import { postJson, postBinary, HttpError } from "./httpClient.js";
import { parseChartResponse } from "./chartParser.js";
import {
	TOKEN_MAX_AGE_MS,
	ENSURE_TOKEN_TIMEOUT_MS,
	CLOUD_HOST_DEFAULT,
	CLOUD_HOST_EU,
	CLOUD_DC_HOSTS,
	IAM_PRE_INSPECT_PATH,
	IAM_LOGIN_V3_PATH,
	IAM_REGION_PATH,
	PROFILE_PROBE_PATH,
	STATION_AK_FIND_PATH,
	APP_USER_AGENT_PREFIX,
	APP_VERSION,
	APP_TID,
} from "./constants.js";
import { errorMessage, withTimeout, buildCredentialChallenges, buildArgon2Challenge } from "./utils.js";

/**
 * Cloud profile, determined by an authoritative probe against `/pvm/.../select_by_page`
 * AFTER a successful login. Pre-insp's `v` cannot be used as the profile signal — Hoymiles
 * unified all accounts onto Argon2id (`v=3`) in 2026, so the auth variant no longer maps
 * 1:1 to the data-API surface a given account is allowed on.
 *
 * - `"installer"`: probe returned `status=0`. The account works on `global.hoymiles.com`
 *   and reaches the full `/pvm/...` data API (latitude/longitude/address, FW version
 *   strings, weather, …). Includes the S-Miles Installer and Cloud-Web Enduser cohorts.
 * - `"home"`: probe was rejected (server response "can only be used for logging in to the
 *   S-Miles Home app"). These accounts are restricted by the server to `/pvmc/.../*_c`,
 *   which delivers a leaner record (no coordinates, no FW strings) but adds reflux /
 *   self-consumption / electricity-price fields.
 */
export type CloudProfile = "installer" | "home";

const EU_WEATHER_URL = `${CLOUD_HOST_EU}/tpa/api/0/weather/get`;

/**
 * Validate that API response data is a non-null object.
 *
 * @param data - Raw API response data
 * @param label - Context label for error messages
 */
function assertData<T>(data: unknown, label: string): T {
	if (data == null || typeof data !== "object") {
		throw new Error(`${label}: expected object, got ${typeof data}`);
	}
	return data as T;
}

/**
 * Map a Home-API tree node (`devices[]`, no soft_ver/hard_ver/model_no) onto the
 * web-style `CloudDeviceNode` shape (with `children[]`). Fields the Home API does not
 * deliver remain `undefined` — callers must already tolerate missing version strings.
 *
 * @param raw - Raw node object from a `/pvmc/.../select_device_c` response.
 */
function normalizeHomeTreeNode(raw: unknown): CloudDeviceNode {
	const n = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const children = Array.isArray(n.devices) ? (n.devices as unknown[]).map(normalizeHomeTreeNode) : [];
	return {
		sn: typeof n.sn === "string" ? n.sn : "",
		id: typeof n.id === "number" ? n.id : 0,
		dtu_sn: typeof n.dtu_sn === "string" ? n.dtu_sn : "",
		type: typeof n.type === "number" ? n.type : 0,
		// soft_ver/hard_ver/model_no are absent in _c responses; expose as empty strings so
		// `state.value = ""` consumers don't blow up — the on-demand state writer skips empty.
		model_no: "",
		soft_ver: "",
		hard_ver: "",
		warn_data: (n.warn_data as CloudDeviceNode["warn_data"]) ?? { connect: false, warn: false },
		children,
		...n,
	};
}

interface CloudApiResponse<T = Record<string, unknown>> {
	status: string;
	message?: string;
	data?: T;
}

interface PreInspectData {
	/** Server-generated nonce, echoed back in the login request. */
	n: string;
	/** Argon2id salt as hex string. Absent for legacy v=2 accounts (no Argon2 required). */
	a?: string;
	/** Auth protocol version. 3 = Argon2 mandatory (S-Miles Home accounts); 2 = legacy md5/sha (Web/Installer). */
	v?: number;
	/** Data-center marker echoed from region_c. */
	dc?: number;
	/** Account-state flag (0 = normal, 1 = password expired, 2 = email-add required). Adapter currently honors only 0. */
	f?: number;
	/** Site/tenant id (159 = HOYMILES). */
	t?: number;
}

interface RegionData {
	/** Regional API base URL the user's account lives on. Empty string when unknown. */
	login_url: string;
	/** Data-center marker. -1 = account not found, 0+ = a real region. */
	dc: number;
}

/**
 * Outcome of one login-diagnostic step — used by `loginDiagnostics()` to report
 * what each phase of the auth flow said, without leaking the token.
 */
