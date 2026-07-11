import assert from "node:assert";
import BurstPoller from "../build/lib/burstPoller.js";
import { BURST_MIN_INTERVAL_MS, BURST_MAX_INTERVAL_MS, BURST_MAX_FAILURES } from "../build/lib/constants.js";

// ============================================================
// helpers
// ============================================================

/**
 * Tracking adapter mock, following the repo convention (see test/deviceContext.test.js).
 * `setTimeout`/`clearTimeout` can be overridden per test to observe reschedule behavior.
 */
function createTrackingAdapter() {
	const calls = [];
	const adapter = {
		log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
		devices: new Map(),
		setStateAsync: async (id, val) => {
			calls.push([id, val]);
		},
		getStateAsync: async () => null,
		extendObjectAsync: async () => {},
		setObjectNotExistsAsync: async () => {},
		subscribeStates: () => {},
		unsubscribeStates: () => {},
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
		clearTimeout: id => {
			if (id) {
				clearTimeout(id);
			}
		},
		matchLocalDeviceToCloud: () => {},
		onRelayDataSent: () => {},
		onLocalConnected: () => {},
		onLocalDisconnected: () => {},
		onSendTimeUpdated: () => {},
		updateConnectionState: async () => {},
	};
	return { calls, adapter };
}

/**
 * Minimal cloud-only DeviceContext stand-in.
 *
 * @param overrides - Fields to override on the default cloud-only device shape.
 */
function makeDevice(overrides = {}) {
	return {
		dtuSerial: overrides.dtuSerial,
		deviceId: overrides.dtuSerial,
		connection: null,
		pvCount: 2,
		createPvStates: async () => {},
		...overrides,
	};
}

/**
 * One DTU node as returned by CloudConnection.getDeviceTree().
 *
 * @param sn - DTU serial number.
 * @param inverterSns - Serial numbers of the inverters (children) attached to this DTU.
 */
function dtuNode(sn, inverterSns) {
	return { sn, id: 1, children: inverterSns.map(isn => ({ sn: isn, id: 1 })) };
}

// ============================================================
// BurstPoller – station discovery / cloud-only filtering
// ============================================================
describe("BurstPoller – start() station discovery", function () {
	it("polls only cloud-only inverters, skipping DTUs with an active local connection", async function () {
		const { adapter } = createTrackingAdapter();

		let resolvePolled;
		const polled = new Promise(r => (resolvePolled = r));

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_LOCAL", ["INV_LOCAL"]), dtuNode("DTU_CLOUD", ["INV_CLOUD"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async (uri, body) => {
				resolvePolled(body);
				return { mis: [], dly: 5000 };
			},
		};

		const devices = new Map([
			["DTU_LOCAL", makeDevice({ dtuSerial: "DTU_LOCAL", connection: { connected: true } })],
			["DTU_CLOUD", makeDevice({ dtuSerial: "DTU_CLOUD", connection: null })],
		]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		const body = await polled;

		assert.deepStrictEqual(body.mis, ["INV_CLOUD"], "only the cloud-only inverter should be polled");
		poller.stop();
	});

	it("does not fetch a realtime uri for a station with no cloud-only inverters", async function () {
		const { adapter } = createTrackingAdapter();
		let uriCalled = false;

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_LOCAL_ONLY", ["INV_LOCAL"])],
			getRealtimeUri: async () => {
				uriCalled = true;
				return "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1";
			},
			pollRealtimeBurst: async () => ({ mis: [], dly: 5000 }),
		};

		const devices = new Map([
			["DTU_LOCAL_ONLY", makeDevice({ dtuSerial: "DTU_LOCAL_ONLY", connection: { connected: true } })],
		]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();

		assert.strictEqual(uriCalled, false, "getRealtimeUri must not be called when no target inverters exist");
		assert.strictEqual(poller.stations.size, 0);
		poller.stop();
	});

	it("does not throw when getDeviceTree fails for a station", async function () {
		const { adapter } = createTrackingAdapter();
		const cloud = {
			getDeviceTree: async () => {
				throw new Error("network error");
			},
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({ mis: [], dly: 5000 }),
		};

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices: new Map(),
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await assert.doesNotReject(() => poller.start());
		assert.strictEqual(poller.stations.size, 0);
		poller.stop();
	});

	it("skips devices with enableLocal=true even when not currently connected (never claims a locally-configured DTU)", async function () {
		const { adapter } = createTrackingAdapter();
		let uriCalled = false;

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_ENABLELOCAL", ["INV1"])],
			getRealtimeUri: async () => {
				uriCalled = true;
				return "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1";
			},
			pollRealtimeBurst: async () => ({ mis: [], dly: 5000 }),
		};

		const burstActiveStations = new Set();
		// enableLocal=true but no active connection (e.g. WR offline at night) — must still be skipped.
		const dev = makeDevice({ dtuSerial: "DTU_ENABLELOCAL", enableLocal: true, connection: null });
		const devices = new Map([["DTU_ENABLELOCAL", dev]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations,
		});
		await poller.start();

		assert.strictEqual(uriCalled, false, "getRealtimeUri must not be called for a locally-configured DTU");
		assert.strictEqual(poller.stations.size, 0, "station must not be tracked when only a local DTU is present");
		assert.strictEqual(dev.burstActive, undefined, "burstActive must not be set for a locally-configured device");
		assert.strictEqual(burstActiveStations.has(1), false, "station must not be flagged burst-active");
		poller.stop();
	});

	it("does not throw when getRealtimeUri fails after cloud-only inverters were found", async function () {
		const { adapter } = createTrackingAdapter();
		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_CLOUD", ["INV1"])],
			getRealtimeUri: async () => {
				throw new Error("get_sd_uri failed");
			},
			pollRealtimeBurst: async () => ({ mis: [], dly: 5000 }),
		};

		const devices = new Map([["DTU_CLOUD", makeDevice({ dtuSerial: "DTU_CLOUD" })]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await assert.doesNotReject(() => poller.start());
		assert.strictEqual(poller.stations.size, 0, "station must not be tracked when uri fetch fails");
		poller.stop();
	});
});

