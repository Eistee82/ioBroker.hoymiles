import assert from "node:assert";
import { errorMessage, mapLimit } from "../build/lib/utils.js";

// ============================================================
// main – errorMessage helper used throughout the adapter
// ============================================================
describe("main – errorMessage helper", function () {
	it("extracts message from Error objects", function () {
		assert.strictEqual(errorMessage(new Error("test error")), "test error");
	});

	it("handles string errors", function () {
		assert.strictEqual(errorMessage("plain string"), "plain string");
	});

	it("handles null/undefined gracefully", function () {
		const result = errorMessage(null);
		assert.strictEqual(typeof result, "string");
	});

	it("handles objects without crashing", function () {
		const result = errorMessage({ message: "custom" });
		assert.strictEqual(typeof result, "string");
		assert.ok(result.length > 0);
	});

	it("handles numeric errors", function () {
		const result = errorMessage(42);
		assert.strictEqual(typeof result, "string");
	});
});

// ============================================================
// main – mapLimit (used for parallel device operations)
// ============================================================
describe("main – mapLimit for parallel device operations", function () {
	it("processes empty array", async function () {
		const results = await mapLimit([], 3, async item => item);
		assert.deepStrictEqual(results, []);
	});

	it("processes all items", async function () {
		const results = await mapLimit([1, 2, 3, 4], 2, async n => n * 2);
		assert.deepStrictEqual(results, [2, 4, 6, 8]);
	});

	it("respects concurrency limit", async function () {
		let concurrent = 0;
		let maxConcurrent = 0;

		const results = await mapLimit([1, 2, 3, 4, 5], 2, async n => {
			concurrent++;
			maxConcurrent = Math.max(maxConcurrent, concurrent);
			await new Promise(r => globalThis.setTimeout(r, 10));
			concurrent--;
			return n;
		});

		assert.strictEqual(results.length, 5);
		assert.ok(maxConcurrent <= 2, `max concurrent was ${maxConcurrent}, expected <= 2`);
	});

	it("handles errors in mapper", async function () {
		await assert.rejects(
			() =>
				mapLimit([1, 2, 3], 2, async n => {
					if (n === 2) {
						throw new Error("fail");
					}
					return n;
				}),
			/fail/,
		);
	});

	it("limit of 1 processes sequentially", async function () {
		const order = [];
		await mapLimit([1, 2, 3], 1, async n => {
			order.push(n);
			await new Promise(r => globalThis.setTimeout(r, 5));
			return n;
		});
		assert.deepStrictEqual(order, [1, 2, 3]);
	});
});
