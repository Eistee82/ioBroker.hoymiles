import { POWER_LIMIT_MIN, POWER_LIMIT_MAX, SCALE_POWER, DEVICE_COMMAND_REBOOT, DEVICE_COMMAND_POWER_ON, DEVICE_COMMAND_POWER_OFF, DTU_COMMAND_REBOOT, CLOUD_DEV_TYPE_DTU, CLOUD_DEV_TYPE_MICRO, } from "./constants.js";
import { unixSeconds } from "./utils.js";
const COMMANDS = {
    "inverter.powerLimit": {
        validate: v => v < POWER_LIMIT_MIN || v > POWER_LIMIT_MAX
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
        validate: v => !((v >= -1 && v <= -0.8) || (v >= 0.8 && v <= 1)) ? "Power factor must be -1.0…-0.8 or 0.8…1.0" : null,
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
    "config.serverSendTime": {
        validate: v => (!v || v < 1 ? "Server send time must be a positive number (minutes)" : null),
        encode: (v, ts, pb) => pb.encodeSetConfig(ts, { serverSendTime: Number(v) }),
        log: v => `Setting cloud send interval to ${v}min`,
    },
    "config.limitPowerMyPower": {
        validate: v => v < POWER_LIMIT_MIN || v > POWER_LIMIT_MAX
            ? `Power limit must be between ${POWER_LIMIT_MIN} and ${POWER_LIMIT_MAX}`
            : null,
        encode: (v, ts, pb) => pb.encodeSetConfig(ts, { limitPowerMypower: Math.round(Number(v) * SCALE_POWER) }),
        log: v => `Setting persistent power limit to ${v}% (stored in DTU)`,
    },
};
async function executeCommand(stateId, state, ctx) {
    const cmd = COMMANDS[stateId];
    if (!cmd) {
        return;
    }
    const { connection, protobuf, deviceId, host, log } = ctx;
    if (cmd.button && !state.val) {
        return;
    }
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
    if (!cmd.button) {
        await ctx.setState(stateId, state.val, true);
    }
    if (cmd.button) {
        ctx.resetButton(stateId);
    }
}
const CLOUD_COMMANDS = {
    "inverter.reboot": { action: () => DEVICE_COMMAND_REBOOT, button: true },
    "inverter.active": { action: v => (v ? DEVICE_COMMAND_POWER_ON : DEVICE_COMMAND_POWER_OFF) },
    "dtu.reboot": { action: () => DTU_COMMAND_REBOOT, button: true, devType: CLOUD_DEV_TYPE_DTU },
};
async function executeCloudCommand(stateId, state, ctx) {
    const cmd = CLOUD_COMMANDS[stateId];
    if (!cmd) {
        return false;
    }
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
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.warn(`[${ctx.deviceId}] Cloud command "${stateId}" failed: ${msg}`);
    }
    finally {
        if (cmd.button) {
            ctx.resetButton(stateId);
        }
    }
    return true;
}
export { executeCommand, executeCloudCommand, COMMANDS, CLOUD_COMMANDS };
//# sourceMappingURL=commandHandler.js.map