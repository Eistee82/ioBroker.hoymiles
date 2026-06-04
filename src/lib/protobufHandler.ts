import * as path from "node:path";
import protobuf from "protobufjs";
import { getAlarmDescription } from "./alarmCodes.js";
import { crc16 } from "./crc16.js";
import {
	DTU_TIME_OFFSET,
	HM_MAGIC_0,
	HM_MAGIC_1,
	SCALE_VOLTAGE,
	SCALE_POWER,
	SCALE_TEMPERATURE,
	SCALE_CURRENT,
	SCALE_FREQUENCY,
	SCALE_ENERGY,
	SCALE_POWER_FACTOR,
} from "./constants.js";
import { unixSeconds } from "./utils.js";
import type {
	RealDataResult,
	InfoDataResult,
	SetConfigFields,
	ConfigResult,
	AlarmEntry,
	AlarmDataResult,
	ParsedResponse,
	HistPowerResult,
	WarnEntry,
	WarnDataResult,
	EventEntry,
	EventDataResult,
} from "./protobufTypes.js";

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function formatVersion(n: number, majorDiv: number, minorDiv: number, minorMod: number, patchMod: number): string {
	return `V${pad2(Math.floor(n / majorDiv))}.${pad2(Math.floor(n / minorDiv) % minorMod)}.${pad2(n % patchMod)}`;
}

/**
 * Format DTU version: major=n//4096, minor=(n//256)%16, patch=n%256
 *
 * @param n - Raw version number
 */
export function formatDtuVersion(n: number): string {
	return formatVersion(n, 4096, 256, 16, 256);
}

/**
 * Format SW version: major=n//10000, minor=(n%10000)//100, patch=n%100
 *
 * @param n - Raw version number
 */
export function formatSwVersion(n: number): string {
	return formatVersion(n, 10000, 100, 100, 100);
}

/**
 * Format inverter FW version: major=n//2048, minor=(n//64)%32, patch=n%64
 *
 * @param n - Raw version number
 */
export function formatInvVersion(n: number): string {
	return formatVersion(n, 2048, 64, 32, 64);
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
	CLEAN_GROUNDING_FAULT: 10,
	LOCK: 12,
	UNLOCK: 13,
	PERFORMANCE_DATA_MODE: 33,
	CLEAN_WARN: 42,
	READ_MI_HU_WARN: 46,
	POWER_FACTOR_LIMIT: 47,
	REACTIVE_POWER_LIMIT: 48,
	ALARM_LIST: 50,
} as const;

const MAGIC = [HM_MAGIC_0, HM_MAGIC_1] as const;
const HEADER_SIZE = 10;
const SEQ_MAX = 60000;

// --- Helper functions to reduce repetition in decode methods ---

/**
 * Coerce unknown protobuf field to number, defaulting to 0.
 *
 * @param v - Unknown protobuf field value
 */
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0);

/**
 * Coerce unknown to iterable array of records, defaulting to empty.
 *
 * @param v - Unknown protobuf field value
 */
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/**
 * Coerce and scale a protobuf field by a divisor.
 *
 * @param v - Unknown protobuf field value
 * @param div - Divisor for scaling
 */
const scaled = (v: unknown, div: number): number => (div === 0 ? 0 : num(v) / div);

/**
 * Convert a numeric serial number to uppercase hex string.
 *
 * @param v - Numeric serial number
 */
const serialToHex = (v: unknown): string => (Number(v) || 0).toString(16).toUpperCase();

/**
 * Format 4 protobuf fields as an IPv4 address string.
 *
 * @param a - First octet
 * @param b - Second octet
 * @param c - Third octet
 * @param d - Fourth octet
 */
const formatIpv4 = (a: unknown, b: unknown, c: unknown, d: unknown): string =>
	[num(a), num(b), num(c), num(d)].join(".");

/**
 * Format 6 protobuf fields as a MAC address string.
 *
 * @param a - First byte
 * @param b - Second byte
 * @param c - Third byte
 * @param d - Fourth byte
 * @param e - Fifth byte
 * @param f - Sixth byte
 */
const formatMac = (a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown): string =>
	[a, b, c, d, e, f].map(v => num(v).toString(16).padStart(2, "0").toUpperCase()).join(":");

/**
 * Write a big-endian uint16 into a buffer at the given offset.
 *
 * @param buf - Target buffer
 * @param off - Byte offset
 * @param val - 16-bit unsigned value
 */
const writeU16BE = (buf: Buffer, off: number, val: number): void => {
	buf[off] = (val >> 8) & 0xff;
	buf[off + 1] = val & 0xff;
};

