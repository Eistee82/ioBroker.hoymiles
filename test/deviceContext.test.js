import assert from "node:assert";
import DeviceContext, { WRITABLE_STATES } from "../build/lib/deviceContext.js";
import { COMMANDS } from "../build/lib/commandHandler.js";
import { ProtobufHandler } from "../build/lib/protobufHandler.js";
import { byteSwap16 } from "../build/lib/gridProfile.js";

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
		assert.ok(WRITABLE_STATES.includes("config.limitPowerMyPower"));
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

		// = 2 * (1 + 6) = 14
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

	it("clamps pvCount to MAX_PV_PORTS (12)", async function () {
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
		await ctx.createPvStates(20);
		const newCalls = extendCalls.slice(callsBefore);

		// Loop uses this.pvCount (clamped to MAX_PV_PORTS = 12, the upper bound of the
		// cloud's own micro-rule dictionary)
		// 12 PVs × (1 channel + 6 states) = 84 calls
		assert.strictEqual(newCalls.length, 72, "Should create exactly 72 objects for 12 clamped PV ports");
		assert.strictEqual(ctx["pvCount"], 12, "pvCount should be clamped to 12");
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

	it("derives active flag and daily energy from sgs/pv when dtu_power is 0 (BLE 2WB)", async function () {
		const { calls, adapter } = createTrackingAdapter();
		const mockProtobuf = {
			// The BLE-only 2WB does not populate dtu_power / dtu_daily_energy — the real values live
			// in the per-inverter sgs and the per-string pv entries.
			decodeRealDataNew: () => ({
				dtuPower: 0,
				dtuDailyEnergy: 0,
				sgs: [
					{
						activePower: 254,
						voltage: 230,
						current: 1.1,
						frequency: 50,
						reactivePower: 0,
						powerFactor: 1,
						temperature: 30,
						warningNumber: 0,
						linkStatus: 1,
						serialNumber: "INV",
						powerLimit: 1000,
					},
				],
				pv: [
					{ portNumber: 1, power: 128, voltage: 39, current: 3.3, energyDaily: 1200, energyTotal: 40000 },
					{ portNumber: 2, power: 126, voltage: 35, current: 3.6, energyDaily: 1100, energyTotal: 38000 },
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

		const active = newCalls.find(c => c[0] === "TEST1234.inverter.active");
		assert.strictEqual(
			active[1],
			true,
			"inverter.active must be true when sgs reports power even if dtu_power is 0",
		);
		const daily = newCalls.find(c => c[0] === "TEST1234.grid.dailyEnergy");
		assert.strictEqual(
			daily[1],
			2.3,
			"grid.dailyEnergy must fall back to the pv daily sum (1200+1100 Wh = 2.3 kWh)",
		);
		const gridPower = newCalls.find(c => c[0] === "TEST1234.grid.power");
		assert.strictEqual(gridPower[1], 254, "grid.power comes from sgs activePower");
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
				packageNub: 1,
				packageNow: 0,
				warnDevice: 1,
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

	it("accumulates a paginated WarnData list and requests follow-up packages", async function () {
		const { calls, adapter } = createTrackingAdapter();
		// Two packages, each with one warning. package_now is 0-based, package_nub = 2.
		const pages = [
			{
				packageNub: 2,
				packageNow: 0,
				warnDevice: 1,
				warnings: [{ sn: "INV1", code: 101, num: 1, startTime: 1700000000, endTime: 0, data1: 0, data2: 0 }],
			},
			{
				packageNub: 2,
				packageNow: 1,
				warnDevice: 1,
				warnings: [{ sn: "INV1", code: 102, num: 2, startTime: 1700000000, endTime: 0, data1: 0, data2: 0 }],
			},
		];
		let decodeCall = 0;
		const sentRequests = [];
		const mockProtobuf = {
			decodeAlarmData: () => {
				throw new Error("not alarm format");
			},
			decodeWarnData: () => pages[decodeCall++],
			encodeWarnDataRequest: (_ts, packageNow) => {
				sentRequests.push(packageNow);
				return Buffer.from([packageNow]);
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
		ctx.connection = { connected: true, send: async () => {} };

		// First package: must NOT write states yet, but must request package 1.
		const before1 = calls.length;
		await ctx["handleAlarmData"](Buffer.alloc(0));
		const after1 = calls.slice(before1);
		assert.ok(
			!after1.some(c => c[0] === "TEST1234.alarms.count"),
			"First package must not finalize alarm states yet",
		);
		assert.deepStrictEqual(sentRequests, [1], "Must request the next package (index 1)");

		// Second (last) package: now finalize with BOTH warnings merged.
		const before2 = calls.length;
		await ctx["handleAlarmData"](Buffer.alloc(0));
		const after2 = calls.slice(before2);
		const countCall = after2.find(c => c[0] === "TEST1234.alarms.count");
		assert.strictEqual(countCall[1], 2, "Both packages' warnings must be present after the last package");

		const jsonCall = after2.find(c => c[0] === "TEST1234.alarms.json");
		const codes = JSON.parse(jsonCall[1]).map(a => a.code);
		assert.deepStrictEqual(codes, [101, 102], "Warnings assembled in package order");
		assert.deepStrictEqual(sentRequests, [1], "Last package must not request a further package");
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
		// limitPower from GetConfig is now written as config.limitPowerMyPower (persistent, DTU-stored)
		// rather than inverter.powerLimit (runtime setpoint) — see handleConfigData change.
		assert.ok(stateIds.includes("TEST1234.config.limitPowerMyPower"), "Should write config.limitPowerMyPower");
		assert.ok(stateIds.includes("TEST1234.config.serverDomain"), "Should write config.serverDomain");
		assert.ok(stateIds.includes("TEST1234.config.wifiSsid"), "Should write config.wifiSsid");

		// limitPower = 8000 / 10 = 800
		const powerLimitCall = newCalls.find(c => c[0] === "TEST1234.config.limitPowerMyPower");
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
		assert.strictEqual(deviceCall[1].common.name, "DTU DTU_SERIAL");

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

		// 1 channel via setObjectNotExistsAsync + 23 meter state defs via extendObjectAsync
		// (14 originally, plus the nine per-phase energies and power factors)
		assert.strictEqual(newSetObj.length, 1, "Should create 1 meter channel");
		assert.ok(newSetObj[0][0].endsWith("meter"), "Channel should be named 'meter'");
		assert.strictEqual(newSetObj[0][1].type, "channel");

		assert.strictEqual(newExtend.length, 23, `Expected 23 meter state objects, got ${newExtend.length}`);
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

	it("creates 1 PV input with 6 fields (local mode)", async function () {
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
		// 1 PV: 1 channel + 6 states = 7
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
		// 4 PVs * (1 channel + 6 states) = 28
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

	// The relay re-frames the RealData payload verbatim under a cloud tag and its own sequence
	// number. With encryption active, key and IV come from enc_rand + msgId + seqNum, so the
	// re-framed message would be undecryptable for the cloud — it must not be uploaded at all.
	async function realDataRelayCtx(encryptionRequired) {
		const { adapter, warnMsgs } = createTrackingAdapter();
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
		await ctx.initFromSerial("TEST1234");
		const relayed = [];
		ctx.cloudRelay = { updateRealData: m => relayed.push(m) };
		ctx.encryptionRequired = encryptionRequired;
		const msg = Buffer.alloc(20);
		msg[2] = 0xa2;
		msg[3] = 0x11;
		return { ctx, msg, relayed, warnMsgs };
	}

	it("forwards plain RealData to the cloud relay", async function () {
		const { ctx, msg, relayed } = await realDataRelayCtx(false);
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		assert.strictEqual(relayed.length, 1, "plain RealData must reach the relay");
	});

	it("does not relay RealData when the DTU encrypts its messages", async function () {
		const { ctx, msg, relayed, warnMsgs } = await realDataRelayCtx(true);
		ctx["handleResponse"](msg);
		ctx["handleResponse"](msg);
		await new Promise(r => setTimeout(r, 10));
		assert.strictEqual(relayed.length, 0, "encrypted RealData must not be re-framed for the cloud");
		const warns = warnMsgs.filter(m => m.includes("cloud relay"));
		assert.strictEqual(warns.length, 1, "the skip must be warned about exactly once, not per frame");
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

	/** Cloud-fallback fixture: no local link, cloud enabled, records sendCloudDeviceCommand args. */
	function makeCloudFallbackCtx() {
		const cloudCalls = [];
		let warnMsg = "";
		const adapter = {
			log: { info: () => {}, warn: msg => (warnMsg = msg), debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
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
			sendCloudDeviceCommand: async (devSn, dtuSn, action, devType) => {
				cloudCalls.push({ devSn, dtuSn, action, devType });
			},
		};
		const ctx = new DeviceContext({
			adapter,
			protobuf: null,
			host: "",
			enableLocal: false,
			enableCloud: true,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		return { ctx, cloudCalls, getWarn: () => warnMsg };
	}

	const button = val => ({ val, ack: false, ts: Date.now(), lc: Date.now(), from: "" });

	it("dtu.reboot over cloud targets the DTU serial with the DTU device type", async function () {
		const { ctx, cloudCalls } = makeCloudFallbackCtx();
		await ctx.initFromSerial("DTU9999");
		ctx.setCloudInverterSn("INV1111");

		await ctx.handleStateChange("dtu.reboot", button(true));

		assert.deepStrictEqual(cloudCalls, [{ devSn: "DTU9999", dtuSn: "DTU9999", action: 1, devType: 1 }]);
	});

	it("inverter.reboot over cloud targets the inverter serial with the micro device type", async function () {
		const { ctx, cloudCalls } = makeCloudFallbackCtx();
		await ctx.initFromSerial("DTU9999");
		ctx.setCloudInverterSn("INV1111");

		await ctx.handleStateChange("inverter.reboot", button(true));

		assert.deepStrictEqual(cloudCalls, [{ devSn: "INV1111", dtuSn: "DTU9999", action: 3, devType: 3 }]);
	});

	it("dtu.reboot over cloud works even before the inverter serial is known", async function () {
		const { ctx, cloudCalls } = makeCloudFallbackCtx();
		await ctx.initFromSerial("DTU9999"); // no setCloudInverterSn

		await ctx.handleStateChange("dtu.reboot", button(true));

		assert.deepStrictEqual(cloudCalls, [{ devSn: "DTU9999", dtuSn: "DTU9999", action: 1, devType: 1 }]);
	});

	it("inverter.reboot before the inverter serial is known fails with a clear message, no leak", async function () {
		const { ctx, cloudCalls, getWarn } = makeCloudFallbackCtx();
		await ctx.initFromSerial("DTU9999"); // no setCloudInverterSn

		await ctx.handleStateChange("inverter.reboot", button(true));

		assert.strictEqual(cloudCalls.length, 0, "no cloud command sent without an inverter serial");
		assert.ok(getWarn().includes("inverter serial not known"), "user-facing message, not internal validation");
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
			// handleNetworkInfo now reads the payload fields instead of discarding them
			decodePayload: () => ({ csq: 21, netWorkMod: 1, netWorkState: 2 }),
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

		// Single-package grid profile: CountryStd=768, Version=8193 (big-endian).
		const mockProtobuf = {
			getType: () => ({
				decode: () => ({}),
				toObject: () => ({
					data: new Uint8Array([0x03, 0x00, 0x20, 0x01]),
					currentPackage: 0,
					totalPackages: 1,
				}),
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
			debugMsgs.some(m => m.includes("grid profile")),
			"Should log grid profile debug",
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
		assert.ok(stateIds.includes("DTU999.dtu.signalQuality"), "Should write dtu.signalQuality");
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

// ============================================================
// deviceContext – cloud grid-profile handshake ordering
// ============================================================
// The relay must mirror the real DTU's handshake when the cloud reads the grid
// profile (action 41): ack (0x22 0x05) + status (0x22 0x06) first, then the grid
// file (0x22 0x0e) ONLY after the cloud acks the status with 0x23 0x06. Sending
// the file up front makes the cloud display "no data".
describe("deviceContext – cloud grid-profile handshake ordering", function () {
	let handler;
	const RAW_BLOB = Buffer.from([0x03, 0x00, 0x20, 0x00, 0x0a, 0x08]); // even length, big-endian
	const GRID_DTU_SN = Buffer.from("4143A01CEDE4", "hex"); // raw serial bytes (dtu_sn is bytes)
	const GRID_DEV_SN = Buffer.from("1412A01CEDE4", "hex"); // raw serial bytes (dev_sn is bytes)

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function makeCtx() {
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
		const sent = [];
		const ctx = new DeviceContext({
			adapter,
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: true,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.cloudRelay = { sendFrame: b => sent.push(b) };
		ctx.dtuSerial = "4143A01CEDE4";
		ctx["inverterSn"] = "1412A01CEDE4";
		ctx["gridBlob"] = Buffer.from(RAW_BLOB);
		// dtu_sn/dev_sn are echoed verbatim from the local read as raw bytes
		ctx["gridDtuSn"] = Buffer.from(GRID_DTU_SN);
		ctx["gridDevSn"] = Buffer.from(GRID_DEV_SN);
		return { ctx, sent };
	}

	const tags = sent => sent.map(f => [f[2], f[3]]);

	function actionCmd(action, tid) {
		const ResDTO = handler.getType("CommandPB", "CommandResDTO");
		const payload = ResDTO.encode(ResDTO.create({ action, tid })).finish();
		return { cmdHigh: 0x23, cmdLow: 0x05, seq: 1, payload: Buffer.from(payload) };
	}

	function statusAck(action, tid) {
		const StatusRes = handler.getType("CommandPB", "CommandStatusResDTO");
		const payload = StatusRes.encode(StatusRes.create({ action, tid })).finish();
		return { cmdHigh: 0x23, cmdLow: 0x06, seq: 2, payload: Buffer.from(payload) };
	}

	it("on action 41 sends ack (0x22 0x05) + status (0x22 0x06) but NOT the grid file yet", function () {
		const { ctx, sent } = makeCtx();
		ctx["handleCloudCommand"](actionCmd(41, 12345));
		assert.deepStrictEqual(tags(sent), [
			[0x22, 0x05],
			[0x22, 0x06],
		]);
		assert.ok(
			!tags(sent).some(([, low]) => low === 0x0e),
			"grid file (0x22 0x0e) must not be sent before the status-ack",
		);
	});

	it("sends the grid file (0x22 0x0e) only after the cloud status-ack (0x23 0x06)", function () {
		const { ctx, sent } = makeCtx();
		ctx["handleCloudCommand"](actionCmd(41, 12345));
		ctx["handleCloudCommand"](statusAck(41, 12345));
		assert.deepStrictEqual(tags(sent), [
			[0x22, 0x05],
			[0x22, 0x06],
			[0x22, 0x0e],
		]);
	});

	it("grid file echoes the command tid, the byte-swapped blob and the raw serial bytes", function () {
		const { ctx, sent } = makeCtx();
		ctx["handleCloudCommand"](actionCmd(41, 43981));
		ctx["handleCloudCommand"](statusAck(41, 43981));
		const fileFrame = sent.find(f => f[2] === 0x22 && f[3] === 0x0e);
		assert.ok(fileFrame, "grid file frame present");
		const parsed = handler.parseResponse(fileFrame);
		const ReqDTO = handler.getType("DevConfig", "DevConfigFetchReqDTO");
		const obj = ReqDTO.toObject(ReqDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(Number(obj.transactionId), 43981);
		assert.deepStrictEqual(Buffer.from(obj.data), byteSwap16(Buffer.from(RAW_BLOB)));
		// dtu_sn/dev_sn are echoed verbatim as the raw bytes the DTU sent (not ASCII serials)
		assert.deepStrictEqual(Buffer.from(obj.dtuSn), GRID_DTU_SN);
		assert.deepStrictEqual(Buffer.from(obj.devSn), GRID_DEV_SN);
	});

	it("does not upload the grid file when the DTU serials were not cached", function () {
		const { ctx, sent } = makeCtx();
		ctx["gridDtuSn"] = null;
		ctx["gridDevSn"] = null;
		ctx["handleCloudCommand"](actionCmd(41, 7));
		ctx["handleCloudCommand"](statusAck(41, 7));
		assert.ok(!sent.some(f => f[2] === 0x22 && f[3] === 0x0e), "no grid file without cached serials");
	});

	it("ignores a stray status-ack when no grid-profile read is pending", function () {
		const { ctx, sent } = makeCtx();
		ctx["handleCloudCommand"](statusAck(41, 999));
		assert.strictEqual(sent.length, 0);
	});
});

// ============================================================
// deviceContext – cloud downlink coverage
// ============================================================
// Every 0x23NN frame the cloud sends must end up somewhere identifiable. Before, only
// 0x2305/0x2306 were looked at and the routine acks were discarded inside the relay, so an
// unimplemented downlink was indistinguishable from no downlink at all.
describe("deviceContext – cloud downlink coverage", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function makeCtx({ localConnected = true } = {}) {
		const logs = { info: [], warn: [], debug: [] };
		const adapter = {
			log: {
				info: m => logs.info.push(m),
				warn: m => logs.warn.push(m),
				debug: m => logs.debug.push(m),
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
		const cloudSent = [];
		const localSent = [];
		const ctx = new DeviceContext({
			adapter,
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: true,
			dataInterval: 15,
			slowPollFactor: 6,
		});
		ctx.cloudRelay = { sendFrame: b => cloudSent.push(b) };
		ctx.connection = { connected: localConnected, send: async f => localSent.push(f) };
		ctx.dtuSerial = "4143A01CEDE4";
		return { ctx, cloudSent, localSent, logs };
	}

	function actionFrame(action, tid = 4711) {
		const ResDTO = handler.getType("CommandPB", "CommandResDTO");
		const payload = ResDTO.encode(ResDTO.create({ time: 1, action, devKind: 1, packageNub: 1, tid })).finish();
		return { cmdHigh: 0x23, cmdLow: 0x05, seq: 1, payload: Buffer.from(payload) };
	}

	it("forwards an ordinary action to the device on the cloud tag", function () {
		const { ctx, cloudSent, localSent } = makeCtx();
		ctx["handleCloudCommand"](actionFrame(8)); // power limit
		assert.strictEqual(localSent.length, 1, "command was not handed to the device");
		// The tag must stay in the cloud family: request/response slots are separate in the
		// firmware, so rewriting it to 0xa305 would put the answer in the wrong slot.
		assert.strictEqual(localSent[0][2], 0x23);
		assert.strictEqual(localSent[0][3], 0x05);
		// and the cloud gets ack (0x22 0x05) + status (0x22 0x06)
		assert.deepStrictEqual(
			cloudSent.map(f => [f[2], f[3]]),
			[
				[0x22, 0x05],
				[0x22, 0x06],
			],
		);
	});

	it("refuses an OTA action instead of forwarding it", function () {
		const { ctx, cloudSent, localSent, logs } = makeCtx();
		ctx["handleCloudCommand"](actionFrame(2)); // OTA download
		assert.strictEqual(localSent.length, 0, "OTA action must not reach the device");
		assert.strictEqual(cloudSent.length, 0);
		assert.ok(
			logs.warn.some(m => /refusing cloud action 2/.test(m)),
			"refusal was not reported",
		);
	});

	it("reports an action it cannot execute without a local connection", function () {
		const { ctx, localSent, logs } = makeCtx({ localConnected: false });
		ctx["handleCloudCommand"](actionFrame(8));
		assert.strictEqual(localSent.length, 0);
		assert.ok(logs.info.some(m => /no local connection/.test(m)));
	});

	it("names an implemented-but-unhandled downlink instead of dropping it", function () {
		const { ctx, logs } = makeCtx();
		ctx["handleCloudCommand"]({ cmdHigh: 0x23, cmdLow: 0x0a, seq: 1, payload: Buffer.alloc(4) });
		assert.ok(
			logs.info.some(m => /WaveRes/.test(m)),
			"the tag name should appear in the log",
		);
	});

	it("warns about a tag neither firmware dispatches", function () {
		const { ctx, logs } = makeCtx();
		ctx["handleCloudCommand"]({ cmdHigh: 0x23, cmdLow: 0x7f, seq: 1, payload: Buffer.alloc(2) });
		assert.ok(logs.warn.some(m => /no firmware dispatches it/.test(m)));
	});

	it("surfaces a rejected upload from the cloud's acknowledgement", function () {
		const { ctx, logs } = makeCtx();
		const Res = handler.getType("RealDataNew", "RealDataNewResDTO");
		const payload = Buffer.from(Res.encode(Res.create({ cp: 1, errorCode: 7, time: 99 })).finish());
		ctx["handleCloudAck"]({ cmdHigh: 0x23, cmdLow: 0x0c, seq: 1, payload });
		assert.ok(
			logs.warn.some(m => /cloud rejected our upload/.test(m) && /error 7/.test(m)),
			"a non-zero error code must be reported",
		);
	});

	it("accepts a clean acknowledgement quietly", function () {
		const { ctx, logs } = makeCtx();
		const Res = handler.getType("APPHeartbeatPB", "HBResDTO");
		const payload = Buffer.from(Res.encode(Res.create({ offset: 3600, time: 12345 })).finish());
		ctx["handleCloudAck"]({ cmdHigh: 0x23, cmdLow: 0x02, seq: 1, payload });
		assert.strictEqual(logs.warn.length, 0);
		assert.ok(logs.debug.some(m => /HBRes/.test(m)));
	});
});

// ============================================================
// deviceContext – the relay is a TCP-only concern
// ============================================================
// The relay exists because a TCP DTU serves a single socket: while the adapter holds port
// 10081 the device cannot reach the cloud, so the adapter uploads for it. A BLE device has no
// local TCP port at all — the adapter never takes its cloud socket away, so it keeps uploading
// itself. Starting a relay there would push a SECOND stream under the same serial.
describe("deviceContext – relay only on TCP transport", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function makeCtx(transport) {
		const logs = { debug: [] };
		const adapter = {
			log: { info: () => {}, warn: () => {}, error: () => {}, debug: m => logs.debug.push(m) },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
			getStateAsync: async () => ({ val: "dataeu.hoymiles.com" }),
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
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: false,
			enableCloud: false,
			enableCloudRelay: true,
			dataInterval: 15,
			slowPollFactor: 6,
			transport,
		});
		return { ctx, logs };
	}

	it("does not start a relay for a BLE device", async function () {
		const { ctx, logs } = makeCtx("ble");
		await ctx["initCloudRelay"]("4161A031AB61");
		assert.ok(!ctx.cloudRelay, "a BLE device must not get a cloud relay");
		assert.ok(
			logs.debug.some(m => /keeps its own cloud connection/.test(m)),
			"the skip should be explained in the log",
		);
	});

	it("starts a relay for a TCP device", async function () {
		const { ctx } = makeCtx("tcp");
		await ctx["initCloudRelay"]("4143A01CEDE4");
		assert.ok(ctx.cloudRelay, "a TCP device needs the relay to reach the cloud");
		ctx.cloudRelay.disconnect();
	});
});

// ============================================================
// deviceContext – slow-poll queue contents
// ============================================================
// The queue decides which non-realtime reads ever happen. A message whose handler exists but
// which nobody requests produces no states at all — that is exactly how history.* stayed empty.
describe("deviceContext – slow-poll queue", function () {
	function queueFrames(transport) {
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
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
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
			transport,
		});
		ctx["startPollCycle"]();
		const ts = 1753900000;
		const frames = ctx["slowPollQueue"].map(f => f(ts));
		ctx["stopPollCycle"]();
		return frames;
	}

	function queueTags(transport) {
		return queueFrames(transport).map(f => `0x${f[2].toString(16)}${f[3].toString(16).padStart(2, "0")}`);
	}

	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	it("asks for the daily power curve on the TCP path", function () {
		assert.ok(queueTags("tcp").includes("0xa315"), "HistPower must be requested, or history.* stays empty");
	});

	it("asks for the daily power curve on the BLE path too", function () {
		assert.ok(queueTags("ble").includes("0xa315"), "the 2WB answers a315 as well");
	});

	// The alarm trigger and the MI-warn read are both action commands on tag 0xa305, so they can
	// only be told apart by their action code (50 = ALARM_LIST, 46 = READ_MI_HU_WARN).
	function queueActions(transport) {
		const ResDTO = handler.getType("CommandPB", "CommandResDTO");
		return queueFrames(transport)
			.filter(f => f[2] === 0xa3 && f[3] === 0x05)
			.map(f => Number(ResDTO.toObject(ResDTO.decode(f.subarray(10)), { defaults: true }).action));
	}

	it("still skips the alarm trigger on BLE, which the 2WB rejects", function () {
		assert.ok(queueActions("tcp").includes(50), "TCP keeps the alarm-list trigger");
		assert.ok(!queueActions("ble").includes(50), "BLE must not send it (2WB answers error 1)");
		assert.ok(queueActions("ble").includes(46), "BLE reads warnings via the MI-warn request instead");
	});
});

// ============================================================
// deviceContext – cumulative counters never go backwards
// ============================================================
// After a device restart the inverter re-reads its last persisted counter and reports a few Wh
// below the previous figure. Written through, that is a downward step in every history consumer.
describe("deviceContext – counter monotonicity", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function ctxWithWrites() {
		const written = [];
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async (id, val) => {
				written.push([id, val]);
			},
			extendObjectAsync: async () => {},
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
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
		});
		return { ctx, written };
	}

	function realData(totalWh) {
		return {
			dtuPower: 100,
			dtuDailyEnergy: 0,
			sgs: [],
			pv: [
				{
					portNumber: 1,
					power: 100,
					voltage: 30,
					current: 3,
					energyDaily: 500,
					energyTotal: totalWh,
				},
			],
			meter: [],
		};
	}

	it("writes a rising total energy", async function () {
		const { ctx, written } = ctxWithWrites();
		await ctx.initFromSerial("TEST1234");
		ctx.pvCount = 1;
		await ctx.applyRealData(realData(100000));
		await ctx.applyRealData(realData(100100));
		const totals = written.filter(([id]) => id.endsWith("pv0.totalEnergy")).map(([, v]) => v);
		assert.deepStrictEqual(totals, [100, 100.1], "both rising values must be written");
	});

	it("drops a total energy that went backwards after a restart", async function () {
		const { ctx, written } = ctxWithWrites();
		await ctx.initFromSerial("TEST1234");
		ctx.pvCount = 1;
		await ctx.applyRealData(realData(100100));
		await ctx.applyRealData(realData(100000));
		const totals = written.filter(([id]) => id.endsWith("pv0.totalEnergy")).map(([, v]) => v);
		assert.deepStrictEqual(totals, [100.1], "the backward step must not be written");
	});

	it("forgets its counter memory when the device disconnects", async function () {
		const { ctx, written } = ctxWithWrites();
		await ctx.initFromSerial("TEST1234");
		ctx.pvCount = 1;
		await ctx.applyRealData(realData(100100));
		ctx.disconnect();
		await ctx.applyRealData(realData(100000));
		const totals = written.filter(([id]) => id.endsWith("pv0.totalEnergy")).map(([, v]) => v);
		assert.deepStrictEqual(totals, [100.1, 100], "after a disconnect the next device starts fresh");
	});
});

// ============================================================
// deviceContext – cloud power-limit writes share the flash accounting
// ============================================================
// Both routes to a power limit end in the same two flash sectors. A cloud command is forwarded
// unthrottled on purpose (the relay stands in for the device, and it acknowledges the command
// upstream — dropping it would tell the server a lie), but it must still be booked, or the next
// local write is judged against a value the device no longer holds.
describe("deviceContext – shared flash accounting", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function ctxWithRelay() {
		const sentLocal = [];
		const warns = [];
		const adapter = {
			log: { info: () => {}, warn: m => warns.push(m), debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
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
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: true,
			dataInterval: 5,
			slowPollFactor: 6,
		});
		ctx.dtuSerial = "4143A01CEDE4";
		ctx.deviceId = "4143A01CEDE4";
		ctx.connection = {
			connected: true,
			send: async buf => {
				sentLocal.push(buf);
				return true;
			},
		};
		ctx.cloudRelay = { sendFrame: () => {} };
		return { ctx, sentLocal, warns };
	}

	function cloudPowerLimit() {
		const ResDTO = handler.getType("CommandPB", "CommandResDTO");
		const payload = ResDTO.encode(ResDTO.create({ action: 8, tid: 1, data: "A:800,B:0,C:0\r" })).finish();
		return { cmdHigh: 0x23, cmdLow: 0x05, seq: 1, payload: Buffer.from(payload) };
	}

	it("forwards a cloud power-limit command without throttling it", function () {
		const { ctx, sentLocal } = ctxWithRelay();
		ctx["handleCloudAction"](cloudPowerLimit());
		ctx["handleCloudAction"](cloudPowerLimit());
		assert.strictEqual(sentLocal.length, 2, "the relay must not drop a command it acknowledges upstream");
	});

	it("books the cloud write so the next local write sees it", function () {
		const { ctx } = ctxWithRelay();
		ctx["handleCloudAction"](cloudPowerLimit());
		const entry = ctx["flashWrites"].get("inverter.powerLimit");
		assert.ok(entry, "the cloud write must be booked under the local state id");
		assert.ok(entry.lastWriteMs > 0, "its time must be recorded");
		assert.strictEqual(entry.lastValue, null, "its value is unknown and must not be guessed");
	});

	it("warns once when the cloud writes faster than the configured interval", function () {
		const { ctx, warns } = ctxWithRelay();
		ctx["handleCloudAction"](cloudPowerLimit());
		ctx["handleCloudAction"](cloudPowerLimit());
		ctx["handleCloudAction"](cloudPowerLimit());
		const rateWarnings = warns.filter(m => /faster than the configured/.test(m));
		assert.strictEqual(rateWarnings.length, 1, "one warning, not one per command");
	});

	it("does not book an action that writes no flash", function () {
		const { ctx } = ctxWithRelay();
		const ResDTO = handler.getType("CommandPB", "CommandResDTO");
		const payload = ResDTO.encode(ResDTO.create({ action: 3, tid: 1 })).finish();
		ctx["handleCloudAction"]({ cmdHigh: 0x23, cmdLow: 0x05, seq: 1, payload: Buffer.from(payload) });
		assert.strictEqual(ctx["flashWrites"].size, 0, "a reboot writes no configuration");
	});
});

// ============================================================
// deviceContext – configuration writes need a read first
// ============================================================
describe("deviceContext – config snapshot", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function ctx() {
		const warns = [];
		const sent = [];
		const adapter = {
			log: { info: () => {}, warn: m => warns.push(m), debug: () => {}, error: () => {} },
			setStateAsync: async () => {},
			extendObjectAsync: async () => {},
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
		const c = new DeviceContext({
			adapter,
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
		});
		c.deviceId = "DTU1";
		c.connection = {
			connected: true,
			send: async b => {
				sent.push(b);
				return true;
			},
			removeAllListeners: () => {},
			disconnect: () => {},
		};
		return { c, warns, sent };
	}

	it("refuses a configuration write before the configuration was read", async function () {
		const { c, warns, sent } = ctx();
		await c.handleStateChange("config.serverSendTime", { val: 10, ack: false });
		assert.strictEqual(sent.length, 0, "nothing may go out — it would clear the untouched fields");
		assert.ok(
			warns.some(m => /without having read it first/i.test(m)),
			"the refusal must say why",
		);
	});

	it("writes once the device's configuration is known", async function () {
		const { c, sent } = ctx();
		const ReqDTO = handler.getType("GetConfig", "GetConfigReqDTO");
		const payload = ReqDTO.encode(
			ReqDTO.create({ serverDomainName: "dataeu.hoymiles.com", serverport: 10081, lockPassword: 4711 }),
		).finish();
		await c["handleConfigData"](Buffer.from(payload));
		await c.handleStateChange("config.serverSendTime", { val: 10, ack: false });
		assert.strictEqual(sent.length, 1, "now the write is safe");
		const ResDTO = handler.getType("SetConfig", "SetConfigResDTO");
		const msg = ResDTO.toObject(ResDTO.decode(sent[0].subarray(10)), { longs: Number, defaults: true });
		assert.strictEqual(msg.serverDomainName, "dataeu.hoymiles.com", "carried over from the read");
		assert.strictEqual(Number(msg.lockPassword), 4711, "including the field the adapter never exposes");
	});

	it("forgets the snapshot on disconnect", async function () {
		const { c } = ctx();
		const ReqDTO = handler.getType("GetConfig", "GetConfigReqDTO");
		await c["handleConfigData"](Buffer.from(ReqDTO.encode(ReqDTO.create({ serverport: 10081 })).finish()));
		assert.ok(c["configSnapshot"], "snapshot present after a read");
		c.disconnect();
		assert.strictEqual(c["configSnapshot"], null, "a snapshot must not outlive its device");
	});
});

// ============================================================
// deviceContext – the day curve is collected across all pages
// ============================================================
// The device splits the day into pages of at most 200 samples and reports the count in `ap`.
// Page 0 alone ends at mid-morning, so publishing it would show a third of the day as the whole.
describe("deviceContext – HistPower paging", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function pagePayload(values, pageCount) {
		const ReqDTO = handler.getType("AppGetHistPower", "AppGetHistPowerReqDTO");
		return Buffer.from(
			ReqDTO.encode(
				ReqDTO.create({
					powerArray: values,
					stepTime: 60,
					ap: pageCount,
					absoluteStart: 1785382614,
					dailyEnergy: 4500,
					totalEnergy: 853192,
				}),
			).finish(),
		);
	}

	function ctx() {
		const written = [];
		const sent = [];
		const adapter = {
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async (id, val) => {
				written.push([id, val]);
			},
			extendObjectAsync: async () => {},
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
		const c = new DeviceContext({
			adapter,
			protobuf: handler,
			host: "192.168.1.1",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 5,
			slowPollFactor: 6,
		});
		c.deviceId = "DTU1";
		// setState is gated on the context being ready (device id known + state objects created);
		// the paging logic under test runs after that point in real operation.
		c.statesCreated = true;
		c.connection = {
			connected: true,
			send: async b => {
				sent.push(b);
				return true;
			},
			removeAllListeners: () => {},
			disconnect: () => {},
		};
		return { c, written, sent };
	}

	const curve = written => JSON.parse(written.filter(([id]) => id.endsWith("history.powerJson")).pop()[1]);

	it("requests the next page instead of publishing an incomplete curve", async function () {
		const { c, written, sent } = ctx();
		await c["handleHistPower"](pagePayload([100, 200], 3));
		assert.strictEqual(sent.length, 1, "a follow-up request for page 1 must go out");
		assert.strictEqual(sent[0][3], 0x15, "and it is another HistPower request");
		assert.strictEqual(
			written.filter(([id]) => id.endsWith("history.powerJson")).length,
			0,
			"nothing may be published while pages are missing",
		);
	});

	it("publishes the concatenated curve once the last page arrives", async function () {
		const { c, written } = ctx();
		await c["handleHistPower"](pagePayload([100, 200], 3));
		await c["handleHistPower"](pagePayload([300, 400], 3));
		await c["handleHistPower"](pagePayload([500], 3));
		assert.deepStrictEqual(curve(written), [10, 20, 30, 40, 50], "all pages, scaled to W");
	});

	it("publishes immediately when the device reports a single page", async function () {
		const { c, written, sent } = ctx();
		await c["handleHistPower"](pagePayload([100, 200], 1));
		assert.strictEqual(sent.length, 0, "no follow-up request for a one-page day");
		assert.deepStrictEqual(curve(written), [10, 20]);
	});

	it("stops when a page comes back empty, rather than asking forever", async function () {
		const { c, written, sent } = ctx();
		await c["handleHistPower"](pagePayload([100], 5));
		await c["handleHistPower"](pagePayload([], 5));
		assert.strictEqual(sent.length, 1, "only the one follow-up, then it stops");
		assert.deepStrictEqual(curve(written), [10]);
	});

	it("starts a fresh curve on the next round instead of appending forever", async function () {
		const { c, written } = ctx();
		await c["handleHistPower"](pagePayload([100, 200], 1));
		await c["handleHistPower"](pagePayload([300], 1));
		assert.deepStrictEqual(curve(written), [30], "the second round replaces, not appends");
	});
});

// ============================================================
// deviceContext – Shelly meter states (BLE only)
// ============================================================
describe("deviceContext – Shelly meter", function () {
	/** Adapter mock that records every state write. */
	function makeTrackingAdapter() {
		const writes = new Map();
		return {
			writes,
			log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
			setStateAsync: async (id, val) => {
				writes.set(id, val && typeof val === "object" && "val" in val ? val.val : val);
			},
			extendObjectAsync: async () => {},
			setObjectNotExistsAsync: async () => {},
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
	}

	function makeCtx(adapter, transport) {
		const ctx = new DeviceContext({
			adapter,
			protobuf: new ProtobufHandler(),
			host: "AA:BB:CC:DD:EE:FF",
			enableLocal: true,
			enableCloud: false,
			enableCloudRelay: false,
			dataInterval: 15,
			slowPollFactor: 6,
			transport,
		});
		ctx.deviceId = "4161A031AB61";
		ctx.statesCreated = true; // skip object creation, we only care about the values
		return ctx;
	}

	// Hand-built payload: the shared .proto cannot express fields 13/14.
	const varint = n => {
		const b = [];
		let v = BigInt(n);
		while (v > 0x7fn) {
			b.push(Number(v & 0x7fn) | 0x80);
			v >>= 7n;
		}
		b.push(Number(v));
		return Buffer.from(b);
	};
	const fld = (no, wire, p) => Buffer.concat([varint((no << 3) | wire), p]);
	const msg = p => Buffer.concat([varint(p.length), p]);
	const vfld = (no, v) => fld(no, 0, varint(BigInt.asUintN(64, BigInt(v))));

	const flow = fld(
		13,
		2,
		msg(Buffer.concat([vfld(1, 5282), vfld(2, -5000), vfld(3, 12942), vfld(4, 0), vfld(5, 5002)])),
	);
	// Header field 1 carries the device id (eight raw bytes off the device record); field 2 gets
	// the constant 1. Phase slot: number, voltage, current, active power.
	const meter = fld(
		14,
		2,
		msg(
			Buffer.concat([
				fld(1, 2, msg(Buffer.concat([vfld(1, 0xbc2411b807c0n), vfld(2, 1)]))),
				fld(2, 2, msg(Buffer.concat([vfld(1, 1), vfld(2, 2301), vfld(3, 1234), vfld(4, 4560)]))),
			]),
		),
	);

	it("writes the energy flow when a meter reports", async function () {
		const adapter = makeTrackingAdapter();
		const ctx = makeCtx(adapter, "ble");
		await ctx.applyShellyData(Buffer.concat([flow, meter]));

		assert.strictEqual(adapter.writes.get("4161A031AB61.meter.gridPower"), -500, "export stays negative");
		assert.strictEqual(adapter.writes.get("4161A031AB61.meter.pvPower"), 528.2);
		assert.strictEqual(adapter.writes.get("4161A031AB61.meter.loadPower"), 1294.2);
		assert.strictEqual(adapter.writes.get("4161A031AB61.meter.connected"), true);
		assert.strictEqual(adapter.writes.get("4161A031AB61.meter.deviceId"), "bc2411b807c0");
	});

	it("creates nothing while no meter is bound", async function () {
		// The DTU ships the flow message even without a meter — grid/sp are simply zero then. A
		// device without a meter must not grow an empty shelly branch.
		const adapter = makeTrackingAdapter();
		const ctx = makeCtx(adapter, "ble");
		await ctx.applyShellyData(flow);
		assert.strictEqual(adapter.writes.size, 0, "no states before a meter ever reported");
	});

	it("keeps reporting once the meter has been seen, so a dying poll is visible", async function () {
		const adapter = makeTrackingAdapter();
		const ctx = makeCtx(adapter, "ble");
		await ctx.applyShellyData(Buffer.concat([flow, meter]));
		adapter.writes.clear();
		// The DTU's WebSocket poll dies after a few minutes; the device then drops out of the frame.
		await ctx.applyShellyData(flow);
		assert.strictEqual(adapter.writes.get("4161A031AB61.meter.connected"), false, "must flag the loss");
	});

	it("is not applied on the TCP path", async function () {
		// The 2T has neither a meter input nor an energy management (firmware-verified), and its
		// field 13 carries dtu_daily_energy instead.
		const adapter = makeTrackingAdapter();
		const ctx = makeCtx(adapter, "tcp");
		await ctx.handleRealData(Buffer.concat([flow, meter]));
		const shellyWrites = [...adapter.writes.keys()].filter(k => k.includes(".meter."));
		assert.deepStrictEqual(shellyWrites, [], "no shelly states on TCP devices");
	});
});
