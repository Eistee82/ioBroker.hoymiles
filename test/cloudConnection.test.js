import assert from "node:assert";
import CloudConnection, { CloudAuthError } from "../build/lib/cloudConnection.js";

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
