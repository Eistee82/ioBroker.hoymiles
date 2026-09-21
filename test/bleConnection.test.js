import assert from "node:assert";
import { EventEmitter } from "node:events";
import BleConnection from "../build/lib/bleConnection.js";
import { bleBuildFrame, bleParseFrame } from "../build/lib/bleCrypto.js";
import { EsphomeGateway } from "../build/lib/esphomeGateway.js";

const MAC = EsphomeGateway.macToNumber("AA:BB:CC:DD:EE:FF");
const SN = Buffer.from("4161A031AB61", "ascii");
const ENC_RAND = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const PIN = "123456";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/** Fake ESPHome gateway: records writes and lets the test push notify frames. */
class FakeGateway extends EventEmitter {
	constructor() {
		super();
		this.connected = true;
		this.writes = [];
		this.descriptorWrites = [];
		this.notifyCb = null;
		this.connectAttempts = 0;
	}
	async disconnectDevice() {}
	async writeDescriptor(_mac, handle, value) {
		this.descriptorWrites.push({ handle, value: Buffer.from(value) });
	}
	onNotifyData(_mac, _handle, cb) {
		this.notifyCb = cb;
		return () => {
			this.notifyCb = null;
		};
	}
	onDeviceDisconnect(_mac, cb) {
		this.deviceGoneCb = cb;
		return () => {
			this.deviceGoneCb = null;
		};
	}
	/** Simulate the proxy reporting that the BLE device dropped its GATT link (e.g. inverter powered off). */
	dropDevice() {
		if (this.deviceGoneCb) {
			this.deviceGoneCb();
		}
	}
	async connectDevice(_mac, addressType) {
		this.connectAttempts++;
		this.lastAddressType = addressType;
	}
	async listGatt() {
		return {
			address: MAC,
			servicesList: [
				{
					uuid: "0000e0ff-3c17-d293-8e48-14fe2e4da212",
					handle: 1,
					characteristicsList: [
						{ uuid: "0000ffe1-0000-1000-8000-00805f9b34fb", handle: 10 },
						{ uuid: "0000ffe2-0000-1000-8000-00805f9b34fb", handle: 11 },
					],
				},
			],
		};
	}
	async enableNotify() {}
	async writeChar(_mac, _handle, frame) {
		this.writes.push(Buffer.from(frame));
	}
	push(frame) {
		if (this.notifyCb) {
			this.notifyCb(Buffer.from(frame));
		}
	}
}

/**
 * Controllable timers: capture the tick interval, use real timers for the short handshake delays.
 *
 * @param timeoutOverrideMs - when set, every setTimeout fires after this many ms instead of the
 *   requested delay (collapses the 5 s reconnect backoff so a test can observe the retry)
 */
function makeTimers(timeoutOverrideMs) {
	const ctl = { tickCb: null, delays: [] };
	const timers = {
		setInterval: cb => {
			ctl.tickCb = cb;
			return 1;
		},
		clearInterval: () => {
			ctl.tickCb = null;
		},
		setTimeout: (cb, ms) => {
			ctl.delays.push(ms);
			return setTimeout(cb, timeoutOverrideMs ?? ms);
		},
		clearTimeout: h => clearTimeout(h),
	};
	ctl.fireTick = async () => {
		if (ctl.tickCb) {
			ctl.tickCb();
		}
		await sleep(50); // let the tick's internal delayed sends resolve
	};
	return { timers, ctl };
}

/**
 * The reconnect delays a connection asked for, in order. Filters out the transport's short internal
 * waits (2 s between GATT attempts, 300 ms inside the handshake tick), which are always < 5 s.
 *
 * @param ctl - control object from {@link makeTimers}
 */
function reconnectDelays(ctl) {
	return ctl.delays.filter(ms => ms >= 5000);
}

/**
 * Bootstrap a201 payload = protobuf field 8 { field 27 = encRand } (SN-CBC encrypted on the wire).
 *
 * @param seq - 16-bit sequence number
 */
function bootstrapFrame(seq) {
	const inner = Buffer.concat([Buffer.from([0xda, 0x01, 0x10]), ENC_RAND]); // f27 (bytes,16)
	const outer = Buffer.concat([Buffer.from([0x42, inner.length]), inner]); // f8 (message)
	return bleBuildFrame(0xa201, outer, { mode: "sncbc", sn: SN, seq });
}

/**
 * CommCmdStatus response (a219) with sts (field 11), GCM-encrypted. Optionally sets the echoed
 * action (field 3) so the receiver can tell a base (64) status from a PIN (82) status.
 *
 * @param sts - pairing status code
 * @param seq - 16-bit sequence number
 * @param action - optional echoed action code (field 3)
 */
