import { EventEmitter } from "node:events";
import { NATIVE_TIMERS, type TimerScheduler } from "./tcpConnection.js";
import { EsphomeGateway, type GatewayLogger } from "./esphomeGateway.js";
import {
	bleBuildFrame,
	bleParseFrame,
	bleDecrypt,
	snDecrypt,
	extractEncRand,
	pbFindVarint,
	type BleFrameMode,
} from "./bleCrypto.js";
import { BLE_HANDSHAKE_TICK_MS, BLE_IDLE_TIMEOUT_MS, HM_MAGIC_0, HM_MAGIC_1, RECONNECT_MAX_MS } from "./constants.js";
import { unixSeconds, errorMessage } from "./utils.js";

// Command tags (msgId). Requests a3xx, responses a2xx — same family as the TCP path.
const TAG_INFO = 0xa301; // bootstrap/keepalive (plain) → device replies 0xa201 (SN-CBC) with encRand
const TAG_COMMCMD_Y = 0xa318; // CommCmd "Y" / PIN carrier (GCM)
const TAG_COMMCMD_H = 0xa319; // CommCmd "H" status poll (GCM) → response 0xa219 carries `sts`
const TAG_COMMCMD_STATUS = 0xa219; // status response

// CommCmd action codes (field 2 of the request, echoed in field 3 of the status response).
const ACTION_STATUS = 64; // connection/auth status query
const ACTION_PIN_VERIFY = 82; // verify an existing PIN

// Pairing status (`sts`, field 11 of the CommCmdStatus response). App-verified meanings.
// NOTE: the meaning of `sts` depends on which action was polled — see handleStatus().
const STS_RUNNING = 0;
const STS_PAIRED = 1;
const STS_FAILED = 2;
const STS_PIN_NEEDED = 3;
const STS_PIN_REJECTED = 4;

const MTU_GUARD = 4096;
/** First reconnect delay; doubles per failed round up to {@link RECONNECT_MAX_MS}. */
const RECONNECT_DELAY_MIN_MS = 5000;
/** GATT connect is flaky over the proxy; retry a few times before giving up. */
const GATT_CONNECT_TRIES = 6;
const GATT_CONNECT_RETRY_MS = 2000;
const GCM_TAG_LEN = 16;
const MAGIC = Buffer.from([HM_MAGIC_0, HM_MAGIC_1]);

/** Handshake phases (mirrors the app's BleClient state machine). */
type HandshakeState = "idle" | "boot" | "commcmd" | "pin_needed" | "pin_wait" | "paired";

/**
 * Encode a varint (used for the small hand-built CommCmd protobufs).
 *
 * @param n - value to encode
 */
