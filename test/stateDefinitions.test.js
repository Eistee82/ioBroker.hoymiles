import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { channels, states, stationChannels, stationStates } from "../build/lib/stateDefinitions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(__dirname, "..", "src", "lib", "i18n");
const enWords = JSON.parse(readFileSync(join(i18nDir, "en.json"), "utf8"));
const deWords = JSON.parse(readFileSync(join(i18nDir, "de.json"), "utf8"));

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

	it("all states have required fields (id, nameKey, type, role)", function () {
		for (const s of states) {
			assert.ok(s.id, `State missing id: ${JSON.stringify(s)}`);
			assert.ok(s.nameKey, `State ${s.id} missing nameKey`);
			assert.ok(s.type, `State ${s.id} missing type`);
			assert.ok(s.role, `State ${s.id} missing role`);
		}
	});

	it("all channel and state nameKeys resolve in en + de i18n files", function () {
		for (const c of channels) {
			assert.ok(enWords[c.nameKey], `Channel ${c.id}: nameKey ${c.nameKey} missing in en.json`);
			assert.ok(deWords[c.nameKey], `Channel ${c.id}: nameKey ${c.nameKey} missing in de.json`);
		}
		for (const s of states) {
			assert.ok(enWords[s.nameKey], `State ${s.id}: nameKey ${s.nameKey} missing in en.json`);
			assert.ok(deWords[s.nameKey], `State ${s.id}: nameKey ${s.nameKey} missing in de.json`);
		}
	});

	it("no duplicate state IDs", function () {
		const ids = states.map(s => s.id);
		const uniqueIds = new Set(ids);
		assert.strictEqual(ids.length, uniqueIds.size, "Duplicate state IDs found");
	});

	it("all states belong to a defined channel", function () {
		const channelIds = new Set(channels.map(c => c.id));
		for (const s of states) {
			const channelId = s.id.split(".")[0];
			assert.ok(channelIds.has(channelId), `State ${s.id} belongs to undefined channel "${channelId}"`);
		}
	});

	it("contains expected static channels", function () {
		const channelIds = channels.map(c => c.id);
		assert.ok(channelIds.includes("grid"), "Missing grid channel");
		assert.ok(channelIds.includes("inverter"), "Missing inverter channel");
		assert.ok(channelIds.includes("dtu"), "Missing dtu channel");
		assert.ok(channelIds.includes("info"), "Missing info channel");
		assert.ok(channelIds.includes("alarms"), "Missing alarms channel");
		assert.ok(channelIds.includes("config"), "Missing config channel");
	});

	it("has 6 static channels (PV and meter are dynamic)", function () {
		assert.strictEqual(channels.length, 6, `Expected 6 channels but got ${channels.length}`);
	});

	it("contains DTU states", function () {
		const stateIds = states.map(s => s.id);
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
		assert.ok(stateIds.includes("dtu.connState"), "Missing dtu.connState state");
	});

	it("contains network config states", function () {
		const stateIds = states.map(s => s.id);
		assert.ok(stateIds.includes("config.netIpAddress"), "Missing config.netIpAddress state");
		assert.ok(stateIds.includes("config.netSubnetMask"), "Missing config.netSubnetMask state");
		assert.ok(stateIds.includes("config.netGateway"), "Missing config.netGateway state");
		assert.ok(stateIds.includes("config.wifiIpAddress"), "Missing config.wifiIpAddress state");
		assert.ok(stateIds.includes("config.netMacAddress"), "Missing config.netMacAddress state");
		assert.ok(stateIds.includes("config.wifiMacAddress"), "Missing config.wifiMacAddress state");
	});

	it("does not contain events.* states", function () {
		const eventStates = states.filter(s => s.id.startsWith("events."));
		assert.strictEqual(
			eventStates.length,
			0,
			`Unexpected events.* states found: ${eventStates.map(s => s.id).join(", ")}`,
		);
	});

	it("does not contain history.* states", function () {
		const historyStates = states.filter(s => s.id.startsWith("history."));
		assert.strictEqual(
			historyStates.length,
			0,
			`Unexpected history.* states found: ${historyStates.map(s => s.id).join(", ")}`,
		);
	});
});

