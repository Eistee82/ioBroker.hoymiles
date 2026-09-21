import assert from "node:assert";
import { bleNameToSn, isHoymilesAdvertisement } from "../build/lib/bleDiscovery.js";
import { EsphomeGateway } from "../build/lib/esphomeGateway.js";

describe("bleDiscovery", function () {
	describe("bleNameToSn", function () {
		it("takes the last 12 alphanumeric chars, uppercased", function () {
			assert.strictEqual(bleNameToSn("RMI-4161A031AB61"), "4161A031AB61");
			assert.strictEqual(bleNameToSn("rmi_4161a031ab61"), "4161A031AB61");
		});
		it("handles empty/short names", function () {
			assert.strictEqual(bleNameToSn(""), "");
			assert.strictEqual(bleNameToSn("ABC"), "ABC");
		});
	});

	describe("isHoymilesAdvertisement", function () {
		it("accepts a device advertising the Hoymiles service UUID", function () {
			assert.strictEqual(
				isHoymilesAdvertisement({
					name: "whatever",
					serviceUuidsList: ["0000e0ff-3c17-d293-8e48-14fe2e4da212"],
				}),
				true,
			);
		});
		it("accepts the app's inverter name prefixes (MI/RMI/AUS/MSA/MSH/RMSA)", function () {
			assert.strictEqual(isHoymilesAdvertisement({ name: "RMI-4161A031AB61" }), true);
			assert.strictEqual(isHoymilesAdvertisement({ name: "MI-4161A031AB61" }), true);
			assert.strictEqual(isHoymilesAdvertisement({ name: "MSA-1234567890AB" }), true);
		});
		it("rejects unrelated devices", function () {
			assert.strictEqual(isHoymilesAdvertisement({ name: "MyPhone" }), false);
			assert.strictEqual(isHoymilesAdvertisement({ name: "" }), false);
			assert.strictEqual(isHoymilesAdvertisement({ name: "TV-Living-Room-Soundbar-XL" }), false);
			// Real-world false positive the old shape heuristic let through (seen live in a scan).
			assert.strictEqual(isHoymilesAdvertisement({ name: "Hue ambiance lamp" }), false);
			// A WiFi-DTU name is not a balcony BLE device — the balcony scan only accepts MI/RMI/…
			assert.strictEqual(isHoymilesAdvertisement({ name: "DTUBI-410012345678" }), false);
		});
	});

	describe("EsphomeGateway.macToNumber / macToString", function () {
		it("round-trips a MAC through number and back", function () {
			const mac = "AA:BB:CC:DD:EE:FF";
			const num = EsphomeGateway.macToNumber(mac);
			assert.strictEqual(num, 0xaabbccddeeff);
			assert.strictEqual(EsphomeGateway.macToString(num), mac);
		});
		it("parses a MAC without separators", function () {
			assert.strictEqual(EsphomeGateway.macToNumber("aabbccddeeff"), 0xaabbccddeeff);
		});
	});
});
