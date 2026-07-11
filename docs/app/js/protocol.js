// protocol.js — HMS-800-2WB BLE application protocol: bootstrap, PIN handshake, RealData polling,
// GetConfig/SetConfig. Combines frames.js (wire framing) + crypto.js (WebCrypto) + proto.js
// (protobuf) into one session state machine that a UI layer (app.js) drives.
//
// Message field numbers and the handshake sequence are taken from:
//   - src/lib/proto/{RealDataNew,GetConfig,SetConfig,APPInformationData}.proto
//   - _fwanalysis/hms800-2wb/ble/server.mjs (working Node reference — CommCmd byte layout, sts
//     field number, tick/keepalive sequencing)
//   - _fwanalysis/hms800-2wb/ble/BLE_HANDSHAKE_APP.md (PIN-gate semantics, action codes, sts codes)
//
// Tag convention: the device's notify response tag is (request tag - 0x0100), e.g. 0xA301 ->
// 0xA201, 0xA311 -> 0xA211, 0xA319 -> 0xA219 — all confirmed against a live capture or given
// directly in the task spec, as is the GetConfig pair 0xA309 -> 0xA209. The SetConfig *response*
// tag 0xA310 -> 0xA210 is the one number in this file that is EXTRAPOLATED from that pattern
// rather than independently confirmed — BLE_HANDSHAKE_APP.md only names the reply DTO
// (SetConfigReqDTO), not its numeric tag. Flagged again at TAG.SETCONFIG_RES below.

import { buildFrame, parseFrame, NotifyReassembler } from "./frames.js";
import { snDecrypt, bleDecrypt } from "./crypto.js";
import { ProtoWriter, parseMessage, getIntNumber, getString, getMessage, getRepeatedMessages, getNestedBytes } from "./proto.js";
import { formatYmdHms, unixNow, hexEncode } from "./util.js";

export const TAG = {
  BOOTSTRAP_REQ: 0xa301, // APPInfoDataRes (App->device, plain)
  BOOTSTRAP_RES: 0xa201, // APPInfoDataReqDTO (device->App, SN-CBC) — carries encRand
  COMMCMD_Y_REQ: 0xa318, // CommCmdResDTO (status query "Y" / PIN send, action 64 / 82)
  COMMCMD_H_REQ: 0xa319, // CommCmdStatusResDTO (status query "H", action 64)
  COMMCMD_STATUS_RES: 0xa219, // CommCmdStatusReqDTO (device->App) — carries sts (field 11)
  REALDATA_REQ: 0xa311, // RealDataNewResDTO (App->device request-for-data, confusingly named)
  REALDATA_RES: 0xa211, // RealDataNewReqDTO (device->App, actual telemetry)
  GETCONFIG_REQ: 0xa309, // GetConfigResDTO (App->device request) — tag pair given directly in the task spec
  GETCONFIG_RES: 0xa209, // GetConfigReqDTO (device->App, full config)
  SETCONFIG_REQ: 0xa310, // SetConfigResDTO (App->device write) — request tag given directly in the task spec
  SETCONFIG_RES: 0xa210, // SetConfigReqDTO (device->App, offset/error_code) — response tag EXTRAPOLATED from
  // the (request - 0x0100) pattern confirmed for bootstrap/RealData/CommCmd; BLE_HANDSHAKE_APP.md only names
  // the DTO, not the numeric tag. Verify against a live 0xA210 (or whatever tag actually arrives) capture.
};

const TZ_OFFSET_SECONDS = 28800; // ClientConstants default (matches the app; UTC+8 timezone slot, not local TZ)

// ---------- outbound message builders ----------

function buildBootstrapRequest() {
  return new Uint8Array(0); // APPInfoDataRes: empty plaintext payload, as observed live
}

/** CommCmdResDTO "Y": {time=1, action=2=64, tid=5}. Status query, first half. */
function buildCommCmdStatusQueryY() {
  const t = unixNow();
  return new ProtoWriter().varint(1, t).varint(2, 64).varint(5, t).finish();
}

/** CommCmdStatusResDTO "H": {time=1, action=2=64, tid=4}. Status query, second half — its reply carries sts. */
function buildCommCmdStatusQueryH() {
  const t = unixNow();
  return new ProtoWriter().varint(1, t).varint(2, 64).varint(4, t).finish();
}

/** CommCmdResDTO PIN-verify: {time=1, action=2=82, tid=5, data=6="<pin>"}. Sent exactly once per PIN attempt. */
function buildCommCmdPinVerify(pin) {
  const t = unixNow();
  return new ProtoWriter().varint(1, t).varint(2, 82).varint(5, t).string(6, pin).finish();
}

