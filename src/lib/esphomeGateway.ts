import { EventEmitter } from "node:events";
// The library is CommonJS but ships an ESM-shaped `.d.ts`; Node's named-export interop resolves
// `Client` at runtime, so a named import works for both the value and the types.
import { Client } from "@2colors/esphome-native-api";
import type {
	Client as EsphomeClient,
	BluetoothLEAdvertisementResponse,
	BluetoothGATTGetServicesResponse,
	BluetoothGATTNotifyDataResponse,
} from "@2colors/esphome-native-api";
import { ESPHOME_API_PORT } from "./constants.js";
import { errorMessage } from "./utils.js";

/** Minimal logger surface (satisfied by the ioBroker adapter's `log`). */
export interface GatewayLogger {
	/** Debug-level log. */
	debug: (message: string) => void;
	/** Info-level log. */
	info: (message: string) => void;
	/** Warning-level log. */
	warn: (message: string) => void;
	/** Error-level log. */
	error: (message: string) => void;
}

const NOTIFY_EVENT = "message.BluetoothGATTNotifyDataResponse";
const DEVICE_CONNECTION_EVENT = "message.BluetoothDeviceConnectionResponse";

/**
 * Wraps a single ESPHome Bluetooth-Proxy (Native API, TCP port 6053). Provides connection
 * lifecycle, BLE advertisement subscription, and per-device GATT operations (connect, list
 * services, write, notify). Multiple {@link BleConnection}s can share one gateway.
 *
 * Emits: `connected`, `disconnected`, `error` (Error), `advertisement` (advertisement object).
 */
export class EsphomeGateway extends EventEmitter {
	readonly host: string;
	readonly port: number;

	private client: EsphomeClient | null;
	private started: boolean;
	private authorized: boolean;
	private readonly log: GatewayLogger;

	/**
	 * @param host - proxy IP/hostname
	 * @param port - Native API port (default 6053)
	 * @param log - logger
	 */
	constructor(host: string, port: number, log: GatewayLogger) {
		super();
		this.host = host;
		this.port = port || ESPHOME_API_PORT;
		this.log = log;
		this.client = null;
		this.started = false;
		this.authorized = false;
	}

	/**
	 * Convert a MAC string ("AA:BB:CC:DD:EE:FF") to the uint64 number the ESPHome API expects.
	 *
	 * @param mac - MAC address
	 */
	static macToNumber(mac: string): number {
		return parseInt(mac.replace(/[^0-9a-fA-F]/g, ""), 16);
	}

	/**
	 * Convert a numeric MAC back to the canonical "AA:BB:CC:DD:EE:FF" string.
	 *
	 * @param mac - MAC address
	 */
	static macToString(mac: number): string {
		const hex = mac.toString(16).padStart(12, "0").toUpperCase();
		return (hex.match(/.{2}/g) ?? []).join(":");
	}

	/** True once the underlying Native-API connection is up and authorized. */
	get connected(): boolean {
		return this.authorized && !!this.client?.connection?.connected;
	}

	/** Open the Native-API connection (idempotent). Auto-reconnects internally. */
	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;

		const client = new Client({
			host: this.host,
			port: this.port,
			// Empty strings (not null/undefined) select the plaintext, no-password path.
			encryptionKey: "",
			password: "",
			clientInfo: "iobroker.hoymiles",
			reconnect: true,
			// We only need BLE advertisements. Skip the entity/state/log init — newer ESPHome
			// firmware sends API message types this client version cannot parse, which aborts the
			// ListEntities step and would prevent the advertisement subscription from ever running.
			initializeDeviceInfo: false,
			initializeListEntities: false,
			initializeSubscribeStates: false,
			initializeSubscribeLogs: false,
			initializeSubscribeBLEAdvertisements: true,
		});
		this.client = client;

		client.on("error", (e: unknown) => {
			this.emit("error", e instanceof Error ? e : new Error(errorMessage(e)));
		});
		client.on("ble", (adv: BluetoothLEAdvertisementResponse) => {
			this.emit("advertisement", adv);
		});

		const conn = this.eventConnection();
		conn.on("authorized", () => {
			this.authorized = true;
			this.log.debug(`[esphome ${this.host}] authorized`);
			this.emit("connected");
		});
		conn.on("disconnected", () => {
			this.authorized = false;
			this.log.debug(`[esphome ${this.host}] disconnected`);
			this.emit("disconnected");
		});

