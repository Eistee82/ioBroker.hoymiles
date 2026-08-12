import type * as net from "node:net";
import TcpConnection, { type TimerScheduler } from "./tcpConnection.js";
import type { ProtobufHandler } from "./protobufHandler.js";
import { unixSeconds } from "./utils.js";
import {
	CLOUD_RECONNECT_DELAY_MIN_MS,
	CLOUD_RECONNECT_DELAY_MAX_MS,
	CLOUD_HEARTBEAT_INTERVAL_MS,
	CLOUD_SOCKET_TIMEOUT_MS,
	CLOUD_DEFAULT_REALDATA_INTERVAL_MS,
	CLOUD_MIN_REALDATA_INTERVAL_MS,
} from "./constants.js";

// Cloud protocol uses 0x22/0x23 prefix (different from local 0xa2/0xa3!)
const CLOUD_CMD_HEARTBEAT: [number, number] = [0x22, 0x02]; // HBReqDTO
const CLOUD_CMD_REALDATA: [number, number] = [0x22, 0x0c]; // RealDataReqDTO (every sendTime interval)
const CLOUD_CMD_REALDATA_STATUS: [number, number] = [0x22, 0x0d]; // RealDataReqDTO (every 60s with HB)

/**
 * Downlink tags that only ever acknowledge one of our uploads. They must not reach the
 * device: `0x2301`/`0x2302`/`0x230c`/`0x230d` are the cloud's answers to InfoData, heartbeat,
 * RealData and history. `0x2306` is deliberately absent — it is an acknowledgement too, but
 * the grid-profile serve keys off it, so it stays on the command path.
 */
const ACK_ONLY = new Set([0x01, 0x02, 0x0c, 0x0d]);

/**
 * Cloud Relay: Sends DTU data to the Hoymiles cloud server.
 * Uses the cloud protocol (0x22/0x23 tags) instead of local protocol (0xa2/0xa3).
 * Emulates the DTU's cloud connection: periodic heartbeats + RealData forwarding.
 *
 * Emits "dataSent" after each RealData upload so the adapter can schedule a cloud poll.
 */
class CloudRelay extends TcpConnection {
	public paused: boolean;

	private heartbeatTimer: ioBroker.Interval | undefined;
	private realDataTimer: ioBroker.Interval | undefined;
	private pauseTimer: ioBroker.Timeout | undefined;

	private protobuf: ProtobufHandler | null;
	private dtuSn: string;
	private timezoneOffset: number;
	private lastRealDataPayload: Buffer | null;
	private lastRealDataTimestamp: number;
	private seq: number;
	private realDataIntervalMs: number;
	/** Accumulator for splitting downlink (cloud→DTU) HM frames across TCP segments. */
	private rxBuffer: Buffer;

	/**
	 * @param host - Cloud relay server hostname
	 * @param port - Cloud relay server port
	 * @param timers - Adapter-managed timer scheduler; falls back to native timers when omitted
	 */
	constructor(host: string, port: number, timers?: TimerScheduler) {
		super(host, port, CLOUD_RECONNECT_DELAY_MIN_MS, CLOUD_RECONNECT_DELAY_MAX_MS, timers);
		this.paused = false;
		this.heartbeatTimer = undefined;
		this.realDataTimer = undefined;
		this.pauseTimer = undefined;
		this.protobuf = null;
		this.dtuSn = "";
		this.timezoneOffset = -new Date().getTimezoneOffset() * 60; // Local UTC offset in seconds
		this.lastRealDataPayload = null;
		this.lastRealDataTimestamp = 0;
		this.seq = 0;
		this.realDataIntervalMs = CLOUD_DEFAULT_REALDATA_INTERVAL_MS;
		this.rxBuffer = Buffer.alloc(0);
	}

	/**
	 * Configure the relay with DTU info needed for cloud messages.
	 *
	 * @param protobuf - ProtobufHandler instance for encoding messages
	 * @param dtuSn - DTU serial number for cloud identification
	 * @param timezoneOffset - Timezone offset in seconds (default 3600)
	 */
	configure(protobuf: ProtobufHandler, dtuSn: string, timezoneOffset?: number): void {
		if (!dtuSn) {
			throw new Error("CloudRelay.configure: dtuSn is required");
		}
		this.protobuf = protobuf;
		this.dtuSn = dtuSn;
		if (timezoneOffset !== undefined) {
			this.timezoneOffset = timezoneOffset;
		}
	}

	/**
	 * Set the RealData forwarding interval from DTU serverSendTime config.
	 * If connected and not paused, restarts timers immediately with the new interval.
	 *
	 * @param minutes - Interval in minutes (minimum 1)
	 */
	setRealDataInterval(minutes: number): void {
		if (minutes <= 0) {
			return;
		}
		const newInterval = Math.max(minutes * 60 * 1000, CLOUD_MIN_REALDATA_INTERVAL_MS);
		if (newInterval === this.realDataIntervalMs) {
			return; // No change — don't restart timers (would reset heartbeat countdown)
		}
		this.realDataIntervalMs = newInterval;
		// Restart timers immediately if actively running
		if (this.connected && !this.paused && !this.destroyed) {
			this._stopSessionTimers();
			this._startTimers();
		}
	}

