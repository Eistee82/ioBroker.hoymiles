import * as utils from "@iobroker/adapter-core";
import { fileURLToPath } from "node:url";
import CloudManager from "./lib/cloudManager.js";
import CloudConnection from "./lib/cloudConnection.js";
import DeviceContext from "./lib/deviceContext.js";
import { ProtobufHandler } from "./lib/protobufHandler.js";
import { discoverDtus, probeHost } from "./lib/networkDiscovery.js";
import { destroyAgent } from "./lib/httpClient.js";
import {
	DISCOVERY_CONCURRENCY,
	DISCOVERY_TIMEOUT_MS,
	PROBE_TIMEOUT_MS,
	POWER_LIMIT_DEADBAND_DEFAULT,
	POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT,
} from "./lib/constants.js";
import { anonymize, errorMessage, mapLimit } from "./lib/utils.js";
import { HoymilesDeviceManagement } from "./lib/deviceManagement.js";
import BleGatewayManager, { type BleDeviceConfig } from "./lib/bleGatewayManager.js";

interface DeviceConfig {
	host: string;
	enabled: boolean;
	serial?: string;
	reachable?: boolean;
}

/** A BLE inverter entry as stored in the config (PIN in protected-native). */
interface BleDeviceConfigRaw {
	sn?: string;
	mac?: string;
	pin?: string;
	enabled?: boolean;
}

interface HoymilesConfig {
	enableLocal?: boolean;
	enableCloud?: boolean;
	enableCloudRelay?: boolean;
	enableRealtimeBurst?: boolean;
	cloudUser?: string;
	cloudPassword?: string;
	dataInterval?: number;
	slowPollFactor?: number;
	powerLimitDeadband?: number;
	powerLimitMinIntervalSec?: number;
	devices?: DeviceConfig[];
	host?: string; // Legacy v0.2.0 flat format
	enableBleGateway?: boolean;
	bleDevices?: BleDeviceConfigRaw[];
}

class Hoymiles extends utils.Adapter {
	public devices: Map<string, DeviceContext>;
	private localContexts: DeviceContext[];
	private cloudManager: CloudManager | null;
	private bleGatewayManager: BleGatewayManager | null;

	/** Shared protobuf handler (loaded once, used by all DeviceContexts). */
	private sharedProtobuf: ProtobufHandler | null;
	/** Cached connection state to avoid redundant setStateAsync calls. */
	private lastConnectionState: boolean | undefined;
	/** Cached BLE connection state to avoid redundant setStateAsync calls. */
	private lastBleConnected: boolean | undefined;

	/**
	 * ioBroker Device Manager backend. Held to keep the instance alive; it binds its own `dm:*`
	 * message handler in its constructor and reads devices lazily from the object DB.
	 */
	readonly deviceManagement: HoymilesDeviceManagement;

	constructor(options: Partial<utils.AdapterOptions> = {}) {
		// useFormatDate makes `this.language` (the ioBroker system language) available, which the
		// alarm handling uses to localize warn messages instead of hard-coding a single language.
		super({ ...options, name: "hoymiles", useFormatDate: true });
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.devices = new Map();
		this.localContexts = [];
		this.cloudManager = null;
		this.bleGatewayManager = null;
		this.sharedProtobuf = null;

		// Device Manager backend. Constructed here (not in onReady) because dm-utils binds its
		// message handler in its own constructor. Intentionally without a communication-state id:
		// passing one makes dm-utils touch the object DB from the constructor (before the adapter
		// is connected), which crashes the process. The tab loads via loadDevices on open and the
		// "Refresh" instance action reloads on demand — no GUI push needed.
		this.deviceManagement = new HoymilesDeviceManagement(this);
	}

