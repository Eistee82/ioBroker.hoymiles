import type { ProtobufHandler } from "./protobufHandler.js";
import type DtuConnection from "./dtuConnection.js";
import { POWER_LIMIT_MIN, POWER_LIMIT_MAX, SCALE_POWER } from "./constants.js";
import { unixSeconds } from "./utils.js";

interface CommandContext {
	connection: DtuConnection;
	protobuf: ProtobufHandler;
	deviceId: string;
	host: string;
	log: ioBroker.Logger;
	setState: (id: string, value: ioBroker.StateValue, ack: boolean) => Promise<void>;
	resetButton: (stateId: string) => void;
}

interface CommandDefinition {
	validate?: (val: number) => string | null;
	encode: (val: ioBroker.StateValue, ts: number, protobuf: ProtobufHandler) => Buffer;
	log: (val: ioBroker.StateValue) => string;
	button?: boolean;
}

const COMMANDS: Record<string, CommandDefinition> = {
	"inverter.powerLimit": {
		validate: v =>
			v < POWER_LIMIT_MIN || v > POWER_LIMIT_MAX
				? `Power limit must be between ${POWER_LIMIT_MIN} and ${POWER_LIMIT_MAX}`
				: null,
		encode: (v, ts, pb) => pb.encodeSetPowerLimit(Number(v), ts),
		log: v => `Setting power limit to ${v}%`,
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
	},
	"inverter.reactivePowerLimit": {
		validate: v => (v < -50 || v > 50 ? "Reactive power limit must be -50…+50°" : null),
		encode: (v, ts, pb) => pb.encodeReactivePowerLimit(Number(v), ts),
		log: v => `Setting reactive power limit to ${v}°`,
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
	"config.zeroExportEnable": {
		encode: (v, ts, pb) => pb.encodeSetConfig(ts, { zeroExportEnable: v ? 1 : 0 }),
		log: v => `Setting zero export: ${v ? "enabled" : "disabled"}`,
	},
	"config.serverSendTime": {
		validate: v => (!v || v < 1 ? "Server send time must be a positive number (minutes)" : null),
		encode: (v, ts, pb) => pb.encodeSetConfig(ts, { serverSendTime: Number(v) }),
		log: v => `Setting cloud send interval to ${v}min`,
	},
	// Persistent power limit (SetConfig limit_power_mypower → DTU flash). Survives a power
	// cycle. Uses the same 0.1%-unit scaling as the runtime limit. For frequent/dynamic
	// limiting (zero-export) use inverter.powerLimit instead (runtime, no flash write).
	"config.limitPowerMyPower": {
		validate: v =>
			v < POWER_LIMIT_MIN || v > POWER_LIMIT_MAX
				? `Power limit must be between ${POWER_LIMIT_MIN} and ${POWER_LIMIT_MAX}`
				: null,
		encode: (v, ts, pb) => pb.encodeSetConfig(ts, { limitPowerMypower: Math.round(Number(v) * SCALE_POWER) }),
		log: v => `Setting persistent power limit to ${v}% (stored in DTU)`,
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

	log.info(`[${deviceId}] ${cmd.log(state.val)}`);
	const timestamp = unixSeconds();
	await connection.send(cmd.encode(state.val, timestamp, protobuf));

	// Acknowledge non-button commands after successful send
	if (!cmd.button) {
		await ctx.setState(stateId, state.val, true);
	}

	// Reset button states after 1s
	if (cmd.button) {
		ctx.resetButton(stateId);
	}
}

export { executeCommand, COMMANDS };
export type { CommandContext };