export interface LoginAttemptResult {
	/** Which phase this attempt represents: region_c discovery, pre-inspect, login, or profile probe. */
	flow: "region" | "preInsp" | "login" | "probe";
	/** Base URL the attempt was made against. */
	host: string;
	/** True if the server accepted the request. */
	ok: boolean;
	/** Server-reported status code, if the request reached the server. */
	status?: string;
	/** Server-reported or transport error message, when not ok. */
	message?: string;
	/** Data-center marker from region_c response (region attempts only). */
	dc?: number;
	/** Auth protocol version reported by pre-insp (preInsp attempts only). */
	v?: number;
	/** Whether pre-insp returned a salt — i.e. an Argon2 challenge would be used. */
	saltPresent?: boolean;
	/** Cloud profile decided by the probe (probe attempts only). */
	profile?: CloudProfile;
	/** True if the login phase produced a session token. */
	hasToken?: boolean;
}

interface CloudStation {
	id: number;
	name: string;
	[key: string]: unknown;
}

interface CloudRealtimeData {
	today_eq: string;
	month_eq: string;
	year_eq: string;
	total_eq: string;
	real_power: string;
	co2_emission_reduction: string;
	plant_tree: string;
	data_time: string;
	last_data_time?: string;
	capacitor: string;
	clp: number;
	is_balance?: boolean;
	is_reflux?: boolean;
	[key: string]: unknown;
}

interface CloudStationDetails {
	name: string;
	capacitor: string;
	address: string;
	electricity_price: number;
	money_unit: string;
	latitude: string;
	longitude: string;
	status: number;
	config: {
		power_limit: string;
		module_max_power: number;
		[key: string]: unknown;
	};
	/** Station-level grid/meter warning flags. Absent on the home `find_c` record. */
	warn_data?: {
		s_uoff: boolean;
		s_ustable: boolean;
		s_uid: boolean;
		l3_warn: boolean;
		g_warn: boolean;
		me_warn: boolean;
		pw_off: boolean;
		[key: string]: unknown;
	};
	create_at: string;
	// `timezone` carries only a display name — the cloud exposes no machine-readable UTC
	// offset anywhere in its station/realtime responses (verified against the S-Miles app).
	timezone: { tz_name: string };
	/** Station wall-clock time ("YYYY-MM-DD HH:mm:ss"), station-local zone. */
	local_time?: string;
	[key: string]: unknown;
}

interface CloudDeviceNode {
	sn: string;
	id: number;
	dtu_sn: string;
	type: number;
	model_no: string;
	soft_ver: string;
	hard_ver: string;
	warn_data: { connect: boolean; warn: boolean; [key: string]: unknown };
	children: CloudDeviceNode[];
	[key: string]: unknown;
}

interface WeatherData {
	icon: string;
	temp: number;
	sunrise: number;
	sunset: number;
}

/**
 * Response shape of `/pvm-ext/api/0/station-ak/find` — the supplementary endpoint
 * the S-Miles Home app uses to fetch lat/lon/address for a station whose `find_c`
 * record does not carry these fields. Verified against the balcony APK's `WeatherHelper`.
 */
interface CloudStationExtInfo {
	id?: number;
	latitude?: string;
	longitude?: string;
	address?: string;
	[key: string]: unknown;
}

interface FirmwareStatus {
	upgrade: number;
	done: number;
	tid: string;
}

/**
 * Permanent authentication failure against the Hoymiles cloud.
 * Thrown when pre-inspect or login endpoints return a non-zero status the server
 * considers a client-side auth error (wrong credentials, account locked, user not found).
 * Distinct from network/5xx errors, which are transient and should be retried.
 */
export class CloudAuthError extends Error {
	public readonly code: string;

	/**
	 * @param message - Server-reported error message
	 * @param code - Server-reported status code (e.g. "1" for rejected)
	 */
	constructor(message: string, code = "") {
		super(message);
		this.name = "CloudAuthError";
		this.code = code;
	}
}

/** Hoymiles S-Miles Cloud API client for station data and device management. */
class CloudConnection {
	public token: string | null;

	private readonly user: string;
	/** Pre-computed credential challenges for password-only login (no salt). */
	private readonly credentials: string[];
	/** Raw credential input for Argon2 login (when server provides salt). */
	private readonly credentialInput: Buffer;
	private readonly log: (msg: string) => void;
	private tokenTime: number;
	private tokenRefreshPromise: Promise<void> | null;
	/**
	 * Active API base URL. Starts at CLOUD_HOST_DEFAULT and may be replaced
	 * once region_c maps the user's account to a different regional host.
	 */
	private baseUrl: string;
	/** Cloud profile decided by the post-login `/pvm/.../select_by_page` probe. null = not yet logged in. */
	private profile: CloudProfile | null;
	/** Last data-center returned by region_c (null = not yet queried, -1 = account unknown). */
	private lastDc: number | null;
	/**
	 * Per-station data-center, populated by `getStationList()` from the `dc` field
	 * each list entry carries. Drives `getStationHost()` so that station-scoped calls
	 * (`find`, `select_device_of_tree`, realtime, firmware) route to the station's home
	 * region — required because account-region replication is not guaranteed.
	 */
	private stationDcMap: Map<number, number>;
	/**
	 * Per-station access key from `select_by_page`. Required by the
	 * `pvm-ext/station-ak/find` endpoint (Home-profile lat/lon/address).
	 */
	private stationAkMap: Map<number, string>;

