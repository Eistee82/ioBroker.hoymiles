"use strict";

const assert = require("node:assert");
const path = require("path");

// --- alarmCodes ---
const { ALARM_CODES, getAlarmDescription } = require("../build/lib/alarmCodes");

// --- stateDefinitions ---
const { channels, states } = require("../build/lib/stateDefinitions");

// --- encryption ---
const Encryption = require("../build/lib/encryption");

// --- protobufHandler ---
const { ProtobufHandler, CMD, ACTION, HEADER_SIZE, formatDtuVersion, formatSwVersion, formatInvVersion } = require("../build/lib/protobufHandler");

// --- dtuConnection ---
const DtuConnection = require("../build/lib/dtuConnection");

// ============================================================
// alarmCodes
// ============================================================
describe("alarmCodes", function () {
	it("getAlarmDescription returns correct EN description", function () {
		assert.strictEqual(getAlarmDescription(1, "en"), "Reset");
		assert.strictEqual(getAlarmDescription(121, "en"), "Over temperature protection");
		assert.strictEqual(getAlarmDescription(5070, "en"), "Over temperature protection");
	});

	it("getAlarmDescription returns correct DE description", function () {
		assert.strictEqual(getAlarmDescription(1, "de"), "Neustart");
		assert.strictEqual(getAlarmDescription(4, "de"), "Offline");
		assert.strictEqual(getAlarmDescription(121, "de"), "\u00dcbertemperaturschutz");
	});

	it('getAlarmDescription returns "Unknown alarm code" for invalid code', function () {
		assert.strictEqual(getAlarmDescription(99999, "en"), "Unknown alarm code: 99999");
		assert.strictEqual(getAlarmDescription(0, "en"), "Unknown alarm code: 0");
		assert.strictEqual(getAlarmDescription(-1, "de"), "Unknown alarm code: -1");
	});

	it("getAlarmDescription defaults to EN when no language specified", function () {
		assert.strictEqual(getAlarmDescription(1), "Reset");
	});

	it("ALARM_CODES has 109 entries", function () {
		assert.strictEqual(Object.keys(ALARM_CODES).length, 109);
	});
});

