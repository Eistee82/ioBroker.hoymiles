import { POWER_LIMIT_MIN, POWER_LIMIT_MAX, POWER_LIMIT_WATT_MAX, POWER_LIMIT_WATT_MIN, DEVICE_COMMAND_REBOOT, DEVICE_COMMAND_POWER_ON, DEVICE_COMMAND_POWER_OFF, DTU_COMMAND_REBOOT, DTU_COMMAND_REBOOT_STORAGE, CLOUD_DEV_TYPE_DTU, CLOUD_DEV_TYPE_MICRO, CLOUD_DEV_TYPE_STORAGE_INVERTER, } from "./constants.js";
import { unixSeconds } from "./utils.js";
export const CELL_A_STATES = [
    "inverter.powerLimit",
    "inverter.powerFactorLimit",
    "inverter.reactivePowerLimit",
];
function flashGroup(stateId) {
    return CELL_A_STATES.includes(stateId) ? CELL_A_STATES : [stateId];
}
const bookings = new WeakMap();
let bookingSeq = 0;
export function bookFlashWrite(stateId, value, nowMs, lookup) {
    const seq = ++bookingSeq;
    const before = flashGroup(stateId).map(id => ({ entry: lookup(id), saved: { ...lookup(id) } }));
    for (const { entry: member } of before) {
        member.lastValue = null;
        bookings.set(member, seq);
    }
    const entry = lookup(stateId);
    entry.lastValue = value;
    entry.lastWriteMs = nowMs;
    entry.skipsLogged = 0;
    return () => {
        if (before.some(({ entry: member }) => bookings.get(member) !== seq)) {
            return;
        }
        for (const { entry: member, saved } of before) {
            Object.assign(member, saved);
        }
    };
}
export function groupLastWriteMs(stateId, lookup) {
    return Math.max(...flashGroup(stateId).map(id => lookup(id).lastWriteMs));
}
export function shouldSkipFlashWrite(value, last, guard, nowMs, valueSpan = 100) {
    if (last.lastValue !== null && guard.deadband > 0) {
        const change = Math.abs(value - last.lastValue);
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
export function flashWritingStateForAction(action) {
    switch (action) {
        case 8:
            return "inverter.powerLimit";
        case 47:
            return "inverter.powerFactorLimit";
        case 48:
            return "inverter.reactivePowerLimit";
        default:
            return null;
    }
}
const COMMANDS = {
    "inverter.powerLimit": {
        validate: v => !(v >= POWER_LIMIT_MIN && v <= POWER_LIMIT_MAX)
            ? `Power limit must be between ${POWER_LIMIT_MIN} and ${POWER_LIMIT_MAX}`
            : null,
        encode: (v, ts, pb) => pb.encodeSetPowerLimit(Number(v), ts),
        log: v => `Setting power limit to ${v}%`,
        writesFlash: true,
        valueSpan: 100,
        readback: "percent",
        cellA: v => Math.round(v * 10),
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
        writesFlash: true,
        valueSpan: 2,
        cellA: v => Math.round(v * 1000),
    },
    "inverter.reactivePowerLimit": {
        validate: v => (!(v >= -50 && v <= 50) ? "Reactive power setpoint must be -50…+50 %" : null),
        encode: (v, ts, pb) => pb.encodeReactivePowerLimit(Number(v), ts),
        log: v => `Setting reactive power setpoint to ${v} %`,
        writesFlash: true,
        valueSpan: 100,
        cellA: v => Math.round(v * 10),
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
    "inverter.powerLimitWatt": {
        validate: v => !(v >= POWER_LIMIT_WATT_MIN) || v > POWER_LIMIT_WATT_MAX
            ? `Power limit must be between ${POWER_LIMIT_WATT_MIN} and ${POWER_LIMIT_WATT_MAX} W`
            : null,
        encode: (v, ts, pb) => pb.encodeSetPowerLimitWatt(Number(v), ts),
        log: v => `Setting runtime power limit to ${v} W`,
        readback: "watt",
    },
};
const notSentWarned = new Set();
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
    let undoBooking = null;
    if (cmd.writesFlash && ctx.flashGuard && ctx.flashWriteState) {
        const lookup = ctx.flashWriteState;
        const last = lookup(stateId);
        const nowMs = Date.now();
        const skip = shouldSkipFlashWrite(Number(state.val), { ...last, lastWriteMs: groupLastWriteMs(stateId, lookup) }, ctx.flashGuard, nowMs, cmd.valueSpan);
        if (skip) {
            const message = `[${deviceId}] Skipping "${stateId}" to protect the DTU flash — ${skip}`;
            if (last.skipsLogged === 0) {
                log.info(message);
            }
            else {
                log.debug(message);
            }
            last.skipsLogged++;
            if (last.lastValue !== null) {
                await ctx.setState(stateId, last.lastValue, true);
            }
            return;
        }
        undoBooking = bookFlashWrite(stateId, Number(state.val), nowMs, lookup);
    }
    log.info(`[${deviceId}] ${cmd.log(state.val)}`);
    const timestamp = ctx.now ? ctx.now() : unixSeconds();
    let frame;
    try {
        frame = cmd.encode(state.val, timestamp, protobuf, ctx.configSnapshot ?? null);
    }
    catch (err) {
        log.warn(`[${deviceId}] Cannot execute "${stateId}": ${err instanceof Error ? err.message : String(err)}`);
        undoBooking?.();
        if (cmd.button) {
            ctx.resetButton(stateId);
        }
        return;
    }
    if ((await connection.send(frame)) === false) {
        undoBooking?.();
        const message = `[${deviceId}] "${stateId}" was not sent — the connection is down`;
        if (notSentWarned.has(deviceId)) {
            log.debug(message);
        }
        else {
            notSentWarned.add(deviceId);
            log.warn(message);
        }
        if (cmd.button) {
            ctx.resetButton(stateId);
        }
        return;
    }
    notSentWarned.delete(deviceId);
    if (cmd.cellA && ctx.onCellAWritten) {
        ctx.onCellAWritten(cmd.cellA(Number(state.val)));
    }
    if (!cmd.button) {
        if (cmd.readback && ctx.expectReadback) {
            ctx.expectReadback(cmd.readback);
        }
        else {
            await ctx.setState(stateId, state.val, true);
        }
    }
    if (cmd.button) {
        ctx.resetButton(stateId);
    }
}
const CLOUD_COMMANDS = {
    "inverter.reboot": { action: () => DEVICE_COMMAND_REBOOT, button: true },
    "inverter.active": { action: v => (v ? DEVICE_COMMAND_POWER_ON : DEVICE_COMMAND_POWER_OFF) },
    "dtu.reboot": {
        action: (_v, storage) => (storage ? DTU_COMMAND_REBOOT_STORAGE : DTU_COMMAND_REBOOT),
        button: true,
        devType: CLOUD_DEV_TYPE_DTU,
    },
};
async function executeCloudCommand(stateId, state, ctx) {
    const cmd = CLOUD_COMMANDS[stateId];
    if (!cmd) {
        return false;
    }
    if (cmd.button && !state.val) {
        return true;
    }
    const storage = !!ctx.storageSystem;
    const action = cmd.action(state.val, storage);
    const devType = cmd.devType ?? (storage ? CLOUD_DEV_TYPE_STORAGE_INVERTER : CLOUD_DEV_TYPE_MICRO);
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