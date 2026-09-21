import DeviceContext, { type HoymilesAdapter } from "./deviceContext.js";
import { EsphomeGateway } from "./esphomeGateway.js";
import { discoverGateways, isHoymilesAdvertisement, bleNameToSn } from "./bleDiscovery.js";
import type { ProtobufHandler } from "./protobufHandler.js";
import type { BluetoothLEAdvertisementResponse } from "@2colors/esphome-native-api";
import { ESPHOME_API_PORT, DISCOVERY_TIMEOUT_MS } from "./constants.js";
import { errorMessage, safeJsonStringify } from "./utils.js";

/** One activated BLE inverter from the config: serial, BLE MAC and PIN. */
export interface BleDeviceConfig {
	/** Serial number (12 chars, upper-case) — used for the SN-CBC bootstrap. */
	sn: string;
	/** BLE MAC "AA:BB:CC:DD:EE:FF" — identifies the device. */
	mac: string;
	/** Pairing PIN (plaintext). */
	pin: string;
}

/** Options for {@link BleGatewayManager}. */
export interface BleGatewayManagerOptions {
	/** The adapter instance. */
	adapter: HoymilesAdapter;
	/** Shared protobuf handler. */
	protobuf: ProtobufHandler;
	/** Activated BLE inverters (enabled rows with a serial, MAC and PIN). */
	devices: BleDeviceConfig[];
	/** Data poll interval (seconds). */
	dataInterval: number;
	/** Slow-poll factor. */
	slowPollFactor: number;
	/** Smallest power-limit change worth a flash write, in percent. */
	powerLimitDeadband?: number;
	/** Shortest gap between two power-limit flash writes, in seconds. */
	powerLimitMinIntervalSec?: number;
}

/** Collect advertisements from several gateways for this long before picking the best-RSSI one. */
const CONNECT_DEBOUNCE_MS = 3000;
/** Throttle for republishing the discovered list. */
const PUBLISH_THROTTLE_MS = 5000;
/** RSSI samples older than this are ignored when choosing a gateway. */
const RSSI_MAX_AGE_MS = 30000;
/** Discovered devices not seen within this window drop off the published list. */
const DISCOVERED_TTL_MS = 300000;
/** Re-run mDNS gateway discovery this often while no gateway has been found yet. */
const REDISCOVER_MISSING_MS = 30000;
/** Re-run mDNS gateway discovery this often once at least one gateway is known (to catch new ones). */
const REDISCOVER_FOUND_MS = 300000;

/**
 * Normalize a MAC to bare upper-case hex for matching ("AA:BB:.." → "AABB..").
 *
 * @param mac - MAC address in any separator style
 */
