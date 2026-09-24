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
	/**
	 * Today's counters in Wh (`use_eq_total`, `efg_total`, `e2g_total`, `e2b_total`, `efb_total`)
	 * also travel in this block. They are the figures of the app's "Overview" and are deliberately
	 * NOT mapped: the day balance comes from the "Production & Consumption" statistics
	 * (`mapEnergyStats`), the same source as month, year and lifetime.
	 */
	/** Battery working mode × 1000 (the S-Miles app divides by 1000 before it looks the mode up); 0 = none. */
	work_mode?: string | number;
	[key: string]: unknown;
}

/** Station-level values of a storage system; `null` = not delivered. */
export interface MappedStorageStation {
	/** Whether the plant has a battery (`icon_bms`) — decides whether the battery flows of the energy balance become states. */
	hasBattery: boolean;
	/** Live power flow (W) and state of charge (%) — overlaps with the realtime burst. */
	flow: Array<{ suffix: string; val: number }>;
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
	const result: MappedStorageStation = { hasBattery, flow: [], battery: [] };
	const add = (list: MappedStorageStation["flow"], suffix: string, raw: unknown): void => {
		const val = toNumber(raw as RealIndicator["val"]);
		if (val !== null) {
			list.push({ suffix, val: Math.round(val * 1000) / 1000 });
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
	if (hasBattery) {
		// Delivered passively with every station poll — reading the mode this way sends nothing to
		// the device, unlike the portal's settings dialog.
		const workMode = toNumber(rf.work_mode);
		if (workMode !== null && workMode >= 1000) {
			result.battery.push({ suffix: "battery.workMode", val: Math.floor(workMode / 1000) });
		}
	}
	return result;
}

/**
 * `inv_state` ("Working Status") value the cloud labels "On-grid Mode" — recorded live on the running
 * reference inverter. The S-Miles app carries no value table for `inv_state` (it prints the cloud's
 * `fmt_val` as delivered) and no on/off notion for a storage inverter at all (its device list only
 * distinguishes connected / alarm / disconnected), so this is the one working state known for sure.
 */
export const HYBRID_INV_STATE_ON_GRID = 3;

/**
 * Whether a cloud-only hybrid inverter is running — the value of `inverter.active`, which the
 * local path derives from the microinverter's RealData and which nobody wrote for a cloud-only
 * device (it stayed on its default and showed "off" for a running inverter). On: the tree reports
 * the inverter connected and it is either in On-grid Mode or exchanging AC power (`p_total` ≠ 0).
 * Off: disconnected, or an unknown working state without any AC power. A powered-off inverter has
 * not been observed yet, so no `inv_state` value is claimed to mean "off".
 *
 * @param values - Mapped `IND_INV` values of the inverter (`mapRealIndicators(...).values`).
 * @param connected - `warn_data.connect` of the inverter's device-tree node.
 * @returns true/false, or null when neither the working state nor the power was delivered.
 */
export function hybridInverterActive(
	values: ReadonlyArray<{ id: string; val: unknown }>,
	connected: boolean,
): boolean | null {
	const state = values.find(v => v.id === "inverter.operatingState")?.val;
	const power = values.find(v => v.id === "grid.power")?.val;
	if (typeof state !== "number" && typeof power !== "number") {
		return null;
	}
	if (!connected) {
		return false;
	}
	return state === HYBRID_INV_STATE_ON_GRID || (typeof power === "number" && power !== 0);
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

/** Period suffix of the balance states (`grid.gridImport<Period>` …). */
export type EnergyStatsPeriod = "Today" | "Month" | "Year" | "Total";

/**
 * `mode` values of `station/data_fd/stat_g_a`: the period the balance is summed over (the S-Miles
 * app's statistics tab: 1 day, 3 month, 4 year, 5 lifetime). The day is read with every station
 * poll, the long periods only on the slow poll — they move slowly and cost a request each.
 */
export const ENERGY_STATS_MODES: ReadonlyArray<{ mode: number; period: EnergyStatsPeriod; slowPoll: boolean }> = [
	{ mode: 1, period: "Today", slowPoll: false },
	{ mode: 3, period: "Month", slowPoll: true },
	{ mode: 4, period: "Year", slowPoll: true },
	{ mode: 5, period: "Total", slowPoll: true },
];

/**
 * `type` value of `station/data_fd/stat_g_a` that selects the data set of the app's
 * "Production & Consumption" sub-tab (`PowerTab3FragmentDoubleYTestEs`, `AppConstant.p0 == 1`):
 * the six energy flows below. `type: 1` is the "Overview" sub-tab (`meter_in_eq`, `meter_out_eq`,
 * `consumption_eq`, `bms_in_eq`, `bms_out_eq`, `pv_eq`), `4` the battery tab, `5` the grid tab.
 * Recorded live: both tabs agree on production and consumption, but "Overview" books the energy the
 * grid pushes into the battery as grid import as well (211.9 vs 129.7 kWh in one month) — the user
 * report asked for the "Production & Consumption" figures.
 */
export const ENERGY_STATS_TYPE_PRODUCTION_CONSUMPTION = 6;

/**
 * Response of `station/data_fd/stat_g_a` with `type: 6`, Wh. A plant without a balance only returns
 * `last_data_time`. Field names as the app reads them (`StationDataBean`).
 */
export interface EnergyStatsResult {
	/** PV → load. */
	p2l?: string | number;
	/** PV → battery. */
	p2b?: string | number;
	/** PV → grid (export). */
	p2g?: string | number;
	/** Load from PV (equals `p2l` in every recorded response). */
	lfp?: string | number;
	/** Load from battery. */
	lfb?: string | number;
	/** Load from grid (import). */
	lfg?: string | number;
	[key: string]: unknown;
}

/**
 * Translate one period's energy flows into station states — kWh, plus the self-sufficiency rate in
 * percent — exactly as the app's "Production & Consumption" tab presents them: consumption is
 * `lfp + lfb + lfg`, self-sufficiency is `100 − lfg / consumption × 100` with one decimal and 0 %
 * when nothing was consumed. Production (`p2l + p2b + p2g`) is not repeated here: the station's
 * `dailyEnergy` / `monthEnergy` / `yearEnergy` / `totalEnergy` already carry the PV yield.
 *
 * @param period - Period the result was summed over.
 * @param result - Decoded `data` of the request.
 * @param hasBattery - Whether the plant has a battery; without one the battery flows stay out.
 */
export function mapEnergyStats(
	period: EnergyStatsPeriod,
	result: EnergyStatsResult | null | undefined,
	hasBattery = true,
): Array<{ suffix: string; val: number }> {
	if (!result || typeof result !== "object") {
		return [];
	}
	const out: Array<{ suffix: string; val: number }> = [];
	const kwh = (name: string, wh: number): void => {
		out.push({ suffix: `grid.${name}${period}`, val: Math.round(wh) / 1000 });
	};
	const lfg = toNumber(result.lfg);
	const p2g = toNumber(result.p2g);
	const p2l = toNumber(result.p2l);
	const lfp = toNumber(result.lfp);
	const lfb = toNumber(result.lfb);
	const p2b = toNumber(result.p2b);
	if (lfg !== null) {
		kwh("gridImport", lfg);
	}
	if (p2g !== null) {
		kwh("gridExport", p2g);
	}
	if (p2l !== null) {
		kwh("pvToLoad", p2l);
	}
	if (lfp !== null && lfb !== null && lfg !== null) {
		const consumption = lfp + lfb + lfg;
		kwh("consumption", consumption);
		const rate = consumption > 0 ? 100 - (lfg * 100) / consumption : 0;
		out.push({ suffix: `grid.selfSufficiency${period}`, val: Math.round(rate * 10) / 10 });
	}
	if (hasBattery) {
		if (p2b !== null) {
			kwh("batteryCharge", p2b);
		}
		if (lfb !== null) {
			kwh("batteryDischarge", lfb);
		}
	}
	return out;
}

/** Income and cost as the cloud accounts them (`eps/api/0/record/stat_a`), in the station's currency. */
export interface IncomeStats {
	/** Income today. */
	today_profit?: number | string;
	/** Income this month. */
	monthly_profit?: number | string;
	/** Income this year. */
	yearly_profit?: number | string;
	/** Income in total. */
	total_profit?: number | string;
	/** Electricity cost today. */
	today_spend?: number | string;
	/** Electricity cost this month. */
	monthly_spend?: number | string;
	/** Electricity cost this year. */
	yearly_spend?: number | string;
	/** Electricity cost in total. */
	total_spend?: number | string;
	[key: string]: unknown;
}

/**
 * Translate the cloud's income/cost record into station states, rounded to cents. Income replaces
 * the adapter's own "yield × price" estimate wherever the cloud delivers one.
 *
 * @param result - Decoded `data` of the request.
 */
export function mapIncomeStats(result: IncomeStats | null | undefined): Array<{ suffix: string; val: number }> {
	if (!result || typeof result !== "object") {
		return [];
	}
	const out: Array<{ suffix: string; val: number }> = [];
	for (const [key, suffix] of [
		["today_profit", "grid.todayIncome"],
		["monthly_profit", "grid.monthIncome"],
		["yearly_profit", "grid.yearIncome"],
		["total_profit", "grid.totalIncome"],
		["today_spend", "grid.todayCost"],
		["monthly_spend", "grid.monthCost"],
		["yearly_spend", "grid.yearCost"],
		["total_spend", "grid.totalCost"],
	] as const) {
		const val = toNumber(result[key]);
		if (val !== null) {
			out.push({ suffix, val: Math.round(val * 100) / 100 });
		}
	}
	return out;
}

/** One page of a cloud alarm list (`monitor/api/0/ng/dev/flesw` etc.). */
export interface CloudAlarmList {
	/** Number of devices with alarms. */
	total?: number;
	/** One entry per device, with its active warnings. */
	list?: Array<{
		name?: string;
		sn?: string;
		track_time?: string;
		tz?: string;
		warns?: Array<{ code?: number | string; pre?: unknown; time?: string; [key: string]: unknown }>;
	} | null>;
}

/**
 * Summarize the active cloud alarms of a device: how many there are and a compact JSON list. The
 * cloud's own alarm dictionary is not applied here — the code stays as delivered.
 *
 * @param lists - Alarm lists of the device's sources (inverter, DTU), null where a read failed.
 */
export function mapCloudAlarms(lists: Array<CloudAlarmList | null | undefined>): { count: number; json: string } {
	const alarms: Array<Record<string, unknown>> = [];
	for (const list of lists) {
		for (const entry of list?.list ?? []) {
			for (const warn of entry?.warns ?? []) {
				if (!warn || typeof warn !== "object") {
					continue;
				}
				alarms.push({
					code: warn.code,
					time: warn.time,
					pre: warn.pre,
					source: entry?.name,
					data: [warn.wd1, warn.wd2, warn.wd3, warn.wd4],
				});
			}
		}
	}
	return { count: alarms.length, json: JSON.stringify(alarms) };
}

/** Action codes of the dry-contact (relay) settings read; which one a plant answers depends on its relay hardware. */
export const SETTING_ACTIONS_DRY_CONTACT_READ: readonly number[] = [1014, 1024];

/** Result of the dry-contact settings read, as far as the adapter reads it. */
export interface DryContactResult {
	/** Relay mode, 0 = off. */
	mode?: number | string;
	/** Per-mode parameters, keyed `k_<mode>`. */
	data?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Translate the dry-contact settings read: the mode as a number, everything as JSON. The per-mode
 * parameters (generator start/stop thresholds, load-control windows, …) differ by mode and carry
 * no units, so they are passed on untouched.
 *
 * @param result - `data` object of the finished setting-read task.
 */
export function mapDryContactSettings(
	result: DryContactResult | null | undefined,
): Array<{ suffix: string; val: number | string }> {
	const mode = toNumber(result?.mode);
	if (!result || mode === null) {
		return [];
	}
	return [
		{ suffix: "dryContact.mode", val: mode },
		{ suffix: "dryContact.settingsJson", val: JSON.stringify(result) },
	];
}

/** Day curves the adapter reads for a hybrid inverter and its battery. */
export interface DayCurveSpec {
	/** Cloud device type the curve is requested for (6 = inverter, 10 = battery). */
	devType: number;
	/** Indicator key. */
	indicator: string;
	/** State the JSON array goes to. */
	suffix: string;
	/** Only worth reading when PV is connected to the inverter. */
	needsPv?: boolean;
}

export const DAY_CURVES: readonly DayCurveSpec[] = [
	{ devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "p_total", suffix: "history.powerJson" },
	{ devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "inv_pbat", suffix: "history.batteryPowerJson" },
	{ devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "pv_p_total", suffix: "history.pvPowerJson", needsPv: true },
	{ devType: CLOUD_DEV_TYPE_BATTERY, indicator: "bms_soc", suffix: "history.socJson" },
];

/**
 * Turn a decoded day curve into the adapter's history format: a JSON array of values plus the
 * epoch of the first sample and the step in seconds — the same shape the local path writes.
 *
 * @param curve - Minutes of day + values.
 * @param dayStartEpochMs - Epoch of the station-local midnight the curve belongs to.
 */
export function mapDayCurve(
	curve: { minutes: number[]; values: number[] } | null | undefined,
	dayStartEpochMs: number,
): { json: string; startTime: number; stepTime: number } | null {
	if (!curve || curve.minutes.length === 0 || curve.minutes.length !== curve.values.length) {
		return null;
	}
	const stepMinutes = curve.minutes.length > 1 ? curve.minutes[1] - curve.minutes[0] : 5;
	return {
		json: JSON.stringify(curve.values.map(v => Math.round(v * 10) / 10)),
		startTime: dayStartEpochMs + curve.minutes[0] * 60_000,
		stepTime: Math.max(stepMinutes, 1) * 60,
	};
}
