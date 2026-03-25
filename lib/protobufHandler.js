"use strict";

const path = require("path");
const protobuf = require("protobufjs");

// Command IDs
const CMD = {
    REAL_DATA_NEW: [0xa3, 0x11],
    APP_INFO_DATA: [0xa3, 0x01],
    GET_CONFIG: [0xa3, 0x09],
    SET_CONFIG: [0xa3, 0x10],
    COMMAND: [0xa3, 0x05],
    ALARM_DATA: [0xa3, 0x04],
    HIST_POWER: [0xa3, 0x15],
    COMMAND_CLOUD: [0x23, 0x05],
    HEARTBEAT: [0xa3, 0x14],
};

// Action codes for CommandResDTO
const ACTION = {
    DTU_REBOOT: 1,
    INV_REBOOT: 3,
    MI_START: 6,
    MI_SHUTDOWN: 7,
    LIMIT_POWER: 8,
    UPGRADE_MI: 15,
    ALARM_LIST: 42,
};

const MAGIC = [0x48, 0x4d]; // "HM"
const FLAGS = [0x00, 0x01];
const HEADER_SIZE = 10;
const DTU_TIME_OFFSET = 28800;

class ProtobufHandler {
    constructor() {
        this.protos = {};
    }

    async loadProtos() {
        const protoDir = path.join(__dirname, "proto");
        const files = [
            "RealDataNew",
            "GetConfig",
            "SetConfig",
            "CommandPB",
            "AlarmData",
            "WarnData",
            "APPInformationData",
            "APPHeartbeatPB",
            "AppGetHistPower",
            "EventData",
            "NetworkInfo",
        ];

        for (const file of files) {
            const root = await protobuf.load(path.join(protoDir, `${file}.proto`));
            this.protos[file] = root;
        }
    }

