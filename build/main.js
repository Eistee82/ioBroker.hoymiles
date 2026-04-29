import * as utils from "@iobroker/adapter-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import CloudManager from "./lib/cloudManager.js";
import DeviceContext from "./lib/deviceContext.js";
import { ProtobufHandler } from "./lib/protobufHandler.js";
import { discoverDtus, probeHost } from "./lib/networkDiscovery.js";
import { destroyAgent } from "./lib/httpClient.js";
import { DISCOVERY_CONCURRENCY, DISCOVERY_TIMEOUT_MS, PROBE_TIMEOUT_MS, UNLOAD_TIMEOUT_MS } from "./lib/constants.js";
import { errorMessage, mapLimit } from "./lib/utils.js";
class Hoymiles extends utils.Adapter {
    devices;
    localContexts;
    cloudManager;
    sharedProtobuf;
    lastConnectionState;
    constructor(options = {}) {
        super({ ...options, name: "hoymiles" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.devices = new Map();
        this.localContexts = [];
        this.cloudManager = null;
        this.sharedProtobuf = null;
    }
    i18nName(key, ...args) {
        return utils.I18n.getTranslatedObject(key, ...args);
    }
    i18nDescOptional(key) {
        const obj = utils.I18n.getTranslatedObject(key);
        if (typeof obj === "object" &&
            obj !== null &&
            Object.keys(obj).length === 1 &&
            obj.en === key) {
            return undefined;
        }
        return obj;
    }
    async onReady() {
        await utils.I18n.init(join(dirname(fileURLToPath(import.meta.url)), "lib"), this);
        const cfg = this.config;
        const enableLocal = cfg.enableLocal !== false;
        const enableCloud = cfg.enableCloud === true;
        if (!enableLocal && !enableCloud) {
            this.log.error("Neither local nor cloud connection is enabled. Please enable at least one in the adapter settings.");
            return;
        }
        await this.migrateConfig(cfg);
        const rawInterval = Number(cfg.dataInterval ?? 5);
        const dataInterval = Number.isNaN(rawInterval) ? 5 : rawInterval;
        const rawSlowPoll = Number(cfg.slowPollFactor ?? 6);
        const slowPollFactor = Number.isNaN(rawSlowPoll) || rawSlowPoll < 1 ? 6 : rawSlowPoll;
        const enableCloudRelay = cfg.enableCloudRelay !== false;
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
        const newState = !!(anyLocalConnected || cloudOk);
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
    onMessage(obj) {
        if (typeof obj === "object" && obj.command) {
            if (obj.command === "discover") {
                void this.handleDiscover(obj).catch(err => this.log.error(`Discover failed: ${errorMessage(err)}`));
            }
            else if (obj.command === "testConnections") {
                void this.handleTestConnections(obj).catch(err => this.log.error(`TestConnections failed: ${errorMessage(err)}`));
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
                this.reply(obj, {
                    error: {
                        en: "No DTUs found",
                        de: "Keine DTUs gefunden",
                        ru: "DTU не найдены",
                        pt: "Nenhuma DTU encontrada",
                        nl: "Geen DTU's gevonden",
                        fr: "Aucune DTU trouvée",
                        it: "Nessuna DTU trovata",
                        es: "No se encontraron DTUs",
                        pl: "Nie znaleziono żadnych DTU",
                        uk: "DTU не знайдено",
                        "zh-cn": "未找到 DTU",
                    },
                });
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
    onUnload(callback) {
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                callback();
            }
        };
        const timer = this.setTimeout(() => {
            this.log.warn("Unload timeout after 5s — forcing shutdown");
            finish();
        }, UNLOAD_TIMEOUT_MS);
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
            }
            catch (err) {
                this.log.debug(`Shutdown state update skipped: ${errorMessage(err)}`);
            }
        };
        cleanup()
            .catch(err => this.log.error(`Unload error: ${errorMessage(err)}`))
            .finally(() => {
            this.clearTimeout(timer);
            finish();
        });
    }
}
export default function createAdapter(options = {}) {
    return new Hoymiles(options);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    new Hoymiles();
}
//# sourceMappingURL=main.js.map