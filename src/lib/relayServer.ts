import * as net from "node:net";
import { EventEmitter } from "node:events";
import { type ProtobufHandler, type RealDataResult, HEADER_SIZE } from "./protobufHandler.js";
import { HM_MAGIC_0, HM_MAGIC_1, RELAY_SERVER_MAX_BUFFER_SIZE, RELAY_SERVER_IDLE_TIMEOUT_MS } from "./constants.js";
import { errorMessage, clearTimer } from "./utils.js";

const MAGIC = Buffer.from([HM_MAGIC_0, HM_MAGIC_1]);

/** Which leg of the proxied connection a sniffed frame was captured on. */
type RelayDirection = "uplink" | "downlink";

/** One proxied DTU↔cloud TCP connection: the redirected inverter (client) and our uplink to the real cloud. */
interface RelaySession {
	id: number;
	clientSocket: net.Socket;
	cloudSocket: net.Socket;
	/** DTU serial number, learned from the first heartbeat or RealData frame we see (empty until then). */
	dtuSn: string;
	/** Sniff accumulator for the device→cloud direction (uplink). */
	upBuffer: Buffer;
	/** Sniff accumulator for the cloud→device direction (downlink). */
	downBuffer: Buffer;
	/** Guards against double-cleanup when both socket "close" handlers fire. */
	closed: boolean;
	/** Fires when no traffic (either direction) has been seen for a while — forces a reconnect. */
	idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Emitted when a redirected DTU dials into the relay. */
export interface RelayConnectionEvent {
	/** Session id, stable for the lifetime of this proxied connection. */
	sessionId: number;
	/** Client's remote address as `"ip:port"`. */
	remoteAddress: string;
}

/** Emitted once a session's proxied connection ends (either leg closed). */
export interface RelayDisconnectionEvent {
	/** Session id that ended. */
	sessionId: number;
	/** DTU serial, if it was learned before the session ended (empty otherwise). */
	dtuSn: string;
	/** Short human-readable reason (e.g. "client closed", "upstream closed", "idle timeout"). */
	reason: string;
}

/** Emitted the first time a session's DTU serial becomes known (or changes). */
export interface RelayDeviceIdentifiedEvent {
	/** Session id that was identified. */
	sessionId: number;
	/** DTU serial number learned from a heartbeat or RealData frame. */
	dtuSn: string;
}

/** Emitted for every uplink RealData frame (cloud tag `0x22 0x0c`/`0x0d`). */
export interface RelayRealDataEvent {
	/** Session id the frame was captured on. */
	sessionId: number;
	/** May be empty if no heartbeat/RealData has identified the device yet. */
	dtuSn: string;
	/** Sequence number from the HM frame header. */
	seq: number;
	/** `true` for the `0x0d` "status" variant (sent alongside the 60s heartbeat, same payload shape). */
	statusOnly: boolean;
	/** Decoded RealData, or `null` if decoding failed (e.g. an encrypted payload we can't read). */
	data: RealDataResult | null;
}

/** Emitted for any non-routine HM frame in either direction (grid-profile upload, action commands, acks, …). */
export interface RelayCommandEvent {
	/** Session id the frame was captured on. */
	sessionId: number;
	/** May be empty if no heartbeat/RealData has identified the device yet. */
	dtuSn: string;
	/** Which leg of the proxied connection the frame was captured on. */
	direction: RelayDirection;
	/** High byte of the command tag (e.g. `0x22` uplink, `0x23` downlink). */
	cmdHigh: number;
	/** Low byte of the command tag. */
	cmdLow: number;
	/** Sequence number from the HM frame header. */
	seq: number;
	/** Raw protobuf payload (undecoded — caller decodes via {@link ProtobufHandler}). */
	payload: Buffer;
}

/**
 * Cloud relay server for DTUs that have no local TCP port (e.g. HMS-800-2WB) and are instead
 * BLE-configured to dial straight into the adapter. Accepts each incoming connection, opens a
 * matching uplink to the real Hoymiles cloud, and pipes bytes transparently in both directions
 * — the device and the S-Miles app/portal keep working completely unchanged. In parallel, a copy
 * of every HM-framed message is sniffed (cloud tags `0x22`/`0x23` — see {@link ProtobufHandler})
 * and surfaced as typed events so the adapter can populate states and (via {@link sendToDevice})
 * inject downlink frames.
 *
 * Adapter-independent by design (like {@link "./tcpConnection.js"} subclasses) so it can be unit
 * tested without a full ioBroker adapter mock; the caller wires start()/stop() into the adapter
 * lifecycle and consumes events via the standard EventEmitter API.
 */
class RelayServer extends EventEmitter {
	private server: net.Server | null;
	private readonly sessions: Map<number, RelaySession>;
	private nextSessionId: number;
	private cloudHost: string;
	private cloudPort: number;
	private readonly protobuf: ProtobufHandler;
	private readonly log: (msg: string) => void;

