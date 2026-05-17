import assert from "node:assert";
import {
	clearTimer,
	deriveStationTzOffsetMs,
	errorMessage,
	logOnError,
	mapLimit,
	safeJsonStringify,
	stationWallClockToEpoch,
	unixSeconds,
	withTimeout,
} from "../build/lib/utils.js";

// ============================================================
// unixSeconds
// ============================================================
describe("unixSeconds", function () {
	it("returns an integer close to Date.now()/1000", function () {
		const before = Math.floor(Date.now() / 1000);
		const result = unixSeconds();
		const after = Math.floor(Date.now() / 1000);
		assert.strictEqual(Number.isInteger(result), true);
		assert.ok(result >= before && result <= after);
	});
});

// ============================================================
// errorMessage
// ============================================================
describe("errorMessage", function () {
	it("extracts message from Error instance", function () {
		assert.strictEqual(errorMessage(new Error("boom")), "boom");
	});

	it("returns string as-is", function () {
		assert.strictEqual(errorMessage("oops"), "oops");
	});

	it("handles null", function () {
		assert.strictEqual(errorMessage(null), "null");
	});

	it("handles undefined", function () {
		assert.strictEqual(errorMessage(undefined), "undefined");
	});

	it("handles number", function () {
		assert.strictEqual(errorMessage(404), "404");
	});

	it("handles object with toString", function () {
		assert.strictEqual(errorMessage({ toString: () => "custom" }), "custom");
	});

	it("handles Error subclass", function () {
		assert.strictEqual(errorMessage(new TypeError("type err")), "type err");
	});
});

// ============================================================
// logOnError
// ============================================================
describe("logOnError", function () {
	it("calls fn successfully without calling log", async function () {
		let fnCalled = false;
		let logCalled = false;
		await logOnError(
			() => {
				fnCalled = true;
			},
			() => {
				logCalled = true;
			},
			"test",
		);
		assert.strictEqual(fnCalled, true, "fn should have been called");
		assert.strictEqual(logCalled, false, "log should not have been called on success");
	});

	it("catches errors and calls log with formatted message", async function () {
		let logMessage = "";
		await logOnError(
			() => {
				throw new Error("something broke");
			},
			msg => {
				logMessage = msg;
			},
			"myLabel",
		);
		assert.strictEqual(logMessage, "myLabel: something broke");
	});

	it("includes the label in the log message", async function () {
		let logMessage = "";
		await logOnError(
			() => {
				throw new Error("fail");
			},
			msg => {
				logMessage = msg;
			},
			"ImportantTask",
		);
		assert.ok(logMessage.startsWith("ImportantTask:"), `log message should start with label, got: ${logMessage}`);
	});

	it("does not throw when fn throws", async function () {
		await assert.doesNotReject(async () => {
			await logOnError(
				() => {
					throw new Error("kaboom");
				},
				() => {},
				"safe",
			);
		});
	});

	it("handles async fn that rejects", async function () {
		let logMessage = "";
		await logOnError(
			async () => {
				throw new Error("async fail");
			},
			msg => {
				logMessage = msg;
			},
			"asyncOp",
		);
		assert.strictEqual(logMessage, "asyncOp: async fail");
	});

	it("handles non-Error throws via errorMessage", async function () {
		let logMessage = "";
		await logOnError(
			() => {
				throw "string error";
			},
			msg => {
				logMessage = msg;
			},
			"strErr",
		);
		assert.strictEqual(logMessage, "strErr: string error");
	});
});

