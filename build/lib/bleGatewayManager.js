import DeviceContext from "./deviceContext.js";
import { EsphomeGateway } from "./esphomeGateway.js";
import { discoverGateways, isHoymilesAdvertisement, bleNameToSn } from "./bleDiscovery.js";
import { ESPHOME_API_PORT, DISCOVERY_TIMEOUT_MS } from "./constants.js";
import { errorMessage, safeJsonStringify } from "./utils.js";
const CONNECT_DEBOUNCE_MS = 3000;
const PUBLISH_THROTTLE_MS = 5000;
const RSSI_MAX_AGE_MS = 30000;
const DISCOVERED_TTL_MS = 300000;
const REDISCOVER_MISSING_MS = 30000;
const REDISCOVER_FOUND_MS = 300000;
function normMac(mac) {
    return (mac || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}
export class BleGatewayManager {
    adapter;
    protobuf;
    dataInterval;
    slowPollFactor;
    powerLimitDeadband;
    powerLimitMinIntervalSec;
    wanted;
    gateways;
    contexts;
    rssi;
    connectTimers;
    discovered;
    discoveredGateways;
    publishTimer;
    publishDirty;
    stopped;
    discoveryTimer;
    discoveryAbort;
    warnedNoGateway;
    constructor(options) {
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
    start() {
        void this.init();
    }
    stop() {
        this.stopped = true;
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
            }
            catch (err) {
                this.adapter.log.warn(`BLE context disconnect error: ${errorMessage(err)}`);
            }
        }
        this.contexts.clear();
        for (const gw of this.gateways.values()) {
            try {
                gw.stop();
            }
            catch (err) {
                this.adapter.log.warn(`BLE gateway stop error: ${errorMessage(err)}`);
            }
        }
        this.gateways.clear();
    }
    anyConnected() {
        for (const ctx of this.contexts.values()) {
            if (ctx.connection?.connected) {
                return true;
            }
        }
        return false;
    }
    anyGatewayConnected() {
        for (const gw of this.gateways.values()) {
            if (gw.connected) {
                return true;
            }
        }
        return false;
    }
    async init() {
        if (this.stopped) {
            return;
        }
        let discovered = [];
        try {
            discovered = await discoverGateways(DISCOVERY_TIMEOUT_MS * 3, this.adapter, this.discoveryAbort.signal);
        }
        catch (err) {
            this.adapter.log.debug(`BLE gateway mDNS discovery failed: ${errorMessage(err)}`);
        }
        if (this.stopped) {
            return;
        }
        for (const gw of discovered) {
            this.ensureGateway(gw.host, gw.port, gw.name);
        }
        if (this.gateways.size === 0 && !this.warnedNoGateway) {
            this.warnedNoGateway = true;
            this.adapter.log.info("BLE gateway enabled but no ESPHome gateway found yet (mDNS). Retrying in the background — check the proxy is running.");
        }
        this.discoveryTimer = this.adapter.setTimeout(() => {
            this.discoveryTimer = undefined;
            void this.init();
        }, this.gateways.size === 0 ? REDISCOVER_MISSING_MS : REDISCOVER_FOUND_MS);
    }
    ensureGateway(host, port, name) {
        const key = `${host}:${port || ESPHOME_API_PORT}`;
        let gateway = this.gateways.get(key);
        if (!gateway) {
            gateway = new EsphomeGateway(host, port || ESPHOME_API_PORT, this.adapter.log);
            gateway.on("error", (e) => this.adapter.log.debug(`[esphome ${host}] ${errorMessage(e)}`));
            gateway.on("connected", () => {
                this.adapter.log.info(`ESPHome gateway ${host} connected`);
                this.refreshConnectionState();
            });
            gateway.on("disconnected", () => {
                this.adapter.log.warn(`ESPHome gateway ${host} disconnected`);
                this.refreshConnectionState();
            });
            gateway.on("advertisement", (adv) => this.onAdvertisement(adv, key, host));
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
    onAdvertisement(adv, gatewayKey, gatewayHost) {
        if (this.stopped) {
            return;
        }
        const macStr = EsphomeGateway.macToString(adv.address);
        const macKey = normMac(macStr);
        const rssi = typeof adv.rssi === "number" ? adv.rssi : -127;
        const now = Date.now();
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
            this.adapter.log.info(`BLE discovery: Hoymiles device ${bleNameToSn(adv.name || "") || macStr} (${adv.name || "?"}) via ${gatewayHost}`);
        }
        this.publishSoon();
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
    connectDevice(macKey) {
        if (this.stopped || this.contexts.has(macKey)) {
            return;
        }
        const want = this.wanted.get(macKey);
        const samples = this.rssi.get(macKey);
        if (!want || !samples || samples.size === 0) {
            return;
        }
        const cutoff = Date.now() - RSSI_MAX_AGE_MS;
        let best = null;
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
            bleAddressType: best.addressType,
            onPairingFailed: (_c, reason) => this.handlePairingFailed(want.sn || want.mac, reason),
        });
        this.contexts.set(macKey, ctx);
        this.adapter.log.info(`Connecting BLE inverter ${want.sn || want.mac} (${want.mac}) via gateway ${best.gatewayHost} (rssi ${best.rssi})`);
        try {
            ctx.connect();
        }
        catch (err) {
            this.adapter.log.error(`Failed to start BLE inverter ${want.sn || want.mac}: ${errorMessage(err)}`);
        }
    }
    handlePairingFailed(id, reason) {
        const msg = `${id}: ${reason}`;
        this.adapter.log.error(`BLE pairing failed for ${msg} — deactivating. Fix the PIN and restart to retry.`);
        this.adapter.setStateAsync("info.bleLastError", msg, true).catch(err => {
            this.adapter.log.debug(`Failed to set info.bleLastError: ${errorMessage(err)}`);
        });
        this.adapter.updateConnectionState().catch(err => {
            this.adapter.log.debug(`updateConnectionState error: ${errorMessage(err)}`);
        });
    }
    refreshConnectionState() {
        this.adapter.updateConnectionState().catch(err => {
            this.adapter.log.debug(`updateConnectionState error: ${errorMessage(err)}`);
        });
    }
    publishSoon() {
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
    publishDiscovered() {
        const cutoff = Date.now() - DISCOVERED_TTL_MS;
        for (const [k, d] of this.discovered) {
            if (d.lastSeen < cutoff) {
                this.discovered.delete(k);
            }
        }
        const payload = {
            gateways: [...this.discoveredGateways.values()],
            devices: [...this.discovered.values()].sort((a, b) => Number(b.hoymiles) - Number(a.hoymiles) || b.rssi - a.rssi),
        };
        this.adapter.setStateAsync("info.bleDiscovered", safeJsonStringify(payload), true).catch(err => {
            this.adapter.log.debug(`Failed to publish info.bleDiscovered: ${errorMessage(err)}`);
        });
    }
}
export default BleGatewayManager;
//# sourceMappingURL=bleGatewayManager.js.map