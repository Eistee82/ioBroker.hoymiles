import assert from "node:assert";
import {
	buildShellyBindData,
	parseEnergyFlow,
	parseMeterDevices,
	SHELLY_DEV_TYPE_GRID,
	SHELLY_DEV_TYPE_METER_ONLY,
} from "../build/lib/shellyProtocol.js";

// --- helpers to build protobuf payloads by hand -------------------------------
// Deliberately hand-rolled: the shared RealDataNew.proto declares field 13 as `uint64
// dtu_daily_energy` (true on the 2T), so these fields cannot be expressed through it.

const varint = n => {
	const b = [];
	let v = BigInt(n);
	while (v > 0x7fn) {
		b.push(Number(v & 0x7fn) | 0x80);
		v >>= 7n;
	}
	b.push(Number(v));
	return Buffer.from(b);
};
const fld = (no, wire, payload) => Buffer.concat([varint((no << 3) | wire), payload]);
const msg = p => Buffer.concat([varint(p.length), p]);
const vfld = (no, value) => fld(no, 0, varint(value));

/**
 * Energy-flow submessage (field 13): pv, grid, load, sp, plug.
 *
 * @param values - the five flow values, in tenths of a watt as the device sends them
 * @param values.pv - PV production (13.1)
 * @param values.grid - grid exchange, negative = export (13.2)
 * @param values.load - house load (13.3)
 * @param values.sp - storage power (13.4)
 * @param values.plug - plug power (13.5)
 */
function flowPayload({ pv = 0, grid = 0, load = 0, sp = 0, plug = 0 }) {
	return fld(
		13,
		2,
		msg(
			Buffer.concat([
				vfld(1, pv),
				vfld(2, BigInt.asUintN(64, BigInt(grid))),
				vfld(3, load),
				vfld(4, sp),
				vfld(5, plug),
			]),
		),
	);
}

/**
 * One metering device (field 14 or 15).
 *
 * Header layout mirrors what the encoder at 0x4080bf3e writes: field 1 = the device id copied as
 * eight raw bytes off the device record, field 2 = the constant 1, field 3 = frequency,
 * fields 4/5 = the cumulative energy counters.
 *
 * @param fieldNo - 14 (primary, max 5 devices) or 15 (secondary, max 10)
 * @param serial - device id as BigInt; for a Shelly this is its MAC
 * @param phases - one `[phase, voltage, current, activePower]` tuple per phase
 * @param head - optional frequency and energy counters
 */
function meterPayload(fieldNo, serial, phases, head = {}) {
	const { frequency = 0, energyImport = 0, energyExport = 0 } = head;
	const headBuf = Buffer.concat([
		vfld(1, serial),
		vfld(2, 1),
		vfld(3, BigInt.asUintN(64, BigInt(frequency))),
		vfld(4, BigInt.asUintN(64, BigInt(energyImport))),
		vfld(5, BigInt.asUintN(64, BigInt(energyExport))),
	]);
	const parts = [fld(1, 2, msg(headBuf))];
	for (const p of phases) {
		parts.push(fld(2, 2, msg(Buffer.concat(p.map((v, i) => vfld(i + 1, BigInt.asUintN(64, BigInt(v))))))));
	}
	return fld(fieldNo, 2, msg(Buffer.concat(parts)));
}

describe("shellyProtocol — bind payload (action 85)", function () {
	// Firmware-proven format: "<count>\r<mac-hex>,<type>\r". The record parser runs the token
	// through strtoull(base 16) and looks it up in the device registry, so a hostname yields 0
	// and the device list stays empty ("[E] Shelly Hostname is NULL").
	it("builds the documented payload from a bare hex MAC", function () {
		assert.strictEqual(buildShellyBindData("bc2411b807c0", SHELLY_DEV_TYPE_GRID), "1\rbc2411b807c0,2\r");
	});

	it("accepts a separator-formatted MAC and normalizes it", function () {
		assert.strictEqual(buildShellyBindData("BC:24:11:B8:07:C0", SHELLY_DEV_TYPE_GRID), "1\rbc2411b807c0,2\r");
	});

	it("distinguishes meter-only from grid device", function () {
		// Type 0 polls the meter but the EMS never treats it as grid device, so zero-export
		// does not regulate. Type 2 is what makes the regulation see it.
		assert.strictEqual(buildShellyBindData("bc2411b807c0", SHELLY_DEV_TYPE_METER_ONLY), "1\rbc2411b807c0,0\r");
		assert.strictEqual(SHELLY_DEV_TYPE_METER_ONLY, 0);
		assert.strictEqual(SHELLY_DEV_TYPE_GRID, 2);
	});

	it("rejects a hostname instead of a MAC", function () {
		assert.throws(() => buildShellyBindData("shellypro3em-bc2411b807c0", SHELLY_DEV_TYPE_GRID), /MAC/i);
	});

	it("rejects a MAC of the wrong length", function () {
		assert.throws(() => buildShellyBindData("bc2411b807", SHELLY_DEV_TYPE_GRID), /MAC/i);
	});

	it("rejects an out-of-range device type", function () {
		assert.throws(() => buildShellyBindData("bc2411b807c0", 7), /type/i);
	});
});

