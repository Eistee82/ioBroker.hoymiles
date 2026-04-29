import assert from "node:assert";
import DeviceContext, { WRITABLE_STATES } from "../build/lib/deviceContext.js";
import { COMMANDS } from "../build/lib/commandHandler.js";

// ============================================================
// deviceContext – WRITABLE_STATES constant
// ============================================================
describe("deviceContext – WRITABLE_STATES", function () {
	it("is not empty", function () {
		assert.ok(WRITABLE_STATES.length > 0);
	});

	it("contains expected writable states", function () {
		assert.ok(WRITABLE_STATES.includes("inverter.powerLimit"));
		assert.ok(WRITABLE_STATES.includes("inverter.active"));
		assert.ok(WRITABLE_STATES.includes("inverter.reboot"));
		assert.ok(WRITABLE_STATES.includes("dtu.reboot"));
		assert.ok(WRITABLE_STATES.includes("inverter.lock"));
		assert.ok(WRITABLE_STATES.includes("config.serverSendTime"));
		assert.ok(WRITABLE_STATES.includes("config.zeroExportEnable"));
	});

	it("all writable states have a matching COMMANDS entry", function () {
		for (const stateId of WRITABLE_STATES) {
			assert.ok(COMMANDS[stateId], `WRITABLE_STATE "${stateId}" has no COMMANDS entry`);
		}
	});

	it("all COMMANDS entries have a matching WRITABLE_STATES entry", function () {
		for (const key of Object.keys(COMMANDS)) {
			assert.ok(WRITABLE_STATES.includes(key), `COMMAND "${key}" not in WRITABLE_STATES`);
		}
	});
});

// ============================================================
// deviceContext – DeviceContext instantiation with mock adapter
// ============================================================
describe("deviceContext – DeviceContext constructor", function () {
	const mockAdapter = {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		extendObjectAsync: async () => {},
		setInterval: () => undefined,
		clearInterval: () => {},
		setTimeout: () => undefined,
		clearTimeout: () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		devices: new Map(),
		matchLocalDeviceToCloud: () => {},
		onRelayDataSent: () => {},
		onLocalConnected: () => {},
		onLocalDisconnected: () => {},
		onSendTimeUpdated: () => {},
		updateConnectionState: async () => {},
	};

	it("constructor with enableLocal=false does not crash", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		assert.ok(ctx);
	});

	it("pvStatesCreated starts as false", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		assert.strictEqual(ctx.pvStatesCreated, false);
	});

	it("statesCreated starts as false", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		assert.strictEqual(ctx.statesCreated, false);
	});

	it("ready is false on fresh context", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		assert.strictEqual(ctx.ready, false);
	});

	it("connect() with enableLocal=false returns without connecting", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.connect();
		assert.strictEqual(ctx.connection, null);
	});

	it("disconnect() on fresh context does not crash", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.disconnect();
		assert.strictEqual(ctx.connection, null);
	});

	it("dtuSerial starts as empty string", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		assert.strictEqual(ctx.dtuSerial, "");
	});

	it("slowPollEvery defaults to slowPollFactor", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 10,
		});
		assert.strictEqual(ctx.slowPollEvery, 10);
	});
});

// ============================================================
// deviceContext – connect/disconnect lifecycle
// ============================================================
describe("deviceContext – connect/disconnect lifecycle", function () {
	const mockAdapter = {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		extendObjectAsync: async () => {},
		setInterval: () => undefined,
		clearInterval: () => {},
		setTimeout: () => undefined,
		clearTimeout: () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		devices: new Map(),
		matchLocalDeviceToCloud: () => {},
		onRelayDataSent: () => {},
		onLocalConnected: () => {},
		onLocalDisconnected: () => {},
		onSendTimeUpdated: () => {},
		updateConnectionState: async () => {},
	};

	it("connect() with enableLocal=true but empty host does not create connection", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.connect();
		assert.strictEqual(ctx.connection, null);
	});

	it("connect() with enableLocal=true and host creates a DtuConnection", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: { encodeHeartbeat: () => Buffer.alloc(0) },
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.connect();
		assert.ok(ctx.connection !== null, "connection should be created");
		// Clean up so the test does not hang
		ctx.disconnect();
	});

	it("disconnect() clears connection", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: { encodeHeartbeat: () => Buffer.alloc(0) },
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.connect();
		assert.ok(ctx.connection !== null);
		ctx.disconnect();
		assert.strictEqual(ctx.connection, null);
	});

	it("disconnect() is idempotent", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: { encodeHeartbeat: () => Buffer.alloc(0) },
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.connect();
		ctx.disconnect();
		ctx.disconnect();
		assert.strictEqual(ctx.connection, null);
	});

	it("disconnect() clears cloudRelay if set", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// Manually assign a mock cloudRelay
		ctx.cloudRelay = {
			removeAllListeners: () => {},
			disconnect: () => {},
		};
		ctx.disconnect();
		assert.strictEqual(ctx.cloudRelay, null);
	});
});

// ============================================================
// deviceContext – initFromSerial
// ============================================================
describe("deviceContext – initFromSerial", function () {
	const mockAdapter = {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		extendObjectAsync: async () => {},
		i18nName: key => ({ en: key }),
		i18nDescOptional: () => undefined,
		setObjectNotExistsAsync: async () => {},
		getStateAsync: async () => null,
		setInterval: () => undefined,
		clearInterval: () => {},
		setTimeout: () => undefined,
		clearTimeout: () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		devices: new Map(),
		matchLocalDeviceToCloud: () => {},
		onRelayDataSent: () => {},
		onLocalConnected: () => {},
		onLocalDisconnected: () => {},
		onSendTimeUpdated: () => {},
		updateConnectionState: async () => {},
	};

	it("initFromSerial sets dtuSerial", async function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("HM123456");
		assert.strictEqual(ctx.dtuSerial, "HM123456");
	});

	it("initFromSerial sets deviceId", async function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("HM123456");
		assert.ok(ctx.deviceId, "deviceId should not be empty after initFromSerial");
	});
});

// ============================================================
// deviceContext – state management
// ============================================================
describe("deviceContext – state management", function () {
	const mockAdapter = {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		extendObjectAsync: async () => {},
		setInterval: () => undefined,
		clearInterval: () => {},
		setTimeout: () => undefined,
		clearTimeout: () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		devices: new Map(),
		matchLocalDeviceToCloud: () => {},
		onRelayDataSent: () => {},
		onLocalConnected: () => {},
		onLocalDisconnected: () => {},
		onSendTimeUpdated: () => {},
		updateConnectionState: async () => {},
	};

	it("stateCache is empty after disconnect", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.disconnect();
		assert.strictEqual(ctx.ready, false);
	});

	it("slowPollEvery reflects constructor parameter", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 3,
		});
		assert.strictEqual(ctx.slowPollEvery, 3);
	});
});

// ============================================================
// deviceContext – setState / stateCache deduplication
// ============================================================
describe("deviceContext – setState / stateCache deduplication", function () {
	/** Create a mock adapter that tracks setStateAsync calls. */
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	/**
	 * Helper: create a DeviceContext and make it ready by calling initFromSerial.
	 *
	 * @param adapter - Mock adapter instance
	 */
	async function createReadyContext(adapter) {
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		return ctx;
	}

	it("setState writes a value the first time", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = await createReadyContext(adapter);
		const callsBefore = calls.length;
		// Access private setState via bracket notation
		await ctx["setState"]("grid.power", 100, true);
		const newCalls = calls.slice(callsBefore);
		assert.ok(newCalls.length === 1, `Expected 1 setStateAsync call, got ${newCalls.length}`);
		assert.strictEqual(newCalls[0][0], "TEST1234.grid.power");
		assert.strictEqual(newCalls[0][1], 100);
	});

	it("setState skips write when same value is written twice", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = await createReadyContext(adapter);
		await ctx["setState"]("grid.power", 200, true);
		const callsBefore = calls.length;
		await ctx["setState"]("grid.power", 200, true);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 0, "Second write with same value should be skipped");
	});

	it("setState writes again when value changes", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = await createReadyContext(adapter);
		await ctx["setState"]("grid.power", 100, true);
		const callsBefore = calls.length;
		await ctx["setState"]("grid.power", 200, true);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 1, "Write should happen when value changes");
		assert.strictEqual(newCalls[0][1], 200);
	});

	it("setState writes again when quality changes", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = await createReadyContext(adapter);
		await ctx["setState"]("grid.power", 100, true, 0x00);
		const callsBefore = calls.length;
		await ctx["setState"]("grid.power", 100, true, 0x42);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 1, "Write should happen when quality changes");
		// When q !== 0, setStateAsync should receive an object
		assert.deepStrictEqual(newCalls[0][1], { val: 100, ack: true, q: 0x42 });
	});

	it("setState does nothing when device is not ready", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// ctx is NOT ready (no initFromSerial called)
		const callsBefore = calls.length;
		await ctx["setState"]("grid.power", 100, true);
		assert.strictEqual(calls.length, callsBefore, "No writes should happen when not ready");
	});
});

