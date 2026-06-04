import assert from "node:assert";
import { decodeGridProfile, GRID_PROFILE_SCHEMA } from "../build/lib/gridProfile.js";

// Real grid-profile blob read locally from an HMS-800W-2T via DevConfigFetch (0xa3 0x07),
// field `data` (big-endian 16-bit words). Verified 1:1 against the S-Miles cloud's decoded
// values (DE_VDE4105_2018).
const REAL_BLOB =
	"03002001000a08fc0730001e0b3b0001040b001e09e210001388128e0001141e0001200000013003025809e207" +
	"a31392128e400007d0001050080001139c01900010139c137470020001271080000000085b012c08b70941099d" +
	"012c90000000005fb000000001f4ffa1a002000000000000";

describe("decodeGridProfile", () => {
	const { values, standard } = decodeGridProfile(Buffer.from(REAL_BLOB, "hex"));

	it("resolves the standard name from the country-std code", () => {
		assert.strictEqual(values.countryStdCode, 768);
		assert.strictEqual(values.version, 8193);
		assert.strictEqual(standard, "DE_VDE4105_2018");
	});

	it("decodes voltage limits (big-endian / multiple)", () => {
		assert.strictEqual(values.nominalVoltage, 230);
		assert.strictEqual(values.lowVoltage1, 184);
		assert.strictEqual(values.highVoltage1, 287.5);
		assert.strictEqual(values.lowVoltage2, 103.5);
	});

	it("decodes frequency limits", () => {
		assert.strictEqual(values.nominalFrequency, 50);
		assert.strictEqual(values.lowFrequency1, 47.5);
		assert.strictEqual(values.highFrequency1, 51.5);
	});

	it("decodes reconnect + power-factor parameters", () => {
		assert.strictEqual(values.reconnectTime, 60);
		assert.strictEqual(values.reconnectHighVoltage, 253);
		assert.strictEqual(values.reconnectLowVoltage, 195.5);
		assert.strictEqual(values.powerFactor, 0.95);
	});

	it("decodes function flags as booleans", () => {
		assert.strictEqual(typeof values.islandingDetection, "boolean");
		assert.strictEqual(values.islandingDetection, true);
		assert.strictEqual(values.freqWattActive, true);
		assert.strictEqual(values.voltVarActive, false);
	});

	it("skips parameters beyond the blob length without throwing", () => {
		const short = decodeGridProfile(Buffer.from("030020010000", "hex"));
		assert.strictEqual(short.values.countryStdCode, 768);
		assert.strictEqual(short.values.version, 8193);
		assert.strictEqual(short.values.nominalVoltage, undefined);
	});

	it("schema keys are unique", () => {
		const keys = GRID_PROFILE_SCHEMA.map(p => p.key);
		assert.strictEqual(new Set(keys).size, keys.length);
	});
});
