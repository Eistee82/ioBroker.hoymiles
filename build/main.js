"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const dtuConnection_1 = __importDefault(require("./lib/dtuConnection"));
const cloudRelay_1 = __importDefault(require("./lib/cloudRelay"));
const protobufHandler_1 = require("./lib/protobufHandler");
const encryption_1 = __importDefault(require("./lib/encryption"));
const cloudConnection_1 = __importDefault(require("./lib/cloudConnection"));
const stateDefinitions_1 = require("./lib/stateDefinitions");
const alarmCodes_1 = require("./lib/alarmCodes");
class Hoymiles extends utils.Adapter {
    connection;
    cloudRelay;
    protobuf;
    encryption;
    encryptionRequired;
    cloud;
    cloudPollTimer;
    cloudStationId;
    pollTimer;
    lastSgsData;
    pvStatesCreated;
    meterStatesCreated;
    pollCount;
    slowPollEvery;
    infoPollCount;
    cloudServerDomain;
    cloudSendTimeMin;
    constructor(options = {}) {
        super({ ...options, name: "hoymiles" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.connection = null;
        this.cloudRelay = null;
        this.protobuf = null;
        this.encryption = null;
        this.encryptionRequired = false;
        this.cloud = null;
        this.cloudPollTimer = undefined;
        this.cloudStationId = null;
        this.pollTimer = undefined;
        this.lastSgsData = null;
        this.pvStatesCreated = false;
        this.meterStatesCreated = false;
        this.pollCount = 0;
        this.slowPollEvery = 6;
        this.infoPollCount = 0;
        this.cloudServerDomain = "";
        this.cloudSendTimeMin = 0;
    }
    async onReady() {
        const enableLocal = this.config.enableLocal !== false;
        const enableCloud = !!this.config.enableCloud;
        if (!enableLocal && !enableCloud) {
            this.log.error("Neither local nor cloud connection is enabled. Please enable at least one in the adapter settings.");
            return;
        }
        // Load protobuf definitions (needed for local mode)
        if (enableLocal) {
            this.protobuf = new protobufHandler_1.ProtobufHandler();
            try {
                await this.protobuf.loadProtos();
                this.log.info("Protobuf definitions loaded successfully");
            }
            catch (err) {
                this.log.error(`Failed to load protobuf definitions: ${err.message}`);
                return;
            }
        }
        // Create state objects (only for active modes)
        await this.createStateObjects(enableLocal, enableCloud);
        // Subscribe to writable states
        this.subscribeStates("inverter.powerLimit");
        this.subscribeStates("inverter.active");
        this.subscribeStates("inverter.reboot");
        this.subscribeStates("inverter.powerFactorLimit");
        this.subscribeStates("inverter.reactivePowerLimit");
        this.subscribeStates("inverter.cleanWarnings");
        this.subscribeStates("inverter.cleanGroundingFault");
        this.subscribeStates("inverter.lock");
        this.subscribeStates("config.zeroExportEnable");
        this.subscribeStates("config.serverSendTime");
        this.subscribeStates("dtu.reboot");
        // --- Local TCP connection (persistent + cloud relay) ---
        if (enableLocal) {
            const host = this.config.host;
            if (!host) {
                this.log.error("Local connection enabled but no DTU host configured. Use the search button in adapter settings.");
            }
            else {
                this.log.info(`Starting local connection to DTU at ${host}:10081`);
                this.connection = new dtuConnection_1.default(host, 10081, () => {
                    const ts = Math.floor(Date.now() / 1000);
                    return this.protobuf.encodeHeartbeat(ts);
                });
                this.connection.on("connected", () => {
                    this.log.info("Connected to DTU");
                    void this.updateConnectionState();
                    // Request device info immediately
                    if (this.protobuf) {
                        const ts = Math.floor(Date.now() / 1000);
                        void this.connection.send(this.protobuf.encodeInfoRequest(ts));
                    }
                    if (this.protobuf) {
                        this.setTimeout(() => {
                            if (this.protobuf && this.connection?.connected) {
                                this.log.info("Enabling performance data mode");
                                const ts = Math.floor(Date.now() / 1000);
                                void this.connection.send(this.protobuf.encodePerformanceDataMode(ts));
                            }
                        }, 2000);
                    }
                    this.setTimeout(() => this.startPollCycle(), 3000);
                });
                this.connection.on("disconnected", () => {
                    this.log.warn("Disconnected from DTU");
                    void this.updateConnectionState();
                    this.stopPollCycle();
                });
                this.connection.on("message", (message) => {
                    this.handleResponse(message);
                });
                this.connection.on("error", (err) => {
                    this.log.warn(`DTU: ${err.message}`);
                });
                this.connection.on("idle", () => {
                    this.log.warn("No data from DTU for 5 minutes, reconnecting...");
                });
                this.connection.connect();
            }
        }
        // --- Cloud connection ---
        if (enableCloud) {
            const cloudUser = this.config.cloudUser;
            const cloudPassword = this.config.cloudPassword;
            if (!cloudUser || !cloudPassword) {
                this.log.error("Cloud connection enabled but credentials not configured.");
            }
            else {
                this.log.info("Starting cloud connection to Hoymiles S-Miles API");
                this.cloud = new cloudConnection_1.default(cloudUser, cloudPassword);
                try {
                    await this.cloud.login();
                    this.log.info("Cloud login successful");
                    await this.setStateAsync("info.cloudConnected", true, true);
                    await this.updateConnectionState();
                    // Get station list and match by DTU serial number
                    const stationList = await this.cloud.getStationList();
                    if (stationList.length === 0) {
                        this.log.error("No stations found in cloud account");
                    }
                    else {
                        let matchedStation = stationList[0]; // fallback: first station
                        if (stationList.length > 1) {
                            // Priority 1: DTU SN from config
                            // Priority 2: DTU SN from local connection
                            const configDtuSn = this.config.cloudDtuSerial;
                            const localDtuSn = await this.getStateAsync("dtu.serialNumber");
                            const dtuSn = configDtuSn || localDtuSn?.val;
                            if (dtuSn) {
                                this.log.info(`Matching cloud station by DTU SN: ${dtuSn}`);
                                for (const station of stationList) {
                                    try {
                                        const devices = await this.cloud.getDeviceTree(station.id);
                                        const found = devices.some(d => d.sn === dtuSn || d.dtu_sn === dtuSn);
                                        if (found) {
                                            matchedStation = station;
                                            this.log.info(`Matched: ${station.name} (ID: ${station.id})`);
                                            break;
                                        }
                                    }
                                    catch {
                                        // ignore errors, try next station
                                    }
                                }
                            }
                            else {
                                this.log.warn("Multiple stations found but no DTU serial configured. Using first station. " +
                                    "Set cloudDtuSerial in config to select the correct one.");
                            }
                        }
                        this.cloudStationId = matchedStation.id;
                        await this.setStateAsync("info.stationName", matchedStation.name, true);
                        await this.setStateAsync("info.stationId", this.cloudStationId, true);
                        this.log.info(`Cloud station: ${matchedStation.name} (ID: ${this.cloudStationId})`);
                        // Initial cloud data fetch + start recurring poll chain
                        await this.pollCloudData();
                        this.scheduleCloudPoll();
                    }
                }
                catch (err) {
                    this.log.error(`Cloud login failed: ${err.message}`);
                    await this.setStateAsync("info.cloudConnected", false, true);
                    await this.updateConnectionState();
                }
            }
        }
    }
    async updateConnectionState() {
        const localOk = this.connection && this.connection.connected;
        const cloudOk = this.cloud && this.cloud.token;
        await this.setStateAsync("info.connection", !!(localOk || cloudOk), true);
    }
    scheduleCloudPoll() {
        // Determine interval based on mode:
        // 1. Local + relay active: sendTime from DTU config + 30s buffer
        // 2. Local + no relay: DTU uploads itself at sendTime + 30s buffer
        // 3. Cloud only (no local): fixed 300s (5 min default)
        const enableLocal = this.config.enableLocal !== false;
        let intervalMs;
        if (enableLocal && this.cloudSendTimeMin > 0) {
            // We know DTU's sendTime — poll 30s after data should arrive in cloud
            intervalMs = this.cloudSendTimeMin * 60 * 1000 + 30000;
        }
        else {
            // No local connection or unknown sendTime — default 5 min
            intervalMs = 300000;
        }
        this.cloudPollTimer = this.setTimeout(async () => {
            await this.pollCloudData();
            this.scheduleCloudPoll();
        }, intervalMs);
    }
    async createStateObjects(enableLocal, enableCloud) {
        // Create channels (only for active sources)
        for (const ch of stateDefinitions_1.channels) {
            if (ch.id === "info") {
                continue;
            }
            if (ch.source === "local" && !enableLocal) {
                continue;
            }
            if (ch.source === "cloud" && !enableCloud) {
                continue;
            }
            await this.setObjectNotExistsAsync(ch.id, {
                type: "channel",
                common: { name: ch.name },
                native: {},
            });
        }
        // Create or update states (only for active sources)
        for (const def of stateDefinitions_1.states) {
            if (def.id === "info.connection") {
                continue;
            }
            if (def.source === "local" && !enableLocal) {
                continue;
            }
            if (def.source === "cloud" && !enableCloud) {
                continue;
            }
            const common = {
                name: def.name,
                type: def.type,
                role: def.role,
                unit: def.unit || "",
                read: true,
                write: def.write || false,
                min: def.min,
                max: def.max,
            };
            if (def.states) {
                common.states = def.states;
            }
            await this.extendObjectAsync(def.id, {
                type: "state",
                common: common,
                native: {},
            });
            // Initialize button/switch states with false if they have no value yet
            if (def.write && def.type === "boolean") {
                const current = await this.getStateAsync(def.id);
                if (!current || current.val === null) {
                    await this.setStateAsync(def.id, false, true);
                }
            }
        }
    }
    /**
     * Create PV channel and states dynamically based on pvNumber from DTU info.
     *
     * @param pvCount - Number of PV inputs reported by DTU
     */
    async createPvStates(pvCount) {
        for (let i = 0; i < pvCount; i++) {
            const ch = `pv${i}`;
            await this.extendObjectAsync(ch, {
                type: "channel",
                common: { name: { en: `PV input ${i}`, de: `PV-Eingang ${i}` } },
                native: {},
            });
            const pvFields = [
                { suffix: "power", en: "power", de: "Leistung", role: "value.power", unit: "W" },
                { suffix: "voltage", en: "voltage", de: "Spannung", role: "value.voltage", unit: "V" },
                { suffix: "current", en: "current", de: "Strom", role: "value.current", unit: "A" },
                { suffix: "dailyEnergy", en: "daily energy", de: "Tagesenergie", role: "value.energy", unit: "kWh" },
                { suffix: "totalEnergy", en: "total energy", de: "Gesamtenergie", role: "value.energy", unit: "kWh" },
            ];
            for (const f of pvFields) {
                await this.extendObjectAsync(`${ch}.${f.suffix}`, {
                    type: "state",
                    common: {
                        name: { en: `PV${i} ${f.en}`, de: `PV${i} ${f.de}` },
                        type: "number",
                        role: f.role,
                        unit: f.unit,
                        read: true,
                        write: false,
                    },
                    native: {},
                });
            }
        }
    }
    async createMeterStates() {
        this.log.info("Meter detected, creating meter states");
        await this.setObjectNotExistsAsync("meter", {
            type: "channel",
            common: { name: { en: "Energy meter", de: "Energiezähler" } },
            native: {},
        });
        const meterDefs = [
            {
                id: "meter.totalPower",
                name: { en: "Total power", de: "Gesamtleistung" },
                role: "value.power",
                unit: "W",
            },
            {
                id: "meter.phaseAPower",
                name: { en: "Phase A power", de: "Phase A Leistung" },
                role: "value.power",
                unit: "W",
            },
            {
                id: "meter.phaseBPower",
                name: { en: "Phase B power", de: "Phase B Leistung" },
                role: "value.power",
                unit: "W",
            },
            {
                id: "meter.phaseCPower",
                name: { en: "Phase C power", de: "Phase C Leistung" },
                role: "value.power",
                unit: "W",
            },
            {
                id: "meter.powerFactorTotal",
                name: { en: "Power factor total", de: "Leistungsfaktor gesamt" },
                role: "value",
                unit: "",
            },
            {
                id: "meter.energyTotalExport",
                name: { en: "Total energy export", de: "Gesamtenergie Export" },
                role: "value.energy",
                unit: "kWh",
            },
            {
                id: "meter.energyTotalImport",
                name: { en: "Total energy import", de: "Gesamtenergie Import" },
                role: "value.energy",
                unit: "kWh",
            },
            {
                id: "meter.voltagePhaseA",
                name: { en: "Voltage phase A", de: "Spannung Phase A" },
                role: "value.voltage",
                unit: "V",
            },
            {
                id: "meter.voltagePhaseB",
                name: { en: "Voltage phase B", de: "Spannung Phase B" },
                role: "value.voltage",
                unit: "V",
            },
            {
                id: "meter.voltagePhaseC",
                name: { en: "Voltage phase C", de: "Spannung Phase C" },
                role: "value.voltage",
                unit: "V",
            },
            {
                id: "meter.currentPhaseA",
                name: { en: "Current phase A", de: "Strom Phase A" },
                role: "value.current",
                unit: "A",
            },
            {
                id: "meter.currentPhaseB",
                name: { en: "Current phase B", de: "Strom Phase B" },
                role: "value.current",
                unit: "A",
            },
            {
                id: "meter.currentPhaseC",
                name: { en: "Current phase C", de: "Strom Phase C" },
                role: "value.current",
                unit: "A",
            },
            { id: "meter.faultCode", name: { en: "Fault code", de: "Fehlercode" }, role: "value", unit: "" },
        ];
        for (const def of meterDefs) {
            await this.extendObjectAsync(def.id, {
                type: "state",
                common: { name: def.name, type: "number", role: def.role, unit: def.unit, read: true, write: false },
                native: {},
            });
        }
    }
    /**
     * Start slow poll timer for config/alarms/info.
     * Persistent connection with active polling.
     * Cloud relay forwards RealData to the Hoymiles cloud on behalf of the DTU.
     */
    startPollCycle() {
        this.stopPollCycle();
        const raw = this.config.dataInterval;
        const seconds = raw != null ? Number(raw) : 5;
        const interval = seconds > 0 ? seconds * 1000 : 1000; // 0 = fastest (1s)
        this.slowPollEvery = Number(this.config.slowPollFactor) || 6;
        this.pollCount = 0;
        this.infoPollCount = 0;
        this.log.info(`Poll cycle: every ${interval / 1000}s, config/alarms every ${this.slowPollEvery} polls`);
        void this.pollTick();
        this.pollTimer = this.setInterval(() => {
            void this.pollTick();
        }, interval);
    }
    stopPollCycle() {
        if (this.pollTimer) {
            this.clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    async pollTick() {
        if (!this.connection?.connected || !this.protobuf) {
            return;
        }
        const ts = Math.floor(Date.now() / 1000);
        await this.connection.send(this.protobuf.encodeRealDataNewRequest(ts));
        this.pollCount++;
        if (this.pollCount >= this.slowPollEvery) {
            this.pollCount = 0;
            await this.connection.send(this.protobuf.encodeGetConfigRequest(ts));
            await this.connection.send(this.protobuf.encodeAlarmTrigger(ts));
            await this.connection.send(this.protobuf.encodeMiWarnRequest(ts));
            this.infoPollCount++;
            if (this.infoPollCount >= 6) {
                this.infoPollCount = 0;
                await this.connection.send(this.protobuf.encodeInfoRequest(ts));
            }
        }
        await this.setStateAsync("info.lastResponse", Date.now(), true);
    }
    handleResponse(message) {
        if (!this.protobuf) {
            return;
        }
        try {
            const parsed = this.protobuf.parseResponse(message);
            if (!parsed) {
                this.log.debug("Could not parse response message");
                return;
            }
            const { cmdHigh, cmdLow, payload } = parsed;
            this.log.debug(`Response: cmd=0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}, payload=${payload.length} bytes`);
            // Extract msgId and seqNum for encryption
            const msgId = (message[2] << 8) | message[3];
            const seqNum = (message[4] << 8) | message[5];
            // Decrypt if needed (Info response is never encrypted)
            let decryptedPayload = payload;
            if (this.encryptionRequired && this.encryption) {
                if (!(cmdHigh === 0xa2 && cmdLow === 0x01)) {
                    try {
                        decryptedPayload = this.encryption.decrypt(payload, msgId, seqNum);
                    }
                    catch (err) {
                        this.log.warn(`Decryption failed: ${err.message}`);
                        return;
                    }
                }
            }
            // DTU responses use 0xa2 prefix (App->DTU requests use 0xa3)
            if (cmdHigh === 0xa2 && cmdLow === 0x11) {
                // RealDataNew — process locally AND update cloud relay with latest data
                if (this.cloudRelay) {
                    this.cloudRelay.updateRealData(message);
                }
                void this.handleRealData(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x01) {
                // AppInfoData response
                void this.handleInfoData(payload); // Always unencrypted
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x09) {
                // GetConfig response
                void this.handleConfigData(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x04) {
                // AlarmData / WarnData response
                void this.handleAlarmData(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x15) {
                // HistPower response
                void this.handleHistPower(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x10) {
                // SetConfig response
                this.log.info("SetConfig response received");
            }
            else if ((cmdHigh === 0xa2 && cmdLow === 0x05) || (cmdHigh === 0x23 && cmdLow === 0x05)) {
                // Command response
                this.handleCommandResponse(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x02) {
                // Heartbeat response (idle keepalive acknowledged)
                this.log.debug("Heartbeat response received");
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x14) {
                // NetworkInfo response
                void this.handleNetworkInfo(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x06) {
                // CommandStatus response
                this.log.debug("CommandStatus response received");
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x16) {
                // HistEnergy response
                this.log.debug(`HistEnergy response: ${decryptedPayload.length} bytes`);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x13) {
                // AutoSearch response
                void this.handleAutoSearch(decryptedPayload);
            }
            else if (cmdHigh === 0xa2 && cmdLow === 0x07) {
                // DevConfigFetch response
                void this.handleDevConfigFetch(decryptedPayload);
            }
            else {
                this.log.debug(`Unknown command response: 0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}`);
            }
        }
        catch (err) {
            this.log.warn(`Error handling response: ${err.message}`);
        }
    }
    async handleRealData(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const data = this.protobuf.decodeRealDataNew(payload);
            this.log.debug(`RealData: power=${data.dtuPower}W, dailyEnergy=${data.dtuDailyEnergy}, sgs=${data.sgs.length}, pv=${data.pv.length}, meter=${data.meter.length}`);
            await this.setStateAsync("info.lastResponse", Math.floor(Date.now() / 1000), true);
            // Inverter active status: active when producing power
            await this.setStateAsync("inverter.active", data.sgs.length > 0 && data.dtuPower > 0, true);
            // Grid data (from first SGSMO entry)
            if (data.sgs.length > 0) {
                const sgs = data.sgs[0];
                this.lastSgsData = sgs;
                await this.setStateAsync("grid.power", sgs.activePower, true);
                await this.setStateAsync("grid.voltage", sgs.voltage, true);
                await this.setStateAsync("grid.current", sgs.current, true);
                await this.setStateAsync("grid.frequency", sgs.frequency, true);
                await this.setStateAsync("grid.reactivePower", sgs.reactivePower, true);
                await this.setStateAsync("grid.powerFactor", sgs.powerFactor, true);
                await this.setStateAsync("inverter.temperature", sgs.temperature, true);
                await this.setStateAsync("inverter.warnCount", sgs.warningNumber, true);
                await this.setStateAsync("inverter.warnMessage", sgs.warningNumber > 0 ? (0, alarmCodes_1.getAlarmDescription)(sgs.warningNumber, "en") : "", true);
                await this.setStateAsync("inverter.linkStatus", sgs.linkStatus, true);
                await this.setStateAsync("inverter.serialNumber", sgs.serialNumber, true);
                await this.setStateAsync("inverter.activePowerLimit", sgs.powerLimit, true);
            }
            // PV data (DTU uses port 1,2,3,4 → map to pv0,pv1,pv2,pv3)
            for (const pv of data.pv) {
                const pvIndex = pv.portNumber - 1;
                if (pvIndex < 0 || pvIndex > 3) {
                    continue;
                }
                const prefix = `pv${pvIndex}`;
                await this.setStateAsync(`${prefix}.power`, pv.power, true);
                await this.setStateAsync(`${prefix}.voltage`, pv.voltage, true);
                await this.setStateAsync(`${prefix}.current`, pv.current, true);
                await this.setStateAsync(`${prefix}.dailyEnergy`, Math.round(pv.energyDaily) / 1000, true);
                await this.setStateAsync(`${prefix}.totalEnergy`, Math.round(pv.energyTotal / 100) / 10, true);
            }
            // Meter data (from first MeterMO entry) - create states dynamically on first receive
            if (data.meter.length > 0) {
                if (!this.meterStatesCreated) {
                    await this.createMeterStates();
                    this.meterStatesCreated = true;
                }
                const m = data.meter[0];
                await this.setStateAsync("meter.totalPower", m.phaseTotalPower, true);
                await this.setStateAsync("meter.phaseAPower", m.phaseAPower, true);
                await this.setStateAsync("meter.phaseBPower", m.phaseBPower, true);
                await this.setStateAsync("meter.phaseCPower", m.phaseCPower, true);
                await this.setStateAsync("meter.powerFactorTotal", m.powerFactorTotal, true);
                await this.setStateAsync("meter.energyTotalExport", m.energyTotalPower, true);
                await this.setStateAsync("meter.energyTotalImport", m.energyTotalConsumed, true);
                await this.setStateAsync("meter.voltagePhaseA", m.voltagePhaseA, true);
                await this.setStateAsync("meter.voltagePhaseB", m.voltagePhaseB, true);
                await this.setStateAsync("meter.voltagePhaseC", m.voltagePhaseC, true);
                await this.setStateAsync("meter.currentPhaseA", m.currentPhaseA, true);
                await this.setStateAsync("meter.currentPhaseB", m.currentPhaseB, true);
                await this.setStateAsync("meter.currentPhaseC", m.currentPhaseC, true);
                await this.setStateAsync("meter.faultCode", m.faultCode, true);
            }
            // DTU aggregated values
            await this.setStateAsync("grid.dailyEnergy", Math.round(data.dtuDailyEnergy) / 1000, true);
            // grid.totalEnergy is set from cloud API only (AC output).
            // PV totals are DC input and include inverter conversion losses.
        }
        catch (err) {
            this.log.warn(`Error decoding RealData: ${err.message}`);
        }
    }
    async handleInfoData(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const info = this.protobuf.decodeInfoData(payload);
            this.log.info(`Device info: DTU SN=${info.dtuSn}, devices=${info.deviceNumber}, PVs=${info.pvNumber}`);
            // Create PV states dynamically based on actual PV count
            if (!this.pvStatesCreated && info.pvNumber > 0) {
                await this.createPvStates(info.pvNumber);
                this.pvStatesCreated = true;
            }
            await this.setStateAsync("dtu.serialNumber", info.dtuSn, true);
            if (info.dtuInfo) {
                const di = info.dtuInfo;
                await this.setStateAsync("dtu.swVersion", (0, protobufHandler_1.formatDtuVersion)(di.swVersion), true);
                await this.setStateAsync("dtu.hwVersion", (0, protobufHandler_1.formatDtuVersion)(di.hwVersion).replace("V", "H"), true);
                await this.setStateAsync("dtu.rssi", di.signalStrength, true);
                await this.setStateAsync("dtu.connState", di.errorCode, true);
                await this.setStateAsync("dtu.stepTime", di.dtuStepTime, true);
                await this.setStateAsync("dtu.rfHwVersion", di.dtuRfHwVersion, true);
                await this.setStateAsync("dtu.rfSwVersion", di.dtuRfSwVersion, true);
                await this.setStateAsync("dtu.accessModel", di.accessModel, true);
                await this.setStateAsync("dtu.communicationTime", di.communicationTime * 1000, true);
                await this.setStateAsync("dtu.wifiVersion", di.wifiVersion, true);
                await this.setStateAsync("dtu.mode485", di.dtu485Mode, true);
                await this.setStateAsync("dtu.sub1gFrequencyBand", di.sub1gFrequencyBand, true);
                // Check encryption requirement
                if (encryption_1.default.isRequired(di.dfs)) {
                    this.log.info("DTU requires encrypted communication");
                    this.encryptionRequired = true;
                    if (di.encRand) {
                        this.encryption = new encryption_1.default(di.encRand);
                        this.log.info("Encryption initialized with enc_rand from DTU");
                    }
                    else {
                        this.log.warn("Encryption required but no enc_rand received");
                    }
                }
                else {
                    this.log.info("DTU does not require encryption");
                    this.encryptionRequired = false;
                }
            }
            if (info.pvInfo.length > 0) {
                const pv = info.pvInfo[0];
                await this.setStateAsync("inverter.serialNumber", pv.sn, true);
                await this.setStateAsync("inverter.hwVersion", (0, protobufHandler_1.formatInvVersion)(pv.bootVersion).replace("V", "H"), true);
                await this.setStateAsync("inverter.swVersion", (0, protobufHandler_1.formatSwVersion)(pv.gridVersion), true);
            }
            // Start/configure cloud relay once we have DTU SN
            const relayEnabled = this.config.enableCloudRelay !== false;
            if (relayEnabled &&
                this.protobuf &&
                info.dtuSn &&
                !this.cloudRelay &&
                !this.cloudServerDomain.startsWith("_starting")) {
                // Read server from config state (set by handleConfigData)
                const serverState = await this.getStateAsync("config.serverDomain");
                const portState = await this.getStateAsync("config.serverPort");
                const serverDomain = serverState?.val || "";
                const serverPort = portState?.val || 10081;
                if (serverDomain) {
                    this.cloudServerDomain = "_starting"; // Prevent double init from parallel calls
                    const relay = new cloudRelay_1.default(serverDomain, serverPort);
                    relay.configure(this.protobuf, info.dtuSn);
                    this.cloudRelay = relay;
                    this.cloudRelay.on("connected", () => {
                        this.log.info(`Cloud relay connected to ${serverDomain}:${serverPort} as DTU ${info.dtuSn}`);
                    });
                    this.cloudRelay.on("disconnected", () => {
                        this.log.warn("Cloud relay disconnected, will reconnect");
                    });
                    this.cloudRelay.on("error", (err) => {
                        this.log.debug(`Cloud relay: ${err.message}`);
                    });
                    this.cloudRelay.connect();
                }
            }
            else if (this.cloudRelay && this.protobuf && info.dtuSn) {
                this.cloudRelay.configure(this.protobuf, info.dtuSn);
            }
        }
        catch (err) {
            this.log.warn(`Error decoding InfoData: ${err.message}`);
        }
    }
    async handleConfigData(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const config = this.protobuf.decodeGetConfig(payload);
            this.log.debug(`Config: server=${config.serverDomain}:${config.serverPort}, sendTime=${config.serverSendTime}min`);
            // Power limit from config (limitPower 1000 = 100%)
            await this.setStateAsync("inverter.powerLimit", config.limitPower / 10, true);
            await this.setStateAsync("config.serverDomain", config.serverDomain, true);
            await this.setStateAsync("config.serverPort", config.serverPort, true);
            await this.setStateAsync("config.serverSendTime", config.serverSendTime, true);
            await this.setStateAsync("config.wifiSsid", config.wifiSsid, true);
            await this.setStateAsync("config.wifiRssi", config.wifiRssi, true);
            await this.setStateAsync("config.zeroExportEnable", !!config.zeroExportEnable, true);
            await this.setStateAsync("config.zeroExport433Addr", config.zeroExport433Addr, true);
            await this.setStateAsync("config.meterKind", config.meterKind, true);
            await this.setStateAsync("config.meterInterface", config.meterInterface, true);
            await this.setStateAsync("config.netDhcpSwitch", config.dhcpSwitch, true);
            await this.setStateAsync("config.dtuApSsid", config.dtuApSsid, true);
            await this.setStateAsync("config.netmodeSelect", config.netmodeSelect, true);
            await this.setStateAsync("config.channelSelect", config.channelSelect, true);
            await this.setStateAsync("config.sub1gSweepSwitch", config.sub1gSweepSwitch, true);
            await this.setStateAsync("config.sub1gWorkChannel", config.sub1gWorkChannel, true);
            await this.setStateAsync("config.invType", config.invType, true);
            await this.setStateAsync("config.netIpAddress", config.ipAddress, true);
            await this.setStateAsync("config.netSubnetMask", config.subnetMask, true);
            await this.setStateAsync("config.netGateway", config.gateway, true);
            await this.setStateAsync("config.wifiIpAddress", config.wifiIpAddress, true);
            await this.setStateAsync("config.netMacAddress", config.macAddress, true);
            await this.setStateAsync("config.wifiMacAddress", config.wifiMacAddress, true);
            // Remember cloud server + sendTime for relay
            if (config.serverDomain && config.serverPort) {
                this.cloudServerDomain = `${config.serverDomain}:${config.serverPort}`;
            }
            if (config.serverSendTime > 0) {
                this.cloudSendTimeMin = config.serverSendTime;
            }
        }
        catch (err) {
            this.log.warn(`Error decoding Config: ${err.message}`);
        }
    }
    /**
     * Process alarm entries from both legacy AlarmData and newer WarnData formats.
     * Alarms with eTime=0 are active, eTime>0 are resolved.
     *
     * @param payload - Protobuf payload from DTU response
     * Severity is encoded in bits 14-15 of the code field.
     */
    async handleAlarmData(payload) {
        if (!this.protobuf) {
            return;
        }
        let alarms = [];
        // Try legacy AlarmData format first, then WarnData
        try {
            const data = this.protobuf.decodeAlarmData(payload);
            alarms = data.alarms.map(a => ({
                sn: a.sn,
                code: a.code,
                num: a.num,
                startTime: a.startTime * 1000,
                endTime: a.endTime > 0 ? a.endTime * 1000 : 0,
                data1: a.data1,
                data2: a.data2,
                descriptionEn: (0, alarmCodes_1.getAlarmDescription)(a.code, "en"),
                descriptionDe: (0, alarmCodes_1.getAlarmDescription)(a.code, "de"),
                active: a.endTime === 0,
            }));
        }
        catch {
            try {
                const data = this.protobuf.decodeWarnData(payload);
                alarms = data.warnings.map(w => ({
                    sn: w.sn,
                    code: w.code,
                    num: w.num,
                    startTime: w.startTime * 1000,
                    endTime: w.endTime > 0 ? w.endTime * 1000 : 0,
                    data1: w.data1,
                    data2: w.data2,
                    descriptionEn: w.descriptionEn,
                    descriptionDe: w.descriptionDe,
                    active: w.endTime === 0,
                }));
            }
            catch (err) {
                this.log.warn(`Error decoding AlarmData/WarnData: ${err.message}`);
                return;
            }
        }
        if (alarms.length === 0) {
            this.log.debug("Alarm list query returned no active alarms");
        }
        else {
            this.log.debug(`Alarms received: ${alarms.length} entries`);
        }
        const activeAlarms = alarms.filter(a => a.active);
        await this.setStateAsync("alarms.count", alarms.length, true);
        await this.setStateAsync("alarms.activeCount", activeAlarms.length, true);
        await this.setStateAsync("alarms.hasActive", activeAlarms.length > 0, true);
        await this.setStateAsync("alarms.json", JSON.stringify(alarms), true);
        if (alarms.length > 0) {
            const last = alarms[alarms.length - 1];
            await this.setStateAsync("alarms.lastCode", last.code, true);
            await this.setStateAsync("alarms.lastStartTime", last.startTime, true);
            await this.setStateAsync("alarms.lastEndTime", last.endTime, true);
            await this.setStateAsync("alarms.lastMessage", `${last.descriptionDe} (Code ${last.code})`, true);
            await this.setStateAsync("alarms.lastData1", last.data1, true);
            await this.setStateAsync("alarms.lastData2", last.data2, true);
        }
    }
    async handleHistPower(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const data = this.protobuf.decodeHistPower(payload);
            this.log.debug(`HistPower: ${data.powerArray.length} entries, step=${data.stepTime}s, daily=${data.dailyEnergy}Wh, total=${data.totalEnergy}Wh, start=${data.startTime}, relPower=${data.relativePower}, warns=${data.warningNumber}`);
            await this.setStateAsync("history.powerJson", JSON.stringify(data.powerArray), true);
            await this.setStateAsync("history.dailyEnergy", data.dailyEnergy, true);
            await this.setStateAsync("history.totalEnergy", Math.round(data.totalEnergy / 100) / 10, true);
            await this.setStateAsync("history.stepTime", data.stepTime, true);
        }
        catch (err) {
            this.log.warn(`Error decoding HistPower: ${err.message}`);
        }
    }
    async handleAutoSearch(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const ReqDTO = this.protobuf.protos.AutoSearch.lookupType("AutoSearchReqDTO");
            const msg = ReqDTO.decode(payload);
            const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
            const serialNumbers = obj.miSerialNumbers || [];
            const hexSerials = serialNumbers.map(sn => (Number(sn) || 0).toString(16).toUpperCase());
            this.log.info(`AutoSearch found ${hexSerials.length} inverter(s): ${hexSerials.join(", ")}`);
            await this.setStateAsync("dtu.searchResult", JSON.stringify(hexSerials), true);
        }
        catch (err) {
            this.log.warn(`Error decoding AutoSearch: ${err.message}`);
        }
    }
    handleDevConfigFetch(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const ReqDTO = this.protobuf.protos.DevConfig.lookupType("DevConfigFetchReqDTO");
            ReqDTO.decode(payload);
            this.log.debug("DevConfig response received");
        }
        catch (err) {
            this.log.warn(`Error decoding DevConfig: ${err.message}`);
        }
    }
    handleNetworkInfo(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const ReqDTO = this.protobuf.protos.NetworkInfo.lookupType("NetworkInfoReqDTO");
            ReqDTO.decode(payload);
            this.log.debug("NetworkInfo response received");
        }
        catch (err) {
            this.log.debug(`Error decoding NetworkInfo: ${err.message}`);
        }
    }
    handleCommandResponse(payload) {
        if (!this.protobuf) {
            return;
        }
        try {
            const ReqDTO = this.protobuf.protos.CommandPB.lookupType("CommandReqDTO");
            const msg = ReqDTO.decode(payload);
            const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
            const errCode = obj.errCode;
            this.log.info(`Command response: action=${String(obj.action)}, error=${String(errCode)}, packageNow=${String(obj.packageNow)}`);
            if (errCode !== undefined && errCode !== null && errCode !== 0) {
                this.log.warn(`Command failed with error code: ${String(errCode)}`);
            }
            // Alarm list response with no data → set states to empty
            if (obj.action === 50 && errCode === 0 && (obj.packageNow === 0 || obj.packageNow === undefined)) {
                this.log.debug("Alarm list query returned no active alarms");
                void this.setStateAsync("alarms.count", 0, true);
                void this.setStateAsync("alarms.json", "[]", true);
            }
        }
        catch (err) {
            this.log.debug(`Error decoding command response: ${err.message}`);
        }
    }
    async onStateChange(id, state) {
        if (!state || state.ack) {
            return;
        }
        if (!this.connection || !this.connection.connected || !this.protobuf) {
            this.log.warn("Cannot send command: not connected to DTU");
            return;
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const stateId = id.split(".").slice(2).join(".");
        if (stateId === "inverter.powerLimit") {
            const percent = Number(state.val);
            if (percent < 2 || percent > 100) {
                this.log.warn(`Power limit must be between 2 and 100, got ${percent}`);
                return;
            }
            this.log.info(`Setting power limit to ${percent}%`);
            const msg = this.protobuf.encodeSetPowerLimit(percent, timestamp);
            await this.connection.send(msg);
        }
        else if (stateId === "inverter.active") {
            if (state.val) {
                this.log.info("Turning inverter ON");
                const msg = this.protobuf.encodeInverterOn(timestamp);
                await this.connection.send(msg);
            }
            else {
                this.log.info("Turning inverter OFF");
                const msg = this.protobuf.encodeInverterOff(timestamp);
                await this.connection.send(msg);
            }
        }
        else if (stateId === "inverter.reboot") {
            if (state.val) {
                this.log.info("Rebooting inverter");
                const msg = this.protobuf.encodeInverterReboot(timestamp);
                await this.connection.send(msg);
                // Reset button state
                this.setTimeout(() => void this.setStateAsync("inverter.reboot", false, true), 1000);
            }
        }
        else if (stateId === "dtu.reboot") {
            if (state.val) {
                this.log.info("Rebooting DTU");
                const msg = this.protobuf.encodeDtuReboot(timestamp);
                await this.connection.send(msg);
                this.setTimeout(() => void this.setStateAsync("dtu.reboot", false, true), 1000);
            }
        }
        else if (stateId === "inverter.powerFactorLimit") {
            const value = Number(state.val);
            if ((value < -1 || value > -0.8) && (value < 0.8 || value > 1)) {
                this.log.warn(`Power factor must be -1.0…-0.8 or 0.8…1.0, got ${value}`);
                return;
            }
            this.log.info(`Setting power factor limit to ${value}`);
            const msg = this.protobuf.encodePowerFactorLimit(value, timestamp);
            await this.connection.send(msg);
        }
        else if (stateId === "inverter.reactivePowerLimit") {
            const degrees = Number(state.val);
            if (degrees < -50 || degrees > 50) {
                this.log.warn(`Reactive power limit must be -50…+50°, got ${degrees}`);
                return;
            }
            this.log.info(`Setting reactive power limit to ${degrees}°`);
            const msg = this.protobuf.encodeReactivePowerLimit(degrees, timestamp);
            await this.connection.send(msg);
        }
        else if (stateId === "inverter.cleanWarnings") {
            if (state.val) {
                this.log.info("Cleaning warnings");
                const msg = this.protobuf.encodeCleanWarnings(timestamp);
                await this.connection.send(msg);
                this.setTimeout(() => void this.setStateAsync("inverter.cleanWarnings", false, true), 1000);
            }
        }
        else if (stateId === "inverter.cleanGroundingFault") {
            if (state.val) {
                this.log.info("Cleaning grounding fault");
                const msg = this.protobuf.encodeCleanGroundingFault(timestamp);
                await this.connection.send(msg);
                this.setTimeout(() => void this.setStateAsync("inverter.cleanGroundingFault", false, true), 1000);
            }
        }
        else if (stateId === "inverter.lock") {
            if (state.val) {
                this.log.info("Locking inverter");
                const msg = this.protobuf.encodeLockInverter(timestamp);
                await this.connection.send(msg);
            }
            else {
                this.log.info("Unlocking inverter");
                const msg = this.protobuf.encodeUnlockInverter(timestamp);
                await this.connection.send(msg);
            }
        }
        else if (stateId === "config.zeroExportEnable") {
            const enable = !!state.val;
            this.log.info(`Setting zero export: ${enable ? "enabled" : "disabled"}`);
            const msg = this.protobuf.encodeSetConfig(timestamp, {
                zeroExportEnable: enable ? 1 : 0,
            });
            await this.connection.send(msg);
        }
        else if (stateId === "config.serverSendTime") {
            const seconds = Number(state.val);
            if (!seconds || seconds < 1) {
                this.log.warn(`Server send time must be a positive number, got ${state.val}`);
                return;
            }
            this.log.info(`Setting cloud send interval to ${seconds}s`);
            const msg = this.protobuf.encodeSetConfig(timestamp, {
                serverSendTime: seconds,
            });
            await this.connection.send(msg);
        }
    }
    async pollCloudData() {
        if (!this.cloud || !this.cloudStationId) {
            return;
        }
        try {
            await this.cloud.ensureToken();
            const data = await this.cloud.getStationRealtime(this.cloudStationId);
            const dtuConnected = this.connection && this.connection.connected;
            const toKwh = (wh) => Math.round((parseFloat(wh) || 0) / 10) / 100;
            // Cloud-exclusive states (no local equivalent): always update
            await this.setStateAsync("grid.monthEnergy", toKwh(data.month_eq), true);
            await this.setStateAsync("grid.yearEnergy", toKwh(data.year_eq), true);
            await this.setStateAsync("grid.co2Saved", Math.round((parseFloat(data.co2_emission_reduction) || 0) / 10) / 100, true);
            await this.setStateAsync("grid.treesPlanted", parseFloat(data.plant_tree) || 0, true);
            await this.setStateAsync("grid.isBalance", !!data.is_balance, true);
            await this.setStateAsync("grid.isReflux", !!data.is_reflux, true);
            await this.setStateAsync("info.lastCloudUpdate", new Date(data.data_time || 0).getTime(), true);
            const lastDataStr = data.last_data_time || "";
            await this.setStateAsync("info.lastDataTime", lastDataStr ? new Date(lastDataStr).getTime() : 0, true);
            await this.setStateAsync("info.cloudConnected", true, true);
            // Total energy always from cloud (AC output, not available locally)
            await this.setStateAsync("grid.totalEnergy", toKwh(data.total_eq), true);
            // Power/daily energy: only from cloud when DTU not connected (local has priority)
            if (!dtuConnected) {
                const power = parseFloat(data.real_power) || 0;
                await this.setStateAsync("grid.power", power, true);
                await this.setStateAsync("grid.dailyEnergy", toKwh(data.today_eq), true);
            }
            // Station details
            try {
                const details = await this.cloud.getStationDetails(this.cloudStationId);
                await this.setStateAsync("info.systemCapacity", parseFloat(details.capacitor) || 0, true);
                await this.setStateAsync("info.address", details.address || "", true);
                await this.setStateAsync("info.latitude", parseFloat(details.latitude) || 0, true);
                await this.setStateAsync("info.longitude", parseFloat(details.longitude) || 0, true);
                await this.setStateAsync("info.stationStatus", details.status || 0, true);
                await this.setStateAsync("info.installedAt", new Date(details.create_at || 0).getTime(), true);
                await this.setStateAsync("info.timezone", details.timezone?.tz_name || "", true);
                await this.setStateAsync("grid.electricityPrice", details.electricity_price || 0, true);
                // Currency from cloud (dynamic, not hardcoded EUR)
                const currency = details.money_unit || "EUR";
                await this.setStateAsync("grid.currency", currency, true);
                // Power limit → shared state
                if (!dtuConnected) {
                    await this.setStateAsync("inverter.powerLimit", parseFloat(details.config?.power_limit) || 0, true);
                }
                // Calculate income
                const price = details.electricity_price || 0;
                await this.setStateAsync("grid.todayIncome", Math.round(toKwh(data.today_eq) * price * 100) / 100, true);
                await this.setStateAsync("grid.totalIncome", Math.round(toKwh(data.total_eq) * price * 100) / 100, true);
            }
            catch (detailErr) {
                this.log.debug(`Cloud station details failed: ${detailErr.message}`);
            }
            // Device tree → write into info.* and inverter.*
            try {
                const devices = await this.cloud.getDeviceTree(this.cloudStationId);
                if (devices.length > 0) {
                    const dtu = devices[0];
                    if (!dtuConnected) {
                        await this.setStateAsync("dtu.serialNumber", dtu.sn || "", true);
                        await this.setStateAsync("dtu.swVersion", dtu.soft_ver || "", true);
                        await this.setStateAsync("dtu.hwVersion", dtu.hard_ver || "", true);
                    }
                    if (dtu.children && dtu.children.length > 0) {
                        const inv = dtu.children[0];
                        await this.setStateAsync("inverter.model", inv.model_no || "", true);
                        if (!dtuConnected) {
                            await this.setStateAsync("inverter.serialNumber", inv.sn || "", true);
                            await this.setStateAsync("inverter.swVersion", inv.soft_ver || "", true);
                            await this.setStateAsync("inverter.hwVersion", inv.hard_ver || "", true);
                            await this.setStateAsync("inverter.linkStatus", inv.warn_data?.connect ? 1 : 0, true);
                        }
                    }
                }
            }
            catch (devErr) {
                this.log.debug(`Cloud device tree failed: ${devErr.message}`);
            }
            const todayKwh = toKwh(data.today_eq).toFixed(2);
            const monthKwh = toKwh(data.month_eq).toFixed(2);
            const totalKwh = toKwh(data.total_eq).toFixed(2);
            this.log.debug(`Cloud data: ${data.real_power}W, today=${todayKwh}kWh, month=${monthKwh}kWh, total=${totalKwh}kWh`);
        }
        catch (err) {
            this.log.warn(`Cloud poll failed: ${err.message}`);
            await this.setStateAsync("info.cloudConnected", false, true);
            await this.updateConnectionState();
        }
    }
    onUnload(callback) {
        try {
            this.stopPollCycle();
            if (this.connection) {
                this.connection.disconnect();
                this.connection = null;
            }
            if (this.cloudRelay) {
                this.cloudRelay.disconnect();
                this.cloudRelay = null;
            }
            if (this.cloudPollTimer) {
                this.clearTimeout(this.cloudPollTimer);
                this.cloudPollTimer = undefined;
            }
            if (this.cloud) {
                this.cloud.disconnect();
                this.cloud = null;
            }
            void this.setStateAsync("info.connection", false, true);
            void this.setStateAsync("info.cloudConnected", false, true);
        }
        catch {
            // ignore
        }
        callback();
    }
}
if (require.main !== module) {
    module.exports = (options) => new Hoymiles(options);
}
else {
    (() => new Hoymiles())();
}
//# sourceMappingURL=main.js.map