// ============================================================
// BurstPoller – writing state values
// ============================================================
describe("BurstPoller – writeInverter", function () {
	it("writes grid.power (=pac) and pvN.power (=p1..pN, limited by dev.pvCount) with quality 0x00 when the stream is live (con=1)", async function () {
		const { adapter, calls } = createTrackingAdapter();

		let resolveWrites;
		const writesDone = new Promise(r => (resolveWrites = r));
		const trackedSetState = adapter.setStateAsync;
		adapter.setStateAsync = async (id, val) => {
			await trackedSetState(id, val);
			if (id === "DTU1.pv1.power") {
				resolveWrites();
			}
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU1", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({
				mis: [{ sn: "INV1", pac: 321, p1: 100, p2: 221, p3: 0, p4: 0 }],
				dly: 4000,
				con: 1,
			}),
		};

		const dev = makeDevice({ dtuSerial: "DTU1", pvCount: 2 });
		const devices = new Map([["DTU1", dev]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		await writesDone;

		// While streaming, the device is flagged so the cloud poller yields the power states.
		assert.strictEqual(dev.burstActive, true);

		poller.stop();
		// stop() releases the gate again.
		assert.strictEqual(dev.burstActive, false);

		const byId = Object.fromEntries(calls.map(([id, val]) => [id, val]));
		assert.deepStrictEqual(byId["DTU1.grid.power"], { val: 321, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["DTU1.pv0.power"], { val: 100, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["DTU1.pv1.power"], { val: 221, ack: true, q: 0x00 });
		// p3/p4 must not be written — dev.pvCount is 2.
		assert.strictEqual(byId["DTU1.pv2.power"], undefined);
		assert.strictEqual(byId["DTU1.pv3.power"], undefined);
	});

	it("flags samples as stale (quality 0x42) when the stream is not live (con!=1)", async function () {
		const { adapter, calls } = createTrackingAdapter();

		let resolveWrites;
		const writesDone = new Promise(r => (resolveWrites = r));
		const trackedSetState = adapter.setStateAsync;
		adapter.setStateAsync = async (id, val) => {
			await trackedSetState(id, val);
			if (id === "DTU1.grid.power") {
				resolveWrites();
			}
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU1", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({
				mis: [{ sn: "INV1", pac: 0, p1: 0, p2: 0, p3: 0, p4: 0 }],
				dly: 4000,
				con: 0,
			}),
		};

		const devices = new Map([["DTU1", makeDevice({ dtuSerial: "DTU1", pvCount: 2 })]]);
		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		await writesDone;
		poller.stop();

		const byId = Object.fromEntries(calls.map(([id, val]) => [id, val]));
		assert.strictEqual(byId["DTU1.grid.power"].q, 0x42);
	});

	it("writes the station power flow from m:0 and marks the station burst-active", async function () {
		const { adapter, calls } = createTrackingAdapter();
		let resolveStation;
		const stationDone = new Promise(r => (resolveStation = r));
		const trackedSetState = adapter.setStateAsync;
		adapter.setStateAsync = async (id, val) => {
			await trackedSetState(id, val);
			if (id === "station-1.grid.pvUtilization") {
				resolveStation();
			}
		};

		const burstActiveStations = new Set();
		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU1", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async (uri, body) => {
				if (body.m === 0) {
					return { con: 1, dly: 3000, power: { pv: 500, pvr: 62.5, grid: -100, load: 400, bat: 0, sp: 0 } };
				}
				return { mis: [{ sn: "INV1", pac: 500, p1: 250, p2: 250, p3: 0, p4: 0 }], dly: 3000, con: 1 };
			},
		};
		const devices = new Map([["DTU1", makeDevice({ dtuSerial: "DTU1", pvCount: 2 })]]);
		const poller = new BurstPoller({ cloud, adapter, devices, stationDevices: new Set([1]), burstActiveStations });
		await poller.start();
		await stationDone;

		assert.strictEqual(burstActiveStations.has(1), true, "station must be flagged burst-active");
		poller.stop();
		assert.strictEqual(burstActiveStations.has(1), false, "stop() releases the station flag");

		const byId = Object.fromEntries(calls.map(([id, val]) => [id, val]));
		assert.deepStrictEqual(byId["station-1.grid.power"], { val: 500, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["station-1.grid.gridPower"], { val: -100, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["station-1.grid.loadPower"], { val: 400, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["station-1.grid.batteryPower"], { val: 0, ack: true, q: 0x00 });
		assert.deepStrictEqual(byId["station-1.grid.pvUtilization"], { val: 62.5, ack: true, q: 0x00 });
	});

	it("coerces string pac/pN values from the burst response into numbers", async function () {
		const { adapter, calls } = createTrackingAdapter();

		let resolveWrites;
		const writesDone = new Promise(r => (resolveWrites = r));
		const trackedSetState = adapter.setStateAsync;
		adapter.setStateAsync = async (id, val) => {
			await trackedSetState(id, val);
			if (id === "DTU_STR.pv0.power") {
				resolveWrites();
			}
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_STR", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({
				mis: [{ sn: "INV1", pac: "123.4", p1: "50", p2: 0, p3: 0, p4: 0 }],
				dly: 4000,
				con: 1,
			}),
		};

		const devices = new Map([["DTU_STR", makeDevice({ dtuSerial: "DTU_STR", pvCount: 2 })]]);
		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		await writesDone;
		poller.stop();

		const byId = Object.fromEntries(calls.map(([id, val]) => [id, val]));
		assert.strictEqual(byId["DTU_STR.grid.power"].val, 123.4, "string pac must be coerced to a number");
		assert.strictEqual(typeof byId["DTU_STR.grid.power"].val, "number");
		assert.strictEqual(byId["DTU_STR.pv0.power"].val, 50, "string p1 must be coerced to a number");
		assert.strictEqual(typeof byId["DTU_STR.pv0.power"].val, "number");
	});

	it("creates additional PV states on demand when an active string exceeds the known pvCount", async function () {
		const { adapter } = createTrackingAdapter();

		let resolveCreated;
		const created = new Promise(r => (resolveCreated = r));

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU2", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({
				mis: [{ sn: "INV1", pac: 100, p1: 50, p2: 0, p3: 40, p4: 0 }],
				dly: 4000,
			}),
		};

		const dev = makeDevice({
			dtuSerial: "DTU2",
			pvCount: 2,
			createPvStates: async (count, cloudOnly) => resolveCreated({ count, cloudOnly }),
		});
		const devices = new Map([["DTU2", dev]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		const args = await created;
		poller.stop();

		assert.strictEqual(args.count, 3, "p3 > 0 means 3 active PV strings");
		assert.strictEqual(args.cloudOnly, true);
	});
});

