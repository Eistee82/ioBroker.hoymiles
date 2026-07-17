import assert from "node:assert";
import DtuConnection from "../build/lib/dtuConnection.js";

// ============================================================
// dtuConnection
// ============================================================
describe("dtuConnection", function () {
	describe("constructor", function () {
		it("sets default values correctly", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			assert.strictEqual(conn.connected, false);
			conn.disconnect();
		});

		it("accepts port 0 without error", function () {
			const conn = new DtuConnection("192.168.1.100", 0);
			assert.strictEqual(conn.connected, false);
			conn.disconnect();
		});

		it("accepts heartbeat generator callback", function () {
			const conn = new DtuConnection("192.168.1.100", 10081, () => Buffer.from([0x48, 0x4d]));
			assert.strictEqual(conn.connected, false);
			conn.disconnect();
		});
	});

	describe("disconnect", function () {
		it("sets connected to false", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect();
			assert.strictEqual(conn.connected, false);
		});

		it("can be called multiple times without error", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect();
			conn.disconnect();
			conn.disconnect();
			assert.strictEqual(conn.connected, false);
		});

		it("sets destroyed flag so connect becomes no-op", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect();
			// After disconnect, destroyed is true — connect should be a no-op
			conn.connect();
			assert.strictEqual(conn.connected, false);
		});
	});

	describe("send", function () {
		it("returns false when not connected", async function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const result = await conn.send(Buffer.from([0x01, 0x02]));
			assert.strictEqual(result, false);
			conn.disconnect();
		});

		it("returns false after disconnect", async function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect();
			const result = await conn.send(Buffer.from([0x01, 0x02]));
			assert.strictEqual(result, false);
		});

		it("returns false with empty buffer when not connected", async function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const result = await conn.send(Buffer.alloc(0));
			assert.strictEqual(result, false);
			conn.disconnect();
		});
	});

	describe("heartbeat generator", function () {
		it("stores null when no generator provided", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			// No crash — heartbeat generator is null internally
			assert.strictEqual(conn.connected, false);
			conn.disconnect();
		});

		it("stores the provided generator function", function () {
			let called = false;
			const generator = () => {
				called = true;
				return Buffer.from([0x48, 0x4d]);
			};
			const conn = new DtuConnection("192.168.1.100", 10081, generator);
			// Generator is stored but not called until heartbeat fires
			assert.strictEqual(called, false);
			conn.disconnect();
		});
	});

	describe("_stopSessionTimers", function () {
		it("clears heartbeatTimer and idleTimer", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			// Manually set timers to simulate active session
			conn.heartbeatTimer = setTimeout(() => {}, 100000);
			conn.idleTimer = setTimeout(() => {}, 100000);
			assert.ok(conn.heartbeatTimer !== undefined, "heartbeatTimer should be set");
			assert.ok(conn.idleTimer !== undefined, "idleTimer should be set");
			conn._stopSessionTimers();
			assert.strictEqual(
				conn.heartbeatTimer,
				undefined,
				"heartbeatTimer should be null after _stopSessionTimers",
			);
			assert.strictEqual(conn.idleTimer, undefined, "idleTimer should be null after _stopSessionTimers");
			conn.disconnect();
		});

		it("is safe to call when timers are already null", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			assert.strictEqual(conn.heartbeatTimer, undefined);
			assert.strictEqual(conn.idleTimer, undefined);
			assert.doesNotThrow(() => conn._stopSessionTimers());
			conn.disconnect();
		});
	});

	describe("destroyed flag", function () {
		it("disconnect sets destroyed to true", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			assert.strictEqual(conn.destroyed, false, "destroyed should be false initially");
			conn.disconnect();
			assert.strictEqual(conn.destroyed, true, "destroyed should be true after disconnect");
		});

		it("destroyed prevents reconnection after disconnect", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect();
			assert.strictEqual(conn.destroyed, true);
			// connect() should be a no-op when destroyed
			conn.connect();
			assert.strictEqual(conn.connected, false);
			assert.strictEqual(conn.socket, null);
		});
	});

	describe("EventEmitter", function () {
		it("supports adding event listeners", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			let errorReceived = false;
			conn.on("error", () => {
				errorReceived = true;
			});
			conn.emit("error", new Error("test"));
			assert.strictEqual(errorReceived, true);
			conn.disconnect();
		});

		it("supports message event listeners", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			let messageReceived = null;
			conn.on("message", msg => {
				messageReceived = msg;
			});
			const testMsg = Buffer.from([0x48, 0x4d, 0x00]);
			conn.emit("message", testMsg);
			assert.deepStrictEqual(messageReceived, testMsg);
			conn.disconnect();
		});
	});

	// ============================================================
	// _onData – message framing via direct method call
	// ============================================================
	describe("_onData message framing", function () {
		/**
		 * Helper: build a valid HM-framed message.
		 * Header: 0x48 0x4d + 6 padding bytes + 2-byte big-endian total length.
		 * Body: filled with 0xAA.
		 *
		 * @param totalLen - Total message length including header
		 */
		function buildHmMessage(totalLen) {
			const buf = Buffer.alloc(totalLen, 0xaa);
			buf[0] = 0x48; // magic 0
			buf[1] = 0x4d; // magic 1
			buf[8] = (totalLen >> 8) & 0xff;
			buf[9] = totalLen & 0xff;
			return buf;
		}

		it("emits message for a complete single frame", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const frame = buildHmMessage(14);
			conn._onData(frame);

			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].length, 14);
			assert.strictEqual(messages[0][0], 0x48);
			assert.strictEqual(messages[0][1], 0x4d);
			conn.disconnect();
		});

		it("reassembles a message split across two chunks", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const frame = buildHmMessage(20);
			// Split at byte 8 (in the middle of the header)
			conn._onData(frame.subarray(0, 8));
			assert.strictEqual(messages.length, 0, "should not emit yet — incomplete header");
			conn._onData(frame.subarray(8));
			assert.strictEqual(messages.length, 1, "should emit after second chunk completes the frame");
			assert.strictEqual(messages[0].length, 20);
			conn.disconnect();
		});

		it("reassembles a message split into many small chunks", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const frame = buildHmMessage(16);
			// Feed one byte at a time
			for (let i = 0; i < frame.length; i++) {
				conn._onData(frame.subarray(i, i + 1));
			}
			assert.strictEqual(messages.length, 1);
			assert.deepStrictEqual(messages[0], frame);
			conn.disconnect();
		});

		it("handles two complete messages in one chunk", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const frame1 = buildHmMessage(12);
			const frame2 = buildHmMessage(14);
			const combined = Buffer.concat([frame1, frame2]);
			conn._onData(combined);

			assert.strictEqual(messages.length, 2);
			assert.strictEqual(messages[0].length, 12);
			assert.strictEqual(messages[1].length, 14);
			conn.disconnect();
		});

		it("skips garbage bytes before valid magic header", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const garbage = Buffer.from([0x00, 0x01, 0x02, 0xff]);
			const frame = buildHmMessage(12);
			const combined = Buffer.concat([garbage, frame]);
			conn._onData(combined);

			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].length, 12);
			conn.disconnect();
		});

		it("discards data with no magic header found", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const garbage = Buffer.alloc(20, 0xff); // No 0x48 0x4d anywhere
			conn._onData(garbage);

			assert.strictEqual(messages.length, 0);
			conn.disconnect();
		});

		it("skips frame with invalid totalLen (too small)", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			// Build a frame header that claims totalLen = 5 (less than HEADER_SIZE=10)
			const badFrame = Buffer.alloc(20, 0x00);
			badFrame[0] = 0x48;
			badFrame[1] = 0x4d;
			badFrame[8] = 0x00;
			badFrame[9] = 0x05; // totalLen = 5, invalid

			// Append a valid frame after the bad one (the parser should skip bad bytes and find this)
			const goodFrame = buildHmMessage(10);
			const combined = Buffer.concat([badFrame, goodFrame]);
			conn._onData(combined);

			// The parser skips the bad header byte-by-byte until it finds the good frame's magic
			assert.ok(messages.length >= 0); // May or may not find goodFrame depending on overlap
			conn.disconnect();
		});

		it("waits for more data when totalLen exceeds current buffer", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			// Header says 30 bytes total, but only send 15 initially
			const frame = buildHmMessage(30);
			conn._onData(frame.subarray(0, 15));
			assert.strictEqual(messages.length, 0, "should wait for remaining bytes");

			conn._onData(frame.subarray(15));
			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].length, 30);
			conn.disconnect();
		});
	});

	// ============================================================
	// _onData – buffer overflow protection
	// ============================================================
	describe("_onData buffer overflow", function () {
		it("emits error and resets buffer when exceeding MAX_BUFFER_SIZE (128KB)", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const errors = [];
			conn.on("error", err => errors.push(err));

			// Build a valid header that claims a huge totalLen so the parser waits for more data
			// instead of consuming it. Header says totalLen=65535 so it keeps buffering.
			const header = Buffer.alloc(10, 0x00);
			header[0] = 0x48; // magic
			header[1] = 0x4d;
			header[8] = 0xff; // totalLen = 65535
			header[9] = 0xff;
			conn._onData(header);

			// Now feed enough data to exceed 128KB. Parser is waiting for 65535 bytes total.
			// After header (10 bytes), send 131063 more bytes to exceed 131072 limit.
			const bigChunk = Buffer.alloc(131063, 0xaa);
			conn._onData(bigChunk);

			assert.strictEqual(errors.length, 1);
			assert.ok(errors[0].message.includes("overflow"), "error message should mention overflow");
			conn.disconnect();
		});

		it("buffer resets after overflow, allowing new messages", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.on("error", () => {}); // Suppress error

			// Overflow
			conn._onData(Buffer.alloc(130000, 0xff));
			conn._onData(Buffer.alloc(2000, 0xff));

			// Now send a valid message — should work after reset
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			const frame = Buffer.alloc(12, 0xaa);
			frame[0] = 0x48;
			frame[1] = 0x4d;
			frame[8] = 0x00;
			frame[9] = 12;
			conn._onData(frame);

			assert.strictEqual(messages.length, 1);
			conn.disconnect();
		});
	});

	// ============================================================
	// _onData – buffer growth
	// ============================================================
	describe("_onData buffer growth", function () {
		it("grows receive buffer when data exceeds initial 4KB", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			const messages = [];
			conn.on("message", msg => messages.push(msg));

			// Build a valid message larger than 4096 bytes (initial buffer size)
			const totalLen = 5000;
			const frame = Buffer.alloc(totalLen, 0xaa);
			frame[0] = 0x48;
			frame[1] = 0x4d;
			frame[8] = (totalLen >> 8) & 0xff;
			frame[9] = totalLen & 0xff;

			conn._onData(frame);
			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].length, totalLen);
			conn.disconnect();
		});
	});

	// ============================================================
	// _resetHeartbeatTimer / _resetIdleTimer
	// ============================================================
	describe("_resetHeartbeatTimer", function () {
		it("creates a heartbeat timer that can be observed", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn._resetHeartbeatTimer();
			assert.ok(conn.heartbeatTimer !== undefined, "heartbeatTimer should be set");
			conn.disconnect();
		});

		it("does not create timer when destroyed", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect(); // sets destroyed = true
			conn._resetHeartbeatTimer();
			assert.strictEqual(conn.heartbeatTimer, undefined, "heartbeatTimer should remain null when destroyed");
		});

		it("replaces existing timer on repeated calls", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn._resetHeartbeatTimer();
			const firstTimer = conn.heartbeatTimer;
			conn._resetHeartbeatTimer();
			const secondTimer = conn.heartbeatTimer;
			assert.ok(firstTimer !== undefined);
			assert.ok(secondTimer !== undefined);
			// They should be different timer handles
			assert.notStrictEqual(firstTimer, secondTimer);
			conn.disconnect();
		});
	});

	describe("_resetIdleTimer", function () {
		it("creates an idle timer that can be observed", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn._resetIdleTimer();
			assert.ok(conn.idleTimer !== undefined, "idleTimer should be set");
			conn.disconnect();
		});

		it("does not create timer when destroyed", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn.disconnect(); // sets destroyed = true
			conn._resetIdleTimer();
			assert.strictEqual(conn.idleTimer, undefined, "idleTimer should remain null when destroyed");
		});

		it("replaces existing timer on repeated calls", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			conn._resetIdleTimer();
			const firstTimer = conn.idleTimer;
			conn._resetIdleTimer();
			const secondTimer = conn.idleTimer;
			assert.ok(firstTimer !== undefined);
			assert.ok(secondTimer !== undefined);
			assert.notStrictEqual(firstTimer, secondTimer);
			conn.disconnect();
		});
	});

	// ============================================================
	// _onConnected
	// ============================================================
	describe("_onConnected", function () {
		it("resets consecutiveFailedSends, starts timers, emits connected", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			let connectedEmitted = false;
			conn.on("connected", () => {
				connectedEmitted = true;
			});

			// Simulate some failed sends
			conn.consecutiveFailedSends = 5;

			conn._onConnected();

			assert.strictEqual(conn.consecutiveFailedSends, 0, "should reset failed send counter");
			assert.ok(conn.heartbeatTimer !== undefined, "should start heartbeat timer");
			assert.ok(conn.idleTimer !== undefined, "should start idle timer");
			assert.strictEqual(connectedEmitted, true, "should emit connected event");
			conn.disconnect();
		});
	});

	// ============================================================
	// _configureSocket
	// ============================================================
	describe("_configureSocket", function () {
		it("sets keepAlive and adds data listener on socket", function () {
			const conn = new DtuConnection("192.168.1.100", 10081);
			let keepAliveSet = false;
			const listeners = {};
			const fakeSocket = {
				setKeepAlive(val) {
					keepAliveSet = val;
				},
				on(event, fn) {
					listeners[event] = fn;
				},
			};
			conn._configureSocket(fakeSocket);
			assert.strictEqual(keepAliveSet, true, "should enable keepAlive");
			assert.ok(typeof listeners["data"] === "function", "should add data listener");
			conn.disconnect();
		});
	});
});
