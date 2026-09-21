export const CLOUD_DEV_TYPE_HYBRID_INVERTER = 6;
export const CLOUD_DEV_TYPE_BATTERY = 10;
export const REAL_INDICATOR_TYPE_GRID_METER = 2;
export const INDICATOR_SET_INVERTER = "IND_INV";
export const INDICATOR_SET_GRID_METER = "IND_GRID";
export const INDICATOR_SET_BATTERY = "IND_BMS";
const num = (id) => ({ id, kind: "number" });
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
const GRID_METER_KEYS = {
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
};
const KEY_TABLES = {
    [INDICATOR_SET_INVERTER]: INVERTER_KEYS,
    [INDICATOR_SET_GRID_METER]: GRID_METER_KEYS,
    [INDICATOR_SET_BATTERY]: BATTERY_KEYS,
};
const PV_KEY_RE = /^pv_([pvi])_(\d+)$/;
const PV_FIELDS = { p: "power", v: "voltage", i: "current" };
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
    const pvEntries = [];
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
    const zeroBased = pvEntries.some(e => e.index === 0);
    for (const e of pvEntries) {
        result.pv.push({ port: zeroBased ? e.index : e.index - 1, field: e.field, val: e.val });
    }
    return result;
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
    const result = { flow: [], energy: [] };
    const add = (list, suffix, raw, scale = 1) => {
        const val = toNumber(raw);
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
//# sourceMappingURL=hybridCloud.js.map