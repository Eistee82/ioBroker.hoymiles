import type { ProtobufHandler } from "./protobufHandler.js";

/** Minimal outbound-frame surface — satisfied by both DtuConnection and BleConnection. */
interface CommandTransport {
	send(buffer: Buffer): Promise<boolean>;
}
import {
	POWER_LIMIT_MIN,
	POWER_LIMIT_MAX,
	SCALE_POWER,
	DEVICE_COMMAND_REBOOT,
	DEVICE_COMMAND_POWER_ON,
	DEVICE_COMMAND_POWER_OFF,
	DTU_COMMAND_REBOOT,
	CLOUD_DEV_TYPE_DTU,
	CLOUD_DEV_TYPE_MICRO,
} from "./constants.js";
import { unixSeconds } from "./utils.js";

/** What was last written for one flash-writing state, so the next write can be judged against it. */
export interface FlashWriteState {
	/** Last value actually written, or null when it is unknown (nothing written, or a cloud write). */
	lastValue: number | null;
	/** When that write happened, in milliseconds since the epoch; 0 when nothing was written yet. */
	lastWriteMs: number;
	/** Consecutive skips, so a control loop does not log an info line on every cycle. */
	skipsLogged: number;
}

/** User-tunable flash protection. `deadband` in percent, `minIntervalMs` in milliseconds. */
export interface FlashGuardOptions {
	/** Smallest change worth a flash write, in percent. 0 disables the dead band. */
	deadband: number;
	/** Shortest gap between two writes, in milliseconds. 0 disables the throttle. */
	minIntervalMs: number;
}

interface CommandContext {
	connection: CommandTransport;
	protobuf: ProtobufHandler;
	deviceId: string;
	host: string;
	log: ioBroker.Logger;
	setState: (id: string, value: ioBroker.StateValue, ack: boolean) => Promise<void>;
	resetButton: (stateId: string) => void;
	/** Omitted when the device layer has no guard configured — then nothing is throttled. */
	flashGuard?: FlashGuardOptions;
	/** Per-state memory of the last flash write. Required whenever `flashGuard` is set. */
	flashWriteState?: (stateId: string) => FlashWriteState;
	/**
	 * The device's last GetConfig response, raw. Required by every command that writes the
	 * configuration — without it a write would clear every field it does not carry.
	 */
	configSnapshot?: Record<string, unknown> | null;
}

interface CommandDefinition {
	validate?: (val: number) => string | null;
	/**
	 * @param val - The requested state value.
	 * @param ts - Unix timestamp in seconds.
	 * @param protobuf - Shared protobuf handler.
	 * @param base - Last raw GetConfig response, required by the config-writing commands.
	 */
	encode: (
		val: ioBroker.StateValue,
		ts: number,
		protobuf: ProtobufHandler,
		base: Record<string, unknown> | null,
	) => Buffer;
	log: (val: ioBroker.StateValue) => string;
	button?: boolean;
	/**
	 * Set for commands the DTU persists to flash. Every accepted write erases and rewrites two
	 * 4 KB sectors — on the 2T the success path of action 8 calls the config serializer
	 * `0x4080d642`, which runs erase (`0x40817a92`) + write (`0x40817bf6`) for region 3 and again
	 * for region 0xe; on the 2WB `sys_cfg_write` does the same twice. Such commands are subject to
	 * the dead band and the minimum interval.
	 *
	 * This is not limited to the power limit: the same success path serves actions `0x2f` and
	 * `0x30`, so the power factor and the reactive power cost the same two sectors
	 * (_fwanalysis/ADAPTER_FINDINGS.md §1).
	 */
	writesFlash?: boolean;
	/**
	 * Full span of this command's value range, used to translate the configured dead band — which
	 * the user sets in percent of the range — into the command's own unit. Without it a dead band
	 * of "1 %" would be read as 1.0 and swallow every power-factor change, whose whole range is
	 * only 2.0 wide. Required whenever `writesFlash` is set.
	 */
	valueSpan?: number;
}

