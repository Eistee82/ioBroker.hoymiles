import assert from "node:assert";
import * as https from "node:https";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import CloudConnection, { CloudAuthError } from "../build/lib/cloudConnection.js";
import { HttpError, initAgent } from "../build/lib/httpClient.js";

function generateCert() {
	const tmp = mkdtempSync(join(tmpdir(), "cloudconn-test-"));
	const keyFile = join(tmp, "key.pem");
	const certFile = join(tmp, "cert.pem");
	try {
		// SAN covers the 127.0.0.1 the mock server binds to, so the client can validate the cert
		// properly (as a trusted CA) instead of the test disabling certificate validation globally.
		execSync(
			`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "${keyFile}" -out "${certFile}" -days 1 -nodes ` +
				`-subj "/CN=localhost" -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"`,
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
// cloudConnection – constructor and input validation
// ============================================================
describe("cloudConnection – constructor", function () {
	it("stores user credential", function () {
		const cloud = new CloudConnection("user@example.com", "secret");
		assert.strictEqual(cloud.user, "user@example.com");
	});

	it("accepts optional log callback", function () {
		const msgs = [];
		const cloud = new CloudConnection("u", "p", m => msgs.push(m));
		assert.strictEqual(typeof cloud.log, "function");
	});

	it("starts without a token", function () {
		const cloud = new CloudConnection("u", "p");
		assert.strictEqual(cloud.token, null);
	});

	it("disconnect clears the token", function () {
		const cloud = new CloudConnection("u", "p");
		cloud.disconnect();
		assert.strictEqual(cloud.token, null);
	});
});

// ============================================================
// cloudConnection – token state
// ============================================================
describe("cloudConnection – token state", function () {
	it("hasToken is false initially", function () {
		const cloud = new CloudConnection("u", "p");
		assert.ok(!cloud.token, "token should be falsy initially");
	});
});

// ============================================================
// cloudConnection – input validation (before network calls)
// ============================================================
describe("cloudConnection – getStationDetails validation", function () {
	it("throws 'Invalid stationId' for 0", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.getStationDetails(0), {
			message: "Invalid stationId",
		});
	});

	it("throws 'Invalid stationId' for -1", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.getStationDetails(-1), {
			message: "Invalid stationId",
		});
	});
});

describe("cloudConnection – getDeviceTree validation", function () {
	it("throws 'Invalid stationId' for 0", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.getDeviceTree(0), {
			message: "Invalid stationId",
		});
	});
});

describe("cloudConnection – getStationExtInfo", function () {
	it("throws 'Invalid stationId' for 0", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.getStationExtInfo(0), {
			message: "Invalid stationId",
		});
	});

	it("returns null when no ak is cached for the station (no network call)", async function () {
		const cloud = new CloudConnection("u", "p");
		// Token set so ensureToken doesn't fire a login; map is empty so we never hit the network.
		cloud.token = "fake-token";
		cloud.tokenTime = Date.now();
		const result = await cloud.getStationExtInfo(12345);
		assert.strictEqual(result, null);
	});
});

describe("cloudConnection – stationDcMap / stationAkMap", function () {
	it("getStationAk returns undefined when nothing cached", function () {
		const cloud = new CloudConnection("u", "p");
		assert.strictEqual(cloud.getStationAk(99), undefined);
	});

	it("disconnect clears stationDcMap and stationAkMap", function () {
		const cloud = new CloudConnection("u", "p");
		cloud.stationDcMap.set(1, 1);
		cloud.stationAkMap.set(1, "AK-1");
		cloud.disconnect();
		assert.strictEqual(cloud.stationDcMap.size, 0);
		assert.strictEqual(cloud.stationAkMap.size, 0);
		assert.strictEqual(cloud.getStationAk(1), undefined);
	});
});