/** RealDataNewResDTO request: {time_ymd_hms=1, cp=2, error_code=3=0, offset=4, time=5}. */
function buildRealDataRequest(cp) {
  const w = new ProtoWriter();
  w.bytes(1, new TextEncoder().encode(formatYmdHms()));
  w.varint(2, cp);
  w.varint(3, 0);
  w.varint(4, TZ_OFFSET_SECONDS);
  w.varint(5, unixNow());
  return w.finish();
}

/** GetConfigResDTO request: {offset=1, time=2}. */
function buildGetConfigRequest() {
  return new ProtoWriter().varint(1, TZ_OFFSET_SECONDS).varint(2, unixNow()).finish();
}

// Field table shared by GetConfig response decoding and SetConfig request encoding.
// `writable` fields (1-51) exist in both GetConfigReqDTO and SetConfigResDTO; the remainder
// (52-62) are device-info-only fields present just in GetConfigReqDTO (MAC/AP details).
const CONFIG_FIELDS = [
  { no: 1, name: "offset", type: "int" },
  { no: 2, name: "time", type: "int" },
  { no: 3, name: "lockPassword", type: "int" },
  { no: 4, name: "lockTime", type: "int" },
  { no: 5, name: "limitPowerMypower", type: "int" },
  { no: 6, name: "zeroExport433Addr", type: "int" },
  { no: 7, name: "zeroExportEnable", type: "int" },
  { no: 8, name: "netmodeSelect", type: "int" },
  { no: 9, name: "channelSelect", type: "int" },
  { no: 10, name: "serverSendTime", type: "int" },
  { no: 11, name: "wifiRssi", type: "int" },
  { no: 12, name: "serverport", type: "int" },
  { no: 13, name: "apnSet", type: "string" },
  { no: 14, name: "meterKind", type: "string" },
  { no: 15, name: "meterInterface", type: "string" },
  { no: 16, name: "wifiSsid", type: "string" },
  { no: 17, name: "wifiPassword", type: "string" },
  { no: 18, name: "serverDomainName", type: "string" },
  { no: 19, name: "invType", type: "int" },
  { no: 20, name: "dtuSn", type: "string" },
  { no: 21, name: "accessModel", type: "int" },
  { no: 22, name: "mac0", type: "int" },
  { no: 23, name: "mac1", type: "int" },
  { no: 24, name: "mac2", type: "int" },
  { no: 25, name: "mac3", type: "int" },
  { no: 26, name: "dhcpSwitch", type: "int" },
  { no: 27, name: "ipAddr0", type: "int" },
  { no: 28, name: "ipAddr1", type: "int" },
  { no: 29, name: "ipAddr2", type: "int" },
  { no: 30, name: "ipAddr3", type: "int" },
  { no: 31, name: "subnetMask0", type: "int" },
  { no: 32, name: "subnetMask1", type: "int" },
  { no: 33, name: "subnetMask2", type: "int" },
  { no: 34, name: "subnetMask3", type: "int" },
  { no: 35, name: "defaultGateway0", type: "int" },
  { no: 36, name: "defaultGateway1", type: "int" },
  { no: 37, name: "defaultGateway2", type: "int" },
  { no: 38, name: "defaultGateway3", type: "int" },
  { no: 39, name: "kaNub", type: "string" },
  { no: 40, name: "apnName", type: "string" },
  { no: 41, name: "apnPassword", type: "string" },
  { no: 42, name: "sub1gSweepSwitch", type: "int" },
  { no: 43, name: "sub1gWorkChannel", type: "int" },
  { no: 44, name: "cableDns0", type: "int" },
  { no: 45, name: "cableDns1", type: "int" },
  { no: 46, name: "cableDns2", type: "int" },
  { no: 47, name: "cableDns3", type: "int" },
  { no: 48, name: "wifiIpAddr0", type: "int" },
  { no: 49, name: "wifiIpAddr1", type: "int" },
  { no: 50, name: "wifiIpAddr2", type: "int" },
  { no: 51, name: "wifiIpAddr3", type: "int" },
];
const CONFIG_FIELDS_READONLY = [
  { no: 52, name: "mac4", type: "int" },
  { no: 53, name: "mac5", type: "int" },
  { no: 54, name: "wifiMac0", type: "int" },
  { no: 55, name: "wifiMac1", type: "int" },
  { no: 56, name: "wifiMac2", type: "int" },
  { no: 57, name: "wifiMac3", type: "int" },
  { no: 58, name: "wifiMac4", type: "int" },
  { no: 59, name: "wifiMac5", type: "int" },
  { no: 60, name: "gprsImei", type: "string" },
  { no: 61, name: "dtuApSsid", type: "string" },
  { no: 62, name: "dtuApPass", type: "string" },
];

