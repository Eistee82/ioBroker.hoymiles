import * as utils from "@iobroker/adapter-core";
import { fileURLToPath } from "node:url";
import CloudManager from "./lib/cloudManager.js";
import CloudConnection from "./lib/cloudConnection.js";
import DeviceContext from "./lib/deviceContext.js";
import { ProtobufHandler } from "./lib/protobufHandler.js";
import { discoverDtus, probeHost } from "./lib/networkDiscovery.js";
import { destroyAgent } from "./lib/httpClient.js";
import { DISCOVERY_CONCURRENCY, DISCOVERY_TIMEOUT_MS, PROBE_TIMEOUT_MS, POWER_LIMIT_DEADBAND_DEFAULT, POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT, } from "./lib/constants.js";
import { anonymize, errorMessage, mapLimit } from "./lib/utils.js";
import { HoymilesDeviceManagement } from "./lib/deviceManagement.js";
import BleGatewayManager from "./lib/bleGatewayManager.js";
class Hoymiles extends utils.Adapter {
    devices;
    localContexts;
    cloudManager;
    bleGatewayManager;
    sharedProtobuf;
    lastConnectionState;
    lastBleConnected;
    deviceManagement;
    constructor(options = {}) {
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
        this.deviceManagement = new HoymilesDeviceManagement(this);
    }
    async onReady() {
        const cfg = this.config;
        const enableLocal = cfg.enableLocal !== false;
        const enableCloud = cfg.enableCloud === true;
        const enableBleGateway = cfg.enableBleGateway === true;
        if (!enableLocal && !enableCloud && !enableBleGateway) {
            this.log.error("No connection method is enabled. Please enable local, cloud, or the BLE gateway in the adapter settings.");
            return;
        }
        await this.migrateConfig(cfg);
        const rawInterval = Number(cfg.dataInterval ?? 5);
        const dataInterval = Number.isNaN(rawInterval) ? 5 : rawInterval;
        const rawSlowPoll = Number(cfg.slowPollFactor ?? 6);
        const slowPollFactor = Number.isNaN(rawSlowPoll) || rawSlowPoll < 1 ? 6 : rawSlowPoll;
        const rawDeadband = Number(cfg.powerLimitDeadband ?? POWER_LIMIT_DEADBAND_DEFAULT);
        const powerLimitDeadband = Number.isNaN(rawDeadband) || rawDeadband < 0 ? POWER_LIMIT_DEADBAND_DEFAULT : rawDeadband;
        const rawMinInterval = Number(cfg.powerLimitMinIntervalSec ?? POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT);
        const powerLimitMinIntervalSec = Number.isNaN(rawMinInterval) || rawMinInterval < 0 ? POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT : rawMinInterval;
        const enableCloudRelay = cfg.enableCloudRelay !== false;
        const enableRealtimeBurst = cfg.enableRealtimeBurst !== false;
        this.sharedProtobuf = new ProtobufHandler();
        try {
            await this.sharedProtobuf.loadProtos();
        }
        catch (err) {
            this.log.error(`Failed to load protobuf definitions: ${errorMessage(err)}`);
            this.terminate("Protobuf definitions could not be loaded — adapter cannot function");
            return;
        }
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
                try {
                    ctx.connect();
                }
                catch (err) {
                    this.log.error(`Failed to start connection to ${devCfg.host}: ${errorMessage(err)}`);
                }
            }
        }
        if (enableBleGateway) {
            const bleDevices = (cfg.bleDevices || [])
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
            }
            catch (err) {
                this.log.error(`BLE gateway startup failed: ${errorMessage(err)}`);
                try {
                    this.bleGatewayManager.stop();
                }
                catch (stopErr) {
                    this.log.warn(`BLE gateway stop also failed: ${errorMessage(stopErr)}`);
                }
                this.bleGatewayManager = null;
            }
        }
        if (enableCloud) {
            const cloudUser = cfg.cloudUser;
            const cloudPassword = cfg.cloudPassword;
            if (!cloudUser || !cloudPassword) {
                this.log.error("Cloud connection enabled but credentials not configured. Cloud features will be disabled.");
            }
            else {
                this.log.info("Starting cloud connection to Hoymiles S-Miles API");
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
                }
                catch (err) {
                    this.log.error(`Cloud startup failed: ${errorMessage(err)}`);
                    try {
                        this.cloudManager.stop();
                    }
                    catch (stopErr) {
                        this.log.warn(`Cloud stop also failed: ${errorMessage(stopErr)}`);
                    }
                    this.cloudManager = null;
                }
            }
        }
        await this.updateConnectionState();
    }
    async migrateConfig(cfg) {
        if (cfg.host && !cfg.devices) {
            const devices = [{ host: cfg.host, enabled: true }];
            await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
                native: { devices, host: "" },
            });
            cfg.devices = devices;
            this.log.info("Migrated single-device config to multi-device format");
        }
        try {
            const oldGrid = await this.getObjectAsync("grid");
            if (oldGrid && oldGrid.type === "channel") {
                this.log.info("Cleaning up old flat state structure (migrating to device-level)");
                const oldChannels = ["grid", "inverter", "dtu", "alarms", "config", "meter", "history"];
                const pvChannels = Array.from({ length: 4 }, (_, i) => `pv${i}`);
                const results = await Promise.allSettled([...oldChannels, ...pvChannels].map(ch => this.delObjectAsync(ch, { recursive: true })));
                for (const r of results) {
                    if (r.status === "rejected") {
                        this.log.debug(`Migration cleanup: failed to delete channel: ${errorMessage(r.reason)}`);
                    }
                }
            }
        }
        catch (err) {
            this.log.debug(`Config migration cleanup: ${errorMessage(err)}`);
        }
    }
    async updateConnectionState() {
        const anyLocalConnected = this.localContexts.some(ctx => ctx.connection?.connected);
        const cloudOk = this.cloudManager?.hasToken;
        const anyBleInverter = this.bleGatewayManager?.anyConnected() ?? false;
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
    onRelayDataSent() {
        this.cloudManager?.onRelayDataSent();
    }
    onLocalConnected(ctx) {
        this.cloudManager?.onLocalConnected(ctx);
    }
    onLocalDisconnected(_ctx) {
        this.cloudManager?.onLocalDisconnected();
    }
    onSendTimeUpdated(ctx) {
        this.cloudManager?.onLocalConnected(ctx);
    }
    matchLocalDeviceToCloud(ctx) {
        this.cloudManager?.matchLocalDeviceToCloud(ctx);
    }
    async sendCloudDeviceCommand(devSn, dtuSn, action, devType) {
        if (!this.cloudManager) {
            throw new Error("Cloud is not enabled");
        }
        await this.cloudManager.sendDeviceCommand(devSn, dtuSn, action, devType);
    }
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
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
    reply(obj, data) {
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, data, obj.callback);
        }
    }
    tr(en, de) {
        return this.language === "de" ? de : en;
    }
    onMessage(obj) {
        if (typeof obj?.command === "string" && obj.command.startsWith("dm:")) {
            return;
        }
        if (typeof obj === "object" && obj.command) {
            if (obj.command === "discover") {
                void this.handleDiscover(obj).catch(err => this.log.error(`Discover failed: ${errorMessage(err)}`));
            }
            else if (obj.command === "testConnections") {
                void this.handleTestConnections(obj).catch(err => this.log.error(`TestConnections failed: ${errorMessage(err)}`));
            }
            else if (obj.command === "testCloudLogin") {
                void this.handleTestCloudLogin(obj).catch(err => this.log.error(`TestCloudLogin failed: ${errorMessage(err)}`));
            }
            else if (obj.command === "importBleDevices") {
                void this.handleImportBleDevices(obj).catch(err => this.log.error(`ImportBleDevices failed: ${errorMessage(err)}`));
            }
            else {
                this.log.debug(`Unknown message command: ${obj.command}`);
                this.reply(obj, { error: `Unknown command: ${obj.command}` });
            }
        }
    }
    async handleDiscover(obj) {
        try {
            this.log.info("Starting network discovery for Hoymiles DTUs...");
            const found = await discoverDtus(DISCOVERY_TIMEOUT_MS, DISCOVERY_CONCURRENCY);
            if (found.length === 0) {
                this.log.info("No DTUs found on the local network");
                this.reply(obj, { error: this.tr("No DTUs found", "Keine DTUs gefunden") });
                return;
            }
            const cfg = this.config;
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
                }
                else if (isDuplicateSerial) {
                    this.log.info(`  Skipped: serial ${device.dtuSerial} already configured`);
                }
                else if (isDuplicateHost) {
                    this.log.info(`  Skipped: host ${device.host} already configured`);
                }
            }
            this.reply(obj, { native: { devices: currentDevices } });
        }
        catch (err) {
            this.log.error(`Discovery failed: ${errorMessage(err)}`);
            this.reply(obj, { error: errorMessage(err) });
        }
    }
    async handleImportBleDevices(obj) {
        try {
            const st = await this.getStateAsync("info.bleDiscovered");
            let devices = [];
            try {
                const parsed = JSON.parse(st?.val || "{}");
                devices = Array.isArray(parsed?.devices) ? parsed.devices : [];
            }
            catch {
                devices = [];
            }
            const norm = (m) => String(m || "")
                .replace(/[^0-9a-fA-F]/g, "")
                .toUpperCase();
            const found = devices.filter(d => d && d.hoymiles && d.mac);
            if (found.length === 0) {
                this.reply(obj, {
                    error: this.tr("No Hoymiles inverters discovered yet. Make sure an inverter is powered on (producing) and within Bluetooth range of the proxy.", "Noch keine Hoymiles-Wechselrichter erkannt. Stelle sicher, dass ein Wechselrichter eingeschaltet ist (produziert) und in Bluetooth-Reichweite des Proxys liegt."),
                });
                return;
            }
            const cfg = this.config;
            const current = (cfg.bleDevices || []).map(d => ({ ...d }));
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
        }
        catch (err) {
            this.log.error(`BLE import failed: ${errorMessage(err)}`);
            this.reply(obj, { error: errorMessage(err) });
        }
    }
    async handleTestConnections(obj) {
        try {
            if (typeof obj.message !== "object" || obj.message === null) {
                this.reply(obj, { error: "Invalid message format" });
                return;
            }
            const msg = obj.message;
            const devices = msg?.devices || [];
            if (devices.length === 0) {
                this.reply(obj, { error: "No devices configured" });
                return;
            }
            this.log.info(`Testing connections to ${devices.length} inverter(s)...`);
            const updated = devices.map(d => ({ ...d }));
            let success = 0;
            await mapLimit(updated, 5, async (device) => {
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
                }
                else {
                    device.reachable = false;
                    this.log.info(`  ${device.host}: not reachable`);
                }
            });
            const serialMap = new Map();
            for (const device of updated) {
                if (device.serial && device.reachable) {
                    const existing = serialMap.get(device.serial);
                    if (existing) {
                        this.log.warn(`  Duplicate: ${device.host} and ${existing} are the same inverter (SN: ${device.serial})`);
                    }
                    else {
                        serialMap.set(device.serial, device.host);
                    }
                }
            }
            this.log.info(`Connection test: ${success}/${devices.length} reachable`);
            this.reply(obj, { native: { devices: updated } });
        }
        catch (err) {
            this.log.error(`Connection test failed: ${errorMessage(err)}`);
            this.reply(obj, { error: errorMessage(err) });
        }
    }
    async handleTestCloudLogin(obj) {
        try {
            const msg = (obj.message || {});
            const cfg = this.config;
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
        }
        catch (err) {
            this.log.error(`[testCloudLogin] unexpected error: ${errorMessage(err)}`);
            this.reply(obj, { error: errorMessage(err) });
        }
    }
    formatLoginDiagnostics(results) {
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
    async dmScanNetwork() {
        try {
            const found = await discoverDtus(DISCOVERY_TIMEOUT_MS, DISCOVERY_CONCURRENCY);
            if (found.length === 0) {
                return "No DTUs found on the local network.";
            }
            return `Found ${found.length} DTU(s): ${found
                .map(d => `${d.host}${d.dtuSerial ? ` (${d.dtuSerial})` : ""}`)
                .join(", ")}`;
        }
        catch (err) {
            return `Network scan failed: ${errorMessage(err)}`;
        }
    }
    async dmTestCloudLogin() {
        const cfg = this.config;
        const user = (cfg.cloudUser ?? "").trim();
        const password = cfg.cloudPassword ?? "";
        if (!user || !password) {
            return "Cloud is not configured.";
        }
        try {
            const cloud = new CloudConnection(user, password, m => this.log.debug(`[dm testCloudLogin] ${m}`));
            const results = await cloud.loginDiagnostics();
            return this.formatLoginDiagnostics(results);
        }
        catch (err) {
            return `Cloud login test failed: ${errorMessage(err)}`;
        }
    }
    onUnload(callback) {
        const cleanup = async () => {
            const contexts = this.localContexts;
            this.localContexts = [];
            for (const ctx of contexts) {
                try {
                    ctx.disconnect();
                }
                catch (err) {
                    this.log.warn(`Disconnect error: ${errorMessage(err)}`);
                }
            }
            try {
                if (this.cloudManager) {
                    this.cloudManager.stop();
                    this.cloudManager = null;
                }
            }
            catch (err) {
                this.log.warn(`CloudManager stop error: ${errorMessage(err)}`);
            }
            try {
                if (this.bleGatewayManager) {
                    this.bleGatewayManager.stop();
                    this.bleGatewayManager = null;
                }
            }
            catch (err) {
                this.log.warn(`BleGatewayManager stop error: ${errorMessage(err)}`);
            }
            for (const ctx of this.devices.values()) {
                try {
                    ctx.disconnect();
                }
                catch (err) {
                    this.log.warn(`Device disconnect error: ${errorMessage(err)}`);
                }
            }
            this.devices.clear();
            this.sharedProtobuf = null;
            try {
                this.unsubscribeStates("*");
            }
            catch (err) {
                this.log.warn(`Unsubscribe error: ${errorMessage(err)}`);
            }
            try {
                destroyAgent();
            }
            catch (err) {
                this.log.warn(`destroyAgent error: ${errorMessage(err)}`);
            }
            try {
                await this.setStateAsync("info.connection", false, true);
                await this.setStateAsync("info.cloudConnected", false, true);
                await this.setStateAsync("info.bleConnected", false, true);
            }
            catch (err) {
                this.log.debug(`Shutdown state update skipped: ${errorMessage(err)}`);
            }
        };
        cleanup()
            .catch(err => this.log.error(`Unload error: ${errorMessage(err)}`))
            .finally(() => callback());
    }
}
export default function createAdapter(options = {}) {
    return new Hoymiles(options);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    new Hoymiles();
}
//# sourceMappingURL=main.js.map