import { EventEmitter } from "node:events";
import { NATIVE_TIMERS } from "./tcpConnection.js";
import { EsphomeGateway } from "./esphomeGateway.js";
import { bleBuildFrame, bleParseFrame, bleDecrypt, snDecrypt, extractEncRand, pbFindVarint, } from "./bleCrypto.js";
import { BLE_HANDSHAKE_TICK_MS, BLE_IDLE_TIMEOUT_MS, HM_MAGIC_0, HM_MAGIC_1, RECONNECT_MAX_MS } from "./constants.js";
import { unixSeconds, errorMessage } from "./utils.js";
const TAG_INFO = 0xa301;
const TAG_COMMCMD_Y = 0xa318;
const TAG_COMMCMD_H = 0xa319;
const TAG_COMMCMD_STATUS = 0xa219;
const ACTION_STATUS = 64;
const ACTION_PIN_VERIFY = 82;
const STS_RUNNING = 0;
const STS_PAIRED = 1;
const STS_FAILED = 2;
const STS_PIN_NEEDED = 3;
const STS_PIN_REJECTED = 4;
const MTU_GUARD = 4096;
const RECONNECT_DELAY_MIN_MS = 5000;
const GATT_CONNECT_TRIES = 6;
const GATT_CONNECT_RETRY_MS = 2000;
const GCM_TAG_LEN = 16;
const MAGIC = Buffer.from([HM_MAGIC_0, HM_MAGIC_1]);
function vint(n) {
    const bytes = [];
    let v = n;
    while (v > 0x7f) {
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    bytes.push(v);
    return Buffer.from(bytes);
}
export class BleConnection extends EventEmitter {
    connected;
    gateway;
    mac;
    sn;
    pin;
    timers;
    log;
    addressType;
    idleTimeoutMs;
    destroyed;
    establishing;
    state;
    encRand;
    seq;
    writeHandle;
    notifyHandle;
    notifyBuf;
    unsubNotify;
    unsubDeviceGone;
    lastRxTs;
    tickTimer;
    reconnectTimer;
    reconnectDelay;
    tickBusy;
    onGwConnected;
    onGwDisconnected;
    constructor(options) {
        super();
        this.gateway = options.gateway;
        this.mac = options.mac;
        this.sn = options.sn;
        this.pin = options.pin;
        this.timers = options.timers ?? NATIVE_TIMERS;
        this.log = options.log;
        this.addressType = options.addressType;
        this.idleTimeoutMs = options.idleTimeoutMs ?? BLE_IDLE_TIMEOUT_MS;
        this.connected = false;
        this.destroyed = false;
        this.establishing = false;
        this.state = "idle";
        this.encRand = null;
        this.seq = 0;
        this.writeHandle = null;
        this.notifyHandle = null;
        this.notifyBuf = Buffer.alloc(0);
        this.unsubNotify = null;
        this.unsubDeviceGone = null;
        this.lastRxTs = 0;
        this.reconnectDelay = RECONNECT_DELAY_MIN_MS;
        this.tickBusy = false;
        this.onGwConnected = () => {
            if (!this.destroyed && !this.connected && !this.establishing) {
                void this.establish();
            }
        };
        this.onGwDisconnected = () => this.teardownSession();
    }
    connect() {
        if (this.destroyed) {
            return;
        }
        this.gateway.on("connected", this.onGwConnected);
        this.gateway.on("disconnected", this.onGwDisconnected);
        this.unsubDeviceGone = this.gateway.onDeviceDisconnect(this.mac, () => this.onDeviceGone());
        if (this.gateway.connected) {
            void this.establish();
        }
        else {
            this.log.debug(`[ble ${this.macStr()}] waiting for gateway ${this.gateway.host}`);
        }
    }
    async send(buffer) {
        if (!this.connected) {
            return false;
        }
        const parsed = bleParseFrame(buffer);
        if (!parsed) {
            return false;
        }
        const mode = parsed.tag === TAG_INFO ? "plain" : "gcm";
        if (mode === "gcm" && !this.encRand) {
            return false;
        }
        try {
            const frame = bleBuildFrame(parsed.tag, parsed.payload, {
                mode,
                encRand: this.encRand,
                sn: this.sn,
                seq: this.nextSeq(),
            });
            await this.gateway.writeChar(this.mac, this.writeHandle, frame);
            return true;
        }
        catch (err) {
            this.log.debug(`[ble ${this.macStr()}] send failed: ${errorMessage(err)}`);
            return false;
        }
    }
    disconnect() {
        this.destroyed = true;
        this.detachGateway();
        this.reconnectTimer = this.clearTimer(this.reconnectTimer);
        this.teardownSession();
        this.removeAllListeners();
    }
    detachGateway() {
        this.gateway.removeListener("connected", this.onGwConnected);
        this.gateway.removeListener("disconnected", this.onGwDisconnected);
        if (this.unsubDeviceGone) {
            try {
                this.unsubDeviceGone();
            }
            catch {
            }
            this.unsubDeviceGone = null;
        }
    }
    onDeviceGone() {
        if (this.destroyed || (this.state === "idle" && !this.connected)) {
            return;
        }
        this.log.info(`[ble ${this.macStr()}] device disconnected, will retry`);
        this.teardownSession();
        this.scheduleReconnect();
    }
    async establish() {
        if (this.destroyed || this.establishing || this.connected) {
            return;
        }
        this.establishing = true;
        try {
            if (!this.gateway.connected) {
                return;
            }
            await this.gattConnect();
            const { servicesList } = await this.gateway.listGatt(this.mac);
            this.resolveHandles(servicesList);
            if (this.writeHandle == null || this.notifyHandle == null) {
                throw new Error("required GATT characteristics (ffe1/ffe2) not found");
            }
            this.unsubNotify = this.gateway.onNotifyData(this.mac, this.notifyHandle, chunk => this.onNotify(chunk));
            await this.gateway.enableNotify(this.mac, this.notifyHandle);
            try {
                await this.gateway.writeDescriptor(this.mac, this.notifyHandle + 1, Buffer.from([0x01, 0x00]));
            }
            catch (err) {
                this.log.debug(`[ble ${this.macStr()}] CCCD write failed (continuing): ${errorMessage(err)}`);
            }
            this.state = "boot";
            this.encRand = null;
            this.notifyBuf = Buffer.alloc(0);
            this.lastRxTs = Date.now();
            this.startTick();
            this.log.info(`[ble ${this.macStr()}] GATT ready, starting pairing handshake`);
        }
        catch (err) {
            this.log.debug(`[ble ${this.macStr()}] establish failed: ${errorMessage(err)}`);
            this.emit("error", err instanceof Error ? err : new Error(errorMessage(err)));
            this.scheduleReconnect();
        }
        finally {
            this.establishing = false;
        }
    }
    async gattConnect() {
        try {
            await this.gateway.disconnectDevice(this.mac);
        }
        catch {
        }
        let lastErr = null;
        for (let attempt = 1; attempt <= GATT_CONNECT_TRIES; attempt++) {
            if (this.destroyed || !this.gateway.connected) {
                throw new Error("gateway gone before GATT connect");
            }
            try {
                await this.gateway.connectDevice(this.mac, this.addressType);
                return;
            }
            catch (err) {
                lastErr = err;
                await this.delay(GATT_CONNECT_RETRY_MS);
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error(errorMessage(lastErr));
    }
    teardownSession() {
        const wasConnected = this.connected;
        this.connected = false;
        this.state = "idle";
        this.lastRxTs = 0;
        this.tickTimer = this.clearInterval(this.tickTimer);
        if (this.unsubNotify) {
            try {
                this.unsubNotify();
            }
            catch {
            }
            this.unsubNotify = null;
        }
        if (wasConnected) {
            this.emit("disconnected");
        }
    }
    scheduleReconnect() {
        if (this.destroyed || this.reconnectTimer) {
            return;
        }
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
        this.log.debug(`[ble ${this.macStr()}] reconnecting in ${Math.round(delay / 1000)}s`);
        this.reconnectTimer = this.timers.setTimeout(() => {
            this.reconnectTimer = undefined;
            if (!this.destroyed && !this.connected && this.gateway.connected) {
                void this.establish();
            }
        }, delay);
    }
    resolveHandles(servicesList) {
        for (const svc of servicesList) {
            for (const ch of svc.characteristicsList) {
                const uuid = (ch.uuid || "").toLowerCase();
                if (uuid.includes("ffe1")) {
                    this.writeHandle = ch.handle;
                }
                else if (uuid.includes("ffe2")) {
                    this.notifyHandle = ch.handle;
                }
            }
        }
    }
    startTick() {
        this.tickTimer = this.clearInterval(this.tickTimer);
        this.tickTimer = this.timers.setInterval(() => {
            void this.tick();
        }, BLE_HANDSHAKE_TICK_MS);
    }
    async tick() {
        if (this.destroyed || this.tickBusy || !this.gateway.connected) {
            return;
        }
        this.tickBusy = true;
        try {
            if (this.lastRxTs > 0 && Date.now() - this.lastRxTs > this.idleTimeoutMs) {
                this.log.warn(`[ble ${this.macStr()}] no data for ${Math.round(this.idleTimeoutMs / 1000)}s, reconnecting`);
                this.teardownSession();
                this.scheduleReconnect();
                return;
            }
            if (!this.encRand) {
                this.sendInternal(TAG_INFO, Buffer.alloc(0), "plain");
                return;
            }
            const ts = unixSeconds();
            switch (this.state) {
                case "boot":
                    this.state = "commcmd";
                    break;
                case "commcmd":
                    this.sendInternal(TAG_COMMCMD_Y, BleConnection.commCmdY(ts), "gcm");
                    await this.delay(300);
                    if (this.okToSend()) {
                        this.sendInternal(TAG_COMMCMD_H, BleConnection.commCmdH(ts, ACTION_STATUS), "gcm");
                    }
                    break;
                case "pin_needed":
                    if (!this.pin) {
                        this.failPairing("no PIN configured");
                        break;
                    }
                    this.log.info(`[ble ${this.macStr()}] sending PIN (once)`);
                    this.sendInternal(TAG_COMMCMD_Y, BleConnection.commCmdPin(ts, this.pin), "gcm");
                    await this.delay(300);
                    if (this.okToSend()) {
                        this.sendInternal(TAG_COMMCMD_H, BleConnection.commCmdH(ts, ACTION_PIN_VERIFY), "gcm");
                    }
                    this.state = "pin_wait";
                    break;
                case "pin_wait":
                    this.sendInternal(TAG_COMMCMD_H, BleConnection.commCmdH(ts, ACTION_PIN_VERIFY), "gcm");
                    break;
                case "paired":
                case "idle":
                    break;
            }
        }
        finally {
            this.tickBusy = false;
        }
    }
    markPaired() {
        if (this.state !== "paired") {
            this.state = "paired";
            this.connected = true;
            this.reconnectDelay = RECONNECT_DELAY_MIN_MS;
            this.log.info(`[ble ${this.macStr()}] paired`);
            this.emit("connected");
        }
    }
    handleStatus(plain) {
        const action = pbFindVarint(plain, 3) ?? ACTION_STATUS;
        const sts = pbFindVarint(plain, 11) ?? STS_RUNNING;
        if (action === ACTION_PIN_VERIFY) {
            if (sts === STS_RUNNING) {
                this.markPaired();
            }
            else {
                this.failPairing("PIN rejected");
            }
            return;
        }
        switch (sts) {
            case STS_PIN_NEEDED:
                if (this.state === "commcmd") {
                    this.state = "pin_needed";
                    this.log.info(`[ble ${this.macStr()}] device requests PIN`);
                }
                break;
            case STS_PAIRED:
                this.markPaired();
                break;
            case STS_FAILED:
                this.failPairing("pairing rejected by device");
                break;
            case STS_PIN_REJECTED:
                this.failPairing("PIN rejected");
                break;
            case STS_RUNNING:
            default:
                break;
        }
    }
    failPairing(reason) {
        if (this.destroyed) {
            return;
        }
        this.log.warn(`[ble ${this.macStr()}] pairing failed: ${reason}`);
        this.destroyed = true;
        this.detachGateway();
        this.reconnectTimer = this.clearTimer(this.reconnectTimer);
        this.teardownSession();
        this.emit("pairingFailed", reason);
    }
    onNotify(chunk) {
        this.lastRxTs = Date.now();
        this.notifyBuf = Buffer.concat([this.notifyBuf, chunk]);
        while (this.notifyBuf.length >= 10 && this.notifyBuf[0] === HM_MAGIC_0 && this.notifyBuf[1] === HM_MAGIC_1) {
            const totalLen = this.notifyBuf.readUInt16BE(8);
            if (this.notifyBuf.length < totalLen) {
                break;
            }
            const nextHM = this.notifyBuf.indexOf(MAGIC, 2);
            const take = nextHM > 0 ? nextHM : this.notifyBuf.length;
            this.processFrame(this.notifyBuf.subarray(0, take));
            this.notifyBuf = this.notifyBuf.subarray(take);
        }
        if (this.notifyBuf.length > MTU_GUARD) {
            this.notifyBuf = Buffer.alloc(0);
        }
    }
    processFrame(frame) {
        const parsed = bleParseFrame(frame);
        if (!parsed) {
            return;
        }
        let plain = null;
        if (parsed.payload.length >= GCM_TAG_LEN) {
            if (this.sn && parsed.payload.length % 16 === 0) {
                try {
                    plain = snDecrypt(this.sn, parsed.tag, parsed.seq, parsed.payload);
                    if (!this.encRand) {
                        const er = extractEncRand(plain);
                        if (er) {
                            this.encRand = er;
                            this.log.debug(`[ble ${this.macStr()}] encRand acquired from bootstrap`);
                        }
                    }
                }
                catch {
                    plain = null;
                }
            }
            if (!plain && this.encRand) {
                try {
                    plain = bleDecrypt(this.encRand, parsed.tag, parsed.seq, parsed.payload);
                }
                catch {
                    plain = null;
                }
            }
        }
        else {
            plain = parsed.payload;
        }
        if (!plain) {
            return;
        }
        if (parsed.tag === TAG_COMMCMD_STATUS) {
            this.handleStatus(plain);
            return;
        }
        if (this.connected) {
            const clear = bleBuildFrame(parsed.tag, plain, { mode: "plain", seq: parsed.seq });
            this.emit("message", clear);
        }
    }
    sendInternal(tag, payload, mode) {
        if (mode === "gcm" && !this.encRand) {
            return;
        }
        try {
            const frame = bleBuildFrame(tag, payload, {
                mode,
                encRand: this.encRand,
                sn: this.sn,
                seq: this.nextSeq(),
            });
            void this.gateway.writeChar(this.mac, this.writeHandle, frame).catch(err => {
                this.log.debug(`[ble ${this.macStr()}] internal write failed: ${errorMessage(err)}`);
            });
        }
        catch (err) {
            this.log.debug(`[ble ${this.macStr()}] internal frame build failed: ${errorMessage(err)}`);
        }
    }
    okToSend() {
        return !this.destroyed && this.gateway.connected;
    }
    nextSeq() {
        this.seq = (this.seq + 1) & 0xffff;
        return this.seq;
    }
    macStr() {
        return EsphomeGateway.macToString(this.mac);
    }
    delay(ms) {
        return new Promise(resolve => {
            this.timers.setTimeout(resolve, ms);
        });
    }
    clearTimer(handle) {
        if (handle) {
            this.timers.clearTimeout(handle);
        }
        return undefined;
    }
    clearInterval(handle) {
        if (handle) {
            this.timers.clearInterval(handle);
        }
        return undefined;
    }
    static commCmdY(ts) {
        return Buffer.concat([
            Buffer.concat([Buffer.from([0x08]), vint(ts)]),
            Buffer.from([0x10, 0x40]),
            Buffer.concat([Buffer.from([0x28]), vint(ts)]),
        ]);
    }
    static commCmdH(ts, action) {
        return Buffer.concat([
            Buffer.concat([Buffer.from([0x08]), vint(ts)]),
            Buffer.concat([Buffer.from([0x10]), vint(action)]),
            Buffer.concat([Buffer.from([0x20]), vint(ts)]),
        ]);
    }
    static commCmdPin(ts, pin) {
        const p = Buffer.from(pin, "ascii");
        return Buffer.concat([
            Buffer.concat([Buffer.from([0x08]), vint(ts)]),
            Buffer.from([0x10, 0x52]),
            Buffer.concat([Buffer.from([0x28]), vint(ts)]),
            Buffer.concat([Buffer.from([0x32, p.length]), p]),
        ]);
    }
}
export default BleConnection;
//# sourceMappingURL=bleConnection.js.map