// crypto.js — WebCrypto recipes for the HMS-800-2WB BLE app-layer protocol.
//
// Ported 1:1 from the working Node reference (_fwanalysis/hms800-2wb/ble/server.mjs) and the
// libhmf.so reverse-engineering writeup (_fwanalysis/hms800-2wb/ble/LIBHMF_CRYPTO.md). There are
// TWO independent, non-interchangeable crypto paths — do not mix them up:
//
//   1. SN-CBC   — bootstrap only. AES-128-CBC keyed off the device's serial number (last 12 chars
//                 of the advertised BLE name). msgId/seq are encoded BIG-endian. Used to decrypt the
//                 very first 0xA201 notify, which carries `encRand` in the clear (inside ciphertext).
//   2. encRand-GCM — everything after bootstrap. AES-128-GCM keyed off the device-supplied 16-byte
//                 `encRand`. msgId/seq are encoded LITTLE-endian here — the opposite of SN-CBC.
//
// All primitives are async because they go through crypto.subtle.

import { concatBytes, utf8Encode } from "./util.js";

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error("WebCrypto (crypto.subtle) ist in diesem Kontext nicht verfügbar (braucht HTTPS/localhost).");
  return s;
}

/** SHA-256 over bytes, returns Uint8Array(32). */
export async function sha256(bytes) {
  const digest = await subtle().digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** SHA256(SHA256(SHA256(bytes))) — the triple-hash chain used throughout key/nonce derivation. */
export async function sha256x3(bytes) {
  return sha256(await sha256(await sha256(bytes)));
}

const SN_CONST = utf8Encode("Hoymiles@#123456");

/** SN-CBC key (session-constant): SHA256³(SN‖"Hoymiles@#123456")[0:16]. */
export async function snCbcKey(sn) {
  const h = await sha256x3(concatBytes(sn, SN_CONST));
  return h.subarray(0, 16);
}

/** SN-CBC IV (per-frame): SHA256³(msgId_BE16‖seq_BE16‖SN)[16:32]. Note: BIG-endian header. */
export async function snCbcIv(sn, msgId, seq) {
  const hdr = new Uint8Array(4);
  const dv = new DataView(hdr.buffer);
  dv.setUint16(0, msgId & 0xffff, false);
  dv.setUint16(2, seq & 0xffff, false);
  const h = await sha256x3(concatBytes(hdr, sn));
  return h.subarray(16, 32);
}

async function importAesCbcKey(rawKey) {
  return subtle().importKey("raw", rawKey, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
}

/**
 * Decrypt an SN-CBC bootstrap frame payload (AES-128-CBC/PKCS7). Throws (rejects) on a padding
 * failure — i.e. wrong SN/msgId/seq.
 */
export async function snDecrypt(sn, msgId, seq, ciphertext) {
  const key = await importAesCbcKey(await snCbcKey(sn));
  const iv = await snCbcIv(sn, msgId, seq);
  const pt = await subtle().decrypt({ name: "AES-CBC", iv }, key, ciphertext);
  return new Uint8Array(pt);
}

/** Encrypt a plaintext frame payload with SN-CBC (a/b-path) — the encrypt-side counterpart of snDecrypt. */
export async function snEncrypt(sn, msgId, seq, plaintext) {
  const key = await importAesCbcKey(await snCbcKey(sn));
  const iv = await snCbcIv(sn, msgId, seq);
  const ct = await subtle().encrypt({ name: "AES-CBC", iv }, key, plaintext);
  return new Uint8Array(ct);
}

/** BLE-GCM key (session-constant, per encRand): SHA256³(encRand[0:16])[0:16]. */
export async function bleKey(encRand) {
  const h = await sha256x3(encRand.subarray(0, 16));
  return h.subarray(0, 16);
}

/** BLE-GCM nonce (per-frame, 12B): SHA256³(msgId_LE16‖seq_LE16‖encRand[0:16])[20:32]. LITTLE-endian header. */
export async function bleNonce(encRand, msgId, seq) {
  const hdr = new Uint8Array(4);
  const dv = new DataView(hdr.buffer);
  dv.setUint16(0, msgId & 0xffff, true);
  dv.setUint16(2, seq & 0xffff, true);
  const h = await sha256x3(concatBytes(hdr, encRand.subarray(0, 16)));
  return h.subarray(20, 32);
}

/** BLE-GCM AAD (4B): uint32LE(msgId | (seq << 16)). */
export function bleAad(msgId, seq) {
  const aad = new Uint8Array(4);
  new DataView(aad.buffer).setUint32(0, ((msgId & 0xffff) | ((seq & 0xffff) << 16)) >>> 0, true);
  return aad;
}

async function importAesGcmKey(rawKey) {
  return subtle().importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypt with encRand-GCM. Output = ciphertext‖16B-tag — WebCrypto's AES-GCM already appends the
 * auth tag to the ciphertext, which happens to match the wire format directly.
 */
export async function bleEncrypt(encRand, msgId, seq, plaintext) {
  const key = await importAesGcmKey(await bleKey(encRand));
  const iv = await bleNonce(encRand, msgId, seq);
  const aad = bleAad(msgId, seq);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, plaintext);
  return new Uint8Array(ct);
}

/** Decrypt an encRand-GCM frame (ciphertext‖tag). Throws (rejects) on auth-tag mismatch. */
export async function bleDecrypt(encRand, msgId, seq, ciphertextPlusTag) {
  const key = await importAesGcmKey(await bleKey(encRand));
  const iv = await bleNonce(encRand, msgId, seq);
  const aad = bleAad(msgId, seq);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ciphertextPlusTag);
  return new Uint8Array(pt);
}