describe("shellyProtocol — energy flow (field 13)", function () {
	// Field mapping proven in firmware: format string @0x4080b6d8
	// " pv: %d\r\n plug: %d\r\n grid: %d\r\n load: %d\r\n sp: %d\r\n" with the arguments loaded
	// from $r6+0x1cc0 immediately before, i.e. 13.1=pv 13.2=grid 13.3=load 13.4=sp 13.5=plug.
	it("maps the five values to their proven names", function () {
		const r = parseEnergyFlow(flowPayload({ pv: 5282, grid: 7940, load: 12942, sp: 0, plug: 5002 }));
		assert.deepStrictEqual(r, { pv: 528.2, grid: 794, load: 1294.2, sp: 0, plug: 500.2 });
	});

	it("keeps export negative", function () {
		// Feeding into the grid arrives as a negative int32; a naive unsigned read would turn
		// -500 W into a 2^64 number and make the value useless.
		const r = parseEnergyFlow(flowPayload({ grid: -5000 }));
		assert.strictEqual(r.grid, -500);
	});

	it("returns null when the field is absent", function () {
		// Without a running Shelly poll the DTU omits field 13 entirely.
		assert.strictEqual(parseEnergyFlow(Buffer.from("0a03414243", "hex")), null);
	});

	it("survives a truncated payload", function () {
		assert.doesNotThrow(() => parseEnergyFlow(Buffer.from("6a05089205", "hex")));
	});
});

describe("shellyProtocol — metering devices (fields 14/15)", function () {
	// Slot layout proven at 0x4080bf3e: field 1 is the literal phase number (the encoder writes the
	// constants 1/2/3 from 0x4080bf14/bf16/bf26), field 2 voltage, field 3 current, field 4 active
	// power. The anchor is the regulation getter 0x40840668, which reads the three active powers
	// from [$r1+0x1020/0x1030/0x1040] — exactly the addresses the encoder feeds into field 4.
	it("names the phase values as the firmware orders them", function () {
		const devices = parseMeterDevices(meterPayload(14, 0xbc2411b807c0n, [[1, 2301, 1234, 4560]]));
		assert.strictEqual(devices.length, 1);
		assert.strictEqual(devices[0].field, 14);
		// The device id sits in header field 1, copied as eight raw bytes off the device record —
		// NOT in field 2, which receives the constant 1.
		assert.strictEqual(devices[0].serial, "bc2411b807c0");
		assert.deepStrictEqual(devices[0].phases, [{ phase: 1, voltage: 230.1, current: 12.34, activePower: 456 }]);
	});

	it("reads all three phases with their own numbers", function () {
		const devices = parseMeterDevices(
			meterPayload(14, 1n, [
				[1, 2300, 100, 500],
				[2, 2310, 200, 600],
				[3, 2320, 300, 700],
			]),
		);
		assert.strictEqual(devices[0].phases.length, 3);
		assert.deepStrictEqual(devices[0].phases[2], { phase: 3, voltage: 232, current: 3, activePower: 70 });
	});

	it("keeps active power negative on export", function () {
		// The encoder negates this value from the device's direction-bit byte, the same byte and
		// the same bits (1/2/4) the regulation getter uses.
		const devices = parseMeterDevices(meterPayload(14, 1n, [[1, 2300, 100, -4500]]));
		assert.strictEqual(devices[0].phases[0].activePower, -450);
	});

	it("reads frequency and the energy counters from the header", function () {
		// Frequency is sent once per device, not per phase — the encoder puts [$r0+0x24] into
		// header field 3 rather than into a phase slot.
		const devices = parseMeterDevices(
			meterPayload(14, 1n, [[1, 2300, 100, 500]], {
				frequency: 50,
				energyImport: 123456,
				energyExport: 7890,
			}),
		);
		assert.strictEqual(devices[0].frequency, 50);
		assert.strictEqual(devices[0].energyImport, 123456);
		assert.strictEqual(devices[0].energyExport, 7890);
	});

	it("falls back to the slot index when the phase number is missing", function () {
		// proto3 omits a field that equals its default, so phase 0 can arrive without its number.
		const devices = parseMeterDevices(meterPayload(14, 1n, [[0, 2300, 100, 500]]));
		assert.strictEqual(devices[0].phases[0].phase, 1);
	});

	it("reads field 15 as well", function () {
		const devices = parseMeterDevices(meterPayload(15, 2n, [[1, 2300, 100, 500]]));
		assert.strictEqual(devices[0].field, 15);
	});

	it("returns an empty list when no meter is present", function () {
		assert.deepStrictEqual(parseMeterDevices(Buffer.from("0a03414243", "hex")), []);
	});
});

