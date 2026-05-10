#!/usr/bin/env node
// Standalone smoke-test for the Hoymiles cloud login flows.
//
// Usage:
//   CLOUD_USER=you@example.com CLOUD_PASS=yourpassword node scripts/test-cloud-login.mjs
//
// Runs region_c → v3 → v0 against neapi.hoymiles.com (and follows region_c
// redirects to a different regional host if the server returns one).
// Reports which flow accepts the credentials and, when at least one flow
// produced a token, also dumps the station list as a sanity check.
//
// No write actions, no token persistence — purely diagnostic. Safe to run
// against a real account; the password is hashed locally before transmission
// (same code path as the adapter).

import CloudConnection from "../build/lib/cloudConnection.js";

const user = process.env.CLOUD_USER;
const password = process.env.CLOUD_PASS;
if (!user || !password) {
	console.error("ERROR: CLOUD_USER and CLOUD_PASS environment variables are required.");
	console.error("Example:");
	console.error("  CLOUD_USER=you@example.com CLOUD_PASS=yourpassword node scripts/test-cloud-login.mjs");
	process.exit(2);
}

const log = (msg) => console.log(`[debug] ${msg}`);

async function main() {
	console.log(`==> Diagnosing cloud login for ${user} ...`);
	const cloud = new CloudConnection(user, password, log);

	const results = await cloud.loginDiagnostics();
	console.log("\n==> Per-flow results:");
	for (const r of results) {
		const head = `${r.flow.padEnd(7)} @ ${new URL(r.host).host}`;
		if (r.flow === "region") {
			console.log(
				r.ok
					? `  ${head}  OK     dc=${r.dc ?? "n/a"}`
					: `  ${head}  FAIL   ${r.status ? `status=${r.status} ` : ""}${r.message ?? ""}`,
			);
		} else {
			console.log(
				r.ok
					? `  ${head}  ACCEPTED — token received`
					: `  ${head}  rejected ${r.status ? `status=${r.status} ` : ""}${r.message ?? ""}`,
			);
		}
	}

	const accepted = results.find((r) => (r.flow === "v3" || r.flow === "v0") && r.ok);
	if (!accepted) {
		console.error("\nNeither v3 nor v0 accepted the credentials. Cloud login is not possible with this account.");
		process.exit(1);
	}

	// At least one flow worked — promote to a real login so we can fetch stations
	// as an end-to-end sanity check (data API is the same for both flows).
	console.log(`\n==> ${accepted.flow.toUpperCase()} accepted the account. Fetching station list to verify data API ...`);
	try {
		await cloud.login();
		const stations = await cloud.getStationList();
		console.log(`    found ${stations.length} station(s):`);
		for (const s of stations) {
			console.log(`      • #${s.id}  ${s.name ?? "(unnamed)"}`);
		}
	} catch (err) {
		console.error(`    station list call failed: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}

	console.log("\nAll good. Both authentication and the data API work for this account.");
}

main().catch((err) => {
	console.error(`\nUnexpected error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
	process.exit(1);
});