describe("cloudConnection – getMicroPortRules", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	// The dictionary is what the S-Miles app itself uses to size an inverter's PV strings:
	// serial-number prefix → rule.port. Verified live 2026-07-22 against the real endpoint,
	// which answers on /dict/pub/ without a token (91 rules, ports 1/2/4/6/8/12).
	const DICT = [
		{ id: 1, val: "1412", dis_name: "1412", rule: { port: 2, series: 3, version: 3 } },
		{ id: 2, val: "1610", dis_name: "1610", rule: { port: 2, series: 10, version: 3 } },
		{ id: 3, val: "1620", dis_name: "1620", rule: { port: 4, series: 10, version: 3 } },
		{ id: 4, val: "A01", dis_name: "A01", rule: { port: 4, series: 7, version: 3 } },
	];

	it("maps serial prefixes to their port count", async function () {
		CloudConnection.prototype._post = async function (apiPath, _body, hostOverride) {
			assert.strictEqual(apiPath, "/dict/pub/0/dictionary/select_micro_rule");
			// Global vendor data — must not follow the account's regional host.
			assert.strictEqual(hostOverride, "https://neapi.hoymiles.com");
			return { status: "0", data: DICT };
		};
		const cloud = new CloudConnection("u", "p");
		const rules = await cloud.getMicroPortRules();
		assert.strictEqual(rules.get("1620"), 4);
		assert.strictEqual(rules.get("1610"), 2);
		assert.strictEqual(rules.get("A01"), 4);
	});

	it("fetches the dictionary only once and serves later calls from cache", async function () {
		let calls = 0;
		CloudConnection.prototype._post = async function () {
			calls++;
			return { status: "0", data: DICT };
		};
		const cloud = new CloudConnection("u", "p");
		await cloud.getMicroPortRules();
		await cloud.getMicroPortRules();
		assert.strictEqual(calls, 1, "the dictionary must be fetched once per session");
	});

	it("returns an empty map instead of throwing when the endpoint fails", async function () {
		CloudConnection.prototype._post = async function () {
			throw new Error("network down");
		};
		const cloud = new CloudConnection("u", "p");
		const rules = await cloud.getMicroPortRules();
		assert.strictEqual(rules.size, 0);
	});

	it("skips malformed entries rather than poisoning the map", async function () {
		CloudConnection.prototype._post = async function () {
			return {
				status: "0",
				data: [
					{ val: "1620", rule: { port: 4 } },
					{ val: "", rule: { port: 2 } },
					{ val: "1234" }, // no rule
					{ val: "5678", rule: { port: 0 } }, // non-positive
					"garbage",
				],
			};
		};
		const cloud = new CloudConnection("u", "p");
		const rules = await cloud.getMicroPortRules();
		assert.deepStrictEqual([...rules.entries()], [["1620", 4]]);
	});
});

describe("cloudConnection – checkFirmwareUpdate validation", function () {
	it("throws 'Invalid stationId' for 0", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.checkFirmwareUpdate(0, "SN123"), {
			message: "Invalid stationId",
		});
	});

	it("throws 'Invalid dtuSn' for empty string", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.checkFirmwareUpdate(1, ""), {
			message: "Invalid dtuSn",
		});
	});
});

// ============================================================
// cloudConnection – disconnect idempotency
// ============================================================
describe("cloudConnection – disconnect", function () {
	it("disconnect is idempotent (can be called twice)", function () {
		const cloud = new CloudConnection("u", "p");
		cloud.disconnect();
		cloud.disconnect();
		assert.strictEqual(cloud.token, null);
	});
});

// ============================================================
// cloudConnection – log callback
// ============================================================
describe("cloudConnection – log callback", function () {
	it("log callback receives messages", function () {
		const msgs = [];
		const cloud = new CloudConnection("u", "p", m => msgs.push(m));
		cloud.log("test message");
		assert.strictEqual(msgs.length, 1);
		assert.strictEqual(msgs[0], "test message");
	});

	it("default log callback is a no-op function", function () {
		const cloud = new CloudConnection("u", "p");
		assert.doesNotThrow(() => cloud.log("should not throw"));
	});
});

