import * as crypto from "node:crypto";

/**
 * Current time as Unix timestamp in seconds.
 */
export function unixSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * Anonymize an identifier (DTU/inverter serial, account e-mail) for debug logs that
 * may be shared in a public forum bug report. Returns a short, STABLE token — the same
 * input always yields the same token so log lines stay correlatable, but the original
 * value cannot be recovered. Empty input yields `<prefix>:none`.
 *
 * @param value - Identifier to mask.
 * @param prefix - Short tag for the token (e.g. "sn", "acct").
 */
export function anonymize(value: string | undefined | null, prefix = "id"): string {
	if (!value) {
		return `${prefix}:none`;
	}
	const hash = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
	return `${prefix}:${hash}`;
}

/** Response keys whose values are personal or secret — redacted from shareable logs. */
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
/** Response keys holding device/account identifiers — replaced with a stable anonymized token. */
const LOG_ANON_KEYS = new Set(["sn", "dtu_sn", "dtusn", "serial", "serial_number", "user", "username", "email"]);
/** Response keys holding geo coordinates — real values hidden, 0/placeholder kept (diagnostic). */
const LOG_GEO_KEYS = new Set(["latitude", "longitude", "lat", "lon", "lng"]);

/**
 * Deep-copy an API payload with personal and secret values removed, so a cloud response
 * can be written to a debug log that is safe to share in a public forum bug report.
 * Serials become stable anonymized tokens (still correlatable across lines); coordinates,
 * address, names and tokens are redacted; everything else (status, timestamps, warn_data
 * flags, version strings, …) is kept verbatim so the response stays diagnosable.
 *
 * @param value - Arbitrary parsed-JSON value.
 */
export function sanitizeForLog(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeForLog);
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			const lk = key.toLowerCase();
			if (LOG_ANON_KEYS.has(lk)) {
				out[key] = typeof v === "string" && v ? anonymize(v, "id") : v;
			} else if (LOG_REDACT_KEYS.has(lk)) {
				out[key] = v ? "<redacted>" : v;
			} else if (LOG_GEO_KEYS.has(lk)) {
				const n = typeof v === "number" ? v : parseFloat(String(v));
				out[key] = !Number.isNaN(n) && n === 0 ? v : v ? "<geo>" : v;
			} else {
				out[key] = sanitizeForLog(v);
			}
		}
		return out;
	}
	return value;
}

/**
 * Parse a Hoymiles cloud wall-clock string ("YYYY-MM-DD HH:mm:ss", no zone) as if
 * it were UTC. Returns the epoch in ms, or NaN when the string is unparseable.
 *
 * @param str - Wall-clock string from the cloud API.
 */
function parseWallClockAsUtc(str: string): number {
	return Date.parse(`${str.trim().replace(" ", "T")}Z`);
}

/**
 * Derive a station's UTC offset (ms) by comparing the server-reported wall-clock
 * `local_time` against the host's real UTC clock. Rounded to 15-minute steps so
 * request latency / minor clock skew don't perturb it, while still resolving every
 * real-world zone (including the :30 and :45 offsets).
 *
 * The Hoymiles cloud delivers `data_time` / `last_data_time` / `create_at` in the
 * station's local zone but exposes no machine-readable UTC offset — `local_time`
 * from `station/find` is the only reliable anchor.
 *
 * @param localTime - Station wall-clock string ("YYYY-MM-DD HH:mm:ss").
 * @returns Offset in ms (local = UTC + offset), or null if `localTime` is unusable.
 */
export function deriveStationTzOffsetMs(localTime: string | undefined | null): number | null {
	if (!localTime) {
		return null;
	}
	const asUtc = parseWallClockAsUtc(localTime);
	if (Number.isNaN(asUtc)) {
		return null;
	}
	const offsetMs = Math.round((asUtc - Date.now()) / 900000) * 900000;
	return offsetMs === 0 ? 0 : offsetMs; // normalize -0 (host clock a few ms ahead of a UTC station)
}

/**
 * Convert a station-local wall-clock string to a UTC epoch (ms) by subtracting the
 * station's UTC offset. Use for `data_time` / `last_data_time` / `create_at`, which
 * the Hoymiles cloud returns in the station's local zone (not UTC).
 *
 * @param wallClock - Wall-clock string ("YYYY-MM-DD HH:mm:ss"), or empty/nullish.
 * @param offsetMs - Station UTC offset from `deriveStationTzOffsetMs`.
 * @returns UTC epoch in ms, or null when `wallClock` is empty/unparseable.
 */
