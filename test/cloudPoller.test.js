import assert from "node:assert";
import CloudPoller from "../build/lib/cloudPoller.js";

// ============================================================
// helpers
// ============================================================
function makeMockAdapter() {
	return {
		log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
		setStateAsync: async () => {},
		// CloudPoller's writeStationState / writeHybridState create objects on demand. Tests don't
		// care about the object, only the resulting setStateAsync call, so these are no-op stubs.
		extendObjectAsync: async () => {},
		setObjectNotExistsAsync: async () => {},
		subscribeStates: () => {},
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
		getMicroPortRules: async () => new Map(),
		getRealIndicators: async () => null,
		// Default: no period balance (a plain PV plant answers with last_data_time only).
		getStationEnergyStats: async () => null,
		// Default: no battery settings on tap — most tests never poll a storage plant far enough to
		// reach it, and those that do override this explicitly.
		readBatterySettings: async () => ({}),
	};
}

/**
 * Waits for the microtask queue to drain, so a fire-and-forget `void promise` inside the code
 * under test gets a chance to run before the assertions that follow.
 */
const flushMicrotasks = () => new Promise(r => setImmediate(r));

function makePoller(overrides = {}) {
	const defaults = {
		cloud: makeMockCloud(),
		adapter: makeMockAdapter(),
		devices: new Map(),
		stationDevices: new Set(),
		hasRelay: false,
		slowPollFactor: 6,
		burstActiveStations: new Set(),
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

	// NIGHT_MODE used to be escapable only via onLocalConnected(). A BLE-only inverter whose local
	// link does not come back in the morning then left the adapter polling weather forever, with no
	// cloud values at all — even though the station was uploading again.
	it("leaves NIGHT_MODE when the station uploads again, without a local connection", async function () {
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			real_power: "180",
			today_eq: "0",
			total_eq: "0",
			// Station-local wall clock; no cached tz offset in the test, so this is read as UTC.
			data_time: new Date().toISOString().replace("T", " ").slice(0, 19),
		});
		const poller = makePoller({ cloud, stationDevices: new Set([1]) });
		poller.state = "NIGHT_MODE";

		await poller.nightPoll();

		assert.strictEqual(poller.state, "POLLING_ACTIVE", "a fresh station upload must resume active polling");
		poller.stop();
	});

	it("stays in NIGHT_MODE while the station upload is stale", async function () {
		const cloud = makeMockCloud();
		const old = new Date(Date.now() - 6 * 60 * 60 * 1000);
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			total_eq: "0",
			data_time: old.toISOString().replace("T", " ").slice(0, 19),
		});
		const poller = makePoller({ cloud, stationDevices: new Set([1]) });
		poller.state = "NIGHT_MODE";

		await poller.nightPoll();

		assert.strictEqual(poller.state, "NIGHT_MODE", "a stale station must not wake the poller");
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
		poller.lastFirmwareCheckDay = new Map();

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

		// Mark station 1 as already firmware-checked today so it skips
		poller.lastFirmwareCheckDay = new Map([[1, new Date().getDate()]]);
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

	it("no longer writes a station-level battery capacity from station details (there is exactly one battery place, below the device)", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({ name: "Storage station", bms_capacitor: "10.5" });
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.battery.capacity"], undefined);
		assert.strictEqual(stateWrites["station-1.info.batteryCapacity"], undefined);
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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

	it("polls all four PV ports of a WB-series inverter (HMS-2000-4WB)", async function () {
		// Regression: the port count used to be parsed with /(\d+)T$/, which does not match
		// the WB series ("HMS-2000-4WB") and silently fell back to 2 ports — strings 3 and 4
		// then never received voltage/current. Reported at
		// https://forum.iobroker.net/topic/84475/.../43
		const moduleCalls = [];
		const createdPvCounts = [];

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
				id: 10,
				children: [
					{
						sn: "INV_SN_1",
						id: 100,
						model_no: "HMS-2000-4WB",
						warn_data: { connect: true },
					},
				],
			},
		];
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 900 });
		cloud.getModuleRealtimeData = async (sid, invId, port) => {
			moduleCalls.push(port);
			return { MODULE_POWER: 225, MODULE_V: 33.2, MODULE_I: 6.8 };
		};

		const adapter = makeMockAdapter();
		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null,
			pvStatesCreated: false,
			pvCount: 0,
			setCloudInverterSn: () => {},
			createPvStates: async count => {
				createdPvCounts.push(count);
			},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([42]),
			slowPollFactor: 1,
		});

		await poller.poll();

		assert.deepStrictEqual(
			moduleCalls.sort((a, b) => a - b),
			[1, 2, 3, 4],
			"all four PV ports of a 4WB inverter must be polled",
		);
		assert.deepStrictEqual(createdPvCounts, [4], "four PV state channels must be created");
		poller.stop();
	});

	it("prefers the cloud micro-rule dictionary over the model-name heuristic", async function () {
		// The dictionary (serial prefix → rule.port) is what the S-Miles app itself uses.
		// Where it disagrees with the model name, it wins: here the name says 2T while the
		// serial's prefix is registered with four ports.
		const moduleCalls = [];

		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_SN_1",
				id: 10,
				children: [{ sn: "1620ABCDEF01", id: 100, model_no: "HMS-800W-2T", warn_data: { connect: true } }],
			},
		];
		cloud.getMicroPortRules = async () => new Map([["1620", 4]]);
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 900 });
		cloud.getModuleRealtimeData = async (sid, invId, port) => {
			moduleCalls.push(port);
			return { MODULE_V: 33.2, MODULE_I: 6.8 };
		};

		const adapter = makeMockAdapter();
		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null,
			pvStatesCreated: false,
			pvCount: 0,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([42]),
			slowPollFactor: 1,
		});

		await poller.poll();

		assert.deepStrictEqual(
			moduleCalls.sort((a, b) => a - b),
			[1, 2, 3, 4],
			"the dictionary port count must override the model-name guess",
		);
		poller.stop();
	});

	it("does not cap an inverter with more than six strings", async function () {
		// The live micro-rule dictionary (2026-07-22) contains rules with 8 and 12 ports.
		// Capping at 6 would silently drop the remaining strings.
		const moduleCalls = [];

		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_SN_1",
				id: 10,
				children: [{ sn: "1520ABCDEF01", id: 100, model_no: "HMT-XXXX", warn_data: { connect: true } }],
			},
		];
		cloud.getMicroPortRules = async () => new Map([["1520", 8]]);
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 900 });
		cloud.getModuleRealtimeData = async (sid, invId, port) => {
			moduleCalls.push(port);
			return { MODULE_V: 33.2, MODULE_I: 6.8 };
		};

		const adapter = makeMockAdapter();
		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null,
			pvStatesCreated: false,
			pvCount: 0,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([42]),
			slowPollFactor: 1,
		});

		await poller.poll();

		assert.deepStrictEqual(
			moduleCalls.sort((a, b) => a - b),
			[1, 2, 3, 4, 5, 6, 7, 8],
			"an 8-string inverter must have all eight strings polled",
		);
		poller.stop();
	});

	it("polls as many PV ports as the burst poller has already discovered when the model name is unknown", async function () {
		// The burst poller derives the live string count from the data itself and grows
		// dtuDev.pvCount. If the model name yields no (or a smaller) count, that discovery
		// must still widen the voltage/current polling — otherwise the extra strings keep
		// power but never get V/I.
		const moduleCalls = [];

		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_SN_1",
				id: 10,
				children: [{ sn: "INV_SN_1", id: 100, model_no: "HMS-2000-SOMETHING", warn_data: { connect: true } }],
			},
		];
		cloud.getMicroRealtimeData = async () => ({ MI_POWER: 900 });
		cloud.getModuleRealtimeData = async (sid, invId, port) => {
			moduleCalls.push(port);
			return { MODULE_V: 33.2, MODULE_I: 6.8 };
		};

		const adapter = makeMockAdapter();
		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null,
			pvStatesCreated: true, // burst poller already created the states
			pvCount: 4, // …and discovered four live strings
			burstActive: true,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
		});

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([42]),
			slowPollFactor: 1,
		});

		await poller.poll();

		assert.deepStrictEqual(
			moduleCalls.sort((a, b) => a - b),
			[1, 2, 3, 4],
			"the burst-discovered string count must widen the module polling",
		);
		poller.stop();
	});

	it("yields grid.power/pvN.power to the burst poller when a DTU is burstActive, but keeps voltage/current/temperature", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
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
		cloud.getMicroRealtimeData = async () => ({
			MI_POWER: 450,
			MI_NET_V: 230,
			MI_NET_RATE: 50.01,
			MI_TEMPERATURE: 38.5,
		});
		cloud.getModuleRealtimeData = async () => ({ MODULE_POWER: 225, MODULE_V: 33.2, MODULE_I: 6.8 });

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null,
			burstActive: true, // burst poller owns power for this DTU
			pvStatesCreated: false,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
		});

		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([42]), slowPollFactor: 1 });
		await poller.poll();

		// Power states are yielded to the burst poller.
		assert.strictEqual(stateWrites["DTU_SN_1.grid.power"], undefined);
		assert.strictEqual(stateWrites["DTU_SN_1.pv0.power"], undefined);
		// Metrics the burst does not deliver are still written by the cloud poller.
		assert.strictEqual(stateWrites["DTU_SN_1.grid.voltage"], 230);
		assert.strictEqual(stateWrites["DTU_SN_1.grid.frequency"], 50.01);
		assert.strictEqual(stateWrites["DTU_SN_1.inverter.temperature"], 38.5);
		assert.strictEqual(stateWrites["DTU_SN_1.pv0.voltage"], 33.2);
		assert.strictEqual(stateWrites["DTU_SN_1.pv0.current"], 6.8);
		poller.stop();
	});

	it("writes per-inverter cloud values with quality 0x00 when the station is fresh and 0x42 when stale", async function () {
		const run = async dataTime => {
			const writes = {};
			const cloud = makeMockCloud();
			cloud.ensureToken = async () => {};
			cloud.getStationRealtime = async () => ({
				real_power: "200",
				today_eq: "0",
				month_eq: "0",
				year_eq: "0",
				total_eq: "0",
				co2_emission_reduction: "0",
				plant_tree: "0",
				data_time: dataTime,
			});
			cloud.getStationDetails = async () => ({});
			cloud.getDeviceTree = async () => [
				{
					sn: "DTU_SN_1",
					id: 10,
					children: [{ sn: "INV_SN_1", id: 100, model_no: "HMS-800W-2T", warn_data: { connect: true } }],
				},
			];
			cloud.getMicroRealtimeData = async () => ({ MI_NET_V: 230 });
			cloud.getModuleRealtimeData = async () => ({});

			const adapter = makeMockAdapter();
			adapter.setStateAsync = async (id, val) => {
				writes[id] = val;
			};
			const devices = new Map();
			devices.set("DTU_SN_1", {
				dtuSerial: "DTU_SN_1",
				cloudStationId: 42,
				connection: null,
				burstActive: false,
				pvStatesCreated: true,
				pvCount: 2,
				setCloudInverterSn: () => {},
				createPvStates: async () => {},
			});
			const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([42]), slowPollFactor: 1 });
			await poller.poll();
			poller.stop();
			return writes;
		};

		// No data_time → treated as fresh → good quality.
		const fresh = await run(undefined);
		assert.strictEqual(fresh["DTU_SN_1.grid.voltage"].q, 0x00);
		// Very old upload → stale → device-not-connected quality.
		const stale = await run("2020-01-01 00:00:00");
		assert.strictEqual(stale["DTU_SN_1.grid.voltage"].q, 0x42);
	});

	it("writes per-inverter cloud values with quality 0x42 when the station is fresh but no inverter child reports warn_data.connect", async function () {
		const writes = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
			// no data_time → station itself is treated as fresh/online
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_SN_1",
				id: 10,
				children: [{ sn: "INV_SN_1", id: 100, model_no: "HMS-800W-2T", warn_data: { connect: false } }],
			},
		];
		cloud.getMicroRealtimeData = async () => ({ MI_NET_V: 230 });
		cloud.getModuleRealtimeData = async () => ({});

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			writes[id] = val;
		};
		const devices = new Map();
		devices.set("DTU_SN_1", {
			dtuSerial: "DTU_SN_1",
			cloudStationId: 42,
			connection: null,
			burstActive: false,
			pvStatesCreated: true,
			pvCount: 2,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
		});
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([42]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(
			writes["DTU_SN_1.grid.voltage"].q,
			0x42,
			"fresh station but no connected inverter child ⇒ q=0x42",
		);
	});

	it("yields station grid.power to the burst (m:0) when the station is burst-active, keeps energy counters", async function () {
		const writes = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			real_power: "200",
			today_eq: "1500",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		});
		cloud.getStationDetails = async () => ({});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			writes[id] = typeof val === "object" ? val.val : val;
		};
		const poller = makePoller({
			cloud,
			adapter,
			stationDevices: new Set([42]),
			burstActiveStations: new Set([42]),
		});
		await poller.poll();
		poller.stop();

		// grid.power is left to the burst poller (m:0)…
		assert.strictEqual(writes["station-42.grid.power"], undefined);
		// …but the energy counters (which the burst does not deliver) are still written.
		assert.strictEqual(writes["station-42.grid.dailyEnergy"], 1.5);
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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
// CloudPoller – info.connected source discipline
// ============================================================
describe("CloudPoller – info.connected source discipline", function () {
	function setup(deviceOverrides, deviceTree) {
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
		cloud.getDeviceTree = async () => deviceTree;
		cloud.getMicroRealtimeData = async () => ({});
		cloud.getModuleRealtimeData = async () => null;

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const devices = new Map();
		devices.set(deviceOverrides.dtuSerial, {
			pvStatesCreated: true,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
			...deviceOverrides,
		});

		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		return { poller, stateWrites };
	}

	it("does NOT write info.connected for a locally-configured DTU that is offline", async function () {
		// connection != null (locally configured) but connected === false (sun is down).
		// The cloud must leave info.connected alone — the local layer already set it false.
		const { poller, stateWrites } = setup(
			{ dtuSerial: "DTU_LOCAL_OFF", cloudStationId: 1, connection: { connected: false } },
			[
				{
					sn: "DTU_LOCAL_OFF",
					id: 10,
					children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T", warn_data: { connect: true } }],
				},
			],
		);
		await poller.poll();
		assert.strictEqual(
			stateWrites["DTU_LOCAL_OFF.info.connected"],
			undefined,
			"cloud poller must not touch info.connected of a locally-configured DTU",
		);
		poller.stop();
	});

	it("writes info.connected=false for a cloud-only DTU whose inverter is disconnected", async function () {
		const { poller, stateWrites } = setup({ dtuSerial: "DTU_CLOUD_OFF", cloudStationId: 1, connection: null }, [
			{
				sn: "DTU_CLOUD_OFF",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T", warn_data: { connect: false } }],
			},
		]);
		await poller.poll();
		assert.strictEqual(stateWrites["DTU_CLOUD_OFF.info.connected"], false);
		poller.stop();
	});

	it("writes info.connected=true for a cloud-only DTU whose inverter is connected", async function () {
		const { poller, stateWrites } = setup({ dtuSerial: "DTU_CLOUD_ON", cloudStationId: 1, connection: null }, [
			{
				sn: "DTU_CLOUD_ON",
				id: 10,
				children: [{ sn: "INV1", id: 100, model_no: "HMS-400W-1T", warn_data: { connect: true } }],
			},
		]);
		await poller.poll();
		assert.strictEqual(stateWrites["DTU_CLOUD_ON.info.connected"], true);
		poller.stop();
	});
});

