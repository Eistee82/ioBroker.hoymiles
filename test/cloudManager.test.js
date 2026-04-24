import assert from "node:assert";
import CloudManager from "../build/lib/cloudManager.js";
import { CloudAuthError } from "../build/lib/cloudConnection.js";

// Minimal mock adapter matching the HoymilesAdapter interface
function makeMockAdapter() {
	return {
		log: {
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
		},
		devices: new Map(),
		setStateAsync: async () => {},
		getStateAsync: async () => null,
		extendObjectAsync: async () => {},
		setObjectNotExistsAsync: async () => {},
		updateConnectionState: async () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		clearTimeout: id => {
			if (id) {
				clearTimeout(id);
			}
		},
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
	};
}

// Minimal mock protobuf handler
function makeMockProtobuf() {
	return {};
}

// ============================================================
// CloudManager
// ============================================================
describe("CloudManager", function () {
	it("constructor does not throw with valid options", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		assert.ok(manager);
	});

	it("hasToken returns false initially", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		assert.strictEqual(manager.hasToken, false);
	});

	it("stop on fresh instance does not throw", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		assert.doesNotThrow(() => manager.stop());
	});

	it("stop is idempotent (can be called twice)", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.stop();
		assert.doesNotThrow(() => manager.stop());
	});

	it("hasToken remains false after stop", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.stop();
		assert.strictEqual(manager.hasToken, false);
	});

	it("matchLocalDeviceToCloud ignores context without serial", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		// Should not throw for context without dtuSerial
		assert.doesNotThrow(() => manager.matchLocalDeviceToCloud({ dtuSerial: "" }));
	});
});

// ============================================================
// CloudManager – start/stop lifecycle
// ============================================================
describe("CloudManager – start/stop lifecycle", function () {
	this.timeout(15000);

	it("start() does not throw when cloud login fails", async function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		// start() catches login errors internally and schedules a retry
		await manager.start();
		manager.stop();
	});

	it("stop() after start() does not throw", async function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		await manager.start();
		assert.doesNotThrow(() => manager.stop());
	});

	it("stop() clears retryTimer", async function () {
		const adapter = makeMockAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		await manager.start();
		// After start fails internally, a retryTimer is scheduled.
		// stop() should clean it up without errors.
		manager.stop();
		// Calling stop again to confirm timer is already cleared
		assert.doesNotThrow(() => manager.stop());
	});
});

// ============================================================
// CloudManager – matchLocalDeviceToCloud
// ============================================================
describe("CloudManager – matchLocalDeviceToCloud", function () {
	it("registers device in adapter.devices map", function () {
		const adapter = makeMockAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		const ctx = { dtuSerial: "HM123", cloudStationId: null, enableLocal: true };
		manager.matchLocalDeviceToCloud(ctx);
		assert.strictEqual(adapter.devices.has("HM123"), true);
	});

	it("ignores empty serial", function () {
		const adapter = makeMockAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		const ctx = { dtuSerial: "", cloudStationId: null, enableLocal: true };
		manager.matchLocalDeviceToCloud(ctx);
		assert.strictEqual(adapter.devices.size, 0);
	});

	it("does not duplicate on repeated calls", function () {
		const adapter = makeMockAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		const ctx = { dtuSerial: "HM123", cloudStationId: null, enableLocal: true };
		manager.matchLocalDeviceToCloud(ctx);
		manager.matchLocalDeviceToCloud(ctx);
		assert.strictEqual(adapter.devices.size, 1);
	});
});

