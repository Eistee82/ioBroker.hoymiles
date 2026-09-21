/**
 * Cloud data of hybrid (storage) inverters such as the Hoymiles HAT series.
 *
 * These devices are not microinverters: the cloud files them under their own device types and
 * serves their live values through `select_real_indicators_data` — a plain JSON list of
 * `{key, val, unit}` entries — instead of the protobuf day charts the microinverter path reads.
 * The key names below were taken from the S-Miles web portal talking to a real
 * HAT-6.0HV-EUG1 with a HB-(10-23)S-G2 battery and a three-phase grid meter.
 *
 * This module only translates; it performs no I/O, so it can be tested on recorded responses.
 */

/** Cloud device type of a hybrid (storage) inverter. Microinverters are type 3. */
export const CLOUD_DEV_TYPE_HYBRID_INVERTER = 6;
/** Cloud device type of a battery; it hangs below its hybrid inverter in the device tree. */
export const CLOUD_DEV_TYPE_BATTERY = 10;
/** `type` selector of the real-indicator request that returns the station's grid meter. */
export const REAL_INDICATOR_TYPE_GRID_METER = 2;

/** `title` values of a real-indicator response — they name the indicator set that was returned. */
export const INDICATOR_SET_INVERTER = "IND_INV";
export const INDICATOR_SET_GRID_METER = "IND_GRID";
export const INDICATOR_SET_BATTERY = "IND_BMS";

/** One entry of a real-indicator list. */
export interface RealIndicator {
	/** Stable, language-independent key, e.g. `p_total` or `bms_soc`. */
	key: string;
	/** Raw value; numbers mostly arrive as strings. */
	val?: string | number | null;
	/** Display unit, absent on enumerations. */
	unit?: string;
	/** Localized display text of an enumeration value (follows the request's `language` header). */
	fmt_val?: string | number | null;
	/** Localized display name. */
	name?: string;
}

/** Decoded `data` object of a `select_real_indicators_data` response. */
export interface RealIndicatorData {
	/** Indicator set, e.g. `IND_INV`. */
	title?: string;
	/** Number of PV inputs of the inverter. */
	pv_total?: number;
	/** 1 = single-phase, 3 = three-phase. */
	phase_type?: number;
	/** The indicators themselves. */
	list?: RealIndicator[];
	/** Station-local wall clock of the sample. */
	last_data_time?: string;
}

/** One value destined for a `<dtuSerial>.<id>` state. */
export interface MappedValue {
	/** State id below the device, e.g. `battery.soc`. */
	id: string;
	/** Value in the type the target state declares. */
	val: number | string | boolean;
}

/** Per-PV-input field, 0-based port as the adapter numbers its `pvN` channels. */
export interface MappedPvValue {
	/** 0-based PV input, i.e. the `N` of `pvN`. */
	port: number;
	/** State name below the `pvN` channel. */
	field: "power" | "voltage" | "current";
	/** Measured value (W, V or A). */
	val: number;
}

/** Result of translating one indicator list. */
export interface MappedIndicators {
	/** Values for fixed state ids. */
	values: MappedValue[];
	/** Values for the dynamic `pvN` channels. */
	pv: MappedPvValue[];
	/** Keys without a mapping — logged so that a new firmware's additions do not go unnoticed. */
	unknownKeys: string[];
}

type Kind = "number" | "text" | "fmtText" | "isOne";
type Mapping = { id: string; kind: Kind } | Array<{ id: string; kind: Kind }>;

const num = (id: string): { id: string; kind: Kind } => ({ id, kind: "number" });

/** Phase letter of the cloud → phase number of the adapter's state ids. */
const PHASES: ReadonlyArray<[string, number]> = [
	["a", 1],
	["b", 2],
	["c", 3],
];

const INVERTER_KEYS: Record<string, Mapping> = {
	// The aggregate values land on the states every device already has.
	p_total: num("grid.power"),
	frequency: num("grid.frequency"),
	inv_tin: num("inverter.temperature"),
	inv_state: [num("inverter.operatingState"), { id: "inverter.operatingStateText", kind: "fmtText" }],
	inv_drm: num("inverter.drmMode"),
	inv_vbus: num("inverter.busVoltage"),
	inv_vbat: num("battery.inverterVoltage"),
	inv_ibat: num("battery.inverterCurrent"),
	inv_pbat: num("battery.inverterPower"),
	// Master/slave role of a parallel system; of no use as a state on its own.
	role: [],
	// Sum of the PV inputs; the per-input values below carry the same information.
	pv_p_total: [],
};
for (const [letter, p] of PHASES) {
	INVERTER_KEYS[`v_${letter}`] = num(`grid.l${p}Voltage`);
	INVERTER_KEYS[`i_${letter}`] = num(`grid.l${p}Current`);
	INVERTER_KEYS[`p_${letter}`] = num(`grid.l${p}Power`);
	INVERTER_KEYS[`q_${letter}`] = num(`grid.l${p}ReactivePower`);
	INVERTER_KEYS[`veps_${letter}`] = num(`eps.l${p}Voltage`);
	INVERTER_KEYS[`ieps_${letter}`] = num(`eps.l${p}Current`);
	INVERTER_KEYS[`peps_${letter}`] = num(`eps.l${p}Power`);
}