// ============================================================
// mapLimit
// ============================================================
describe("mapLimit", function () {
	it("empty array returns empty array", async function () {
		const result = await mapLimit([], 3, async x => x);
		assert.deepStrictEqual(result, []);
	});

	it("single item returns single result", async function () {
		const result = await mapLimit([42], 3, async x => x * 2);
		assert.deepStrictEqual(result, [84]);
	});

	it("preserves order of results", async function () {
		// Add varying delays to verify order is preserved regardless of completion order
		const result = await mapLimit([1, 2, 3], 2, async x => {
			await new Promise(r => setTimeout(r, (4 - x) * 10));
			return x * 2;
		});
		assert.deepStrictEqual(result, [2, 4, 6]);
	});

	it("concurrency limit is respected", async function () {
		const limit = 2;
		let active = 0;
		let maxActive = 0;

		await mapLimit([1, 2, 3, 4, 5], limit, async x => {
			active++;
			if (active > maxActive) {
				maxActive = active;
			}
			await new Promise(r => setTimeout(r, 20));
			active--;
			return x;
		});

		assert.ok(maxActive <= limit, `maxActive was ${maxActive}, expected <= ${limit}`);
		assert.ok(maxActive > 0, "maxActive should be > 0");
	});

	it("errors propagate", async function () {
		await assert.rejects(
			() =>
				mapLimit([1, 2, 3], 2, async x => {
					if (x === 2) {
						throw new Error("boom");
					}
					return x;
				}),
			{ message: "boom" },
		);
	});

	it("limit larger than items length works correctly", async function () {
		const result = await mapLimit([10, 20], 100, async x => x + 1);
		assert.deepStrictEqual(result, [11, 21]);
	});

	it("limit of 1 processes sequentially", async function () {
		let active = 0;
		let maxActive = 0;
		const order = [];

		await mapLimit([1, 2, 3], 1, async x => {
			active++;
			if (active > maxActive) {
				maxActive = active;
			}
			order.push(x);
			await new Promise(r => setTimeout(r, 10));
			active--;
			return x;
		});

		assert.strictEqual(maxActive, 1, "should never exceed 1 concurrent task");
		assert.deepStrictEqual(order, [1, 2, 3], "items should be processed in order");
	});
});

// ============================================================
// clearTimer
// ============================================================
describe("clearTimer", function () {
	it("returns null for null input", function () {
		assert.strictEqual(clearTimer(null), null);
	});

	it("returns null for undefined input", function () {
		assert.strictEqual(clearTimer(undefined), null);
	});

	it("returns null for a real timer handle and clears it", function () {
		let fired = false;
		const handle = setTimeout(() => {
			fired = true;
		}, 10);
		const result = clearTimer(handle);
		assert.strictEqual(result, null);
		// Give the timer a chance to fire (it should not)
		return new Promise(resolve => {
			setTimeout(() => {
				assert.strictEqual(fired, false, "timer callback should not have fired");
				resolve();
			}, 50);
		});
	});
});

// ============================================================
// withTimeout
// ============================================================
describe("withTimeout", function () {
	it("resolves if promise completes within timeout", async function () {
		const result = await withTimeout(new Promise(resolve => setTimeout(() => resolve("done"), 10)), 200, "fast");
		assert.strictEqual(result, "done");
	});

	it("rejects with timeout error if promise takes too long", async function () {
		await assert.rejects(
			() => withTimeout(new Promise(resolve => setTimeout(() => resolve("late"), 500)), 20, "slowOp"),
			err => {
				assert.ok(err instanceof Error);
				assert.ok(err.message.includes("slowOp"));
				assert.ok(err.message.includes("timeout"));
				assert.ok(err.message.includes("20ms"));
				return true;
			},
		);
	});

	it("cleans up timer on success (no hanging timers)", async function () {
		// If the timer is not cleaned up, the test runner would report a leak
		// or the process would hang. We verify by ensuring fast resolution.
		const result = await withTimeout(Promise.resolve(42), 5000, "cleanup");
		assert.strictEqual(result, 42);
	});

	it("rejects with original error if promise rejects before timeout", async function () {
		await assert.rejects(() => withTimeout(Promise.reject(new Error("original failure")), 5000, "rejectTest"), {
			message: "original failure",
		});
	});
});

