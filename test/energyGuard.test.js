import assert from "node:assert";
import { EnergyGuard } from "../build/lib/energyGuard.js";

// Local-time helper: the guard derives calendar boundaries from the local timezone,
// so the fixtures must be built as local times to stay timezone-independent.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

describe("EnergyGuard — totalEnergy", function () {
	it("accepts the first value of a key", function () {
		const guard = new EnergyGuard();
		assert.strictEqual(guard.accept("pv0.totalEnergy", 1234.5, at(2026, 7, 30)), 1234.5);
	});

	it("passes a rising counter through", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		assert.strictEqual(guard.accept("pv0.totalEnergy", 1001, at(2026, 7, 30)), 1001);
		assert.strictEqual(guard.accept("pv0.totalEnergy", 1050.25, at(2026, 7, 30)), 1050.25);
	});

	it("accepts an unchanged value", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		assert.strictEqual(guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30)), 1000);
	});

	it("drops a backward step (device restart)", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		assert.strictEqual(guard.accept("pv0.totalEnergy", 998, at(2026, 7, 30)), null);
	});

	it("never resets on a day, month or year change", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 12, 31, 23, 59));
		assert.strictEqual(guard.accept("pv0.totalEnergy", 0, at(2027, 1, 1, 0, 1)), null);
	});

	it("does not update its memory from a dropped value", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		guard.accept("pv0.totalEnergy", 5, at(2026, 7, 30));
		// Still measured against 1000, not against the rejected 5.
		assert.strictEqual(guard.accept("pv0.totalEnergy", 900, at(2026, 7, 30)), null);
		assert.strictEqual(guard.accept("pv0.totalEnergy", 1001, at(2026, 7, 30)), 1001);
	});
});

describe("EnergyGuard — dailyEnergy", function () {
	it("drops a backward step within the same day", function () {
		const guard = new EnergyGuard();
		guard.accept("grid.dailyEnergy", 2.5, at(2026, 7, 30, 10));
		assert.strictEqual(guard.accept("grid.dailyEnergy", 2.4, at(2026, 7, 30, 11)), null);
		assert.strictEqual(guard.accept("grid.dailyEnergy", 2.6, at(2026, 7, 30, 12)), 2.6);
	});

	it("allows the reset to 0 after local midnight", function () {
		const guard = new EnergyGuard();
		guard.accept("grid.dailyEnergy", 4.2, at(2026, 7, 30, 23, 55));
		assert.strictEqual(guard.accept("grid.dailyEnergy", 0, at(2026, 7, 31, 0, 5)), 0);
		assert.strictEqual(guard.accept("grid.dailyEnergy", 0.1, at(2026, 7, 31, 6)), 0.1);
		// The new day is guarded again.
		assert.strictEqual(guard.accept("grid.dailyEnergy", 0.05, at(2026, 7, 31, 7)), null);
	});
});

describe("EnergyGuard — monthEnergy / yearEnergy", function () {
	it("guards monthEnergy within a month and lets it reset on the 1st", function () {
		const guard = new EnergyGuard();
		guard.accept("grid.monthEnergy", 120, at(2026, 7, 30));
		assert.strictEqual(guard.accept("grid.monthEnergy", 119, at(2026, 7, 31)), null);
		assert.strictEqual(guard.accept("grid.monthEnergy", 0, at(2026, 8, 1)), 0);
	});

	it("does not reset monthEnergy on a mere day change", function () {
		const guard = new EnergyGuard();
		guard.accept("grid.monthEnergy", 120, at(2026, 7, 30));
		assert.strictEqual(guard.accept("grid.monthEnergy", 5, at(2026, 7, 31)), null);
	});

	it("guards yearEnergy within a year and lets it reset on Jan 1st", function () {
		const guard = new EnergyGuard();
		guard.accept("grid.yearEnergy", 900, at(2026, 3, 15));
		assert.strictEqual(guard.accept("grid.yearEnergy", 890, at(2026, 11, 2)), null);
		assert.strictEqual(guard.accept("grid.yearEnergy", 0, at(2027, 1, 1)), 0);
	});

	it("does not reset yearEnergy on a mere month change", function () {
		const guard = new EnergyGuard();
		guard.accept("grid.yearEnergy", 900, at(2026, 7, 30));
		assert.strictEqual(guard.accept("grid.yearEnergy", 12, at(2026, 8, 1)), null);
	});
});

describe("EnergyGuard — key handling", function () {
	it("keeps a separate memory per key", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		guard.accept("pv1.totalEnergy", 50, at(2026, 7, 30));
		// 60 is below pv0's 1000 but above pv1's 50 — must pass for pv1.
		assert.strictEqual(guard.accept("pv1.totalEnergy", 60, at(2026, 7, 30)), 60);
		assert.strictEqual(guard.accept("pv0.totalEnergy", 60, at(2026, 7, 30)), null);
	});

	it("passes unknown keys through untouched", function () {
		const guard = new EnergyGuard();
		assert.strictEqual(guard.accept("grid.power", 500, at(2026, 7, 30)), 500);
		assert.strictEqual(guard.accept("grid.power", 100, at(2026, 7, 30)), 100);
		assert.strictEqual(guard.accept("grid.totalIncome", 12.5, at(2026, 7, 30)), 12.5);
		assert.strictEqual(guard.accept("grid.totalIncome", 0, at(2026, 7, 30)), 0);
		assert.strictEqual(guard.accept("temperature", -5, at(2026, 7, 30)), -5);
	});
});

describe("EnergyGuard — invalid values", function () {
	it("drops NaN and non-finite values", function () {
		const guard = new EnergyGuard();
		assert.strictEqual(guard.accept("pv0.totalEnergy", NaN, at(2026, 7, 30)), null);
		assert.strictEqual(guard.accept("pv0.totalEnergy", Infinity, at(2026, 7, 30)), null);
		// Memory untouched — the next valid value is still a first value.
		assert.strictEqual(guard.accept("pv0.totalEnergy", 10, at(2026, 7, 30)), 10);
	});

	it("drops negative values", function () {
		const guard = new EnergyGuard();
		assert.strictEqual(guard.accept("grid.dailyEnergy", -0.1, at(2026, 7, 30)), null);
		assert.strictEqual(guard.accept("grid.dailyEnergy", 0, at(2026, 7, 30)), 0);
	});
});

describe("EnergyGuard — reset / clear", function () {
	it("reset() forgets exactly one key", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		guard.accept("pv1.totalEnergy", 1000, at(2026, 7, 30));
		guard.reset("pv0.totalEnergy");
		assert.strictEqual(guard.accept("pv0.totalEnergy", 5, at(2026, 7, 30)), 5);
		assert.strictEqual(guard.accept("pv1.totalEnergy", 5, at(2026, 7, 30)), null);
	});

	it("reset() on an unknown key does nothing", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		guard.reset("pv9.totalEnergy");
		assert.strictEqual(guard.accept("pv0.totalEnergy", 5, at(2026, 7, 30)), null);
	});

	it("clear() forgets everything", function () {
		const guard = new EnergyGuard();
		guard.accept("pv0.totalEnergy", 1000, at(2026, 7, 30));
		guard.accept("grid.dailyEnergy", 4.2, at(2026, 7, 30));
		guard.clear();
		assert.strictEqual(guard.accept("pv0.totalEnergy", 5, at(2026, 7, 30)), 5);
		assert.strictEqual(guard.accept("grid.dailyEnergy", 0.1, at(2026, 7, 30)), 0.1);
	});
});