// ============================================================
// cloudConnection – ensureToken without login
// ============================================================
describe("cloudConnection – ensureToken", function () {
	it("ensureToken calls login when no token exists", async function () {
		this.timeout(40000);
		const cloud = new CloudConnection("u", "p");
		// ensureToken will call login() which will fail because no real server
		// but it should reject, not crash
		await assert.rejects(() => cloud.ensureToken(), /.*/, "should reject without a valid server");
	});

	it("ensureToken does NOT call login when token is fresh", async function () {
		const cloud = new CloudConnection("u", "p");
		// Manually set a valid token and recent tokenTime
		cloud.token = "valid-token-123";
		cloud.tokenTime = Date.now();

		let loginCalled = false;
		const origLogin = cloud.login.bind(cloud);
		cloud.login = async () => {
			loginCalled = true;
			return origLogin();
		};

		await cloud.ensureToken();
		assert.strictEqual(loginCalled, false, "login should NOT be called when token is still fresh");
		assert.strictEqual(cloud.token, "valid-token-123", "token should remain unchanged");
	});

	it("ensureToken deduplicates concurrent calls by returning same promise", async function () {
		const cloud = new CloudConnection("u", "p");

		// Set tokenRefreshPromise to a pending promise (simulates an in-flight refresh)
		let resolveOuter;
		const pendingPromise = new Promise(r => {
			resolveOuter = r;
		});
		cloud.tokenRefreshPromise = pendingPromise;

		// ensureToken is async, so it wraps the return; but we can verify it awaits
		// the same underlying promise by checking the tokenRefreshPromise is not replaced
		const p1 = cloud.ensureToken();
		const p2 = cloud.ensureToken();

		// Both calls should see the same tokenRefreshPromise
		assert.strictEqual(cloud.tokenRefreshPromise, pendingPromise, "tokenRefreshPromise should not be replaced");

		// Clean up
		resolveOuter();
		await p1;
		await p2;
	});
});

// ============================================================
// cloudConnection – chart data error handling
// ============================================================
describe("cloudConnection – getMicroRealtimeData error handling", function () {
	it("returns null when _postBinary throws", async function () {
		const cloud = new CloudConnection("u", "p");
		// Set a fake token so ensureToken doesn't try to login
		cloud.token = "fake-token";
		cloud.tokenTime = Date.now();

		// Force _postBinary to throw so the catch block returns null
		cloud._postBinary = async () => {
			throw new Error("network error");
		};

		const result = await cloud.getMicroRealtimeData(1, [{ id: "MI123" }], "2026-04-01", ["pv_power"]);
		assert.strictEqual(result, null, "should return null on error");
	});
});

describe("cloudConnection – getModuleRealtimeData error handling", function () {
	it("returns null when _postBinary throws", async function () {
		const cloud = new CloudConnection("u", "p");
		// Set a fake token so ensureToken doesn't try to login
		cloud.token = "fake-token";
		cloud.tokenTime = Date.now();

		// Force _postBinary to throw so the catch block returns null
		cloud._postBinary = async () => {
			throw new Error("network error");
		};

		const result = await cloud.getModuleRealtimeData(1, "MI123", 1, "2026-04-01", ["pv_power"]);
		assert.strictEqual(result, null, "should return null on error");
	});
});

describe("cloudConnection – login error propagation", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("throws CloudAuthError when pre-inspect returns status=1 with message", async function () {
		CloudConnection.prototype._post = async function () {
			return { status: "1", message: "User does not exist" };
		};
		const cloud = new CloudConnection("u@x", "wrong");
		await assert.rejects(
			() => cloud.login(),
			err => {
				assert.ok(err instanceof CloudAuthError, `expected CloudAuthError, got ${err.constructor.name}`);
				assert.strictEqual(err.message, "User does not exist");
				assert.strictEqual(err.code, "1");
				return true;
			},
		);
	});

	it("throws CloudAuthError when login endpoint returns non-zero status", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath.endsWith("/auth/pre-insp")) {
				return { status: "0", data: { n: "nonce-123" } };
			}
			return { status: "1", message: "Invalid password" };
		};
		const cloud = new CloudConnection("u@x", "wrong");
		await assert.rejects(
			() => cloud.login(),
			err => {
				assert.ok(err instanceof CloudAuthError);
				assert.strictEqual(err.message, "Invalid password");
				return true;
			},
		);
	});

	it("does not classify transient network errors as CloudAuthError", async function () {
		let calls = 0;
		CloudConnection.prototype._post = async function () {
			calls++;
			throw new Error("ETIMEDOUT");
		};
		const cloud = new CloudConnection("u@x", "password");
		await assert.rejects(
			() => cloud.login(),
			err => {
				assert.ok(!(err instanceof CloudAuthError), "transient errors must not be CloudAuthError");
				assert.match(err.message, /ETIMEDOUT|Login failed/);
				return true;
			},
		);
		assert.ok(calls >= 2, "should have tried at least two strategies");
	});
});

