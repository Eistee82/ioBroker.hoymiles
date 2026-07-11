import type CloudConnection from "./cloudConnection.js";
import type { BurstInverter, BurstStationPower } from "./cloudConnection.js";
import type DeviceContext from "./deviceContext.js";
import {
	BURST_MIN_INTERVAL_MS,
	BURST_MAX_INTERVAL_MS,
	BURST_URI_REFRESH_MS,
	BURST_MAX_FAILURES,
	CLOUD_POLL_CONCURRENCY,
} from "./constants.js";
import { stationStateMap, buildStateCommon } from "./stateDefinitions.js";
import { anonymize, errorMessage, mapLimit } from "./utils.js";

// The burst endpoint types its power fields as numbers, but the main cloud API is known to
// deliver numerics as strings — coerce defensively before persisting into number-typed states.
const num = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v)) || 0);

interface BurstPollerOptions {
	cloud: CloudConnection;
	adapter: ioBroker.Adapter;
	devices: Map<string, DeviceContext>;
	stationDevices: Set<number>;
	/**
	 * Shared set of station ids the burst is actively streaming. The cloud poller reads it to
	 * yield `station-<id>.grid.power` to the burst (avoids the slow poller overwriting live values).
	 */
	burstActiveStations: Set<number>;
}

/** Per-inverter routing info: which DTU state-tree the burst values belong to. */
interface InverterTarget {
	/** DTU serial = state id prefix (`<dtuSerial>.grid.power`, `<dtuSerial>.pvN.power`). */
	dtuSerial: string;
	/** Device context, for on-demand PV-state creation. */
	dev: DeviceContext;
}

/** Runtime state of one station's realtime burst loop. */
interface StationBurst {
	stationId: number;
	/** Realtime URL from `get_sd_uri` (host + path + `?k=…&t=…`). Re-fetched when it ages out. */
	uri: string;
	/** Timestamp (ms) the current `uri` was fetched — drives token refresh. */
	uriFetchedAt: number;
	/** Inverter serial → routing target. Only cloud-only DTUs (no live local/relay link). */
	targets: Map<string, InverterTarget>;
	timer: ioBroker.Timeout | undefined;
	stopped: boolean;
	/** Consecutive failed polls — at {@link BURST_MAX_FAILURES} the state claim is released. */
	consecutiveFailures: number;
	/**
	 * True while the claim on `grid.power`/`pvN.power` is released back to the slow cloud
	 * poller (after persistent failures). The loop keeps polling and re-claims on success.
	 */
	claimReleased: boolean;
}

/**
 * Polls the fast-updating realtime "burst" channel (`eurt.…/rds/api/0/burst/get`) — the same
 * source the S-Miles app's live view uses — for every cloud-only DTU. Runs in parallel to the
 * slower {@link CloudPoller}: the burst delivers per-inverter AC + per-PV-string power at the
 * server-dictated cadence (~1.5–3 s), while the cloud poller keeps supplying everything the
 * burst does not (voltage, current, temperature, energy counters) at its slower interval.
 *
 * Deliberately skips any DTU with a live local or relay connection (`connection?.connected`):
 * those already have direct realtime data, and hitting the cloud burst for them would add load
 * and could interfere with the relay.
 */
class BurstPoller {
	private readonly cloud: CloudConnection;
	private readonly adapter: ioBroker.Adapter;
	private readonly devices: Map<string, DeviceContext>;
	private readonly stationDevices: Set<number>;
	private readonly burstActiveStations: Set<number>;
	private readonly stations: Map<number, StationBurst>;
	/** Station-state object ids already created via `writeStationState` (avoids re-issuing extendObject). */
	private readonly stationStateObjects: Set<string>;
	private stopped: boolean;

	/**
	 * @param options - Burst poller configuration.
	 */
	constructor(options: BurstPollerOptions) {
		this.cloud = options.cloud;
		this.adapter = options.adapter;
		this.devices = options.devices;
		this.stationDevices = options.stationDevices;
		this.burstActiveStations = options.burstActiveStations;
		this.stations = new Map();
		this.stationStateObjects = new Set();
		this.stopped = false;
	}

