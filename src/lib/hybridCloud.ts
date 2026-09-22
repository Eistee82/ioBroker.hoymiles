/**
 * Cloud data of hybrid (storage) inverters such as the Hoymiles HAT series.
 *
 * These devices are not microinverters: the cloud files them under their own device types and
 * serves their live values through `select_real_indicators_data` — a plain JSON list of
 * `{key, val, unit}` entries — instead of the protobuf day charts the microinverter path reads.
 * The key names below were taken from the S-Miles web portal talking to a real
 * HAT-6.0HV-EUG1 with a HB-(10-23)S-G2 battery and a three-phase grid meter; keys that system did
 * not deliver come from the portal's own field tables and its public indicator dictionary
 * (`dict/pub/0/i18n/select_by_ns_and_lang`, namespace 23), which name every indicator the cloud knows.
 *
 * This module only translates; it performs no I/O, so it can be tested on recorded responses.
 */

/** Cloud device type of a hybrid (storage) inverter. Microinverters are type 3. */
export const CLOUD_DEV_TYPE_HYBRID_INVERTER = 6;
/** Cloud device type of a battery; it hangs below its hybrid inverter in the device tree. */
export const CLOUD_DEV_TYPE_BATTERY = 10;
/**
 * Cloud device type of a battery pack system — the portal treats it exactly like type 10, only the
 * indicator keys carry a `bps_` instead of a `bms_` prefix. The device type doubles as the `type`
 * selector of the real-indicator request for both.
 */
export const CLOUD_DEV_TYPE_BATTERY_PACK = 22;
/** `type` selector of the real-indicator request that returns the station's grid meter. */
export const REAL_INDICATOR_TYPE_GRID_METER = 2;
/** `type` selector for the PV inputs of one hybrid inverter — they are NOT part of the inverter set. */
export const REAL_INDICATOR_TYPE_PV = 4;
/** `type` selector for the station's loads (the consumption side of the inverter). */
export const REAL_INDICATOR_TYPE_LOAD = 1;
/** `type` selector for a third-party PV inverter measured by its own PV meter. */
export const REAL_INDICATOR_TYPE_PV_METER = 30;
/** `type` selector for a generator. */
export const REAL_INDICATOR_TYPE_GENERATOR = 20;

/** `title` values of a real-indicator response — they name the indicator set that was returned. */
export const INDICATOR_SET_INVERTER = "IND_INV";
export const INDICATOR_SET_GRID_METER = "IND_GRID";
export const INDICATOR_SET_BATTERY = "IND_BMS";
export const INDICATOR_SET_PV = "IND_PV";
export const INDICATOR_SET_LOAD = "IND_LOAD";
export const INDICATOR_SET_BATTERY_PACK = "IND_BPS";
export const INDICATOR_SET_PV_METER = "IND_PVI";
export const INDICATOR_SET_GENERATOR = "IND_GEN";

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
	field: "power" | "voltage" | "current" | "dailyEnergy";
	/** Measured value (W, V, A or kWh). */
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

type Kind = "number" | "energy" | "text" | "fmtText" | "isOne";
type Mapping = { id: string; kind: Kind } | Array<{ id: string; kind: Kind }>;

const num = (id: string): { id: string; kind: Kind } => ({ id, kind: "number" });
/**
 * An energy the cloud may deliver in Wh, kWh or MWh; the state is always kWh.
 *
 * @param id - Target state id.
 */
const energy = (id: string): { id: string; kind: Kind } => ({ id, kind: "energy" });
const text = (id: string): { id: string; kind: Kind } => ({ id, kind: "text" });

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
	// Not delivered by the reference system, but part of the cloud's inverter vocabulary.
	inv_tpv: num("inverter.pvHeatsinkTemperature"),
	inv_tinv: num("inverter.heatsinkTemperature"),
	inv_tbat: num("inverter.batteryHeatsinkTemperature"),
	inv_mf: text("inverter.powerFaultCode"),
	inv_sf: text("inverter.safetyFaultCode"),
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
	grid_ecd: energy("gridMeter.importToday"),
	grid_efd: energy("gridMeter.exportToday"),
};
for (const [letter, p] of PHASES) {
	GRID_METER_KEYS[`v_${letter}`] = num(`gridMeter.l${p}Voltage`);
	GRID_METER_KEYS[`i_${letter}`] = num(`gridMeter.l${p}Current`);
	GRID_METER_KEYS[`p_${letter}`] = num(`gridMeter.l${p}Power`);
	GRID_METER_KEYS[`q_${letter}`] = num(`gridMeter.l${p}ReactivePower`);
	GRID_METER_KEYS[`pf_${letter}`] = num(`gridMeter.l${p}PowerFactor`);
	GRID_METER_KEYS[`grid_ec_${letter}`] = energy(`gridMeter.l${p}ImportToday`);
	GRID_METER_KEYS[`grid_ef_${letter}`] = energy(`gridMeter.l${p}ExportToday`);
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
	// Charged / discharged today: the plant's daily balance carries these (`grid.battery*Today`),
	// and no value is kept twice.
	bms_echg: [],
	bms_edchg: [],
	bms_cc: num("battery.cycles"),
	bms_hs: [num("battery.heating"), { id: "battery.heatingText", kind: "fmtText" }],
};

