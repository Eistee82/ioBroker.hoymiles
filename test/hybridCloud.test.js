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
	mapBatterySettings,
	mapRealIndicators,
	mapStorageStationData,
	stationIndicatorTypes,
} from "../build/lib/hybridCloud.js";
import { hybridStateMap, stationIndicatorStateMap, states } from "../build/lib/stateDefinitions.js";

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

	it("maps the battery set, including the new energy/cycle/heating keys", function () {
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
		assert.strictEqual(valueOf(mapped, "battery.chargeToday"), 3.2);
		assert.strictEqual(valueOf(mapped, "battery.dischargeToday"), 1.5);
		assert.strictEqual(valueOf(mapped, "battery.cycles"), 42);
		assert.strictEqual(valueOf(mapped, "battery.heating"), 1);
		assert.strictEqual(valueOf(mapped, "battery.heatingText"), "Heating");
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
		assert.strictEqual(valueOf(mapped, "battery.chargeToday"), 3.2);
		assert.strictEqual(valueOf(mapped, "battery.dischargeToday"), 1.5);
		assert.strictEqual(valueOf(mapped, "battery.cycles"), 12);
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

	it("matches the documented example: bms_echg without a unit", function () {
		const mapped = mapRealIndicators({ title: "IND_BMS", list: [{ key: "bms_echg", val: "10" }] });
		assert.deepStrictEqual(mapped.unknownKeys, ["bms_echg[unit=]"]);
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
			"battery.chargeToday": 7.8,
			"battery.dischargeToday": 5.4,
		});
	});

	it("delivers the live flow in watts and the state of charge in percent", function () {
		assert.deepStrictEqual(toObject(mapStorageStationData(BLOCK).flow), {
			"grid.gridPower": 0,
			"grid.loadPower": 567,
			"grid.batteryPower": 567,
			"battery.soc": 25,
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
		assert.deepStrictEqual(mapped.info, []);
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
		assert.deepStrictEqual(mapped.flow, [{ suffix: "battery.soc", val: 80 }]);
		assert.deepStrictEqual(mapped.energy, []);
		assert.deepStrictEqual(mapped.info, []);
	});

	it("converts work_mode into battery.workMode by dividing by 1000 (app sample: 1000 → 1)", function () {
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, work_mode: 1000 }).info, [
			{ suffix: "battery.workMode", val: 1 },
		]);
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, work_mode: 2000 }).info, [
			{ suffix: "battery.workMode", val: 2 },
		]);
	});

	it("floors a work_mode that isn't an exact multiple of 1000", function () {
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, work_mode: 2999 }).info, [
			{ suffix: "battery.workMode", val: 2 },
		]);
	});

	it("leaves info empty when work_mode is 0, missing, non-numeric, or below 1000", function () {
		for (const work_mode of [0, undefined, "x", 500]) {
			const block = work_mode === undefined ? { ...BLOCK } : { ...BLOCK, work_mode };
			assert.deepStrictEqual(mapStorageStationData(block).info, [], `work_mode=${work_mode}`);
		}
	});

	it("leaves info empty on a station with a grid meter but no battery, even with a work_mode", function () {
		assert.deepStrictEqual(mapStorageStationData({ ...BLOCK, icon_bms: 0, work_mode: 1000 }).info, []);
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
		assert.strictEqual(byId["battery.settingsJson"], JSON.stringify({ mode: 1, data: RESULT.data }));
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

	it("still emits settingsJson (as data: {}) when mode is present but data is missing", function () {
		const values = mapBatterySettings({ mode: 1 });
		const byId = Object.fromEntries(values.map(v => [v.suffix, v.val]));
		assert.strictEqual(byId["battery.workMode"], 1);
		assert.strictEqual(byId["battery.reserveSoc"], undefined);
		assert.strictEqual(byId["battery.settingsJson"], JSON.stringify({ mode: 1, data: {} }));
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
