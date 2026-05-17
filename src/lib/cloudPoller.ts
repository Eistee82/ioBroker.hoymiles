import type CloudConnection from "./cloudConnection.js";
import { toKwh } from "./convert.js";
import type DeviceContext from "./deviceContext.js";
import { CLOUD_POLL_CONCURRENCY, DEFAULT_POLL_MS, MIN_POLL_MS, RELAY_POLL_DELAY_MS } from "./constants.js";
import { deriveStationTzOffsetMs, errorMessage, logOnError, mapLimit, stationWallClockToEpoch } from "./utils.js";
import { stationStateMap, buildStateCommon } from "./stateDefinitions.js";

/**
 * Parse a string to number, returning 0 for NaN/undefined.
 *
 * @param v - String value to parse
 */
const num = (v: string | undefined | null): number => parseFloat(v as string) || 0;

/** OpenWeatherMap icon codes → human-readable descriptions. */
const WEATHER_DESCRIPTIONS: Record<string, { en: string; de: string }> = {
	"01d": { en: "Clear sky", de: "Klarer Himmel" },
	"01n": { en: "Clear sky", de: "Klarer Himmel" },
	"02d": { en: "Few clouds", de: "Leicht bewölkt" },
	"02n": { en: "Few clouds", de: "Leicht bewölkt" },
	"03d": { en: "Scattered clouds", de: "Aufgelockert bewölkt" },
	"03n": { en: "Scattered clouds", de: "Aufgelockert bewölkt" },
	"04d": { en: "Overcast", de: "Bedeckt" },
	"04n": { en: "Overcast", de: "Bedeckt" },
	"09d": { en: "Shower rain", de: "Regenschauer" },
	"09n": { en: "Shower rain", de: "Regenschauer" },
	"10d": { en: "Rain", de: "Regen" },
	"10n": { en: "Rain", de: "Regen" },
	"11d": { en: "Thunderstorm", de: "Gewitter" },
	"11n": { en: "Thunderstorm", de: "Gewitter" },
	"13d": { en: "Snow", de: "Schnee" },
	"13n": { en: "Snow", de: "Schnee" },
	"50d": { en: "Mist/Fog", de: "Nebel" },
	"50n": { en: "Mist/Fog", de: "Nebel" },
};

/** Cloud polling states that determine what data is fetched and at what interval. */
type CloudPollState = "POLLING_ACTIVE" | "RELAY_TRIGGERED" | "NIGHT_MODE";

interface CloudPollerOptions {
	cloud: CloudConnection;
	adapter: ioBroker.Adapter;
	devices: Map<string, DeviceContext>;
	stationDevices: Set<number>;
	slowPollFactor: number;
	hasRelay: boolean;
}

/**
 * Handles periodic cloud data polling for station and inverter data.
 *
 * State machine:
 * - POLLING_ACTIVE: Self-timed polling at pollIntervalMs (cloud-only or local+cloud without relay)
 * - RELAY_TRIGGERED: Polls triggered by relay dataSent events (+30s delay), no own timer
 * - NIGHT_MODE: Only weather + firmware checks (local offline / night)
 */
class CloudPoller {
	private static readonly PORT_COUNT_RE = /(\d+)T$/;

	private readonly cloud: CloudConnection;
	private readonly adapter: ioBroker.Adapter;
	private readonly devices: Map<string, DeviceContext>;
	private readonly stationDevices: Set<number>;
	private readonly slowPollFactor: number;
	private readonly hasRelay: boolean;

	private state: CloudPollState;
	private pollCount: number;
	private pollTimer: ioBroker.Timeout | undefined;
	private pollIntervalMs: number;
	private stationCoords: Map<number, { lat: number; lon: number; tzOffsetS: number }>;
	/**
	 * Per-station UTC offset in ms, derived from the station's reported `local_time`.
	 * Used to convert the cloud's local-zone `data_time` / `create_at` strings to a UTC epoch.
	 */
	private stationTzOffsetMs: Map<number, number>;
	/**
	 * Day-of-month of the last firmware check, per station id. Per-station so a multi-station
	 * account checks every station — a single shared counter skipped all but the first.
	 */
	private lastFirmwareCheckDay: Map<number, number>;
	private initialFetchDone: boolean;