const GRID_METER_KEYS: Record<string, Mapping> = {
	grid_state: { id: "gridMeter.connected", kind: "isOne" },
	p_total: num("gridMeter.power"),
	q_total: num("gridMeter.reactivePower"),
	grid_pfd: num("gridMeter.powerFactor"),
	grid_f: num("gridMeter.frequency"),
};
for (const [letter, p] of PHASES) {
	GRID_METER_KEYS[`v_${letter}`] = num(`gridMeter.l${p}Voltage`);
	GRID_METER_KEYS[`i_${letter}`] = num(`gridMeter.l${p}Current`);
	GRID_METER_KEYS[`p_${letter}`] = num(`gridMeter.l${p}Power`);
	GRID_METER_KEYS[`q_${letter}`] = num(`gridMeter.l${p}ReactivePower`);
	GRID_METER_KEYS[`pf_${letter}`] = num(`gridMeter.l${p}PowerFactor`);
}

const BATTERY_KEYS: Record<string, Mapping> = {
	bms_type: { id: "battery.type", kind: "fmtText" },
	bms_soc: num("battery.soc"),
	bms_soh: num("battery.soh"),
	bms_state: [num("battery.state"), { id: "battery.stateText", kind: "fmtText" }],
	bms_fc: { id: "battery.faultCode", kind: "text" },
	bms_v: num("battery.voltage"),
	bms_i: num("battery.current"),
	bms_p: num("battery.power"),
	bms_icm: num("battery.maxChargeCurrent"),
	bms_idm: num("battery.maxDischargeCurrent"),
	bms_vc: num("battery.chargeCutoffVoltage"),
	bms_vd: num("battery.dischargeCutoffVoltage"),
	bms_tch: num("battery.cellTempMax"),
	bms_tcl: num("battery.cellTempMin"),
	bms_tmh: num("battery.moduleTempMax"),
	bms_tml: num("battery.moduleTempMin"),
	bms_vch: num("battery.cellVoltageMax"),
	bms_vcl: num("battery.cellVoltageMin"),
	bms_vmh: num("battery.moduleVoltageMax"),
	bms_vml: num("battery.moduleVoltageMin"),
};

const KEY_TABLES: Record<string, Record<string, Mapping>> = {
	[INDICATOR_SET_INVERTER]: INVERTER_KEYS,
	[INDICATOR_SET_GRID_METER]: GRID_METER_KEYS,
	[INDICATOR_SET_BATTERY]: BATTERY_KEYS,
};

/**
 * Per-PV-input keys. The chart catalogue (`cci_g_a`) names them `pv_p_0`, `pv_v_0`, `pv_i_0` with a
 * 0-based input index. The live list was only ever seen at night, when it carries no PV entries at
 * all, so a 1-based spelling cannot be ruled out — {@link mapRealIndicators} normalizes either.
 */
const PV_KEY_RE = /^pv_([pvi])_(\d+)$/;
const PV_FIELDS: Record<string, MappedPvValue["field"]> = { p: "power", v: "voltage", i: "current" };

/**
 * Parse an indicator value. Returns null for anything that is not a finite number, so a placeholder
 * such as `"-"` or an empty string never overwrites a state with 0.
 *
 * @param v - Raw `val` of an indicator.
 */
