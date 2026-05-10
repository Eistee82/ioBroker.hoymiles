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
// cloudConnection – region_c discovery
// ============================================================
describe("cloudConnection – region_c discovery", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("switches baseUrl when region_c returns a different login_url", async function () {
		const calls = [];
		CloudConnection.prototype._post = async function (apiPath) {
			calls.push(apiPath);
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "user not found" };
			}
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://euapi.hoymiles.com", dc: 1 } };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "0", data: { token: "tok-eu" } };
			}
			return { status: "1", message: "unexpected" };
		};
		const cloud = new CloudConnection("eu@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-eu");
		assert.strictEqual(cloud.getBaseUrl(), "https://euapi.hoymiles.com");
		assert.strictEqual(cloud.getLastFlow(), "v0");
		assert.strictEqual(cloud.getLastDc(), 1);
	});

	it("keeps default baseUrl when region_c returns empty login_url with dc=-1", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "user not found" };
			}
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "", dc: -1 } };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
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

	it("keeps default baseUrl when region_c throws (network error)", async function () {
		const log = [];
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "user not found" };
			}
			if (apiPath === "/iam/pub/0/c/region_c") {
				throw new Error("ETIMEDOUT region_c");
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "0", data: { token: "tok-default" } };
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
// cloudConnection – v3 → v0 fallback
// ============================================================
describe("cloudConnection – v3 → v0 fallback", function () {
	let originalPost;

	beforeEach(function () {
		originalPost = CloudConnection.prototype._post;
	});

	afterEach(function () {
		CloudConnection.prototype._post = originalPost;
	});

	it("v3 success — does NOT call v0", async function () {
		const calls = [];
		CloudConnection.prototype._post = async function (apiPath) {
			calls.push(apiPath);
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce-1" } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-v3" } };
			}
			throw new Error(`unexpected call to ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-v3");
		assert.strictEqual(cloud.getLastFlow(), "v3");
		assert.ok(!calls.includes("/iam/pub/0/c/region_c"), "region_c must NOT be called when v3 succeeds");
		assert.ok(!calls.includes("/iam/pub/0/c/login_c"), "v0 login_c must NOT be called when v3 succeeds");
	});

	it("v3 hard-reject → v0 success returns v0 token", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "v3 says no" };
			}
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "0", data: { token: "tok-v0" } };
			}
			throw new Error(`unexpected call to ${apiPath}`);
		};
		const cloud = new CloudConnection("home@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-v0");
		assert.strictEqual(cloud.getLastFlow(), "v0");
	});

	it("v3 + v0 hard-reject → CloudAuthError, combined message preserved", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "v3 reason" };
			}
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "1", message: "v0 reason" };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		await assert.rejects(
			() => cloud.login(),
			err => {
				assert.ok(err instanceof CloudAuthError);
				assert.match(err.message, /v0 reason/);
				assert.match(err.message, /v3 reason/, "combined message should mention v3 reject reason too");
				return true;
			},
		);
		assert.strictEqual(cloud.getLastFlow(), null);
	});

	it("v3 transient + v0 success → succeeds via v0 (transient v3 outage tolerated)", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				throw new Error("ECONNRESET v3");
			}
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "0", data: { token: "tok-v0" } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-v0");
		assert.strictEqual(cloud.getLastFlow(), "v0");
	});

	it("v3 success on retry-strategy 2 — v0 not invoked", async function () {
		// First strategy throws CloudAuthError, but tryLoginV3 only re-tries within
		// a transient catch. CloudAuthError is permanent. So this verifies that on a
		// transient v3 failure of one challenge, the loop continues; here we simulate
		// pre-insp success on first call (no salt → uses challenge), login success.
		let postCalls = 0;
		CloudConnection.prototype._post = async function (apiPath) {
			postCalls++;
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce" } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-v3" } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("u@x", "pw");
		const token = await cloud.login();
		assert.strictEqual(token, "tok-v3");
		assert.ok(postCalls === 2, `expected 2 _post calls (pre-insp + login), got ${postCalls}`);
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

	it("returns one result per flow (region, v3, v0) without mutating state", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "1", message: "v3 says no" };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "0", data: { token: "tok-v0" } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("home@x", "pw");
		// pre-set state to verify it's preserved
		cloud.token = "preexisting";
		cloud.tokenTime = 12345;

		const results = await cloud.loginDiagnostics();
		assert.strictEqual(results.length, 3, "should report 3 attempts (region, v3, v0)");
		assert.strictEqual(results[0].flow, "region");
		assert.strictEqual(results[0].ok, true);
		assert.strictEqual(results[0].dc, 0);
		assert.strictEqual(results[1].flow, "v3");
		assert.strictEqual(results[1].ok, false);
		assert.strictEqual(results[1].status, "1");
		assert.strictEqual(results[2].flow, "v0");
		assert.strictEqual(results[2].ok, true);
		assert.strictEqual(results[2].hasToken, true);

		// State must NOT be mutated.
		assert.strictEqual(cloud.token, "preexisting");
		assert.strictEqual(cloud.tokenTime, 12345);
		assert.strictEqual(cloud.getLastFlow(), null);
	});

	it("reports a v3-only-success diagnostics correctly", async function () {
		CloudConnection.prototype._post = async function (apiPath) {
			if (apiPath === "/iam/pub/0/c/region_c") {
				return { status: "0", data: { login_url: "https://neapi.hoymiles.com", dc: 0 } };
			}
			if (apiPath === "/iam/pub/3/auth/pre-insp") {
				return { status: "0", data: { n: "nonce" } };
			}
			if (apiPath === "/iam/pub/3/auth/login") {
				return { status: "0", data: { token: "tok-v3" } };
			}
			if (apiPath === "/iam/pub/0/c/login_c") {
				return { status: "0", data: { token: "tok-v0" } };
			}
			throw new Error(`unexpected ${apiPath}`);
		};
		const cloud = new CloudConnection("dual@x", "pw");
		const results = await cloud.loginDiagnostics();
		const flows = results.map(r => `${r.flow}:${r.ok}`).join(",");
		// All three should succeed for a dual-account user
		assert.strictEqual(flows, "region:true,v3:true,v0:true");
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
