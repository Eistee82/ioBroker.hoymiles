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
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEADER_SIZE = exports.ACTION = exports.CMD = exports.ProtobufHandler = void 0;
exports.formatDtuVersion = formatDtuVersion;
exports.formatSwVersion = formatSwVersion;
exports.formatInvVersion = formatInvVersion;
const path = __importStar(require("node:path"));
const protobuf = __importStar(require("protobufjs"));
const alarmCodes_1 = require("./alarmCodes");
/**
 * Format DTU version: major=n//4096, minor=(n//256)%16, patch=n%256
 *
 * @param n - Raw version number
 */
function formatDtuVersion(n) {
    const major = Math.floor(n / 4096);
    const minor = Math.floor(n / 256) % 16;
    const patch = n % 256;
    return `V${String(major).padStart(2, "0")}.${String(minor).padStart(2, "0")}.${String(patch).padStart(2, "0")}`;
}
/**
 * Format SW version: major=n//10000, minor=(n%10000)//100, patch=n%100
 *
 * @param n - Raw version number
 */
function formatSwVersion(n) {
    const major = Math.floor(n / 10000);
    const minor = Math.floor((n % 10000) / 100);
    const patch = n % 100;
    return `V${String(major).padStart(2, "0")}.${String(minor).padStart(2, "0")}.${String(patch).padStart(2, "0")}`;
}
/**
 * Format inverter FW version: major=n//2048, minor=(n//64)%32, patch=n%64
 *
 * @param n - Raw version number
 */
