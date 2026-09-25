import * as path from "node:path";
import protobuf from "protobufjs";
import { round1 } from "./convert.js";
import { errorMessage } from "./utils.js";

/**
 * Find the last positive value in an array, rounded to one decimal place.
 *
 * @param arr - Array of numeric values
 */
function lastPositive(arr: number[]): number | undefined {
	for (let i = arr.length - 1; i >= 0; i--) {
		if (arr[i] > 0) {
			return round1(arr[i]);
		}
	}
	return undefined;
}

let chartRoot: protobuf.Root | null = null;

/**
 * Load the Chart.proto definition (cached after first load).
 */
async function ensureChartProto(): Promise<protobuf.Root> {
	if (!chartRoot) {
		const protoDir = path.join(import.meta.dirname, "proto");
		chartRoot = await protobuf.load(path.join(protoDir, "Chart.proto"));
	}
	return chartRoot;
}

/**
 * Parse a Protobuf chart response (LineChart or ChartV2 format).
 * Extracts the last non-zero value per quota/series type.
 *
 * @param rawBuf - Raw Protobuf response buffer
 * @param log - Debug log callback
 * @returns Map of quota name to last non-zero value
 */
async function parseChartResponse(rawBuf: Buffer, log?: (msg: string) => void): Promise<Record<string, number>> {
	const result: Record<string, number> = {};
	if (!rawBuf || rawBuf.length < 50) {
		return result;
	}

	let root: protobuf.Root;
	try {
		root = await ensureChartProto();
	} catch (err) {
		log?.(`Failed to load Chart proto: ${err instanceof Error ? err.message : String(err)}`);
		return result;
	}

	// Try LineChart format first (used by the app: ChartPB.LineChart.parseFrom)
	// LineChart has: x_axis (strings), series (LineSeries[]), type
	// LineSeries has: type (string), data (float[]), did, port
	try {
		const LineChart = root.lookupType("LineChart");
		const decoded = LineChart.decode(rawBuf);
		const chart = LineChart.toObject(decoded, { longs: Number, defaults: true });
		const series = (chart.series || []) as Array<{ type: string; data: number[] }>;
		for (const s of series) {
			if (s.data && s.data.length > 0) {
				const val = lastPositive(s.data);
				if (val !== undefined) {
					result[s.type] = val;
				}
			}
		}
		return result;
	} catch (err) {
		log?.(`LineChart parse failed, trying ChartV2: ${errorMessage(err)}`);
	}

	// Fallback: try ChartV2 format
	try {
		const ChartV2 = root.lookupType("ChartV2");
		const decoded = ChartV2.decode(rawBuf);
		const obj = ChartV2.toObject(decoded, { longs: Number, defaults: true });
		const dataArr = (obj.data || []) as number[];
		const quota = (obj.quota || "") as string;
		if (dataArr.length > 0 && quota) {
			const val = lastPositive(dataArr);
			if (val !== undefined) {
				result[quota] = val;
			}
		}
	} catch (err2) {
		log?.(`ChartV2 parse also failed: ${errorMessage(err2)}`);
	}

	return result;
}

/** One indicator's day curve as `indicators/data/cid_g_a` delivers it. */
export interface IndicatorDayCurve {
	/** Minute of the station-local day of each sample (0, 5, 10, …). */
	minutes: number[];
	/** Sample values in the indicator's unit (W, %, …). */
	values: number[];
}

/**
 * Decode the protobuf answer of `indicators/data/cid_g_a` — the day curve of one indicator of a
 * storage-plant device. The message is not in the adapter's .proto set; its shape was read off live
 * answers: a repeated outer message whose fields are 1 = "id,sn", 2 = date, 3 = indicator key,
 * 4 = packed varint minutes of day, 5 = packed doubles. The first series with samples is returned.
 *
 * @param rawBuf - Raw response body.
 * @returns The curve, or null when the answer carries no samples.
 */
export function decodeIndicatorDayCurve(rawBuf: Uint8Array): IndicatorDayCurve | null {
	const outer = protobuf.Reader.create(rawBuf);
	while (outer.pos < outer.len) {
		const tag = outer.uint32();
		if ((tag & 7) !== 2) {
			outer.skipType(tag & 7);
			continue;
		}
		const inner = protobuf.Reader.create(outer.bytes());
		const minutes: number[] = [];
		const values: number[] = [];
		while (inner.pos < inner.len) {
			const t = inner.uint32();
			const field = t >>> 3;
			const wire = t & 7;
			if (wire !== 2) {
				inner.skipType(wire);
				continue;
			}
			const b = inner.bytes();
			if (field === 4) {
				const r = protobuf.Reader.create(b);
				while (r.pos < r.len) {
					minutes.push(r.uint32());
				}
			} else if (field === 5) {
				const view = Buffer.from(b.buffer, b.byteOffset, b.length);
				for (let i = 0; i + 8 <= b.length; i += 8) {
					values.push(view.readDoubleLE(i));
				}
			}
		}
		if (minutes.length > 0 && minutes.length === values.length) {
			return { minutes, values };
		}
	}
	return null;
}

export { parseChartResponse };
