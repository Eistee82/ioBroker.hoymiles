import TcpConnection from "./tcpConnection.js";
import { HM_MAGIC_0, HM_MAGIC_1 } from "./constants.js";
const MAGIC_HEADER = Buffer.from([HM_MAGIC_0, HM_MAGIC_1]);
const HEADER_SIZE = 10;
const HEARTBEAT_TIMEOUT = 20000;
const RECONNECT_DELAY_MIN = 1000;
const RECONNECT_DELAY_MAX = 300000;
const MAX_FAILED_SENDS = 10;
const MIN_REQUEST_INTERVAL = 500;
const IDLE_TIMEOUT = 300000;
const INITIAL_BUFFER_SIZE = 4096;
const MAX_BUFFER_SIZE = 131072;
class DtuConnection extends TcpConnection {
    heartbeatGenerator;
    receiveBuffer;
    receiveBufferLen;
    heartbeatTimer;
    idleTimer;
    lastRequestTime;
    consecutiveFailedSends;
    constructor(host, port, heartbeatGenerator, timers) {
        super(host, port, RECONNECT_DELAY_MIN, RECONNECT_DELAY_MAX, timers);
        this.heartbeatGenerator = heartbeatGenerator || null;
        this.receiveBuffer = Buffer.alloc(INITIAL_BUFFER_SIZE);
        this.receiveBufferLen = 0;
        this.heartbeatTimer = undefined;
        this.idleTimer = undefined;
        this.lastRequestTime = 0;
        this.consecutiveFailedSends = 0;
    }
    connect() {
        this.receiveBufferLen = 0;
        super.connect();
    }
    async send(buffer) {
        if (!this.connected || !this.socket) {
            return false;
        }
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < MIN_REQUEST_INTERVAL) {
            await new Promise(resolve => globalThis.setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
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
    _configureSocket(socket) {
        socket.setKeepAlive(true);
        socket.on("data", (chunk) => this._onData(chunk));
    }
    _onConnected() {
        this.consecutiveFailedSends = 0;
        this._resetHeartbeatTimer();
        this._resetIdleTimer();
        this.emit("connected");
    }
    _stopSessionTimers() {
        this.heartbeatTimer = this.clearManagedTimeout(this.heartbeatTimer);
        this.idleTimer = this.clearManagedTimeout(this.idleTimer);
    }
    _onData(chunk) {
        this._resetIdleTimer();
        const needed = this.receiveBufferLen + chunk.length;
        if (needed > MAX_BUFFER_SIZE) {
            this.emit("error", new Error(`Receive buffer overflow (${needed} bytes), discarding buffer`));
            this.receiveBufferLen = 0;
            return;
        }
        if (needed > this.receiveBuffer.length) {
            const newSize = Math.min(this.receiveBuffer.length * 2, MAX_BUFFER_SIZE);
            const newBuf = Buffer.alloc(Math.max(newSize, needed));
            this.receiveBuffer.copy(newBuf, 0, 0, this.receiveBufferLen);
            this.receiveBuffer = newBuf;
        }
        chunk.copy(this.receiveBuffer, this.receiveBufferLen);
        this.receiveBufferLen += chunk.length;
        while (this.receiveBufferLen >= HEADER_SIZE) {
            if (this.receiveBuffer[0] !== HM_MAGIC_0 || this.receiveBuffer[1] !== HM_MAGIC_1) {
                const idx = this.receiveBuffer.subarray(0, this.receiveBufferLen).indexOf(MAGIC_HEADER, 1);
                if (idx === -1) {
                    this.receiveBufferLen = 0;
                    return;
                }
                this.receiveBuffer.copy(this.receiveBuffer, 0, idx, this.receiveBufferLen);
                this.receiveBufferLen -= idx;
                continue;
            }
            const totalLen = (this.receiveBuffer[8] << 8) | this.receiveBuffer[9];
            if (totalLen < HEADER_SIZE || totalLen > 65535) {
                this.receiveBuffer.copy(this.receiveBuffer, 0, 1, this.receiveBufferLen);
                this.receiveBufferLen -= 1;
                continue;
            }
            if (this.receiveBufferLen < totalLen) {
                break;
            }
            const message = Buffer.from(this.receiveBuffer.subarray(0, totalLen));
            this.receiveBuffer.copy(this.receiveBuffer, 0, totalLen, this.receiveBufferLen);
            this.receiveBufferLen -= totalLen;
            this.emit("message", message);
        }
    }
    _resetHeartbeatTimer() {
        this.heartbeatTimer = this.clearManagedTimeout(this.heartbeatTimer);
        if (this.destroyed) {
            return;
        }
        this.heartbeatTimer = this.timers.setTimeout(() => {
            if (this.destroyed) {
                return;
            }
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
        this.idleTimer = this.clearManagedTimeout(this.idleTimer);
        if (this.destroyed) {
            return;
        }
        this.idleTimer = this.timers.setTimeout(() => {
            if (this.destroyed) {
                return;
            }
            if (this.connected) {
                this.emit("idle");
                this.socket?.destroy();
            }
        }, IDLE_TIMEOUT);
    }
}
export default DtuConnection;
//# sourceMappingURL=dtuConnection.js.map