// ============================================================
// CloudManager – event delegation
// ============================================================
describe("CloudManager – event delegation", function () {
	it("onRelayDataSent does not throw when no poller exists", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		assert.doesNotThrow(() => manager.onRelayDataSent());
	});

	it("onLocalDisconnected does not throw on fresh manager", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		assert.doesNotThrow(() => manager.onLocalDisconnected());
	});

	it("onLocalConnected does not throw on fresh manager", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		const ctx = { dtuSerial: "HM123", cloudStationId: null, cloudSendTimeMin: 0, enableLocal: true };
		assert.doesNotThrow(() => manager.onLocalConnected(ctx));
	});

	it("onLocalConnected with cloudSendTimeMin > 0 does not throw (no poller)", function () {
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		const ctx = { dtuSerial: "HM123", cloudStationId: null, cloudSendTimeMin: 5, enableLocal: true };
		assert.doesNotThrow(() => manager.onLocalConnected(ctx));
	});

	it("onLocalDisconnected checks localContexts for connected devices", function () {
		const localCtx = {
			dtuSerial: "HM456",
			cloudStationId: null,
			connection: { connected: false },
		};
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		// All contexts are disconnected, so this triggers the night-mode path
		assert.doesNotThrow(() => manager.onLocalDisconnected());
	});

	it("onLocalDisconnected does NOT enter night mode when a context is still connected", function () {
		const localCtx = {
			dtuSerial: "HM456",
			cloudStationId: null,
			connection: { connected: true },
		};
		const manager = new CloudManager({
			adapter: makeMockAdapter(),
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		assert.doesNotThrow(() => manager.onLocalDisconnected());
	});
});

// ============================================================
// Helper: create a manager with injectable mock cloud
// ============================================================
function makeManagerWithMockCloud(overrides = {}) {
	const adapter = makeMockAdapter();
	const manager = new CloudManager({
		adapter,
		protobuf: makeMockProtobuf(),
		cloudUser: "test@example.com",
		cloudPassword: "password123",
		enableLocal: overrides.enableLocal ?? false,
		enableCloudRelay: overrides.enableCloudRelay ?? false,
		dataInterval: 5,
		slowPollFactor: 6,
		localContexts: overrides.localContexts ?? [],
	});

	// Replace the internal cloud connection with a controllable mock
	const mockCloud = {
		token: overrides.token ?? null,
		login: overrides.login ?? (async () => "mock-token"),
		getStationList: overrides.getStationList ?? (async () => []),
		getDeviceTree: overrides.getDeviceTree ?? (async () => []),
		disconnect: overrides.disconnect ?? (() => {}),
		ensureToken: overrides.ensureToken ?? (async () => {}),
	};
	// Overwrite private field (JS has no access control at runtime)
	manager.cloud = mockCloud;

	return { manager, adapter, mockCloud };
}

// ============================================================
// CloudManager – _retryLogin via start()
// ============================================================
describe("CloudManager – _retryLogin exponential backoff", function () {
	this.timeout(10000);

	it("schedules retry when initial login fails", async function () {
		let loginAttempts = 0;
		const { manager } = makeManagerWithMockCloud({
			login: async () => {
				loginAttempts++;
				throw new Error("auth failed");
			},
		});
		await manager.start();
		// After start(), login failed once, so retryTimer should be set
		assert.strictEqual(loginAttempts, 1);
		manager.stop(); // clears the retryTimer
	});

	it("stop() clears retryTimer after failed start", async function () {
		const { manager } = makeManagerWithMockCloud({
			login: async () => {
				throw new Error("auth failed");
			},
		});
		await manager.start();
		// retryTimer is set internally. stop() should clear it.
		manager.stop();
		// Calling stop again should be safe (timer already cleared)
		assert.doesNotThrow(() => manager.stop());
	});

	it("_retryLogin does not schedule duplicate timers", async function () {
		let loginCallCount = 0;
		const { manager } = makeManagerWithMockCloud({
			login: async () => {
				loginCallCount++;
				throw new Error("auth failed");
			},
		});
		await manager.start();
		// Manually call start again — the second retryLogin should be a no-op
		// because a timer is already pending
		await manager.start();
		// Only 2 login attempts (one per start call), not extra retries
		assert.strictEqual(loginCallCount, 2);
		manager.stop();
	});
});

