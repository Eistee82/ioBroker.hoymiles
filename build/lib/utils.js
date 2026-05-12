import * as crypto from "node:crypto";
export function unixSeconds() {
    return Math.floor(Date.now() / 1000);
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