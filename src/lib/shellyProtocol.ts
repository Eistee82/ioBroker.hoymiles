/**
 * Shelly/ecotracker metering support for the BLE-only HMS-800-2WB.
 *
 * Two jobs, both of which the shared `.proto` schema cannot do:
 *
 * 1. **Binding a meter** — `action 85` (`Cmd_Shelly_Networking`) is what starts the DTU's
 *    continuous `EM.GetStatus` WebSocket poll and, with device type 2, makes its energy-management
 *    treat the meter as the grid device (that is what regulates the inverter down to zero export).
 * 2. **Reading the values back** — the meter data arrives in `RealDataNew` fields 13, 14 and 15,
 *    none of which exist in `RealDataNew.proto`. Field 13 is even declared there as
 *    `uint64 dtu_daily_energy`, which is correct on the 2T — so the schema must not be changed.
 *    These parsers therefore read the wire format directly and leave the schema alone.
 *
 * Everything named here is firmware-proven. What is not proven is not named: the four values per
 * phase in fields 14/15 are `current`, `voltage`, `act_power` and `freq` (EM logger `0x4082c642`
 * ff., format `0x40919d90`), but their order is not decided, so {@link parseMeterDevices} hands
 * them out as a raw tuple.
 */

/** `Cmd_Shelly_Networking` — starts the meter poll. Handler `0x4081544c`, range check `slti #0x57`. */
export const ACTION_SHELLY_BIND = 85;

/**
 * Device type 0 — the DTU polls the meter (its power shows up in field 13.2) but the
 * energy-management never recognises it as the grid device, so zero export does not regulate.
 */
export const SHELLY_DEV_TYPE_METER_ONLY = 0;

/**
 * Device type 2 — grid device. The regulation looks for exactly this value: the grid-device search
 * `0x4083cf88`–`0x4083cfde` tests `bnec $r0,#0x2` @`0x4083cfba` on `[node+0x440]`, the very field
 * the record parser fills with the device type (@`0x408148c6`). Measured effect with type 2:
 * `sgs.powerLimit` 10000 → 8368 on export, back to 10000 on import.
 */
export const SHELLY_DEV_TYPE_GRID = 2;

/** Field numbers inside a `RealDataNew` response. */
const FIELD_ENERGY_FLOW = 13;
const FIELD_METER_PRIMARY = 14;
const FIELD_METER_SECONDARY = 15;

/** The DTU reports these power values in tenths of a watt (7940 = 794.0 W, live-verified). */
const SCALE_FLOW_POWER = 10;

// Meter scales, measured on 2026-08-04 against a Shelly Pro 3EM reporting its own values over
// its API at the same moment. Phase A of the first run: 2386/238.5 V = 10.004, 27/0.27 A = 100.000,
// 640/64 W = 10.000; a second run at different load reproduced all three.
/** Voltage arrives in tenths of a volt. */
const SCALE_METER_VOLTAGE = 10;
/** Current arrives in hundredths of an ampere. */
const SCALE_METER_CURRENT = 100;
/** Active power arrives in tenths of a watt, signed. */
const SCALE_METER_POWER = 10;

/** One decoded protobuf field. */
interface WireField {
	no: number;
	wire: number;
	varint: bigint;
	bytes: Buffer;
}

/**
 * Walk a protobuf buffer and return its top-level fields.
 *
 * Tolerant by design: a truncated or unexpected buffer ends the walk instead of throwing, because
 * this runs on live device data whose exact shape is what we are still establishing.
 *
 * @param buf - raw protobuf bytes
 */
function wireFields(buf: Buffer): WireField[] {
	const out: WireField[] = [];
	let i = 0;
	const readVarint = (): bigint | null => {
		let v = 0n;
		let shift = 0n;
		let b: number;
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
		} else if (wire === 2) {
			const len = readVarint();
			if (len === null || i + Number(len) > buf.length) {
				break;
			}
			const n = Number(len);
			out.push({ no, wire, varint: 0n, bytes: buf.subarray(i, i + n) });
			i += n;
		} else if (wire === 5) {
			if (i + 4 > buf.length) {
				break;
			}
			out.push({ no, wire, varint: 0n, bytes: buf.subarray(i, i + 4) });
			i += 4;
		} else if (wire === 1) {
			if (i + 8 > buf.length) {
				break;
			}
			out.push({ no, wire, varint: 0n, bytes: buf.subarray(i, i + 8) });
			i += 8;
		} else {
			break; // group wire types are not used here — stop rather than guess
		}
	}
	return out;
}