// ============================================================
// safeJsonStringify
// ============================================================
describe("safeJsonStringify", function () {
	it("returns normal JSON for small data", function () {
		const data = { a: 1, b: "hello" };
		assert.strictEqual(safeJsonStringify(data), JSON.stringify(data));
	});

	it("truncates large arrays (returns object with truncated, count, data)", function () {
		const bigArray = Array.from({ length: 10000 }, (_, i) => ({ index: i, value: "x".repeat(20) }));
		const result = safeJsonStringify(bigArray, 1000);
		const parsed = JSON.parse(result);
		assert.strictEqual(parsed.truncated, true);
		assert.strictEqual(parsed.count, 10000);
		assert.ok(Array.isArray(parsed.data));
		assert.strictEqual(parsed.data.length, 500);
		// Should contain the last 500 elements
		assert.strictEqual(parsed.data[0].index, 9500);
	});

	it("handles non-array large data by substring", function () {
		const bigString = "x".repeat(200);
		const result = safeJsonStringify(bigString, 50);
		assert.ok(result.length <= 50, `result length ${result.length} should be <= 50`);
		// Should be the beginning of the JSON string
		assert.strictEqual(result, JSON.stringify(bigString).substring(0, 50));
	});

	it("default maxLength works without explicit argument", function () {
		const smallData = [1, 2, 3];
		const result = safeJsonStringify(smallData);
		assert.strictEqual(result, JSON.stringify(smallData));
	});
});

// ============================================================
// deriveStationTzOffsetMs
// ============================================================
describe("deriveStationTzOffsetMs", function () {
	/**
	 * Build a wall-clock string offsetH hours ahead of the current real UTC time.
	 *
	 * @param offsetH - Hours the simulated station is ahead of UTC (may be fractional/negative).
	 */
	function wallClock(offsetH) {
		return new Date(Date.now() + offsetH * 3600000).toISOString().slice(0, 19).replace("T", " ");
	}

	it("returns +2h for a station 2 hours ahead of UTC (CEST)", function () {
		assert.strictEqual(deriveStationTzOffsetMs(wallClock(2)), 2 * 3600000);
	});

	it("returns 0 for a station on UTC", function () {
		assert.strictEqual(deriveStationTzOffsetMs(wallClock(0)), 0);
	});

	it("returns a negative offset for a station behind UTC", function () {
		assert.strictEqual(deriveStationTzOffsetMs(wallClock(-5)), -5 * 3600000);
	});

	it("resolves a :30 offset (rounded to 15min)", function () {
		assert.strictEqual(deriveStationTzOffsetMs(wallClock(5.5)), 5.5 * 3600000);
	});

	it("returns null for empty/nullish/garbage input", function () {
		assert.strictEqual(deriveStationTzOffsetMs(""), null);
		assert.strictEqual(deriveStationTzOffsetMs(undefined), null);
		assert.strictEqual(deriveStationTzOffsetMs(null), null);
		assert.strictEqual(deriveStationTzOffsetMs("not-a-date"), null);
	});
});

// ============================================================
// stationWallClockToEpoch
// ============================================================
describe("stationWallClockToEpoch", function () {
	it("subtracts the station offset to land on the real UTC instant", function () {
		// 14:30 station-local in a UTC+2 zone == 12:30:00Z.
		const epoch = stationWallClockToEpoch("2026-05-15 14:30:00", 2 * 3600000);
		assert.strictEqual(epoch, Date.parse("2026-05-15T12:30:00Z"));
	});

	it("is an identity (parse-as-UTC) when offset is 0", function () {
		const epoch = stationWallClockToEpoch("2026-05-15 14:30:00", 0);
		assert.strictEqual(epoch, Date.parse("2026-05-15T14:30:00Z"));
	});

	it("returns null for empty/nullish/garbage input", function () {
		assert.strictEqual(stationWallClockToEpoch("", 0), null);
		assert.strictEqual(stationWallClockToEpoch(undefined, 0), null);
		assert.strictEqual(stationWallClockToEpoch(null, 0), null);
		assert.strictEqual(stationWallClockToEpoch("garbage", 0), null);
	});
});
