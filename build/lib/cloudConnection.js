import { postJson, postBinary } from "./httpClient.js";
import { parseChartResponse } from "./chartParser.js";
import { TOKEN_MAX_AGE_MS, ENSURE_TOKEN_TIMEOUT_MS, CLOUD_HOST_DEFAULT, CLOUD_HOST_EU, IAM_PRE_INSPECT_PATH, IAM_LOGIN_V3_PATH, IAM_REGION_PATH, PROFILE_PROBE_PATH, APP_USER_AGENT_PREFIX, APP_VERSION, APP_TID, } from "./constants.js";
import { errorMessage, withTimeout, buildCredentialChallenges, buildArgon2Challenge } from "./utils.js";
const EU_WEATHER_URL = `${CLOUD_HOST_EU}/tpa/api/0/weather/get`;
function assertData(data, label) {
    if (data == null || typeof data !== "object") {
        throw new Error(`${label}: expected object, got ${typeof data}`);
    }
    return data;
}
function normalizeHomeTreeNode(raw) {
    const n = (raw && typeof raw === "object" ? raw : {});
    const children = Array.isArray(n.devices) ? n.devices.map(normalizeHomeTreeNode) : [];
    return {
        sn: typeof n.sn === "string" ? n.sn : "",
        id: typeof n.id === "number" ? n.id : 0,
        dtu_sn: typeof n.dtu_sn === "string" ? n.dtu_sn : "",
        type: typeof n.type === "number" ? n.type : 0,
        model_no: "",
        soft_ver: "",
        hard_ver: "",
        warn_data: n.warn_data ?? { connect: false, warn: false },
        children,
        ...n,
    };
}
export class CloudAuthError extends Error {
    code;
    constructor(message, code = "") {
        super(message);
        this.name = "CloudAuthError";
        this.code = code;
    }
}
class CloudConnection {
    token;
    user;
    credentials;
    credentialInput;
    log;
    tokenTime;
    tokenRefreshPromise;
    baseUrl;
    profile;
    lastDc;
    assertStationId(stationId) {
        if (!stationId || stationId <= 0) {
            throw new Error("Invalid stationId");
        }
    }
    constructor(user, password, log) {
        this.user = user;
        const input = Buffer.from(password);
        this.credentials = buildCredentialChallenges(input);
        this.credentialInput = input;
        this.log = log || (() => { });
        this.token = null;
        this.tokenTime = 0;
        this.tokenRefreshPromise = null;
        this.baseUrl = CLOUD_HOST_DEFAULT;
        this.profile = null;
        this.lastDc = null;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    getProfile() {
        return this.profile;
    }
    getLastDc() {
        return this.lastDc;
    }
    getUserAgent() {
        const dc = this.lastDc ?? 0;
        return `${APP_USER_AGENT_PREFIX}/${APP_VERSION}/${APP_TID}/${dc}`;
    }
    getDataHost() {
        return this.profile === "home" ? CLOUD_HOST_DEFAULT : this.baseUrl;
    }
    async login() {
        this.log(`Cloud login start (host=${this.baseUrl}, user=${this.user})`);
        await this.discoverRegion();
        const token = await this.tryLoginV3();
        if (!token) {
            throw new Error("Login failed: server accepted credentials but returned no token");
        }
        this.token = token;
        this.tokenTime = Date.now();
        try {
            this.profile = await this.probeDataProfile();
        }
        catch (err) {
            this.token = null;
            this.tokenTime = 0;
            throw err;
        }
        this.log(`Cloud login success: profile=${this.profile} dc=${this.lastDc ?? "n/a"} host=${this.baseUrl}`);
        return token;
    }
    async tryLoginV3() {
        const preInsp = await this._post(IAM_PRE_INSPECT_PATH, { u: this.user }, this.baseUrl);
        if (preInsp.status !== "0") {
            throw new CloudAuthError(preInsp.message || "Pre-inspect failed", preInsp.status);
        }
        const preData = assertData(preInsp.data, "Pre-inspect");
        const { n: nonce, a: salt, v } = preData;
        const ch = salt ? await buildArgon2Challenge(this.credentialInput, salt) : this.credentials[0];
        this.log(`Cloud pre-insp: v=${v ?? "?"} saltPresent=${!!salt} dc=${preData.dc ?? "n/a"}`);
        const result = await this._post(IAM_LOGIN_V3_PATH, { u: this.user, ch, n: nonce }, this.baseUrl);
        if (result.status !== "0") {
            throw new CloudAuthError(result.message || "Login rejected", result.status);
        }
        return result.data?.token ?? null;
    }
    async probeDataProfile() {
        const result = await this._post(PROFILE_PROBE_PATH, { page: 1, page_size: 1 }, this.baseUrl);
        if (result.status === "0") {
            this.log(`Cloud profile probe: /pvm accepted → installer`);
            return "installer";
        }
        this.log(`Cloud profile probe: /pvm rejected (status=${result.status} msg="${result.message ?? ""}") → home`);
        return "home";
    }
    async discoverRegion() {
        try {
            const result = await this._post(IAM_REGION_PATH, { email: this.user }, this.baseUrl);
            if (result.status !== "0" || !result.data) {
                this.log(`Cloud region_c: status=${result.status} message="${result.message ?? ""}" — keeping host ${this.baseUrl}`);
                return;
            }
            const { login_url, dc } = result.data;
            this.lastDc = typeof dc === "number" ? dc : null;
            if (login_url && login_url !== this.baseUrl) {
                this.log(`Cloud region_c: switching base URL ${this.baseUrl} → ${login_url} (dc=${dc})`);
                this.baseUrl = login_url;
            }
            else if (login_url) {
                this.log(`Cloud region_c: confirmed host ${this.baseUrl} (dc=${dc})`);
            }
            else {
                this.log(`Cloud region_c: empty login_url, dc=${dc} — keeping host ${this.baseUrl}`);
            }
        }
        catch (err) {
            this.log(`Cloud region_c: ${errorMessage(err)} — keeping host ${this.baseUrl}`);
        }
    }
    async loginDiagnostics() {
        const attempts = [];
        const startBase = this.baseUrl;
        const savedToken = this.token;
        const savedTokenTime = this.tokenTime;
        const savedProfile = this.profile;
        const savedLastDc = this.lastDc;
        try {
            try {
                const regionResult = await this._post(IAM_REGION_PATH, { email: this.user }, this.baseUrl);
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
            }
            catch (err) {
                attempts.push({ flow: "region", host: startBase, ok: false, message: errorMessage(err) });
            }
            let preInspOk = false;
            let preData;
            try {
                const preInsp = await this._post(IAM_PRE_INSPECT_PATH, { u: this.user }, this.baseUrl);
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
            }
            catch (err) {
                attempts.push({ flow: "preInsp", host: this.baseUrl, ok: false, message: errorMessage(err) });
            }
            let probeToken = null;
            if (preInspOk && preData?.n) {
                try {
                    const ch = preData.a
                        ? await buildArgon2Challenge(this.credentialInput, preData.a)
                        : this.credentials[0];
                    const result = await this._post(IAM_LOGIN_V3_PATH, { u: this.user, ch, n: preData.n }, this.baseUrl);
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
                }
                catch (err) {
                    if (err instanceof CloudAuthError) {
                        attempts.push({
                            flow: "login",
                            host: this.baseUrl,
                            ok: false,
                            status: err.code,
                            message: err.message,
                        });
                    }
                    else {
                        attempts.push({ flow: "login", host: this.baseUrl, ok: false, message: errorMessage(err) });
                    }
                }
            }
            if (probeToken) {
                this.token = probeToken;
                try {
                    const probeResult = await this._post(PROFILE_PROBE_PATH, { page: 1, page_size: 1 }, this.baseUrl);
                    const accepted = probeResult.status === "0";
                    attempts.push({
                        flow: "probe",
                        host: this.baseUrl,
                        ok: true,
                        status: probeResult.status,
                        message: probeResult.message,
                        profile: accepted ? "installer" : "home",
                    });
                }
                catch (err) {
                    attempts.push({ flow: "probe", host: this.baseUrl, ok: false, message: errorMessage(err) });
                }
            }
        }
        finally {
            this.baseUrl = startBase;
            this.token = savedToken;
            this.tokenTime = savedTokenTime;
            this.profile = savedProfile;
            this.lastDc = savedLastDc;
        }
        return attempts;
    }
    async ensureToken() {
        if (this.tokenRefreshPromise) {
            return this.tokenRefreshPromise;
        }
        if (!this.token || Date.now() - this.tokenTime > TOKEN_MAX_AGE_MS) {
            this.tokenRefreshPromise = withTimeout(this.login(), ENSURE_TOKEN_TIMEOUT_MS, "ensureToken")
                .then(() => { })
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
    disconnect() {
        this.token = null;
        this.profile = null;
    }
    async getStationList() {
        await this.ensureToken();
        const path = this.profile === "home" ? "/pvmc/api/0/station/select_by_page_c" : "/pvm/api/0/station/select_by_page";
        const result = await this._post(path, {
            page: 1,
            page_size: 100,
        });
        if (result.status !== "0") {
            throw new Error(`Station list failed: ${result.message}`);
        }
        const rawList = result.data?.list ?? [];
        return rawList.map(entry => {
            const id = typeof entry.id === "number" ? entry.id : typeof entry.sid === "number" ? entry.sid : 0;
            return { ...entry, id, name: typeof entry.name === "string" ? entry.name : "" };
        });
    }
    async getStationDetails(stationId) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const isHome = this.profile === "home";
        const path = isHome ? "/pvmc/api/0/station/find_c" : "/pvm/api/0/station/find";
        const body = isHome ? { sid: stationId } : { id: stationId };
        const result = await this._post(path, body);
        if (result.status !== "0") {
            throw new Error(`Station details failed: ${result.message}`);
        }
        return assertData(result.data, "Station details");
    }
    async getDeviceTree(stationId) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const isHome = this.profile === "home";
        const path = isHome ? "/pvmc/api/0/station/select_device_c" : "/pvm/api/0/station/select_device_of_tree";
        const body = isHome ? { sid: stationId } : { id: stationId };
        const result = await this._post(path, body);
        if (result.status !== "0") {
            throw new Error(`Device tree failed: ${result.message}`);
        }
        const raw = assertData(result.data ?? [], "Device tree");
        return isHome ? raw.map(node => normalizeHomeTreeNode(node)) : raw;
    }
    async getMicroRealtimeData(stationId, microIds, date, quotas) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const path = this.profile === "home"
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
        }
        catch (err) {
            this.log(`Micro chart error: ${err instanceof Error ? err.stack || err.message : errorMessage(err)}`);
            return null;
        }
    }
    _postBinary(apiPath, body) {
        return postBinary(new URL(apiPath, this.getDataHost()).href, body, {
            token: this.token,
            userAgent: this.getUserAgent(),
        });
    }
    async getModuleRealtimeData(stationId, microId, port, date, quotas) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const path = this.profile === "home"
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
        }
        catch (err) {
            this.log(`Module chart error: ${errorMessage(err)}`);
            return null;
        }
    }
    async getStationRealtime(stationId) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const path = this.profile === "home"
            ? "/pvmc/api/0/station_data/count_station_real_data_c"
            : "/pvm-data/api/0/station/data/count_station_real_data";
        const result = await this._post(path, { sid: stationId });
        if (result.status !== "0") {
            throw new Error(`Realtime data failed: ${result.message}`);
        }
        return assertData(result.data, "Realtime data");
    }
    async getWeather(lat, lon) {
        const result = await postJson(EU_WEATHER_URL, { lat, lon }, {
            token: this.token,
            userAgent: this.getUserAgent(),
        });
        if (result.status !== "0") {
            throw new Error(`Weather request failed: ${result.message}`);
        }
        return assertData(result.data, "Weather");
    }
    async checkFirmwareUpdate(stationId, dtuSn) {
        this.assertStationId(stationId);
        if (!dtuSn) {
            throw new Error("Invalid dtuSn");
        }
        await this.ensureToken();
        const isHome = this.profile === "home";
        const path = isHome ? "/pvmc/api/0/station/upgrade_compare_c" : "/pvm/api/0/upgrade/compare";
        const result = await this._post(path, { sid: stationId, dtu_sn: dtuSn });
        if (result.status !== "0") {
            throw new Error(`Firmware check failed: ${result.message}`);
        }
        const data = result.data;
        if (isHome) {
            const anyUpgrade = (data?.list ?? []).some(e => (e?.is_upgrade ?? 0) > 0);
            return { upgrade: anyUpgrade ? 1 : 0, done: 0, tid: data?.tid ?? "" };
        }
        return assertData(data ?? { upgrade: 0, done: 0, tid: "" }, "Firmware status");
    }
    _post(apiPath, body, hostOverride) {
        const url = new URL(apiPath, hostOverride ?? this.getDataHost()).href;
        return postJson(url, body, {
            token: this.token,
            userAgent: this.getUserAgent(),
        });
    }
}
export default CloudConnection;
//# sourceMappingURL=cloudConnection.js.map