/**
 * Decide whether a flash-writing command may be skipped.
 *
 * The point is not to be clever about the value but to keep a control loop — a zero-export
 * regulation, say — from erasing flash sectors every few seconds. Two independent limits, either
 * of which can be switched off with 0: a change smaller than the dead band is not worth a write,
 * and two writes closer together than the minimum interval are throttled regardless of size.
 *
 * The first write after a restart always passes: without a previous value there is nothing to
 * compare against, and refusing it would leave the device on a stale limit.
 *
 * @param value - The requested value.
 * @param last - What was last written for this state.
 * @param guard - The configured dead band and minimum interval.
 * @param nowMs - Current time in milliseconds.
 * @param valueSpan - Full span of the command's range; the dead band is that percentage of it.
 *   Defaults to 100, which makes the dead band a plain percentage point (the power limit's case).
 * @returns A reason string when the write is skipped, otherwise null.
 */
export function shouldSkipFlashWrite(
	value: number,
	last: FlashWriteState,
	guard: FlashGuardOptions,
	nowMs: number,
	valueSpan = 100,
): string | null {
	// The two limits are checked independently because they can be known independently: a write
	// that came in over the cloud relay is recorded with its time but not always with its value
	// (the cloud's payload is forwarded verbatim and is not always parseable). Time alone is
	// still worth throttling on.
	if (last.lastValue !== null && guard.deadband > 0) {
		const change = Math.abs(value - last.lastValue);
		// The user configures the dead band in percent; a command whose range is not 0-100 needs
		// it scaled, or the threshold would dwarf its entire range.
		const threshold = (guard.deadband * valueSpan) / 100;
		if (change < threshold) {
			return `the change of ${change.toFixed(2)} is below the ${guard.deadband}% dead band (${threshold.toFixed(2)})`;
		}
	}
	if (last.lastWriteMs > 0 && guard.minIntervalMs > 0) {
		const sinceMs = nowMs - last.lastWriteMs;
		if (sinceMs < guard.minIntervalMs) {
			return `only ${Math.round(sinceMs / 1000)}s since the last write (minimum ${Math.round(guard.minIntervalMs / 1000)}s)`;
		}
	}
	return null;
}

/**
 * The state id a flash-writing cloud action shares its wear accounting with.
 *
 * The cloud can send the same power-limit command the local path sends. Both end up in the same
 * two flash sectors, so they must share one memory — otherwise a local write is judged against a
 * value the device no longer has, which can suppress a write that was needed or let through one
 * that should have waited.
 *
 * @param action - Action code from the cloud's `CommandResDTO`.
 * @returns The state id to account the write under, or null when the action writes no flash.
 */
export function flashWritingStateForAction(action: number): string | null {
	// action 8 = LIMIT_POWER. Its success path runs the config serializer, same as the local
	// command — see the writesFlash note above.
	return action === 8 ? "inverter.powerLimit" : null;
}