/** Handler for encoding and decoding Hoymiles protobuf messages. */
class ProtobufHandler {
	public protos: Record<string, protobuf.Root>;
	private seq: number;
	private cachedTimeStr: Uint8Array | null;
	private cachedTimeSec: number;
	private readonly types = new Map<string, protobuf.Type>();

	/** Create a new ProtobufHandler instance. */
	constructor() {
		this.protos = {};
		this.seq = 0;
		this.cachedTimeStr = null;
		this.cachedTimeSec = 0;
	}

	/**
	 * Get a cached protobuf type, falling back to dynamic lookup.
	 *
	 * @param proto - Proto file key
	 * @param name - Message type name
	 */
	getType(proto: string, name: string): protobuf.Type {
		const key = `${proto}.${name}`;
		let type = this.types.get(key);
		if (!type) {
			type = this.protos[proto].lookupType(name);
			this.types.set(key, type);
		}
		return type;
	}

	/**
	 * Generic decode helper: looks up type, validates size, decodes payload, returns plain object.
	 *
	 * @param proto - Proto file name
	 * @param name - DTO type name
	 * @param payload - Raw protobuf payload
	 */
	decodePayload(proto: string, name: string, payload: Buffer): Record<string, unknown> {
		const type = this.getType(proto, name);
		const msg = type.decode(payload);
		return type.toObject(msg, { longs: Number, defaults: true });
	}

	/** Get next sequence number (0-60000, wraps around like the app). */
	private nextSeq(): number {
		const current = this.seq;
		this.seq = current >= SEQ_MAX ? 0 : current + 1;
		return current;
	}