	/** Timestamp (ms) of last cloud realtime data fetch per DTU serial. */
	private lastRealtimeFetch: Map<string, number>;
	private pollInProgress: boolean;

	/** Cached bound setStateAsync to avoid re-creating closures on every poll. */
	private readonly boundSetState: ioBroker.Adapter["setStateAsync"];
	/** Cached last cloudConnected value to avoid redundant state writes. */
	private lastCloudConnected: boolean | undefined;
	/** State-objects already created via `writeStationState`. Avoids re-issuing extendObjectAsync per poll. */
	private readonly stationStateObjects: Set<string> = new Set();

	/**
	 * @param options - Cloud poller configuration
	 */
	constructor(options: CloudPollerOptions) {
		this.cloud = options.cloud;
		this.adapter = options.adapter;
		this.devices = options.devices;
		this.stationDevices = options.stationDevices;
		this.slowPollFactor = options.slowPollFactor;
		this.hasRelay = options.hasRelay;

		this.state = "POLLING_ACTIVE";
		this.pollCount = 0;
		this.pollTimer = undefined;
		this.pollIntervalMs = DEFAULT_POLL_MS;
		this.stationCoords = new Map();
		this.stationTzOffsetMs = new Map();
		this.lastFirmwareCheckDay = new Map();
		this.lastRealtimeFetch = new Map();
		this.initialFetchDone = false;
		this.pollInProgress = false;
		this.boundSetState = this.adapter.setStateAsync.bind(this.adapter);
	}

	/**
	 * Write a cloud-station state, creating the underlying object on demand.
	 *
	 * Skips entirely when `value` is null/undefined/empty-string — the Home API surface
	 * delivers a leaner record than the Web API (no `latitude`/`longitude`/`address`/etc.),
	 * and we don't want to populate the object tree with zero/empty placeholders for those
	 * accounts. Once an object has been created for a given full id, the existence check
	 * is cached so subsequent polls are a plain `setStateAsync`.
	 *
	 * @param deviceId - Station device id, e.g. `station-10022030`.
	 * @param suffix - State suffix matching a key in `stationStateMap`, e.g. `info.address`.
	 * @param value - Value to write. Null/undefined/empty string → skipped.
	 */
	private async writeStationState(
		deviceId: string,
		suffix: string,
		value: string | number | boolean | null | undefined,
	): Promise<void> {
		if (value === null || value === undefined || value === "") {
			return;
		}
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
		await this.boundSetState(fullId, value, true);
	}

	/**
	 * Initial full fetch of all cloud data on adapter start.
	 * Forces a slow poll cycle to get station details, weather, firmware, etc.
	 * After completion, sets the state based on whether a relay is active.
	 */
	async initialFetch(): Promise<void> {
		if (this.initialFetchDone) {
			return;
		}
		this.initialFetchDone = true;
		this.pollCount = 0;

		// Set state before poll to prevent race with onLocalDisconnected
		if (this.hasRelay) {
			this.state = "RELAY_TRIGGERED";
		} else {
			this.state = "POLLING_ACTIVE";
		}
		await this.poll(true);
	}

	/**
	 * Schedule self-rescheduling cloud poll timer.
	 * Only effective when state is POLLING_ACTIVE.
	 */
	scheduleCloudPoll(): void {
		if (this.state !== "POLLING_ACTIVE") {
			return;
		}
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.pollTimer = this.adapter.setTimeout(async () => {
			this.pollTimer = undefined;
			// Re-check state — may have changed during the wait
			if (this.state !== "POLLING_ACTIVE") {
				return;
			}
			await this.poll();
			this.scheduleCloudPoll();
		}, this.pollIntervalMs);
	}

