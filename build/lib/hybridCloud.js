export const CLOUD_DEV_TYPE_HYBRID_INVERTER = 6;
export const CLOUD_DEV_TYPE_BATTERY = 10;
export const CLOUD_DEV_TYPE_BATTERY_PACK = 22;
export const REAL_INDICATOR_TYPE_GRID_METER = 2;
export const REAL_INDICATOR_TYPE_PV = 4;
export const REAL_INDICATOR_TYPE_LOAD = 1;
export const REAL_INDICATOR_TYPE_PV_METER = 30;
export const REAL_INDICATOR_TYPE_GENERATOR = 20;
export const INDICATOR_SET_INVERTER = "IND_INV";
export const INDICATOR_SET_GRID_METER = "IND_GRID";
export const INDICATOR_SET_BATTERY = "IND_BMS";
export const INDICATOR_SET_PV = "IND_PV";
export const INDICATOR_SET_LOAD = "IND_LOAD";
export const INDICATOR_SET_BATTERY_PACK = "IND_BPS";
export const INDICATOR_SET_PV_METER = "IND_PVI";
export const INDICATOR_SET_GENERATOR = "IND_GEN";
const num = (id) => ({ id, kind: "number" });
const energy = (id) => ({ id, kind: "energy" });
const text = (id) => ({ id, kind: "text" });
const PHASES = [
    ["a", 1],
    ["b", 2],
    ["c", 3],
];
const INVERTER_KEYS = {
    p_total: num("grid.power"),
    frequency: num("grid.frequency"),
    inv_tin: num("inverter.temperature"),
    inv_state: [num("inverter.operatingState"), { id: "inverter.operatingStateText", kind: "fmtText" }],
    inv_drm: num("inverter.drmMode"),
    inv_vbus: num("inverter.busVoltage"),
    inv_vbat: num("battery.inverterVoltage"),
    inv_ibat: num("battery.inverterCurrent"),
    inv_pbat: num("battery.inverterPower"),
    role: [],
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
const GRID_METER_KEYS = {
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
const BATTERY_KEYS = {
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
    bms_echg: [],
    bms_edchg: [],
    bms_cc: num("battery.cycles"),
    bms_hs: [num("battery.heating"), { id: "battery.heatingText", kind: "fmtText" }],
};
const BATTERY_PACK_KEYS = {
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
const meteredSource = (ch, stateKey, stateMapping) => {
    const table = {
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
const PV_KEYS = {
    pv_p_total: num("inverter.pvPower"),
    pv_e_total: energy("inverter.pvEnergyToday"),
};
const LOAD_KEYS = {
    frequency: [],
    load_state: [num("load.mode"), { id: "load.modeText", kind: "fmtText" }],
    load_ecd: energy("load.energyToday"),
};
for (const [letter, p] of PHASES) {
    LOAD_KEYS[`v_${letter}`] = num(`load.l${p}Voltage`);
    LOAD_KEYS[`p_${letter}`] = num(`load.l${p}Power`);
    LOAD_KEYS[`load_ec_${letter}`] = energy(`load.l${p}EnergyToday`);
}
const KEY_TABLES = {
    [INDICATOR_SET_INVERTER]: INVERTER_KEYS,
    [INDICATOR_SET_GRID_METER]: GRID_METER_KEYS,
    [INDICATOR_SET_BATTERY]: BATTERY_KEYS,
    [INDICATOR_SET_PV]: PV_KEYS,
    [INDICATOR_SET_LOAD]: LOAD_KEYS,
    [INDICATOR_SET_BATTERY_PACK]: BATTERY_PACK_KEYS,
    [INDICATOR_SET_PV_METER]: PV_METER_KEYS,
    [INDICATOR_SET_GENERATOR]: GENERATOR_KEYS,
};
const PV_KEY_RE = /^(\d+)_pv_([pvie])$/;
const PV_FIELDS = {
    p: "power",
    v: "voltage",
    i: "current",
    e: "dailyEnergy",
};
const ENERGY_TO_KWH = { wh: 0.001, kwh: 1, mwh: 1000 };
function toKwh(entry) {
    const val = toNumber(entry.val);
    const factor = ENERGY_TO_KWH[(entry.unit ?? "").trim().toLowerCase()];
    if (val === null || factor === undefined) {
        return null;
    }
    return Math.round(val * factor * 1000) / 1000;
}
function toNumber(v) {
    if (typeof v === "number") {
        return Number.isFinite(v) ? v : null;
    }
    if (typeof v !== "string" || v.trim() === "") {
        return null;
    }
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
}
export function mapRealIndicators(data) {
    const result = { values: [], pv: [], unknownKeys: [] };
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
            }
            else if (val === null && field === "dailyEnergy" && toNumber(entry.val) !== null) {
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
            }
            else if (target.kind === "energy") {
                const val = toKwh(entry);
                if (val !== null) {
                    result.values.push({ id: target.id, val });
                }
                else if (toNumber(entry.val) !== null) {
                    result.unknownKeys.push(`${entry.key}[unit=${entry.unit ?? ""}]`);
                }
            }
            else if (target.kind === "isOne") {
                const val = toNumber(entry.val);
                if (val !== null) {
                    result.values.push({ id: target.id, val: val === 1 });
                }
            }
            else if (target.kind === "text") {
                if (entry.val !== null && entry.val !== undefined && entry.val !== "") {
                    result.values.push({ id: target.id, val: String(entry.val) });
                }
            }
            else if (entry.fmt_val !== null && entry.fmt_val !== undefined && entry.fmt_val !== "") {
                result.values.push({ id: target.id, val: String(entry.fmt_val) });
            }
        }
    }
    return result;
}
export const FLOW_NODE_GRID = 2;
export const FLOW_NODE_BATTERY = 10;
export function directedPower(raw, node, edges) {
    const magnitude = Math.abs(raw);
    if (edges.some(e => e.from === node)) {
        return magnitude;
    }
    if (edges.some(e => e.to === node)) {
        return magnitude === 0 ? 0 : -magnitude;
    }
    return raw;
}
export function inverterHasPv(block) {
    return !(block && typeof block === "object" && block.icon_pv === 0);
}
export function stationIndicatorTypes(block) {
    if (!block || typeof block !== "object") {
        return [];
    }
    const flags = block;
    const types = [];
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
export function mapStorageStationData(block) {
    if (!block || typeof block !== "object") {
        return null;
    }
    const rf = block;
    const hasBattery = rf.icon_bms === 1;
    if (!hasBattery && rf.icon_grid !== 1) {
        return null;
    }
    const result = { hasBattery, flow: [], battery: [] };
    const add = (list, suffix, raw) => {
        const val = toNumber(raw);
        if (val !== null) {
            list.push({ suffix, val: Math.round(val * 1000) / 1000 });
        }
    };
    const edges = Array.isArray(rf.flows) ? rf.flows.map(f => ({ from: Number(f?.out), to: Number(f?.in) })) : [];
    const inGraph = (node) => edges.some(e => e.from === node || e.to === node);
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
        const workMode = toNumber(rf.work_mode);
        if (workMode !== null && workMode >= 1000) {
            result.battery.push({ suffix: "battery.workMode", val: Math.floor(workMode / 1000) });
        }
    }
    return result;
}
export const SETTING_ACTION_BATTERY_MODE_READ = 1013;
export function mapBatterySettings(result) {
    const mode = toNumber(result?.mode);
    if (!result || mode === null || mode < 1) {
        return [];
    }
    const values = [{ suffix: "battery.workMode", val: mode }];
    const reserve = toNumber(result.data?.[`k_${mode}`]?.reserve_soc);
    if (reserve !== null) {
        values.push({ suffix: "battery.reserveSoc", val: reserve });
    }
    values.push({ suffix: "battery.settingsJson", val: JSON.stringify(result) });
    return values;
}
export const ENERGY_STATS_MODES = [
    { mode: 1, period: "Today", slowPoll: false },
    { mode: 3, period: "Month", slowPoll: true },
    { mode: 4, period: "Year", slowPoll: true },
    { mode: 5, period: "Total", slowPoll: true },
];
export const ENERGY_STATS_TYPE_PRODUCTION_CONSUMPTION = 6;
export function mapEnergyStats(period, result, hasBattery = true) {
    if (!result || typeof result !== "object") {
        return [];
    }
    const out = [];
    const kwh = (name, wh) => {
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
export function mapIncomeStats(result) {
    if (!result || typeof result !== "object") {
        return [];
    }
    const out = [];
    for (const [key, suffix] of [
        ["today_profit", "grid.todayIncome"],
        ["monthly_profit", "grid.monthIncome"],
        ["yearly_profit", "grid.yearIncome"],
        ["total_profit", "grid.totalIncome"],
        ["today_spend", "grid.todayCost"],
        ["monthly_spend", "grid.monthCost"],
        ["yearly_spend", "grid.yearCost"],
        ["total_spend", "grid.totalCost"],
    ]) {
        const val = toNumber(result[key]);
        if (val !== null) {
            out.push({ suffix, val: Math.round(val * 100) / 100 });
        }
    }
    return out;
}
export function mapCloudAlarms(lists) {
    const alarms = [];
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
export const SETTING_ACTIONS_DRY_CONTACT_READ = [1014, 1024];
export function mapDryContactSettings(result) {
    const mode = toNumber(result?.mode);
    if (!result || mode === null) {
        return [];
    }
    return [
        { suffix: "dryContact.mode", val: mode },
        { suffix: "dryContact.settingsJson", val: JSON.stringify(result) },
    ];
}
export const DAY_CURVES = [
    { devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "p_total", suffix: "history.powerJson" },
    { devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "inv_pbat", suffix: "history.batteryPowerJson" },
    { devType: CLOUD_DEV_TYPE_HYBRID_INVERTER, indicator: "pv_p_total", suffix: "history.pvPowerJson", needsPv: true },
    { devType: CLOUD_DEV_TYPE_BATTERY, indicator: "bms_soc", suffix: "history.socJson" },
];
export function mapDayCurve(curve, dayStartEpochMs) {
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
//# sourceMappingURL=hybridCloud.js.map