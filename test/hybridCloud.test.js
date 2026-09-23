import assert from "node:assert";
import {
	CLOUD_DEV_TYPE_BATTERY,
	CLOUD_DEV_TYPE_BATTERY_PACK,
	CLOUD_DEV_TYPE_HYBRID_INVERTER,
	REAL_INDICATOR_TYPE_GRID_METER,
	REAL_INDICATOR_TYPE_PV,
	REAL_INDICATOR_TYPE_LOAD,
	REAL_INDICATOR_TYPE_PV_METER,
	REAL_INDICATOR_TYPE_GENERATOR,
	SETTING_ACTION_BATTERY_MODE_READ,
	FLOW_NODE_BATTERY,
	FLOW_NODE_GRID,
	directedPower,
	mapBatterySettings,
	mapRealIndicators,
	mapStorageStationData,
	stationIndicatorTypes,
	inverterHasPv,
	ENERGY_STATS_MODES,
	ENERGY_STATS_TYPE_PRODUCTION_CONSUMPTION,
	mapEnergyStats,
	mapIncomeStats,
	mapCloudAlarms,
	SETTING_ACTIONS_DRY_CONTACT_READ,
	mapDryContactSettings,
	DAY_CURVES,
	mapDayCurve,
} from "../build/lib/hybridCloud.js";
import { hybridStateMap, stationIndicatorStateMap, stationStates, states } from "../build/lib/stateDefinitions.js";

// Responses as the S-Miles web portal received them for a HAT-6.0HV-EUG1 with battery and
// three-phase grid meter, taken at night (no PV entries in the inverter list). Extended with a
// couple of keys the reference system never delivered but that are part of the cloud's vocabulary.
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
		{ key: "inv_tpv", val: "35", unit: "℃" },
		{ key: "inv_tinv", val: "38", unit: "℃" },
		{ key: "inv_tbat", val: "30", unit: "℃" },
		{ key: "inv_mf", val: "12" },
		{ key: "inv_sf", val: "7" },
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
		{ key: "bms_echg", val: "3200", unit: "Wh" },
		{ key: "bms_edchg", val: "1.5", unit: "kWh" },
		{ key: "bms_cc", val: "42" },
		{ key: "bms_hs", val: "1", fmt_val: "Heating" },
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
		{ key: "grid_ecd", val: "6500", unit: "Wh" },
		{ key: "grid_efd", val: "3000", unit: "Wh" },
		{ key: "grid_ec_a", val: "2.1", unit: "kWh" },
		{ key: "grid_ef_a", val: "1.2", unit: "kWh" },
	],
};

// Real recorded response, taken at night: all inputs report zero.
const PV_NIGHT = {
	title: "IND_PV",
	pv_total: 2,
	phase_type: 3,
	list: [
		{ key: "pv_p_total", val: "0", unit: "W" },
		{ key: "1_pv_v", val: 0, unit: "V" },
		{ key: "1_pv_i", val: 0, unit: "A" },
		{ key: "1_pv_p", val: 0, unit: "W" },
		{ key: "2_pv_v", val: 0, unit: "V" },
		{ key: "2_pv_i", val: 0, unit: "A" },
		{ key: "2_pv_p", val: 0, unit: "W" },
	],
};

// Synthetic daytime response (the night recording never carries non-zero PV entries).
const PV_DAY = {
	title: "IND_PV",
	pv_total: 2,
	list: [
		{ key: "pv_p_total", val: "812", unit: "W" },
		{ key: "pv_e_total", val: "1250", unit: "Wh" },
		{ key: "1_pv_v", val: "380.5", unit: "V" },
		{ key: "1_pv_i", val: "1.2", unit: "A" },
		{ key: "1_pv_p", val: "456", unit: "W" },
		{ key: "1_pv_e", val: "0.62", unit: "kWh" },
		{ key: "2_pv_v", val: "375.0", unit: "V" },
		{ key: "2_pv_i", val: "0.95", unit: "A" },
		{ key: "2_pv_p", val: "356", unit: "W" },
		{ key: "2_pv_e", val: "630", unit: "Wh" },
	],
};

const LOAD = {
	title: "IND_LOAD",
	list: [
		{ key: "frequency", val: "50.04", unit: "Hz" },
		{ key: "v_a", val: "227.1", unit: "V" },
		{ key: "p_a", val: "176", unit: "W" },
		{ key: "v_b", val: "226.1", unit: "V" },
		{ key: "p_b", val: "97", unit: "W" },
		{ key: "v_c", val: "227.4", unit: "V" },
		{ key: "p_c", val: "105", unit: "W" },
	],
};

const PV_METER = {
	title: "IND_PVI",
	list: [
		{ key: "pvi_state", val: "1", fmt_val: "Online" },
		{ key: "frequency", val: "50.04", unit: "Hz" },
		{ key: "p_total", val: "1", unit: "W" },
		{ key: "q_total", val: "89", unit: "Var" },
		{ key: "v_a", val: "227.1", unit: "V" },
		{ key: "i_a", val: "0.13", unit: "A" },
		{ key: "p_a", val: "0", unit: "W" },
		{ key: "q_a", val: "30", unit: "Var" },
	],
};

const GENERATOR = {
	title: "IND_GEN",
	list: [
		{ key: "gen_state", val: "0", fmt_val: "None" },
		{ key: "frequency", val: "0", unit: "Hz" },
		{ key: "p_total", val: "0", unit: "W" },
	],
};