function vint(n: number): Buffer {
	const bytes: number[] = [];
	let v = n;
	while (v > 0x7f) {
		bytes.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	bytes.push(v);
	return Buffer.from(bytes);
}

/** Options for {@link BleConnection}. */
export interface BleConnectionOptions {
	/** The ESPHome gateway that tunnels this device's GATT traffic. */
	gateway: EsphomeGateway;
	/** Numeric BLE address of the inverter. */
	mac: number;
	/** Serial-number bytes (last 12 chars of the BLE name) for the SN-CBC bootstrap. */
	sn: Buffer;
	/** Pairing PIN. */
	pin: string;
	/** Adapter-managed timer scheduler; falls back to native timers in tests. */
	timers?: TimerScheduler;
	/** Logger. */
	log: GatewayLogger;
	/** Optional BLE address type (0 = public, 1 = random). */
	addressType?: number;
	/** No-traffic watchdog in ms; defaults to {@link BLE_IDLE_TIMEOUT_MS}. */
	idleTimeoutMs?: number;
}

/**
 * BLE transport for a single HMS-800-2WB (or similar BLE-only inverter), tunneled through an
 * {@link EsphomeGateway}. Presents the same event/method surface as `DtuConnection`
 * (`connect`/`send`/`disconnect`/`connected` + events `connected`/`disconnected`/`message`/`error`)
 * so {@link DeviceContext} can drive it unchanged.
 *
 * It owns the BLE-specific layer the TCP path does not have: GATT connect + notify, the
 * SN-CBC → encRand-GCM crypto, and the pairing handshake (bootstrap → status poll → PIN → paired).
 * `"connected"` is emitted only after pairing succeeds; from then on it forwards decrypted
 * cleartext HM frames upward and GCM-wraps outgoing frames. A hard pairing failure (wrong PIN,
 * device refusal) emits `"pairingFailed"` and stops — no reconnect storm.
 */
export class BleConnection extends EventEmitter {
	public connected: boolean;

	private readonly gateway: EsphomeGateway;
	private readonly mac: number;
	private readonly sn: Buffer;
	private readonly pin: string;
	private readonly timers: TimerScheduler;
	private readonly log: GatewayLogger;
	private readonly addressType?: number;
	private readonly idleTimeoutMs: number;

	private destroyed: boolean;
	private establishing: boolean;
	private state: HandshakeState;
	private encRand: Buffer | null;
	private seq: number;
	private writeHandle: number | null;
	private notifyHandle: number | null;
	private notifyBuf: Buffer;
	private unsubNotify: (() => void) | null;
	private unsubDeviceGone: (() => void) | null;
	/** Timestamp (ms) of the last frame received from the device — drives the idle watchdog. */
	private lastRxTs: number;

	private tickTimer: ioBroker.Interval | undefined;
	private reconnectTimer: ioBroker.Timeout | undefined;
	/** Current reconnect delay, grown per failed round and reset by a paired session. */
	private reconnectDelay: number;
	private tickBusy: boolean;

	private readonly onGwConnected: () => void;
	private readonly onGwDisconnected: () => void;

	/** @param options - transport configuration */
	constructor(options: BleConnectionOptions) {
		super();
		this.gateway = options.gateway;
		this.mac = options.mac;
		this.sn = options.sn;
		this.pin = options.pin;
		this.timers = options.timers ?? NATIVE_TIMERS;
		this.log = options.log;
		this.addressType = options.addressType;
		this.idleTimeoutMs = options.idleTimeoutMs ?? BLE_IDLE_TIMEOUT_MS;

		this.connected = false;
		this.destroyed = false;
		this.establishing = false;
		this.state = "idle";
		this.encRand = null;
		this.seq = 0;
		this.writeHandle = null;
		this.notifyHandle = null;
		this.notifyBuf = Buffer.alloc(0);
		this.unsubNotify = null;
		this.unsubDeviceGone = null;
		this.lastRxTs = 0;
		this.reconnectDelay = RECONNECT_DELAY_MIN_MS;
		this.tickBusy = false;

		this.onGwConnected = () => {
			if (!this.destroyed && !this.connected && !this.establishing) {
				void this.establish();
			}
		};
		this.onGwDisconnected = () => this.teardownSession();
	}

	/** Begin connecting (idempotent while running). */
	connect(): void {
		if (this.destroyed) {
			return;
		}
		this.gateway.on("connected", this.onGwConnected);
		this.gateway.on("disconnected", this.onGwDisconnected);
		// Survives individual sessions: the proxy reports the device dropping its link even while
		// the proxy connection itself stays up (the nightly inverter power-down).
		this.unsubDeviceGone = this.gateway.onDeviceDisconnect(this.mac, () => this.onDeviceGone());
		if (this.gateway.connected) {
			void this.establish();
		} else {
			this.log.debug(`[ble ${this.macStr()}] waiting for gateway ${this.gateway.host}`);
		}
	}

	/**
	 * Send a cleartext HM frame from {@link DeviceContext}. The tag decides the wire encryption:
	 * `0xa301` (info) stays plaintext, everything else is GCM-wrapped with the session encRand.
	 *
	 * @param buffer - a complete cleartext HM frame
	 */
	async send(buffer: Buffer): Promise<boolean> {
		if (!this.connected) {
			return false;
		}
		const parsed = bleParseFrame(buffer);
		if (!parsed) {
			return false;
		}
		const mode: BleFrameMode = parsed.tag === TAG_INFO ? "plain" : "gcm";
		if (mode === "gcm" && !this.encRand) {
			return false;
		}
		try {
			const frame = bleBuildFrame(parsed.tag, parsed.payload, {
				mode,
				encRand: this.encRand,
				sn: this.sn,
				seq: this.nextSeq(),
			});
			await this.gateway.writeChar(this.mac, this.writeHandle!, frame);
			return true;
		} catch (err) {
			this.log.debug(`[ble ${this.macStr()}] send failed: ${errorMessage(err)}`);
			return false;
		}
	}

	/** Close permanently: stop timers, unsubscribe, disconnect the BLE device. */
	disconnect(): void {
		this.destroyed = true;
		this.detachGateway();
		this.reconnectTimer = this.clearTimer(this.reconnectTimer);
		this.teardownSession();
		this.removeAllListeners();
	}

	/** Drop every gateway subscription this connection holds. */
	private detachGateway(): void {
		this.gateway.removeListener("connected", this.onGwConnected);
		this.gateway.removeListener("disconnected", this.onGwDisconnected);
		if (this.unsubDeviceGone) {
			try {
				this.unsubDeviceGone();
			} catch {
				/* ignore */
			}
			this.unsubDeviceGone = null;
		}
	}

	/**
	 * The proxy reported this device as disconnected. Tear the session down so `connected` stops
	 * lying — DeviceContext needs that to flag its states and to let the cloud fallback take over —
	 * then retry, because the inverter usually comes back the next morning.
	 */
	private onDeviceGone(): void {
		if (this.destroyed || (this.state === "idle" && !this.connected)) {
			return; // never established, or already down — nothing to tear down
		}
		this.log.info(`[ble ${this.macStr()}] device disconnected, will retry`);
		this.teardownSession();
		this.scheduleReconnect();
	}

	// --- session lifecycle -----------------------------------------------------

	private async establish(): Promise<void> {
		if (this.destroyed || this.establishing || this.connected) {
			return;
		}
		this.establishing = true;
		try {
			if (!this.gateway.connected) {
				return; // will retry on gateway "connected"
			}
			await this.gattConnect();
			const { servicesList } = await this.gateway.listGatt(this.mac);
			this.resolveHandles(servicesList);
			if (this.writeHandle == null || this.notifyHandle == null) {
				throw new Error("required GATT characteristics (ffe1/ffe2) not found");
			}
			this.unsubNotify = this.gateway.onNotifyData(this.mac, this.notifyHandle, chunk => this.onNotify(chunk));
			await this.gateway.enableNotify(this.mac, this.notifyHandle);
			// The proxy registers for notifications, but the device only starts sending once its CCCD
			// (notify handle + 1) is set to 0x0100. Without this the inverter stays silent and the
			// handshake never completes (verified on hardware).
			try {
				await this.gateway.writeDescriptor(this.mac, this.notifyHandle + 1, Buffer.from([0x01, 0x00]));
			} catch (err) {
				this.log.debug(`[ble ${this.macStr()}] CCCD write failed (continuing): ${errorMessage(err)}`);
			}

			this.state = "boot";
			this.encRand = null;
			this.notifyBuf = Buffer.alloc(0);
			this.lastRxTs = Date.now();
			this.startTick();
			this.log.info(`[ble ${this.macStr()}] GATT ready, starting pairing handshake`);
		} catch (err) {
			// debug, not warn: the "error" event below reaches DeviceContext, which warns once and
			// demotes every repeat. Warning here too made a night-time inverter log a warning per
			// retry round, forever, for a condition that is entirely expected after sunset.
			this.log.debug(`[ble ${this.macStr()}] establish failed: ${errorMessage(err)}`);
			this.emit("error", err instanceof Error ? err : new Error(errorMessage(err)));
			this.scheduleReconnect();
		} finally {
			this.establishing = false;
		}
	}

	/**
	 * Open the GATT link, tolerant of a stale connection the proxy may still hold. A first connect
	 * against an occupied slot fails instantly ("error 0"); dropping any previous link and retrying a
	 * few times clears it (verified on hardware — the first attempt often fails, a later one wins).
	 */
	private async gattConnect(): Promise<void> {
		try {
			await this.gateway.disconnectDevice(this.mac);
		} catch {
			/* nothing to clear */
		}
		let lastErr: unknown = null;
		for (let attempt = 1; attempt <= GATT_CONNECT_TRIES; attempt++) {
			if (this.destroyed || !this.gateway.connected) {
				throw new Error("gateway gone before GATT connect");
			}
			try {
				await this.gateway.connectDevice(this.mac, this.addressType);
				return;
			} catch (err) {
				lastErr = err;
				await this.delay(GATT_CONNECT_RETRY_MS);
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(errorMessage(lastErr));
	}

	private teardownSession(): void {
		const wasConnected = this.connected;
		this.connected = false;
		this.state = "idle";
		this.lastRxTs = 0; // disarm the idle watchdog until the next session arms it
		this.tickTimer = this.clearInterval(this.tickTimer);
		if (this.unsubNotify) {
			try {
				this.unsubNotify();
			} catch {
				/* ignore */
			}
			this.unsubNotify = null;
		}
		if (wasConnected) {
			this.emit("disconnected");
		}
	}

	/**
	 * Arm the next reconnect with an exponential backoff (same shape as the TCP path). The inverter
	 * is powered down for the whole night, so a fixed 5 s retry means hundreds of pointless GATT
	 * rounds over the proxy until sunrise. {@link markPaired} resets the delay, so a link that was
	 * healthy still comes back promptly.
	 */
	private scheduleReconnect(): void {
		if (this.destroyed || this.reconnectTimer) {
			return;
		}
		const delay = this.reconnectDelay;
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
		this.log.debug(`[ble ${this.macStr()}] reconnecting in ${Math.round(delay / 1000)}s`);
		this.reconnectTimer = this.timers.setTimeout(() => {
			this.reconnectTimer = undefined;
			if (!this.destroyed && !this.connected && this.gateway.connected) {
				void this.establish();
			}
		}, delay);
	}

	private resolveHandles(
		servicesList: Array<{ characteristicsList: Array<{ uuid: string; handle: number }> }>,
	): void {
		for (const svc of servicesList) {
			for (const ch of svc.characteristicsList) {
				const uuid = (ch.uuid || "").toLowerCase();
				if (uuid.includes("ffe1")) {
					this.writeHandle = ch.handle;
				} else if (uuid.includes("ffe2")) {
					this.notifyHandle = ch.handle;
				}
			}
		}
	}

	// --- handshake automaton ---------------------------------------------------

	private startTick(): void {
		this.tickTimer = this.clearInterval(this.tickTimer);
		this.tickTimer = this.timers.setInterval(() => {
			void this.tick();
		}, BLE_HANDSHAKE_TICK_MS);
	}

	private async tick(): Promise<void> {
		if (this.destroyed || this.tickBusy || !this.gateway.connected) {
			return;
		}
		this.tickBusy = true;
		try {
			// Backstop for a link that dies without the proxy saying so: a GATT connection the peer
			// simply stopped serving looks identical to a healthy idle one, so go by traffic.
			if (this.lastRxTs > 0 && Date.now() - this.lastRxTs > this.idleTimeoutMs) {
				this.log.warn(
					`[ble ${this.macStr()}] no data for ${Math.round(this.idleTimeoutMs / 1000)}s, reconnecting`,
				);
				this.teardownSession();
				this.scheduleReconnect();
				return;
			}
			if (!this.encRand) {
				// Bootstrap only: a301 (plain) triggers the a201 reply that carries encRand. The app
				// sends a301 once, not on a loop — so we re-send it only while encRand is still unknown.
				this.sendInternal(TAG_INFO, Buffer.alloc(0), "plain");
				return;
			}
			const ts = unixSeconds();
			switch (this.state) {
				case "boot":
					this.state = "commcmd";
					break;
				case "commcmd":
					this.sendInternal(TAG_COMMCMD_Y, BleConnection.commCmdY(ts), "gcm");
					await this.delay(300);
					if (this.okToSend()) {
						this.sendInternal(TAG_COMMCMD_H, BleConnection.commCmdH(ts, ACTION_STATUS), "gcm");
					}
					break;
				case "pin_needed":
					if (!this.pin) {
						this.failPairing("no PIN configured");
						break;
					}
					this.log.info(`[ble ${this.macStr()}] sending PIN (once)`);
					this.sendInternal(TAG_COMMCMD_Y, BleConnection.commCmdPin(ts, this.pin), "gcm");
					await this.delay(300);
					if (this.okToSend()) {
						// Poll the status of the PIN command (action 82), as the app does — NOT action 64.
						this.sendInternal(TAG_COMMCMD_H, BleConnection.commCmdH(ts, ACTION_PIN_VERIFY), "gcm");
					}
					this.state = "pin_wait";
					break;
				case "pin_wait":
					this.sendInternal(TAG_COMMCMD_H, BleConnection.commCmdH(ts, ACTION_PIN_VERIFY), "gcm");
					break;
				case "paired":
				case "idle":
					break;
			}
		} finally {
			this.tickBusy = false;
		}
	}

	private markPaired(): void {
		if (this.state !== "paired") {
			this.state = "paired";
			this.connected = true;
			this.reconnectDelay = RECONNECT_DELAY_MIN_MS; // a good session earns a prompt retry again
			this.log.info(`[ble ${this.macStr()}] paired`);
			this.emit("connected");
		}
	}

	private handleStatus(plain: Buffer): void {
		// The status response echoes the polled action in field 3. Its meaning of `sts` (field 11)
		// differs by action (app-verified, see BleMasterSlaveScanPageActivity$getPinCmdStatusFromDevice):
		//   action 64 (base): 1 = OK/paired, 3 = PIN needed, 2/4 = failed, 0 = keep polling.
		//   action 82 (PIN):  0 = PIN ACCEPTED, anything else = rejected  ← inverted vs. base.
		const action = pbFindVarint(plain, 3) ?? ACTION_STATUS;
		const sts = pbFindVarint(plain, 11) ?? STS_RUNNING;

		if (action === ACTION_PIN_VERIFY) {
			if (sts === STS_RUNNING) {
				this.markPaired();
			} else {
				this.failPairing("PIN rejected");
			}
			return;
		}

		switch (sts) {
			case STS_PIN_NEEDED:
				if (this.state === "commcmd") {
					this.state = "pin_needed";
					this.log.info(`[ble ${this.macStr()}] device requests PIN`);
				}
				break;
			case STS_PAIRED:
				this.markPaired();
				break;
			case STS_FAILED:
				this.failPairing("pairing rejected by device");
				break;
			case STS_PIN_REJECTED:
				this.failPairing("PIN rejected");
				break;
			case STS_RUNNING:
			default:
				break; // keep polling
		}
	}

	private failPairing(reason: string): void {
		if (this.destroyed) {
			return;
		}
		this.log.warn(`[ble ${this.macStr()}] pairing failed: ${reason}`);
		this.destroyed = true;
		this.detachGateway();
		this.reconnectTimer = this.clearTimer(this.reconnectTimer);
		this.teardownSession();
		this.emit("pairingFailed", reason);
	}

	// --- receive path ----------------------------------------------------------

	private onNotify(chunk: Buffer): void {
		this.lastRxTs = Date.now();
		this.notifyBuf = Buffer.concat([this.notifyBuf, chunk]);
		while (this.notifyBuf.length >= 10 && this.notifyBuf[0] === HM_MAGIC_0 && this.notifyBuf[1] === HM_MAGIC_1) {
			const totalLen = this.notifyBuf.readUInt16BE(8);
			if (this.notifyBuf.length < totalLen) {
				break; // not yet complete (at least up to declared length)
			}
			// A GCM frame carries an extra 16-byte tag beyond totalLen; take up to the next HM marker.
			const nextHM = this.notifyBuf.indexOf(MAGIC, 2);
			const take = nextHM > 0 ? nextHM : this.notifyBuf.length;
			this.processFrame(this.notifyBuf.subarray(0, take));
			this.notifyBuf = this.notifyBuf.subarray(take);
		}
		if (this.notifyBuf.length > MTU_GUARD) {
			this.notifyBuf = Buffer.alloc(0);
		}
	}

	private processFrame(frame: Buffer): void {
		const parsed = bleParseFrame(frame);
		if (!parsed) {
			return;
		}
		let plain: Buffer | null = null;

		if (parsed.payload.length >= GCM_TAG_LEN) {
			// Try SN-CBC first (bootstrap frames), then encRand-GCM. The first that verifies wins.
			if (this.sn && parsed.payload.length % 16 === 0) {
				try {
					plain = snDecrypt(this.sn, parsed.tag, parsed.seq, parsed.payload);
					if (!this.encRand) {
						const er = extractEncRand(plain);
						if (er) {
							this.encRand = er;
							this.log.debug(`[ble ${this.macStr()}] encRand acquired from bootstrap`);
						}
					}
				} catch {
					plain = null;
				}
			}
			if (!plain && this.encRand) {
				try {
					plain = bleDecrypt(this.encRand, parsed.tag, parsed.seq, parsed.payload);
				} catch {
					plain = null;
				}
			}
		} else {
			plain = parsed.payload; // short/plaintext frame
		}

		if (!plain) {
			return; // could not decrypt (e.g. encRand not yet known)
		}

		if (parsed.tag === TAG_COMMCMD_STATUS) {
			// Handshake-internal status frame — consumed here, never forwarded to DeviceContext.
			this.handleStatus(plain);
			return;
		}

		// Forward decrypted frames to DeviceContext only once paired, as a cleartext HM frame.
		if (this.connected) {
			const clear = bleBuildFrame(parsed.tag, plain, { mode: "plain", seq: parsed.seq });
			this.emit("message", clear);
		}
	}

	private sendInternal(tag: number, payload: Buffer, mode: BleFrameMode): void {
		if (mode === "gcm" && !this.encRand) {
			return;
		}
		try {
			const frame = bleBuildFrame(tag, payload, {
				mode,
				encRand: this.encRand,
				sn: this.sn,
				seq: this.nextSeq(),
			});
			void this.gateway.writeChar(this.mac, this.writeHandle!, frame).catch(err => {
				this.log.debug(`[ble ${this.macStr()}] internal write failed: ${errorMessage(err)}`);
			});
		} catch (err) {
			this.log.debug(`[ble ${this.macStr()}] internal frame build failed: ${errorMessage(err)}`);
		}
	}

	// --- helpers ---------------------------------------------------------------

	private okToSend(): boolean {
		return !this.destroyed && this.gateway.connected;
	}

	private nextSeq(): number {
		this.seq = (this.seq + 1) & 0xffff;
		return this.seq;
	}

	private macStr(): string {
		return EsphomeGateway.macToString(this.mac);
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => {
			this.timers.setTimeout(resolve, ms);
		});
	}

	private clearTimer(handle: ioBroker.Timeout | undefined): undefined {
		if (handle) {
			this.timers.clearTimeout(handle);
		}
		return undefined;
	}

	private clearInterval(handle: ioBroker.Interval | undefined): undefined {
		if (handle) {
			this.timers.clearInterval(handle);
		}
		return undefined;
	}

	// --- CommCmd protobuf builders (verified against the app's BleClient) -------

	/**
	 * CommCmdResDTO { time=1, action=2 (=64), tid=5 }.
	 *
	 * @param ts - unix timestamp (seconds)
	 */
	private static commCmdY(ts: number): Buffer {
		return Buffer.concat([
			Buffer.concat([Buffer.from([0x08]), vint(ts)]),
			Buffer.from([0x10, 0x40]),
			Buffer.concat([Buffer.from([0x28]), vint(ts)]),
		]);
	}

	/**
	 * CommCmdStatusResDTO { time=1, action=2, tid=4 }. The app polls the status of the action it just
	 * sent (64 for the base handshake, 82 after the PIN), so the action is a parameter.
	 *
	 * @param ts - unix timestamp (seconds)
	 * @param action - the action whose status to poll (64 or 82)
	 */
	private static commCmdH(ts: number, action: number): Buffer {
		return Buffer.concat([
			Buffer.concat([Buffer.from([0x08]), vint(ts)]),
			Buffer.concat([Buffer.from([0x10]), vint(action)]),
			Buffer.concat([Buffer.from([0x20]), vint(ts)]),
		]);
	}

	/**
	 * CommCmdResDTO { time=1, action=2 (=82), tid=5, data=6="<pin>" } — PIN verification.
	 *
	 * @param ts - unix timestamp (seconds)
	 * @param pin - pairing PIN
	 */
	private static commCmdPin(ts: number, pin: string): Buffer {
		const p = Buffer.from(pin, "ascii");
		return Buffer.concat([
			Buffer.concat([Buffer.from([0x08]), vint(ts)]),
			Buffer.from([0x10, 0x52]),
			Buffer.concat([Buffer.from([0x28]), vint(ts)]),
			Buffer.concat([Buffer.from([0x32, p.length]), p]),
		]);
	}
}

export default BleConnection;
