import { postJson, postBinary } from "./httpClient.js";
import { parseChartResponse } from "./chartParser.js";
import { TOKEN_MAX_AGE_MS, ENSURE_TOKEN_TIMEOUT_MS, CLOUD_HOST_DEFAULT, CLOUD_HOST_EU, IAM_PRE_INSPECT_PATH, IAM_LOGIN_V3_PATH, IAM_REGION_PATH, IAM_LOGIN_V0_PATH, } from "./constants.js";
import { errorMessage, withTimeout, buildCredentialChallenges, buildArgon2Challenge } from "./utils.js";
const EU_WEATHER_URL = `${CLOUD_HOST_EU}/tpa/api/0/weather/get`;
function assertData(data, label) {
    if (data == null || typeof data !== "object") {
        throw new Error(`${label}: expected object, got ${typeof data}`);
    }
    return data;
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
    lastFlow;
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
        this.lastFlow = null;
        this.lastDc = null;
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    getLastFlow() {
        return this.lastFlow;
    }
    getLastDc() {
        return this.lastDc;
    }
    async login() {
        let v3AuthError = null;
        let lastTechError;
        this.log(`Cloud login start (host=${this.baseUrl}, user=${this.user})`);
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
        }
        catch (err) {
            if (err instanceof CloudAuthError) {
                v3AuthError = err;
                this.log(`Cloud login v3 rejected: status=${err.code} message="${err.message}" — trying v0 fallback`);
            }
            else {
                lastTechError = err;
                this.log(`Cloud login v3 transient error: ${errorMessage(err)} — trying v0 fallback`);
            }
        }
        await this.discoverRegion();
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
        }
        catch (err) {
            if (err instanceof CloudAuthError) {
                const combined = v3AuthError && v3AuthError.message !== err.message
                    ? `${err.message} (v0); v3 also rejected: ${v3AuthError.message}`
                    : err.message;
                this.log(`Cloud login v0 rejected: status=${err.code} message="${err.message}"`);
                throw new CloudAuthError(combined, err.code);
            }
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
    async tryLoginV3() {
        let lastTechError;
        for (const challenge of this.credentials) {
            try {
                const token = await this.tryLoginV3Challenge(challenge);
                if (token) {
                    return token;
                }
            }
            catch (err) {
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
    async tryLoginV3Challenge(challenge) {
        const preInsp = await this._post(IAM_PRE_INSPECT_PATH, { u: this.user });
        if (preInsp.status !== "0") {
            throw new CloudAuthError(preInsp.message || "Pre-inspect failed", preInsp.status);
        }
        const preData = assertData(preInsp.data, "Pre-inspect");
        const { n: nonce, a: salt } = preData;
        const ch = salt ? await buildArgon2Challenge(this.credentialInput, salt) : challenge;
        const result = await this._post(IAM_LOGIN_V3_PATH, {
            u: this.user,
            ch,
            n: nonce,
        });
        if (result.status !== "0") {
            throw new CloudAuthError(result.message || "Login rejected", result.status);
        }
        return result.data?.token ?? null;
    }
    async discoverRegion() {
        try {
            const result = await this._post(IAM_REGION_PATH, { email: this.user });
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
    async tryLoginV0() {
        const password = this.credentials[0];
        this.log(`Cloud login v0: POST ${IAM_LOGIN_V0_PATH} on ${this.baseUrl}`);
        const result = await this._post(IAM_LOGIN_V0_PATH, {
            user_name: this.user,
            password,
        });
        if (result.status !== "0") {
            throw new CloudAuthError(result.message || "Login rejected (v0)", result.status);
        }
        return result.data?.token ?? null;
    }
    async loginDiagnostics() {
        const attempts = [];
        const startBase = this.baseUrl;
        const savedToken = this.token;
        const savedTokenTime = this.tokenTime;
        const savedLastFlow = this.lastFlow;
        const savedLastDc = this.lastDc;
        try {
            const regionResult = await this._post(IAM_REGION_PATH, { email: this.user });
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
        }
        catch (err) {
            attempts.push({ flow: "region", host: startBase, ok: false, message: errorMessage(err) });
        }
        try {
            const token = await this.tryLoginV3();
            attempts.push({ flow: "v3", host: this.baseUrl, ok: !!token, hasToken: !!token });
        }
        catch (err) {
            if (err instanceof CloudAuthError) {
                attempts.push({
                    flow: "v3",
                    host: this.baseUrl,
                    ok: false,
                    status: err.code,
                    message: err.message,
                });
            }
            else {
                attempts.push({ flow: "v3", host: this.baseUrl, ok: false, message: errorMessage(err) });
            }
        }
        try {
            const token = await this.tryLoginV0();
            attempts.push({ flow: "v0", host: this.baseUrl, ok: !!token, hasToken: !!token });
        }
        catch (err) {
            if (err instanceof CloudAuthError) {
                attempts.push({
                    flow: "v0",
                    host: this.baseUrl,
                    ok: false,
                    status: err.code,
                    message: err.message,
                });
            }
            else {
                attempts.push({ flow: "v0", host: this.baseUrl, ok: false, message: errorMessage(err) });
            }
        }
        this.baseUrl = startBase;
        this.token = savedToken;
        this.tokenTime = savedTokenTime;
        this.lastFlow = savedLastFlow;
        this.lastDc = savedLastDc;
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
        this.lastFlow = null;
    }
    async getStationList() {
        await this.ensureToken();
        const result = await this._post("/pvm/api/0/station/select_by_page", {
            page: 1,
            page_size: 100,
        });
        if (result.status !== "0") {
            throw new Error(`Station list failed: ${result.message}`);
        }
        return result.data?.list || [];
    }
    async getStationDetails(stationId) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const result = await this._post("/pvm/api/0/station/find", { id: stationId });
        if (result.status !== "0") {
            throw new Error(`Station details failed: ${result.message}`);
        }
        return assertData(result.data, "Station details");
    }
    async getDeviceTree(stationId) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const result = await this._post("/pvm/api/0/station/select_device_of_tree", {
            id: stationId,
        });
        if (result.status !== "0") {
            throw new Error(`Device tree failed: ${result.message}`);
        }
        return assertData(result.data ?? [], "Device tree");
    }
    async getMicroRealtimeData(stationId, microIds, date, quotas) {
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
        }
        catch (err) {
            this.log(`Micro chart error: ${err instanceof Error ? err.stack || err.message : errorMessage(err)}`);
            return null;
        }
    }
    _postBinary(apiPath, body) {
        return postBinary(new URL(apiPath, this.baseUrl).href, body, { token: this.token });
    }
    async getModuleRealtimeData(stationId, microId, port, date, quotas) {
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
        }
        catch (err) {
            this.log(`Module chart error: ${errorMessage(err)}`);
            return null;
        }
    }
    async getStationRealtime(stationId) {
        this.assertStationId(stationId);
        await this.ensureToken();
        const result = await this._post("/pvm-data/api/0/station/data/count_station_real_data", {
            sid: stationId,
        });
        if (result.status !== "0") {
            throw new Error(`Realtime data failed: ${result.message}`);
        }
        return assertData(result.data, "Realtime data");
    }
    async getWeather(lat, lon) {
        const result = await postJson(EU_WEATHER_URL, { lat, lon }, {
            token: this.token,
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
        const result = await this._post("/pvm/api/0/upgrade/compare", {
            sid: stationId,
            dtu_sn: dtuSn,
        });
        if (result.status !== "0") {
            throw new Error(`Firmware check failed: ${result.message}`);
        }
        return assertData(result.data ?? { upgrade: 0, done: 0, tid: "" }, "Firmware status");
    }
    _post(apiPath, body) {
        return postJson(new URL(apiPath, this.baseUrl).href, body, { token: this.token });
    }
}
export default CloudConnection;
//# sourceMappingURL=cloudConnection.js.map