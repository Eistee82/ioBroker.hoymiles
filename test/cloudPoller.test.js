import assert from "node:assert";
import CloudPoller from "../build/lib/cloudPoller.js";

// ============================================================
// helpers
// ============================================================
function makeMockAdapter() {
	return {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
		clearTimeout: id => globalThis.clearTimeout(id),
	};
}

function makeMockCloud() {
	return {
		ensureToken: async () => {},
		getStationRealtime: async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		}),
		getStationDetails: async () => ({}),
		getDeviceTree: async () => [],
		getWeather: async () => ({}),
		checkFirmwareUpdate: async () => ({ upgrade: 0 }),
		getMicroRealtimeData: async () => ({}),
		getModuleRealtimeData: async () => ({}),
	};
}

function makePoller(overrides = {}) {
	const defaults = {
		cloud: makeMockCloud(),
		adapter: makeMockAdapter(),
		devices: new Map(),
		stationDevices: new Set(),
		hasRelay: false,
		slowPollFactor: 6,
	};
	return new CloudPoller({ ...defaults, ...overrides });
}

// ============================================================
// CloudPoller
// ============================================================
describe("CloudPoller", function () {
	it("constructor creates instance without errors", function () {
		const poller = makePoller();
		assert.ok(poller, "should create a CloudPoller instance");
	});

	it("poll() returns early when cloud is null", async function () {
		const poller = makePoller({ cloud: null });
		// Should not throw and should return immediately
		await poller.poll();
		assert.strictEqual(poller.pollInProgress, false, "pollInProgress should remain false");
	});

	it("poll() sets pollInProgress flag to prevent concurrent polls", async function () {
		let capturedFlag = false;
		const slowCloud = makeMockCloud();
		slowCloud.ensureToken = async () => {
			// Capture the flag while poll is in progress
			capturedFlag = poller.pollInProgress;
		};

		const poller = makePoller({ cloud: slowCloud });
		await poller.poll();

		assert.strictEqual(capturedFlag, true, "pollInProgress should be true during poll execution");
		assert.strictEqual(poller.pollInProgress, false, "pollInProgress should be false after poll completes");
	});

	it("onLocalConnected() only transitions from NIGHT_MODE", function () {
		const poller = makePoller({ hasRelay: false });

		// Default state is POLLING_ACTIVE — onLocalConnected should not change it
		poller.onLocalConnected();
		assert.strictEqual(poller.state, "POLLING_ACTIVE");

		// Force RELAY_TRIGGERED state — onLocalConnected should not change it
		poller.state = "RELAY_TRIGGERED";
		poller.onLocalConnected();
		assert.strictEqual(poller.state, "RELAY_TRIGGERED");

		// Force NIGHT_MODE — onLocalConnected should transition to POLLING_ACTIVE
		poller.state = "NIGHT_MODE";
		poller.onLocalConnected();
		assert.strictEqual(poller.state, "POLLING_ACTIVE");
	});

	it("onLocalConnected() transitions to RELAY_TRIGGERED when hasRelay is true", function () {
		const poller = makePoller({ hasRelay: true });

		poller.state = "NIGHT_MODE";
		poller.onLocalConnected();
		assert.strictEqual(poller.state, "RELAY_TRIGGERED");
	});

	it("stop() clears pending timer", function () {
		let clearedId = null;
		const adapter = makeMockAdapter();
		adapter.clearTimeout = id => {
			clearedId = id;
			globalThis.clearTimeout(id);
		};

		const poller = makePoller({ adapter });

		// Simulate a pending timer
		poller.pollTimer = adapter.setTimeout(() => {}, 60000);
		assert.ok(poller.pollTimer !== undefined, "pollTimer should be set");

		poller.stop();

		assert.strictEqual(poller.pollTimer, undefined, "pollTimer should be cleared");
		assert.ok(clearedId !== null, "clearTimeout should have been called");
	});
});

