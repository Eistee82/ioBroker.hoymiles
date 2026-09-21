import assert from "node:assert";
import {
	CLOUD_DEV_TYPE_BATTERY,
	CLOUD_DEV_TYPE_HYBRID_INVERTER,
	REAL_INDICATOR_TYPE_GRID_METER,
	mapRealIndicators,
	mapStorageStationData,
} from "../build/lib/hybridCloud.js";
import { hybridStateMap, states } from "../build/lib/stateDefinitions.js";

// Responses as the S-Miles web portal received them for a HAT-6.0HV-EUG1 with battery and
// three-phase grid meter, taken at night (no PV entries in the inverter list).
const INVERTER = {
	pv_total: 2,
	title: "IND_INV",
	phase_type: 3,
	list: [
		{ key: "role", name: "Master/Slave", val: "0", fmt_val: "Single" },
		{ key: "inv_state", name: "Operating state", val: "3", fmt_val: "On-grid mode" },
		{ key: "p_total", val: 543, unit: "W" },
		{ key: "frequency", val: "50.05", unit: "Hz" },
		{ key: "inv_drm", val: "0" },
		{ key: "inv_tin", val: "40", unit: "℃" },
		{ key: "v_a", val: "226.1", unit: "V" },
		{ key: "i_a", val: "1.24", unit: "A" },
		{ key: "p_a", val: "198", unit: "W" },
		{ key: "q_a", val: "-10", unit: "Var" },
		{ key: "veps_a", val: "2.5", unit: "V" },
		{ key: "ieps_a", val: "-0.92", unit: "A" },
		{ key: "peps_a", val: "-2", unit: "W" },
		{ key: "inv_vbus", val: "711.3", unit: "V" },
		{ key: "v_b", val: "225.2", unit: "V" },
		{ key: "q_c", val: "1", unit: "Var" },
		{ key: "peps_c", val: "0", unit: "W" },
		{ key: "inv_vbat", val: "308.1", unit: "V" },
		{ key: "inv_ibat", val: "1.86", unit: "A" },
		{ key: "inv_pbat", val: "523", unit: "W" },
	],
	last_data_time: "2026-09-21 21:07:31",
};

const BATTERY = {
	title: "IND_BMS",
	list: [
		{ key: "bms_type", val: "1", fmt_val: "Li-Ion" },
		{ key: "bms_soc", val: "24", unit: "%" },
		{ key: "bms_fc", val: "0", fmt_val: "0" },
		{ key: "bms_state", val: "2", fmt_val: "Discharging" },
		{ key: "bms_soh", val: "95", unit: "%", fmt_val: 95.0 },
		{ key: "bms_v", val: "306.6", unit: "V" },
		{ key: "bms_i", val: "2.0", unit: "A" },
		{ key: "bms_p", val: "613", unit: "W" },
		{ key: "bms_icm", val: "25.0", unit: "A" },
		{ key: "bms_vcl", val: "3.199", unit: "V", fmt_val: 3.199 },
	],
};

const GRID_METER = {
	title: "IND_GRID",
	list: [
		{ key: "grid_state", val: "1", fmt_val: "Online" },
		{ key: "p_total", val: -33, unit: "W" },
		{ key: "grid_pfd", val: "0.0" },
		{ key: "grid_f", val: "50.03", unit: "Hz" },
		{ key: "q_total", val: "510", unit: "Var" },
		{ key: "v_a", val: "227.9", unit: "V" },
		{ key: "pf_a", val: "-0.27" },
		{ key: "p_c", val: "76", unit: "W" },
	],
};

const valueOf = (mapped, id) => mapped.values.find(v => v.id === id)?.val;

describe("hybridCloud – constants", function () {
	it("uses the device types the cloud reports", function () {
		assert.strictEqual(CLOUD_DEV_TYPE_HYBRID_INVERTER, 6);
		assert.strictEqual(CLOUD_DEV_TYPE_BATTERY, 10);
		assert.strictEqual(REAL_INDICATOR_TYPE_GRID_METER, 2);
	});
});