	/**
	 * Store the latest RealData protobuf payload from local DTU response.
	 *
	 * @param rawLocalMessage - Raw HM-framed message from local DTU connection
	 */
	updateRealData(rawLocalMessage: Buffer): void {
		// Store the raw local RealData response — we'll re-frame it for cloud
		if (rawLocalMessage.length > 10) {
			this.lastRealDataPayload = Buffer.from(rawLocalMessage.subarray(10)); // Strip HM header
			this.lastRealDataTimestamp = Date.now();
		}
	}

	/**
	 * Send one final RealData upload, then disconnect from cloud server.
	 * Called when the local DTU connection drops (e.g. inverter offline at night).
	 */
	sendFinalAndPause(): void {
		this.paused = true;
		this._stopSessionTimers();
		if (this.destroyed) {
			return;
		}
		// Send last known data once so the cloud has the final state
		try {
			this._sendRealData();
		} catch (err) {
			this.emit("error", new Error(`CloudRelay final send failed: ${(err as Error).message}`));
		}
		// Disconnect from cloud server after a short delay (allow final send to flush)
		this.pauseTimer = this.clearManagedTimeout(this.pauseTimer);
		this.pauseTimer = this.timers.setTimeout(() => {
			this.pauseTimer = undefined;
			if (this.destroyed) {
				return;
			}
			if (this.paused && this.socket) {
				this.socket.removeAllListeners();
				this.socket.on("error", () => {});
				this.socket.destroy();
				this.socket = null;
				this._handleDisconnect(null);
			}
		}, 2000);
	}

	/**
	 * Resume relay activity: reconnect to cloud server and restart timers.
	 * Called when the local DTU connection is re-established.
	 */
	resume(): void {
		this.paused = false;
		// Clear pause timer if resume is called during the 2s delay
		this.pauseTimer = this.clearManagedTimeout(this.pauseTimer);
		if (!this.connected && !this.destroyed) {
			this.connect();
		} else if (this.connected) {
			this._sendHeartbeat();
			this._startTimers();
		}
	}

	/** @inheritdoc */
	protected _configureSocket(socket: net.Socket): void {
		socket.setKeepAlive(true, CLOUD_HEARTBEAT_INTERVAL_MS);
		// Server responds to each heartbeat (every 60s). If no data arrives in 90s, connection is dead.
		socket.setTimeout(CLOUD_SOCKET_TIMEOUT_MS);

		socket.on("data", (data: Buffer) => {
			this.emit("dataReceived", data.length);
			this._onDownlink(data);
		});

		socket.on("timeout", () => {
			this.emit("error", new Error("Socket timeout — no heartbeat response received"));
			socket.destroy();
		});
	}

	/** @inheritdoc */
	protected _onConnected(): void {
		this.emit("connected");
		this._sendHeartbeat();
		// Send cached RealData immediately so cloud gets data right away
		if (this.lastRealDataPayload) {
			this._sendRealData();
		}
		if (!this.paused) {
			this._startTimers();
		}
	}

	/** @inheritdoc */
	protected _stopSessionTimers(): void {
		this.heartbeatTimer = this.clearManagedInterval(this.heartbeatTimer);
		this.realDataTimer = this.clearManagedInterval(this.realDataTimer);
	}

	/** @inheritdoc */
	protected override _stopAllTimers(): void {
		super._stopAllTimers();
		this.pauseTimer = this.clearManagedTimeout(this.pauseTimer);
	}

	/** @inheritdoc */
	protected override _shouldReconnect(): boolean {
		return !this.paused;
	}

	/** Build and send a cloud heartbeat (HBReqDTO, tag 0x22 0x02). */
	private _sendHeartbeat(): void {
		if (!this.connected || !this.socket || !this.protobuf) {
			return;
		}

		const HBReqDTO = this.protobuf.getType("APPHeartbeatPB", "HBReqDTO");
		const msg = HBReqDTO.create({
			offset: this.timezoneOffset,
			time: unixSeconds(),
			csq: -69, // Signal quality placeholder
			dtuSerialNumber: this.dtuSn,
			unknownField6: 550, // PCAP: real DTU sends field 6 with values ~537-565
		});
		const payload = HBReqDTO.encode(msg).finish();
		const frame = this._buildCloudMessage(CLOUD_CMD_HEARTBEAT[0], CLOUD_CMD_HEARTBEAT[1], payload);
		this._safeWrite(frame);
		this.emit("heartbeatSent", this.seq);
	}