const BATTERY_PACK = {
	title: "IND_BPS",
	list: [
		{ key: "bps_sts", val: "2", fmt_val: "Discharging" },
		{ key: "bps_hs", val: "0", fmt_val: "Off" },
		{ key: "bps_fc", val: "0" },
		{ key: "bps_soc", val: "60", unit: "%" },
		{ key: "bps_soh", val: "98", unit: "%" },
		{ key: "bps_v", val: "306.6", unit: "V" },
		{ key: "bps_i", val: "2.0", unit: "A" },
		{ key: "bps_p", val: "613", unit: "W" },
		{ key: "bps_icm", val: "25.0", unit: "A" },
		{ key: "bps_idm", val: "25.0", unit: "A" },
		{ key: "bps_vch", val: "3.65", unit: "V" },
		{ key: "bps_vcl", val: "3.2", unit: "V" },
		{ key: "bps_tch", val: "28", unit: "℃" },
		{ key: "bps_tcl", val: "26", unit: "℃" },
		{ key: "bps_vc", val: "350", unit: "V" },
		{ key: "bps_vd", val: "280", unit: "V" },
		{ key: "bps_echg", val: "3.2", unit: "kWh" },
		{ key: "bps_edchg", val: "1500", unit: "Wh" },
		{ key: "bps_cc", val: "12" },
	],
};

const valueOf = (mapped, id) => mapped.values.find(v => v.id === id)?.val;

