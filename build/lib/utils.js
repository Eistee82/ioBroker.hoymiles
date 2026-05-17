import * as crypto from "node:crypto";
export function unixSeconds() {
    return Math.floor(Date.now() / 1000);
}
export function anonymize(value, prefix = "id") {
    if (!value) {
        return `${prefix}:none`;
    }
    const hash = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
    return `${prefix}:${hash}`;
}
const LOG_REDACT_KEYS = new Set([
    "address",
    "name",
    "station_name",
    "plant_name",
    "nickname",
    "nick_name",
    "owner_name",
    "token",
    "ak",
    "access_key",
    "password",
    "pwd",
    "ch",
    "mobile",
    "phone",
    "tel",
]);
const LOG_ANON_KEYS = new Set(["sn", "dtu_sn", "dtusn", "serial", "serial_number", "user", "username", "email"]);
const LOG_GEO_KEYS = new Set(["latitude", "longitude", "lat", "lon", "lng"]);
export function sanitizeForLog(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeForLog);
    }
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, v] of Object.entries(value)) {
            const lk = key.toLowerCase();
            if (LOG_ANON_KEYS.has(lk)) {
                out[key] = typeof v === "string" && v ? anonymize(v, "id") : v;
            }
            else if (LOG_REDACT_KEYS.has(lk)) {
                out[key] = v ? "<redacted>" : v;
            }
            else if (LOG_GEO_KEYS.has(lk)) {
                const n = typeof v === "number" ? v : parseFloat(String(v));
                out[key] = !Number.isNaN(n) && n === 0 ? v : v ? "<geo>" : v;
            }
            else {
                out[key] = sanitizeForLog(v);
            }
        }
        return out;
    }
    return value;
}
function parseWallClockAsUtc(str) {
    return Date.parse(`${str.trim().replace(" ", "T")}Z`);
}
export function deriveStationTzOffsetMs(localTime) {
    if (!localTime) {
        return null;
    }
    const asUtc = parseWallClockAsUtc(localTime);
    if (Number.isNaN(asUtc)) {
        return null;
    }
    const offsetMs = Math.round((asUtc - Date.now()) / 900000) * 900000;
    return offsetMs === 0 ? 0 : offsetMs;
}
export function stationWallClockToEpoch(wallClock, offsetMs) {
    if (!wallClock) {
        return null;
    }
    const asUtc = parseWallClockAsUtc(wallClock);
    return Number.isNaN(asUtc) ? null : asUtc - offsetMs;
}
export function errorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    return String(err);
}
export async function logOnError(fn, log, label) {
    try {
        await fn();
    }
    catch (err) {
        log(`${label}: ${errorMessage(err)}`);
    }
}
export async function mapLimit(items, limit, fn) {
    const results = [];
    let index = 0;
    async function next() {
        const i = index++;
        if (i >= items.length) {
            return;
        }
        results[i] = await fn(items[i]);
        await next();
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
    return results;
}
export function clearTimer(handle) {
    if (handle != null) {
        clearTimeout(handle);
    }
    return null;
}
export async function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    }
    finally {
        globalThis.clearTimeout(timer);
    }
}
export function buildCredentialChallenges(input) {
    const md5Hex = crypto.createHash("md5").update(input).digest("hex");
    const sha256B64 = crypto.createHash("sha256").update(input).digest("base64");
    const sha256Hex = crypto.createHash("sha256").update(input).digest("hex");
    return [`${md5Hex}.${sha256B64}`, sha256Hex];
}
export async function buildArgon2Challenge(input, salt) {
    const argon2 = await import("argon2");
    const hash = await argon2.hash(input, {
        type: argon2.argon2id,
        salt: Buffer.from(salt, "hex"),
        timeCost: 3,
        memoryCost: 32768,
        parallelism: 1,
        hashLength: 32,
        raw: true,
        version: 0x13,
    });
    return hash.toString("hex");
}
export function safeJsonStringify(data, maxLength = 65536) {
    const json = JSON.stringify(data);
    if (json.length > maxLength && Array.isArray(data)) {
        return JSON.stringify({ truncated: true, count: data.length, data: data.slice(-500) });
    }
    return json.length > maxLength ? json.substring(0, maxLength) : json;
}
//# sourceMappingURL=utils.js.map