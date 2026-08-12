const PERIOD_BY_SUFFIX = [
    ["totalEnergy", "total"],
    ["dailyEnergy", "day"],
    ["monthEnergy", "month"],
    ["yearEnergy", "year"],
];
function periodOf(key) {
    for (const [suffix, period] of PERIOD_BY_SUFFIX) {
        if (key.endsWith(suffix)) {
            return period;
        }
    }
    return null;
}
function stampOf(period, nowMs) {
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
export class EnergyGuard {
    memory = new Map();
    accept(key, value, nowMs) {
        const period = periodOf(key);
        if (period === null) {
            return value;
        }
        if (!Number.isFinite(value) || value < 0) {
            return null;
        }
        const stamp = stampOf(period, nowMs);
        const last = this.memory.get(key);
        if (last !== undefined && last.stamp === stamp && value < last.value) {
            return null;
        }
        this.memory.set(key, { stamp, value });
        return value;
    }
    reset(key) {
        this.memory.delete(key);
    }
    clear() {
        this.memory.clear();
    }
}
export default EnergyGuard;
//# sourceMappingURL=energyGuard.js.map