describe("hybridCloud – constants", function () {
	it("uses the device types the cloud reports", function () {
		assert.strictEqual(CLOUD_DEV_TYPE_HYBRID_INVERTER, 6);
		assert.strictEqual(CLOUD_DEV_TYPE_BATTERY, 10);
		assert.strictEqual(CLOUD_DEV_TYPE_BATTERY_PACK, 22);
	});

	it("uses the type selectors the cloud expects for each real-indicator request", function () {
		assert.strictEqual(REAL_INDICATOR_TYPE_GRID_METER, 2);
		assert.strictEqual(REAL_INDICATOR_TYPE_PV, 4);
		assert.strictEqual(REAL_INDICATOR_TYPE_LOAD, 1);
		assert.strictEqual(REAL_INDICATOR_TYPE_PV_METER, 30);
		assert.strictEqual(REAL_INDICATOR_TYPE_GENERATOR, 20);
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

	it("maps the temperature/fault-code keys the reference system never delivered", function () {
		const mapped = mapRealIndicators(INVERTER);
		assert.strictEqual(valueOf(mapped, "inverter.pvHeatsinkTemperature"), 35);
		assert.strictEqual(valueOf(mapped, "inverter.heatsinkTemperature"), 38);
		assert.strictEqual(valueOf(mapped, "inverter.batteryHeatsinkTemperature"), 30);
		assert.strictEqual(valueOf(mapped, "inverter.powerFaultCode"), "12");
		assert.strictEqual(valueOf(mapped, "inverter.safetyFaultCode"), "7");
	});

	it("no longer treats pv_p_total as an inverter-set key (it moved to the PV set)", function () {
		const mapped = mapRealIndicators({ title: "IND_INV", list: [{ key: "pv_p_total", val: "1" }] });
		assert.deepStrictEqual(mapped.values, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["pv_p_total"]);
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

	it("maps the battery set, including the cycle/heating keys", function () {
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
		assert.strictEqual(valueOf(mapped, "battery.cycles"), 42);
		assert.strictEqual(valueOf(mapped, "battery.heating"), 1);
		assert.strictEqual(valueOf(mapped, "battery.heatingText"), "Heating");
	});

	it("drops bms_echg/bms_edchg (charged/discharged today lives in the station's day balance, not twice)", function () {
		const mapped = mapRealIndicators(BATTERY);
		assert.ok(!mapped.values.some(v => v.id === "battery.chargeToday" || v.id === "battery.dischargeToday"));
		assert.ok(!mapped.unknownKeys.includes("bms_echg"));
		assert.ok(!mapped.unknownKeys.includes("bms_edchg"));
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
		assert.strictEqual(valueOf(mapped, "gridMeter.importToday"), 6.5);
		assert.strictEqual(valueOf(mapped, "gridMeter.exportToday"), 3);
		assert.strictEqual(valueOf(mapped, "gridMeter.l1ImportToday"), 2.1);
		assert.strictEqual(valueOf(mapped, "gridMeter.l1ExportToday"), 1.2);
		assert.ok(!mapped.values.some(v => v.id.startsWith("grid.")));
	});

	it("reports a disconnected grid meter as false", function () {
		const mapped = mapRealIndicators({ title: "IND_GRID", list: [{ key: "grid_state", val: "0" }] });
		assert.strictEqual(valueOf(mapped, "gridMeter.connected"), false);
	});

	it("maps the PV set's recorded night response: pv_p_total=0 and every N_pv_* input at zero", function () {
		const mapped = mapRealIndicators(PV_NIGHT);
		assert.strictEqual(valueOf(mapped, "inverter.pvPower"), 0);
		assert.deepStrictEqual(mapped.pv, [
			{ port: 0, field: "voltage", val: 0 },
			{ port: 0, field: "current", val: 0 },
			{ port: 0, field: "power", val: 0 },
			{ port: 1, field: "voltage", val: 0 },
			{ port: 1, field: "current", val: 0 },
			{ port: 1, field: "power", val: 0 },
		]);
		assert.deepStrictEqual(mapped.unknownKeys, []);
	});

	it("maps 1_pv_p / 2_pv_v (the 1-based input number first) onto 0-based ports, and pv_e_total to inverter.pvEnergyToday", function () {
		const mapped = mapRealIndicators(PV_DAY);
		assert.strictEqual(valueOf(mapped, "inverter.pvPower"), 812);
		assert.strictEqual(valueOf(mapped, "inverter.pvEnergyToday"), 1.25);
		const port0 = mapped.pv.filter(p => p.port === 0);
		const port1 = mapped.pv.filter(p => p.port === 1);
		assert.deepStrictEqual(port0, [
			{ port: 0, field: "voltage", val: 380.5 },
			{ port: 0, field: "current", val: 1.2 },
			{ port: 0, field: "power", val: 456 },
			{ port: 0, field: "dailyEnergy", val: 0.62 },
		]);
		assert.deepStrictEqual(port1, [
			{ port: 1, field: "voltage", val: 375 },
			{ port: 1, field: "current", val: 0.95 },
			{ port: 1, field: "power", val: 356 },
			{ port: 1, field: "dailyEnergy", val: 0.63 },
		]);
	});

	it("does not recognize the old 0-based pv_p_0 / pv_v_1 spelling under the PV title", function () {
		const mapped = mapRealIndicators({
			title: "IND_PV",
			list: [
				{ key: "pv_p_0", val: "1200" },
				{ key: "pv_v_1", val: "35.2" },
			],
		});
		assert.deepStrictEqual(mapped.pv, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["pv_p_0", "pv_v_1"]);
	});

	it("does not treat N_pv_* keys as PV inputs outside the IND_PV title", function () {
		const mapped = mapRealIndicators({ title: "IND_INV", list: [{ key: "1_pv_v", val: "1" }] });
		assert.deepStrictEqual(mapped.pv, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["1_pv_v"]);
	});

	it("skips a PV placeholder value silently, like everywhere else", function () {
		const mapped = mapRealIndicators({ title: "IND_PV", list: [{ key: "1_pv_v", val: "-" }] });
		assert.deepStrictEqual(mapped.pv, []);
		assert.deepStrictEqual(mapped.unknownKeys, []);
	});

	it("reports an unconvertible N_pv_e as unknown instead of silently dropping the day's energy", function () {
		const mapped = mapRealIndicators({ title: "IND_PV", list: [{ key: "1_pv_e", val: "5" }] });
		assert.deepStrictEqual(mapped.pv, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["1_pv_e[unit=]"]);
	});

	it("maps the load set; frequency is dropped on purpose, not reported as unknown", function () {
		const mapped = mapRealIndicators(LOAD);
		assert.strictEqual(valueOf(mapped, "load.l1Voltage"), 227.1);
		assert.strictEqual(valueOf(mapped, "load.l1Power"), 176);
		assert.strictEqual(valueOf(mapped, "load.l2Voltage"), 226.1);
		assert.strictEqual(valueOf(mapped, "load.l2Power"), 97);
		assert.strictEqual(valueOf(mapped, "load.l3Voltage"), 227.4);
		assert.strictEqual(valueOf(mapped, "load.l3Power"), 105);
		assert.ok(!mapped.values.some(v => v.id === "load.frequency"));
		assert.deepStrictEqual(mapped.unknownKeys, []);
	});

	it("splits load_state into load.mode and load.modeText, and converts load_ecd/load_ec_a to kWh", function () {
		const mapped = mapRealIndicators({
			title: "IND_LOAD",
			list: [
				{ key: "load_state", val: "1", fmt_val: "Priority" },
				{ key: "load_ecd", val: "2400", unit: "Wh" },
				{ key: "load_ec_a", val: "0.8", unit: "kWh" },
			],
		});
		assert.strictEqual(valueOf(mapped, "load.mode"), 1);
		assert.strictEqual(valueOf(mapped, "load.modeText"), "Priority");
		assert.strictEqual(valueOf(mapped, "load.energyToday"), 2.4);
		assert.strictEqual(valueOf(mapped, "load.l1EnergyToday"), 0.8);
	});

	it("maps the PV meter set (IND_PVI)", function () {
		const mapped = mapRealIndicators(PV_METER);
		assert.strictEqual(valueOf(mapped, "pvMeter.connected"), true);
		assert.strictEqual(valueOf(mapped, "pvMeter.frequency"), 50.04);
		assert.strictEqual(valueOf(mapped, "pvMeter.power"), 1);
		assert.strictEqual(valueOf(mapped, "pvMeter.reactivePower"), 89);
		assert.strictEqual(valueOf(mapped, "pvMeter.l1Voltage"), 227.1);
		assert.strictEqual(valueOf(mapped, "pvMeter.l1Current"), 0.13);
		assert.strictEqual(valueOf(mapped, "pvMeter.l1Power"), 0);
		assert.strictEqual(valueOf(mapped, "pvMeter.l1ReactivePower"), 30);
	});

	it("maps the generator set (IND_GEN), including the absent-generator zero template", function () {
		const mapped = mapRealIndicators(GENERATOR);
		assert.strictEqual(valueOf(mapped, "generator.state"), 0);
		assert.strictEqual(valueOf(mapped, "generator.stateText"), "None");
		assert.strictEqual(valueOf(mapped, "generator.frequency"), 0);
		assert.strictEqual(valueOf(mapped, "generator.power"), 0);
	});

	it("maps e_total/e_a of a metered source (PV meter / generator) to energyToday in kWh", function () {
		const mapped = mapRealIndicators({
			title: "IND_GEN",
			list: [
				{ key: "e_total", val: "12500", unit: "Wh" },
				{ key: "e_a", val: "4.2", unit: "kWh" },
			],
		});
		assert.strictEqual(valueOf(mapped, "generator.energyToday"), 12.5);
		assert.strictEqual(valueOf(mapped, "generator.l1EnergyToday"), 4.2);
	});

	it("maps the battery pack set (IND_BPS) onto the same battery.* states as IND_BMS", function () {
		const mapped = mapRealIndicators(BATTERY_PACK);
		assert.strictEqual(valueOf(mapped, "battery.state"), 2);
		assert.strictEqual(valueOf(mapped, "battery.stateText"), "Discharging");
		assert.strictEqual(valueOf(mapped, "battery.heating"), 0);
		assert.strictEqual(valueOf(mapped, "battery.heatingText"), "Off");
		assert.strictEqual(valueOf(mapped, "battery.faultCode"), "0");
		assert.strictEqual(valueOf(mapped, "battery.soc"), 60);
		assert.strictEqual(valueOf(mapped, "battery.soh"), 98);
		assert.strictEqual(valueOf(mapped, "battery.voltage"), 306.6);
		assert.strictEqual(valueOf(mapped, "battery.current"), 2);
		assert.strictEqual(valueOf(mapped, "battery.power"), 613);
		assert.strictEqual(valueOf(mapped, "battery.maxChargeCurrent"), 25);
		assert.strictEqual(valueOf(mapped, "battery.maxDischargeCurrent"), 25);
		assert.strictEqual(valueOf(mapped, "battery.cellVoltageMax"), 3.65);
		assert.strictEqual(valueOf(mapped, "battery.cellVoltageMin"), 3.2);
		assert.strictEqual(valueOf(mapped, "battery.cellTempMax"), 28);
		assert.strictEqual(valueOf(mapped, "battery.cellTempMin"), 26);
		assert.strictEqual(valueOf(mapped, "battery.chargeCutoffVoltage"), 350);
		assert.strictEqual(valueOf(mapped, "battery.dischargeCutoffVoltage"), 280);
		assert.strictEqual(valueOf(mapped, "battery.cycles"), 12);
		assert.ok(!mapped.values.some(v => v.id === "battery.chargeToday" || v.id === "battery.dischargeToday"));
		assert.deepStrictEqual(mapped.unknownKeys, []);
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

	it("skips a non-finite numeric value (NaN/Infinity delivered as a number, not a string)", function () {
		const mapped = mapRealIndicators({
			title: "IND_BMS",
			list: [
				{ key: "bms_soc", val: NaN },
				{ key: "bms_soh", val: Infinity },
			],
		});
		assert.deepStrictEqual(mapped.values, []);
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
		const known = new Set([...states.map(s => s.id), ...hybridStateMap.keys(), ...stationIndicatorStateMap.keys()]);
		for (const data of [INVERTER, BATTERY, GRID_METER, PV_DAY, PV_NIGHT, LOAD, PV_METER, GENERATOR, BATTERY_PACK]) {
			for (const v of mapRealIndicators(data).values) {
				assert.ok(known.has(v.id), `${v.id} has no state definition`);
			}
		}
	});

	it("delivers the value type the target state declares", function () {
		const defs = new Map([...states.map(s => [s.id, s]), ...hybridStateMap, ...stationIndicatorStateMap]);
		for (const data of [INVERTER, BATTERY, GRID_METER, PV_DAY, PV_NIGHT, LOAD, PV_METER, GENERATOR, BATTERY_PACK]) {
			for (const v of mapRealIndicators(data).values) {
				assert.strictEqual(typeof v.val, defs.get(v.id).type, `${v.id}: ${typeof v.val}`);
			}
		}
	});
});

describe("hybridCloud – energy kind (Wh/kWh/MWh → kWh)", function () {
	const grid = (val, unit) =>
		mapRealIndicators({
			title: "IND_GRID",
			list: [{ key: "grid_ecd", val, ...(unit !== undefined ? { unit } : {}) }],
		});

	it("converts Wh to kWh (×0.001)", function () {
		assert.strictEqual(valueOf(grid("1500", "Wh"), "gridMeter.importToday"), 1.5);
	});

	it("passes kWh through unchanged, case-insensitively", function () {
		assert.strictEqual(valueOf(grid("2.5", "KWH"), "gridMeter.importToday"), 2.5);
		assert.strictEqual(valueOf(grid("2.5", "kWh"), "gridMeter.importToday"), 2.5);
	});

	it("converts MWh to kWh (×1000)", function () {
		assert.strictEqual(valueOf(grid("0.001", "MWh"), "gridMeter.importToday"), 1);
	});

	it("reports a missing unit as unknown instead of guessing", function () {
		const mapped = grid("5", undefined);
		assert.deepStrictEqual(mapped.values, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["grid_ecd[unit=]"]);
	});

	it("reports an unconvertible unit as unknown instead of guessing", function () {
		const mapped = grid("5", "J");
		assert.deepStrictEqual(mapped.values, []);
		assert.deepStrictEqual(mapped.unknownKeys, ["grid_ecd[unit=J]"]);
	});

	it("skips a non-numeric energy value silently", function () {
		const mapped = grid("-", "Wh");
		assert.deepStrictEqual(mapped.values, []);
		assert.deepStrictEqual(mapped.unknownKeys, []);
	});

	it("bms_echg/bms_edchg/bps_echg/bps_edchg are known-but-dropped, not reported as unknown, regardless of unit", function () {
		for (const [title, key] of [
			["IND_BMS", "bms_echg"],
			["IND_BMS", "bms_edchg"],
			["IND_BPS", "bps_echg"],
			["IND_BPS", "bps_edchg"],
		]) {
			const withUnit = mapRealIndicators({ title, list: [{ key, val: "10", unit: "Wh" }] });
			const withoutUnit = mapRealIndicators({ title, list: [{ key, val: "10" }] });
			assert.deepStrictEqual(withUnit.unknownKeys, [], `${key} with unit`);
			assert.deepStrictEqual(withUnit.values, [], `${key} with unit`);
			assert.deepStrictEqual(withoutUnit.unknownKeys, [], `${key} without unit`);
			assert.deepStrictEqual(withoutUnit.values, [], `${key} without unit`);
		}
	});
});

describe("hybridCloud – stationIndicatorTypes", function () {
	it("returns the grid-meter selector only when icon_grid is 1", function () {
		assert.deepStrictEqual(stationIndicatorTypes({ icon_grid: 1 }), [2]);
	});

	it("returns the load selector only when icon_load is 1", function () {
		assert.deepStrictEqual(stationIndicatorTypes({ icon_load: 1 }), [1]);
	});

	it("returns the PV-meter selector only when icon_pvi is 1", function () {
		assert.deepStrictEqual(stationIndicatorTypes({ icon_pvi: 1 }), [30]);
	});

	it("returns the generator selector only when icon_gen is 1", function () {
		assert.deepStrictEqual(stationIndicatorTypes({ icon_gen: 1 }), [20]);
	});

	it("returns all four selectors in grid/load/pvi/gen order when every flag is set", function () {
		assert.deepStrictEqual(
			stationIndicatorTypes({ icon_grid: 1, icon_load: 1, icon_pvi: 1, icon_gen: 1 }),
			[2, 1, 30, 20],
		);
	});

	it("returns nothing for a flag value other than exactly 1", function () {
		assert.deepStrictEqual(stationIndicatorTypes({ icon_grid: 0 }), []);
		assert.deepStrictEqual(stationIndicatorTypes({ icon_grid: "1" }), []);
		assert.deepStrictEqual(stationIndicatorTypes({ icon_grid: true }), []);
	});

	it("returns nothing for a missing or non-object block", function () {
		assert.deepStrictEqual(stationIndicatorTypes(undefined), []);
		assert.deepStrictEqual(stationIndicatorTypes(null), []);
		assert.deepStrictEqual(stationIndicatorTypes("x"), []);
		assert.deepStrictEqual(stationIndicatorTypes({}), []);
	});
});

describe("hybridCloud – directedPower", function () {
	it("uses the node ids of the cloud's flow graph", function () {
		assert.strictEqual(FLOW_NODE_GRID, 2);
		assert.strictEqual(FLOW_NODE_BATTERY, 10);
	});

	it("is positive while the node is a source, whatever sign the reading carries", function () {
		const importing = [{ from: 2, to: 1 }];
		assert.strictEqual(directedPower(273, FLOW_NODE_GRID, importing), 273);
		assert.strictEqual(directedPower(-276, FLOW_NODE_GRID, importing), 276);
	});

	it("is negative while the node is a sink, whatever sign the reading carries", function () {
		const charging = [{ from: 4, to: 10 }];
		assert.strictEqual(directedPower(1500, FLOW_NODE_BATTERY, charging), -1500);
		assert.strictEqual(directedPower(-1500, FLOW_NODE_BATTERY, charging), -1500);
	});

	it("never produces -0", function () {
		assert.ok(Object.is(directedPower(0, FLOW_NODE_GRID, [{ from: 4, to: 2 }]), 0));
	});

	it("keeps the reading as delivered when the graph does not mention the node", function () {
		assert.strictEqual(directedPower(-42, FLOW_NODE_GRID, [{ from: 10, to: 1 }]), -42);
		assert.strictEqual(directedPower(42, FLOW_NODE_GRID, []), 42);
	});
});

describe("hybridCloud – mapEnergyStats", function () {
	// Recorded live 2026-09-24 (mode 3 = September 2026, type 6): the six flows of the app's
	// "Production & Consumption" tab. Production p2l+p2b+p2g = 305.9 kWh and consumption
	// lfp+lfb+lfg = 419.0 kWh equal pv_eq / consumption_eq of the "Overview" tab (type 1); the
	// grid import differs (129.7 vs 211.9 kWh), which is exactly what the user report was about.
	const MONTH = {
		p2b: 155500,
		p2g: 500,
		last_data_time: "2026-09-24 00:52:31",
		lfp: 149900,
		lfb: 139400,
		p2l: 149900,
		lfg: 129700,
	};

	it("uses the app's mode numbers, the day on every poll and the long periods on the slow poll", function () {
		assert.deepStrictEqual(ENERGY_STATS_MODES, [
			{ mode: 1, period: "Today", slowPoll: false },
			{ mode: 3, period: "Month", slowPoll: true },
			{ mode: 4, period: "Year", slowPoll: true },
			{ mode: 5, period: "Total", slowPoll: true },
		]);
	});

	it("asks for the app's 'Production & Consumption' data set (type 6), not the 'Overview' one", function () {
		assert.strictEqual(ENERGY_STATS_TYPE_PRODUCTION_CONSUMPTION, 6);
	});

	it("converts a period's flows from Wh to kWh under period-suffixed ids, consumption summed like the app", function () {
		assert.deepStrictEqual(mapEnergyStats("Month", MONTH), [
			{ suffix: "grid.gridImportMonth", val: 129.7 },
			{ suffix: "grid.gridExportMonth", val: 0.5 },
			{ suffix: "grid.pvToLoadMonth", val: 149.9 },
			{ suffix: "grid.consumptionMonth", val: 419 },
			{ suffix: "grid.selfSufficiencyMonth", val: 69 },
			{ suffix: "grid.batteryChargeMonth", val: 155.5 },
			{ suffix: "grid.batteryDischargeMonth", val: 139.4 },
		]);
		assert.strictEqual(mapEnergyStats("Total", { lfg: "4739100" })[0].val, 4739.1);
	});

	it("computes self-sufficiency like the app: 100 − grid share of consumption, one decimal, 0 without consumption", function () {
		// Year 2026 as recorded: lfg 1850.7 of 5349.2 kWh → 65.4 %.
		const year = mapEnergyStats("Year", { lfp: 1609100, lfb: 1889400, lfg: 1850700 });
		assert.deepStrictEqual(
			year.find(v => v.suffix === "grid.selfSufficiencyYear"),
			{
				suffix: "grid.selfSufficiencyYear",
				val: 65.4,
			},
		);
		const night = mapEnergyStats("Today", { p2l: 0, p2b: 0, p2g: 0, lfp: 0, lfb: 0, lfg: 0 });
		assert.strictEqual(night.find(v => v.suffix === "grid.selfSufficiencyToday").val, 0);
		assert.strictEqual(night.find(v => v.suffix === "grid.consumptionToday").val, 0);
		// Without the full consumption split there is no rate to compute.
		const partial = mapEnergyStats("Today", { lfg: 1000 });
		assert.strictEqual(
			partial.some(v => v.suffix.startsWith("grid.selfSufficiency")),
			false,
		);
		assert.strictEqual(
			partial.some(v => v.suffix.startsWith("grid.consumption")),
			false,
		);
	});

	it("leaves the battery flows out on a plant with a meter but no battery", function () {
		const ids = mapEnergyStats("Month", MONTH, false).map(v => v.suffix);
		assert.deepStrictEqual(ids, [
			"grid.gridImportMonth",
			"grid.gridExportMonth",
			"grid.pvToLoadMonth",
			"grid.consumptionMonth",
			"grid.selfSufficiencyMonth",
		]);
	});

	it("maps nothing for a plant without a balance (only last_data_time) or no data", function () {
		assert.deepStrictEqual(mapEnergyStats("Month", { last_data_time: "2026-09-22 07:37:30" }), []);
		assert.deepStrictEqual(mapEnergyStats("Month", null), []);
		assert.deepStrictEqual(mapEnergyStats("Month", undefined), []);
	});

	it("only targets states that exist, in the type they declare", function () {
		const known = new Map(stationStates.map(d => [d.id, d]));
		for (const period of ["Today", "Month", "Year", "Total"]) {
			for (const v of mapEnergyStats(period, MONTH)) {
				assert.ok(known.has(v.suffix), `${v.suffix} has no state definition`);
				assert.strictEqual(known.get(v.suffix).type, "number");
			}
		}
	});
});

describe("hybridCloud – inverterHasPv", function () {
	it("is false only when the station explicitly reports icon_pv 0", function () {
		assert.strictEqual(inverterHasPv({ icon_pv: 0, icon_pvi: 1 }), false);
		assert.strictEqual(inverterHasPv({ icon_pv: 1 }), true);
		assert.strictEqual(inverterHasPv({}), true, "unknown counts as yes");
		assert.strictEqual(inverterHasPv(undefined), true);
		assert.strictEqual(inverterHasPv("x"), true);
	});
});

describe("hybridCloud – mapStorageStationData", function () {
	// Recorded live. The block also carries the day's energy counters (use_eq_total, efg_total,
	// e2g_total, e2b_total, efb_total) — those belong to the app's "Overview" and are NOT mapped:
	// the day balance comes from the "Production & Consumption" statistics (mapEnergyStats).
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

	it("does not map the block's day counters (the 'Overview' figures) — the day balance has one source only", function () {
		const mapped = mapStorageStationData(BLOCK);
		assert.deepStrictEqual(Object.keys(mapped).sort(), ["battery", "flow", "hasBattery"]);
		assert.strictEqual(mapped.hasBattery, true);
		assert.strictEqual(mapStorageStationData({ ...BLOCK, icon_bms: 0 }).hasBattery, false);
		assert.ok(!Object.keys(toObject(mapped.flow)).some(id => id.endsWith("Today")));
	});

	it("leaves the battery values out on a station with a meter but no battery", function () {
		const mapped = mapStorageStationData({ ...BLOCK, icon_bms: 0 });
		assert.deepStrictEqual(Object.keys(toObject(mapped.flow)), ["grid.gridPower", "grid.loadPower"]);
		assert.deepStrictEqual(mapped.battery, []);
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
		const mapped = mapStorageStationData({ icon_bms: 1, bms_power: "80" });
		assert.deepStrictEqual(mapped.flow, [{ suffix: "grid.batteryPower", val: 80 }]);
		assert.deepStrictEqual(mapped.battery, []);
	});

	it("converts work_mode into a device-level battery.workMode suffix by dividing by 1000 (app sample: 1000 → 1)", function () {
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, work_mode: 1000 }).battery, [
			{ suffix: "battery.workMode", val: 1 },
		]);
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, work_mode: 2000 }).battery, [
			{ suffix: "battery.workMode", val: 2 },
		]);
	});

	it("floors a work_mode that isn't an exact multiple of 1000", function () {
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, work_mode: 2999 }).battery, [
			{ suffix: "battery.workMode", val: 2 },
		]);
	});

	it("leaves battery empty when work_mode is 0, missing, non-numeric, or below 1000", function () {
		for (const work_mode of [0, undefined, "x", 500]) {
			const block = work_mode === undefined ? { ...BLOCK } : { ...BLOCK, work_mode };
			assert.deepStrictEqual(mapStorageStationData(block).battery, [], `work_mode=${work_mode}`);
		}
	});

	it("leaves battery empty on a station with a grid meter but no battery, even with a work_mode", function () {
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, icon_bms: 0, work_mode: 1000 }).battery, []);
	});
});

