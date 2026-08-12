import { Discovery } from "@2colors/esphome-native-api";
import { ESPHOME_API_PORT, BLE_SERVICE_UUID } from "./constants.js";
import { NATIVE_TIMERS } from "./tcpConnection.js";
const HOYMILES_SERVICE_HINT = BLE_SERVICE_UUID.slice(4, 8);
const HOYMILES_NAME_PREFIXES = ["AUS", "MSA", "MSH", "MI", "RMI", "RMSA"];
export function bleNameToSn(name) {
    const n = (name ?? "").trim();
    return (n.length <= 12 ? n : n.slice(-12)).toUpperCase();
}
export function isHoymilesAdvertisement(adv) {
    if ((adv.serviceUuidsList ?? []).some(u => u.toLowerCase().includes(HOYMILES_SERVICE_HINT))) {
        return true;
    }
    const name = (adv.name ?? "").trim();
    return HOYMILES_NAME_PREFIXES.some(p => name.startsWith(p));
}
function sleep(ms, timers, signal) {
    return new Promise(resolve => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        let handle = undefined;
        const done = () => {
            signal?.removeEventListener("abort", done);
            timers.clearTimeout(handle);
            resolve();
        };
        handle = timers.setTimeout(done, ms);
        signal?.addEventListener("abort", done, { once: true });
    });
}
export async function discoverGateways(timeoutMs = 5000, timers = NATIVE_TIMERS, signal) {
    const found = new Map();
    const disc = new Discovery({});
    disc.on("info", (info) => {
        const host = info.address || info.host || info.address6;
        if (host) {
            const name = info.name || (info.host && info.host !== host ? info.host : "");
            found.set(host, { host, port: info.port || ESPHOME_API_PORT, name });
        }
    });
    try {
        disc.run();
        await sleep(timeoutMs, timers, signal);
    }
    finally {
        try {
            disc.destroy();
        }
        catch {
        }
    }
    return [...found.values()];
}
//# sourceMappingURL=bleDiscovery.js.map