// ============================================================
// cloudConnection – region_c discovery (auth phase 1)
// ============================================================
describe("cloudConnection – region_c discovery", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("switches baseUrl + records dc when region_c returns a different login_url", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce-eu", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-eu" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "0", data: { list: [] } };
			}
			return { status: "1", message: "unexpected" };
		};
		const cloud = new CloudConnection("eu@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-eu");
		assert.strictEqual(cloud.getBaseUrl(), "https://euapi.hoymiles.com");
		assert.strictEqual(cloud.getProfile(), "installer");
		assert.strictEqual(cloud.getLastDc(), 1);
	});

	it("keeps default baseUrl when region_c returns empty login_url with dc=-1", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "", dc: -1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "User does not exist" };
			}
			return { status: "1", message: "unexpected" };
		};
		const cloud = new CloudConnection("ghost@x", "pw");
		await assert.rejects(
			() => cloud.login(),
			err => err instanceof CloudAuthError,
		);
		assert.strictEqual(cloud.getBaseUrl(), "https://neapi.hoymiles.com");
		assert.strictEqual(cloud.getLastDc(), -1);
	});

	it("keeps default baseUrl when region_c throws (network error) — login still proceeds", async function () {
		const log = [];
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				throw new Error("ETIMEDOUT region_c");
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce-default", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-default" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "0", data: { list: [] } };
			}
			return { status: "1", message: "unexpected" };
		};
		const cloud = new CloudConnection("u@x", "pw", m => log.push(m));
		const token = await cloud.login();
		assert.strictEqual(token, "tok-default");
		assert.strictEqual(cloud.getBaseUrl(), "https://neapi.hoymiles.com");
		assert.ok(
			log.some(m => m.includes("region_c") && m.includes("ETIMEDOUT")),
			"region_c failure should be logged",
		);
	});
});