	/**
	 * @param protobuf - Shared protobuf handler used to parse/decode sniffed frames.
	 * @param log - Optional debug logger (defaults to a no-op).
	 */
	constructor(protobuf: ProtobufHandler, log: (msg: string) => void = () => {}) {
		super();
		this.protobuf = protobuf;
		this.log = log;
		this.server = null;
		this.sessions = new Map();
		this.nextSessionId = 1;
		this.cloudHost = "";
		this.cloudPort = 0;
	}

	/** Whether the server is currently accepting connections. */
	get listening(): boolean {
		return !!this.server?.listening;
	}

	/** Number of currently proxied (client↔cloud) sessions. */
	get sessionCount(): number {
		return this.sessions.size;
	}

	/**
	 * Start listening for redirected DTU connections. Each accepted connection gets its own
	 * uplink connection to `cloudHost:cloudPort`; a second `start()` call while already
	 * listening is a no-op (call {@link stop} first to change the target).
	 *
	 * @param port - Local port to listen on (the DTU is BLE-configured to dial this address).
	 * @param cloudHost - Real Hoymiles cloud host to forward to (e.g. dataeu.hoymiles.com).
	 * @param cloudPort - Real Hoymiles cloud port to forward to.
	 */
	start(port: number, cloudHost: string, cloudPort: number): void {
		if (this.server) {
			return;
		}
		this.cloudHost = cloudHost;
		this.cloudPort = cloudPort;

		const server = net.createServer(socket => this._onConnection(socket));
		server.on("error", (err: Error) => {
			this.emit("error", new Error(`RelayServer listen error: ${errorMessage(err)}`));
		});
		server.listen(port, () => {
			// Report the actually-bound port (relevant when `port` was 0 — OS-assigned, e.g. in tests).
			const addr = server.address();
			this.emit("listening", typeof addr === "object" && addr ? addr.port : port);
		});
		this.server = server;
	}