describe("hybridCloud – mapBatterySettings", function () {
	// Real recorded result of the battery settings read (pvm-ctl action 1013).
	const RESULT = {
		mode: 1,
		data: {
			k_5: { reserve_soc: 90, max_power: 50 },
			k_4: {},
			k_7: { reserve_soc: 20, max_soc: 75, meter_power: "0" },
			k_6: { reserve_soc: 30, max_power: 50 },
			k_8: {
				reserve_soc: 30,
				time: [
					{
						cs_time: "09:01",
						ce_time: "14:00",
						c_power: 50,
						dcs_time: "14:01",
						dce_time: "23:59",
						dc_power: 10,
						charge_soc: 90,
						dis_charge_soc: 50,
					},
				],
			},
			k_1: { reserve_soc: 15 },
			k_3: { reserve_soc: 70 },
			k_2: { reserve_soc: 15, money_code: "$" },
		},
	};

	it("uses the pvm-ctl action code the portal uses for the settings-read task", function () {
		assert.strictEqual(SETTING_ACTION_BATTERY_MODE_READ, 1013);
	});

	it("maps the recorded result: mode 1, its reserve_soc, and the full settings as JSON", function () {
		const values = mapBatterySettings(RESULT);
		const byId = Object.fromEntries(values.map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["battery.workMode"], 1);
		assert.strictEqual(byId["battery.reserveSoc"], 15);
		assert.strictEqual(byId["battery.settingsJson"], JSON.stringify(RESULT));
		// The S-Miles app reads `emspara` and `relay` out of the same answer — passed through whole.
		const withExtras = mapBatterySettings({ ...RESULT, emspara: { tou: 1 }, relay: { mode: 2 } });
		assert.ok(withExtras.find(v => v.suffix === "battery.settingsJson").val.includes('"relay":{"mode":2}'));
	});

	it("omits battery.reserveSoc when the active mode has none (mode 4 → k_4: {})", function () {
		const values = mapBatterySettings({ ...RESULT, mode: 4 });
		const byId = Object.fromEntries(values.map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["battery.workMode"], 4);
		assert.strictEqual(byId["battery.reserveSoc"], undefined);
		assert.ok("battery.settingsJson" in byId, "settingsJson must still be emitted");
	});

	it("returns [] for null/undefined/missing mode or a mode below 1", function () {
		assert.deepStrictEqual(mapBatterySettings(null), []);
		assert.deepStrictEqual(mapBatterySettings(undefined), []);
		assert.deepStrictEqual(mapBatterySettings({}), []);
		assert.deepStrictEqual(mapBatterySettings({ mode: 0 }), []);
		assert.deepStrictEqual(mapBatterySettings({ mode: -1 }), []);
	});

	it("still emits settingsJson when mode is present but data is missing", function () {
		const values = mapBatterySettings({ mode: 1 });
		const byId = Object.fromEntries(values.map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["battery.workMode"], 1);
		assert.strictEqual(byId["battery.reserveSoc"], undefined);
		assert.strictEqual(byId["battery.settingsJson"], JSON.stringify({ mode: 1 }));
	});

	it("only targets states that exist, with the value type the target state declares", function () {
		const defs = new Map([...states.map(s => [s.id, s]), ...hybridStateMap, ...stationIndicatorStateMap]);
		for (const data of [RESULT, { ...RESULT, mode: 4 }]) {
			for (const v of mapBatterySettings(data)) {
				const def = defs.get(v.suffix);
				assert.ok(def, `${v.suffix} has no state definition`);
				assert.strictEqual(typeof v.val, def.type, `${v.suffix}: ${typeof v.val}`);
			}
		}
	});
});