	/** Start a realtime burst loop for every station that has at least one cloud-only DTU. */
	async start(): Promise<void> {
		await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async stationId => {
			if (this.stopped) {
				return;
			}
			try {
				await this.startStation(stationId);
			} catch (err) {
				this.adapter.log.debug(`Burst: station ${stationId} start failed: ${errorMessage(err)}`);
			}
		});
	}

	/** Stop all burst loops, clear timers, and release the cloud poller's `grid.power`/`pvN.power` gate. */
	stop(): void {
		this.stopped = true;
		for (const sb of this.stations.values()) {
			sb.stopped = true;
			this.burstActiveStations.delete(sb.stationId);
			for (const t of sb.targets.values()) {
				t.dev.burstActive = false;
			}
			if (sb.timer) {
				this.adapter.clearTimeout(sb.timer);
				sb.timer = undefined;
			}
		}
		this.stations.clear();
	}

	/**
	 * Build the cloud-only inverter target map for a station and kick off its poll loop.
	 * Does nothing if the station has no cloud-only inverters.
	 *
	 * @param stationId - Cloud station ID.
	 */
	private async startStation(stationId: number): Promise<void> {
		const targets = new Map<string, InverterTarget>();
		let deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>> = [];
		try {
			deviceTree = await this.cloud.getDeviceTree(stationId);
		} catch (err) {
			this.adapter.log.debug(`Burst: device tree for station ${stationId} failed: ${errorMessage(err)}`);
			return;
		}

		for (const dtu of deviceTree) {
			const dev = this.devices.get(dtu.sn);
			// Only cloud-only DTUs. A locally-configured DTU (enableLocal) owns its realtime data
			// even while its TCP link is down (e.g. overnight) — claiming it here would double-write
			// grid.power/pvN.power once the local connection resumes, because the claim is never
			// re-evaluated. `connection?.connected` stays as a belt-and-braces guard.
			if (!dev?.dtuSerial || dev.enableLocal || dev.connection?.connected) {
				continue;
			}
			for (const inv of dtu.children ?? []) {
				if (inv.sn) {
					targets.set(inv.sn, { dtuSerial: dev.dtuSerial, dev });
				}
			}
		}

		if (targets.size === 0) {
			return;
		}

		const uri = await this.cloud.getRealtimeUri(stationId);
		// Claim the overlapping power states so the slow cloud poller stops writing them.
		for (const t of targets.values()) {
			t.dev.burstActive = true;
		}
		this.burstActiveStations.add(stationId);
		const sb: StationBurst = {
			stationId,
			uri,
			uriFetchedAt: Date.now(),
			targets,
			timer: undefined,
			stopped: false,
			consecutiveFailures: 0,
			claimReleased: false,
		};
		this.stations.set(stationId, sb);
		this.adapter.log.info(
			`Burst realtime started for station ${stationId} (${targets.size} cloud-only inverter(s))`,
		);
		void this.poll(sb);
	}

	/**
	 * Run one burst poll for a station and self-reschedule at the server-dictated `dly`.
	 *
	 * @param sb - Station burst state.
	 */
	private async poll(sb: StationBurst): Promise<void> {
		if (sb.stopped || this.stopped) {
			return;
		}

		let nextDelay = BURST_MIN_INTERVAL_MS;
		try {
			// Refresh the short-lived k-token URL before it ages out.
			if (Date.now() - sb.uriFetchedAt > BURST_URI_REFRESH_MS) {
				sb.uri = await this.cloud.getRealtimeUri(sb.stationId);
				sb.uriFetchedAt = Date.now();
			}

			const data = await this.cloud.pollRealtimeBurst(sb.uri, {
				m: 3,
				mis: [...sb.targets.keys()],
				t: 1,
			});

			// The poll works again — take the power states back from the slow cloud poller.
			if (sb.claimReleased) {
				for (const t of sb.targets.values()) {
					t.dev.burstActive = true;
				}
				this.burstActiveStations.add(sb.stationId);
				sb.claimReleased = false;
				this.adapter.log.info(`Burst realtime for station ${sb.stationId} resumed`);
			}
			sb.consecutiveFailures = 0;

			// `con:1` = the DTU is live-streaming → the values are genuinely current (good, 0x00).
			// Anything else means the stream is not live, so mark the sample as stale (0x42).
			const quality: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY] = data.con === 1 ? 0x00 : 0x42;
			for (const inv of data.mis ?? []) {
				await this.writeInverter(sb, inv, quality);
			}

			// Station-level power flow (m:0), aggregated live across all inverters of the station.
			// The first poll after opening the stream sometimes omits `power` — just skip it then.
			const stationData = await this.cloud.pollRealtimeBurst(sb.uri, { m: 0, t: 1 });
			if (stationData.power) {
				const sq: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY] = stationData.con === 1 ? 0x00 : 0x42;
				await this.writeStation(sb.stationId, stationData.power, sq);
			}

			// Server tells us when to poll next; clamp to sane bounds.
			nextDelay = Math.min(
				Math.max(data.dly ?? BURST_MIN_INTERVAL_MS, BURST_MIN_INTERVAL_MS),
				BURST_MAX_INTERVAL_MS,
			);
		} catch (err) {
			// A stale k-token surfaces as HTTP 400/401 — force a URL refresh on the next tick.
			sb.uriFetchedAt = 0;
			nextDelay = BURST_MAX_INTERVAL_MS;
			sb.consecutiveFailures++;
			// On a persistent outage, release the claim so the slow cloud poller resumes writing
			// (and freshness-flagging) grid.power/pvN.power — otherwise they would stay frozen at
			// their last "good" value forever. The loop keeps polling and re-claims on success.
			if (!sb.claimReleased && sb.consecutiveFailures >= BURST_MAX_FAILURES) {
				for (const t of sb.targets.values()) {
					t.dev.burstActive = false;
				}
				this.burstActiveStations.delete(sb.stationId);
				sb.claimReleased = true;
				this.adapter.log.info(
					`Burst realtime for station ${sb.stationId} paused after ${BURST_MAX_FAILURES} consecutive failures — the slow cloud poller takes over until the burst recovers`,
				);
			}
			this.adapter.log.debug(`Burst: poll failed for station ${sb.stationId}: ${errorMessage(err)}`);
		}

		if (sb.stopped || this.stopped) {
			return;
		}
		sb.timer = this.adapter.setTimeout(() => {
			sb.timer = undefined;
			void this.poll(sb);
		}, nextDelay);
	}

	/**
	 * Write one inverter's burst sample: AC total → `grid.power`, PV strings `p1..p4` → `pvN.power`.
	 * Creates PV states on demand if the cloud poller hasn't yet.
	 *
	 * @param sb - Station burst state (for target lookup).
	 * @param inv - One `mis[]` entry (per-inverter power sample) from the burst response.
	 * @param quality - ioBroker state quality for this sample (0x00 live, 0x42 stale).
	 */
	private async writeInverter(
		sb: StationBurst,
		inv: BurstInverter,
		quality: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY],
	): Promise<void> {
		const target = sb.targets.get(inv.sn);
		if (!target) {
			return;
		}
		const sn = target.dtuSerial;
		const cs = (id: string, val: number): Promise<void> =>
			this.adapter.setStateAsync(id, { val, ack: true, q: quality }).then(() => {});

		const strings = [inv.p1, inv.p2, inv.p3, inv.p4].map(num);
		// Highest populated PV index (a string that ever produced > 0). Ensures the pv states exist.
		const activePv = strings.reduce((max, p, i) => (p > 0 ? i + 1 : max), 0);
		if (activePv > target.dev.pvCount && target.dev.deviceId) {
			await target.dev.createPvStates(activePv, true);
		}

		const writes: Array<Promise<void>> = [cs(`${sn}.grid.power`, num(inv.pac))];
		for (let i = 0; i < target.dev.pvCount; i++) {
			writes.push(cs(`${sn}.pv${i}.power`, strings[i] ?? 0));
		}
		// allSettled: a single failed setState must not abort the sibling writes or bubble into
		// poll()'s catch (which would count it as a burst outage and back off the whole station).
		await Promise.allSettled(writes);
		this.adapter.log.debug(
			`Burst ${anonymize(sn, "dtu")}: pac=${num(inv.pac)}W pv=[${strings.slice(0, target.dev.pvCount).join(",")}]`,
		);
	}

	/**
	 * Write the station-level realtime power flow (burst m:0) to `station-<id>.grid.*`. `power.pv`
	 * feeds `grid.power` (the aggregate live generation); grid/load/battery flow and PV utilization
	 * go to their own states (non-zero only on metered/battery systems).
	 *
	 * @param stationId - Cloud station id.
	 * @param power - The `power` object from a burst m:0 response.
	 * @param quality - ioBroker state quality (0x00 live, 0x42 stale).
	 */
	private async writeStation(
		stationId: number,
		power: BurstStationPower,
		quality: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY],
	): Promise<void> {
		const deviceId = `station-${stationId}`;
		const ws = (suffix: string, val: number): Promise<void> =>
			this.writeStationState(deviceId, suffix, val, quality);
		await Promise.allSettled([
			ws("grid.power", num(power.pv)),
			ws("grid.gridPower", num(power.grid)),
			ws("grid.loadPower", num(power.load)),
			ws("grid.batteryPower", num(power.bat)),
			ws("grid.pvUtilization", num(power.pvr)),
		]);
	}

	/**
	 * Set a station state, creating its object on demand from `stationStateMap`. Object creation is
	 * cached per full id so subsequent writes are a plain setState.
	 *
	 * @param deviceId - `station-<id>`.
	 * @param suffix - State suffix (a key in `stationStateMap`).
	 * @param val - Value to write.
	 * @param quality - ioBroker state quality.
	 */
	private async writeStationState(
		deviceId: string,
		suffix: string,
		val: number,
		quality: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY],
	): Promise<void> {
		const fullId = `${deviceId}.${suffix}`;
		if (!this.stationStateObjects.has(fullId)) {
			const def = stationStateMap.get(suffix);
			if (def) {
				await this.adapter.extendObjectAsync(fullId, {
					type: "state",
					common: buildStateCommon(def),
					native: {},
				});
			}
			this.stationStateObjects.add(fullId);
		}
		await this.adapter.setStateAsync(fullId, { val, ack: true, q: quality });
	}
}

export default BurstPoller;
