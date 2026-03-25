"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const crypto = __importStar(require("node:crypto"));
const https = __importStar(require("node:https"));
const BASE_URL = "https://neapi.hoymiles.com";
class CloudConnection {
    token;
    user;
    password;
    tokenTime;
    constructor(user, password) {
        this.user = user;
        this.password = password;
        this.token = null;
        this.tokenTime = 0;
    }
    // --- Auth ---
    async login() {
        // Step 1: Pre-inspect to get nonce and salt
        const preInsp = (await this._post("/iam/pub/3/auth/pre-insp", { u: this.user }));
        if (preInsp.status !== "0") {
            throw new Error(`Pre-inspect failed: ${preInsp.message}`);
        }
        const { n: nonce, a: salt } = preInsp.data;
        // Step 2: Compute credential hash
        let ch;
        if (salt) {
            // Argon2 would be needed here - not implemented yet
            throw new Error("Argon2 authentication not supported yet (salt is set). Please report this.");
        }
        else {
            // No salt: use md5.sha256_base64 format
            const md5Hex = crypto.createHash("md5").update(this.password).digest("hex");
            const sha256B64 = crypto.createHash("sha256").update(this.password).digest("base64");
            ch = `${md5Hex}.${sha256B64}`;
        }
        // Step 3: Login
        const loginResult = (await this._post("/iam/pub/3/auth/login", {
            u: this.user,
            ch: ch,
            n: nonce,
        }));
        if (loginResult.status !== "0" || !loginResult.data || !loginResult.data.token) {
            // Retry with sha256 hex only (candidate 2)
            const preInsp2 = (await this._post("/iam/pub/3/auth/pre-insp", { u: this.user }));
            const nonce2 = preInsp2.data.n;
            const sha256Hex = crypto.createHash("sha256").update(this.password).digest("hex");
            const loginResult2 = (await this._post("/iam/pub/3/auth/login", {
                u: this.user,
                ch: sha256Hex,
                n: nonce2,
            }));
            if (loginResult2.status !== "0" || !loginResult2.data || !loginResult2.data.token) {
                throw new Error(`Login failed: ${loginResult2.message || "unknown error"}`);
            }
            this.token = loginResult2.data.token;
        }
        else {
            this.token = loginResult.data.token;
        }
        this.tokenTime = Date.now();
        return this.token;
    }
    async ensureToken() {
        // Re-login if token is older than 1 hour
        if (!this.token || Date.now() - this.tokenTime > 3600000) {
            await this.login();
        }
    }
    disconnect() {
        this.token = null;
    }
    // --- Data endpoints ---
    async getStationList() {
        await this.ensureToken();
        const result = (await this._post("/pvm/api/0/station/select_by_page", {
            page: 1,
            page_size: 100,
        }));
        if (result.status !== "0") {
            throw new Error(`Station list failed: ${result.message}`);
        }
        return result.data.list || [];
    }
    async getStationDetails(stationId) {
        await this.ensureToken();
        const result = await this._post("/pvm/api/0/station/find", { id: stationId });
        if (result.status !== "0") {
            throw new Error(`Station details failed: ${result.message}`);
        }
        return (result.data || {});
    }
    async getDeviceTree(stationId) {
        await this.ensureToken();
        const result = await this._post("/pvm/api/0/station/select_device_of_tree", {
            id: stationId,
        });
        if (result.status !== "0") {
            throw new Error(`Device tree failed: ${result.message}`);
        }
        return (result.data || []);
    }
    async getStationRealtime(stationId) {
        await this.ensureToken();
        const result = await this._post("/pvm-data/api/0/station/data/count_station_real_data", {
            sid: stationId,
        });
        if (result.status !== "0") {
            throw new Error(`Realtime data failed: ${result.message}`);
        }
        return result.data;
    }
    // --- HTTP helpers ---
    _post(path, body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const url = new URL(path, BASE_URL);
            const options = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(data),
                },
            };
            if (this.token) {
                options.headers.Authorization = this.token;
            }
            const req = https.request(options, res => {
                let responseBody = "";
                res.on("data", (chunk) => (responseBody += chunk));
                res.on("end", () => {
                    try {
                        const parsed = JSON.parse(responseBody);
                        resolve(parsed);
                    }
                    catch {
                        reject(new Error(`Invalid JSON response from ${path}: ${responseBody.substring(0, 200)}`));
                    }
                });
            });
            req.on("error", reject);
            req.setTimeout(15000, () => {
                req.destroy();
                reject(new Error(`Timeout on ${path}`));
            });
            req.write(data);
            req.end();
        });
    }
}
module.exports = CloudConnection;
//# sourceMappingURL=cloudConnection.js.map