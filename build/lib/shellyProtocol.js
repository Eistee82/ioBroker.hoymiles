export const ACTION_SHELLY_BIND = 85;
export const SHELLY_DEV_TYPE_METER_ONLY = 0;
export const SHELLY_DEV_TYPE_GRID = 2;
const FIELD_ENERGY_FLOW = 13;
const FIELD_METER_PRIMARY = 14;
const FIELD_METER_SECONDARY = 15;
const SCALE_FLOW_POWER = 10;
const SCALE_METER_VOLTAGE = 10;
const SCALE_METER_CURRENT = 100;
const SCALE_METER_POWER = 10;
function wireFields(buf) {
    const out = [];
    let i = 0;
    const readVarint = () => {
        let v = 0n;
        let shift = 0n;
        let b;
        do {
            if (i >= buf.length || shift > 63n) {
                return null;
            }
            b = buf[i++];
            v |= BigInt(b & 0x7f) << shift;
            shift += 7n;
        } while (b & 0x80);
        return v;
    };
    while (i < buf.length) {
        const key = readVarint();
        if (key === null) {
            break;
        }
        const no = Number(key >> 3n);
        const wire = Number(key & 7n);
        if (wire === 0) {
            const v = readVarint();
            if (v === null) {
                break;
            }
            out.push({ no, wire, varint: v, bytes: Buffer.alloc(0) });
        }
        else if (wire === 2) {
            const len = readVarint();
            if (len === null || i + Number(len) > buf.length) {
                break;
            }
            const n = Number(len);
            out.push({ no, wire, varint: 0n, bytes: buf.subarray(i, i + n) });
            i += n;
        }
        else if (wire === 5) {
            if (i + 4 > buf.length) {
                break;
            }
            out.push({ no, wire, varint: 0n, bytes: buf.subarray(i, i + 4) });
            i += 4;
        }
        else if (wire === 1) {
            if (i + 8 > buf.length) {
                break;
            }
            out.push({ no, wire, varint: 0n, bytes: buf.subarray(i, i + 8) });
            i += 8;
        }
        else {
            break;
        }
    }
    return out;
}
function asInt32(v) {
    return Number(BigInt.asIntN(32, BigInt.asUintN(64, v)));
}
export function parseEnergyFlow(payload) {
    const field = wireFields(payload).find(f => f.no === FIELD_ENERGY_FLOW && f.wire === 2);
    if (!field) {
        return null;
    }
    const v = new Map();
    for (const f of wireFields(field.bytes)) {
        if (f.wire === 0) {
            v.set(f.no, asInt32(f.varint) / SCALE_FLOW_POWER);
        }
    }
    return {
        pv: v.get(1) ?? 0,
        grid: v.get(2) ?? 0,
        load: v.get(3) ?? 0,
        sp: v.get(4) ?? 0,
        plug: v.get(5) ?? 0,
    };
}
export function parseMeterDevices(payload) {
    const devices = [];
    for (const field of wireFields(payload)) {
        if (field.wire !== 2 || (field.no !== FIELD_METER_PRIMARY && field.no !== FIELD_METER_SECONDARY)) {
            continue;
        }
        const inner = wireFields(field.bytes);
        const head = inner.find(f => f.no === 1 && f.wire === 2);
        const headFields = new Map();
        if (head) {
            for (const f of wireFields(head.bytes)) {
                if (f.wire === 0) {
                    headFields.set(f.no, f.varint);
                }
            }
        }
        const phases = inner
            .filter(f => f.no === 2 && f.wire === 2)
            .map((p, idx) => {
            const slots = new Map();
            for (const f of wireFields(p.bytes)) {
                if (f.wire === 0) {
                    slots.set(f.no, asInt32(f.varint));
                }
            }
            const phase = slots.get(1);
            return {
                phase: phase && phase > 0 ? phase : idx + 1,
                voltage: (slots.get(2) ?? 0) / SCALE_METER_VOLTAGE,
                current: (slots.get(3) ?? 0) / SCALE_METER_CURRENT,
                activePower: (slots.get(4) ?? 0) / SCALE_METER_POWER,
            };
        });
        devices.push({
            field: field.no,
            serial: headFields.has(1) ? headFields.get(1).toString(16) : "",
            phases,
            frequency: asInt32(headFields.get(3) ?? 0n),
            energyImport: asInt32(headFields.get(4) ?? 0n),
            energyExport: asInt32(headFields.get(5) ?? 0n),
        });
    }
    return devices;
}
function varint(n) {
    const bytes = [];
    let v = n;
    while (v > 0x7f) {
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    bytes.push(v);
    return Buffer.from(bytes);
}
export function encodeShellyBindBody(mac, devType, timestamp) {
    const data = Buffer.from(buildShellyBindData(mac, devType), "ascii");
    return Buffer.concat([
        Buffer.concat([varint((1 << 3) | 0), varint(timestamp)]),
        Buffer.concat([varint((2 << 3) | 0), varint(ACTION_SHELLY_BIND)]),
        Buffer.concat([varint((5 << 3) | 0), varint(timestamp)]),
        Buffer.concat([varint((6 << 3) | 2), varint(data.length), data]),
    ]);
}
export function buildShellyBindData(mac, devType) {
    const clean = (mac || "").replace(/[:\-\s]/g, "").toLowerCase();
    if (!/^[0-9a-f]{12}$/.test(clean)) {
        throw new Error(`"${mac}" is not a 12-digit hex MAC. The bind command identifies the meter by MAC, ` +
            `not by its mDNS hostname.`);
    }
    if (devType !== SHELLY_DEV_TYPE_METER_ONLY && devType !== SHELLY_DEV_TYPE_GRID) {
        throw new Error(`Unknown Shelly device type ${devType} (0 = meter only, 2 = grid device).`);
    }
    return `1\r${clean},${devType}\r`;
}
//# sourceMappingURL=shellyProtocol.js.map