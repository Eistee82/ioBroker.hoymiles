import * as net from "node:net";
import * as tls from "node:tls";
import { EventEmitter } from "node:events";
export const NATIVE_TIMERS = {
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: handle => globalThis.clearTimeout(handle),
    setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
    clearInterval: handle => globalThis.clearInterval(handle),
};
class TcpConnection extends EventEmitter {
    connected;
    socket;
    destroyed;
    reconnectDelay;
    host;
    port;
    timers;
    tlsOptions;
    reconnectTimer;
    reconnectDelayMin;
    reconnectDelayMax;
    constructor(host, port, reconnectDelayMin, reconnectDelayMax, timers, tlsOptions) {
        super();
        this.host = host;
        this.port = port;
        this.timers = timers ?? NATIVE_TIMERS;
        this.tlsOptions = tlsOptions ?? null;
        this.socket = null;
        this.connected = false;
        this.destroyed = false;
        this.reconnectTimer = undefined;
        this.reconnectDelay = reconnectDelayMin;
        this.reconnectDelayMin = reconnectDelayMin;
        this.reconnectDelayMax = reconnectDelayMax;
    }
    connect() {
        if (this.destroyed) {
            return;
        }
        this.reconnectTimer = this.clearManagedTimeout(this.reconnectTimer);
        this._cleanupSocket();
        this.connected = false;
        const onConnected = () => {
            this.connected = true;
            this.reconnectDelay = this.reconnectDelayMin;
            this._onConnected();
        };
        if (this.tlsOptions) {
            const socket = tls.connect({
                host: this.host,
                port: this.port,
                ...(net.isIP(this.host) ? {} : { servername: this.host }),
                ...this.tlsOptions,
            }, onConnected);
            this.socket = socket;
            this._configureSocket(socket);
        }
        else {
            const socket = new net.Socket();
            this.socket = socket;
            this._configureSocket(socket);
            socket.connect(this.port, this.host, onConnected);
        }
        this.socket.on("error", (err) => this._handleDisconnect(err));
        this.socket.on("close", () => this._handleDisconnect(null));
    }
    get usesTls() {
        return this.tlsOptions !== null;
    }
    disconnect() {
        this.destroyed = true;
        this._stopAllTimers();
        this._cleanupSocket();
        this.connected = false;
    }
    _handleDisconnect(err) {
        const wasConnected = this.connected;
        this.connected = false;
        this._stopSessionTimers();
        if (this.destroyed) {
            if (wasConnected) {
                this.emit("disconnected");
            }
            return;
        }
        if (err) {
            this.emit("error", err);
        }
        if (wasConnected) {
            this.emit("disconnected");
        }
        if (this._shouldReconnect() && !this.reconnectTimer) {
            const delay = this.reconnectDelay;
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectDelayMax);
            this.reconnectTimer = this.timers.setTimeout(() => {
                this.reconnectTimer = undefined;
                if (!this.destroyed && this._shouldReconnect()) {
                    this.connect();
                }
            }, delay);
        }
    }
    _stopAllTimers() {
        this._stopSessionTimers();
        this.reconnectTimer = this.clearManagedTimeout(this.reconnectTimer);
    }
    clearManagedTimeout(handle) {
        if (handle) {
            this.timers.clearTimeout(handle);
        }
        return undefined;
    }
    clearManagedInterval(handle) {
        if (handle) {
            this.timers.clearInterval(handle);
        }
        return undefined;
    }
    _cleanupSocket() {
        if (this.socket) {
            const old = this.socket;
            this.socket = null;
            old.removeAllListeners();
            old.on("error", () => { });
            old.destroy();
        }
    }
    _shouldReconnect() {
        return true;
    }
}
export default TcpConnection;
//# sourceMappingURL=tcpConnection.js.map