// ============================================================
// CloudPoller – state transitions
// ============================================================
describe("CloudPoller – state transitions", function () {
	it("onRelayDataSent sets state to RELAY_TRIGGERED", function () {
		const poller = makePoller();
		poller.onRelayDataSent();
		assert.strictEqual(poller.state, "RELAY_TRIGGERED");
		poller.stop();
	});

	it("onRelayDataSent does nothing in NIGHT_MODE", function () {
		const poller = makePoller();
		poller.state = "NIGHT_MODE";
		poller.onRelayDataSent();
		assert.strictEqual(poller.state, "NIGHT_MODE");
		poller.stop();
	});

	it("onLocalDisconnected enters NIGHT_MODE", async function () {
		const poller = makePoller();
		await poller.onLocalDisconnected();
		assert.strictEqual(poller.state, "NIGHT_MODE");
		poller.stop();
	});

	it("scheduleCloudPoll does nothing when state is not POLLING_ACTIVE", function () {
		const poller = makePoller();
		poller.state = "RELAY_TRIGGERED";
		poller.scheduleCloudPoll();
		assert.strictEqual(poller.pollTimer, undefined, "pollTimer should remain undefined");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – setServerSendTime
// ============================================================
describe("CloudPoller – setServerSendTime", function () {
	it("setServerSendTime ignores zero", function () {
		const poller = makePoller();
		poller.setServerSendTime(0);
		assert.strictEqual(poller.pollIntervalMs, 300000);
		poller.stop();
	});

	it("setServerSendTime ignores negative values", function () {
		const poller = makePoller();
		poller.setServerSendTime(-5);
		assert.strictEqual(poller.pollIntervalMs, 300000);
		poller.stop();
	});

	it("setServerSendTime updates pollIntervalMs", function () {
		const poller = makePoller();
		poller.setServerSendTime(10);
		assert.strictEqual(poller.pollIntervalMs, 600000);
		poller.stop();
	});

	it("setServerSendTime enforces minimum interval", function () {
		const poller = makePoller();
		poller.setServerSendTime(1);
		assert.ok(poller.pollIntervalMs >= 60000, "pollIntervalMs should be at least 60000 (MIN_POLL_MS)");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – poll behavior
// ============================================================
describe("CloudPoller – poll behavior", function () {
	it("poll increments pollCount", async function () {
		const poller = makePoller({ stationDevices: new Set() });
		await poller.poll();
		assert.strictEqual(poller.pollCount, 1);
		poller.stop();
	});

	it("poll with no stations does not throw", async function () {
		const poller = makePoller({ stationDevices: new Set() });
		await assert.doesNotReject(() => poller.poll());
		poller.stop();
	});

	it("poll skips when pollInProgress is true", async function () {
		const poller = makePoller();
		poller.pollInProgress = true;
		await poller.poll();
		assert.strictEqual(poller.pollCount, 0, "pollCount should not increment when poll is skipped");
		poller.stop();
	});

	it("initialFetch sets initialFetchDone", async function () {
		const poller = makePoller({ stationDevices: new Set() });
		await poller.initialFetch();
		assert.strictEqual(poller.initialFetchDone, true);
		poller.stop();
	});

	it("initialFetch is idempotent", async function () {
		const poller = makePoller({ stationDevices: new Set() });
		await poller.initialFetch();
		await poller.initialFetch();
		assert.strictEqual(poller.pollCount, 1, "poll should only run once despite two initialFetch calls");
		poller.stop();
	});

	it("poll processes all stations in stationDevices", async function () {
		const polledStations = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async sid => {
			polledStations.push(sid);
			return {
				real_power: "0",
				today_eq: "0",
				month_eq: "0",
				year_eq: "0",
				total_eq: "0",
				co2_emission_reduction: "0",
				plant_tree: "0",
			};
		};

		const poller = makePoller({
			cloud,
			stationDevices: new Set([100, 200, 300]),
		});
		await poller.poll();

		assert.deepStrictEqual(polledStations.sort(), [100, 200, 300], "all stations should be polled");
		poller.stop();
	});

	it("poll sets cloudConnected to false when ensureToken throws", async function () {
		let cloudConnectedValue = null;
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {
			throw new Error("token failure");
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			if (id === "info.cloudConnected") {
				cloudConnectedValue = val;
			}
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]) });
		await poller.poll();

		assert.strictEqual(cloudConnectedValue, false, "cloudConnected should be set to false on ensureToken failure");
		assert.strictEqual(poller.pollInProgress, false, "pollInProgress should be reset after failure");
		poller.stop();
	});

	it("concurrent poll() calls: second call is a no-op", async function () {
		let resolveFirst;
		const firstCallBarrier = new Promise(r => {
			resolveFirst = r;
		});

		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {
			await firstCallBarrier;
		};

		const poller = makePoller({ cloud, stationDevices: new Set() });

		// Start first poll (will block on ensureToken); pollCount increments immediately
		const p1 = poller.poll();

		// At this point pollInProgress is true, pollCount is 1
		assert.strictEqual(poller.pollInProgress, true, "first poll should hold pollInProgress");

		// Second poll should be a no-op because pollInProgress is true
		await poller.poll();
		assert.strictEqual(poller.pollCount, 1, "pollCount should still be 1 after second (skipped) poll");

		// Unblock first poll
		resolveFirst();
		await p1;

		assert.strictEqual(poller.pollCount, 1, "only the first poll should have incremented pollCount");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – nightPoll (via scheduleNightPoll / onLocalDisconnected)
// ============================================================
describe("CloudPoller – nightPoll", function () {
	it("onLocalDisconnected performs final poll, enters NIGHT_MODE, and schedules night poll timer", async function () {
		let pollCalled = false;
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {
			pollCalled = true;
		};

		let timerScheduled = false;
		const adapter = makeMockAdapter();
		const origSetTimeout = adapter.setTimeout;
		adapter.setTimeout = (fn, _ms) => {
			timerScheduled = true;
			// Return a timer handle but don't actually run it
			return origSetTimeout(fn, 999999);
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]) });
		await poller.onLocalDisconnected();

		assert.strictEqual(poller.state, "NIGHT_MODE", "state should be NIGHT_MODE");
		assert.ok(pollCalled, "final poll should have been executed");
		assert.ok(timerScheduled, "night poll timer should be scheduled");
		poller.stop();
	});

	it("nightPoll calls weather and firmware for each station", async function () {
		const weatherCalls = [];
		const fwCalls = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getWeather = async (lat, lon) => {
			weatherCalls.push({ lat, lon });
			return { icon: "01d", temp: 20, sunrise: 1000, sunset: 2000 };
		};
		cloud.checkFirmwareUpdate = async (sid, serial) => {
			fwCalls.push({ sid, serial });
			return { upgrade: 0 };
		};

		const devices = new Map();
		devices.set("DTU123", {
			dtuSerial: "DTU123",
			cloudStationId: 42,
			connection: null,
		});

		// Use a fast timer so nightPoll actually fires
		let nightPollTimerFn = null;
		const adapter = makeMockAdapter();
		adapter.setTimeout = (fn, _ms) => {
			nightPollTimerFn = fn;
			return globalThis.setTimeout(() => {}, 999999);
		};

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([42]),
		});

		// Enter night mode
		await poller.onLocalDisconnected();
		assert.strictEqual(poller.state, "NIGHT_MODE");

		// Simulate station coords (normally set by pollStationDetails)
		poller.stationCoords = new Map([[42, { lat: 48.1, lon: 11.5 }]]);
		// Reset lastFirmwareCheckDay so firmware check runs
		poller.lastFirmwareCheckDay = -1;

		// Manually invoke the scheduled nightPoll callback
		assert.ok(nightPollTimerFn, "night poll timer function should exist");
		await nightPollTimerFn();

		assert.ok(weatherCalls.length > 0, "weather should be polled during nightPoll");
		assert.ok(fwCalls.length > 0, "firmware should be checked during nightPoll");
		assert.deepStrictEqual(fwCalls[0], { sid: 42, serial: "DTU123" });
		poller.stop();
	});

	it("nightPoll returns early if state changes during ensureToken", async function () {
		const weatherCalls = [];
		let ensureTokenCallCount = 0;
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {
			ensureTokenCallCount++;
			// On the nightPoll call (not the final poll from onLocalDisconnected),
			// simulate a local reconnect that changes the state
			if (ensureTokenCallCount > 1) {
				poller.state = "POLLING_ACTIVE";
			}
		};
		cloud.getWeather = async () => {
			weatherCalls.push(true);
			return {};
		};

		const timerFns = [];
		const adapter = makeMockAdapter();
		adapter.setTimeout = (fn, _ms) => {
			timerFns.push(fn);
			return globalThis.setTimeout(() => {}, 999999);
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]) });

		// Enter night mode via onLocalDisconnected (calls poll() first, then scheduleNightPoll)
		await poller.onLocalDisconnected();
		assert.strictEqual(poller.state, "NIGHT_MODE", "should be in NIGHT_MODE after disconnect");

		// The last timer fn scheduled should be the night poll timer
		const nightPollTimerFn = timerFns[timerFns.length - 1];
		assert.ok(nightPollTimerFn, "night poll timer function should exist");

		// Reset weather tracking
		weatherCalls.length = 0;

		// Fire nightPoll — ensureToken will change state to POLLING_ACTIVE
		await nightPollTimerFn();

		assert.strictEqual(weatherCalls.length, 0, "weather should NOT be polled when state left NIGHT_MODE");
		poller.stop();
	});

	it("nightPoll sets cloudConnected false on ensureToken failure", async function () {
		let cloudConnectedValue = null;
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {
			throw new Error("token failure");
		};

		let nightPollTimerFn = null;
		const adapter = makeMockAdapter();
		adapter.setTimeout = (fn, _ms) => {
			nightPollTimerFn = fn;
			return globalThis.setTimeout(() => {}, 999999);
		};
		adapter.setStateAsync = async (id, val) => {
			if (id === "info.cloudConnected") {
				cloudConnectedValue = val;
			}
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]) });
		await poller.onLocalDisconnected();

		// onLocalDisconnected → poll() also fails, so cloudConnected was already set to false.
		// With deduplication, the nightPoll won't re-write the same value.
		// Verify the value remained false throughout (not reset to null/true).
		assert.strictEqual(
			cloudConnectedValue,
			false,
			"cloudConnected should be false after onLocalDisconnected poll failure",
		);

		assert.ok(nightPollTimerFn, "timer fn should be set");
		await nightPollTimerFn();

		assert.strictEqual(
			cloudConnectedValue,
			false,
			"cloudConnected should remain false after nightPoll token failure",
		);
		poller.stop();
	});

	it("nightPoll skips firmware check if already checked today", async function () {
		const fwCalls = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getWeather = async () => ({ icon: "01d" });
		cloud.checkFirmwareUpdate = async (sid, serial) => {
			fwCalls.push(serial);
			return { upgrade: 0 };
		};

		const devices = new Map();
		devices.set("DTU1", { dtuSerial: "DTU1", cloudStationId: 1, connection: null });

		let nightPollTimerFn = null;
		const adapter = makeMockAdapter();
		adapter.setTimeout = (fn, _ms) => {
			nightPollTimerFn = fn;
			return globalThis.setTimeout(() => {}, 999999);
		};

		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]) });
		poller.stationCoords = new Map([[1, { lat: 1, lon: 1 }]]);

		await poller.onLocalDisconnected();

		// Set lastFirmwareCheckDay to today so it skips
		poller.lastFirmwareCheckDay = new Date().getDate();
		fwCalls.length = 0;

		await nightPollTimerFn();
		assert.strictEqual(fwCalls.length, 0, "firmware check should be skipped when already done today");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – pollStation with isSlowPoll