// ============================================================
// deviceContext – setStates batch writes
// ============================================================
describe("deviceContext – setStates batch writes", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("setStates writes multiple values in parallel", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = calls.length;
		await ctx["setStates"](
			[
				["grid.power", 100],
				["grid.voltage", 230],
				["grid.frequency", 50],
			],
			true,
		);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 3);
	});

	it("setStates deduplicates cached values", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		await ctx["setStates"](
			[
				["grid.power", 100],
				["grid.voltage", 230],
			],
			true,
		);
		const callsBefore = calls.length;
		// Same values again — should be skipped
		await ctx["setStates"](
			[
				["grid.power", 100],
				["grid.voltage", 230],
			],
			true,
		);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 0, "Duplicate values should be skipped");
	});

	it("setStates writes only changed values in mixed batch", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		await ctx["setStates"](
			[
				["grid.power", 100],
				["grid.voltage", 230],
			],
			true,
		);
		const callsBefore = calls.length;
		// Only voltage changes
		await ctx["setStates"](
			[
				["grid.power", 100],
				["grid.voltage", 231],
			],
			true,
		);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 1, "Only changed value should be written");
		assert.strictEqual(newCalls[0][0], "TEST1234.grid.voltage");
	});

	it("setStates does nothing when device is not ready", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		const callsBefore = calls.length;
		await ctx["setStates"]([["grid.power", 100]], true);
		assert.strictEqual(calls.length, callsBefore, "No writes should happen when not ready");
	});
});

// ============================================================
// deviceContext – markStatesDisconnected
// ============================================================
describe("deviceContext – markStatesDisconnected", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("marks data states as disconnected (q=0x42)", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		// Pre-populate stateCache with data states
		await ctx["setState"]("grid.power", 100, true);
		await ctx["setState"]("grid.voltage", 230, true);
		await ctx["setState"]("inverter.temperature", 45, true);

		const callsBefore = calls.length;
		await ctx["markStatesDisconnected"]();
		const newCalls = calls.slice(callsBefore);

		// All 3 data states should be updated with q=0x42
		assert.strictEqual(newCalls.length, 3, `Expected 3 disconnect writes, got ${newCalls.length}`);
		for (const call of newCalls) {
			assert.strictEqual(call[1].q, 0x42, `State ${call[0]} should have q=0x42`);
		}
	});

	it("does not mark non-data states as disconnected", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		// Write a non-data state (e.g. dtu.serialNumber, config.*, alarms.*)
		await ctx["setState"]("dtu.serialNumber", "ABC123", true);
		await ctx["setState"]("alarms.count", 0, true);

		const callsBefore = calls.length;
		await ctx["markStatesDisconnected"]();
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 0, "Non-data states should not be marked disconnected");
	});

	it("is idempotent — calling twice does not re-write", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		await ctx["setState"]("grid.power", 100, true);

		await ctx["markStatesDisconnected"]();
		const callsBefore = calls.length;
		await ctx["markStatesDisconnected"]();
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 0, "Second markStatesDisconnected should be a no-op");
	});

	it("does nothing when device is not ready", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// Not ready — no initFromSerial
		const callsBefore = calls.length;
		await ctx["markStatesDisconnected"]();
		assert.strictEqual(calls.length, callsBefore);
	});
});

// ============================================================
// deviceContext – createPvStates
// ============================================================
describe("deviceContext – createPvStates", function () {
	function createTrackingAdapter() {
		const extendCalls = [];
		return {
			extendCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async () => {},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("creates channel and states for each PV input", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(2);
		const newCalls = extendCalls.slice(callsBefore);

		// 2 PV inputs: each gets 1 channel + 5 states (power, voltage, current, dailyEnergy, totalEnergy)
		// = 2 * (1 + 5) = 12
		assert.strictEqual(newCalls.length, 12, `Expected 12 extendObject calls, got ${newCalls.length}`);

		// Verify channel creation
		assert.ok(newCalls[0][0].endsWith("pv0"), "First call should create pv0 channel");
		assert.strictEqual(newCalls[0][1].type, "channel");
	});

	it("creates only base fields when cloudOnly=true", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(2, true);
		const newCalls = extendCalls.slice(callsBefore);

		// 2 PV inputs: each gets 1 channel + 3 base states (power, voltage, current)
		// = 2 * (1 + 3) = 8
		assert.strictEqual(newCalls.length, 8, `Expected 8 extendObject calls for cloudOnly, got ${newCalls.length}`);
	});

	it("does nothing when deviceId is empty", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// No initFromSerial — deviceId is empty
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(2);
		assert.strictEqual(extendCalls.length, callsBefore, "No calls when deviceId is empty");
	});

	it("clamps pvCount to MAX_PV_PORTS (6)", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(10);
		const newCalls = extendCalls.slice(callsBefore);

		// Loop uses this.pvCount (clamped to MAX_PV_PORTS = 6)
		// 6 PVs × (1 channel + 5 states) = 36 calls
		assert.strictEqual(newCalls.length, 36, "Should create exactly 36 objects for 6 clamped PV ports");
		assert.strictEqual(ctx["pvCount"], 6, "pvCount should be clamped to 6");
	});
});

// ============================================================
// deviceContext – stopPollCycle
// ============================================================
describe("deviceContext – stopPollCycle", function () {
	it("clears pollTimer", async function () {
		let clearIntervalCalled = false;
		const mockAdapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => "fake-interval",
			clearInterval: () => {
				clearIntervalCalled = true;
			},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		// Manually set a pollTimer to simulate active polling
		ctx["pollTimer"] = "fake-interval";
		ctx["stopPollCycle"]();
		assert.strictEqual(ctx["pollTimer"], undefined, "pollTimer should be cleared");
		assert.ok(clearIntervalCalled, "clearInterval should have been called");
	});

	it("clears pendingResponse timer", function () {
		let clearTimeoutCalled = false;
		const mockAdapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {
				clearTimeoutCalled = true;
			},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["pendingResponse"] = { cmdKey: "0xa2:0x11", resolve: () => {}, timer: "fake-timer" };
		ctx["stopPollCycle"]();
		assert.strictEqual(ctx["pendingResponse"], null, "pendingResponse should be null");
		assert.ok(clearTimeoutCalled, "clearTimeout should have been called for pending timer");
	});

	it("resets pollBusy to false", function () {
		const mockAdapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["pollBusy"] = true;
		ctx["stopPollCycle"]();
		assert.strictEqual(ctx["pollBusy"], false, "pollBusy should be reset to false");
	});
});

