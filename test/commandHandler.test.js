import assert from "node:assert";
import {
	COMMANDS,
	executeCommand,
	executeCloudCommand,
	flashWritingStateForAction,
	shouldSkipFlashWrite,
} from "../build/lib/commandHandler.js";
import { ProtobufHandler } from "../build/lib/protobufHandler.js";

// ============================================================
// commandHandler — COMMANDS lookup table
// ============================================================
describe("commandHandler – COMMANDS", function () {
	const EXPECTED_COMMANDS = [
		"inverter.powerLimit",
		"inverter.active",
		"inverter.reboot",
		"dtu.reboot",
		"inverter.powerFactorLimit",
		"inverter.reactivePowerLimit",
		"inverter.cleanWarnings",
		"inverter.cleanGroundingFault",
		"inverter.lock",
		"config.serverSendTime",
		"config.limitPowerMyPower",
	];

	it("contains all expected command keys", function () {
		for (const key of EXPECTED_COMMANDS) {
			assert.ok(COMMANDS[key], `Missing command: ${key}`);
		}
	});

	it("has exactly 11 commands", function () {
		assert.strictEqual(Object.keys(COMMANDS).length, 11);
	});

	it("all commands have encode and log functions", function () {
		for (const [key, cmd] of Object.entries(COMMANDS)) {
			assert.strictEqual(typeof cmd.encode, "function", `${key} missing encode`);
			assert.strictEqual(typeof cmd.log, "function", `${key} missing log`);
		}
	});

	it("button commands are flagged correctly", function () {
		const buttons = ["inverter.reboot", "dtu.reboot", "inverter.cleanWarnings", "inverter.cleanGroundingFault"];
		for (const key of buttons) {
			assert.strictEqual(COMMANDS[key].button, true, `${key} should be a button`);
		}
		const nonButtons = ["inverter.powerLimit", "inverter.active", "inverter.lock", "config.limitPowerMyPower"];
		for (const key of nonButtons) {
			assert.ok(!COMMANDS[key].button, `${key} should not be a button`);
		}
	});

	it("powerLimit validate rejects out of range", function () {
		const v = COMMANDS["inverter.powerLimit"].validate;
		assert.ok(v);
		assert.ok(v(1) !== null, "1 should be rejected");
		assert.ok(v(101) !== null, "101 should be rejected");
		assert.strictEqual(v(2), null, "2 should be valid");
		assert.strictEqual(v(100), null, "100 should be valid");
		assert.strictEqual(v(50), null, "50 should be valid");
	});

	it("powerFactorLimit validate rejects invalid ranges", function () {
		const v = COMMANDS["inverter.powerFactorLimit"].validate;
		assert.ok(v);
		assert.ok(v(0) !== null, "0 should be rejected");
		assert.ok(v(0.5) !== null, "0.5 should be rejected");
		assert.strictEqual(v(0.9), null, "0.9 should be valid");
		assert.strictEqual(v(-0.9), null, "-0.9 should be valid");
		assert.strictEqual(v(1), null, "1 should be valid");
		assert.strictEqual(v(-1), null, "-1 should be valid");
	});

	it("reactivePowerLimit validate rejects out of range", function () {
		const v = COMMANDS["inverter.reactivePowerLimit"].validate;
		assert.ok(v);
		assert.ok(v(-51) !== null, "-51 should be rejected");
		assert.ok(v(51) !== null, "51 should be rejected");
		assert.strictEqual(v(0), null, "0 should be valid");
		assert.strictEqual(v(-50), null, "-50 should be valid");
		assert.strictEqual(v(50), null, "50 should be valid");
	});

	it("serverSendTime validate rejects invalid values", function () {
		const v = COMMANDS["config.serverSendTime"].validate;
		assert.ok(v);
		assert.ok(v(0) !== null, "0 should be rejected");
		assert.ok(v(-1) !== null, "-1 should be rejected");
		assert.strictEqual(v(1), null, "1 should be valid");
		assert.strictEqual(v(5), null, "5 should be valid");
	});

	it("limitPowerMyPower validate rejects out of range", function () {
		const v = COMMANDS["config.limitPowerMyPower"].validate;
		assert.ok(v, "validate function must exist");
		assert.ok(v(1) !== null, "1 should be rejected (below min 2)");
		assert.ok(v(101) !== null, "101 should be rejected (above max 100)");
		assert.strictEqual(v(2), null, "2 should be valid (min)");
		assert.strictEqual(v(50), null, "50 should be valid");
		assert.strictEqual(v(100), null, "100 should be valid (max)");
	});

	it("log functions return strings", function () {
		for (const [key, cmd] of Object.entries(COMMANDS)) {
			const result = cmd.log(42);
			assert.strictEqual(typeof result, "string", `${key}.log() should return string`);
			assert.ok(result.length > 0, `${key}.log() should return non-empty string`);
		}
	});
});