describe("hybridCloud – mapIncomeStats", function () {
	// Real recorded result of /eps/api/0/record/stat_a.
	const RESULT = {
		sid: 1,
		unit: "EUR(€)",
		today_profit: 0.034,
		monthly_profit: 93.574,
		yearly_profit: 1235.754,
		total_profit: 2576.398,
		today_spend: 1.632,
		monthly_spend: 68.476,
		yearly_spend: 1008.712,
		total_spend: 2381.564,
	};

	it("maps the recorded result, rounded to 2 decimals", function () {
		const byId = Object.fromEntries(mapIncomeStats(RESULT).map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["grid.todayIncome"], 0.03);
		assert.strictEqual(byId["grid.monthIncome"], 93.57);
		assert.strictEqual(byId["grid.yearIncome"], 1235.75);
		assert.strictEqual(byId["grid.totalIncome"], 2576.4);
		assert.strictEqual(byId["grid.todayCost"], 1.63);
		assert.strictEqual(byId["grid.monthCost"], 68.48);
		assert.strictEqual(byId["grid.yearCost"], 1008.71);
		assert.strictEqual(byId["grid.totalCost"], 2381.56);
	});

	it("ignores non-numeric fields (sid, unit) without throwing", function () {
		const ids = mapIncomeStats(RESULT).map(v => v.suffix);
		assert.ok(!ids.some(id => id.includes("sid")));
		assert.ok(!ids.some(id => id.includes("unit")));
	});

	it("returns [] for null or undefined", function () {
		assert.deepStrictEqual(mapIncomeStats(null), []);
		assert.deepStrictEqual(mapIncomeStats(undefined), []);
	});

	it("skips a non-numeric value for one key, keeping the rest", function () {
		const mapped = mapIncomeStats({ ...RESULT, today_profit: "N/A" });
		const byId = Object.fromEntries(mapped.map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["grid.todayIncome"], undefined);
		assert.strictEqual(byId["grid.monthIncome"], 93.57);
	});

	it("only targets states that exist, with the value type the target state declares", function () {
		const defs = new Map(stationStates.map(s => [s.id, s]));
		for (const v of mapIncomeStats(RESULT)) {
			const def = defs.get(v.suffix);
			assert.ok(def, `${v.suffix} has no state definition`);
			assert.strictEqual(typeof v.val, def.type, `${v.suffix}: ${typeof v.val}`);
		}
	});
});