// ============================================================
// cloudConnection – v3 login + post-login probe (profile decision)
// ============================================================
describe("cloudConnection – v3 login + profile probe", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("legacy v=2 (no salt) + probe accepts → installer profile, classic challenge", async function () {
		const calls = [];
		const bodies = [];
		CloudConnection.prototype._post = async function (apiPath, body) {
			calls.push(apiPath);
			bodies.push(body);
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce-legacy", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-installer" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "0", data: { list: [] } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-installer");
		assert.strictEqual(cloud.getProfile(), "installer");
		// v0 endpoint must never be called.
		assert.ok(!calls.includes("/iam/pub/0/c/login_c"), "v0 must not be called");
		// Probe must be called after login, against the regional host.
		assert.ok(calls.includes("/pvm/api/0/station/select_by_page"), "probe must be called");
		// Login body uses the legacy md5.sha256base64 challenge (single dotted string).
		const loginBody = bodies[calls.indexOf("/iam/pub/3/auth/login")];
		assert.strictEqual(typeof loginBody.ch, "string");
		assert.match(loginBody.ch, /^[a-f0-9]{32}\.[A-Za-z0-9+/]+=*$/, "legacy challenge format");
		assert.strictEqual(loginBody.n, "nonce-legacy");
	});

	it("v=3 + Argon2 + probe accepts → installer profile (2026 cloud: even Web/Installer get v=3)", async function () {
		const calls = [];
		const bodies = [];
		CloudConnection.prototype._post = async function (apiPath, body) {
			calls.push(apiPath);
			bodies.push(body);
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", a: "46530f67d9c6768975e9ce7edd412df8", v: 3, dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-installer-v3" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "0", data: { list: [{ id: 123, name: "Balcony" }] } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("installer@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-installer-v3");
		assert.strictEqual(cloud.getProfile(), "installer", "probe acceptance must override v=3 Argon2 hint");
		const loginBody = bodies[calls.indexOf("/iam/pub/3/auth/login")];
		assert.match(loginBody.ch, /^[a-f0-9]{64}$/, "Argon2 hex hash regardless of profile");
	});

	it("v=3 + Argon2 + probe rejected → home profile (the real S-Miles Home case)", async function () {
		const calls = [];
		const bodies = [];
		CloudConnection.prototype._post = async function (apiPath, body) {
			calls.push(apiPath);
			bodies.push(body);
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce-home", a: "46530f67d9c6768975e9ce7edd412df8", v: 3, dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-home" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "100", message: "can only be used for logging in to the S-Miles Home app" };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("home@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-home");
		assert.strictEqual(cloud.getProfile(), "home");
		const loginBody = bodies[calls.indexOf("/iam/pub/3/auth/login")];
		// 32-byte Argon2 hash = 64 lowercase hex chars.
		assert.match(loginBody.ch, /^[a-f0-9]{64}$/, "Argon2 hex hash of 32 bytes");
		assert.strictEqual(loginBody.n, "nonce-home");
	});

	it("probe throws (network error) → login rejects and token state is rolled back", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				throw new Error("ETIMEDOUT probe");
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		await assert.rejects(() => cloud.login(), /ETIMEDOUT probe/);
		assert.strictEqual(cloud.token, null, "token must be rolled back on probe failure");
		assert.strictEqual(cloud.tokenTime, 0, "tokenTime must be reset on probe failure");
		assert.strictEqual(cloud.getProfile(), null, "profile must stay null on probe failure");
	});

	it("pre-insp rejected → CloudAuthError, profile stays null, no probe call", async function () {
		const calls = [];
		CloudConnection.prototype._post = async function (apiPath) {
			calls.push(apiPath);
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "user not found" };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("ghost@x", "pw");
		await assert.rejects(
			() => cloud.login(),
			err => err instanceof CloudAuthError && err.message === "user not found",
		);
		assert.strictEqual(cloud.getProfile(), null);
		assert.ok(!calls.includes("/pvm/api/0/station/select_by_page"), "probe must not run when login fails");
	});

	it("login rejected (after pre-insp success) → CloudAuthError, no probe call", async function () {
		const calls = [];
		CloudConnection.prototype._post = async function (apiPath) {
			calls.push(apiPath);
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "1", message: "Log in failed. Please check your account and password.#7" };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "wrong");
		await assert.rejects(
			() => cloud.login(),
			err => err instanceof CloudAuthError && /check your account/.test(err.message),
		);
		assert.ok(!calls.includes("/pvm/api/0/station/select_by_page"), "probe must not run when login fails");
	});

	it("does exactly 4 _post calls on a successful login (region + pre-insp + login + probe)", async function () {
		let postCalls = 0;
		CloudConnection.prototype._post = async function (apiPath) {
			postCalls++;
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "0", data: { list: [] } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok");
		assert.strictEqual(
			postCalls,
			4,
			`expected 4 _post calls (region + pre-insp + login + probe), got ${postCalls}`,
		);
	});
});

