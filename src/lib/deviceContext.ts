import DtuConnection from "./dtuConnection.js";
import CloudRelay from "./cloudRelay.js";
import {
	type ProtobufHandler,
	type RealDataResult,
	formatDtuVersion,
	formatSwVersion,
	formatInvVersion,
} from "./protobufHandler.js";
import { executeCommand, executeCloudCommand } from "./commandHandler.js";
import Encryption from "./encryption.js";
import { channels, states } from "./stateDefinitions.js";
import { getAlarmDescription } from "./alarmCodes.js";
import { decodeGridProfile, byteSwap16 } from "./gridProfile.js";
import { INFO_FALLBACK_TIMEOUT_MS, SCALE_POWER, CLOUD_DEV_TYPE_DTU } from "./constants.js";
import { whToKwh } from "./convert.js";
import { errorMessage, safeJsonStringify, unixSeconds } from "./utils.js";

/** Maximum number of PV ports supported by any Hoymiles inverter model. */
const MAX_PV_PORTS = 6;

/** Extended adapter interface exposing Hoymiles-specific methods to DeviceContext. */
export interface HoymilesAdapter extends ioBroker.Adapter {
	/** Map aller aktiven Geräte (Serial → DeviceContext). */
	devices: Map<string, DeviceContext>;
	/** Lokales Gerät mit Cloud-Gegenstück abgleichen. */
	matchLocalDeviceToCloud(ctx: DeviceContext): void;
	/** Cloud-Relay hat Daten gesendet, Cloud-Poll auslösen. */
	onRelayDataSent(): void;
	/** Lokales Gerät hat sich verbunden. */
	onLocalConnected(ctx: DeviceContext): void;
	/** Lokales Gerät hat sich getrennt. */
	onLocalDisconnected(ctx: DeviceContext): void;
	/** Cloud-Send-Intervall wurde vom DTU empfangen. */
	onSendTimeUpdated(ctx: DeviceContext): void;
	/** Adapter-weiten Verbindungsstatus neu berechnen. */
	updateConnectionState(): Promise<void>;
	/** Steuerbefehl über die Cloud senden (für Geräte ohne lokale Verbindung). */
	sendCloudDeviceCommand(devSn: string, dtuSn: string, action: number, devType?: number): Promise<void>;
}

interface DeviceContextOptions {
	adapter: HoymilesAdapter;
	protobuf: ProtobufHandler;
	host: string;
	enableLocal: boolean;
	enableCloud: boolean;
	enableCloudRelay: boolean;
	dataInterval: number;
	slowPollFactor: number;
}

/** A non-routine downlink frame the cloud sent to the relay (server → DTU command). */
interface CloudRelayCommand {
	cmdHigh: number;
	cmdLow: number;
	seq: number;
	payload: Buffer;
}

/** PV field definitions — base fields available from both local and cloud. */
const PV_FIELDS_BASE = [
	{ suffix: "power", en: "power", de: "Leistung", role: "value.power", unit: "W" },
	{ suffix: "voltage", en: "voltage", de: "Spannung", role: "value.voltage", unit: "V" },
	{ suffix: "current", en: "current", de: "Strom", role: "value.current", unit: "A" },
] as const;

/** PV field definitions — only available from local TCP connection. */
const PV_FIELDS_LOCAL_ONLY = [
	{ suffix: "dailyEnergy", en: "daily energy", de: "Tagesenergie", role: "value.energy", unit: "kWh" },
	{ suffix: "totalEnergy", en: "total energy", de: "Gesamtenergie", role: "value.energy", unit: "kWh" },
	// PvMO.error_code (field 8): per-string fault code, 0 in normal operation. Raw value
	// (no scaling) — firmware-confirmed field, decoded but previously unexposed.
	{ suffix: "errorCode", en: "error code", de: "Fehlercode", role: "value", unit: "" },
] as const;

/** Writable state IDs that need subscriptions (relative to device prefix). */
const WRITABLE_STATES = [
	"inverter.powerLimit",
	"inverter.active",
	"inverter.reboot",
	"inverter.powerFactorLimit",
	"inverter.reactivePowerLimit",
	"inverter.cleanWarnings",
	"inverter.cleanGroundingFault",
	"inverter.lock",
	"config.serverSendTime",
	"config.limitPowerMyPower",
	"dtu.reboot",
];

/** A normalized alarm/warning entry ready to be written to states. */
interface NormalizedAlarm {
	sn: string;
	code: number;
	num: number;
	startTime: number;
	endTime: number;
	data1: number;
	data2: number;
	descriptionEn: string;
	descriptionDe: string;
	active: boolean;
}

/** Manages a single DTU device: connection, polling, state updates, and commands. */
class DeviceContext {
	readonly adapter: HoymilesAdapter;
	readonly host: string;
	readonly enableLocal: boolean;
	readonly enableCloud: boolean;
	readonly enableCloudRelay: boolean;

	/** DTU serial number — learned from first info response or cloud. */
	dtuSerial: string;
	/** ioBroker device ID (= dtuSerial once known). */
	deviceId: string;
	/** Whether state objects have been created under deviceId. */
	private statesCreated: boolean;
	/** Whether device is ready for state updates. */
	private get ready(): boolean {
		return !!(this.deviceId && this.statesCreated);
	}
	/** Whether initial InfoData has been received (serial + encryption known). */
	private infoReceived: boolean;

	connection: DtuConnection | null;
	cloudRelay: CloudRelay | null;
	protobuf: ProtobufHandler;
	encryption: Encryption | null;
	encryptionRequired: boolean;

	/** Matched cloud station ID for this device. */
	cloudStationId: number | null;

	private pollTimer: ioBroker.Interval | undefined;
	pvStatesCreated: boolean;
	/** Number of PV-string states created so far. Read by the burst poller to size its writes. */
	pvCount: number;
	/**
	 * True while the realtime burst poller is actively streaming this DTU's power. The cloud
	 * poller then skips the overlapping `grid.power`/`pvN.power` writes (the burst owns them,
	 * faster and fresher) but keeps supplying the metrics the burst does not: voltage, current,
	 * frequency, temperature, energy counters.
	 */
	burstActive: boolean;
	private meterStatesCreated: boolean;
	private histStatesCreated: boolean;
	private pollCount: number;
	private slowPollEvery: number;
	cloudServerDomain: string;
	cloudSendTimeMin: number;
	private cloudRelayInitializing: boolean;
	private dataInterval: number;
	/** Micro-inverter serial (from InfoData) — needed as `dev_sn` for DevConfigFetch (grid profile). */
	private inverterSn: string;
	/** Grid-profile chunk accumulator: package index → raw data bytes. */
	private readonly gridChunks: Map<number, Buffer> = new Map();
	/** Paginated warn-list accumulator: package index (0-based) → normalized alarms of that package. */
	private readonly warnChunks: Map<number, NormalizedAlarm[]> = new Map();
	/** Last fully-read grid-profile blob (big-endian), cached to answer cloud-relay reads. */
	private gridBlob: Buffer | null = null;
	/**
	 * DTU/inverter serials exactly as the DTU sent them in the local DevConfigFetch response
	 * (`dtu_sn`/`dev_sn` are `bytes`, not an ASCII serial). Echoed verbatim into the cloud
	 * grid-profile upload so the cloud can match it to the pending read. `null` until read.
	 */
	private gridDtuSn: Buffer | null = null;
	private gridDevSn: Buffer | null = null;
	/**
	 * Transaction id of an in-flight cloud grid-profile read (action 41). Set when we ack the
	 * command; the grid file (0x22 0x0e) is uploaded only once the cloud acks our status
	 * (0x23 0x06), mirroring the real DTU's handshake. `null` when no read is pending.
	 */
	private pendingGridServeTid: number | null = null;

	/** Pending response resolver for request-response pairing. */
	private pendingResponse: { cmdKey: string; resolve: () => void; timer: ioBroker.Timeout | undefined } | null;
	/** Slow-poll command queue — one command per tick, round-robin. */
	private slowPollQueue: Array<(ts: number) => Buffer>;
	private slowPollIndex: number;
	private slowPollRotations: number;
	/** Guard against overlapping poll ticks. */
	private pollBusy: boolean;
	/** Consecutive poll tick errors — stops polling after threshold. */
	private consecutivePollErrors: number;
	/** Fallback timer for InfoData timeout. */
	private infoFallbackTimer: ioBroker.Timeout | undefined;
	/** Deferred poll start timer. */
	private pollStartTimer: ioBroker.Timeout | undefined;
	/** Active resetButton timers (adapter-managed, auto-cleared on stop). */
	private readonly resetButtonTimers: Set<ioBroker.Timeout> = new Set();