function formatInvVersion(n) {
    const major = Math.floor(n / 2048);
    const minor = Math.floor(n / 64) % 32;
    const patch = n % 64;
    return `V${String(major).padStart(2, "0")}.${String(minor).padStart(2, "0")}.${String(patch).padStart(2, "0")}`;
}
// Command IDs for requests (App -> DTU: 0xa3 prefix)
const CMD = {
    REAL_DATA_NEW: [0xa3, 0x11],
    APP_INFO_DATA: [0xa3, 0x01],
    GET_CONFIG: [0xa3, 0x09],
    COMMAND: [0xa3, 0x05],
    COMMAND_CLOUD: [0x23, 0x05],
    SET_CONFIG: [0xa3, 0x10],
    WARN_DATA: [0xa3, 0x04],
    HIST_POWER: [0xa3, 0x15],
    HIST_ED: [0xa3, 0x16],
    HEARTBEAT: [0xa3, 0x02],
    NETWORK_INFO: [0xa3, 0x14],
    COMMAND_STATUS: [0xa3, 0x06],
    AUTO_SEARCH: [0xa3, 0x13],
    DEV_CONFIG_FETCH: [0xa3, 0x07],
    DEV_CONFIG_PUT: [0xa3, 0x08],
};
exports.CMD = CMD;
// Action codes for CommandResDTO
const ACTION = {
    DTU_REBOOT: 1,
    INV_REBOOT: 3,
    MI_START: 6,
    MI_SHUTDOWN: 7,
    LIMIT_POWER: 8,
    PERFORMANCE_DATA_MODE: 33,
    CLEAN_WARN: 42,
    READ_MI_HU_WARN: 46,
    ALARM_LIST: 50,
};
exports.ACTION = ACTION;
const MAGIC = [0x48, 0x4d]; // "HM"
const FLAGS = [0x00, 0x01];
const HEADER_SIZE = 10;
exports.HEADER_SIZE = HEADER_SIZE;
const DTU_TIME_OFFSET = 28800;
/** Handler for encoding and decoding Hoymiles protobuf messages. */
class ProtobufHandler {
    protos;
    /** Create a new ProtobufHandler instance. */
    constructor() {
        this.protos = {};
    }
    /** Load all protobuf definition files from the proto directory. */
    async loadProtos() {
        const protoDir = path.join(__dirname, "proto");
        const files = [
            "RealDataNew",
            "GetConfig",
            "CommandPB",
            "AlarmData",
            "APPInformationData",
            "SetConfig",
            "WarnData",
            "APPHeartbeatPB",
            "AppGetHistPower",
            "EventData",
            "NetworkInfo",
            "AutoSearch",
            "DevConfig",
        ];
        for (const file of files) {
            const root = await protobuf.load(path.join(protoDir, `${file}.proto`));
            this.protos[file] = root;
        }
    }
    /**
     * CRC16 with polynomial 0x18005 (CRC-16/MODBUS).
     *
     * @param buffer - The data to compute CRC over
     * @returns The 16-bit CRC value
     */
    crc16(buffer) {
        let crc = 0xffff;
        for (const byte of buffer) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) {
                if (crc & 1) {
                    crc = (crc >> 1) ^ 0xa001;
                }
                else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }
    /**
     * Build a framed message with HM header.
     *
     * @param cmdHigh - High byte of command ID
     * @param cmdLow - Low byte of command ID
     * @param protobufPayload - The protobuf-encoded payload
     * @returns Complete message buffer with header
     */
    buildMessage(cmdHigh, cmdLow, protobufPayload) {
        const crc = this.crc16(protobufPayload);
        const totalLen = HEADER_SIZE + protobufPayload.length;
        const header = Buffer.alloc(HEADER_SIZE);
        header[0] = MAGIC[0];
        header[1] = MAGIC[1];
        header[2] = cmdHigh;
        header[3] = cmdLow;
        header[4] = FLAGS[0];
        header[5] = FLAGS[1];
        header[6] = (crc >> 8) & 0xff;
        header[7] = crc & 0xff;
        header[8] = (totalLen >> 8) & 0xff;
        header[9] = totalLen & 0xff;
        return Buffer.concat([header, protobufPayload]);
    }
    /**
     * Parse a raw response buffer into command ID and payload.
     *
     * @param buffer - The raw message buffer
     * @returns Parsed response or null if invalid
     */
    parseResponse(buffer) {
        if (buffer.length < HEADER_SIZE) {
            return null;
        }
        if (buffer[0] !== MAGIC[0] || buffer[1] !== MAGIC[1]) {
            return null;
        }
        const cmdHigh = buffer[2];
        const cmdLow = buffer[3];
        const totalLen = (buffer[8] << 8) | buffer[9];
        const payload = buffer.slice(HEADER_SIZE, totalLen);
        return {
            cmdHigh,
            cmdLow,
            payload,
            totalLen,
        };
    }
    // --- Encode Requests ---
    /**
     * Encode a RealDataNew request message.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeRealDataNewRequest(timestamp) {
        const ResDTO = this.protos.RealDataNew.lookupType("RealDataNewResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.REAL_DATA_NEW[0], CMD.REAL_DATA_NEW[1], payload);
    }
    /**
     * Encode an AppInfoData request message.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeInfoRequest(timestamp) {
        const ResDTO = this.protos.APPInformationData.lookupType("APPInfoDataResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            offset: DTU_TIME_OFFSET,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.APP_INFO_DATA[0], CMD.APP_INFO_DATA[1], payload);
    }
    /**
     * Encode a GetConfig request message.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeGetConfigRequest(timestamp) {
        const ResDTO = this.protos.GetConfig.lookupType("GetConfigResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.GET_CONFIG[0], CMD.GET_CONFIG[1], payload);
    }
    /**
     * Encode an alarm list trigger command.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeAlarmTrigger(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.ALARM_LIST,
            devKind: 0,
            packageNub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND[0], CMD.COMMAND[1], payload);
    }
    /**
     * Encode a power limit command.
     *
     * @param percent - Power limit percentage (2-100)
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeSetPowerLimit(percent, timestamp) {
        const limitValue = Math.round(percent * 10);
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.LIMIT_POWER,
            devKind: 1,
            packageNub: 1,
            tid: timestamp,
            data: `A:${limitValue},B:0,C:0\r`,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND[0], CMD.COMMAND[1], payload);
    }
    /**
     * Encode an inverter turn-on command.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeInverterOn(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.MI_START,
            devKind: 1,
            packageNub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }
    /**
     * Encode an inverter shutdown command.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeInverterOff(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.MI_SHUTDOWN,
            devKind: 1,
            packageNub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }
    /**
     * Encode an inverter reboot command.
     *
     * @param timestamp - Unix timestamp in seconds
     * @returns Framed message buffer
     */
    encodeInverterReboot(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.INV_REBOOT,
            devKind: 1,
            packageNub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }
    /**
     * Encode a SetConfig message to write DTU configuration.
     *
     * @param timestamp - Unix timestamp in seconds
     * @param config - Configuration fields to set
     * @returns Framed message buffer
     */
    encodeSetConfig(timestamp, config) {
        const ResDTO = this.protos.SetConfig.lookupType("SetConfigResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
            ...config,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.SET_CONFIG[0], CMD.SET_CONFIG[1], payload);
    }
    /**
     * Encode a historical power data request message.
     *
     * @returns Framed message buffer
     */
    encodeHistPowerRequest() {
        const ResDTO = this.protos.AppGetHistPower.lookupType("AppGetHistPowerResDTO");
        const msg = ResDTO.create({
            cp: 0,
            offset: DTU_TIME_OFFSET,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.HIST_POWER[0], CMD.HIST_POWER[1], payload);
    }
    /**
     * Encode a heartbeat message.
     *
     * @param timestamp - Unix timestamp in seconds
     */
    encodeHeartbeat(timestamp) {
        const ResDTO = this.protos.APPHeartbeatPB.lookupType("HBResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.HEARTBEAT[0], CMD.HEARTBEAT[1], payload);
    }
    /**
     * Encode a network info request.
     *
     * @param timestamp - Unix timestamp in seconds
     */
    encodeNetworkInfoRequest(timestamp) {
        const ResDTO = this.protos.NetworkInfo.lookupType("NetworkInfoResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.NETWORK_INFO[0], CMD.NETWORK_INFO[1], payload);
    }
    /**
     * Encode a DTU reboot command.
     *
     * @param timestamp - Unix timestamp in seconds
     */
    encodeDtuReboot(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.DTU_REBOOT,
            packageNub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }
    /**
     * Enable performance data mode for faster DTU internal updates.
     *
     * @param timestamp - Unix timestamp in seconds
     */
    encodePerformanceDataMode(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.PERFORMANCE_DATA_MODE,
            packageNub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND[0], CMD.COMMAND[1], payload);
    }
    /**
     * Encode an AutoSearch request to discover connected inverters.
     *
     * @param timestamp - Unix timestamp in seconds
     */
    encodeAutoSearch(timestamp) {
        const ResDTO = this.protos.AutoSearch.lookupType("AutoSearchResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.AUTO_SEARCH[0], CMD.AUTO_SEARCH[1], payload);
    }
    /**
     * Encode a DevConfig fetch request.
     *
     * @param timestamp - Unix timestamp in seconds
     * @param dtuSn - DTU serial number
     * @param devSn - Device serial number
     */
    encodeDevConfigFetch(timestamp, dtuSn, devSn) {
        const ResDTO = this.protos.DevConfig.lookupType("DevConfigFetchResDTO");
        const msg = ResDTO.create({
            responseTime: timestamp,
            transactionId: timestamp,
            dtuSn: dtuSn,
            devSn: devSn,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.DEV_CONFIG_FETCH[0], CMD.DEV_CONFIG_FETCH[1], payload);
    }
    // --- Decode Responses ---
    /**
     * Decode a RealDataNew response payload.
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded real data result
     */
    decodeRealDataNew(payload) {
        const ReqDTO = this.protos.RealDataNew.lookupType("RealDataNewReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        const result = {
            dtuSn: obj.deviceSerialNumber || "",
            timestamp: obj.timestamp || 0,
            dtuPower: (Number(obj.dtuPower) || 0) / 10,
            dtuDailyEnergy: Number(obj.dtuDailyEnergy) || 0,
            sgs: [],
            pv: [],
            meter: [],
        };
        if (obj.sgsData) {
            for (const sgs of obj.sgsData) {
                result.sgs.push({
                    serialNumber: (Number(sgs.serialNumber) || 0).toString(16).toUpperCase(),
                    firmwareVersion: sgs.firmwareVersion || 0,
                    voltage: (sgs.voltage || 0) / 10,
                    frequency: (sgs.frequency || 0) / 100,
                    activePower: (sgs.activePower || 0) / 10,
                    reactivePower: (sgs.reactivePower || 0) / 10,
                    current: (sgs.current || 0) / 100,
                    powerFactor: (sgs.powerFactor || 0) / 1000,
                    temperature: (sgs.temperature || 0) / 10,
                    warningNumber: sgs.warningNumber || 0,
                    crcChecksum: sgs.crcChecksum || 0,
                    linkStatus: sgs.linkStatus || 0,
                    powerLimit: (sgs.powerLimit || 0) / 10,
                    modulationIndexSignal: sgs.modulationIndexSignal || 0,
                });
            }
        }
        if (obj.pvData) {
            for (const pv of obj.pvData) {
                result.pv.push({
                    serialNumber: (Number(pv.serialNumber) || 0).toString(16).toUpperCase(),
                    portNumber: pv.portNumber || 0,
                    voltage: (pv.voltage || 0) / 10,
                    current: (pv.current || 0) / 100,
                    power: (pv.power || 0) / 10,
                    energyTotal: pv.energyTotal || 0,
                    energyDaily: pv.energyDaily || 0,
                    errorCode: pv.errorCode || 0,
                });
            }
        }
        if (obj.meterData) {
            for (const m of obj.meterData) {
                result.meter.push({
                    deviceType: m.deviceType || 0,
                    serialNumber: (Number(m.serialNumber) || 0).toString(16).toUpperCase(),
                    phaseTotalPower: m.phaseTotalPower || 0,
                    phaseAPower: m.phase_APower || 0,
                    phaseBPower: m.phase_BPower || 0,
                    phaseCPower: m.phase_CPower || 0,
                    powerFactorTotal: (m.powerFactorTotal || 0) / 1000,
                    energyTotalPower: (m.energyTotalPower || 0) / 100,
                    energyTotalConsumed: (m.energyTotalConsumed || 0) / 100,
                    faultCode: m.faultCode || 0,
                    voltagePhaseA: (m.voltagePhase_A || 0) / 10,
                    voltagePhaseB: (m.voltagePhase_B || 0) / 10,
                    voltagePhaseC: (m.voltagePhase_C || 0) / 10,
                    currentPhaseA: (m.currentPhase_A || 0) / 100,
                    currentPhaseB: (m.currentPhase_B || 0) / 100,
                    currentPhaseC: (m.currentPhase_C || 0) / 100,
                });
            }
        }
        return result;
    }
    /**
     * Decode an AppInfoData response payload.
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded info data result
     */
    decodeInfoData(payload) {
        const ReqDTO = this.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        const result = {
            dtuSn: obj.dtuSerialNumber || "",
            timestamp: obj.timestamp || 0,
            deviceNumber: obj.deviceNumber || 0,
            pvNumber: obj.pvNumber || 0,
            dtuInfo: null,
            pvInfo: [],
        };
        if (obj.dtuInfo) {
            const di = obj.dtuInfo;
            result.dtuInfo = {
                deviceKind: di.deviceKind || 0,
                swVersion: di.dtuSwVersion || 0,
                hwVersion: di.dtuHwVersion || 0,
                signalStrength: di.signalStrength || 0,
                errorCode: di.dtuErrorCode || 0,
                dfs: Number(di.dfs) || 0,
                encRand: di.encRand || null,
                type: di.type || 0,
                dtuStepTime: di.dtuStepTime || 0,
                dtuRfHwVersion: di.dtuRfHwVersion || 0,
                dtuRfSwVersion: di.dtuRfSwVersion || 0,
                accessModel: di.accessModel || 0,
                communicationTime: di.communicationTime || 0,
                wifiVersion: di.wifiVersion || "",
                dtu485Mode: di.dtu485Mode || 0,
                sub1gFrequencyBand: di.sub1gFrequencyBand || 0,
            };
        }
        if (obj.pvInfo) {
            for (const pv of obj.pvInfo) {
                result.pvInfo.push({
                    kind: pv.pvKind || 0,
                    sn: (Number(pv.pvSn) || 0).toString(16).toUpperCase(),
                    hwVersion: pv.pvHwVersion || 0,
                    swVersion: pv.pvSwVersion || 0,
                    gridVersion: pv.pvGridVersion || 0,
                    bootVersion: pv.pvBootVersion || 0,
                });
            }
        }
        return result;
    }
    /**
     * Decode a GetConfig response payload.
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded config result
     */
    decodeGetConfig(payload) {
        const ReqDTO = this.protos.GetConfig.lookupType("GetConfigReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        const ipAddr = [obj.ipAddr_0, obj.ipAddr_1, obj.ipAddr_2, obj.ipAddr_3].map(v => v || 0).join(".");
        const subnetMask = [obj.subnetMask_0, obj.subnetMask_1, obj.subnetMask_2, obj.subnetMask_3]
            .map(v => v || 0)
            .join(".");
        const gateway = [obj.defaultGateway_0, obj.defaultGateway_1, obj.defaultGateway_2, obj.defaultGateway_3]
            .map(v => v || 0)
            .join(".");
        const wifiIp = [obj.wifiIpAddr_0, obj.wifiIpAddr_1, obj.wifiIpAddr_2, obj.wifiIpAddr_3]
            .map(v => v || 0)
            .join(".");
        const mac = [obj.mac_0, obj.mac_1, obj.mac_2, obj.mac_3, obj.mac_4, obj.mac_5]
            .map(v => (v || 0).toString(16).padStart(2, "0").toUpperCase())
            .join(":");
        const wifiMac = [obj.wifiMac_0, obj.wifiMac_1, obj.wifiMac_2, obj.wifiMac_3, obj.wifiMac_4, obj.wifiMac_5]
            .map(v => (v || 0).toString(16).padStart(2, "0").toUpperCase())
            .join(":");
        return {
            limitPower: obj.limitPowerMypower || 0,
            zeroExportEnable: obj.zeroExportEnable || 0,
            zeroExport433Addr: obj.zeroExport_433Addr || 0,
            meterKind: obj.meterKind || "",
            meterInterface: obj.meterInterface || "",
            serverSendTime: obj.serverSendTime || 0,
            wifiRssi: obj.wifiRssi || 0,
            serverPort: obj.serverport || 0,
            serverDomain: obj.serverDomainName || "",
            wifiSsid: obj.wifiSsid || "",
            dtuSn: obj.dtuSn || "",
            dhcpSwitch: obj.dhcpSwitch || 0,
            invType: obj.invType || 0,
            netmodeSelect: obj.netmodeSelect || 0,
            channelSelect: obj.channelSelect || 0,
            sub1gSweepSwitch: obj.sub1gSweepSwitch || 0,
            sub1gWorkChannel: obj.sub1gWorkChannel || 0,
            dtuApSsid: obj.dtuApSsid || "",
            ipAddress: ipAddr,
            subnetMask: subnetMask,
            gateway: gateway,
            wifiIpAddress: wifiIp,
            macAddress: mac,
            wifiMacAddress: wifiMac,
        };
    }
    /**
     * Decode an AlarmData response payload.
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded alarm data result
     */
    decodeAlarmData(payload) {
        const ReqDTO = this.protos.AlarmData.lookupType("WInfoReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        const alarms = [];
        if (obj.mWInfo) {
            for (const w of obj.mWInfo) {
                alarms.push({
                    sn: (Number(w.pvSn) || 0).toString(16).toUpperCase(),
                    code: w.WCode || 0,
                    num: w.WNum || 0,
                    startTime: w.WTime1 || 0,
                    endTime: w.WTime2 || 0,
                    data1: w.WData1 || 0,
                    data2: w.WData2 || 0,
                });
            }
        }
        return {
            dtuSn: obj.dtuSn || "",
            timestamp: obj.time || 0,
            alarms,
        };
    }
    /**
     * Decode a historical power data response payload.
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded historical power result
     */
    decodeHistPower(payload) {
        const ReqDTO = this.protos.AppGetHistPower.lookupType("AppGetHistPowerReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        return {
            serialNumber: (Number(obj.serialNumber) || 0).toString(16).toUpperCase(),
            powerArray: obj.powerArray || [],
            totalEnergy: obj.totalEnergy || 0,
            dailyEnergy: obj.dailyEnergy || 0,
            stepTime: obj.stepTime || 0,
            startTime: obj.startTime || 0,
            relativePower: obj.relativePower || 0,
            warningNumber: obj.warningNumber || 0,
        };
    }
    /**
     * Decode a WarnData response payload (newer warning format).
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded warning data result with alarm descriptions
     */
    decodeWarnData(payload) {
        const ReqDTO = this.protos.WarnData.lookupType("WarnReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        const warnings = [];
        if (obj.warns) {
            for (const w of obj.warns) {
                const code = w.code || 0;
                warnings.push({
                    sn: (Number(w.pvSn) || 0).toString(16).toUpperCase(),
                    code,
                    num: w.num || 0,
                    startTime: w.sTime || 0,
                    endTime: w.eTime || 0,
                    data1: w.wData1 || 0,
                    data2: w.wData2 || 0,
                    descriptionEn: (0, alarmCodes_1.getAlarmDescription)(code, "en"),
                    descriptionDe: (0, alarmCodes_1.getAlarmDescription)(code, "de"),
                });
            }
        }
        return {
            dtuSn: obj.dtuSn || "",
            timestamp: obj.time || 0,
            warnings,
        };
    }
    /**
     * Decode an EventData response payload.
     *
     * @param payload - The protobuf payload buffer
     * @returns Decoded event data result
     */
    decodeEventData(payload) {
        const ReqDTO = this.protos.EventData.lookupType("EventDataReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });
        const events = [];
        if (obj.miEvents) {
            for (const e of obj.miEvents) {
                events.push({
                    eventCode: e.eventCode || 0,
                    eventStatus: e.eventStatus || 0,
                    eventCount: e.eventCount || 0,
                    pvVoltage: (e.pvVoltage || 0) / 10,
                    gridVoltage: (e.gridVoltage || 0) / 10,
                    gridFrequency: (e.gridFrequency || 0) / 100,
                    gridPower: e.gridPower || 0,
                    temperature: (e.temperature || 0) / 10,
                    miId: `${Number(e.miId) || 0}`,
                    startTimestamp: e.startTimestamp || 0,
                });
            }
        }
        return {
            offset: obj.offset || 0,
            timestamp: obj.time || 0,
            events,
        };
    }
}
exports.ProtobufHandler = ProtobufHandler;
//# sourceMappingURL=protobufHandler.js.map