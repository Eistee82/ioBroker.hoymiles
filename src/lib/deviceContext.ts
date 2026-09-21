import DtuConnection from "./dtuConnection.js";
import BleConnection from "./bleConnection.js";
import type { EsphomeGateway } from "./esphomeGateway.js";
import CloudRelay from "./cloudRelay.js";
import {
	type ProtobufHandler,
	type RealDataResult,
	formatDtuVersion,
	formatSwVersion,
	formatInvVersion,
} from "./protobufHandler.js";
import {
	executeCommand,
	executeCloudCommand,
	flashWritingStateForAction,
	type FlashGuardOptions,
	type FlashWriteState,
} from "./commandHandler.js";
import Encryption from "./encryption.js";
import {
	buildShellyBindData,
	encodeShellyBindBody,
	parseEnergyFlow,
	parseMeterDevices,
	SHELLY_DEV_TYPE_GRID,
	SHELLY_DEV_TYPE_METER_ONLY,
} from "./shellyProtocol.js";

/** `CommCmd` carrier tag — the same one the pairing handshake uses. */
const SHELLY_CMD_TAG = [0xa3, 0x18] as const;
import { channels, states, meterMeasurementStates, meterControlStates, buildStateCommon } from "./stateDefinitions.js";
import { getAlarmDescription } from "./alarmCodes.js";
import { decodeGridProfile, byteSwap16 } from "./gridProfile.js";
import EnergyGuard from "./energyGuard.js";
import { cloudTagLabel, describeCloudTag, refusalReason } from "./cloudTranslator.js";
import {
	INFO_FALLBACK_TIMEOUT_MS,
	SCALE_POWER,
	SCALE_POWER_LIMIT_BLE,
	SCALE_POWER_LIMIT_TCP,
	CLOUD_DEV_TYPE_DTU,
	POWER_LIMIT_DEADBAND_DEFAULT,
	POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT,
	HIST_MAX_PAGES,
} from "./constants.js";
import { whToKwh } from "./convert.js";
import { anonymize, errorMessage, safeJsonStringify, unixSeconds } from "./utils.js";
import { inverterIcon } from "./deviceIcons.js";

/**
 * Maximum number of PV ports supported by any Hoymiles inverter model. Upper bound of the
 * cloud's own micro-rule dictionary, which lists port counts of 1, 2, 4, 6, 8 and 12
 * (verified live 2026-07-22, 91 rules).
 */
export const MAX_PV_PORTS = 12;

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
	/** Smallest power-limit change worth a flash write, in percent. 0 disables the dead band. */
	powerLimitDeadband?: number;
	/** Shortest gap between two power-limit flash writes, in seconds. 0 disables the throttle. */
	powerLimitMinIntervalSec?: number;
	/** Local transport: "tcp" (default, DTU on port 10081) or "ble" (ESPHome BLE proxy). */
	transport?: "tcp" | "ble";
	/** BLE-only: the ESPHome gateway that tunnels this inverter's GATT traffic. */
	gateway?: EsphomeGateway;
	/** BLE-only: numeric BLE address of the inverter. */
	bleMac?: number;
	/** BLE-only: serial-number bytes for the SN-CBC bootstrap. */
	bleSn?: Buffer;
	/** BLE-only: pairing PIN. */
	blePin?: string;
	/** BLE-only: advertised BLE address type (0 = public, 1 = random); needed for the GATT connect. */
	bleAddressType?: number;
	/** BLE-only: called when pairing hard-fails (wrong PIN / device refusal). */
	onPairingFailed?: (ctx: DeviceContext, reason: string) => void;
}