	private assertStationId(stationId: number): void {
		if (!stationId || stationId <= 0) {
			throw new Error("Invalid stationId");
		}
	}

	/**
	 * @param user - Hoymiles account email
	 * @param password - Hoymiles account password
	 * @param log - Debug log callback
	 */
	constructor(user: string, password: string, log?: (msg: string) => void) {
		this.user = user;
		const input = Buffer.from(password);
		this.credentials = buildCredentialChallenges(input);
		this.credentialInput = input;
		this.log = log || (() => {});
		this.token = null;
		this.tokenTime = 0;
		this.tokenRefreshPromise = null;
		this.baseUrl = CLOUD_HOST_DEFAULT;
		this.profile = null;
		this.lastDc = null;
		this.stationDcMap = new Map();
		this.stationAkMap = new Map();
	}

	/** Currently active API base URL (changes if region_c redirects to a regional host). */
	getBaseUrl(): string {
		return this.baseUrl;
	}

	/**
	 * Cloud profile produced by the most recent login, decided by a probe against
	 * `/pvm/.../select_by_page` AFTER the v3 login obtained a token.
	 *
	 * - `"installer"`: probe accepted → S-Miles Installer / Cloud-Web Enduser account. Data API is `/pvm/...`.
	 * - `"home"`:      probe rejected → S-Miles Home account. Data API is `/pvmc/.../_c`.
	 * - `null`:        not yet logged in (or login failed before the probe).
	 */
	getProfile(): CloudProfile | null {
		return this.profile;
	}

	/** Last data-center marker from region_c. -1 = account unknown to that region; null = region_c not yet called. */
	getLastDc(): number | null {
		return this.lastDc;
	}

	/** Build the S-Miles-Home-app-style User-Agent for the current data-center marker. */
	private getUserAgent(): string {
		const dc = this.lastDc ?? 0;
		return `${APP_USER_AGENT_PREFIX}/${APP_VERSION}/${APP_TID}/${dc}`;
	}

	/**
	 * The host data-API requests go to. For `home` profile, all `_c` endpoints live on the
	 * default host (`neapi.hoymiles.com`) regardless of which regional host region_c picked
	 * for the auth phase — verified live: euapi/pvmc/... returns 404, neapi/pvmc/... returns 200.
	 * `installer` profile (and the brief null window before the post-login profile probe)
	 * keeps using `baseUrl`, so /pvm/ web-API calls and the probe itself stay on the regional host.
	 */
	private getDataHost(): string {
		return this.profile === "home" ? CLOUD_HOST_DEFAULT : this.baseUrl;
	}

	/**
	 * Resolve the host for a station-scoped call. Falls back to the account-default
	 * host when the station's `dc` is unknown or unmapped — so legacy code paths that
	 * call station endpoints before `getStationList()` still work.
	 *
	 * @param stationId - Cloud station ID
	 */
	private getStationHost(stationId: number): string {
		const dc = this.stationDcMap.get(stationId);
		if (dc != null && CLOUD_DC_HOSTS[dc]) {
			return CLOUD_DC_HOSTS[dc];
		}
		return this.getDataHost();
	}

	/**
	 * Access key cached from the station listing; needed for `pvm-ext/station-ak/find`.
	 *
	 * @param stationId - Cloud station ID
	 */
	getStationAk(stationId: number): string | undefined {
		return this.stationAkMap.get(stationId);
	}

	// --- Auth ---