export function stationWallClockToEpoch(wallClock: string | undefined | null, offsetMs: number): number | null {
	if (!wallClock) {
		return null;
	}
	const asUtc = parseWallClockAsUtc(wallClock);
	return Number.isNaN(asUtc) ? null : asUtc - offsetMs;
}

/**
 * Safely extract an error message from an unknown catch value.
 *
 * @param err - The caught value (may not be an Error instance)
 */
export function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	if (typeof err === "string") {
		return err;
	}
	return String(err);
}

/**
 * Run an async function, catching errors and logging them instead of throwing.
 *
 * @param fn - Async function to execute
 * @param log - Logging function for error output
 * @param label - Context label for the error message
 */
export async function logOnError(fn: () => Promise<void>, log: (msg: string) => void, label: string): Promise<void> {
	try {
		await fn();
	} catch (err) {
		log(`${label}: ${errorMessage(err)}`);
	}
}

/**
 * Run an async function over items with bounded concurrency.
 * If any callback rejects, the remaining workers are aborted and the error propagates.
 * Callers that need per-item error tolerance should catch inside `fn`.
 *
 * @param items - Array of items to process
 * @param limit - Maximum concurrent workers
 * @param fn - Async function to apply to each item
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let index = 0;
	async function next(): Promise<void> {
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

/**
 * Safely clear a native timer (setTimeout or setInterval) and return null.
 * Usage: `this.timer = clearTimer(this.timer);`
 *
 * @param handle - Timer handle to clear
 */
export function clearTimer(handle: ReturnType<typeof setTimeout> | null | undefined): null {
	if (handle != null) {
		clearTimeout(handle);
	}
	return null;
}

/**
 * Race a promise against a timeout. Rejects with an Error if the timeout fires first.
 *
 * @param promise - Promise to race against timeout
 * @param ms - Timeout duration in milliseconds
 * @param label - Context label for timeout error
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof globalThis.setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = globalThis.setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		globalThis.clearTimeout(timer!);
	}
}

/**
 * Compute the MD5 and SHA-256 credential challenges required by the
 * Hoymiles cloud authentication API.  Returns two challenge strings
 * that are tried in order during login.
 *
 * This is a protocol-mandated transform (not password storage), so fast
 * hashes are acceptable here.
 *
 * @param input - Raw credential input
 * @returns Array of credential challenge strings
 */
export function buildCredentialChallenges(input: Buffer): string[] {
	const md5Hex = crypto.createHash("md5").update(input).digest("hex");
	const sha256B64 = crypto.createHash("sha256").update(input).digest("base64");
	const sha256Hex = crypto.createHash("sha256").update(input).digest("hex");
	return [`${md5Hex}.${sha256B64}`, sha256Hex];
}

/**
 * Compute an Argon2id credential challenge for the Hoymiles cloud API.
 * Used when the pre-inspect response includes a salt value.
 *
 * Parameters match the S-Miles Home app (com.hm.balcony) exactly — see
 * Argon2IDUtil.kt: ARGON2_ID, V13, t=3, m=32 MiB, p=1, hashLen=32, salt as
 * hex-decoded bytes, password as UTF-8 bytes. Diverging from any of these
 * yields a different hash and the server rejects the login.
 *
 * @param input - Raw credential input
 * @param salt - Salt from the pre-inspect response (hex string)
 * @returns Argon2id hash as hex string
 */
export async function buildArgon2Challenge(input: Buffer, salt: string): Promise<string> {
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

/**
 * JSON.stringify with a size safety net.  Large arrays are truncated to avoid
 * unbounded state values.
 *
 * @param data - Data to serialize
 * @param maxLength - Maximum output length in characters
 */
export function safeJsonStringify(data: unknown, maxLength = 65536): string {
	const json = JSON.stringify(data);
	if (json.length > maxLength && Array.isArray(data)) {
		return JSON.stringify({ truncated: true, count: data.length, data: data.slice(-500) });
	}
	return json.length > maxLength ? json.substring(0, maxLength) : json;
}