	private async onReady(): Promise<void> {
		const cfg = this.config as HoymilesConfig;
		const enableLocal = cfg.enableLocal !== false; // default-on (primary use case)
		const enableCloud = cfg.enableCloud === true; // opt-in
		const enableBleGateway = cfg.enableBleGateway === true; // opt-in (BLE-only inverters)

		if (!enableLocal && !enableCloud && !enableBleGateway) {
			this.log.error(
				"No connection method is enabled. Please enable local, cloud, or the BLE gateway in the adapter settings.",
			);
			return;
		}

		// --- Config migration from v0.2.0 flat format ---
		await this.migrateConfig(cfg);

		const rawInterval = Number(cfg.dataInterval ?? 5);
		const dataInterval = Number.isNaN(rawInterval) ? 5 : rawInterval;
		const rawSlowPoll = Number(cfg.slowPollFactor ?? 6);
		const slowPollFactor = Number.isNaN(rawSlowPoll) || rawSlowPoll < 1 ? 6 : rawSlowPoll;
		// Flash protection for power-limit writes. 0 is a valid "switch it off", so an empty or
		// invalid field falls back to the default while a deliberate 0 is kept.
		const rawDeadband = Number(cfg.powerLimitDeadband ?? POWER_LIMIT_DEADBAND_DEFAULT);
		const powerLimitDeadband =
			Number.isNaN(rawDeadband) || rawDeadband < 0 ? POWER_LIMIT_DEADBAND_DEFAULT : rawDeadband;
		const rawMinInterval = Number(cfg.powerLimitMinIntervalSec ?? POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT);
		const powerLimitMinIntervalSec =
			Number.isNaN(rawMinInterval) || rawMinInterval < 0 ? POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT : rawMinInterval;
		const enableCloudRelay = cfg.enableCloudRelay !== false;
		// Fast realtime burst for cloud-only DTUs. Default on: it only affects DTUs without a
		// local link (skipped otherwise) and follows the server-dictated cadence.
		const enableRealtimeBurst = cfg.enableRealtimeBurst !== false;

		// --- Shared protobuf handler (loaded once, shared across all devices) ---
		this.sharedProtobuf = new ProtobufHandler();
		try {
			await this.sharedProtobuf.loadProtos();
		} catch (err) {
			this.log.error(`Failed to load protobuf definitions: ${errorMessage(err)}`);
			this.terminate("Protobuf definitions could not be loaded — adapter cannot function");
			return;
		}

		// --- Local connections ---
		if (enableLocal) {
			const deviceConfigs = cfg.devices || [];
			const enabledDevices = deviceConfigs.filter(d => d.enabled && d.host);

			if (enabledDevices.length === 0) {
				this.log.warn("Local connection enabled but no devices configured.");
			}

			for (const devCfg of enabledDevices) {
				this.log.info(`Starting local connection to DTU at ${devCfg.host}:10081`);
				const ctx = new DeviceContext({
					adapter: this,
					protobuf: this.sharedProtobuf,
					host: devCfg.host,
					enableLocal: true,
					enableCloud,
					enableCloudRelay,
					dataInterval,
					slowPollFactor,
					powerLimitDeadband,
					powerLimitMinIntervalSec,
				});
				this.localContexts.push(ctx);

				// connect() is synchronous — runtime errors are emitted as events on the connection
				try {
					ctx.connect();
				} catch (err) {
					this.log.error(`Failed to start connection to ${devCfg.host}: ${errorMessage(err)}`);
				}
			}
		}

		// --- BLE gateway (ESPHome Bluetooth proxy) for BLE-only inverters (e.g. HMS-800-2WB) ---
		if (enableBleGateway) {
			// Only activated rows with a MAC and PIN are connected.
			const bleDevices: BleDeviceConfig[] = (cfg.bleDevices || [])
				.map(d => ({
					sn: (d.sn || "").toUpperCase().replace(/[^0-9A-Z]/g, ""),
					mac: (d.mac || "").toUpperCase(),
					pin: d.pin || "",
					enabled: d.enabled === true,
				}))
				.filter(d => d.enabled && d.mac && d.pin)
				.map(({ sn, mac, pin }) => ({ sn, mac, pin }));
			await this.setStateAsync("info.bleLastError", "", true);
			this.bleGatewayManager = new BleGatewayManager({
				adapter: this,
				protobuf: this.sharedProtobuf,
				devices: bleDevices,
				dataInterval,
				slowPollFactor,
				powerLimitDeadband,
				powerLimitMinIntervalSec,
			});
			try {
				this.bleGatewayManager.start();
			} catch (err) {
				this.log.error(`BLE gateway startup failed: ${errorMessage(err)}`);
				try {
					this.bleGatewayManager.stop();
				} catch (stopErr) {
					this.log.warn(`BLE gateway stop also failed: ${errorMessage(stopErr)}`);
				}
				this.bleGatewayManager = null;
			}
		}

		// --- Cloud connection ---
		if (enableCloud) {
			const cloudUser = cfg.cloudUser;
			const cloudPassword = cfg.cloudPassword;
			if (!cloudUser || !cloudPassword) {
				this.log.error(
					"Cloud connection enabled but credentials not configured. Cloud features will be disabled.",
				);
			} else {
				this.log.info("Starting cloud connection to Hoymiles S-Miles API");
				// Clear persisted auth error from previous session — a fresh start gets a clean slate.
				// CloudManager will re-populate this state if the new credentials are still wrong.
				await this.setStateAsync("info.cloudLastError", "", true);
				this.cloudManager = new CloudManager({
					adapter: this,
					protobuf: this.sharedProtobuf,
					cloudUser,
					cloudPassword,
					enableLocal,
					enableCloudRelay,
					enableRealtimeBurst,
					dataInterval,
					slowPollFactor,
					localContexts: this.localContexts,
				});
				try {
					await this.cloudManager.start();
				} catch (err) {
					this.log.error(`Cloud startup failed: ${errorMessage(err)}`);
					try {
						this.cloudManager.stop();
					} catch (stopErr) {
						this.log.warn(`Cloud stop also failed: ${errorMessage(stopErr)}`);
					}
					this.cloudManager = null;
				}
			}
		}

		await this.updateConnectionState();
	}

