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
const HEARTBEAT_TIMEOUT = 20000; // 20s idle → send heartbeat (like the app)
const RECONNECT_DELAY_MIN = 1000;
const RECONNECT_DELAY_MAX = 60000;
const MAX_FAILED_SENDS = 10;
const MIN_REQUEST_INTERVAL = 500; // 500ms between requests for fast polling
const IDLE_TIMEOUT = 300000; // 5 min no data → reconnect
class DtuConnection extends node_events_1.EventEmitter {
    connected;
    host;
    port;
    heartbeatGenerator;
    socket;
    receiveBuffer;
    heartbeatTimer;
    reconnectTimer;
    idleTimer;
    lastRequestTime;
    destroyed;
    reconnectDelay;
    consecutiveFailedSends;
    constructor(host, port, heartbeatGenerator) {
        super();
        this.host = host;
        this.port = port;
        this.heartbeatGenerator = heartbeatGenerator || null;
        this.socket = null;
        this.connected = false;
        this.receiveBuffer = Buffer.alloc(0);
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.idleTimer = null;
        this.lastRequestTime = 0;
        this.destroyed = false;
        this.reconnectDelay = RECONNECT_DELAY_MIN;
        this.consecutiveFailedSends = 0;
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
        this.socket.setKeepAlive(true);
        this.socket.connect(this.port, this.host, () => {
            this.connected = true;
            this.reconnectDelay = RECONNECT_DELAY_MIN;
            this.consecutiveFailedSends = 0;
            this._resetHeartbeatTimer();
            this._resetIdleTimer();
            this.emit("connected");
        });
        this.socket.on("data", (chunk) => this._onData(chunk));
        this.socket.on("error", (err) => this._handleDisconnect(err));
        this.socket.on("close", () => this._handleDisconnect(null));
    }
    disconnect() {
        this.destroyed = true;
        this._stopTimers();
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }
    async send(buffer) {
        if (!this.connected || !this.socket) {
            return false;
        }
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < MIN_REQUEST_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
        }
        this.lastRequestTime = Date.now();
        this._resetHeartbeatTimer();
        if (!this.socket || !this.connected) {
            return false;
        }
        return new Promise(resolve => {
            this.socket.write(buffer, err => {
                if (err) {
                    this.consecutiveFailedSends++;
                    if (this.consecutiveFailedSends >= MAX_FAILED_SENDS) {
                        this.socket?.destroy();
                    }
                    resolve(false);
                }
                else {
                    this.consecutiveFailedSends = 0;
                    resolve(true);
                }
            });
        });
    }
    _onData(chunk) {
        this._resetIdleTimer();
        this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
        while (this.receiveBuffer.length >= HEADER_SIZE) {
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
        this._stopTimers();
        if (!wasConnected || this.destroyed) {
            if (wasConnected) {
                this.emit("disconnected");
            }
            return;
        }
        if (err) {
            this.emit("error", err);
        }
        this.emit("disconnected");
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_DELAY_MAX);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed) {
                this.connect();
            }
        }, delay);
    }
    /** Heartbeat only fires after 20s of idle (no send() calls). */
    _resetHeartbeatTimer() {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
        }
        this.heartbeatTimer = setTimeout(() => {
            if (this.connected && this.socket && this.heartbeatGenerator) {
                this.socket.write(this.heartbeatGenerator(), err => {
                    if (err) {
                        this.consecutiveFailedSends++;
                        if (this.consecutiveFailedSends >= MAX_FAILED_SENDS) {
                            this.socket?.destroy();
                        }
                    }
                    else {
                        this.consecutiveFailedSends = 0;
                    }
                });
                this._resetHeartbeatTimer();
            }
        }, HEARTBEAT_TIMEOUT);
    }
    _resetIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => {
            if (this.connected) {
                this.emit("idle");
                this.socket?.destroy();
            }
        }, IDLE_TIMEOUT);
    }
    _stopTimers() {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}
module.exports = DtuConnection;
//# sourceMappingURL=dtuConnection.js.map