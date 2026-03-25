"use strict";

const utils = require("@iobroker/adapter-core");
const DtuConnection = require("./lib/dtuConnection");
const ProtobufHandler = require("./lib/protobufHandler");
const Encryption = require("./lib/encryption");
const CloudConnection = require("./lib/cloudConnection");
const { channels, states } = require("./lib/stateDefinitions");
const { getAlarmDescription } = require("./lib/alarmCodes");

class Hoymiles extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: "hoymiles" });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.connection = null;
        this.protobuf = null;
        this.encryption = null;
        this.encryptionRequired = false;

        this.cloud = null;
        this.cloudPollTimer = null;
        this.cloudStationId = null;

        this.pollTimer = null;
        this.infoTimer = null;
        this.inverterActive = true;
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
            this.protobuf = new ProtobufHandler();
            try {
                await this.protobuf.loadProtos();
                this.log.info("Protobuf definitions loaded successfully");
            } catch (err) {
                this.log.error(`Failed to load protobuf definitions: ${err.message}`);
                return;
            }
        }

        // Create state objects
        await this.createStateObjects();

        // Subscribe to writable states
        this.subscribeStates("inverter.powerLimitSet");
        this.subscribeStates("inverter.active");
        this.subscribeStates("inverter.reboot");

        // --- Local TCP connection ---
        if (enableLocal) {
            if (!this.config.host) {
                this.log.error("Local connection enabled but no DTU host configured.");
            } else {
                this.log.info(`Starting local connection to DTU at ${this.config.host}:10081`);
                this.connection = new DtuConnection(
                    this.config.host,
                    10081,
                    {
                        cloudPause: this.config.cloudPause !== false,
                        cloudPauseDuration: this.config.cloudPauseDuration || 40,
                    }
                );

                this.connection.on("connected", () => {
                    this.log.info("Connected to DTU");
                    this.setStateAsync("info.connection", true, true);
                    this.requestInfo();
                    setTimeout(() => this.startPollCycle(), 3000);
                });

                this.connection.on("disconnected", () => {
                    this.log.warn("Disconnected from DTU");
                    this.setStateAsync("info.connection", false, true);
                    this.stopPollCycle();
                });

                this.connection.on("message", (message) => {
                    this.handleResponse(message);
                });

                this.connection.on("cloudPause", (paused) => {
                    this.log.info(`Cloud pause: ${paused ? "active" : "ended"}`);
                    this.setStateAsync("info.cloudPaused", paused, true);
                    if (paused) {
                        this.stopPollCycle();
                    }
                });

                this.connection.on("error", (err, count) => {
                    if (count === 1) {
                        this.log.warn(`DTU not reachable: ${err.message}`);
                    } else if (count && count % 10 === 0) {
                        this.log.info(`DTU still not reachable (attempt ${count}), retrying...`);
                    }
                });

                this.connection.connect();
            }
        }

        // --- Cloud connection ---
        if (enableCloud) {
            if (!this.config.cloudUser || !this.config.cloudPassword) {
                this.log.error("Cloud connection enabled but credentials not configured.");
            } else {
                this.log.info("Starting cloud connection to Hoymiles S-Miles API");
                this.cloud = new CloudConnection(this.config.cloudUser, this.config.cloudPassword);

                try {
                    await this.cloud.login();
                    this.log.info("Cloud login successful");
                    await this.setStateAsync("cloud.connected", true, true);

                    // Get station list and select first station
                    const stations = await this.cloud.getStationList();
                    if (stations.length === 0) {
                        this.log.error("No stations found in cloud account");
                    } else {
                        this.cloudStationId = stations[0].id;
                        await this.setStateAsync("cloud.stationName", stations[0].name, true);
                        await this.setStateAsync("cloud.stationId", this.cloudStationId, true);
                        this.log.info(`Cloud station: ${stations[0].name} (ID: ${this.cloudStationId})`);

                        // Initial cloud data fetch
                        await this.pollCloudData();

                        // Start cloud poll timer
                        const cloudInterval = (this.config.cloudPollInterval || 300) * 1000;
                        this.cloudPollTimer = setInterval(() => {
                            this.pollCloudData();
                        }, cloudInterval);
                    }
                } catch (err) {
                    this.log.error(`Cloud login failed: ${err.message}`);
                    await this.setStateAsync("cloud.connected", false, true);
                }
            }
        }
    }

    async createStateObjects() {
        // Create channels
        for (const ch of channels) {
            // info channel is already created by instanceObjects
            if (ch.id === "info") continue;
            await this.setObjectNotExistsAsync(ch.id, {
                type: "channel",
                common: { name: ch.name },
                native: {},
            });
        }

        // Create states
        for (const def of states) {
            // info.connection is already created by instanceObjects
            if (def.id === "info.connection") continue;
            await this.setObjectNotExistsAsync(def.id, {
                type: "state",
                common: {
                    name: def.name,
                    type: def.type,
                    role: def.role,
                    unit: def.unit || "",
                    read: true,
                    write: def.write || false,
                    min: def.min,
                    max: def.max,
                },
                native: {},
            });
        }
    }

    startPollCycle() {
        this.stopPollCycle();
        const interval = (this.config.pollInterval || 30) * 1000;

        // Immediate first poll
        this.requestRealData();

        this.pollTimer = setInterval(() => {
            if (this.connection && this.connection.connected && !this.connection.cloudPaused) {
                this.requestRealData();
            }
        }, interval);

        // Info poll every 10 minutes
        this.infoTimer = setInterval(() => {
            if (this.connection && this.connection.connected && !this.connection.cloudPaused) {
                this.requestInfo();
            }
        }, 600000);
    }

    stopPollCycle() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        if (this.infoTimer) {
            clearInterval(this.infoTimer);
            this.infoTimer = null;
        }
    }

    async requestRealData() {
        const timestamp = Math.floor(Date.now() / 1000);
        const msg = this.protobuf.encodeRealDataNewRequest(timestamp);
        const sent = await this.connection.send(msg);
        if (!sent) {
            this.log.debug("Failed to send RealData request");
        }
    }

    async requestInfo() {
        const timestamp = Math.floor(Date.now() / 1000);
        const msg = this.protobuf.encodeInfoRequest(timestamp);
        const sent = await this.connection.send(msg);
        if (!sent) {
            this.log.debug("Failed to send Info request");
        }
    }

    async requestConfig() {
        const timestamp = Math.floor(Date.now() / 1000);
        const msg = this.protobuf.encodeGetConfigRequest(timestamp);
        await this.connection.send(msg);
    }

    async requestAlarms() {
        const timestamp = Math.floor(Date.now() / 1000);
        const msg = this.protobuf.encodeAlarmTrigger(timestamp);
        await this.connection.send(msg);
    }

    handleResponse(message) {
        try {
            const parsed = this.protobuf.parseResponse(message);
            if (!parsed) {
                this.log.debug("Could not parse response message");
                return;
            }

            const { cmdHigh, cmdLow, payload } = parsed;

            // Decrypt if needed
            let decryptedPayload = payload;
            if (this.encryptionRequired && this.encryption) {
                // Info response is never encrypted
                if (!(cmdHigh === 0xa3 && cmdLow === 0x01)) {
                    try {
                        decryptedPayload = this.encryption.decrypt(payload);
                    } catch (err) {
                        this.log.warn(`Decryption failed: ${err.message}`);
                        return;
                    }
                }
            }

            if (cmdHigh === 0xa3 && cmdLow === 0x11) {
                // RealDataNew response
                this.handleRealData(decryptedPayload);
            } else if (cmdHigh === 0xa3 && cmdLow === 0x01) {
                // AppInfoData response
                this.handleInfoData(payload); // Always unencrypted
            } else if (cmdHigh === 0xa3 && cmdLow === 0x09) {
                // GetConfig response
                this.handleConfigData(decryptedPayload);
            } else if (cmdHigh === 0xa3 && cmdLow === 0x04) {
                // AlarmData response
                this.handleAlarmData(decryptedPayload);
            } else if (cmdHigh === 0xa3 && cmdLow === 0x05 || cmdHigh === 0x23 && cmdLow === 0x05) {
                // Command response
                this.handleCommandResponse(decryptedPayload);
            } else if (cmdHigh === 0xa3 && cmdLow === 0x15) {
                // HistPower response
                this.handleHistPower(decryptedPayload);
            } else {
                this.log.debug(`Unknown command response: 0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}`);
            }
        } catch (err) {
            this.log.warn(`Error handling response: ${err.message}`);
        }
    }

    async handleRealData(payload) {
        try {
            const data = this.protobuf.decodeRealDataNew(payload);
            this.log.debug(`RealData received: DTU power=${data.dtuPower}W`);

            await this.setStateAsync("info.lastResponse", Math.floor(Date.now() / 1000), true);

            // Grid data (from first SGSMO entry)
            if (data.sgs.length > 0) {
                const sgs = data.sgs[0];
                await this.setStateAsync("grid.power", sgs.activePower, true);
                await this.setStateAsync("grid.voltage", sgs.voltage, true);
                await this.setStateAsync("grid.current", sgs.current, true);
                await this.setStateAsync("grid.frequency", sgs.frequency, true);
                await this.setStateAsync("grid.reactivePower", sgs.reactivePower, true);
                await this.setStateAsync("grid.powerFactor", sgs.powerFactor, true);

                await this.setStateAsync("inverter.temperature", sgs.temperature, true);
                await this.setStateAsync("inverter.powerLimit", sgs.powerLimit, true);
                await this.setStateAsync("inverter.warnCount", sgs.warningNumber, true);
                await this.setStateAsync("inverter.linkStatus", sgs.linkStatus, true);
                await this.setStateAsync("inverter.rfSignal", sgs.modulationIndexSignal, true);
                await this.setStateAsync("inverter.serialNumber", sgs.serialNumber, true);
                await this.setStateAsync("inverter.firmwareVersion", sgs.firmwareVersion, true);
                await this.setStateAsync("inverter.crcChecksum", sgs.crcChecksum, true);
            }

            // PV data
            for (const pv of data.pv) {
                const prefix = `pv${pv.portNumber}`;
                // Only handle pv0 and pv1
                if (pv.portNumber > 1) continue;
                await this.setStateAsync(`${prefix}.power`, pv.power, true);
                await this.setStateAsync(`${prefix}.voltage`, pv.voltage, true);
                await this.setStateAsync(`${prefix}.current`, pv.current, true);
                await this.setStateAsync(`${prefix}.dailyEnergy`, Math.round(pv.energyDaily / 10) / 100, true);
                await this.setStateAsync(`${prefix}.totalEnergy`, Math.round(pv.energyTotal / 10) / 100, true);
            }

            // DTU aggregated values
            await this.setStateAsync("inverter.dtuPower", data.dtuPower, true);
            await this.setStateAsync("inverter.dtuDailyEnergy", Math.round(data.dtuDailyEnergy / 10) / 100, true);
            await this.setStateAsync("grid.dailyEnergy", Math.round(data.dtuDailyEnergy / 10) / 100, true);

            // Chain: request config after real data
            setTimeout(() => this.requestConfig(), 2000);
            // Then alarms
            setTimeout(() => this.requestAlarms(), 4000);
        } catch (err) {
            this.log.warn(`Error decoding RealData: ${err.message}`);
        }
    }

    async handleInfoData(payload) {
        try {
            const info = this.protobuf.decodeInfoData(payload);
            this.log.info(`Device info: DTU SN=${info.dtuSn}, devices=${info.deviceNumber}, PVs=${info.pvNumber}`);

            await this.setStateAsync("info.dtuSerial", info.dtuSn, true);

            if (info.dtuInfo) {
                const di = info.dtuInfo;
                await this.setStateAsync("info.dtuSwVersion", String(di.swVersion), true);
                await this.setStateAsync("info.dtuHwVersion", String(di.hwVersion), true);
                await this.setStateAsync("info.dtuRssi", di.signalStrength, true);
                await this.setStateAsync("info.dtuConnState", di.errorCode, true);

                // Check encryption requirement
                if (Encryption.isRequired(di.dfs)) {
                    this.log.info("DTU requires encrypted communication");
                    this.encryptionRequired = true;
                    if (di.encRand) {
                        this.encryption = new Encryption(di.encRand);
                        this.log.info("Encryption initialized with enc_rand from DTU");
                    } else {
                        this.log.warn("Encryption required but no enc_rand received");
                    }
                } else {
                    this.log.info("DTU does not require encryption");
                    this.encryptionRequired = false;
                }
            }

            if (info.pvInfo.length > 0) {
                const pv = info.pvInfo[0];
                await this.setStateAsync("info.inverterSerial", pv.sn, true);
                await this.setStateAsync("info.inverterHwVersion", String(pv.hwVersion), true);
                await this.setStateAsync("info.inverterSwVersion", String(pv.swVersion), true);
            }
        } catch (err) {
            this.log.warn(`Error decoding InfoData: ${err.message}`);
        }
    }

    async handleConfigData(payload) {
        try {
            const config = this.protobuf.decodeGetConfig(payload);
            this.log.debug(`Config: server=${config.serverDomain}:${config.serverPort}, sendTime=${config.serverSendTime}s`);

            await this.setStateAsync("config.serverDomain", config.serverDomain, true);
            await this.setStateAsync("config.serverPort", config.serverPort, true);
            await this.setStateAsync("config.serverSendTime", config.serverSendTime, true);
            await this.setStateAsync("config.wifiSsid", config.wifiSsid, true);
            await this.setStateAsync("config.wifiRssi", config.wifiRssi, true);
            await this.setStateAsync("config.zeroExportEnable", !!config.zeroExportEnable, true);
            await this.setStateAsync("config.dhcpSwitch", config.dhcpSwitch, true);
        } catch (err) {
            this.log.warn(`Error decoding Config: ${err.message}`);
        }
    }

    async handleAlarmData(payload) {
        try {
            const data = this.protobuf.decodeAlarmData(payload);
            this.log.debug(`Alarms received: ${data.alarms.length} entries`);

            await this.setStateAsync("alarms.count", data.alarms.length, true);

            // Enrich alarms with descriptions
            const enrichedAlarms = data.alarms.map((a) => ({
                ...a,
                description_en: getAlarmDescription(a.code, "en"),
                description_de: getAlarmDescription(a.code, "de"),
            }));
            await this.setStateAsync("alarms.json", JSON.stringify(enrichedAlarms), true);

            if (data.alarms.length > 0) {
                const last = data.alarms[data.alarms.length - 1];
                await this.setStateAsync("alarms.lastCode", last.code, true);
                await this.setStateAsync("alarms.lastTime", last.startTime, true);
                const desc = getAlarmDescription(last.code, "de");
                await this.setStateAsync("alarms.lastMessage", `${desc} (Code ${last.code})`, true);
            }
        } catch (err) {
            this.log.warn(`Error decoding AlarmData: ${err.message}`);
        }
    }

    async handleCommandResponse(payload) {
        try {
            const ReqDTO = this.protobuf.protos.CommandPB.lookupType("CommandReqDTO");
            const msg = ReqDTO.decode(payload);
            const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
            this.log.info(`Command response: action=${obj.action}, error=${obj.err_code}`);

            if (obj.err_code !== 0) {
                this.log.warn(`Command failed with error code: ${obj.err_code}`);
            }
        } catch (err) {
            this.log.debug(`Error decoding command response: ${err.message}`);
        }
    }

    async handleHistPower(payload) {
        try {
            const data = this.protobuf.decodeHistPower(payload);
            await this.setStateAsync("history.powerJson", JSON.stringify(data), true);
        } catch (err) {
            this.log.warn(`Error decoding HistPower: ${err.message}`);
        }
    }

    async onStateChange(id, state) {
        if (!state || state.ack) return;
        if (!this.connection || !this.connection.connected) {
            this.log.warn("Cannot send command: not connected to DTU");
            return;
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const stateId = id.split(".").slice(2).join(".");

        if (stateId === "inverter.powerLimitSet") {
            const percent = Number(state.val);
            if (percent < 2 || percent > 100) {
                this.log.warn(`Power limit must be between 2 and 100, got ${percent}`);
                return;
            }
            this.log.info(`Setting power limit to ${percent}%`);
            const msg = this.protobuf.encodeSetPowerLimit(percent, timestamp);
            await this.connection.send(msg);
        } else if (stateId === "inverter.active") {
            if (state.val) {
                this.log.info("Turning inverter ON");
                const msg = this.protobuf.encodeInverterOn(timestamp);
                await this.connection.send(msg);
            } else {
                this.log.info("Turning inverter OFF");
                const msg = this.protobuf.encodeInverterOff(timestamp);
                await this.connection.send(msg);
            }
        } else if (stateId === "inverter.reboot") {
            if (state.val) {
                this.log.info("Rebooting inverter");
                const msg = this.protobuf.encodeInverterReboot(timestamp);
                await this.connection.send(msg);
                // Reset button state
                setTimeout(() => this.setStateAsync("inverter.reboot", false, true), 1000);
            }
        }
    }

    async pollCloudData() {
        if (!this.cloud || !this.cloudStationId) return;

        try {
            await this.cloud.ensureToken();
            const data = await this.cloud.getStationRealtime(this.cloudStationId);

            // Cloud-exclusive states: always update
            await this.setStateAsync("cloud.todayEnergy", Math.round((parseFloat(data.today_eq) || 0) / 10) / 100, true);
            await this.setStateAsync("cloud.monthEnergy", Math.round((parseFloat(data.month_eq) || 0) / 10) / 100, true);
            await this.setStateAsync("cloud.yearEnergy", Math.round((parseFloat(data.year_eq) || 0) / 10) / 100, true);
            await this.setStateAsync("cloud.totalEnergy", Math.round((parseFloat(data.total_eq) || 0) / 10) / 100, true);
            await this.setStateAsync("cloud.currentPower", parseFloat(data.real_power) || 0, true);
            await this.setStateAsync("cloud.co2Saved", parseFloat(data.co2_emission_reduction) || 0, true);
            await this.setStateAsync("cloud.lastUpdate", data.data_time || "", true);
            await this.setStateAsync("cloud.connected", true, true);

            // Shared states: only update if DTU is NOT connected (local has priority)
            const dtuConnected = this.connection && this.connection.connected;
            if (!dtuConnected) {
                const power = parseFloat(data.real_power) || 0;
                await this.setStateAsync("grid.power", power, true);
                await this.setStateAsync("inverter.dtuPower", power, true);
                await this.setStateAsync("grid.dailyEnergy", Math.round((parseFloat(data.today_eq) || 0) / 10) / 100, true);
            }

            this.log.debug(`Cloud data: ${data.real_power}W, today=${data.today_eq}Wh, month=${data.month_eq}Wh`);
        } catch (err) {
            this.log.warn(`Cloud poll failed: ${err.message}`);
            await this.setStateAsync("cloud.connected", false, true);
        }
    }

    onUnload(callback) {
        try {
            this.stopPollCycle();
            if (this.cloudPollTimer) {
                clearInterval(this.cloudPollTimer);
                this.cloudPollTimer = null;
            }
            if (this.connection) {
                this.connection.disconnect();
                this.connection = null;
            }
            if (this.cloud) {
                this.cloud.disconnect();
                this.cloud = null;
            }
            this.setStateAsync("info.connection", false, true);
            this.setStateAsync("info.cloudPaused", false, true);
            this.setStateAsync("cloud.connected", false, true);
        } catch (e) {
            // ignore
        }
        callback();
    }
}

if (require.main !== module) {
    module.exports = (options) => new Hoymiles(options);
} else {
    new Hoymiles();
}