// ============================================================
// stateDefinitions
// ============================================================
describe("stateDefinitions", function () {
	it("channels array is not empty", function () {
		assert.ok(channels.length > 0);
	});

	it("states array is not empty", function () {
		assert.ok(states.length > 0);
	});

	it("all states have required fields (id, name, type, role)", function () {
		for (const s of states) {
			assert.ok(s.id, `State missing id: ${JSON.stringify(s)}`);
			assert.ok(s.name, `State ${s.id} missing name`);
			assert.ok(s.type, `State ${s.id} missing type`);
			assert.ok(s.role, `State ${s.id} missing role`);
		}
	});

	it("all state names have en and de translations", function () {
		for (const s of states) {
			assert.ok(
				typeof s.name === "object" && s.name.en,
				`State ${s.id} missing English name`,
			);
			assert.ok(
				typeof s.name === "object" && s.name.de,
				`State ${s.id} missing German name`,
			);
		}
	});

	it("no duplicate state IDs", function () {
		const ids = states.map((s) => s.id);
		const uniqueIds = new Set(ids);
		assert.strictEqual(ids.length, uniqueIds.size, "Duplicate state IDs found");
	});

	it("all states belong to a defined channel", function () {
		const channelIds = new Set(channels.map((c) => c.id));
		for (const s of states) {
			const channelId = s.id.split(".")[0];
			assert.ok(
				channelIds.has(channelId),
				`State ${s.id} belongs to undefined channel "${channelId}"`,
			);
		}
	});

	it("contains expected channels", function () {
		const channelIds = channels.map((c) => c.id);
		assert.ok(channelIds.includes("grid"), "Missing grid channel");
		assert.ok(channelIds.includes("pv0"), "Missing pv0 channel");
		assert.ok(channelIds.includes("pv1"), "Missing pv1 channel");
		assert.ok(channelIds.includes("inverter"), "Missing inverter channel");
		assert.ok(channelIds.includes("dtu"), "Missing dtu channel");
		assert.ok(channelIds.includes("info"), "Missing info channel");
		assert.ok(channelIds.includes("alarms"), "Missing alarms channel");
		assert.ok(channelIds.includes("config"), "Missing config channel");
	});

	it("has exactly 8 channels", function () {
		assert.strictEqual(channels.length, 8, `Expected 8 channels but got ${channels.length}`);
	});

	it("contains DTU states", function () {
		const stateIds = states.map((s) => s.id);
		assert.ok(stateIds.includes("dtu.serialNumber"), "Missing dtu.serialNumber state");
		assert.ok(stateIds.includes("dtu.hwVersion"), "Missing dtu.hwVersion state");
		assert.ok(stateIds.includes("dtu.swVersion"), "Missing dtu.swVersion state");
		assert.ok(stateIds.includes("dtu.rssi"), "Missing dtu.rssi state");
		assert.ok(stateIds.includes("dtu.stepTime"), "Missing dtu.stepTime state");
		assert.ok(stateIds.includes("dtu.rfHwVersion"), "Missing dtu.rfHwVersion state");
		assert.ok(stateIds.includes("dtu.rfSwVersion"), "Missing dtu.rfSwVersion state");
		assert.ok(stateIds.includes("dtu.accessModel"), "Missing dtu.accessModel state");
		assert.ok(stateIds.includes("dtu.communicationTime"), "Missing dtu.communicationTime state");
		assert.ok(stateIds.includes("dtu.wifiVersion"), "Missing dtu.wifiVersion state");
		assert.ok(stateIds.includes("dtu.mode485"), "Missing dtu.mode485 state");
		assert.ok(stateIds.includes("dtu.sub1gFrequencyBand"), "Missing dtu.sub1gFrequencyBand state");
		assert.ok(stateIds.includes("dtu.reboot"), "Missing dtu.reboot state");
		assert.ok(stateIds.includes("dtu.reconnectPaused"), "Missing dtu.reconnectPaused state");
		assert.ok(stateIds.includes("dtu.connState"), "Missing dtu.connState state");
	});

	it("contains network config states", function () {
		const stateIds = states.map((s) => s.id);
		assert.ok(stateIds.includes("config.ipAddress"), "Missing config.ipAddress state");
		assert.ok(stateIds.includes("config.subnetMask"), "Missing config.subnetMask state");
		assert.ok(stateIds.includes("config.gateway"), "Missing config.gateway state");
		assert.ok(stateIds.includes("config.wifiIpAddress"), "Missing config.wifiIpAddress state");
		assert.ok(stateIds.includes("config.macAddress"), "Missing config.macAddress state");
		assert.ok(stateIds.includes("config.wifiMacAddress"), "Missing config.wifiMacAddress state");
	});

	it("does not contain events.* states", function () {
		const eventStates = states.filter((s) => s.id.startsWith("events."));
		assert.strictEqual(eventStates.length, 0, `Unexpected events.* states found: ${eventStates.map((s) => s.id).join(", ")}`);
	});

	it("does not contain history.* states", function () {
		const historyStates = states.filter((s) => s.id.startsWith("history."));
		assert.strictEqual(historyStates.length, 0, `Unexpected history.* states found: ${historyStates.map((s) => s.id).join(", ")}`);
	});
});

