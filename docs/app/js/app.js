// app.js — UI/state glue. Wires ble.js (radio) + protocol.js (session state machine) +
// serverlist.js (regions + per-device default cookie) into the page defined by index.html.

import { BleTransport, isBluetoothAvailable, isIos } from "./ble.js";
import { HoymilesSession } from "./protocol.js";
import { REGIONAL_SERVERS, DEFAULT_PORT, isHoymilesHost, findRegionalServerByHost, getDefaultServerForSn, hasDefaultServerForSn, setDefaultServerForSn } from "./serverlist.js";
import { serialFromDeviceName } from "./util.js";

const $ = (id) => document.getElementById(id);

// ---------- theme ----------
const THEME_KEY = "hoymiles-ble.theme";
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
(function initTheme() {
  try {
    applyTheme(localStorage.getItem(THEME_KEY));
  } catch {
    /* ignore */
  }
})();
$("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
});

// ---------- log console ----------
const logConsole = $("logConsole");
let logLineCount = 0;
function log(level, msg) {
  const line = document.createElement("div");
  line.className = "log-line log-" + level;
  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = new Date().toLocaleTimeString("de-DE");
  line.appendChild(time);
  line.appendChild(document.createTextNode(msg));
  logConsole.appendChild(line);
  logLineCount++;
  if (logLineCount > 400) {
    logConsole.removeChild(logConsole.firstChild);
    logLineCount--;
  }
  logConsole.scrollTop = logConsole.scrollHeight;
}
$("clearLogBtn").addEventListener("click", () => {
  logConsole.innerHTML = "";
  logLineCount = 0;
});

// ---------- diagnostics banner ----------
function showBanner(msg, level = "danger") {
  const el = $("diagBanner");
  el.textContent = msg;
  el.className = "banner show" + (level === "warn" ? " warn" : "");
}
function hideBanner() {
  $("diagBanner").className = "banner";
}
(function checkAvailability() {
  if (!isBluetoothAvailable()) {
    showBanner(
      isIos()
        ? "Web Bluetooth wird auf iOS/iPadOS von keinem Browser unterstützt — das ist eine Plattform-Einschränkung von Apple, kein Fehler dieser Seite. Bitte auf einem Android-Gerät oder Desktop-Rechner mit Chrome oder Edge öffnen."
        : "Web Bluetooth ist in diesem Browser nicht verfügbar. Bitte Chrome oder Edge verwenden (Desktop oder Android).",
    );
  } else if (!window.isSecureContext) {
    showBanner("Diese Seite läuft nicht in einem sicheren Kontext (HTTPS). Web Bluetooth funktioniert nur über HTTPS oder localhost.");
  }
})();

// ---------- LED / status helpers ----------
const bleLed = $("bleLed");
const pairLed = $("pairLed");
const topSub = $("topSub");
const connStatusLine = $("connStatusLine");

function setLed(state) {
  bleLed.dataset.state = state;
  pairLed.dataset.state = state;
}

// ---------- server region select ----------
const regionSelect = $("serverRegionSelect");
for (const s of REGIONAL_SERVERS) {
  const opt = document.createElement("option");
  opt.value = s.host;
  opt.textContent = `${s.label} — ${s.host}`;
  regionSelect.appendChild(opt);
}
const CUSTOM_VALUE = "__custom__";
const customOpt = document.createElement("option");
customOpt.value = CUSTOM_VALUE;
customOpt.textContent = "Eigene Adresse …";
regionSelect.appendChild(customOpt);

const customFields = $("customServerFields");
regionSelect.addEventListener("change", () => {
  customFields.classList.toggle("hidden", regionSelect.value !== CUSTOM_VALUE);
});

// ---------- app state ----------
/** @type {BleTransport|null} */
let transport = null;
/** @type {HoymilesSession|null} */
let session = null;
let deviceSn = null;
let wakeLock = null;

function resetLiveReadouts() {
  $("acPower").textContent = "—";
  $("acVoltage").textContent = "—";
  $("acFrequency").textContent = "—";
  $("acTemp").textContent = "—";
  $("liveNote").textContent = "Noch keine Messwerte — verbinde dich mit dem Wechselrichter.";
  $("pvGrid").innerHTML = '<p class="pv-empty">Noch keine Daten empfangen.</p>';
}

function setConnectedUi(connecting) {
  $("connectBtn").disabled = connecting;
  $("disconnectBtn").disabled = !connecting;
  $("showAllDevices").disabled = connecting;
}

async function keepAwake() {
  try {
    if (!("wakeLock" in navigator)) return;
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    /* best-effort only */
  }
}
function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && session && !wakeLock) keepAwake();
});

