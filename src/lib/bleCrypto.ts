import * as crypto from "node:crypto";
import { crc16 } from "./crc16.js";
import { HM_MAGIC_0, HM_MAGIC_1 } from "./constants.js";

/**
 * BLE crypto and framing for the HMS-800-2WB (and other BLE-only Hoymiles inverters).
 *
 * Two independent schemes, both reverse-engineered from `libhmf.so`
 * (see `_fwanalysis/hms800-2wb/ble/LIBHMF_CRYPTO.md`) and verified live against the device:
 *
 * - **AES-128-GCM** ("gcm"): the normal authenticated channel. The only secret is `encRand`
 *   (16 bytes) which the device sends in cleartext during the bootstrap. msgId/seq are
 *   **little-endian** here — the opposite of the TCP path in {@link Encryption} (big-endian CBC).
 * - **AES-128-CBC** ("sncbc"): the bootstrap path for the `0xa201`/`0xa301` frames that carry
 *   `encRand` in the clear. Key/IV are derived from the serial number (last 12 chars of the BLE
 *   device name), msgId/seq are **big-endian** here.
 *
 * All functions are pure so they can be unit-tested without a device.
 */

/** Protocol constant folded into the SN-CBC bootstrap key — NOT a secret (hardcoded in libhmf.so). */
const SN_CONST = Buffer.from("Hoymiles@#123456", "ascii");

const HM_HEADER_SIZE = 10;
const GCM_TAG_LEN = 16;

/** Frame encryption mode. */
export type BleFrameMode = "plain" | "gcm" | "sncbc";

/** Options for {@link bleBuildFrame}. */
export interface BleBuildFrameOptions {
	/** Encryption mode: plaintext, encRand-GCM, or SN-CBC bootstrap. */
	mode?: BleFrameMode;
	/** 16-byte random seed from the device (required for `gcm`). */
	encRand?: Buffer | null;
	/** Serial number bytes (required for `sncbc`). */
	sn?: Buffer | null;
	/** 16-bit sequence number for this frame. */
	seq: number;
}

/** A parsed HM frame (header fields + raw payload). */
export interface BleParsedFrame {
	/** Command tag (msgId), e.g. 0xa201. */
	tag: number;
	/** 16-bit sequence number. */
	seq: number;
	/** CRC-16/MODBUS from the header (over the ciphertext-without-tag / plaintext). */
	crc: number;
	/** Declared total length = crcInput length + 10. */
	totalLen: number;
	/** Raw payload bytes after the 10-byte header (ciphertext+tag for gcm, ciphertext for sncbc). */
	payload: Buffer;
}

const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
/**
 * SHA-256 applied three times (the Hoymiles KDF).
 *
 * @param b - input buffer
 */
const sha256x3 = (b: Buffer): Buffer => sha256(sha256(sha256(b)));

// --- AES-128-GCM (encRand) ---------------------------------------------------

/**
 * Derive the session GCM key: SHA256³(encRand[0:16])[0:16]. Depends only on encRand.
 *
 * @param encRand - 16-byte device random seed
 */
export function bleKey(encRand: Buffer): Buffer {
	return sha256x3(encRand.subarray(0, 16)).subarray(0, 16);
}

/**
 * Derive the 12-byte GCM nonce: SHA256³(msgId_LE16 ‖ seq_LE16 ‖ encRand[0:16])[20:32].
 *
 * @param encRand - 16-byte device random seed
 * @param msgId - command tag (msgId)
 * @param seq - 16-bit sequence number
 */
export function bleNonce(encRand: Buffer, msgId: number, seq: number): Buffer {
	const h = Buffer.alloc(4 + 16);
	h.writeUInt16LE(msgId & 0xffff, 0);
	h.writeUInt16LE(seq & 0xffff, 2);
	encRand.subarray(0, 16).copy(h, 4);
	return sha256x3(h).subarray(20, 32);
}

/**
 * Derive the 4-byte GCM AAD: uint32LE(msgId | (seq << 16)).
 *
 * @param msgId - command tag (msgId)
 * @param seq - 16-bit sequence number
 */
export function bleAad(msgId: number, seq: number): Buffer {
	const a = Buffer.alloc(4);
	a.writeUInt32LE(((msgId & 0xffff) | ((seq & 0xffff) << 16)) >>> 0, 0);
	return a;
}

/**
 * AES-128-GCM encrypt. Returns `{ ct, tag, full }` where `full = ct ‖ tag(16)`.
 *
 * @param encRand - 16-byte device random seed
 * @param msgId - command tag
 * @param seq - sequence number
 * @param plain - plaintext payload
 */