	/**
	 * Authenticate with the Hoymiles cloud and obtain a session token.
	 *
	 * Flow: region_c → pre-insp → login (v3) → profile probe.
	 *
	 * - region_c: returns the user's regional host AND the `dc` marker that goes into
	 *   the User-Agent. Non-fatal on failure — we fall back to the default host.
	 * - pre-insp + login (v3): Argon2id when the server returns a salt, legacy md5/sha
	 *   otherwise. Throws `CloudAuthError` on hard reject (wrong password, account locked).
	 * - profile probe: a single call to `/pvm/.../select_by_page` decides whether this
	 *   account is `installer` (probe accepted → full web API) or `home` (probe rejected
	 *   → `/pvmc/.../*_c` API only). Profile cannot be derived from `pre-insp.v` any
	 *   longer because Hoymiles migrated all accounts to Argon2id (v=3) in 2026.
	 *
	 * v0 fallback was removed in 2026 — server uniformly rejects it as "app version is low".
	 */
	async login(): Promise<string> {
		this.log(`Cloud login start (host=${this.baseUrl}, user=${this.user})`);

		// Phase 1: region_c — sets baseUrl + dc. Non-fatal on failure (we still try
		// v3 against the default host; dc=0 in the UA is a safe default).
		await this.discoverRegion();

		// Phase 2: v3 (pre-insp → login). Throws CloudAuthError on hard reject.
		const token = await this.tryLoginV3();
		if (!token) {
			throw new Error("Login failed: server accepted credentials but returned no token");
		}
		this.token = token;
		this.tokenTime = Date.now();

		// Phase 3: profile probe — needs a valid token. If it throws (network error) we
		// roll back the token assignment so callers see a consistent "not logged in"
		// state and cloudManager's retry loop can reschedule.
		try {
			this.profile = await this.probeDataProfile();
		} catch (err) {
			this.token = null;
			this.tokenTime = 0;
			throw err;
		}
		this.log(`Cloud login success: profile=${this.profile} dc=${this.lastDc ?? "n/a"} host=${this.baseUrl}`);
		return token;
	}

	/**
	 * v3 flow: pre-inspect to fetch nonce+salt+v, then login with the appropriate
	 * challenge. Profile is NOT set here — `probeDataProfile()` does that after we
	 * have a token, because pre-insp.v no longer maps 1:1 to the data-API surface.
	 *
	 * @returns Session token on success, or null if status=0 but data.token is empty
	 * @throws CloudAuthError on permanent server-side rejection (wrong password, account locked)
	 */
	private async tryLoginV3(): Promise<string | null> {
		// Auth endpoints stay on the regional login host (this.baseUrl), separate from the
		// data-API host which for home profile is forced to neapi.
		const preInsp = await this._post<PreInspectData>(IAM_PRE_INSPECT_PATH, { u: this.user }, this.baseUrl);

		if (preInsp.status !== "0") {
			throw new CloudAuthError(preInsp.message || "Pre-inspect failed", preInsp.status);
		}

		const preData = assertData<PreInspectData>(preInsp.data, "Pre-inspect");
		const { n: nonce, a: salt, v } = preData;

		const ch = salt ? await buildArgon2Challenge(this.credentialInput, salt) : this.credentials[0]; // Legacy md5/sha — same body the web portal sends.

		this.log(`Cloud pre-insp: v=${v ?? "?"} saltPresent=${!!salt} dc=${preData.dc ?? "n/a"}`);

		const result = await this._post<{ token?: string }>(
			IAM_LOGIN_V3_PATH,
			{ u: this.user, ch, n: nonce },
			this.baseUrl,
		);

		if (result.status !== "0") {
			throw new CloudAuthError(result.message || "Login rejected", result.status);
		}

		return result.data?.token ?? null;
	}

	/**
	 * Probe which data-API surface the account is allowed on. Hits `/pvm/.../select_by_page`
	 * against `this.baseUrl` (regional host) — Web/Installer accounts get status=0, home
	 * accounts get rejected by the server. This replaces the pre-insp.v profile inference,
	 * which broke after Hoymiles unified all accounts onto Argon2id in 2026.
	 *
	 * The rejection arrives in one of two shapes, BOTH meaning "home":
	 * - HTTP 200 with a non-zero JSON `status` ("can only be used for logging in to the
	 *   S-Miles Home app" or similar), or
	 * - an HTTP 403 — the live cloud forbids Home accounts on the `/pvm/` web API outright.
	 *   This is NOT a transport error; it is the definitive profile signal and must not
	 *   abort the login (that bug locked every S-Miles Home account out completely).
	 *
	 * Must run AFTER token assignment — the endpoint requires authentication.
	 *
	 * @throws on genuine transport/network errors (timeout, DNS, 5xx). Caller rolls back token state.
	 */
	private async probeDataProfile(): Promise<CloudProfile> {
		try {
			const result = await this._post<{ list?: unknown[] }>(
				PROFILE_PROBE_PATH,
				{ page: 1, page_size: 1 },
				this.baseUrl,
			);
			if (result.status === "0") {
				this.log(`Cloud profile probe: /pvm accepted → installer`);
				return "installer";
			}
			this.log(
				`Cloud profile probe: /pvm rejected (status=${result.status} msg="${result.message ?? ""}") → home`,
			);
			return "home";
		} catch (err) {
			if (err instanceof HttpError && err.statusCode === 403) {
				this.log(`Cloud profile probe: /pvm returned HTTP 403 → home`);
				return "home";
			}
			throw err;
		}
	}