// ============================================================
// CloudPoller – station timezone & warnings
// ============================================================
describe("CloudPoller – station timezone & warnings", function () {
	it("converts lastCloudUpdate from station-local time to a UTC epoch", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		// Station reports a wall clock 2 hours ahead of real UTC → offset +2h.
		const stationLocalNow = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 19).replace("T", " ");
		cloud.getStationDetails = async () => ({ name: "TZ", local_time: stationLocalNow });
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
			data_time: "2026-05-15 14:30:00",
		});
		cloud.getDeviceTree = async () => [];

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();

		// 14:30 local in a UTC+2 zone is 12:30:00Z.
		assert.strictEqual(stateWrites["station-1.info.lastCloudUpdate"], Date.parse("2026-05-15T12:30:00Z"));
		poller.stop();
	});

	it("writes station warn states from the cloud warn_data block", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationDetails = async () => ({
			name: "W",
			warn_data: {
				s_uoff: false,
				s_ustable: false,
				s_uid: false,
				l3_warn: true,
				g_warn: true,
				me_warn: false,
				pw_off: false,
			},
		});
		cloud.getDeviceTree = async () => [];

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();

		assert.strictEqual(stateWrites["station-1.warn.gridFault"], true);
		assert.strictEqual(stateWrites["station-1.warn.deviceAlarm"], true);
		assert.strictEqual(stateWrites["station-1.warn.stationOffline"], false);
		assert.strictEqual(stateWrites["station-1.warn.meterFault"], false);
		poller.stop();
	});

	it("creates no warn states when the cloud delivers no warn_data (home account)", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		cloud.getStationDetails = async () => ({ name: "NoWarn" });
		cloud.getDeviceTree = async () => [];

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();

		assert.strictEqual(stateWrites["station-1.warn.gridFault"], undefined);
		poller.stop();
	});

	it("falls back to realtime.warn_data when details omits it (S-Miles Home account)", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		// Home find_c: no warn_data in details.
		cloud.getStationDetails = async () => ({ name: "Home" });
		// Home realtime_c: warn_data sits here instead.
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
			data_time: "2026-05-21 10:00:00",
			warn_data: {
				s_uoff: true,
				s_ustable: false,
				s_uid: false,
				l3_warn: false,
				g_warn: false,
				me_warn: false,
				pw_off: null,
			},
		});
		cloud.getDeviceTree = async () => [];

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();

		assert.strictEqual(
			stateWrites["station-1.warn.stationOffline"],
			true,
			"stationOffline from realtime warn_data",
		);
		assert.strictEqual(stateWrites["station-1.warn.gridFault"], false);
		poller.stop();
	});

	it("derives TZ offset from realtime.local_time when details omits it (S-Miles Home account)", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.ensureToken = async () => {};
		// Home find_c: no local_time in details.
		cloud.getStationDetails = async () => ({ name: "Home" });
		const stationLocalNow = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 19).replace("T", " ");
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
			data_time: "2026-05-21 12:30:00",
			// Home realtime: local_time present here.
			local_time: stationLocalNow,
		});
		cloud.getDeviceTree = async () => [];

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};

		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();

		// 12:30 station-local at +2h offset is 10:30:00Z.
		assert.strictEqual(stateWrites["station-1.info.lastCloudUpdate"], Date.parse("2026-05-21T10:30:00Z"));
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
		poller.lastFirmwareCheckDay = new Map();

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
		poller.lastFirmwareCheckDay = new Map();

		await assert.doesNotReject(() => poller.poll(), "firmware error should be caught gracefully");
		poller.stop();
	});

	it("checks firmware for every station, not just the first one polled", async function () {
		const fwStations = [];
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
		cloud.checkFirmwareUpdate = async sid => {
			fwStations.push(sid);
			return { upgrade: 0 };
		};

		const devices = new Map();
		devices.set("DTU_A", { dtuSerial: "DTU_A", cloudStationId: 1, connection: null });
		devices.set("DTU_B", { dtuSerial: "DTU_B", cloudStationId: 2, connection: null });

		const poller = makePoller({ cloud, devices, stationDevices: new Set([1, 2]), slowPollFactor: 1 });
		await poller.poll();

		assert.ok(fwStations.includes(1), "station 1 firmware should be checked");
		assert.ok(fwStations.includes(2), "station 2 firmware should be checked (per-station day tracking)");
		poller.stop();
	});

	it("writes formatted swVersion from firmware-compare list (home account fallback)", async function () {
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
		cloud.checkFirmwareUpdate = async () => ({
			upgrade: 0,
			done: 0,
			tid: "0",
			devices: [
				// DTU: 4103 → V01.00.07 via formatDtuVersion
				{ sn: "DTU_HM", devType: 1, currentVer: 4103, targetVer: 4103, isUpgrade: 0 },
				// Inverter: 10309 → V01.03.09 via formatSwVersion
				{ sn: "INV_HM", devType: 3, currentVer: 10309, targetVer: 10309, isUpgrade: 0 },
			],
		});

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = val;
		};

		const devices = new Map();
		devices.set("DTU_HM", { dtuSerial: "DTU_HM", cloudStationId: 1, connection: null });

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		poller.lastFirmwareCheckDay = new Map();
		await poller.poll();

		assert.strictEqual(stateWrites["DTU_HM.dtu.fwUpdateAvailable"], false);
		assert.strictEqual(stateWrites["DTU_HM.dtu.swVersion"], "V01.00.07");
		assert.strictEqual(stateWrites["DTU_HM.inverter.swVersion"], "V01.03.09");
		poller.stop();
	});

	it("skips swVersion writes when currentVer is zero (no overwrite with V00.00.00)", async function () {
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
		cloud.checkFirmwareUpdate = async () => ({
			upgrade: 0,
			done: 0,
			tid: "0",
			devices: [{ sn: "DTU_X", devType: 1, currentVer: 0, targetVer: 0, isUpgrade: 0 }],
		});

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, _ack) => {
			stateWrites[id] = val;
		};

		const devices = new Map();
		devices.set("DTU_X", { dtuSerial: "DTU_X", cloudStationId: 1, connection: null });

		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		poller.lastFirmwareCheckDay = new Map();
		await poller.poll();

		assert.strictEqual(stateWrites["DTU_X.dtu.fwUpdateAvailable"], false);
		assert.strictEqual(stateWrites["DTU_X.dtu.swVersion"], undefined, "must not blank swVersion with V00.00.00");
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
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

// ============================================================
// CloudPoller – station freshness & re-online behaviour
// ============================================================
describe("CloudPoller – freshness & re-online", function () {
	// Format a Date as the cloud's local-zone wall-clock string "YYYY-MM-DD HH:MM:SS" (UTC here,
	// matched by offset=0 in the poller on the first poll).
	const wallClock = d =>
		`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ` +
		`${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;

	const realtime = dataTime => ({
		real_power: "5",
		today_eq: "0",
		month_eq: "0",
		year_eq: "0",
		total_eq: "0",
		co2_emission_reduction: "0",
		plant_tree: "0",
		data_time: dataTime,
		last_data_time: dataTime,
	});

	it("forces a full refresh when a station transitions offline → online", async function () {
		let detailsCalls = 0;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => realtime(wallClock(new Date())); // fresh
		cloud.getStationDetails = async () => {
			detailsCalls++;
			return {};
		};
		cloud.getDeviceTree = async () => [];

		const poller = makePoller({ cloud, stationDevices: new Set([42]) });
		poller.stationOnline.set(42, false); // pretend it was offline last cycle

		await poller.poll(); // pollCount → 1, 1 % 6 ≠ 0 ⇒ NOT a slow poll
		assert.strictEqual(detailsCalls, 1, "details must be fetched on the fast poll that detects re-online");
		assert.strictEqual(poller.stationOnline.get(42), true, "station should now be marked online");
		poller.stop();
	});

	it("does not force a refresh while the station stays online", async function () {
		let detailsCalls = 0;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => realtime(wallClock(new Date()));
		cloud.getStationDetails = async () => {
			detailsCalls++;
			return {};
		};
		cloud.getDeviceTree = async () => [];

		const poller = makePoller({ cloud, stationDevices: new Set([42]) });
		poller.stationOnline.set(42, true); // already online

		await poller.poll(); // fast poll, no transition
		assert.strictEqual(detailsCalls, 0, "no details fetch on a fast poll when already online");
		poller.stop();
	});

	it("reports stationOffline=false when s_uoff=true but realtime data is fresh (relay-bump transient)", async function () {
		const writes = [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, state) => {
			writes.push({ id, state });
		};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => realtime(wallClock(new Date())); // fresh upload
		cloud.getStationDetails = async () => ({ warn_data: { s_uoff: true } }); // cloud transiently flags offline
		cloud.getDeviceTree = async () => [];
		const poller = new CloudPoller({
			cloud,
			adapter,
			devices: new Map(),
			stationDevices: new Set([42]),
			hasRelay: false,
			slowPollFactor: 6,
			burstActiveStations: new Set(),
		});

		await poller.poll(true); // force a slow poll so pollStationDetails runs
		const off = writes.find(w => w.id === "station-42.warn.stationOffline");
		assert.ok(off, "warn.stationOffline should be written");
		assert.strictEqual(off.state, false, "fresh data must override a transient s_uoff=true → stationOffline false");
		poller.stop();
	});

	it("reports stationOffline=true only when s_uoff=true AND data is stale", async function () {
		const writes = [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, state) => {
			writes.push({ id, state });
		};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => realtime("2020-01-01 00:00:00"); // stale
		cloud.getStationDetails = async () => ({ warn_data: { s_uoff: true } });
		cloud.getDeviceTree = async () => [];
		const poller = new CloudPoller({
			cloud,
			adapter,
			devices: new Map(),
			stationDevices: new Set([42]),
			hasRelay: false,
			slowPollFactor: 6,
			burstActiveStations: new Set(),
		});

		await poller.poll(true);
		const off = writes.find(w => w.id === "station-42.warn.stationOffline");
		assert.ok(off, "warn.stationOffline should be written");
		assert.strictEqual(off.state, true, "stale data + s_uoff=true → stationOffline true");
		poller.stop();
	});

	it("flags stale cloud measurements with quality 0x42 (and fresh ones with 0x00)", async function () {
		const writes = [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, state) => {
			writes.push({ id, state });
		};

		// Stale: data_time far in the past ⇒ offline ⇒ q=0x42
		const staleCloud = makeMockCloud();
		staleCloud.getStationRealtime = async () => realtime("2020-01-01 00:00:00");
		staleCloud.getDeviceTree = async () => [];
		const stalePoller = new CloudPoller({
			cloud: staleCloud,
			adapter,
			devices: new Map(),
			stationDevices: new Set([42]),
			hasRelay: false,
			slowPollFactor: 6,
			burstActiveStations: new Set(),
		});
		await stalePoller.poll();
		const stalePower = writes.find(w => w.id === "station-42.grid.power");
		assert.ok(stalePower, "grid.power should be written");
		assert.strictEqual(stalePower.state.q, 0x42, "stale grid.power must carry quality 0x42");
		stalePoller.stop();

		// Fresh: current data_time ⇒ online ⇒ q=0x00
		writes.length = 0;
		const freshCloud = makeMockCloud();
		freshCloud.getStationRealtime = async () => realtime(wallClock(new Date()));
		freshCloud.getDeviceTree = async () => [];
		const freshPoller = new CloudPoller({
			cloud: freshCloud,
			adapter,
			devices: new Map(),
			stationDevices: new Set([42]),
			hasRelay: false,
			slowPollFactor: 6,
			burstActiveStations: new Set(),
		});
		await freshPoller.poll();
		const freshPower = writes.find(w => w.id === "station-42.grid.power");
		assert.ok(freshPower, "grid.power should be written");
		assert.strictEqual(freshPower.state.q, 0x00, "fresh grid.power must carry quality 0x00");
		freshPoller.stop();
	});
});

// ============================================================
// CloudPoller – hybrid (storage) inverter
// ============================================================
describe("CloudPoller – hybrid inverter", function () {
	// Recorded real device-tree shape for a HAT-6.0HV-EUG1 + battery, serials made up.
	function hatDeviceTree() {
		return [
			{
				sn: "DTU_HAT",
				id: 1,
				type: 1,
				model_no: "DTS-WIFI-G1",
				soft_ver: "",
				hard_ver: "",
				warn_data: { connect: true, warn: false },
				children: [
					{
						sn: "INV_HAT",
						id: 135250,
						type: 6,
						model_no: "HAT-6.0HV-EUG1",
						soft_ver: "V02.07.07",
						hard_ver: "",
						warn_data: { connect: true, warn: false },
						children: [
							{
								sn: "BAT_HAT",
								id: -5,
								type: 10,
								model_no: "HB-(10-23)S-G2",
								soft_ver: "V00.00.00.29",
								hard_ver: "V00.00.02.113",
								warn_data: { connect: true, warn: null },
								extend_data: { bms_type: 1, bms_capacitor: "15.3", id: 135250 },
								children: [],
							},
						],
					},
				],
			},
		];
	}

	function baseRealtime() {
		return {
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		};
	}

	function hatDevice(overrides = {}) {
		return {
			dtuSerial: "DTU_HAT",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: true,
			pvCount: 0,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
			...overrides,
		};
	}

	it("never calls getMicroRealtimeData/getModuleRealtimeData for a hybrid inverter, and reads the inverter and its battery via getRealIndicators (no PV request without a reported input, no grid meter from the inverter path)", async function () {
		const selectorCalls = [];
		let microCalled = false;
		let moduleCalled = false;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			selectorCalls.push(selector);
			return null;
		};
		cloud.getMicroRealtimeData = async () => {
			microCalled = true;
			return {};
		};
		cloud.getModuleRealtimeData = async () => {
			moduleCalled = true;
			return {};
		};

		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(microCalled, false, "a hybrid inverter must never go through the microinverter path");
		assert.strictEqual(moduleCalled, false, "a hybrid inverter has no per-module chart data");
		assert.strictEqual(selectorCalls.length, 2, "inverter + battery = 2 getRealIndicators calls");
		assert.deepStrictEqual(selectorCalls[0], { type: 6, inv_list: [{ id: 135250, sn: "INV_HAT", type: 6 }] });
		assert.deepStrictEqual(selectorCalls[1], {
			type: 10,
			inv_list: [{ id: 135250, sn: "INV_HAT", type: 0 }],
			dev_sn: "BAT_HAT",
		});
	});

	it("requests the PV set with a type-4 selector, using the inverter's own device type, only when pv_total > 0", async function () {
		const calls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			calls.push(selector);
			return selector.type === 6 ? { title: "IND_INV", pv_total: 2, list: [] } : null;
		};

		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		const pvCall = calls.find(c => c.type === 4);
		assert.deepStrictEqual(pvCall, { type: 4, inv_list: [{ id: 135250, sn: "INV_HAT", type: 6 }] });
	});

	it("does not request the PV set when the inverter reports no PV inputs (pv_total missing or 0)", async function () {
		for (const invData of [
			{ title: "IND_INV", list: [] },
			{ title: "IND_INV", pv_total: 0, list: [] },
		]) {
			const calls = [];
			const cloud = makeMockCloud();
			cloud.getStationRealtime = async () => baseRealtime();
			cloud.getDeviceTree = async () => hatDeviceTree();
			cloud.getRealIndicators = async (stationId, selector) => {
				calls.push(selector);
				return selector.type === 6 ? invData : null;
			};

			const devices = new Map([["DTU_HAT", hatDevice()]]);
			const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
			await poller.poll();
			poller.stop();

			assert.ok(
				!calls.some(c => c.type === 4),
				`pv_total=${invData.pv_total} must not trigger a type-4 PV request`,
			);
		}
	});

	it("uses a battery pack system's own device type (22) as the selector, response title IND_BPS", async function () {
		const tree = hatDeviceTree();
		tree[0].children[0].children[0] = { ...tree[0].children[0].children[0], type: 22, sn: "BPS_HAT" };
		const calls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => tree;
		cloud.getRealIndicators = async (stationId, selector) => {
			calls.push(selector);
			return null;
		};

		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		const bpsCall = calls.find(c => c.dev_sn === "BPS_HAT");
		assert.deepStrictEqual(bpsCall, {
			type: 22,
			inv_list: [{ id: 135250, sn: "INV_HAT", type: 0 }],
			dev_sn: "BPS_HAT",
		});
	});

	it("skips the IND_BMS battery.soc while the station is burst-active, but still writes the other battery values", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 10
				? {
						title: "IND_BMS",
						list: [
							{ key: "bms_soc", val: "24", unit: "%" },
							{ key: "bms_v", val: "306.6", unit: "V" },
						],
					}
				: null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();
		poller.stop();

		assert.strictEqual(
			stateWrites["DTU_HAT.battery.soc"],
			undefined,
			"the burst delivers soc every few seconds — the 5-minute value must not fight it",
		);
		assert.strictEqual(stateWrites["DTU_HAT.battery.voltage"], 306.6, "other battery values are still written");
	});

	it("writes the IND_BMS battery.soc normally when the station is not burst-active", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 10 ? { title: "IND_BMS", list: [{ key: "bms_soc", val: "24", unit: "%" }] } : null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["DTU_HAT.battery.soc"], 24);
	});

	it("writes hybrid indicator values to the right states with quality 0x00 when online and connected", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			if (selector.type === 6) {
				return {
					title: "IND_INV",
					pv_total: 0,
					list: [
						{ key: "p_total", val: 543, unit: "W" },
						{ key: "v_a", val: "226.1", unit: "V" },
						{ key: "peps_c", val: "0", unit: "W" },
					],
				};
			}
			if (selector.type === 10) {
				return { title: "IND_BMS", list: [{ key: "bms_soc", val: "24", unit: "%" }] };
			}
			return null;
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = val;
		};
		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(stateWrites["DTU_HAT.grid.power"], { val: 543, ack: true, q: 0x00 });
		assert.deepStrictEqual(stateWrites["DTU_HAT.grid.l1Voltage"], { val: 226.1, ack: true, q: 0x00 });
		assert.deepStrictEqual(stateWrites["DTU_HAT.eps.l3Power"], { val: 0, ack: true, q: 0x00 });
		assert.deepStrictEqual(stateWrites["DTU_HAT.battery.soc"], { val: 24, ack: true, q: 0x00 });
		assert.strictEqual(
			stateWrites["DTU_HAT.gridMeter.power"],
			undefined,
			"the grid meter no longer comes from the inverter path",
		);
	});

	it("flags hybrid inverter values with quality 0x42 when the inverter's warn_data.connect is false", async function () {
		const stateWrites = {};
		const tree = hatDeviceTree();
		tree[0].children[0].warn_data = { connect: false, warn: false };
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => tree;
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 6 ? { title: "IND_INV", list: [{ key: "p_total", val: 543 }] } : null;

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = val;
		};
		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["DTU_HAT.grid.power"].q, 0x42);
	});

	it("creates the battery/eps channels and their states on first use, not again on a later poll", async function () {
		const setObjectCalls = [];
		const extendObjectCalls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			if (selector.type === 6) {
				return {
					title: "IND_INV",
					list: [
						{ key: "p_total", val: 543 },
						{ key: "peps_c", val: 0 },
					],
				};
			}
			if (selector.type === 10) {
				return { title: "IND_BMS", list: [{ key: "bms_soc", val: 24 }] };
			}
			return null;
		};

		const adapter = makeMockAdapter();
		adapter.setObjectNotExistsAsync = async id => {
			setObjectCalls.push(id);
		};
		adapter.extendObjectAsync = async id => {
			extendObjectCalls.push(id);
		};
		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.poll();
		const channelCallsAfterFirstPoll = setObjectCalls.filter(id => id.startsWith("DTU_HAT."));
		const stateCallsAfterFirstPoll = extendObjectCalls.filter(id => id.startsWith("DTU_HAT."));
		// All writes of one poll start at the same time; the ones sharing a channel must wait for a
		// single creation call instead of each issuing their own.
		assert.deepStrictEqual(
			[...channelCallsAfterFirstPoll].sort(),
			["DTU_HAT.battery", "DTU_HAT.eps"],
			"each of the two hybrid channels must be created exactly once, no gridMeter channel on the device",
		);
		assert.strictEqual(
			stateCallsAfterFirstPoll.length,
			new Set(stateCallsAfterFirstPoll).size,
			"no state object may be created twice",
		);
		assert.ok(stateCallsAfterFirstPoll.includes("DTU_HAT.battery.soc"));
		assert.ok(stateCallsAfterFirstPoll.includes("DTU_HAT.eps.l3Power"));

		// Reset the per-DTU throttle so the second poll actually re-fetches (see the throttling
		// test above for the same pattern).
		poller.lastRealtimeFetch.set("DTU_HAT", 0);
		setObjectCalls.length = 0;
		extendObjectCalls.length = 0;
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(
			setObjectCalls.filter(id => id.startsWith("DTU_HAT.")),
			[],
			"no channel must be created again on a later poll",
		);
		assert.deepStrictEqual(
			extendObjectCalls.filter(id => id.startsWith("DTU_HAT.")),
			[],
			"no state must be created again on a later poll",
		);
	});

	// The reference plant is AC-coupled: its PV comes from a separate inverter behind a PV meter,
	// the hybrid inverter's own two inputs reported 0 V for a whole day, and the station says so
	// with icon_pv: 0. No PV request and no pvN states for such a plant.
	it("skips the PV request and the PV states when the station reports no PV on the hybrid inverter (icon_pv 0)", async function () {
		const selectors = [];
		let created = false;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: { icon_pv: 0, icon_pvi: 1, icon_grid: 1, icon_bms: 1 },
		});
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			selectors.push(selector.type);
			if (selector.type === 6) {
				return { title: "IND_INV", pv_total: 2, list: [{ key: "p_total", val: 10 }] };
			}
			return null;
		};
		const dev = hatDevice();
		dev.createPvStates = async () => {
			created = true;
		};
		const poller = makePoller({
			cloud,
			adapter: makeMockAdapter(),
			devices: new Map([["DTU_HAT", dev]]),
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();
		poller.stop();
		assert.ok(!selectors.includes(4), `no type-4 request, got ${selectors.join(",")}`);
		assert.strictEqual(created, false, "no PV states");
	});

	it("creates PV states from pv_total when the indicator list carries no PV entries (e.g. at night)", async function () {
		let createArgs = null;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 6 ? { title: "IND_INV", pv_total: 2, list: [] } : null;

		const devices = new Map([
			[
				"DTU_HAT",
				hatDevice({
					pvStatesCreated: false,
					createPvStates: async (count, cloudOnly) => {
						createArgs = { count, cloudOnly };
					},
				}),
			],
		]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(createArgs, { count: 2, cloudOnly: true });
	});

	it("writes 1_pv_p / 2_pv_v indicator entries (1-based) from the PV set to pv0.power / pv1.voltage", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			if (selector.type === 6) {
				return { title: "IND_INV", pv_total: 2, list: [] };
			}
			if (selector.type === 4) {
				return {
					title: "IND_PV",
					pv_total: 2,
					list: [
						{ key: "1_pv_p", val: 120, unit: "W" },
						{ key: "2_pv_v", val: "35.2", unit: "V" },
					],
				};
			}
			return null;
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const dev = hatDevice({
			pvStatesCreated: false,
			createPvStates: async count => {
				dev.pvCount = count;
				dev.pvStatesCreated = true;
			},
		});
		const devices = new Map([["DTU_HAT", dev]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["DTU_HAT.pv0.power"], 120);
		assert.strictEqual(stateWrites["DTU_HAT.pv1.voltage"], 35.2);
	});

	it("writes pv_p_total / pv_e_total from the PV set onto inverter.pvPower / inverter.pvEnergyToday", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			if (selector.type === 6) {
				return { title: "IND_INV", pv_total: 1, list: [] };
			}
			if (selector.type === 4) {
				return {
					title: "IND_PV",
					pv_total: 1,
					list: [
						{ key: "pv_p_total", val: "812", unit: "W" },
						{ key: "pv_e_total", val: "1250", unit: "Wh" },
					],
				};
			}
			return null;
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice()]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["DTU_HAT.inverter.pvPower"], 812);
		assert.strictEqual(stateWrites["DTU_HAT.inverter.pvEnergyToday"], 1.25);
	});

	it("creates the pvN.dailyEnergy object on demand exactly once across polls, and writes N_pv_e there", async function () {
		const stateWrites = {};
		const extendObjectCalls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		cloud.getRealIndicators = async (stationId, selector) => {
			if (selector.type === 6) {
				return { title: "IND_INV", pv_total: 1, list: [] };
			}
			if (selector.type === 4) {
				return { title: "IND_PV", pv_total: 1, list: [{ key: "1_pv_e", val: "3.456", unit: "kWh" }] };
			}
			return null;
		};

		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		adapter.extendObjectAsync = async id => {
			extendObjectCalls.push(id);
		};
		const dev = hatDevice({
			pvStatesCreated: false,
			pvCount: 0,
			createPvStates: async count => {
				dev.pvCount = count;
				dev.pvStatesCreated = true;
			},
		});
		const devices = new Map([["DTU_HAT", dev]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.poll();
		assert.strictEqual(stateWrites["DTU_HAT.pv0.dailyEnergy"], 3.456);
		assert.deepStrictEqual(
			extendObjectCalls.filter(id => id === "DTU_HAT.pv0.dailyEnergy"),
			["DTU_HAT.pv0.dailyEnergy"],
			"pv0.dailyEnergy must be created exactly once",
		);

		// Reset the per-DTU throttle so the second poll actually re-fetches.
		poller.lastRealtimeFetch.set("DTU_HAT", 0);
		extendObjectCalls.length = 0;
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(
			extendObjectCalls.filter(id => id === "DTU_HAT.pv0.dailyEnergy"),
			[],
			"pv0.dailyEnergy must not be created again on a later poll",
		);
	});

	it("sets dev.hybridInverter=true for a DTU whose device-tree child is a hybrid inverter (type 6), and caches its serial", async function () {
		const cachedSns = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => hatDeviceTree();
		const dev = hatDevice({ hybridInverter: false, setCloudInverterSn: sn => cachedSns.push(sn) });
		const devices = new Map([["DTU_HAT", dev]]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(dev.hybridInverter, true);
		assert.deepStrictEqual(cachedSns, ["INV_HAT"]);
	});

	it("never sets dev.hybridInverter for a DTU whose device-tree child is a plain microinverter", async function () {
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_MICRO3",
				id: 1,
				children: [
					{ sn: "INV_MICRO3", id: 100, type: 3, model_no: "HMS-800W-2T", warn_data: { connect: true } },
				],
			},
		];
		const dev = {
			dtuSerial: "DTU_MICRO3",
			cloudStationId: 1,
			connection: null,
			pvStatesCreated: true,
			hybridInverter: false,
			setCloudInverterSn: () => {},
			createPvStates: async () => {},
		};
		const devices = new Map([["DTU_MICRO3", dev]]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(dev.hybridInverter, false);
	});

	it("leaves a DTU with a normal microinverter child (type 3) on the microinverter path, untouched by getRealIndicators", async function () {
		let microCalled = false;
		let realIndicatorsCalled = false;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_MICRO",
				id: 1,
				children: [
					{ sn: "INV_MICRO", id: 100, type: 3, model_no: "HMS-800W-2T", warn_data: { connect: true } },
				],
			},
		];
		cloud.getMicroRealtimeData = async () => {
			microCalled = true;
			return { MI_POWER: 100 };
		};
		cloud.getRealIndicators = async () => {
			realIndicatorsCalled = true;
			return null;
		};

		const devices = new Map([
			[
				"DTU_MICRO",
				{
					dtuSerial: "DTU_MICRO",
					cloudStationId: 1,
					connection: null,
					pvStatesCreated: true,
					setCloudInverterSn: () => {},
					createPvStates: async () => {},
				},
			],
		]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(microCalled, true, "a normal microinverter must still use getMicroRealtimeData");
		assert.strictEqual(realIndicatorsCalled, false, "getRealIndicators must not be called for a microinverter");
	});

	it("pollGridProfiles skips a DTU whose first child is a hybrid inverter, but still reads a microinverter's profile", async function () {
		const readCalls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => [
			{
				sn: "DTU_HAT2",
				id: 1,
				children: [{ sn: "INV_HAT2", id: 2, type: 6, warn_data: { connect: true } }],
			},
			{
				sn: "DTU_MICRO2",
				id: 3,
				children: [{ sn: "INV_MICRO2", id: 4, type: 3, warn_data: { connect: true } }],
			},
		];
		cloud.readGridProfileViaCloud = async (devSn, dtuSn) => {
			readCalls.push({ devSn, dtuSn });
			return [];
		};
		cloud.getRealIndicators = async () => null;

		const devices = new Map([
			[
				"DTU_HAT2",
				{
					dtuSerial: "DTU_HAT2",
					cloudStationId: 1,
					connection: null,
					pvStatesCreated: true,
					setCloudInverterSn: () => {},
					createPvStates: async () => {},
				},
			],
			[
				"DTU_MICRO2",
				{
					dtuSerial: "DTU_MICRO2",
					cloudStationId: 1,
					connection: null,
					pvStatesCreated: true,
					setCloudInverterSn: () => {},
					createPvStates: async () => {},
				},
			],
		]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(readCalls.length, 1, "the grid profile must be read for the microinverter DTU only");
		assert.strictEqual(readCalls[0].dtuSn, "DTU_MICRO2");
	});

	it("writes the storage station's day-energy balance (incl. battery charge/discharge) and live flow from reflux_station_data", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: {
				icon_bms: 1,
				icon_grid: 1,
				grid_power: "0.0",
				load_power: "567.0",
				bms_power: "567.0",
				bms_soc: "25",
				use_eq_total: "14300",
				efg_total: "6500",
				e2g_total: "3000",
				e2b_total: "7800",
				efb_total: "5400",
			},
		});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice({ hybridInverter: true })]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.grid.consumptionToday"], 14.3);
		assert.strictEqual(stateWrites["station-1.grid.gridImportToday"], 6.5);
		assert.strictEqual(stateWrites["station-1.grid.gridExportToday"], 3);
		assert.strictEqual(stateWrites["station-1.grid.batteryChargeToday"], 7.8);
		assert.strictEqual(stateWrites["station-1.grid.batteryDischargeToday"], 5.4);
		assert.strictEqual(stateWrites["station-1.grid.loadPower"], 567);
		assert.strictEqual(
			stateWrites["station-1.battery.soc"],
			undefined,
			"the state of charge is no longer part of the station's storage flow at all",
		);
	});

	it("keeps the day-energy counters but skips the live flow states when the station is burst-active", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: {
				icon_bms: 1,
				icon_grid: 1,
				grid_power: "0.0",
				load_power: "567.0",
				bms_power: "567.0",
				bms_soc: "25",
				use_eq_total: "14300",
				efg_total: "6500",
				e2g_total: "3000",
				e2b_total: "7800",
				efb_total: "5400",
			},
		});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice({ hybridInverter: true })]]);
		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.grid.consumptionToday"], 14.3);
		assert.strictEqual(stateWrites["station-1.grid.batteryChargeToday"], 7.8);
		assert.strictEqual(stateWrites["station-1.grid.loadPower"], undefined);
		assert.strictEqual(stateWrites["station-1.battery.soc"], undefined);
		assert.strictEqual(stateWrites["station-1.grid.batteryPower"], undefined);
		assert.strictEqual(stateWrites["station-1.grid.gridPower"], undefined);
	});

	it("writes nothing from reflux_station_data on a balcony system (icon_bms=0, icon_grid=0)", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: {
				icon_bms: 0,
				icon_grid: 0,
				grid_power: "0.0",
				load_power: "0.0",
				bms_power: "0.0",
				bms_soc: "0",
				use_eq_total: "0",
				efg_total: "0",
				e2g_total: "0",
				e2b_total: "0",
				efb_total: "0",
			},
		});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.grid.consumptionToday"], undefined);
		assert.strictEqual(stateWrites["station-1.battery.soc"], undefined);
		assert.strictEqual(stateWrites["station-1.grid.loadPower"], undefined);
	});

	it("writes the battery working mode from reflux_station_data.work_mode to the hybrid device, including on a burst-active station", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: {
				icon_bms: 1,
				icon_grid: 1,
				bms_soc: "25",
				e2b_total: "7800",
				efb_total: "5400",
				work_mode: 1000,
			},
		});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice({ hybridInverter: true })]]);
		const poller = makePoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set([1]),
			slowPollFactor: 1,
		});
		await poller.poll();
		poller.stop();

		assert.strictEqual(
			stateWrites["DTU_HAT.battery.workMode"],
			1,
			"battery.workMode must be written even while the burst owns the live flow",
		);
		assert.strictEqual(stateWrites["station-1.battery.workMode"], undefined, "there is no station battery place");
	});

	it("writes the battery working mode to every hybrid device of the station", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: { icon_bms: 1, icon_grid: 1, e2b_total: "7800", efb_total: "5400", work_mode: 3000 },
		});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([
			["DTU_HAT", hatDevice({ hybridInverter: true })],
			["DTU_HAT2", hatDevice({ dtuSerial: "DTU_HAT2", hybridInverter: true })],
		]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["DTU_HAT.battery.workMode"], 3);
		assert.strictEqual(stateWrites["DTU_HAT2.battery.workMode"], 3);
	});

	it("does not write battery.workMode anywhere for a plant without a battery", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: { icon_bms: 0, icon_grid: 1, grid_power: "0.0", work_mode: 1000 },
		});
		cloud.getDeviceTree = async () => [];
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([["DTU_HAT", hatDevice({ hybridInverter: true })]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.battery.workMode"], undefined);
		assert.strictEqual(stateWrites["DTU_HAT.battery.workMode"], undefined);
	});
});

// ============================================================
// CloudPoller – pollStationIndicators (station-level measuring points)
// ============================================================
describe("CloudPoller – energy stats (period balance)", function () {
	// Recorded live: mode 4 (year 2026) of a plant with meter and battery.
	const YEAR = {
		meter_in_eq: 2963800,
		pv_eq: 4189600,
		last_data_time: "2026-09-22 07:37:30",
		meter_out_eq: 1545600,
		bms_in_eq: 2141800,
		bms_out_eq: 1890100,
		consumption_eq: 5330400,
	};
	const storage = () => ({
		real_power: "0",
		today_eq: "0",
		month_eq: "0",
		year_eq: "0",
		total_eq: "0",
		co2_emission_reduction: "0",
		plant_tree: "0",
		reflux_station_data: { icon_bms: 1, icon_grid: 1, bms_soc: "25" },
	});

	it("reads month, year and lifetime on a slow poll and writes them under period-suffixed ids", async function () {
		const calls = [];
		const writes = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => storage();
		cloud.getStationEnergyStats = async (sid, mode, date) => {
			calls.push({ sid, mode, date });
			return mode === 4 ? YEAR : { last_data_time: "x" };
		};
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			writes.push([id, val]);
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();
		assert.deepStrictEqual(
			calls.map(x => x.mode),
			[3, 4, 5],
			"month, year, lifetime",
		);
		assert.ok(
			calls.every(x => x.sid === 1 && /^\d{4}-\d{2}-\d{2}$/.test(x.date)),
			"a station-local date",
		);
		const byId = Object.fromEntries(writes.map(([id, v]) => [id, v]));
		assert.deepStrictEqual(byId["station-1.grid.gridImportYear"], { val: 2963.8, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["station-1.grid.batteryDischargeYear"], { val: 1890.1, ack: true, q: 0x00 });
		assert.strictEqual(
			byId["station-1.grid.gridImportMonth"],
			undefined,
			"a period without a balance writes nothing",
		);
	});

	it("does not read the balance for a plain PV plant, nor on a fast poll", async function () {
		let calls = 0;
		const cloud = makeMockCloud();
		cloud.getStationEnergyStats = async () => {
			calls++;
			return null;
		};
		// Plain plant, slow poll: no storage block → no request.
		const plain = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 1 });
		await plain.poll();
		plain.stop();
		assert.strictEqual(calls, 0);
		// Storage plant, fast poll: the balance is slow-poll work only.
		cloud.getStationRealtime = async () => storage();
		const fast = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 6 });
		await fast.poll(); // poll #1 of 6 is a fast one
		assert.strictEqual(calls, 0, "no read on a fast poll");
		await fast.poll(true); // forced slow poll
		assert.strictEqual(calls, 3);
		await fast.poll();
		fast.stop();
		assert.strictEqual(calls, 3, "no read on the following fast poll");
	});

	it("survives a throwing stats read and still finishes the poll", async function () {
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => storage();
		cloud.getStationEnergyStats = async () => {
			throw new Error("boom");
		};
		let weather = 0;
		cloud.getWeather = async () => {
			weather++;
			return {};
		};
		const poller = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();
		assert.ok(weather >= 0, "poll completed");
	});
});

describe("CloudPoller – pollStationIndicators", function () {
	function baseRealtime() {
		return {
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
		};
	}

	it("makes zero getRealIndicators calls for a plant with no icon_* flags at all (plain microinverter station)", async function () {
		const calls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => baseRealtime();
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) => {
			calls.push(selector);
			return null;
		};
		const poller = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(calls, []);
	});

	it("makes zero getRealIndicators calls when reflux_station_data reports every icon_* flag as absent/0", async function () {
		const calls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: { icon_grid: 0, icon_load: 0, icon_pvi: 0, icon_gen: 0 },
		});
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) => {
			calls.push(selector);
			return null;
		};
		const poller = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(calls, []);
	});

	it("requests exactly the types the icon_* flags name, in grid/load/pvi/gen order", async function () {
		const calls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			reflux_station_data: { icon_grid: 1, icon_load: 1, icon_pvi: 1, icon_gen: 1 },
		});
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) => {
			calls.push(selector);
			return null;
		};
		const poller = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(calls, [{ type: 2 }, { type: 1 }, { type: 30 }, { type: 20 }]);
	});

	it("requests only the grid meter when only icon_grid is set", async function () {
		const calls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({ ...baseRealtime(), reflux_station_data: { icon_grid: 1 } });
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) => {
			calls.push(selector);
			return null;
		};
		const poller = makePoller({ cloud, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(calls, [{ type: 2 }]);
	});

	it("writes the grid meter set to station-<id>.gridMeter.*, quality 0x00 when the station is fresh", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({ ...baseRealtime(), reflux_station_data: { icon_grid: 1 } });
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 2
				? {
						title: "IND_GRID",
						list: [
							{ key: "p_total", val: -33, unit: "W" },
							{ key: "grid_state", val: "1" },
						],
					}
				: null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(stateWrites["station-1.gridMeter.power"], { val: -33, ack: true, q: 0x00 });
		assert.deepStrictEqual(stateWrites["station-1.gridMeter.connected"], { val: true, ack: true, q: 0x00 });
	});

	it("writes the load set to station-<id>.load.*", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({ ...baseRealtime(), reflux_station_data: { icon_load: 1 } });
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 1
				? {
						title: "IND_LOAD",
						list: [
							{ key: "frequency", val: "50.04", unit: "Hz" },
							{ key: "v_a", val: "227.1", unit: "V" },
							{ key: "p_a", val: "176", unit: "W" },
						],
					}
				: null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.load.l1Voltage"], 227.1);
		assert.strictEqual(stateWrites["station-1.load.l1Power"], 176);
		assert.strictEqual(stateWrites["station-1.load.frequency"], undefined, "load.frequency is not a known state");
	});

	it("writes the PV meter set to station-<id>.pvMeter.*", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({ ...baseRealtime(), reflux_station_data: { icon_pvi: 1 } });
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 30
				? {
						title: "IND_PVI",
						list: [
							{ key: "pvi_state", val: "1", fmt_val: "Online" },
							{ key: "p_total", val: "1", unit: "W" },
							{ key: "v_a", val: "227.1", unit: "V" },
						],
					}
				: null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.pvMeter.connected"], true);
		assert.strictEqual(stateWrites["station-1.pvMeter.power"], 1);
		assert.strictEqual(stateWrites["station-1.pvMeter.l1Voltage"], 227.1);
	});

	it("writes the generator set to station-<id>.generator.*", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({ ...baseRealtime(), reflux_station_data: { icon_gen: 1 } });
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 20
				? {
						title: "IND_GEN",
						list: [
							{ key: "gen_state", val: "0", fmt_val: "None" },
							{ key: "frequency", val: "0", unit: "Hz" },
							{ key: "p_total", val: "0", unit: "W" },
						],
					}
				: null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.generator.state"], 0);
		assert.strictEqual(stateWrites["station-1.generator.stateText"], "None");
		assert.strictEqual(stateWrites["station-1.generator.frequency"], 0);
	});

	it("flags station indicator values with quality 0x42 when the station's last upload is stale", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			...baseRealtime(),
			data_time: "2000-01-01 00:00:00",
			reflux_station_data: { icon_grid: 1 },
		});
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 2 ? { title: "IND_GRID", list: [{ key: "p_total", val: -33, unit: "W" }] } : null;
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = val;
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		poller.stop();

		assert.strictEqual(stateWrites["station-1.gridMeter.power"].q, 0x42);
	});

	it("creates the station-indicator channel exactly once across polls", async function () {
		const setObjectCalls = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({ ...baseRealtime(), reflux_station_data: { icon_grid: 1 } });
		cloud.getDeviceTree = async () => [];
		cloud.getRealIndicators = async (stationId, selector) =>
			selector.type === 2 ? { title: "IND_GRID", list: [{ key: "p_total", val: -33, unit: "W" }] } : null;
		const adapter = makeMockAdapter();
		adapter.setObjectNotExistsAsync = async id => {
			setObjectCalls.push(id);
		};
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.poll();
		assert.deepStrictEqual(
			setObjectCalls.filter(id => id === "station-1.gridMeter"),
			["station-1.gridMeter"],
			"the gridMeter channel must be created exactly once",
		);

		setObjectCalls.length = 0;
		await poller.poll();
		poller.stop();

		assert.deepStrictEqual(
			setObjectCalls.filter(id => id === "station-1.gridMeter"),
			[],
			"the gridMeter channel must not be created again on a later poll",
		);
	});
});

// ============================================================
// CloudPoller – battery settings (read-only pvm-ctl action 1013, device-level)
// ============================================================
describe("CloudPoller – battery settings", function () {
	/**
	 * A hybrid device registered locally, as `pollDevicesAndInverters` would have flagged it.
	 *
	 * @param sn - DTU serial.
	 * @param stationId - Cloud station id the device belongs to.
	 */
	function hybridDev(sn, stationId = 1) {
		return { dtuSerial: sn, cloudStationId: stationId, hybridInverter: true, connection: null };
	}

	function storageRealtime(overrides = {}) {
		return {
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
			reflux_station_data: {
				icon_bms: 1,
				icon_grid: 1,
				bms_soc: "25",
				e2b_total: "7800",
				efb_total: "5400",
				work_mode: 1000,
			},
			...overrides,
		};
	}

	it("creates the readSettings button once per hybrid device, subscribes once, and reads the settings exactly once per adapter run", async function () {
		const subscribed = [];
		const extendCalls = [];
		let readCalls = 0;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => storageRealtime();
		cloud.getDeviceTree = async () => [];
		cloud.readBatterySettings = async () => {
			readCalls++;
			return {};
		};
		const adapter = makeMockAdapter();
		adapter.subscribeStates = id => subscribed.push(id);
		adapter.extendObjectAsync = async id => {
			extendCalls.push(id);
		};
		const devices = new Map([
			["DTU_A", hybridDev("DTU_A")],
			["DTU_B", hybridDev("DTU_B")],
		]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.poll();
		await flushMicrotasks();
		assert.deepStrictEqual(subscribed.sort(), ["DTU_A.battery.readSettings", "DTU_B.battery.readSettings"]);
		assert.deepStrictEqual(
			extendCalls.filter(id => id.endsWith(".battery.readSettings")).sort(),
			["DTU_A.battery.readSettings", "DTU_B.battery.readSettings"],
			"the button object must be created exactly once per device",
		);
		assert.strictEqual(
			readCalls,
			1,
			"the settings must be read once on the first poll (one request for the station)",
		);

		// A second poll of the same station within the same adapter run must not repeat the
		// creation/subscription/read.
		extendCalls.length = 0;
		subscribed.length = 0;
		await poller.poll();
		await flushMicrotasks();
		poller.stop();

		assert.strictEqual(readCalls, 1, "a second poll must not read the settings again");
		assert.deepStrictEqual(
			extendCalls.filter(id => id.endsWith(".battery.readSettings")),
			[],
			"the button object must not be created again",
		);
		assert.deepStrictEqual(subscribed, [], "must not subscribe again");
	});

	// Seen live: the cloud answered "[Load grid profile] pending, please wait." because another
	// task was queued for the device. A transient refusal must not cost the whole adapter run.
	it("retries a failed settings read on later polls, at most three times, and stops after a success", async function () {
		const outcomes = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => storageRealtime();
		cloud.getDeviceTree = async () => [];
		cloud.readBatterySettings = async () => {
			const next = outcomes.shift();
			if (next instanceof Error) {
				throw next;
			}
			return next;
		};
		const warns = [];
		const adapter = makeMockAdapter();
		adapter.log.warn = m => warns.push(m);
		const devices = new Map([["DTU_A", hybridDev("DTU_A")]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		const pollOnce = async () => {
			poller.lastRealtimeFetch.set("DTU_A", 0);
			await poller.poll();
			await flushMicrotasks();
		};

		// Fails, is retried, succeeds, and is then left alone.
		outcomes.push(new Error("[Load grid profile] pending, please wait."), {
			mode: 1,
			data: { k_1: { reserve_soc: 15 } },
		});
		let reads = 0;
		const counting = cloud.readBatterySettings;
		cloud.readBatterySettings = async () => {
			reads++;
			return counting();
		};
		await pollOnce();
		assert.strictEqual(reads, 1);
		assert.ok(
			warns.some(w => w.includes("will try again on a later poll")),
			"the warning must announce the retry",
		);
		await pollOnce();
		assert.strictEqual(reads, 2, "the failed read must be retried on the next poll");
		await pollOnce();
		await pollOnce();
		assert.strictEqual(reads, 2, "after a success no further automatic read");

		// A fresh poller: three failures in a row, then no more automatic attempts.
		outcomes.length = 0;
		outcomes.push(new Error("busy"), new Error("busy"), new Error("busy"), new Error("busy"));
		reads = 0;
		warns.length = 0;
		const poller2 = makePoller({
			cloud,
			adapter,
			devices: new Map([["DTU_A", hybridDev("DTU_A")]]),
			stationDevices: new Set([1]),
			slowPollFactor: 1,
		});
		for (let i = 0; i < 5; i++) {
			poller2.lastRealtimeFetch.set("DTU_A", 0);
			await poller2.poll();
			await flushMicrotasks();
		}
		poller.stop();
		poller2.stop();
		assert.strictEqual(reads, 3, "at most three automatic attempts per adapter run");
		assert.ok(warns.at(-1).includes("giving up for this adapter run"), "the last warning must say it gave up");
	});

	it("never reads and never subscribes for a station without a battery, even with a hybrid device registered", async function () {
		const subscribed = [];
		let readCalls = 0;
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => ({
			real_power: "0",
			today_eq: "0",
			month_eq: "0",
			year_eq: "0",
			total_eq: "0",
			co2_emission_reduction: "0",
			plant_tree: "0",
			reflux_station_data: { icon_grid: 1, icon_bms: 0, grid_power: "0.0" },
		});
		cloud.getDeviceTree = async () => [];
		cloud.readBatterySettings = async () => {
			readCalls++;
			return {};
		};
		const adapter = makeMockAdapter();
		adapter.subscribeStates = id => subscribed.push(id);
		const devices = new Map([["DTU_HAT", hybridDev("DTU_HAT")]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		await flushMicrotasks();
		poller.stop();

		assert.strictEqual(readCalls, 0);
		assert.deepStrictEqual(subscribed, []);
	});

	it("does not read the battery settings of an offline station", async function () {
		let readCalls = 0;
		const cloud = makeMockCloud();
		// A wall-clock timestamp far in the past → stale → offline.
		cloud.getStationRealtime = async () => storageRealtime({ data_time: "2000-01-01 00:00:00" });
		cloud.getDeviceTree = async () => [];
		cloud.readBatterySettings = async () => {
			readCalls++;
			return {};
		};
		const devices = new Map([["DTU_HAT", hybridDev("DTU_HAT")]]);
		const poller = makePoller({ cloud, devices, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		await flushMicrotasks();
		poller.stop();

		assert.strictEqual(readCalls, 0);
	});

	it("does not read the battery settings when the station has a battery but no locally-known hybrid device", async function () {
		let readCalls = 0;
		const subscribed = [];
		const cloud = makeMockCloud();
		cloud.getStationRealtime = async () => storageRealtime();
		cloud.getDeviceTree = async () => [];
		cloud.readBatterySettings = async () => {
			readCalls++;
			return {};
		};
		const adapter = makeMockAdapter();
		adapter.subscribeStates = id => subscribed.push(id);
		// No devices registered at all — e.g. discovery has not run yet.
		const poller = makePoller({ cloud, adapter, stationDevices: new Set([1]), slowPollFactor: 1 });
		await poller.poll();
		await flushMicrotasks();
		poller.stop();

		assert.strictEqual(readCalls, 0);
		assert.deepStrictEqual(subscribed, []);
	});

	it("readBatterySettings writes the mapped values plus battery.settingsUpdated to every hybrid device of the station", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.readBatterySettings = async () => ({ mode: 1, data: { k_1: { reserve_soc: 15 } } });
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = typeof val === "object" ? val.val : val;
		};
		const devices = new Map([
			["DTU_A", hybridDev("DTU_A")],
			["DTU_B", hybridDev("DTU_B")],
		]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.readBatterySettings(1);

		for (const sn of ["DTU_A", "DTU_B"]) {
			assert.strictEqual(stateWrites[`${sn}.battery.workMode`], 1);
			assert.strictEqual(stateWrites[`${sn}.battery.reserveSoc`], 15);
			assert.strictEqual(
				stateWrites[`${sn}.battery.settingsJson`],
				JSON.stringify({ mode: 1, data: { k_1: { reserve_soc: 15 } } }),
			);
			assert.strictEqual(typeof stateWrites[`${sn}.battery.settingsUpdated`], "number");
		}
		assert.strictEqual(stateWrites["station-1.battery.workMode"], undefined, "there is no station battery place");
	});

	it("readBatterySettings releases the readSettings button (ack false) on every hybrid device, even on success", async function () {
		const acks = [];
		const cloud = makeMockCloud();
		cloud.readBatterySettings = async () => ({ mode: 1 });
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val, ack) => {
			if (id.endsWith(".battery.readSettings")) {
				acks.push([id, val, ack]);
			}
		};
		const devices = new Map([
			["DTU_A", hybridDev("DTU_A")],
			["DTU_B", hybridDev("DTU_B")],
		]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.readBatterySettings(1);

		assert.deepStrictEqual(
			acks.sort((a, b) => a[0].localeCompare(b[0])),
			[
				["DTU_A.battery.readSettings", false, true],
				["DTU_B.battery.readSettings", false, true],
			],
		);
	});

	it("readBatterySettings logs a warning, does not throw, and still releases the button when the cloud call rejects", async function () {
		const warnings = [];
		const acks = [];
		const cloud = makeMockCloud();
		cloud.readBatterySettings = async () => {
			throw new Error("device did not answer");
		};
		const adapter = makeMockAdapter();
		adapter.log.warn = msg => warnings.push(msg);
		adapter.setStateAsync = async (id, val, ack) => {
			if (id.endsWith(".battery.readSettings")) {
				acks.push([id, val, ack]);
			}
		};
		const devices = new Map([["DTU_HAT", hybridDev("DTU_HAT")]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await assert.doesNotReject(() => poller.readBatterySettings(1));
		assert.strictEqual(warnings.length, 1);
		assert.deepStrictEqual(acks, [["DTU_HAT.battery.readSettings", false, true]]);
	});

	it("readBatterySettings writes no value but still releases the button when the device returns no mode", async function () {
		const stateWrites = {};
		const cloud = makeMockCloud();
		cloud.readBatterySettings = async () => ({});
		const adapter = makeMockAdapter();
		adapter.setStateAsync = async (id, val) => {
			stateWrites[id] = val;
		};
		const devices = new Map([["DTU_HAT", hybridDev("DTU_HAT")]]);
		const poller = makePoller({ cloud, adapter, devices, stationDevices: new Set([1]), slowPollFactor: 1 });

		await poller.readBatterySettings(1);

		const otherWrites = Object.keys(stateWrites).filter(id => id !== "DTU_HAT.battery.readSettings");
		assert.deepStrictEqual(otherWrites, []);
		assert.strictEqual(stateWrites["DTU_HAT.battery.readSettings"], false);
	});

	it("no longer exposes handleStationStateChange (removed — DeviceContext now calls readBatterySettings directly)", function () {
		const poller = makePoller();
		assert.strictEqual(typeof poller.handleStationStateChange, "undefined");
		poller.stop();
	});
});
