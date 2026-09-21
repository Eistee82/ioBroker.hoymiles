import { EventEmitter } from "node:events";
import { Client } from "@2colors/esphome-native-api";
import { ESPHOME_API_PORT } from "./constants.js";
import { errorMessage } from "./utils.js";
const NOTIFY_EVENT = "message.BluetoothGATTNotifyDataResponse";
const DEVICE_CONNECTION_EVENT = "message.BluetoothDeviceConnectionResponse";
export class EsphomeGateway extends EventEmitter {
    host;
    port;
    client;
    started;
    authorized;
    log;
    constructor(host, port, log) {
        super();
        this.host = host;
        this.port = port || ESPHOME_API_PORT;
        this.log = log;
        this.client = null;
        this.started = false;
        this.authorized = false;
    }
    static macToNumber(mac) {
        return parseInt(mac.replace(/[^0-9a-fA-F]/g, ""), 16);
    }
    static macToString(mac) {
        const hex = mac.toString(16).padStart(12, "0").toUpperCase();
        return (hex.match(/.{2}/g) ?? []).join(":");
    }
    get connected() {
        return this.authorized && !!this.client?.connection?.connected;
    }
    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        const client = new Client({
            host: this.host,
            port: this.port,
            encryptionKey: "",
            password: "",
            clientInfo: "iobroker.hoymiles",
            reconnect: true,
            initializeDeviceInfo: false,
            initializeListEntities: false,
            initializeSubscribeStates: false,
            initializeSubscribeLogs: false,
            initializeSubscribeBLEAdvertisements: true,
        });
        this.client = client;
        client.on("error", (e) => {
            this.emit("error", e instanceof Error ? e : new Error(errorMessage(e)));
        });
        client.on("ble", (adv) => {
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
        }
        catch (e) {
            this.emit("error", e instanceof Error ? e : new Error(errorMessage(e)));
        }
    }
    stop() {
        this.started = false;
        this.authorized = false;
        if (this.client) {
            try {
                this.client.connection.disconnect();
            }
            catch {
            }
            this.client = null;
        }
        this.removeAllListeners();
    }
    onNotifyData(mac, handle, cb) {
        const conn = this.eventConnection();
        const listener = (msg) => {
            if (msg.address === mac && msg.handle === handle) {
                cb(Buffer.from(msg.data, "base64"));
            }
        };
        conn.on(NOTIFY_EVENT, listener);
        return () => {
            conn.removeListener(NOTIFY_EVENT, listener);
        };
    }
    onDeviceDisconnect(mac, cb) {
        const conn = this.eventConnection();
        const listener = (msg) => {
            if (msg.address === mac && msg.connected === false) {
                cb();
            }
        };
        conn.on(DEVICE_CONNECTION_EVENT, listener);
        return () => {
            conn.removeListener(DEVICE_CONNECTION_EVENT, listener);
        };
    }
    async connectDevice(mac, addressType) {
        const res = await this.requireConnection().connectBluetoothDeviceService(mac, addressType);
        if (res && res.connected === false) {
            throw new Error(`BLE connect failed (error ${res.error ?? "?"})`);
        }
    }
    async disconnectDevice(mac) {
        await this.requireConnection().disconnectBluetoothDeviceService(mac);
    }
    async listGatt(mac) {
        return this.requireConnection().listBluetoothGATTServicesService(mac);
    }
    async enableNotify(mac, handle) {
        await this.requireConnection().notifyBluetoothGATTCharacteristicService(mac, handle);
    }
    async writeChar(mac, handle, value, withResponse = false) {
        await this.requireConnection().writeBluetoothGATTCharacteristicService(mac, handle, value, withResponse);
    }
    async writeDescriptor(mac, handle, value) {
        await this.requireConnection().writeBluetoothGATTDescriptorService(mac, handle, value);
    }
    eventConnection() {
        return this.requireConnection();
    }
    requireConnection() {
        if (!this.client?.connection) {
            throw new Error("ESPHome gateway not started");
        }
        return this.client.connection;
    }
}
//# sourceMappingURL=esphomeGateway.js.map