	/**
	 * Create a new DeviceContext.
	 *
	 * @param options - Device configuration options
	 */
	constructor(options: DeviceContextOptions) {
		this.adapter = options.adapter;
		this.host = options.host;
		this.enableLocal = options.enableLocal;
		this.enableCloud = options.enableCloud;
		this.enableCloudRelay = options.enableCloudRelay;
		this.dataInterval = options.dataInterval;
		this.slowPollEvery = options.slowPollFactor || 6;

		this.dtuSerial = "";
		this.deviceId = "";
		this.statesCreated = false;
		this.infoReceived = false;

		this.connection = null;
		this.cloudRelay = null;
		this.protobuf = options.protobuf;
		this.encryption = null;
		this.encryptionRequired = false;
		this.cloudStationId = null;

		this.pollTimer = undefined;
		this.pvStatesCreated = false;
		this.pvCount = 0;
		this.burstActive = false;
		this.meterStatesCreated = false;
		this.histStatesCreated = false;
		this.pollCount = 0;

		this.cloudServerDomain = "";
		this.cloudRelayInitializing = false;
		this.cloudSendTimeMin = 0;
		this.pendingResponse = null;
		this.slowPollQueue = [];
		this.slowPollIndex = 0;
		this.slowPollRotations = 0;
		this.pollBusy = false;
		this.consecutivePollErrors = 0;
		this.inverterSn = "";
	}

	/**
	 * Initialize device ID from known DTU serial (e.g. from cloud).
	 *
	 * @param serial - DTU serial number
	 */
	async initFromSerial(serial: string): Promise<void> {
		this.dtuSerial = serial;
		this.deviceId = serial;
		// Register device for command routing (critical when cloud is disabled)
		if (!this.adapter.devices.has(serial)) {
			this.adapter.devices.set(serial, this);
		}
		await this.createDeviceAndStates();
		// Set connected state (may have been missed during initial connect before serial was known)
		const isConnected = this.connection && this.connection.connected;
		await this.adapter.setStateAsync(`${this.deviceId}.info.connected`, !!isConnected, true);
	}

	// --- Connection lifecycle ---

	/** Start local TCP connection to DTU. */
	connect(): void {
		if (!this.enableLocal || !this.host) {
			return;
		}

		this.connection = new DtuConnection(
			this.host,
			10081,
			() => {
				const ts = unixSeconds();
				return this.protobuf.encodeHeartbeat(ts);
			},
			this.adapter,
		);

		let lastErrorMsg = "";
		let errorRepeatCount = 0;

		this.connection.on("connected", () => {
			this.adapter.log.info(`[${this.host}] Connected to DTU`);
			lastErrorMsg = "";
			errorRepeatCount = 0;
			this.onConnected().catch(err =>
				this.adapter.log.warn(`[${this.host}] onConnected error: ${errorMessage(err)}`),
			);
		});

		this.connection.on("disconnected", () => {
			this.adapter.log.warn(`[${this.host}] Disconnected from DTU`);
			this.stopPollCycle();
			if (this.cloudRelay && !this.cloudRelay.paused) {
				this.adapter.log.info(`[${this.deviceId || this.host}] Pausing cloud relay (local connection lost)`);
				this.cloudRelay.sendFinalAndPause();
			}
			if (this.deviceId) {
				this.adapter
					.setStateAsync(`${this.deviceId}.info.connected`, false, true)
					.catch(err =>
						this.adapter.log.warn(`[${this.host}] Failed to set connected state: ${errorMessage(err)}`),
					);
			}
			this.markStatesDisconnected().catch(err =>
				this.adapter.log.warn(`[${this.host}] markStatesDisconnected error: ${errorMessage(err)}`),
			);
			this.updateAdapterConnectionState().catch(err =>
				this.adapter.log.warn(`[${this.host}] updateAdapterConnectionState error: ${errorMessage(err)}`),
			);

			// Notify adapter that a local device disconnected (for CloudPoller night mode)
			this.adapter.onLocalDisconnected(this);
		});

		this.connection.on("message", (message: Buffer) => {
			this.handleResponse(message);
		});

		this.connection.on("error", (err: Error) => {
			if (err.message === lastErrorMsg) {
				errorRepeatCount++;
				this.adapter.log.debug(`[${this.host}] DTU: ${err.message} (repeated ${errorRepeatCount}x)`);
				return;
			}
			lastErrorMsg = err.message;
			errorRepeatCount = 1;
			this.adapter.log.warn(`[${this.host}] DTU: ${err.message}`);
		});

		this.connection.on("idle", () => {
			this.adapter.log.warn(`[${this.host}] No data from DTU for 5 minutes, reconnecting...`);
		});

		this.connection.connect();
	}

	private async onConnected(): Promise<void> {
		if (this.deviceId) {
			await this.adapter.setStateAsync(`${this.deviceId}.info.connected`, true, true);
		}
		// Reset cache quality so first data after reconnect is written even if values match
		for (const [, cached] of this.stateCache) {
			if (cached.q === DeviceContext.Q_DEVICE_DISCONNECTED) {
				cached.q = 0;
			}
		}
		await this.updateAdapterConnectionState();

		// Resume cloud relay if it was paused
		if (this.cloudRelay && this.cloudRelay.paused) {
			this.adapter.log.info(`[${this.deviceId || this.host}] Resuming cloud relay (local connection restored)`);
			this.cloudRelay.resume();
		}

		// Notify adapter that a local device is connected (for CloudPoller state transitions)
		this.adapter.onLocalConnected(this);

		// Reset infoReceived — on reconnect we need fresh info (encryption keys may change)
		this.infoReceived = false;

		// Request device info immediately — poll cycle starts after InfoData is received
		const ts = unixSeconds();
		this.connection?.send(this.protobuf.encodeInfoRequest(ts)).catch(e => {
			this.adapter.log.debug(`[${this.deviceId}] InfoRequest send failed: ${errorMessage(e)}`);
		});

		// Fallback: if InfoData doesn't arrive within 10s, start poll cycle anyway
		this.infoFallbackTimer = this.adapter.setTimeout(() => {
			this.infoFallbackTimer = undefined;
			if (!this.infoReceived && this.connection?.connected) {
				this.adapter.log.warn(`[${this.host}] No InfoData received within 10s, starting poll cycle without it`);
				this.startPollCycle();
			}
		}, INFO_FALLBACK_TIMEOUT_MS);
	}

	/** Create ioBroker device node and all channel/state objects. */
	private async createDeviceAndStates(): Promise<void> {
		if (this.statesCreated || !this.deviceId) {
			return;
		}

		// Create device node with statusStates for admin UI indicator
		await this.adapter.extendObjectAsync(this.deviceId, {
			type: "device",
			common: {
				name: `DTU ${this.deviceId}`,
				statusStates: { onlineId: "info.connected" },
				icon: "hoymiles.png",
			},
			native: { host: this.host },
		});

		// Create info channel under device
		await this.adapter.extendObjectAsync(`${this.deviceId}.info`, {
			type: "channel",
			common: { name: { en: "Device info", de: "Geräte-Info" } },
			native: {},
		});

		// Create channels (only for active sources)
		const activeChannels = channels.filter(
			ch => !(ch.source === "local" && !this.enableLocal) && !(ch.source === "cloud" && !this.enableCloud),
		);
		await Promise.all(
			activeChannels.map(ch =>
				this.adapter.setObjectNotExistsAsync(`${this.deviceId}.${ch.id}`, {
					type: "channel",
					common: { name: ch.name },
					native: {},
				}),
			),
		);

		// Create states (only for active sources)
		const activeStates = states.filter(
			def => !(def.source === "local" && !this.enableLocal) && !(def.source === "cloud" && !this.enableCloud),
		);
		await Promise.all(
			activeStates.map(def => {
				const common: Partial<ioBroker.StateCommon> = {
					name: def.name,
					type: def.type,
					role: def.role,
					unit: def.unit || "",
					read: true,
					write: def.write || false,
					def: def.type === "boolean" ? false : def.type === "number" ? 0 : "",
					min: def.min,
					max: def.max,
					states: def.states,
				};
				return this.adapter.extendObjectAsync(`${this.deviceId}.${def.id}`, {
					type: "state",
					common: common,
					native: {},
				});
			}),
		);

		// Initialize states with default values if they have no value yet
		await Promise.all(
			activeStates.map(async def => {
				const current = await this.adapter.getStateAsync(`${this.deviceId}.${def.id}`);
				if (!current || current.val === null) {
					const defaultVal = def.type === "boolean" ? false : def.type === "number" ? 0 : "";
					await this.adapter.setStateAsync(`${this.deviceId}.${def.id}`, defaultVal, true);
				}
			}),
		);

		// Remove states/channels that no longer exist in the definitions (e.g. after an
		// adapter update that renamed or dropped a state) so they disappear from the tree.
		await this.cleanupObsoleteObjects();

		// Subscribe to writable states for this device
		for (const stateId of WRITABLE_STATES) {
			this.adapter.subscribeStates(`${this.deviceId}.${stateId}`);
		}

		this.statesCreated = true;
		this.adapter.log.info(`[${this.deviceId}] Device states created`);
	}

