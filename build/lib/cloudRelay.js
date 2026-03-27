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
const RECONNECT_DELAY = 10000;
const HEARTBEAT_INTERVAL = 60000; // 60s heartbeat (PCAP: DTU sends HB every 60s)
const REALDATA_INTERVAL = 300000; // 5 min RealData (matches DTU default sendTime=5min)
// Cloud protocol uses 0x22/0x23 prefix (different from local 0xa2/0xa3!)
const CLOUD_CMD_HEARTBEAT = [0x22, 0x02]; // HBReqDTO
const CLOUD_CMD_REALDATA = [0x22, 0x0c]; // RealDataReqDTO
/**
 * Cloud Relay: Sends DTU data to the Hoymiles cloud server.
 * Uses the cloud protocol (0x22/0x23 tags) instead of local protocol (0xa2/0xa3).
 * Emulates the DTU's cloud connection: periodic heartbeats + RealData forwarding.
 */
class CloudRelay extends node_events_1.EventEmitter {
    connected;
    host;
    port;
    socket;
    destroyed;
    reconnectTimer;
    heartbeatTimer;
    realDataTimer;
    protobuf;
    dtuSn;
    timezoneOffset;
    lastRealDataPayload;
    constructor(host, port) {
        super();
        this.host = host;
        this.port = port;
        this.socket = null;
        this.connected = false;
        this.destroyed = false;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.realDataTimer = null;
        this.protobuf = null;
        this.dtuSn = "";
        this.timezoneOffset = 3600;
        this.lastRealDataPayload = null;
    }
    /**
     * Configure the relay with DTU info needed for cloud messages.
     *
     * @param protobuf - ProtobufHandler instance for encoding messages
     * @param dtuSn - DTU serial number for cloud identification
     * @param timezoneOffset - Timezone offset in seconds (default 3600)
     */
    configure(protobuf, dtuSn, timezoneOffset) {
        this.protobuf = protobuf;
        this.dtuSn = dtuSn;
        if (timezoneOffset !== undefined) {
            this.timezoneOffset = timezoneOffset;
        }
    }
    /**
     * Store the latest RealData protobuf payload from local DTU response.
     *
     * @param rawLocalMessage - Raw HM-framed message from local DTU connection
     */
    updateRealData(rawLocalMessage) {
        // Store the raw local RealData response — we'll re-frame it for cloud
        if (rawLocalMessage.length > 10) {
            this.lastRealDataPayload = Buffer.from(rawLocalMessage.subarray(10)); // Strip HM header
        }
    }
    connect() {
        if (this.destroyed) {
            return;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.socket = new net.Socket();
        this.socket.setKeepAlive(true);
        this.socket.connect(this.port, this.host, () => {
            this.connected = true;
            this.emit("connected");
            this._sendHeartbeat();
            this._startTimers();
        });
        this.socket.on("data", () => {
            // Cloud responses — acknowledged, no processing needed
        });
        this.socket.on("error", (err) => {
            this.emit("error", err);
            this._handleDisconnect();
        });
        this.socket.on("close", () => {
            this._handleDisconnect();
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
    }
    /** Build and send a cloud heartbeat (HBReqDTO, tag 0x22 0x02). */
    _sendHeartbeat() {
        if (!this.connected || !this.socket || !this.protobuf) {
            return;
        }
        const HBReqDTO = this.protobuf.protos.APPHeartbeatPB.lookupType("HBReqDTO");
        const msg = HBReqDTO.create({
            offset: this.timezoneOffset,
            time: Math.floor(Date.now() / 1000),
            csq: -69, // Signal quality placeholder
            dtuSerialNumber: this.dtuSn,
        });
        const payload = HBReqDTO.encode(msg).finish();
        const frame = this._buildCloudMessage(CLOUD_CMD_HEARTBEAT[0], CLOUD_CMD_HEARTBEAT[1], payload);
        this.socket.write(frame);
    }
    /** Build and send RealData to cloud (tag 0x22 0x0c). */
    _sendRealData() {
        if (!this.connected || !this.socket || !this.lastRealDataPayload) {
            return;
        }
        // Forward the raw protobuf payload with cloud framing
        const frame = this._buildCloudMessage(CLOUD_CMD_REALDATA[0], CLOUD_CMD_REALDATA[1], this.lastRealDataPayload);
        this.socket.write(frame);
    }
    /**
     * Build HM-framed message with cloud tags and sequence numbers.
     *
     * @param cmdHigh - High byte of cloud command tag
     * @param cmdLow - Low byte of cloud command tag
     * @param protobufPayload - Encoded protobuf data
     */
    _buildCloudMessage(cmdHigh, cmdLow, protobufPayload) {
        if (!this.protobuf) {
            throw new Error("Protobuf not configured");
        }
        // Use protobufHandler's buildMessage which handles seq + CRC
        return this.protobuf.buildMessage(cmdHigh, cmdLow, protobufPayload);
    }
    _startTimers() {
        this._stopTimers();
        // Heartbeat every ~55s
        this.heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL);
        // Forward latest RealData every ~5 min
        this.realDataTimer = setInterval(() => this._sendRealData(), REALDATA_INTERVAL);
    }
    _handleDisconnect() {
        const wasConnected = this.connected;
        this.connected = false;
        this._stopTimers();
        if (this.destroyed) {
            if (wasConnected) {
                this.emit("disconnected");
            }
            return;
        }
        if (wasConnected) {
            this.emit("disconnected");
        }
        if (!this.reconnectTimer) {
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (!this.destroyed) {
                    this.connect();
                }
            }, RECONNECT_DELAY);
        }
    }
    _stopTimers() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.realDataTimer) {
            clearInterval(this.realDataTimer);
            this.realDataTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
module.exports = CloudRelay;
//# sourceMappingURL=cloudRelay.js.map