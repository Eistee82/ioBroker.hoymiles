import assert from "node:assert";
import * as constants from "../build/lib/constants.js";

// ============================================================
// All exports are non-empty values of an expected shape
//
// Most constants are positive numbers (timeouts, sizes, ports). Cloud-host and
// IAM-path exports are strings. Validate each export against the shape implied
// by its name so a typo (e.g. an empty string or an unintended `false`) is
// caught immediately.
// ============================================================
describe("constants – all exports", function () {
	const entries = Object.entries(constants);

	it("has at least one export", function () {
		assert.ok(entries.length > 0, "module should export at least one constant");
	});

	for (const [name, value] of entries) {
		it(`${name} has a sensible value`, function () {
			if (typeof value === "string") {
				assert.ok(value.length > 0, `${name} should not be an empty string`);
				if (name.startsWith("CLOUD_HOST_")) {
					assert.match(value, /^https:\/\/[^/]+$/, `${name} should be a bare HTTPS host URL`);
				} else if (name.startsWith("IAM_") && name.endsWith("_PATH")) {
					assert.match(value, /^\/[\w/-]+$/, `${name} should be an absolute path`);
				}
			} else if (value && typeof value === "object") {
				// e.g. CLOUD_DC_HOSTS — a Record<number, host>. Validate shape generically.
				const objEntries = Object.entries(value);
				assert.ok(objEntries.length > 0, `${name} should not be empty`);
				for (const [k, v] of objEntries) {
					assert.match(k, /^\d+$/, `${name} key "${k}" should be numeric`);
					assert.strictEqual(typeof v, "string", `${name}[${k}] should be a string`);
					assert.match(v, /^https:\/\/[^/]+$/, `${name}[${k}] should be a bare HTTPS host URL`);
				}
			} else {
				assert.strictEqual(typeof value, "number", `${name} should be a number, got ${typeof value}`);
				assert.ok(value > 0, `${name} should be > 0, got ${value}`);
			}
		});
	}
});

// ============================================================
// Specific values
// ============================================================
describe("constants – specific values", function () {
	it("DEFAULT_POLL_MS is 300000 (5 minutes)", function () {
		assert.strictEqual(constants.DEFAULT_POLL_MS, 300000);
	});

	it("MIN_POLL_MS is 60000 (1 minute)", function () {
		assert.strictEqual(constants.MIN_POLL_MS, 60000);
	});

	it("DTU_PORT is 10081", function () {
		assert.strictEqual(constants.DTU_PORT, 10081);
	});

	it("TOKEN_MAX_AGE_MS is 3600000 (1 hour)", function () {
		assert.strictEqual(constants.TOKEN_MAX_AGE_MS, 3600000);
	});

	it("UNLOAD_TIMEOUT_MS is 5000", function () {
		assert.strictEqual(constants.UNLOAD_TIMEOUT_MS, 5000);
	});

	it("HTTP_REQUEST_TIMEOUT_MS is 15000", function () {
		assert.strictEqual(constants.HTTP_REQUEST_TIMEOUT_MS, 15000);
	});

	it("CLOUD_RETRY_INITIAL_MS is 60000", function () {
		assert.strictEqual(constants.CLOUD_RETRY_INITIAL_MS, 60000);
	});

	it("CLOUD_RETRY_MAX_MS is 600000", function () {
		assert.strictEqual(constants.CLOUD_RETRY_MAX_MS, 600000);
	});
});

// ============================================================
// Relationships between constants
// ============================================================
describe("constants – relationships", function () {
	it("MIN_POLL_MS < DEFAULT_POLL_MS", function () {
		assert.ok(
			constants.MIN_POLL_MS < constants.DEFAULT_POLL_MS,
			`MIN_POLL_MS (${constants.MIN_POLL_MS}) should be less than DEFAULT_POLL_MS (${constants.DEFAULT_POLL_MS})`,
		);
	});

	it("CLOUD_RETRY_INITIAL_MS < CLOUD_RETRY_MAX_MS", function () {
		assert.ok(
			constants.CLOUD_RETRY_INITIAL_MS < constants.CLOUD_RETRY_MAX_MS,
			`CLOUD_RETRY_INITIAL_MS (${constants.CLOUD_RETRY_INITIAL_MS}) should be less than CLOUD_RETRY_MAX_MS (${constants.CLOUD_RETRY_MAX_MS})`,
		);
	});

	it("HTTP_REQUEST_TIMEOUT_MS < HTTP_AGENT_TIMEOUT_MS", function () {
		assert.ok(
			constants.HTTP_REQUEST_TIMEOUT_MS < constants.HTTP_AGENT_TIMEOUT_MS,
			`HTTP_REQUEST_TIMEOUT_MS (${constants.HTTP_REQUEST_TIMEOUT_MS}) should be less than HTTP_AGENT_TIMEOUT_MS (${constants.HTTP_AGENT_TIMEOUT_MS})`,
		);
	});

	it("UNLOAD_TIMEOUT_MS < INFO_FALLBACK_TIMEOUT_MS", function () {
		assert.ok(
			constants.UNLOAD_TIMEOUT_MS < constants.INFO_FALLBACK_TIMEOUT_MS,
			`UNLOAD_TIMEOUT_MS (${constants.UNLOAD_TIMEOUT_MS}) should be less than INFO_FALLBACK_TIMEOUT_MS (${constants.INFO_FALLBACK_TIMEOUT_MS})`,
		);
	});

	it("RECONNECT_MAX_MS >= CLOUD_RETRY_INITIAL_MS", function () {
		assert.ok(
			constants.RECONNECT_MAX_MS >= constants.CLOUD_RETRY_INITIAL_MS,
			`RECONNECT_MAX_MS (${constants.RECONNECT_MAX_MS}) should be >= CLOUD_RETRY_INITIAL_MS (${constants.CLOUD_RETRY_INITIAL_MS})`,
		);
	});
});
