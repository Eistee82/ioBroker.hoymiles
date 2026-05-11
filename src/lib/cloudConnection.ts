import { postJson, postBinary } from "./httpClient.js";
import { parseChartResponse } from "./chartParser.js";
import {
	TOKEN_MAX_AGE_MS,
	ENSURE_TOKEN_TIMEOUT_MS,
	CLOUD_HOST_DEFAULT,
	CLOUD_HOST_EU,
	IAM_PRE_INSPECT_PATH,
	IAM_LOGIN_V3_PATH,
	IAM_REGION_PATH,
	APP_USER_AGENT_PREFIX,
	APP_VERSION,
	APP_TID,
} from "./constants.js";
import { errorMessage, withTimeout, buildCredentialChallenges, buildArgon2Challenge } from "./utils.js";

/**
 * Cloud profile inferred from pre-insp `v`. Determines which API surface the adapter talks to.
 *
 * - `"installer"`: server returned `v=2` (no salt). These are S-Miles Installer and S-Miles
 *   Enduser accounts — the same ones that can sign into the `global.hoymiles.com` web portal.
 *   Login uses the legacy md5/sha challenge; data calls use the `/pvm/...` web API surface
 *   (no regression for setups already on this profile).
 * - `"home"`: server returned `v=3` with an Argon2 salt. These are S-Miles Home accounts
 *   from the `com.hm.balcony` app and are restricted to that ecosystem by the server
 *   ("can only be used for logging in to the S-Miles Home app" on `/pvm/...`). Login uses
 *   Argon2id; data calls use the `/pvmc/.../*_c` API surface, which is also reachable from
 *   installer accounts but is the only surface available to home accounts.
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
	/** Which phase this attempt represents: region_c discovery, pre-inspect, or login. */
	flow: "region" | "preInsp" | "login";
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
	/** Cloud profile derived from `v` (home if v=3, else installer). */
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
	warn_data: {
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
	timezone: { tz_name: string; offset: number };
	local_time: string;
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
	/** Cloud profile from the most recent pre-insp (v=3 → home, else installer). null = not yet logged in. */
	private profile: CloudProfile | null;
	/** Last data-center returned by region_c (null = not yet queried, -1 = account unknown). */
	private lastDc: number | null;

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
	}

	/** Currently active API base URL (changes if region_c redirects to a regional host). */
	getBaseUrl(): string {
		return this.baseUrl;
	}

	/**
	 * Cloud profile produced by the most recent login:
	 * - `"installer"`: S-Miles Installer / Cloud-Web Enduser account (`pre-insp.v == 2`, legacy md5/sha challenge). Data API surface is `/pvm/...`.
	 * - `"home"`:      S-Miles Home account (`pre-insp.v == 3`, Argon2 salt). Data API surface is `/pvmc/.../_c`.
	 * - `null`:        not yet logged in.
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
	 * `installer` profile keeps using `baseUrl` so existing Cloud-Web setups are unaffected.
	 */
	private getDataHost(): string {
		return this.profile === "home" ? CLOUD_HOST_DEFAULT : this.baseUrl;
	}

	// --- Auth ---

	/**
	 * Authenticate with the Hoymiles cloud and obtain a session token.
	 *
	 * Flow: region_c → pre-insp → login (v3). region_c first because it returns
	 * the user's regional host AND the `dc` marker that goes into the User-Agent.
	 * pre-insp returns `v` which decides the challenge type:
	 *   v=3 + salt → Argon2id (S-Miles Home accounts on com.hm.balcony)
	 *   v=2 (no salt) → legacy md5/sha (S-Miles Cloud Web / Installer accounts)
	 *
	 * Previously this method also attempted the v0 (`/iam/pub/0/c/login_c`) flow
	 * as a fallback. The Hoymiles cloud has since locked v0 down with a generic
	 * "Your app version is low" rejection for Home accounts, while Web accounts
	 * succeed through v3 already. v0 is dead code in 2026 and was removed.
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
		this.log(`Cloud login success: profile=${this.profile} dc=${this.lastDc ?? "n/a"} host=${this.baseUrl}`);
		return token;
	}

	/**
	 * v3 flow: pre-inspect to fetch nonce+salt+v, then login with the appropriate
	 * challenge. Sets `this.profile` based on `pre-insp.v`.
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

		// `v=3` is the marker for S-Miles Home accounts (Argon2-only). Anything
		// else — currently v=2 in the wild — is a legacy Installer/Cloud-Web account.
		this.profile = v === 3 ? "home" : "installer";

		const ch = salt ? await buildArgon2Challenge(this.credentialInput, salt) : this.credentials[0]; // Legacy md5/sha — same body the web portal sends.

		this.log(
			`Cloud pre-insp: v=${v ?? "?"} saltPresent=${!!salt} profile=${this.profile} dc=${preData.dc ?? "n/a"}`,
		);

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
	 * Run a non-destructive diagnostic of the configured credentials: region_c → pre-insp → login.
	 * Returns what each phase reported so the admin UI can show exactly where the auth flow
	 * fell over for a forum bug report. Restores all mutable state on exit — neither token,
	 * profile, baseUrl nor dc reflect this run.
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

			// 2. pre-insp — reports v / saltPresent / inferred profile before login is even tried.
			let preInspOk = false;
			let preData: PreInspectData | undefined;
			try {
				const preInsp = await this._post<PreInspectData>(IAM_PRE_INSPECT_PATH, { u: this.user }, this.baseUrl);
				preInspOk = preInsp.status === "0" && preInsp.data != null;
				preData = preInsp.data;
				const v = preData?.v;
				attempts.push({
					flow: "preInsp",
					host: this.baseUrl,
					ok: preInspOk,
					status: preInsp.status,
					message: preInsp.message,
					v,
					saltPresent: !!preData?.a,
					profile: preInspOk && v != null ? (v === 3 ? "home" : "installer") : undefined,
				});
			} catch (err) {
				attempts.push({ flow: "preInsp", host: this.baseUrl, ok: false, message: errorMessage(err) });
			}

			// 3. login — only attempted if pre-insp succeeded (otherwise we'd just send garbage to
			// the server with no chance of success and no diagnostic benefit).
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
					attempts.push({
						flow: "login",
						host: this.baseUrl,
						ok: result.status === "0" && !!result.data?.token,
						status: result.status,
						message: result.message,
						hasToken: !!result.data?.token,
					});
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
		return rawList.map(entry => {
			// home: id arrives as `sid`. Preserve everything else so future fields stay accessible.
			const id = typeof entry.id === "number" ? entry.id : typeof entry.sid === "number" ? entry.sid : 0;
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
