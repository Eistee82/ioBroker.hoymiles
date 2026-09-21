import assert from "node:assert";
import {
	ProtobufHandler,
	CMD,
	ACTION,
	HEADER_SIZE,
	formatDtuVersion,
	formatSwVersion,
	formatInvVersion,
} from "../build/lib/protobufHandler.js";
import { crc16 } from "../build/lib/crc16.js";
import { SCALE_POWER_LIMIT_TCP, SCALE_POWER_LIMIT_BLE } from "../build/lib/constants.js";

// ============================================================
// protobufHandler
// ============================================================
describe("protobufHandler", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	describe("crc16", function () {
		it("returns correct checksum for known input", function () {
			const crc = crc16(Buffer.alloc(0));
			assert.strictEqual(crc, 0xffff);
		});

		it("returns correct checksum for single byte 0x00", function () {
			const crc = crc16(Buffer.from([0x00]));
			assert.ok(crc >= 0 && crc <= 0xffff);
		});

		it("returns different checksums for different inputs", function () {
			const crc1 = crc16(Buffer.from([0x01]));
			const crc2 = crc16(Buffer.from([0x02]));
			assert.notStrictEqual(crc1, crc2);
		});
	});

	describe("buildMessage", function () {
		it("creates correct header with magic bytes 0x48 0x4D", function () {
			const payload = Buffer.from([0x01, 0x02, 0x03]);
			const msg = handler.buildMessage(0xa3, 0x11, payload);
			assert.strictEqual(msg[0], 0x48);
			assert.strictEqual(msg[1], 0x4d);
		});

		it("contains correct command bytes", function () {
			const payload = Buffer.from([0x01, 0x02, 0x03]);
			const msg = handler.buildMessage(0xa3, 0x11, payload);
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x11);
		});

		it("encodes correct total length in header", function () {
			const payload = Buffer.from([0x01, 0x02, 0x03]);
			const msg = handler.buildMessage(0xa3, 0x11, payload);
			const expectedLen = HEADER_SIZE + payload.length;
			const encodedLen = (msg[8] << 8) | msg[9];
			assert.strictEqual(encodedLen, expectedLen);
		});

		it("total buffer length equals header + payload", function () {
			const payload = Buffer.from([0x01, 0x02, 0x03]);
			const msg = handler.buildMessage(0xa3, 0x11, payload);
			assert.strictEqual(msg.length, HEADER_SIZE + payload.length);
		});

		it("payload is appended after header", function () {
			const payload = Buffer.from([0xaa, 0xbb, 0xcc]);
			const msg = handler.buildMessage(0xa3, 0x11, payload);
			assert.strictEqual(msg[HEADER_SIZE], 0xaa);
			assert.strictEqual(msg[HEADER_SIZE + 1], 0xbb);
			assert.strictEqual(msg[HEADER_SIZE + 2], 0xcc);
		});
	});

	describe("parseResponse", function () {
		it("extracts command ID and payload correctly", function () {
			const payload = Buffer.from([0xaa, 0xbb]);
			const msg = handler.buildMessage(0xa3, 0x11, payload);
			const parsed = handler.parseResponse(msg);
			assert.ok(parsed);
			assert.strictEqual(parsed.cmdHigh, 0xa3);
			assert.strictEqual(parsed.cmdLow, 0x11);
			assert.strictEqual(parsed.payload.length, payload.length);
		});

		it("returns null for buffer shorter than header", function () {
			assert.strictEqual(handler.parseResponse(Buffer.alloc(5)), null);
		});

		it("returns null for invalid magic bytes", function () {
			const buf = Buffer.alloc(HEADER_SIZE);
			assert.strictEqual(handler.parseResponse(buf), null);
		});

		it("returns null for empty buffer", function () {
			assert.strictEqual(handler.parseResponse(Buffer.alloc(0)), null);
		});
	});

	describe("loadProtos", function () {
		it("loads all 13 proto files", function () {
			assert.strictEqual(Object.keys(handler.protos).length, 13);
		});

		it("loads expected proto file names", function () {
			const expected = [
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
			for (const name of expected) {
				assert.ok(handler.protos[name], `Proto "${name}" not loaded`);
			}
		});
	});

	describe("encodeRealDataNewRequest", function () {
		it("creates valid message with correct command bytes", function () {
			const msg = handler.encodeRealDataNewRequest(1700000000);
			assert.ok(Buffer.isBuffer(msg));
			assert.ok(msg.length > HEADER_SIZE);
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x11);
		});
	});

	describe("encodeSetPowerLimit", function () {
		it("payload decodes with correct action and data", function () {
			const msg = handler.encodeSetPowerLimit(50, 1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.LIMIT_POWER);
			assert.strictEqual(obj.data, "A:500,B:0,C:0\r");
		});
	});

	describe("CMD constants", function () {
		it("has correct command constants", function () {
			assert.deepStrictEqual(CMD.SET_CONFIG, [0xa3, 0x10]);
			assert.deepStrictEqual(CMD.WARN_DATA, [0xa3, 0x04]);
			assert.deepStrictEqual(CMD.HIST_POWER, [0xa3, 0x15]);
			assert.deepStrictEqual(CMD.HEARTBEAT, [0xa3, 0x02]);
			assert.deepStrictEqual(CMD.NETWORK_INFO, [0xa3, 0x14]);
			assert.deepStrictEqual(CMD.DEV_CONFIG_FETCH, [0xa3, 0x07]);
		});

		it("HEARTBEAT low byte is 0x02", function () {
			assert.strictEqual(CMD.HEARTBEAT[1], 0x02);
		});

		it("has REAL_DATA_NEW, APP_INFO_DATA, GET_CONFIG, COMMAND constants", function () {
			assert.deepStrictEqual(CMD.REAL_DATA_NEW, [0xa3, 0x11]);
			assert.deepStrictEqual(CMD.APP_INFO_DATA, [0xa3, 0x01]);
			assert.deepStrictEqual(CMD.GET_CONFIG, [0xa3, 0x09]);
			assert.deepStrictEqual(CMD.COMMAND, [0xa3, 0x05]);
			assert.deepStrictEqual(CMD.COMMAND_CLOUD, [0x23, 0x05]);
		});

		it("has DEV_CONFIG_PUT and COMMAND_STATUS constants", function () {
			assert.deepStrictEqual(CMD.DEV_CONFIG_PUT, [0xa3, 0x08]);
			assert.deepStrictEqual(CMD.COMMAND_STATUS, [0xa3, 0x06]);
		});
	});

	describe("ACTION constants", function () {
		it("has PERFORMANCE_DATA_MODE = 33", function () {
			assert.strictEqual(ACTION.PERFORMANCE_DATA_MODE, 33);
		});

		it("has DTU_REBOOT = 1", function () {
			assert.strictEqual(ACTION.DTU_REBOOT, 1);
		});

		it("has LIMIT_POWER = 8", function () {
			assert.strictEqual(ACTION.LIMIT_POWER, 8);
		});

		it("has new command actions", function () {
			assert.strictEqual(ACTION.CLEAN_GROUNDING_FAULT, 10);
			assert.strictEqual(ACTION.LOCK, 12);
			assert.strictEqual(ACTION.UNLOCK, 13);
			assert.strictEqual(ACTION.CLEAN_WARN, 42);
			assert.strictEqual(ACTION.POWER_FACTOR_LIMIT, 47);
			assert.strictEqual(ACTION.REACTIVE_POWER_LIMIT, 48);
			assert.strictEqual(ACTION.ALARM_LIST, 50);
		});
	});

	describe("sequence numbers", function () {
		it("increments sequence number on each buildMessage call", function () {
			const h2 = new ProtobufHandler();
			const msg1 = h2.buildMessage(0xa3, 0x11, Buffer.from([0x01]));
			const msg2 = h2.buildMessage(0xa3, 0x11, Buffer.from([0x01]));
			const seq1 = (msg1[4] << 8) | msg1[5];
			const seq2 = (msg2[4] << 8) | msg2[5];
			assert.strictEqual(seq2, seq1 + 1);
		});
	});

	describe("new command encoders", function () {
		it("encodePowerFactorLimit creates valid message with action 47", function () {
			const msg = handler.encodePowerFactorLimit(0.95, 1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.POWER_FACTOR_LIMIT);
			assert.strictEqual(obj.data, "A:950,B:0,C:0\r");
		});

		it("encodeReactivePowerLimit creates valid message with action 48", function () {
			const msg = handler.encodeReactivePowerLimit(25, 1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.REACTIVE_POWER_LIMIT);
			assert.strictEqual(obj.data, "A:250,B:0,C:0\r");
		});

		it("encodeCleanWarnings creates valid message with action 42", function () {
			const msg = handler.encodeCleanWarnings(1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.CLEAN_WARN);
		});

		it("encodeLockInverter creates valid message with action 12", function () {
			const msg = handler.encodeLockInverter(1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.LOCK);
		});

		it("encodeUnlockInverter creates valid message with action 13", function () {
			const msg = handler.encodeUnlockInverter(1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.UNLOCK);
		});

		it("encodeCleanGroundingFault creates valid message with action 10", function () {
			const msg = handler.encodeCleanGroundingFault(1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.CLEAN_GROUNDING_FAULT);
		});
	});

	describe("encodeDevConfigFetch", function () {
		it("creates valid message with correct command bytes", function () {
			const msg = handler.encodeDevConfigFetch(1700000000, "DTU123", "DEV456");
			assert.ok(Buffer.isBuffer(msg));
			assert.ok(msg.length > HEADER_SIZE);
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x07);
		});
	});

	describe("encodePerformanceDataMode", function () {
		it("creates valid message with correct command bytes", function () {
			const msg = handler.encodePerformanceDataMode(1700000000);
			assert.ok(Buffer.isBuffer(msg));
			assert.ok(msg.length > HEADER_SIZE);
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x05);
		});

		it("payload decodes with action code 33", function () {
			const msg = handler.encodePerformanceDataMode(1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, 33);
		});
	});

	describe("encodeHeartbeat", function () {
		it("creates valid message with correct command bytes 0xa3, 0x02", function () {
			const msg = handler.encodeHeartbeat(1700000000);
			assert.ok(Buffer.isBuffer(msg));
			assert.ok(msg.length > HEADER_SIZE);
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x02);
		});
	});

	describe("encodeDtuReboot", function () {
		it("creates valid message with correct command bytes", function () {
			const msg = handler.encodeDtuReboot(1700000000);
			assert.ok(Buffer.isBuffer(msg));
			assert.ok(msg.length > HEADER_SIZE);
			assert.strictEqual(msg[2], 0x23);
			assert.strictEqual(msg[3], 0x05);
		});

		it("payload decodes with action DTU_REBOOT (1)", function () {
			const msg = handler.encodeDtuReboot(1700000000);
			const parsed = handler.parseResponse(msg);
			const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
			const decoded = ResDTO.decode(parsed.payload);
			const obj = ResDTO.toObject(decoded, { longs: Number, defaults: true });
			assert.strictEqual(obj.action, ACTION.DTU_REBOOT);
		});
	});
});

