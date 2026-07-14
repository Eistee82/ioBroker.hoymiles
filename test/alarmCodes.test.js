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

	it("ALARM_CODES has 223 entries (55 hand-maintained + 168 from the cloud mwc dictionary)", function () {
		assert.strictEqual(Object.keys(ALARM_CODES).length, 223);
	});

	it("localizes into additional languages from the cloud mwc dictionary", function () {
		assert.strictEqual(getAlarmDescription(141, "ru"), "Перенапряжение электросети");
		assert.strictEqual(getAlarmDescription(141, "fr"), "Surtension du réseau");
		assert.strictEqual(getAlarmDescription(141, "zh-cn"), "电网过压");
	});

	it("falls back to EN when a language is unavailable for a code", function () {
		// Hoymiles does not localize Ukrainian, so uk resolves to the English text.
		assert.strictEqual(getAlarmDescription(141, "uk"), getAlarmDescription(141, "en"));
		// Hand-maintained EXTRA_CODES carry only en/de, so other languages fall back to en.
		assert.strictEqual(getAlarmDescription(1, "ru"), "Reset");
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

	it("every code has an EN base text and resolves non-empty in EN and DE", function () {
		// The model is "en required, other languages optional with en-fallback" — a code whose DE
		// text equals EN omits the redundant DE entry, but getAlarmDescription must still resolve it.
		for (const [code, entry] of Object.entries(ALARM_CODES)) {
			assert.ok(entry.en, `Code ${code} missing EN base translation`);
			assert.ok(getAlarmDescription(Number(code), "en"), `Code ${code} resolves empty in EN`);
			assert.ok(getAlarmDescription(Number(code), "de"), `Code ${code} resolves empty in DE`);
		}
	});

	it("code numbers are positive integers", function () {
		for (const code of Object.keys(ALARM_CODES)) {
			const num = Number(code);
			assert.ok(Number.isInteger(num) && num > 0, `Invalid code number: ${code}`);
		}
	});
});