describe("hybridCloud – mapCloudAlarms", function () {
	const LISTS = [
		{
			total: 1,
			list: [
				{
					name: "Inverter123",
					sn: "INV1",
					warns: [{ code: 209, time: "2026-09-20 10:00:00", pre: "L3", wd1: 1, wd2: 0, wd3: 0, wd4: 0 }],
				},
			],
		},
		{
			total: 1,
			list: [{ name: "DTU1", sn: "DTU1", warns: [{ code: 5, time: "2026-09-20 09:00:00", wd1: 2 }] }],
		},
	];

	it("counts every warning across all lists and builds a flat JSON array with code/time/pre/source/data", function () {
		const mapped = mapCloudAlarms(LISTS);
		assert.strictEqual(mapped.count, 2);
		const alarms = JSON.parse(mapped.json);
		assert.strictEqual(alarms.length, 2);
		assert.deepStrictEqual(alarms[0], {
			code: 209,
			time: "2026-09-20 10:00:00",
			pre: "L3",
			source: "Inverter123",
			data: [1, 0, 0, 0],
		});
		// No "pre" in the source warn at all — JSON.stringify drops an undefined object property
		// (unlike an array element, which becomes null; that still shows up in "data" below).
		assert.deepStrictEqual(alarms[1], {
			code: 5,
			time: "2026-09-20 09:00:00",
			source: "DTU1",
			data: [2, null, null, null],
		});
	});

	it("returns count:0 and json:'[]' for an empty input", function () {
		assert.deepStrictEqual(mapCloudAlarms([]), { count: 0, json: "[]" });
	});

	it("tolerates null lists, null entries, null/missing warns, and malformed warn entries", function () {
		const mapped = mapCloudAlarms([
			null,
			undefined,
			{ list: null },
			{ list: [null, { warns: null }, { warns: [null, "not-an-object", { code: 1 }] }] },
		]);
		assert.strictEqual(mapped.count, 1);
		// time/pre/source are all undefined here and get dropped by JSON.stringify.
		assert.deepStrictEqual(JSON.parse(mapped.json), [{ code: 1, data: [null, null, null, null] }]);
	});
});