	/** Format timestamp as "YYYY-MM-DD HH:mm:ss" UTF-8 bytes (cached per second). */
	private formatTimeYmdHms(): Uint8Array {
		const sec = unixSeconds();
		if (this.cachedTimeStr && sec === this.cachedTimeSec) {
			return this.cachedTimeStr;
		}
		const now = new Date();
		const str =
			`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ` +
			`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
		this.cachedTimeStr = Buffer.from(str, "utf-8");
		this.cachedTimeSec = sec;
		return this.cachedTimeStr;
	}

	/** Load all protobuf definition files from the proto directory. */
	async loadProtos(): Promise<void> {
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

		// Pre-cache all known types for fast access during operation
		const typeSpecs: Array<[string, string]> = [
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

	/**
	 * Build a framed message with HM header.
	 *
	 * @param cmdHigh - High byte of command ID
	 * @param cmdLow - Low byte of command ID
	 * @param protobufPayload - The protobuf-encoded payload
	 * @param overrideSeq - Optional sequence number (uses internal counter if omitted)
	 * @returns Complete message buffer with header
	 */
	buildMessage(cmdHigh: number, cmdLow: number, protobufPayload: Uint8Array, overrideSeq?: number): Buffer {
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

	// --- Encode Requests ---

	/**
	 * Encode a RealDataNew request to send to the DTU.
	 *
	 * Note: Hoymiles protocol uses inverted naming — the app sends "ResDTO"
	 * (response) and the DTU replies with "ReqDTO" (request). This is correct
	 * despite the confusing naming convention.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 * @returns Framed message buffer
	 */
	encodeRealDataNewRequest(timestamp: number): Buffer {
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

	/**
	 * Encode an AppInfoData request message.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 * @returns Framed message buffer
	 */
	encodeInfoRequest(timestamp: number): Buffer {
		const ResDTO = this.getType("APPInformationData", "APPInfoDataResDTO");
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
		const ResDTO = this.getType("GetConfig", "GetConfigResDTO");
		const msg = ResDTO.create({
			offset: DTU_TIME_OFFSET,
			time: timestamp,
		});
		const payload = ResDTO.encode(msg).finish();
		return this.buildMessage(CMD.GET_CONFIG[0], CMD.GET_CONFIG[1], payload);
	}

	/**
	 * Generic helper to encode a CommandResDTO action message.
	 *
	 * @param action - ACTION constant
	 * @param timestamp - Unix timestamp in seconds
	 * @param data - Optional data string (e.g. "A:100,B:0,C:0\r")
	 * @param cmd - Command ID pair (default CMD.COMMAND, use CMD.COMMAND_CLOUD for cloud-routed)
	 * @param devKind - Device kind (default 1)
	 */
	private encodeCommandAction(
		action: number,
		timestamp: number,
		data?: string,
		cmd?: readonly [number, number],
		devKind = 1,
	): Buffer {
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

	/**
	 * Trigger alarm list request.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeAlarmTrigger(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.ALARM_LIST, timestamp, undefined, undefined, 0);
	}

	/**
	 * Request micro-inverter warning history.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeMiWarnRequest(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.READ_MI_HU_WARN, timestamp);
	}

	/**
	 * Set power limit percentage (2-100).
	 *
	 * @param percent - Power limit percentage
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeSetPowerLimit(percent: number, timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.LIMIT_POWER, timestamp, `A:${Math.round(percent * 10)},B:0,C:0\r`);
	}

	/**
	 * Turn inverter on.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeInverterOn(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.MI_START, timestamp, undefined, CMD.COMMAND_CLOUD);
	}

	/**
	 * Turn inverter off.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeInverterOff(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.MI_SHUTDOWN, timestamp, undefined, CMD.COMMAND_CLOUD);
	}

	/**
	 * Reboot inverter.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeInverterReboot(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.INV_REBOOT, timestamp, undefined, CMD.COMMAND_CLOUD);
	}

	/**
	 * Encode a SetConfig message to write DTU configuration.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 * @param config - Configuration fields to set
	 * @returns Framed message buffer
	 */
	encodeSetConfig(timestamp: number, config: Partial<SetConfigFields>): Buffer {
		const ResDTO = this.getType("SetConfig", "SetConfigResDTO");
		const msg = ResDTO.create({
			offset: DTU_TIME_OFFSET,
			time: timestamp,
			...config,
		});
		const payload = ResDTO.encode(msg).finish();
		return this.buildMessage(CMD.SET_CONFIG[0], CMD.SET_CONFIG[1], payload);
	}

	/**
	 * Encode a heartbeat message.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeHeartbeat(timestamp: number): Buffer {
		const ResDTO = this.getType("APPHeartbeatPB", "HBResDTO");
		const msg = ResDTO.create({
			offset: DTU_TIME_OFFSET,
			time: timestamp,
			timeYmdHms: this.formatTimeYmdHms(),
		});
		const payload = ResDTO.encode(msg).finish();
		return this.buildMessage(CMD.HEARTBEAT[0], CMD.HEARTBEAT[1], payload);
	}

	/**
	 * Reboot DTU.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeDtuReboot(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.DTU_REBOOT, timestamp, undefined, CMD.COMMAND_CLOUD);
	}

	/**
	 * Enable performance data mode for faster DTU internal updates.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodePerformanceDataMode(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.PERFORMANCE_DATA_MODE, timestamp);
	}

	/**
	 * Set power factor limit (-1.0 to -0.8 or 0.8 to 1.0).
	 *
	 * @param value - Power factor value
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodePowerFactorLimit(value: number, timestamp: number): Buffer {
		return this.encodeCommandAction(
			ACTION.POWER_FACTOR_LIMIT,
			timestamp,
			`A:${Math.round(value * 1000)},B:0,C:0\r`,
		);
	}

	/**
	 * Set reactive power angle (-50 to +50 degrees).
	 *
	 * @param degrees - Reactive power angle
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeReactivePowerLimit(degrees: number, timestamp: number): Buffer {
		return this.encodeCommandAction(
			ACTION.REACTIVE_POWER_LIMIT,
			timestamp,
			`A:${Math.round(degrees * 10)},B:0,C:0\r`,
		);
	}

	/**
	 * Clear warning history.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeCleanWarnings(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.CLEAN_WARN, timestamp);
	}

	/**
	 * Clear grounding fault.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeCleanGroundingFault(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.CLEAN_GROUNDING_FAULT, timestamp);
	}

	/**
	 * Lock inverter (prevent operation).
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeLockInverter(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.LOCK, timestamp, undefined, CMD.COMMAND_CLOUD);
	}

	/**
	 * Unlock inverter (allow operation).
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeUnlockInverter(timestamp: number): Buffer {
		return this.encodeCommandAction(ACTION.UNLOCK, timestamp, undefined, CMD.COMMAND_CLOUD);
	}

	/**
	 * Encode an AutoSearch request to discover connected inverters.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 */
	encodeAutoSearch(timestamp: number): Buffer {
		const ResDTO = this.getType("AutoSearch", "AutoSearchResDTO");
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
	 * @param currentPackage - Package index to request (0-based; for chunked grid-profile reads)
	 */
	encodeDevConfigFetch(timestamp: number, dtuSn: string, devSn: string, currentPackage = 0): Buffer {
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

	// --- Cloud-relay downlink responses (DTU → cloud, 0x22 tags) ---
	// Used when the relay impersonates the DTU and must answer a server command itself.

	/**
	 * Encode the command acknowledgement the DTU sends after receiving an action command
	 * (cloud tag 0x22 0x05, `CommandReqDTO`).
	 *
	 * @param timestamp - Unix timestamp in seconds
	 * @param dtuSn - DTU serial number
	 * @param action - Action code being acknowledged (e.g. 41 = read grid profile)
	 * @param tid - Transaction id from the originating command
	 */
	encodeCloudCommandAck(timestamp: number, dtuSn: string, action: number, tid: number): Buffer {
		const ReqDTO = this.getType("CommandPB", "CommandReqDTO");
		const msg = ReqDTO.create({ dtuSn, time: timestamp, action, tid });
		return this.buildMessage(0x22, 0x05, ReqDTO.encode(msg).finish());
	}

	/**
	 * Encode the command-status message (cloud tag 0x22 0x06, `CommandStatusReqDTO`) the DTU
	 * sends while processing a command.
	 *
	 * @param timestamp - Unix timestamp in seconds
	 * @param dtuSn - DTU serial number
	 * @param action - Action code (e.g. 41 = read grid profile, 4 = report version)
	 * @param tid - Transaction id from the originating command
	 * @param miSnsSucs - Micro-inverter serials (as int64) the command succeeded for; the version
	 *   query (action 4) echoes the inverter here. Omit/empty for commands that don't report it.
	 */
	encodeCloudCommandStatus(
		timestamp: number,
		dtuSn: string,
		action: number,
		tid: number,
		miSnsSucs: number[] = [],
	): Buffer {
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

	/**
	 * Encode a device-config (grid-profile) upload (cloud tag 0x22 0x0e, `DevConfigFetchReqDTO`).
	 * The `data` blob must be little-endian (cloud byte order — see {@link byteSwap16}).
	 *
	 * @param timestamp - Unix timestamp in seconds
	 * @param dtuSn - DTU serial number
	 * @param devSn - Micro-inverter serial number
	 * @param tid - Transaction id from the originating command
	 * @param data - Little-endian grid-file blob
	 */
	encodeGridProfileResponse(timestamp: number, dtuSn: string, devSn: string, tid: number, data: Uint8Array): Buffer {
		const ReqDTO = this.getType("DevConfig", "DevConfigFetchReqDTO");
		const msg = ReqDTO.create({
			requestTime: timestamp,
			transactionId: tid,
			data,
			crc: crc16(data), // CRC-16/Modbus over the (little-endian) blob — matches the real DTU
			dtuSn,
			devSn,
			totalPackages: 1,
			currentPackage: 1,
		});
		return this.buildMessage(0x22, 0x0e, ReqDTO.encode(msg).finish());
	}

	// --- Decode Responses ---

	/**
	 * Decode a RealDataNew response payload.
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded real data result
	 */
	decodeRealDataNew(payload: Buffer): RealDataResult {
		const obj = this.decodePayload("RealDataNew", "RealDataNewReqDTO", payload);

		const result: RealDataResult = {
			dtuSn: (obj.deviceSerialNumber as string) || "",
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
				temperature: scaled(sgs.temperature, SCALE_TEMPERATURE),
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

	/**
	 * Decode an AppInfoData response payload.
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded info data result
	 */
	decodeInfoData(payload: Buffer): InfoDataResult {
		const obj = this.decodePayload("APPInformationData", "APPInfoDataReqDTO", payload);

		const result: InfoDataResult = {
			dtuSn: (obj.dtuSerialNumber as string) || "",
			timestamp: num(obj.timestamp),
			deviceNumber: num(obj.deviceNumber),
			pvNumber: num(obj.pvNumber),
			dtuInfo: null,
			pvInfo: [],
		};

		if (obj.dtuInfo) {
			const di = obj.dtuInfo as Record<string, unknown>;
			result.dtuInfo = {
				deviceKind: num(di.deviceKind),
				swVersion: num(di.dtuSwVersion),
				hwVersion: num(di.dtuHwVersion),
				signalStrength: num(di.signalStrength),
				errorCode: num(di.dtuErrorCode),
				dfs: num(di.dfs),
				encRand: (di.encRand as string) || null,
				type: num(di.type),
				dtuStepTime: num(di.dtuStepTime),
				dtuRfHwVersion: num(di.dtuRfHwVersion),
				dtuRfSwVersion: num(di.dtuRfSwVersion),
				accessModel: num(di.accessModel),
				communicationTime: num(di.communicationTime),
				wifiVersion: (di.wifiVersion as string) || "",
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

	/**
	 * Decode a GetConfig response payload.
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded config result
	 */
	decodeGetConfig(payload: Buffer): ConfigResult {
		const obj = this.decodePayload("GetConfig", "GetConfigReqDTO", payload);

		const ipAddr = formatIpv4(obj.ipAddr_0, obj.ipAddr_1, obj.ipAddr_2, obj.ipAddr_3);
		const subnetMask = formatIpv4(obj.subnetMask_0, obj.subnetMask_1, obj.subnetMask_2, obj.subnetMask_3);
		const gateway = formatIpv4(
			obj.defaultGateway_0,
			obj.defaultGateway_1,
			obj.defaultGateway_2,
			obj.defaultGateway_3,
		);
		const wifiIp = formatIpv4(obj.wifiIpAddr_0, obj.wifiIpAddr_1, obj.wifiIpAddr_2, obj.wifiIpAddr_3);
		const mac = formatMac(obj.mac_0, obj.mac_1, obj.mac_2, obj.mac_3, obj.mac_4, obj.mac_5);
		const wifiMac = formatMac(
			obj.wifiMac_0,
			obj.wifiMac_1,
			obj.wifiMac_2,
			obj.wifiMac_3,
			obj.wifiMac_4,
			obj.wifiMac_5,
		);

		return {
			limitPower: num(obj.limitPowerMypower),
			zeroExportEnable: num(obj.zeroExportEnable),
			zeroExport433Addr: num(obj.zeroExport_433Addr),
			meterKind: (obj.meterKind as string) || "",
			meterInterface: (obj.meterInterface as string) || "",
			serverSendTime: num(obj.serverSendTime),
			wifiRssi: num(obj.wifiRssi),
			serverPort: num(obj.serverport),
			serverDomain: (obj.serverDomainName as string) || "",
			wifiSsid: (obj.wifiSsid as string) || "",
			dtuSn: (obj.dtuSn as string) || "",
			dhcpSwitch: num(obj.dhcpSwitch),
			invType: num(obj.invType),
			netmodeSelect: num(obj.netmodeSelect),
			channelSelect: num(obj.channelSelect),
			sub1gSweepSwitch: num(obj.sub1gSweepSwitch),
			sub1gWorkChannel: num(obj.sub1gWorkChannel),
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
		const obj = this.decodePayload("AlarmData", "WInfoReqDTO", payload);

		const alarms: AlarmEntry[] = [];
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
			dtuSn: (obj.dtuSn as string) || "",
			timestamp: num(obj.time),
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
		const obj = this.decodePayload("AppGetHistPower", "AppGetHistPowerReqDTO", payload);

		return {
			serialNumber: serialToHex(obj.serialNumber),
			powerArray: (obj.powerArray as number[]) || [],
			totalEnergy: num(obj.totalEnergy),
			dailyEnergy: num(obj.dailyEnergy),
			stepTime: num(obj.stepTime),
			startTime: num(obj.startTime),
			relativePower: num(obj.relativePower),
			warningNumber: num(obj.warningNumber),
		};
	}

	/**
	 * Decode a WarnData response payload (newer warning format).
	 *
	 * @param payload - The protobuf payload buffer
	 * @returns Decoded warning data result with alarm descriptions
	 */
	decodeWarnData(payload: Buffer): WarnDataResult {
		const obj = this.decodePayload("WarnData", "WarnReqDTO", payload);

		const warnings: WarnEntry[] = [];
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
			dtuSn: (obj.dtuSn as string) || "",
			timestamp: num(obj.time),
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
		const obj = this.decodePayload("EventData", "EventDataReqDTO", payload);

		const events: EventEntry[] = [];
		for (const e of arr(obj.miEvents)) {
			events.push({
				eventCode: num(e.eventCode),
				eventStatus: num(e.eventStatus),
				eventCount: num(e.eventCount),
				pvVoltage: scaled(e.pvVoltage, SCALE_VOLTAGE),
				gridVoltage: scaled(e.gridVoltage, SCALE_VOLTAGE),
				gridFrequency: scaled(e.gridFrequency, SCALE_FREQUENCY),
				gridPower: num(e.gridPower),
				temperature: scaled(e.temperature, SCALE_TEMPERATURE),
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
export type {
	SgsData,
	PvData,
	MeterData,
	RealDataResult,
	DtuInfo,
	PvInfo,
	InfoDataResult,
	SetConfigFields,
	ConfigResult,
	AlarmEntry,
	AlarmDataResult,
	ParsedResponse,
	HistPowerResult,
	WarnEntry,
	WarnDataResult,
	EventEntry,
	EventDataResult,
} from "./protobufTypes.js";