// ============================================================
// commandHandler – executeCommand
// ============================================================
describe("commandHandler – executeCommand", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	function createMockContext(handler) {
		const sent = [];
		const states = {};
		const resetButtons = [];
		return {
			ctx: {
				connection: {
					send: async buf => {
						sent.push(buf);
						return true;
					},
				},
				protobuf: handler,
				deviceId: "TEST123",
				log: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
				setState: async (id, val, ack) => {
					states[id] = { val, ack };
				},
				resetButton: id => {
					resetButtons.push(id);
				},
			},
			sent,
			states,
			resetButtons,
		};
	}

	it("sends power limit command", async function () {
		const { ctx, sent } = createMockContext(handler);
		await executeCommand("inverter.powerLimit", { val: 50, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 1);
		assert.ok(Buffer.isBuffer(sent[0]));
	});

	it("rejects invalid power limit", async function () {
		const { ctx, sent } = createMockContext(handler);
		await executeCommand("inverter.powerLimit", { val: 150, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 0);
	});

	it("limitPowerMyPower encode produces buffer with limitPowerMypower 500 for value 50", async function () {
		const cmd = COMMANDS["config.limitPowerMyPower"];
		const buf = cmd.encode(50, 1700000000, handler, {});
		assert.ok(Buffer.isBuffer(buf), "encode must return a Buffer");
		assert.ok(buf.length > 0, "buffer must not be empty");
		// Decode the protobuf payload to verify the scaled value
		const parsed = handler.parseResponse(buf);
		assert.ok(parsed, "buffer must be a parseable protobuf message");
		const ResDTO = handler.protos.SetConfig.lookupType("SetConfigResDTO");
		const obj = ResDTO.toObject(ResDTO.decode(parsed.payload), { longs: Number, defaults: true });
		assert.strictEqual(obj.limitPowerMypower, 500, "50% * SCALE_POWER(10) must equal 500");
	});

	it("sends inverter on/off command", async function () {
		const { ctx, sent } = createMockContext(handler);
		await executeCommand("inverter.active", { val: true, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 1);
		await executeCommand("inverter.active", { val: false, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 2);
	});

	it("sends reboot and resets button", async function () {
		const { ctx, sent, resetButtons } = createMockContext(handler);
		await executeCommand("inverter.reboot", { val: true, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 1);
		assert.strictEqual(resetButtons.length, 1);
		assert.strictEqual(resetButtons[0], "inverter.reboot");
	});

	it("ignores button command with false value", async function () {
		const { ctx, sent } = createMockContext(handler);
		await executeCommand("inverter.reboot", { val: false, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 0);
	});

	it("ignores unknown state ID", async function () {
		const { ctx, sent } = createMockContext(handler);
		await executeCommand("unknown.state", { val: 42, ack: false, ts: 0, lc: 0, from: "", q: 0 }, ctx);
		assert.strictEqual(sent.length, 0);
	});
});

// ============================================================
// commandHandler — cloud command fallback
// ============================================================
describe("commandHandler – executeCloudCommand", function () {
	/** Build a cloud command context that records sent actions and reset buttons. */
	function createCloudCtx() {
		const sent = [];
		const calls = [];
		const acks = [];
		const resets = [];
		const ctx = {
			deviceId: "DTU1",
			log: { info: () => {}, warn: () => {} },
			send: async (action, devType) => {
				sent.push(action);
				calls.push({ action, devType });
			},
			setState: async (id, val, ack) => {
				acks.push({ id, val, ack });
			},
			resetButton: id => resets.push(id),
		};
		return { ctx, sent, calls, acks, resets };
	}

	const st = val => ({ val, ack: false, ts: 0, lc: 0, from: "", q: 0 });

	it("maps inverter.reboot to action 3 (micro dev_type) and resets the button", async function () {
		const { ctx, calls, resets } = createCloudCtx();
		const handled = await executeCloudCommand("inverter.reboot", st(true), ctx);
		assert.strictEqual(handled, true);
		assert.deepStrictEqual(calls, [{ action: 3, devType: 3 }]);
		assert.deepStrictEqual(resets, ["inverter.reboot"]);
	});

	it("maps dtu.reboot to action 1 with the DTU dev_type and resets the button", async function () {
		const { ctx, calls, resets } = createCloudCtx();
		const handled = await executeCloudCommand("dtu.reboot", st(true), ctx);
		assert.strictEqual(handled, true);
		assert.deepStrictEqual(calls, [{ action: 1, devType: 1 }]);
		assert.deepStrictEqual(resets, ["dtu.reboot"]);
	});

	it("maps inverter.active on/off to action 6/7 and acks", async function () {
		const on = createCloudCtx();
		await executeCloudCommand("inverter.active", st(true), on.ctx);
		assert.deepStrictEqual(on.sent, [6]);
		assert.deepStrictEqual(on.acks, [{ id: "inverter.active", val: true, ack: true }]);

		const off = createCloudCtx();
		await executeCloudCommand("inverter.active", st(false), off.ctx);
		assert.deepStrictEqual(off.sent, [7]);
	});

	it("does not fire a button command on a falsy value but reports it handled", async function () {
		const { ctx, sent } = createCloudCtx();
		const handled = await executeCloudCommand("inverter.reboot", st(false), ctx);
		assert.strictEqual(handled, true);
		assert.strictEqual(sent.length, 0);
	});

	it("returns false for a local-only command (not cloud-capable)", async function () {
		const { ctx, sent } = createCloudCtx();
		const handled = await executeCloudCommand("inverter.powerLimit", st(50), ctx);
		assert.strictEqual(handled, false);
		assert.strictEqual(sent.length, 0);
	});

	it("does not throw when the cloud send fails", async function () {
		const { resets } = createCloudCtx();
		const ctx = {
			deviceId: "DTU1",
			log: { info: () => {}, warn: () => {} },
			send: async () => {
				throw new Error("cloud offline");
			},
			setState: async () => {},
			resetButton: id => resets.push(id),
		};
		const handled = await executeCloudCommand("inverter.reboot", st(true), ctx);
		assert.strictEqual(handled, true);
		assert.deepStrictEqual(resets, ["inverter.reboot"]); // button still reset in finally
	});
});

// ============================================================
// commandHandler — flash protection for power-limit writes
// ============================================================
// Every accepted power-limit command erases and writes two 4 KB flash sectors on both devices
// (2T: action 8 success path → 0x4080d642 → erase+write regions 3 and 0xe; 2WB: sys_cfg_write
// runs nv_erase+nv_write twice). A control loop that writes every few seconds would wear the
// flash out, so a dead band and a minimum interval gate those writes.
describe("commandHandler – flash guard", function () {
	let handler;

	before(async function () {
		this.timeout(10000);
		handler = new ProtobufHandler();
		await handler.loadProtos();
	});

	it("skips a power-limit write inside the dead band", function () {
		const guard = { deadband: 1, minIntervalMs: 0 };
		const last = { lastValue: 50, lastWriteMs: 0, skipsLogged: 0 };
		assert.ok(shouldSkipFlashWrite(50.5, last, guard, 100000), "0.5 % change must be skipped");
		assert.strictEqual(shouldSkipFlashWrite(52, last, guard, 100000), null, "2 % change must pass");
	});

	it("skips a power-limit write inside the minimum interval", function () {
		const guard = { deadband: 0, minIntervalMs: 60000 };
		const last = { lastValue: 50, lastWriteMs: 100000, skipsLogged: 0 };
		assert.ok(shouldSkipFlashWrite(80, last, guard, 130000), "30 s after the last write: skip");
		assert.strictEqual(shouldSkipFlashWrite(80, last, guard, 161000), null, "61 s later: pass");
	});

	it("always lets the first write through", function () {
		const guard = { deadband: 5, minIntervalMs: 60000 };
		const last = { lastValue: null, lastWriteMs: 0, skipsLogged: 0 };
		assert.strictEqual(shouldSkipFlashWrite(50, last, guard, 1000), null, "no previous value: must pass");
	});

	it("is disabled when both limits are zero", function () {
		const guard = { deadband: 0, minIntervalMs: 0 };
		const last = { lastValue: 50, lastWriteMs: 100000, skipsLogged: 0 };
		assert.strictEqual(shouldSkipFlashWrite(50, last, guard, 100001), null, "no guard configured: never skip");
	});

	it("marks exactly the three commands the DTU persists to flash", function () {
		// actions 8, 47 (0x2f) and 48 (0x30) share one success path, which calls the config
		// serializer 0x4080d642 and rewrites two 4 KB sectors — ADAPTER_FINDINGS.md §1.
		// SetConfig fields are NOT among them: they land in RAM only (§15).
		const flashing = Object.entries(COMMANDS)
			.filter(([, def]) => def.writesFlash)
			.map(([id]) => id)
			.sort();
		assert.deepStrictEqual(flashing, [
			"inverter.powerFactorLimit",
			"inverter.powerLimit",
			"inverter.reactivePowerLimit",
		]);
	});

	it("gives every flash-writing command the span its dead band is scaled against", function () {
		// Without a span the percent dead band would be read in the command's own unit and, for
		// the power factor (whole range 2.0), swallow every change the user could make.
		for (const [id, def] of Object.entries(COMMANDS).filter(([, d]) => d.writesFlash)) {
			assert.ok(typeof def.valueSpan === "number" && def.valueSpan > 0, `"${id}" has no valueSpan`);
		}
	});

	it("scales the dead band to the command's range", function () {
		const guard = { deadband: 1, minIntervalMs: 0 };
		const last = { lastValue: 0.9, lastWriteMs: 0, skipsLogged: 0 };
		// 1 % of the power factor's 2.0 range is 0.02, so a step of 0.1 must pass...
		assert.strictEqual(shouldSkipFlashWrite(1.0, last, guard, Date.now(), 2), null);
		// ...while a step of 0.01 stays below it.
		assert.ok(shouldSkipFlashWrite(0.91, last, guard, Date.now(), 2));
		// On a 0-100 range the dead band keeps meaning plain percentage points.
		assert.ok(shouldSkipFlashWrite(50.5, { ...last, lastValue: 50 }, guard, Date.now(), 100));
		assert.strictEqual(shouldSkipFlashWrite(52, { ...last, lastValue: 50 }, guard, Date.now(), 100), null);
	});

	it("does not send a throttled command but still acknowledges the state", async function () {
		const sent = [];
		const acks = [];
		const infos = [];
		const ctx = flashCtx(sent, acks, infos, { deadband: 5, minIntervalMs: 0 });
		await executeCommand("inverter.powerLimit", { val: 50, ack: false }, ctx);
		await executeCommand("inverter.powerLimit", { val: 52, ack: false }, ctx);
		assert.strictEqual(sent.length, 1, "the second write is inside the dead band and must not be sent");
		assert.strictEqual(acks.length, 2, "both values are acknowledged — the wish was refused, not lost");
		assert.ok(
			infos.some(m => /flash/i.test(m)),
			"the skipped write must say why",
		);
	});

	it("does not throttle a command that writes no flash", async function () {
		const sent = [];
		const ctx = flashCtx(sent, [], [], { deadband: 100, minIntervalMs: 999999 });
		await executeCommand("inverter.reboot", { val: true, ack: false }, ctx);
		await executeCommand("inverter.reboot", { val: true, ack: false }, ctx);
		assert.strictEqual(sent.length, 2, "reboot does not touch flash and must never be throttled");
	});

	function flashCtx(sent, acks, infos, flashGuard) {
		const flashState = new Map();
		return {
			connection: {
				connected: true,
				send: async buf => {
					sent.push(buf);
				},
			},
			protobuf: handler,
			deviceId: "DTU1",
			host: "192.168.1.1",
			log: {
				info: m => infos.push(m),
				warn: m => infos.push(m),
				debug: () => {},
			},
			setState: async (id, val, ack) => {
				acks.push({ id, val, ack });
			},
			resetButton: () => {},
			flashGuard,
			flashWriteState: id => {
				if (!flashState.has(id)) {
					flashState.set(id, { lastValue: null, lastWriteMs: 0, skipsLogged: 0 });
				}
				return flashState.get(id);
			},
		};
	}
});

// ============================================================
// commandHandler — flash guard, edge cases found in review
// ============================================================
describe("commandHandler – flash guard edge cases", function () {
	// A limit of 0 is not a legal power limit, but the guard must still tell "0 was written"
	// apart from "nothing was written yet" — a truthiness check would conflate them and let
	// every write through after a 0.
	it("treats a remembered 0 as a real value, not as 'nothing written yet'", function () {
		const guard = { deadband: 5, minIntervalMs: 0 };
		const last = { lastValue: 0, lastWriteMs: 1000, skipsLogged: 0 };
		assert.ok(shouldSkipFlashWrite(2, last, guard, 5000), "2 is inside the dead band around 0");
		assert.strictEqual(shouldSkipFlashWrite(50, last, guard, 5000), null, "50 is outside it");
	});

	// A cloud-forwarded command is booked with its time but without its value, because the
	// cloud's payload is passed through verbatim. The interval must still apply.
	it("applies the minimum interval even when the last value is unknown", function () {
		const guard = { deadband: 1, minIntervalMs: 60000 };
		const last = { lastValue: null, lastWriteMs: 100000, skipsLogged: 0 };
		assert.ok(shouldSkipFlashWrite(50, last, guard, 130000), "30 s after an unvalued write: skip");
		assert.strictEqual(shouldSkipFlashWrite(50, last, guard, 161000), null, "61 s later: pass");
	});

	it("still lets a genuinely first write through", function () {
		const guard = { deadband: 5, minIntervalMs: 60000 };
		const last = { lastValue: null, lastWriteMs: 0, skipsLogged: 0 };
		assert.strictEqual(shouldSkipFlashWrite(50, last, guard, 1000), null, "nothing written yet: pass");
	});

	it("maps only the power-limit action to a flash-writing state", function () {
		assert.strictEqual(flashWritingStateForAction(8), "inverter.powerLimit");
		assert.strictEqual(flashWritingStateForAction(3), null, "inverter reboot writes no config");
		assert.strictEqual(flashWritingStateForAction(41), null, "grid-profile read writes nothing");
	});
});
