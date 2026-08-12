// Timeouts
export const INFO_FALLBACK_TIMEOUT_MS = 10000;
export const TOKEN_MAX_AGE_MS = 3600000; // 1h
export const CLOUD_RETRY_INITIAL_MS = 60000; // 1min
export const CLOUD_RETRY_MAX_MS = 600000; // 10min
export const HTTP_REQUEST_TIMEOUT_MS = 15000;
export const HTTP_AGENT_TIMEOUT_MS = 30000;
export const RELAY_POLL_DELAY_MS = 30000;

// Polling
export const DEFAULT_POLL_MS = 300000; // 5min
export const MIN_POLL_MS = 60000; // 1min
/** A cloud station counts as offline/stale when its last upload (`data_time`) is older than this. */
export const CLOUD_STATION_STALE_MS = 1200000; // 20min (DTU uploads ~every 5min; tolerate a few misses)

// Connection
export const DTU_PORT = 10081;
export const RECONNECT_MAX_MS = 300000; // 5min

// ESPHome Bluetooth-Proxy (Native API) — for BLE-only inverters (e.g. HMS-800-2WB)
export const ESPHOME_API_PORT = 6053;
/** GATT service/characteristic UUIDs of the Hoymiles BLE inverter (from BleServerConstant.java). */
export const BLE_SERVICE_UUID = "0000e0ff-3c17-d293-8e48-14fe2e4da212";
export const BLE_WRITE_CHAR_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";
export const BLE_NOTIFY_CHAR_UUID = "0000ffe2-0000-1000-8000-00805f9b34fb";
/** BLE advertisement scan duration when enumerating inverters behind a gateway. */
export const BLE_SCAN_TIMEOUT_MS = 8000;
/** Keepalive/handshake tick — mirrors the app cadence that keeps the BLE link warm. */
export const BLE_HANDSHAKE_TICK_MS = 1500;
/**
 * No frame received for this long → drop the BLE session and reconnect. Mirrors the TCP path's
 * `IDLE_TIMEOUT`. The proxy's device-disconnect notification is the primary signal; this is the
 * backstop for a link that goes silent without one (verified failure mode: the inverter powers
 * down for the night and the session stays "paired" until the adapter restarts).
 */
export const BLE_IDLE_TIMEOUT_MS = 300000; // 5 min

// Cloud relay timing (moved from cloudRelay.ts)
export const CLOUD_RECONNECT_DELAY_MIN_MS = 1000;
export const CLOUD_RECONNECT_DELAY_MAX_MS = 60000;
export const CLOUD_HEARTBEAT_INTERVAL_MS = 60000;
export const CLOUD_SOCKET_TIMEOUT_MS = 90000;
export const CLOUD_DEFAULT_REALDATA_INTERVAL_MS = 300000;
export const CLOUD_MIN_REALDATA_INTERVAL_MS = 60000;
export const ENSURE_TOKEN_TIMEOUT_MS = 30000;

// Realtime "burst" channel (fast live power for cloud-only DTUs).
// The server dictates the poll cadence via `dly`; we clamp it to these bounds.
export const BURST_MIN_INTERVAL_MS = 1500;
export const BURST_MAX_INTERVAL_MS = 10000;
// Proactively re-fetch the short-lived k-token URL well before it can expire.
export const BURST_URI_REFRESH_MS = 240000;
// After this many consecutive poll failures the burst releases its claim on the overlapping
// power states so the slow cloud poller resumes writing (and freshness-flagging) them.
export const BURST_MAX_FAILURES = 3;

// Protobuf protocol
export const DTU_TIME_OFFSET = 28800; // 8h in seconds
export const MIN_PROTOBUF_PAYLOAD_SIZE = 4;

