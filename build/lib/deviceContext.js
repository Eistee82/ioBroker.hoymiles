import DtuConnection from "./dtuConnection.js";
import CloudRelay from "./cloudRelay.js";
import { formatDtuVersion, formatSwVersion, formatInvVersion, } from "./protobufHandler.js";
import { executeCommand, executeCloudCommand } from "./commandHandler.js";
import Encryption from "./encryption.js";
import { channels, states } from "./stateDefinitions.js";
import { getAlarmDescription } from "./alarmCodes.js";
import { decodeGridProfile, byteSwap16 } from "./gridProfile.js";
import { INFO_FALLBACK_TIMEOUT_MS, SCALE_POWER, CLOUD_DEV_TYPE_DTU } from "./constants.js";
import { whToKwh } from "./convert.js";
import { errorMessage, safeJsonStringify, unixSeconds } from "./utils.js";
import { inverterIcon } from "./deviceIcons.js";
export const MAX_PV_PORTS = 12;
const PV_FIELDS_BASE = [
    { suffix: "power", en: "power", de: "Leistung", role: "value.power", unit: "W" },
    { suffix: "voltage", en: "voltage", de: "Spannung", role: "value.voltage", unit: "V" },
    { suffix: "current", en: "current", de: "Strom", role: "value.current", unit: "A" },
];
const PV_FIELDS_LOCAL_ONLY = [
    { suffix: "dailyEnergy", en: "daily energy", de: "Tagesenergie", role: "value.energy", unit: "kWh" },
    { suffix: "totalEnergy", en: "total energy", de: "Gesamtenergie", role: "value.energy", unit: "kWh" },
    { suffix: "errorCode", en: "error code", de: "Fehlercode", role: "value", unit: "" },
];
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
class DeviceContext {
    adapter;
    host;
    enableLocal;
    enableCloud;
    enableCloudRelay;
    dtuSerial;
    deviceId;
    statesCreated;
    get ready() {
        return !!(this.deviceId && this.statesCreated);
    }
    infoReceived;
    connection;
    cloudRelay;
    protobuf;
    encryption;
    encryptionRequired;
    cloudStationId;
    pollTimer;
    pvStatesCreated;
    pvCount;
    burstActive;
    meterStatesCreated;
    histStatesCreated;
    pollCount;
    slowPollEvery;
    cloudServerDomain;
    cloudSendTimeMin;
    cloudRelayInitializing;
    dataInterval;
    inverterSn;
    gridChunks = new Map();
    warnChunks = new Map();
    gridBlob = null;
    gridDtuSn = null;
    gridDevSn = null;
    pendingGridServeTid = null;
    pendingResponse;
    slowPollQueue;
    slowPollIndex;
    slowPollRotations;
    pollBusy;
    consecutivePollErrors;
    infoFallbackTimer;
    pollStartTimer;
    resetButtonTimers = new Set();
    constructor(options) {
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
    async initFromSerial(serial) {
        this.dtuSerial = serial;
        this.deviceId = serial;
        if (!this.adapter.devices.has(serial)) {
            this.adapter.devices.set(serial, this);
        }
        await this.createDeviceAndStates();
        const isConnected = this.connection && this.connection.connected;
        await this.adapter.setStateAsync(`${this.deviceId}.info.connected`, !!isConnected, true);
    }
    connect() {
        if (!this.enableLocal || !this.host) {
            return;
        }
        this.connection = new DtuConnection(this.host, 10081, () => {
            const ts = unixSeconds();
            return this.protobuf.encodeHeartbeat(ts);
        }, this.adapter);
        let lastErrorMsg = "";
        let errorRepeatCount = 0;
        this.connection.on("connected", () => {
            this.adapter.log.info(`[${this.host}] Connected to DTU`);
            lastErrorMsg = "";
            errorRepeatCount = 0;
            this.onConnected().catch(err => this.adapter.log.warn(`[${this.host}] onConnected error: ${errorMessage(err)}`));
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
                    .catch(err => this.adapter.log.warn(`[${this.host}] Failed to set connected state: ${errorMessage(err)}`));
            }
            this.markStatesDisconnected().catch(err => this.adapter.log.warn(`[${this.host}] markStatesDisconnected error: ${errorMessage(err)}`));
            this.updateAdapterConnectionState().catch(err => this.adapter.log.warn(`[${this.host}] updateAdapterConnectionState error: ${errorMessage(err)}`));
            this.adapter.onLocalDisconnected(this);
        });
        this.connection.on("message", (message) => {
            this.handleResponse(message);
        });
        this.connection.on("error", (err) => {
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
    async onConnected() {
        if (this.deviceId) {
            await this.adapter.setStateAsync(`${this.deviceId}.info.connected`, true, true);
        }
        for (const [, cached] of this.stateCache) {
            if (cached.q === DeviceContext.Q_DEVICE_DISCONNECTED) {
                cached.q = 0;
            }
        }
        await this.updateAdapterConnectionState();
        if (this.cloudRelay && this.cloudRelay.paused) {
            this.adapter.log.info(`[${this.deviceId || this.host}] Resuming cloud relay (local connection restored)`);
            this.cloudRelay.resume();
        }
        this.adapter.onLocalConnected(this);
        this.infoReceived = false;
        const ts = unixSeconds();
        this.connection?.send(this.protobuf.encodeInfoRequest(ts)).catch(e => {
            this.adapter.log.debug(`[${this.deviceId}] InfoRequest send failed: ${errorMessage(e)}`);
        });
        this.infoFallbackTimer = this.adapter.setTimeout(() => {
            this.infoFallbackTimer = undefined;
            if (!this.infoReceived && this.connection?.connected) {
                this.adapter.log.warn(`[${this.host}] No InfoData received within 10s, starting poll cycle without it`);
                this.startPollCycle();
            }
        }, INFO_FALLBACK_TIMEOUT_MS);
    }
    async createDeviceAndStates() {
        if (this.statesCreated || !this.deviceId) {
            return;
        }
        await this.adapter.extendObjectAsync(this.deviceId, {
            type: "device",
            common: {
                name: `DTU ${this.deviceId}`,
                statusStates: { onlineId: "info.connected" },
                icon: inverterIcon(""),
            },
            native: { host: this.host },
        });
        await this.adapter.extendObjectAsync(`${this.deviceId}.info`, {
            type: "channel",
            common: { name: { en: "Device info", de: "Geräte-Info" } },
            native: {},
        });
        const activeChannels = channels.filter(ch => !(ch.source === "local" && !this.enableLocal) && !(ch.source === "cloud" && !this.enableCloud));
        await Promise.all(activeChannels.map(ch => this.adapter.setObjectNotExistsAsync(`${this.deviceId}.${ch.id}`, {
            type: "channel",
            common: { name: ch.name },
            native: {},
        })));
        const activeStates = states.filter(def => !(def.source === "local" && !this.enableLocal) && !(def.source === "cloud" && !this.enableCloud));
        await Promise.all(activeStates.map(def => {
            const common = {
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
        }));
        await Promise.all(activeStates.map(async (def) => {
            const current = await this.adapter.getStateAsync(`${this.deviceId}.${def.id}`);
            if (!current || current.val === null) {
                const defaultVal = def.type === "boolean" ? false : def.type === "number" ? 0 : "";
                await this.adapter.setStateAsync(`${this.deviceId}.${def.id}`, defaultVal, true);
            }
        }));
        await this.cleanupObsoleteObjects();
        for (const stateId of WRITABLE_STATES) {
            this.adapter.subscribeStates(`${this.deviceId}.${stateId}`);
        }
        this.statesCreated = true;
        this.adapter.log.info(`[${this.deviceId}] Device states created`);
    }
    async cleanupObsoleteObjects() {
        const knownStates = new Set(states.map(d => d.id));
        const knownChannels = new Set(channels.map(c => c.id));
        const isKnown = (rel) => knownStates.has(rel) ||
            knownChannels.has(rel) ||
            /^pv\d+(\.|$)/.test(rel) ||
            rel === "meter" ||
            rel.startsWith("meter.") ||
            rel === "history" ||
            rel.startsWith("history.");
        const prefix = `${this.adapter.namespace}.${this.deviceId}.`;
        try {
            const removed = [];
            for (const kind of ["state", "channel"]) {
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
                this.adapter.log.info(`[${this.deviceId}] Removed ${removed.length} obsolete object(s): ${removed.join(", ")}`);
            }
        }
        catch (e) {
            this.adapter.log.debug(`[${this.deviceId}] Obsolete-object cleanup skipped: ${errorMessage(e)}`);
        }
    }
    async createPvStates(pvCount, cloudOnly = false) {
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
    async createMeterStates() {
        if (!this.deviceId) {
            return;
        }
        this.adapter.log.info(`[${this.deviceId}] Meter detected, creating meter states`);
        await this.adapter.setObjectNotExistsAsync(`${this.deviceId}.meter`, {
            type: "channel",
            common: { name: { en: "Energy meter", de: "Energiezähler" } },
            native: {},
        });
        const m = (id, en, de, role, unit) => ({
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
        await Promise.all(meterDefs.map(def => this.adapter.extendObjectAsync(`${this.deviceId}.${def.id}`, {
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
        })));
    }
    startPollCycle() {
        this.stopPollCycle();
        const seconds = this.dataInterval > 0 ? this.dataInterval : 1;
        const interval = seconds * 1000;
        this.pollCount = 0;
        this.consecutivePollErrors = 0;
        this.slowPollIndex = 0;
        this.slowPollRotations = 0;
        this.pollBusy = false;
        this.slowPollQueue = [
            ts => this.protobuf.encodeGetConfigRequest(ts),
            ts => this.protobuf.encodeAlarmTrigger(ts),
            ts => this.protobuf.encodeMiWarnRequest(ts),
        ];
        this.adapter.log.info(`[${this.deviceId || this.host}] Poll cycle: every ${seconds}s, config/alarms every ${this.slowPollEvery} polls`);
        const onPollError = (err) => {
            this.consecutivePollErrors++;
            this.adapter.log.warn(`[${this.deviceId || this.host}] pollTick error: ${errorMessage(err)}`);
            if (this.consecutivePollErrors >= 5) {
                this.adapter.log.error(`[${this.deviceId || this.host}] 5 consecutive poll errors, stopping poll cycle`);
                this.stopPollCycle();
            }
        };
        this.pollTick().catch(onPollError);
        this.pollTimer = this.adapter.setInterval(() => {
            this.pollTick().catch(onPollError);
        }, interval);
        this.requestGridProfile();
    }
    requestGridProfile() {
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
    handleCloudCommand(cmd) {
        if (!this.protobuf || !this.cloudRelay) {
            return;
        }
        try {
            if (cmd.cmdHigh === 0x23 && cmd.cmdLow === 0x06) {
                this.handleCloudStatusAck(cmd.payload);
                return;
            }
            if (!(cmd.cmdHigh === 0x23 && cmd.cmdLow === 0x05)) {
                this.adapter.log.debug(`[${this.deviceId}] [diag] cloud command 0x${cmd.cmdHigh.toString(16)} 0x${cmd.cmdLow.toString(16)} — not handled`);
                return;
            }
            const ResDTO = this.protobuf.getType("CommandPB", "CommandResDTO");
            const obj = ResDTO.toObject(ResDTO.decode(cmd.payload), { longs: Number, defaults: true });
            const action = Number(obj.action) || 0;
            const tid = Number(obj.tid) || 0;
            this.adapter.log.debug(`[${this.deviceId}] [diag] cloud command action=${action} tid=${tid}`);
            if (action === 41) {
                this.serveGridProfileToCloud(tid);
            }
            else if (action === 4) {
                this.serveVersionToCloud(tid);
            }
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId}] handleCloudCommand error: ${errorMessage(err)}`);
        }
    }
    serveGridProfileToCloud(tid) {
        const relay = this.cloudRelay;
        if (!relay || !this.protobuf || !this.gridBlob || !this.gridDtuSn || !this.gridDevSn) {
            this.adapter.log.debug(`[${this.deviceId}] grid-profile cloud-serve skipped (relay/blob/sn missing)`);
            return;
        }
        const ts = unixSeconds();
        relay.sendFrame(this.protobuf.encodeCloudCommandAck(ts, this.dtuSerial, 41, tid));
        relay.sendFrame(this.protobuf.encodeCloudCommandStatus(ts, this.dtuSerial, 41, tid));
        this.pendingGridServeTid = tid;
        this.adapter.log.debug(`[${this.deviceId}] grid-profile read: ack+status sent, awaiting cloud status-ack (tid=${tid})`);
    }
    handleCloudStatusAck(payload) {
        if (!this.protobuf || this.pendingGridServeTid === null) {
            return;
        }
        const StatusRes = this.protobuf.getType("CommandPB", "CommandStatusResDTO");
        const obj = StatusRes.toObject(StatusRes.decode(payload), { longs: Number, defaults: true });
        const action = Number(obj.action) || 0;
        if (action !== 0 && action !== 41) {
            return;
        }
        const tid = this.pendingGridServeTid;
        this.pendingGridServeTid = null;
        this.sendGridProfileFile(tid);
    }
    sendGridProfileFile(tid) {
        const relay = this.cloudRelay;
        if (!relay || !this.protobuf || !this.gridBlob || !this.gridDtuSn || !this.gridDevSn) {
            this.adapter.log.debug(`[${this.deviceId}] grid-profile file send skipped (relay/blob/sn missing)`);
            return;
        }
        relay.sendFrame(this.protobuf.encodeGridProfileResponse(unixSeconds(), this.gridDtuSn, this.gridDevSn, tid, byteSwap16(this.gridBlob)));
        this.adapter.log.info(`[${this.deviceId}] served grid profile to cloud via relay (tid=${tid})`);
    }
    serveVersionToCloud(tid) {
        const relay = this.cloudRelay;
        if (!relay || !this.protobuf || !this.inverterSn) {
            this.adapter.log.debug(`[${this.deviceId}] version cloud-serve skipped (relay/sn missing)`);
            return;
        }
        const ts = unixSeconds();
        const miSn = Number.parseInt(this.inverterSn, 16);
        relay.sendFrame(this.protobuf.encodeCloudCommandAck(ts, this.dtuSerial, 4, tid));
        relay.sendFrame(this.protobuf.encodeCloudCommandStatus(ts, this.dtuSerial, 4, tid, Number.isFinite(miSn) ? [miSn] : []));
        this.adapter.log.info(`[${this.deviceId}] answered cloud version query (action 4) via relay (tid=${tid})`);
    }
    stopPollCycle() {
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
    sendAndWait(conn, message, timeoutMs = 3000) {
        const cmdHigh = message[2] === 0xa3 ? 0xa2 : message[2];
        const cmdLow = message[3];
        const cmdKey = `${cmdHigh}:${cmdLow}`;
        return new Promise(resolve => {
            let resolved = false;
            const settle = (value) => {
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
    async pollTick() {
        const conn = this.connection;
        if (!conn?.connected || !this.protobuf || this.pollBusy) {
            return;
        }
        this.pollBusy = true;
        try {
            const ts = unixSeconds();
            await this.sendAndWait(conn, this.protobuf.encodeRealDataNewRequest(ts));
            this.consecutivePollErrors = 0;
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
                    if (this.slowPollRotations >= 6 && conn.connected) {
                        this.slowPollRotations = 0;
                        await this.sendAndWait(conn, this.protobuf.encodeInfoRequest(ts));
                    }
                }
            }
            if (this.deviceId) {
                await this.adapter.setStateAsync(`${this.deviceId}.info.lastResponse`, Date.now(), true);
            }
        }
        finally {
            this.pollBusy = false;
        }
    }
    handleResponse(message) {
        try {
            const parsed = this.protobuf.parseResponse(message);
            if (!parsed) {
                this.adapter.log.debug(`[${this.host}] Could not parse response message`);
                return;
            }
            const { cmdHigh, cmdLow, payload } = parsed;
            this.adapter.log.debug(`[${this.host}] Response: cmd=0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}, payload=${payload.length} bytes`);
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
                    }
                    catch (err) {
                        this.adapter.log.warn(`[${this.host}] Decryption failed: ${errorMessage(err)}`);
                        return;
                    }
                }
            }
            const tag = this.deviceId || this.host;
            switch ((cmdHigh << 8) | cmdLow) {
                case 0xa211:
                    this.cloudRelay?.updateRealData(message);
                    this.handleRealData(decryptedPayload).catch(err => this.adapter.log.warn(`[${tag}] handleRealData error: ${errorMessage(err)}`));
                    break;
                case 0xa201:
                    this.handleInfoData(payload).catch(err => this.adapter.log.warn(`[${tag}] handleInfoData error: ${errorMessage(err)}`));
                    break;
                case 0xa209:
                    this.handleConfigData(decryptedPayload).catch(err => this.adapter.log.warn(`[${tag}] handleConfigData error: ${errorMessage(err)}`));
                    break;
                case 0xa204:
                    this.handleAlarmData(decryptedPayload).catch(err => this.adapter.log.warn(`[${tag}] handleAlarmData error: ${errorMessage(err)}`));
                    break;
                case 0xa215:
                    this.handleHistPower(decryptedPayload).catch(err => this.adapter.log.warn(`[${tag}] handleHistPower error: ${errorMessage(err)}`));
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
                    }
                    catch (err) {
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
                    this.handleAutoSearch(decryptedPayload).catch(err => this.adapter.log.warn(`[${tag}] handleAutoSearch error: ${errorMessage(err)}`));
                    break;
                case 0xa207:
                    try {
                        this.handleDevConfigFetch(decryptedPayload);
                    }
                    catch (err) {
                        this.adapter.log.warn(`[${tag}] handleDevConfigFetch error: ${errorMessage(err)}`);
                    }
                    break;
                default:
                    this.adapter.log.debug(`[${this.host}] Unknown command response: 0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}`);
            }
        }
        catch (err) {
            this.adapter.log.warn(`[${this.host}] Error handling response: ${errorMessage(err)}`);
        }
    }
    static Q_GOOD = 0x00;
    static Q_DEVICE_DISCONNECTED = 0x42;
    stateCache = new Map();
    async setState(stateId, value, ack, q = DeviceContext.Q_GOOD) {
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
        }
        else {
            await this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, { val: value, ack, q });
        }
    }
    async setStates(entries, ack, q = DeviceContext.Q_GOOD) {
        if (!this.ready) {
            return;
        }
        const writes = [];
        for (const [stateId, value] of entries) {
            const cached = this.stateCache.get(stateId);
            if (!cached || cached.val !== value || cached.q !== q) {
                this.stateCache.set(stateId, { val: value, q });
                if (q === 0) {
                    writes.push(this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, value, ack));
                }
                else {
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
    static DATA_STATE_PATTERN = /^(grid\.|pv\d+\.|inverter\.(temperature|active|warnCount|warnMessage|activePowerLimit)|meter\.)/;
    async markStatesDisconnected() {
        if (!this.ready) {
            return;
        }
        const writes = [];
        for (const [stateId, cached] of this.stateCache) {
            if (DeviceContext.DATA_STATE_PATTERN.test(stateId) && cached.q !== DeviceContext.Q_DEVICE_DISCONNECTED) {
                cached.q = DeviceContext.Q_DEVICE_DISCONNECTED;
                writes.push(this.adapter.setStateAsync(`${this.deviceId}.${stateId}`, {
                    val: cached.val,
                    ack: true,
                    q: DeviceContext.Q_DEVICE_DISCONNECTED,
                }));
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
    async handleRealData(payload) {
        try {
            const data = this.protobuf.decodeRealDataNew(payload);
            this.adapter.log.debug(`[${this.deviceId || this.host}] RealData: power=${data.dtuPower}W, dailyEnergy=${data.dtuDailyEnergy}, sgs=${data.sgs.length}, pv=${data.pv.length}, meter=${data.meter.length}`);
            await this.applyRealData(data);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding RealData: ${errorMessage(err)}`);
        }
    }
    async applyRealData(data) {
        try {
            const entries = [
                ["info.lastResponse", unixSeconds()],
                ["inverter.active", data.sgs.length > 0 && data.dtuPower > 0],
                ["grid.dailyEnergy", whToKwh(data.dtuDailyEnergy)],
            ];
            if (data.sgs.length > 0) {
                const sgs = data.sgs[0];
                entries.push(["grid.power", sgs.activePower], ["grid.voltage", sgs.voltage], ["grid.current", sgs.current], ["grid.frequency", sgs.frequency], ["grid.reactivePower", sgs.reactivePower], ["grid.powerFactor", sgs.powerFactor], ["inverter.temperature", sgs.temperature], ["inverter.warnCount", sgs.warningNumber], ...(sgs.linkStatus
                    ? [["inverter.linkStatus", sgs.linkStatus]]
                    : []), ["inverter.serialNumber", sgs.serialNumber], ["inverter.activePowerLimit", sgs.powerLimit], ["inverter.modulationIndexSignal", sgs.modulationIndexSignal]);
            }
            for (const pv of data.pv) {
                const pvIndex = pv.portNumber - 1;
                if (pvIndex < 0 || pvIndex >= this.pvCount) {
                    continue;
                }
                const prefix = `pv${pvIndex}`;
                entries.push([`${prefix}.power`, pv.power], [`${prefix}.voltage`, pv.voltage], [`${prefix}.current`, pv.current], [`${prefix}.dailyEnergy`, whToKwh(pv.energyDaily)], [`${prefix}.totalEnergy`, Math.round(pv.energyTotal / 100) / 10], [`${prefix}.errorCode`, pv.errorCode]);
            }
            if (data.meter.length > 0) {
                if (!this.meterStatesCreated) {
                    await this.createMeterStates();
                    this.meterStatesCreated = true;
                }
                const m = data.meter[0];
                entries.push(["meter.totalPower", m.phaseTotalPower], ["meter.phaseAPower", m.phaseAPower], ["meter.phaseBPower", m.phaseBPower], ["meter.phaseCPower", m.phaseCPower], ["meter.powerFactorTotal", m.powerFactorTotal], ["meter.energyTotalExport", m.energyTotalPower], ["meter.energyTotalImport", m.energyTotalConsumed], ["meter.voltagePhaseA", m.voltagePhaseA], ["meter.voltagePhaseB", m.voltagePhaseB], ["meter.voltagePhaseC", m.voltagePhaseC], ["meter.currentPhaseA", m.currentPhaseA], ["meter.currentPhaseB", m.currentPhaseB], ["meter.currentPhaseC", m.currentPhaseC], ["meter.faultCode", m.faultCode]);
            }
            await this.setStates(entries, true);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId || this.host}] Error applying RealData: ${errorMessage(err)}`);
        }
    }
    async handleInfoData(payload) {
        try {
            const info = this.protobuf.decodeInfoData(payload);
            const logLevel = this.deviceId ? "debug" : "info";
            this.adapter.log[logLevel](`[${this.host}] Device info: DTU SN=${info.dtuSn}, devices=${info.deviceNumber}, PVs=${info.pvNumber}`);
            if (!this.deviceId && info.dtuSn) {
                const existing = this.adapter.devices.get(info.dtuSn);
                if (existing && existing !== this) {
                    if (!existing.connection?.connected && this.enableLocal) {
                        this.adapter.log.info(`[${this.host}] Taking over socket-less device context for SN ${info.dtuSn}`);
                        this.cloudStationId = existing.cloudStationId;
                        this.adapter.devices.delete(info.dtuSn);
                    }
                    else {
                        this.adapter.log.warn(`[${this.host}] Duplicate inverter: SN ${info.dtuSn} is already connected via another IP. Disconnecting.`);
                        this.disconnect();
                        return;
                    }
                }
                await this.initFromSerial(info.dtuSn);
                this.adapter.matchLocalDeviceToCloud(this);
            }
            else if (this.deviceId && !this.dtuSerial && info.dtuSn) {
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
        }
        catch (err) {
            this.adapter.log.warn(`[${this.host}] Error decoding InfoData: ${errorMessage(err)}`);
        }
    }
    async updateDtuStates(info) {
        const entries = [["dtu.serialNumber", info.dtuSn]];
        if (info.dtuInfo) {
            const di = info.dtuInfo;
            entries.push(["dtu.swVersion", formatDtuVersion(di.swVersion)], ["dtu.hwVersion", formatDtuVersion(di.hwVersion).replace("V", "H")], ["dtu.rssi", di.signalStrength], ["dtu.connState", di.errorCode], ["dtu.stepTime", di.dtuStepTime], ["dtu.accessModel", di.accessModel], ["dtu.communicationTime", di.communicationTime * 1000], ["dtu.wifiVersion", di.wifiVersion]);
        }
        await this.setStates(entries, true);
    }
    setupEncryption(info) {
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
            }
            else {
                this.adapter.log.warn(`[${this.deviceId}] Encryption required but no enc_rand received`);
            }
        }
        else {
            this.adapter.log.debug(`[${this.deviceId}] DTU does not require encryption`);
            this.encryptionRequired = false;
        }
    }
    async updateInverterVersions(info) {
        if (info.pvInfo.length > 0) {
            const pv = info.pvInfo[0];
            this.inverterSn = pv.sn || this.inverterSn;
            await this.setStates([
                ["inverter.serialNumber", pv.sn],
                ["inverter.hwVersion", formatInvVersion(pv.bootVersion).replace("V", "H")],
                ["inverter.swVersion", formatSwVersion(pv.gridVersion)],
            ], true);
        }
    }
    async initCloudRelay(dtuSn) {
        if (this.enableCloudRelay && this.protobuf && dtuSn && !this.cloudRelay && !this.cloudRelayInitializing) {
            const serverState = await this.adapter.getStateAsync(`${this.deviceId}.config.serverDomain`);
            const portState = await this.adapter.getStateAsync(`${this.deviceId}.config.serverPort`);
            const serverDomain = serverState?.val || "";
            const serverPort = portState?.val || 10081;
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
                this.cloudRelay.on("error", (err) => {
                    this.adapter.log.debug(`[${this.deviceId}] Cloud relay: ${err.message}`);
                });
                this.cloudRelay.on("heartbeatSent", (seq) => {
                    this.adapter.log.debug(`[${this.deviceId}] Cloud relay heartbeat sent (seq=${seq})`);
                });
                this.cloudRelay.on("dataReceived", (bytes) => {
                    this.adapter.log.debug(`[${this.deviceId}] Cloud relay received ${bytes} bytes`);
                });
                this.cloudRelay.on("dataSent", () => {
                    this.adapter.log.debug(`[${this.deviceId}] Cloud relay sent data, triggering cloud poll`);
                    void this.adapter.onRelayDataSent();
                });
                this.cloudRelay.on("command", (cmd) => this.handleCloudCommand(cmd));
                this.cloudRelay.connect();
            }
        }
        else if (this.cloudRelay && this.protobuf && dtuSn) {
            this.cloudRelay.configure(this.protobuf, dtuSn);
        }
    }
    startPollingIfReady() {
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
    async handleConfigData(payload) {
        try {
            const config = this.protobuf.decodeGetConfig(payload);
            this.adapter.log.debug(`[${this.deviceId || this.host}] Config: server=${config.serverDomain}:${config.serverPort}, sendTime=${config.serverSendTime}min`);
            await this.setStates([
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
            ], true);
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
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding Config: ${errorMessage(err)}`);
        }
    }
    static normalizeAlarm(e) {
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
    async handleAlarmData(payload) {
        try {
            const data = this.protobuf.decodeAlarmData(payload);
            await this.finalizeAlarms(data.alarms.map(DeviceContext.normalizeAlarm));
            return;
        }
        catch {
        }
        let data;
        try {
            data = this.protobuf.decodeWarnData(payload);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding AlarmData/WarnData: ${errorMessage(err)}`);
            return;
        }
        const total = data.packageNub;
        const now = data.packageNow;
        const pageAlarms = data.warnings.map(DeviceContext.normalizeAlarm);
        if (total <= 1) {
            this.warnChunks.clear();
            await this.finalizeAlarms(pageAlarms);
            return;
        }
        if (now === 0) {
            this.warnChunks.clear();
        }
        this.warnChunks.set(now, pageAlarms);
        this.adapter.log.debug(`[${this.deviceId || this.host}] Warn list package ${now + 1}/${total} (${pageAlarms.length} entries)`);
        if (now + 1 < total) {
            this.connection
                ?.send(this.protobuf.encodeWarnDataRequest(unixSeconds(), now + 1))
                .catch(e => this.adapter.log.debug(`[${this.deviceId || this.host}] warn next-pkg failed: ${errorMessage(e)}`));
            return;
        }
        const assembled = [...this.warnChunks.keys()].sort((a, b) => a - b).flatMap(k => this.warnChunks.get(k));
        this.warnChunks.clear();
        await this.finalizeAlarms(assembled);
    }
    async finalizeAlarms(alarms) {
        if (alarms.length === 0) {
            this.adapter.log.debug(`[${this.deviceId || this.host}] Alarm list query returned no active alarms`);
        }
        else {
            this.adapter.log.debug(`[${this.deviceId || this.host}] Alarms received: ${alarms.length} entries`);
        }
        const activeAlarms = alarms.filter(a => a.active);
        const lang = this.adapter.language || "en";
        const latestActive = activeAlarms[activeAlarms.length - 1];
        const entries = [
            ["alarms.count", alarms.length],
            ["alarms.activeCount", activeAlarms.length],
            ["alarms.hasActive", activeAlarms.length > 0],
            ["alarms.json", safeJsonStringify(alarms)],
            ["inverter.warnMessage", latestActive ? getAlarmDescription(latestActive.code, lang) : ""],
        ];
        if (alarms.length > 0) {
            const last = alarms[alarms.length - 1];
            entries.push(["alarms.lastCode", last.code], ["alarms.lastStartTime", last.startTime], ["alarms.lastEndTime", last.endTime], ["alarms.lastMessage", `${getAlarmDescription(last.code, lang)} (Code ${last.code})`], ["alarms.lastData1", last.data1], ["alarms.lastData2", last.data2]);
        }
        await this.setStates(entries, true);
    }
    async handleHistPower(payload) {
        if (!this.protobuf || !this.deviceId) {
            return;
        }
        try {
            const data = this.protobuf.decodeHistPower(payload);
            this.adapter.log.debug(`[${this.deviceId}] HistPower: ${data.powerArray.length} entries, daily=${data.dailyEnergy}Wh`);
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
                        type: "string",
                        role: "json",
                        unit: "",
                    },
                    {
                        id: "history.dailyEnergy",
                        name: { en: "Daily energy", de: "Tagesenergie" },
                        type: "number",
                        role: "value.energy",
                        unit: "Wh",
                    },
                    {
                        id: "history.totalEnergy",
                        name: { en: "Total energy", de: "Gesamtenergie" },
                        type: "number",
                        role: "value.energy",
                        unit: "kWh",
                    },
                    {
                        id: "history.stepTime",
                        name: { en: "Step time", de: "Schrittzeit" },
                        type: "number",
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
            await this.setState("history.totalEnergy", Math.round(data.totalEnergy / 100) / 10, true);
            await this.setState("history.stepTime", data.stepTime, true);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId}] Error decoding HistPower: ${errorMessage(err)}`);
        }
    }
    async handleAutoSearch(payload) {
        if (!this.protobuf || !this.deviceId) {
            return;
        }
        try {
            const ReqDTO = this.protobuf.getType("AutoSearch", "AutoSearchReqDTO");
            const msg = ReqDTO.decode(payload);
            const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
            const serialNumbers = obj.miSerialNumbers || [];
            const hexSerials = serialNumbers.map(sn => (Number(sn) || 0).toString(16).toUpperCase());
            this.adapter.log.info(`[${this.deviceId}] AutoSearch found ${hexSerials.length} inverter(s): ${hexSerials.join(", ")}`);
            await this.setState("dtu.searchResult", JSON.stringify(hexSerials), true);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId}] Error decoding AutoSearch: ${errorMessage(err)}`);
        }
    }
    handleDevConfigFetch(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const ReqDTO = this.protobuf.getType("DevConfig", "DevConfigFetchReqDTO");
            const obj = ReqDTO.toObject(ReqDTO.decode(payload), { longs: Number, defaults: true });
            const data = obj.data;
            const chunk = data && data.length ? Buffer.from(data) : Buffer.alloc(0);
            const pkg = Number(obj.currentPackage) || 0;
            const total = Math.max(Number(obj.totalPackages) || 1, 1);
            this.gridChunks.set(pkg, chunk);
            this.adapter.log.debug(`[${this.deviceId || this.host}] grid profile package ${pkg + 1}/${total} (${chunk.length} bytes)`);
            if (pkg + 1 < total) {
                this.connection
                    ?.send(this.protobuf.encodeDevConfigFetch(unixSeconds(), this.dtuSerial, this.inverterSn, pkg + 1))
                    .catch(e => this.adapter.log.debug(`[${this.deviceId}] grid profile next-pkg failed: ${errorMessage(e)}`));
                return;
            }
            const assembled = Buffer.concat([...this.gridChunks.keys()].sort((a, b) => a - b).map(k => this.gridChunks.get(k)));
            this.gridChunks.clear();
            if (assembled.length < 4) {
                return;
            }
            const blob = assembled.subarray(0, assembled.length - 2);
            this.gridBlob = blob;
            const dtuSnBytes = obj.dtuSn;
            const devSnBytes = obj.devSn;
            this.gridDtuSn = dtuSnBytes && dtuSnBytes.length ? Buffer.from(dtuSnBytes) : null;
            this.gridDevSn = devSnBytes && devSnBytes.length ? Buffer.from(devSnBytes) : null;
            this.adapter.log.debug(`[${this.deviceId || this.host}] [diag] grid profile blob: ${blob.toString("hex")}`);
            this.adapter.log.debug(`[${this.deviceId || this.host}] [diag] grid profile sns: dtu=${this.gridDtuSn?.toString("hex") ?? "-"} dev=${this.gridDevSn?.toString("hex") ?? "-"}`);
            const decoded = decodeGridProfile(blob);
            const entries = [["gridProfile.standard", decoded.standard]];
            for (const [key, val] of Object.entries(decoded.values)) {
                entries.push([`gridProfile.${key}`, val]);
            }
            void this.setStates(entries, true);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding DevConfig: ${errorMessage(err)}`);
        }
    }
    handleNetworkInfo(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            this.protobuf.getType("NetworkInfo", "NetworkInfoReqDTO").decode(payload);
            this.adapter.log.debug(`[${this.deviceId || this.host}] NetworkInfo response received`);
        }
        catch (err) {
            this.adapter.log.warn(`[${this.deviceId || this.host}] Error decoding NetworkInfo: ${errorMessage(err)}`);
        }
    }
    handleCommandResponse(payload) {
        try {
            const ReqDTO = this.protobuf.getType("CommandPB", "CommandReqDTO");
            const msg = ReqDTO.decode(payload);
            const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
            const errCode = obj.errCode;
            this.adapter.log.debug(`[${this.deviceId || this.host}] Command response: action=${String(obj.action)}, error=${String(errCode)}`);
            if (errCode !== undefined && errCode !== null && errCode !== 0) {
                this.adapter.log.warn(`[${this.deviceId || this.host}] Command failed with error code: ${String(errCode)}`);
            }
            if (obj.action === 50 && errCode === 0 && (obj.packageNow === 0 || obj.packageNow === undefined)) {
                this.adapter.log.debug(`[${this.deviceId || this.host}] No active alarms`);
                this.setStates([
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
                ], true).catch(err => this.adapter.log.warn(`[${this.deviceId || this.host}] setStates error: ${errorMessage(err)}`));
            }
        }
        catch (err) {
            this.adapter.log.debug(`[${this.deviceId || this.host}] Error decoding command response: ${errorMessage(err)}`);
        }
    }
    async handleStateChange(stateId, state) {
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
        if (this.enableCloud && this.dtuSerial) {
            const handled = await executeCloudCommand(stateId, state, {
                deviceId: this.deviceId,
                log: this.adapter.log,
                send: (action, devType) => {
                    const devSn = devType === CLOUD_DEV_TYPE_DTU ? this.dtuSerial : this.inverterSn;
                    if (!devSn) {
                        return Promise.reject(new Error("inverter serial not known yet (device is still being discovered)"));
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
    setCloudInverterSn(sn) {
        if (sn && !this.inverterSn) {
            this.inverterSn = sn;
        }
    }
    scheduleButtonReset(id) {
        const handle = this.adapter.setTimeout(() => {
            this.resetButtonTimers.delete(handle);
            this.setState(id, false, true).catch(err => this.adapter.log.warn(`[${this.deviceId}] resetButton error: ${errorMessage(err)}`));
        }, 1000);
        if (handle) {
            this.resetButtonTimers.add(handle);
        }
    }
    async updateAdapterConnectionState() {
        await this.adapter.updateConnectionState();
    }
    disconnect() {
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
        if (this.deviceId) {
            for (const stateId of WRITABLE_STATES) {
                this.adapter.unsubscribeStates(`${this.deviceId}.${stateId}`);
            }
        }
    }
}
export default DeviceContext;
export { WRITABLE_STATES };
//# sourceMappingURL=deviceContext.js.map