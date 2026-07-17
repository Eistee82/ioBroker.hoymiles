import * as net from "node:net";
import { EventEmitter } from "node:events";

/**
 * Minimal timer interface satisfied by the ioBroker adapter instance
 * (`adapter.setTimeout`/`clearTimeout`/`setInterval`/`clearInterval`). Injecting it lets the
 * connection classes use adapter-managed timers — which the js-controller cleans up automatically
 * on unload — while still working with native timers when no adapter is supplied (e.g. in tests).
 */
export interface TimerScheduler {
	/** Schedule a one-shot timer. */
	setTimeout: (cb: () => void, ms: number) => ioBroker.Timeout | undefined;
	/** Cancel a one-shot timer previously returned by setTimeout. */
	clearTimeout: (handle: ioBroker.Timeout | undefined) => void;
	/** Schedule a repeating timer. */
	setInterval: (cb: () => void, ms: number) => ioBroker.Interval | undefined;
	/** Cancel a repeating timer previously returned by setInterval. */
	clearInterval: (handle: ioBroker.Interval | undefined) => void;
}

/** Fallback scheduler using native timers — used when no adapter is injected (tests, standalone). */
const NATIVE_TIMERS: TimerScheduler = {
	setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms) as unknown as ioBroker.Timeout,
	clearTimeout: handle => globalThis.clearTimeout(handle as unknown as NodeJS.Timeout),
	setInterval: (cb, ms) => globalThis.setInterval(cb, ms) as unknown as ioBroker.Interval,
	clearInterval: handle => globalThis.clearInterval(handle as unknown as NodeJS.Timeout),
};

/**
 * Abstract base class for persistent TCP connections with reconnect logic.
 * Shared by DtuConnection (local DTU) and CloudRelay (cloud server).
 *
 * Timers run through an injected {@link TimerScheduler} (the ioBroker adapter) so the js-controller
 * cleans them up on unload; when none is supplied they fall back to native timers. Callers must
 * still call disconnect() on unload to close sockets and stop all timers deterministically.
 */
abstract class TcpConnection extends EventEmitter {
	public connected: boolean;

	protected socket: net.Socket | null;
	protected destroyed: boolean;
	protected reconnectDelay: number;

	protected readonly host: string;
	protected readonly port: number;
	protected readonly timers: TimerScheduler;

	private reconnectTimer: ioBroker.Timeout | undefined;
	private readonly reconnectDelayMin: number;
	private readonly reconnectDelayMax: number;

	/**
	 * @param host - Remote host address
	 * @param port - Remote port
	 * @param reconnectDelayMin - Initial reconnect delay in ms
	 * @param reconnectDelayMax - Maximum reconnect delay in ms
	 * @param timers - Adapter-managed timer scheduler; falls back to native timers when omitted
	 */
	constructor(
		host: string,
		port: number,
		reconnectDelayMin: number,
		reconnectDelayMax: number,
		timers?: TimerScheduler,
	) {
		super();
		this.host = host;
		this.port = port;
		this.timers = timers ?? NATIVE_TIMERS;
		this.socket = null;
		this.connected = false;
		this.destroyed = false;
		this.reconnectTimer = undefined;
		this.reconnectDelay = reconnectDelayMin;
		this.reconnectDelayMin = reconnectDelayMin;
		this.reconnectDelayMax = reconnectDelayMax;
	}

	/** Open TCP connection. Cleans up any existing socket first. */
	connect(): void {
		if (this.destroyed) {
			return;
		}

		// Cancel pending reconnect — we are connecting now
		this.reconnectTimer = this.clearManagedTimeout(this.reconnectTimer);

		// Clean up old socket: remove listeners to prevent stale events after destroy
		this._cleanupSocket();

		this.connected = false;
		this.socket = new net.Socket();

		this._configureSocket(this.socket);

		this.socket.connect(this.port, this.host, () => {
			this.connected = true;
			this.reconnectDelay = this.reconnectDelayMin;
			this._onConnected();
		});

		this.socket.on("error", (err: Error) => this._handleDisconnect(err));
		this.socket.on("close", () => this._handleDisconnect(null));
	}

	/** Close the connection permanently and stop all timers. */
	disconnect(): void {
		this.destroyed = true;
		this._stopAllTimers();
		this._cleanupSocket();
		this.connected = false;
	}

	/**
	 * Handle socket disconnect: emit events and schedule reconnect.
	 *
	 * @param err - The error that caused the disconnect, or null for clean close
	 */
	protected _handleDisconnect(err: Error | null): void {
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

		// Schedule reconnect unless subclass says no (e.g. paused) or already scheduled
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

	/** Stop all timers including reconnect. */
	protected _stopAllTimers(): void {
		this._stopSessionTimers();
		this.reconnectTimer = this.clearManagedTimeout(this.reconnectTimer);
	}

	/**
	 * Clear a managed one-shot timer through the injected scheduler and return undefined so callers
	 * can null the field in one assignment (`this.x = this.clearManagedTimeout(this.x)`).
	 *
	 * @param handle - Timeout handle to clear (no-op if undefined)
	 */
	protected clearManagedTimeout(handle: ioBroker.Timeout | undefined): undefined {
		if (handle) {
			this.timers.clearTimeout(handle);
		}
		return undefined;
	}

	/**
	 * Clear a managed repeating timer through the injected scheduler and return undefined so callers
	 * can null the field in one assignment (`this.x = this.clearManagedInterval(this.x)`).
	 *
	 * @param handle - Interval handle to clear (no-op if undefined)
	 */
	protected clearManagedInterval(handle: ioBroker.Interval | undefined): undefined {
		if (handle) {
			this.timers.clearInterval(handle);
		}
		return undefined;
	}

	/** Remove all listeners from socket and destroy it. */
	private _cleanupSocket(): void {
		if (this.socket) {
			const old = this.socket;
			this.socket = null;
			old.removeAllListeners();
			old.on("error", () => {}); // Prevent uncaught exception from post-destroy error
			old.destroy();
		}
	}

	/** Configure the socket (keepAlive, timeout) and add data handlers. Called after socket creation. */
	protected abstract _configureSocket(socket: net.Socket): void;

	/** Run logic after TCP connect callback fires. */
	protected abstract _onConnected(): void;

	/** Stop session-specific timers. Subclasses override to stop their own timers. */
	protected abstract _stopSessionTimers(): void;

	/** Whether reconnect should be attempted. Override to add conditions like pause state. */
	protected _shouldReconnect(): boolean {
		return true;
	}
}

export default TcpConnection;