// ---------- connect / disconnect ----------
$("connectBtn").addEventListener("click", async () => {
  hideBanner();
  setConnectedUi(true);
  setLed("connecting");
  topSub.textContent = "Verbinde …";
  connStatusLine.textContent = "Bluetooth-Geräteauswahl geöffnet — bitte den Wechselrichter auswählen.";
  try {
    transport = new BleTransport({
      onNotify: (chunk) => session?.onNotifyChunk(chunk).catch((e) => log("err", "Notify-Verarbeitung fehlgeschlagen: " + e.message)),
      onDisconnected: handleFinalDisconnect,
      onReconnected: () => {
        log("ok", "BLE automatisch wiederhergestellt.");
        setLed(session ? sessionLedState() : "off");
      },
      onLog: (msg) => log("sys", msg),
    });
    const { name } = await transport.connect({ showAll: $("showAllDevices").checked });
    log("ok", `Verbunden mit „${name || "(ohne Namen)"}“.`);
    deviceSn = serialFromDeviceName(name);
    if (!deviceSn) {
      throw new Error("Konnte keine Seriennummer aus dem Gerätenamen ermitteln (Name zu kurz/ungewöhnlich). Bitte Gerätenamen prüfen.");
    }
    log("sys", `Seriennummer aus Gerätename: ${deviceSn}`);
    renderDefaultBadge(); // show a previously-recorded factory default (if any) right away, pre-GetConfig

    session = new HoymilesSession({
      write: (bytes) => transport.write(bytes),
      onEvent: handleSessionEvent,
      sn: deviceSn,
    });
    setLed("handshake");
    topSub.textContent = "Authentisiere …";
    connStatusLine.textContent = "Verbunden — Bootstrap läuft (Schlüsselaustausch, kein PIN nötig für diesen Schritt).";
    session.start();
    keepAwake();
  } catch (e) {
    log("err", "Verbindung fehlgeschlagen: " + e.message);
    connStatusLine.textContent = friendlyConnectError(e);
    setLed("error");
    setConnectedUi(false);
    transport = null;
  }
});

function friendlyConnectError(e) {
  const msg = String(e.message || e);
  if (/user gesture|cancelled|User cancelled/i.test(msg)) return "Geräteauswahl abgebrochen.";
  if (/not supported|not available/i.test(msg)) return "Web Bluetooth ist auf diesem Gerät/Browser nicht verfügbar.";
  return "Verbindung fehlgeschlagen: " + msg;
}

$("disconnectBtn").addEventListener("click", () => {
  transport?.disconnect();
});

function handleFinalDisconnect() {
  session?.stop();
  session = null;
  transport = null;
  deviceSn = null;
  setLed("off");
  topSub.textContent = "Nicht verbunden";
  connStatusLine.textContent = "Getrennt. Klicke „Verbinden“, um erneut eine Verbindung aufzubauen.";
  setConnectedUi(false);
  $("pinPanel").classList.add("hidden");
  $("saveServerBtn").disabled = true;
  $("reloadConfigBtn").disabled = true;
  resetLiveReadouts();
  renderDefaultBadge();
  releaseWakeLock();
  log("sys", "Getrennt.");
}

function sessionLedState() {
  if (!session) return "off";
  if (session.hs === "paired") return "paired";
  if (session.hs === "pin_failed") return "error";
  return "handshake";
}

// ---------- session events ----------
function handleSessionEvent(ev) {
  switch (ev.type) {
    case "log":
      log(ev.level === "error" ? "err" : "sys", ev.msg);
      break;
    case "frame-in":
      if ($("verboseLog").checked) {
        log("in", `◀ Tag 0x${ev.tag.toString(16).padStart(4, "0")} seq ${ev.seq} (${ev.len}B)`);
      }
      break;
    case "bootstrap": {
      const info = ev.deviceInfo;
      log("ok", `Bootstrap ok — DTU-SN ${ev.dtuSerial || "?"}${info?.dtuSwVersion ? `, SW ${info.dtuSwVersion}` : ""}${info?.signalStrength !== undefined ? `, Signal ${info.signalStrength}` : ""}.`);
      connStatusLine.textContent = "Schlüsselaustausch ok — prüfe Authentifizierungs-Status …";
      break;
    }
    case "pin-required":
      $("pinPanel").classList.remove("hidden");
      $("pinStatus").textContent = "";
      connStatusLine.textContent = "PIN erforderlich, um fortzufahren.";
      log("sys", "Gerät verlangt PIN-Bestätigung (sts=3).");
      break;
    case "paired":
      $("pinPanel").classList.add("hidden");
      setLed("paired");
      topSub.textContent = "Verbunden & authentifiziert";
      connStatusLine.textContent = "Gepaart — Live-Daten werden abgerufen.";
      log("ok", "Authentifizierung erfolgreich (sts=0). Live-Polling aktiv.");
      session.requestConfig().catch((e) => log("err", "GetConfig fehlgeschlagen: " + e.message));
      $("reloadConfigBtn").disabled = false;
      break;
    case "pin-rejected":
      setLed("error");
      $("pinStatus").textContent = "PIN wurde abgelehnt. Aus Geräteschutz-Gründen wird kein weiterer Versuch automatisch gesendet — bitte trennen und mit dem korrekten PIN erneut verbinden.";
      log("err", "PIN abgelehnt (sts=1). Kein weiterer automatischer Versuch (Geräteschutz).");
      break;
    case "realdata":
      renderLiveData(ev.data);
      break;
    case "config":
      renderServerConfig(ev.config);
      break;
    case "config-saved":
      renderSaveResult(ev.errorCode);
      break;
  }
}

