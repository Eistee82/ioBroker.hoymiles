// proto.js — minimal hand-rolled protobuf (proto3 wire format) encoder/decoder.
//
// No codegen, no npm/CDN dependency (static page, strict CSP). Handles the wire types this
// protocol actually uses: varint (0), length-delimited (2) for strings/bytes/nested messages.
// Fixed32/fixed64 are parsed structurally (skipped) but not needed by any message here.
//
// Field numbers below are taken 1:1 from src/lib/proto/*.proto (RealDataNew, GetConfig, SetConfig,
// APPInformationData) plus the CommCmd message shapes confirmed against a live capture in
// _fwanalysis/hms800-2wb/ble/server.mjs (that file builds those bytes by hand; here we generalize
// the same field numbers through a real writer/reader).

import { concatBytes, utf8Encode, utf8Decode } from "./util.js";

const WT_VARINT = 0;
const WT_FIXED64 = 1;
const WT_LEN = 2;
const WT_FIXED32 = 5;

// ---------- varint ----------

/** Encode a non-negative or proto3-signed integer (number|bigint) as a protobuf varint. */
export function encodeVarint(value) {
  let v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (v < 0n) v &= 0xffffffffffffffffn; // proto3 plain int32/int64: negative -> 10-byte two's complement
  const bytes = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) b |= 0x80;
    bytes.push(b);
  } while (v !== 0n);
  return Uint8Array.from(bytes);
}

/** Decode a varint starting at `offset`. Returns { value: bigint, next: offset-after }. */
export function decodeVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  for (;;) {
    if (i >= buf.length) throw new Error("proto: truncated varint");
    const b = buf[i++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error("proto: varint too long");
  }
  return { value: result, next: i };
}

function tagByte(fieldNo, wireType) {
  return encodeVarint((fieldNo << 3) | wireType);
}

// ---------- writer ----------

/** Fluent protobuf message writer. Every setter is a no-op for undefined/null (proto3 "unset"). */
export class ProtoWriter {
  constructor() {
    this.chunks = [];
  }
  /** int32/uint32/int64/uint64 field (varint wire type). */
  varint(fieldNo, value) {
    if (value === undefined || value === null) return this;
    this.chunks.push(tagByte(fieldNo, WT_VARINT), encodeVarint(value));
    return this;
  }
  /** UTF-8 string field. */
  string(fieldNo, str) {
    if (str === undefined || str === null) return this;
    return this.bytes(fieldNo, utf8Encode(str));
  }
  /** Raw bytes field. */
  bytes(fieldNo, data) {
    if (data === undefined || data === null) return this;
    this.chunks.push(tagByte(fieldNo, WT_LEN), encodeVarint(data.length), data);
    return this;
  }
  /** Nested message field — pass either a finished ProtoWriter or raw encoded bytes. */
  message(fieldNo, writerOrBytes) {
    const data = writerOrBytes instanceof ProtoWriter ? writerOrBytes.finish() : writerOrBytes;
    return this.bytes(fieldNo, data);
  }
  finish() {
    return concatBytes(...this.chunks);
  }
}

// ---------- reader ----------
//
// parseMessage() parses one message level into a Map<fieldNo, entry[]>, entry = { wireType, raw }.
// `raw` is a bigint for varint/fixed32/fixed64 (fixed values kept as their raw bytes' bigint LE
// value is NOT computed — fixed32/64 are only skip-parsed since nothing here uses them), or a
// Uint8Array for length-delimited fields. Repeated fields collect multiple entries in wire order.

export function parseMessage(buf) {
  const fields = new Map();
  let i = 0;
  while (i < buf.length) {
    const t = decodeVarint(buf, i);
    i = t.next;
    const tagNum = Number(t.value);
    const fieldNo = tagNum >>> 3;
    const wireType = tagNum & 7;
    let raw;
    if (wireType === WT_VARINT) {
      const v = decodeVarint(buf, i);
      raw = v.value;
      i = v.next;
    } else if (wireType === WT_LEN) {
      const l = decodeVarint(buf, i);
      i = l.next;
      const len = Number(l.value);
      if (i + len > buf.length) throw new Error("proto: length-delimited field runs past end of buffer");
      raw = buf.subarray(i, i + len);
      i += len;
    } else if (wireType === WT_FIXED32) {
      raw = buf.subarray(i, i + 4);
      i += 4;
    } else if (wireType === WT_FIXED64) {
      raw = buf.subarray(i, i + 8);
      i += 8;
    } else {
      throw new Error(`proto: unsupported wire type ${wireType} (field ${fieldNo})`);
    }
    if (!fields.has(fieldNo)) fields.set(fieldNo, []);
    fields.get(fieldNo).push({ wireType, raw });
  }
  return fields;
}

function lastRaw(fields, fieldNo) {
  const entries = fields.get(fieldNo);
  return entries && entries.length ? entries[entries.length - 1].raw : undefined; // proto3: last-one-wins
}

/** Signed integer (int32/int64 semantics) field value as a JS number, or undefined if unset. */
export function getIntNumber(fields, fieldNo) {
  const raw = lastRaw(fields, fieldNo);
  if (raw === undefined || typeof raw !== "bigint") return undefined;
  return Number(BigInt.asIntN(64, raw));
}

/** String field value, or undefined if unset. */
export function getString(fields, fieldNo) {
  const raw = lastRaw(fields, fieldNo);
  return raw === undefined ? undefined : utf8Decode(raw);
}

/** Raw bytes field value (Uint8Array), or undefined if unset. */
export function getBytes(fields, fieldNo) {
  const raw = lastRaw(fields, fieldNo);
  return raw instanceof Uint8Array ? raw : undefined;
}

/** Parse a nested message field into its own field map, or undefined if unset. */
export function getMessage(fields, fieldNo) {
  const raw = getBytes(fields, fieldNo);
  return raw === undefined ? undefined : parseMessage(raw);
}

/** Parse every occurrence of a repeated nested-message field into an array of field maps. */
export function getRepeatedMessages(fields, fieldNo) {
  const entries = fields.get(fieldNo);
  if (!entries) return [];
  return entries.map((e) => parseMessage(e.raw));
}

/**
 * Walk a chain of length-delimited field numbers through nested messages, e.g. [8, 27] means
 * "top-level field 8, then field 27 inside that submessage". Returns the raw bytes of the final
 * field, or undefined if any hop is missing. Mirrors pbFindNested() from server.mjs.
 */
export function getNestedBytes(buf, path) {
  let fields = parseMessage(buf);
  let raw;
  for (let idx = 0; idx < path.length; idx++) {
    raw = getBytes(fields, path[idx]);
    if (raw === undefined) return undefined;
    if (idx < path.length - 1) fields = parseMessage(raw);
  }
  return raw;
}