// Scaling divisors (raw protobuf integer → real unit)
export const SCALE_VOLTAGE = 10;
export const SCALE_POWER = 10;
/**
 * `SGSMO.power_limit` is a percentage, not a power in tenths of a watt — and **the two device
 * families disagree on its scale**, so it cannot share a single constant.
 *
 * Both measured directly:
 * - **2WB (BLE):** 10000 while running unthrottled at 100 %, dropping to 8368 (= 83.68 %) under an
 *   active zero-export regulation ⇒ hundredths of a percent.
 * - **2T (TCP):** the field stays 0 until a limit is set at all; after setting 80 % it read 800
 *   ⇒ tenths of a percent.
 *
 * Guessing from the value is impossible: a 2T at 100 % and a 2WB at 10 % both send 1000.
 */
export const SCALE_POWER_LIMIT_TCP = 10;
/** See {@link SCALE_POWER_LIMIT_TCP} — the BLE family reports hundredths of a percent. */
export const SCALE_POWER_LIMIT_BLE = 100;
export const SCALE_TEMPERATURE = 10;
export const SCALE_CURRENT = 100;
export const SCALE_FREQUENCY = 100;
export const SCALE_ENERGY = 100;
export const SCALE_POWER_FACTOR = 1000;
export const SCALE_WH_TO_KWH = 1000;

// Protocol magic bytes ("HM")
export const HM_MAGIC_0 = 0x48;
export const HM_MAGIC_1 = 0x4d;

// Discovery
export const DISCOVERY_TIMEOUT_MS = 1500;
export const DISCOVERY_CONCURRENCY = 50;
export const PROBE_TIMEOUT_MS = 3000;

// Concurrency limits
export const CLOUD_POLL_CONCURRENCY = 3;
export const CLOUD_DISCOVER_CONCURRENCY = 5;

/**
 * Safety cap on the pages of the day curve. The device reports the count itself (`ap`, measured 5
 * on a 2T with 903 one-minute samples), but a corrupted response must not turn into an endless
 * request chain.
 */
export const HIST_MAX_PAGES = 16;

// Command validation bounds
export const POWER_LIMIT_MIN = 2;
export const POWER_LIMIT_MAX = 100;

/**
 * Flash protection for power-limit writes.
 *
 * Every accepted power-limit command makes the DTU rewrite its configuration, and that costs two
 * 4 KB flash sectors on both devices. On the HMS-800W-2T the success path of action 8 calls the
 * config serializer `0x4080d642`, which runs erase (`0x40817a92`) followed by write
 * (`0x40817bf6`) for region 3 and again for region 0xe; on the HMS-800-2WB `sys_cfg_write`
 * (`LA 0x407fc41e`) does the equivalent twice. A zero-export control loop writing every few
 * seconds would wear the flash out within months.
 *
 * Both defaults are deliberately mild and can be raised or switched off (0) in the settings —
 * someone who knowingly wants to regulate faster must be able to say so.
 */
export const POWER_LIMIT_DEADBAND_DEFAULT = 1;
export const POWER_LIMIT_MIN_INTERVAL_SEC_DEFAULT = 60;

// Cloud API hosts and auth paths
export const CLOUD_HOST_DEFAULT = "https://neapi.hoymiles.com";
export const CLOUD_HOST_EU = "https://euapi.hoymiles.com";
/**
 * Station-level data-center → host map. `select_by_page` returns a `dc` field per
 * station which decides where its real lat/lon/address (and a few other fields)
 * live — these are NOT automatically mirrored to the account host. Verified live:
 * an account with region_c.dc=0 owning a `dc=1` station gets `latitude="0.0"` from
 * neapi but the actual coordinates from euapi for the same /pvm/.../find call.
 * The Hoymiles app does the same DC routing via DCManager + per-station `dc`.
 */
export const CLOUD_DC_HOSTS: Record<number, string> = {
	0: CLOUD_HOST_DEFAULT,
	1: CLOUD_HOST_EU,
};
/** Home-account station info (incl. lat/lon/address) — not delivered by `find_c`. */
export const STATION_AK_FIND_PATH = "/pvm-ext/api/0/station-ak/find";

