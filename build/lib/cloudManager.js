import CloudConnection, { CloudAuthError } from "./cloudConnection.js";
import CloudPoller from "./cloudPoller.js";
import DeviceContext from "./deviceContext.js";
import { stationChannels, stationStates } from "./stateDefinitions.js";
import { CLOUD_DISCOVER_CONCURRENCY, CLOUD_RETRY_INITIAL_MS, CLOUD_RETRY_MAX_MS } from "./constants.js";
import { errorMessage, mapLimit } from "./utils.js";
class CloudManager {
    adapter;
    protobuf;
    enableLocal;
    enableCloudRelay;
    dataInterval;
    slowPollFactor;
    localContexts;
    cloud;
    cloudPoller;
    pendingCloudMatches;
    stationDevices;
    cloudRetryDelay;
    retryTimer;
    deferredMatchTimer;
    authErrorActive;
    constructor(options) {
        this.adapter = options.adapter;
        this.protobuf = options.protobuf;
        this.enableLocal = options.enableLocal;
        this.enableCloudRelay = options.enableCloudRelay;
        this.dataInterval = options.dataInterval;
        this.slowPollFactor = options.slowPollFactor;
        this.localContexts = options.localContexts;
        this.cloud = new CloudConnection(options.cloudUser, options.cloudPassword, msg => this.adapter.log.debug(`Cloud: ${msg}`));
        this.cloudPoller = null;
        this.pendingCloudMatches = new Map();
        this.stationDevices = new Set();
        this.cloudRetryDelay = CLOUD_RETRY_INITIAL_MS;
        this.authErrorActive = false;
    }
    async start() {
        try {
            await this._initCloudServices();
        }
        catch (err) {
            if (err instanceof CloudAuthError) {
                await this._handleAuthError(err);
                return;
            }
            this.adapter.log.error(`Cloud login failed: ${errorMessage(err)}`);
            await this.adapter.setStateAsync("info.cloudConnected", false, true);
            await this.adapter.updateConnectionState();
            this._retryLogin();
        }
    }
    stop() {
        if (this.retryTimer) {
            this.adapter.clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
        if (this.deferredMatchTimer) {
            this.adapter.clearTimeout(this.deferredMatchTimer);
            this.deferredMatchTimer = undefined;
        }
        if (this.cloudPoller) {
            this.cloudPoller.stop();
            this.cloudPoller = null;
        }
        this.cloud.disconnect();
        this.pendingCloudMatches.clear();
        this.stationDevices.clear();
        const cloudOnly = [...this.adapter.devices.entries()].filter(([, ctx]) => ctx instanceof DeviceContext && !ctx.enableLocal);
        for (const [serial, ctx] of cloudOnly) {
            try {
                ctx.disconnect();
            }
            catch {
            }
            this.adapter.devices.delete(serial);
        }
    }
    get hasToken() {
        return !!this.cloud.token;
    }
    matchLocalDeviceToCloud(ctx) {
        if (!ctx.dtuSerial) {
            return;
        }
        if (!this.adapter.devices.has(ctx.dtuSerial)) {
            this.adapter.devices.set(ctx.dtuSerial, ctx);
        }
        const stationId = this.pendingCloudMatches.get(ctx.dtuSerial);
        if (stationId !== undefined) {
            ctx.cloudStationId = stationId;
            this.pendingCloudMatches.delete(ctx.dtuSerial);
            this.adapter.log.info(`Deferred cloud match resolved: DTU ${ctx.dtuSerial} → station ${stationId}`);
        }
    }
    onRelayDataSent() {
        this.cloudPoller?.onRelayDataSent();
    }
    onLocalConnected(ctx) {
        if (this.cloudPoller && ctx.cloudSendTimeMin > 0) {
            this.cloudPoller.setServerSendTime(ctx.cloudSendTimeMin);
        }
        this.cloudPoller?.onLocalConnected();
    }
    onLocalDisconnected() {
        const anyConnected = this.localContexts.some(c => c.connection?.connected);
        if (!anyConnected) {
            void this.cloudPoller?.onLocalDisconnected();
        }
    }
    async _initCloudServices() {
        await this.cloud.login();
        this.adapter.log.info("Cloud login successful");
        await this.adapter.setStateAsync("info.cloudConnected", true, true);
        await this.adapter.setStateAsync("info.cloudLastError", "", true);
        await this.adapter.updateConnectionState();
        await this._discoverDevices();
        const hasActiveRelay = this.enableCloudRelay && this.enableLocal;
        this.cloudPoller = new CloudPoller({
            cloud: this.cloud,
            adapter: this.adapter,
            devices: this.adapter.devices,
            stationDevices: this.stationDevices,
            slowPollFactor: this.slowPollFactor,
            hasRelay: hasActiveRelay,
        });
        await this.cloudPoller.initialFetch();
        if (!hasActiveRelay) {
            this.cloudPoller.scheduleCloudPoll();
        }
    }
    _retryLogin() {
        if (this.retryTimer || this.authErrorActive) {
            return;
        }
        const delay = this.cloudRetryDelay;
        this.adapter.log.info(`Will retry cloud login in ${Math.round(delay / 1000)}s...`);
        this.retryTimer = this.adapter.setTimeout(async () => {
            this.retryTimer = undefined;
            try {
                await this._initCloudServices();
                this.cloudRetryDelay = CLOUD_RETRY_INITIAL_MS;
            }
            catch (retryErr) {
                if (retryErr instanceof CloudAuthError) {
                    await this._handleAuthError(retryErr);
                    return;
                }
                this.adapter.log.error(`Cloud login retry failed: ${errorMessage(retryErr)}`);
                this.cloudRetryDelay = Math.min(this.cloudRetryDelay * 2, CLOUD_RETRY_MAX_MS);
                this._retryLogin();
            }
        }, delay);
    }
    async _handleAuthError(err) {
        this.authErrorActive = true;
        this.adapter.log.error(`Cloud authentication failed: ${err.message}. Further retries are suspended until credentials are updated — otherwise the Hoymiles account may be locked out.`);
        try {
            await this.adapter.setStateAsync("info.cloudConnected", false, true);
            await this.adapter.setStateAsync("info.cloudLastError", err.message, true);
            await this.adapter.updateConnectionState();
            if (typeof this.adapter.registerNotification === "function") {
                await this.adapter.registerNotification("hoymiles", "cloudAuth", `Cloud authentication failed: ${err.message}`);
            }
        }
        catch (stateErr) {
            this.adapter.log.warn(`Failed to persist cloud auth error state: ${errorMessage(stateErr)}`);
        }
    }
    async _discoverDevices() {
        const stationList = await this.cloud.getStationList();
        if (stationList.length === 0) {
            this.adapter.log.error("No stations found in cloud account");
            return;
        }
        const localBySerial = new Map();
        for (const ctx of this.localContexts) {
            if (ctx.dtuSerial) {
                localBySerial.set(ctx.dtuSerial, ctx);
            }
        }
        const stationData = await mapLimit(stationList, CLOUD_DISCOVER_CONCURRENCY, async (station) => {
            await this._createStationDevice(station.id, station.name);
            try {
                const deviceTree = await this.cloud.getDeviceTree(station.id);
                return { station, deviceTree };
            }
            catch (err) {
                this.adapter.log.warn(`Failed to get device tree for station ${station.name}: ${errorMessage(err)}`);
                return { station, deviceTree: [] };
            }
        });
        for (const { station, deviceTree } of stationData) {
            try {
                for (const dtu of deviceTree) {
                    const dtuSerial = dtu.sn;
                    if (!dtuSerial) {
                        continue;
                    }
                    const localCtx = localBySerial.get(dtuSerial);
                    const matched = !!localCtx;
                    if (localCtx) {
                        localCtx.cloudStationId = station.id;
                        this.adapter.devices.set(dtuSerial, localCtx);
                        this.adapter.log.info(`Cloud matched DTU ${dtuSerial} to local device at ${localCtx.host}`);
                    }
                    if (!matched) {
                        const hasUnidentified = this.localContexts.some(ctx => !ctx.dtuSerial);
                        if (hasUnidentified) {
                            this.pendingCloudMatches.set(dtuSerial, station.id);
                            this.adapter.log.debug(`Deferred cloud match for DTU ${dtuSerial} (waiting for local serial)`);
                        }
                        else {
                            const ctx = new DeviceContext({
                                adapter: this.adapter,
                                protobuf: this.protobuf,
                                host: "",
                                enableLocal: false,
                                enableCloud: true,
                                enableCloudRelay: false,
                                dataInterval: this.dataInterval,
                                slowPollFactor: this.slowPollFactor,
                            });
                            ctx.cloudStationId = station.id;
                            await ctx.initFromSerial(dtuSerial);
                            this.adapter.devices.set(dtuSerial, ctx);
                            this.adapter.log.info(`Created cloud-only device for DTU ${dtuSerial}`);
                        }
                    }
                }
            }
            catch (err) {
                this.adapter.log.warn(`Failed to process device tree for station ${station.name}: ${errorMessage(err)}`);
            }
        }
        for (const ctx of this.localContexts) {
            if (ctx.dtuSerial && !this.adapter.devices.has(ctx.dtuSerial)) {
                this.adapter.devices.set(ctx.dtuSerial, ctx);
            }
        }
        if (this.pendingCloudMatches.size > 0) {
            this.deferredMatchTimer = this.adapter.setTimeout(async () => {
                this.deferredMatchTimer = undefined;
                try {
                    for (const [serial, stationId] of this.pendingCloudMatches) {
                        if (!this.adapter.devices.has(serial)) {
                            const ctx = new DeviceContext({
                                adapter: this.adapter,
                                protobuf: this.protobuf,
                                host: "",
                                enableLocal: false,
                                enableCloud: true,
                                enableCloudRelay: false,
                                dataInterval: this.dataInterval,
                                slowPollFactor: this.slowPollFactor,
                            });
                            ctx.cloudStationId = stationId;
                            await ctx.initFromSerial(serial);
                            this.adapter.devices.set(serial, ctx);
                            this.adapter.log.info(`Deferred match timeout: created cloud-only device for DTU ${serial}`);
                        }
                    }
                }
                catch (err) {
                    this.adapter.log.error(`Deferred cloud device creation failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                finally {
                    this.pendingCloudMatches.clear();
                }
            }, CLOUD_RETRY_INITIAL_MS);
        }
    }
    async _createStationDevice(stationId, stationName) {
        if (this.stationDevices.has(stationId)) {
            return;
        }
        const deviceId = `station-${stationId}`;
        await this.adapter.extendObjectAsync(deviceId, {
            type: "device",
            common: {
                name: stationName,
                statusStates: { onlineId: "info.stationStatus" },
                icon: "hoymiles.png",
            },
            native: { stationId },
        });
        await Promise.all(stationChannels.map(ch => this.adapter.setObjectNotExistsAsync(`${deviceId}.${ch.id}`, {
            type: "channel",
            common: { name: ch.name },
            native: {},
        })));
        await Promise.all(stationStates.map(def => {
            const common = {
                name: def.name,
                type: def.type,
                role: def.role,
                unit: def.unit || "",
                read: true,
                write: false,
                def: def.type === "boolean" ? false : def.type === "number" ? 0 : "",
                states: def.states,
            };
            return this.adapter.extendObjectAsync(`${deviceId}.${def.id}`, {
                type: "state",
                common: common,
                native: {},
            });
        }));
        this.stationDevices.add(stationId);
        this.adapter.log.info(`Station device created: ${stationName} (${deviceId})`);
    }
}
export default CloudManager;
//# sourceMappingURL=cloudManager.js.map