	/**
	 * Migrate v0.2.0 flat config (single host) to multi-device array format.
	 *
	 * @param cfg - Adapter native config object
	 */
	private async migrateConfig(cfg: HoymilesConfig): Promise<void> {
		if (cfg.host && !cfg.devices) {
			const devices: DeviceConfig[] = [{ host: cfg.host, enabled: true }];
			await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
				native: { devices, host: "" } as Record<string, unknown>,
			});
			cfg.devices = devices;
			this.log.info("Migrated single-device config to multi-device format");
		}

		// Clean up old flat state objects from v0.2.0
		try {
			const oldGrid = await this.getObjectAsync("grid");
			if (oldGrid && oldGrid.type === "channel") {
				this.log.info("Cleaning up old flat state structure (migrating to device-level)");
				const oldChannels = ["grid", "inverter", "dtu", "alarms", "config", "meter", "history"];
				const pvChannels = Array.from({ length: 4 }, (_, i) => `pv${i}`);
				const results = await Promise.allSettled(
					[...oldChannels, ...pvChannels].map(ch => this.delObjectAsync(ch, { recursive: true })),
				);
				for (const r of results) {
					if (r.status === "rejected") {
						this.log.debug(`Migration cleanup: failed to delete channel: ${errorMessage(r.reason)}`);
					}
				}
			}
		} catch (err) {
			this.log.debug(`Config migration cleanup: ${errorMessage(err)}`);
		}
	}

	// --- Connection state ---

	async updateConnectionState(): Promise<void> {
		const anyLocalConnected = this.localContexts.some(ctx => ctx.connection?.connected);
		const cloudOk = this.cloudManager?.hasToken;
		// A paired BLE inverter counts as a data connection; a bare gateway link does not.
		const anyBleInverter = this.bleGatewayManager?.anyConnected() ?? false;
		// info.bleConnected tracks the ESPHome gateway link itself (not inverter pairing).
		const anyBleGateway = this.bleGatewayManager?.anyGatewayConnected() ?? false;

		if (anyBleGateway !== this.lastBleConnected) {
			this.lastBleConnected = anyBleGateway;
			await this.setStateAsync("info.bleConnected", anyBleGateway, true);
		}

		const newState = !!(anyLocalConnected || cloudOk || anyBleInverter);
		if (newState === this.lastConnectionState) {
			return;
		}
		this.lastConnectionState = newState;
		await this.setStateAsync("info.connection", newState, true);
	}

	// --- Cloud polling callbacks (delegated to CloudManager) ---

	/**
	 * Called by DeviceContext when the cloud relay has sent data.
	 * Delegates to CloudManager to schedule a poll 30s later.
	 */
	onRelayDataSent(): void {
		this.cloudManager?.onRelayDataSent();
	}

	/**
	 * Called by DeviceContext when a local DTU connection is established.
	 * Propagates serverSendTime and notifies CloudManager to exit night mode.
	 *
	 * @param ctx - The device context that just connected
	 */
	onLocalConnected(ctx: DeviceContext): void {
		this.cloudManager?.onLocalConnected(ctx);
	}

	/**
	 * Called by DeviceContext when a local DTU connection is lost.
	 * If ALL local connections are offline, puts CloudManager into night mode.
	 *
	 * @param _ctx - The device context that just disconnected
	 */
	onLocalDisconnected(_ctx: DeviceContext): void {
		this.cloudManager?.onLocalDisconnected();
	}

	/**
	 * Called by DeviceContext when the DTU reports its cloud send interval.
	 *
	 * @param ctx - The device context with updated cloudSendTimeMin
	 */
	onSendTimeUpdated(ctx: DeviceContext): void {
		this.cloudManager?.onLocalConnected(ctx);
	}

	/**
	 * Attempt to match a newly identified local device with pending cloud data.
	 *
	 * @param ctx - The device context that just learned its DTU serial
	 */
	matchLocalDeviceToCloud(ctx: DeviceContext): void {
		this.cloudManager?.matchLocalDeviceToCloud(ctx);
	}

	/**
	 * Send a device control command over the cloud (fallback for command states on devices with
	 * no local link). Rejects when the cloud is disabled.
	 *
	 * @param devSn - Target device serial number (unprefixed): the inverter for micro commands, the DTU for DTU commands.
	 * @param dtuSn - DTU serial number (unprefixed).
	 * @param action - Control action code (see DEVICE_COMMAND_* / DTU_COMMAND_* constants).
	 * @param devType - Target device type (see CLOUD_DEV_TYPE_* constants; defaults to micro-inverter).
	 */
	async sendCloudDeviceCommand(devSn: string, dtuSn: string, action: number, devType?: number): Promise<void> {
		if (!this.cloudManager) {
			throw new Error("Cloud is not enabled");
		}
		await this.cloudManager.sendDeviceCommand(devSn, dtuSn, action, devType);
	}

	// --- State change routing ---

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack) {
			return;
		}

		// id format: "hoymiles.0.<deviceId>.<channel>.<state>"
		const parts = id.split(".");
		if (parts.length < 4) {
			return;
		}
		const deviceId = parts[2];
		const stateId = parts.slice(3).join(".");

		const device = this.devices.get(deviceId);
		if (!device) {
			this.log.warn(`State change for unknown device: ${deviceId}`);
			return;
		}

		await device.handleStateChange(stateId, state);
	}

	// --- Message handling (admin UI communication) ---

	/**
	 * Send a response back to the admin UI if a callback is registered.
	 *
	 * @param obj - ioBroker message object with callback
	 * @param data - Response payload
	 */
	private reply(obj: ioBroker.Message, data: unknown): void {
		if (obj.callback) {
			this.sendTo(obj.from, obj.command, data, obj.callback);
		}
	}

	/**
	 * Pick a message in the ioBroker system language. The admin sendTo dialog shows an `error`
	 * string as-is, so a localized string is returned rather than an `{en, de}` object (which the
	 * dialog would print verbatim).
	 *
	 * @param en - English text (also the fallback)
	 * @param de - German text
	 */
	private tr(en: string, de: string): string {
		return this.language === "de" ? de : en;
	}

	/**
	 * Handle messages from the admin UI (e.g. device discovery).
	 *
	 * @param obj - The message object from admin
	 */
	private onMessage(obj: ioBroker.Message): void {
		// Device Manager messages (`dm:*`) are handled by the dm-utils base class, which binds
		// its own message listener. Let them pass through untouched instead of replying "unknown".
		if (typeof obj?.command === "string" && obj.command.startsWith("dm:")) {
			return;
		}
		if (typeof obj === "object" && obj.command) {
			if (obj.command === "discover") {
				void this.handleDiscover(obj).catch(err => this.log.error(`Discover failed: ${errorMessage(err)}`));
			} else if (obj.command === "testConnections") {
				void this.handleTestConnections(obj).catch(err =>
					this.log.error(`TestConnections failed: ${errorMessage(err)}`),
				);
			} else if (obj.command === "testCloudLogin") {
				void this.handleTestCloudLogin(obj).catch(err =>
					this.log.error(`TestCloudLogin failed: ${errorMessage(err)}`),
				);
			} else if (obj.command === "importBleDevices") {
				void this.handleImportBleDevices(obj).catch(err =>
					this.log.error(`ImportBleDevices failed: ${errorMessage(err)}`),
				);
			} else {
				this.log.debug(`Unknown message command: ${obj.command}`);
				this.reply(obj, { error: `Unknown command: ${obj.command}` });
			}
		}
	}

	/**
	 * Scan the local network for Hoymiles DTUs on port 10081.
	 *
	 * @param obj - The message object to respond to
	 */
	private async handleDiscover(obj: ioBroker.Message): Promise<void> {
		try {
			this.log.info("Starting network discovery for Hoymiles DTUs...");
			const found = await discoverDtus(DISCOVERY_TIMEOUT_MS, DISCOVERY_CONCURRENCY);

			if (found.length === 0) {
				this.log.info("No DTUs found on the local network");
				this.reply(obj, { error: this.tr("No DTUs found", "Keine DTUs gefunden") });
				return;
			}

			// Merge found inverters into current config (skip duplicates by host OR serial)
			const cfg = this.config as HoymilesConfig;
			const currentDevices = (cfg.devices || []).map(d => ({ ...d }));
			const existingHosts = new Set(currentDevices.map(d => d.host));
			const existingSerials = new Set(currentDevices.map(d => d.serial).filter(s => s));

			for (const device of found) {
				this.log.info(`Found inverter: ${device.host} (SN: ${device.dtuSerial || "unknown"})`);
				const isDuplicateHost = existingHosts.has(device.host);
				const isDuplicateSerial = device.dtuSerial && existingSerials.has(device.dtuSerial);
				if (!isDuplicateHost && !isDuplicateSerial) {
					currentDevices.push({
						host: device.host,
						enabled: true,
						serial: device.dtuSerial || "",
						reachable: true,
					});
					existingHosts.add(device.host);
					if (device.dtuSerial) {
						existingSerials.add(device.dtuSerial);
					}
				} else if (isDuplicateSerial) {
					this.log.info(`  Skipped: serial ${device.dtuSerial} already configured`);
				} else if (isDuplicateHost) {
					this.log.info(`  Skipped: host ${device.host} already configured`);
				}
			}

			// Return {native: {devices: [...]}} — admin updates the form data
			// See: https://github.com/ioBroker/json-config#sendto
			this.reply(obj, { native: { devices: currentDevices } });
		} catch (err) {
			this.log.error(`Discovery failed: ${errorMessage(err)}`);
			this.reply(obj, { error: errorMessage(err) });
		}
	}

	/**
	 * Add the currently-discovered Hoymiles BLE inverters (from `info.bleDiscovered`) as rows in the
	 * config table so the user only has to enter each PIN and tick Active. Existing rows (and their
	 * PINs) are preserved; nothing is written to disk here — the admin form is updated and the user
	 * saves.
	 *
	 * @param obj - The message object to respond to
	 */
	private async handleImportBleDevices(obj: ioBroker.Message): Promise<void> {
		try {
			const st = await this.getStateAsync("info.bleDiscovered");
			let devices: Array<{ hoymiles?: boolean; sn?: string; mac?: string }> = [];
			try {
				const parsed = JSON.parse((st?.val as string) || "{}");
				devices = Array.isArray(parsed?.devices) ? parsed.devices : [];
			} catch {
				devices = [];
			}
			const norm = (m: string | undefined): string =>
				String(m || "")
					.replace(/[^0-9a-fA-F]/g, "")
					.toUpperCase();
			const found = devices.filter(d => d && d.hoymiles && d.mac);
			if (found.length === 0) {
				this.reply(obj, {
					error: this.tr(
						"No Hoymiles inverters discovered yet. Make sure an inverter is powered on (producing) and within Bluetooth range of the proxy.",
						"Noch keine Hoymiles-Wechselrichter erkannt. Stelle sicher, dass ein Wechselrichter eingeschaltet ist (produziert) und in Bluetooth-Reichweite des Proxys liegt.",
					),
				});
				return;
			}

			const cfg = this.config as HoymilesConfig;
			const current: BleDeviceConfigRaw[] = (cfg.bleDevices || []).map(d => ({ ...d }));
			const existing = new Set(current.map(d => norm(d.mac)));
			let added = 0;
			for (const d of found) {
				const key = norm(d.mac);
				if (key && !existing.has(key)) {
					current.push({ sn: d.sn || "", mac: d.mac, pin: "", enabled: false });
					existing.add(key);
					added++;
				}
			}
			this.log.info(`BLE import: ${added} new device(s) added to the config table (${found.length} discovered)`);
			this.reply(obj, { native: { bleDevices: current } });
		} catch (err) {
			this.log.error(`BLE import failed: ${errorMessage(err)}`);
			this.reply(obj, { error: errorMessage(err) });
		}
	}

	/**
	 * Test connections to all configured inverters and fill in serial numbers.
	 *
	 * @param obj - The message object from admin
	 */
	private async handleTestConnections(obj: ioBroker.Message): Promise<void> {
		try {
			if (typeof obj.message !== "object" || obj.message === null) {
				this.reply(obj, { error: "Invalid message format" });
				return;
			}
			const msg = obj.message as { devices?: DeviceConfig[] };
			const devices = msg?.devices || [];
			if (devices.length === 0) {
				this.reply(obj, { error: "No devices configured" });
				return;
			}

			this.log.info(`Testing connections to ${devices.length} inverter(s)...`);
			const updated = devices.map(d => ({ ...d }));
			let success = 0;

			await mapLimit(updated, 5, async device => {
				if (!device.host) {
					device.reachable = false;
					return;
				}
				const result = await probeHost(device.host, PROBE_TIMEOUT_MS);
				if (result) {
					device.serial = result.dtuSerial || "";
					device.reachable = true;
					success++;
					this.log.info(`  ${device.host}: OK (SN: ${device.serial})`);
				} else {
					device.reachable = false;
					this.log.info(`  ${device.host}: not reachable`);
				}
			});

			// Warn about duplicates (same serial from different IPs)
			const serialMap = new Map<string, string>();
			for (const device of updated) {
				if (device.serial && device.reachable) {
					const existing = serialMap.get(device.serial);
					if (existing) {
						this.log.warn(
							`  Duplicate: ${device.host} and ${existing} are the same inverter (SN: ${device.serial})`,
						);
					} else {
						serialMap.set(device.serial, device.host);
					}
				}
			}

			this.log.info(`Connection test: ${success}/${devices.length} reachable`);

			this.reply(obj, { native: { devices: updated } });
		} catch (err) {
			this.log.error(`Connection test failed: ${errorMessage(err)}`);
			this.reply(obj, { error: errorMessage(err) });
		}
	}

	/**
	 * Diagnose the configured Hoymiles cloud credentials by trying both auth flows
	 * (region_c discovery + v3 + v0) without storing a token. Reports back to the
	 * admin UI which flow accepts the account — invaluable when a user reports
	 * "Login failed: all authentication strategies rejected" in the forum.
	 *
	 * @param obj - The message object from admin
	 */
	private async handleTestCloudLogin(obj: ioBroker.Message): Promise<void> {
		try {
			const msg = (obj.message || {}) as { user?: string; password?: string };
			const cfg = this.config as HoymilesConfig;
			const user = (msg.user ?? cfg.cloudUser ?? "").trim();
			const password = msg.password ?? cfg.cloudPassword ?? "";
			if (!user || !password) {
				this.reply(obj, {
					error: this.tr("Email and password required", "E-Mail und Passwort erforderlich"),
				});
				return;
			}

			this.log.info(`[testCloudLogin] starting diagnostics for ${anonymize(user, "acct")}`);
			const cloud = new CloudConnection(user, password, m => this.log.debug(`[testCloudLogin] ${m}`));
			const results = await cloud.loginDiagnostics();

			// Compose human-readable summary, log it (so forum users can copy from logs),
			// and return raw results to the UI.
			const summary = this.formatLoginDiagnostics(results);

			this.log.info(`[testCloudLogin] result for ${anonymize(user, "acct")}: ${summary}`);

			const anyAccepted = results.some(r => r.flow === "login" && r.ok);
			this.reply(obj, {
				result: {
					ok: anyAccepted,
					user,
					summary,
					attempts: results,
				},
			});
		} catch (err) {
			this.log.error(`[testCloudLogin] unexpected error: ${errorMessage(err)}`);
			this.reply(obj, { error: errorMessage(err) });
		}
	}

	/**
	 * Format cloud login-diagnostic results into a one-line human summary. Shared by the admin
	 * "Test cloud login" button and the Device Manager instance action.
	 *
	 * @param results - Per-flow diagnostic results from {@link CloudConnection.loginDiagnostics}.
	 */
	private formatLoginDiagnostics(results: Awaited<ReturnType<CloudConnection["loginDiagnostics"]>>): string {
		return results
			.map(r => {
				const head = `${r.flow}@${new URL(r.host).host}`;
				if (r.flow === "region") {
					return r.ok
						? `${head}: ok (dc=${r.dc ?? "n/a"})`
						: `${head}: failed${r.status ? ` status=${r.status}` : ""}${r.message ? ` "${r.message}"` : ""}`;
				}
				if (r.flow === "preInsp") {
					return r.ok
						? `${head}: ok (v=${r.v ?? "?"} salt=${r.saltPresent ? "yes" : "no"})`
						: `${head}: failed${r.status ? ` status=${r.status}` : ""}${r.message ? ` "${r.message}"` : ""}`;
				}
				if (r.flow === "probe") {
					return r.ok
						? `${head}: profile=${r.profile ?? "?"}${r.status ? ` (status=${r.status})` : ""}`
						: `${head}: probe failed${r.message ? ` "${r.message}"` : ""}`;
				}
				return r.ok
					? `${head}: ACCEPTED (token received)`
					: `${head}: rejected${r.status ? ` status=${r.status}` : ""}${r.message ? ` "${r.message}"` : ""}`;
			})
			.join(" | ");
	}

	/**
	 * Device-Manager helper: scan the local network for DTUs and return a short human summary.
	 * Report-only — it does not modify the configured device list (unlike the admin discover button).
	 */
	public async dmScanNetwork(): Promise<string> {
		try {
			const found = await discoverDtus(DISCOVERY_TIMEOUT_MS, DISCOVERY_CONCURRENCY);
			if (found.length === 0) {
				return "No DTUs found on the local network.";
			}
			return `Found ${found.length} DTU(s): ${found
				.map(d => `${d.host}${d.dtuSerial ? ` (${d.dtuSerial})` : ""}`)
				.join(", ")}`;
		} catch (err) {
			return `Network scan failed: ${errorMessage(err)}`;
		}
	}

	/**
	 * Device-Manager helper: run cloud login diagnostics for the configured credentials and
	 * return the same one-line summary the admin "Test cloud login" button produces.
	 */
	public async dmTestCloudLogin(): Promise<string> {
		const cfg = this.config as HoymilesConfig;
		const user = (cfg.cloudUser ?? "").trim();
		const password = cfg.cloudPassword ?? "";
		if (!user || !password) {
			return "Cloud is not configured.";
		}
		try {
			const cloud = new CloudConnection(user, password, m => this.log.debug(`[dm testCloudLogin] ${m}`));
			const results = await cloud.loginDiagnostics();
			return this.formatLoginDiagnostics(results);
		} catch (err) {
			return `Cloud login test failed: ${errorMessage(err)}`;
		}
	}

	// --- Unload ---

	private onUnload(callback: () => void): void {
		// No self-scheduled unload watchdog: scheduling any timer here is exactly what triggers
		// js-controller's "setTimeout called, but adapter is shutting down" warning, and it is
		// unnecessary — js-controller force-stops the adapter after onUnload on its own. Just tear
		// everything down and call the callback once cleanup settles (per the adapter template).
		const cleanup = async (): Promise<void> => {
			const contexts = this.localContexts;
			this.localContexts = [];
			for (const ctx of contexts) {
				try {
					ctx.disconnect();
				} catch (err) {
					this.log.warn(`Disconnect error: ${errorMessage(err)}`);
				}
			}
			try {
				if (this.cloudManager) {
					this.cloudManager.stop();
					this.cloudManager = null;
				}
			} catch (err) {
				this.log.warn(`CloudManager stop error: ${errorMessage(err)}`);
			}
			try {
				if (this.bleGatewayManager) {
					this.bleGatewayManager.stop();
					this.bleGatewayManager = null;
				}
			} catch (err) {
				this.log.warn(`BleGatewayManager stop error: ${errorMessage(err)}`);
			}
			// Idempotent safety net: disconnect() is a no-op for contexts already torn down above
			// (local via localContexts, cloud-only via CloudManager.stop()).
			for (const ctx of this.devices.values()) {
				try {
					ctx.disconnect();
				} catch (err) {
					this.log.warn(`Device disconnect error: ${errorMessage(err)}`);
				}
			}
			this.devices.clear();
			this.sharedProtobuf = null;
			try {
				this.unsubscribeStates("*");
			} catch (err) {
				this.log.warn(`Unsubscribe error: ${errorMessage(err)}`);
			}
			try {
				destroyAgent();
			} catch (err) {
				this.log.warn(`destroyAgent error: ${errorMessage(err)}`);
			}
			try {
				await this.setStateAsync("info.connection", false, true);
				await this.setStateAsync("info.cloudConnected", false, true);
				await this.setStateAsync("info.bleConnected", false, true);
			} catch (err) {
				this.log.debug(`Shutdown state update skipped: ${errorMessage(err)}`);
			}
		};

		cleanup()
			.catch(err => this.log.error(`Unload error: ${errorMessage(err)}`))
			.finally(() => callback());
	}
}

/**
 * Create a new Hoymiles adapter instance for programmatic use.
 *
 * @param options - Adapter options passed to the ioBroker adapter core
 */
export default function createAdapter(options: Partial<utils.AdapterOptions> = {}): Hoymiles {
	return new Hoymiles(options);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	new Hoymiles();
}