describe("hybridCloud – SETTING_ACTIONS_DRY_CONTACT_READ / mapDryContactSettings", function () {
	it("tries 1014 then 1024", function () {
		assert.deepStrictEqual(SETTING_ACTIONS_DRY_CONTACT_READ, [1014, 1024]);
	});

	// Real recorded result: mode 0 is a legitimate answer (relay off), not a missing value.
	const RESULT = { mode: 0, data: { k_1: {}, k_3: { threshold: 50 }, k_2: { mode: 2, threshold: 80 } } };

	it("maps the recorded result: mode 0 is valid, settingsJson is the whole result", function () {
		const values = mapDryContactSettings(RESULT);
		const byId = Object.fromEntries(values.map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["dryContact.mode"], 0);
		assert.strictEqual(byId["dryContact.settingsJson"], JSON.stringify(RESULT));
	});

	it("returns [] when mode is missing, null, undefined, or non-numeric", function () {
		assert.deepStrictEqual(mapDryContactSettings(null), []);
		assert.deepStrictEqual(mapDryContactSettings(undefined), []);
		assert.deepStrictEqual(mapDryContactSettings({}), []);
		assert.deepStrictEqual(mapDryContactSettings({ mode: "x" }), []);
	});

	it("only targets states that exist, with the value type the target state declares", function () {
		const defs = new Map([...states.map(s => [s.id, s]), ...hybridStateMap]);
		for (const v of mapDryContactSettings(RESULT)) {
			const def = defs.get(v.suffix);
			assert.ok(def, `${v.suffix} has no state definition`);
			assert.strictEqual(typeof v.val, def.type, `${v.suffix}: ${typeof v.val}`);
		}
	});
});

