import assert from "node:assert";
import CloudRelay from "../build/lib/cloudRelay.js";

// ============================================================
// cloudRelay – constructor and configuration
// ============================================================
describe("cloudRelay", function () {
	it("constructor sets default values", function () {
		const relay = new CloudRelay("server.example.com", 10081);
		assert.strictEqual(relay.connected, false);
		assert.strictEqual(relay.paused, false);
		relay.disconnect();
	});

	it("disconnect sets connected to false", function () {
		const relay = new CloudRelay("server.example.com", 10081);
		relay.disconnect();
		assert.strictEqual(relay.connected, false);
	});

	it("updateRealData stores payload when buffer is large enough", function () {
		const relay = new CloudRelay("server.example.com", 10081);
		const fakeMsg = Buffer.alloc(20, 0xaa);
		relay.updateRealData(fakeMsg);
		// lastRealDataPayload is private, but we can verify no crash
		relay.disconnect();
	});

	it("updateRealData ignores too-small buffers", function () {
		const relay = new CloudRelay("server.example.com", 10081);
		relay.updateRealData(Buffer.alloc(5));
		relay.disconnect();
	});

	it("sendFinalAndPause sets paused to true", function () {
		const relay = new CloudRelay("server.example.com", 10081);
		relay.sendFinalAndPause();
		assert.strictEqual(relay.paused, true);
		relay.disconnect();
	});

	it("resume sets paused to false", function () {
		const relay = new CloudRelay("server.example.com", 10081);
		relay.sendFinalAndPause();
		assert.strictEqual(relay.paused, true);
		relay.resume();
		assert.strictEqual(relay.paused, false);
		relay.disconnect();
	});

	// ============================================================
	// setRealDataInterval
	// ============================================================
	describe("setRealDataInterval", function () {
		it("accepts valid minutes value without crash", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.setRealDataInterval(5);
			relay.disconnect();
		});

		it("accepts minimum value of 1 minute", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.setRealDataInterval(1);
			relay.disconnect();
		});

		it("ignores 0 value", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.setRealDataInterval(0);
			// No crash, value silently ignored
			relay.disconnect();
		});

		it("ignores negative value", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.setRealDataInterval(-5);
			relay.disconnect();
		});

		it("can be called multiple times with different values", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.setRealDataInterval(1);
			relay.setRealDataInterval(10);
			relay.setRealDataInterval(3);
			relay.disconnect();
		});
	});

	// ============================================================
	// configure
	// ============================================================
	describe("configure", function () {
		it("throws when dtuSn is empty", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.throws(() => {
				relay.configure({}, "");
			}, /dtuSn is required/);
			relay.disconnect();
		});

		it("accepts valid protobuf handler and dtuSn", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const fakeProtobuf = { protos: {} };
			relay.configure(fakeProtobuf, "HM123456789");
			// No crash — protobuf and dtuSn are stored
			relay.disconnect();
		});

		it("accepts optional timezoneOffset parameter", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const fakeProtobuf = { protos: {} };
			relay.configure(fakeProtobuf, "HM123456789", 3600);
			relay.disconnect();
		});

		it("uses default timezoneOffset when not provided", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const fakeProtobuf = { protos: {} };
			relay.configure(fakeProtobuf, "HM123456789");
			// No crash — uses the default local timezone offset
			relay.disconnect();
		});
	});

	// ============================================================
	// sendFinalAndPause / resume interaction
	// ============================================================
	describe("sendFinalAndPause / resume", function () {
		it("resume immediately after sendFinalAndPause clears pauseTimer", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			assert.strictEqual(relay.paused, true);
			// Immediately resume — should clear the pause timer
			relay.resume();
			assert.strictEqual(relay.paused, false);
			relay.disconnect();
		});

		it("multiple sendFinalAndPause calls do not crash", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			relay.sendFinalAndPause();
			relay.sendFinalAndPause();
			assert.strictEqual(relay.paused, true);
			relay.disconnect();
		});

		it("sendFinalAndPause then resume then sendFinalAndPause again", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			assert.strictEqual(relay.paused, true);
			relay.resume();
			assert.strictEqual(relay.paused, false);
			relay.sendFinalAndPause();
			assert.strictEqual(relay.paused, true);
			relay.disconnect();
		});

		it("resume when not paused is a no-op", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.strictEqual(relay.paused, false);
			relay.resume();
			assert.strictEqual(relay.paused, false);
			relay.disconnect();
		});
	});

	// ============================================================
	// updateRealData edge cases
	// ============================================================
	describe("updateRealData edge cases", function () {
		it("handles exactly 10-byte buffer (boundary, too small)", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.updateRealData(Buffer.alloc(10));
			// 10 bytes is not > 10, so payload should not be stored
			relay.disconnect();
		});

		it("handles 11-byte buffer (minimum valid size)", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.updateRealData(Buffer.alloc(11, 0xbb));
			relay.disconnect();
		});

		it("can be called multiple times overwriting previous data", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.updateRealData(Buffer.alloc(20, 0xaa));
			relay.updateRealData(Buffer.alloc(30, 0xbb));
			relay.updateRealData(Buffer.alloc(15, 0xcc));
			relay.disconnect();
		});
	});

	// ============================================================
	// disconnect
	// ============================================================
	describe("disconnect", function () {
		it("can be called multiple times without error", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.disconnect();
			relay.disconnect();
			relay.disconnect();
			assert.strictEqual(relay.connected, false);
		});

		it("cleans up after sendFinalAndPause", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			relay.disconnect();
			assert.strictEqual(relay.connected, false);
		});
	});

	// ============================================================
	// sendFinalAndPause – detailed behavior
	// ============================================================
	describe("sendFinalAndPause detailed", function () {
		it("stops session timers (heartbeat + realData)", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			// Manually set timers to simulate an active session
			relay.heartbeatTimer = setInterval(() => {}, 100000);
			relay.realDataTimer = setInterval(() => {}, 100000);
			assert.ok(relay.heartbeatTimer !== undefined);
			assert.ok(relay.realDataTimer !== undefined);

			relay.sendFinalAndPause();

			assert.strictEqual(relay.heartbeatTimer, undefined, "heartbeatTimer should be cleared");
			assert.strictEqual(relay.realDataTimer, undefined, "realDataTimer should be cleared");
			assert.strictEqual(relay.paused, true);
			relay.disconnect();
		});

		it("creates a pauseTimer for delayed socket cleanup", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			assert.ok(relay.pauseTimer !== undefined, "pauseTimer should be set for delayed cleanup");
			relay.disconnect();
		});

		it("does not create pauseTimer when already destroyed", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.disconnect(); // sets destroyed = true
			relay.paused = false; // reset for test
			relay.sendFinalAndPause();
			assert.strictEqual(relay.paused, true, "paused should still be set");
			// pauseTimer should be null because destroyed guard returns early
			assert.strictEqual(relay.pauseTimer, undefined, "pauseTimer should not be set when destroyed");
		});
	});

	// ============================================================
	// resume – detailed behavior
	// ============================================================
	describe("resume detailed", function () {
		it("clears pauseTimer when called during pause delay", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			assert.ok(relay.pauseTimer !== undefined, "pauseTimer should exist after sendFinalAndPause");

			relay.resume();
			assert.strictEqual(relay.pauseTimer, undefined, "pauseTimer should be cleared by resume");
			assert.strictEqual(relay.paused, false);
			relay.disconnect();
		});

		it("does not attempt connect when destroyed", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.sendFinalAndPause();
			relay.disconnect(); // sets destroyed = true
			relay.paused = true; // simulate still paused

			// resume should not throw even when destroyed
			assert.doesNotThrow(() => relay.resume());
			assert.strictEqual(relay.paused, false);
		});
	});

	// ============================================================
	// _startTimers guard – paused race condition
	// ============================================================
	describe("_startTimers guard", function () {
		it("does not create timers when paused is true", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.paused = true;

			relay._startTimers();

			assert.strictEqual(relay.heartbeatTimer, undefined, "heartbeatTimer should not be created when paused");
			assert.strictEqual(relay.realDataTimer, undefined, "realDataTimer should not be created when paused");
			relay.disconnect();
		});

		it("does not create timers when destroyed is true", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.disconnect(); // sets destroyed = true

			relay._startTimers();

			assert.strictEqual(relay.heartbeatTimer, undefined, "heartbeatTimer should not be created when destroyed");
			assert.strictEqual(relay.realDataTimer, undefined, "realDataTimer should not be created when destroyed");
		});

		it("creates timers when neither paused nor destroyed", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.strictEqual(relay.paused, false);
			assert.strictEqual(relay.destroyed, false);

			relay._startTimers();

			assert.ok(relay.heartbeatTimer !== undefined, "heartbeatTimer should be created");
			assert.ok(relay.realDataTimer !== undefined, "realDataTimer should be created");
			relay.disconnect();
		});
	});

	// ============================================================
	// _stopSessionTimers
	// ============================================================
	describe("_stopSessionTimers", function () {
		it("clears both heartbeat and realData timers", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.heartbeatTimer = setInterval(() => {}, 100000);
			relay.realDataTimer = setInterval(() => {}, 100000);

			relay._stopSessionTimers();

			assert.strictEqual(relay.heartbeatTimer, undefined);
			assert.strictEqual(relay.realDataTimer, undefined);
			relay.disconnect();
		});

		it("is safe to call when timers are already null", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.doesNotThrow(() => relay._stopSessionTimers());
			relay.disconnect();
		});
	});

	// ============================================================
	// _stopAllTimers
	// ============================================================
	describe("_stopAllTimers", function () {
		it("clears pauseTimer in addition to session timers", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.heartbeatTimer = setInterval(() => {}, 100000);
			relay.realDataTimer = setInterval(() => {}, 100000);
			relay.pauseTimer = setTimeout(() => {}, 100000);

			relay._stopAllTimers();

			assert.strictEqual(relay.heartbeatTimer, undefined);
			assert.strictEqual(relay.realDataTimer, undefined);
			assert.strictEqual(relay.pauseTimer, undefined);
			relay.disconnect();
		});
	});

	// ============================================================
	// _shouldReconnect
	// ============================================================
	describe("_shouldReconnect", function () {
		it("returns true when not paused", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.strictEqual(relay._shouldReconnect(), true);
			relay.disconnect();
		});

		it("returns false when paused", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.paused = true;
			assert.strictEqual(relay._shouldReconnect(), false);
			relay.disconnect();
		});
	});

	// ============================================================
	// _buildCloudMessage
	// ============================================================
	describe("_buildCloudMessage", function () {
		it("throws when protobuf is not configured", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.throws(() => relay._buildCloudMessage(0x22, 0x02, Buffer.from([0x01])), /Protobuf not configured/);
			relay.disconnect();
		});

		it("increments sequence counter", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const fakeBuildMessage = (h, l, p, seq) => Buffer.from([seq & 0xff]);
			const fakeProtobuf = { protos: {}, buildMessage: fakeBuildMessage };
			relay.configure(fakeProtobuf, "HM123456789");

			const initialSeq = relay.seq;
			relay._buildCloudMessage(0x22, 0x02, Buffer.from([0x01]));
			assert.strictEqual(relay.seq, initialSeq + 1);
			relay.disconnect();
		});

		it("wraps sequence counter at 60000", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const fakeBuildMessage = (h, l, p, seq) => Buffer.from([seq & 0xff]);
			const fakeProtobuf = { protos: {}, buildMessage: fakeBuildMessage };
			relay.configure(fakeProtobuf, "HM123456789");

			relay.seq = 60000;
			relay._buildCloudMessage(0x22, 0x02, Buffer.from([0x01]));
			assert.strictEqual(relay.seq, 0, "seq should wrap to 0 after 60000");
			relay.disconnect();
		});
	});

	// ============================================================
	// _safeWrite
	// ============================================================
	describe("_safeWrite", function () {
		it("does nothing when socket is null", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.strictEqual(relay.socket, null);
			// Should not throw
			assert.doesNotThrow(() => relay._safeWrite(Buffer.from([0x01])));
			relay.disconnect();
		});
	});

	// ============================================================
	// _sendHeartbeat / _sendRealData / _sendRealDataStatus guards
	// ============================================================
	describe("send methods guard checks", function () {
		it("_sendHeartbeat does nothing when not connected", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			// Should not throw when not connected
			assert.doesNotThrow(() => relay._sendHeartbeat());
			relay.disconnect();
		});

		it("_sendRealDataStatus does nothing when not connected", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.doesNotThrow(() => relay._sendRealDataStatus());
			relay.disconnect();
		});

		it("_sendRealData does nothing when not connected", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			assert.doesNotThrow(() => relay._sendRealData());
			relay.disconnect();
		});

		it("_sendRealDataStatus does nothing when no payload stored", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			// Simulate connected state without socket (guard still triggers)
			relay.connected = true;
			assert.doesNotThrow(() => relay._sendRealDataStatus());
			relay.disconnect();
		});

		it("_sendRealData does nothing when no payload stored", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.connected = true;
			assert.doesNotThrow(() => relay._sendRealData());
			relay.disconnect();
		});
	});

	// ============================================================
	// setRealDataInterval – same value no-op
	// ============================================================
	describe("setRealDataInterval edge cases", function () {
		it("no-ops when new interval equals current interval", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			// Default is 300000ms = 5 minutes
			// Setting 5 minutes again should be a no-op
			relay.setRealDataInterval(5);
			// No crash, no timer restart
			relay.disconnect();
		});

		it("accepts very large values", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.setRealDataInterval(1440); // 24 hours
			relay.disconnect();
		});
	});

	// ============================================================
	// updateRealData – stores payload and timestamp
	// ============================================================
	describe("updateRealData stores payload", function () {
		it("stores stripped payload (without 10-byte header)", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const raw = Buffer.alloc(20, 0xcc);
			relay.updateRealData(raw);
			// lastRealDataPayload should be bytes 10..19 (length 10)
			assert.ok(relay.lastRealDataPayload !== null, "payload should be stored");
			assert.strictEqual(relay.lastRealDataPayload.length, 10, "should strip 10-byte header");
			assert.strictEqual(relay.lastRealDataPayload[0], 0xcc);
			relay.disconnect();
		});

		it("updates lastRealDataTimestamp", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			const before = Date.now();
			relay.updateRealData(Buffer.alloc(20, 0xcc));
			const after = Date.now();
			assert.ok(relay.lastRealDataTimestamp >= before);
			assert.ok(relay.lastRealDataTimestamp <= after);
			relay.disconnect();
		});

		it("does not update payload for exactly 10-byte buffer", function () {
			const relay = new CloudRelay("server.example.com", 10081);
			relay.updateRealData(Buffer.alloc(10));
			assert.strictEqual(relay.lastRealDataPayload, null, "10 bytes is not > 10");
			relay.disconnect();
		});
	});
});