// ============================================================
// cloudConnection – probe HTTP 403 → home profile (S-Miles Home account)
// ============================================================
describe("cloudConnection – probe HTTP 403 handling", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("probe rejected with HTTP 403 → home profile, login succeeds", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce-home", a: "46530f67d9c6768975e9ce7edd412df8", v: 3 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-home-403" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				throw new HttpError(403, "https://euapi.hoymiles.com/pvm/api/0/station/select_by_page");
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("home@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-home-403", "login must succeed despite the /pvm 403");
		assert.strictEqual(cloud.getProfile(), "home", "HTTP 403 on /pvm must be classified as home");
		assert.strictEqual(cloud.token, "tok-home-403", "token must be kept, not rolled back");
	});

	it("probe rejected with a non-403 HttpError (500) → login still rejects (transport error)", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				throw new HttpError(500, "https://neapi.hoymiles.com/pvm/api/0/station/select_by_page");
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		await assert.rejects(() => cloud.login(), /HTTP 500/);
		assert.strictEqual(cloud.token, null, "token must be rolled back on a genuine probe failure");
		assert.strictEqual(cloud.getProfile(), null);
	});
});

// ============================================================
// cloudConnection – loginDiagnostics
// ============================================================
describe("cloudConnection – loginDiagnostics", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("returns one result per phase (region, preInsp, login, probe) without mutating state", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", v: 2 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-installer" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "0", data: { list: [] } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		// pre-set state to verify it's preserved
		cloud.token = "preexisting";
		cloud.tokenTime = 12345;

		const results = await cloud.loginDiagnostics();
		assert.strictEqual(results.length, 4, "should report 4 attempts (region, preInsp, login, probe)");
		assert.strictEqual(results[0].flow, "region");
		assert.strictEqual(results[0].ok, true);
		assert.strictEqual(results[0].dc, 0);
		assert.strictEqual(results[1].flow, "preInsp");
		assert.strictEqual(results[1].ok, true);
		assert.strictEqual(results[1].v, 2);
		assert.strictEqual(results[1].saltPresent, false);
		assert.strictEqual(results[1].profile, undefined, "preInsp must no longer report profile");
		assert.strictEqual(results[2].flow, "login");
		assert.strictEqual(results[2].ok, true);
		assert.strictEqual(results[2].hasToken, true);
		assert.strictEqual(results[3].flow, "probe");
		assert.strictEqual(results[3].ok, true);
		assert.strictEqual(results[3].profile, "installer");

		// State must NOT be mutated.
		assert.strictEqual(cloud.token, "preexisting");
		assert.strictEqual(cloud.tokenTime, 12345);
		assert.strictEqual(cloud.getProfile(), null);
	});

	it("pre-insp rejection short-circuits the login + probe phases", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "Account locked." };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("locked@x", "pw");
		const results = await cloud.loginDiagnostics();
		// Only region + preInsp — no login/probe attempt because pre-insp failed.
		assert.strictEqual(results.length, 2);
		assert.strictEqual(results[0].flow, "region");
		assert.strictEqual(results[1].flow, "preInsp");
		assert.strictEqual(results[1].ok, false);
		assert.strictEqual(results[1].message, "Account locked.");
	});

	it("v=3 + salt + probe rejection → profile=home reported by probe phase, not preInsp", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", a: "46530f67d9c6768975e9ce7edd412df8", v: 3, dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-home" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				return { status: "100", message: "can only be used for logging in to the S-Miles Home app" };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("home@x", "pw");
		const results = await cloud.loginDiagnostics();
		assert.strictEqual(results.length, 4);
		assert.strictEqual(results[1].flow, "preInsp");
		assert.strictEqual(results[1].v, 3);
		assert.strictEqual(results[1].saltPresent, true);
		assert.strictEqual(results[1].profile, undefined);
		assert.strictEqual(results[2].flow, "login");
		assert.strictEqual(results[2].ok, true);
		assert.strictEqual(results[3].flow, "probe");
		assert.strictEqual(results[3].profile, "home");
	});

	it("login rejection skips the probe", async function () {
		const calls = [];
		CloudConnection.prototype._post = async function (apiPath) {
			calls.push(apiPath);
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", v: 3, a: "46530f67d9c6768975e9ce7edd412df8" } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "1", message: "Invalid password" };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "wrong");
		const results = await cloud.loginDiagnostics();
		// region + preInsp + login (failed) — no probe.
		assert.strictEqual(results.length, 3);
		assert.strictEqual(results[2].flow, "login");
		assert.strictEqual(results[2].ok, false);
		assert.ok(!calls.includes("/pvm/api/0/station/select_by_page"), "probe must not run when login fails");
	});

	it("probe HTTP 403 → reported as ok with profile=home, not as a failure", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce", a: "46530f67d9c6768975e9ce7edd412df8", v: 3 } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-home" } };
			}
			if (apiPath === "/pvm/api/0/station/select_by_page") {
				throw new HttpError(403, "https://euapi.hoymiles.com/pvm/api/0/station/select_by_page");
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("home@x", "pw");
		const results = await cloud.loginDiagnostics();
		assert.strictEqual(results.length, 4);
		assert.strictEqual(results[3].flow, "probe");
		assert.strictEqual(results[3].ok, true, "a 403 probe is a definitive verdict, not a failure");
		assert.strictEqual(results[3].profile, "home");
	});
});

