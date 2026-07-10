import assert from "node:assert";
import { channels, states, stationChannels, stationStates } from "../build/lib/stateDefinitions.js";

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
			assert.ok(typeof s.name === "object" && s.name.en, `State ${s.id} missing English name`);
			assert.ok(typeof s.name === "object" && s.name.de, `State ${s.id} missing German name`);
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
		assert.ok(channelIds.includes("gridProfile"), "Missing gridProfile channel");
	});

	it("has 7 static channels (PV and meter are dynamic)", function () {
		assert.strictEqual(channels.length, 7, `Expected 7 channels but got ${channels.length}`);
	});

	it("contains DTU states", function () {
		const stateIds = states.map(s => s.id);
		assert.ok(stateIds.includes("dtu.serialNumber"), "Missing dtu.serialNumber state");
		assert.ok(stateIds.includes("dtu.hwVersion"), "Missing dtu.hwVersion state");
		assert.ok(stateIds.includes("dtu.swVersion"), "Missing dtu.swVersion state");
		assert.ok(stateIds.includes("dtu.rssi"), "Missing dtu.rssi state");
		assert.ok(stateIds.includes("dtu.stepTime"), "Missing dtu.stepTime state");
		assert.ok(stateIds.includes("dtu.accessModel"), "Missing dtu.accessModel state");
		assert.ok(stateIds.includes("dtu.communicationTime"), "Missing dtu.communicationTime state");
		assert.ok(stateIds.includes("dtu.wifiVersion"), "Missing dtu.wifiVersion state");
		assert.ok(stateIds.includes("dtu.reboot"), "Missing dtu.reboot state");
		assert.ok(stateIds.includes("dtu.connState"), "Missing dtu.connState state");
	});

	it("contains network config states", function () {
		const stateIds = states.map(s => s.id);
		assert.ok(stateIds.includes("config.wifiIpAddress"), "Missing config.wifiIpAddress state");
		assert.ok(stateIds.includes("config.wifiMacAddress"), "Missing config.wifiMacAddress state");
		assert.ok(stateIds.includes("config.dtuApSsid"), "Missing config.dtuApSsid state");
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
			assert.ok(s.name, `Station state ${s.id} missing name`);
			assert.ok(s.type, `Station state ${s.id} missing type`);
			assert.ok(s.role, `Station state ${s.id} missing role`);
		}
	});

	it("all station state names have en and de translations", function () {
		for (const s of stationStates) {
			assert.ok(typeof s.name === "object" && s.name.en, `Station state ${s.id} missing EN name`);
			assert.ok(typeof s.name === "object" && s.name.de, `Station state ${s.id} missing DE name`);
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
		assert.ok(writableIds.includes("config.limitPowerMyPower"), "Missing writable config.limitPowerMyPower");
	});

	it("config.limitPowerMyPower state has correct definition", function () {
		const def = states.find(s => s.id === "config.limitPowerMyPower");
		assert.ok(def, "config.limitPowerMyPower must exist in states");
		assert.strictEqual(def.type, "number", "type must be number");
		assert.strictEqual(def.write, true, "must be writable");
		assert.strictEqual(def.min, 2, "min must be 2");
		assert.strictEqual(def.max, 100, "max must be 100");
	});

	it("station states are all read-only", function () {
		for (const s of stationStates) {
			assert.ok(!s.write, `Station state ${s.id} should not be writable`);
		}
	});
});
