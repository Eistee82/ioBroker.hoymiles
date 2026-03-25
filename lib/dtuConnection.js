"use strict";

const net = require("net");
const EventEmitter = require("events");

const MAGIC_0 = 0x48;
const MAGIC_1 = 0x4d;
const HEADER_SIZE = 10;
const KEEP_ALIVE_INTERVAL = 10000; // 10 seconds
const RECONNECT_DELAY_MIN = 5000; // 5 seconds
const RECONNECT_DELAY_MAX = 300000; // 5 minutes
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests
const SOCKET_TIMEOUT = 30000; // 30 seconds

class DtuConnection extends EventEmitter {
    constructor(host, port, options = {}) {
        super();
        this.host = host;
        this.port = port || 10081;
        this.cloudPauseEnabled = options.cloudPause !== false;
        this.cloudPauseDuration = (options.cloudPauseDuration || 40) * 1000;

        this.socket = null;
        this.connected = false;
        this.receiveBuffer = Buffer.alloc(0);
        this.keepAliveTimer = null;
        this.reconnectTimer = null;
        this.cloudPauseTimer = null;
        this.cloudPaused = false;
        this.lastRequestTime = 0;
        this.destroyed = false;
        this.reconnectDelay = RECONNECT_DELAY_MIN;
        this.consecutiveErrors = 0;
    }

    connect() {
        if (this.destroyed) return;
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }

        this.receiveBuffer = Buffer.alloc(0);

        this.socket = new net.Socket();
        this.socket.setTimeout(SOCKET_TIMEOUT);

        this.socket.connect(this.port, this.host, () => {
            this.connected = true;
            this.cloudPaused = false;
            this.reconnectDelay = RECONNECT_DELAY_MIN;
            this.consecutiveErrors = 0;
            this._startKeepAlive();
            if (this.cloudPauseEnabled) {
                this._startCloudPauseCheck();
            }
            this.emit("connected");
        });

        this.socket.on("data", (chunk) => this._onData(chunk));

        this.socket.on("error", (err) => {
            this.consecutiveErrors++;
            // Only emit error on first failure and then every 10th attempt
            if (this.consecutiveErrors === 1 || this.consecutiveErrors % 10 === 0) {
                this.emit("error", err, this.consecutiveErrors);
            }
            this._handleDisconnect();
        });

        this.socket.on("close", () => {
            this._handleDisconnect();
        });

        this.socket.on("timeout", () => {
            this.emit("error", new Error("Socket timeout"));
            if (this.socket) this.socket.destroy();
        });
    }

    disconnect() {
        this.destroyed = true;
        this._stopTimers();
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
        this.cloudPaused = false;
    }

    async send(buffer) {
        if (!this.connected || !this.socket || this.cloudPaused) {
            return false;
        }

        // Enforce minimum request interval
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < MIN_REQUEST_INTERVAL) {
            await new Promise((resolve) =>
                setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed)
            );
        }

        this.lastRequestTime = Date.now();

        return new Promise((resolve) => {
            this.socket.write(buffer, (err) => {
                resolve(!err);
            });
        });
    }

    isCloudPauseActive() {
        if (!this.cloudPauseEnabled) return false;

        const now = new Date();
        const min = now.getMinutes();
        const sec = now.getSeconds();

        // Cloud upload window at xx:14:40, xx:29:40, xx:44:40, xx:59:40
        if (sec >= 40 && (min === 14 || min === 29 || min === 44 || min === 59)) {
            return true;
        }
        // Also cover the rollover into the next minute
        if (sec < 20 && (min === 0 || min === 15 || min === 30 || min === 45)) {
            return true;
        }
        return false;
    }

    _onData(chunk) {
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);

        while (this.receiveBuffer.length >= HEADER_SIZE) {
            // Find magic bytes
            if (
                this.receiveBuffer[0] !== MAGIC_0 ||
                this.receiveBuffer[1] !== MAGIC_1
            ) {
                // Scan for magic bytes
                let found = false;
                for (let i = 1; i < this.receiveBuffer.length - 1; i++) {
                    if (
                        this.receiveBuffer[i] === MAGIC_0 &&
                        this.receiveBuffer[i + 1] === MAGIC_1
                    ) {
                        this.receiveBuffer = this.receiveBuffer.slice(i);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    this.receiveBuffer = Buffer.alloc(0);
                    return;
                }
                continue;
            }

            // Read total length from header bytes 8-9
            const totalLen = (this.receiveBuffer[8] << 8) | this.receiveBuffer[9];

            if (totalLen < HEADER_SIZE || totalLen > 65535) {
                // Invalid length, skip this byte
                this.receiveBuffer = this.receiveBuffer.slice(1);
                continue;
            }

            // Wait for complete message
            if (this.receiveBuffer.length < totalLen) {
                break;
            }

            // Extract complete message
            const message = this.receiveBuffer.slice(0, totalLen);
            this.receiveBuffer = this.receiveBuffer.slice(totalLen);

            this.emit("message", message);
        }
    }

    _handleDisconnect() {
        const wasConnected = this.connected;
        this.connected = false;
        this._stopKeepAlive();

        if (wasConnected) {
            this.emit("disconnected");
        }

        if (!this.destroyed && !this.cloudPaused) {
            this._scheduleReconnect();
        }
    }

    _startKeepAlive() {
        this._stopKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.connected && this.socket) {
                this.socket.write(Buffer.from([0x00]), () => {});
            }
        }, KEEP_ALIVE_INTERVAL);
    }

    _stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    _startCloudPauseCheck() {
        this._stopCloudPauseCheck();
        this.cloudPauseTimer = setInterval(() => {
            if (this.destroyed) return;

            const shouldPause = this.isCloudPauseActive();

            if (shouldPause && !this.cloudPaused && this.connected) {
                // Enter cloud pause: disconnect
                this.cloudPaused = true;
                this.emit("cloudPause", true);
                this._stopKeepAlive();
                if (this.socket) {
                    this.socket.destroy();
                    this.socket = null;
                }
                this.connected = false;

                // Schedule reconnect after pause duration
                setTimeout(() => {
                    if (!this.destroyed) {
                        this.cloudPaused = false;
                        this.emit("cloudPause", false);
                        this.connect();
                    }
                }, this.cloudPauseDuration);
            }
        }, 1000);
    }

    _stopCloudPauseCheck() {
        if (this.cloudPauseTimer) {
            clearInterval(this.cloudPauseTimer);
            this.cloudPauseTimer = null;
        }
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed) {
                this.connect();
            }
        }, this.reconnectDelay);
        // Exponential backoff: 5s → 10s → 20s → 40s → 80s → 160s → 300s (max)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_DELAY_MAX);
    }

    _stopTimers() {
        this._stopKeepAlive();
        this._stopCloudPauseCheck();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}

module.exports = DtuConnection;