// ============================================================
// BurstPoller – claim release and recovery on repeated poll failures
// ============================================================
describe("BurstPoller – claim release/recovery on poll failures", function () {
	/**
	 * Drives the poll loop by hand: overrides adapter.setTimeout so each poll cycle's reschedule
	 * is captured instead of actually waiting. `waitScheduled()` returns a promise for the next
	 * scheduled cycle (call it BEFORE poller.start()/driver.fire() to avoid missing a fast cycle);
	 * `fire(cycle)` invokes a previously captured cycle's timer callback to kick off the next poll.
	 *
	 * @param adapter - The tracking adapter mock whose setTimeout is overridden in place.
	 */
	function driveManually(adapter) {
		let resolveScheduled;
		let scheduled = new Promise(r => (resolveScheduled = r));
		adapter.setTimeout = (fn, ms) => {
			const id = globalThis.setTimeout(() => {}, 0);
			const resolve = resolveScheduled;
			scheduled = new Promise(r => (resolveScheduled = r));
			resolve({ fn, ms });
			return id;
		};
		return {
			// Waits for the next scheduled cycle (call once right after start()).
			waitScheduled: () => scheduled,
			// Fires the previously captured timer callback (kicks off the next poll cycle).
			fire: cycle => cycle.fn(),
		};
	}

	it(`releases the claim after ${BURST_MAX_FAILURES} consecutive poll failures, but keeps the poll loop running`, async function () {
		const { adapter } = createTrackingAdapter();
		const driver = driveManually(adapter);

		let failCount = 0;
		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_FAIL", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async (uri, body) => {
				if (body.m === 3) {
					failCount++;
					throw new Error("burst poll failed");
				}
				return { mis: [], dly: 2000 };
			},
		};

		const dev = makeDevice({ dtuSerial: "DTU_FAIL" });
		const devices = new Map([["DTU_FAIL", dev]]);
		const burstActiveStations = new Set();

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations,
		});

		// Capture the reference to the "cycle 1 scheduled" promise BEFORE starting: poll(sb) runs
		// fire-and-forget from within startStation(), so it may finish before start() resolves.
		const firstScheduled = driver.waitScheduled();
		await poller.start();
		let cycle = await firstScheduled; // attempt 1 done

		assert.strictEqual(dev.burstActive, true, "claim is held after the first (single) failure");

		for (let i = 2; i <= BURST_MAX_FAILURES; i++) {
			const next = driver.waitScheduled();
			driver.fire(cycle);
			cycle = await next;
		}

		assert.strictEqual(failCount, BURST_MAX_FAILURES, "expected exactly BURST_MAX_FAILURES poll attempts");
		assert.strictEqual(dev.burstActive, false, "claim must be released after BURST_MAX_FAILURES failures");
		assert.strictEqual(burstActiveStations.has(1), false, "station must no longer be burst-active");
		assert.strictEqual(poller.stations.has(1), true, "the poll loop keeps tracking/retrying the station");

		poller.stop();
	});

	it("reclaims the station once a poll succeeds again after the claim was released", async function () {
		const { adapter } = createTrackingAdapter();
		const driver = driveManually(adapter);

		let callCount = 0;
		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU_RECOVER", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async (uri, body) => {
				if (body.m === 3) {
					callCount++;
					if (callCount <= BURST_MAX_FAILURES) {
						throw new Error("burst poll failed");
					}
				}
				return { mis: [], dly: 2000 };
			},
		};

		const dev = makeDevice({ dtuSerial: "DTU_RECOVER" });
		const devices = new Map([["DTU_RECOVER", dev]]);
		const burstActiveStations = new Set();

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations,
		});

		// Capture the reference to the "cycle 1 scheduled" promise BEFORE starting: poll(sb) runs
		// fire-and-forget from within startStation(), so it may finish before start() resolves.
		const firstScheduled = driver.waitScheduled();
		await poller.start();
		let cycle = await firstScheduled; // attempt 1

		// Drive through the remaining failures until the claim is released.
		for (let i = 2; i <= BURST_MAX_FAILURES; i++) {
			const next = driver.waitScheduled();
			driver.fire(cycle);
			cycle = await next;
		}
		assert.strictEqual(dev.burstActive, false, "claim released after BURST_MAX_FAILURES failures");
		assert.strictEqual(burstActiveStations.has(1), false);

		// One more successful cycle should reclaim the station.
		const next = driver.waitScheduled();
		driver.fire(cycle);
		await next;

		assert.strictEqual(dev.burstActive, true, "claim must be reacquired once a poll succeeds again");
		assert.strictEqual(burstActiveStations.has(1), true, "station must be burst-active again");

		poller.stop();
	});
});

