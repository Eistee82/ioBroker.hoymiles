import assert from "node:assert";
import { ALARM_CODES, getAlarmDescription } from "../build/lib/alarmCodes.js";

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

	it('getAlarmDescription returns "Unknown code" for invalid code', function () {
		assert.strictEqual(getAlarmDescription(99999, "en"), "Unknown code: 99999");
		assert.strictEqual(getAlarmDescription(0, "en"), "Unknown code: 0");
		assert.strictEqual(getAlarmDescription(-1, "de"), "Unbekannter Code: -1");
	});

	it("getAlarmDescription defaults to EN when no language specified", function () {
		assert.strictEqual(getAlarmDescription(1), "Reset");
	});

	it("ALARM_CODES has 110 entries", function () {
		assert.strictEqual(Object.keys(ALARM_CODES).length, 110);
	});
});

// ============================================================
// alarmCodes – additional coverage
// ============================================================
describe("alarmCodes – extended", function () {
	it("code 38 (undocumented) returns correct description", function () {
		assert.strictEqual(getAlarmDescription(38, "en"), "Insufficient input power (shutting down)");
		assert.strictEqual(getAlarmDescription(38, "de"), "Eingangsleistung zu gering (Abschaltung)");
	});

	it("all codes have both EN and DE translations", function () {
		for (const [code, entry] of Object.entries(ALARM_CODES)) {
			assert.ok(entry.en, `Code ${code} missing EN translation`);
			assert.ok(entry.de, `Code ${code} missing DE translation`);
		}
	});

	it("code numbers are positive integers", function () {
		for (const code of Object.keys(ALARM_CODES)) {
			const num = Number(code);
			assert.ok(Number.isInteger(num) && num > 0, `Invalid code number: ${code}`);
		}
	});
});