/** Decode a GetConfigReqDTO (device's config reply) into a plain, named object. */
export function decodeConfig(buf) {
  const fields = parseMessage(buf);
  const out = {};
  for (const f of [...CONFIG_FIELDS, ...CONFIG_FIELDS_READONLY]) {
    out[f.name] = f.type === "string" ? getString(fields, f.no) : getIntNumber(fields, f.no);
  }
  return out;
}

/**
 * Build a SetConfigResDTO from a previously-decoded config object, applying `overrides`. Mirrors
 * what the app does: read the full config first, change only what the user wants (here: server
 * host/port), and re-send every other writable field unchanged so nothing else gets reset.
 */
export function buildSetConfigRequest(currentConfig, overrides) {
  const merged = { ...currentConfig, ...overrides, offset: TZ_OFFSET_SECONDS, time: unixNow() };
  const w = new ProtoWriter();
  for (const f of CONFIG_FIELDS) {
    const v = merged[f.name];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "string") w.string(f.no, v);
    else w.varint(f.no, v);
  }
  return w.finish();
}

// ---------- inbound message parsers ----------

/** Parse APPInfoDataReqDTO (bootstrap reply): dtu serial, device info, and encRand. */
function parseBootstrapReply(buf) {
  const fields = parseMessage(buf);
  const dtuSerial = getString(fields, 1);
  const dtuInfoFields = getMessage(fields, 8);
  let deviceInfo = null;
  let encRand;
  if (dtuInfoFields) {
    deviceInfo = {
      deviceKind: getIntNumber(dtuInfoFields, 1),
      dtuSwVersion: getIntNumber(dtuInfoFields, 2),
      dtuHwVersion: getIntNumber(dtuInfoFields, 3),
      signalStrength: getIntNumber(dtuInfoFields, 9),
      gprsVersion: getString(dtuInfoFields, 10),
      wifiVersion: getString(dtuInfoFields, 11),
      dtuRuleId: getIntNumber(dtuInfoFields, 13),
    };
  }
  encRand = getNestedBytes(buf, [8, 27]);
  return { dtuSerial, deviceInfo, encRand };
}

/** Parse CommCmdStatusReqDTO: only `sts` (field 11) matters for the handshake. */
function parseCommCmdStatus(buf) {
  const fields = parseMessage(buf);
  return { sts: getIntNumber(fields, 11) };
}

/** Parse RealDataNewReqDTO (telemetry): device serial, timestamp, SGSMO (AC), PvMO[] (DC strings). */
function parseRealData(buf) {
  const fields = parseMessage(buf);
  const sgsList = getRepeatedMessages(fields, 9);
  const sgs = sgsList[0];
  const ac = sgs
    ? {
        voltage: divOrUndef(getIntNumber(sgs, 3), 10),
        frequency: divOrUndef(getIntNumber(sgs, 4), 100),
        activePower: divOrUndef(getIntNumber(sgs, 5), 10),
        reactivePower: getIntNumber(sgs, 6),
        current: divOrUndef(getIntNumber(sgs, 7), 100),
        powerFactor: getIntNumber(sgs, 8),
        temperature: divOrUndef(getIntNumber(sgs, 9), 10),
        warningNumber: getIntNumber(sgs, 10),
        linkStatus: getIntNumber(sgs, 12),
        powerLimit: getIntNumber(sgs, 13),
      }
    : null;
  const pvList = getRepeatedMessages(fields, 11).map((pv) => ({
    portNumber: getIntNumber(pv, 2),
    voltage: divOrUndef(getIntNumber(pv, 3), 10),
    current: divOrUndef(getIntNumber(pv, 4), 100),
    power: divOrUndef(getIntNumber(pv, 5), 10),
    energyTotal: getIntNumber(pv, 6),
    energyDaily: getIntNumber(pv, 7),
    errorCode: getIntNumber(pv, 8),
  }));
  return {
    deviceSerialNumber: getString(fields, 1),
    timestamp: getIntNumber(fields, 2),
    ac,
    pv: pvList,
  };
}

function divOrUndef(v, d) {
  return v === undefined ? undefined : v / d;
}

// ---------- session state machine ----------