describe("shellyProtocol — measured against real hardware", function () {
	// A complete a211 answer captured on 2026-08-04 from an HMS-800-2WB with a Shelly Pro 3EM bound
	// as its grid device. At that moment the meter reported over its own API:
	//   L1 238.5 V / 0.27 A /  64 W
	//   L2 238.4 V / -0.35 A / -83 W   (exporting on that phase)
	//   L3 237.8 V / 2.70 A / 642 W    total 623 W
	// This is the regression guard for both the field mapping and the scales.
	const CAPTURE =
		"0a0c343136314130333141423631109980c8d306180128014a2308e1d6c6818ac205100218f11220872728be2c38eb0140e80748b1035001600168904e5a1f08e1d6c6818ac205100118d40220cc0528831330abe50238910b40808080185a1f08e1d6c6818ac205100218c70220c60828f91b30f6c30338860f40808080186a0c08fc2e10ba3118f85d28be2c72530a1b08c08fe08dc1842f100118322086980130adffffffffffffffff01120a080110d212181b208005121b080210d11218deffffffffffffffff0120e0f9ffffffffffffff01120b080310ca1218910220da32";

	it("decodes the phase values to what the meter itself reported", function () {
		const devices = parseMeterDevices(Buffer.from(CAPTURE, "hex"));
		assert.strictEqual(devices.length, 1, "one meter");
		assert.strictEqual(devices[0].serial, "bc2411b807c0", "device id is the meter MAC");
		const p = devices[0].phases;
		assert.strictEqual(p.length, 3, "three phases");
		assert.deepStrictEqual(
			p.map(x => x.phase),
			[1, 2, 3],
			"phases carry their own numbers",
		);
		// Voltage in tenths of a volt — meter said 238.5 / 238.4 / 237.8.
		assert.deepStrictEqual(
			p.map(x => x.voltage),
			[238.6, 238.5, 237.8],
		);
		// Current in hundredths of an ampere — meter said 0.27 / -0.35 / 2.70.
		assert.deepStrictEqual(
			p.map(x => x.current),
			[0.27, -0.34, 2.73],
		);
		// Active power in tenths of a watt, signed — meter said 64 / -83 / 642.
		assert.deepStrictEqual(
			p.map(x => x.activePower),
			[64, -80, 649],
		);
		// Frequency arrives once per device and unscaled.
		assert.strictEqual(devices[0].frequency, 50);
	});

	it("decodes the energy flow and satisfies the firmware's own identity", function () {
		const flow = parseEnergyFlow(Buffer.from(CAPTURE, "hex"));
		assert.deepStrictEqual(flow, { pv: 601.2, grid: 633, load: 1202.4, sp: 0, plug: 569.4 });
		// The firmware computes load = grid + plug - sp right next to the values (0x4080b6b0).
		// It holds exactly on the captured frame, which is what pins the field mapping down.
		assert.strictEqual(flow.load, flow.grid + flow.plug - flow.sp);
	});
});
