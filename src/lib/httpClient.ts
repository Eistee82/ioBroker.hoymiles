import * as https from "node:https";
import { HTTP_REQUEST_TIMEOUT_MS, HTTP_AGENT_TIMEOUT_MS } from "./constants.js";

const REQUEST_TIMEOUT = HTTP_REQUEST_TIMEOUT_MS;
let agent = new https.Agent({ keepAlive: true, maxSockets: 5, timeout: HTTP_AGENT_TIMEOUT_MS });

/**
 * Re-initialize the shared HTTPS agent with custom options.
 * Call before any HTTP requests are made (e.g. during adapter onReady).
 *
 * @param options - Agent configuration overrides
 * @param options.maxSockets - Maximum concurrent sockets
 */
function initAgent(options?: { maxSockets?: number }): void {
	agent.destroy();
	agent = new https.Agent({
		keepAlive: true,
		maxSockets: options?.maxSockets ?? 5,
		timeout: HTTP_AGENT_TIMEOUT_MS,
	});
}

interface HttpPostOptions {
	token?: string | null;
	/** Optional User-Agent header. Hoymiles v3 / `_c` endpoints require an app-style UA (`sma/ad/<ver>/<tid>/<dc>`) to accept requests. */
	userAgent?: string;
}

/**
 * POST JSON to an HTTPS endpoint and return the parsed JSON response.
 *
 * @param url - Full URL to POST to
 * @param body - JSON request body
 * @param options - Optional token / user agent
 */
function postJson<T>(url: string, body: Record<string, unknown>, options?: HttpPostOptions): Promise<T> {
	return request(url, body, options, "json") as Promise<T>;
}

/**
 * POST JSON to an HTTPS endpoint and return the raw binary response.
 *
 * @param url - Full URL to POST to
 * @param body - JSON request body
 * @param options - Optional token / user agent
 */
function postBinary(url: string, body: Record<string, unknown>, options?: HttpPostOptions): Promise<Buffer> {
	return request(url, body, options, "binary") as Promise<Buffer>;
}

function request(
	url: string,
	body: Record<string, unknown>,
	options: HttpPostOptions | undefined,
	responseType: "json" | "binary",
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const ok = (val: unknown): void => {
			if (!settled) {
				settled = true;
				resolve(val);
			}
		};
		const fail = (err: Error): void => {
			if (!settled) {
				settled = true;
				reject(err);
			}
		};

		const data = JSON.stringify(body);
		const parsed = new URL(url);

		const headers: Record<string, string | number> = {
			"Content-Type": "application/json",
			"Content-Length": Buffer.byteLength(data),
		};
		if (options?.token) {
			headers.Authorization = options.token;
		}
		if (options?.userAgent) {
			headers["User-Agent"] = options.userAgent;
		}

		const reqOptions: https.RequestOptions = {
			hostname: parsed.hostname,
			port: parsed.port || 443,
			path: parsed.pathname,
			method: "POST",
			agent,
			headers,
		};

		const req = https.request(reqOptions, res => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				if (res.statusCode && res.statusCode >= 400) {
					fail(new Error(`HTTP ${res.statusCode} on ${url}`));
					return;
				}
				const buf = Buffer.concat(chunks);
				if (responseType === "binary") {
					ok(buf);
				} else {
					try {
						ok(JSON.parse(buf.toString()));
					} catch {
						fail(
							new Error(
								`Invalid JSON (HTTP ${res.statusCode}) from ${url}: ${buf.toString().substring(0, 200)}`,
							),
						);
					}
				}
			});
		});

		req.on("error", (err: Error) => fail(err));
		req.setTimeout(REQUEST_TIMEOUT, () => {
			req.destroy();
			fail(new Error(`Timeout on ${url}`));
		});
		req.write(data);
		req.end();
	});
}

/** Destroy the shared HTTPS agent (call on adapter shutdown). */
function destroyAgent(): void {
	agent.destroy();
}

export { postJson, postBinary, destroyAgent, initAgent };