// ============================================================
describe("CloudPoller – pollStation (slow poll)", function () {
	it("slow poll fetches station details, weather and firmware", async function () {
		const calls = { details: 0, weather: 0, firmware: 0, deviceTree: 0 };
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "100",
			today_eq: "5000",
			month_eq: "30000",
			year_eq: "100000",
			total_eq: "500000",
			co2_emission_reduction: "1000",
			plant_tree: "5",
		});
		cloud.getStationDetails = async () => {
			calls.details++;
			return { name: "TestStation", capacitor: "800", latitude: "48.1", longitude: "11.5" };
		};
		cloud.getWeather = async () => {
			calls.weather++;
			return { icon: "02d", temp: 22, sunrise: 1000, sunset: 2000 };
		};
		cloud.checkFirmwareUpdate = async () => {
			calls.firmware++;
			return { upgrade: 0 };
		};
		cloud.getDeviceTree = async () => {
			calls.deviceTree++;
			return [];
		};

		const devices = new Map([["DTU_SN", { dtuSerial: "DTU_SN", cloudStationId: 1, connection: null }]]);
		const adapter = makeMockAdapter();
		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 2,
		});

		// Force slowPoll by setting pollCount to make (pollCount+1) % slowPollFactor === 0
		poller.pollCount = 1; // next poll will be pollCount=2, 2%2===0 → slowPoll

		await poller.poll();

		assert.ok(calls.details > 0, "station details should be fetched on slow poll");
		assert.ok(calls.weather > 0, "weather should be fetched on slow poll");
		assert.ok(calls.deviceTree > 0, "device tree should be fetched on slow poll");
		assert.ok(calls.firmware > 0, "firmware check should run on slow poll");
		poller.stop();
	});

	it("fast poll skips station details and weather", async function () {
		const calls = { details: 0, weather: 0, deviceTree: 0 };
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "100",
			today_eq: "5000",
			month_eq: "30000",
			year_eq: "100000",
			total_eq: "500000",
			co2_emission_reduction: "1000",
			plant_tree: "5",
		});
		cloud.getStationDetails = async () => {
			calls.details++;
			return {};
		};
		cloud.getWeather = async () => {
			calls.weather++;
			return {};
		};
		cloud.getDeviceTree = async () => {
			calls.deviceTree++;
			return [];
		};

		const devices = new Map();
		const poller = makePoller({
			cloud,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 100, // very high so it never triggers
		});

		await poller.poll();

		assert.strictEqual(calls.details, 0, "station details should NOT be fetched on fast poll");
		assert.strictEqual(calls.weather, 0, "weather should NOT be fetched on fast poll");
		poller.stop();
	});

	it("poll with forceSlowPoll=true triggers slow poll regardless of pollCount", async function () {
		const calls = { details: 0 };
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => {
			calls.details++;
			return {};
		};
		cloud.getDeviceTree = async () => [];

		const poller = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 9999 });
		await poller.poll(true);

		assert.ok(calls.details > 0, "station details should be fetched when forceSlowPoll is true");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – pollDevicesAndInverters