describe("hybridCloud – DAY_CURVES", function () {
	it("has the 4 documented specs (inverter power/battery power/PV power, battery soc)", function () {
		assert.deepStrictEqual(DAY_CURVES, [
			{ devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "p_total", suffix: "history.powerJson" },
			{ devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "inv_pbat", suffix: "history.batteryPowerJson" },
			{
				devType: CLOUD_DEV_TYPE_HYBRID_INVERTER,
				indicator: "pv_p_total",
				suffix: "history.pvPowerJson",
				needsPv: true,
			},
			{ devType: CLOUD_DEV_TYPE_BATTERY, indicator: "bms_soc", suffix: "history.socJson" },
		]);
	});

	it("only targets states that exist, and every suffix lives under the history channel", function () {
		for (const spec of DAY_CURVES) {
			assert.ok(hybridStateMap.has(spec.suffix), `${spec.suffix} has no state definition`);
			assert.ok(spec.suffix.startsWith("history."), `${spec.suffix} does not live under history.*`);
		}
	});
});

describe("hybridCloud – mapDayCurve", function () {
	const DAY_START = Date.UTC(2026, 8, 22, 0, 0, 0); // station-local midnight, as an epoch

	it("converts minutes/values into json (rounded to 1 decimal), startTime and stepTime", function () {
		const mapped = mapDayCurve({ minutes: [0, 5, 10], values: [100.123, 150.456, 120] }, DAY_START);
		assert.deepStrictEqual(mapped, {
			json: JSON.stringify([100.1, 150.5, 120]),
			startTime: DAY_START,
			stepTime: 300,
		});
	});

	it("offsets startTime by the first sample's minute-of-day", function () {
		const mapped = mapDayCurve({ minutes: [10, 15], values: [1, 2] }, DAY_START);
		assert.strictEqual(mapped.startTime, DAY_START + 10 * 60_000);
	});

	it("defaults the step to 5 minutes when there is only a single sample", function () {
		const mapped = mapDayCurve({ minutes: [10], values: [55] }, DAY_START);
		assert.strictEqual(mapped.stepTime, 300);
		assert.strictEqual(mapped.startTime, DAY_START + 10 * 60_000);
	});

	it("floors the step at 60s (1 minute) even if two samples share the same minute", function () {
		const mapped = mapDayCurve({ minutes: [10, 10, 20], values: [1, 2, 3] }, DAY_START);
		assert.strictEqual(mapped.stepTime, 60);
	});

	it("returns null for a missing, empty, or length-mismatched curve", function () {
		assert.strictEqual(mapDayCurve(null, DAY_START), null);
		assert.strictEqual(mapDayCurve(undefined, DAY_START), null);
		assert.strictEqual(mapDayCurve({ minutes: [], values: [] }, DAY_START), null);
		assert.strictEqual(mapDayCurve({ minutes: [0, 5], values: [1] }, DAY_START), null);
	});
});
