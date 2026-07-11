// ble.js — Web Bluetooth GATT transport. Pure radio plumbing: scan/connect/notify/write and
// reconnect retries. No protocol knowledge lives here — see protocol.js for that.
// Ported from _fwanalysis/hms800-2wb/ble/index.html (device filters, GATT-retry loop, MTU/notify).

const SERVICE = "0000e0ff-3c17-d293-8e48-14fe2e4da212";
const CH_WRITE = "0000ffe1-0000-1000-8000-00805f9b34fb";
const CH_NOTIFY = "0000ffe2-0000-1000-8000-00805f9b34fb";

// Device name prefixes the S-Miles app itself scans for (BleSupportUtil.i()/k()/h()): balcony/
// micro/2WB segment (AUS-/MSA-/MSH-/MI-/RMI-), its meters (RMet-/Met-), and the standard-app /
// DTU segment (HMS-/HMT-/HMI-/DTUP-). The HMS-800-2WB itself advertises as "RMI-<serial>".
const NAME_PREFIXES = ["RMI-", "MI-", "RMSA-", "MSA-", "MSH-", "AUS-", "RMet-", "Met-", "HMS-", "HMT-", "HMI-", "DTUP-"];

const GATT_CONNECT_ATTEMPTS = 6;
const GATT_RETRY_DELAY_MS = 800;
const AUTO_RECONNECT_ATTEMPTS = 5;
const AUTO_RECONNECT_DELAY_MS = 1500;

/** True if the environment has a usable Web Bluetooth implementation. */
export function isBluetoothAvailable() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

/** Best-effort iOS detection, purely to show a more specific error message (Web Bluetooth is unsupported there). */
export function isIos() {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/i.test(navigator.userAgent) && !window.MSStream;
}

/**
 * Thin GATT transport for the HMS-800-2WB. Emits events through the callbacks passed to the
 * constructor; keeps no protocol state of its own.
 */
export class BleTransport {
  /**
   * @param {object} opts
   * @param {(chunk: Uint8Array) => void} opts.onNotify
   * @param {() => void} opts.onDisconnected final loss of connection (auto-reconnect exhausted, or intentional)
   * @param {() => void} [opts.onReconnected] fired after an unexpected drop self-heals
   * @param {(msg: string) => void} opts.onLog
   */
  constructor({ onNotify, onDisconnected, onReconnected, onLog }) {
    this.onNotify = onNotify || (() => {});
    this.onDisconnected = onDisconnected || (() => {});
    this.onReconnected = onReconnected || (() => {});
    this.onLog = onLog || (() => {});
    this.device = null;
    this.gatt = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.deviceName = null;
    this._intentionalDisconnect = false;
    this._reconnecting = false;
  }

  get connected() {
    return !!(this.gatt && this.gatt.connected);
  }

  /**
   * Open the device picker and connect. `showAll` bypasses the name-prefix filter (useful when a
   * device advertises without a recognizable name in a weak-signal situation).
   */
  async connect({ showAll = false } = {}) {
    if (!isBluetoothAvailable()) {
      throw new Error(
        isIos()
          ? "Web Bluetooth wird auf iOS/iPadOS von keinem Browser unterstützt (Apple-Plattform-Einschränkung). Bitte einen Android-Rechner/Handy mit Chrome oder Edge verwenden."
          : "Web Bluetooth ist in diesem Browser nicht verfügbar. Bitte Chrome oder Edge verwenden (Desktop oder Android), über HTTPS oder localhost.",
      );
    }
    const options = showAll
      ? { acceptAllDevices: true, optionalServices: [SERVICE] }
      : { filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), optionalServices: [SERVICE] };

    this.device = await navigator.bluetooth.requestDevice(options);
    this.deviceName = this.device.name || null;
    this._intentionalDisconnect = false;
    this.device.addEventListener("gattserverdisconnected", () => this._handleGattDrop());

    this.gatt = await this._connectWithRetry();
    await this._bindService();
    return { name: this.deviceName, id: this.device.id };
  }

  async _bindService() {
    const service = await this.gatt.getPrimaryService(SERVICE);
    this.writeChar = await service.getCharacteristic(CH_WRITE);
    this.notifyChar = await service.getCharacteristic(CH_NOTIFY);
    await this.notifyChar.startNotifications();
    this.notifyChar.addEventListener("characteristicvaluechanged", (ev) => {
      this.onNotify(new Uint8Array(ev.target.value.buffer));
    });
  }

  async _connectWithRetry() {
    let lastErr;
    for (let attempt = 1; attempt <= GATT_CONNECT_ATTEMPTS; attempt++) {
      try {
        return await this.device.gatt.connect();
      } catch (e) {
        lastErr = e;
        this.onLog(`GATT-Verbindungsversuch ${attempt}/${GATT_CONNECT_ATTEMPTS} fehlgeschlagen: ${e.message}`);
        if (attempt < GATT_CONNECT_ATTEMPTS) await new Promise((r) => setTimeout(r, GATT_RETRY_DELAY_MS));
      }
    }
    throw lastErr;
  }

  /**
   * The device (weak signal, sleep, out-of-range) can drop the GATT link at any time during a
   * session, independent of the initial connect. Try to self-heal a few times before giving up
   * and telling the UI the session is really over — an intentional disconnect() skips straight to
   * that without retrying.
   */
  async _handleGattDrop() {
    this.gatt = null;
    this.writeChar = null;
    this.notifyChar = null;
    if (this._intentionalDisconnect || this._reconnecting) {
      this.onDisconnected();
      return;
    }
    this._reconnecting = true;
    this.onLog("BLE-Verbindung verloren — versuche automatisch neu zu verbinden …");
    try {
      for (let attempt = 1; attempt <= AUTO_RECONNECT_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, AUTO_RECONNECT_DELAY_MS));
        try {
          this.gatt = await this.device.gatt.connect();
          await this._bindService();
          this.onLog("Automatisch neu verbunden.");
          this.onReconnected();
          return;
        } catch (e) {
          this.onLog(`Automatischer Reconnect-Versuch ${attempt}/${AUTO_RECONNECT_ATTEMPTS} fehlgeschlagen: ${e.message}`);
        }
      }
      this.onLog("Automatischer Reconnect aufgegeben — bitte manuell erneut verbinden.");
      this.onDisconnected();
    } finally {
      this._reconnecting = false;
    }
  }

  async write(bytes) {
    if (!this.writeChar) throw new Error("BLE: nicht verbunden (kein Write-Kanal)");
    if (this.writeChar.properties.writeWithoutResponse) await this.writeChar.writeValueWithoutResponse(bytes);
    else await this.writeChar.writeValueWithResponse(bytes);
  }

  disconnect() {
    this._intentionalDisconnect = true;
    if (this.gatt && this.gatt.connected) this.gatt.disconnect();
    else this.onDisconnected();
  }
}