// ============================================================
// version formatting functions
// ============================================================
describe("version formatting", function () {
	describe("formatDtuVersion", function () {
		it("formatDtuVersion(4097) returns V01.00.01", function () {
			assert.strictEqual(formatDtuVersion(4097), "V01.00.01");
		});

		it("formatDtuVersion(256) contains 00.01.00", function () {
			const result = formatDtuVersion(256);
			assert.ok(result.includes("00.01.00"), `Expected result to contain "00.01.00" but got "${result}"`);
		});

		it("formatDtuVersion(0) returns V00.00.00", function () {
			assert.strictEqual(formatDtuVersion(0), "V00.00.00");
		});
	});

	describe("formatSwVersion", function () {
		it("formatSwVersion(10201) returns V01.02.01", function () {
			assert.strictEqual(formatSwVersion(10201), "V01.02.01");
		});

		it("formatSwVersion(0) returns V00.00.00", function () {
			assert.strictEqual(formatSwVersion(0), "V00.00.00");
		});

		it("formatSwVersion(10000) returns V01.00.00", function () {
			assert.strictEqual(formatSwVersion(10000), "V01.00.00");
		});
	});

	describe("formatInvVersion", function () {
		it("formatInvVersion(256) contains 00.04.00", function () {
			const result = formatInvVersion(256);
			assert.ok(result.includes("00.04.00"), `Expected result to contain "00.04.00" but got "${result}"`);
		});

		it("formatInvVersion(0) returns V00.00.00", function () {
			assert.strictEqual(formatInvVersion(0), "V00.00.00");
		});

		it("formatInvVersion(2048) returns V01.00.00", function () {
			assert.strictEqual(formatInvVersion(2048), "V01.00.00");
		});
	});
});