// ============================================================
// stateDefinitions – station states
// ============================================================
describe("stateDefinitions – station", function () {
	it("stationChannels array is not empty", function () {
		assert.ok(stationChannels.length > 0);
	});

	it("stationStates array is not empty", function () {
		assert.ok(stationStates.length > 0);
	});

	it("all station states have required fields", function () {
		for (const s of stationStates) {
			assert.ok(s.id, `Station state missing id`);
			assert.ok(s.nameKey, `Station state ${s.id} missing nameKey`);
			assert.ok(s.type, `Station state ${s.id} missing type`);
			assert.ok(s.role, `Station state ${s.id} missing role`);
		}
	});

	it("all station nameKeys resolve in en + de i18n files", function () {
		for (const c of stationChannels) {
			assert.ok(enWords[c.nameKey], `Station channel ${c.id}: nameKey ${c.nameKey} missing in en.json`);
			assert.ok(deWords[c.nameKey], `Station channel ${c.id}: nameKey ${c.nameKey} missing in de.json`);
		}
		for (const s of stationStates) {
			assert.ok(enWords[s.nameKey], `Station state ${s.id}: nameKey ${s.nameKey} missing in en.json`);
			assert.ok(deWords[s.nameKey], `Station state ${s.id}: nameKey ${s.nameKey} missing in de.json`);
		}
	});

	it("no duplicate station state IDs", function () {
		const ids = stationStates.map(s => s.id);
		assert.strictEqual(ids.length, new Set(ids).size, "Duplicate station state IDs");
	});

	it("all station states belong to a defined station channel", function () {
		const channelIds = new Set(stationChannels.map(c => c.id));
		for (const s of stationStates) {
			const channelId = s.id.split(".")[0];
			assert.ok(channelIds.has(channelId), `Station state ${s.id} belongs to undefined channel "${channelId}"`);
		}
	});

	it("contains expected station channels", function () {
		const channelIds = stationChannels.map(c => c.id);
		assert.ok(channelIds.includes("grid"), "Missing station grid channel");
		assert.ok(channelIds.includes("info"), "Missing station info channel");
	});

	it("contains key station states", function () {
		const ids = stationStates.map(s => s.id);
		assert.ok(ids.includes("grid.power"), "Missing grid.power");
		assert.ok(ids.includes("grid.dailyEnergy"), "Missing grid.dailyEnergy");
		assert.ok(ids.includes("grid.totalEnergy"), "Missing grid.totalEnergy");
		assert.ok(ids.includes("info.stationName"), "Missing info.stationName");
	});

	it("writable device states include expected commands", function () {
		const writableIds = states.filter(s => s.write).map(s => s.id);
		assert.ok(writableIds.includes("inverter.powerLimit"), "Missing writable inverter.powerLimit");
		assert.ok(writableIds.includes("inverter.active"), "Missing writable inverter.active");
		assert.ok(writableIds.includes("inverter.reboot"), "Missing writable inverter.reboot");
		assert.ok(writableIds.includes("dtu.reboot"), "Missing writable dtu.reboot");
		assert.ok(writableIds.includes("inverter.lock"), "Missing writable inverter.lock");
		assert.ok(writableIds.includes("config.serverSendTime"), "Missing writable config.serverSendTime");
	});

	it("station states are all read-only", function () {
		for (const s of stationStates) {
			assert.ok(!s.write, `Station state ${s.id} should not be writable`);
		}
	});
});

// ============================================================
// i18n parity — every language file has the same keys
// ============================================================
describe("i18n", function () {
	const langs = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"];
	const wordsPerLang = Object.fromEntries(
		langs.map(l => [l, JSON.parse(readFileSync(join(i18nDir, `${l}.json`), "utf8"))]),
	);

	it("all 11 mandatory languages exist", function () {
		for (const l of langs) {
			assert.ok(wordsPerLang[l], `i18n file missing for language ${l}`);
		}
	});

	it("each language file has the same set of keys as en.json", function () {
		const enKeys = Object.keys(wordsPerLang.en).sort();
		for (const l of langs) {
			if (l === "en") {
				continue;
			}
			const langKeys = Object.keys(wordsPerLang[l]).sort();
			assert.deepStrictEqual(langKeys, enKeys, `Key set in ${l}.json differs from en.json`);
		}
	});

	it("no empty translation values", function () {
		for (const l of langs) {
			for (const [k, v] of Object.entries(wordsPerLang[l])) {
				assert.ok(typeof v === "string" && v.length > 0, `${l}.json: empty value for key ${k}`);
			}
		}
	});
});
