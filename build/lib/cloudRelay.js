import TcpConnection from "./tcpConnection.js";
import { unixSeconds } from "./utils.js";
import { CLOUD_RECONNECT_DELAY_MIN_MS, CLOUD_RECONNECT_DELAY_MAX_MS, CLOUD_HEARTBEAT_INTERVAL_MS, CLOUD_SOCKET_TIMEOUT_MS, CLOUD_DEFAULT_REALDATA_INTERVAL_MS, CLOUD_MIN_REALDATA_INTERVAL_MS, } from "./constants.js";
const CLOUD_CMD_HEARTBEAT = [0x22, 0x02];
const CLOUD_CMD_REALDATA = [0x22, 0x0c];
const CLOUD_CMD_REALDATA_STATUS = [0x22, 0x0d];
const ACK_ONLY = new Set([0x01, 0x02, 0x0c, 0x0d]);
class CloudRelay extends TcpConnection {
    paused;
    heartbeatTimer;
    realDataTimer;
    pauseTimer;
    protobuf;
    dtuSn;
    timezoneOffset;
    lastRealDataPayload;
    lastRealDataTimestamp;
    seq;
    realDataIntervalMs;
    rxBuffer;
    constructor(host, port, timers) {
        super(host, port, CLOUD_RECONNECT_DELAY_MIN_MS, CLOUD_RECONNECT_DELAY_MAX_MS, timers);
        this.paused = false;
        this.heartbeatTimer = undefined;
        this.realDataTimer = undefined;
        this.pauseTimer = undefined;
        this.protobuf = null;
        this.dtuSn = "";
        this.timezoneOffset = -new Date().getTimezoneOffset() * 60;
        this.lastRealDataPayload = null;
        this.lastRealDataTimestamp = 0;
        this.seq = 0;
        this.realDataIntervalMs = CLOUD_DEFAULT_REALDATA_INTERVAL_MS;
        this.rxBuffer = Buffer.alloc(0);
    }
    configure(protobuf, dtuSn, timezoneOffset) {
        if (!dtuSn) {
            throw new Error("CloudRelay.configure: dtuSn is required");
        }
        this.protobuf = protobuf;
        this.dtuSn = dtuSn;
        if (timezoneOffset !== undefined) {
            this.timezoneOffset = timezoneOffset;
        }
    }
    setRealDataInterval(minutes) {
        if (minutes <= 0) {
            return;
        }
        const newInterval = Math.max(minutes * 60 * 1000, CLOUD_MIN_REALDATA_INTERVAL_MS);
        if (newInterval === this.realDataIntervalMs) {
            return;
        }
        this.realDataIntervalMs = newInterval;
        if (this.connected && !this.paused && !this.destroyed) {
            this._stopSessionTimers();
            this._startTimers();
        }
    }
    updateRealData(rawLocalMessage) {
        if (rawLocalMessage.length > 10) {
            this.lastRealDataPayload = Buffer.from(rawLocalMessage.subarray(10));
            this.lastRealDataTimestamp = Date.now();
        }
    }
    sendFinalAndPause() {
        this.paused = true;
        this._stopSessionTimers();
        if (this.destroyed) {
            return;
        }
        try {
            this._sendRealData();
        }
        catch (err) {
            this.emit("error", new Error(`CloudRelay final send failed: ${err.message}`));
        }
        this.pauseTimer = this.clearManagedTimeout(this.pauseTimer);
        this.pauseTimer = this.timers.setTimeout(() => {
            this.pauseTimer = undefined;
            if (this.destroyed) {
                return;
            }
            if (this.paused && this.socket) {
                this.socket.removeAllListeners();
                this.socket.on("error", () => { });
                this.socket.destroy();
                this.socket = null;
                this._handleDisconnect(null);
            }
        }, 2000);
    }
    resume() {
        this.paused = false;
        this.pauseTimer = this.clearManagedTimeout(this.pauseTimer);
        if (!this.connected && !this.destroyed) {
            this.connect();
        }
        else if (this.connected) {
            this._sendHeartbeat();
            this._startTimers();
        }
    }
    _configureSocket(socket) {
        socket.setKeepAlive(true, CLOUD_HEARTBEAT_INTERVAL_MS);
        socket.setTimeout(CLOUD_SOCKET_TIMEOUT_MS);
        socket.on("data", (data) => {
            this.emit("dataReceived", data.length);
            this._onDownlink(data);
        });
        socket.on("timeout", () => {
            this.emit("error", new Error("Socket timeout — no heartbeat response received"));
            socket.destroy();
        });
    }
    _onConnected() {
        this.emit("connected");
        this._sendHeartbeat();
        if (this.lastRealDataPayload) {
            this._sendRealData();
        }
        if (!this.paused) {
            this._startTimers();
        }
    }
    _stopSessionTimers() {
        this.heartbeatTimer = this.clearManagedInterval(this.heartbeatTimer);
        this.realDataTimer = this.clearManagedInterval(this.realDataTimer);
    }
    _stopAllTimers() {
        super._stopAllTimers();
        this.pauseTimer = this.clearManagedTimeout(this.pauseTimer);
    }
    _shouldReconnect() {
        return !this.paused;
    }
    _sendHeartbeat() {
        if (!this.connected || !this.socket || !this.protobuf) {
            return;
        }
        const HBReqDTO = this.protobuf.getType("APPHeartbeatPB", "HBReqDTO");
        const msg = HBReqDTO.create({
            offset: this.timezoneOffset,
            time: unixSeconds(),
            csq: -69,
            dtuSerialNumber: this.dtuSn,
            unknownField6: 550,
        });
        const payload = HBReqDTO.encode(msg).finish();
        const frame = this._buildCloudMessage(CLOUD_CMD_HEARTBEAT[0], CLOUD_CMD_HEARTBEAT[1], payload);
        this._safeWrite(frame);
        this.emit("heartbeatSent", this.seq);
    }
    _sendRealDataStatus() {
        if (!this.connected || !this.socket || !this.lastRealDataPayload) {
            return;
        }
        const frame = this._buildCloudMessage(CLOUD_CMD_REALDATA_STATUS[0], CLOUD_CMD_REALDATA_STATUS[1], this.lastRealDataPayload);
        this._safeWrite(frame);
    }
    _sendRealData() {
        if (!this.connected || !this.socket || !this.lastRealDataPayload) {
            return;
        }
        if (Date.now() - this.lastRealDataTimestamp > this.realDataIntervalMs * 2) {
            return;
        }
        const frame = this._buildCloudMessage(CLOUD_CMD_REALDATA[0], CLOUD_CMD_REALDATA[1], this.lastRealDataPayload);
        this._safeWrite(frame);
        this.emit("dataSent");
    }
    _buildCloudMessage(cmdHigh, cmdLow, protobufPayload) {
        if (!this.protobuf) {
            throw new Error("Protobuf not configured");
        }
        const seq = this.seq;
        this.seq = seq >= 60000 ? 0 : seq + 1;
        return this.protobuf.buildMessage(cmdHigh, cmdLow, protobufPayload, seq);
    }
    sendFrame(frame) {
        if (!this.connected || !this.socket) {
            return;
        }
        this._safeWrite(frame);
    }
    _onDownlink(chunk) {
        if (!this.protobuf) {
            return;
        }
        this.rxBuffer = this.rxBuffer.length ? Buffer.concat([this.rxBuffer, chunk]) : chunk;
        while (this.rxBuffer.length >= 10) {
            if (this.rxBuffer[0] !== 0x48 || this.rxBuffer[1] !== 0x4d) {
                const idx = this.rxBuffer.indexOf(Buffer.from([0x48, 0x4d]), 1);
                if (idx === -1) {
                    this.rxBuffer = Buffer.alloc(0);
                    return;
                }
                this.rxBuffer = this.rxBuffer.subarray(idx);
                continue;
            }
            const total = (this.rxBuffer[8] << 8) | this.rxBuffer[9];
            if (total < 10 || total > 65535) {
                this.rxBuffer = this.rxBuffer.subarray(1);
                continue;
            }
            if (this.rxBuffer.length < total) {
                break;
            }
            const frame = Buffer.from(this.rxBuffer.subarray(0, total));
            this.rxBuffer = this.rxBuffer.subarray(total);
            const parsed = this.protobuf.parseResponse(frame);
            if (!parsed) {
                continue;
            }
            const { cmdHigh, cmdLow, payload } = parsed;
            const seq = (frame[4] << 8) | frame[5];
            if (ACK_ONLY.has(cmdLow)) {
                this.emit("ack", { cmdHigh, cmdLow, seq, payload });
                continue;
            }
            this.emit("command", { cmdHigh, cmdLow, seq, payload });
        }
    }
    _safeWrite(data) {
        if (!this.socket) {
            return;
        }
        this.socket.write(data, err => {
            if (err) {
                this.emit("error", new Error(`CloudRelay write failed: ${err.message}`));
            }
        });
    }
    _startTimers() {
        this._stopSessionTimers();
        if (this.paused || this.destroyed) {
            return;
        }
        this.heartbeatTimer = this.timers.setInterval(() => {
            if (this.destroyed || this.paused) {
                return;
            }
            this._sendRealDataStatus();
            this._sendHeartbeat();
        }, CLOUD_HEARTBEAT_INTERVAL_MS);
        this.realDataTimer = this.timers.setInterval(() => {
            if (this.destroyed || this.paused) {
                return;
            }
            this._sendRealData();
        }, this.realDataIntervalMs);
    }
}
export default CloudRelay;
//# sourceMappingURL=cloudRelay.js.map