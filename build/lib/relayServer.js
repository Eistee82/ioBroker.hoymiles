import * as net from "node:net";
import { EventEmitter } from "node:events";
import { HEADER_SIZE } from "./protobufHandler.js";
import { HM_MAGIC_0, HM_MAGIC_1, RELAY_SERVER_MAX_BUFFER_SIZE, RELAY_SERVER_IDLE_TIMEOUT_MS } from "./constants.js";
import { errorMessage, clearTimer } from "./utils.js";
const MAGIC = Buffer.from([HM_MAGIC_0, HM_MAGIC_1]);
class RelayServer extends EventEmitter {
    server;
    sessions;
    nextSessionId;
    cloudHost;
    cloudPort;
    protobuf;
    log;
    constructor(protobuf, log = () => { }) {
        super();
        this.protobuf = protobuf;
        this.log = log;
        this.server = null;
        this.sessions = new Map();
        this.nextSessionId = 1;
        this.cloudHost = "";
        this.cloudPort = 0;
    }
    get listening() {
        return !!this.server?.listening;
    }
    get sessionCount() {
        return this.sessions.size;
    }
    start(port, cloudHost, cloudPort) {
        if (this.server) {
            return;
        }
        this.cloudHost = cloudHost;
        this.cloudPort = cloudPort;
        const server = net.createServer(socket => this._onConnection(socket));
        server.on("error", (err) => {
            this.emit("error", new Error(`RelayServer listen error: ${errorMessage(err)}`));
        });
        server.listen(port, () => {
            const addr = server.address();
            this.emit("listening", typeof addr === "object" && addr ? addr.port : port);
        });
        this.server = server;
    }
    stop() {
        for (const session of this.sessions.values()) {
            this._closeSession(session, "server stopping");
        }
        this.sessions.clear();
        if (this.server) {
            const server = this.server;
            this.server = null;
            server.removeAllListeners();
            server.close();
        }
    }
    sendToDevice(dtuSn, frame) {
        for (const session of this.sessions.values()) {
            if (session.dtuSn === dtuSn && session.clientSocket.writable) {
                session.clientSocket.write(frame, (err) => {
                    if (err) {
                        this.emit("error", new Error(`RelayServer sendToDevice(${dtuSn}) failed: ${errorMessage(err)}`));
                    }
                });
                return true;
            }
        }
        return false;
    }
    _onConnection(clientSocket) {
        const id = this.nextSessionId++;
        const remoteAddress = `${clientSocket.remoteAddress ?? "?"}:${clientSocket.remotePort ?? "?"}`;
        const cloudSocket = new net.Socket();
        const session = {
            id,
            clientSocket,
            cloudSocket,
            dtuSn: "",
            upBuffer: Buffer.alloc(0),
            downBuffer: Buffer.alloc(0),
            closed: false,
            idleTimer: null,
        };
        this.sessions.set(id, session);
        this._resetIdleTimer(session);
        clientSocket.setKeepAlive(true);
        cloudSocket.setKeepAlive(true);
        clientSocket.on("data", (chunk) => {
            this._resetIdleTimer(session);
            if (cloudSocket.writable) {
                cloudSocket.write(chunk);
            }
            this._sniff(session, chunk, "uplink");
        });
        cloudSocket.on("data", (chunk) => {
            this._resetIdleTimer(session);
            if (clientSocket.writable) {
                clientSocket.write(chunk);
            }
            this._sniff(session, chunk, "downlink");
        });
        clientSocket.on("error", (err) => {
            this.log(`RelayServer session ${id}: client error: ${errorMessage(err)}`);
        });
        cloudSocket.on("error", (err) => {
            this.log(`RelayServer session ${id}: upstream error: ${errorMessage(err)}`);
        });
        clientSocket.on("close", () => this._closeSession(session, "client closed"));
        cloudSocket.on("close", () => this._closeSession(session, "upstream closed"));
        cloudSocket.connect(this.cloudPort, this.cloudHost);
        const evt = { sessionId: id, remoteAddress };
        this.emit("connection", evt);
    }
    _closeSession(session, reason) {
        if (session.closed) {
            return;
        }
        session.closed = true;
        session.idleTimer = clearTimer(session.idleTimer);
        this.sessions.delete(session.id);
        this._destroySocket(session.clientSocket);
        this._destroySocket(session.cloudSocket);
        const evt = { sessionId: session.id, dtuSn: session.dtuSn, reason };
        this.emit("disconnection", evt);
    }
    _resetIdleTimer(session) {
        session.idleTimer = clearTimer(session.idleTimer);
        if (session.closed) {
            return;
        }
        session.idleTimer = setTimeout(() => {
            this._closeSession(session, "idle timeout");
        }, RELAY_SERVER_IDLE_TIMEOUT_MS);
    }
    _destroySocket(socket) {
        socket.removeAllListeners();
        socket.on("error", () => { });
        socket.destroy();
    }
    _sniff(session, chunk, direction) {
        const key = direction === "uplink" ? "upBuffer" : "downBuffer";
        let buf = session[key].length ? Buffer.concat([session[key], chunk]) : chunk;
        if (buf.length > RELAY_SERVER_MAX_BUFFER_SIZE) {
            this.emit("error", new Error(`RelayServer session ${session.id}: ${direction} sniff buffer overflow, discarding`));
            session[key] = Buffer.alloc(0);
            return;
        }
        while (buf.length >= HEADER_SIZE) {
            if (buf[0] !== HM_MAGIC_0 || buf[1] !== HM_MAGIC_1) {
                const idx = buf.indexOf(MAGIC, 1);
                if (idx === -1) {
                    buf = Buffer.alloc(0);
                    break;
                }
                buf = buf.subarray(idx);
                continue;
            }
            const total = (buf[8] << 8) | buf[9];
            if (total < HEADER_SIZE || total > 65535) {
                buf = buf.subarray(1);
                continue;
            }
            if (buf.length < total) {
                break;
            }
            const frame = Buffer.from(buf.subarray(0, total));
            buf = buf.subarray(total);
            this._handleFrame(session, frame, direction);
        }
        session[key] = buf;
    }
    _handleFrame(session, frame, direction) {
        const parsed = this.protobuf.parseResponse(frame);
        if (!parsed) {
            return;
        }
        const { cmdHigh, cmdLow, payload } = parsed;
        const seq = (frame[4] << 8) | frame[5];
        if (direction === "uplink" && cmdHigh === 0x22 && cmdLow === 0x02) {
            try {
                const obj = this.protobuf.decodePayload("APPHeartbeatPB", "HBReqDTO", payload);
                this._identify(session, obj.dtuSerialNumber || "");
            }
            catch (err) {
                this.log(`RelayServer session ${session.id}: heartbeat decode failed: ${errorMessage(err)}`);
            }
            return;
        }
        if (direction === "downlink" && cmdHigh === 0x23 && (cmdLow === 0x0c || cmdLow === 0x0d)) {
            return;
        }
        if (direction === "uplink" && cmdHigh === 0x22 && (cmdLow === 0x0c || cmdLow === 0x0d)) {
            let data = null;
            try {
                data = this.protobuf.decodeRealDataNew(payload);
                this._identify(session, data.dtuSn);
            }
            catch (err) {
                this.log(`RelayServer session ${session.id}: RealData decode failed: ${errorMessage(err)}`);
            }
            const evt = {
                sessionId: session.id,
                dtuSn: session.dtuSn,
                seq,
                statusOnly: cmdLow === 0x0d,
                data,
            };
            this.emit("realData", evt);
            return;
        }
        const evt = {
            sessionId: session.id,
            dtuSn: session.dtuSn,
            direction,
            cmdHigh,
            cmdLow,
            seq,
            payload,
        };
        this.emit("command", evt);
    }
    _identify(session, dtuSn) {
        if (!dtuSn || dtuSn === session.dtuSn) {
            return;
        }
        session.dtuSn = dtuSn;
        const evt = { sessionId: session.id, dtuSn };
        this.emit("deviceIdentified", evt);
    }
}
export default RelayServer;
//# sourceMappingURL=relayServer.js.map