	/**
	 * Resolve the regional API host for the configured user via region_c.
	 * On success, updates this.baseUrl and this.lastDc so all subsequent v3 + data-API
	 * requests land on the right region with the correct User-Agent. Failure is
	 * logged but non-fatal — we proceed against the default host with dc=0.
	 */
	private async discoverRegion(): Promise<void> {
		try {
			const result = await this._post<RegionData>(IAM_REGION_PATH, { email: this.user }, this.baseUrl);
			if (result.status !== "0" || !result.data) {
				this.log(
					`Cloud region_c: status=${result.status} message="${result.message ?? ""}" — keeping host ${this.baseUrl}`,
				);
				return;
			}
			const { login_url, dc } = result.data;
			this.lastDc = typeof dc === "number" ? dc : null;
			if (login_url && login_url !== this.baseUrl) {
				this.log(`Cloud region_c: switching base URL ${this.baseUrl} → ${login_url} (dc=${dc})`);
				this.baseUrl = login_url;
			} else if (login_url) {
				this.log(`Cloud region_c: confirmed host ${this.baseUrl} (dc=${dc})`);
			} else {
				this.log(`Cloud region_c: empty login_url, dc=${dc} — keeping host ${this.baseUrl}`);
			}
		} catch (err) {
			this.log(`Cloud region_c: ${errorMessage(err)} — keeping host ${this.baseUrl}`);
		}
	}

	/**
	 * Run a non-destructive diagnostic of the configured credentials:
	 * region_c → pre-insp → login → profile probe.
	 *
	 * Returns what each phase reported so the admin UI can show exactly where the auth
	 * flow fell over for a forum bug report. Restores all mutable state on exit —
	 * neither token, profile, baseUrl nor dc reflect this run.
	 */
	async loginDiagnostics(): Promise<LoginAttemptResult[]> {
		const attempts: LoginAttemptResult[] = [];
		const startBase = this.baseUrl;
		const savedToken = this.token;
		const savedTokenTime = this.tokenTime;
		const savedProfile = this.profile;
		const savedLastDc = this.lastDc;

		try {
			// 1. region_c
			try {
				const regionResult = await this._post<RegionData>(IAM_REGION_PATH, { email: this.user }, this.baseUrl);
				const ok = regionResult.status === "0" && !!regionResult.data?.login_url;
				attempts.push({
					flow: "region",
					host: startBase,
					ok,
					status: regionResult.status,
					message: regionResult.message,
					dc: regionResult.data?.dc,
				});
				if (ok && regionResult.data) {
					this.baseUrl = regionResult.data.login_url;
					this.lastDc = typeof regionResult.data.dc === "number" ? regionResult.data.dc : null;
				}
			} catch (err) {
				attempts.push({ flow: "region", host: startBase, ok: false, message: errorMessage(err) });
			}

			// 2. pre-insp — reports v / saltPresent before login is even tried. Profile is
			// no longer inferred here (see probe phase below).
			let preInspOk = false;
			let preData: PreInspectData | undefined;
			try {
				const preInsp = await this._post<PreInspectData>(IAM_PRE_INSPECT_PATH, { u: this.user }, this.baseUrl);
				preInspOk = preInsp.status === "0" && preInsp.data != null;
				preData = preInsp.data;
				attempts.push({
					flow: "preInsp",
					host: this.baseUrl,
					ok: preInspOk,
					status: preInsp.status,
					message: preInsp.message,
					v: preData?.v,
					saltPresent: !!preData?.a,
				});
			} catch (err) {
				attempts.push({ flow: "preInsp", host: this.baseUrl, ok: false, message: errorMessage(err) });
			}

			// 3. login — only attempted if pre-insp succeeded (otherwise we'd just send garbage to
			// the server with no chance of success and no diagnostic benefit).
			let probeToken: string | null = null;
			if (preInspOk && preData?.n) {
				try {
					const ch = preData.a
						? await buildArgon2Challenge(this.credentialInput, preData.a)
						: this.credentials[0];
					const result = await this._post<{ token?: string }>(
						IAM_LOGIN_V3_PATH,
						{ u: this.user, ch, n: preData.n },
						this.baseUrl,
					);
					const ok = result.status === "0" && !!result.data?.token;
					attempts.push({
						flow: "login",
						host: this.baseUrl,
						ok,
						status: result.status,
						message: result.message,
						hasToken: !!result.data?.token,
					});
					if (ok) {
						probeToken = result.data?.token ?? null;
					}
				} catch (err) {
					if (err instanceof CloudAuthError) {
						attempts.push({
							flow: "login",
							host: this.baseUrl,
							ok: false,
							status: err.code,
							message: err.message,
						});
					} else {
						attempts.push({ flow: "login", host: this.baseUrl, ok: false, message: errorMessage(err) });
					}
				}
			}

			// 4. profile probe — only attempted if login produced a token. Temporarily writes
			// `this.token` so _post sends the auth header; the outer `finally` restores it.
			if (probeToken) {
				this.token = probeToken;
				try {
					const probeResult = await this._post<{ list?: unknown[] }>(
						PROFILE_PROBE_PATH,
						{ page: 1, page_size: 1 },
						this.baseUrl,
					);
					const accepted = probeResult.status === "0";
					attempts.push({
						flow: "probe",
						host: this.baseUrl,
						ok: true,
						status: probeResult.status,
						message: probeResult.message,
						profile: accepted ? "installer" : "home",
					});
				} catch (err) {
					// HTTP 403 is not a probe failure — it is the server's "home" verdict.
					if (err instanceof HttpError && err.statusCode === 403) {
						attempts.push({
							flow: "probe",
							host: this.baseUrl,
							ok: true,
							status: "403",
							message: err.message,
							profile: "home",
						});
					} else {
						attempts.push({
							flow: "probe",
							host: this.baseUrl,
							ok: false,
							message: errorMessage(err),
						});
					}
				}
			}
		} finally {
			// Restore state — diagnostics must not interfere with a real login.
			this.baseUrl = startBase;
			this.token = savedToken;
			this.tokenTime = savedTokenTime;
			this.profile = savedProfile;
			this.lastDc = savedLastDc;
		}

		return attempts;
	}

