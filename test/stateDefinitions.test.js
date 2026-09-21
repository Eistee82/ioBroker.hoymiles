import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
	channels,
	states,
	stationChannels,
	stationStates,
	meterMeasurementStates,
	meterControlStates,
	hybridChannels,
	hybridStates,
	hybridStateMap,
	batterySettingStates,
	stationIndicatorChannels,
	stationIndicatorStates,
	stationIndicatorStateMap,
} from "../build/lib/stateDefinitions.js";

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
		assert.ok(stateIds.includes("dtu.signalQuality"), "Missing dtu.signalQuality state");
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

	it("station states are all read-only — there is no writable station state at all", function () {
		for (const s of stationStates) {
			assert.ok(!s.write, `Station state ${s.id} should not be writable`);
		}
	});

	it("carries the battery's day energy balance again (grid.batteryChargeToday/DischargeToday)", function () {
		const ids = stationStates.map(s => s.id);
		assert.ok(ids.includes("grid.batteryChargeToday"), "Missing grid.batteryChargeToday");
		assert.ok(ids.includes("grid.batteryDischargeToday"), "Missing grid.batteryDischargeToday");
	});

	it("does not contain any other battery state — there is exactly one battery place, below the device", function () {
		const ids = stationStates.map(s => s.id);
		for (const removed of ["grid.batterySoc", "info.batteryCapacity", "info.workMode"]) {
			assert.ok(!ids.includes(removed), `${removed} must not exist in stationStates`);
		}
	});
});

// ============================================================
// stateDefinitions – every selectable value is translated
// ============================================================
describe("stateDefinitions – state value translations", function () {
	// ioBroker types common.states as Record<string, string>, so a value cannot carry its own
	// translations. The Admin resolves the text through the adapter's i18n files instead — which
	// only works if the exact string is a key there. A value added without that entry silently
	// stays English in every language.
	const LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"];

	/** Collect every `states` value used anywhere in the definitions. */
	function allStateValues() {
		const values = new Set();
		for (const def of [
			...states,
			...stationStates,
			...meterMeasurementStates,
			...meterControlStates,
			...hybridStates,
			...stationIndicatorStates,
		]) {
			for (const text of Object.values(def.states ?? {})) {
				values.add(text);
			}
		}
		return values;
	}

	it("has an i18n entry for every selectable value, in all 11 languages", function () {
		const missing = [];
		for (const lang of LANGS) {
			const dict = JSON.parse(readFileSync(`admin/i18n/${lang}.json`, "utf8"));
			for (const value of allStateValues()) {
				if (typeof dict[value] !== "string" || dict[value].length === 0) {
					missing.push(`${lang}: "${value}"`);
				}
			}
		}
		assert.deepStrictEqual(missing, [], `untranslated state values:\n  ${missing.join("\n  ")}`);
	});

	it("offers the meter modes the firmware actually distinguishes", function () {
		const mode = meterControlStates.find(d => d.id === "meter.mode");
		assert.ok(mode, "meter.mode missing");
		// 1 = polled only, 2 = grid device (the value the regulation tests for with `bnec $r0,#0x2`).
		// 0 is the never-bound starting value, not a command: undoing a binding would need
		// action 90, which memsets the whole network block including the inverter assignment.
		assert.deepStrictEqual(Object.keys(mode.states), ["0", "1", "2"]);
		assert.strictEqual(mode.states[1], "meter only");
		assert.strictEqual(mode.states[2], "zero export");
		assert.strictEqual(mode.write, true);
	});
});

