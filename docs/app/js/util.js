// util.js — small byte/hex/text helpers shared by every module in this tool.
// No dependencies, pure ES module.

/** UTF-8 encode a string to Uint8Array. */
export function utf8Encode(str) {
  return new TextEncoder().encode(str);
}

/** UTF-8 decode a Uint8Array (or similar) to a string. */
export function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

/** Concatenate any number of Uint8Array-likes into one new Uint8Array. */
export function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Lowercase hex string from bytes. */
export function hexEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/** Bytes from a hex string (whitespace tolerant). Throws on odd-length/invalid input. */
export function hexDecode(hex) {
  const clean = String(hex).trim().replace(/\s+/g, "");
  if (clean.length % 2 !== 0) throw new Error("hexDecode: odd-length hex string");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = clean.substr(i * 2, 2);
    if (!/^[0-9a-fA-F]{2}$/.test(byte)) throw new Error(`hexDecode: invalid byte "${byte}"`);
    out[i] = parseInt(byte, 16);
  }
  return out;
}

/** Constant-shape (not constant-time — fine for UI-side comparisons) byte equality check. */
export function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Format a Date as "YYYY-MM-DD HH:MM:SS" (local time), as used by RealDataNewResDTO.time_ymd_hms. */
export function formatYmdHms(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/** Current unix time in whole seconds. */
export function unixNow() {
  return Math.floor(Date.now() / 1000);
}

/** Small helper: resolves after `ms` milliseconds. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Last 12 [A-Za-z0-9] characters of a BLE advertised device name, used as the device serial number. */
export function serialFromDeviceName(name) {
  if (!name) return null;
  const clean = name.replace(/[^A-Za-z0-9]/g, "");
  return clean.length >= 12 ? clean.slice(-12) : clean || null;
}