export function bleEncrypt(
	encRand: Buffer,
	msgId: number,
	seq: number,
	plain: Buffer,
): { ct: Buffer; tag: Buffer; full: Buffer } {
	const c = crypto.createCipheriv("aes-128-gcm", bleKey(encRand), bleNonce(encRand, msgId, seq), {
		authTagLength: GCM_TAG_LEN,
	});
	c.setAAD(bleAad(msgId, seq));
	const ct = Buffer.concat([c.update(plain), c.final()]);
	const tag = c.getAuthTag();
	return { ct, tag, full: Buffer.concat([ct, tag]) };
}

/**
 * AES-128-GCM decrypt of `ciphertext ‖ tag(16)`. Throws on tag mismatch.
 *
 * @param encRand - 16-byte device random seed
 * @param msgId - command tag
 * @param seq - sequence number
 * @param ctPlusTag - ciphertext followed by the 16-byte GCM tag
 */
export function bleDecrypt(encRand: Buffer, msgId: number, seq: number, ctPlusTag: Buffer): Buffer {
	const ct = ctPlusTag.subarray(0, ctPlusTag.length - GCM_TAG_LEN);
	const tag = ctPlusTag.subarray(ctPlusTag.length - GCM_TAG_LEN);
	const d = crypto.createDecipheriv("aes-128-gcm", bleKey(encRand), bleNonce(encRand, msgId, seq), {
		authTagLength: GCM_TAG_LEN,
	});
	d.setAAD(bleAad(msgId, seq));
	d.setAuthTag(tag);
	return Buffer.concat([d.update(ct), d.final()]);
}

// --- AES-128-CBC (SN bootstrap) ----------------------------------------------

/**
 * Derive the session SN-CBC key: SHA256³(SN ‖ "Hoymiles@#123456")[0:16].
 *
 * @param sn - serial-number bytes
 */
export function snCbcKey(sn: Buffer): Buffer {
	return sha256x3(Buffer.concat([sn, SN_CONST])).subarray(0, 16);
}

/**
 * Derive the per-frame SN-CBC IV: SHA256³(msgId_BE16 ‖ seq_BE16 ‖ SN)[16:32] (big-endian!).
 *
 * @param sn - serial-number bytes
 * @param msgId - command tag (msgId)
 * @param seq - 16-bit sequence number
 */
export function snCbcIv(sn: Buffer, msgId: number, seq: number): Buffer {
	const h = Buffer.alloc(4);
	h.writeUInt16BE(msgId & 0xffff, 0);
	h.writeUInt16BE(seq & 0xffff, 2);
	return sha256x3(Buffer.concat([h, sn])).subarray(16, 32);
}

/**
 * AES-128-CBC encrypt (PKCS7). Returns raw ciphertext (no tag).
 *
 * @param sn - serial number bytes
 * @param msgId - command tag
 * @param seq - sequence number
 * @param plain - plaintext payload
 */
export function snEncrypt(sn: Buffer, msgId: number, seq: number, plain: Buffer): Buffer {
	const c = crypto.createCipheriv("aes-128-cbc", snCbcKey(sn), snCbcIv(sn, msgId, seq));
	c.setAutoPadding(true);
	return Buffer.concat([c.update(plain), c.final()]);
}

/**
 * AES-128-CBC decrypt (PKCS7). Throws on padding error.
 *
 * @param sn - serial number bytes
 * @param msgId - command tag
 * @param seq - sequence number
 * @param ct - ciphertext
 */
export function snDecrypt(sn: Buffer, msgId: number, seq: number, ct: Buffer): Buffer {
	const d = crypto.createDecipheriv("aes-128-cbc", snCbcKey(sn), snCbcIv(sn, msgId, seq));
	d.setAutoPadding(true);
	return Buffer.concat([d.update(ct), d.final()]);
}

// --- HM framing --------------------------------------------------------------

/**
 * Build an HM frame: `"HM" | tag(u16BE) | seq(u16BE) | crc16(u16BE) | totalLen(u16BE) | body`.
 *
 * The CRC and totalLen cover the *crc input* (plaintext for `plain`, ciphertext-without-tag for
 * `gcm`, ciphertext for `sncbc`); the body carries the 16-byte GCM tag appended for `gcm`.
 *
 * @param tag - command tag (also used as GCM/CBC msgId)
 * @param payload - plaintext payload
 * @param opts - encryption mode and key material
 */
export function bleBuildFrame(tag: number, payload: Buffer, opts: BleBuildFrameOptions): Buffer {
	const seq = opts.seq & 0xffff;
	const mode = opts.mode ?? "plain";
	let body: Buffer;
	let crcInput: Buffer;

	if (mode === "gcm") {
		if (!opts.encRand) {
			throw new Error("gcm mode requires encRand");
		}
		const { ct, full } = bleEncrypt(opts.encRand, tag, seq, payload);
		crcInput = ct;
		body = full;
	} else if (mode === "sncbc") {
		if (!opts.sn) {
			throw new Error("sncbc mode requires sn");
		}
		const ct = snEncrypt(opts.sn, tag, seq, payload);
		crcInput = ct;
		body = ct;
	} else {
		crcInput = payload;
		body = payload;
	}

	const hdr = Buffer.alloc(HM_HEADER_SIZE);
	hdr[0] = HM_MAGIC_0;
	hdr[1] = HM_MAGIC_1;
	hdr.writeUInt16BE(tag & 0xffff, 2);
	hdr.writeUInt16BE(seq, 4);
	hdr.writeUInt16BE(crc16(crcInput), 6);
	hdr.writeUInt16BE(crcInput.length + HM_HEADER_SIZE, 8);
	return Buffer.concat([hdr, body]);
}