describe("hybridCloud – mapRealIndicators", function () {
	it("maps the inverter set onto the shared and the hybrid states", function () {
		const mapped = mapRealIndicators(INVERTER);
		assert.strictEqual(valueOf(mapped, "grid.power"), 543);
		assert.strictEqual(valueOf(mapped, "grid.frequency"), 50.05);
		assert.strictEqual(valueOf(mapped, "inverter.temperature"), 40);
		assert.strictEqual(valueOf(mapped, "grid.l1Voltage"), 226.1);
		assert.strictEqual(valueOf(mapped, "grid.l1Current"), 1.24);
		assert.strictEqual(valueOf(mapped, "grid.l1Power"), 198);
		assert.strictEqual(valueOf(mapped, "grid.l2Voltage"), 225.2);
		assert.strictEqual(valueOf(mapped, "grid.l3ReactivePower"), 1);
		assert.strictEqual(valueOf(mapped, "eps.l1Voltage"), 2.5);
		assert.strictEqual(valueOf(mapped, "eps.l3Power"), 0);
		assert.strictEqual(valueOf(mapped, "inverter.busVoltage"), 711.3);
		assert.strictEqual(valueOf(mapped, "battery.inverterPower"), 523);
	});

	it("keeps negative values negative", function () {
		const mapped = mapRealIndicators(INVERTER);
		assert.strictEqual(valueOf(mapped, "grid.l1ReactivePower"), -10);
		assert.strictEqual(valueOf(mapped, "eps.l1Current"), -0.92);
		assert.strictEqual(valueOf(mapped, "eps.l1Power"), -2);
	});

	it("splits an enumeration into its number and its display text", function () {
		const mapped = mapRealIndicators(INVERTER);
		assert.strictEqual(valueOf(mapped, "inverter.operatingState"), 3);
		assert.strictEqual(valueOf(mapped, "inverter.operatingStateText"), "On-grid mode");
	});

	it("drops keys that are deliberately not exposed without reporting them as unknown", function () {
		const mapped = mapRealIndicators(INVERTER);
		assert.deepStrictEqual(mapped.unknownKeys, []);
		assert.ok(!mapped.values.some(v => v.id.includes("role")));
	});

	it("maps the battery set", function () {
		const mapped = mapRealIndicators(BATTERY);
		assert.strictEqual(valueOf(mapped, "battery.type"), "Li-Ion");
		assert.strictEqual(valueOf(mapped, "battery.soc"), 24);
		assert.strictEqual(valueOf(mapped, "battery.soh"), 95);
		assert.strictEqual(valueOf(mapped, "battery.state"), 2);
		assert.strictEqual(valueOf(mapped, "battery.stateText"), "Discharging");
		assert.strictEqual(valueOf(mapped, "battery.faultCode"), "0");
		assert.strictEqual(valueOf(mapped, "battery.power"), 613);
		assert.strictEqual(valueOf(mapped, "battery.maxChargeCurrent"), 25);
		assert.strictEqual(valueOf(mapped, "battery.cellVoltageMin"), 3.199);
	});

	it("maps the grid meter set, the same keys landing on gridMeter.* instead of grid.*", function () {
		const mapped = mapRealIndicators(GRID_METER);
		assert.strictEqual(valueOf(mapped, "gridMeter.connected"), true);
		assert.strictEqual(valueOf(mapped, "gridMeter.power"), -33);
		assert.strictEqual(valueOf(mapped, "gridMeter.powerFactor"), 0);
		assert.strictEqual(valueOf(mapped, "gridMeter.frequency"), 50.03);
		assert.strictEqual(valueOf(mapped, "gridMeter.reactivePower"), 510);
		assert.strictEqual(valueOf(mapped, "gridMeter.l1Voltage"), 227.9);
		assert.strictEqual(valueOf(mapped, "gridMeter.l1PowerFactor"), -0.27);
		assert.strictEqual(valueOf(mapped, "gridMeter.l3Power"), 76);
		assert.ok(!mapped.values.some(v => v.id.startsWith("grid.")));
	});

	it("reports a disconnected grid meter as false", function () {
		const mapped = mapRealIndicators({ title: "IND_GRID", list: [{ key: "grid_state", val: "0" }] });
		assert.strictEqual(valueOf(mapped, "gridMeter.connected"), false);
	});

	it("maps 0-based PV input keys onto 0-based ports", function () {
		const mapped = mapRealIndicators({
			title: "IND_INV",
			list: [
				{ key: "pv_p_0", val: "1200" },
				{ key: "pv_v_0", val: "380.5" },
				{ key: "pv_i_1", val: "3.1" },
			],
		});
		assert.deepStrictEqual(mapped.pv, [
			{ port: 0, field: "power", val: 1200 },
			{ port: 0, field: "voltage", val: 380.5 },
			{ port: 1, field: "current", val: 3.1 },
		]);
		assert.deepStrictEqual(mapped.unknownKeys, []);
	});

	it("normalizes 1-based PV input keys onto 0-based ports", function () {
		const mapped = mapRealIndicators({
			title: "IND_INV",
			list: [
				{ key: "pv_p_1", val: "1200" },
				{ key: "pv_p_2", val: "900" },
			],
		});
		assert.deepStrictEqual(
			mapped.pv.map(p => p.port),
			[0, 1],
		);
	});

	it("does not treat pv_* keys as PV inputs outside the inverter set", function () {
		const mapped = mapRealIndicators({ title: "IND_BMS", list: [{ key: "pv_p_0", val: "1" }] });
		assert.deepStrictEqual(mapped.pv, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["pv_p_0"]);
	});

	it("collects keys it has no state for", function () {
		const mapped = mapRealIndicators({
			title: "IND_INV",
			list: [
				{ key: "p_total", val: 1 },
				{ key: "brand_new_key", val: "7" },
			],
		});
		assert.deepStrictEqual(mapped.unknownKeys, ["brand_new_key"]);
		assert.strictEqual(mapped.values.length, 1);
	});

	it("skips placeholders instead of writing 0", function () {
		const mapped = mapRealIndicators({
			title: "IND_BMS",
			list: [
				{ key: "bms_soc", val: "-" },
				{ key: "bms_v", val: "" },
				{ key: "bms_i", val: null },
				{ key: "bms_p" },
				{ key: "bms_state", val: "2", fmt_val: "" },
				{ key: "bms_fc", val: "" },
			],
		});
		assert.deepStrictEqual(mapped.values, [{ id: "battery.state", val: 2 }]);
	});

	it("returns an empty result for an unknown set, a missing list or no data at all", function () {
		const empty = { values: [], pv: [], unknownKeys: [] };
		assert.deepStrictEqual(mapRealIndicators({ title: "IND_OTHER", list: [{ key: "p_total", val: 1 }] }), empty);
		assert.deepStrictEqual(mapRealIndicators({ title: "IND_INV" }), empty);
		assert.deepStrictEqual(mapRealIndicators(null), empty);
		assert.deepStrictEqual(mapRealIndicators(undefined), empty);
	});

	it("tolerates malformed list entries", function () {
		const mapped = mapRealIndicators({
			title: "IND_INV",
			list: [null, {}, { key: 5 }, { key: "p_total", val: 9 }],
		});
		assert.deepStrictEqual(mapped.values, [{ id: "grid.power", val: 9 }]);
	});

	it("only targets states that exist", function () {
		const known = new Set([...states.map(s => s.id), ...hybridStateMap.keys()]);
		for (const data of [INVERTER, BATTERY, GRID_METER]) {
			for (const v of mapRealIndicators(data).values) {
				assert.ok(known.has(v.id), `${v.id} has no state definition`);
			}
		}
	});

	it("delivers the value type the target state declares", function () {
		const defs = new Map([...states.map(s => [s.id, s]), ...hybridStateMap]);
		for (const data of [INVERTER, BATTERY, GRID_METER]) {
			for (const v of mapRealIndicators(data).values) {
				assert.strictEqual(typeof v.val, defs.get(v.id).type, `${v.id}: ${typeof v.val}`);
			}
		}
	});
});