	/**
	 * Delete states/channels under this device that are no longer part of the current
	 * definitions. Keeps dynamically-created objects (PV channels, meter, history) and
	 * everything still listed in `states`/`channels`. Runs once after state creation so
	 * obsolete entries from older adapter versions vanish on update.
	 */
	private async cleanupObsoleteObjects(): Promise<void> {
		const knownStates = new Set(states.map(d => d.id));
		const knownChannels = new Set(channels.map(c => c.id));
		const isKnown = (rel: string): boolean =>
			knownStates.has(rel) ||
			knownChannels.has(rel) ||
			/^pv\d+(\.|$)/.test(rel) || // dynamic PV channels + states
			rel === "meter" ||
			rel.startsWith("meter.") || // dynamic meter channel
			rel === "history" ||
			rel.startsWith("history."); // dynamic history channel

		const prefix = `${this.adapter.namespace}.${this.deviceId}.`;
		try {
			const removed: string[] = [];
			for (const kind of ["state", "channel"] as const) {
				const view = await this.adapter.getObjectViewAsync("system", kind, {
					startkey: prefix,
					endkey: `${prefix}香`,
				});
				for (const row of view.rows) {
					const rel = row.id.slice(prefix.length);
					if (rel && !isKnown(rel)) {
						await this.adapter.delObjectAsync(row.id, { recursive: true });
						removed.push(rel);
					}
				}
			}
			if (removed.length) {
				this.adapter.log.info(
					`[${this.deviceId}] Removed ${removed.length} obsolete object(s): ${removed.join(", ")}`,
				);
			}
		} catch (e) {
			this.adapter.log.debug(`[${this.deviceId}] Obsolete-object cleanup skipped: ${errorMessage(e)}`);
		}
	}

	/**
	 * Create PV channel and states dynamically based on pvNumber from DTU info.
	 *
	 * @param pvCount - Number of PV inputs reported by DTU
	 * @param cloudOnly - If true, only create states available from cloud (power, voltage, current)
	 */
	async createPvStates(pvCount: number, cloudOnly = false): Promise<void> {
		if (!this.deviceId) {
			return;
		}
		this.pvCount = Math.min(pvCount, MAX_PV_PORTS);
		for (let i = 0; i < this.pvCount; i++) {
			const ch = `${this.deviceId}.pv${i}`;
			await this.adapter.extendObjectAsync(ch, {
				type: "channel",
				common: { name: { en: `PV input ${i}`, de: `PV-Eingang ${i}` } },
				native: {},
			});
			const pvFields = cloudOnly ? PV_FIELDS_BASE : [...PV_FIELDS_BASE, ...PV_FIELDS_LOCAL_ONLY];
			for (const f of pvFields) {
				await this.adapter.extendObjectAsync(`${ch}.${f.suffix}`, {
					type: "state",
					common: {
						name: { en: `PV${i} ${f.en}`, de: `PV${i} ${f.de}` },
						type: "number",
						role: f.role,
						unit: f.unit,
						read: true,
						write: false,
						def: 0,
					},
					native: {},
				});
			}
		}
	}

	private async createMeterStates(): Promise<void> {
		if (!this.deviceId) {
			return;
		}
		this.adapter.log.info(`[${this.deviceId}] Meter detected, creating meter states`);
		await this.adapter.setObjectNotExistsAsync(`${this.deviceId}.meter`, {
			type: "channel",
			common: { name: { en: "Energy meter", de: "Energiezähler" } },
			native: {},
		});
		const m = (
			id: string,
			en: string,
			de: string,
			role: string,
			unit: string,
		): { id: string; name: ioBroker.StringOrTranslated; role: string; unit: string } => ({
			id: `meter.${id}`,
			name: { en, de },
			role,
			unit,
		});
		const meterDefs = [
			m("totalPower", "Total power", "Gesamtleistung", "value.power", "W"),
			m("phaseAPower", "Phase A power", "Phase A Leistung", "value.power", "W"),
			m("phaseBPower", "Phase B power", "Phase B Leistung", "value.power", "W"),
			m("phaseCPower", "Phase C power", "Phase C Leistung", "value.power", "W"),
			m("powerFactorTotal", "Power factor total", "Leistungsfaktor gesamt", "value", ""),
			m("energyTotalExport", "Total energy export", "Gesamtenergie Export", "value.energy", "kWh"),
			m("energyTotalImport", "Total energy import", "Gesamtenergie Import", "value.energy", "kWh"),
			m("voltagePhaseA", "Voltage phase A", "Spannung Phase A", "value.voltage", "V"),
			m("voltagePhaseB", "Voltage phase B", "Spannung Phase B", "value.voltage", "V"),
			m("voltagePhaseC", "Voltage phase C", "Spannung Phase C", "value.voltage", "V"),
			m("currentPhaseA", "Current phase A", "Strom Phase A", "value.current", "A"),
			m("currentPhaseB", "Current phase B", "Strom Phase B", "value.current", "A"),
			m("currentPhaseC", "Current phase C", "Strom Phase C", "value.current", "A"),
			m("faultCode", "Fault code", "Fehlercode", "value", ""),
		];
		await Promise.all(
			meterDefs.map(def =>
				this.adapter.extendObjectAsync(`${this.deviceId}.${def.id}`, {
					type: "state",
					common: {
						name: def.name,
						type: "number",
						role: def.role,
						unit: def.unit,
						read: true,
						write: false,
						def: 0,
					},
					native: {},
				}),
			),
		);
	}

	// --- Polling ---

	private startPollCycle(): void {
		this.stopPollCycle();
		const seconds = this.dataInterval > 0 ? this.dataInterval : 1;
		const interval = seconds * 1000;
		this.pollCount = 0;
		this.consecutivePollErrors = 0;

		this.slowPollIndex = 0;
		this.slowPollRotations = 0;
		this.pollBusy = false;

		// Build slow-poll command queue — one command per slow-poll tick, round-robin.
		// Rebuilding on each cycle start is correct: these are stateless function references,
		// so there is no accumulated state to preserve from a previous cycle.
		this.slowPollQueue = [
			ts => this.protobuf.encodeGetConfigRequest(ts),
			ts => this.protobuf.encodeAlarmTrigger(ts),
			ts => this.protobuf.encodeMiWarnRequest(ts),
		];

		this.adapter.log.info(
			`[${this.deviceId || this.host}] Poll cycle: every ${seconds}s, config/alarms every ${this.slowPollEvery} polls`,
		);

		const onPollError = (err: unknown): void => {
			this.consecutivePollErrors++;
			this.adapter.log.warn(`[${this.deviceId || this.host}] pollTick error: ${errorMessage(err)}`);
			if (this.consecutivePollErrors >= 5) {
				this.adapter.log.error(
					`[${this.deviceId || this.host}] 5 consecutive poll errors, stopping poll cycle`,
				);
				this.stopPollCycle();
			}
		};
		this.pollTick().catch(onPollError);
		this.pollTimer = this.adapter.setInterval(() => {
			this.pollTick().catch(onPollError);
		}, interval);

		// Read the grid profile once per (re)connect — it is near-static, so no need to poll it
		// repeatedly. The DTU answers via DevConfigFetch (0xa2 0x07); handleDevConfigFetch
		// reassembles chunked packages and decodes the blob into gridProfile.* states.
		this.requestGridProfile();
	}

	/** Kick off a grid-profile read (package 0). Subsequent packages are requested in the handler. */
	private requestGridProfile(): void {
		if (!this.enableLocal || !this.inverterSn || !this.connection?.connected || !this.protobuf) {
			return;
		}
		this.gridChunks.clear();
		this.connection
			.send(this.protobuf.encodeDevConfigFetch(unixSeconds(), this.dtuSerial, this.inverterSn))
			.catch(e => {
				this.adapter.log.debug(`[${this.deviceId}] DevConfigFetch send failed: ${errorMessage(e)}`);
			});
	}