function toNumber(v: RealIndicator["val"]): number | null {
	if (typeof v === "number") {
		return Number.isFinite(v) ? v : null;
	}
	if (typeof v !== "string" || v.trim() === "") {
		return null;
	}
	const parsed = Number(v);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Translate one real-indicator response into state values.
 *
 * @param data - Decoded `data` object of `select_real_indicators_data`.
 */
export function mapRealIndicators(data: RealIndicatorData | null | undefined): MappedIndicators {
	const result: MappedIndicators = { values: [], pv: [], unknownKeys: [] };
	const table = data?.title ? KEY_TABLES[data.title] : undefined;
	if (!table || !Array.isArray(data?.list)) {
		return result;
	}

	const pvEntries: Array<{ index: number; field: MappedPvValue["field"]; val: number }> = [];
	for (const entry of data.list) {
		if (!entry || typeof entry.key !== "string") {
			continue;
		}
		const pvMatch = data.title === INDICATOR_SET_INVERTER ? PV_KEY_RE.exec(entry.key) : null;
		if (pvMatch) {
			const val = toNumber(entry.val);
			if (val !== null) {
				pvEntries.push({ index: Number(pvMatch[2]), field: PV_FIELDS[pvMatch[1]], val });
			}
			continue;
		}
		const mapping = table[entry.key];
		if (mapping === undefined) {
			result.unknownKeys.push(entry.key);
			continue;
		}
		for (const target of Array.isArray(mapping) ? mapping : [mapping]) {
			if (target.kind === "number") {
				const val = toNumber(entry.val);
				if (val !== null) {
					result.values.push({ id: target.id, val });
				}
			} else if (target.kind === "isOne") {
				const val = toNumber(entry.val);
				if (val !== null) {
					result.values.push({ id: target.id, val: val === 1 });
				}
			} else if (target.kind === "text") {
				if (entry.val !== null && entry.val !== undefined && entry.val !== "") {
					result.values.push({ id: target.id, val: String(entry.val) });
				}
			} else if (entry.fmt_val !== null && entry.fmt_val !== undefined && entry.fmt_val !== "") {
				result.values.push({ id: target.id, val: String(entry.fmt_val) });
			}
		}
	}

	// 0-based when any input is numbered 0, otherwise treat the numbering as 1-based.
	const zeroBased = pvEntries.some(e => e.index === 0);
	for (const e of pvEntries) {
		result.pv.push({ port: zeroBased ? e.index : e.index - 1, field: e.field, val: e.val });
	}
	return result;
}

/** The `reflux_station_data` block of the station realtime response, as far as the adapter reads it. */
export interface StorageStationData {
	/** Grid exchange power, W. */
	grid_power?: string | number;
	/** Load / consumption power, W. */
	load_power?: string | number;
	/** Battery power, W. */
	bms_power?: string | number;
	/** Battery state of charge, %. */
	bms_soc?: string | number;
	/** 1 when the station has a battery. */
	icon_bms?: number;
	/** 1 when the station has a grid meter. */
	icon_grid?: number;
	/** Today's consumption, Wh. */
	use_eq_total?: string | number;
	/** Today's energy drawn from the grid, Wh. */
	efg_total?: string | number;
	/** Today's energy fed into the grid, Wh. */
	e2g_total?: string | number;
	/** Today's energy charged into the battery, Wh. */
	e2b_total?: string | number;
	/** Today's energy discharged from the battery, Wh. */
	efb_total?: string | number;
	[key: string]: unknown;
}

/** Station-level values of a storage system; `null` = not delivered. */
export interface MappedStorageStation {
	/** Live power flow (W) and state of charge (%) — overlaps with the realtime burst. */
	flow: Array<{ suffix: string; val: number }>;
	/** Today's energy balance in kWh. */
	energy: Array<{ suffix: string; val: number }>;
}

/**
 * Translate the `reflux_station_data` block. Returns null unless the station actually has a battery
 * or a grid meter: a plain balcony system also carries the block, filled with zeros, and must not
 * grow a set of meaningless states.
 *
 * @param block - `reflux_station_data` of the station realtime response.
 */
export function mapStorageStationData(block: unknown): MappedStorageStation | null {
	if (!block || typeof block !== "object") {
		return null;
	}
	const rf = block as StorageStationData;
	const hasBattery = rf.icon_bms === 1;
	if (!hasBattery && rf.icon_grid !== 1) {
		return null;
	}
	const result: MappedStorageStation = { flow: [], energy: [] };
	const add = (list: MappedStorageStation["flow"], suffix: string, raw: unknown, scale = 1): void => {
		const val = toNumber(raw as RealIndicator["val"]);
		if (val !== null) {
			list.push({ suffix, val: Math.round((val / scale) * 1000) / 1000 });
		}
	};
	add(result.flow, "grid.gridPower", rf.grid_power);
	add(result.flow, "grid.loadPower", rf.load_power);
	if (hasBattery) {
		add(result.flow, "grid.batteryPower", rf.bms_power);
		add(result.flow, "grid.batterySoc", rf.bms_soc);
	}
	add(result.energy, "grid.consumptionToday", rf.use_eq_total, 1000);
	add(result.energy, "grid.gridImportToday", rf.efg_total, 1000);
	add(result.energy, "grid.gridExportToday", rf.e2g_total, 1000);
	if (hasBattery) {
		add(result.energy, "grid.batteryChargeToday", rf.e2b_total, 1000);
		add(result.energy, "grid.batteryDischargeToday", rf.efb_total, 1000);
	}
	return result;
}