	/** Re-login if the current token is older than 1 hour. */
	async ensureToken(): Promise<void> {
		if (this.tokenRefreshPromise) {
			return this.tokenRefreshPromise;
		}
		if (!this.token || Date.now() - this.tokenTime > TOKEN_MAX_AGE_MS) {
			this.tokenRefreshPromise = withTimeout(this.login(), ENSURE_TOKEN_TIMEOUT_MS, "ensureToken")
				.then(() => {})
				.catch(err => {
					this.token = null;
					throw err;
				})
				.finally(() => {
					this.tokenRefreshPromise = null;
				});
			return this.tokenRefreshPromise;
		}
	}

	/** Clear the current session token. */
	disconnect(): void {
		this.token = null;
		this.profile = null;
		this.stationDcMap.clear();
		this.stationAkMap.clear();
	}

	// --- Data endpoints ---

	/**
	 * Fetch the list of stations (plants) for this account. Home accounts get the
	 * same data over `/pvmc/.../select_by_page_c` but the station id arrives as
	 * `sid` instead of `id` — normalized to `id` here so callers don't care.
	 */
	async getStationList(): Promise<CloudStation[]> {
		await this.ensureToken();
		const path =
			this.profile === "home" ? "/pvmc/api/0/station/select_by_page_c" : "/pvm/api/0/station/select_by_page";
		const result = await this._post<{ list?: Record<string, unknown>[] }>(path, {
			page: 1,
			page_size: 100,
		});
		if (result.status !== "0") {
			throw new Error(`Station list failed: ${result.message}`);
		}
		const rawList = result.data?.list ?? [];
		this.stationDcMap.clear();
		this.stationAkMap.clear();
		return rawList.map(entry => {
			// home: id arrives as `sid`. Preserve everything else so future fields stay accessible.
			const id = typeof entry.id === "number" ? entry.id : typeof entry.sid === "number" ? entry.sid : 0;
			if (id && typeof entry.dc === "number") {
				this.stationDcMap.set(id, entry.dc);
			}
			if (id && typeof entry.ak === "string" && entry.ak) {
				this.stationAkMap.set(id, entry.ak);
			}
			return { ...entry, id, name: typeof entry.name === "string" ? entry.name : "" } as CloudStation;
		});
	}

	/**
	 * Get station details. Home accounts receive a leaner record via `/pvmc/.../find_c`:
	 * `latitude`, `longitude`, `address`, `status`, `local_time`, `warn_data` are NOT present.
	 * Callers must treat those fields as optional (already is `[key: string]: unknown` typed).
	 *
	 * @param stationId - Station ID to query
	 */
	async getStationDetails(stationId: number): Promise<CloudStationDetails> {
		this.assertStationId(stationId);
		await this.ensureToken();
		// Web wants `{id}`, home wants `{sid}` — verified live; `{id}` against find_c gives a DTO error.
		const isHome = this.profile === "home";
		const path = isHome ? "/pvmc/api/0/station/find_c" : "/pvm/api/0/station/find";
		const body = isHome ? { sid: stationId } : { id: stationId };
		const result = await this._post(path, body);
		if (result.status !== "0") {
			throw new Error(`Station details failed: ${result.message}`);
		}
		return assertData<CloudStationDetails>(result.data, "Station details");
	}