// ============================================================
describe("CloudPoller – pollDevicesAndInverters", function () {
	it("fetches micro and module realtime data for cloud-only DTUs", async function () {
		const microCalls = [];
		const moduleCalls = [];
		const stateWrites = {};

		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "1000",
			month_eq: "5000",
			year_eq: "20000",
			total_eq: "100000",
			co2_emission_reduction: "500",
			plant_tree: "2",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_SN_1",
				soft_ver: "1.0.0",
				hard_ver: "2.0.0",
				id: 10,
				children: [
					{
						sn: "INV_SN_1",
						id: 100,
						model_no: "HMS-800W-2T",
						soft_ver: "3.0.0",
						hard_ver: "4.0.0",
						warn_data: { connect: true },
					},
				],
			},
		];
		cloud.getMicroRealtimeData = async (sid, ids, date, fields) => {
			microCalls.push({ sid, ids, fields });
			return {
				MI_POWER: 450,
				MI_NET_V: 230,
				MI_NET_RATE: 50.01,
				MI_TEMPERATURE: 38.5,
			};
		};
		cloud.getModuleRealtimeData = async (sid, invId, port, _date, _fields) => {
			moduleCalls.push({ sid, invId, port });
			return {
				MODULE_POWER: 225,
				MODULE_V: 33.2,
				MODULE_I: 6.8,
			};
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null, // not locally connected
			pvStatesCreated: false,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([42]),
			slowPollFactor: 1, // always slow poll so deviceTree is fetched
		});

		await poller.poll();

		assert.ok(microCalls.length > 0, "getMicroRealtimeData should be called");
		assert.ok(moduleCalls.length > 0, "getModuleRealtimeData should be called");
		// 2T model → 2 ports
		assert.strictEqual(moduleCalls.length, 2, "should fetch 2 PV ports for 2T model");
		assert.strictEqual(moduleCalls[0].port, 1);
		assert.strictEqual(moduleCalls[1].port, 2);

		// Verify state writes
		assert.strictEqual(stateWrites["DTU_SN_1.info.connected"], true);
		poller.stop();
	});

	it("skips locally connected DTUs in pollInverterRealtimeData", async function () {
		const microCalls = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_LOCAL",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T" }],
			},
		];
		cloud.getMicroRealtimeData = async () => {
			microCalls.push(true);
			return {};
		};

		const devices = new Map();
		devices.set("DTU_LOCAL", {
			dtuSerial: "DTU_LOCAL",
			cloudStationId: 1,
			connection: { connected: true }, // locally connected
		});

		const poller = makePoller({
			cloud,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();

		assert.strictEqual(microCalls.length, 0, "should not fetch micro data for locally connected DTU");
		poller.stop();
	});

	it("skips DTU when last fetch is within pollIntervalMs (throttling)", async function () {
		const microCalls = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_THROTTLE",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T" }],
			},
		];
		cloud.getMicroRealtimeData = async () => {
			microCalls.push(true);
			return { MI_POWER: 100 };
		};

		const devices = new Map();
		devices.set("DTU_THROTTLE", {
			dtuSerial: "DTU_THROTTLE",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: true,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});

		// First poll — should fetch
		await poller.poll();
		assert.strictEqual(microCalls.length, 1, "first poll should fetch micro data");

		// Second poll — should be throttled (within pollIntervalMs)
		await poller.poll();
		assert.strictEqual(microCalls.length, 1, "second poll should be throttled");
		poller.stop();
	});

	it("returns early from pollInverterRealtimeData when deviceTree is empty", async function () {
		const microCalls = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [];
		cloud.getMicroRealtimeData = async () => {
			microCalls.push(true);
			return {};
		};

		const poller = makePoller({
			cloud,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();

		assert.strictEqual(microCalls.length, 0, "should not call getMicroRealtimeData for empty deviceTree");
		poller.stop();
	});

	it("handles getMicroRealtimeData returning null gracefully", async function () {
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_NULL",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T" }],
			},
		];
		cloud.getMicroRealtimeData = async () => null;

		const devices = new Map();
		devices.set("DTU_NULL", {
			dtuSerial: "DTU_NULL",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: true,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});

		// Should not throw
		await assert.doesNotReject(() => poller.poll());
		poller.stop();
	});

	it("updateDeviceVersions writes version states for cloud-only DTUs on slow poll", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_VER",
				soft_ver: "V1.2.3",
				hard_ver: "HW4.5",
				id: 10,
				children: [
					{
						sn: "INV_VER",
						id: 100,
						model_no: "HMS-800W-2T",
						soft_ver: "V3.0",
						hard_ver: "HW2.0",
						warn_data: { connect: true },
					},
				],
			},
		];
		cloud.getMicroRealtimeData = async () => ({});
		cloud.getModuleRealtimeData = async () => null;

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const devices = new Map();
		devices.set("DTU_VER", {
			dtuSerial: "DTU_VER",
			cloudStationId: 1,
			connection: null, // cloud-only
			pvStatesCreated: true,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1, // always slow
		});

		await poller.poll();

		assert.strictEqual(stateWrites["DTU_VER.dtu.serialNumber"], "DTU_VER");
		assert.strictEqual(stateWrites["DTU_VER.dtu.swVersion"], "V1.2.3");
		assert.strictEqual(stateWrites["DTU_VER.dtu.hwVersion"], "HW4.5");
		assert.strictEqual(stateWrites["DTU_VER.inverter.model"], "HMS-800W-2T");
		assert.strictEqual(stateWrites["DTU_VER.inverter.serialNumber"], "INV_VER");
		assert.strictEqual(stateWrites["DTU_VER.inverter.linkStatus"], 1);
		poller.stop();
	});

	it("cleans up stale lastRealtimeFetch entries for removed devices", async function () {
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_ACTIVE",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T" }],
			},
		];
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 100 });
		cloud.getModuleRealtimeData = async () => null;

		const devices = new Map();
		devices.set("DTU_ACTIVE", {
			dtuSerial: "DTU_ACTIVE",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: true,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});

		await poller.poll();
		// Verify lastRealtimeFetch has DTU_ACTIVE
		assert.ok(poller.lastRealtimeFetch.has("DTU_ACTIVE"), "should track DTU_ACTIVE");

		// Manually add a stale entry
		poller.lastRealtimeFetch.set("DTU_REMOVED", Date.now());

		// Next poll triggers cleanup (need to reset throttle first)
		poller.lastRealtimeFetch.set("DTU_ACTIVE", 0); // reset throttle
		await poller.poll();

		assert.ok(!poller.lastRealtimeFetch.has("DTU_REMOVED"), "stale entry should be cleaned up");
		assert.ok(poller.lastRealtimeFetch.has("DTU_ACTIVE"), "active entry should remain");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – pollWeather