	/**
	 * Called when a cloud relay sends data.
	 * Schedules a poll 30s later to fetch the updated cloud data.
	 */
	onRelayDataSent(): void {
		if (this.state === "NIGHT_MODE") {
			return;
		}
		this.state = "RELAY_TRIGGERED";
		// Cancel any pending timer
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.pollTimer = this.adapter.setTimeout(async () => {
			this.pollTimer = undefined;
			if (this.state === "NIGHT_MODE") {
				return;
			}
			await this.poll();
			// Do NOT self-reschedule — wait for next relay trigger
		}, RELAY_POLL_DELAY_MS);
	}

	/**
	 * Called when a local DTU connection is established.
	 * Exits NIGHT_MODE and enters the appropriate active state.
	 */
	onLocalConnected(): void {
		if (this.state === "NIGHT_MODE") {
			// Cancel any pending night poll timer
			if (this.pollTimer) {
				this.adapter.clearTimeout(this.pollTimer);
				this.pollTimer = undefined;
			}
			if (this.hasRelay) {
				this.state = "RELAY_TRIGGERED";
				// Wait for first relay dataSent event to trigger a poll
			} else {
				this.state = "POLLING_ACTIVE";
				this.scheduleCloudPoll();
			}
		}
	}

	/**
	 * Called when ALL local DTU connections are offline (e.g. night).
	 * Performs one final poll, then enters NIGHT_MODE with reduced polling.
	 */
	async onLocalDisconnected(): Promise<void> {
		// Cancel any pending timer first to prevent stale polls after state change
		this.stop();

		// One last full poll to capture final state
		await logOnError(
			() => this.poll(),
			msg => this.adapter.log.warn(msg),
			"Final poll before night mode failed",
		);

		this.state = "NIGHT_MODE";
		this.scheduleNightPoll();
	}

	/**
	 * Update the poll interval from DTU serverSendTime config.
	 * If in POLLING_ACTIVE state, restarts the poll timer with the new interval.
	 *
	 * @param minutes - Interval in minutes (minimum 1, values ≤ 0 are ignored)
	 */
	setServerSendTime(minutes: number): void {
		if (minutes <= 0) {
			return;
		}
		this.pollIntervalMs = Math.max(minutes * 60 * 1000, MIN_POLL_MS);
		// Restart poll timer if actively self-scheduling
		if (this.state === "POLLING_ACTIVE" && this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
			this.scheduleCloudPoll();
		}
	}

	/** Stop any pending poll timer. */
	stop(): void {
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.lastRealtimeFetch.clear();
	}