	/**
	 * Fetch supplementary station info (lat/lon/address) via the `pvm-ext` endpoint
	 * the Home app uses. Required for Home-profile accounts because `find_c` does
	 * not include coordinates, which leaves the weather pipeline empty.
	 *
	 * Needs the station's `ak` from `getStationList()`; returns `null` if `ak` is
	 * not cached. Routes via the station's DC host like other station-scoped calls.
	 *
	 * @param stationId - Station ID
	 */
	async getStationExtInfo(stationId: number): Promise<CloudStationExtInfo | null> {
		this.assertStationId(stationId);
		const ak = this.stationAkMap.get(stationId);
		if (!ak) {
			return null;
		}
		await this.ensureToken();
		const body = { sid: stationId, ak };
		// The S-Miles app routes this call via the station's `dc` host (DCManager in the
		// decompiled APK). We try the station-DC host first because that's where the real
		// per-station lat/lon lives. If the token isn't accepted there (HTTP 4xx — account
		// doesn't span regions), fall back to the account host so we don't break installs
		// where region replication actually works.
		const stationHost = this.getStationHost(stationId);
		const accountHost = this.getDataHost();
		const hosts = stationHost === accountHost ? [stationHost] : [stationHost, accountHost];
		let lastError: Error | null = null;
		for (const host of hosts) {
			try {
				const result = await this._post<CloudStationExtInfo>(STATION_AK_FIND_PATH, body, host);
				if (result.status !== "0") {
					throw new Error(`Station ext-info failed: ${result.message}`);
				}
				return assertData<CloudStationExtInfo>(result.data, "Station ext-info");
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				this.log(`Station ext-info on ${host} failed: ${lastError.message}`);
			}
		}
		throw lastError ?? new Error("Station ext-info failed");
	}