/**
 * Interpret a protobuf varint as a signed 32-bit value.
 *
 * proto3 transmits negative `int32` sign-extended to 64 bit, so reading it unsigned would turn
 * −500 W of export into a 2^64-sized number.
 *
 * @param v - raw varint
 */
function asInt32(v: bigint): number {
	return Number(BigInt.asIntN(32, BigInt.asUintN(64, v)));
}

/** The DTU's own energy-flow calculation, in watts. */
export interface EnergyFlow {
	/** Total PV production. */
	pv: number;
	/** Grid exchange — positive = import, negative = export. This is what zero export regulates on. */
	grid: number;
	/** House load, computed by the DTU as `grid + plug − sp`. */
	load: number;
	/** Storage power. */
	sp: number;
	/** Plug/socket power. */
	plug: number;
}

/**
 * Read the energy-flow message (field 13) from a `RealDataNew` payload.
 *
 * Field mapping is firmware-proven: the format string @`0x4080b6d8` reads
 * `" pv: %d\r\n plug: %d\r\n grid: %d\r\n load: %d\r\n sp: %d\r\n"`, and the arguments are loaded
 * from `$r6+0x1cc0` immediately before it — giving 13.1 = pv, 13.2 = grid, 13.3 = load,
 * 13.4 = sp, 13.5 = plug. Cross-checked twice: `0x4080b6b0`–`0x4080b6be` computes
 * `load = grid + plug − sp`, which is only meaningful with this mapping, and a live capture showed
 * `13.2 = 7940` while the meter itself reported 796–824 W.
 *
 * @param payload - decoded `RealDataNew` protobuf bytes
 * @returns the flow in watts, or `null` when the device sent no field 13 (no meter poll running)
 */
export function parseEnergyFlow(payload: Buffer): EnergyFlow | null {
	const field = wireFields(payload).find(f => f.no === FIELD_ENERGY_FLOW && f.wire === 2);
	if (!field) {
		return null;
	}
	const v = new Map<number, number>();
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

/**
 * One phase of a metering device.
 *
 * The field mapping is firmware-proven. The encoder at `0x4080bf3e` fills three 16-byte slots and
 * writes the literal constants 1, 2, 3 into each slot's first field (`0x4080bf14`, `0x4080bf16`,
 * `0x4080bf26`) — that is the phase number, not a measurement. The three measurements come from
 * `[$r0+0x18/0x1c/0x20]` and the same offsets +0x10 / +0x20 for the other phases.
 *
 * What anchors the mapping is the regulation's own getter at `0x40840668`: it reads
 * `[$r1+0x1020]`, `[+0x1030]` and `[+0x1040]` as the three phase active powers and flips each
 * sign from a direction-bit byte. The encoder reads exactly those addresses (with `$r0 = dev +
 * 0x1000`) into the fourth slot field, using the same bits 1/2/4 and the same flags byte. The EM
 * logger (`0x4082c642` ff., format `0x40919d90`) lists `current, voltage, act_power, freq` at
 * `+0xac … +0xb8` with stride `0x10`, which lines up on the same base without contradiction.
 *
 * The scales were measured against the meter's own API on 2026-08-04 and are applied here, so these
 * are volts, amperes and watts.
 */
export interface MeterPhase {
	/** Phase number as the device labels it: 1 = A, 2 = B, 3 = C. */
	phase: number;
	/** Voltage in V. */
	voltage: number;
	/** Current in A. */
	current: number;
	/** Active power in W, signed — the direction comes from the device's own flags byte. */
	activePower: number;
}

/** A metering device as the DTU reports it. */
export interface MeterDevice {
	/** Which `RealDataNew` field carried it (14 = primary, max 5; 15 = secondary, max 10). */
	field: number;
	/**
	 * Device id as lower-case hex — for a Shelly this is its MAC.
	 *
	 * It sits in the header's **first** field: the encoder copies eight bytes straight off the
	 * device record (`lmw.bi $r4,[$r0],$r5` at `0x4080bf3a`) into header offsets +0x00/+0x04. The
	 * descriptor calls that field `device_kind`, but that name is merely inherited from the app
	 * decompilation and does not match what the firmware puts there. Header field 2 receives the
	 * constant 1.
	 */
	serial: string;
	/** One entry per phase, up to three. */
	phases: MeterPhase[];
	/**
	 * Grid frequency in Hz. Sent once per device (header field 3), not per phase — the encoder puts
	 * `[$r0+0x24]` there rather than into a phase slot. Unlike the phase values this one is not
	 * scaled: the device sent a bare 50 while the meter reported 50.00 Hz.
	 */
	frequency: number;
	/** Cumulative imported energy, raw (header field 4) — unit not established. */
	energyImport: number;
	/** Cumulative exported energy, raw (header field 5) — unit not established. */
	energyExport: number;
}

/**
 * Read the metering devices (fields 14 and 15) from a `RealDataNew` payload.
 *
 * Structure is hard-proven from the flash descriptor `Msg_40923654`: a device header plus up to
 * three phase entries of four `int32` each; the encoder at `0x4080bf3e` writes `cnt = 3` and three
 * 16-byte slots starting at +0x24.
 *
 * @param payload - decoded `RealDataNew` protobuf bytes
 * @returns every metering device found, empty when no meter poll is running
 */
export function parseMeterDevices(payload: Buffer): MeterDevice[] {
	const devices: MeterDevice[] = [];
	for (const field of wireFields(payload)) {
		if (field.wire !== 2 || (field.no !== FIELD_METER_PRIMARY && field.no !== FIELD_METER_SECONDARY)) {
			continue;
		}
		const inner = wireFields(field.bytes);
		const head = inner.find(f => f.no === 1 && f.wire === 2);
		const headFields = new Map<number, bigint>();
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
				const slots = new Map<number, number>();
				for (const f of wireFields(p.bytes)) {
					if (f.wire === 0) {
						slots.set(f.no, asInt32(f.varint));
					}
				}
				// The device numbers its phases 1..3, so a 0 means "not sent" just as much as an
				// absent field does — proto3 omits defaults, and either way the slot order is the
				// authoritative answer.
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
			serial: headFields.has(1) ? headFields.get(1)!.toString(16) : "",
			phases,
			frequency: asInt32(headFields.get(3) ?? 0n),
			energyImport: asInt32(headFields.get(4) ?? 0n),
			energyExport: asInt32(headFields.get(5) ?? 0n),
		});
	}
	return devices;
}