	/**
	 * Run a single cloud poll cycle across all stations.
	 *
	 * @param forceSlowPoll - If true, forces a slow poll cycle (station details, weather, firmware)
	 */
	async poll(forceSlowPoll = false): Promise<void> {
		if (!this.cloud || this.pollInProgress) {
			return;
		}

		this.pollInProgress = true;
		try {
			this.pollCount++;
			const isSlowPoll = forceSlowPoll || this.pollCount % this.slowPollFactor === 0;

			await this.cloud.ensureToken();

			await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async stationId => {
				try {
					await this.pollStation(stationId, isSlowPoll);
				} catch (stationErr) {
					this.adapter.log.warn(`Cloud poll failed for station ${stationId}: ${errorMessage(stationErr)}`);
				}
			});

			await this.setCloudConnected(true);
		} catch (err) {
			this.adapter.log.warn(`Cloud poll failed: ${errorMessage(err)}`);
			await this.setCloudConnected(false);
		} finally {
			this.pollInProgress = false;
		}
	}

	// --- Private polling sub-methods ---

	/** Schedule a reduced poll (weather + firmware only) for night mode. */
	private scheduleNightPoll(): void {
		if (this.state !== "NIGHT_MODE") {
			return;
		}
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		const interval = this.slowPollFactor * DEFAULT_POLL_MS;
		this.pollTimer = this.adapter.setTimeout(async () => {
			this.pollTimer = undefined;
			if (this.state !== "NIGHT_MODE") {
				return;
			}
			await this.nightPoll();
			this.scheduleNightPoll();
		}, interval);
	}

	/** Night mode poll: only weather and firmware checks. */
	private async nightPoll(): Promise<void> {
		try {
			await this.cloud.ensureToken();
			// State may have changed during async ensureToken (e.g. local reconnect)
			if (this.state !== "NIGHT_MODE") {
				return;
			}
			await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async stationId => {
				const deviceId = `station-${stationId}`;
				await this.pollWeather(stationId, deviceId);
				if (this.firmwareCheckDue(stationId)) {
					await this.pollFirmwareStatus(stationId);
				}
			});
			await this.setCloudConnected(true);
		} catch (err) {
			this.adapter.log.warn(`Night poll failed: ${errorMessage(err)}`);
			await this.setCloudConnected(false);
		}
	}

	private async pollStation(stationId: number, isSlowPoll: boolean): Promise<void> {
		const deviceId = `station-${stationId}`;

		// Station realtime data (every cycle)
		const data = await this.cloud.getStationRealtime(stationId);

		// Station details run BEFORE the realtime states on a slow poll: they cache the
		// station's UTC offset that setStationRealtimeStates needs to convert data_time.
		if (isSlowPoll) {
			await this.pollStationDetails(stationId, deviceId, data);
		}
		await this.setStationRealtimeStates(stationId, deviceId, data);

		// Weather (slow poll ~30min), firmware (once per day)
		if (isSlowPoll) {
			await this.pollWeather(stationId, deviceId);
			if (this.firmwareCheckDue(stationId)) {
				await this.pollFirmwareStatus(stationId);
			}
		}

		// Device tree + per-inverter data
		await this.pollDevicesAndInverters(stationId, isSlowPoll);

		this.adapter.log.debug(
			`Cloud data (station ${stationId}): ${data.real_power}W, today=${toKwh(data.today_eq).toFixed(2)}kWh, total=${toKwh(data.total_eq).toFixed(2)}kWh`,
		);
	}

	private async setStationRealtimeStates(
		stationId: number,
		deviceId: string,
		data: Awaited<ReturnType<CloudConnection["getStationRealtime"]>>,
	): Promise<void> {
		const w = (suffix: string, value: string | number | boolean | null | undefined): Promise<void> =>
			this.writeStationState(deviceId, suffix, value);
		// data_time / last_data_time arrive in the station's LOCAL zone, not UTC — convert
		// with the offset cached by pollStationDetails (0 = no offset known yet, first poll).
		const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
		await Promise.all([
			w("grid.power", num(data.real_power)),
			w("grid.dailyEnergy", toKwh(data.today_eq)),
			w("grid.monthEnergy", toKwh(data.month_eq)),
			w("grid.yearEnergy", toKwh(data.year_eq)),
			w("grid.totalEnergy", toKwh(data.total_eq)),
			w("grid.co2Saved", Math.round(num(data.co2_emission_reduction) / 10) / 100),
			w("grid.treesPlanted", num(data.plant_tree)),
			// is_balance / is_reflux: server sends number (0/1) on Home and boolean on Web — both coerce cleanly via !!.
			w("grid.isBalance", !!data.is_balance),
			w("grid.isReflux", !!data.is_reflux),
			w("info.lastCloudUpdate", stationWallClockToEpoch(data.data_time, offsetMs)),
			w("info.lastDataTime", stationWallClockToEpoch(data.last_data_time, offsetMs)),
		]);
	}

	private async pollStationDetails(
		stationId: number,
		deviceId: string,
		realtimeData: Awaited<ReturnType<CloudConnection["getStationRealtime"]>>,
	): Promise<void> {
		try {
			const details = await this.cloud.getStationDetails(stationId);
			const w = (suffix: string, value: string | number | boolean | null | undefined): Promise<void> =>
				this.writeStationState(deviceId, suffix, value);
			// Home accounts (find_c) lack latitude/longitude/address/status/timezone.offset — the
			// helper skips empty/undefined values so those states never get created on the home side.
			let lat = details.latitude != null ? num(details.latitude) : null;
			let lon = details.longitude != null ? num(details.longitude) : null;
			let address = details.address ?? null;
			// Station UTC offset, derived from the reported wall-clock `local_time` — the
			// only reliable anchor (find's `timezone` object carries no machine-readable
			// offset). Cached so the realtime poll can convert `data_time`; on a parse
			// failure we keep any previously cached value rather than resetting to 0.
			const derivedOffsetMs = deriveStationTzOffsetMs(details.local_time);
			if (derivedOffsetMs != null) {
				this.stationTzOffsetMs.set(stationId, derivedOffsetMs);
			}
			const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
			const tzOffsetS = Math.round(offsetMs / 1000);
			// Some accounts/regions return placeholder 0.0/0.0 from `find` (account host doesn't
			// mirror station-region data). The Home-app supplementary `pvm-ext/station-ak/find`
			// endpoint carries the real coordinates — try it whenever the primary record lacks them.
			if (lat == null || lon == null || (lat === 0 && lon === 0)) {
				try {
					const ext = await this.cloud.getStationExtInfo(stationId);
					if (ext) {
						const extLat = ext.latitude != null ? num(ext.latitude) : null;
						const extLon = ext.longitude != null ? num(ext.longitude) : null;
						if (extLat != null && extLon != null && (extLat !== 0 || extLon !== 0)) {
							lat = extLat;
							lon = extLon;
							address = ext.address ?? address;
						}
					}
				} catch (err) {
					this.adapter.log.debug(`Station ext-info failed for ${stationId}: ${errorMessage(err)}`);
				}
			}
			if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
				this.stationCoords.set(stationId, { lat, lon, tzOffsetS });
			}
			const price = details.electricity_price ?? null;
			// Station-level grid/meter warning flags from `find`. The home `find_c` record
			// may omit `warn_data` entirely — writeStationState skips undefined, so those
			// states simply never get created on accounts that don't deliver them.
			const wd = details.warn_data;
			await Promise.all([
				w("info.stationName", details.name || null),
				w("info.stationId", stationId),
				w("info.systemCapacity", details.capacitor != null ? num(details.capacitor) : null),
				w("info.address", address || null),
				w("info.latitude", lat),
				w("info.longitude", lon),
				w("info.stationStatus", details.status ?? null),
				w("info.installedAt", stationWallClockToEpoch(details.create_at, offsetMs)),
				w("info.timezone", details.timezone?.tz_name || null),
				w("grid.electricityPrice", price),
				w("grid.currency", details.money_unit || null),
				// Income calculations require a price > 0; otherwise skip so we don't create a meaningless 0-state.
				w("grid.todayIncome", price ? Math.round(toKwh(realtimeData.today_eq) * price * 100) / 100 : null),
				w("grid.totalIncome", price ? Math.round(toKwh(realtimeData.total_eq) * price * 100) / 100 : null),
				w("warn.stationOffline", wd?.s_uoff),
				w("warn.gridUnstable", wd?.s_ustable),
				w("warn.gridFault", wd?.g_warn),
				w("warn.alarmActive", wd?.l3_warn),
				w("warn.deviceIdError", wd?.s_uid),
				w("warn.meterFault", wd?.me_warn),
				w("warn.powerOutputOff", wd?.pw_off),
			]);
		} catch (err) {
			this.adapter.log.debug(`Cloud station details failed for ${stationId}: ${errorMessage(err)}`);
		}
	}

	private async pollDevicesAndInverters(stationId: number, isSlowPoll: boolean): Promise<void> {
		let hasCloudOnlyDtus = false;
		for (const d of this.devices.values()) {
			if (d.cloudStationId === stationId && d.dtuSerial && !d.connection?.connected) {
				hasCloudOnlyDtus = true;
				break;
			}
		}

		let deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>> = [];
		if (hasCloudOnlyDtus || isSlowPoll) {
			try {
				deviceTree = await this.cloud.getDeviceTree(stationId);
			} catch (err) {
				this.adapter.log.debug(`Cloud device tree failed for station ${stationId}: ${errorMessage(err)}`);
			}
		}

		// Refresh info.connected for cloud-only DTUs from the cloud's link status.
		await this.updateCloudConnectedStates(deviceTree);

		// DTU/inverter versions (slow poll only)
		if (isSlowPoll && deviceTree.length > 0) {
			await this.updateDeviceVersions(deviceTree);
		}

		// Per-inverter + per-PV realtime data
		await this.pollInverterRealtimeData(stationId, deviceTree);
	}

	/**
	 * Write `<dtuSerial>.info.connected` for **cloud-only** DTUs from the cloud's reported
	 * link status (`warn_data.connect` on the inverter node — the same signal that feeds
	 * `inverter.linkStatus`).
	 *
	 * Locally-configured DTUs (`connection != null`, even while their TCP link is down) are
	 * deliberately skipped: an inverter is "online" exactly when the local DTU connection
	 * stands, and that state is owned by the local layer (`deviceContext`). When the sun
	 * sets the connection drops and `deviceContext` sets `connected = false`; the cloud
	 * must not resurrect it to `true` from cached cloud data. Overwriting it here was the
	 * cause of offline inverters showing as online.
	 *
	 * @param deviceTree - Device tree from `getDeviceTree()`.
	 */
	private async updateCloudConnectedStates(
		deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>>,
	): Promise<void> {
		for (const dtu of deviceTree) {
			const dtuDev = this.devices.get(dtu.sn);
			if (!dtuDev?.dtuSerial || dtuDev.connection != null) {
				// not mapped, or locally configured → local layer owns info.connected
				continue;
			}
			const online = dtu.children?.some(inv => inv.warn_data?.connect) ?? false;
			await this.boundSetState(`${dtuDev.dtuSerial}.info.connected`, online, true);
		}
	}

	private async updateDeviceVersions(
		deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>>,
	): Promise<void> {
		const s = this.boundSetState;
		for (const dtu of deviceTree) {
			const dtuDevice = this.devices.get(dtu.sn);
			if (!dtuDevice?.dtuSerial) {
				continue;
			}
			const sn = dtuDevice.dtuSerial;
			const isLocal = dtuDevice.connection?.connected;

			const writes: Array<Promise<unknown>> = [];
			if (!isLocal) {
				writes.push(
					s(`${sn}.dtu.serialNumber`, dtu.sn || "", true),
					s(`${sn}.dtu.swVersion`, dtu.soft_ver || "", true),
					s(`${sn}.dtu.hwVersion`, dtu.hard_ver || "", true),
				);
			}
			if (dtu.children?.[0]) {
				const inv = dtu.children[0];
				writes.push(s(`${sn}.inverter.model`, inv.model_no || "", true));
				if (!isLocal) {
					writes.push(
						s(`${sn}.inverter.serialNumber`, inv.sn || "", true),
						s(`${sn}.inverter.swVersion`, inv.soft_ver || "", true),
						s(`${sn}.inverter.hwVersion`, inv.hard_ver || "", true),
						s(`${sn}.inverter.linkStatus`, inv.warn_data?.connect ? 1 : 0, true),
					);
				}
			}
			await Promise.all(writes);
		}
	}

	private async pollInverterRealtimeData(
		stationId: number,
		deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>>,
	): Promise<void> {
		if (deviceTree.length === 0) {
			return;
		}

		const now = Date.now();
		const tzOffsetS = this.stationCoords.get(stationId)?.tzOffsetS ?? 0;
		const today = new Date(now + tzOffsetS * 1000).toISOString().substring(0, 10);

		// Collect DTUs that need fetching (skip local-connected and recently fetched)
		const dtuTasks: Array<{
			dtu: (typeof deviceTree)[0];
			dtuDev: DeviceContext;
			sn: string;
			microIds: number[];
		}> = [];

		for (const dtu of deviceTree) {
			const dtuDev = this.devices.get(dtu.sn);
			if (!dtuDev?.dtuSerial || dtuDev.connection?.connected) {
				continue;
			}

			const sn = dtuDev.dtuSerial;

			// Skip if last fetch was within pollIntervalMs (serverSendTime-based throttling)
			const lastFetch = this.lastRealtimeFetch.get(sn) || 0;
			if (now - lastFetch < this.pollIntervalMs) {
				continue;
			}

			const microIds: number[] = [];
			for (const inv of dtu.children || []) {
				if (inv.id) {
					microIds.push(inv.id);
				}
			}
			if (microIds.length === 0) {
				continue;
			}

			dtuTasks.push({ dtu, dtuDev, sn, microIds });
		}

		if (dtuTasks.length === 0) {
			return;
		}

		// Fetch DTUs with limited concurrency
		await mapLimit(dtuTasks, CLOUD_POLL_CONCURRENCY, async ({ dtu, dtuDev, sn, microIds }) => {
			try {
				this.lastRealtimeFetch.set(sn, now);
				const s = this.boundSetState;
				// Cloud-sourced data states use q=0x40 (substitute value from device/instance)
				const cs = (id: string, val: ioBroker.StateValue): Promise<void> =>
					s(id, { val, ack: true, q: 0x40 }).then(() => {});

				// Inverter-level metrics
				const values = await this.cloud.getMicroRealtimeData(stationId, microIds, today, [
					"MI_POWER",
					"MI_NET_V",
					"MI_NET_RATE",
					"MI_TEMPERATURE",
				]);
				if (!values) {
					return; // Error already logged in CloudConnection
				}

				// info.connected is NOT written here — updateCloudConnectedStates() owns it
				// (cloud-only DTUs only), so a locally-configured DTU that is merely offline
				// for the night keeps the `false` its local layer set.
				const writes: Array<Promise<void>> = [];
				if (values.MI_POWER !== undefined) {
					writes.push(cs(`${sn}.grid.power`, values.MI_POWER));
				}
				if (values.MI_NET_V !== undefined) {
					writes.push(cs(`${sn}.grid.voltage`, values.MI_NET_V));
				}
				if (values.MI_NET_RATE !== undefined) {
					writes.push(cs(`${sn}.grid.frequency`, values.MI_NET_RATE));
				}
				if (values.MI_TEMPERATURE !== undefined) {
					writes.push(cs(`${sn}.inverter.temperature`, values.MI_TEMPERATURE));
				}
				const writeResults = await Promise.allSettled(writes);
				for (const r of writeResults) {
					if (r.status === "rejected") {
						this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
					}
				}

				// Per-PV port metrics (parallel per port)
				const pvTasks: Array<Promise<void>> = [];
				const children = dtu.children || [];

				// Ensure PV states exist for the max port count across all inverter children
				if (!dtuDev.pvStatesCreated && children.length > 0) {
					let maxPorts = 0;
					for (const inv of children) {
						const m = CloudPoller.PORT_COUNT_RE.exec(inv.model_no || "");
						maxPorts = Math.max(maxPorts, Math.min(Math.max(m ? parseInt(m[1], 10) : 2, 1), 6));
					}
					if (maxPorts > 0) {
						await dtuDev.createPvStates(maxPorts, true);
						dtuDev.pvStatesCreated = true;
					}
				}

				for (const inv of children) {
					if (!inv.id) {
						continue;
					}
					const portMatch = CloudPoller.PORT_COUNT_RE.exec(inv.model_no || "");
					if (!portMatch) {
						this.adapter.log.debug(
							`Could not extract port count from model "${inv.model_no}", using default: 2`,
						);
					}
					const portCount = Math.min(Math.max(portMatch ? parseInt(portMatch[1], 10) : 2, 1), 6);

					for (let p = 1; p <= portCount; p++) {
						pvTasks.push(
							this.cloud
								.getModuleRealtimeData(stationId, inv.id, p, today, [
									"MODULE_POWER",
									"MODULE_V",
									"MODULE_I",
								])
								.then(modValues => this.setPvStates(cs, sn, p - 1, modValues)),
						);
					}
				}
				await Promise.all(pvTasks);
			} catch (err) {
				this.adapter.log.debug(`Cloud realtime data failed for DTU ${sn}: ${errorMessage(err)}`);
			}
		});

		// Clean up stale entries for DTUs no longer in the device map
		for (const sn of this.lastRealtimeFetch.keys()) {
			if (!this.devices.has(sn)) {
				this.lastRealtimeFetch.delete(sn);
			}
		}

		// Clean up stale per-station entries for stations no longer present
		for (const sid of this.stationCoords.keys()) {
			if (!this.stationDevices.has(sid)) {
				this.stationCoords.delete(sid);
			}
		}
		for (const sid of this.stationTzOffsetMs.keys()) {
			if (!this.stationDevices.has(sid)) {
				this.stationTzOffsetMs.delete(sid);
			}
		}
		for (const sid of this.lastFirmwareCheckDay.keys()) {
			if (!this.stationDevices.has(sid)) {
				this.lastFirmwareCheckDay.delete(sid);
			}
		}
	}

	private async setPvStates(
		cs: (id: string, val: ioBroker.StateValue, ack?: boolean) => Promise<void>,
		sn: string,
		pvIndex: number,
		modValues: Record<string, number> | null,
	): Promise<void> {
		if (!modValues) {
			return;
		}
		const prefix = `${sn}.pv${pvIndex}`;
		const writes: Array<Promise<void>> = [];
		if (modValues.MODULE_POWER !== undefined) {
			writes.push(cs(`${prefix}.power`, modValues.MODULE_POWER));
		}
		if (modValues.MODULE_V !== undefined) {
			writes.push(cs(`${prefix}.voltage`, modValues.MODULE_V));
		}
		if (modValues.MODULE_I !== undefined) {
			writes.push(cs(`${prefix}.current`, modValues.MODULE_I));
		}
		const pvResults = await Promise.allSettled(writes);
		for (const r of pvResults) {
			if (r.status === "rejected") {
				this.adapter.log.warn(`PV state write failed: ${errorMessage(r.reason)}`);
			}
		}
	}

	private async pollWeather(stationId: number, deviceId: string): Promise<void> {
		const coords = this.stationCoords.get(stationId);
		if (!coords) {
			return;
		}
		try {
			const weather = await this.cloud.getWeather(coords.lat, coords.lon);
			const w = (suffix: string, value: string | number | boolean | null | undefined): Promise<void> =>
				this.writeStationState(deviceId, suffix, value);
			const desc = WEATHER_DESCRIPTIONS[weather.icon];
			await Promise.all([
				w("weather.icon", weather.icon || null),
				w("weather.description", desc?.en || weather.icon || null),
				w("weather.temperature", weather.temp ?? null),
				w("weather.sunrise", weather.sunrise ? weather.sunrise * 1000 : null),
				w("weather.sunset", weather.sunset ? weather.sunset * 1000 : null),
			]);
		} catch (err) {
			this.adapter.log.debug(`Weather data failed for station ${stationId}: ${errorMessage(err)}`);
		}
	}

	private async setCloudConnected(connected: boolean): Promise<void> {
		if (connected !== this.lastCloudConnected) {
			this.lastCloudConnected = connected;
			await this.adapter.setStateAsync("info.cloudConnected", connected, true);
		}
	}

	/**
	 * True at most once per calendar day per station — gates the daily firmware check.
	 * Marks the station as checked for today as a side effect.
	 *
	 * @param stationId - Cloud station ID.
	 */
	private firmwareCheckDue(stationId: number): boolean {
		const today = new Date().getDate();
		if (this.lastFirmwareCheckDay.get(stationId) === today) {
			return false;
		}
		this.lastFirmwareCheckDay.set(stationId, today);
		return true;
	}

	private async pollFirmwareStatus(stationId: number): Promise<void> {
		try {
			for (const device of this.devices.values()) {
				if (device.cloudStationId !== stationId || !device.dtuSerial) {
					continue;
				}
				const fw = await this.cloud.checkFirmwareUpdate(stationId, device.dtuSerial);
				await this.adapter.setStateAsync(`${device.dtuSerial}.dtu.fwUpdateAvailable`, fw.upgrade > 0, true);
			}
		} catch (err) {
			this.adapter.log.debug(`Firmware check failed for station ${stationId}: ${errorMessage(err)}`);
		}
	}
}

export default CloudPoller;
