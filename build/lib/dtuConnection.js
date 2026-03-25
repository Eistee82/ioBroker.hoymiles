"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const net = __importStar(require("node:net"));
const node_events_1 = require("node:events");
const MAGIC_0 = 0x48;
const MAGIC_1 = 0x4d;
const HEADER_SIZE = 10;
const KEEP_ALIVE_INTERVAL = 10000; // 10 seconds
const RECONNECT_DELAY_MIN = 5000; // 5 seconds
const RECONNECT_DELAY_MAX = 300000; // 5 minutes
const MIN_REQUEST_INTERVAL = 2000; // 2 seconds between requests
const SOCKET_TIMEOUT = 30000; // 30 seconds
const RECONNECT_PAUSE = 10000; // 10 seconds pause after DTU disconnect before reconnecting
class DtuConnection extends node_events_1.EventEmitter {
    connected;
    reconnectPaused;
    host;
    port;
    socket;
    receiveBuffer;
    keepAliveTimer;
    reconnectTimer;
    lastRequestTime;
    destroyed;
    reconnectDelay;
    consecutiveErrors;
    constructor(host, port) {
        super();
        this.host = host;
        this.port = port;
        this.socket = null;
        this.connected = false;
        this.receiveBuffer = Buffer.alloc(0);
        this.keepAliveTimer = null;
        this.reconnectTimer = null;
        this.reconnectPaused = false;
        this.lastRequestTime = 0;
        this.destroyed = false;
        this.reconnectDelay = RECONNECT_DELAY_MIN;
        this.consecutiveErrors = 0;
    }
    connect() {
        if (this.destroyed) {
            return;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.receiveBuffer = Buffer.alloc(0);
        this.socket = new net.Socket();
        this.socket.setTimeout(SOCKET_TIMEOUT);
        this.socket.connect(this.port, this.host, () => {
            this.connected = true;
            this.reconnectPaused = false;
            this.reconnectDelay = RECONNECT_DELAY_MIN;
            this.consecutiveErrors = 0;
            this._startKeepAlive();
            this.emit("connected");
        });
        this.socket.on("data", (chunk) => this._onData(chunk));
        this.socket.on("error", (err) => {
            this.consecutiveErrors++;
            this._handleDisconnect(err);
        });
        this.socket.on("close", () => {
            this._handleDisconnect(null);
        });
        this.socket.on("timeout", () => {
            if (this.socket) {
                this.socket.destroy();
            }
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
        this.reconnectPaused = false;
    }
    async send(buffer) {
        if (!this.connected || !this.socket || this.reconnectPaused) {
            return false;
        }
        // Enforce minimum request interval
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < MIN_REQUEST_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
        }
        this.lastRequestTime = Date.now();
        return new Promise(resolve => {
            this.socket.write(buffer, err => {
                resolve(!err);
            });
        });
    }
    _onData(chunk) {
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
        while (this.receiveBuffer.length >= HEADER_SIZE) {
            // Find magic bytes
            if (this.receiveBuffer[0] !== MAGIC_0 || this.receiveBuffer[1] !== MAGIC_1) {
                let found = false;
                for (let i = 1; i < this.receiveBuffer.length - 1; i++) {
                    if (this.receiveBuffer[i] === MAGIC_0 && this.receiveBuffer[i + 1] === MAGIC_1) {
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
            const totalLen = (this.receiveBuffer[8] << 8) | this.receiveBuffer[9];
            if (totalLen < HEADER_SIZE || totalLen > 65535) {
                this.receiveBuffer = this.receiveBuffer.slice(1);
                continue;
            }
            if (this.receiveBuffer.length < totalLen) {
                break;
            }
            const message = this.receiveBuffer.slice(0, totalLen);
            this.receiveBuffer = this.receiveBuffer.slice(totalLen);
            this.emit("message", message);
        }
    }
    _handleDisconnect(err) {
        const wasConnected = this.connected;
        this.connected = false;
        this._stopKeepAlive();
        if (!wasConnected) {
            return;
        }
        if (this.destroyed) {
            this.emit("disconnected");
            return;
        }
        // DTU dropped us — give it time to recover before reconnecting
        this.reconnectPaused = true;
        this.emit("reconnectPause", true);
        if (err && this.consecutiveErrors === 1) {
            this.emit("error", err, this.consecutiveErrors);
        }
        else if (err && this.consecutiveErrors % 10 === 0) {
            this.emit("error", err, this.consecutiveErrors);
        }
        this.emit("disconnected");
        // Wait before reconnecting to let DTU recover
        this._scheduleReconnect(RECONNECT_PAUSE);
    }
    _startKeepAlive() {
        this._stopKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.connected && this.socket) {
                this.socket.write(Buffer.from([0x00]), () => { });
            }
        }, KEEP_ALIVE_INTERVAL);
    }
    _stopKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }
    _scheduleReconnect(delay) {
        if (this.reconnectTimer) {
            return;
        }
        const reconnectMs = delay ?? this.reconnectDelay;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed) {
                this.reconnectPaused = false;
                this.emit("reconnectPause", false);
                this.connect();
            }
        }, reconnectMs);
        // Only apply backoff for actual errors, not reconnect pauses
        if (!delay) {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_DELAY_MAX);
        }
    }
    _stopTimers() {
        this._stopKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
module.exports = DtuConnection;
//# sourceMappingURL=dtuConnection.js.map