	/**
	 * Get the device tree (DTU + inverters) for a station. The two API surfaces use
	 * different field names: web returns `children[]` with `soft_ver`/`hard_ver`/`model_no`
	 * strings; home returns `devices[]` with compact `extend_data.soft_num` integers and no
	 * model name. The wrapper normalizes the tree shape (devices → children) so the rest of
	 * the adapter can iterate without branching, but fields not delivered by `_c` remain
	 * undefined (callers must already tolerate that and skip the corresponding states).
	 *
	 * @param stationId - Station ID to query
	 */
	async getDeviceTree(stationId: number): Promise<CloudDeviceNode[]> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const isHome = this.profile === "home";
		const path = isHome ? "/pvmc/api/0/station/select_device_c" : "/pvm/api/0/station/select_device_of_tree";
		const body = isHome ? { sid: stationId } : { id: stationId };
		const result = await this._post(path, body);
		if (result.status !== "0") {
			throw new Error(`Device tree failed: ${result.message}`);
		}
		const raw = assertData<unknown[]>(result.data ?? [], "Device tree");
		return isHome ? raw.map(node => normalizeHomeTreeNode(node)) : (raw as CloudDeviceNode[]);
	}

	/**
	 * Get micro-inverter realtime data from daily chart (Protobuf response).
	 * Endpoint: /pvm-data/api/0/micro/data/count_by_day
	 * From app DeviceDetailActivity.F2(): T0(sid, date, mi_list, quota)
	 * Response is Protobuf LineChart with Float32 time series per quota.
	 *
	 * @param stationId - Cloud station ID
	 * @param microIds - Array of micro-inverter IDs (from device tree child.id)
	 * @param date - Date string YYYY-MM-DD
	 * @param quotas - Array of quota names (e.g. ["MI_POWER", "MI_TEMPERATURE"])
	 * @returns Map of quota name to last non-zero value
	 */
	async getMicroRealtimeData(
		stationId: number,
		microIds: number[],
		date: string,
		quotas: string[],
	): Promise<Record<string, number> | null> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const path =
			this.profile === "home"
				? "/pvmc/api/0/micro_data/count_by_day_c"
				: "/pvm-data/api/0/micro/data/count_by_day";
		try {
			const rawBuf = await this._postBinary(path, {
				sid: stationId,
				date,
				mi_list: microIds,
				quota: quotas,
			});
			return await parseChartResponse(rawBuf, this.log);
		} catch (err) {
			this.log(`Micro chart error: ${err instanceof Error ? err.stack || err.message : errorMessage(err)}`);
			return null;
		}
	}

	private _postBinary(apiPath: string, body: Record<string, unknown>): Promise<Buffer> {
		return postBinary(new URL(apiPath, this.getDataHost()).href, body, {
			token: this.token,
			userAgent: this.getUserAgent(),
		});
	}

	/**
	 * Get per-PV-port daily chart data (Protobuf response).
	 * Endpoint: /pvm-data/api/0/module/data/count_by_day
	 * From app DeviceDetailActivity.H2(): U0(sid, date, mi_list, quota, port)
	 *
	 * @param stationId - Cloud station ID
	 * @param microId - Micro-inverter ID
	 * @param port - Port number (1-based)
	 * @param date - Date string YYYY-MM-DD
	 * @param quotas - Array of quota names (e.g. ["MODULE_POWER", "MODULE_V", "MODULE_I"])
	 * @returns Map of quota name to last value
	 */
	async getModuleRealtimeData(
		stationId: number,
		microId: number,
		port: number,
		date: string,
		quotas: string[],
	): Promise<Record<string, number> | null> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const path =
			this.profile === "home"
				? "/pvmc/api/0/module_data/count_by_day_c"
				: "/pvm-data/api/0/module/data/count_by_day";
		try {
			const rawBuf = await this._postBinary(path, {
				sid: stationId,
				date,
				mi_list: [{ id: microId, port }],
				quota: quotas,
			});
			return await parseChartResponse(rawBuf, this.log);
		} catch (err) {
			this.log(`Module chart error: ${errorMessage(err)}`);
			return null;
		}
	}

	/**
	 * Get station-wide realtime energy/power. Both API surfaces produce the same
	 * 15 core fields (today_eq, real_power, …); the home variant additionally returns
	 * `reflux_station_data`, `efl_*`, `local_time`, `warn_data`, and `electricity_price`
	 * — see `project_c_api_new_fields.md` for the full inventory we want to surface
	 * in phase 2.
	 *
	 * @param stationId - Station ID to query
	 */
	async getStationRealtime(stationId: number): Promise<CloudRealtimeData> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const path =
			this.profile === "home"
				? "/pvmc/api/0/station_data/count_station_real_data_c"
				: "/pvm-data/api/0/station/data/count_station_real_data";
		const result = await this._post<CloudRealtimeData>(path, { sid: stationId });
		if (result.status !== "0") {
			throw new Error(`Realtime data failed: ${result.message}`);
		}
		return assertData<CloudRealtimeData>(result.data, "Realtime data");
	}

	/**
	 * Get weather data for station coordinates.
	 * Uses EU API server (euapi.hoymiles.com) which hosts the weather endpoint.
	 *
	 * @param lat - Station latitude
	 * @param lon - Station longitude
	 */
	async getWeather(lat: number, lon: number): Promise<WeatherData> {
		const result = await postJson<CloudApiResponse<WeatherData>>(
			EU_WEATHER_URL,
			{ lat, lon },
			{
				token: this.token,
				userAgent: this.getUserAgent(),
			},
		);
		if (result.status !== "0") {
			throw new Error(`Weather request failed: ${result.message}`);
		}
		return assertData<WeatherData>(result.data, "Weather");
	}

	/**
	 * Check if firmware updates are available for a DTU.
	 *
	 * @param stationId - Station ID
	 * @param dtuSn - DTU serial number
	 */
	async checkFirmwareUpdate(stationId: number, dtuSn: string): Promise<FirmwareStatus> {
		this.assertStationId(stationId);
		if (!dtuSn) {
			throw new Error("Invalid dtuSn");
		}
		await this.ensureToken();
		const isHome = this.profile === "home";
		const path = isHome ? "/pvmc/api/0/station/upgrade_compare_c" : "/pvm/api/0/upgrade/compare";
		const result = await this._post<{
			tid?: string;
			// web shape:
			upgrade?: number;
			done?: number;
			// home shape:
			list?: Array<{ sn?: string; is_upgrade?: number; target_ver?: number; current_ver?: number }>;
		}>(path, { sid: stationId, dtu_sn: dtuSn });
		if (result.status !== "0") {
			throw new Error(`Firmware check failed: ${result.message}`);
		}
		const data = result.data;
		if (isHome) {
			// _c shape: per-device list. "upgrade" = ANY device on this DTU has is_upgrade>0.
			const anyUpgrade = (data?.list ?? []).some(e => (e?.is_upgrade ?? 0) > 0);
			return { upgrade: anyUpgrade ? 1 : 0, done: 0, tid: data?.tid ?? "" };
		}
		return assertData<FirmwareStatus>(data ?? { upgrade: 0, done: 0, tid: "" }, "Firmware status");
	}

	// --- HTTP helpers ---

	/**
	 * POST to a data endpoint. Default host comes from `getDataHost()` so `home` profile
	 * data calls automatically land on `neapi`. Auth endpoints pass `hostOverride=this.baseUrl`
	 * because they must use the regional login host.
	 *
	 * @param apiPath - Endpoint path relative to the base URL (e.g. `/pvmc/api/0/station/find_c`).
	 * @param body - JSON body to POST.
	 * @param hostOverride - Force this host instead of the profile-dependent default (used for auth endpoints).
	 */
	private _post<T = Record<string, unknown>>(
		apiPath: string,
		body: Record<string, unknown>,
		hostOverride?: string,
	): Promise<CloudApiResponse<T>> {
		const url = new URL(apiPath, hostOverride ?? this.getDataHost()).href;
		return postJson<CloudApiResponse<T>>(url, body, {
			token: this.token,
			userAgent: this.getUserAgent(),
		});
	}
}

export default CloudConnection;