const KEEPALIVE_MS = 5000;
const REALDATA_POLL_MS = 3000;

/**
 * Drives the full session against one connected BLE transport. The transport only needs to
 * expose an async `write(bytes)` — everything protocol-specific (encryption, framing, handshake
 * timing, decrypt-attempt ordering) lives here. UI state changes are reported through `onEvent`.
 *
 * hs (handshake) states: boot -> commcmd -> pin_needed -> pin_wait -> paired
 *                                                       \-> pin_failed
 */
export class HoymilesSession {
  /**
   * @param {object} opts
   * @param {(bytes: Uint8Array) => Promise<void>} opts.write raw GATT write to ffe1
   * @param {(event: {type: string, [k: string]: any}) => void} opts.onEvent UI notification sink
   * @param {string} opts.sn device serial number (last 12 chars of the BLE name)
   */
  constructor({ write, onEvent, sn }) {
    this.write = write;
    this.onEvent = onEvent || (() => {});
    this.sn = new TextEncoder().encode(sn);
    this.snString = sn;
    this.encRand = null;
    this.seq = 1;
    this.cp = 0;
    this.hs = "boot";
    this.pin = null;
    this.pinAttemptSent = false;
    this.reassembler = new NotifyReassembler();
    this.config = null;
    this._keepaliveTimer = null;
    this._pollTimer = null;
    this._tickBusy = false;
  }

  setPin(pin) {
    this.pin = pin;
    this.pinAttemptSent = false;
  }

  nextSeq() {
    const s = this.seq;
    this.seq = (this.seq + 1) & 0xffff;
    return s;
  }

  async sendPlain(tag) {
    const frame = await buildFrame(tag, buildBootstrapRequest(), { mode: "plain", seq: this.nextSeq() });
    await this.write(frame);
  }

  async sendGcm(tag, payload) {
    if (!this.encRand) throw new Error("sendGcm: encRand noch nicht bekannt (Bootstrap ausstehend)");
    const frame = await buildFrame(tag, payload, { mode: "gcm", encRand: this.encRand, seq: this.nextSeq() });
    await this.write(frame);
  }

  /** Start the keepalive/handshake tick and (once paired) the RealData poll. Idempotent. */
  start() {
    if (this._keepaliveTimer) return;
    this._keepaliveTimer = setInterval(() => this._tick().catch((e) => this._reportError("tick", e)), KEEPALIVE_MS);
    this._pollTimer = setInterval(() => this._pollRealData().catch((e) => this._reportError("realdata-poll", e)), REALDATA_POLL_MS);
    this._tick().catch((e) => this._reportError("tick", e)); // fire immediately, don't wait 5s
  }

  stop() {
    if (this._keepaliveTimer) clearInterval(this._keepaliveTimer);
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._keepaliveTimer = null;
    this._pollTimer = null;
  }

  async _tick() {
    if (this._tickBusy) return;
    this._tickBusy = true;
    try {
      await this.sendPlain(TAG.BOOTSTRAP_REQ); // a301: keeps link warm + (re)delivers encRand
      if (!this.encRand) return;
      if (this.hs === "boot") this.hs = "commcmd";
      if (this.hs === "commcmd") {
        await this.sendGcm(TAG.COMMCMD_Y_REQ, buildCommCmdStatusQueryY());
        await this.sendGcm(TAG.COMMCMD_H_REQ, buildCommCmdStatusQueryH());
      } else if (this.hs === "pin_needed" && this.pin && !this.pinAttemptSent) {
        this.pinAttemptSent = true;
        this.onEvent({ type: "log", level: "info", msg: "Sende PIN (einmalig) …" });
        await this.sendGcm(TAG.COMMCMD_Y_REQ, buildCommCmdPinVerify(this.pin));
        await this.sendGcm(TAG.COMMCMD_H_REQ, buildCommCmdStatusQueryH());
        this.hs = "pin_wait";
      } else if (this.hs === "pin_wait") {
        await this.sendGcm(TAG.COMMCMD_H_REQ, buildCommCmdStatusQueryH());
      }
    } finally {
      this._tickBusy = false;
    }
  }

  async _pollRealData() {
    if (this.hs !== "paired") return;
    await this.sendGcm(TAG.REALDATA_REQ, buildRealDataRequest(this.cp++));
  }

  /** Explicitly request the device configuration (GetConfig). Requires the session to be paired. */
  async requestConfig() {
    if (this.hs !== "paired") throw new Error("requestConfig: erst nach erfolgreichem Pairing möglich");
    await this.sendGcm(TAG.GETCONFIG_REQ, buildGetConfigRequest());
  }