describe("CloudAuthError", function () {
	it("is an instance of Error", function () {
		const err = new CloudAuthError("bad credentials", "1");
		assert.ok(err instanceof Error);
		assert.ok(err instanceof CloudAuthError);
	});

	it("has name 'CloudAuthError'", function () {
		const err = new CloudAuthError("bad credentials", "1");
		assert.strictEqual(err.name, "CloudAuthError");
	});

	it("exposes the server-reported code and message", function () {
		const err = new CloudAuthError("Invalid username or password", "1");
		assert.strictEqual(err.message, "Invalid username or password");
		assert.strictEqual(err.code, "1");
	});

	it("code defaults to empty string when omitted", function () {
		const err = new CloudAuthError("bad credentials");
		assert.strictEqual(err.code, "");
	});
});

// ============================================================
// cloudConnection – getRealtimeUri
// ============================================================
describe("cloudConnection – getRealtimeUri", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("throws 'Invalid stationId' for 0", async function () {
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.getRealtimeUri(0), {
			message: "Invalid stationId",
		});
	});

	it("posts {sid} to get_sd_uri and returns data.uri on status=0", async function () {
		const cloud = new CloudConnection("u", "p");
		cloud.token = "fake-token";
		cloud.tokenTime = Date.now();

		let calledPath;
		let calledBody;
		CloudConnection.prototype._post = async function (apiPath, body) {
			calledPath = apiPath;
			calledBody = body;
			return { status: "0", data: { uri: "https://eurt.hoymiles.com/rds/api/0/burst/get?k=abc123&t=999" } };
		};

		const uri = await cloud.getRealtimeUri(42);
		assert.strictEqual(uri, "https://eurt.hoymiles.com/rds/api/0/burst/get?k=abc123&t=999");
		assert.strictEqual(calledPath, "/pvm/api/0/station/get_sd_uri");
		assert.deepStrictEqual(calledBody, { sid: 42 });
	});

	it("throws when status is not '0'", async function () {
		const cloud = new CloudConnection("u", "p");
		cloud.token = "fake-token";
		cloud.tokenTime = Date.now();
		CloudConnection.prototype._post = async function () {
			return { status: "1", message: "session expired" };
		};
		await assert.rejects(() => cloud.getRealtimeUri(42), {
			message: "get_sd_uri failed: session expired",
		});
	});

	it("throws when status is '0' but data.uri is missing", async function () {
		const cloud = new CloudConnection("u", "p");
		cloud.token = "fake-token";
		cloud.tokenTime = Date.now();
		CloudConnection.prototype._post = async function () {
			return { status: "0", data: {} };
		};
		await assert.rejects(() => cloud.getRealtimeUri(42), {
			message: "get_sd_uri returned no uri",
		});
	});
});