function statusFrame(sts, seq, action) {
	const body = action == null ? Buffer.from([0x58, sts]) : Buffer.from([0x18, action, 0x58, sts]);
	return bleBuildFrame(0xa219, body, { mode: "gcm", encRand: ENC_RAND, seq });
}

/**
 * Drive a connection all the way through the handshake and return it paired.
 *
 * @param options - optional `timeoutOverrideMs` (collapses the reconnect backoff) and
 *   `idleTimeoutMs` (shortens the no-traffic watchdog) so timing-dependent behaviour is testable
 */
async function pairedConnection(options = {}) {
	const gateway = new FakeGateway();
	const { timers, ctl } = makeTimers(options.timeoutOverrideMs);
	const conn = new BleConnection({
		gateway,
		mac: MAC,
		sn: SN,
		pin: PIN,
		timers,
		log: silentLog,
		idleTimeoutMs: options.idleTimeoutMs,
	});

	conn.connect();
	await sleep(50);
	gateway.push(bootstrapFrame(1));
	await ctl.fireTick(); // boot -> commcmd
	await ctl.fireTick(); // sends CommCmd Y + status poll
	gateway.push(statusFrame(1, 2)); // paired
	assert.strictEqual(conn.connected, true, "setup: connection should be paired");
	return { gateway, conn, ctl };
}