const COMMANDS: Record<string, CommandDefinition> = {
	"inverter.powerLimit": {
		validate: v =>
			v < POWER_LIMIT_MIN || v > POWER_LIMIT_MAX
				? `Power limit must be between ${POWER_LIMIT_MIN} and ${POWER_LIMIT_MAX}`
				: null,
		encode: (v, ts, pb) => pb.encodeSetPowerLimit(Number(v), ts),
		log: v => `Setting power limit to ${v}%`,
		writesFlash: true,
		valueSpan: 100,
	},
	"inverter.active": {
		encode: (v, ts, pb) => (v ? pb.encodeInverterOn(ts) : pb.encodeInverterOff(ts)),
		log: v => (v ? "Turning inverter ON" : "Turning inverter OFF"),
	},
	"inverter.reboot": {
		encode: (_v, ts, pb) => pb.encodeInverterReboot(ts),
		log: () => "Rebooting inverter",
		button: true,
	},
	"dtu.reboot": {
		encode: (_v, ts, pb) => pb.encodeDtuReboot(ts),
		log: () => "Rebooting DTU",
		button: true,
	},
	"inverter.powerFactorLimit": {
		validate: v =>
			!((v >= -1 && v <= -0.8) || (v >= 0.8 && v <= 1)) ? "Power factor must be -1.0…-0.8 or 0.8…1.0" : null,
		encode: (v, ts, pb) => pb.encodePowerFactorLimit(Number(v), ts),
		log: v => `Setting power factor limit to ${v}`,
		// action 47 (0x2f) shares the success path of action 8 and therefore its two flash sectors.
		writesFlash: true,
		valueSpan: 2,
	},
	"inverter.reactivePowerLimit": {
		validate: v => (v < -50 || v > 50 ? "Reactive power limit must be -50…+50°" : null),
		encode: (v, ts, pb) => pb.encodeReactivePowerLimit(Number(v), ts),
		log: v => `Setting reactive power limit to ${v}°`,
		// action 48 (0x30), same success path and the same two flash sectors.
		writesFlash: true,
		valueSpan: 100,
	},
	"inverter.cleanWarnings": {
		encode: (_v, ts, pb) => pb.encodeCleanWarnings(ts),
		log: () => "Cleaning warnings",
		button: true,
	},
	"inverter.cleanGroundingFault": {
		encode: (_v, ts, pb) => pb.encodeCleanGroundingFault(ts),
		log: () => "Cleaning grounding fault",
		button: true,
	},
	"inverter.lock": {
		encode: (v, ts, pb) => (v ? pb.encodeLockInverter(ts) : pb.encodeUnlockInverter(ts)),
		log: v => (v ? "Locking inverter" : "Unlocking inverter"),
	},
	"config.serverSendTime": {
		validate: v => (!v || v < 1 ? "Server send time must be a positive number (minutes)" : null),
		encode: (v, ts, pb, base) => pb.encodeSetConfig(ts, { serverSendTime: Number(v) }, base),
		log: v => `Setting cloud send interval to ${v}min`,
	},
	// Power limit through the DTU's config field (SetConfig limit_power_mypower), same 0.1%-unit
	// scaling as the command above.
	//
	// This used to be documented as the "persistent" limit that survives a power cycle. That is
	// wrong on the HMS-800W-2T, where the value does not survive a restart (firmware-verified,
	// _fwanalysis/ADAPTER_FINDINGS.md §2) — the name says the opposite of what happens.
	//
	// No `writesFlash` either, and that is deliberate: SetConfig field 5 is written to `gp-108260`
	// (`0x6c204`), outside the persisted structure `0x6b8dc`, and the decoder's dirty flag — the
	// only thing that triggers the serializer — is set exclusively in the WiFi/AP password branch
	// (§15). The flash guard that used to sit here was throttling writes that cost no flash at
	// all. The persistent limit is `inverter.powerLimit`, which is guarded.
	"config.limitPowerMyPower": {
		validate: v =>
			v < POWER_LIMIT_MIN || v > POWER_LIMIT_MAX
				? `Power limit must be between ${POWER_LIMIT_MIN} and ${POWER_LIMIT_MAX}`
				: null,
		encode: (v, ts, pb, base) =>
			pb.encodeSetConfig(ts, { limitPowerMypower: Math.round(Number(v) * SCALE_POWER) }, base),
		log: v => `Setting power limit to ${v}% via the DTU config field`,
	},
};

/**
 * Execute a writable state command by sending the corresponding protobuf message to the DTU.
 *
 * @param stateId - State ID relative to device prefix (e.g. "inverter.powerLimit")
 * @param state - The new state value
 * @param ctx - Command context with connection, protobuf, logging
 */