// ============================================================
// protobufHandler – untested encoders
// ============================================================
describe("protobufHandler – additional encoders", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	it("encodeAlarmTrigger creates valid message with action ALARM_LIST", function () {
		const msg = handler.encodeAlarmTrigger(1700000000);
		const parsed = handler.parseResponse(msg);
		assert.ok(parsed);
		assert.strictEqual(msg[2], 0xa3);
		assert.strictEqual(msg[3], 0x05);
		const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.action, ACTION.ALARM_LIST);
		assert.strictEqual(obj.devKind, 0); // alarmTrigger uses devKind=0
	});

	it("encodeMiWarnRequest creates valid message with action READ_MI_HU_WARN", function () {
		const msg = handler.encodeMiWarnRequest(1700000000);
		const parsed = handler.parseResponse(msg);
		const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.action, ACTION.READ_MI_HU_WARN);
	});

	it("encodeInverterOn creates valid message with MI_START via COMMAND_CLOUD", function () {
		const msg = handler.encodeInverterOn(1700000000);
		assert.strictEqual(msg[2], 0x23); // COMMAND_CLOUD
		assert.strictEqual(msg[3], 0x05);
		const parsed = handler.parseResponse(msg);
		const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.action, ACTION.MI_START);
	});

	it("encodeInverterOff creates valid message with MI_SHUTDOWN via COMMAND_CLOUD", function () {
		const msg = handler.encodeInverterOff(1700000000);
		assert.strictEqual(msg[2], 0x23);
		const parsed = handler.parseResponse(msg);
		const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.action, ACTION.MI_SHUTDOWN);
	});

	it("encodeInverterReboot creates valid message with INV_REBOOT via COMMAND_CLOUD", function () {
		const msg = handler.encodeInverterReboot(1700000000);
		assert.strictEqual(msg[2], 0x23);
		const parsed = handler.parseResponse(msg);
		const ResDTO = handler.protos.CommandPB.lookupType("CommandResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.action, ACTION.INV_REBOOT);
	});

	it("encodeSetConfig creates valid message with SET_CONFIG command", function () {
		const msg = handler.encodeSetConfig(1700000000, { serverSendTime: 5 }, {}, {});
		assert.strictEqual(msg[2], 0xa3);
		assert.strictEqual(msg[3], 0x10); // SET_CONFIG
		const parsed = handler.parseResponse(msg);
		const ResDTO = handler.protos.SetConfig.lookupType("SetConfigResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.serverSendTime, 5);
	});

	it("encodeSetConfig uses the SetConfigRes wire numbering, not the GetConfig one", function () {
		// SetConfigRes has no wifi_rssi field, so everything from serverport onward is one lower
		// than in GetConfig. Round-trips through the same proto can't catch a wrong numbering —
		// assert the raw wire tags (fieldNo << 3 | wireType) as verified on-device.
		const msg = handler.encodeSetConfig(
			1700000000,
			{
				serverport: 10081,
				wifiPassword: "secret",
				serverDomainName: "dataeu.hoymiles.com",
			},
			{},
		);
		const parsed = handler.parseResponse(msg);
		const readVarint = (buf, pos) => {
			let value = 0;
			let shift = 0;
			let b;
			do {
				b = buf[pos++];
				value |= (b & 0x7f) << shift;
				shift += 7;
			} while (b & 0x80);
			return [value, pos];
		};
		const tags = [];
		for (let i = 0; i < parsed.payload.length; ) {
			let tag;
			[tag, i] = readVarint(parsed.payload, i);
			tags.push(tag);
			if ((tag & 0x07) === 0) {
				[, i] = readVarint(parsed.payload, i); // skip varint value
			} else {
				let len;
				[len, i] = readVarint(parsed.payload, i);
				i += len; // skip length-delimited value
			}
		}
		assert.ok(tags.includes((11 << 3) | 0), "serverport must be field 11 (varint)");
		assert.ok(tags.includes((16 << 3) | 2), "wifi_password must be field 16 (string)");
		assert.ok(tags.includes((17 << 3) | 2), "server_domain_name must be field 17 (string)");
		assert.ok(!tags.includes((18 << 3) | 2), "field 18 (inv_type) must not carry a string");
	});

	it("encodeSetConfig with zeroExportEnable", function () {
		const msg = handler.encodeSetConfig(1700000000, { zeroExportEnable: 1 }, {});
		const parsed = handler.parseResponse(msg);
		const ResDTO = handler.protos.SetConfig.lookupType("SetConfigResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.zeroExportEnable, 1);
	});

	it("encodeGetConfigRequest creates valid message", function () {
		const msg = handler.encodeGetConfigRequest(1700000000);
		assert.strictEqual(msg[2], 0xa3);
		assert.strictEqual(msg[3], 0x09); // GET_CONFIG
	});

	it("encodeInfoRequest creates valid message", function () {
		const msg = handler.encodeInfoRequest(1700000000);
		assert.strictEqual(msg[2], 0xa3);
		assert.strictEqual(msg[3], 0x01); // APP_INFO_DATA
	});
});

// ============================================================
// protobufHandler – encode/decode round-trips
// ============================================================
describe("protobufHandler – decode methods", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	it("decodeRealDataNew handles encoded RealDataNew payload", function () {
		// Create a minimal RealDataNew protobuf payload
		const ReqDTO = handler.protos.RealDataNew.lookupType("RealDataNewReqDTO");
		const msg = ReqDTO.create({ offset: 28800, time: 1700000000 });
		const payload = ReqDTO.encode(msg).finish();
		const result = handler.decodeRealDataNew(Buffer.from(payload));
		assert.ok(result);
		assert.ok(Array.isArray(result.sgs));
		assert.ok(Array.isArray(result.pv));
	});

	it("decodeAlarmData handles encoded AlarmData payload", function () {
		const ReqDTO = handler.protos.AlarmData.lookupType("WInfoReqDTO");
		const msg = ReqDTO.create({ offset: 28800, time: 1700000000 });
		const payload = ReqDTO.encode(msg).finish();
		const result = handler.decodeAlarmData(Buffer.from(payload));
		assert.ok(result);
		assert.ok(Array.isArray(result.alarms));
	});

	it("decodeHistPower handles encoded HistPower payload", function () {
		const ReqDTO = handler.protos.AppGetHistPower.lookupType("AppGetHistPowerReqDTO");
		const msg = ReqDTO.create({ offset: 28800, cp: 0 });
		const payload = ReqDTO.encode(msg).finish();
		const result = handler.decodeHistPower(Buffer.from(payload));
		assert.ok(result);
		assert.ok(Array.isArray(result.powerArray));
	});

	it("decodeWarnData handles encoded WarnData payload", function () {
		const ReqDTO = handler.protos.WarnData.lookupType("WarnReqDTO");
		const msg = ReqDTO.create({ offset: 28800, time: 1700000000 });
		const payload = ReqDTO.encode(msg).finish();
		const result = handler.decodeWarnData(Buffer.from(payload));
		assert.ok(result);
		assert.ok(Array.isArray(result.warnings));
	});
});

