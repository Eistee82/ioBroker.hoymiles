// serverlist.js — the seven Hoymiles regional cloud servers + the per-device "factory default"
// cookie logic (stored in localStorage, keyed by device serial number).

export const DEFAULT_PORT = 10081;

export const REGIONAL_SERVERS = [
  { id: "dataeu", host: "dataeu.hoymiles.com", label: "Europa" },
  { id: "datacn", host: "datacn.hoymiles.com", label: "China" },
  { id: "dataas", host: "dataas.hoymiles.com", label: "Asien" },
  { id: "dataaf", host: "dataaf.hoymiles.com", label: "Afrika" },
  { id: "dataoa", host: "dataoa.hoymiles.com", label: "Ozeanien" },
  { id: "datana", host: "datana.hoymiles.com", label: "Nordamerika" },
  { id: "datasa", host: "datasa.hoymiles.com", label: "Südamerika" },
];

/** True if `host` is one of Hoymiles' own cloud domains (vs. a custom relay address). */
export function isHoymilesHost(host) {
  return /(^|\.)hoymiles\.com$/i.test(String(host || "").trim());
}

/** Find a regional server entry by host, or null. */
export function findRegionalServerByHost(host) {
  const h = String(host || "").trim().toLowerCase();
  return REGIONAL_SERVERS.find((s) => s.host.toLowerCase() === h) || null;
}

const STORAGE_PREFIX = "hoymiles-ble.default-server.";

function storageKey(sn) {
  return STORAGE_PREFIX + String(sn).trim();
}

/** Read the stored "factory default" server for a device serial number, or null if none saved. */
export function getDefaultServerForSn(sn) {
  try {
    const raw = localStorage.getItem(storageKey(sn));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** True if a default server has already been recorded for this SN (used to gate the one-time save). */
export function hasDefaultServerForSn(sn) {
  try {
    return localStorage.getItem(storageKey(sn)) !== null;
  } catch {
    return false;
  }
}

/** Persist {host, port} as the factory default for this SN. Only ever called once per device. */
export function setDefaultServerForSn(sn, host, port) {
  try {
    localStorage.setItem(storageKey(sn), JSON.stringify({ host, port, savedAt: Date.now() }));
  } catch {
    /* localStorage unavailable (private mode / quota) — non-fatal, just no default badge */
  }
}