	/** Send RealData status to cloud (tag 0x22 0x0d, every 60s with heartbeat). */
	private _sendRealDataStatus(): void {
		if (!this.connected || !this.socket || !this.lastRealDataPayload) {
			return;
		}
		const frame = this._buildCloudMessage(
			CLOUD_CMD_REALDATA_STATUS[0],
			CLOUD_CMD_REALDATA_STATUS[1],
			this.lastRealDataPayload,
		);
		this._safeWrite(frame);
	}

	/** Build and send RealData to cloud (tag 0x22 0x0c, every sendTime interval). */
	private _sendRealData(): void {
		if (!this.connected || !this.socket || !this.lastRealDataPayload) {
			return;
		}
		// Don't send stale data — if no fresh RealData arrived within 2x the interval,
		// the inverter is likely offline and we shouldn't send outdated values to cloud
		if (Date.now() - this.lastRealDataTimestamp > this.realDataIntervalMs * 2) {
			return;
		}

		// Forward the raw protobuf payload with cloud framing
		const frame = this._buildCloudMessage(CLOUD_CMD_REALDATA[0], CLOUD_CMD_REALDATA[1], this.lastRealDataPayload);
		this._safeWrite(frame);
		this.emit("dataSent");
	}

	/**
	 * Build HM-framed message with cloud tags and own sequence counter.
	 * Uses a separate sequence counter from the local connection to match real DTU behavior.
	 *
	 * @param cmdHigh - High byte of cloud command tag
	 * @param cmdLow - Low byte of cloud command tag
	 * @param protobufPayload - Encoded protobuf data
	 */
	private _buildCloudMessage(cmdHigh: number, cmdLow: number, protobufPayload: Uint8Array): Buffer {
		if (!this.protobuf) {
			throw new Error("Protobuf not configured");
		}
		const seq = this.seq;
		this.seq = seq >= 60000 ? 0 : seq + 1;
		return this.protobuf.buildMessage(cmdHigh, cmdLow, protobufPayload, seq);
	}

	/**
	 * Send a pre-built, HM-framed cloud-protocol frame. Used to answer downlink commands the
	 * server sends to the relay (e.g. grid-profile read) — the frame is built by the
	 * `ProtobufHandler.encodeCloud*` helpers.
	 *
	 * @param frame - Complete HM-framed message (header + payload).
	 */
	sendFrame(frame: Buffer): void {
		if (!this.connected || !this.socket) {
			return;
		}
		this._safeWrite(frame);
	}

	/**
	 * Parse downlink (cloud→DTU) HM frames out of the TCP stream. Routine keep-alive frames
	 * (heartbeat 0x02, realdata request 0x0c, realdata-status 0x0d) are ignored; everything
	 * else is surfaced as a `"command"` event `{ cmdHigh, cmdLow, seq, payload }` so the
	 * device layer can answer it (the relay alone has no local DTU connection).
	 *
	 * @param chunk - Raw bytes received from the cloud socket.
	 */
	private _onDownlink(chunk: Buffer): void {
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
			// The cloud's answers to our own uploads (InfoData, heartbeat, RealData, history)
			// used to be discarded here. They carry the server time, the timezone offset and an
			// error code — dropping them lost the time sync and hid rejected uploads. They are
			// acknowledgements, so they are surfaced separately and never forwarded to a device.
			if (ACK_ONLY.has(cmdLow)) {
				this.emit("ack", { cmdHigh, cmdLow, seq, payload });
				continue;
			}
			this.emit("command", { cmdHigh, cmdLow, seq, payload });
		}
	}

	/**
	 * Write to socket with error callback to avoid silent failures.
	 *
	 * @param data - Buffer to write to the socket
	 */
	private _safeWrite(data: Buffer): void {
		if (!this.socket) {
			return;
		}
		this.socket.write(data, err => {
			if (err) {
				this.emit("error", new Error(`CloudRelay write failed: ${err.message}`));
			}
		});
	}

	private _startTimers(): void {
		this._stopSessionTimers();
		// Guard: don't start timers if paused or destroyed (race with sendFinalAndPause)
		if (this.paused || this.destroyed) {
			return;
		}
		// PCAP pattern: every 60s send RealDataStatus (0x0d) then Heartbeat (0x02)
		this.heartbeatTimer = this.timers.setInterval(() => {
			if (this.destroyed || this.paused) {
				return;
			}
			this._sendRealDataStatus();
			this._sendHeartbeat();
		}, CLOUD_HEARTBEAT_INTERVAL_MS);
		// Forward latest RealData (0x0c) at configured interval (from DTU serverSendTime)
		this.realDataTimer = this.timers.setInterval(() => {
			if (this.destroyed || this.paused) {
				return;
			}
			this._sendRealData();
		}, this.realDataIntervalMs);
	}
}

export default CloudRelay;
