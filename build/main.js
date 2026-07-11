import * as utils from "@iobroker/adapter-core";
import { fileURLToPath } from "node:url";
import CloudManager from "./lib/cloudManager.js";
import CloudConnection from "./lib/cloudConnection.js";
import DeviceContext from "./lib/deviceContext.js";
import { ProtobufHandler } from "./lib/protobufHandler.js";
import RelayServer from "./lib/relayServer.js";
import { discoverDtus, probeHost } from "./lib/networkDiscovery.js";
import { destroyAgent } from "./lib/httpClient.js";
import { DISCOVERY_CONCURRENCY, DISCOVERY_TIMEOUT_MS, PROBE_TIMEOUT_MS, UNLOAD_TIMEOUT_MS, RELAY_SERVER_DEFAULT_PORT, RELAY_SERVER_DEFAULT_CLOUD_PORT, } from "./lib/constants.js";
import { anonymize, errorMessage, mapLimit } from "./lib/utils.js";
class Hoymiles extends utils.Adapter {
    devices;
    localContexts;
    cloudManager;
    relayServer;
    sharedProtobuf;
    lastConnectionState;
    dataInterval;
    slowPollFactor;
    constructor(options = {}) {
        super({ ...options, name: "hoymiles" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.devices = new Map();
        this.localContexts = [];
        this.cloudManager = null;
        this.relayServer = null;
        this.dataInterval = 5;
        this.slowPollFactor = 6;
        this.sharedProtobuf = null;
    }
    async onReady() {
        const cfg = this.config;
        const enableLocal = cfg.enableLocal !== false;
        const enableCloud = cfg.enableCloud === true;
        const enableRelayServer = cfg.enableRelayServer === true;
        if (!enableLocal && !enableCloud && !enableRelayServer) {
            this.log.error("Neither local, cloud, nor relay-server connection is enabled. Please enable at least one in the adapter settings.");
            return;
        }
        await this.migrateConfig(cfg);
        const rawInterval = Number(cfg.dataInterval ?? 5);
        const dataInterval = Number.isNaN(rawInterval) ? 5 : rawInterval;
        const rawSlowPoll = Number(cfg.slowPollFactor ?? 6);
        const slowPollFactor = Number.isNaN(rawSlowPoll) || rawSlowPoll < 1 ? 6 : rawSlowPoll;
        const enableCloudRelay = cfg.enableCloudRelay !== false;
        const enableRealtimeBurst = cfg.enableRealtimeBurst !== false;
        this.dataInterval = dataInterval;
        this.slowPollFactor = slowPollFactor;
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
        if (enableRelayServer) {
            this.startRelayServer(cfg);
        }
        await this.updateConnectionState();
    }
    startRelayServer(cfg) {
        const cloudHost = (cfg.relayCloudServer || "").trim();
        if (!cloudHost) {
            this.log.warn("Relay server enabled but no upstream cloud host configured — not starting.");
            return;
        }
        if (!this.sharedProtobuf) {
            this.log.warn("Relay server enabled but protobuf definitions are unavailable — not starting.");
            return;
        }
        const port = Number(cfg.relayServerPort) > 0 ? Number(cfg.relayServerPort) : RELAY_SERVER_DEFAULT_PORT;
        const cloudPort = Number(cfg.relayCloudPort) > 0 ? Number(cfg.relayCloudPort) : RELAY_SERVER_DEFAULT_CLOUD_PORT;
        const relay = new RelayServer(this.sharedProtobuf, msg => this.log.debug(`Relay server: ${msg}`));
        relay.on("listening", (listenPort) => {
            this.log.info(`Relay server listening on port ${listenPort}, forwarding to ${cloudHost}:${cloudPort}`);
        });
        relay.on("connection", (evt) => {
            this.log.info(`Relay server: connection from ${evt.remoteAddress} (session ${evt.sessionId})`);
        });
        relay.on("deviceIdentified", (evt) => {
            void this.onRelayDeviceIdentified(evt.dtuSn).catch(err => this.log.warn(`Relay server: device identification failed for ${evt.dtuSn}: ${errorMessage(err)}`));
        });
        relay.on("realData", (evt) => {
            if (!evt.data || !evt.dtuSn) {
                return;
            }
            const ctx = this.devices.get(evt.dtuSn);
            if (!ctx) {
                this.log.debug(`Relay server: RealData for unmatched DTU ${evt.dtuSn} (no device registered yet)`);
                return;
            }
            void ctx
                .applyRealData(evt.data)
                .catch(err => this.log.warn(`Relay server: applyRealData failed for ${evt.dtuSn}: ${errorMessage(err)}`));
        });
        relay.on("disconnection", (evt) => {
            this.log.info(`Relay server: session ${evt.sessionId} ended (${evt.reason})`);
            if (!evt.dtuSn) {
                return;
            }
            const ctx = this.devices.get(evt.dtuSn);
            if (ctx) {
                void ctx
                    .markRelaySessionLost()
                    .catch(err => this.log.warn(`Relay server: markRelaySessionLost failed for ${evt.dtuSn}: ${errorMessage(err)}`));
            }
        });
        relay.on("command", (evt) => {
            this.log.debug(`Relay server: [diag] ${evt.direction} command 0x${evt.cmdHigh.toString(16)} 0x${evt.cmdLow.toString(16)} (dtu=${evt.dtuSn || "?"}, ${evt.payload.length}B)`);
        });
        relay.on("error", (err) => {
            this.log.warn(`Relay server: ${errorMessage(err)}`);
        });
        relay.start(port, cloudHost, cloudPort);
        this.relayServer = relay;
    }
    async onRelayDeviceIdentified(dtuSn) {
        if (!dtuSn) {
            return;
        }
        let ctx = this.devices.get(dtuSn);
        if (!ctx) {
            if (!this.sharedProtobuf) {
                return;
            }
            ctx = new DeviceContext({
                adapter: this,
                protobuf: this.sharedProtobuf,
                host: "",
                enableLocal: true,
                enableCloud: false,
                enableCloudRelay: false,
                dataInterval: this.dataInterval,
                slowPollFactor: this.slowPollFactor,
            });
            await ctx.initFromSerial(dtuSn);
            this.devices.set(dtuSn, ctx);
            this.log.info(`Relay server: created device for redirected DTU ${dtuSn}`);
        }
        await ctx.markRelaySessionActive();
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
            else if (obj.command === "testCloudLogin") {
                void this.handleTestCloudLogin(obj).catch(err => this.log.error(`TestCloudLogin failed: ${errorMessage(err)}`));
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
                this.reply(obj, { error: { en: "No DTUs found", de: "Keine DTUs gefunden" } });
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
    async handleTestCloudLogin(obj) {
        try {
            const msg = (obj.message || {});
            const cfg = this.config;
            const user = (msg.user ?? cfg.cloudUser ?? "").trim();
            const password = msg.password ?? cfg.cloudPassword ?? "";
            if (!user || !password) {
                this.reply(obj, {
                    error: { en: "Email and password required", de: "E-Mail und Passwort erforderlich" },
                });
                return;
            }
            this.log.info(`[testCloudLogin] starting diagnostics for ${anonymize(user, "acct")}`);
            const cloud = new CloudConnection(user, password, m => this.log.debug(`[testCloudLogin] ${m}`));
            const results = await cloud.loginDiagnostics();
            const summary = results
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
            try {
                if (this.relayServer) {
                    this.relayServer.stop();
                    this.relayServer = null;
                }
            }
            catch (err) {
                this.log.warn(`RelayServer stop error: ${errorMessage(err)}`);
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