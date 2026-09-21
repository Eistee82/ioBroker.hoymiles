import assert from "node:assert";
import {
	CLOUD_DOWNLINK_TAGS,
	describeCloudTag,
	cloudTagLabel,
	refusalReason,
	REFUSED_ACTIONS,
} from "../build/lib/cloudTranslator.js";

// ============================================================
// cloudTranslator – downlink tag table
// ============================================================
// The table is the relay's map of everything the cloud can send back. Its value is that no
// downlink is anonymous any more: before, an unimplemented frame was dropped and looked
// exactly like no frame at all.
describe("cloudTranslator – downlink tag table", function () {
	it("covers every tag the TCP dispatcher implements", function () {
		// DISPATCH_2T.md, exhaustive: each of the 1024 possible values was simulated.
		const expected = [0x01, 0x02, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x12, 0x13];
		for (const low of expected) {
			assert.ok(describeCloudTag(low), `0x23${low.toString(16)} missing from the table`);
		}
		assert.strictEqual(CLOUD_DOWNLINK_TAGS.length, expected.length);
	});

	it("leaves out the tags only the BLE firmware dispatches", function () {
		// No relay ever runs for a BLE device, so those tags cannot arrive here. Listing them
		// would suggest the relay might see them.
		for (const low of [0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c]) {
			assert.strictEqual(describeCloudTag(low), undefined, `0x23${low.toString(16)} must not be listed`);
		}
	});

	it("has no duplicate entries", function () {
		const lows = CLOUD_DOWNLINK_TAGS.map(t => t.low);
		assert.strictEqual(new Set(lows).size, lows.length);
	});

	it("classifies the cloud's answers to our own uploads as acks", function () {
		// InfoData, heartbeat, RealData, history — these must never reach the device.
		for (const low of [0x01, 0x02, 0x0c, 0x0d]) {
			assert.strictEqual(describeCloudTag(low).kind, "ack", `0x23${low.toString(16)} should be an ack`);
		}
	});

	it("classifies the action channel as a command", function () {
		assert.strictEqual(describeCloudTag(0x05).kind, "command");
	});

	it("returns undefined for a tag neither firmware dispatches", function () {
		assert.strictEqual(describeCloudTag(0x7f), undefined);
	});
});

describe("cloudTranslator – labels", function () {
	it("names a known tag", function () {
		assert.strictEqual(cloudTagLabel(0x05), "0x2305 CommandRes");
	});

	it("zero-pads the low byte", function () {
		assert.strictEqual(cloudTagLabel(0x02), "0x2302 HBRes");
	});

	it("says so when the firmware dispatches no such tag", function () {
		assert.match(cloudTagLabel(0x7f), /^0x237f \(not dispatched/);
	});
});

// ============================================================
// cloudTranslator – refused actions
// ============================================================
// A relay that forwards anything the server sends can flash firmware or move the device to
// another server. Those actions are refused on purpose, and the refusal carries a reason.
describe("cloudTranslator – refused actions", function () {
	it("refuses the OTA download actions", function () {
		assert.match(refusalReason(2), /OTA/);
		assert.match(refusalReason(15), /OTA/);
	});

	it("refuses the configuration-rewriting actions", function () {
		for (const action of [52, 53, 54, 56, 57]) {
			assert.ok(refusalReason(action), `action ${action} should be refused`);
		}
	});

	it("allows an ordinary control action", function () {
		assert.strictEqual(refusalReason(8), null); // power limit
		assert.strictEqual(refusalReason(3), null); // inverter reboot
	});

	it("every refusal states a reason", function () {
		for (const [, reason] of REFUSED_ACTIONS) {
			assert.ok(reason && reason.length > 0);
		}
	});
});