describe("BleConnection", function () {
	this.timeout(8000);

	it("runs the full pairing handshake and forwards decrypted data once paired", async function () {
		const gateway = new FakeGateway();
		const { timers, ctl } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });

		let connectedEmitted = false;
		conn.on("connected", () => {
			connectedEmitted = true;
		});
		const messages = [];
		conn.on("message", m => messages.push(Buffer.from(m)));

		conn.connect();
		await sleep(50); // establish() (connect device, discover handles, subscribe notify)

		// Device sends its bootstrap → transport extracts encRand.
		gateway.push(bootstrapFrame(1));

		await ctl.fireTick(); // sends a301; encRand known → boot -> commcmd
		await ctl.fireTick(); // commcmd -> sends CommCmd Y + H

		// Device asks for a PIN.
		gateway.push(statusFrame(3, 2));
		await ctl.fireTick(); // pin_needed -> sends PIN + H

		// PIN accepted → paired.
		gateway.push(statusFrame(1, 3));
		assert.strictEqual(connectedEmitted, true, "connected should be emitted on sts=1");
		assert.strictEqual(conn.connected, true);

		// A GCM data frame is now forwarded to DeviceContext as a cleartext HM frame.
		const dataPayload = Buffer.from([0x0a, 0x02, 0x41, 0x42]);
		gateway.push(bleBuildFrame(0xa211, dataPayload, { mode: "gcm", encRand: ENC_RAND, seq: 4 }));
		assert.strictEqual(messages.length, 1, "one message forwarded after pairing");
		const parsed = bleParseFrame(messages[0]);
		assert.strictEqual(parsed.tag, 0xa211);
		assert.deepStrictEqual(parsed.payload, dataPayload);

		// A PIN frame was actually written to the write characteristic during pin_needed.
		const wroteSomething = gateway.writes.length > 0;
		assert.ok(wroteSomething, "frames were written to the gateway");

		conn.disconnect();
	});

	it("pairs on a PIN-accepted status (action 82, sts=0 — inverted vs. base)", async function () {
		const gateway = new FakeGateway();
		const { timers, ctl } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		let connectedEmitted = false;
		conn.on("connected", () => {
			connectedEmitted = true;
		});

		conn.connect();
		await sleep(50);
		gateway.push(bootstrapFrame(1));
		await ctl.fireTick(); // boot -> commcmd
		await ctl.fireTick(); // commcmd -> Y + base status poll
		gateway.push(statusFrame(3, 2)); // base status: PIN needed
		await ctl.fireTick(); // pin_needed -> sends PIN + action-82 poll

		// PIN status uses inverted semantics: sts=0 means accepted.
		gateway.push(statusFrame(0, 3, 82));
		assert.strictEqual(connectedEmitted, true, "sts=0 on the action-82 status must pair");
		assert.strictEqual(conn.connected, true);
		conn.disconnect();
	});

	it("fails on a PIN-rejected status (action 82, sts=1)", async function () {
		const gateway = new FakeGateway();
		const { timers, ctl } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		let failReason = null;
		conn.on("pairingFailed", r => {
			failReason = r;
		});

		conn.connect();
		await sleep(50);
		gateway.push(bootstrapFrame(1));
		await ctl.fireTick();
		await ctl.fireTick();
		gateway.push(statusFrame(3, 2));
		await ctl.fireTick();
		gateway.push(statusFrame(1, 3, 82)); // action-82, sts=1 → rejected
		assert.ok(failReason, "a rejected PIN must emit pairingFailed");
		assert.strictEqual(conn.connected, false);
		conn.disconnect();
	});

	it("writes the CCCD (notify handle + 1) so the device starts sending", async function () {
		const gateway = new FakeGateway();
		const { timers } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });

		conn.connect();
		await sleep(50); // establish() runs GATT connect + notify + CCCD write

		// ffe2's handle is 11, so the CCCD is handle 12, written with 0x0100.
		assert.strictEqual(gateway.descriptorWrites.length, 1, "one CCCD write");
		assert.strictEqual(gateway.descriptorWrites[0].handle, 12);
		assert.deepStrictEqual(gateway.descriptorWrites[0].value, Buffer.from([0x01, 0x00]));

		conn.disconnect();
	});

	it("passes the advertised BLE address type to the GATT connect", async function () {
		const gateway = new FakeGateway();
		const { timers } = makeTimers();
		const conn = new BleConnection({
			gateway,
			mac: MAC,
			sn: SN,
			pin: PIN,
			addressType: 0,
			timers,
			log: silentLog,
		});
		conn.connect();
		await sleep(50);
		// Without the address type the proxy rejects the connect with "error 0" on real hardware.
		assert.strictEqual(gateway.lastAddressType, 0);
		conn.disconnect();
	});

	it("retries the GATT connect when the first attempt fails", async function () {
		const gateway = new FakeGateway();
		let fails = 2;
		gateway.connectDevice = async function () {
			this.connectAttempts++;
			if (fails-- > 0) {
				throw new Error("BLE connect failed (error 0)");
			}
		};
		// Collapse the 2 s inter-attempt delay so the retries complete within the test.
		const fastTimers = {
			setInterval: () => 1,
			clearInterval: () => {},
			setTimeout: cb => setTimeout(cb, 1),
			clearTimeout: h => clearTimeout(h),
		};
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers: fastTimers, log: silentLog });

		conn.connect();
		await sleep(200);

		assert.ok(gateway.connectAttempts >= 3, `expected a retry, got ${gateway.connectAttempts} attempts`);
		conn.disconnect();
	});

	it("does not forward frames before pairing completes", async function () {
		const gateway = new FakeGateway();
		const { timers, ctl } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		const messages = [];
		conn.on("message", m => messages.push(m));

		conn.connect();
		await sleep(50);
		gateway.push(bootstrapFrame(1));
		await ctl.fireTick();
		// A data frame arriving pre-pairing must be consumed internally, not forwarded.
		gateway.push(bleBuildFrame(0xa211, Buffer.from([0x08, 0x01]), { mode: "gcm", encRand: ENC_RAND, seq: 5 }));
		assert.strictEqual(messages.length, 0);
		conn.disconnect();
	});

	it("emits pairingFailed and stops on a rejected PIN (sts=4)", async function () {
		const gateway = new FakeGateway();
		const { timers, ctl } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });

		let failReason = null;
		conn.on("pairingFailed", r => {
			failReason = r;
		});

		conn.connect();
		await sleep(50);
		gateway.push(bootstrapFrame(1));
		await ctl.fireTick();
		await ctl.fireTick();
		gateway.push(statusFrame(3, 2)); // PIN needed
		await ctl.fireTick(); // send PIN
		gateway.push(statusFrame(4, 3)); // rejected

		assert.ok(failReason && /PIN/i.test(failReason), `pairingFailed with reason, got: ${failReason}`);
		assert.strictEqual(conn.connected, false);
		conn.disconnect();
	});

	it("reassembles a notify frame delivered in multiple chunks", async function () {
		const gateway = new FakeGateway();
		const { timers } = makeTimers();
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		conn.connect();
		await sleep(50);

		// Split the bootstrap frame across two notifications; encRand must still be extracted.
		const frame = bootstrapFrame(1);
		const mid = Math.floor(frame.length / 2);
		gateway.push(frame.subarray(0, mid));
		gateway.push(frame.subarray(mid));

		// After encRand is known, a GCM status frame decrypts and drives the handshake.
		gateway.push(statusFrame(1, 2));
		assert.strictEqual(conn.connected, true);
		conn.disconnect();
	});

	// --- session loss (the inverter powers down at night) ---------------------------
	//
	// The proxy stays connected while the inverter itself goes away, so the gateway-level
	// "disconnected" event never fires. Without the two mechanisms below `connected` stayed true
	// until the adapter was restarted, which also starved the cloud fallback (the cloud poller
	// skips any DTU whose local connection reports connected).

	it("drops the session when the proxy reports the device gone", async function () {
		const { gateway, conn } = await pairedConnection();
		let disconnects = 0;
		conn.on("disconnected", () => disconnects++);

		gateway.dropDevice();

		assert.strictEqual(conn.connected, false, "a device-level disconnect must clear `connected`");
		assert.strictEqual(disconnects, 1, "DeviceContext must be told the link is gone");
		conn.disconnect();
	});

	it("reconnects after the device comes back", async function () {
		// Collapse the 5 s reconnect backoff so the retry lands inside the test.
		const { gateway, conn } = await pairedConnection({ timeoutOverrideMs: 5 });
		const attemptsWhenPaired = gateway.connectAttempts;

		gateway.dropDevice();
		await sleep(120); // reconnect timer fires → establish() → gattConnect()

		assert.ok(
			gateway.connectAttempts > attemptsWhenPaired,
			`expected a reconnect attempt, got ${gateway.connectAttempts} (was ${attemptsWhenPaired})`,
		);
		conn.disconnect();
	});

	it("backs off exponentially while the device stays away", async function () {
		// The inverter is powered down for the whole night. A fixed 5 s retry means ~700 pointless
		// GATT rounds over the proxy until sunrise, each one also logging.
		const gateway = new FakeGateway();
		gateway.connectDevice = async function () {
			this.connectAttempts++;
			throw new Error("BLE connect failed (error 256)");
		};
		const { timers, ctl } = makeTimers(1); // collapse every wait so the rounds fit in the test
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		conn.on("error", () => {}); // as DeviceContext does — an unhandled "error" would kill the retry loop

		conn.connect();
		await sleep(400);
		conn.disconnect();

		const delays = reconnectDelays(ctl);
		assert.ok(delays.length >= 3, `expected several reconnect rounds, got ${delays.length}`);
		assert.deepStrictEqual(delays.slice(0, 3), [5000, 10000, 20000], "delay must double per failure");
	});

	it("caps the reconnect backoff at 5 minutes", async function () {
		const gateway = new FakeGateway();
		gateway.connectDevice = async function () {
			this.connectAttempts++;
			throw new Error("BLE connect failed (error 256)");
		};
		const { timers, ctl } = makeTimers(1);
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		conn.on("error", () => {});

		conn.connect();
		await sleep(800);
		conn.disconnect();

		const delays = reconnectDelays(ctl);
		assert.ok(
			delays.every(ms => ms <= 300000),
			`no delay may exceed 5 min, got ${Math.max(...delays)}`,
		);
	});

	it("resets the reconnect backoff once a session pairs", async function () {
		// Morning: after the failed night rounds the very next drop must retry promptly again,
		// otherwise a paired-then-lost link would inherit the night's 5-minute delay.
		const gateway = new FakeGateway();
		gateway.connectDevice = async function () {
			this.connectAttempts++;
			if (this.connectAttempts <= 6) {
				throw new Error("BLE connect failed (error 256)"); // one full establish() round fails
			}
		};
		const { timers, ctl } = makeTimers(5);
		const conn = new BleConnection({ gateway, mac: MAC, sn: SN, pin: PIN, timers, log: silentLog });
		conn.on("error", () => {});

		conn.connect();
		await sleep(200); // first round fails, reconnect fires, second round gets through
		assert.deepStrictEqual(reconnectDelays(ctl), [5000], "setup: exactly one failed round");

		gateway.push(bootstrapFrame(1));
		await ctl.fireTick();
		await ctl.fireTick();
		gateway.push(statusFrame(1, 2));
		assert.strictEqual(conn.connected, true, "setup: connection should be paired");

		ctl.delays.length = 0;
		gateway.dropDevice();

		assert.deepStrictEqual(reconnectDelays(ctl), [5000], "a good session must restart the backoff");
		conn.disconnect();
	});

	it("tears the session down when no frame arrives within the idle timeout", async function () {
		const { gateway, conn, ctl } = await pairedConnection({ idleTimeoutMs: 200 });
		let disconnects = 0;
		conn.on("disconnected", () => disconnects++);

		await sleep(300); // longer than the idle timeout, with no traffic
		await ctl.fireTick();

		assert.strictEqual(conn.connected, false, "a silent link must not stay `connected` forever");
		assert.strictEqual(disconnects, 1);
		void gateway;
		conn.disconnect();
	});

	it("keeps the session alive while frames keep arriving", async function () {
		const { gateway, conn, ctl } = await pairedConnection({ idleTimeoutMs: 250 });

		await sleep(150);
		// A fresh frame must reset the idle clock — otherwise a healthy link would be torn down.
		gateway.push(bleBuildFrame(0xa211, Buffer.from([0x08, 0x01]), { mode: "gcm", encRand: ENC_RAND, seq: 9 }));
		await sleep(150); // 300 ms since pairing, but only 150 ms since the last frame
		await ctl.fireTick();

		assert.strictEqual(conn.connected, true, "traffic must keep the session up");
		conn.disconnect();
	});
});