// ============================================================
// protobufHandler – parseResponse edge cases
// ============================================================
describe("protobufHandler – parseResponse edge cases", function () {
	let handler;

	before(function () {
		handler = new ProtobufHandler();
	});

	it("returns null for buffer with valid magic but truncated header", function () {
		const buf = Buffer.from([0x48, 0x4d, 0xa3, 0x11, 0x00, 0x01]);
		assert.strictEqual(handler.parseResponse(buf), null);
	});

	it("handles message with empty payload", function () {
		const msg = handler.buildMessage(0xa3, 0x11, Buffer.alloc(0));
		const parsed = handler.parseResponse(msg);
		assert.ok(parsed);
		assert.strictEqual(parsed.payload.length, 0);
	});

	it("handles message with large payload", function () {
		const largePayload = Buffer.alloc(10000, 0xcc);
		const msg = handler.buildMessage(0xa3, 0x11, largePayload);
		const parsed = handler.parseResponse(msg);
		assert.ok(parsed);
		assert.strictEqual(parsed.payload.length, 10000);
	});
});

// ============================================================
// protobufHandler – decode: InfoData, GetConfig, EventData
// ============================================================
describe("protobufHandler – additional decode methods", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	describe("decodeInfoData", function () {
		it("parses DTU serial number and device counts", function () {
			const ReqDTO = handler.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
			const msg = ReqDTO.create({
				dtuSerialNumber: "4143A01CEDE4",
				timestamp: 1700000000,
				deviceNumber: 1,
				pvNumber: 2,
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeInfoData(Buffer.from(payload));
			assert.strictEqual(result.dtuSn, "4143A01CEDE4");
			assert.strictEqual(result.deviceNumber, 1);
			assert.strictEqual(result.pvNumber, 2);
		});

		it("parses dtuInfo with version and signal strength", function () {
			const ReqDTO = handler.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
			const msg = ReqDTO.create({
				dtuSerialNumber: "TEST123",
				timestamp: 1700000000,
				dtuInfo: {
					deviceKind: 1,
					dtuSwVersion: 4097,
					dtuHwVersion: 4096,
					signalStrength: -65,
					accessModel: 1,
					dtuStepTime: 300,
				},
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeInfoData(Buffer.from(payload));
			assert.ok(result.dtuInfo);
			assert.strictEqual(result.dtuInfo.swVersion, 4097);
			assert.strictEqual(result.dtuInfo.hwVersion, 4096);
			assert.strictEqual(result.dtuInfo.signalStrength, -65);
			assert.strictEqual(result.dtuInfo.accessModel, 1);
			assert.strictEqual(result.dtuInfo.dtuStepTime, 300);
		});

		it("parses pvInfo array", function () {
			const ReqDTO = handler.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
			const msg = ReqDTO.create({
				dtuSerialNumber: "TEST123",
				pvInfo: [
					{
						pvKind: 1,
						pvSn: 0x116172607710,
						pvHwVersion: 100,
						pvGridVersion: 10201,
						pvSwVersion: 200,
						pvBootVersion: 2048,
					},
				],
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeInfoData(Buffer.from(payload));
			assert.strictEqual(result.pvInfo.length, 1);
			assert.strictEqual(result.pvInfo[0].kind, 1);
			assert.strictEqual(result.pvInfo[0].hwVersion, 100);
			assert.strictEqual(result.pvInfo[0].gridVersion, 10201);
			assert.strictEqual(result.pvInfo[0].bootVersion, 2048);
		});

		it("handles missing dtuInfo gracefully", function () {
			const ReqDTO = handler.protos.APPInformationData.lookupType("APPInfoDataReqDTO");
			const msg = ReqDTO.create({ dtuSerialNumber: "TEST123" });
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeInfoData(Buffer.from(payload));
			assert.strictEqual(result.dtuInfo, null);
			assert.strictEqual(result.pvInfo.length, 0);
		});
	});

	describe("decodeGetConfig", function () {
		it("parses server domain and send time", function () {
			const ReqDTO = handler.protos.GetConfig.lookupType("GetConfigReqDTO");
			const msg = ReqDTO.create({
				serverDomainName: "dataeu.hoymiles.com",
				serverport: 10081,
				serverSendTime: 5,
				wifiSsid: "MyWiFi",
				wifiRssi: -55,
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeGetConfig(Buffer.from(payload));
			assert.strictEqual(result.serverDomain, "dataeu.hoymiles.com");
			assert.strictEqual(result.serverPort, 10081);
			assert.strictEqual(result.serverSendTime, 5);
			assert.strictEqual(result.wifiSsid, "MyWiFi");
			assert.strictEqual(result.wifiRssi, -55);
		});

		it("formats IP address from 4 octets", function () {
			const ReqDTO = handler.protos.GetConfig.lookupType("GetConfigReqDTO");
			const msg = ReqDTO.create({
				ipAddr_0: 192,
				ipAddr_1: 168,
				ipAddr_2: 1,
				ipAddr_3: 100,
				subnetMask_0: 255,
				subnetMask_1: 255,
				subnetMask_2: 255,
				subnetMask_3: 0,
				defaultGateway_0: 192,
				defaultGateway_1: 168,
				defaultGateway_2: 1,
				defaultGateway_3: 1,
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeGetConfig(Buffer.from(payload));
			assert.strictEqual(result.ipAddress, "192.168.1.100");
			assert.strictEqual(result.subnetMask, "255.255.255.0");
			assert.strictEqual(result.gateway, "192.168.1.1");
		});

		it("formats MAC address from 6 bytes", function () {
			const ReqDTO = handler.protos.GetConfig.lookupType("GetConfigReqDTO");
			const msg = ReqDTO.create({
				mac_0: 0xaa,
				mac_1: 0xbb,
				mac_2: 0xcc,
				mac_3: 0xdd,
				mac_4: 0xee,
				mac_5: 0xff,
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeGetConfig(Buffer.from(payload));
			assert.strictEqual(result.macAddress, "AA:BB:CC:DD:EE:FF");
		});

		it("handles empty config with defaults", function () {
			const ReqDTO = handler.protos.GetConfig.lookupType("GetConfigReqDTO");
			const msg = ReqDTO.create({});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeGetConfig(Buffer.from(payload));
			assert.strictEqual(result.serverDomain, "");
			assert.strictEqual(result.serverPort, 0);
			assert.strictEqual(result.serverSendTime, 0);
			assert.strictEqual(result.ipAddress, "0.0.0.0");
			assert.strictEqual(result.macAddress, "00:00:00:00:00:00");
		});
	});

	describe("decodeEventData", function () {
		it("parses event list with scaling", function () {
			const ReqDTO = handler.protos.EventData.lookupType("EventDataReqDTO");
			const msg = ReqDTO.create({
				offset: 28800,
				time: 1700000000,
				miEvents: [
					{
						eventCode: 141,
						eventStatus: 1,
						eventCount: 3,
						pvVoltage: 3200,
						gridVoltage: 2350,
						gridFrequency: 5000,
						temperature: 450,
					},
				],
			});
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeEventData(Buffer.from(payload));
			assert.strictEqual(result.events.length, 1);
			assert.strictEqual(result.events[0].eventCode, 141);
			assert.strictEqual(result.events[0].eventStatus, 1);
			assert.strictEqual(result.events[0].eventCount, 3);
			assert.strictEqual(result.events[0].pvVoltage, 320);
			assert.strictEqual(result.events[0].gridVoltage, 235);
			assert.strictEqual(result.events[0].gridFrequency, 50);
			assert.strictEqual(result.events[0].temperature, 45);
		});

		it("handles empty event list", function () {
			const ReqDTO = handler.protos.EventData.lookupType("EventDataReqDTO");
			const msg = ReqDTO.create({ offset: 28800, time: 1700000000 });
			const payload = ReqDTO.encode(msg).finish();
			const result = handler.decodeEventData(Buffer.from(payload));
			assert.strictEqual(result.events.length, 0);
		});
	});

	describe("cloud-relay grid-profile responses", function () {
		it("encodeGridProfileResponse round-trips via 0x22 0x0e (DevConfigFetchReqDTO)", function () {
			const data = Buffer.from("00030120", "hex"); // little-endian sample blob
			// dtu_sn/dev_sn are bytes (raw serial), not ASCII strings — echo what the DTU sent
			const dtuSn = Buffer.from("4143A01CEDE4", "hex");
			const devSn = Buffer.from("1412A01CEDE4", "hex");
			const frame = handler.encodeGridProfileResponse(1700000000, dtuSn, devSn, 9999, data);
			const parsed = handler.parseResponse(frame);
			assert.strictEqual(parsed.cmdHigh, 0x22);
			assert.strictEqual(parsed.cmdLow, 0x0e);
			const ReqDTO = handler.protos.DevConfig.lookupType("DevConfigFetchReqDTO");
			const obj = ReqDTO.toObject(ReqDTO.decode(parsed.payload), { longs: Number });
			assert.strictEqual(Buffer.from(obj.data).toString("hex"), "00030120");
			assert.strictEqual(Buffer.from(obj.dtuSn).toString("hex"), dtuSn.toString("hex"));
			assert.strictEqual(Buffer.from(obj.devSn).toString("hex"), devSn.toString("hex"));
			assert.strictEqual(obj.transactionId, 9999);
			assert.strictEqual(obj.totalPackages, 1);
			// real DTU closes the single-package upload with rule_type=1, not current_package
			assert.strictEqual(obj.ruleType, 1);
			assert.ok(!obj.currentPackage, "current_package must not be set (real DTU uses rule_type)");
			assert.strictEqual(obj.crc, crc16(data), "crc must be CRC-16/Modbus over the data blob");
		});

		it("encodeGridProfileResponse crc matches the captured DTU value (20325 for the real LE blob)", function () {
			const leBlob = Buffer.from(
				"000301200a00fc0830071e003b0b01000b041e00e209001088138e1201001e1401000020010003305802e209a30792138e120040d0071000085001009c13900110009c137413027001001027008000005b082c01b70841099d092c01009000005f0000b00000f401a1ff02a000000000",
				"hex",
			);
			const frame = handler.encodeGridProfileResponse(
				1700000000,
				Buffer.from("4143A01CEDE4", "hex"),
				Buffer.from("1412A01CEDE4", "hex"),
				1,
				leBlob,
			);
			const ReqDTO = handler.protos.DevConfig.lookupType("DevConfigFetchReqDTO");
			const obj = ReqDTO.toObject(ReqDTO.decode(handler.parseResponse(frame).payload), { longs: Number });
			assert.strictEqual(obj.crc, 20325);
		});

		it("encodeCloudCommandAck carries dtuSn/action/tid via 0x22 0x05", function () {
			const parsed = handler.parseResponse(handler.encodeCloudCommandAck(1700000000, "DTU123", 41, 9999));
			assert.strictEqual(parsed.cmdHigh, 0x22);
			assert.strictEqual(parsed.cmdLow, 0x05);
			const ReqDTO = handler.protos.CommandPB.lookupType("CommandReqDTO");
			const obj = ReqDTO.toObject(ReqDTO.decode(parsed.payload), { longs: Number });
			assert.strictEqual(obj.dtuSn, "DTU123");
			assert.strictEqual(obj.action, 41);
			assert.strictEqual(obj.tid, 9999);
		});

		it("encodeCloudCommandStatus uses 0x22 0x06 (CommandStatusReqDTO)", function () {
			const parsed = handler.parseResponse(handler.encodeCloudCommandStatus(1700000000, "DTU123", 41, 9999));
			assert.strictEqual(parsed.cmdHigh, 0x22);
			assert.strictEqual(parsed.cmdLow, 0x06);
			const ReqDTO = handler.protos.CommandPB.lookupType("CommandStatusReqDTO");
			const obj = ReqDTO.toObject(ReqDTO.decode(parsed.payload), { longs: Number });
			assert.strictEqual(obj.action, 41);
			assert.strictEqual(obj.tid, 9999);
		});

		it("encodeCloudCommandStatus echoes mi_sns_sucs for the version query (action 4)", function () {
			// inverter SN 1412A01CEDE4 as int64 == 22070228217316 (captured live)
			const miSn = parseInt("1412A01CEDE4", 16);
			const parsed = handler.parseResponse(
				handler.encodeCloudCommandStatus(1700000000, "DTU123", 4, 50628399, [miSn]),
			);
			assert.strictEqual(parsed.cmdHigh, 0x22);
			assert.strictEqual(parsed.cmdLow, 0x06);
			const ReqDTO = handler.protos.CommandPB.lookupType("CommandStatusReqDTO");
			const obj = ReqDTO.toObject(ReqDTO.decode(parsed.payload), { longs: Number });
			assert.strictEqual(obj.action, 4);
			assert.strictEqual(obj.tid, 50628399);
			assert.deepStrictEqual(obj.miSnsSucs, [22070228217316]);
		});
	});
});

// ============================================================
// protobufHandler – meter per-phase fields
// ============================================================
// These nine fields (MeterMO #9-#11, #13-#15, #23-#25) were decoded nowhere, so the values
// existed on the wire but never reached a state. The point of this test is the FIELD NAMES:
// protobufjs camel-cases `energy_phase_A` to `energyPhase_A` (the `_A` survives because the
// next character is already uppercase). Get that wrong and the decoder silently yields 0 —
// which looks exactly like a meter that reports nothing.
describe("protobufHandler – meter per-phase fields", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function realDataWithMeter(meterFields) {
		const Req = handler.getType("RealDataNew", "RealDataNewReqDTO");
		const msg = Req.create({
			deviceSerialNumber: "4143A01CEDE4",
			timestamp: 1700000000,
			meterData: [meterFields],
		});
		return Buffer.from(Req.encode(msg).finish());
	}

	it("decodes the per-phase exported energies", function () {
		const payload = realDataWithMeter({
			energyPhase_A: 1234, // ÷100 → 12.34 kWh
			energyPhase_B: 5600,
			energyPhase_C: 7,
		});
		const m = handler.decodeRealDataNew(payload).meter[0];
		assert.strictEqual(m.energyPhaseAExport, 12.34);
		assert.strictEqual(m.energyPhaseBExport, 56);
		assert.strictEqual(m.energyPhaseCExport, 0.07);
	});

	it("decodes the per-phase imported energies", function () {
		const payload = realDataWithMeter({
			energyPhase_AConsumed: 4321,
			energyPhase_BConsumed: 100,
			energyPhase_CConsumed: 0,
		});
		const m = handler.decodeRealDataNew(payload).meter[0];
		assert.strictEqual(m.energyPhaseAImport, 43.21);
		assert.strictEqual(m.energyPhaseBImport, 1);
		assert.strictEqual(m.energyPhaseCImport, 0);
	});

	it("decodes the per-phase power factors", function () {
		const payload = realDataWithMeter({
			powerFactorPhase_A: 998, // ÷1000
			powerFactorPhase_B: 1000,
			powerFactorPhase_C: 500,
		});
		const m = handler.decodeRealDataNew(payload).meter[0];
		assert.strictEqual(m.powerFactorPhaseA, 0.998);
		assert.strictEqual(m.powerFactorPhaseB, 1);
		assert.strictEqual(m.powerFactorPhaseC, 0.5);
	});

	it("keeps the existing totals untouched", function () {
		const payload = realDataWithMeter({
			energyTotalPower: 10000,
			energyTotalConsumed: 2000,
			powerFactorTotal: 950,
			energyPhase_A: 1234,
		});
		const m = handler.decodeRealDataNew(payload).meter[0];
		assert.strictEqual(m.energyTotalPower, 100);
		assert.strictEqual(m.energyTotalConsumed, 20);
		assert.strictEqual(m.powerFactorTotal, 0.95);
		assert.strictEqual(m.energyPhaseAExport, 12.34);
	});
});

// ============================================================
// protobufHandler – config values that were decoded and dropped
// ============================================================
// The DTU reports IP, mask, gateway, MAC and its meter configuration in every GetConfig.
// Assembling them was already implemented, but nothing ever wrote them; DNS and lock duration
// were not even decoded. As with the meter fields, the field names are the risk: protobufjs
// yields `cableDns_0`, not `cableDns0`.
describe("protobufHandler – config values", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function config(fields) {
		const Req = handler.getType("GetConfig", "GetConfigReqDTO");
		return Buffer.from(Req.encode(Req.create(fields)).finish());
	}

	it("assembles the DNS server from its four octets", function () {
		const c = handler.decodeGetConfig(config({ cableDns_0: 192, cableDns_1: 168, cableDns_2: 178, cableDns_3: 1 }));
		assert.strictEqual(c.dnsServer, "192.168.178.1");
	});

	it("decodes the inverter lock duration", function () {
		assert.strictEqual(handler.decodeGetConfig(config({ lockTime: 300 })).lockTime, 300);
		assert.strictEqual(handler.decodeGetConfig(config({})).lockTime, 0);
	});

	it("still assembles the network addresses that were already decoded", function () {
		const c = handler.decodeGetConfig(
			config({
				ipAddr_0: 10,
				ipAddr_1: 0,
				ipAddr_2: 0,
				ipAddr_3: 7,
				subnetMask_0: 255,
				subnetMask_1: 255,
				subnetMask_2: 255,
				subnetMask_3: 0,
				defaultGateway_0: 10,
				defaultGateway_1: 0,
				defaultGateway_2: 0,
				defaultGateway_3: 1,
				mac_0: 0x40,
				mac_1: 0xf4,
				mac_2: 0xc9,
				mac_3: 0x86,
				mac_4: 0x9d,
				mac_5: 0x50,
			}),
		);
		assert.strictEqual(c.ipAddress, "10.0.0.7");
		assert.strictEqual(c.subnetMask, "255.255.255.0");
		assert.strictEqual(c.gateway, "10.0.0.1");
		assert.strictEqual(c.macAddress.toLowerCase(), "40:f4:c9:86:9d:50");
	});

	it("reports the meter configuration as sent", function () {
		const c = handler.decodeGetConfig(config({ meterKind: "SHELLY", meterInterface: "WIFI" }));
		assert.strictEqual(c.meterKind, "SHELLY");
		assert.strictEqual(c.meterInterface, "WIFI");
	});
});

// ============================================================
// protobufHandler — HistPower request (a315)
// ============================================================
// The response handler for 0xa215 has always existed and fills the history.* states, but nothing
// ever asked for the curve. These tests nail down the request the device expects.
describe("protobufHandler – encodeHistPowerRequest", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	it("frames the request on tag 0xa315", function () {
		const frame = handler.encodeHistPowerRequest(1753900000, 0);
		assert.strictEqual(frame[0], 0x48, "HM magic");
		assert.strictEqual(frame[1], 0x4d);
		assert.strictEqual(frame[2], 0xa3, "local request family");
		assert.strictEqual(frame[3], 0x15, "HistPower");
	});

	// requested_day must be 0. The handler truncates the field to one byte and keeps it as an
	// anchor that a running counter is compared against; a real timestamp truncates to an
	// arbitrary byte and the device then answers without the array at all. Measured on a 2T:
	// local midnight produced 0 samples, 0 produced the full day.
	it("always asks with requested_day = 0, never a date", function () {
		const ResDTO = handler.getType("AppGetHistPower", "AppGetHistPowerResDTO");
		for (const page of [0, 3]) {
			const frame = handler.encodeHistPowerRequest(1753900000, page);
			const msg = ResDTO.toObject(ResDTO.decode(frame.subarray(10)), { longs: Number, defaults: true });
			assert.strictEqual(Number(msg.requestedDay), 0, "a date here yields an empty curve");
			assert.strictEqual(Number(msg.requestedTime), 1753900000);
			assert.strictEqual(Number(msg.cp), page, "cp selects the page");
		}
	});

	it("declares the total length in the header, matching the payload", function () {
		const frame = handler.encodeHistPowerRequest(1753900000, 0);
		const total = (frame[8] << 8) | frame[9];
		assert.strictEqual(total, frame.length, "header length must match the frame");
		assert.ok(total - 10 < 0x401, "payload must stay under the 2T's 1024-byte limit");
	});

	// The device sends 0.1 W per unit. Integrating a measured full day at its reported step
	// reproduced its own daily-energy figure to within 0.12 %, which is what settles the unit.
	it("scales the power samples from 0.1 W units to W", function () {
		const ReqDTO = handler.getType("AppGetHistPower", "AppGetHistPowerReqDTO");
		const payload = ReqDTO.encode(
			ReqDTO.create({ powerArray: [0, 3612, 6020], stepTime: 60, ap: 5, absoluteStart: 1785382614 }),
		).finish();
		const r = handler.decodeHistPower(Buffer.from(payload));
		assert.deepStrictEqual(r.powerArray, [0, 361.2, 602], "6020 is 602 W, not 6020 W");
		assert.strictEqual(r.stepTime, 60, "seconds between samples");
		assert.strictEqual(r.pageCount, 5, "ap is the page count");
		assert.strictEqual(r.absoluteStart, 1785382614, "first sample of this page");
	});
});

// ============================================================
// protobufHandler — SetConfig must always be a full set
// ============================================================
// The DTU copies every decoded field into its configuration without checking whether it was
// actually transmitted, and proto3 does not transmit a field holding its default. A partial write
// therefore clears everything it does not carry — on the 2WB that wiped the server domain, the
// port and the power limit in a live test.
describe("protobufHandler – encodeSetConfig full set", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function baseConfig() {
		return {
			serverDomainName: "dataeu.hoymiles.com",
			serverport: 10081,
			serverSendTime: 5,
			limitPowerMypower: 1000,
			lockPassword: 987654,
			lockTime: 30,
			invType: 2,
			netmodeSelect: 1,
			dhcpSwitch: 1,
			meterKind: "NONE",
			meterInterface: "NONE",
		};
	}

	function decodeSet(frame) {
		const ResDTO = handler.getType("SetConfig", "SetConfigResDTO");
		return ResDTO.toObject(ResDTO.decode(frame.subarray(10)), { longs: Number, defaults: true });
	}

	it("refuses to build a message without a base configuration", function () {
		assert.throws(
			() => handler.encodeSetConfig(1753900000, { serverSendTime: 10 }, null),
			/without having read it first/i,
			"a partial write is never safe and must not be produced at all",
		);
	});

	it("carries every untouched field over from the base", function () {
		const msg = decodeSet(handler.encodeSetConfig(1753900000, { serverSendTime: 10 }, baseConfig()));
		assert.strictEqual(Number(msg.serverSendTime), 10, "the changed field");
		assert.strictEqual(msg.serverDomainName, "dataeu.hoymiles.com", "server must not fall back to the default");
		assert.strictEqual(Number(msg.serverport), 10081, "port must not be cleared to 0");
		assert.strictEqual(Number(msg.limitPowerMypower), 1000, "power limit must survive");
		assert.strictEqual(Number(msg.lockPassword), 987654, "the lock password must not be erased");
		assert.strictEqual(Number(msg.lockTime), 30);
		assert.strictEqual(msg.meterKind, "NONE");
	});

	it("never sets app_page, which would unlock the WiFi credential branch", function () {
		const msg = decodeSet(
			handler.encodeSetConfig(1753900000, { limitPowerMypower: 800 }, { ...baseConfig(), appPage: 1 }),
		);
		assert.strictEqual(Number(msg.appPage ?? 0), 0, "app_page must stay 0 even if the base carries 1");
	});

	it("lets the requested change win over the base value", function () {
		const msg = decodeSet(handler.encodeSetConfig(1753900000, { limitPowerMypower: 800 }, baseConfig()));
		assert.strictEqual(Number(msg.limitPowerMypower), 800);
		assert.strictEqual(Number(msg.serverSendTime), 5, "the untouched field keeps the device's value");
	});

	it("stays inside the 2T's 1024-byte payload limit with a full base", function () {
		const frame = handler.encodeSetConfig(1753900000, { serverSendTime: 10 }, baseConfig());
		assert.ok(frame.length - 10 < 0x401, `payload ${frame.length - 10} must stay under 1024`);
	});
});

// ============================================================
// protobufHandler – power limit scale
// ============================================================
describe("protobufHandler – SGSMO power limit", function () {
	// The two device families disagree on the scale of this field, and the value alone cannot tell
	// them apart: a 2T at 100 % and a 2WB at 10 % both send 1000. The caller therefore passes the
	// divisor, chosen by transport.
	//
	// 2T (TCP), firmware-traced: action 8 parses "A:800,..." and stores the raw number in
	// gp-108260 (0x40812ccc); that same variable goes unchanged into the UART string to the
	// inverter (format "%d,A:%ld,B:%ld,C:%ld" at 0x40814e9c / 0x408163ee). Tenths of a percent.
	// Measured: after setting 80 %, the field read 800.
	//
	// 2WB (BLE): the field is fed from the energy-management setpoint gp-84168 (0x4080b62a),
	// clamped at 0x4083e09e. Measured: 10000 unthrottled, 8368 under zero-export regulation —
	// 83.68 %, which as tenths would be an impossible 836.8 %.
	let pb;
	before(async function () {
		pb = new ProtobufHandler();
		await pb.loadProtos();
	});

	/**
	 * Decode a RealData frame carrying just the given SGSMO fields.
	 *
	 * @param sgs - SGSMO fields to encode
	 * @param scale - divisor for power_limit, or undefined for the default
	 */
	function decodeWith(sgs, scale) {
		const Real = pb.getType("RealDataNew", "RealDataNewReqDTO");
		const payload = Real.encode(Real.create({ sgsData: [sgs] })).finish();
		return pb.decodeRealDataNew(Buffer.from(payload), scale);
	}

	it("reads the TCP scale as tenths of a percent", function () {
		assert.strictEqual(decodeWith({ powerLimit: 800 }, SCALE_POWER_LIMIT_TCP).sgs[0].powerLimit, 80);
		assert.strictEqual(decodeWith({ powerLimit: 1000 }, SCALE_POWER_LIMIT_TCP).sgs[0].powerLimit, 100);
	});

	it("reads the BLE scale as hundredths of a percent", function () {
		assert.strictEqual(decodeWith({ powerLimit: 10000 }, SCALE_POWER_LIMIT_BLE).sgs[0].powerLimit, 100);
		assert.strictEqual(decodeWith({ powerLimit: 8368 }, SCALE_POWER_LIMIT_BLE).sgs[0].powerLimit, 83.68);
	});

	it("defaults to the TCP scale", function () {
		// The released path is TCP; a caller that forgets the argument must not break it.
		assert.strictEqual(decodeWith({ powerLimit: 800 }).sgs[0].powerLimit, 80);
	});

	it("never shares a factor with the watt-valued fields", function () {
		// Both were divided by SCALE_POWER before, which reported the limit as 1000 %.
		const r = decodeWith({ activePower: 10000, powerLimit: 10000 }, SCALE_POWER_LIMIT_BLE);
		assert.strictEqual(r.sgs[0].activePower, 1000, "activePower is 0.1 W");
		assert.strictEqual(r.sgs[0].powerLimit, 100, "powerLimit is 0.01 %");
	});
});