// ---------- rendering ----------
function fmt(v, digits, suffix = "") {
  return v === undefined || v === null || Number.isNaN(v) ? "—" : v.toFixed(digits) + suffix;
}

function renderLiveData(data) {
  const ac = data.ac;
  $("acPower").textContent = ac ? fmt(ac.activePower, 0) : "—";
  $("acVoltage").textContent = ac ? fmt(ac.voltage, 1, " V") : "—";
  $("acFrequency").textContent = ac ? fmt(ac.frequency, 2, " Hz") : "—";
  $("acTemp").textContent = ac ? fmt(ac.temperature, 1, " °C") : "—";
  $("liveNote").textContent = ac
    ? `Aktualisiert ${new Date().toLocaleTimeString("de-DE")}${ac.powerLimit !== undefined ? ` · Limit ${ac.powerLimit}%` : ""}`
    : "Warte auf AC-Messwerte …";

  const grid = $("pvGrid");
  if (!data.pv || data.pv.length === 0) {
    grid.innerHTML = '<p class="pv-empty">Noch keine PV-Strang-Daten empfangen.</p>';
    return;
  }
  grid.innerHTML = "";
  data.pv.forEach((pv, i) => {
    grid.appendChild(buildPvCard(pv, i));
  });
}

// Builds a PV-string card via safe DOM methods (no innerHTML) — all values ultimately originate
// from the BLE device's protobuf reply, so they're treated as untrusted text, not markup.
function buildPvCard(pv, i) {
  const card = document.createElement("div");
  card.className = "pv-card";

  const terminals = document.createElement("div");
  terminals.className = "pv-card-terminals";
  for (let t = 0; t < 3; t++) terminals.appendChild(document.createElement("span"));
  card.appendChild(terminals);

  const body = document.createElement("div");
  body.className = "pv-card-body";

  const label = document.createElement("div");
  label.className = "pv-card-label";
  label.textContent = `PV${pv.portNumber ?? i + 1}`;
  body.appendChild(label);

  body.appendChild(pvRow("Spannung", fmt(pv.voltage, 1, " V")));
  body.appendChild(pvRow("Strom", fmt(pv.current, 2, " A")));
  body.appendChild(pvRow("Leistung", fmt(pv.power, 0, " W")));

  const daily = document.createElement("div");
  daily.className = "pv-card-daily";
  const dK = document.createElement("span");
  dK.className = "k";
  dK.textContent = "Tagesertrag";
  const dV = document.createElement("span");
  dV.textContent = `${pv.energyDaily ?? "—"} Wh`;
  daily.append(dK, dV);
  body.appendChild(daily);

  card.appendChild(body);
  return card;
}

function pvRow(label, value) {
  const row = document.createElement("div");
  row.className = "pv-card-row";
  const k = document.createElement("span");
  k.className = "k";
  k.textContent = label;
  const v = document.createElement("span");
  v.textContent = value;
  row.append(k, v);
  return row;
}

function renderServerConfig(config) {
  $("currentServerText").textContent = `Aktueller Server: ${config.serverDomainName || "?"}:${config.serverport ?? "?"}`;
  $("saveServerBtn").disabled = false;

  // pre-select the matching region (or fall back to "custom" with the fields filled in)
  const match = findRegionalServerByHost(config.serverDomainName);
  if (match) {
    regionSelect.value = match.host;
    customFields.classList.add("hidden");
  } else {
    regionSelect.value = CUSTOM_VALUE;
    customFields.classList.remove("hidden");
    $("customHost").value = config.serverDomainName || "";
    $("customPort").value = config.serverport || DEFAULT_PORT;
  }

  // one-time "factory default" cookie: only written the first time we see a Hoymiles-owned server
  // for this SN, so a later relay redirect never overwrites the recorded factory default.
  if (deviceSn && isHoymilesHost(config.serverDomainName) && !hasDefaultServerForSn(deviceSn)) {
    setDefaultServerForSn(deviceSn, config.serverDomainName, config.serverport || DEFAULT_PORT);
    log("sys", `Werksserver dieses Geräts gemerkt: ${config.serverDomainName}:${config.serverport}.`);
  }
  renderDefaultBadge();
}