/** Local transport kind. */
type DeviceConnection = DtuConnection | BleConnection;

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
	// PvMO field 8 was exposed here as "error code". It is not one: the WB encoder at
	// 0x4080b8ac-0x4080b8be reads three separate bytes off the inverter's data block (+0x37,
	// +0x39, +0x3b) and shifts them together by 24, 16 and 8 bits, leaving the lowest byte always
	// zero — hence the 0x03000000 that looked like a fault. It never changed across readings, and
	// the T series leaves the field at 0 entirely. What the three bytes mean is not established,
	// so publishing them as a fault code stated something that was not known to be true.
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

	connection: DeviceConnection | null;
	cloudRelay: CloudRelay | null;
	/** Local transport kind (default "tcp"). */
	readonly transport: "tcp" | "ble";
	private readonly gateway: EsphomeGateway | null;
	private readonly bleMac: number;
	private readonly bleAddressType?: number;
	private readonly bleSn: Buffer;
	private readonly blePin: string;
	private readonly onPairingFailed?: (ctx: DeviceContext, reason: string) => void;
	protobuf: ProtobufHandler;
	encryption: Encryption | null;
	encryptionRequired: boolean;
	/** Keeps the "cannot relay encrypted RealData" warning to one line per session. */
	private warnedEncryptedRelay: boolean;
	/** Dead band and minimum interval for the commands the DTU persists to flash. */
	private readonly flashGuard: FlashGuardOptions;
	/** Last flash-writing command per state id — the guard judges the next write against it. */
	private readonly flashWrites: Map<string, FlashWriteState>;
	/** Keeps cumulative energy counters from stepping backwards after a device restart. */
	private readonly energyGuard: EnergyGuard;
	/** Keeps the "cloud writes the power limit faster than the guard allows" warning to one line. */
	private warnedCloudFlashRate: boolean;
	/** Page of the day curve currently being collected (`cp`). */
	private histPage: number;
	/** Samples gathered across the pages of the current curve, in W. */
	private histSamples: number[];
	/** Unix timestamp of the first sample of the current curve. */
	private histStart: number;
	/**
	 * The device's last GetConfig response, raw and complete. Needed to write the configuration
	 * without clearing the fields that are not being changed. Holds credentials the device sends
	 * in the clear (`lock_password`, `wifi_password`) — never log it, never put it in a state.
	 */
	private configSnapshot: Record<string, unknown> | null;

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
	private meterMeasurementStatesCreated: boolean;
	private meterControlStatesCreated: boolean;
	/** Set once the "device sends unmapped lists" hint has been logged, so it stays a one-off. */
	private extraListsReported: boolean;
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
		// `?? default` rather than `|| default`: 0 is a deliberate "switch this off", not a missing value.
		this.flashGuard = {
			deadband: options.powerLimitDeadband ?? POWER_LIMIT_DEADBAND_DEFAULT,
			minIntervalMs: (options.powerLimitMinIntervalSec ?? POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT) * 1000,
		};
		this.flashWrites = new Map();
		this.energyGuard = new EnergyGuard();
		this.warnedCloudFlashRate = false;
		this.configSnapshot = null;
		this.histPage = 0;
		this.histSamples = [];
		this.histStart = 0;

		this.dtuSerial = "";
		this.deviceId = "";
		this.statesCreated = false;
		this.infoReceived = false;

		this.connection = null;
		this.cloudRelay = null;
		this.transport = options.transport ?? "tcp";
		this.gateway = options.gateway ?? null;
		this.bleMac = options.bleMac ?? 0;
		this.bleAddressType = options.bleAddressType;
		this.bleSn = options.bleSn ?? Buffer.alloc(0);
		this.blePin = options.blePin ?? "";
		this.onPairingFailed = options.onPairingFailed;
		this.protobuf = options.protobuf;
		this.encryption = null;
		this.encryptionRequired = false;
		this.warnedEncryptedRelay = false;
		this.cloudStationId = null;

		this.pollTimer = undefined;
		this.pvStatesCreated = false;
		this.pvCount = 0;
		this.burstActive = false;
		this.meterStatesCreated = false;
		this.meterMeasurementStatesCreated = false;
		this.meterControlStatesCreated = false;
		this.extraListsReported = false;
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

	/** Start the local connection (TCP to the DTU, or BLE via the ESPHome gateway). */
	connect(): void {
		if (this.transport === "ble") {
			if (!this.gateway || !this.bleMac) {
				return;
			}
			this.connection = new BleConnection({
				gateway: this.gateway,
				mac: this.bleMac,
				sn: this.bleSn,
				pin: this.blePin,
				addressType: this.bleAddressType,
				timers: this.adapter,
				log: this.adapter.log,
			});
			this.connection.on("pairingFailed", (reason: string) => {
				this.adapter.log.warn(`[${this.host}] BLE pairing failed: ${reason}`);
				this.onPairingFailed?.(this, reason);
			});
		} else {
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
		}

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
				// Model isn't known at creation (it arrives later from the cloud), so use the
				// default micro-inverter icon — correct for the HMS line (incl. WB), which is
				// the overwhelming majority. The Device Manager card refines this per model.
				icon: inverterIcon(""),
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

		// A BLE device can take a Shelly/ecotracker meter — the 2T cannot (no meter input, no
		// energy management). Its controls have to exist before a meter is bound, otherwise there
		// would be no way to bind one in the first place.
		if (this.transport === "ble") {
			await this.adapter.setObjectNotExistsAsync(`${this.deviceId}.meter`, {
				type: "channel",
				common: { name: { en: "Shelly meter", de: "Shelly-Zähler" } },
				native: {},
			});
			this.meterControlStatesCreated = true;
			for (const def of meterControlStates) {
				await this.adapter.extendObjectAsync(`${this.deviceId}.${def.id}`, {
					type: "state",
					common: buildStateCommon(def),
					native: {},
				});
				if (def.write) {
					this.adapter.subscribeStates(`${this.deviceId}.${def.id}`);
				}
			}
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
		// `shelly.*` is deliberately NOT listed: an earlier build put the network meter under that
		// name, which was wrong twice over — the firmware supports ecotracker devices just as well
		// (`SHELLY=1, ECOTRACKER=2` in its own type table), and a `meter` channel already existed
		// for the wired meter. Leaving it out of the known set is what removes the old branch from
		// installations that ran that build.

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
			m("energyPhaseAExport", "Phase A energy export", "Phase A Energie Export", "value.energy", "kWh"),
			m("energyPhaseBExport", "Phase B energy export", "Phase B Energie Export", "value.energy", "kWh"),
			m("energyPhaseCExport", "Phase C energy export", "Phase C Energie Export", "value.energy", "kWh"),
			m("energyPhaseAImport", "Phase A energy import", "Phase A Energie Import", "value.energy", "kWh"),
			m("energyPhaseBImport", "Phase B energy import", "Phase B Energie Import", "value.energy", "kWh"),
			m("energyPhaseCImport", "Phase C energy import", "Phase C Energie Import", "value.energy", "kWh"),
			m("powerFactorPhaseA", "Power factor phase A", "Leistungsfaktor Phase A", "value", ""),
			m("powerFactorPhaseB", "Power factor phase B", "Leistungsfaktor Phase B", "value", ""),
			m("powerFactorPhaseC", "Power factor phase C", "Leistungsfaktor Phase C", "value", ""),
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
			// AlarmTrigger (ALARM_LIST / action 50) is rejected by the BLE-only 2WB (error 1); the
			// MiWarnRequest below covers warning reads there, so only send it on the TCP path.
			...(this.transport !== "ble" ? [(ts: number) => this.protobuf.encodeAlarmTrigger(ts)] : []),
			ts => this.protobuf.encodeMiWarnRequest(ts),
			// The device keeps its own power curve for the day, at one sample per minute on the 2T.
			// This asks for the first page; handleHistPower walks the rest and publishes once the
			// whole day is together.
			ts => {
				this.histPage = 0;
				return this.protobuf.encodeHistPowerRequest(ts, 0);
			},
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
		const label = cloudTagLabel(cmd.cmdLow);
		try {
			// The cloud acks our command-status with 0x23 0x06 (CommandStatusResDTO). For a
			// grid-profile read the real DTU uploads the grid file (0x22 0x0e) only after this
			// status-ack, so complete a pending read here rather than up front.
			if (cmd.cmdLow === 0x06) {
				this.handleCloudStatusAck(cmd.payload);
				return;
			}
			// Cloud action commands arrive as 0x23 0x05 (CommandResDTO with an action code).
			if (cmd.cmdLow === 0x05) {
				this.handleCloudAction(cmd);
				return;
			}
			const info = describeCloudTag(cmd.cmdLow);
			if (!info) {
				// Neither firmware dispatches this tag. Worth a warning rather than a shrug: it
				// means the server speaks something this analysis has not seen.
				this.adapter.log.warn(
					`[${this.deviceId}] cloud sent ${label}, ${cmd.payload.length} bytes — no firmware dispatches it`,
				);
				return;
			}
			// Everything below is a tag both sides know but the adapter has no proven contract
			// for. It is named and counted, never silently discarded — the previous behaviour
			// made an unimplemented downlink indistinguishable from no downlink at all.
			this.adapter.log.info(
				`[${this.deviceId}] cloud sent ${label} (${info.kind}), ${cmd.payload.length} bytes — ` +
					`not acted on${info.note ? `: ${info.note}` : ""}`,
			);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId}] handleCloudCommand ${label} error: ${errorMessage(err)}`);
		}
	}

	/**
	 * Handle a cloud action command (`0x23 0x05`, `CommandResDTO`).
	 *
	 * Three outcomes, in this order: an action the adapter answers from data it already holds
	 * (grid profile, version), an action that is refused on purpose, or a plain forward to the
	 * device. Forwarding keeps the cloud tag — request and response families are symmetric in
	 * the firmware and both are reachable over the local socket, so rewriting the tag to the
	 * `0xa3` family would put the answer in the wrong slot.
	 *
	 * @param cmd - The downlink frame.
	 */
	private handleCloudAction(cmd: CloudRelayCommand): void {
		if (!this.protobuf) {
			return;
		}
		const ResDTO = this.protobuf.getType("CommandPB", "CommandResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(cmd.payload), { longs: Number, defaults: true }) as Record<
			string,
			unknown
		>;
		const action = Number(obj.action) || 0;
		const tid = Number(obj.tid) || 0;
		this.adapter.log.debug(`[${this.deviceId}] cloud command action=${action} tid=${tid}`);

		if (action === 41) {
			this.serveGridProfileToCloud(tid);
			return;
		}
		if (action === 4) {
			this.serveVersionToCloud(tid);
			return;
		}
		const refusal = refusalReason(action);
		if (refusal) {
			this.adapter.log.warn(
				`[${this.deviceId}] refusing cloud action ${action} (tid=${tid}): it ${refusal}. ` +
					`Such commands are not executed unattended.`,
			);
			return;
		}
		this.forwardCloudActionToDevice(cmd, action, tid);
	}

	/**
	 * Hand a cloud action to the local device and acknowledge it upstream.
	 *
	 * The payload is re-framed rather than re-encoded: the bytes the cloud sent are exactly what
	 * the device expects, so only the sequence number is replaced with one from the local
	 * counter. Anything else would risk changing a field the cloud set deliberately.
	 *
	 * **A cloud command is deliberately NOT throttled by the flash guard**, even when it writes
	 * flash. Two reasons. The relay stands in for the device: without the adapter in the middle
	 * the DTU would receive this very command straight from the cloud and write flash just the
	 * same, so dropping it would make the device behave differently merely because the adapter is
	 * running. And this method acknowledges the command upstream — skipping the send while still
	 * acknowledging would tell the server the limit was applied when it was not, leaving the
	 * S-Miles app showing a value the inverter does not have.
	 *
	 * What it does instead is **book the wear in the same place the local path uses**. Both routes
	 * end in the same two flash sectors, so they have to share one memory; otherwise the next
	 * local write is judged against a value the device no longer holds.
	 *
	 * @param cmd - The downlink frame.
	 * @param action - Decoded action code, for the acknowledgement.
	 * @param tid - Transaction id to echo back.
	 */
	private forwardCloudActionToDevice(cmd: CloudRelayCommand, action: number, tid: number): void {
		const relay = this.cloudRelay;
		if (!relay || !this.protobuf) {
			return;
		}
		if (!this.enableLocal || !this.connection?.connected) {
			this.adapter.log.info(
				`[${this.deviceId}] cloud action ${action} (tid=${tid}) not executed — no local connection`,
			);
			return;
		}
		const frame = this.protobuf.buildMessage(cmd.cmdHigh, cmd.cmdLow, cmd.payload);
		this.connection.send(frame).catch(e => {
			this.adapter.log.warn(`[${this.deviceId}] forwarding cloud action ${action} failed: ${errorMessage(e)}`);
		});
		this.bookCloudFlashWrite(action);
		const ts = unixSeconds();
		relay.sendFrame(this.protobuf.encodeCloudCommandAck(ts, this.dtuSerial, action, tid));
		relay.sendFrame(this.protobuf.encodeCloudCommandStatus(ts, this.dtuSerial, action, tid));
		this.adapter.log.debug(`[${this.deviceId}] cloud action ${action} forwarded to device (tid=${tid})`);
	}

	/**
	 * Record a flash-writing cloud command in the same memory the local command path uses.
	 *
	 * The value is left unknown: the cloud's payload is forwarded verbatim and its `data` field is
	 * not always parseable, and guessing it would be worse than admitting the gap. The dead band
	 * therefore cannot apply to the following local write, but the minimum interval can — and that
	 * is the limit that actually protects the flash.
	 *
	 * A cloud-driven control loop is also worth one warning: the user cannot see it in the ioBroker
	 * states at all, and it wears the same sectors as their own automation.
	 *
	 * @param action - Action code the cloud sent.
	 */
	private bookCloudFlashWrite(action: number): void {
		const stateId = flashWritingStateForAction(action);
		if (!stateId) {
			return;
		}
		let entry = this.flashWrites.get(stateId);
		if (!entry) {
			entry = { lastValue: null, lastWriteMs: 0, skipsLogged: 0 };
			this.flashWrites.set(stateId, entry);
		}
		const now = Date.now();
		const sinceMs = now - entry.lastWriteMs;
		if (entry.lastWriteMs > 0 && this.flashGuard.minIntervalMs > 0 && sinceMs < this.flashGuard.minIntervalMs) {
			if (!this.warnedCloudFlashRate) {
				this.warnedCloudFlashRate = true;
				this.adapter.log.warn(
					`[${this.deviceId}] The cloud is sending power-limit commands faster than the configured ` +
						`minimum interval (${Math.round(sinceMs / 1000)}s apart). These are forwarded unchanged — ` +
						`the adapter does not silently drop a command it has already acknowledged to the server — ` +
						`but each one erases two flash sectors in the inverter.`,
				);
			}
		}
		entry.lastValue = null;
		entry.lastWriteMs = now;
		entry.skipsLogged = 0;
	}

	/**
	 * Handle the cloud's acknowledgement of one of our uploads (`0x2301`, `0x2302`, `0x230c`,
	 * `0x230d`). These used to be discarded inside the relay, which threw away the server time
	 * and hid rejected uploads.
	 *
	 * @param cmd - The acknowledgement frame.
	 */
	private handleCloudAck(cmd: CloudRelayCommand): void {
		if (!this.protobuf) {
			return;
		}
		const info = describeCloudTag(cmd.cmdLow);
		const label = cloudTagLabel(cmd.cmdLow);
		if (!info?.decode) {
			this.adapter.log.debug(`[${this.deviceId}] cloud ack ${label}, ${cmd.payload.length} bytes`);
			return;
		}
		try {
			const obj = this.protobuf.decodePayload(info.decode.proto, info.decode.message, cmd.payload);
			const errorCode = Number(obj.errorCode ?? 0);
			if (errorCode !== 0) {
				// The upload was rejected. Without this the relay would keep sending into a
				// refusing server and look healthy while the cloud showed nothing.
				this.adapter.log.warn(`[${this.deviceId}] cloud rejected our upload (${label}, error ${errorCode})`);
				return;
			}
			this.adapter.log.debug(
				`[${this.deviceId}] cloud ack ${label} (server time ${Number(obj.time ?? 0)}, offset ${Number(obj.offset ?? 0)})`,
			);
		} catch (err) {
			this.adapter.log.debug(`[${this.deviceId}] cloud ack ${label} could not be decoded: ${errorMessage(err)}`);
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
	private sendAndWait(conn: DeviceConnection, message: Buffer, timeoutMs = 3000): Promise<boolean> {
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
					this.relayRealData(message);
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
				// 0xa213 (AutoSearch response) had a case here. Neither device dispatches the a313
				// request, so the answer cannot arrive — verified live: no reply within 15 s while
				// a311 answered in 0.24 s.
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

	/**
	 * Hand a fresh local RealData frame to the cloud relay.
	 *
	 * The relay does not re-encode the message — it keeps the protobuf payload byte for byte
	 * and only puts a cloud tag and its own sequence number in front of it. That is sound while
	 * the payload is plain, and it is plain on every DTU this relay serves: real cloud traffic
	 * on port 10081 carries unencrypted `0x22NN`/`0x23NN` frames (captures under
	 * `_fwanalysis/captures/`, protobuf directly parseable, serial in the clear).
	 *
	 * It stops being sound the moment a DTU demands encryption (`dfs` bit 25): key and IV are
	 * derived from `enc_rand` **plus message id plus sequence number** (see `Encryption`), and
	 * the re-framing changes both — the server would receive bytes it cannot decrypt. Sending
	 * nothing is the better failure: the cloud then sees a device that went quiet rather than
	 * one that talks gibberish.
	 *
	 * @param message - The raw HM-framed local RealData response (`0xa211`).
	 */
	private relayRealData(message: Buffer): void {
		if (!this.cloudRelay) {
			return;
		}
		if (this.encryptionRequired) {
			if (!this.warnedEncryptedRelay) {
				this.warnedEncryptedRelay = true;
				this.adapter.log.warn(
					`[${this.deviceId || this.host}] This DTU encrypts its local messages, so the cloud relay ` +
						`cannot forward RealData — the cloud would not be able to decrypt it. Relay uploads are ` +
						`skipped; local states are unaffected.`,
				);
			}
			return;
		}
		this.cloudRelay.updateRealData(message);
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
			// The power-limit scale differs by device family and cannot be told from the value
			// (a 2T at 100 % and a 2WB at 10 % both send 1000), so the transport decides it.
			const data = this.protobuf.decodeRealDataNew(
				payload,
				this.transport === "ble" ? SCALE_POWER_LIMIT_BLE : SCALE_POWER_LIMIT_TCP,
			);
			// Report the effective inverter power / daily energy: the dtu-level fields on TCP, the
			// per-inverter / per-string values on BLE (where the dtu-level fields are not populated) —
			// so the debug line matches what the states actually show.
			const effPower = data.dtuPower > 0 ? data.dtuPower : data.sgs.length > 0 ? data.sgs[0].activePower : 0;
			const effDaily =
				data.dtuDailyEnergy > 0 ? data.dtuDailyEnergy : data.pv.reduce((s, pv) => s + (pv.energyDaily || 0), 0);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] RealData: power=${effPower}W, dailyEnergy=${effDaily}, sgs=${data.sgs.length}, pv=${data.pv.length}, meter=${data.meter.length}`,
			);
			await this.applyRealData(data);
			// A Shelly/ecotracker meter reports in fields 13/14/15, which the shared schema cannot
			// express — field 13 is `dtu_daily_energy` there, which is correct on the 2T. So these
			// are read off the raw payload instead, and only for BLE devices: the 2T has no meter
			// input and no energy management at all (firmware-verified).
			if (this.transport === "ble") {
				await this.applyShellyData(payload);
			}
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding RealData: ${errorMessage(err)}`);
		}
	}

	/**
	 * Write the meter states from a raw RealData payload.
	 *
	 * The DTU sends the energy-flow message whenever an inverter is in the frame, but `grid` and
	 * `sp` only carry real values once a meter is bound. The states are therefore created lazily,
	 * on the first frame that actually contains a metering device — a device without a meter never
	 * grows an empty `shelly` branch.
	 *
	 * @param payload - raw RealData protobuf bytes
	 */
	/**
	 * Apply a change to one of the meter controls.
	 *
	 * Writing the MAC only records it — nothing is sent until a mode is chosen, so a half-entered
	 * address cannot reach the device. Choosing a mode binds the meter in that role.
	 *
	 * @param stateId - `meter.mode` or `meter.deviceId`
	 * @param state - the new value
	 */
	private async handleShellyStateChange(stateId: string, state: ioBroker.State): Promise<void> {
		if (stateId === "meter.deviceId") {
			const mac = String(state.val ?? "").trim();
			try {
				// Validate through the same builder the command uses, so a bad address is refused
				// here rather than silently ignored by the device later.
				buildShellyBindData(mac, SHELLY_DEV_TYPE_METER_ONLY);
			} catch (err) {
				this.adapter.log.warn(`[${this.deviceId}] Meter MAC rejected: ${errorMessage(err)}`);
				return;
			}
			await this.setState("meter.deviceId", mac, true);
			return;
		}

		const mode = Number(state.val ?? 0);
		if (mode === 0) {
			// Nothing is sent: the DTU has no "forget this meter" that would not also disturb a
			// running poll, and unbinding is not what a user reaching for "off" usually wants.
			// The value is acknowledged so the choice is visible, and no further binds happen.
			await this.setState("meter.mode", 0, true);
			this.adapter.log.info(`[${this.deviceId}] Meter mode set to off — no further binding sent`);
			return;
		}
		const macState = this.deviceId ? await this.adapter.getStateAsync(`${this.deviceId}.meter.deviceId`) : null;
		const mac = String(macState?.val ?? "").trim();
		if (!mac) {
			this.adapter.log.warn(`[${this.deviceId}] Set the meter MAC before choosing a mode.`);
			return;
		}
		const devType = mode === 2 ? SHELLY_DEV_TYPE_GRID : SHELLY_DEV_TYPE_METER_ONLY;
		try {
			const sent = await this.bindShellyMeter(mac, devType);
			if (sent) {
				await this.setState("meter.mode", mode, true);
			} else {
				this.adapter.log.warn(`[${this.deviceId}] Meter binding could not be sent.`);
			}
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId}] Meter binding failed: ${errorMessage(err)}`);
		}
	}

	/**
	 * Bind a Shelly/ecotracker meter, or re-bind it in a different role.
	 *
	 * This is what starts the DTU's own `EM.GetStatus` WebSocket poll; with
	 * {@link SHELLY_DEV_TYPE_GRID} the meter additionally becomes the grid device its energy
	 * management regulates on, which is what makes zero export work without the adapter in the loop.
	 *
	 * The command is idempotent — re-sending it restarts a poll that has died, which the device is
	 * known to do after a few minutes.
	 *
	 * @param mac - meter MAC (with or without separators)
	 * @param devType - 0 = meter only, 2 = grid device
	 * @returns whether the frame was handed to the transport
	 */
	async bindShellyMeter(mac: string, devType: number): Promise<boolean> {
		if (this.transport !== "ble") {
			throw new Error("Only BLE devices can take a Shelly meter.");
		}
		if (!this.connection?.connected || !this.protobuf) {
			throw new Error("Device is not connected.");
		}
		const body = encodeShellyBindBody(mac, devType, unixSeconds());
		const frame = this.protobuf.buildMessage(SHELLY_CMD_TAG[0], SHELLY_CMD_TAG[1], body);
		this.adapter.log.info(
			`[${this.deviceId || this.host}] Binding Shelly meter ${anonymize(mac)} as ` +
				`${devType === SHELLY_DEV_TYPE_GRID ? "grid device (zero export)" : "meter only"}`,
		);
		return this.connection.send(frame);
	}

	/** Create the `shelly` channel and its states. Called once, on the first frame with a meter. */
	private async createShellyStates(): Promise<void> {
		if (!this.deviceId) {
			return;
		}
		this.adapter.log.info(`[${this.deviceId}] Shelly meter detected, creating meter states`);
		await this.adapter.setObjectNotExistsAsync(`${this.deviceId}.meter`, {
			type: "channel",
			common: { name: { en: "Shelly meter", de: "Shelly-Zähler" } },
			native: {},
		});
		await Promise.all(
			meterMeasurementStates.map(def =>
				this.adapter.extendObjectAsync(`${this.deviceId}.${def.id}`, {
					type: "state",
					common: buildStateCommon(def),
					native: {},
				}),
			),
		);
	}

	private async applyShellyData(payload: Buffer): Promise<void> {
		const devices = parseMeterDevices(payload);
		const flow = parseEnergyFlow(payload);
		if (devices.length === 0 && !this.meterMeasurementStatesCreated) {
			return; // no meter bound (yet) — nothing to show
		}
		if (!this.meterMeasurementStatesCreated) {
			await this.createShellyStates();
			this.meterMeasurementStatesCreated = true;
		}

		const entries: Array<[string, ioBroker.StateValue]> = [];
		if (flow) {
			entries.push(
				["meter.gridPower", flow.grid],
				["meter.pvPower", flow.pv],
				["meter.loadPower", flow.load],
				["meter.storagePower", flow.sp],
				["meter.plugPower", flow.plug],
			);
		}
		// "Connected" means the DTU's meter poll is alive. It dies silently after a few minutes,
		// and then the device simply drops out of the frame — so presence in this frame is the
		// only honest indicator.
		entries.push(["meter.connected", devices.length > 0]);
		if (devices.length > 0) {
			const meter = devices[0];
			entries.push(["meter.lastData", Date.now()]);
			if (meter.serial) {
				entries.push(["meter.deviceId", meter.serial]);
			}
			if (meter.frequency > 0) {
				entries.push(["meter.frequency", meter.frequency]);
			}
			// The device labels its own phases, so use that number rather than the array position.
			for (const ph of meter.phases) {
				entries.push(
					[`meter.l${ph.phase}Voltage`, ph.voltage],
					[`meter.l${ph.phase}Current`, ph.current],
					[`meter.l${ph.phase}Power`, ph.activePower],
				);
			}
		}
		await this.setStates(entries, true);
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
			// The top-level dtu_power / dtu_daily_energy fields are populated on the TCP path but not
			// on the BLE-only 2WB (where those field numbers carry a mode flag / an energy-flow
			// message instead). Fall back to the per-inverter and per-string values, which are correct
			// on both transports. The fallbacks only trigger when the top-level value is 0, so the TCP
			// path is unaffected.
			const sgsPower = data.sgs.length > 0 ? data.sgs[0].activePower : 0;
			const pvDailyWh = data.pv.reduce((sum, pv) => sum + (pv.energyDaily || 0), 0);
			const dailyEnergyWh = data.dtuDailyEnergy > 0 ? data.dtuDailyEnergy : pvDailyWh;

			const entries: Array<[string, ioBroker.StateValue]> = [
				["info.lastResponse", unixSeconds()],
				["inverter.active", data.sgs.length > 0 && (data.dtuPower > 0 || sgsPower > 0)],
				["grid.dailyEnergy", whToKwh(dailyEnergyWh)],
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
					// Only write a limit the device actually reported. The 2T leaves this field empty
					// (measured: 0 while producing 82.9 W), and proto3 cannot tell "absent" from 0 —
					// so writing it anyway would claim the inverter is throttled to a standstill.
					...(sgs.powerLimit > 0
						? [["inverter.activePowerLimit", sgs.powerLimit] as [string, ioBroker.StateValue]]
						: []),
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
				);
			}

			// One line, once, if the device actually fills a list the adapter does not map yet.
			// Silence here would mean nobody ever finds out that there is data to be had.
			const extra = data.extraLists;
			if (extra && !this.extraListsReported && (extra.rp || extra.rsd || extra.tgs)) {
				this.extraListsReported = true;
				this.adapter.log.info(
					`[${this.deviceId || this.host}] device also sends unmapped telemetry lists ` +
						`(rp=${extra.rp}, rsd=${extra.rsd}, tgs=${extra.tgs}) — please report this, ` +
						`these values could become additional states`,
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
					["meter.energyPhaseAExport", m.energyPhaseAExport],
					["meter.energyPhaseBExport", m.energyPhaseBExport],
					["meter.energyPhaseCExport", m.energyPhaseCExport],
					["meter.energyPhaseAImport", m.energyPhaseAImport],
					["meter.energyPhaseBImport", m.energyPhaseBImport],
					["meter.energyPhaseCImport", m.energyPhaseCImport],
					["meter.powerFactorPhaseA", m.powerFactorPhaseA],
					["meter.powerFactorPhaseB", m.powerFactorPhaseB],
					["meter.powerFactorPhaseC", m.powerFactorPhaseC],
					["meter.faultCode", m.faultCode],
				);
			}

			await this.setStates(this.guardCounters(entries), true);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId || this.host}] Error applying RealData: ${errorMessage(err)}`);
		}
	}

	/**
	 * Drop cumulative counter values that would move a counter backwards.
	 *
	 * The device reports a few Wh below the previous figure after a restart — the inverter
	 * re-reads its last persisted value and starts from there. Written through, that is a
	 * downward step in every history and statistics consumer downstream, and CLAUDE.md forbids
	 * it. Non-counter entries pass untouched.
	 *
	 * @param entries - The state writes about to be applied.
	 * @returns The same list minus the rejected counter values.
	 */
	private guardCounters(entries: Array<[string, ioBroker.StateValue]>): Array<[string, ioBroker.StateValue]> {
		const now = Date.now();
		const kept: Array<[string, ioBroker.StateValue]> = [];
		for (const entry of entries) {
			const [id, value] = entry;
			if (typeof value !== "number") {
				kept.push(entry);
				continue;
			}
			const accepted = this.energyGuard.accept(id, value, now);
			if (accepted === null) {
				this.adapter.log.debug(
					`[${this.deviceId || this.host}] ${id}: ignoring ${value}, it would move the counter backwards`,
				);
				continue;
			}
			kept.push([id, accepted]);
		}
		return kept;
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
				["dtu.signalQuality", di.signalStrength],
				["dtu.connState", di.errorCode],
				["dtu.stepTime", di.dtuStepTime],
				["dtu.accessModel", di.accessModel],
				["dtu.communicationTime", di.communicationTime * 1000],
				["dtu.wifiVersion", di.wifiVersion],
			);
			// Publish the meters the device itself knows about, so the user can pick one instead of
			// looking up a MAC address. Only for BLE devices — the T series has no meter input.
			if (this.transport === "ble" && this.meterControlStatesCreated) {
				entries.push(["meter.detected", safeJsonStringify(di.knownMeters)]);
			}
		}
		await this.setStates(entries, true);
	}

	private setupEncryption(info: ReturnType<ProtobufHandler["decodeInfoData"]>): void {
		// BLE frames are already decrypted by the transport (GCM/SN-CBC); DeviceContext must not
		// layer its own CBC decryption on top.
		if (this.transport === "ble") {
			this.encryptionRequired = false;
			return;
		}
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
		// The relay exists for one reason: on a TCP device (HMS-*-xT) the DTU serves a single
		// socket on port 10081, so while the adapter is connected locally the DTU cannot reach
		// the cloud itself — the adapter has to upload on its behalf.
		//
		// A BLE device (HMS-800-2WB) has no local TCP port at all. The adapter talks to it over
		// GATT and never occupies its cloud socket, so the device keeps uploading by itself.
		// Running a relay there would upload a SECOND stream under the same serial while the
		// device is still sending its own — duplicate data from two sources.
		if (this.transport === "ble") {
			if (this.enableCloudRelay) {
				this.adapter.log.debug(
					`[${this.deviceId}] no cloud relay on BLE — the device keeps its own cloud connection`,
				);
			}
			return;
		}
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
				this.cloudRelay.on("ack", (cmd: CloudRelayCommand) => this.handleCloudAck(cmd));
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
			// PERFORMANCE_DATA_MODE is a DTU-internal fast-push mode the BLE-only 2WB does not have (it
			// rejects the command with error 1); BLE is polled directly, so skip it there.
			if (this.protobuf && this.connection?.connected && this.transport !== "ble") {
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
			// The snapshot lets a later configuration write round-trip every field, including the
			// ones deliberately not exposed as states. It is auxiliary: if it fails, the states are
			// still the point of this handler, and a write will simply refuse itself later rather
			// than go out incomplete.
			try {
				this.configSnapshot = this.protobuf.decodeGetConfigRaw(payload);
			} catch (err) {
				this.adapter.log.debug(
					`[${this.deviceId || this.host}] could not keep a configuration snapshot: ${errorMessage(err)}`,
				);
			}
			const config = this.protobuf.decodeGetConfig(payload);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] Config: server=${config.serverDomain}:${config.serverPort}, sendTime=${config.serverSendTime}min`,
			);

			// limit_power_mypower is the DTU-stored (persistent) limit. The 2WB briefly reports 0,
			// which is below the state's 2 % minimum ("0 %" is not a valid limit) — treat 0 as
			// "not reported" and skip the write rather than emit an out-of-range warning.
			const limitPct = config.limitPower / SCALE_POWER;
			await this.setStates(
				[
					...(limitPct >= 2
						? ([["config.limitPowerMyPower", limitPct]] as Array<[string, ioBroker.StateValue]>)
						: []),
					["config.serverDomain", config.serverDomain],
					["config.serverPort", config.serverPort],
					["config.serverSendTime", config.serverSendTime],
					["config.wifiSsid", config.wifiSsid],
					["config.wifiSignalQuality", config.wifiRssi],
					["config.netDhcpSwitch", config.dhcpSwitch],
					["config.dtuApSsid", config.dtuApSsid],
					["config.netmodeSelect", config.netmodeSelect],
					["config.invType", config.invType],
					["config.wifiIpAddress", config.wifiIpAddress],
					["config.wifiMacAddress", config.wifiMacAddress],
					["config.ipAddress", config.ipAddress],
					["config.subnetMask", config.subnetMask],
					["config.gateway", config.gateway],
					["config.dnsServer", config.dnsServer],
					["config.macAddress", config.macAddress],
					["config.meterKind", config.meterKind],
					["config.meterInterface", config.meterInterface],
					["config.zeroExportEnable", config.zeroExportEnable],
					["config.zeroExport433Addr", config.zeroExport433Addr],
					["config.lockTime", config.lockTime],
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
						name: { en: "Seconds between samples", de: "Sekunden zwischen zwei Messpunkten" },
						type: "number" as const,
						role: "value",
						unit: "s",
					},
					{
						id: "history.startTime",
						name: { en: "First sample of the curve", de: "Erster Messpunkt der Kurve" },
						type: "number" as const,
						role: "value.time",
						unit: "",
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
			// The device splits the day into pages of at most 200 samples and reports how many
			// there are in `ap`. Collect them all before publishing, so the curve is never half a
			// day — page 0 alone ends at mid-morning.
			if (this.histPage === 0) {
				this.histSamples = [];
				this.histStart = data.absoluteStart;
			}
			this.histSamples.push(...data.powerArray);
			const pages = data.pageCount > 0 ? Math.min(data.pageCount, HIST_MAX_PAGES) : 1;
			if (data.powerArray.length > 0 && this.histPage + 1 < pages && this.connection?.connected) {
				this.histPage++;
				const next = this.protobuf.encodeHistPowerRequest(unixSeconds(), this.histPage);
				void this.connection
					.send(next)
					.catch(err =>
						this.adapter.log.debug(
							`[${this.deviceId}] HistPower page ${this.histPage} request failed: ${errorMessage(err)}`,
						),
					);
				return;
			}
			this.histPage = 0;
			this.adapter.log.debug(
				`[${this.deviceId}] HistPower: ${this.histSamples.length} samples at ${data.stepTime}s`,
			);
			await this.setState("history.powerJson", safeJsonStringify(this.histSamples), true);
			await this.setState("history.startTime", this.histStart * 1000, true);
			await this.setStates(
				this.guardCounters([
					["history.dailyEnergy", data.dailyEnergy],
					// double normalization: round at Wh precision, then → kWh
					["history.totalEnergy", Math.round(data.totalEnergy / 100) / 10],
				]),
				true,
			);
			await this.setState("history.stepTime", data.stepTime, true);
		} catch (err) {
			this.adapter.log.warn(`[${this.deviceId}] Error decoding HistPower: ${errorMessage(err)}`);
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
			// The payload carries eight fields, and none of them earns a state. All eight were
			// traced through the response builder on both devices (2T `hm_build_send_cmd_a214`
			// @0x408161ec, 2WB @0x4080f31a; see _fwanalysis/ADAPTER_FINDINGS.md §12):
			//
			//   net_set_mod / net_work_mod  literal 1, stored straight from `movi #0x1` — no information.
			//   net_set_time / net_work_time / net_set_state / net_work_state / ap_set_state
			//                               raw values with no enum table and no time base found;
			//                               a state would be a meaningless number.
			//   csq                         the ONLY field with proven meaning, and it is the very
			//                               same byte the adapter already publishes as
			//                               `config.wifiSignalQuality` (2T gp-109642 = 0x6BC9E; 2WB gp-83830
			//                               in both builders), copied into two protobuf fields. A
			//                               second state for it would be a duplicate under another
			//                               name. Note it is a 0..100 signal QUALITY, not dBm:
			//                               clamp(2 * (95 - |rssi_dBm|), 0, 100), named "wifi_rssi"
			//                               against "rssi" in the firmware's own debug output.
			//
			// The debug line stays: it is the only place the raw values are visible if anyone ever
			// wants to decide the five open fields on real data instead of a guess.
			const info = this.protobuf.decodePayload("NetworkInfo", "NetworkInfoReqDTO", payload);
			this.adapter.log.debug(
				`[${this.deviceId || this.host}] NetworkInfo: csq=${Number(info.csq ?? 0)}, ` +
					`workMode=${Number(info.netWorkMod ?? 0)}, workState=${Number(info.netWorkState ?? 0)}, ` +
					`setMode=${Number(info.netSetMod ?? 0)}, setState=${Number(info.netSetState ?? 0)}, ` +
					`apState=${Number(info.apSetState ?? 0)}`,
			);
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
		// The meter controls are not device commands in the usual sense — they configure which
		// meter the DTU should talk to — so they are handled before the command table.
		if (stateId === "meter.mode" || stateId === "meter.deviceId") {
			await this.handleShellyStateChange(stateId, state);
			return;
		}
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
				configSnapshot: this.configSnapshot,
				flashGuard: this.flashGuard,
				flashWriteState: id => {
					let entry = this.flashWrites.get(id);
					if (!entry) {
						entry = { lastValue: null, lastWriteMs: 0, skipsLogged: 0 };
						this.flashWrites.set(id, entry);
					}
					return entry;
				},
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
		// A remembered limit belongs to the device that was connected, not to whatever connects
		// next — keeping it would throttle the first write to a different DTU.
		this.flashWrites.clear();
		this.energyGuard.clear();
		// The snapshot describes the device that was connected. Keeping it would let a write go
		// out built from another device's configuration.
		this.configSnapshot = null;
		this.histPage = 0;
		this.histSamples = [];
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