// ============================================================
// BurstPoller – reschedule / stop()
// ============================================================
describe("BurstPoller – reschedule and stop()", function () {
	it("stop() cancels the pending reschedule timer and clears tracked stations", async function () {
		const { adapter } = createTrackingAdapter();

		let scheduledId;
		let resolveScheduled;
		const scheduled = new Promise(r => (resolveScheduled = r));
		adapter.setTimeout = (fn, ms) => {
			scheduledId = globalThis.setTimeout(fn, ms);
			resolveScheduled();
			return scheduledId;
		};
		let clearedId;
		adapter.clearTimeout = id => {
			clearedId = id;
			if (id) {
				globalThis.clearTimeout(id);
			}
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU3", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({ mis: [], dly: 2000 }),
		};

		const devices = new Map([["DTU3", makeDevice({ dtuSerial: "DTU3" })]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		await scheduled;

		assert.strictEqual(poller.stations.size, 1, "station should be tracked while polling is active");

		poller.stop();

		assert.strictEqual(poller.stations.size, 0, "stations map must be cleared after stop()");
		assert.strictEqual(clearedId, scheduledId, "the pending reschedule timer must be cancelled");
	});

	it("clamps the reschedule delay to BURST_MAX_INTERVAL_MS when the server requests a longer delay", async function () {
		const { adapter } = createTrackingAdapter();

		let scheduledMs;
		let resolveScheduled;
		const scheduled = new Promise(r => (resolveScheduled = r));
		adapter.setTimeout = (fn, ms) => {
			scheduledMs = ms;
			resolveScheduled();
			return globalThis.setTimeout(() => {}, 0);
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU4", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({ mis: [], dly: 999999 }),
		};

		const devices = new Map([["DTU4", makeDevice({ dtuSerial: "DTU4" })]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		await scheduled;
		poller.stop();

		assert.strictEqual(scheduledMs, BURST_MAX_INTERVAL_MS);
	});

	it("clamps the reschedule delay to BURST_MIN_INTERVAL_MS when the server requests a shorter delay", async function () {
		const { adapter } = createTrackingAdapter();

		let scheduledMs;
		let resolveScheduled;
		const scheduled = new Promise(r => (resolveScheduled = r));
		adapter.setTimeout = (fn, ms) => {
			scheduledMs = ms;
			resolveScheduled();
			return globalThis.setTimeout(() => {}, 0);
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU5", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => ({ mis: [], dly: 1 }),
		};

		const devices = new Map([["DTU5", makeDevice({ dtuSerial: "DTU5" })]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await poller.start();
		await scheduled;
		poller.stop();

		assert.strictEqual(scheduledMs, BURST_MIN_INTERVAL_MS);
	});

	it("reschedules at BURST_MAX_INTERVAL_MS and does not throw when pollRealtimeBurst fails", async function () {
		const { adapter } = createTrackingAdapter();

		let scheduledMs;
		let resolveScheduled;
		const scheduled = new Promise(r => (resolveScheduled = r));
		adapter.setTimeout = (fn, ms) => {
			scheduledMs = ms;
			resolveScheduled();
			return globalThis.setTimeout(() => {}, 0);
		};

		const cloud = {
			getDeviceTree: async () => [dtuNode("DTU6", ["INV1"])],
			getRealtimeUri: async () => "https://eurt.example.com/rds/api/0/burst/get?k=abc&t=1",
			pollRealtimeBurst: async () => {
				throw new Error("stale k-token");
			},
		};

		const devices = new Map([["DTU6", makeDevice({ dtuSerial: "DTU6" })]]);

		const poller = new BurstPoller({
			cloud,
			adapter,
			devices,
			stationDevices: new Set([1]),
			burstActiveStations: new Set(),
		});
		await assert.doesNotReject(() => poller.start());
		await scheduled;
		poller.stop();

		assert.strictEqual(scheduledMs, BURST_MAX_INTERVAL_MS, "a poll failure should back off to the max interval");
	});
});
