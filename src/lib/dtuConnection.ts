import type * as net from "node:net";
import TcpConnection, { type TimerScheduler } from "./tcpConnection.js";
import { HM_MAGIC_0, HM_MAGIC_1 } from "./constants.js";

const MAGIC_HEADER = Buffer.from([HM_MAGIC_0, HM_MAGIC_1]);
const HEADER_SIZE = 10;
const HEARTBEAT_TIMEOUT = 20000; // 20s idle → send heartbeat (app sends at ~20s idle, DTU native HB is 60s)
const RECONNECT_DELAY_MIN = 1000;
const RECONNECT_DELAY_MAX = 300000;
const MAX_FAILED_SENDS = 10;
const MIN_REQUEST_INTERVAL = 500; // 500ms between requests for fast polling
const IDLE_TIMEOUT = 300000; // 5 min no data → reconnect
const INITIAL_BUFFER_SIZE = 4096;
const MAX_BUFFER_SIZE = 131072; // 128KB guard

/** Persistent TCP connection to a Hoymiles DTU with heartbeat and reconnect. */
class DtuConnection extends TcpConnection {
	private readonly heartbeatGenerator: (() => Buffer) | null;

	private receiveBuffer: Buffer;
	private receiveBufferLen: number;
	private heartbeatTimer: ioBroker.Timeout | undefined;
	private idleTimer: ioBroker.Timeout | undefined;
	private lastRequestTime: number;
	private consecutiveFailedSends: number;

	/**
	 * @param host - DTU IP address
	 * @param port - DTU TCP port (default 10081)
	 * @param heartbeatGenerator - Optional callback to generate heartbeat messages
	 * @param timers - Adapter-managed timer scheduler; falls back to native timers when omitted
	 */
	constructor(host: string, port: number, heartbeatGenerator?: () => Buffer, timers?: TimerScheduler) {
		super(host, port, RECONNECT_DELAY_MIN, RECONNECT_DELAY_MAX, timers);
		this.heartbeatGenerator = heartbeatGenerator || null;

		this.receiveBuffer = Buffer.alloc(INITIAL_BUFFER_SIZE);
		this.receiveBufferLen = 0;
		this.heartbeatTimer = undefined;
		this.idleTimer = undefined;
		this.lastRequestTime = 0;
		this.consecutiveFailedSends = 0;
	}

	/** @inheritdoc */
	override connect(): void {
		this.receiveBufferLen = 0;
		super.connect();
	}

	/**
	 * Send a binary message to the DTU, respecting minimum request interval.
	 *
	 * @param buffer - Raw message bytes to send
	 */
	async send(buffer: Buffer): Promise<boolean> {
		if (!this.connected || !this.socket) {
			return false;
		}

		const now = Date.now();
		const elapsed = now - this.lastRequestTime;
		if (elapsed < MIN_REQUEST_INTERVAL) {
			// Native timer: a short throttle sleep that always resolves — no adapter-managed cleanup
			// needed, and using the adapter timer here would warn if a poll is in flight during unload.
			await new Promise<void>(resolve => globalThis.setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
		}
		this.lastRequestTime = Date.now();
		this._resetHeartbeatTimer();

		if (!this.socket || !this.connected) {
			return false;
		}

		return new Promise<boolean>(resolve => {
			this.socket!.write(buffer, err => {
				if (err) {
					this.consecutiveFailedSends++;
					if (this.consecutiveFailedSends >= MAX_FAILED_SENDS) {
						this.socket?.destroy();
					}
					resolve(false);
				} else {
					this.consecutiveFailedSends = 0;
					resolve(true);
				}
			});
		});
	}

	/** @inheritdoc */
	protected _configureSocket(socket: net.Socket): void {
		socket.setKeepAlive(true);
		socket.on("data", (chunk: Buffer) => this._onData(chunk));
	}

	/** @inheritdoc */
	protected _onConnected(): void {
		this.consecutiveFailedSends = 0;
		this._resetHeartbeatTimer();
		this._resetIdleTimer();
		this.emit("connected");
	}

	/** @inheritdoc */
	protected _stopSessionTimers(): void {
		this.heartbeatTimer = this.clearManagedTimeout(this.heartbeatTimer);
		this.idleTimer = this.clearManagedTimeout(this.idleTimer);
	}

	private _onData(chunk: Buffer): void {
		this._resetIdleTimer();

		// Grow buffer if needed
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
				// Shift data to front
				this.receiveBuffer.copy(this.receiveBuffer, 0, idx, this.receiveBufferLen);
				this.receiveBufferLen -= idx;
				continue;
			}

			const totalLen = (this.receiveBuffer[8] << 8) | this.receiveBuffer[9];
			if (totalLen < HEADER_SIZE || totalLen > 65535) {
				// Skip one byte
				this.receiveBuffer.copy(this.receiveBuffer, 0, 1, this.receiveBufferLen);
				this.receiveBufferLen -= 1;
				continue;
			}
			if (this.receiveBufferLen < totalLen) {
				break;
			}

			// Extract complete message (copy since buffer will be reused)
			const message = Buffer.from(this.receiveBuffer.subarray(0, totalLen));
			// Compact: shift remaining data to front
			this.receiveBuffer.copy(this.receiveBuffer, 0, totalLen, this.receiveBufferLen);
			this.receiveBufferLen -= totalLen;
			this.emit("message", message);
		}
	}

	/** Heartbeat only fires after 20s of idle (no send() calls). */
	private _resetHeartbeatTimer(): void {
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
					} else {
						this.consecutiveFailedSends = 0;
					}
				});
				this._resetHeartbeatTimer();
			}
		}, HEARTBEAT_TIMEOUT);
	}

	private _resetIdleTimer(): void {
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
