import * as path from "node:path";
import protobuf from "protobufjs";
import { getAlarmDescription } from "./alarmCodes.js";
import { crc16 } from "./crc16.js";
import { DTU_TIME_OFFSET, HM_MAGIC_0, HM_MAGIC_1, SCALE_VOLTAGE, SCALE_POWER, SCALE_TEMPERATURE, SCALE_CURRENT, SCALE_FREQUENCY, SCALE_ENERGY, SCALE_POWER_FACTOR, } from "./constants.js";
import { unixSeconds } from "./utils.js";
function pad2(n) {
    return String(n).padStart(2, "0");
}
function formatVersion(n, majorDiv, minorDiv, minorMod, patchMod) {
    return `V${pad2(Math.floor(n / majorDiv))}.${pad2(Math.floor(n / minorDiv) % minorMod)}.${pad2(n % patchMod)}`;
}
export function formatDtuVersion(n) {
    return formatVersion(n, 4096, 256, 16, 256);
}
export function formatSwVersion(n) {
    return formatVersion(n, 10000, 100, 100, 100);
}
export function formatInvVersion(n) {
    return formatVersion(n, 2048, 64, 32, 64);
}
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
const ACTION = {
    DTU_REBOOT: 1,
    INV_REBOOT: 3,
    MI_START: 6,
    MI_SHUTDOWN: 7,
    LIMIT_POWER: 8,
    CLEAN_GROUNDING_FAULT: 10,
    LOCK: 12,
    UNLOCK: 13,
    PERFORMANCE_DATA_MODE: 33,
    CLEAN_WARN: 42,
    READ_MI_HU_WARN: 46,
    POWER_FACTOR_LIMIT: 47,
    REACTIVE_POWER_LIMIT: 48,
    ALARM_LIST: 50,
};
const MAGIC = [HM_MAGIC_0, HM_MAGIC_1];
const HEADER_SIZE = 10;
const SEQ_MAX = 60000;
const num = (v) => (typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0);
const arr = (v) => (Array.isArray(v) ? v : []);
const scaled = (v, div) => (div === 0 ? 0 : num(v) / div);
const s16 = (v) => {
    const n = num(v) & 0xffff;
    return n >= 0x8000 ? n - 0x10000 : n;
};
const serialToHex = (v) => (Number(v) || 0).toString(16).toUpperCase();
const formatIpv4 = (a, b, c, d) => [num(a), num(b), num(c), num(d)].join(".");
const formatMac = (a, b, c, d, e, f) => [a, b, c, d, e, f].map(v => num(v).toString(16).padStart(2, "0").toUpperCase()).join(":");
const writeU16BE = (buf, off, val) => {
    buf[off] = (val >> 8) & 0xff;
    buf[off + 1] = val & 0xff;
};
class ProtobufHandler {
    protos;
    seq;
    cachedTimeStr;
    cachedTimeSec;
    types = new Map();
    constructor() {
        this.protos = {};
        this.seq = 0;
        this.cachedTimeStr = null;
        this.cachedTimeSec = 0;
    }
    getType(proto, name) {
        const key = `${proto}.${name}`;
        let type = this.types.get(key);
        if (!type) {
            type = this.protos[proto].lookupType(name);
            this.types.set(key, type);
        }
        return type;
    }
    decodePayload(proto, name, payload) {
        const type = this.getType(proto, name);
        const msg = type.decode(payload);
        return type.toObject(msg, { longs: Number, defaults: true });
    }
    nextSeq() {
        const current = this.seq;
        this.seq = current >= SEQ_MAX ? 0 : current + 1;
        return current;
    }
    formatTimeYmdHms() {
        const sec = unixSeconds();
        if (this.cachedTimeStr && sec === this.cachedTimeSec) {
            return this.cachedTimeStr;
        }
        const now = new Date();
        const str = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ` +
            `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
        this.cachedTimeStr = Buffer.from(str, "utf-8");
        this.cachedTimeSec = sec;
        return this.cachedTimeStr;
    }
    async loadProtos() {
        const protoDir = path.join(import.meta.dirname, "proto");
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
        const loaded = await Promise.all(files.map(file => protobuf.load(path.join(protoDir, `${file}.proto`))));
        for (let i = 0; i < files.length; i++) {
            this.protos[files[i]] = loaded[i];
        }
        const typeSpecs = [
            ["RealDataNew", "RealDataNewResDTO"],
            ["RealDataNew", "RealDataNewReqDTO"],
            ["APPInformationData", "APPInfoDataResDTO"],
            ["APPInformationData", "APPInfoDataReqDTO"],
            ["GetConfig", "GetConfigResDTO"],
            ["GetConfig", "GetConfigReqDTO"],
            ["CommandPB", "CommandResDTO"],
            ["CommandPB", "CommandReqDTO"],
            ["SetConfig", "SetConfigResDTO"],
            ["APPHeartbeatPB", "HBResDTO"],
            ["APPHeartbeatPB", "HBReqDTO"],
            ["AlarmData", "WInfoReqDTO"],
            ["WarnData", "WarnReqDTO"],
            ["WarnData", "WarnResDTO"],
            ["AppGetHistPower", "AppGetHistPowerReqDTO"],
            ["EventData", "EventDataReqDTO"],
            ["AutoSearch", "AutoSearchResDTO"],
            ["AutoSearch", "AutoSearchReqDTO"],
            ["DevConfig", "DevConfigFetchResDTO"],
            ["DevConfig", "DevConfigFetchReqDTO"],
            ["NetworkInfo", "NetworkInfoReqDTO"],
        ];
        for (const [proto, name] of typeSpecs) {
            this.getType(proto, name);
        }
    }
    buildMessage(cmdHigh, cmdLow, protobufPayload, overrideSeq) {
        const crc = crc16(protobufPayload);
        const totalLen = HEADER_SIZE + protobufPayload.length;
        const seq = overrideSeq ?? this.nextSeq();
        const header = Buffer.alloc(HEADER_SIZE);
        header[0] = MAGIC[0];
        header[1] = MAGIC[1];
        header[2] = cmdHigh;
        header[3] = cmdLow;
        writeU16BE(header, 4, seq);
        writeU16BE(header, 6, crc);
        writeU16BE(header, 8, totalLen);
        return Buffer.concat([header, protobufPayload]);
    }
    parseResponse(buffer) {
        if (buffer.length < HEADER_SIZE) {
            return null;
        }
        if (buffer[0] !== MAGIC[0] || buffer[1] !== MAGIC[1]) {
            return null;
        }
        const cmdHigh = buffer[2];
        const cmdLow = buffer[3];
        const storedCrc = (buffer[6] << 8) | buffer[7];
        const totalLen = (buffer[8] << 8) | buffer[9];
        const payload = buffer.subarray(HEADER_SIZE, totalLen);
        if (payload.length > 0 && storedCrc !== 0) {
            const computedCrc = crc16(payload);
            if (storedCrc !== computedCrc) {
                return null;
            }
        }
        return {
            cmdHigh,
            cmdLow,
            payload,
            totalLen,
        };
    }
    encodeRealDataNewRequest(timestamp) {
        const ResDTO = this.getType("RealDataNew", "RealDataNewResDTO");
        const msg = ResDTO.create({
            timeYmdHms: this.formatTimeYmdHms(),
            offset: DTU_TIME_OFFSET,
            time: timestamp,
            cp: 0,
            errCode: 0,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.REAL_DATA_NEW[0], CMD.REAL_DATA_NEW[1], payload);
    }
    encodeInfoRequest(timestamp) {
        const ResDTO = this.getType("APPInformationData", "APPInfoDataResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            offset: DTU_TIME_OFFSET,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.APP_INFO_DATA[0], CMD.APP_INFO_DATA[1], payload);
    }
    encodeGetConfigRequest(timestamp) {
        const ResDTO = this.getType("GetConfig", "GetConfigResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.GET_CONFIG[0], CMD.GET_CONFIG[1], payload);
    }
    encodeCommandAction(action, timestamp, data, cmd, devKind = 1) {
        const ResDTO = this.getType("CommandPB", "CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action,
            devKind,
            packageNub: 1,
            tid: timestamp,
            ...(data && { data }),
        });
        const c = cmd || CMD.COMMAND;
        return this.buildMessage(c[0], c[1], ResDTO.encode(msg).finish());
    }
    encodeAlarmTrigger(timestamp) {
        return this.encodeCommandAction(ACTION.ALARM_LIST, timestamp, undefined, undefined, 0);
    }
    encodeMiWarnRequest(timestamp) {
        return this.encodeCommandAction(ACTION.READ_MI_HU_WARN, timestamp);
    }
    encodeSetPowerLimit(percent, timestamp) {
        return this.encodeCommandAction(ACTION.LIMIT_POWER, timestamp, `A:${Math.round(percent * 10)},B:0,C:0\r`);
    }
    encodeInverterOn(timestamp) {
        return this.encodeCommandAction(ACTION.MI_START, timestamp, undefined, CMD.COMMAND_CLOUD);
    }
    encodeInverterOff(timestamp) {
        return this.encodeCommandAction(ACTION.MI_SHUTDOWN, timestamp, undefined, CMD.COMMAND_CLOUD);
    }
    encodeInverterReboot(timestamp) {
        return this.encodeCommandAction(ACTION.INV_REBOOT, timestamp, undefined, CMD.COMMAND_CLOUD);
    }
    encodeSetConfig(timestamp, config) {
        const ResDTO = this.getType("SetConfig", "SetConfigResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
            ...config,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.SET_CONFIG[0], CMD.SET_CONFIG[1], payload);
    }
    encodeWarnDataRequest(timestamp, packageNow = 0) {
        const ResDTO = this.getType("WarnData", "WarnResDTO");
        const msg = ResDTO.create({
            ymdHms: this.formatTimeYmdHms(),
            packageNow,
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.WARN_DATA[0], CMD.WARN_DATA[1], payload);
    }
    encodeHeartbeat(timestamp) {
        const ResDTO = this.getType("APPHeartbeatPB", "HBResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
            timeYmdHms: this.formatTimeYmdHms(),
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.HEARTBEAT[0], CMD.HEARTBEAT[1], payload);
    }
    encodeDtuReboot(timestamp) {
        return this.encodeCommandAction(ACTION.DTU_REBOOT, timestamp, undefined, CMD.COMMAND_CLOUD);
    }
    encodePerformanceDataMode(timestamp) {
        return this.encodeCommandAction(ACTION.PERFORMANCE_DATA_MODE, timestamp);
    }
    encodePowerFactorLimit(value, timestamp) {
        return this.encodeCommandAction(ACTION.POWER_FACTOR_LIMIT, timestamp, `A:${Math.round(value * 1000)},B:0,C:0\r`);
    }
    encodeReactivePowerLimit(degrees, timestamp) {
        return this.encodeCommandAction(ACTION.REACTIVE_POWER_LIMIT, timestamp, `A:${Math.round(degrees * 10)},B:0,C:0\r`);
    }
    encodeCleanWarnings(timestamp) {
        return this.encodeCommandAction(ACTION.CLEAN_WARN, timestamp);
    }
    encodeCleanGroundingFault(timestamp) {
        return this.encodeCommandAction(ACTION.CLEAN_GROUNDING_FAULT, timestamp);
    }
    encodeLockInverter(timestamp) {
        return this.encodeCommandAction(ACTION.LOCK, timestamp, undefined, CMD.COMMAND_CLOUD);
    }
    encodeUnlockInverter(timestamp) {
        return this.encodeCommandAction(ACTION.UNLOCK, timestamp, undefined, CMD.COMMAND_CLOUD);
    }
    encodeAutoSearch(timestamp) {
        const ResDTO = this.getType("AutoSearch", "AutoSearchResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.AUTO_SEARCH[0], CMD.AUTO_SEARCH[1], payload);
    }
    encodeDevConfigFetch(timestamp, dtuSn, devSn, currentPackage = 0) {
        const ResDTO = this.getType("DevConfig", "DevConfigFetchResDTO");
        const msg = ResDTO.create({
            responseTime: timestamp,
            transactionId: timestamp,
            dtuSn: dtuSn,
            devSn: devSn,
            currentPackage: currentPackage,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.DEV_CONFIG_FETCH[0], CMD.DEV_CONFIG_FETCH[1], payload);
    }
    encodeCloudCommandAck(timestamp, dtuSn, action, tid) {
        const ReqDTO = this.getType("CommandPB", "CommandReqDTO");
        const msg = ReqDTO.create({ dtuSn, time: timestamp, action, tid });
        return this.buildMessage(0x22, 0x05, ReqDTO.encode(msg).finish());
    }
    encodeCloudCommandStatus(timestamp, dtuSn, action, tid, miSnsSucs = []) {
        const ReqDTO = this.getType("CommandPB", "CommandStatusReqDTO");
        const msg = ReqDTO.create({
            dtuSn,
            time: timestamp,
            action,
            packageNub: 1,
            packageNow: 1,
            tid,
            miSnsSucs,
        });
        return this.buildMessage(0x22, 0x06, ReqDTO.encode(msg).finish());
    }
    encodeGridProfileResponse(timestamp, dtuSn, devSn, tid, data) {
        const ReqDTO = this.getType("DevConfig", "DevConfigFetchReqDTO");
        const msg = ReqDTO.create({
            requestTime: timestamp,
            transactionId: tid,
            data,
            crc: crc16(data),
            dtuSn,
            devSn,
            totalPackages: 1,
            ruleType: 1,
        });
        return this.buildMessage(0x22, 0x0e, ReqDTO.encode(msg).finish());
    }
    decodeRealDataNew(payload) {
        const obj = this.decodePayload("RealDataNew", "RealDataNewReqDTO", payload);
        const result = {
            dtuSn: obj.deviceSerialNumber || "",
            timestamp: num(obj.timestamp),
            dtuPower: scaled(obj.dtuPower, SCALE_POWER),
            dtuDailyEnergy: num(obj.dtuDailyEnergy),
            sgs: [],
            pv: [],
            meter: [],
        };
        for (const sgs of arr(obj.sgsData)) {
            result.sgs.push({
                serialNumber: serialToHex(sgs.serialNumber),
                firmwareVersion: num(sgs.firmwareVersion),
                voltage: scaled(sgs.voltage, SCALE_VOLTAGE),
                frequency: scaled(sgs.frequency, SCALE_FREQUENCY),
                activePower: scaled(sgs.activePower, SCALE_POWER),
                reactivePower: scaled(sgs.reactivePower, SCALE_POWER),
                current: scaled(sgs.current, SCALE_CURRENT),
                powerFactor: scaled(sgs.powerFactor, SCALE_POWER_FACTOR),
                temperature: scaled(s16(sgs.temperature), SCALE_TEMPERATURE),
                warningNumber: num(sgs.warningNumber),
                crcChecksum: num(sgs.crcChecksum),
                linkStatus: num(sgs.linkStatus),
                powerLimit: scaled(sgs.powerLimit, SCALE_POWER),
                modulationIndexSignal: num(sgs.modulationIndexSignal),
            });
        }
        for (const pv of arr(obj.pvData)) {
            result.pv.push({
                serialNumber: serialToHex(pv.serialNumber),
                portNumber: num(pv.portNumber),
                voltage: scaled(pv.voltage, SCALE_VOLTAGE),
                current: scaled(pv.current, SCALE_CURRENT),
                power: scaled(pv.power, SCALE_POWER),
                energyTotal: num(pv.energyTotal),
                energyDaily: num(pv.energyDaily),
                errorCode: num(pv.errorCode),
            });
        }
        for (const m of arr(obj.meterData)) {
            result.meter.push({
                deviceType: num(m.deviceType),
                serialNumber: serialToHex(m.serialNumber),
                phaseTotalPower: num(m.phaseTotalPower),
                phaseAPower: num(m.phase_APower),
                phaseBPower: num(m.phase_BPower),
                phaseCPower: num(m.phase_CPower),
                powerFactorTotal: scaled(m.powerFactorTotal, SCALE_POWER_FACTOR),
                energyTotalPower: scaled(m.energyTotalPower, SCALE_ENERGY),
                energyTotalConsumed: scaled(m.energyTotalConsumed, SCALE_ENERGY),
                faultCode: num(m.faultCode),
                voltagePhaseA: scaled(m.voltagePhase_A, SCALE_VOLTAGE),
                voltagePhaseB: scaled(m.voltagePhase_B, SCALE_VOLTAGE),
                voltagePhaseC: scaled(m.voltagePhase_C, SCALE_VOLTAGE),
                currentPhaseA: scaled(m.currentPhase_A, SCALE_CURRENT),
                currentPhaseB: scaled(m.currentPhase_B, SCALE_CURRENT),
                currentPhaseC: scaled(m.currentPhase_C, SCALE_CURRENT),
            });
        }
        return result;
    }
    decodeInfoData(payload) {
        const obj = this.decodePayload("APPInformationData", "APPInfoDataReqDTO", payload);
        const result = {
            dtuSn: obj.dtuSerialNumber || "",
            timestamp: num(obj.timestamp),
            deviceNumber: num(obj.deviceNumber),
            pvNumber: num(obj.pvNumber),
            dtuInfo: null,
            pvInfo: [],
        };
        if (obj.dtuInfo) {
            const di = obj.dtuInfo;
            result.dtuInfo = {
                deviceKind: num(di.deviceKind),
                swVersion: num(di.dtuSwVersion),
                hwVersion: num(di.dtuHwVersion),
                signalStrength: num(di.signalStrength),
                errorCode: num(di.dtuErrorCode),
                dfs: num(di.dfs),
                encRand: di.encRand || null,
                type: num(di.type),
                dtuStepTime: num(di.dtuStepTime),
                dtuRfHwVersion: num(di.dtuRfHwVersion),
                dtuRfSwVersion: num(di.dtuRfSwVersion),
                accessModel: num(di.accessModel),
                communicationTime: num(di.communicationTime),
                wifiVersion: di.wifiVersion || "",
                dtu485Mode: num(di.dtu485Mode),
                sub1gFrequencyBand: num(di.sub1gFrequencyBand),
            };
        }
        for (const pv of arr(obj.pvInfo)) {
            result.pvInfo.push({
                kind: num(pv.pvKind),
                sn: serialToHex(pv.pvSn),
                hwVersion: num(pv.pvHwVersion),
                swVersion: num(pv.pvSwVersion),
                gridVersion: num(pv.pvGridVersion),
                bootVersion: num(pv.pvBootVersion),
            });
        }
        return result;
    }
    decodeGetConfig(payload) {
        const obj = this.decodePayload("GetConfig", "GetConfigReqDTO", payload);
        const ipAddr = formatIpv4(obj.ipAddr_0, obj.ipAddr_1, obj.ipAddr_2, obj.ipAddr_3);
        const subnetMask = formatIpv4(obj.subnetMask_0, obj.subnetMask_1, obj.subnetMask_2, obj.subnetMask_3);
        const gateway = formatIpv4(obj.defaultGateway_0, obj.defaultGateway_1, obj.defaultGateway_2, obj.defaultGateway_3);
        const wifiIp = formatIpv4(obj.wifiIpAddr_0, obj.wifiIpAddr_1, obj.wifiIpAddr_2, obj.wifiIpAddr_3);
        const mac = formatMac(obj.mac_0, obj.mac_1, obj.mac_2, obj.mac_3, obj.mac_4, obj.mac_5);
        const wifiMac = formatMac(obj.wifiMac_0, obj.wifiMac_1, obj.wifiMac_2, obj.wifiMac_3, obj.wifiMac_4, obj.wifiMac_5);
        return {
            limitPower: num(obj.limitPowerMypower),
            zeroExportEnable: num(obj.zeroExportEnable),
            zeroExport433Addr: num(obj.zeroExport_433Addr),
            meterKind: obj.meterKind || "",
            meterInterface: obj.meterInterface || "",
            serverSendTime: num(obj.serverSendTime),
            wifiRssi: num(obj.wifiRssi),
            serverPort: num(obj.serverport),
            serverDomain: obj.serverDomainName || "",
            wifiSsid: obj.wifiSsid || "",
            dtuSn: obj.dtuSn || "",
            dhcpSwitch: num(obj.dhcpSwitch),
            invType: num(obj.invType),
            netmodeSelect: num(obj.netmodeSelect),
            channelSelect: num(obj.channelSelect),
            sub1gSweepSwitch: num(obj.sub1gSweepSwitch),
            sub1gWorkChannel: num(obj.sub1gWorkChannel),
            dtuApSsid: obj.dtuApSsid || "",
            ipAddress: ipAddr,
            subnetMask: subnetMask,
            gateway: gateway,
            wifiIpAddress: wifiIp,
            macAddress: mac,
            wifiMacAddress: wifiMac,
        };
    }
    decodeAlarmData(payload) {
        const obj = this.decodePayload("AlarmData", "WInfoReqDTO", payload);
        const alarms = [];
        for (const w of arr(obj.mWInfo)) {
            alarms.push({
                sn: serialToHex(w.pvSn),
                code: num(w.WCode),
                num: num(w.WNum),
                startTime: num(w.WTime1),
                endTime: num(w.WTime2),
                data1: num(w.WData1),
                data2: num(w.WData2),
            });
        }
        return {
            dtuSn: obj.dtuSn || "",
            timestamp: num(obj.time),
            alarms,
        };
    }
    decodeHistPower(payload) {
        const obj = this.decodePayload("AppGetHistPower", "AppGetHistPowerReqDTO", payload);
        return {
            serialNumber: serialToHex(obj.serialNumber),
            powerArray: obj.powerArray || [],
            totalEnergy: num(obj.totalEnergy),
            dailyEnergy: num(obj.dailyEnergy),
            stepTime: num(obj.stepTime),
            startTime: num(obj.startTime),
            relativePower: num(obj.relativePower),
            warningNumber: num(obj.warningNumber),
        };
    }
    decodeWarnData(payload) {
        const obj = this.decodePayload("WarnData", "WarnReqDTO", payload);
        const warnings = [];
        for (const w of arr(obj.warns)) {
            const code = num(w.code);
            warnings.push({
                sn: serialToHex(w.pvSn),
                code,
                num: num(w.num),
                startTime: num(w.sTime),
                endTime: num(w.eTime),
                data1: num(w.wData1),
                data2: num(w.wData2),
                descriptionEn: getAlarmDescription(code, "en"),
                descriptionDe: getAlarmDescription(code, "de"),
            });
        }
        return {
            dtuSn: obj.dtuSn || "",
            timestamp: num(obj.time),
            packageNub: Math.max(num(obj.packageNub), 1),
            packageNow: num(obj.packageNow),
            warnDevice: num(obj.warnDevice),
            warnings,
        };
    }
    decodeEventData(payload) {
        const obj = this.decodePayload("EventData", "EventDataReqDTO", payload);
        const events = [];
        for (const e of arr(obj.miEvents)) {
            events.push({
                eventCode: num(e.eventCode),
                eventStatus: num(e.eventStatus),
                eventCount: num(e.eventCount),
                pvVoltage: scaled(e.pvVoltage, SCALE_VOLTAGE),
                gridVoltage: scaled(e.gridVoltage, SCALE_VOLTAGE),
                gridFrequency: scaled(e.gridFrequency, SCALE_FREQUENCY),
                gridPower: num(e.gridPower),
                temperature: scaled(s16(e.temperature), SCALE_TEMPERATURE),
                miId: `${num(e.miId)}`,
                startTimestamp: num(e.startTimestamp),
            });
        }
        return {
            offset: num(obj.offset),
            timestamp: num(obj.time),
            events,
        };
    }
}
export { ProtobufHandler, CMD, ACTION, HEADER_SIZE };
//# sourceMappingURL=protobufHandler.js.map