// ============================================================
// stateDefinitions – hybrid (storage) inverter states
// ============================================================
describe("stateDefinitions – hybrid inverter states", function () {
	it("hybridStates array is not empty", function () {
		assert.ok(hybridStates.length > 0);
	});

	it("no duplicate hybrid state IDs", function () {
		const ids = hybridStates.map(s => s.id);
		assert.strictEqual(ids.length, new Set(ids).size, "Duplicate hybrid state IDs found");
	});

	it("no hybrid state ID collides with an existing device state ID", function () {
		const stateIds = new Set(states.map(s => s.id));
		const collisions = hybridStates.filter(s => stateIds.has(s.id)).map(s => s.id);
		assert.deepStrictEqual(
			collisions,
			[],
			`hybrid state(s) collide with existing states: ${collisions.join(", ")}`,
		);
	});

	it("every hybrid state's channel prefix is a known hybrid or device channel", function () {
		const channelIds = new Set([...channels, ...hybridChannels].map(c => c.id));
		for (const s of hybridStates) {
			const channelId = s.id.split(".")[0];
			assert.ok(channelIds.has(channelId), `Hybrid state ${s.id} belongs to undefined channel "${channelId}"`);
		}
	});

	it("every hybrid state is sourced from the cloud", function () {
		for (const s of hybridStates) {
			assert.strictEqual(s.source, "cloud", `Hybrid state ${s.id} must have source "cloud"`);
		}
	});

	it("no hybrid state uses role 'state' (they are all typed measurements/indicators/text)", function () {
		for (const s of hybridStates) {
			assert.notStrictEqual(s.role, "state", `Hybrid state ${s.id} must not use the generic "state" role`);
		}
	});

	it("every hybrid state has en and de translations", function () {
		for (const s of hybridStates) {
			assert.ok(typeof s.name === "object" && s.name.en, `Hybrid state ${s.id} missing English name`);
			assert.ok(typeof s.name === "object" && s.name.de, `Hybrid state ${s.id} missing German name`);
		}
	});

	it("hybridStateMap indexes every hybrid state exactly once", function () {
		assert.strictEqual(hybridStateMap.size, hybridStates.length);
	});

	it("hybridChannels is only eps + battery — the grid meter moved to the station", function () {
		assert.deepStrictEqual(hybridChannels.map(c => c.id).sort(), ["battery", "eps"]);
	});

	it("no longer contains battery.chargeToday / battery.dischargeToday (they live in stationStates now)", function () {
		const ids = hybridStates.map(s => s.id);
		assert.ok(!ids.includes("battery.chargeToday"));
		assert.ok(!ids.includes("battery.dischargeToday"));
	});

	it("contains every batterySettingStates entry (they are pushed into hybridStates)", function () {
		const ids = new Set(hybridStates.map(s => s.id));
		for (const def of batterySettingStates) {
			assert.ok(ids.has(def.id), `${def.id} missing from hybridStates`);
			assert.strictEqual(hybridStateMap.get(def.id), def);
		}
	});

	it("battery.readSettings is the ONLY writable hybrid state", function () {
		const writable = hybridStates.filter(s => s.write).map(s => s.id);
		assert.deepStrictEqual(writable, ["battery.readSettings"]);
	});

	it("battery.readSettings is a button", function () {
		const def = hybridStates.find(s => s.id === "battery.readSettings");
		assert.ok(def, "battery.readSettings must exist");
		assert.strictEqual(def.type, "boolean");
		assert.strictEqual(def.role, "button");
	});

	it("battery.workMode has a states map covering the app's mode table (1-8)", function () {
		const def = hybridStates.find(s => s.id === "battery.workMode");
		assert.ok(def, "battery.workMode must exist in hybridStates");
		assert.strictEqual(def.type, "number", "type must be number");
		assert.deepStrictEqual(
			Object.keys(def.states)
				.map(Number)
				.sort((a, b) => a - b),
			[1, 2, 3, 4, 5, 6, 7, 8],
		);
	});
});

// ============================================================
// stateDefinitions – station-level measuring points (gridMeter/load/pvMeter/generator)
// ============================================================
describe("stateDefinitions – station indicator states", function () {
	it("stationIndicatorStates array is not empty", function () {
		assert.ok(stationIndicatorStates.length > 0);
	});

	it("no duplicate station indicator state IDs", function () {
		const ids = stationIndicatorStates.map(s => s.id);
		assert.strictEqual(ids.length, new Set(ids).size, "Duplicate station indicator state IDs found");
	});

	it("no station indicator state ID collides with an existing station state ID", function () {
		const stateIds = new Set(stationStates.map(s => s.id));
		const collisions = stationIndicatorStates.filter(s => stateIds.has(s.id)).map(s => s.id);
		assert.deepStrictEqual(
			collisions,
			[],
			`station indicator state(s) collide with existing station states: ${collisions.join(", ")}`,
		);
	});

	it("every station indicator state's channel prefix is a known station-indicator channel", function () {
		const channelIds = new Set(stationIndicatorChannels.map(c => c.id));
		for (const s of stationIndicatorStates) {
			const channelId = s.id.split(".")[0];
			assert.ok(
				channelIds.has(channelId),
				`Station indicator state ${s.id} belongs to undefined channel "${channelId}"`,
			);
		}
	});

	it("station indicator channels are not part of stationChannels (they live below the station device too, but are a separate on-demand set)", function () {
		const stationChannelIds = new Set(stationChannels.map(c => c.id));
		for (const c of stationIndicatorChannels) {
			assert.ok(!stationChannelIds.has(c.id), `${c.id} unexpectedly duplicated in stationChannels`);
		}
	});

	it("every station indicator state is sourced from the cloud", function () {
		for (const s of stationIndicatorStates) {
			assert.strictEqual(s.source, "cloud", `Station indicator state ${s.id} must have source "cloud"`);
		}
	});

	it("no station indicator state uses role 'state' (they are all typed measurements/indicators/text)", function () {
		for (const s of stationIndicatorStates) {
			assert.notStrictEqual(
				s.role,
				"state",
				`Station indicator state ${s.id} must not use the generic "state" role`,
			);
		}
	});

	it("every station indicator state has en and de translations", function () {
		for (const s of stationIndicatorStates) {
			assert.ok(typeof s.name === "object" && s.name.en, `Station indicator state ${s.id} missing English name`);
			assert.ok(typeof s.name === "object" && s.name.de, `Station indicator state ${s.id} missing German name`);
		}
	});

	it("stationIndicatorStateMap indexes every station indicator state exactly once", function () {
		assert.strictEqual(stationIndicatorStateMap.size, stationIndicatorStates.length);
	});

	it("contains the four expected channels: gridMeter, load, pvMeter, generator — no battery here", function () {
		assert.deepStrictEqual(stationIndicatorChannels.map(c => c.id).sort(), [
			"generator",
			"gridMeter",
			"load",
			"pvMeter",
		]);
	});

	it("has no writable state at all — there is exactly one battery place, and it is not here", function () {
		const writable = stationIndicatorStates.filter(s => s.write).map(s => s.id);
		assert.deepStrictEqual(writable, []);
	});

	it("no longer contains any battery.* state (moved below the device — see hybridStates)", function () {
		const ids = stationIndicatorStates.map(s => s.id);
		assert.deepStrictEqual(
			ids.filter(id => id.startsWith("battery.")),
			[],
		);
	});
});