    // CRC16 with polynomial 0x18005 (CRC-16/MODBUS)
    crc16(buffer) {
        let crc = 0xffff;
        for (const byte of buffer) {
            crc ^= byte;
            for (let i = 0; i < 8; i++) {
                if (crc & 1) {
                    crc = (crc >> 1) ^ 0xa001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc;
    }

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

    parseResponse(buffer) {
        if (buffer.length < HEADER_SIZE) return null;
        if (buffer[0] !== MAGIC[0] || buffer[1] !== MAGIC[1]) return null;

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

    encodeRealDataNewRequest(timestamp) {
        const ResDTO = this.protos.RealDataNew.lookupType("RealDataNewResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.REAL_DATA_NEW[0], CMD.REAL_DATA_NEW[1], payload);
    }

    encodeInfoRequest(timestamp) {
        const ResDTO = this.protos.APPInformationData.lookupType("APPInfoDataResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            offset: DTU_TIME_OFFSET,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.APP_INFO_DATA[0], CMD.APP_INFO_DATA[1], payload);
    }

    encodeGetConfigRequest(timestamp) {
        const ResDTO = this.protos.GetConfig.lookupType("GetConfigResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.GET_CONFIG[0], CMD.GET_CONFIG[1], payload);
    }

    encodeAlarmTrigger(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.ALARM_LIST,
            package_nub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND[0], CMD.COMMAND[1], payload);
    }

    encodeSetPowerLimit(percent, timestamp) {
        const limitValue = Math.round(percent * 10);
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.LIMIT_POWER,
            dev_kind: 1,
            package_nub: 1,
            tid: timestamp,
            data: `A:${limitValue},B:0,C:0\r`,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND[0], CMD.COMMAND[1], payload);
    }

    encodeInverterOn(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.MI_START,
            dev_kind: 1,
            package_nub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }

    encodeInverterOff(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.MI_SHUTDOWN,
            dev_kind: 1,
            package_nub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }

    encodeInverterReboot(timestamp) {
        const ResDTO = this.protos.CommandPB.lookupType("CommandResDTO");
        const msg = ResDTO.create({
            time: timestamp,
            action: ACTION.INV_REBOOT,
            dev_kind: 1,
            package_nub: 1,
            tid: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.COMMAND_CLOUD[0], CMD.COMMAND_CLOUD[1], payload);
    }

    encodeHistPowerRequest(timestamp) {
        const ResDTO = this.protos.AppGetHistPower.lookupType("AppGetHistPowerResDTO");
        const msg = ResDTO.create({
            offset: DTU_TIME_OFFSET,
            requested_time: timestamp,
        });
        const payload = ResDTO.encode(msg).finish();
        return this.buildMessage(CMD.HIST_POWER[0], CMD.HIST_POWER[1], payload);
    }

    // --- Decode Responses ---

    decodeRealDataNew(payload) {
        const ReqDTO = this.protos.RealDataNew.lookupType("RealDataNewReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });

        const result = {
            dtuSn: obj.device_serial_number || "",
            timestamp: obj.timestamp || 0,
            dtuPower: Number(obj.dtu_power) || 0,
            dtuDailyEnergy: Number(obj.dtu_daily_energy) || 0,
            sgs: [],
            pv: [],
            meter: [],
        };

        if (obj.sgs_data) {
            for (const sgs of obj.sgs_data) {
                result.sgs.push({
                    serialNumber: String(sgs.serial_number || ""),
                    firmwareVersion: sgs.firmware_version || 0,
                    voltage: (sgs.voltage || 0) / 10,
                    frequency: (sgs.frequency || 0) / 100,
                    activePower: sgs.active_power || 0,
                    reactivePower: sgs.reactive_power || 0,
                    current: (sgs.current || 0) / 100,
                    powerFactor: (sgs.power_factor || 0) / 1000,
                    temperature: (sgs.temperature || 0) / 10,
                    warningNumber: sgs.warning_number || 0,
                    crcChecksum: sgs.crc_checksum || 0,
                    linkStatus: sgs.link_status || 0,
                    powerLimit: (sgs.power_limit || 0) / 10,
                    modulationIndexSignal: sgs.modulation_index_signal || 0,
                });
            }
        }

        if (obj.pv_data) {
            for (const pv of obj.pv_data) {
                result.pv.push({
                    serialNumber: String(pv.serial_number || ""),
                    portNumber: pv.port_number || 0,
                    voltage: (pv.voltage || 0) / 10,
                    current: (pv.current || 0) / 100,
                    power: pv.power || 0,
                    energyTotal: pv.energy_total || 0,
                    energyDaily: pv.energy_daily || 0,
                    errorCode: pv.error_code || 0,
                });
            }
        }

        if (obj.meter_data) {
            for (const meter of obj.meter_data) {
                result.meter.push(meter);
            }
        }

        return result;
    }

    decodeInfoData(payload) {
        const ReqDTO = this.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });

        const result = {
            dtuSn: obj.dtu_serial_number || "",
            timestamp: obj.timestamp || 0,
            deviceNumber: obj.device_number || 0,
            pvNumber: obj.pv_number || 0,
            dtuInfo: null,
            pvInfo: [],
        };

        if (obj.dtu_info) {
            const di = obj.dtu_info;
            result.dtuInfo = {
                deviceKind: di.device_kind || 0,
                swVersion: di.dtu_sw_version || 0,
                hwVersion: di.dtu_hw_version || 0,
                signalStrength: di.signal_strength || 0,
                errorCode: di.dtu_error_code || 0,
                dfs: Number(di.dfs) || 0,
                encRand: di.enc_rand || null,
                type: di.type || 0,
            };
        }

        if (obj.pv_info) {
            for (const pv of obj.pv_info) {
                result.pvInfo.push({
                    kind: pv.pv_kind || 0,
                    sn: String(pv.pv_sn || ""),
                    hwVersion: pv.pv_hw_version || 0,
                    swVersion: pv.pv_sw_version || 0,
                    gridVersion: pv.pv_grid_version || 0,
                    bootVersion: pv.pv_boot_version || 0,
                });
            }
        }

        return result;
    }

    decodeGetConfig(payload) {
        const ReqDTO = this.protos.GetConfig.lookupType("GetConfigReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });

        return {
            limitPower: obj.limit_power_mypower || 0,
            zeroExportEnable: obj.zero_export_enable || 0,
            serverSendTime: obj.server_send_time || 0,
            wifiRssi: obj.wifi_rssi || 0,
            serverPort: obj.serverport || 0,
            serverDomain: obj.server_domain_name || "",
            wifiSsid: obj.wifi_ssid || "",
            dtuSn: obj.dtu_sn || "",
            dhcpSwitch: obj.dhcp_switch || 0,
            invType: obj.inv_type || 0,
        };
    }

    decodeAlarmData(payload) {
        const ReqDTO = this.protos.AlarmData.lookupType("WInfoReqDTO");
        const msg = ReqDTO.decode(payload);
        const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true });

        const alarms = [];
        if (obj.mWInfo) {
            for (const w of obj.mWInfo) {
                alarms.push({
                    sn: String(w.pv_sn || ""),
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
            dtuSn: obj.dtu_sn || "",
            timestamp: obj.time || 0,
            alarms,
        };
    }

    decodeHistPower(payload) {
        const ReqDTO = this.protos.AppGetHistPower.lookupType("AppGetHistPowerReqDTO");
        const msg = ReqDTO.decode(payload);
        return ReqDTO.toObject(msg, { longs: Number, defaults: true });
    }
}

ProtobufHandler.CMD = CMD;
ProtobufHandler.ACTION = ACTION;
ProtobufHandler.HEADER_SIZE = HEADER_SIZE;

module.exports = ProtobufHandler;
