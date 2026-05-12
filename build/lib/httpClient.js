import * as https from "node:https";
import { HTTP_REQUEST_TIMEOUT_MS, HTTP_AGENT_TIMEOUT_MS } from "./constants.js";
const REQUEST_TIMEOUT = HTTP_REQUEST_TIMEOUT_MS;
let agent = new https.Agent({ keepAlive: true, maxSockets: 5, timeout: HTTP_AGENT_TIMEOUT_MS });
function initAgent(options) {
    agent.destroy();
    agent = new https.Agent({
        keepAlive: true,
        maxSockets: options?.maxSockets ?? 5,
        timeout: HTTP_AGENT_TIMEOUT_MS,
    });
}
function postJson(url, body, options) {
    return request(url, body, options, "json");
}
function postBinary(url, body, options) {
    return request(url, body, options, "binary");
}
function request(url, body, options, responseType) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const ok = (val) => {
            if (!settled) {
                settled = true;
                resolve(val);
            }
        };
        const fail = (err) => {
            if (!settled) {
                settled = true;
                reject(err);
            }
        };
        const data = JSON.stringify(body);
        const parsed = new URL(url);
        const headers = {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
        };
        if (options?.token) {
            headers.Authorization = options.token;
        }
        if (options?.userAgent) {
            headers["User-Agent"] = options.userAgent;
        }
        const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname,
            method: "POST",
            agent,
            headers,
        };
        const req = https.request(reqOptions, res => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                if (res.statusCode && res.statusCode >= 400) {
                    fail(new Error(`HTTP ${res.statusCode} on ${url}`));
                    return;
                }
                const buf = Buffer.concat(chunks);
                if (responseType === "binary") {
                    ok(buf);
                }
                else {
                    try {
                        ok(JSON.parse(buf.toString()));
                    }
                    catch {
                        fail(new Error(`Invalid JSON (HTTP ${res.statusCode}) from ${url}: ${buf.toString().substring(0, 200)}`));
                    }
                }
            });
        });
        req.on("error", (err) => fail(err));
        req.setTimeout(REQUEST_TIMEOUT, () => {
            req.destroy();
            fail(new Error(`Timeout on ${url}`));
        });
        req.write(data);
        req.end();
    });
}
function destroyAgent() {
    agent.destroy();
}
export { postJson, postBinary, destroyAgent, initAgent };
//# sourceMappingURL=httpClient.js.map