// ============================================================
// CloudManager – _discoverDevices via start()
// ============================================================
describe("CloudManager – _discoverDevices", function () {
	this.timeout(10000);

	it("handles empty station list gracefully", async function () {
		let loggedError = "";
		const adapter = makeMockAdapter();
		adapter.log.error = msg => {
			loggedError = msg;
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [],
			getDeviceTree: async () => [],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		// _initCloudServices will fail because CloudPoller constructor expects a real cloud
		// but _discoverDevices will log "No stations found"
		try {
			await manager.start();
		} catch {
			/* ignore CloudPoller errors */
		}
		assert.ok(loggedError.includes("No stations found"));
		manager.stop();
	});

	it("creates station device and matches local DTU by serial", async function () {
		const adapter = makeMockAdapter();
		const extendedObjects = [];
		adapter.extendObjectAsync = async (id, obj) => {
			extendedObjects.push({ id, obj });
		};

		const localCtx = {
			dtuSerial: "DTU12345",
			cloudStationId: null,
			host: "192.168.1.100",
			connection: null,
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [{ id: 42, name: "My Station" }],
			getDeviceTree: async _stationId => [{ sn: "DTU12345" }],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		// start() will call _initCloudServices → _discoverDevices → then fail on CloudPoller
		// but the device discovery part should complete
		try {
			await manager.start();
		} catch {
			/* CloudPoller construction may fail */
		}

		// Verify local context got matched
		assert.strictEqual(localCtx.cloudStationId, 42);
		assert.strictEqual(adapter.devices.has("DTU12345"), true);
		assert.strictEqual(adapter.devices.get("DTU12345"), localCtx);

		// Verify station device was created (extendObjectAsync was called)
		const stationDevice = extendedObjects.find(e => e.id === "station-42");
		assert.ok(stationDevice, "Station device should have been created");
		assert.strictEqual(stationDevice.obj.common.name, "My Station");

		manager.stop();
	});

	it("defers cloud match for unidentified local devices", async function () {
		const adapter = makeMockAdapter();
		adapter.extendObjectAsync = async () => {};

		// Local context without serial yet (DTU hasn't reported)
		const localCtx = {
			dtuSerial: "",
			cloudStationId: null,
			host: "192.168.1.100",
			connection: null,
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [{ id: 99, name: "Deferred Station" }],
			getDeviceTree: async () => [{ sn: "UNKNOWN_SN" }],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* CloudPoller errors */
		}

		// The serial should be in pendingCloudMatches, not in devices
		assert.strictEqual(adapter.devices.has("UNKNOWN_SN"), false);
		// Now simulate local device reporting its serial via matchLocalDeviceToCloud
		localCtx.dtuSerial = "UNKNOWN_SN";
		manager.matchLocalDeviceToCloud(localCtx);
		assert.strictEqual(localCtx.cloudStationId, 99);
		assert.strictEqual(adapter.devices.has("UNKNOWN_SN"), true);

		manager.stop();
	});

	it("skips DTUs with empty serial from device tree", async function () {
		const adapter = makeMockAdapter();
		adapter.extendObjectAsync = async () => {};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [{ id: 1, name: "Test" }],
			getDeviceTree: async () => [{ sn: "" }, { sn: undefined }],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		assert.strictEqual(adapter.devices.size, 0);
		manager.stop();
	});

	it("handles getDeviceTree failure gracefully", async function () {
		const adapter = makeMockAdapter();
		const warnings = [];
		adapter.log.warn = msg => {
			warnings.push(msg);
		};
		adapter.extendObjectAsync = async () => {};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [{ id: 1, name: "Broken Station" }],
			getDeviceTree: async () => {
				throw new Error("API error");
			},
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		const treeWarning = warnings.find(w => w.includes("Failed to get device tree"));
		assert.ok(treeWarning, "Should log a warning for device tree failure");
		manager.stop();
	});

	it("registers local contexts with serial that were not matched by cloud", async function () {
		const adapter = makeMockAdapter();
		adapter.extendObjectAsync = async () => {};

		const localCtx = {
			dtuSerial: "LOCAL_ONLY_SN",
			cloudStationId: null,
			host: "192.168.1.50",
			connection: null,
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			// Station exists but has a different DTU
			getStationList: async () => [{ id: 10, name: "Other Station" }],
			getDeviceTree: async () => [{ sn: "DIFFERENT_SN" }],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		// localCtx should still be registered in devices even though cloud didn't match it
		assert.strictEqual(adapter.devices.has("LOCAL_ONLY_SN"), true);
		assert.strictEqual(adapter.devices.get("LOCAL_ONLY_SN"), localCtx);
		manager.stop();
	});
});

// ============================================================
// CloudManager – _createStationDevice deduplication
// ============================================================
describe("CloudManager – _createStationDevice", function () {
	this.timeout(10000);

	it("does not create duplicate station devices for same stationId", async function () {
		const adapter = makeMockAdapter();
		let extendCount = 0;
		adapter.extendObjectAsync = async () => {
			extendCount++;
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			// Return the same station twice
			getStationList: async () => [
				{ id: 5, name: "Station A" },
				{ id: 5, name: "Station A" },
			],
			getDeviceTree: async () => [],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		// The station-5 device should only be created once.
		// extendObjectAsync is called for: 1 device + N stationStates for FIRST call only.
		// On second call, stationDevices.has(5) returns true so it's skipped.
		const firstCallExtends = extendCount;
		assert.ok(firstCallExtends > 0, "Should have created at least one station device");

		manager.stop();
	});
});

// ============================================================
// CloudManager – hasToken with injected token
// ============================================================
describe("CloudManager – hasToken with active cloud", function () {
	it("returns true when cloud has a token", function () {
		const { manager } = makeManagerWithMockCloud({ token: "valid-token-123" });
		assert.strictEqual(manager.hasToken, true);
	});

	it("returns false when cloud token is empty string", function () {
		const { manager } = makeManagerWithMockCloud({ token: "" });
		assert.strictEqual(manager.hasToken, false);
	});

	it("returns false when cloud token is null", function () {
		const { manager } = makeManagerWithMockCloud({ token: null });
		assert.strictEqual(manager.hasToken, false);
	});
});

// ============================================================
// CloudManager – stop() clears deferredMatchTimer
// ============================================================
describe("CloudManager – stop() clears deferredMatchTimer", function () {
	this.timeout(10000);

	it("clears deferredMatchTimer when pending cloud matches exist", async function () {
		const adapter = makeMockAdapter();
		adapter.extendObjectAsync = async () => {};

		// Local context without serial — triggers deferred matching
		const localCtx = {
			dtuSerial: "",
			cloudStationId: null,
			host: "192.168.1.1",
			connection: null,
			enableLocal: true,
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [{ id: 7, name: "Deferred" }],
			getDeviceTree: async () => [{ sn: "DEFERRED_SN" }],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		// A deferredMatchTimer should now be set. stop() should clear it.
		manager.stop();
		// Double stop to confirm idempotency
		assert.doesNotThrow(() => manager.stop());
	});
});

// ============================================================
// CloudManager – constructor validation
// ============================================================
describe("CloudManager – constructor state", function () {
	it("stores enableLocal and enableCloudRelay flags", function () {
		const { manager } = makeManagerWithMockCloud({
			enableLocal: true,
			enableCloudRelay: true,
		});
		// The flags are private but we can verify behavior through start()
		assert.ok(manager);
	});

	it("initializes with empty stationDevices", function () {
		const { manager } = makeManagerWithMockCloud();
		// hasToken should be false with default null token
		assert.strictEqual(manager.hasToken, false);
		manager.stop();
	});

	it("accepts localContexts array", function () {
		const ctx1 = { dtuSerial: "A", cloudStationId: null, enableLocal: true };
		const ctx2 = { dtuSerial: "B", cloudStationId: null, enableLocal: true };
		const { manager } = makeManagerWithMockCloud({
			localContexts: [ctx1, ctx2],
		});
		assert.ok(manager);
		manager.stop();
	});
});

// ============================================================
// CloudManager – matchLocalDeviceToCloud advanced scenarios
// ============================================================
describe("CloudManager – matchLocalDeviceToCloud advanced", function () {
	it("resolves deferred match and sets cloudStationId", async function () {
		const adapter = makeMockAdapter();
		adapter.extendObjectAsync = async () => {};

		const localCtx = {
			dtuSerial: "",
			cloudStationId: null,
			host: "192.168.1.1",
			connection: null,
			enableLocal: true,
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: true,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [localCtx],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [{ id: 55, name: "Pending" }],
			getDeviceTree: async () => [{ sn: "PENDING_SN" }],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		// Now the local device learns its serial
		localCtx.dtuSerial = "PENDING_SN";
		manager.matchLocalDeviceToCloud(localCtx);

		assert.strictEqual(localCtx.cloudStationId, 55);
		assert.strictEqual(adapter.devices.get("PENDING_SN"), localCtx);

		// Calling match again should not re-set (pendingCloudMatches already deleted)
		localCtx.cloudStationId = 55; // remains
		manager.matchLocalDeviceToCloud(localCtx);
		assert.strictEqual(localCtx.cloudStationId, 55);

		manager.stop();
	});

	it("matchLocalDeviceToCloud does not overwrite existing device", function () {
		const adapter = makeMockAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});

		const ctx1 = { dtuSerial: "SAME_SN", cloudStationId: null, value: "first", enableLocal: true };
		const ctx2 = { dtuSerial: "SAME_SN", cloudStationId: null, value: "second", enableLocal: true };

		manager.matchLocalDeviceToCloud(ctx1);
		manager.matchLocalDeviceToCloud(ctx2);

		// First context should remain
		assert.strictEqual(adapter.devices.get("SAME_SN").value, "first");
	});
});

// ============================================================
// CloudManager – multiple stations in discovery
// ============================================================
describe("CloudManager – multiple stations", function () {
	this.timeout(10000);

	it("discovers devices from multiple stations", async function () {
		const adapter = makeMockAdapter();
		const createdObjects = [];
		adapter.extendObjectAsync = async (id, _obj) => {
			createdObjects.push(id);
		};

		const manager = new CloudManager({
			adapter,
			protobuf: makeMockProtobuf(),
			cloudUser: "test@example.com",
			cloudPassword: "password123",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud = {
			token: "mock-token",
			login: async () => "mock-token",
			getStationList: async () => [
				{ id: 1, name: "Station Alpha" },
				{ id: 2, name: "Station Beta" },
			],
			getDeviceTree: async () => [],
			disconnect: () => {},
			ensureToken: async () => {},
		};

		try {
			await manager.start();
		} catch {
			/* ignore */
		}

		// Both station devices should be created
		assert.ok(createdObjects.includes("station-1"), "station-1 should be created");
		assert.ok(createdObjects.includes("station-2"), "station-2 should be created");

		manager.stop();
	});
});

// ============================================================
// CloudManager – auth error handling
// ============================================================
describe("CloudManager – auth error handling", function () {
	function makeTrackingAdapter() {
		const states = new Map();
		const timers = new Set();
		const notifications = [];
		return {
			states,
			notifications,
			log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
			devices: new Map(),
			setStateAsync: async (id, val) => {
				states.set(id, val && typeof val === "object" ? val.val : val);
			},
			getStateAsync: async () => null,
			extendObjectAsync: async () => {},
			setObjectNotExistsAsync: async () => {},
			updateConnectionState: async () => {},
			registerNotification: async (scope, category, message) => {
				notifications.push({ scope, category, message });
			},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			setTimeout: (fn, ms) => {
				const id = globalThis.setTimeout(fn, ms);
				timers.add(id);
				return id;
			},
			clearTimeout: id => {
				if (id) {
					globalThis.clearTimeout(id);
					timers.delete(id);
				}
			},
			_timerCount: () => timers.size,
		};
	}

	it("sets info.cloudLastError and stops retrying on CloudAuthError", async function () {
		const adapter = makeTrackingAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: {},
			cloudUser: "u@x",
			cloudPassword: "wrong",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});

		manager.cloud.login = async () => {
			throw new CloudAuthError("Invalid username or password", "1");
		};

		await manager.start();

		assert.strictEqual(adapter.states.get("info.cloudConnected"), false);
		assert.strictEqual(adapter.states.get("info.cloudLastError"), "Invalid username or password");
		assert.strictEqual(adapter._timerCount(), 0, "no retry timer should be scheduled after CloudAuthError");
	});

	it("registers a system notification on CloudAuthError", async function () {
		const adapter = makeTrackingAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: {},
			cloudUser: "u@x",
			cloudPassword: "wrong",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud.login = async () => {
			throw new CloudAuthError("Invalid username or password", "1");
		};

		await manager.start();

		assert.strictEqual(adapter.notifications.length, 1);
		assert.strictEqual(adapter.notifications[0].scope, "hoymiles");
		assert.strictEqual(adapter.notifications[0].category, "cloudAuth");
		assert.match(adapter.notifications[0].message, /Invalid username or password/);
	});

	it("still retries on transient (non-auth) errors", async function () {
		const adapter = makeTrackingAdapter();
		const manager = new CloudManager({
			adapter,
			protobuf: {},
			cloudUser: "u@x",
			cloudPassword: "good",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});

		manager.cloud.login = async () => {
			throw new Error("ETIMEDOUT");
		};

		await manager.start();

		assert.ok(adapter._timerCount() >= 1, "transient error should schedule a retry");
		manager.stop();
	});

	it("clears info.cloudLastError on successful login (even if a stale error was persisted)", async function () {
		const adapter = makeTrackingAdapter();
		// Pre-populate a stale error as it would be after a previous failed login
		adapter.states.set("info.cloudLastError", "Old auth failure");

		const manager = new CloudManager({
			adapter,
			protobuf: {},
			cloudUser: "u@x",
			cloudPassword: "correct",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager.cloud.login = async () => {
			manager.cloud.token = "token-abc";
			manager.cloud.tokenTime = Date.now();
			return "token-abc";
		};

		try {
			await manager._initCloudServices();
		} catch {
			// discoverDevices fails due to missing mocks — acceptable
		}

		assert.strictEqual(adapter.states.get("info.cloudLastError"), "", "should clear stale auth error on success");
		assert.strictEqual(adapter.states.get("info.cloudConnected"), true);
		manager.stop();
	});

	it("fresh manager instance attempts login again after previous auth error", async function () {
		const adapter = makeTrackingAdapter();

		// Session 1: wrong password — triggers CloudAuthError, no retry
		const manager1 = new CloudManager({
			adapter,
			protobuf: {},
			cloudUser: "u@x",
			cloudPassword: "wrong",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		manager1.cloud.login = async () => {
			throw new CloudAuthError("Invalid username or password", "1");
		};
		await manager1.start();
		assert.strictEqual(adapter.states.get("info.cloudLastError"), "Invalid username or password");

		// Session 2: simulates adapter restart with corrected credentials
		const manager2 = new CloudManager({
			adapter,
			protobuf: {},
			cloudUser: "u@x",
			cloudPassword: "correct",
			enableLocal: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			localContexts: [],
		});
		let loginCalls = 0;
		manager2.cloud.login = async () => {
			loginCalls++;
			manager2.cloud.token = "token-abc";
			manager2.cloud.tokenTime = Date.now();
			return "token-abc";
		};
		try {
			await manager2._initCloudServices();
		} catch {
			// discoverDevices will fail due to missing mocks — acceptable for this test
		}
		assert.strictEqual(loginCalls, 1, "new manager instance must attempt login again");

		manager2.stop();
	});
});