// ============================================================
// encryption
// ============================================================
describe("encryption", function () {
	it("Encryption.isRequired returns false for 0", function () {
		assert.strictEqual(Encryption.isRequired(0), false);
	});

	it("Encryption.isRequired returns true for (1 << 25)", function () {
		assert.strictEqual(Encryption.isRequired(1 << 25), true);
	});

	it("Encryption.isRequired returns true for value with bit 25 set among others", function () {
		assert.strictEqual(Encryption.isRequired((1 << 25) | 0xff), true);
	});

	it("Encryption.isRequired returns false for null/undefined", function () {
		assert.strictEqual(Encryption.isRequired(null), false);
		assert.strictEqual(Encryption.isRequired(undefined), false);
	});

	it("encrypt and decrypt round-trip produces original data", function () {
		const enc = new Encryption("0123456789abcdef");
		const original = Buffer.from("Hello, Hoymiles!");
		const encrypted = enc.encrypt(original);
		const decrypted = enc.decrypt(encrypted);
		assert.ok(Buffer.compare(original, decrypted) === 0);
	});

	it("throws when encrypting without valid key", function () {
		const enc = new Encryption("short");
		assert.throws(() => enc.encrypt(Buffer.from("test")), /not initialized/);
	});

	it("throws when decrypting without valid key", function () {
		const enc = new Encryption("");
		assert.throws(() => enc.decrypt(Buffer.from("test")), /not initialized/);
	});
});

// ============================================================
// protobufHandler
// ============================================================
describe("protobufHandler", function () {
	/** @type {InstanceType<typeof ProtobufHandler>} */
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	describe("crc16", function () {
		it("returns correct checksum for known input", function () {
			const crc = handler.crc16(Buffer.alloc(0));
			assert.strictEqual(crc, 0xffff);
		});

		it("returns correct checksum for single byte 0x00", function () {
			const crc = handler.crc16(Buffer.from([0x00]));
			assert.ok(crc >= 0 && crc <= 0xffff);
		});

		it("returns different checksums for different inputs", function () {
			const crc1 = handler.crc16(Buffer.from([0x01]));
			const crc2 = handler.crc16(Buffer.from([0x02]));
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
				"RealDataNew", "GetConfig", "CommandPB", "AlarmData",
				"APPInformationData", "SetConfig", "WarnData", "APPHeartbeatPB",
				"AppGetHistPower", "EventData", "NetworkInfo", "AutoSearch", "DevConfig",
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

	describe("encodeHistPowerRequest", function () {
		it("creates valid message with correct command bytes", function () {
			const msg = handler.encodeHistPowerRequest();
			assert.ok(Buffer.isBuffer(msg));
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x15);
		});
	});

	describe("CMD constants", function () {
		it("has correct command constants", function () {
			assert.deepStrictEqual(CMD.SET_CONFIG, [0xa3, 0x10]);
			assert.deepStrictEqual(CMD.WARN_DATA, [0xa3, 0x04]);
			assert.deepStrictEqual(CMD.HIST_POWER, [0xa3, 0x15]);
			assert.deepStrictEqual(CMD.HEARTBEAT, [0xa3, 0x02]);
			assert.deepStrictEqual(CMD.NETWORK_INFO, [0xa3, 0x14]);
			assert.deepStrictEqual(CMD.AUTO_SEARCH, [0xa3, 0x13]);
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
	});

	describe("encodeAutoSearch", function () {
		it("creates valid message with correct command bytes", function () {
			const msg = handler.encodeAutoSearch(1700000000);
			assert.ok(Buffer.isBuffer(msg));
			assert.ok(msg.length > HEADER_SIZE);
			assert.strictEqual(msg[2], 0xa3);
			assert.strictEqual(msg[3], 0x13);
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
// dtuConnection
// ============================================================
describe("dtuConnection", function () {
	describe("constructor", function () {
		it("sets default values correctly", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			assert.strictEqual(conn.connected, false);
			assert.strictEqual(conn.reconnectPaused, false);
			conn.disconnect();
		});

		it("accepts port 0 without error", function () {
			const conn = new DtuConnection("192.168.1.100", 0);
			assert.strictEqual(conn.connected, false);
			conn.disconnect();
		});

		it("reconnectPaused is false initially", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			assert.strictEqual(conn.reconnectPaused, false);
			conn.disconnect();
		});
	});
});