  /**
   * Write a new server host/port via SetConfig, copying every other field unchanged from the last
   * GetConfig response. Throws if no config has been fetched yet.
   */
  async saveServerConfig(host, port) {
    if (!this.config) throw new Error("saveServerConfig: bitte zuerst die Geräte-Konfiguration laden");
    if (this.hs !== "paired") throw new Error("saveServerConfig: erst nach erfolgreichem Pairing möglich");
    const payload = buildSetConfigRequest(this.config, { serverDomainName: host, serverport: port });
    await this.sendGcm(TAG.SETCONFIG_REQ, payload);
  }

  _reportError(where, err) {
    this.onEvent({ type: "log", level: "error", msg: `${where}: ${err.message || err}` });
  }

  /** Feed one raw BLE notify chunk (Uint8Array) in. Reassembles + decrypts + dispatches frames. */
  async onNotifyChunk(chunk) {
    for (const rawFrame of this.reassembler.push(chunk)) {
      await this._handleFrame(rawFrame);
    }
  }

  async _handleFrame(rawFrame) {
    const parsed = parseFrame(rawFrame);
    if (!parsed) return;
    this.onEvent({ type: "frame-in", tag: parsed.tag, seq: parsed.seq, len: parsed.rawLen, hex: hexEncode(rawFrame) });

    let plaintext = null;
    // Deterministic by tag, not a blind "try both": only the bootstrap reply (0xA201) uses SN-CBC
    // (per BLE_HANDSHAKE_APP.md / LIBHMF_CRYPTO.md — it's the one exchange that predates encRand
    // existing at all); every other authenticated frame is encRand-GCM. This avoids the rare false
    // positive of an SN-CBC decrypt on a block-aligned GCM frame silently "succeeding" with garbage
    // (server.mjs tries both unconditionally because it's a passive sniffer with no session state to
    // decide from — we do have that state here).
    try {
      if (parsed.tag === TAG.BOOTSTRAP_RES) {
        plaintext = await snDecrypt(this.sn, parsed.tag, parsed.seq, parsed.payload);
      } else if (this.encRand) {
        plaintext = await bleDecrypt(this.encRand, parsed.tag, parsed.seq, parsed.payload);
      }
    } catch (e) {
      this._reportError(`decrypt tag 0x${parsed.tag.toString(16)}`, e);
      return;
    }
    if (!plaintext) return;

    if (parsed.tag === TAG.BOOTSTRAP_RES) {
      const info = parseBootstrapReply(plaintext);
      if (info.encRand && info.encRand.length >= 16) {
        const isFirst = !this.encRand;
        this.encRand = info.encRand.subarray(0, 16);
        if (isFirst) this.onEvent({ type: "bootstrap", dtuSerial: info.dtuSerial, deviceInfo: info.deviceInfo, encRand: hexEncode(this.encRand) });
      }
    } else if (parsed.tag === TAG.COMMCMD_STATUS_RES) {
      const { sts } = parseCommCmdStatus(plaintext);
      this._handleStatus(sts);
    } else if (parsed.tag === TAG.REALDATA_RES) {
      const data = parseRealData(plaintext);
      this.onEvent({ type: "realdata", data });
    } else if (parsed.tag === TAG.GETCONFIG_RES) {
      this.config = decodeConfig(plaintext);
      this.onEvent({ type: "config", config: this.config });
    } else if (parsed.tag === TAG.SETCONFIG_RES) {
      const fields = parseMessage(plaintext);
      this.onEvent({ type: "config-saved", errorCode: getIntNumber(fields, 3) ?? 0 });
    }
  }

  _handleStatus(sts) {
    if (this.hs === "commcmd" && sts === 3) {
      this.hs = "pin_needed";
      this.onEvent({ type: "pin-required" });
    } else if (this.hs === "pin_wait") {
      if (sts === undefined || sts === 0) {
        this.hs = "paired";
        this.onEvent({ type: "paired" });
      } else if (sts === 1) {
        this.hs = "pin_failed";
        this.onEvent({ type: "pin-rejected" });
      }
      // sts===0-in-progress-without-pin-attempt (e.g. device already knows this central) also lands here as "paired".
    } else if (this.hs === "commcmd" && (sts === undefined || sts === 0)) {
      // Some devices skip the PIN gate entirely for an already-trusted central.
      this.hs = "paired";
      this.onEvent({ type: "paired" });
    }
  }
}
