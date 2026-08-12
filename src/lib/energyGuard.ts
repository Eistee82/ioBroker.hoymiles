/**
 * Monotonicity guard for cumulative energy counters.
 *
 * The DTU occasionally reports a counter that is a few Wh *below* the previously reported
 * one — most reliably right after a device restart, when the inverter re-reads its last
 * persisted value. Written through unfiltered, that produces a downward step in every
 * ioBroker history/statistics consumer.
 *
 * This guard keeps the last accepted value per state id and drops any report that would
 * move a counter backwards inside its period:
 *
 * - `*.totalEnergy` — never resets, must never decrease.
 * - `*.dailyEnergy` — monotonic within one local calendar day, resets at local midnight.
 * - `*.monthEnergy` — monotonic within one local calendar month.
 * - `*.yearEnergy` — monotonic within one local calendar year.
 *
 * Anything else is passed through untouched: the guard must not interfere with states it
 * is not responsible for.
 *
 * Deliberately free of ioBroker and logging dependencies so it stays unit-testable on its own.
 */

/** The period a counter is monotonic within. */
type GuardPeriod = "total" | "day" | "month" | "year";

/** State id suffix → the period the counter belongs to. */
const PERIOD_BY_SUFFIX: ReadonlyArray<readonly [string, GuardPeriod]> = [
	["totalEnergy", "total"],
	["dailyEnergy", "day"],
	["monthEnergy", "month"],
	["yearEnergy", "year"],
];

/** What the guard remembers per state id. */
interface CounterMemory {
	/** Period stamp the remembered value belongs to (always 0 for `total`). */
	stamp: number;
	/** Last accepted value. */
	value: number;
}

/**
 * Determine which period a state id is guarded in.
 *
 * @param key - State id relative to the device, e.g. "pv0.totalEnergy".
 * @returns The period, or null when the key is not a guarded counter.
 */
function periodOf(key: string): GuardPeriod | null {
	for (const [suffix, period] of PERIOD_BY_SUFFIX) {
		if (key.endsWith(suffix)) {
			return period;
		}
	}
	return null;
}

/**
 * Build the period stamp for a point in time. Two values belong to the same period
 * exactly when their stamps are equal. Local time — the DTU's day boundary is the
 * user's midnight, not UTC midnight.
 *
 * @param period - The period to stamp.
 * @param nowMs - Current time in milliseconds since the epoch.
 * @returns A comparable stamp; 0 for `total`, which has no period boundary.
 */
function stampOf(period: GuardPeriod, nowMs: number): number {
	if (period === "total") {
		return 0;
	}
	const d = new Date(nowMs);
	const year = d.getFullYear();
	if (period === "year") {
		return year;
	}
	const month = d.getMonth() + 1;
	if (period === "month") {
		return year * 100 + month;
	}
	return year * 10000 + month * 100 + d.getDate();
}

/** Remembers the last accepted value of every cumulative counter and rejects backward steps. */
export class EnergyGuard {
	private readonly memory = new Map<string, CounterMemory>();

	/**
	 * Check a reported counter value against what was last accepted for that state.
	 *
	 * @param key - State id relative to the device, e.g. "pv0.totalEnergy" or "grid.dailyEnergy".
	 * @param value - The value the device just reported.
	 * @param nowMs - Current time in milliseconds since the epoch (local time is derived from it).
	 * @returns The value to write, or null when it must not be written.
	 */
	accept(key: string, value: number, nowMs: number): number | null {
		const period = periodOf(key);
		if (period === null) {
			// Not a cumulative counter — hands off.
			return value;
		}
		if (!Number.isFinite(value) || value < 0) {
			return null;
		}

		const stamp = stampOf(period, nowMs);
		const last = this.memory.get(key);
		// A new period starts the counter over, so a smaller value is expected there.
		if (last !== undefined && last.stamp === stamp && value < last.value) {
			return null;
		}

		this.memory.set(key, { stamp, value });
		return value;
	}

	/**
	 * Forget the memory for one key.
	 *
	 * @param key - State id relative to the device.
	 */
	reset(key: string): void {
		this.memory.delete(key);
	}

	/** Forget everything — used when the device disconnects. */
	clear(): void {
		this.memory.clear();
	}
}

export default EnergyGuard;