function normMac(mac: string): string {
	return (mac || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

interface RssiSample {
	rssi: number;
	gatewayKey: string;
	gatewayHost: string;
	ts: number;
	/** BLE address type from the advertisement (0 = public, 1 = random). */
	addressType?: number;
}

interface DiscoveredDevice {
	/** Whether this looks like a Hoymiles inverter (name/service heuristic). */
	hoymiles: boolean;
	/** Serial number (only for Hoymiles devices). */
	sn: string;
	name: string;
	mac: string;
	rssi: number;
	gatewayHost: string;
	lastSeen: number;
}

/**
 * Owns the ESPHome BLE gateways and the BLE inverter {@link DeviceContext}s.
 *
 * The user stores each activated inverter as **serial + MAC + PIN** (no gateway). When enabled, the
 * manager auto-discovers ESPHome gateways (mDNS), connects to all of them, and listens for BLE
 * advertisements. For every configured MAC it collects the RSSI reported by each gateway and
 * connects through the one with the **best reception**.
 *
 * Discovered gateways and devices are surfaced read-only (log + `info.bleDiscovered`); nothing is
 * written back into the config. A hard pairing failure deactivates that device and reports the
 * reason in `info.bleLastError`.
 */
export class BleGatewayManager {
	private readonly adapter: HoymilesAdapter;
	private readonly protobuf: ProtobufHandler;
	private readonly dataInterval: number;
	private readonly slowPollFactor: number;
	private readonly powerLimitDeadband?: number;
	private readonly powerLimitMinIntervalSec?: number;

	/** Activated devices keyed by normalized MAC. */
	private readonly wanted: Map<string, BleDeviceConfig>;
	private readonly gateways: Map<string, EsphomeGateway>;
	/** Live device contexts keyed by normalized MAC. */
	private readonly contexts: Map<string, DeviceContext>;
	private readonly rssi: Map<string, Map<string, RssiSample>>;
	private readonly connectTimers: Map<string, ioBroker.Timeout>;
	private readonly discovered: Map<string, DiscoveredDevice>;
	private readonly discoveredGateways: Map<string, { host: string; port: number; name: string }>;

	private publishTimer: ioBroker.Timeout | undefined;
	private publishDirty: boolean;
	private stopped: boolean;
	private discoveryTimer: ioBroker.Timeout | undefined;
	/** Aborts an mDNS scan that is still listening when the adapter shuts down. */
	private readonly discoveryAbort: AbortController;
	private warnedNoGateway: boolean;

	/** @param options - manager configuration */
	constructor(options: BleGatewayManagerOptions) {
		this.adapter = options.adapter;
		this.protobuf = options.protobuf;
		this.dataInterval = options.dataInterval;
		this.slowPollFactor = options.slowPollFactor;
		this.powerLimitDeadband = options.powerLimitDeadband;
		this.powerLimitMinIntervalSec = options.powerLimitMinIntervalSec;
		this.wanted = new Map(options.devices.map(d => [normMac(d.mac), d]));
		this.gateways = new Map();
		this.contexts = new Map();
		this.rssi = new Map();
		this.connectTimers = new Map();
		this.discovered = new Map();
		this.discoveredGateways = new Map();
		this.publishTimer = undefined;
		this.publishDirty = false;
		this.stopped = false;
		this.discoveryTimer = undefined;
		this.discoveryAbort = new AbortController();
		this.warnedNoGateway = false;
	}

	/** Start gateway discovery and begin connecting configured devices as they are seen. */
	start(): void {
		void this.init();
	}

	/** Stop all BLE inverters, gateways and timers. Idempotent. */
	stop(): void {
		this.stopped = true;
		// An mDNS scan can still be listening here — it runs for 15s and holds a multicast socket
		// that no timer teardown reaches. Aborting it ends the wait and closes the socket at once.
		this.discoveryAbort.abort();
		if (this.discoveryTimer) {
			this.adapter.clearTimeout(this.discoveryTimer);
			this.discoveryTimer = undefined;
		}
		for (const t of this.connectTimers.values()) {
			this.adapter.clearTimeout(t);
		}
		this.connectTimers.clear();
		if (this.publishTimer) {
			this.adapter.clearTimeout(this.publishTimer);
			this.publishTimer = undefined;
		}
		for (const ctx of this.contexts.values()) {
			try {
				ctx.disconnect();
			} catch (err) {
				this.adapter.log.warn(`BLE context disconnect error: ${errorMessage(err)}`);
			}
		}
		this.contexts.clear();
		for (const gw of this.gateways.values()) {
			try {
				gw.stop();
			} catch (err) {
				this.adapter.log.warn(`BLE gateway stop error: ${errorMessage(err)}`);
			}
		}
		this.gateways.clear();
	}

	/** Whether any BLE inverter is currently paired/connected. */
	anyConnected(): boolean {
		for (const ctx of this.contexts.values()) {
			if (ctx.connection?.connected) {
				return true;
			}
		}
		return false;
	}

	/** Whether any ESPHome gateway is currently connected/authorized. */
	anyGatewayConnected(): boolean {
		for (const gw of this.gateways.values()) {
			if (gw.connected) {
				return true;
			}
		}
		return false;
	}

	private async init(): Promise<void> {
		if (this.stopped) {
			return;
		}
		let discovered: Array<{ host: string; port: number; name?: string }> = [];
		try {
			discovered = await discoverGateways(DISCOVERY_TIMEOUT_MS * 3, this.adapter, this.discoveryAbort.signal);
		} catch (err) {
			this.adapter.log.debug(`BLE gateway mDNS discovery failed: ${errorMessage(err)}`);
		}
		if (this.stopped) {
			return;
		}
		for (const gw of discovered) {
			this.ensureGateway(gw.host, gw.port, gw.name);
		}
		if (this.gateways.size === 0 && !this.warnedNoGateway) {
			// mDNS can miss the proxy on a first pass (timing, multicast filtering). Warn once, then
			// keep retrying quietly so a proxy that is up (or comes up later) is picked up.
			this.warnedNoGateway = true;
			this.adapter.log.info(
				"BLE gateway enabled but no ESPHome gateway found yet (mDNS). Retrying in the background — check the proxy is running.",
			);
		}
		// Re-scan periodically: fast while nothing is found, slow once a gateway is known (to catch
		// additional or newly-online proxies). ensureGateway() is idempotent, so re-finding is cheap.
		this.discoveryTimer = this.adapter.setTimeout(
			() => {
				this.discoveryTimer = undefined;
				void this.init();
			},
			this.gateways.size === 0 ? REDISCOVER_MISSING_MS : REDISCOVER_FOUND_MS,
		);
	}

	private ensureGateway(host: string, port: number, name?: string): EsphomeGateway {
		const key = `${host}:${port || ESPHOME_API_PORT}`;
		let gateway = this.gateways.get(key);
		if (!gateway) {
			gateway = new EsphomeGateway(host, port || ESPHOME_API_PORT, this.adapter.log);
			gateway.on("error", (e: Error) => this.adapter.log.debug(`[esphome ${host}] ${errorMessage(e)}`));
			gateway.on("connected", () => {
				this.adapter.log.info(`ESPHome gateway ${host} connected`);
				this.refreshConnectionState();
			});
			gateway.on("disconnected", () => {
				this.adapter.log.warn(`ESPHome gateway ${host} disconnected`);
				this.refreshConnectionState();
			});
			gateway.on("advertisement", (adv: BluetoothLEAdvertisementResponse) =>
				this.onAdvertisement(adv, key, host),
			);
			gateway.start();
			this.gateways.set(key, gateway);
		}
		if (!this.discoveredGateways.has(host)) {
			this.discoveredGateways.set(host, { host, port: port || ESPHOME_API_PORT, name: name || "" });
			this.adapter.log.info(`BLE discovery: gateway ${host}${name ? ` (${name})` : ""}`);
			this.publishSoon();
		}
		return gateway;
	}

	private onAdvertisement(adv: BluetoothLEAdvertisementResponse, gatewayKey: string, gatewayHost: string): void {
		if (this.stopped) {
			return;
		}
		const macStr = EsphomeGateway.macToString(adv.address);
		const macKey = normMac(macStr);
		const rssi = typeof adv.rssi === "number" ? adv.rssi : -127;
		const now = Date.now();

		// Surface every BLE device seen; mark and enrich the ones that look like Hoymiles inverters.
		const isHoy = isHoymilesAdvertisement(adv);
		const known = this.discovered.has(macKey);
		this.discovered.set(macKey, {
			hoymiles: isHoy,
			sn: isHoy ? bleNameToSn(adv.name || "") : "",
			name: adv.name || "",
			mac: macStr,
			rssi,
			gatewayHost,
			lastSeen: now,
		});
		if (!known && isHoy) {
			this.adapter.log.info(
				`BLE discovery: Hoymiles device ${bleNameToSn(adv.name || "") || macStr} (${adv.name || "?"}) via ${gatewayHost}`,
			);
		}
		this.publishSoon();

		// For a configured device, match by MAC (regardless of the name heuristic) and track RSSI.
		const want = this.wanted.get(macKey);
		if (!want || this.contexts.has(macKey)) {
			return;
		}
		let byGateway = this.rssi.get(macKey);
		if (!byGateway) {
			byGateway = new Map();
			this.rssi.set(macKey, byGateway);
		}
		byGateway.set(gatewayKey, {
			rssi,
			gatewayKey,
			gatewayHost,
			ts: now,
			addressType: typeof adv.addressType === "number" ? adv.addressType : undefined,
		});
		if (!this.connectTimers.has(macKey)) {
			const timer = this.adapter.setTimeout(() => {
				this.connectTimers.delete(macKey);
				this.connectDevice(macKey);
			}, CONNECT_DEBOUNCE_MS);
			if (timer) {
				this.connectTimers.set(macKey, timer);
			}
		}
	}

	private connectDevice(macKey: string): void {
		if (this.stopped || this.contexts.has(macKey)) {
			return;
		}
		const want = this.wanted.get(macKey);
		const samples = this.rssi.get(macKey);
		if (!want || !samples || samples.size === 0) {
			return;
		}
		// Pick the gateway with the strongest recent signal.
		const cutoff = Date.now() - RSSI_MAX_AGE_MS;
		let best: RssiSample | null = null;
		for (const s of samples.values()) {
			if (s.ts >= cutoff && (!best || s.rssi > best.rssi)) {
				best = s;
			}
		}
		if (!best) {
			return;
		}
		const gateway = this.gateways.get(best.gatewayKey);
		if (!gateway) {
			return;
		}

		const ctx = new DeviceContext({
			adapter: this.adapter,
			protobuf: this.protobuf,
			host: want.mac,
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: this.dataInterval,
			slowPollFactor: this.slowPollFactor,
			powerLimitDeadband: this.powerLimitDeadband,
			powerLimitMinIntervalSec: this.powerLimitMinIntervalSec,
			transport: "ble",
			gateway,
			bleMac: EsphomeGateway.macToNumber(want.mac),
			bleSn: Buffer.from(want.sn, "ascii"),
			blePin: want.pin,
			// The proxy needs the advertised address type; without it the GATT connect fails ("error 0").
			bleAddressType: best.addressType,
			onPairingFailed: (_c, reason) => this.handlePairingFailed(want.sn || want.mac, reason),
		});
		this.contexts.set(macKey, ctx);
		this.adapter.log.info(
			`Connecting BLE inverter ${want.sn || want.mac} (${want.mac}) via gateway ${best.gatewayHost} (rssi ${best.rssi})`,
		);
		try {
			ctx.connect();
		} catch (err) {
			this.adapter.log.error(`Failed to start BLE inverter ${want.sn || want.mac}: ${errorMessage(err)}`);
		}
	}

	private handlePairingFailed(id: string, reason: string): void {
		const msg = `${id}: ${reason}`;
		this.adapter.log.error(`BLE pairing failed for ${msg} — deactivating. Fix the PIN and restart to retry.`);
		this.adapter.setStateAsync("info.bleLastError", msg, true).catch(err => {
			this.adapter.log.debug(`Failed to set info.bleLastError: ${errorMessage(err)}`);
		});
		this.adapter.updateConnectionState().catch(err => {
			this.adapter.log.debug(`updateConnectionState error: ${errorMessage(err)}`);
		});
	}

	private refreshConnectionState(): void {
		this.adapter.updateConnectionState().catch(err => {
			this.adapter.log.debug(`updateConnectionState error: ${errorMessage(err)}`);
		});
	}

	private publishSoon(): void {
		this.publishDirty = true;
		if (this.stopped || this.publishTimer) {
			return;
		}
		this.publishTimer = this.adapter.setTimeout(() => {
			this.publishTimer = undefined;
			if (this.publishDirty) {
				this.publishDirty = false;
				this.publishDiscovered();
			}
		}, PUBLISH_THROTTLE_MS);
	}

	private publishDiscovered(): void {
		// Drop devices not seen recently so the list reflects what is currently in range.
		const cutoff = Date.now() - DISCOVERED_TTL_MS;
		for (const [k, d] of this.discovered) {
			if (d.lastSeen < cutoff) {
				this.discovered.delete(k);
			}
		}
		const payload = {
			gateways: [...this.discoveredGateways.values()],
			// Hoymiles inverters first, then by signal strength.
			devices: [...this.discovered.values()].sort(
				(a, b) => Number(b.hoymiles) - Number(a.hoymiles) || b.rssi - a.rssi,
			),
		};
		this.adapter.setStateAsync("info.bleDiscovered", safeJsonStringify(payload), true).catch(err => {
			this.adapter.log.debug(`Failed to publish info.bleDiscovered: ${errorMessage(err)}`);
		});
	}
}

export default BleGatewayManager;
