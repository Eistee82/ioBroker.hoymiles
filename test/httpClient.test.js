import assert from "node:assert";
import * as https from "node:https";
import { postJson, postBinary, destroyAgent, initAgent, HttpError } from "../build/lib/httpClient.js";

// Allow self-signed certificates for mock server tests
const _originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// ============================================================
// Helper: create self-signed cert via openssl CLI
// ============================================================
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function generateCert() {
	const tmp = mkdtempSync(join(tmpdir(), "httptest-"));
	const keyFile = join(tmp, "key.pem");
	const certFile = join(tmp, "cert.pem");
	try {
		execSync(
			`openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 1 -nodes -subj "/CN=localhost"`,
			{ stdio: "pipe" },
		);
		const key = readFileSync(keyFile, "utf8");
		const cert = readFileSync(certFile, "utf8");
		return { key, cert };
	} finally {
		try {
			rmSync(tmp, { recursive: true });
		} catch {
			/* ignore */
		}
	}
}

// ============================================================
// httpClient
// ============================================================
describe("httpClient", function () {
	// ----------------------------------------------------------
	// destroyAgent
	// ----------------------------------------------------------
	describe("destroyAgent", function () {
		it("does not throw when called", function () {
			assert.doesNotThrow(() => destroyAgent());
		});

		it("can be called multiple times without error", function () {
			assert.doesNotThrow(() => {
				destroyAgent();
				destroyAgent();
			});
		});
	});

	// ----------------------------------------------------------
	// initAgent
	// ----------------------------------------------------------
	describe("initAgent", function () {
		it("does not throw when called without arguments", function () {
			assert.doesNotThrow(() => initAgent());
		});

		it("accepts options with maxSockets", function () {
			assert.doesNotThrow(() => initAgent({ maxSockets: 10 }));
		});

		it("can be called multiple times to re-initialize", function () {
			assert.doesNotThrow(() => {
				initAgent();
				initAgent({ maxSockets: 3 });
				initAgent();
			});
		});

		afterEach(function () {
			// Reset agent to default state after each test
			initAgent();
		});
	});

	// ----------------------------------------------------------
	// postJson (basic error cases)
	// ----------------------------------------------------------
	describe("postJson", function () {
		it("rejects with invalid URL", async function () {
			await assert.rejects(
				() => postJson("not-a-url", {}),
				err => err instanceof Error,
			);
		});

		it("rejects on unreachable host", async function () {
			this.timeout(60000);
			await assert.rejects(
				() => postJson("https://192.0.2.1/test", {}),
				err => err instanceof Error,
			);
		});
	});

	// ----------------------------------------------------------
	// postBinary (basic error cases)
	// ----------------------------------------------------------
	describe("postBinary", function () {
		it("rejects with invalid URL", async function () {
			await assert.rejects(
				() => postBinary("not-a-url", {}),
				err => err instanceof Error,
			);
		});
	});

	// ----------------------------------------------------------
	// Mock HTTPS server tests
	// ----------------------------------------------------------
	describe("with mock HTTPS server", function () {
		let server;
		let serverAvailable = false;
		let baseUrl;

		before(function (done) {
			this.timeout(10000);

			let creds;
			try {
				creds = generateCert();
			} catch {
				// openssl not available — skip all mock-server tests
				this.skip();
				return;
			}

			server = https.createServer(creds, (req, res) => {
				const chunks = [];
				req.on("data", chunk => chunks.push(chunk));
				req.on("end", () => {
					const body = Buffer.concat(chunks).toString();
					const url = req.url;

					// Route: JSON echo
					if (url === "/echo-json") {
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ echo: true, received: JSON.parse(body) }));
						return;
					}

					// Route: Binary response
					if (url === "/binary") {
						const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]);
						res.writeHead(200, { "Content-Type": "application/octet-stream" });
						res.end(buf);
						return;
					}

					// Route: HTTP 400 error
					if (url === "/error400") {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Bad Request" }));
						return;
					}

					// Route: HTTP 500 error
					if (url === "/error500") {
						res.writeHead(500, { "Content-Type": "text/plain" });
						res.end("Internal Server Error");
						return;
					}

					// Route: Slow response (for timeout testing)
					if (url === "/slow") {
						// Never respond — let the client timeout
						// Do not call res.end()
						return;
					}

					// Route: Authorization check
					if (url === "/auth-check") {
						const authHeader = req.headers.authorization;
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ authorization: authHeader || null }));
						return;
					}

					// Default: 404
					res.writeHead(404, { "Content-Type": "text/plain" });
					res.end("Not Found");
				});
			});

			// Use ephemeral port to avoid permission issues on CI
			server.listen(0, "127.0.0.1", () => {
				serverAvailable = true;
				const port = server.address().port;
				baseUrl = `https://127.0.0.1:${port}`;
				// Re-init agent so new connections use fresh state
				initAgent();
				done();
			});

			server.on("error", err => {
				done(err);
			});
		});

		after(function (done) {
			if (server && serverAvailable) {
				destroyAgent();
				server.close(() => done());
			} else {
				done();
			}
		});

		beforeEach(function () {
			if (!serverAvailable) {
				this.skip();
			}
		});

		// --- postJson with JSON response ---
		describe("postJson with mock server", function () {
			it("returns parsed JSON from server", async function () {
				this.timeout(10000);
				const payload = { hello: "world", num: 42 };
				const result = await postJson(`${baseUrl}/echo-json`, payload);
				assert.strictEqual(result.echo, true);
				assert.deepStrictEqual(result.received, payload);
			});

			it("sends and receives nested objects", async function () {
				this.timeout(10000);
				const payload = { nested: { deep: { value: [1, 2, 3] } } };
				const result = await postJson(`${baseUrl}/echo-json`, payload);
				assert.deepStrictEqual(result.received, payload);
			});
		});

		// --- postBinary with binary response ---
		describe("postBinary with mock server", function () {
			it("returns Buffer from server", async function () {
				this.timeout(10000);
				const result = await postBinary(`${baseUrl}/binary`, {});
				assert.ok(Buffer.isBuffer(result), "result should be a Buffer");
				const expected = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]);
				assert.ok(result.equals(expected), "binary content should match");
			});
		});

		// --- HTTP 4xx error handling ---
		describe("HTTP error handling", function () {
			it("rejects with Error on HTTP 400", async function () {
				this.timeout(10000);
				await assert.rejects(
					() => postJson(`${baseUrl}/error400`, {}),
					err => {
						assert.ok(err instanceof Error);
						assert.ok(err.message.includes("400"), "error message should contain status code 400");
						return true;
					},
				);
			});

			it("rejects with Error on HTTP 500", async function () {
				this.timeout(10000);
				await assert.rejects(
					() => postJson(`${baseUrl}/error500`, {}),
					err => {
						assert.ok(err instanceof Error);
						assert.ok(err.message.includes("500"), "error message should contain status code 500");
						return true;
					},
				);
			});

			it("rejects with an HttpError carrying the numeric statusCode", async function () {
				this.timeout(10000);
				await assert.rejects(
					() => postJson(`${baseUrl}/error400`, {}),
					err => {
						assert.ok(err instanceof HttpError, "should be an HttpError");
						assert.ok(err instanceof Error, "HttpError must still be an Error");
						assert.strictEqual(err.statusCode, 400, "statusCode should expose the HTTP status");
						return true;
					},
				);
			});

			it("HttpError on HTTP 500 exposes statusCode 500", async function () {
				this.timeout(10000);
				await assert.rejects(
					() => postJson(`${baseUrl}/error500`, {}),
					err => {
						assert.ok(err instanceof HttpError);
						assert.strictEqual(err.statusCode, 500);
						return true;
					},
				);
			});

			it("rejects postBinary on HTTP 400", async function () {
				this.timeout(10000);
				await assert.rejects(
					() => postBinary(`${baseUrl}/error400`, {}),
					err => {
						assert.ok(err instanceof Error);
						assert.ok(err.message.includes("400"));
						return true;
					},
				);
			});
		});

		// --- Timeout behavior ---
		describe("timeout handling", function () {
			it("rejects with timeout error when server does not respond", async function () {
				// httpClient uses HTTP_REQUEST_TIMEOUT_MS (15000ms)
				// We set a slightly longer mocha timeout
				this.timeout(25000);
				await assert.rejects(
					() => postJson(`${baseUrl}/slow`, {}),
					err => {
						assert.ok(err instanceof Error);
						assert.ok(
							err.message.toLowerCase().includes("timeout") ||
								err.message.includes("ECONNRESET") ||
								err.message.includes("socket hang up"),
							`expected timeout-related error, got: ${err.message}`,
						);
						return true;
					},
				);
			});
		});

		// --- Authorization header ---
		describe("Authorization header", function () {
			it("sends Authorization header when token is provided", async function () {
				this.timeout(10000);
				const token = "Bearer test-token-abc123";
				const result = await postJson(`${baseUrl}/auth-check`, {}, { token });
				assert.strictEqual(result.authorization, token);
			});

			it("does not send Authorization header when no token", async function () {
				this.timeout(10000);
				const result = await postJson(`${baseUrl}/auth-check`, {});
				assert.strictEqual(result.authorization, null);
			});

			it("sends Authorization header with postBinary", async function () {
				this.timeout(10000);
				// Use echo-json route since it returns JSON, but call it via
				// auth-check which returns the auth header. postBinary returns
				// a Buffer, so we parse it manually.
				const token = "Bearer binary-token-xyz";
				const result = await postBinary(`${baseUrl}/auth-check`, {}, { token });
				assert.ok(Buffer.isBuffer(result));
				const parsed = JSON.parse(result.toString());
				assert.strictEqual(parsed.authorization, token);
			});
		});
	});
});