// ============================================================
describe("CloudPoller – pollWeather", function () {
	it("pollWeather skips when no coords are stored for station", async function () {
		const weatherCalls = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({
			name: "Test",
			latitude: "0",
			longitude: "0", // lat=0 → coords not stored
		});
		cloud.getWeather = async () => {
			weatherCalls.push(true);
			return {};
		};
		cloud.getDeviceTree = async () => [];

		const poller = makePoller({
			cloud,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();

		assert.strictEqual(weatherCalls.length, 0, "weather should not be fetched without valid coords");
		poller.stop();
	});

	it("pollWeather writes weather states with known icon description", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({
			name: "Test",
			latitude: "48.1",
			longitude: "11.5",
		});
		cloud.getWeather = async () => ({
			icon: "10d",
			temp: 15,
			sunrise: 1000,
			sunset: 2000,
		});
		cloud.getDeviceTree = async () => [];

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = val;
		};

		const poller = makePoller({
			cloud,
			adapter,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});

		await poller.poll();

		assert.strictEqual(stateWrites["station-1.weather.icon"], "10d");
		assert.strictEqual(stateWrites["station-1.weather.description"], "Rain");
		assert.strictEqual(stateWrites["station-1.weather.temperature"], 15);
		poller.stop();
	});
});

// ============================================================
// CloudPoller – pollFirmwareStatus
// ============================================================
describe("CloudPoller – pollFirmwareStatus", function () {
	it("pollFirmwareStatus checks firmware for matching devices", async function () {
		const fwCalls = [];
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [];
		cloud.checkFirmwareUpdate = async (sid, serial) => {
			fwCalls.push({ sid, serial });
			return { upgrade: 1 };
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = val;
		};

		const devices = new Map();
		devices.set("DTU_FW", {
			dtuSerial: "DTU_FW",
			cloudStationId: 1,
			connection: null,
		});
		devices.set("DTU_OTHER_STATION", {
			dtuSerial: "DTU_OTHER",
			cloudStationId: 99, // different station
			connection: null,
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		// Ensure firmware check day differs from today
		poller.lastFirmwareCheckDay = -1;

		await poller.poll();

		// Only the device matching station 1 should be checked
		assert.strictEqual(fwCalls.length, 1, "should check firmware for matching station device");
		assert.strictEqual(fwCalls[0].serial, "DTU_FW");
		assert.strictEqual(stateWrites["DTU_FW.dtu.fwUpdateAvailable"], true);
		poller.stop();
	});

	it("pollFirmwareStatus handles errors gracefully", async function () {
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [];
		cloud.checkFirmwareUpdate = async () => {
			throw new Error("API error");
		};

		const devices = new Map();
		devices.set("DTU1", { dtuSerial: "DTU1", cloudStationId: 1, connection: null });

		const poller = makePoller({
			cloud,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		poller.lastFirmwareCheckDay = -1;

		await assert.doesNotReject(() => poller.poll(), "firmware error should be caught gracefully");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – setPvStates
// ============================================================
describe("CloudPoller – setPvStates (via pollInverterRealtimeData)", function () {
	it("writes power, voltage, current for each PV port", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_PV",
				id: 10,
				children: [{ sn: "INV_PV", id: 200, model_no: "HMS-800W-2T" }],
			},
		];
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 400 });
		cloud.getModuleRealtimeData = async (sid, invId, port) => ({
			MODULE_POWER: 200 + port * 10,
			MODULE_V: 30 + port,
			MODULE_I: 6 + port * 0.1,
		});

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const devices = new Map();
		devices.set("DTU_PV", {
			dtuSerial: "DTU_PV",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: false,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});

		await poller.poll();

		// PV0 = port 1, PV1 = port 2
		assert.strictEqual(stateWrites["DTU_PV.pv0.power"], 210);
		assert.strictEqual(stateWrites["DTU_PV.pv0.voltage"], 31);
		assert.strictEqual(stateWrites["DTU_PV.pv0.current"], 6.1);
		assert.strictEqual(stateWrites["DTU_PV.pv1.power"], 220);
		assert.strictEqual(stateWrites["DTU_PV.pv1.voltage"], 32);
		assert.strictEqual(stateWrites["DTU_PV.pv1.current"], 6.2);
		poller.stop();
	});

	it("handles getModuleRealtimeData returning null", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_NULLMOD",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T" }],
			},
		];
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 100 });
		cloud.getModuleRealtimeData = async () => null;

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const devices = new Map();
		devices.set("DTU_NULLMOD", {
			dtuSerial: "DTU_NULLMOD",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: true,
			createPvStates: async () => {},
			refreshDeviceNameWithModel: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});

		await assert.doesNotReject(() => poller.poll());

		// PV states should NOT be written when module data is null
		assert.strictEqual(stateWrites["DTU_NULLMOD.pv0.power"], undefined);
		poller.stop();
	});
});