// Cloud device control channel (pvm-ctl). All operations are async: a "start" call fires the
// command and returns a task id, a "status" call polls it (code 2 = the DTU is still processing,
// 0 = done). Endpoints and action codes were taken from the S-Miles web portal's device code.
//
// setting/read: reads a device setting (e.g. the grid profile) — the only way to obtain the grid
// profile of a cloud-only device (no local TCP path, e.g. HMS-800-2WB).
export const PVM_CTL_SETTING_READ_PATH = "/pvm-ctl/api/0/dev/setting/read";
export const PVM_CTL_SETTING_STATUS_PATH = "/pvm-ctl/api/0/dev/setting/status";
/** action=41: read the device's grid-connection profile (verified live for HMS-800W-2T and 2WB). */
export const DEVICE_SETTING_ACTION_GRID_READ = 41;
// command/put: sends a control command (reboot / power on / power off). `put_status` polls it.
export const PVM_CTL_COMMAND_PUT_PATH = "/pvm-ctl/api/0/dev/command/put";
export const PVM_CTL_COMMAND_STATUS_PATH = "/pvm-ctl/api/0/dev/command/put_status";
// Device-type codes for command/put (`dev_type`; EDeviceType in the S-Miles app). The command
// action code is scoped to the device type — action 1 means "reboot the DTU" for a DTU, but a
// different command for a micro-inverter — so both must be sent together.
export const CLOUD_DEV_TYPE_DTU = 1;
export const CLOUD_DEV_TYPE_MICRO = 3;
/** Micro-inverter control command action codes (from the portal's device-maintenance dialog). */
export const DEVICE_COMMAND_REBOOT = 3;
export const DEVICE_COMMAND_POWER_ON = 6;
export const DEVICE_COMMAND_POWER_OFF = 7;
/** DTU control command action code (ECommandAction.DTU_REBOOT, sent with dev_type = DTU). */
export const DTU_COMMAND_REBOOT = 1;
/** Poll cadence and cap for a device-control/setting task (≈2 s × 15 ≈ 30 s ceiling). */
export const DEVICE_SETTING_POLL_INTERVAL_MS = 2000;
export const DEVICE_SETTING_POLL_MAX = 15;
// v3 auth — region_c first to get the regional host + dc, then pre-insp + login.
// pre-insp returns a nonce, optional salt (`a`), and `v`. Until 2026 we used `v` as
// the profile signal (v=3 ⇒ home, v=2 ⇒ installer), but Hoymiles since unified all
// accounts onto Argon2id (v=3 + salt), so `v` no longer maps to the data-API surface.
// The authoritative profile decision now happens AFTER login via a probe against
// PROFILE_PROBE_PATH; see CloudProfile in cloudConnection.ts. v0 fallback was dropped
// for the same reason — the server now uniformly rejects it with "app version is low".
export const IAM_REGION_PATH = "/iam/pub/0/c/region_c";
export const IAM_PRE_INSPECT_PATH = "/iam/pub/3/auth/pre-insp";
export const IAM_LOGIN_V3_PATH = "/iam/pub/3/auth/login";
// Profile probe — reuses the same /pvm/...select_by_page that the installer data
// surface would call. Installer/Cloud-Web accounts get status=0 with the station list;
// home accounts are rejected by the server ("can only be used for logging in to the
// S-Miles Home app" or similar). Cheapest endpoint that gives a definitive answer.
export const PROFILE_PROBE_PATH = "/pvm/api/0/station/select_by_page";

// User-Agent identifies the request as coming from the S-Miles Home Android app
// (com.hm.balcony). Format from HttpUtils.m() in the decompiled APK 2.9.0:
//   sma/ad/<appVersion>/<aboutUsTid>/<dc>
// where <aboutUsTid>=159 (HOYMILES_COM). v3 endpoints reject requests without a
// valid app-style UA; `_c` endpoints accept tokens from any account type.
export const APP_USER_AGENT_PREFIX = "sma/ad";
export const APP_VERSION = "2.9.0";
export const APP_TID = 159;