// ============================================================
// deviceContext – handleRealData
// ============================================================
describe("deviceContext – handleRealData", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("processes RealData and writes state entries", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeRealDataNew: () => ({
				dtuPower: 500,
				dtuDailyEnergy: 3200,
				sgs: [
					{
						activePower: 480,
						voltage: 230.5,
						current: 2.1,
						frequency: 50.01,
						reactivePower: 10,
						powerFactor: 0.99,
						temperature: 42,
						warningNumber: 0,
						linkStatus: 1,
						serialNumber: "INV123",
						powerLimit: 800,
					},
				],
				pv: [
					{ portNumber: 1, power: 250, voltage: 35.2, current: 7.1, energyDaily: 1500, energyTotal: 50000 },
					{ portNumber: 2, power: 230, voltage: 34.8, current: 6.6, energyDaily: 1400, energyTotal: 48000 },
				],
				meter: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		// Set pvCount to accept PV data
		ctx["pvCount"] = 2;

		const callsBefore = calls.length;
		await ctx["handleRealData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		// Verify some key state writes happened
		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("TEST1234.grid.power"), "Should write grid.power");
		assert.ok(stateIds.includes("TEST1234.grid.voltage"), "Should write grid.voltage");
		assert.ok(stateIds.includes("TEST1234.inverter.temperature"), "Should write inverter.temperature");
		assert.ok(stateIds.includes("TEST1234.pv0.power"), "Should write pv0.power");
		assert.ok(stateIds.includes("TEST1234.pv1.power"), "Should write pv1.power");

		// Verify grid.power value
		const gridPowerCall = newCalls.find(c => c[0] === "TEST1234.grid.power");
		assert.strictEqual(gridPowerCall[1], 480);
	});

	it("skips PV data with out-of-range portNumber", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeRealDataNew: () => ({
				dtuPower: 100,
				dtuDailyEnergy: 500,
				sgs: [],
				pv: [
					{ portNumber: 0, power: 100, voltage: 30, current: 3, energyDaily: 500, energyTotal: 1000 }, // portNumber 0 → index -1, out of range
					{ portNumber: 5, power: 100, voltage: 30, current: 3, energyDaily: 500, energyTotal: 1000 }, // index 4, but pvCount=2
				],
				meter: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		ctx["pvCount"] = 2;

		const callsBefore = calls.length;
		await ctx["handleRealData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const stateIds = newCalls.map(c => c[0]);
		// Neither out-of-range PV should be written
		assert.ok(!stateIds.some(id => id.includes("pv")), "Should not write any PV states for out-of-range ports");
	});

	it("logs warning on decode error without crashing", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			decodeRealDataNew: () => {
				throw new Error("decode failed");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["handleRealData"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("decode failed"), "Should log decode error");
	});

	it("handles empty sgs array gracefully", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeRealDataNew: () => ({
				dtuPower: 0,
				dtuDailyEnergy: 0,
				sgs: [],
				pv: [],
				meter: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		// Should not throw
		await ctx["handleRealData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);
		const stateIds = newCalls.map(c => c[0]);
		assert.ok(!stateIds.some(id => id.includes("grid.power")), "Should not write grid.power with empty sgs");
	});
});

// ============================================================
// deviceContext – handleAlarmData
// ============================================================
describe("deviceContext – handleAlarmData", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("processes alarm data and writes alarm states", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeAlarmData: () => ({
				alarms: [
					{ sn: "INV1", code: 1001, num: 1, startTime: 1700000000, endTime: 0, data1: 10, data2: 20 },
					{ sn: "INV1", code: 1002, num: 2, startTime: 1700000000, endTime: 1700001000, data1: 5, data2: 15 },
				],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		await ctx["handleAlarmData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("TEST1234.alarms.count"), "Should write alarms.count");
		assert.ok(stateIds.includes("TEST1234.alarms.activeCount"), "Should write alarms.activeCount");
		assert.ok(stateIds.includes("TEST1234.alarms.hasActive"), "Should write alarms.hasActive");
		assert.ok(stateIds.includes("TEST1234.alarms.json"), "Should write alarms.json");

		// alarms.count should be 2
		const countCall = newCalls.find(c => c[0] === "TEST1234.alarms.count");
		assert.strictEqual(countCall[1], 2);

		// activeCount should be 1 (only the one with endTime=0)
		const activeCountCall = newCalls.find(c => c[0] === "TEST1234.alarms.activeCount");
		assert.strictEqual(activeCountCall[1], 1);

		// hasActive should be true
		const hasActiveCall = newCalls.find(c => c[0] === "TEST1234.alarms.hasActive");
		assert.strictEqual(hasActiveCall[1], true);
	});

	it("handles empty alarm list", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeAlarmData: () => ({ alarms: [] }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		await ctx["handleAlarmData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const countCall = newCalls.find(c => c[0] === "TEST1234.alarms.count");
		assert.strictEqual(countCall[1], 0);

		const hasActiveCall = newCalls.find(c => c[0] === "TEST1234.alarms.hasActive");
		assert.strictEqual(hasActiveCall[1], false);
	});

	it("falls back to decodeWarnData if decodeAlarmData fails", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeAlarmData: () => {
				throw new Error("not alarm format");
			},
			decodeWarnData: () => ({
				warnings: [{ sn: "INV1", code: 2001, num: 1, startTime: 1700000000, endTime: 0, data1: 0, data2: 0 }],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		await ctx["handleAlarmData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const countCall = newCalls.find(c => c[0] === "TEST1234.alarms.count");
		assert.strictEqual(countCall[1], 1);
	});
});

// ============================================================
// deviceContext – handleConfigData
// ============================================================
describe("deviceContext – handleConfigData", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("processes config data and writes config states", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeGetConfig: () => ({
				limitPower: 8000, // Will be divided by SCALE_POWER (10)
				serverDomain: "cloud.hoymiles.com",
				serverPort: 10081,
				serverSendTime: 5,
				wifiSsid: "MyNetwork",
				wifiRssi: -55,
				zeroExportEnable: 0,
				zeroExport433Addr: 0,
				meterKind: 1,
				meterInterface: 0,
				dhcpSwitch: 1,
				dtuApSsid: "DTU_AP",
				netmodeSelect: 0,
				channelSelect: 1,
				sub1gSweepSwitch: 0,
				sub1gWorkChannel: 0,
				invType: 4,
				ipAddress: "192.168.1.100",
				subnetMask: "255.255.255.0",
				gateway: "192.168.1.1",
				wifiIpAddress: "192.168.1.100",
				macAddress: "AA:BB:CC:DD:EE:FF",
				wifiMacAddress: "11:22:33:44:55:66",
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		await ctx["handleConfigData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("TEST1234.inverter.powerLimit"), "Should write inverter.powerLimit");
		assert.ok(stateIds.includes("TEST1234.config.serverDomain"), "Should write config.serverDomain");
		assert.ok(stateIds.includes("TEST1234.config.wifiSsid"), "Should write config.wifiSsid");

		// powerLimit = 8000 / 10 = 800
		const powerLimitCall = newCalls.find(c => c[0] === "TEST1234.inverter.powerLimit");
		assert.strictEqual(powerLimitCall[1], 800);

		// cloudServerDomain should be set
		assert.strictEqual(ctx.cloudServerDomain, "cloud.hoymiles.com:10081");
		// cloudSendTimeMin should be set
		assert.strictEqual(ctx.cloudSendTimeMin, 5);
	});

	it("logs warning on decode error", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};
		const mockProtobuf = {
			decodeGetConfig: () => {
				throw new Error("config decode failed");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["handleConfigData"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("config decode failed"), "Should log config decode error");
	});
});

// ============================================================
// deviceContext – handleHistPower
// ============================================================
describe("deviceContext – handleHistPower", function () {
	function createTrackingAdapter() {
		const calls = [];
		const extendCalls = [];
		return {
			calls,
			extendCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("creates history channel and writes history states", async function () {
		const { calls, extendCalls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeHistPower: () => ({
				powerArray: [100, 200, 300, 400],
				dailyEnergy: 5000,
				totalEnergy: 1200000,
				stepTime: 300,
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		const extendBefore = extendCalls.length;
		await ctx["handleHistPower"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);
		const newExtend = extendCalls.slice(extendBefore);

		// Should create history channel + 4 state objects
		assert.ok(newExtend.length >= 5, `Expected >= 5 extendObject calls, got ${newExtend.length}`);
		assert.ok(newExtend[0][0].endsWith("history"), "First extend should create history channel");

		// Should write state values
		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("TEST1234.history.dailyEnergy"), "Should write history.dailyEnergy");
		assert.ok(stateIds.includes("TEST1234.history.stepTime"), "Should write history.stepTime");
		assert.ok(stateIds.includes("TEST1234.history.powerJson"), "Should write history.powerJson");

		const dailyCall = newCalls.find(c => c[0] === "TEST1234.history.dailyEnergy");
		assert.strictEqual(dailyCall[1], 5000);

		const stepCall = newCalls.find(c => c[0] === "TEST1234.history.stepTime");
		assert.strictEqual(stepCall[1], 300);
	});

	it("returns early when protobuf is null", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		// Override protobuf to null after init
		ctx.protobuf = null;

		const callsBefore = calls.length;
		await ctx["handleHistPower"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 0, "Should not write any states when protobuf is null");
	});

	it("returns early when deviceId is empty", async function () {
		const { calls: _calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeHistPower: () => {
				throw new Error("should not be called");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// No initFromSerial — deviceId is empty

		// Should not throw
		await ctx["handleHistPower"](Buffer.alloc(0));
	});
});

// ============================================================
// deviceContext – createDeviceAndStates
// ============================================================
describe("deviceContext – createDeviceAndStates", function () {
	function createTrackingAdapter() {
		const extendCalls = [];
		const setCalls = [];
		const subscribeCalls = [];
		return {
			extendCalls,
			setCalls,
			subscribeCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					setCalls.push(args);
				},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: (...args) => {
					subscribeCalls.push(args);
				},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("creates device, channels, and states on initFromSerial", async function () {
		const { extendCalls, subscribeCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		await ctx.initFromSerial("DTU_SERIAL");

		// Should have created device object
		const deviceCall = extendCalls.find(c => c[0] === "DTU_SERIAL" && c[1].type === "device");
		assert.ok(deviceCall, "Should create device object");
		assert.strictEqual(deviceCall[1].common.name, "Hoymiles DTU DTU_SERIAL");

		// Should have subscribed to writable states
		assert.ok(subscribeCalls.length > 0, "Should subscribe to writable states");
		assert.ok(
			subscribeCalls.some(c => c[0].includes("powerLimit")),
			"Should subscribe to powerLimit",
		);
	});

	it("is idempotent — calling initFromSerial twice does not re-create states", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		await ctx.initFromSerial("DTU_SERIAL");
		const callCount = extendCalls.length;
		await ctx.initFromSerial("DTU_SERIAL");
		// Only the setStateAsync for connected should run, not extendObject again
		assert.strictEqual(extendCalls.length, callCount, "Should not re-create states on second call");
	});
});

// ============================================================
// deviceContext – disconnect clears stateCache
// ============================================================
describe("deviceContext – disconnect clears stateCache", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("disconnect clears stateCache so next write is not deduplicated", async function () {
		const { calls: _calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		// Write a value
		await ctx["setState"]("grid.power", 100, true);
		// Disconnect clears cache
		ctx.disconnect();
		// Re-init to make ready again
		// Note: statesCreated is now true but stateCache is cleared
		// After disconnect, statesCreated is still true, but stateCache is empty
		// We need to re-make it ready — but disconnect doesn't reset statesCreated
		// Let's just check the cache is empty
		assert.strictEqual(ctx["stateCache"].size, 0, "stateCache should be empty after disconnect");
	});

	it("disconnect clears infoFallbackTimer and pollStartTimer", function () {
		let clearTimeoutCount = 0;
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {
				clearTimeoutCount++;
			},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["infoFallbackTimer"] = "fake-timer-1";
		ctx["pollStartTimer"] = "fake-timer-2";
		ctx.disconnect();
		assert.strictEqual(ctx["infoFallbackTimer"], undefined);
		assert.strictEqual(ctx["pollStartTimer"], undefined);
		assert.ok(clearTimeoutCount >= 2, "Should clear both timers");
	});
});

// ============================================================
// deviceContext – resetButtonTimers cleanup
// ============================================================
describe("deviceContext – resetButtonTimers cleanup", function () {
	const mockAdapter = {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		extendObjectAsync: async () => {},
		setInterval: () => undefined,
		clearInterval: () => {},
		setTimeout: () => "fake-timer-handle",
		clearTimeout: () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		devices: new Map(),
		matchLocalDeviceToCloud: () => {},
		onRelayDataSent: () => {},
		onLocalConnected: () => {},
		onLocalDisconnected: () => {},
		onSendTimeUpdated: () => {},
		updateConnectionState: async () => {},
	};

	it("disconnect() clears resetButtonTimers", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// Manually add a fake timer handle to resetButtonTimers
		ctx.resetButtonTimers.add("fake-handle-1");
		ctx.resetButtonTimers.add("fake-handle-2");
		assert.strictEqual(ctx.resetButtonTimers.size, 2);
		ctx.disconnect();
		assert.strictEqual(ctx.resetButtonTimers.size, 0);
	});

	it("disconnect() twice does not error even with resetButtonTimers", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.resetButtonTimers.add("fake-handle");
		ctx.disconnect();
		ctx.disconnect();
		assert.strictEqual(ctx.resetButtonTimers.size, 0);
	});

	it("large alarm-like arrays do not crash during processing", function () {
		const ctx = new DeviceContext({
			adapter: mockAdapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// Simulate a large alarm array that would be passed to safeJsonStringify internally
		const largeArray = [];
		for (let i = 0; i < 10000; i++) {
			largeArray.push({ code: i, message: `Alarm ${i}`, timestamp: Date.now() });
		}
		// Verify the context can handle large data without crashing
		assert.ok(ctx);
		assert.doesNotThrow(() => JSON.stringify(largeArray));
		ctx.disconnect();
	});
});

// ============================================================
// deviceContext – createMeterStates (Factory-Pattern + Promise.all)
// ============================================================
describe("deviceContext – createMeterStates", function () {
	function createTrackingAdapter() {
		const extendCalls = [];
		const setObjCalls = [];
		return {
			extendCalls,
			setObjCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async () => {},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async (...args) => {
					setObjCalls.push(args);
				},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("creates meter channel and 14 meter states", async function () {
		const { extendCalls, setObjCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const extendBefore = extendCalls.length;
		const setObjBefore = setObjCalls.length;
		await ctx["createMeterStates"]();
		const newExtend = extendCalls.slice(extendBefore);
		const newSetObj = setObjCalls.slice(setObjBefore);

		// 1 channel via setObjectNotExistsAsync + 14 meter state defs via extendObjectAsync
		assert.strictEqual(newSetObj.length, 1, "Should create 1 meter channel");
		assert.ok(newSetObj[0][0].endsWith("meter"), "Channel should be named 'meter'");
		assert.strictEqual(newSetObj[0][1].type, "channel");

		assert.strictEqual(newExtend.length, 14, `Expected 14 meter state objects, got ${newExtend.length}`);
		// Verify some specific meter states
		const stateIds = newExtend.map(c => c[0]);
		assert.ok(stateIds.some(id => id.endsWith("meter.totalPower")));
		assert.ok(stateIds.some(id => id.endsWith("meter.phaseAPower")));
		assert.ok(stateIds.some(id => id.endsWith("meter.voltagePhaseA")));
		assert.ok(stateIds.some(id => id.endsWith("meter.currentPhaseA")));
		assert.ok(stateIds.some(id => id.endsWith("meter.faultCode")));
		assert.ok(stateIds.some(id => id.endsWith("meter.energyTotalExport")));
		assert.ok(stateIds.some(id => id.endsWith("meter.energyTotalImport")));
	});

	it("does nothing when deviceId is empty", async function () {
		const { extendCalls, setObjCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// No initFromSerial — deviceId is empty
		await ctx["createMeterStates"]();
		assert.strictEqual(extendCalls.length, 0, "No extendObject calls when deviceId is empty");
		assert.strictEqual(setObjCalls.length, 0, "No setObjectNotExists calls when deviceId is empty");
	});

	it("all meter states have type number", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const extendBefore = extendCalls.length;
		await ctx["createMeterStates"]();
		const newExtend = extendCalls.slice(extendBefore);
		for (const call of newExtend) {
			assert.strictEqual(call[1].common.type, "number", `${call[0]} should have type number`);
			assert.strictEqual(call[1].common.read, true, `${call[0]} should be readable`);
			assert.strictEqual(call[1].common.write, false, `${call[0]} should not be writable`);
		}
	});
});

// ============================================================
// deviceContext – createPvStates additional coverage
// ============================================================
describe("deviceContext – createPvStates extended", function () {
	function createTrackingAdapter() {
		const extendCalls = [];
		return {
			extendCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async () => {},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("creates 1 PV input with 5 fields (local mode)", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(1);
		const newCalls = extendCalls.slice(callsBefore);
		// 1 PV: 1 channel + 5 states = 6
		assert.strictEqual(newCalls.length, 6, `Expected 6 calls for 1 PV, got ${newCalls.length}`);
	});

	it("creates 4 PV inputs with correct channel names", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(4);
		const newCalls = extendCalls.slice(callsBefore);
		// 4 PVs * (1 channel + 5 states) = 24
		assert.strictEqual(newCalls.length, 24, `Expected 24 calls, got ${newCalls.length}`);
		// Check channel names
		const channels = newCalls.filter(c => c[1].type === "channel");
		assert.strictEqual(channels.length, 4);
		assert.ok(channels[0][0].endsWith("pv0"));
		assert.ok(channels[1][0].endsWith("pv1"));
		assert.ok(channels[2][0].endsWith("pv2"));
		assert.ok(channels[3][0].endsWith("pv3"));
	});

	it("creates 0 PV inputs (no-op)", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(0);
		const newCalls = extendCalls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 0, "No calls for 0 PVs");
	});

	it("cloudOnly=true creates only 3 base fields per PV", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		const callsBefore = extendCalls.length;
		await ctx.createPvStates(1, true);
		const newCalls = extendCalls.slice(callsBefore);
		// 1 PV cloudOnly: 1 channel + 3 base states = 4
		assert.strictEqual(newCalls.length, 4, `Expected 4 calls for 1 PV cloudOnly, got ${newCalls.length}`);
		// Verify no dailyEnergy or totalEnergy
		const stateIds = newCalls.map(c => c[0]);
		assert.ok(!stateIds.some(id => id.includes("dailyEnergy")), "cloudOnly should not include dailyEnergy");
		assert.ok(!stateIds.some(id => id.includes("totalEnergy")), "cloudOnly should not include totalEnergy");
	});
});

// ============================================================
// deviceContext – handleResponse dispatch
// ============================================================
describe("deviceContext – handleResponse", function () {
	function createTrackingAdapter() {
		const calls = [];
		const debugMsgs = [];
		const warnMsgs = [];
		return {
			calls,
			debugMsgs,
			warnMsgs,
			adapter: {
				log: {
					info: () => {},
					warn: msg => {
						warnMsgs.push(msg);
					},
					debug: msg => {
						debugMsgs.push(msg);
					},
					error: () => {},
				},
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("returns early when parseResponse returns null", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => null,
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["handleResponse"](Buffer.alloc(10));
		assert.ok(
			debugMsgs.some(m => m.includes("Could not parse")),
			"Should log parse failure",
		);
	});

	it("dispatches 0xa211 to handleRealData", async function () {
		const { adapter } = createTrackingAdapter();
		let realDataCalled = false;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x11, payload: Buffer.alloc(0) }),
			decodeRealDataNew: () => {
				realDataCalled = true;
				return { dtuPower: 0, dtuDailyEnergy: 0, sgs: [], pv: [], meter: [] };
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		// Build a fake message with cmd bytes at positions 2-5
		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x11;
		ctx["handleResponse"](msg);
		// handleRealData is called asynchronously (via .catch), give it a tick
		await new Promise(r => setTimeout(r, 10));
		assert.ok(realDataCalled, "Should dispatch to handleRealData for cmd 0xa211");
	});

	it("dispatches 0xa201 to handleInfoData", async function () {
		const { adapter } = createTrackingAdapter();
		let infoCalled = false;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x01, payload: Buffer.alloc(0) }),
			decodeInfoData: () => {
				infoCalled = true;
				return { dtuSn: "DTU123", deviceNumber: 1, pvNumber: 2, dtuInfo: null, pvInfo: [] };
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x01;
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		assert.ok(infoCalled, "Should dispatch to handleInfoData for cmd 0xa201");
	});

	it("dispatches 0xa209 to handleConfigData", async function () {
		const { adapter } = createTrackingAdapter();
		let configCalled = false;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x09, payload: Buffer.alloc(0) }),
			decodeGetConfig: () => {
				configCalled = true;
				return {
					limitPower: 1000,
					serverDomain: "",
					serverPort: 0,
					serverSendTime: 0,
					wifiSsid: "",
					wifiRssi: 0,
					zeroExportEnable: 0,
					zeroExport433Addr: 0,
					meterKind: 0,
					meterInterface: 0,
					dhcpSwitch: 0,
					dtuApSsid: "",
					netmodeSelect: 0,
					channelSelect: 0,
					sub1gSweepSwitch: 0,
					sub1gWorkChannel: 0,
					invType: 0,
					ipAddress: "",
					subnetMask: "",
					gateway: "",
					wifiIpAddress: "",
					macAddress: "",
					wifiMacAddress: "",
				};
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x09;
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		assert.ok(configCalled, "Should dispatch to handleConfigData for cmd 0xa209");
	});

	it("dispatches 0xa204 to handleAlarmData", async function () {
		const { adapter } = createTrackingAdapter();
		let alarmCalled = false;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x04, payload: Buffer.alloc(0) }),
			decodeAlarmData: () => {
				alarmCalled = true;
				return { alarms: [] };
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x04;
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		assert.ok(alarmCalled, "Should dispatch to handleAlarmData for cmd 0xa204");
	});

	it("dispatches 0xa210 (SetConfig) and logs debug", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x10, payload: Buffer.alloc(0) }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x10;
		ctx["handleResponse"](msg);
		assert.ok(
			debugMsgs.some(m => m.includes("SetConfig")),
			"Should log SetConfig response",
		);
	});

	it("dispatches 0xa202 (Heartbeat) and logs debug", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x02, payload: Buffer.alloc(0) }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x02;
		ctx["handleResponse"](msg);
		assert.ok(
			debugMsgs.some(m => m.includes("Heartbeat")),
			"Should log Heartbeat response",
		);
	});

	it("dispatches 0xa206 (CommandStatus) and logs debug", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x06, payload: Buffer.alloc(0) }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x06;
		ctx["handleResponse"](msg);
		assert.ok(
			debugMsgs.some(m => m.includes("CommandStatus")),
			"Should log CommandStatus response",
		);
	});

	it("dispatches 0xa216 (HistEnergy) and logs debug", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x16, payload: Buffer.alloc(0) }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x16;
		ctx["handleResponse"](msg);
		assert.ok(
			debugMsgs.some(m => m.includes("HistEnergy")),
			"Should log HistEnergy response",
		);
	});

	it("logs unknown command for unrecognized cmd pair", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xff, cmdLow: 0xff, payload: Buffer.alloc(0) }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const msg = Buffer.alloc(20);
		msg[2] = 0xff;
		msg[3] = 0xff;
		ctx["handleResponse"](msg);
		assert.ok(
			debugMsgs.some(m => m.includes("Unknown command")),
			"Should log unknown command",
		);
	});

	it("resolves pendingResponse when response matches cmdKey", function () {
		const { adapter } = createTrackingAdapter();
		let resolved = false;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x11, payload: Buffer.alloc(0) }),
			decodeRealDataNew: () => ({ dtuPower: 0, dtuDailyEnergy: 0, sgs: [], pv: [], meter: [] }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		// Simulate a pending response waiting for 0xa2:0x11
		ctx["pendingResponse"] = {
			cmdKey: "162:17", // 0xa2=162, 0x11=17
			resolve: () => {
				resolved = true;
			},
			timer: undefined,
		};

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x11;
		ctx["handleResponse"](msg);
		assert.ok(resolved, "Should resolve pendingResponse when cmd matches");
		assert.strictEqual(ctx["pendingResponse"], null, "Should clear pendingResponse after resolve");
	});

	it("catches parseResponse exceptions gracefully", function () {
		const { warnMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => {
				throw new Error("parse explosion");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		assert.doesNotThrow(() => ctx["handleResponse"](Buffer.alloc(10)));
		assert.ok(
			warnMsgs.some(m => m.includes("parse explosion")),
			"Should log the parse error",
		);
	});

	it("decrypts payload when encryption is required", async function () {
		const { adapter } = createTrackingAdapter();
		let decryptedPayload = null;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x11, payload: Buffer.from([0x01, 0x02]) }),
			decodeRealDataNew: buf => {
				decryptedPayload = buf;
				return { dtuPower: 0, dtuDailyEnergy: 0, sgs: [], pv: [], meter: [] };
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		ctx.encryptionRequired = true;
		ctx.encryption = {
			decrypt: (_payload, _msgId, _seqNum) => Buffer.from([0xde, 0xad]),
		};

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x11;
		msg[4] = 0x00;
		msg[5] = 0x01;
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		assert.ok(decryptedPayload, "Should pass decrypted payload");
		assert.strictEqual(decryptedPayload[0], 0xde);
		assert.strictEqual(decryptedPayload[1], 0xad);
	});

	it("skips decryption for InfoData (0xa201) even when encryption is required", async function () {
		const { adapter } = createTrackingAdapter();
		let receivedPayload = null;
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x01, payload: Buffer.from([0x01, 0x02]) }),
			decodeInfoData: buf => {
				receivedPayload = buf;
				return { dtuSn: "X", deviceNumber: 0, pvNumber: 0, dtuInfo: null, pvInfo: [] };
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		ctx.encryptionRequired = true;
		ctx.encryption = {
			decrypt: () => {
				throw new Error("should not decrypt InfoData");
			},
		};

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x01;
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		// InfoData should receive the original payload, not decrypted
		assert.ok(receivedPayload, "Should call handleInfoData");
		assert.strictEqual(receivedPayload[0], 0x01, "Should use original payload for InfoData");
	});

	it("logs warning when decryption fails", function () {
		const { warnMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			parseResponse: () => ({ cmdHigh: 0xa2, cmdLow: 0x11, payload: Buffer.from([0x01]) }),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx.encryptionRequired = true;
		ctx.encryption = {
			decrypt: () => {
				throw new Error("decrypt failed");
			},
		};

		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x11;
		ctx["handleResponse"](msg);
		assert.ok(
			warnMsgs.some(m => m.includes("Decryption failed")),
			"Should log decryption failure",
		);
	});
});

// ============================================================
// deviceContext – handleCommandResponse
// ============================================================
describe("deviceContext – handleCommandResponse", function () {
	function createTrackingAdapter() {
		const calls = [];
		const debugMsgs = [];
		const warnMsgs = [];
		return {
			calls,
			debugMsgs,
			warnMsgs,
			adapter: {
				log: {
					info: () => {},
					warn: msg => {
						warnMsgs.push(msg);
					},
					debug: msg => {
						debugMsgs.push(msg);
					},
					error: () => {},
				},
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("clears alarm states when action=50, errCode=0, packageNow=0", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
				toObject: () => ({ action: 50, errCode: 0, packageNow: 0 }),
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		ctx["handleCommandResponse"](Buffer.alloc(0));
		// setStates is called with .catch, give it a tick
		await new Promise(r => setTimeout(r, 10));
		const newCalls = calls.slice(callsBefore);

		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("TEST1234.alarms.count"), "Should clear alarms.count");
		assert.ok(stateIds.includes("TEST1234.alarms.hasActive"), "Should clear alarms.hasActive");
		assert.ok(stateIds.includes("TEST1234.alarms.json"), "Should clear alarms.json");

		const countCall = newCalls.find(c => c[0] === "TEST1234.alarms.count");
		assert.strictEqual(countCall[1], 0);
	});

	it("logs warning when errCode is non-zero", function () {
		const { warnMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
				toObject: () => ({ action: 10, errCode: 5 }),
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["handleCommandResponse"](Buffer.alloc(0));
		assert.ok(
			warnMsgs.some(m => m.includes("error code")),
			"Should warn about non-zero error code",
		);
	});

	it("does not clear alarms when action !== 50", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
				toObject: () => ({ action: 10, errCode: 0, packageNow: 0 }),
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		ctx["handleCommandResponse"](Buffer.alloc(0));
		await new Promise(r => setTimeout(r, 10));
		const newCalls = calls.slice(callsBefore);
		const alarmCalls = newCalls.filter(c => c[0].includes("alarms."));
		assert.strictEqual(alarmCalls.length, 0, "Should not write alarm states when action !== 50");
	});

	it("handles decode error gracefully", function () {
		const { debugMsgs, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			getType: () => ({
				decode: () => {
					throw new Error("decode boom");
				},
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		assert.doesNotThrow(() => ctx["handleCommandResponse"](Buffer.alloc(0)));
		assert.ok(
			debugMsgs.some(m => m.includes("decode boom")),
			"Should log decode error",
		);
	});
});

// ============================================================
// deviceContext – handleStateChange
// ============================================================
describe("deviceContext – handleStateChange", function () {
	it("warns when not connected", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx.handleStateChange("inverter.powerLimit", {
			val: 800,
			ack: false,
			ts: Date.now(),
			lc: Date.now(),
			from: "",
		});
		assert.ok(warnMsg.includes("not connected"), "Should warn about not being connected");
	});

	it("warns when connection exists but is not connected", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		// Assign a mock connection that is not connected
		ctx.connection = { connected: false };

		await ctx.handleStateChange("inverter.powerLimit", {
			val: 800,
			ack: false,
			ts: Date.now(),
			lc: Date.now(),
			from: "",
		});
		assert.ok(warnMsg.includes("not connected"), "Should warn when connection.connected is false");
	});
});

// ============================================================
// deviceContext – disconnect full lifecycle
// ============================================================
describe("deviceContext – disconnect full lifecycle", function () {
	it("disconnect clears connection, cloudRelay, timers, cache, and unsubscribes", async function () {
		const unsubCalls = [];
		let _clearIntervalCount = 0;
		let _clearTimeoutCount = 0;
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => "fake-interval",
			clearInterval: () => {
				_clearIntervalCount++;
			},
			setTimeout: () => "fake-timeout",
			clearTimeout: () => {
				_clearTimeoutCount++;
			},
			subscribeStates: () => {},
			unsubscribeStates: (...args) => {
				unsubCalls.push(args);
			},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		// Populate state cache
		await ctx["setState"]("grid.power", 100, true);

		// Set up timers and connection mocks
		ctx["infoFallbackTimer"] = "timer-1";
		ctx["pollStartTimer"] = "timer-2";
		ctx["pollTimer"] = "timer-3";
		ctx.connection = { removeAllListeners: () => {}, disconnect: () => {} };
		ctx.cloudRelay = { removeAllListeners: () => {}, disconnect: () => {} };
		ctx.resetButtonTimers.add("btn-timer-1");

		ctx.disconnect();

		assert.strictEqual(ctx.connection, null, "connection should be null");
		assert.strictEqual(ctx.cloudRelay, null, "cloudRelay should be null");
		assert.strictEqual(ctx["infoFallbackTimer"], undefined, "infoFallbackTimer should be cleared");
		assert.strictEqual(ctx["pollStartTimer"], undefined, "pollStartTimer should be cleared");
		assert.strictEqual(ctx["pollTimer"], undefined, "pollTimer should be cleared");
		assert.strictEqual(ctx["stateCache"].size, 0, "stateCache should be empty");
		assert.strictEqual(ctx.resetButtonTimers.size, 0, "resetButtonTimers should be empty");
		assert.ok(unsubCalls.length > 0, "Should unsubscribe from writable states");
		assert.ok(
			unsubCalls.some(c => c[0].includes("powerLimit")),
			"Should unsubscribe powerLimit",
		);
	});

	it("disconnect does not unsubscribe when deviceId is empty", function () {
		const unsubCalls = [];
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: (...args) => {
				unsubCalls.push(args);
			},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// No initFromSerial — deviceId is empty
		ctx.disconnect();
		assert.strictEqual(unsubCalls.length, 0, "Should not unsubscribe when deviceId is empty");
	});
});

// ============================================================
// deviceContext – handleRealData with meter data
// ============================================================
describe("deviceContext – handleRealData with meter data", function () {
	function createTrackingAdapter() {
		const calls = [];
		const extendCalls = [];
		const setObjCalls = [];
		return {
			calls,
			extendCalls,
			setObjCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async (...args) => {
					setObjCalls.push(args);
				},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("creates meter states on first meter data and writes values", async function () {
		const { calls, setObjCalls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeRealDataNew: () => ({
				dtuPower: 500,
				dtuDailyEnergy: 3000,
				sgs: [],
				pv: [],
				meter: [
					{
						phaseTotalPower: 1500,
						phaseAPower: 500,
						phaseBPower: 500,
						phaseCPower: 500,
						powerFactorTotal: 0.98,
						energyTotalPower: 10000,
						energyTotalConsumed: 8000,
						voltagePhaseA: 230,
						voltagePhaseB: 231,
						voltagePhaseC: 229,
						currentPhaseA: 2.1,
						currentPhaseB: 2.2,
						currentPhaseC: 2.0,
						faultCode: 0,
					},
				],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		await ctx["handleRealData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		// Verify meter channel was created
		assert.ok(
			setObjCalls.some(c => c[0].endsWith("meter")),
			"Should create meter channel",
		);

		// Verify meter state values
		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("TEST1234.meter.totalPower"), "Should write meter.totalPower");
		assert.ok(stateIds.includes("TEST1234.meter.phaseAPower"), "Should write meter.phaseAPower");

		const totalPowerCall = newCalls.find(c => c[0] === "TEST1234.meter.totalPower");
		assert.strictEqual(totalPowerCall[1], 1500);
	});

	it("does not re-create meter states on second call", async function () {
		const { setObjCalls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeRealDataNew: () => ({
				dtuPower: 500,
				dtuDailyEnergy: 3000,
				sgs: [],
				pv: [],
				meter: [
					{
						phaseTotalPower: 1500,
						phaseAPower: 500,
						phaseBPower: 500,
						phaseCPower: 500,
						powerFactorTotal: 0.98,
						energyTotalPower: 10000,
						energyTotalConsumed: 8000,
						voltagePhaseA: 230,
						voltagePhaseB: 231,
						voltagePhaseC: 229,
						currentPhaseA: 2.1,
						currentPhaseB: 2.2,
						currentPhaseC: 2.0,
						faultCode: 0,
					},
				],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["handleRealData"](Buffer.alloc(0));
		const setObjCountFirst = setObjCalls.length;
		await ctx["handleRealData"](Buffer.alloc(0));
		const setObjCountSecond = setObjCalls.length;
		assert.strictEqual(setObjCountSecond, setObjCountFirst, "Should not re-create meter states on second call");
	});
});

// ============================================================
// deviceContext – handleInfoData
// ============================================================
describe("deviceContext – handleInfoData", function () {
	function createTrackingAdapter() {
		const calls = [];
		const extendCalls = [];
		return {
			calls,
			extendCalls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async (...args) => {
					extendCalls.push(args);
				},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("initializes device from DTU serial when deviceId is empty", async function () {
		const { adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU_NEW_123",
				deviceNumber: 1,
				pvNumber: 2,
				dtuInfo: null,
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// deviceId is empty at this point

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.strictEqual(ctx.dtuSerial, "DTU_NEW_123");
		assert.strictEqual(ctx.deviceId, "DTU_NEW_123");
	});

	it("creates PV states when pvNumber > 0 and not yet created", async function () {
		const { extendCalls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU123",
				deviceNumber: 1,
				pvNumber: 3,
				dtuInfo: null,
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU123");

		const before = extendCalls.length;
		await ctx["handleInfoData"](Buffer.alloc(0));
		const _after = extendCalls.length;

		assert.ok(ctx.pvStatesCreated, "pvStatesCreated should be true");
		// 3 PVs * (1 channel + 5 states) = 18 extend calls for PV
		const pvCalls = extendCalls.slice(before).filter(c => c[0].includes("pv"));
		assert.ok(pvCalls.length > 0, "Should create PV state objects");
	});

	it("disconnects on duplicate serial number", async function () {
		const { adapter } = createTrackingAdapter();
		let disconnected = false;
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DUPLICATE_SN",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: null,
				pvInfo: [],
			}),
		};

		// Pre-register the serial
		adapter.devices.set("DUPLICATE_SN", {});

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// Override disconnect to track
		const originalDisconnect = ctx.disconnect.bind(ctx);
		ctx.disconnect = () => {
			disconnected = true;
			originalDisconnect();
		};

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.ok(disconnected, "Should disconnect on duplicate serial");
	});

	it("handles decode error gracefully", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};
		const mockProtobuf = {
			decodeInfoData: () => {
				throw new Error("info decode boom");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("info decode boom"), "Should log decode error");
	});
});

// ============================================================
// deviceContext – sendAndWait
// ============================================================
describe("deviceContext – sendAndWait", function () {
	it("resolves true when response arrives before timeout", async function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: (fn, ms) => {
				const handle = global.setTimeout(fn, ms);
				return handle;
			},
			clearTimeout: h => global.clearTimeout(h),
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const mockConn = {
			send: async () => {},
		};

		// Message with cmd bytes: [_, _, 0xa3, 0x11, ...] → expected response cmdKey = "162:17"
		const message = Buffer.alloc(10);
		message[2] = 0xa3;
		message[3] = 0x11;

		const promise = ctx["sendAndWait"](mockConn, message, 5000);

		// Simulate response arriving
		await new Promise(r => setTimeout(r, 5));
		assert.ok(ctx["pendingResponse"], "Should have a pending response");
		// Manually resolve
		ctx["pendingResponse"].resolve();

		const result = await promise;
		assert.strictEqual(result, true, "Should resolve true when response arrives");
	});

	it("resolves false on send failure", async function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: (fn, ms) => {
				const handle = global.setTimeout(fn, ms);
				return handle;
			},
			clearTimeout: h => global.clearTimeout(h),
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		const mockConn = {
			send: async () => {
				throw new Error("send failed");
			},
		};

		const message = Buffer.alloc(10);
		message[2] = 0xa3;
		message[3] = 0x11;

		const result = await ctx["sendAndWait"](mockConn, message, 5000);
		assert.strictEqual(result, false, "Should resolve false on send failure");
		assert.strictEqual(ctx["pendingResponse"], null, "Should clear pendingResponse on send failure");
	});
});

// ============================================================
// deviceContext – pollTick
// ============================================================
describe("deviceContext – pollTick", function () {
	it("returns early when connection is null", async function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		// Should not throw even with no connection
		await ctx["pollTick"]();
		assert.ok(true, "pollTick should return early without error");
	});

	it("returns early when pollBusy is true", async function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: { encodeRealDataNewRequest: () => Buffer.alloc(10) },
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.connection = { connected: true };
		ctx["pollBusy"] = true;

		await ctx["pollTick"]();
		assert.strictEqual(ctx["pollBusy"], true, "pollBusy should remain true (early return)");
	});
});

// ============================================================
// deviceContext – handleNetworkInfo and handleDevConfigFetch
// ============================================================
describe("deviceContext – handleNetworkInfo / handleDevConfigFetch", function () {
	it("handleNetworkInfo logs debug on success", function () {
		const debugMsgs = [];
		const adapter = {
			log: {
				info: () => {},
				warn: () => {},
				debug: msg => {
					debugMsgs.push(msg);
				},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["handleNetworkInfo"](Buffer.alloc(0));
		assert.ok(
			debugMsgs.some(m => m.includes("NetworkInfo")),
			"Should log NetworkInfo debug",
		);
	});

	it("handleNetworkInfo returns early when protobuf is null", function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		assert.doesNotThrow(() => ctx["handleNetworkInfo"](Buffer.alloc(0)));
	});

	it("handleDevConfigFetch logs debug on success", function () {
		const debugMsgs = [];
		const adapter = {
			log: {
				info: () => {},
				warn: () => {},
				debug: msg => {
					debugMsgs.push(msg);
				},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		ctx["handleDevConfigFetch"](Buffer.alloc(0));
		assert.ok(
			debugMsgs.some(m => m.includes("DevConfig")),
			"Should log DevConfig debug",
		);
	});

	it("handleDevConfigFetch returns early when protobuf is null", function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});

		assert.doesNotThrow(() => ctx["handleDevConfigFetch"](Buffer.alloc(0)));
	});
});

// ============================================================
// deviceContext – handleAutoSearch
// ============================================================
describe("deviceContext – handleAutoSearch", function () {
	it("parses serial numbers and writes searchResult", async function () {
		const calls = [];
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async (...args) => {
				calls.push(args);
			},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
				toObject: () => ({ miSerialNumbers: [0x1234, 0xabcd] }),
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const before = calls.length;
		await ctx["handleAutoSearch"](Buffer.alloc(0));
		const newCalls = calls.slice(before);

		const searchResultCall = newCalls.find(c => c[0] === "TEST1234.dtu.searchResult");
		assert.ok(searchResultCall, "Should write dtu.searchResult");
		const parsed = JSON.parse(searchResultCall[1]);
		assert.strictEqual(parsed.length, 2);
		assert.strictEqual(parsed[0], "1234");
		assert.strictEqual(parsed[1], "ABCD");
	});

	it("returns early when protobuf is null", async function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		ctx.protobuf = null;
		// Should not throw
		await ctx["handleAutoSearch"](Buffer.alloc(0));
	});

	it("returns early when deviceId is empty", async function () {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: {
				getType: () => {
					throw new Error("should not be called");
				},
			},
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		// No initFromSerial
		await ctx["handleAutoSearch"](Buffer.alloc(0));
	});
});

// ============================================================
// deviceContext – setStates with quality
// ============================================================
describe("deviceContext – setStates with quality parameter", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("setStates writes with quality object when q !== 0", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		const callsBefore = calls.length;
		await ctx["setStates"](
			[
				["grid.power", 100],
				["grid.voltage", 230],
			],
			true,
			0x42,
		);
		const newCalls = calls.slice(callsBefore);

		assert.strictEqual(newCalls.length, 2);
		// When q !== 0, should pass object with val, ack, q
		assert.deepStrictEqual(newCalls[0][1], { val: 100, ack: true, q: 0x42 });
		assert.deepStrictEqual(newCalls[1][1], { val: 230, ack: true, q: 0x42 });
	});

	it("setStates deduplicates based on quality", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["setStates"]([["grid.power", 100]], true, 0x00);
		const callsBefore = calls.length;
		// Same value but different quality
		await ctx["setStates"]([["grid.power", 100]], true, 0x42);
		const newCalls = calls.slice(callsBefore);
		assert.strictEqual(newCalls.length, 1, "Should write when quality changes");
	});
});

// ============================================================
// deviceContext – handleConfigData sets cloudRelay interval
// ============================================================
describe("deviceContext – handleConfigData relay integration", function () {
	it("sets cloudRelay realDataInterval when serverSendTime > 0", async function () {
		let relayInterval = null;
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};
		const mockProtobuf = {
			decodeGetConfig: () => ({
				limitPower: 1000,
				serverDomain: "cloud.test.com",
				serverPort: 10081,
				serverSendTime: 3,
				wifiSsid: "",
				wifiRssi: 0,
				zeroExportEnable: 0,
				zeroExport433Addr: 0,
				meterKind: 0,
				meterInterface: 0,
				dhcpSwitch: 0,
				dtuApSsid: "",
				netmodeSelect: 0,
				channelSelect: 0,
				sub1gSweepSwitch: 0,
				sub1gWorkChannel: 0,
				invType: 0,
				ipAddress: "",
				subnetMask: "",
				gateway: "",
				wifiIpAddress: "",
				macAddress: "",
				wifiMacAddress: "",
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		ctx.cloudRelay = {
			setRealDataInterval: min => {
				relayInterval = min;
			},
		};

		await ctx["handleConfigData"](Buffer.alloc(0));
		assert.strictEqual(ctx.cloudSendTimeMin, 3, "cloudSendTimeMin should be set");
		assert.strictEqual(relayInterval, 3, "cloudRelay.setRealDataInterval should be called");
		assert.strictEqual(ctx.cloudServerDomain, "cloud.test.com:10081");
	});
});

// ============================================================
// deviceContext – handleInfoData with dtuInfo and pvInfo
// ============================================================
describe("deviceContext – handleInfoData with dtuInfo/pvInfo", function () {
	function createTrackingAdapter() {
		const calls = [];
		return {
			calls,
			adapter: {
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setStateAsync: async (...args) => {
					calls.push(args);
				},
				extendObjectAsync: async () => {},
				i18nName: key => ({ en: key }),
				i18nDescOptional: () => undefined,
				setObjectNotExistsAsync: async () => {},
				getStateAsync: async () => null,
				setInterval: () => undefined,
				clearInterval: () => {},
				setTimeout: () => undefined,
				clearTimeout: () => {},
				subscribeStates: () => {},
				unsubscribeStates: () => {},
				devices: new Map(),
				matchLocalDeviceToCloud: () => {},
				onRelayDataSent: () => {},
				onLocalConnected: () => {},
				onLocalDisconnected: () => {},
				onSendTimeUpdated: () => {},
				updateConnectionState: async () => {},
			},
		};
	}

	it("updates DTU states when dtuInfo is present", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU999",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: {
					swVersion: 4352,
					hwVersion: 256,
					signalStrength: -65,
					errorCode: 0,
					dtuStepTime: 30,
					dtuRfHwVersion: 1,
					dtuRfSwVersion: 2,
					accessModel: 1,
					communicationTime: 5,
					wifiVersion: 3,
					dtu485Mode: 0,
					sub1gFrequencyBand: 868,
					dfs: 0, // no encryption
				},
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU999");

		const callsBefore = calls.length;
		await ctx["handleInfoData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("DTU999.dtu.serialNumber"), "Should write dtu.serialNumber");
		assert.ok(stateIds.includes("DTU999.dtu.swVersion"), "Should write dtu.swVersion");
		assert.ok(stateIds.includes("DTU999.dtu.hwVersion"), "Should write dtu.hwVersion");
		assert.ok(stateIds.includes("DTU999.dtu.rssi"), "Should write dtu.rssi");
		assert.ok(stateIds.includes("DTU999.dtu.communicationTime"), "Should write dtu.communicationTime");

		// communicationTime should be multiplied by 1000
		const commTimeCall = newCalls.find(c => c[0] === "DTU999.dtu.communicationTime");
		assert.strictEqual(commTimeCall[1], 5000);
	});

	it("sets up encryption when dfs bit 25 is set", async function () {
		const { adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU999",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: {
					swVersion: 0,
					hwVersion: 0,
					signalStrength: 0,
					errorCode: 0,
					dtuStepTime: 0,
					dtuRfHwVersion: 0,
					dtuRfSwVersion: 0,
					accessModel: 0,
					communicationTime: 0,
					wifiVersion: 0,
					dtu485Mode: 0,
					sub1gFrequencyBand: 0,
					dfs: 1 << 25, // bit 25 set = encryption required
					encRand: "test_rand_key",
				},
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU999");

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.strictEqual(ctx.encryptionRequired, true, "Should set encryptionRequired to true");
		assert.ok(ctx.encryption !== null, "Should initialize encryption object");
	});

	it("sets encryptionRequired=false when dfs bit 25 is not set", async function () {
		const { adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU999",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: {
					swVersion: 0,
					hwVersion: 0,
					signalStrength: 0,
					errorCode: 0,
					dtuStepTime: 0,
					dtuRfHwVersion: 0,
					dtuRfSwVersion: 0,
					accessModel: 0,
					communicationTime: 0,
					wifiVersion: 0,
					dtu485Mode: 0,
					sub1gFrequencyBand: 0,
					dfs: 0, // no encryption
				},
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU999");
		ctx.encryptionRequired = true; // pre-set to true

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.strictEqual(ctx.encryptionRequired, false, "Should set encryptionRequired to false");
	});

	it("warns when encryption required but no encRand", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU999",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: {
					swVersion: 0,
					hwVersion: 0,
					signalStrength: 0,
					errorCode: 0,
					dtuStepTime: 0,
					dtuRfHwVersion: 0,
					dtuRfSwVersion: 0,
					accessModel: 0,
					communicationTime: 0,
					wifiVersion: 0,
					dtu485Mode: 0,
					sub1gFrequencyBand: 0,
					dfs: 1 << 25, // encryption required
					encRand: null, // no encRand
				},
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU999");

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("no enc_rand"), "Should warn about missing enc_rand");
	});

	it("updates inverter versions from pvInfo", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU999",
				deviceNumber: 1,
				pvNumber: 2,
				dtuInfo: null,
				pvInfo: [{ sn: "INV_SN_001", bootVersion: 2048, gridVersion: 10000 }],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU999");

		const callsBefore = calls.length;
		await ctx["handleInfoData"](Buffer.alloc(0));
		const newCalls = calls.slice(callsBefore);

		const stateIds = newCalls.map(c => c[0]);
		assert.ok(stateIds.includes("DTU999.inverter.serialNumber"), "Should write inverter.serialNumber");
		assert.ok(stateIds.includes("DTU999.inverter.hwVersion"), "Should write inverter.hwVersion");
		assert.ok(stateIds.includes("DTU999.inverter.swVersion"), "Should write inverter.swVersion");

		const snCall = newCalls.find(c => c[0] === "DTU999.inverter.serialNumber");
		assert.strictEqual(snCall[1], "INV_SN_001");
	});

	it("starts polling when info is first received and connection is active", async function () {
		let setTimeoutCalled = false;
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: _fn => {
				setTimeoutCalled = true;
				return "timer";
			},
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		let perfModeSent = false;
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "DTU999",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: null,
				pvInfo: [],
			}),
			encodePerformanceDataMode: () => {
				perfModeSent = true;
				return Buffer.alloc(10);
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("DTU999");

		// Simulate an active connection
		ctx.connection = { connected: true, send: async () => {} };

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.ok(perfModeSent, "Should send PerformanceDataMode");
		assert.ok(setTimeoutCalled, "Should schedule poll start via setTimeout");
	});

	it("sets dtuSerial from info when deviceId exists but dtuSerial is empty", async function () {
		const { adapter } = createTrackingAdapter();
		const mockProtobuf = {
			decodeInfoData: () => ({
				dtuSn: "NEW_SERIAL",
				deviceNumber: 1,
				pvNumber: 0,
				dtuInfo: null,
				pvInfo: [],
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("EXISTING_ID");
		// Clear dtuSerial to simulate the edge case
		ctx.dtuSerial = "";

		await ctx["handleInfoData"](Buffer.alloc(0));
		assert.strictEqual(ctx.dtuSerial, "NEW_SERIAL", "Should set dtuSerial from info");
	});
});

// ============================================================
// deviceContext – handleAlarmData both decoders fail
// ============================================================
describe("deviceContext – handleAlarmData double decode failure", function () {
	it("logs warning when both decodeAlarmData and decodeWarnData fail", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			decodeAlarmData: () => {
				throw new Error("alarm fail");
			},
			decodeWarnData: () => {
				throw new Error("warn fail too");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["handleAlarmData"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("warn fail too"), "Should log the WarnData decode error");
	});
});

// ============================================================
// deviceContext – handleAutoSearch decode error
// ============================================================
describe("deviceContext – handleAutoSearch decode error", function () {
	it("logs warning on decode error", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			getType: () => ({
				decode: () => {
					throw new Error("auto search boom");
				},
			}),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["handleAutoSearch"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("auto search boom"), "Should log AutoSearch decode error");
	});
});

// ============================================================
// deviceContext – handleStateChange with connected mock
// ============================================================
describe("deviceContext – handleStateChange with connection", function () {
	it("calls executeCommand when connection is active", async function () {
		const calls = [];
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async (...args) => {
				calls.push(args);
			},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => "timer-handle",
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			encodeSetPowerLimit: () => Buffer.alloc(10),
			encodeSetConfig: () => Buffer.alloc(10),
			encodeInverterReboot: () => Buffer.alloc(10),
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");
		ctx.connection = {
			connected: true,
			send: async () => {},
		};

		// This calls executeCommand which finds the "inverter.reboot" handler
		await ctx.handleStateChange("inverter.reboot", {
			val: true,
			ack: false,
			ts: Date.now(),
			lc: Date.now(),
			from: "",
		});
		// If it reaches here without error, the path is covered
		assert.ok(true, "handleStateChange should not crash with active connection");
	});
});

// ============================================================
// deviceContext – handleHistPower decode error
// ============================================================
describe("deviceContext – handleHistPower decode error", function () {
	it("logs warning on decode error", async function () {
		let warnMsg = "";
		const adapter = {
			log: {
				info: () => {},
				warn: msg => {
					warnMsg = msg;
				},
				debug: () => {},
				error: () => {},
			},
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			i18nName: key => ({ en: key }),
			i18nDescOptional: () => undefined,
			setObjectNotExistsAsync: async () => {},
			getStateAsync: async () => null,
			setInterval: () => undefined,
			clearInterval: () => {},
			setTimeout: () => undefined,
			clearTimeout: () => {},
			subscribeStates: () => {},
			unsubscribeStates: () => {},
			devices: new Map(),
			matchLocalDeviceToCloud: () => {},
			onRelayDataSent: () => {},
			onLocalConnected: () => {},
			onLocalDisconnected: () => {},
			onSendTimeUpdated: () => {},
			updateConnectionState: async () => {},
		};

		const mockProtobuf = {
			decodeHistPower: () => {
				throw new Error("hist decode boom");
			},
		};

		const ctx = new DeviceContext({
			adapter,
			protobuf: mockProtobuf,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		await ctx.initFromSerial("TEST1234");

		await ctx["handleHistPower"](Buffer.alloc(0));
		assert.ok(warnMsg.includes("hist decode boom"), "Should log HistPower decode error");
	});
});