describe("hybridCloud – mapStorageStationData", function () {
	// Checked against the portal's dashboard: from grid 6.5, to grid 3, charged 7.8, discharged 5.4,
	// consumption 14.3 kWh.
	const BLOCK = {
		grid_power: "0.0",
		load_power: "567.0",
		bms_power: "567.0",
		bms_soc: "25",
		icon_bms: 1,
		icon_grid: 1,
		use_eq_total: "14300",
		efg_total: "6500",
		e2g_total: "3000",
		e2b_total: "7800",
		efb_total: "5400",
	};
	const toObject = list => Object.fromEntries(list.map(e => [e.suffix, e.val]));

	it("converts the day's energy balance from Wh to kWh", function () {
		assert.deepStrictEqual(toObject(mapStorageStationData(BLOCK).energy), {
			"grid.consumptionToday": 14.3,
			"grid.gridImportToday": 6.5,
			"grid.gridExportToday": 3,
			"grid.batteryChargeToday": 7.8,
			"grid.batteryDischargeToday": 5.4,
		});
	});

	it("delivers the live flow in watts and the state of charge in percent", function () {
		assert.deepStrictEqual(toObject(mapStorageStationData(BLOCK).flow), {
			"grid.gridPower": 0,
			"grid.loadPower": 567,
			"grid.batteryPower": 567,
			"grid.batterySoc": 25,
		});
	});

	it("leaves the battery values out on a station with a meter but no battery", function () {
		const mapped = mapStorageStationData({ ...BLOCK, icon_bms: 0 });
		assert.deepStrictEqual(Object.keys(toObject(mapped.flow)), ["grid.gridPower", "grid.loadPower"]);
		assert.deepStrictEqual(Object.keys(toObject(mapped.energy)), [
			"grid.consumptionToday",
			"grid.gridImportToday",
			"grid.gridExportToday",
		]);
	});

	it("returns null for a plain PV station, whose block is present but meaningless", function () {
		assert.strictEqual(mapStorageStationData({ ...BLOCK, icon_bms: 0, icon_grid: 0 }), null);
		assert.strictEqual(mapStorageStationData({}), null);
	});

	it("returns null when the block is missing or not an object", function () {
		assert.strictEqual(mapStorageStationData(undefined), null);
		assert.strictEqual(mapStorageStationData(null), null);
		assert.strictEqual(mapStorageStationData("x"), null);
	});

	it("skips values the cloud did not deliver", function () {
		const mapped = mapStorageStationData({ icon_bms: 1, bms_soc: "80" });
		assert.deepStrictEqual(mapped.flow, [{ suffix: "grid.batterySoc", val: 80 }]);
		assert.deepStrictEqual(mapped.energy, []);
	});
});
