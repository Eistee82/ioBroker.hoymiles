// Timeouts
export const UNLOAD_TIMEOUT_MS = 5000;
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

// Connection
export const DTU_PORT = 10081;
export const RECONNECT_MAX_MS = 300000; // 5min

// Cloud relay timing (moved from cloudRelay.ts)
export const CLOUD_RECONNECT_DELAY_MIN_MS = 1000;
export const CLOUD_RECONNECT_DELAY_MAX_MS = 60000;
export const CLOUD_HEARTBEAT_INTERVAL_MS = 60000;
export const CLOUD_SOCKET_TIMEOUT_MS = 90000;
export const CLOUD_DEFAULT_REALDATA_INTERVAL_MS = 300000;
export const CLOUD_MIN_REALDATA_INTERVAL_MS = 60000;
export const ENSURE_TOKEN_TIMEOUT_MS = 30000;

// Protobuf protocol
export const DTU_TIME_OFFSET = 28800; // 8h in seconds
export const MIN_PROTOBUF_PAYLOAD_SIZE = 4;

// Scaling divisors (raw protobuf integer → real unit)
export const SCALE_VOLTAGE = 10;
export const SCALE_POWER = 10;
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

// Command validation bounds
export const POWER_LIMIT_MIN = 2;
export const POWER_LIMIT_MAX = 100;

// Cloud API hosts and auth paths
export const CLOUD_HOST_DEFAULT = "https://neapi.hoymiles.com";
export const CLOUD_HOST_EU = "https://euapi.hoymiles.com";
// v3 auth — region_c first to get the regional host + dc, then pre-insp + login.
// pre-insp may return a salt (`a`) and `v`. v=3 + salt → Argon2id challenge
// (S-Miles Home / com.hm.balcony accounts); otherwise the legacy md5/sha challenge
// works (S-Miles Cloud Web / Installer accounts). v0 was tried as a fallback in
// older adapter versions — server now rejects it for Home accounts with "app version
// is low", and Web accounts succeed via v3 anyway, so v0 was removed.
export const IAM_REGION_PATH = "/iam/pub/0/c/region_c";
export const IAM_PRE_INSPECT_PATH = "/iam/pub/3/auth/pre-insp";
export const IAM_LOGIN_V3_PATH = "/iam/pub/3/auth/login";

// User-Agent identifies the request as coming from the S-Miles Home Android app
// (com.hm.balcony). Format from HttpUtils.m() in the decompiled APK 2.9.0:
//   sma/ad/<appVersion>/<aboutUsTid>/<dc>
// where <aboutUsTid>=159 (HOYMILES_COM). v3 endpoints reject requests without a
// valid app-style UA; `_c` endpoints accept tokens from any account type.
export const APP_USER_AGENT_PREFIX = "sma/ad";
export const APP_VERSION = "2.9.0";
export const APP_TID = 159;
