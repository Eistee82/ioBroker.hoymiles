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
	IAM_LOGIN_V0_PATH,
} from "./constants.js";
import { errorMessage, withTimeout, buildCredentialChallenges, buildArgon2Challenge } from "./utils.js";

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

interface CloudApiResponse<T = Record<string, unknown>> {
	status: string;
	message?: string;
	data?: T;
}

interface PreInspectData {
	n: string;
	a?: string;
}

interface RegionData {
	/** Regional API base URL the user's account lives on. Empty string when unknown. */
	login_url: string;
	/** Data-center marker. -1 = account not found, 0+ = a real region. */
	dc: number;
}

interface LoginV0Data {
	token?: string;
}

/**
 * Outcome of one login attempt — used by `loginDiagnostics()` to report which
 * flow accepted/rejected the configured credentials, without leaking the token.
 */
export interface LoginAttemptResult {
	/** Which flow this attempt represents: region_c discovery, v3 login, or v0 login. */
	flow: "v3" | "v0" | "region";
	/** Base URL the attempt was made against (e.g. `https://neapi.hoymiles.com`). */
	host: string;
	/** True if the server accepted the request (region_c: returned a login_url; v3/v0: returned a token). */
	ok: boolean;
	/** Server-reported status code, if the request reached the server. */
	status?: string;
	/** Server-reported or transport error message, when not ok. */
	message?: string;
	/** Data-center marker from region_c response (region attempts only). */
	dc?: number;
	/** True if the attempt produced a session token (v3/v0 attempts only). */
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
	/** Last successful auth flow — informs re-login (skip rediscovery if v3 already worked). */
	private lastFlow: "v3" | "v0" | null;
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
		this.lastFlow = null;
		this.lastDc = null;
	}

	/** Currently active API base URL (changes if region_c redirects to a regional host). */
	getBaseUrl(): string {
		return this.baseUrl;
	}

	/** Auth flow that produced the current token: "v3" (web portal/Installer/Enduser), "v0" (S-Miles Home / legacy), or null if not yet logged in. */
	getLastFlow(): "v3" | "v0" | null {
		return this.lastFlow;
	}

	/** Last data-center marker from region_c. -1 = account unknown to that region; null = region_c not yet called. */
	getLastDc(): number | null {
		return this.lastDc;
	}

	// --- Auth ---

	/**
	 * Authenticate with the Hoymiles cloud and obtain a session token.
	 *
	 * Tries the v3 flow first (used by the S-Miles web portal and historically by
	 * this adapter — accepts S-Miles Installer/Enduser accounts). If v3 hard-rejects
	 * the credentials, falls back to the v0 flow (used by the S-Miles Home /
	 * com.hm.balcony Android app), preceded by a region_c discovery call so the
	 * request lands on the user's regional API host.
	 */
	async login(): Promise<string> {
		let v3AuthError: CloudAuthError | null = null;
		let lastTechError: unknown;

		this.log(`Cloud login start (host=${this.baseUrl}, user=${this.user})`);

		// --- Phase 1: v3 (current web portal flow) ---
		try {
			const token = await this.tryLoginV3();
			if (token) {
				this.token = token;
				this.tokenTime = Date.now();
				this.lastFlow = "v3";
				this.log(`Cloud login success via v3 (host=${this.baseUrl})`);
				return this.token;
			}
			this.log("Cloud login v3: server returned status=0 but no token — will try v0 fallback");
		} catch (err) {
			if (err instanceof CloudAuthError) {
				v3AuthError = err;
				this.log(`Cloud login v3 rejected: status=${err.code} message="${err.message}" — trying v0 fallback`);
			} else {
				// Transient (network/5xx) — remember, but still try v0 in case it's a v3-only outage
				lastTechError = err;
				this.log(`Cloud login v3 transient error: ${errorMessage(err)} — trying v0 fallback`);
			}
		}

		// --- Phase 2: region_c discovery (best-effort) ---
		// region_c may relocate this.baseUrl to the user's regional host. A failure here
		// is non-fatal — we still try v0 against the current base URL.
		await this.discoverRegion();

		// --- Phase 3: v0 fallback (S-Miles Home / Installer-app flow) ---
		try {
			const token = await this.tryLoginV0();
			if (token) {
				this.token = token;
				this.tokenTime = Date.now();
				this.lastFlow = "v0";
				this.log(`Cloud login success via v0 (host=${this.baseUrl}, dc=${this.lastDc ?? "n/a"})`);
				return this.token;
			}
			this.log("Cloud login v0: server returned status=0 but no token");
		} catch (err) {
			if (err instanceof CloudAuthError) {
				// Both flows hard-rejected → permanent auth failure.
				const combined =
					v3AuthError && v3AuthError.message !== err.message
						? `${err.message} (v0); v3 also rejected: ${v3AuthError.message}`
						: err.message;
				this.log(`Cloud login v0 rejected: status=${err.code} message="${err.message}"`);
				throw new CloudAuthError(combined, err.code);
			}
			// v0 transient — keep the more informative one
			lastTechError = err;
			this.log(`Cloud login v0 transient error: ${errorMessage(err)}`);
		}

		if (v3AuthError) {
			throw v3AuthError;
		}
		if (lastTechError instanceof Error) {
			throw lastTechError;
		}
		throw new Error("Login failed: all authentication strategies rejected");
	}

	/**
	 * v3 flow: pre-insp → login. Walks the credential-challenge list and attempts
	 * each in turn until one succeeds or one throws CloudAuthError (permanent reject).
	 */
	private async tryLoginV3(): Promise<string | null> {
		let lastTechError: unknown;
		for (const challenge of this.credentials) {
			try {
				const token = await this.tryLoginV3Challenge(challenge);
				if (token) {
					return token;
				}
			} catch (err) {
				if (err instanceof CloudAuthError) {
					throw err;
				}
				lastTechError = err;
			}
		}
		if (lastTechError instanceof Error) {
			throw lastTechError;
		}
		return null;
	}

	/**
	 * Single v3 attempt: pre-inspect to get nonce, then login with the given credential hash.
	 *
	 * @param challenge - The credential hash to use for authentication
	 * @returns The session token on success, or null if the server accepted the request but returned no token
	 * @throws CloudAuthError when the server reports a permanent auth failure (wrong credentials, locked account)
	 */
	private async tryLoginV3Challenge(challenge: string): Promise<string | null> {
		const preInsp = await this._post<PreInspectData>(IAM_PRE_INSPECT_PATH, { u: this.user });

		if (preInsp.status !== "0") {
			throw new CloudAuthError(preInsp.message || "Pre-inspect failed", preInsp.status);
		}

		const preData = assertData<PreInspectData>(preInsp.data, "Pre-inspect");
		const { n: nonce, a: salt } = preData;

		const ch = salt ? await buildArgon2Challenge(this.credentialInput, salt) : challenge;

		const result = await this._post<{ token?: string }>(IAM_LOGIN_V3_PATH, {
			u: this.user,
			ch,
			n: nonce,
		});

		if (result.status !== "0") {
			throw new CloudAuthError(result.message || "Login rejected", result.status);
		}

		return result.data?.token ?? null;
	}

	/**
	 * Resolve the regional API host for the configured user via region_c.
	 * On success, updates this.baseUrl so all subsequent v0 + data-API requests
	 * land on the right region. Failure is logged but non-fatal.
	 */
	private async discoverRegion(): Promise<void> {
		try {
			const result = await this._post<RegionData>(IAM_REGION_PATH, { email: this.user });
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
	 * v0 flow: legacy login_c endpoint used by the S-Miles Installer and S-Miles
	 * Home (com.hm.balcony) Android apps. Body is `{user_name, password}` where
	 * password is the `<md5>.<base64-sha256>` challenge — exactly the first
	 * challenge in `buildCredentialChallenges()`.
	 */
	private async tryLoginV0(): Promise<string | null> {
		const password = this.credentials[0];
		this.log(`Cloud login v0: POST ${IAM_LOGIN_V0_PATH} on ${this.baseUrl}`);
		const result = await this._post<LoginV0Data>(IAM_LOGIN_V0_PATH, {
			user_name: this.user,
			password,
		});
		if (result.status !== "0") {
			throw new CloudAuthError(result.message || "Login rejected (v0)", result.status);
		}
		return result.data?.token ?? null;
	}

	/**
	 * Run a non-destructive diagnostic of the configured credentials: query
	 * region_c and try BOTH v3 and v0 sequentially, return what each flow said.
	 * Used by the admin UI's "Test cloud login" button so users can see exactly
	 * which flow accepts their account — invaluable for forum bug reports.
	 *
	 * Does NOT mutate this.token or this.lastFlow — purely observational.
	 */
	async loginDiagnostics(): Promise<LoginAttemptResult[]> {
		const attempts: LoginAttemptResult[] = [];
		const startBase = this.baseUrl;
		const savedToken = this.token;
		const savedTokenTime = this.tokenTime;
		const savedLastFlow = this.lastFlow;
		const savedLastDc = this.lastDc;

		// 1. region_c
		try {
			const regionResult = await this._post<RegionData>(IAM_REGION_PATH, { email: this.user });
			attempts.push({
				flow: "region",
				host: startBase,
				ok: regionResult.status === "0" && !!regionResult.data?.login_url,
				status: regionResult.status,
				message: regionResult.message,
				dc: regionResult.data?.dc,
			});
			if (regionResult.status === "0" && regionResult.data?.login_url) {
				this.baseUrl = regionResult.data.login_url;
			}
		} catch (err) {
			attempts.push({ flow: "region", host: startBase, ok: false, message: errorMessage(err) });
		}

		// 2. v3 against the (possibly updated) host
		try {
			const token = await this.tryLoginV3();
			attempts.push({ flow: "v3", host: this.baseUrl, ok: !!token, hasToken: !!token });
		} catch (err) {
			if (err instanceof CloudAuthError) {
				attempts.push({
					flow: "v3",
					host: this.baseUrl,
					ok: false,
					status: err.code,
					message: err.message,
				});
			} else {
				attempts.push({ flow: "v3", host: this.baseUrl, ok: false, message: errorMessage(err) });
			}
		}

		// 3. v0 against the same host
		try {
			const token = await this.tryLoginV0();
			attempts.push({ flow: "v0", host: this.baseUrl, ok: !!token, hasToken: !!token });
		} catch (err) {
			if (err instanceof CloudAuthError) {
				attempts.push({
					flow: "v0",
					host: this.baseUrl,
					ok: false,
					status: err.code,
					message: err.message,
				});
			} else {
				attempts.push({ flow: "v0", host: this.baseUrl, ok: false, message: errorMessage(err) });
			}
		}

		// Restore state — diagnostics must not interfere with a real login.
		this.baseUrl = startBase;
		this.token = savedToken;
		this.tokenTime = savedTokenTime;
		this.lastFlow = savedLastFlow;
		this.lastDc = savedLastDc;

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
		this.lastFlow = null;
	}

	// --- Data endpoints ---

	/** Fetch the list of stations (plants) for this account. */
	async getStationList(): Promise<CloudStation[]> {
		await this.ensureToken();
		const result = await this._post<{ list?: CloudStation[] }>("/pvm/api/0/station/select_by_page", {
			page: 1,
			page_size: 100,
		});
		if (result.status !== "0") {
			throw new Error(`Station list failed: ${result.message}`);
		}
		return result.data?.list || [];
	}

	/** @param stationId - Station ID to query */
	async getStationDetails(stationId: number): Promise<CloudStationDetails> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const result = await this._post("/pvm/api/0/station/find", { id: stationId });
		if (result.status !== "0") {
			throw new Error(`Station details failed: ${result.message}`);
		}
		return assertData<CloudStationDetails>(result.data, "Station details");
	}

	/** @param stationId - Station ID to query */
	async getDeviceTree(stationId: number): Promise<CloudDeviceNode[]> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const result = await this._post("/pvm/api/0/station/select_device_of_tree", {
			id: stationId,
		});
		if (result.status !== "0") {
			throw new Error(`Device tree failed: ${result.message}`);
		}
		return assertData<CloudDeviceNode[]>(result.data ?? [], "Device tree");
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
		try {
			const rawBuf = await this._postBinary("/pvm-data/api/0/micro/data/count_by_day", {
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
		return postBinary(new URL(apiPath, this.baseUrl).href, body, { token: this.token });
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
		try {
			const rawBuf = await this._postBinary("/pvm-data/api/0/module/data/count_by_day", {
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

	/** @param stationId - Station ID to query */
	async getStationRealtime(stationId: number): Promise<CloudRealtimeData> {
		this.assertStationId(stationId);
		await this.ensureToken();
		const result = await this._post<CloudRealtimeData>("/pvm-data/api/0/station/data/count_station_real_data", {
			sid: stationId,
		});
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
		const result = await this._post("/pvm/api/0/upgrade/compare", {
			sid: stationId,
			dtu_sn: dtuSn,
		});
		if (result.status !== "0") {
			throw new Error(`Firmware check failed: ${result.message}`);
		}
		return assertData<FirmwareStatus>(result.data ?? { upgrade: 0, done: 0, tid: "" }, "Firmware status");
	}

	// --- HTTP helpers ---

	private _post<T = Record<string, unknown>>(
		apiPath: string,
		body: Record<string, unknown>,
	): Promise<CloudApiResponse<T>> {
		return postJson<CloudApiResponse<T>>(new URL(apiPath, this.baseUrl).href, body, { token: this.token });
	}
}

export default CloudConnection;