/**
 * Parse an HM frame header. Returns null if the buffer is not a valid HM frame.
 *
 * @param buf - complete frame bytes
 */
export function bleParseFrame(buf: Buffer): BleParsedFrame | null {
	if (buf.length < HM_HEADER_SIZE || buf[0] !== HM_MAGIC_0 || buf[1] !== HM_MAGIC_1) {
		return null;
	}
	return {
		tag: buf.readUInt16BE(2),
		seq: buf.readUInt16BE(4),
		crc: buf.readUInt16BE(6),
		totalLen: buf.readUInt16BE(8),
		payload: buf.subarray(HM_HEADER_SIZE),
	};
}

// --- Minimal protobuf field scanners (for encRand + handshake status) --------

/**
 * Find a length-delimited (wire type 2) field by number. Returns null if absent.
 *
 * @param buf - protobuf message bytes
 * @param fieldNo - field number to look up
 */
export function pbFindBytes(buf: Buffer, fieldNo: number): Buffer | null {
	let i = 0;
	while (i < buf.length) {
		let tag = 0;
		let sh = 0;
		let b: number;
		do {
			b = buf[i++];
			tag |= (b & 0x7f) << sh;
			sh += 7;
		} while (b & 0x80 && i < buf.length);
		const fno = tag >>> 3;
		const wt = tag & 7;
		if (wt === 2) {
			let len = 0;
			let s2 = 0;
			let c: number;
			do {
				c = buf[i++];
				len |= (c & 0x7f) << s2;
				s2 += 7;
			} while (c & 0x80 && i < buf.length);
			const val = buf.subarray(i, i + len);
			i += len;
			if (fno === fieldNo) {
				return val;
			}
		} else if (wt === 0) {
			let c: number;
			do {
				c = buf[i++];
			} while (c & 0x80 && i < buf.length);
		} else if (wt === 5) {
			i += 4;
		} else if (wt === 1) {
			i += 8;
		} else {
			break;
		}
	}
	return null;
}

/**
 * Follow a path of nested length-delimited fields, e.g. `[8, 27]` = dtu_info.enc_rand.
 *
 * @param buf - protobuf message bytes
 * @param path - sequence of field numbers to descend
 */
export function pbFindNested(buf: Buffer, path: number[]): Buffer | null {
	let cur: Buffer | null = buf;
	for (const target of path) {
		if (!cur) {
			return null;
		}
		cur = pbFindBytes(cur, target);
	}
	return cur;
}

/**
 * Find a varint (wire type 0) field by number. Returns null if absent.
 *
 * @param buf - protobuf message bytes
 * @param fieldNo - field number to look up
 */
export function pbFindVarint(buf: Buffer, fieldNo: number): number | null {
	let i = 0;
	while (i < buf.length) {
		let tag = 0;
		let sh = 0;
		let b: number;
		do {
			b = buf[i++];
			tag |= (b & 0x7f) << sh;
			sh += 7;
		} while (b & 0x80 && i < buf.length);
		const fno = tag >>> 3;
		const wt = tag & 7;
		if (wt === 0) {
			let n = 0;
			let s = 0;
			let c: number;
			do {
				c = buf[i++];
				n |= (c & 0x7f) << s;
				s += 7;
			} while (c & 0x80 && i < buf.length);
			if (fno === fieldNo) {
				return n;
			}
		} else if (wt === 2) {
			let l = 0;
			let s = 0;
			let c: number;
			do {
				c = buf[i++];
				l |= (c & 0x7f) << s;
				s += 7;
			} while (c & 0x80 && i < buf.length);
			i += l;
		} else if (wt === 5) {
			i += 4;
		} else if (wt === 1) {
			i += 8;
		} else {
			break;
		}
	}
	return null;
}

/**
 * Extract the 16-byte encRand from a decrypted bootstrap response (field path 8.27).
 *
 * @param decryptedBootstrap - decrypted `0xa201` payload
 */
export function extractEncRand(decryptedBootstrap: Buffer): Buffer | null {
	const enc = pbFindNested(decryptedBootstrap, [8, 27]);
	if (enc && enc.length >= 16) {
		return Buffer.from(enc.subarray(0, 16));
	}
	return null;
}