// ============================================================
// cloudConnection – pollRealtimeBurst (real HTTPS mock server — pollRealtimeBurst
// posts directly to the caller-supplied `uri` via httpClient.postJson, bypassing
// this._post, so it cannot be exercised via the prototype-override pattern above).
// ============================================================
describe("cloudConnection – pollRealtimeBurst", function () {
	let server;
	let serverAvailable = false;
	let baseUrl;

	before(function (done) {
		this.timeout(30000);

		let creds;
		try {
			creds = generateCert();
		} catch {
			// openssl not available — skip all mock-server tests in this block.
			this.skip();
			return;
		}

		server = https.createServer(creds, (req, res) => {
			const chunks = [];
			req.on("data", chunk => chunks.push(chunk));
			req.on("end", () => {
				const url = req.url;

				// m:0 station overview — power + flow.
				if (url.startsWith("/burst-m0")) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: "0",
							data: {
								dly: 2000,
								con: 1,
								power: { pv: 500, pvr: 50, bat: 0, grid: -100, load: 400, sp: 0 },
								flow: [{ i: 1, o: 2, v: 500 }],
							},
						}),
					);
					return;
				}

				// m:3 per-inverter detail — mis[].
				if (url.startsWith("/burst-m3")) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify({
							status: "0",
							data: {
								dly: 1500,
								con: 1,
								mis: [{ sn: "INV1", pac: 300, p1: 150, p2: 150, p3: 0, p4: 0 }],
							},
						}),
					);
					return;
				}

				// Non-zero status — server-side rejection (e.g. stale k-token).
				if (url.startsWith("/burst-error")) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "1", message: "token expired" }));
					return;
				}

				// status=0 with no data at all — pollRealtimeBurst must fall back to {}.
				if (url.startsWith("/burst-empty")) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "0" }));
					return;
				}

				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found");
			});
		});

		// Trust the mock server's self-signed cert on the shared HTTPS agent — full cert validation
		// stays on (no NODE_TLS_REJECT_UNAUTHORIZED / rejectUnauthorized:false).
		initAgent({ ca: creds.cert });

		server.listen(0, "127.0.0.1", () => {
			serverAvailable = true;
			const port = server.address().port;
			baseUrl = `https://127.0.0.1:${port}`;
			done();
		});

		server.on("error", err => done(err));
	});

	after(function (done) {
		initAgent(); // restore the default agent (drop the test CA)
		if (server && serverAvailable) {
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

	it("parses m:0 station overview (power + flow)", async function () {
		this.timeout(30000);
		const cloud = new CloudConnection("u", "p");
		const data = await cloud.pollRealtimeBurst(`${baseUrl}/burst-m0?k=abc&t=1`, { m: 0, t: 1 });
		assert.deepStrictEqual(data.power, { pv: 500, pvr: 50, bat: 0, grid: -100, load: 400, sp: 0 });
		assert.deepStrictEqual(data.flow, [{ i: 1, o: 2, v: 500 }]);
		assert.strictEqual(data.dly, 2000);
	});

	it("parses m:3 per-inverter detail (mis[])", async function () {
		this.timeout(30000);
		const cloud = new CloudConnection("u", "p");
		const data = await cloud.pollRealtimeBurst(`${baseUrl}/burst-m3?k=abc&t=1`, { m: 3, mis: ["INV1"], t: 1 });
		assert.strictEqual(data.mis.length, 1);
		assert.strictEqual(data.mis[0].sn, "INV1");
		assert.strictEqual(data.mis[0].pac, 300);
		assert.strictEqual(data.mis[0].p1, 150);
		assert.strictEqual(data.mis[0].p2, 150);
		assert.strictEqual(data.dly, 1500);
		assert.strictEqual(data.con, 1);
	});

	it("throws when the server reports a non-zero status", async function () {
		this.timeout(30000);
		const cloud = new CloudConnection("u", "p");
		await assert.rejects(() => cloud.pollRealtimeBurst(`${baseUrl}/burst-error`, { m: 3, mis: [] }), {
			message: "Realtime burst failed: token expired",
		});
	});

	it("returns an empty object when status=0 but the server sent no data", async function () {
		this.timeout(30000);
		const cloud = new CloudConnection("u", "p");
		const data = await cloud.pollRealtimeBurst(`${baseUrl}/burst-empty`, { m: 3, mis: [] });
		assert.deepStrictEqual(data, {});
	});
});
