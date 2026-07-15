// frames.js — HM wire framing + CRC16 + notify reassembly.
//
// Frame layout: "HM"(0x48,0x4D) | tag(u16 BE) | seq(u16 BE) | crc16(u16 BE) | totalLen(u16 BE) | payload
// totalLen = (crc-input length) + 10. For encRand-GCM frames the actual payload on the wire is
// 16 bytes longer than totalLen implies (the GCM tag is appended beyond totalLen — the CRC and
// totalLen are both computed over the ciphertext WITHOUT the tag). Ported from buildFrame/
// parseFrame/onNotify in _fwanalysis/hms800-2wb/ble/server.mjs.

import { concatBytes } from "./util.js";
import { bleEncrypt, snEncrypt } from "./crypto.js";

const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/** CRC-16/MODBUS (poly 0xA001, init 0xFFFF). */
export function crc16(bytes) {
  let c = 0xffff;
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xff];
  return c & 0xffff;
}

const MAGIC0 = 0x48; // 'H'
const MAGIC1 = 0x4d; // 'M'

/**
 * Build an HM frame.
 * @param {number} tag 16-bit command tag, e.g. 0xa301.
 * @param {Uint8Array} payload plaintext protobuf payload.
 * @param {object} opts { mode: "plain"|"gcm"|"sncbc", encRand?, sn?, seq }
 */
export async function buildFrame(tag, payload, { mode = "plain", encRand = null, sn = null, seq }) {
  seq = seq & 0xffff;
  let body, crcInput;
  if (mode === "gcm") {
    if (!encRand) throw new Error("frames.buildFrame: gcm-Modus braucht encRand");
    const full = await bleEncrypt(encRand, tag, seq, payload);
    crcInput = full.subarray(0, full.length - 16); // CRC über Ciphertext OHNE 16B-Tag
    body = full;
  } else if (mode === "sncbc") {
    if (!sn) throw new Error("frames.buildFrame: sncbc-Modus braucht sn");
    body = await snEncrypt(sn, tag, seq, payload);
    crcInput = body;
  } else {
    crcInput = payload;
    body = payload;
  }
  const hdr = new Uint8Array(10);
  hdr[0] = MAGIC0;
  hdr[1] = MAGIC1;
  const dv = new DataView(hdr.buffer);
  dv.setUint16(2, tag & 0xffff, false);
  dv.setUint16(4, seq, false);
  dv.setUint16(6, crc16(crcInput), false);
  dv.setUint16(8, crcInput.length + 10, false);
  return concatBytes(hdr, body);
}

/** Parse the HM header of a single frame. Returns null if `buf` doesn't start with "HM". */
export function parseFrame(buf) {
  if (buf.length < 10 || buf[0] !== MAGIC0 || buf[1] !== MAGIC1) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = dv.getUint16(2, false);
  const seq = dv.getUint16(4, false);
  const crc = dv.getUint16(6, false);
  const totalLen = dv.getUint16(8, false);
  return { tag, seq, crc, totalLen, payload: buf.subarray(10), rawLen: buf.length };
}

function indexOfMagic(buf, from) {
  for (let i = from; i < buf.length - 1; i++) if (buf[i] === MAGIC0 && buf[i + 1] === MAGIC1) return i;
  return -1;
}

/**
 * Accumulates BLE notify chunks (each characteristicvaluechanged event can be a fragment) and
 * yields complete HM frames once enough bytes have arrived. Mirrors onNotify() in server.mjs:
 * a frame is considered complete once at least `totalLen` bytes are buffered; if a second "HM"
 * magic follows immediately, that marks the boundary precisely (several frames coalesced into one
 * notify burst), otherwise the rest of the buffer is taken (covers the GCM tag tacked on past
 * totalLen).
 */
export class NotifyReassembler {
  constructor() {
    this.buf = new Uint8Array(0);
  }
  /** Feed a raw notify chunk; returns an array (possibly empty) of complete raw frame buffers. */
  push(chunk) {
    this.buf = concatBytes(this.buf, chunk);
    const out = [];
    while (this.buf.length >= 10 && this.buf[0] === MAGIC0 && this.buf[1] === MAGIC1) {
      const totalLen = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength).getUint16(8, false);
      if (this.buf.length < totalLen) break; // wait for more chunks
      let take = this.buf.length;
      const nextHm = indexOfMagic(this.buf, 2);
      if (nextHm > 0) take = nextHm;
      out.push(this.buf.subarray(0, take));
      this.buf = this.buf.subarray(take);
    }
    if (this.buf.length > 4096) this.buf = new Uint8Array(0); // desync guard
    return out;
  }
  reset() {
    this.buf = new Uint8Array(0);
  }
}