// ============================================================
// CloudPoller – initialFetch with hasRelay
// ============================================================
describe("CloudPoller – initialFetch with relay", function () {
	it("initialFetch sets state to RELAY_TRIGGERED when hasRelay is true", async function () {
		const poller = makePoller({ hasRelay: true, stationDevices: new Set() });
		await poller.initialFetch();
		assert.strictEqual(poller.state, "RELAY_TRIGGERED");
		poller.stop();
	});

	it("initialFetch sets state to POLLING_ACTIVE when hasRelay is false", async function () {
		const poller = makePoller({ hasRelay: false, stationDevices: new Set() });
		await poller.initialFetch();
		assert.strictEqual(poller.state, "POLLING_ACTIVE");
		poller.stop();
	});
});

// ============================================================
// CloudPoller – station poll error handling
// ============================================================
describe("CloudPoller – station poll error handling", function () {
	it("poll continues with other stations when one station throws", async function () {
		const polledStations = [];
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async sid => {
			if (sid === 2) {
				throw new Error("station 2 error");
			}
			polledStations.push(sid);
			return {
				real_power: "0",
				today_eq: "0",
				month_eq: "0",
				year_eq: "0",
				total_eq: "0",
				co2_emission_reduction: "0",
				plant_tree: "0",
			};
		};
		cloud.getDeviceTree = async () => [];

		const poller = makePoller({
			cloud,
			stationDevices: new Set([1, 2, 3]),
		});

		await assert.doesNotReject(() => poller.poll());
		assert.ok(polledStations.includes(1), "station 1 should be polled");
		assert.ok(polledStations.includes(3), "station 3 should be polled despite station 2 failure");
		poller.stop();
	});
});