function renderDefaultBadge() {
  const wrap = $("defaultServerBadgeWrap");
  const resetBtn = $("resetDefaultBtn");
  if (!deviceSn) {
    wrap.innerHTML = "";
    resetBtn.classList.add("hidden");
    return;
  }
  const def = getDefaultServerForSn(deviceSn);
  if (!def) {
    wrap.innerHTML = "";
    resetBtn.classList.add("hidden");
    return;
  }
  wrap.innerHTML = "";
  const p = document.createElement("p");
  p.style.margin = "0 0 12px";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = `Standard dieses Geräts: ${def.host}:${def.port}`;
  p.appendChild(badge);
  wrap.appendChild(p);
  resetBtn.classList.remove("hidden");
}

function renderSaveResult(errorCode) {
  const el = $("serverSaveStatus");
  $("saveServerBtn").disabled = false;
  if (!errorCode) {
    el.textContent = "Gespeichert. Der Wechselrichter verbindet sich beim nächsten Zyklus mit dem neuen Server.";
    el.className = "save-status ok";
    log("ok", "SetConfig bestätigt (error_code=0).");
  } else {
    el.textContent = `Gerät meldet Fehlercode ${errorCode} beim Speichern.`;
    el.className = "save-status err";
    log("err", `SetConfig-Antwort mit error_code=${errorCode}.`);
  }
}

// ---------- server panel actions ----------
$("pinSubmit").addEventListener("click", () => {
  const pin = $("pinInput").value.trim();
  if (!pin) {
    $("pinStatus").textContent = "Bitte einen PIN eingeben.";
    return;
  }
  if (!session) {
    $("pinStatus").textContent = "Keine aktive Sitzung.";
    return;
  }
  session.setPin(pin);
  $("pinStatus").textContent = "PIN wird beim nächsten Zyklus gesendet …";
  log("sys", "PIN gesetzt, wird automatisch gesendet.");
});

$("saveServerBtn").addEventListener("click", async () => {
  if (!session) return;
  let host, port;
  if (regionSelect.value === CUSTOM_VALUE) {
    host = $("customHost").value.trim();
    port = Number($("customPort").value);
    if (!host) {
      $("serverSaveStatus").textContent = "Bitte eine Zieladresse eingeben.";
      $("serverSaveStatus").className = "save-status err";
      return;
    }
  } else {
    host = regionSelect.value;
    port = DEFAULT_PORT;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    $("serverSaveStatus").textContent = "Ungültiger Port (1–65535).";
    $("serverSaveStatus").className = "save-status err";
    return;
  }
  $("saveServerBtn").disabled = true;
  $("serverSaveStatus").textContent = "Speichere …";
  $("serverSaveStatus").className = "save-status";
  try {
    await session.saveServerConfig(host, port);
    log("out", `SetConfig gesendet: ${host}:${port}`);
  } catch (e) {
    $("serverSaveStatus").textContent = "Fehler: " + e.message;
    $("serverSaveStatus").className = "save-status err";
    $("saveServerBtn").disabled = false;
  }
});

$("resetDefaultBtn").addEventListener("click", () => {
  if (!deviceSn) return;
  const def = getDefaultServerForSn(deviceSn);
  if (!def) return;
  const match = findRegionalServerByHost(def.host);
  if (match) {
    regionSelect.value = match.host;
    customFields.classList.add("hidden");
  } else {
    regionSelect.value = CUSTOM_VALUE;
    customFields.classList.remove("hidden");
    $("customHost").value = def.host;
    $("customPort").value = def.port;
  }
  $("serverSaveStatus").textContent = 'Standardwerte übernommen — zum Anwenden auf „Speichern“ klicken.';
  $("serverSaveStatus").className = "save-status";
});

$("reloadConfigBtn").addEventListener("click", () => {
  if (!session) return;
  session.requestConfig().catch((e) => log("err", "GetConfig fehlgeschlagen: " + e.message));
});

log("sys", "Bereit. Verbinde dich mit deinem Wechselrichter, um zu starten.");
