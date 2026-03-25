import * as path from "node:path";
import * as protobuf from "protobufjs";
import { getAlarmDescription } from "./alarmCodes";

/**
 * Format DTU version: major=n//4096, minor=(n//256)%16, patch=n%256
 *
 * @param n - Raw version number
 */
export function formatDtuVersion(n: number): string {
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
export function formatSwVersion(n: number): string {
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
export function formatInvVersion(n: number): string {
	const major = Math.floor(n / 2048);
	const minor = Math.floor(n / 64) % 32;
	const patch = n % 64;
	return `V${String(major).padStart(2, "0")}.${String(minor).padStart(2, "0")}.${String(patch).padStart(2, "0")}`;
}

// Command IDs for requests (App -> DTU: 0xa3 prefix)
const CMD = {
	REAL_DATA_NEW: [0xa3, 0x11] as const,
	APP_INFO_DATA: [0xa3, 0x01] as const,
	GET_CONFIG: [0xa3, 0x09] as const,
	COMMAND: [0xa3, 0x05] as const,
	COMMAND_CLOUD: [0x23, 0x05] as const,
	SET_CONFIG: [0xa3, 0x10] as const,
	WARN_DATA: [0xa3, 0x04] as const,
	HIST_POWER: [0xa3, 0x15] as const,
	HIST_ED: [0xa3, 0x16] as const,
	HEARTBEAT: [0xa3, 0x02] as const,
	NETWORK_INFO: [0xa3, 0x14] as const,
	COMMAND_STATUS: [0xa3, 0x06] as const,
	AUTO_SEARCH: [0xa3, 0x13] as const,
	DEV_CONFIG_FETCH: [0xa3, 0x07] as const,
	DEV_CONFIG_PUT: [0xa3, 0x08] as const,
} as const;

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
} as const;

const MAGIC = [0x48, 0x4d] as const; // "HM"
const FLAGS = [0x00, 0x01] as const;
const HEADER_SIZE = 10;
const DTU_TIME_OFFSET = 28800;

interface SgsData {
	serialNumber: string;
	firmwareVersion: number;
	voltage: number;
	frequency: number;
	activePower: number;
	reactivePower: number;
	current: number;
	powerFactor: number;
	temperature: number;
	warningNumber: number;
	crcChecksum: number;
	linkStatus: number;
	powerLimit: number;
	modulationIndexSignal: number;
}

interface PvData {
	serialNumber: string;
	portNumber: number;
	voltage: number;
	current: number;
	power: number;
	energyTotal: number;
	energyDaily: number;
	errorCode: number;
}

interface MeterData {
	deviceType: number;
	serialNumber: string;
	phaseTotalPower: number;
	phaseAPower: number;
	phaseBPower: number;
	phaseCPower: number;
	powerFactorTotal: number;
	energyTotalPower: number;
	energyTotalConsumed: number;
	faultCode: number;
	voltagePhaseA: number;
	voltagePhaseB: number;
	voltagePhaseC: number;
	currentPhaseA: number;
	currentPhaseB: number;
	currentPhaseC: number;
}

interface RealDataResult {
	dtuSn: string;
	timestamp: number;
	dtuPower: number;
	dtuDailyEnergy: number;
	sgs: SgsData[];
	pv: PvData[];
	meter: MeterData[];
}

interface DtuInfo {
	deviceKind: number;
	swVersion: number;
	hwVersion: number;
	signalStrength: number;
	errorCode: number;
	dfs: number;
	encRand: string | null;
	type: number;
	dtuStepTime: number;
	dtuRfHwVersion: number;
	dtuRfSwVersion: number;
	accessModel: number;
	communicationTime: number;
	wifiVersion: string;
	dtu485Mode: number;
	sub1gFrequencyBand: number;
}

interface PvInfo {
	kind: number;
	sn: string;
	hwVersion: number;
	swVersion: number;
	gridVersion: number;
	bootVersion: number;
}

interface InfoDataResult {
	dtuSn: string;
	timestamp: number;
	deviceNumber: number;
	pvNumber: number;
	dtuInfo: DtuInfo | null;
	pvInfo: PvInfo[];
}

interface SetConfigFields {
	limitPowerMypower: number;
	zeroExportEnable: number;
	zeroExport_433Addr: number;
	meterKind: string;
	meterInterface: string;
	serverSendTime: number;
	serverport: number;
	serverDomainName: string;
	wifiSsid: string;
	wifiPassword: string;
}

interface ConfigResult {
	limitPower: number;
	zeroExportEnable: number;
	zeroExport433Addr: number;
	meterKind: string;
	meterInterface: string;
	serverSendTime: number;
	wifiRssi: number;
	serverPort: number;
	serverDomain: string;
	wifiSsid: string;
	dtuSn: string;
	dhcpSwitch: number;
	invType: number;
	netmodeSelect: number;
	channelSelect: number;
	sub1gSweepSwitch: number;
	sub1gWorkChannel: number;
	dtuApSsid: string;
	ipAddress: string;
	subnetMask: string;
	gateway: string;
	wifiIpAddress: string;
	macAddress: string;
	wifiMacAddress: string;
}

interface AlarmEntry {
	sn: string;
	code: number;
	num: number;
	startTime: number;
	endTime: number;
	data1: number;
	data2: number;
}

interface AlarmDataResult {
	dtuSn: string;
	timestamp: number;
	alarms: AlarmEntry[];
}

interface ParsedResponse {
	cmdHigh: number;
	cmdLow: number;
	payload: Buffer;
	totalLen: number;
}

interface HistPowerResult {
	serialNumber: string;
	powerArray: number[];
	totalEnergy: number;
	dailyEnergy: number;
	stepTime: number;
	startTime: number;
	relativePower: number;
	warningNumber: number;
}

interface WarnEntry {
	sn: string;
	code: number;
	num: number;
	startTime: number;
	endTime: number;
	data1: number;
	data2: number;
	descriptionEn: string;
	descriptionDe: string;
}

interface WarnDataResult {
	dtuSn: string;
	timestamp: number;
	warnings: WarnEntry[];
}

interface EventEntry {
	eventCode: number;
	eventStatus: number;
	eventCount: number;
	pvVoltage: number;
	gridVoltage: number;
	gridFrequency: number;
	gridPower: number;
	temperature: number;
	miId: string;
	startTimestamp: number;
}

interface EventDataResult {
	offset: number;
	timestamp: number;
	events: EventEntry[];
}

/** Handler for encoding and decoding Hoymiles protobuf messages. */
class ProtobufHandler {
	public protos: Record<string, protobuf.Root>;

	/** Create a new ProtobufHandler instance. */
	constructor() {
		this.protos = {};
	}

	/** Load all protobuf definition files from the proto directory. */
	async loadProtos(): Promise<void> {
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
	crc16(buffer: Uint8Array): number {
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

	/**
	 * Build a framed message with HM header.
	 *
	 * @param cmdHigh - High byte of command ID
	 * @param cmdLow - Low byte of command ID
	 * @param protobufPayload - The protobuf-encoded payload
	 * @returns Complete message buffer with header
	 */
	buildMessage(cmdHigh: number, cmdLow: number, protobufPayload: Uint8Array): Buffer {
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
	parseResponse(buffer: Buffer): ParsedResponse | null {
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
	encodeRealDataNewRequest(timestamp: number): Buffer {
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
	encodeInfoRequest(timestamp: number): Buffer {
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
	encodeGetConfigRequest(timestamp: number): Buffer {
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
	encodeAlarmTrigger(timestamp: number): Buffer {
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
	encodeSetPowerLimit(percent: number, timestamp: number): Buffer {
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
	encodeInverterOn(timestamp: number): Buffer {
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
	encodeInverterOff(timestamp: number): Buffer {
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
	encodeInverterReboot(timestamp: number): Buffer {
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
	encodeSetConfig(timestamp: number, config: Partial<SetConfigFields>): Buffer {
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
	encodeHistPowerRequest(): Buffer {
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
	encodeHeartbeat(timestamp: number): Buffer {
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
	encodeNetworkInfoRequest(timestamp: number): Buffer {
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
	encodeDtuReboot(timestamp: number): Buffer {
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
	encodePerformanceDataMode(timestamp: number): Buffer {
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
	encodeAutoSearch(timestamp: number): Buffer {
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
	encodeDevConfigFetch(timestamp: number, dtuSn: string, devSn: string): Buffer {
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
	decodeRealDataNew(payload: Buffer): RealDataResult {
		const ReqDTO = this.protos.RealDataNew.lookupType("RealDataNewReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		const result: RealDataResult = {
			dtuSn: (obj.deviceSerialNumber as string) || "",
			timestamp: (obj.timestamp as number) || 0,
			dtuPower: (Number(obj.dtuPower) || 0) / 10,
			dtuDailyEnergy: Number(obj.dtuDailyEnergy) || 0,
			sgs: [],
			pv: [],
			meter: [],
		};

		if (obj.sgsData) {
			for (const sgs of obj.sgsData as Record<string, unknown>[]) {
				result.sgs.push({
					serialNumber: (Number(sgs.serialNumber) || 0).toString(16).toUpperCase(),
					firmwareVersion: (sgs.firmwareVersion as number) || 0,
					voltage: ((sgs.voltage as number) || 0) / 10,
					frequency: ((sgs.frequency as number) || 0) / 100,
					activePower: ((sgs.activePower as number) || 0) / 10,
					reactivePower: ((sgs.reactivePower as number) || 0) / 10,
					current: ((sgs.current as number) || 0) / 100,
					powerFactor: ((sgs.powerFactor as number) || 0) / 1000,
					temperature: ((sgs.temperature as number) || 0) / 10,
					warningNumber: (sgs.warningNumber as number) || 0,
					crcChecksum: (sgs.crcChecksum as number) || 0,
					linkStatus: (sgs.linkStatus as number) || 0,
					powerLimit: ((sgs.powerLimit as number) || 0) / 10,
					modulationIndexSignal: (sgs.modulationIndexSignal as number) || 0,
				});
			}
		}

		if (obj.pvData) {
			for (const pv of obj.pvData as Record<string, unknown>[]) {
				result.pv.push({
					serialNumber: (Number(pv.serialNumber) || 0).toString(16).toUpperCase(),
					portNumber: (pv.portNumber as number) || 0,
					voltage: ((pv.voltage as number) || 0) / 10,
					current: ((pv.current as number) || 0) / 100,
					power: ((pv.power as number) || 0) / 10,
					energyTotal: (pv.energyTotal as number) || 0,
					energyDaily: (pv.energyDaily as number) || 0,
					errorCode: (pv.errorCode as number) || 0,
				});
			}
		}

		if (obj.meterData) {
			for (const m of obj.meterData as Record<string, unknown>[]) {
				result.meter.push({
					deviceType: (m.deviceType as number) || 0,
					serialNumber: (Number(m.serialNumber) || 0).toString(16).toUpperCase(),
					phaseTotalPower: (m.phaseTotalPower as number) || 0,
					phaseAPower: (m.phase_APower as number) || 0,
					phaseBPower: (m.phase_BPower as number) || 0,
					phaseCPower: (m.phase_CPower as number) || 0,
					powerFactorTotal: ((m.powerFactorTotal as number) || 0) / 1000,
					energyTotalPower: ((m.energyTotalPower as number) || 0) / 100,
					energyTotalConsumed: ((m.energyTotalConsumed as number) || 0) / 100,
					faultCode: (m.faultCode as number) || 0,
					voltagePhaseA: ((m.voltagePhase_A as number) || 0) / 10,
					voltagePhaseB: ((m.voltagePhase_B as number) || 0) / 10,
					voltagePhaseC: ((m.voltagePhase_C as number) || 0) / 10,
					currentPhaseA: ((m.currentPhase_A as number) || 0) / 100,
					currentPhaseB: ((m.currentPhase_B as number) || 0) / 100,
					currentPhaseC: ((m.currentPhase_C as number) || 0) / 100,
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
	decodeInfoData(payload: Buffer): InfoDataResult {
		const ReqDTO = this.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		const result: InfoDataResult = {
			dtuSn: (obj.dtuSerialNumber as string) || "",
			timestamp: (obj.timestamp as number) || 0,
			deviceNumber: (obj.deviceNumber as number) || 0,
			pvNumber: (obj.pvNumber as number) || 0,
			dtuInfo: null,
			pvInfo: [],
		};

		if (obj.dtuInfo) {
			const di = obj.dtuInfo as Record<string, unknown>;
			result.dtuInfo = {
				deviceKind: (di.deviceKind as number) || 0,
				swVersion: (di.dtuSwVersion as number) || 0,
				hwVersion: (di.dtuHwVersion as number) || 0,
				signalStrength: (di.signalStrength as number) || 0,
				errorCode: (di.dtuErrorCode as number) || 0,
				dfs: Number(di.dfs) || 0,
				encRand: (di.encRand as string) || null,
				type: (di.type as number) || 0,
				dtuStepTime: (di.dtuStepTime as number) || 0,
				dtuRfHwVersion: (di.dtuRfHwVersion as number) || 0,
				dtuRfSwVersion: (di.dtuRfSwVersion as number) || 0,
				accessModel: (di.accessModel as number) || 0,
				communicationTime: (di.communicationTime as number) || 0,
				wifiVersion: (di.wifiVersion as string) || "",
				dtu485Mode: (di.dtu485Mode as number) || 0,
				sub1gFrequencyBand: (di.sub1gFrequencyBand as number) || 0,
			};
		}

		if (obj.pvInfo) {
			for (const pv of obj.pvInfo as Record<string, unknown>[]) {
				result.pvInfo.push({
					kind: (pv.pvKind as number) || 0,
					sn: (Number(pv.pvSn) || 0).toString(16).toUpperCase(),
					hwVersion: (pv.pvHwVersion as number) || 0,
					swVersion: (pv.pvSwVersion as number) || 0,
					gridVersion: (pv.pvGridVersion as number) || 0,
					bootVersion: (pv.pvBootVersion as number) || 0,
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
	decodeGetConfig(payload: Buffer): ConfigResult {
		const ReqDTO = this.protos.GetConfig.lookupType("GetConfigReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		const ipAddr = [obj.ipAddr_0, obj.ipAddr_1, obj.ipAddr_2, obj.ipAddr_3].map(v => (v as number) || 0).join(".");
		const subnetMask = [obj.subnetMask_0, obj.subnetMask_1, obj.subnetMask_2, obj.subnetMask_3]
			.map(v => (v as number) || 0)
			.join(".");
		const gateway = [obj.defaultGateway_0, obj.defaultGateway_1, obj.defaultGateway_2, obj.defaultGateway_3]
			.map(v => (v as number) || 0)
			.join(".");
		const wifiIp = [obj.wifiIpAddr_0, obj.wifiIpAddr_1, obj.wifiIpAddr_2, obj.wifiIpAddr_3]
			.map(v => (v as number) || 0)
			.join(".");
		const mac = [obj.mac_0, obj.mac_1, obj.mac_2, obj.mac_3, obj.mac_4, obj.mac_5]
			.map(v => ((v as number) || 0).toString(16).padStart(2, "0").toUpperCase())
			.join(":");
		const wifiMac = [obj.wifiMac_0, obj.wifiMac_1, obj.wifiMac_2, obj.wifiMac_3, obj.wifiMac_4, obj.wifiMac_5]
			.map(v => ((v as number) || 0).toString(16).padStart(2, "0").toUpperCase())
			.join(":");

		return {
			limitPower: (obj.limitPowerMypower as number) || 0,
			zeroExportEnable: (obj.zeroExportEnable as number) || 0,
			zeroExport433Addr: (obj.zeroExport_433Addr as number) || 0,
			meterKind: (obj.meterKind as string) || "",
			meterInterface: (obj.meterInterface as string) || "",
			serverSendTime: (obj.serverSendTime as number) || 0,
			wifiRssi: (obj.wifiRssi as number) || 0,
			serverPort: (obj.serverport as number) || 0,
			serverDomain: (obj.serverDomainName as string) || "",
			wifiSsid: (obj.wifiSsid as string) || "",
			dtuSn: (obj.dtuSn as string) || "",
			dhcpSwitch: (obj.dhcpSwitch as number) || 0,
			invType: (obj.invType as number) || 0,
			netmodeSelect: (obj.netmodeSelect as number) || 0,
			channelSelect: (obj.channelSelect as number) || 0,
			sub1gSweepSwitch: (obj.sub1gSweepSwitch as number) || 0,
			sub1gWorkChannel: (obj.sub1gWorkChannel as number) || 0,
			dtuApSsid: (obj.dtuApSsid as string) || "",
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
	decodeAlarmData(payload: Buffer): AlarmDataResult {
		const ReqDTO = this.protos.AlarmData.lookupType("WInfoReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		const alarms: AlarmEntry[] = [];
		if (obj.mWInfo) {
			for (const w of obj.mWInfo as Record<string, unknown>[]) {
				alarms.push({
					sn: (Number(w.pvSn) || 0).toString(16).toUpperCase(),
					code: (w.WCode as number) || 0,
					num: (w.WNum as number) || 0,
					startTime: (w.WTime1 as number) || 0,
					endTime: (w.WTime2 as number) || 0,
					data1: (w.WData1 as number) || 0,
					data2: (w.WData2 as number) || 0,
				});
			}
		}

		return {
			dtuSn: (obj.dtuSn as string) || "",
			timestamp: (obj.time as number) || 0,
			alarms,
		};
	}

	/**
	 * Decode a historical power data response payload.
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded historical power result
	 */
	decodeHistPower(payload: Buffer): HistPowerResult {
		const ReqDTO = this.protos.AppGetHistPower.lookupType("AppGetHistPowerReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		return {
			serialNumber: (Number(obj.serialNumber) || 0).toString(16).toUpperCase(),
			powerArray: (obj.powerArray as number[]) || [],
			totalEnergy: (obj.totalEnergy as number) || 0,
			dailyEnergy: (obj.dailyEnergy as number) || 0,
			stepTime: (obj.stepTime as number) || 0,
			startTime: (obj.startTime as number) || 0,
			relativePower: (obj.relativePower as number) || 0,
			warningNumber: (obj.warningNumber as number) || 0,
		};
	}

	/**
	 * Decode a WarnData response payload (newer warning format).
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded warning data result with alarm descriptions
	 */
	decodeWarnData(payload: Buffer): WarnDataResult {
		const ReqDTO = this.protos.WarnData.lookupType("WarnReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		const warnings: WarnEntry[] = [];
		if (obj.warns) {
			for (const w of obj.warns as Record<string, unknown>[]) {
				const code = (w.code as number) || 0;
				warnings.push({
					sn: (Number(w.pvSn) || 0).toString(16).toUpperCase(),
					code,
					num: (w.num as number) || 0,
					startTime: (w.sTime as number) || 0,
					endTime: (w.eTime as number) || 0,
					data1: (w.wData1 as number) || 0,
					data2: (w.wData2 as number) || 0,
					descriptionEn: getAlarmDescription(code, "en"),
					descriptionDe: getAlarmDescription(code, "de"),
				});
			}
		}

		return {
			dtuSn: (obj.dtuSn as string) || "",
			timestamp: (obj.time as number) || 0,
			warnings,
		};
	}

	/**
	 * Decode an EventData response payload.
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded event data result
	 */
	decodeEventData(payload: Buffer): EventDataResult {
		const ReqDTO = this.protos.EventData.lookupType("EventDataReqDTO");
		const msg = ReqDTO.decode(payload);
		const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

		const events: EventEntry[] = [];
		if (obj.miEvents) {
			for (const e of obj.miEvents as Record<string, unknown>[]) {
				events.push({
					eventCode: (e.eventCode as number) || 0,
					eventStatus: (e.eventStatus as number) || 0,
					eventCount: (e.eventCount as number) || 0,
					pvVoltage: ((e.pvVoltage as number) || 0) / 10,
					gridVoltage: ((e.gridVoltage as number) || 0) / 10,
					gridFrequency: ((e.gridFrequency as number) || 0) / 100,
					gridPower: (e.gridPower as number) || 0,
					temperature: ((e.temperature as number) || 0) / 10,
					miId: `${Number(e.miId) || 0}`,
					startTimestamp: (e.startTimestamp as number) || 0,
				});
			}
		}

		return {
			offset: (obj.offset as number) || 0,
			timestamp: (obj.time as number) || 0,
			events,
		};
	}
}

export { ProtobufHandler, CMD, ACTION, HEADER_SIZE };
export type {
	SgsData,
	PvData,
	MeterData,
	RealDataResult,
	DtuInfo,
	PvInfo,
	InfoDataResult,
	ConfigResult,
	AlarmEntry,
	AlarmDataResult,
	ParsedResponse,
	HistPowerResult,
	WarnEntry,
	WarnDataResult,
	EventEntry,
	EventDataResult,
};
