import { Discovery } from "@2colors/esphome-native-api";
import { ESPHOME_API_PORT, BLE_SERVICE_UUID } from "./constants.js";
import { NATIVE_TIMERS, type TimerScheduler } from "./tcpConnection.js";

/** A discovered ESPHome Bluetooth-Proxy gateway. */
export interface GatewayInfo {
	/** Gateway IP/hostname. */
	host: string;
	/** Native API port. */
	port: number;
	/** mDNS instance name, if known. */
	name?: string;
}

const HOYMILES_SERVICE_HINT = BLE_SERVICE_UUID.slice(4, 8); // "e0ff"

/**
 * BLE-name prefixes the S-Miles app treats as compatible inverters (`BleSupportUtil.i()`, `J2` =
 * `startsWith`). The HMS-800-2WB advertises as `RMI-<serial>`. Verified against the decompiled app
 * (`temp_apk/balcony/.../com/balcony/helper/BleSupportUtil.java`) and live on the device.
 */
const HOYMILES_NAME_PREFIXES = ["AUS", "MSA", "MSH", "MI", "RMI", "RMSA"];

/**
 * Extract the serial number from a Hoymiles BLE advertised name — the app's `BleSupportUtil.e()`:
 * the **last 12 characters, upper-cased** (`RMI-4161A031AB61` → `4161A031AB61`). No character
 * stripping and no length heuristic; a name shorter than 12 is returned upper-cased as-is.
 *
 * @param name - BLE advertised name
 */
export function bleNameToSn(name: string): string {
	const n = (name ?? "").trim();
	return (n.length <= 12 ? n : n.slice(-12)).toUpperCase();
}

/**
 * Whether a BLE advertisement is a compatible Hoymiles inverter, using the app's exact rule: the
 * advertised name starts with one of {@link HOYMILES_NAME_PREFIXES}, or the device advertises the
 * Hoymiles GATT service. The previous shape heuristic (14–20 alphanumerics, 2–5 leading letters) was
 * too wide — it flagged unrelated devices such as a "Hue ambiance lamp" and minted a bogus serial
 * for them.
 *
 * @param adv - advertisement to test
 * @param adv.name - BLE advertised name
 * @param adv.serviceUuidsList - advertised service UUIDs
 */
export function isHoymilesAdvertisement(adv: { name?: string; serviceUuidsList?: string[] }): boolean {
	if ((adv.serviceUuidsList ?? []).some(u => u.toLowerCase().includes(HOYMILES_SERVICE_HINT))) {
		return true;
	}
	const name = (adv.name ?? "").trim();
	return HOYMILES_NAME_PREFIXES.some(p => name.startsWith(p));
}

function sleep(ms: number, timers: TimerScheduler, signal?: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		// Initialized here rather than at the setTimeout call so that a scheduler calling back
		// synchronously cannot hit the temporal dead zone inside done().
		let handle: ioBroker.Timeout | undefined = undefined;
		const done = (): void => {
			signal?.removeEventListener("abort", done);
			timers.clearTimeout(handle);
			resolve();
		};
		// A shutting-down adapter refuses the timer and returns undefined; the abort from the
		// caller's stop() is what ends the wait then.
		handle = timers.setTimeout(done, ms);
		signal?.addEventListener("abort", done, { once: true });
	});
}

/**
 * Discover ESPHome gateways on the local network via mDNS (`_esphomelib._tcp`).
 *
 * @param timeoutMs - how long to listen for responses
 * @param timers - timer scheduler; pass the adapter so the js-controller cleans the wait timer up
 * @param signal - abort the wait and tear the mDNS socket down early, e.g. from the caller's stop()
 */
export async function discoverGateways(
	timeoutMs = 5000,
	timers: TimerScheduler = NATIVE_TIMERS,
	signal?: AbortSignal,
): Promise<GatewayInfo[]> {
	const found = new Map<string, GatewayInfo>();
	const disc = new Discovery({});
	disc.on("info", (info: { host?: string; address?: string; address6?: string; port?: number; name?: string }) => {
		// Prefer the resolved IPv4 — a ".local" mDNS hostname only resolves when the OS runs an mDNS
		// resolver (Bonjour/Avahi), which many setups (Docker/Linux) do not. Fall back to host/IPv6.
		const host = info.address || info.host || info.address6;
		if (host) {
			// Keep the ".local" name as the display label when we connect by IP.
			const name = info.name || (info.host && info.host !== host ? info.host : "");
			found.set(host, { host, port: info.port || ESPHOME_API_PORT, name });
		}
	});
	try {
		disc.run();
		await sleep(timeoutMs, timers, signal);
	} finally {
		try {
			disc.destroy();
		} catch {
			/* ignore */
		}
	}
	return [...found.values()];
}