/** Battery pack system: the battery vocabulary under a `bps_` prefix, the state spelled `sts`. */
const BATTERY_PACK_KEYS: Record<string, Mapping> = {
	bps_sts: [num("battery.state"), { id: "battery.stateText", kind: "fmtText" }],
	bps_hs: [num("battery.heating"), { id: "battery.heatingText", kind: "fmtText" }],
	bps_fc: text("battery.faultCode"),
	bps_soc: num("battery.soc"),
	bps_soh: num("battery.soh"),
	bps_v: num("battery.voltage"),
	bps_i: num("battery.current"),
	bps_p: num("battery.power"),
	bps_icm: num("battery.maxChargeCurrent"),
	bps_idm: num("battery.maxDischargeCurrent"),
	bps_vch: num("battery.cellVoltageMax"),
	bps_vcl: num("battery.cellVoltageMin"),
	bps_tch: num("battery.cellTempMax"),
	bps_tcl: num("battery.cellTempMin"),
	bps_vc: num("battery.chargeCutoffVoltage"),
	bps_vd: num("battery.dischargeCutoffVoltage"),
	bps_echg: [],
	bps_edchg: [],
	bps_cc: num("battery.cycles"),
};

/**
 * A three-phase measuring point with totals, per-phase readings and daily energies — the PV meter
 * and the generator deliver the same vocabulary.
 *
 * @param ch - Channel the values go to.
 * @param stateKey - Key of the set's status indicator.
 * @param stateMapping - Where that status goes.
 */
const meteredSource = (ch: string, stateKey: string, stateMapping: Mapping): Record<string, Mapping> => {
	const table: Record<string, Mapping> = {
		[stateKey]: stateMapping,
		frequency: num(`${ch}.frequency`),
		p_total: num(`${ch}.power`),
		q_total: num(`${ch}.reactivePower`),
		e_total: energy(`${ch}.energyToday`),
	};
	for (const [letter, p] of PHASES) {
		table[`v_${letter}`] = num(`${ch}.l${p}Voltage`);
		table[`i_${letter}`] = num(`${ch}.l${p}Current`);
		table[`p_${letter}`] = num(`${ch}.l${p}Power`);
		table[`q_${letter}`] = num(`${ch}.l${p}ReactivePower`);
		table[`e_${letter}`] = energy(`${ch}.l${p}EnergyToday`);
	}
	return table;
};

const PV_METER_KEYS = meteredSource("pvMeter", "pvi_state", { id: "pvMeter.connected", kind: "isOne" });
const GENERATOR_KEYS = meteredSource("generator", "gen_state", [
	num("generator.state"),
	{ id: "generator.stateText", kind: "fmtText" },
]);

const PV_KEYS: Record<string, Mapping> = {
	pv_p_total: num("inverter.pvPower"),
	pv_e_total: energy("inverter.pvEnergyToday"),
};

const LOAD_KEYS: Record<string, Mapping> = {
	// The load side sees the same frequency as the inverter's AC side.
	frequency: [],
	load_state: [num("load.mode"), { id: "load.modeText", kind: "fmtText" }],
	load_ecd: energy("load.energyToday"),
};
for (const [letter, p] of PHASES) {
	LOAD_KEYS[`v_${letter}`] = num(`load.l${p}Voltage`);
	LOAD_KEYS[`p_${letter}`] = num(`load.l${p}Power`);
	LOAD_KEYS[`load_ec_${letter}`] = energy(`load.l${p}EnergyToday`);
}

const KEY_TABLES: Record<string, Record<string, Mapping>> = {
	[INDICATOR_SET_INVERTER]: INVERTER_KEYS,
	[INDICATOR_SET_GRID_METER]: GRID_METER_KEYS,
	[INDICATOR_SET_BATTERY]: BATTERY_KEYS,
	[INDICATOR_SET_PV]: PV_KEYS,
	[INDICATOR_SET_LOAD]: LOAD_KEYS,
	[INDICATOR_SET_BATTERY_PACK]: BATTERY_PACK_KEYS,
	[INDICATOR_SET_PV_METER]: PV_METER_KEYS,
	[INDICATOR_SET_GENERATOR]: GENERATOR_KEYS,
};