		try {
			client.connection.connect();
		} catch (e) {
			this.emit("error", e instanceof Error ? e : new Error(errorMessage(e)));
		}
	}

	/** Close the connection permanently and drop all listeners. */
	stop(): void {
		this.started = false;
		this.authorized = false;
		if (this.client) {
			try {
				this.client.connection.disconnect();
			} catch {
				/* ignore */
			}
			this.client = null;
		}
		this.removeAllListeners();
	}

	/**
	 * Subscribe to GATT notifications for one device+handle. Returns an unsubscribe function.
	 *
	 * @param mac - numeric BLE address
	 * @param handle - characteristic handle to filter on
	 * @param cb - called with each notification's payload bytes
	 */
	onNotifyData(mac: number, handle: number, cb: (data: Buffer) => void): () => void {
		const conn = this.eventConnection();
		const listener = (msg: BluetoothGATTNotifyDataResponse): void => {
			if (msg.address === mac && msg.handle === handle) {
				// jspb renders `bytes` fields as base64 strings.
				cb(Buffer.from(msg.data, "base64"));
			}
		};
		conn.on(NOTIFY_EVENT, listener);
		return () => {
			conn.removeListener(NOTIFY_EVENT, listener);
		};
	}

	/**
	 * Subscribe to the proxy's "this BLE device dropped its GATT link" notification. Returns an
	 * unsubscribe function.
	 *
	 * ESPHome pushes a `BluetoothDeviceConnectionResponse` whenever a device's link changes — not
	 * only as the reply to {@link connectDevice}. That unsolicited message is the *only* signal that
	 * a BLE inverter went away while the proxy itself stays connected (the nightly power-down of an
	 * HMS-800-2WB). Without it the transport never learns the device is gone.
	 *
	 * @param mac - numeric BLE address
	 * @param cb - called when the proxy reports this device as no longer connected
	 */
	onDeviceDisconnect(mac: number, cb: () => void): () => void {
		const conn = this.eventConnection();
		const listener = (msg: { address?: number; connected?: boolean }): void => {
			if (msg.address === mac && msg.connected === false) {
				cb();
			}
		};
		conn.on(DEVICE_CONNECTION_EVENT, listener);
		return () => {
			conn.removeListener(DEVICE_CONNECTION_EVENT, listener);
		};
	}

	/**
	 * Open a GATT connection to a BLE device via the proxy.
	 *
	 * @param mac - numeric BLE address
	 * @param addressType - optional BLE address type (0 = public, 1 = random)
	 * @throws {Error} if the proxy reports the connection failed
	 */
	async connectDevice(mac: number, addressType?: number): Promise<void> {
		const res = await this.requireConnection().connectBluetoothDeviceService(mac, addressType);
		if (res && res.connected === false) {
			throw new Error(`BLE connect failed (error ${res.error ?? "?"})`);
		}
	}

	/**
	 * Close the GATT connection to a BLE device (best-effort).
	 *
	 * @param mac - numeric BLE address
	 */
	async disconnectDevice(mac: number): Promise<void> {
		await this.requireConnection().disconnectBluetoothDeviceService(mac);
	}

	/**
	 * List a device's GATT services and characteristics (each with its handle).
	 *
	 * @param mac - numeric BLE address
	 */
	async listGatt(mac: number): Promise<BluetoothGATTGetServicesResponse> {
		return this.requireConnection().listBluetoothGATTServicesService(mac);
	}

	/**
	 * Enable notifications on a characteristic.
	 *
	 * @param mac - numeric BLE address
	 * @param handle - characteristic handle
	 */
	async enableNotify(mac: number, handle: number): Promise<void> {
		await this.requireConnection().notifyBluetoothGATTCharacteristicService(mac, handle);
	}

	/**
	 * Write bytes to a characteristic.
	 *
	 * @param mac - numeric BLE address
	 * @param handle - characteristic handle
	 * @param value - bytes to write
	 * @param withResponse - request a write-response ack (default false = write-without-response)
	 */
	async writeChar(mac: number, handle: number, value: Buffer, withResponse = false): Promise<void> {
		await this.requireConnection().writeBluetoothGATTCharacteristicService(mac, handle, value, withResponse);
	}

	/**
	 * Write a characteristic's descriptor. Used to set the CCCD (`ffe2`'s handle + 1) to `0x0100` so
	 * the inverter actually starts sending notifications — {@link enableNotify} alone registers the
	 * proxy but leaves the CCCD at 0, and the device then stays silent (verified on hardware).
	 *
	 * @param mac - numeric BLE address
	 * @param handle - descriptor handle
	 * @param value - bytes to write
	 */
	async writeDescriptor(mac: number, handle: number, value: Buffer): Promise<void> {
		await this.requireConnection().writeBluetoothGATTDescriptorService(mac, handle, value);
	}

	/** The connection typed for event (un)subscription (the library object is a Node EventEmitter). */
	private eventConnection(): EventEmitter {
		return this.requireConnection() as unknown as EventEmitter;
	}

	private requireConnection(): EsphomeClient["connection"] {
		if (!this.client?.connection) {
			throw new Error("ESPHome gateway not started");
		}
		return this.client.connection;
	}
}