	/** Stop listening and tear down every active session (both legs of each proxied connection). */
	stop(): void {
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

	/**
	 * Inject a pre-built HM-framed message directly into a connected device's socket,
	 * bypassing the real cloud. Low-level primitive for steering a redirected inverter through
	 * the relay (e.g. answering with a synthesized downlink command); the caller builds the
	 * frame via {@link ProtobufHandler}. Full state-change → cloud-command routing (choosing
	 * between local- and cloud-tagged encodings) is not wired up here — see the adapter's
	 * command handling for that.
	 *
	 * @param dtuSn - Target DTU serial number (learned from a "deviceIdentified" or "realData" event).
	 * @param frame - Complete HM-framed message to deliver to that device's client socket.
	 * @returns Whether a matching, writable session was found.
	 */
	sendToDevice(dtuSn: string, frame: Buffer): boolean {
		for (const session of this.sessions.values()) {
			if (session.dtuSn === dtuSn && session.clientSocket.writable) {
				session.clientSocket.write(frame, (err?: Error | null) => {
					if (err) {
						this.emit(
							"error",
							new Error(`RelayServer sendToDevice(${dtuSn}) failed: ${errorMessage(err)}`),
						);
					}
				});
				return true;
			}
		}
		return false;
	}

	/**
	 * Handle a freshly accepted device connection: open the matching uplink to the real cloud
	 * and pipe both directions transparently while tapping a copy for sniffing.
	 *
	 * @param clientSocket - The redirected DTU's incoming socket.
	 */
	private _onConnection(clientSocket: net.Socket): void {
		const id = this.nextSessionId++;
		const remoteAddress = `${clientSocket.remoteAddress ?? "?"}:${clientSocket.remotePort ?? "?"}`;
		const cloudSocket = new net.Socket();
		const session: RelaySession = {
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

		// Transparent byte-for-byte forwarding in both directions, plus a tap for sniffing.
		clientSocket.on("data", (chunk: Buffer) => {
			this._resetIdleTimer(session);
			if (cloudSocket.writable) {
				cloudSocket.write(chunk);
			}
			this._sniff(session, chunk, "uplink");
		});
		cloudSocket.on("data", (chunk: Buffer) => {
			this._resetIdleTimer(session);
			if (clientSocket.writable) {
				clientSocket.write(chunk);
			}
			this._sniff(session, chunk, "downlink");
		});

		clientSocket.on("error", (err: Error) => {
			this.log(`RelayServer session ${id}: client error: ${errorMessage(err)}`);
		});
		cloudSocket.on("error", (err: Error) => {
			this.log(`RelayServer session ${id}: upstream error: ${errorMessage(err)}`);
		});

		// Either leg closing ends the whole session — the DTU's own reconnect logic re-dials us.
		clientSocket.on("close", () => this._closeSession(session, "client closed"));
		cloudSocket.on("close", () => this._closeSession(session, "upstream closed"));

		cloudSocket.connect(this.cloudPort, this.cloudHost);

		const evt: RelayConnectionEvent = { sessionId: id, remoteAddress };
		this.emit("connection", evt);
	}

	/**
	 * Tear down both legs of a session exactly once and notify listeners.
	 *
	 * @param session - The session to close.
	 * @param reason - Short human-readable reason (for logs/events).
	 */
	private _closeSession(session: RelaySession, reason: string): void {
		if (session.closed) {
			return;
		}
		session.closed = true;
		session.idleTimer = clearTimer(session.idleTimer);
		this.sessions.delete(session.id);
		this._destroySocket(session.clientSocket);
		this._destroySocket(session.cloudSocket);
		const evt: RelayDisconnectionEvent = { sessionId: session.id, dtuSn: session.dtuSn, reason };
		this.emit("disconnection", evt);
	}

	/**
	 * Reset the idle watchdog: if no traffic (either direction) arrives within
	 * {@link RELAY_SERVER_IDLE_TIMEOUT_MS}, the session is torn down (its own reconnect logic
	 * will re-dial us). Mirrors DtuConnection's idle-timeout pattern for the local TCP path.
	 *
	 * @param session - Session to arm/re-arm the watchdog for.
	 */
	private _resetIdleTimer(session: RelaySession): void {
		session.idleTimer = clearTimer(session.idleTimer);
		if (session.closed) {
			return;
		}
		session.idleTimer = setTimeout(() => {
			this._closeSession(session, "idle timeout");
		}, RELAY_SERVER_IDLE_TIMEOUT_MS);
	}

	/**
	 * Remove listeners and destroy a socket, swallowing post-destroy errors.
	 *
	 * @param socket - Socket to tear down.
	 */
	private _destroySocket(socket: net.Socket): void {
		socket.removeAllListeners();
		socket.on("error", () => {});
		socket.destroy();
	}

	/**
	 * Accumulate a chunk into the session's per-direction buffer and split out complete
	 * HM-framed messages (magic `48 4d`, 10-byte header, big-endian length at offset 8-9) —
	 * same framing rules as {@link "./dtuConnection.js"} and {@link "./cloudRelay.js"}.
	 *
	 * @param session - Session the chunk belongs to.
	 * @param chunk - Raw bytes just forwarded.
	 * @param direction - Which leg the chunk was captured on.
	 */
	private _sniff(session: RelaySession, chunk: Buffer, direction: RelayDirection): void {
		const key = direction === "uplink" ? "upBuffer" : "downBuffer";
		let buf = session[key].length ? Buffer.concat([session[key], chunk]) : chunk;

		if (buf.length > RELAY_SERVER_MAX_BUFFER_SIZE) {
			this.emit(
				"error",
				new Error(`RelayServer session ${session.id}: ${direction} sniff buffer overflow, discarding`),
			);
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

	/**
	 * Decode a complete HM frame and emit the matching high-level event. Routine keep-alive
	 * traffic (heartbeat, realdata poll request) is consumed silently — everything else
	 * (including uplink RealData) is surfaced.
	 *
	 * @param session - Session the frame belongs to.
	 * @param frame - Complete HM-framed message (header + payload).
	 * @param direction - Which leg the frame was captured on.
	 */
	private _handleFrame(session: RelaySession, frame: Buffer, direction: RelayDirection): void {
		const parsed = this.protobuf.parseResponse(frame);
		if (!parsed) {
			return;
		}
		const { cmdHigh, cmdLow, payload } = parsed;
		const seq = (frame[4] << 8) | frame[5];

		// Uplink heartbeat (HBReqDTO) carries the DTU serial — the cheapest way to identify a
		// session before its first RealData frame arrives.
		if (direction === "uplink" && cmdHigh === 0x22 && cmdLow === 0x02) {
			try {
				const obj = this.protobuf.decodePayload("APPHeartbeatPB", "HBReqDTO", payload);
				this._identify(session, (obj.dtuSerialNumber as string) || "");
			} catch (err) {
				this.log(`RelayServer session ${session.id}: heartbeat decode failed: ${errorMessage(err)}`);
			}
			return;
		}

		// Routine downlink polling — the cloud asking the device for fresh RealData. Not
		// interesting on its own; the reply (uplink 0x22 0x0c/0x0d, handled below) is.
		if (direction === "downlink" && cmdHigh === 0x23 && (cmdLow === 0x0c || cmdLow === 0x0d)) {
			return;
		}

		if (direction === "uplink" && cmdHigh === 0x22 && (cmdLow === 0x0c || cmdLow === 0x0d)) {
			let data: RealDataResult | null = null;
			try {
				data = this.protobuf.decodeRealDataNew(payload);
				this._identify(session, data.dtuSn);
			} catch (err) {
				// Not necessarily fatal — some devices may require decryption we don't have the
				// key for without a local InfoData exchange. Still emit the event (data: null) so
				// callers can see the frame arrived.
				this.log(`RelayServer session ${session.id}: RealData decode failed: ${errorMessage(err)}`);
			}
			const evt: RelayRealDataEvent = {
				sessionId: session.id,
				dtuSn: session.dtuSn,
				seq,
				statusOnly: cmdLow === 0x0d,
				data,
			};
			this.emit("realData", evt);
			return;
		}

		const evt: RelayCommandEvent = {
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

	/**
	 * Record a session's DTU serial and emit "deviceIdentified" the first time it becomes
	 * known (or if it changes, which should not normally happen within one TCP connection).
	 *
	 * @param session - Session to tag.
	 * @param dtuSn - Serial learned from a heartbeat or RealData frame.
	 */
	private _identify(session: RelaySession, dtuSn: string): void {
		if (!dtuSn || dtuSn === session.dtuSn) {
			return;
		}
		session.dtuSn = dtuSn;
		const evt: RelayDeviceIdentifiedEvent = { sessionId: session.id, dtuSn };
		this.emit("deviceIdentified", evt);
	}
}

export default RelayServer;