/**
 * Encode a varint.
 *
 * @param n - non-negative value
 */
function varint(n: number): Buffer {
	const bytes: number[] = [];
	let v = n;
	while (v > 0x7f) {
		bytes.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	bytes.push(v);
	return Buffer.from(bytes);
}

/**
 * Build the `CommCmd` body for the bind command.
 *
 * Field layout `{time=1, action=2, tid=5, data=6}` — the same shape the app sends and the one
 * verified against the device; the descriptor for this message is `VA 0x4090f3d4`.
 *
 * @param mac - meter MAC
 * @param devType - {@link SHELLY_DEV_TYPE_GRID} or {@link SHELLY_DEV_TYPE_METER_ONLY}
 * @param timestamp - unix seconds; the DTU rejects anything more than 60 s off its own clock
 */
export function encodeShellyBindBody(mac: string, devType: number, timestamp: number): Buffer {
	const data = Buffer.from(buildShellyBindData(mac, devType), "ascii");
	return Buffer.concat([
		Buffer.concat([varint((1 << 3) | 0), varint(timestamp)]),
		Buffer.concat([varint((2 << 3) | 0), varint(ACTION_SHELLY_BIND)]),
		Buffer.concat([varint((5 << 3) | 0), varint(timestamp)]),
		Buffer.concat([varint((6 << 3) | 2), varint(data.length), data]),
	]);
}

/**
 * Build the payload for the bind command (`action 85`).
 *
 * The record parser (`0x4081484e`) runs the token through `strtoull(token, NULL, 16)` and looks the
 * result up in the device registry (`0x40831042`, format `"%012llx"`); only a name found there is
 * copied into the device list. A hostname therefore yields 0, the list stays empty, and the DTU
 * logs `[E] Shelly Hostname is NULL` without ever opening a WebSocket — which is why a MAC is
 * required here and a hostname is rejected outright.
 *
 * @param mac - meter MAC, with or without separators
 * @param devType - {@link SHELLY_DEV_TYPE_GRID} or {@link SHELLY_DEV_TYPE_METER_ONLY}
 * @throws {Error} if the MAC is not 12 hex digits or the device type is unknown
 */
export function buildShellyBindData(mac: string, devType: number): string {
	const clean = (mac || "").replace(/[:\-\s]/g, "").toLowerCase();
	if (!/^[0-9a-f]{12}$/.test(clean)) {
		throw new Error(
			`"${mac}" is not a 12-digit hex MAC. The bind command identifies the meter by MAC, ` +
				`not by its mDNS hostname.`,
		);
	}
	if (devType !== SHELLY_DEV_TYPE_METER_ONLY && devType !== SHELLY_DEV_TYPE_GRID) {
		throw new Error(`Unknown Shelly device type ${devType} (0 = meter only, 2 = grid device).`);
	}
	return `1\r${clean},${devType}\r`;
}
