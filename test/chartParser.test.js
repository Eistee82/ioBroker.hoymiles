import assert from "node:assert";
import * as path from "node:path";
import protobuf from "protobufjs";
import { parseChartResponse, decodeIndicatorDayCurve } from "../build/lib/chartParser.js";

// ============================================================
// chartParser
// ============================================================
describe("chartParser", function () {
	it("returns empty object for null buffer", async function () {
		const result = await parseChartResponse(null);
		assert.deepStrictEqual(result, {});
	});

	it("returns empty object for empty buffer", async function () {
		const result = await parseChartResponse(Buffer.alloc(0));
		assert.deepStrictEqual(result, {});
	});

	it("returns empty object for buffer shorter than 50 bytes", async function () {
		const result = await parseChartResponse(Buffer.alloc(49, 0xff));
		assert.deepStrictEqual(result, {});
	});

	it("returns empty object for invalid protobuf data", async function () {
		const result = await parseChartResponse(Buffer.alloc(100, 0xff));
		assert.deepStrictEqual(result, {});
	});

	it("calls log callback on parse failure", async function () {
		let logged = false;
		await parseChartResponse(Buffer.alloc(100, 0xff), () => {
			logged = true;
		});
		assert.ok(logged, "Log callback should have been called");
	});

	it("parses valid LineChart protobuf data", async function () {
		const protoDir = path.join(import.meta.dirname, "..", "build", "lib", "proto");
		const root = await protobuf.load(path.join(protoDir, "Chart.proto"));
		const LineChart = root.lookupType("LineChart");

		const chart = LineChart.create({
			series: [
				{ type: "MI_POWER", data: [0, 0, 100.5, 200.3, 0] },
				{ type: "MI_TEMPERATURE", data: [0, 25.7, 30.2] },
			],
		});
		const buf = Buffer.from(LineChart.encode(chart).finish());

		const result = await parseChartResponse(buf);
		assert.strictEqual(result.MI_POWER, 200.3);
		assert.strictEqual(result.MI_TEMPERATURE, 30.2);
	});

	it("parses LineChart with all-zero series", async function () {
		const protoDir = path.join(import.meta.dirname, "..", "build", "lib", "proto");
		const root = await protobuf.load(path.join(protoDir, "Chart.proto"));
		const LineChart = root.lookupType("LineChart");

		const chart = LineChart.create({
			series: [{ type: "MI_POWER", data: [0, 0, 0] }],
		});
		const buf = Buffer.from(LineChart.encode(chart).finish());

		const result = await parseChartResponse(buf);
		assert.strictEqual(result.MI_POWER, undefined);
	});
});

// ============================================================
// chartParser – decodeIndicatorDayCurve (indicators/data/cid_g_a)
// ============================================================
describe("chartParser – decodeIndicatorDayCurve", function () {
	/**
	 * Packed varint field (wire type 2) carrying the minute-of-day of each sample.
	 *
	 * @param minutes - Minute-of-day values.
	 */
	function packedMinutes(minutes) {
		const w = new protobuf.Writer();
		for (const m of minutes) {
			w.uint32(m);
		}
		return w.finish();
	}

	/**
	 * Packed little-endian doubles (field 5's wire format).
	 *
	 * @param values - Sample values.
	 */
	function packedDoublesLE(values) {
		const buf = Buffer.alloc(values.length * 8);
		values.forEach((v, i) => buf.writeDoubleLE(v, i * 8));
		return buf;
	}

	/**
	 * Build one inner series message: field 4 = packed varint minutes, field 5 = packed LE doubles.
	 *
	 * @param minutes - Minute-of-day of each sample.
	 * @param values - Sample values, same length as `minutes`.
	 */
	function buildSeries(minutes, values) {
		const w = new protobuf.Writer();
		if (minutes) {
			w.uint32(34).bytes(packedMinutes(minutes)); // field 4, wire type 2 → tag 34
		}
		if (values) {
			w.uint32(42).bytes(packedDoublesLE(values)); // field 5, wire type 2 → tag 42
		}
		return w.finish();
	}

	/**
	 * Build the outer repeated message the endpoint answers with.
	 *
	 * @param innerBufs - Encoded inner series messages, one per repeated entry.
	 */
	function buildOuter(innerBufs) {
		const w = new protobuf.Writer();
		for (const inner of innerBufs) {
			w.uint32(10).bytes(inner); // field 1, wire type 2 → tag 10
		}
		return w.finish();
	}

	it("decodes minutes + values from the first series carrying samples", function () {
		const buf = buildOuter([buildSeries([0, 5, 10], [123.45, 130, 98.7])]);
		const result = decodeIndicatorDayCurve(buf);
		assert.deepStrictEqual(result, { minutes: [0, 5, 10], values: [123.45, 130, 98.7] });
	});

	it("skips leading series with no samples and returns the first one that has some", function () {
		const empty = buildSeries([], []);
		const withData = buildSeries([0, 5], [1.5, 2.5]);
		const buf = buildOuter([empty, withData]);
		const result = decodeIndicatorDayCurve(buf);
		assert.deepStrictEqual(result, { minutes: [0, 5], values: [1.5, 2.5] });
	});

	it("returns null for an empty buffer", function () {
		assert.strictEqual(decodeIndicatorDayCurve(Buffer.alloc(0)), null);
	});

	it("returns null for a message without field 4/5 (no minutes, no values)", function () {
		const buf = buildOuter([buildSeries(null, null)]);
		assert.strictEqual(decodeIndicatorDayCurve(buf), null);
	});

	it("returns null when minutes and values have mismatched lengths", function () {
		const buf = buildOuter([buildSeries([0, 5, 10], [1, 2])]);
		assert.strictEqual(decodeIndicatorDayCurve(buf), null);
	});
});
