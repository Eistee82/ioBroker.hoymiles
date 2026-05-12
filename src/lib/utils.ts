import * as crypto from "node:crypto";

/**
 * Current time as Unix timestamp in seconds.
 */
export function unixSeconds(): number {
	return Math.floor(Date.now() / 1000);
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