async function executeCommand(stateId: string, state: ioBroker.State, ctx: CommandContext): Promise<void> {
	const cmd = COMMANDS[stateId];
	if (!cmd) {
		return;
	}

	const { connection, protobuf, deviceId, host, log } = ctx;

	// Button commands only trigger on truthy value
	if (cmd.button && !state.val) {
		return;
	}

	// Validate if validator exists
	if (cmd.validate) {
		const error = cmd.validate(Number(state.val));
		if (error) {
			log.warn(`[${deviceId}@${host}] ${error}, got ${state.val}`);
			return;
		}
	}

	// Flash protection: the DTU persists these two commands, and every accepted write costs two
	// 4 KB sectors. The state is still acknowledged when a write is skipped — the adapter refused
	// the wish deliberately, it did not lose it, and leaving the value unacknowledged would only
	// look like a broken command.
	if (cmd.writesFlash && ctx.flashGuard && ctx.flashWriteState) {
		const last = ctx.flashWriteState(stateId);
		const skip = shouldSkipFlashWrite(Number(state.val), last, ctx.flashGuard, Date.now(), cmd.valueSpan);
		if (skip) {
			// A control loop writes on every cycle, so only the first skip of a run is worth an
			// info line — the rest would be steady noise at a level the user cannot turn off.
			const message = `[${deviceId}] Skipping "${stateId}" to protect the DTU flash — ${skip}`;
			if (last.skipsLogged === 0) {
				log.info(message);
			} else {
				log.debug(message);
			}
			last.skipsLogged++;
			await ctx.setState(stateId, state.val, true);
			return;
		}
		last.skipsLogged = 0;
		last.lastValue = Number(state.val);
		last.lastWriteMs = Date.now();
	}

	log.info(`[${deviceId}] ${cmd.log(state.val)}`);
	const timestamp = unixSeconds();
	let frame: Buffer;
	try {
		frame = cmd.encode(state.val, timestamp, protobuf, ctx.configSnapshot ?? null);
	} catch (err) {
		// The config-writing commands refuse to build a partial message. Say so plainly instead of
		// letting the failure surface as an unexplained encode error.
		log.warn(`[${deviceId}] Cannot execute "${stateId}": ${err instanceof Error ? err.message : String(err)}`);
		return;
	}
	await connection.send(frame);

	// Acknowledge non-button commands after successful send
	if (!cmd.button) {
		await ctx.setState(stateId, state.val, true);
	}

	// Reset button states after 1s
	if (cmd.button) {
		ctx.resetButton(stateId);
	}
}

/** Context for sending a command over the cloud instead of the local TCP link. */
interface CloudCommandContext {
	deviceId: string;
	log: ioBroker.Logger;
	/** Send the given control action code to the device (of the given type) via the cloud. */
	send: (action: number, devType: number) => Promise<void>;
	setState: (id: string, value: ioBroker.StateValue, ack: boolean) => Promise<void>;
	resetButton: (stateId: string) => void;
}

/**
 * The subset of writable command states that can also be actuated over the cloud (for devices
 * with no local link, e.g. HMS-800-2WB). Maps a state to its cloud action code and device type;
 * on/off-style states resolve the code from the boolean value. Commands not listed here are
 * local-only. `devType` defaults to the micro-inverter; DTU-level commands (e.g. `dtu.reboot`)
 * carry the DTU type so the cloud addresses the DTU itself rather than the connected inverter.
 */
const CLOUD_COMMANDS: Record<
	string,
	{ action: (val: ioBroker.StateValue) => number; button?: boolean; devType?: number }
> = {
	"inverter.reboot": { action: () => DEVICE_COMMAND_REBOOT, button: true },
	"inverter.active": { action: v => (v ? DEVICE_COMMAND_POWER_ON : DEVICE_COMMAND_POWER_OFF) },
	"dtu.reboot": { action: () => DTU_COMMAND_REBOOT, button: true, devType: CLOUD_DEV_TYPE_DTU },
};

/**
 * Execute a writable state command over the cloud. Mirrors {@link executeCommand}'s button/ack
 * semantics but sends via the cloud control channel. Returns true if the state maps to a
 * cloud-capable command (whether or not it fired), false if the command is local-only.
 *
 * @param stateId - State ID relative to device prefix (e.g. "inverter.reboot")
 * @param state - The new state value
 * @param ctx - Cloud command context
 */
async function executeCloudCommand(stateId: string, state: ioBroker.State, ctx: CloudCommandContext): Promise<boolean> {
	const cmd = CLOUD_COMMANDS[stateId];
	if (!cmd) {
		return false;
	}
	// Button commands only trigger on a truthy value; the off-edge is a no-op but still "handled".
	if (cmd.button && !state.val) {
		return true;
	}
	const action = cmd.action(state.val);
	const devType = cmd.devType ?? CLOUD_DEV_TYPE_MICRO;
	ctx.log.info(`[${ctx.deviceId}] Sending command "${stateId}" via cloud (action ${action}, dev_type ${devType})`);
	try {
		await ctx.send(action, devType);
		if (!cmd.button) {
			await ctx.setState(stateId, state.val, true);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		ctx.log.warn(`[${ctx.deviceId}] Cloud command "${stateId}" failed: ${msg}`);
	} finally {
		if (cmd.button) {
			ctx.resetButton(stateId);
		}
	}
	return true;
}

export { executeCommand, executeCloudCommand, COMMANDS, CLOUD_COMMANDS };
export type { CommandContext, CloudCommandContext };