	/**
	 * Handle a downlink command the cloud sent to the relay (which impersonates the DTU).
	 * Currently answers the grid-profile read (action 41); other commands are logged only.
	 *
	 * @param cmd - Parsed downlink frame from the cloud relay.
	 */
	private handleCloudCommand(cmd: CloudRelayCommand): void {
		if (!this.protobuf || !this.cloudRelay) {
			return;
		}
		try {
			// The cloud acks our command-status with 0x23 0x06 (CommandStatusResDTO). For a
			// grid-profile read the real DTU uploads the grid file (0x22 0x0e) only after this
			// status-ack, so complete a pending read here rather than up front.
			if (cmd.cmdHigh === 0x23 && cmd.cmdLow === 0x06) {
				this.handleCloudStatusAck(cmd.payload);
				return;
			}
			// Cloud action commands arrive as 0x23 0x05 (CommandResDTO with an action code).
			if (!(cmd.cmdHigh === 0x23 && cmd.cmdLow === 0x05)) {
				this.adapter.log.debug(
					`[${this.deviceId}] [diag] cloud command 0x${cmd.cmdHigh.toString(16)} 0x${cmd.cmdLow.toString(16)} — not handled`,
				);
				return;
			}
			const ResDTO = this.protobuf.getType("CommandPB", "CommandResDTO");
			const obj = ResDTO.toObject(ResDTO.decode(cmd.payload), { longs: Number, defaults: true }) as Record<
				string,
				unknown
			>;
			const action = Number(obj.action) || 0;
			const tid = Number(obj.tid) || 0;
			this.adapter.log.debug(`[${this.deviceId}] [diag] cloud command action=${action} tid=${tid}`);
			if (action === 41) {
				this.serveGridProfileToCloud(tid);
			} else if (action === 4) {
				this.serveVersionToCloud(tid);
			}
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId}] handleCloudCommand error: ${errorMessage(err)}`);
		}
	}

	/**
	 * Begin answering a cloud grid-profile read (action 41) over the relay: send ack (0x22 0x05)
	 * + status (0x22 0x06) and arm the pending serve. The grid file (0x22 0x0e) itself is sent
	 * later from {@link handleCloudStatusAck}, once the cloud acks this status with 0x23 0x06 —
	 * the real DTU follows the same order, and uploading the file up front makes the cloud show
	 * "no data".
	 *
	 * @param tid - Transaction id from the originating command (echoed back).
	 */
	private serveGridProfileToCloud(tid: number): void {
		const relay = this.cloudRelay;
		if (!relay || !this.protobuf || !this.gridBlob || !this.gridDtuSn || !this.gridDevSn) {
			this.adapter.log.debug(`[${this.deviceId}] grid-profile cloud-serve skipped (relay/blob/sn missing)`);
			return;
		}
		const ts = unixSeconds();
		relay.sendFrame(this.protobuf.encodeCloudCommandAck(ts, this.dtuSerial, 41, tid));
		relay.sendFrame(this.protobuf.encodeCloudCommandStatus(ts, this.dtuSerial, 41, tid));
		this.pendingGridServeTid = tid;
		this.adapter.log.debug(
			`[${this.deviceId}] grid-profile read: ack+status sent, awaiting cloud status-ack (tid=${tid})`,
		);
	}

	/**
	 * Handle the cloud's status acknowledgement (0x23 0x06, `CommandStatusResDTO`). When it
	 * confirms a pending grid-profile read, upload the grid file (0x22 0x0e) now — the real DTU
	 * sends it only after this ack. The pending guard (set only for action 41) keeps the
	 * status-ack of an unrelated command (e.g. the version query) from triggering an upload.
	 *
	 * @param payload - `CommandStatusResDTO` payload from the cloud.
	 */
	private handleCloudStatusAck(payload: Buffer): void {
		if (!this.protobuf || this.pendingGridServeTid === null) {
			return;
		}
		const StatusRes = this.protobuf.getType("CommandPB", "CommandStatusResDTO");
		const obj = StatusRes.toObject(StatusRes.decode(payload), { longs: Number, defaults: true }) as Record<
			string,
			unknown
		>;
		const action = Number(obj.action) || 0;
		// A status-ack carrying a different, known action is not ours — leave the read pending.
		if (action !== 0 && action !== 41) {
			return;
		}
		const tid = this.pendingGridServeTid;
		this.pendingGridServeTid = null;
		this.sendGridProfileFile(tid);
	}

	/**
	 * Upload the cached grid file to the cloud (0x22 0x0e, `DevConfigFetchReqDTO`). The blob is
	 * byte-swapped from the locally-read big-endian order to the cloud's little-endian order, and
	 * `dtu_sn`/`dev_sn` echo the raw serial bytes the DTU sent (they are `bytes`, not ASCII).
	 *
	 * @param tid - Transaction id from the originating command (echoed back).
	 */
	private sendGridProfileFile(tid: number): void {
		const relay = this.cloudRelay;
		if (!relay || !this.protobuf || !this.gridBlob || !this.gridDtuSn || !this.gridDevSn) {
			this.adapter.log.debug(`[${this.deviceId}] grid-profile file send skipped (relay/blob/sn missing)`);
			return;
		}
		relay.sendFrame(
			this.protobuf.encodeGridProfileResponse(
				unixSeconds(),
				this.gridDtuSn,
				this.gridDevSn,
				tid,
				byteSwap16(this.gridBlob),
			),
		);
		this.adapter.log.info(`[${this.deviceId}] served grid profile to cloud via relay (tid=${tid})`);
	}

	/**
	 * Answer a cloud version query (action 4) over the relay: ack (0x22 0x05) + status
	 * (0x22 0x06) echoing the inverter serial in `mi_sns_sucs`. There is no separate version
	 * payload — the firmware versions already live in the cloud's device tree (`soft_ver`);
	 * this just lets the request complete instead of timing out while the relay is primary.
	 *
	 * @param tid - Transaction id from the originating command (echoed back).
	 */
	private serveVersionToCloud(tid: number): void {
		const relay = this.cloudRelay;
		if (!relay || !this.protobuf || !this.inverterSn) {
			this.adapter.log.debug(`[${this.deviceId}] version cloud-serve skipped (relay/sn missing)`);
			return;
		}
		const ts = unixSeconds();
		const miSn = Number.parseInt(this.inverterSn, 16);
		relay.sendFrame(this.protobuf.encodeCloudCommandAck(ts, this.dtuSerial, 4, tid));
		relay.sendFrame(
			this.protobuf.encodeCloudCommandStatus(ts, this.dtuSerial, 4, tid, Number.isFinite(miSn) ? [miSn] : []),
		);
		this.adapter.log.info(`[${this.deviceId}] answered cloud version query (action 4) via relay (tid=${tid})`);
	}

	private stopPollCycle(): void {
		if (this.pollTimer) {
			this.adapter.clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		if (this.pendingResponse) {
			this.adapter.clearTimeout(this.pendingResponse.timer);
			this.pendingResponse = null;
		}
		this.pollBusy = false;
	}

	/**
	 * Send a command and wait for the matching response from the DTU.
	 * Resolves true when the response arrives, false on timeout.
	 *
	 * @param conn - DTU connection instance
	 * @param message - Encoded protobuf message to send
	 * @param timeoutMs - Timeout in milliseconds before giving up
	 */
	private sendAndWait(conn: DtuConnection, message: Buffer, timeoutMs = 3000): Promise<boolean> {
		// Expected response: request 0xa3 XX → response 0xa2 XX
		const cmdHigh = message[2] === 0xa3 ? 0xa2 : message[2];
		const cmdLow = message[3];
		const cmdKey = `${cmdHigh}:${cmdLow}`;

		return new Promise(resolve => {
			let resolved = false;
			const settle = (value: boolean): void => {
				if (resolved) {
					return;
				}
				resolved = true;
				resolve(value);
			};

			const timer = this.adapter.setTimeout(() => {
				if (this.pendingResponse?.cmdKey === cmdKey) {
					this.pendingResponse = null;
				}
				settle(false);
			}, timeoutMs);

			this.pendingResponse = { cmdKey, resolve: () => settle(true), timer };
			conn.send(message).catch(err => {
				this.adapter.log.debug(`[${this.host}] sendAndWait send failed: ${errorMessage(err)}`);
				if (this.pendingResponse?.cmdKey === cmdKey) {
					this.adapter.clearTimeout(timer);
					this.pendingResponse = null;
				}
				settle(false);
			});
		});
	}

	private async pollTick(): Promise<void> {
		const conn = this.connection;
		if (!conn?.connected || !this.protobuf || this.pollBusy) {
			return;
		}
		this.pollBusy = true;

		try {
			const ts = unixSeconds();

			// Always send RealData and wait for response
			await this.sendAndWait(conn, this.protobuf.encodeRealDataNewRequest(ts));
			this.consecutivePollErrors = 0;

			// Slow-poll: one extra command per tick, round-robin
			this.pollCount++;
			if (this.pollCount >= this.slowPollEvery && conn.connected) {
				this.pollCount = 0;

				const cmdFactory = this.slowPollQueue[this.slowPollIndex];
				if (cmdFactory) {
					await this.sendAndWait(conn, cmdFactory(ts));
				}

				this.slowPollIndex++;
				if (this.slowPollIndex >= this.slowPollQueue.length) {
					this.slowPollIndex = 0;
					this.slowPollRotations++;

					// Info request every 6 full rotations through the queue
					if (this.slowPollRotations >= 6 && conn.connected) {
						this.slowPollRotations = 0;
						await this.sendAndWait(conn, this.protobuf.encodeInfoRequest(ts));
					}
				}
			}

			if (this.deviceId) {
				await this.adapter.setStateAsync(`${this.deviceId}.info.lastResponse`, Date.now(), true);
			}
		} finally {
			this.pollBusy = false;
		}
	}

	// --- Response handling ---

	private handleResponse(message: Buffer): void {
		try {
			const parsed = this.protobuf.parseResponse(message);
			if (!parsed) {
				this.adapter.log.debug(`[${this.host}] Could not parse response message`);
				return;
			}

			const { cmdHigh, cmdLow, payload } = parsed;
			this.adapter.log.debug(
				`[${this.host}] Response: cmd=0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}, payload=${payload.length} bytes`,
			);

			// Resolve pending sendAndWait if this response matches the expected command
			const responseKey = `${cmdHigh}:${cmdLow}`;
			if (this.pendingResponse && this.pendingResponse.cmdKey === responseKey) {
				this.adapter.clearTimeout(this.pendingResponse.timer);
				const { resolve } = this.pendingResponse;
				this.pendingResponse = null;
				resolve();
			}

			const msgId = (message[2] << 8) | message[3];
			const seqNum = (message[4] << 8) | message[5];

			let decryptedPayload = payload;
			if (this.encryptionRequired && this.encryption) {
				if (!(cmdHigh === 0xa2 && cmdLow === 0x01)) {
					try {
						decryptedPayload = this.encryption.decrypt(payload, msgId, seqNum);
					} catch (err) {
						this.adapter.log.warn(`[${this.host}] Decryption failed: ${errorMessage(err)}`);
						return;
					}
				}
			}

			const tag = this.deviceId || this.host;
			switch ((cmdHigh << 8) | cmdLow) {
				case 0xa211:
					this.cloudRelay?.updateRealData(message);
					this.handleRealData(decryptedPayload).catch(err =>
						this.adapter.log.warn(`[${tag}] handleRealData error: ${errorMessage(err)}`),
					);
					break;
				case 0xa201:
					this.handleInfoData(payload).catch(err =>
						this.adapter.log.warn(`[${tag}] handleInfoData error: ${errorMessage(err)}`),
					);
					break;
				case 0xa209:
					this.handleConfigData(decryptedPayload).catch(err =>
						this.adapter.log.warn(`[${tag}] handleConfigData error: ${errorMessage(err)}`),
					);
					break;
				case 0xa204:
					this.handleAlarmData(decryptedPayload).catch(err =>
						this.adapter.log.warn(`[${tag}] handleAlarmData error: ${errorMessage(err)}`),
					);
					break;
				case 0xa215:
					this.handleHistPower(decryptedPayload).catch(err =>
						this.adapter.log.warn(`[${tag}] handleHistPower error: ${errorMessage(err)}`),
					);
					break;
				case 0xa210:
					this.adapter.log.debug(`[${tag}] SetConfig response received`);
					break;
				case 0xa205:
				case 0x2305:
					this.handleCommandResponse(decryptedPayload);
					break;
				case 0xa202:
					this.adapter.log.debug(`[${this.host}] Heartbeat response received`);
					break;
				case 0xa214:
					try {
						this.handleNetworkInfo(decryptedPayload);
					} catch (err) {
						this.adapter.log.warn(`[${tag}] handleNetworkInfo error: ${errorMessage(err)}`);
					}
					break;
				case 0xa206:
					this.adapter.log.debug(`[${this.host}] CommandStatus response received`);
					break;
				case 0xa216:
					this.adapter.log.debug(`[${this.host}] HistEnergy response: ${decryptedPayload.length} bytes`);
					break;
				case 0xa213:
					this.handleAutoSearch(decryptedPayload).catch(err =>
						this.adapter.log.warn(`[${tag}] handleAutoSearch error: ${errorMessage(err)}`),
					);
					break;
				case 0xa207:
					try {
						this.handleDevConfigFetch(decryptedPayload);
					} catch (err) {
						this.adapter.log.warn(`[${tag}] handleDevConfigFetch error: ${errorMessage(err)}`);
					}
					break;
				default:
					this.adapter.log.debug(
						`[${this.host}] Unknown command response: 0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}`,
					);
			}
		} catch (err) {
			this.adapter.log.warn(`[${this.host}] Error handling response: ${errorMessage(err)}`);
		}
	}

	// --- State management ---

	/** Quality type alias for readability. */
	private static readonly Q_GOOD: ioBroker.STATE_QUALITY["GOOD"] = 0x00;
	private static readonly Q_DEVICE_DISCONNECTED: ioBroker.STATE_QUALITY["DEVICE_NOT_CONNECTED"] = 0x42;

	// Cache size is bounded by the number of state definitions (~70 per device), no pruning needed
	/** Cache of last written state values (including quality) for deduplication. */
	private stateCache: Map<
		string,
		{ val: ioBroker.StateValue; q: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY] }
	> = new Map();

	/**
	 * Set state only if device states are created and value or quality has changed.
	 *
	 * @param stateId - State ID relative to device prefix
	 * @param value - Value to set
	 * @param ack - Acknowledge flag
	 * @param q - Quality attribute (0x00 = good, 0x40 = substitute, 0x42 = device not connected)
	 */
	private async setState(
		stateId: string,
		value: ioBroker.StateValue,
		ack: boolean,
		q: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY] = DeviceContext.Q_GOOD,
	): Promise<void> {
		if (!this.ready) {
			return;
		}
		const cached = this.stateCache.get(stateId);
		if (cached && cached.val === value && cached.q === q) {
			return;
		}
		this.stateCache.set(stateId, { val: value, q });
		if (q === 0) {
			await this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, value, ack);
		} else {
			await this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, { val: value, ack, q });
		}
	}

	/**
	 * Set multiple states in parallel, each only if value or quality has changed.
	 *
	 * @param entries - Array of [stateId, value] tuples
	 * @param ack - Acknowledge flag
	 * @param q - Quality attribute (0x00 = good, 0x40 = substitute, 0x42 = device not connected)
	 */
	private async setStates(
		entries: Array<[string, ioBroker.StateValue]>,
		ack: boolean,
		q: ioBroker.STATE_QUALITY[keyof ioBroker.STATE_QUALITY] = DeviceContext.Q_GOOD,
	): Promise<void> {
		if (!this.ready) {
			return;
		}
		const writes: Array<Promise<unknown>> = [];
		for (const [stateId, value] of entries) {
			const cached = this.stateCache.get(stateId);
			if (!cached || cached.val !== value || cached.q !== q) {
				this.stateCache.set(stateId, { val: value, q });
				if (q === 0) {
					writes.push(this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, value, ack));
				} else {
					writes.push(this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, { val: value, ack, q }));
				}
			}
		}
		if (writes.length > 0) {
			const results = await Promise.allSettled(writes);
			for (const r of results) {
				if (r.status === "rejected") {
					this.adapter.log.warn(`State write failed: ${errorMessage(r.reason)}`);
				}
			}
		}
	}

	/** Regex matching data-channel state IDs that should receive quality updates on disconnect. */
	private static readonly DATA_STATE_PATTERN =
		/^(grid\.|pv\d+\.|inverter\.(temperature|active|warnCount|warnMessage|activePowerLimit)|meter\.)/;

	/**
	 * Mark all cached data states as disconnected (q=0x42).
	 * Called when the local DTU connection is lost.
	 */
	private async markStatesDisconnected(): Promise<void> {
		if (!this.ready) {
			return;
		}
		const writes: Array<Promise<unknown>> = [];
		for (const [stateId, cached] of this.stateCache) {
			if (DeviceContext.DATA_STATE_PATTERN.test(stateId) && cached.q !== DeviceContext.Q_DEVICE_DISCONNECTED) {
				cached.q = DeviceContext.Q_DEVICE_DISCONNECTED;
				writes.push(
					this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, {
						val: cached.val,
						ack: true,
						q: DeviceContext.Q_DEVICE_DISCONNECTED,
					}),
				);
			}
		}
		if (writes.length > 0) {
			const results = await Promise.allSettled(writes);
			for (const r of results) {
				if (r.status === "rejected") {
					this.adapter.log.warn(`State quality write failed: ${errorMessage(r.reason)}`);
				}
			}
		}
	}

	private async handleRealData(payload: Buffer): Promise<void> {
		try {
			const data = this.protobuf.decodeRealDataNew(payload);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] RealData: power=${data.dtuPower}W, dailyEnergy=${data.dtuDailyEnergy}, sgs=${data.sgs.length}, pv=${data.pv.length}, meter=${data.meter.length}`,
			);
			await this.applyRealData(data);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding RealData: ${errorMessage(err)}`);
		}
	}

	/**
	 * Write RealData-derived states from an already-decoded result. Extracted from
	 * {@link handleRealData} so the same mapping logic can be reused by any caller that already
	 * has a decoded RealDataNewReqDTO. Callers are responsible for catching decode errors before
	 * calling this.
	 *
	 * @param data - Decoded RealData result
	 */
	async applyRealData(data: RealDataResult): Promise<void> {
		try {
			const entries: Array<[string, ioBroker.StateValue]> = [
				["info.lastResponse", unixSeconds()],
				["inverter.active", data.sgs.length > 0 && data.dtuPower > 0],
				["grid.dailyEnergy", whToKwh(data.dtuDailyEnergy)],
			];

			if (data.sgs.length > 0) {
				const sgs = data.sgs[0];
				entries.push(
					["grid.power", sgs.activePower],
					["grid.voltage", sgs.voltage],
					["grid.current", sgs.current],
					["grid.frequency", sgs.frequency],
					["grid.reactivePower", sgs.reactivePower],
					["grid.powerFactor", sgs.powerFactor],
					["inverter.temperature", sgs.temperature],
					// SGSMO.warning_number (#10) is NOT a warn code: the S-Miles app never maps it to
					// alarm text (its realtime view reads voltage/frequency/power/temperature only),
					// and the proto names it like WNum (count), not WCode. The authoritative warn
					// codes come via AlarmData/WarnData.WCode and are surfaced as inverter.warnMessage
					// in handleAlarmData(). Keep this only as the raw SGSMO value.
					["inverter.warnCount", sgs.warningNumber],
					// Only write linkStatus if present (proto3 omits default 0, which is indistinguishable from "not sent")
					...(sgs.linkStatus
						? [["inverter.linkStatus", sgs.linkStatus] as [string, ioBroker.StateValue]]
						: []),
					["inverter.serialNumber", sgs.serialNumber],
					["inverter.activePowerLimit", sgs.powerLimit],
					// SGSMO #20: packed (two bytes), exact decode not yet confirmed → raw
					["inverter.modulationIndexSignal", sgs.modulationIndexSignal],
				);
			}

			for (const pv of data.pv) {
				const pvIndex = pv.portNumber - 1;
				if (pvIndex < 0 || pvIndex >= this.pvCount) {
					continue;
				}
				const prefix = `pv${pvIndex}`;
				entries.push(
					[`${prefix}.power`, pv.power],
					[`${prefix}.voltage`, pv.voltage],
					[`${prefix}.current`, pv.current],
					[`${prefix}.dailyEnergy`, whToKwh(pv.energyDaily)],
					[`${prefix}.totalEnergy`, Math.round(pv.energyTotal / 100) / 10], // double normalization: round at Wh precision, then → kWh
					[`${prefix}.errorCode`, pv.errorCode],
				);
			}

			if (data.meter.length > 0) {
				if (!this.meterStatesCreated) {
					await this.createMeterStates();
					this.meterStatesCreated = true;
				}
				const m = data.meter[0];
				entries.push(
					["meter.totalPower", m.phaseTotalPower],
					["meter.phaseAPower", m.phaseAPower],
					["meter.phaseBPower", m.phaseBPower],
					["meter.phaseCPower", m.phaseCPower],
					["meter.powerFactorTotal", m.powerFactorTotal],
					["meter.energyTotalExport", m.energyTotalPower],
					["meter.energyTotalImport", m.energyTotalConsumed],
					["meter.voltagePhaseA", m.voltagePhaseA],
					["meter.voltagePhaseB", m.voltagePhaseB],
					["meter.voltagePhaseC", m.voltagePhaseC],
					["meter.currentPhaseA", m.currentPhaseA],
					["meter.currentPhaseB", m.currentPhaseB],
					["meter.currentPhaseC", m.currentPhaseC],
					["meter.faultCode", m.faultCode],
				);
			}

			await this.setStates(entries, true);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error applying RealData: ${errorMessage(err)}`);
		}
	}

	private async handleInfoData(payload: Buffer): Promise<void> {
		try {
			const info = this.protobuf.decodeInfoData(payload);
			const logLevel = this.deviceId ? "debug" : "info";
			this.adapter.log[logLevel](
				`[${this.host}] Device info: DTU SN=${info.dtuSn}, devices=${info.deviceNumber}, PVs=${info.pvNumber}`,
			);

			// Initialize device ID from DTU serial if not yet known
			if (!this.deviceId && info.dtuSn) {
				const existing = this.adapter.devices.get(info.dtuSn);
				if (existing && existing !== this) {
					// A live local TCP connection takes over any context that has no live local socket
					// (e.g. a cloud-only context, enableLocal:false). Only a genuinely-connected local
					// peer for the same serial is a real duplicate.
					if (!existing.connection?.connected && this.enableLocal) {
						this.adapter.log.info(
							`[${this.host}] Taking over socket-less device context for SN ${info.dtuSn}`,
						);
						this.cloudStationId = existing.cloudStationId;
						this.adapter.devices.delete(info.dtuSn);
					} else {
						this.adapter.log.warn(
							`[${this.host}] Duplicate inverter: SN ${info.dtuSn} is already connected via another IP. Disconnecting.`,
						);
						this.disconnect();
						return;
					}
				}
				await this.initFromSerial(info.dtuSn);
				this.adapter.matchLocalDeviceToCloud(this);
			} else if (this.deviceId && !this.dtuSerial && info.dtuSn) {
				this.dtuSerial = info.dtuSn;
			}

			if (!this.pvStatesCreated && info.pvNumber > 0 && this.deviceId) {
				await this.createPvStates(info.pvNumber);
				this.pvStatesCreated = true;
			}

			await this.updateDtuStates(info);
			this.setupEncryption(info);
			await this.updateInverterVersions(info);
			await this.initCloudRelay(info.dtuSn);
			this.startPollingIfReady();
		} catch (err) {
			this.adapter.log.warn(`[${this.host}] Error decoding InfoData: ${errorMessage(err)}`);
		}
	}

	private async updateDtuStates(info: ReturnType<ProtobufHandler["decodeInfoData"]>): Promise<void> {
		const entries: Array<[string, ioBroker.StateValue]> = [["dtu.serialNumber", info.dtuSn]];
		if (info.dtuInfo) {
			const di = info.dtuInfo;
			entries.push(
				["dtu.swVersion", formatDtuVersion(di.swVersion)],
				["dtu.hwVersion", formatDtuVersion(di.hwVersion).replace("V", "H")],
				["dtu.rssi", di.signalStrength],
				["dtu.connState", di.errorCode],
				["dtu.stepTime", di.dtuStepTime],
				["dtu.accessModel", di.accessModel],
				["dtu.communicationTime", di.communicationTime * 1000],
				["dtu.wifiVersion", di.wifiVersion],
			);
		}
		await this.setStates(entries, true);
	}

	private setupEncryption(info: ReturnType<ProtobufHandler["decodeInfoData"]>): void {
		if (!info.dtuInfo) {
			return;
		}
		const di = info.dtuInfo;
		if (Encryption.isRequired(di.dfs)) {
			this.adapter.log.info(`[${this.deviceId}] DTU requires encrypted communication`);
			this.encryptionRequired = true;
			if (di.encRand) {
				this.encryption = new Encryption(di.encRand);
				this.adapter.log.info(`[${this.deviceId}] Encryption initialized with enc_rand from DTU`);
			} else {
				this.adapter.log.warn(`[${this.deviceId}] Encryption required but no enc_rand received`);
			}
		} else {
			this.adapter.log.debug(`[${this.deviceId}] DTU does not require encryption`);
			this.encryptionRequired = false;
		}
	}

	private async updateInverterVersions(info: ReturnType<ProtobufHandler["decodeInfoData"]>): Promise<void> {
		if (info.pvInfo.length > 0) {
			const pv = info.pvInfo[0];
			this.inverterSn = pv.sn || this.inverterSn;
			await this.setStates(
				[
					["inverter.serialNumber", pv.sn],
					["inverter.hwVersion", formatInvVersion(pv.bootVersion).replace("V", "H")],
					["inverter.swVersion", formatSwVersion(pv.gridVersion)],
				],
				true,
			);
		}
	}

	// --- Cloud relay ---

	private async initCloudRelay(dtuSn: string): Promise<void> {
		if (this.enableCloudRelay && this.protobuf && dtuSn && !this.cloudRelay && !this.cloudRelayInitializing) {
			const serverState = await this.adapter.getStateAsync(`${this.deviceId}.config.serverDomain`);
			const portState = await this.adapter.getStateAsync(`${this.deviceId}.config.serverPort`);
			const serverDomain = (serverState?.val as string) || "";
			const serverPort = (portState?.val as number) || 10081;
			if (serverDomain) {
				this.cloudRelayInitializing = true;
				const relay = new CloudRelay(serverDomain, serverPort, this.adapter);
				relay.configure(this.protobuf, dtuSn);
				this.cloudRelay = relay;
				this.cloudRelay.on("connected", () => {
					this.adapter.log.info(`[${this.deviceId}] Cloud relay connected to ${serverDomain}:${serverPort}`);
				});
				this.cloudRelay.on("disconnected", () => {
					const msg = this.cloudRelay?.paused ? "paused" : "disconnected, will reconnect";
					this.adapter.log.warn(`[${this.deviceId}] Cloud relay ${msg}`);
				});
				this.cloudRelay.on("error", (err: Error) => {
					this.adapter.log.debug(`[${this.deviceId}] Cloud relay: ${err.message}`);
				});
				this.cloudRelay.on("heartbeatSent", (seq: number) => {
					this.adapter.log.debug(`[${this.deviceId}] Cloud relay heartbeat sent (seq=${seq})`);
				});
				this.cloudRelay.on("dataReceived", (bytes: number) => {
					this.adapter.log.debug(`[${this.deviceId}] Cloud relay received ${bytes} bytes`);
				});
				this.cloudRelay.on("dataSent", () => {
					this.adapter.log.debug(`[${this.deviceId}] Cloud relay sent data, triggering cloud poll`);
					void this.adapter.onRelayDataSent();
				});
				this.cloudRelay.on("command", (cmd: CloudRelayCommand) => this.handleCloudCommand(cmd));
				this.cloudRelay.connect();
			}
		} else if (this.cloudRelay && this.protobuf && dtuSn) {
			this.cloudRelay.configure(this.protobuf, dtuSn);
		}
	}

	private startPollingIfReady(): void {
		if (!this.infoReceived) {
			this.infoReceived = true;
			if (this.infoFallbackTimer) {
				this.adapter.clearTimeout(this.infoFallbackTimer);
				this.infoFallbackTimer = undefined;
			}
			if (this.protobuf && this.connection?.connected) {
				this.adapter.log.info(`[${this.host}] Enabling performance data mode`);
				const ts = unixSeconds();
				void this.connection.send(this.protobuf.encodePerformanceDataMode(ts)).catch(e => {
					this.adapter.log.debug(`[${this.deviceId}] PerformanceDataMode send failed: ${errorMessage(e)}`);
				});
			}
			this.pollStartTimer = this.adapter.setTimeout(() => this.startPollCycle(), 1000);
		}
	}

	private async handleConfigData(payload: Buffer): Promise<void> {
		try {
			const config = this.protobuf.decodeGetConfig(payload);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] Config: server=${config.serverDomain}:${config.serverPort}, sendTime=${config.serverSendTime}min`,
			);

			await this.setStates(
				[
					// limit_power_mypower is the DTU-stored (persistent) limit — expose it as the
					// persistent state, not the runtime inverter.powerLimit setpoint.
					["config.limitPowerMyPower", config.limitPower / SCALE_POWER],
					["config.serverDomain", config.serverDomain],
					["config.serverPort", config.serverPort],
					["config.serverSendTime", config.serverSendTime],
					["config.wifiSsid", config.wifiSsid],
					["config.wifiRssi", config.wifiRssi],
					["config.netDhcpSwitch", config.dhcpSwitch],
					["config.dtuApSsid", config.dtuApSsid],
					["config.netmodeSelect", config.netmodeSelect],
					["config.invType", config.invType],
					["config.wifiIpAddress", config.wifiIpAddress],
					["config.wifiMacAddress", config.wifiMacAddress],
				],
				true,
			);

			if (config.serverDomain && config.serverPort) {
				this.cloudServerDomain = `${config.serverDomain}:${config.serverPort}`;
			}
			if (config.serverSendTime > 0) {
				this.cloudSendTimeMin = config.serverSendTime;
				if (this.cloudRelay) {
					this.cloudRelay.setRealDataInterval(config.serverSendTime);
				}
				this.adapter.onSendTimeUpdated(this);
			}
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding Config: ${errorMessage(err)}`);
		}
	}

	private static normalizeAlarm(e: {
		sn: string;
		code: number;
		num: number;
		startTime: number;
		endTime: number;
		data1: number;
		data2: number;
		descriptionEn?: string;
		descriptionDe?: string;
	}): NormalizedAlarm {
		return {
			sn: e.sn,
			code: e.code,
			num: e.num,
			startTime: e.startTime * 1000,
			endTime: e.endTime > 0 ? e.endTime * 1000 : 0,
			data1: e.data1,
			data2: e.data2,
			descriptionEn: e.descriptionEn || getAlarmDescription(e.code, "en"),
			descriptionDe: e.descriptionDe || getAlarmDescription(e.code, "de"),
			active: e.endTime === 0,
		};
	}

	private async handleAlarmData(payload: Buffer): Promise<void> {
		// AlarmData (WInfoReqDTO) is always a single packet — finalize immediately.
		try {
			const data = this.protobuf.decodeAlarmData(payload);
			await this.finalizeAlarms(data.alarms.map(DeviceContext.normalizeAlarm));
			return;
		} catch {
			// Not the AlarmData format → try the (paginated) WarnData format below.
		}

		let data;
		try {
			data = this.protobuf.decodeWarnData(payload);
		} catch (err) {
			this.adapter.log.warn(
				`[${this.deviceId || this.host}] Error decoding AlarmData/WarnData: ${errorMessage(err)}`,
			);
			return;
		}

		const total = data.packageNub;
		const now = data.packageNow;
		const pageAlarms = data.warnings.map(DeviceContext.normalizeAlarm);

		// Single-package list → finalize directly (no accumulation needed).
		if (total <= 1) {
			this.warnChunks.clear();
			await this.finalizeAlarms(pageAlarms);
			return;
		}

		// Multi-package list: the DTU paginates and we must pull every package, then
		// assemble — mirroring the S-Miles app. package_now is 0-based, package_nub is the
		// total. Reset the accumulator on the first package so a new query starts clean.
		if (now === 0) {
			this.warnChunks.clear();
		}
		this.warnChunks.set(now, pageAlarms);
		this.adapter.log.debug(
			`[${this.deviceId || this.host}] Warn list package ${now + 1}/${total} (${pageAlarms.length} entries)`,
		);

		// More packages outstanding → request the next one and wait for it.
		if (now + 1 < total) {
			this.connection
				?.send(this.protobuf.encodeWarnDataRequest(unixSeconds(), now + 1))
				.catch(e =>
					this.adapter.log.debug(`[${this.deviceId || this.host}] warn next-pkg failed: ${errorMessage(e)}`),
				);
			return;
		}

		// Last package received → assemble all packages in order and finalize.
		const assembled = [...this.warnChunks.keys()].sort((a, b) => a - b).flatMap(k => this.warnChunks.get(k)!);
		this.warnChunks.clear();
		await this.finalizeAlarms(assembled);
	}

	/**
	 * Write the assembled alarm list to the alarm states.
	 *
	 * @param alarms - The complete, normalized alarm list (all packages merged).
	 */
	private async finalizeAlarms(alarms: NormalizedAlarm[]): Promise<void> {
		if (alarms.length === 0) {
			this.adapter.log.debug(`[${this.deviceId || this.host}] Alarm list query returned no active alarms`);
		} else {
			this.adapter.log.debug(`[${this.deviceId || this.host}] Alarms received: ${alarms.length} entries`);
		}

		const activeAlarms = alarms.filter(a => a.active);

		// Localize warn messages to the ioBroker system language (falls back to English inside
		// getAlarmDescription when a code has no translation for that language).
		const lang = this.adapter.language || "en";
		const latestActive = activeAlarms[activeAlarms.length - 1];
		const entries: Array<[string, ioBroker.StateValue]> = [
			["alarms.count", alarms.length],
			["alarms.activeCount", activeAlarms.length],
			["alarms.hasActive", activeAlarms.length > 0],
			["alarms.json", safeJsonStringify(alarms)],
			// Authoritative warn message from the WCode-based alarm list (same source the S-Miles app uses)
			["inverter.warnMessage", latestActive ? getAlarmDescription(latestActive.code, lang) : ""],
		];

		if (alarms.length > 0) {
			const last = alarms[alarms.length - 1];
			entries.push(
				["alarms.lastCode", last.code],
				["alarms.lastStartTime", last.startTime],
				["alarms.lastEndTime", last.endTime],
				["alarms.lastMessage", `${getAlarmDescription(last.code, lang)} (Code ${last.code})`],
				["alarms.lastData1", last.data1],
				["alarms.lastData2", last.data2],
			);
		}
		await this.setStates(entries, true);
	}

	private async handleHistPower(payload: Buffer): Promise<void> {
		if (!this.protobuf || !this.deviceId) {
			return;
		}
		try {
			const data = this.protobuf.decodeHistPower(payload);
			this.adapter.log.debug(
				`[${this.deviceId}] HistPower: ${data.powerArray.length} entries, daily=${data.dailyEnergy}Wh`,
			);
			if (!this.histStatesCreated) {
				await this.adapter.extendObjectAsync(`${this.deviceId}.history`, {
					type: "channel",
					common: { name: { en: "Power history", de: "Leistungsverlauf" } },
					native: {},
				});
				const histStates = [
					{
						id: "history.powerJson",
						name: { en: "Power history (JSON)", de: "Leistungsverlauf (JSON)" },
						type: "string" as const,
						role: "json",
						unit: "",
					},
					{
						id: "history.dailyEnergy",
						name: { en: "Daily energy", de: "Tagesenergie" },
						type: "number" as const,
						role: "value.energy",
						unit: "Wh",
					},
					{
						id: "history.totalEnergy",
						name: { en: "Total energy", de: "Gesamtenergie" },
						type: "number" as const,
						role: "value.energy",
						unit: "kWh",
					},
					{
						id: "history.stepTime",
						name: { en: "Step time", de: "Schrittzeit" },
						type: "number" as const,
						role: "value",
						unit: "s",
					},
				];
				for (const s of histStates) {
					await this.adapter.extendObjectAsync(`${this.deviceId}.${s.id}`, {
						type: "state",
						common: {
							name: s.name,
							type: s.type,
							role: s.role,
							unit: s.unit,
							read: true,
							write: false,
						},
						native: {},
					});
				}
				this.histStatesCreated = true;
			}
			await this.setState("history.powerJson", safeJsonStringify(data.powerArray), true);
			await this.setState("history.dailyEnergy", data.dailyEnergy, true);
			await this.setState("history.totalEnergy", Math.round(data.totalEnergy / 100) / 10, true); // double normalization: round at Wh precision, then → kWh
			await this.setState("history.stepTime", data.stepTime, true);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId}] Error decoding HistPower: ${errorMessage(err)}`);
		}
	}

	private async handleAutoSearch(payload: Buffer): Promise<void> {
		if (!this.protobuf || !this.deviceId) {
			return;
		}
		try {
			const ReqDTO = this.protobuf.getType("AutoSearch", "AutoSearchReqDTO");
			const msg = ReqDTO.decode(payload);
			const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

			const serialNumbers = (obj.miSerialNumbers as number[]) || [];
			const hexSerials = serialNumbers.map(sn => (Number(sn) || 0).toString(16).toUpperCase());
			this.adapter.log.info(
				`[${this.deviceId}] AutoSearch found ${hexSerials.length} inverter(s): ${hexSerials.join(", ")}`,
			);

			await this.setState("dtu.searchResult", JSON.stringify(hexSerials), true);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId}] Error decoding AutoSearch: ${errorMessage(err)}`);
		}
	}

	/**
	 * Handle a DevConfigFetch response (grid-connection file). The blob can be chunked over
	 * several packages — accumulate them, request the next while incomplete, then decode the
	 * reassembled big-endian blob into `gridProfile.*` states.
	 *
	 * @param payload - Decrypted DevConfigFetchReqDTO payload.
	 */
	private handleDevConfigFetch(payload: Buffer): void {
		if (!this.protobuf) {
			return;
		}
		try {
			const ReqDTO = this.protobuf.getType("DevConfig", "DevConfigFetchReqDTO");
			const obj = ReqDTO.toObject(ReqDTO.decode(payload), { longs: Number, defaults: true }) as Record<
				string,
				unknown
			>;
			const data = obj.data as Uint8Array | undefined;
			const chunk = data && data.length ? Buffer.from(data) : Buffer.alloc(0);
			const pkg = Number(obj.currentPackage) || 0;
			const total = Math.max(Number(obj.totalPackages) || 1, 1);
			this.gridChunks.set(pkg, chunk);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] grid profile package ${pkg + 1}/${total} (${chunk.length} bytes)`,
			);

			// More packages outstanding → request the next one and wait for it
			if (pkg + 1 < total) {
				this.connection
					?.send(this.protobuf.encodeDevConfigFetch(unixSeconds(), this.dtuSerial, this.inverterSn, pkg + 1))
					.catch(e =>
						this.adapter.log.debug(`[${this.deviceId}] grid profile next-pkg failed: ${errorMessage(e)}`),
					);
				return;
			}

			// All packages received → assemble in order and decode
			const assembled = Buffer.concat(
				[...this.gridChunks.keys()].sort((a, b) => a - b).map(k => this.gridChunks.get(k)!),
			);
			this.gridChunks.clear();
			if (assembled.length < 4) {
				return;
			}
			// The local DevConfigFetch `data` field is the grid file (big-endian) followed by a
			// 2-byte CRC-16 trailer of that grid file. The cloud's grid-file blob (and our decode)
			// is the grid file ONLY — the CRC lives in a separate field. Strip the trailer so the
			// relay serves the exact 112-byte cloud format, not 114 bytes (which the app can't show).
			const blob = assembled.subarray(0, assembled.length - 2);
			this.gridBlob = blob; // cache (big-endian, no trailer) to answer cloud-relay grid-profile reads
			// Cache the DTU/inverter serials exactly as the DTU sent them (raw bytes) so the cloud
			// grid-profile upload can echo them verbatim — see serveGridProfileToCloud.
			const dtuSnBytes = obj.dtuSn as Uint8Array | undefined;
			const devSnBytes = obj.devSn as Uint8Array | undefined;
			this.gridDtuSn = dtuSnBytes && dtuSnBytes.length ? Buffer.from(dtuSnBytes) : null;
			this.gridDevSn = devSnBytes && devSnBytes.length ? Buffer.from(devSnBytes) : null;
			this.adapter.log.debug(`[${this.deviceId || this.host}] [diag] grid profile blob: ${blob.toString("hex")}`);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] [diag] grid profile sns: dtu=${this.gridDtuSn?.toString("hex") ?? "-"} dev=${this.gridDevSn?.toString("hex") ?? "-"}`,
			);
			const decoded = decodeGridProfile(blob);
			const entries: Array<[string, ioBroker.StateValue]> = [["gridProfile.standard", decoded.standard]];
			for (const [key, val] of Object.entries(decoded.values)) {
				entries.push([`gridProfile.${key}`, val]);
			}
			void this.setStates(entries, true);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding DevConfig: ${errorMessage(err)}`);
		}
	}

	private handleNetworkInfo(payload: Buffer): void {
		if (!this.protobuf) {
			return;
		}
		try {
			this.protobuf.getType("NetworkInfo", "NetworkInfoReqDTO").decode(payload);
			this.adapter.log.debug(`[${this.deviceId || this.host}] NetworkInfo response received`);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding NetworkInfo: ${errorMessage(err)}`);
		}
	}

	private handleCommandResponse(payload: Buffer): void {
		try {
			const ReqDTO = this.protobuf.getType("CommandPB", "CommandReqDTO");
			const msg = ReqDTO.decode(payload);
			const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;
			const errCode = obj.errCode as number | undefined;
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] Command response: action=${String(obj.action)}, error=${String(errCode)}`,
			);

			if (errCode !== undefined && errCode !== null && errCode !== 0) {
				this.adapter.log.warn(
					`[${this.deviceId || this.host}] Command failed with error code: ${String(errCode)}`,
				);
			}

			// No active alarms — initialize all alarm states to empty
			if (obj.action === 50 && errCode === 0 && (obj.packageNow === 0 || obj.packageNow === undefined)) {
				this.adapter.log.debug(`[${this.deviceId || this.host}] No active alarms`);
				this.setStates(
					[
						["alarms.count", 0],
						["alarms.activeCount", 0],
						["alarms.hasActive", false],
						["alarms.lastCode", 0],
						["alarms.lastMessage", ""],
						["alarms.lastStartTime", 0],
						["alarms.lastEndTime", 0],
						["alarms.lastData1", 0],
						["alarms.lastData2", 0],
						["alarms.json", "[]"],
					],
					true,
				).catch(err =>
					this.adapter.log.warn(`[${this.deviceId || this.host}] setStates error: ${errorMessage(err)}`),
				);
			}
		} catch (err) {
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] Error decoding command response: ${errorMessage(err)}`,
			);
		}
	}

	// --- State change handling (commands) ---

	/**
	 * Handle a writable state change and send the corresponding command to the DTU.
	 *
	 * @param stateId - State ID relative to device prefix
	 * @param state - The new state value
	 */
	async handleStateChange(stateId: string, state: ioBroker.State): Promise<void> {
		// Local link takes precedence: a locally-connected DTU is actuated directly over TCP.
		if (this.connection?.connected) {
			await executeCommand(stateId, state, {
				connection: this.connection,
				protobuf: this.protobuf,
				deviceId: this.deviceId,
				host: this.host,
				log: this.adapter.log,
				setState: (id, val, ack) => this.setState(id, val, ack),
				resetButton: id => this.scheduleButtonReset(id),
			});
			return;
		}
		// No local link — for a cloud-connected device, send the same command over the cloud.
		if (this.enableCloud && this.dtuSerial) {
			const handled = await executeCloudCommand(stateId, state, {
				deviceId: this.deviceId,
				log: this.adapter.log,
				// DTU-level commands address the DTU itself (dev_sn = DTU serial); micro-inverter
				// commands address the connected inverter (dev_sn = inverter serial), which is only
				// known once the cloud device tree has been polled — fail with a clear message if a
				// micro command is fired before then, rather than leaking an internal validation error.
				send: (action, devType) => {
					const devSn = devType === CLOUD_DEV_TYPE_DTU ? this.dtuSerial : this.inverterSn;
					if (!devSn) {
						return Promise.reject(
							new Error("inverter serial not known yet (device is still being discovered)"),
						);
					}
					return this.adapter.sendCloudDeviceCommand(devSn, this.dtuSerial, action, devType);
				},
				setState: (id, val, ack) => this.setState(id, val, ack),
				resetButton: id => this.scheduleButtonReset(id),
			});
			if (handled) {
				return;
			}
			this.adapter.log.warn(`[${this.deviceId}] Command "${stateId}" is not available over the cloud`);
			return;
		}
		this.adapter.log.warn(`[${this.deviceId}] Cannot send command: not connected to DTU`);
	}

	/**
	 * Set the micro-inverter serial for a cloud-only device (learned from the cloud device tree),
	 * so cloud control commands can address it. Does not overwrite a serial already learned locally.
	 *
	 * @param sn - Micro-inverter serial number (unprefixed).
	 */
	setCloudInverterSn(sn: string): void {
		if (sn && !this.inverterSn) {
			this.inverterSn = sn;
		}
	}

	/**
	 * Reset a button state back to false after 1 s (adapter-managed timer, cleared on stop).
	 *
	 * @param id - State ID relative to device prefix.
	 */
	private scheduleButtonReset(id: string): void {
		const handle = this.adapter.setTimeout(() => {
			this.resetButtonTimers.delete(handle!);
			this.setState(id, false, true).catch(err =>
				this.adapter.log.warn(`[${this.deviceId}] resetButton error: ${errorMessage(err)}`),
			);
		}, 1000);
		if (handle) {
			this.resetButtonTimers.add(handle);
		}
	}

	// --- Utility ---

	private async updateAdapterConnectionState(): Promise<void> {
		await this.adapter.updateConnectionState();
	}

	/** Disconnect local TCP and cloud relay connections, clean up subscriptions. */
	disconnect(): void {
		for (const handle of this.resetButtonTimers) {
			this.adapter.clearTimeout(handle);
		}
		this.resetButtonTimers.clear();
		if (this.infoFallbackTimer) {
			this.adapter.clearTimeout(this.infoFallbackTimer);
			this.infoFallbackTimer = undefined;
		}
		if (this.pollStartTimer) {
			this.adapter.clearTimeout(this.pollStartTimer);
			this.pollStartTimer = undefined;
		}
		this.stopPollCycle();
		this.stateCache.clear();
		if (this.connection) {
			this.connection.removeAllListeners();
			this.connection.disconnect();
			this.connection = null;
		}
		if (this.cloudRelay) {
			this.cloudRelay.removeAllListeners();
			this.cloudRelay.disconnect();
			this.cloudRelay = null;
		}
		this.pendingGridServeTid = null;
		this.gridDtuSn = null;
		this.gridDevSn = null;
		// Unsubscribe from writable states
		if (this.deviceId) {
			for (const stateId of WRITABLE_STATES) {
				this.adapter.unsubscribeStates(`${this.deviceId}.${stateId}`);
			}
		}
	}
}

export default DeviceContext;
export { WRITABLE_STATES };