/**
 * Per-PV-input keys of the PV set: the 1-based input number comes first — `1_pv_v`, `2_pv_p`. (The
 * chart catalogue spells the same inputs `pv_v_0`; that naming never appears in the live list.)
 */
const PV_KEY_RE = /^(\d+)_pv_([pvie])$/;
const PV_FIELDS: Record<string, MappedPvValue["field"]> = {
	p: "power",
	v: "voltage",
	i: "current",
	e: "dailyEnergy",
};

/** Factor that turns a delivered energy unit into kWh. */
const ENERGY_TO_KWH: Record<string, number> = { wh: 0.001, kwh: 1, mwh: 1000 };

/**
 * Convert a delivered energy to kWh. Returns null when the unit is missing or not an energy unit —
 * guessing it would put a value that is off by a factor of 1000 into a counter.
 *
 * @param entry - Indicator carrying an energy.
 */
function toKwh(entry: RealIndicator): number | null {
	const val = toNumber(entry.val);
	const factor = ENERGY_TO_KWH[(entry.unit ?? "").trim().toLowerCase()];
	if (val === null || factor === undefined) {
		return null;
	}
	return Math.round(val * factor * 1000) / 1000;
}

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

	for (const entry of data.list) {
		if (!entry || typeof entry.key !== "string") {
			continue;
		}
		const pvMatch = data.title === INDICATOR_SET_PV ? PV_KEY_RE.exec(entry.key) : null;
		if (pvMatch) {
			const field = PV_FIELDS[pvMatch[2]];
			const val = field === "dailyEnergy" ? toKwh(entry) : toNumber(entry.val);
			const port = Number(pvMatch[1]) - 1;
			if (val !== null && port >= 0) {
				result.pv.push({ port, field, val });
			} else if (val === null && field === "dailyEnergy" && toNumber(entry.val) !== null) {
				result.unknownKeys.push(`${entry.key}[unit=${entry.unit ?? ""}]`);
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
			} else if (target.kind === "energy") {
				const val = toKwh(entry);
				if (val !== null) {
					result.values.push({ id: target.id, val });
				} else if (toNumber(entry.val) !== null) {
					// A value is there, only its unit is not one we can convert — say so.
					result.unknownKeys.push(`${entry.key}[unit=${entry.unit ?? ""}]`);
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
	return result;
}

/** Node ids of the cloud's energy-flow graph (the portal maps 4 = PV, 1 = load, 10 = battery, 2 = grid). */
export const FLOW_NODE_GRID = 2;
export const FLOW_NODE_BATTERY = 10;

/** One edge of the energy-flow graph: power runs from node `from` to node `to`. */
export interface FlowEdge {
	/** Node the power comes out of. */
	from: number;
	/** Node the power goes into. */
	to: number;
}

/**
 * Give a power reading its direction: positive while the node is a SOURCE (the grid is drawn from,
 * the battery discharges), negative while it is a SINK (feed-in, charging).
 *
 * The direction is taken from the flow graph, not from the sign of the reading — the S-Miles portal
 * does the same: it draws the arrows from this graph and prints `Math.abs()` of the grid power. The
 * sign of the raw number cannot be relied on: the station realtime block reports grid import as a
 * negative number, the realtime burst as a positive one.
 *
 * @param raw - Power as delivered, any sign.
 * @param node - Node the reading belongs to.
 * @param edges - Flow graph of the same sample.
 * @returns The signed power; the raw value when the graph does not mention the node (nothing flows).
 */
export function directedPower(raw: number, node: number, edges: FlowEdge[]): number {
	const magnitude = Math.abs(raw);
	if (edges.some(e => e.from === node)) {
		return magnitude;
	}
	if (edges.some(e => e.to === node)) {
		return magnitude === 0 ? 0 : -magnitude;
	}
	return raw;
}

/**
 * Whether the plant's hybrid inverter has PV connected to its own inputs. Unknown counts as yes.
 *
 * @param block - `reflux_station_data` of the station realtime response.
 */
export function inverterHasPv(block: unknown): boolean {
	return !(block && typeof block === "object" && (block as StorageStationData).icon_pv === 0);
}

/**
 * Which station-level measuring points to read. The cloud answers a request for something the plant
 * does not have with a complete template of zeros, so presence has to come from elsewhere: the
 * `icon_*` flags of the station realtime response, which the portal uses to draw its flow diagram.
 *
 * @param block - `reflux_station_data` of the station realtime response.
 * @returns `type` selectors of the real-indicator requests worth making.
 */
export function stationIndicatorTypes(block: unknown): number[] {
	if (!block || typeof block !== "object") {
		return [];
	}
	const flags = block as Record<string, unknown>;
	const types: number[] = [];
	if (flags.icon_grid === 1) {
		types.push(REAL_INDICATOR_TYPE_GRID_METER);
	}
	if (flags.icon_load === 1) {
		types.push(REAL_INDICATOR_TYPE_LOAD);
	}
	if (flags.icon_pvi === 1) {
		types.push(REAL_INDICATOR_TYPE_PV_METER);
	}
	if (flags.icon_gen === 1) {
		types.push(REAL_INDICATOR_TYPE_GENERATOR);
	}
	return types;
}

/** The `reflux_station_data` block of the station realtime response, as far as the adapter reads it. */
export interface StorageStationData {
	/** Energy-flow graph: power runs from node `out` to node `in` (node ids: see `FLOW_NODE_*`). */
	flows?: Array<{ out?: number; in?: number } | null>;
	/** Grid exchange power, W. */
	grid_power?: string | number;
	/** Load / consumption power, W. */
	load_power?: string | number;
	/** Battery power, W. */
	bms_power?: string | number;
	/** 1 when the station has a battery. */
	icon_bms?: number;
	/** 1 when the station has a grid meter. */
	icon_grid?: number;
	/**
	 * 1 when PV is connected to the hybrid inverter itself. 0 on an AC-coupled plant, where the PV
	 * comes from a separate inverter measured by a PV meter (`icon_pvi`) and the hybrid inverter's
	 * own inputs report 0 V forever — verified on the reference plant over a whole day.
	 */
	icon_pv?: number;
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
	/** Battery working mode × 1000 (the S-Miles app divides by 1000 before it looks the mode up); 0 = none. */
	work_mode?: string | number;
	[key: string]: unknown;
}

/** Station-level values of a storage system; `null` = not delivered. */
export interface MappedStorageStation {
	/** Live power flow (W) and state of charge (%) — overlaps with the realtime burst. */
	flow: Array<{ suffix: string; val: number }>;
	/** Today's energy balance in kWh. */
	energy: Array<{ suffix: string; val: number }>;
	/**
	 * Facts about the battery that arrive with the station but belong to the battery — written
	 * below the inverter's device (`<dtuSerial>.battery.*`), not below the station.
	 */
	battery: Array<{ suffix: string; val: number }>;
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
	const result: MappedStorageStation = { flow: [], energy: [], battery: [] };
	const add = (list: MappedStorageStation["flow"], suffix: string, raw: unknown, scale = 1): void => {
		const val = toNumber(raw as RealIndicator["val"]);
		if (val !== null) {
			list.push({ suffix, val: Math.round((val / scale) * 1000) / 1000 });
		}
	};
	// Direction comes from the flow graph (see `directedPower`). Without a graph the block's own
	// signs have to do: measured with an empty battery at night (load 386 W, PV 0, battery 0, so
	// 386 W had to come from the grid) `grid_power` read -386, i.e. import is negative here and is
	// turned round to the documented +import/−export; `bms_power` read +567 while discharging,
	// which already is the documented +discharge/−charge.
	const edges = Array.isArray(rf.flows) ? rf.flows.map(f => ({ from: Number(f?.out), to: Number(f?.in) })) : [];
	const inGraph = (node: number): boolean => edges.some(e => e.from === node || e.to === node);
	const gridPower = toNumber(rf.grid_power);
	if (gridPower !== null) {
		const val = inGraph(FLOW_NODE_GRID) ? directedPower(gridPower, FLOW_NODE_GRID, edges) : -gridPower;
		result.flow.push({ suffix: "grid.gridPower", val: val === 0 ? 0 : val });
	}
	add(result.flow, "grid.loadPower", rf.load_power);
	if (hasBattery) {
		const batteryPower = toNumber(rf.bms_power);
		if (batteryPower !== null) {
			const val = directedPower(batteryPower, FLOW_NODE_BATTERY, edges);
			result.flow.push({ suffix: "grid.batteryPower", val: val === 0 ? 0 : val });
		}
	}
	add(result.energy, "grid.consumptionToday", rf.use_eq_total, 1000);
	add(result.energy, "grid.gridImportToday", rf.efg_total, 1000);
	add(result.energy, "grid.gridExportToday", rf.e2g_total, 1000);
	if (hasBattery) {
		add(result.energy, "grid.batteryChargeToday", rf.e2b_total, 1000);
		add(result.energy, "grid.batteryDischargeToday", rf.efb_total, 1000);
		// Delivered passively with every station poll — reading the mode this way sends nothing to
		// the device, unlike the portal's settings dialog.
		const workMode = toNumber(rf.work_mode);
		if (workMode !== null && workMode >= 1000) {
			result.battery.push({ suffix: "battery.workMode", val: Math.floor(workMode / 1000) });
		}
	}
	return result;
}

/** Action code of the setting read that returns the battery working mode and its parameters. */
export const SETTING_ACTION_BATTERY_MODE_READ = 1013;

/** Result of the battery settings read (`pvm-ctl` action 1013), as far as the adapter reads it. */
export interface BatterySettingsResult {
	/** Active working mode, 1-8 — see the `battery.workMode` state. */
	mode?: number;
	/** Parameters of every mode, keyed `k_<mode>`. */
	data?: Record<string, { reserve_soc?: number; [key: string]: unknown } | undefined>;
}

/**
 * Translate a battery settings read into `<dtuSerial>.battery.*` states. Only what is unambiguous becomes a state
 * of its own: the active mode and its reserved state of charge (the portal labels it "Reserved SOC,
 * %"). The other per-mode parameters (`max_power`, `max_soc`, time windows, tariffs) carry no unit
 * and differ by mode, so they are passed on untouched as JSON rather than given a guessed meaning.
 *
 * @param result - `data` object of the finished setting-read task.
 */
export function mapBatterySettings(
	result: BatterySettingsResult | null | undefined,
): Array<{ suffix: string; val: number | string }> {
	const mode = toNumber(result?.mode);
	if (!result || mode === null || mode < 1) {
		return [];
	}
	const values: Array<{ suffix: string; val: number | string }> = [{ suffix: "battery.workMode", val: mode }];
	const reserve = toNumber(result.data?.[`k_${mode}`]?.reserve_soc);
	if (reserve !== null) {
		values.push({ suffix: "battery.reserveSoc", val: reserve });
	}
	// The whole answer, not just mode and parameters: the S-Miles app also reads `emspara` (forced
	// discharge, peak shaving, time-of-use) and `relay` (dry-contact mode) out of this response
	// when the plant has them configured.
	values.push({ suffix: "battery.settingsJson", val: JSON.stringify(result) });
	return values;
}

/** `mode` values of `station/data_fd/stat_g_a`: the period the balance is summed over. */
export const ENERGY_STATS_MODES: ReadonlyArray<{ mode: number; period: "Month" | "Year" | "Total" }> = [
	{ mode: 3, period: "Month" },
	{ mode: 4, period: "Year" },
	{ mode: 5, period: "Total" },
];

/** Response of `station/data_fd/stat_g_a`, Wh. A plant without a balance only returns `last_data_time`. */
export interface EnergyStatsResult {
	/** Drawn from the grid. */
	meter_in_eq?: string | number;
	/** Fed into the grid. */
	meter_out_eq?: string | number;
	/** Consumed. */
	consumption_eq?: string | number;
	/** Charged into the battery. */
	bms_in_eq?: string | number;
	/** Discharged from the battery. */
	bms_out_eq?: string | number;
	/** PV yield — the station's `monthEnergy` / `yearEnergy` / `totalEnergy` already carry it. */
	pv_eq?: string | number;
	[key: string]: unknown;
}

/**
 * Translate one period's energy balance into station states (kWh). This is the source behind the
 * portal's "historical data" panel; checked live: its month import matches the dashboard's monthly
 * cost at the plant's tariff, and its day values match the `reflux_station_data` day counters.
 *
 * @param period - Period the result was summed over.
 * @param result - Decoded `data` of the request.
 */
export function mapEnergyStats(
	period: "Month" | "Year" | "Total",
	result: EnergyStatsResult | null | undefined,
): Array<{ suffix: string; val: number }> {
	if (!result || typeof result !== "object") {
		return [];
	}
	const out: Array<{ suffix: string; val: number }> = [];
	for (const [key, name] of [
		["meter_in_eq", "gridImport"],
		["meter_out_eq", "gridExport"],
		["consumption_eq", "consumption"],
		["bms_in_eq", "batteryCharge"],
		["bms_out_eq", "batteryDischarge"],
	] as const) {
		const val = toNumber(result[key]);
		if (val !== null) {
			out.push({ suffix: `grid.${name}${period}`, val: Math.round(val) / 1000 });
		}
	}
	return out;
}
