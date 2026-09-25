import { Discovery } from "@2colors/esphome-native-api";
import { ESPHOME_API_PORT, BLE_SERVICE_UUID } from "./constants.js";
import { NATIVE_DELAY } from "./tcpConnection.js";
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
export async function discoverGateways(timeoutMs = 5000, waiter = NATIVE_DELAY, signal, createDiscovery = () => new Discovery({})) {
    const found = new Map();
    if (signal?.aborted) {
        return [];
    }
    const disc = createDiscovery();
    let closed = false;
    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        try {
            disc.destroy();
        }
        catch {
        }
    };
    disc.on("info", info => {
        const host = info.address || info.host || info.address6;
        if (host) {
            const name = info.name || (info.host && info.host !== host ? info.host : "");
            found.set(host, { host, port: info.port || ESPHOME_API_PORT, name });
        }
    });
    signal?.addEventListener("abort", close, { once: true });
    try {
        disc.run();
        await waiter.delay(timeoutMs);
    }
    finally {
        signal?.removeEventListener("abort", close);
        close();
    }
    return [...found.values()];
}
//# sourceMappingURL=bleDiscovery.js.map