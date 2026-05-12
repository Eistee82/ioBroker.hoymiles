#!/usr/bin/env node
// Standalone smoke-test for the Hoymiles cloud login flows.
//
// Usage:
//   CLOUD_USER=you@example.com CLOUD_PASS=yourpassword node scripts/test-cloud-login.mjs
//
// Runs region_c → pre-insp → v3 login → profile probe against neapi.hoymiles.com
// (and follows region_c redirects to a different regional host if the server
// returns one). Reports each phase and, when login produced a token, also dumps
// the station list as a sanity check.
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
	console.log("\n==> Per-phase results:");
	for (const r of results) {
		const head = `${r.flow.padEnd(8)} @ ${new URL(r.host).host}`;
		if (r.flow === "region") {
			console.log(
				r.ok
					? `  ${head}  OK    dc=${r.dc ?? "n/a"}`
					: `  ${head}  FAIL  ${r.status ? `status=${r.status} ` : ""}${r.message ?? ""}`,
			);
		} else if (r.flow === "preInsp") {
			console.log(
				r.ok
					? `  ${head}  OK    v=${r.v ?? "?"} salt=${r.saltPresent ? "yes" : "no"}`
					: `  ${head}  FAIL  ${r.status ? `status=${r.status} ` : ""}${r.message ?? ""}`,
			);
		} else if (r.flow === "probe") {
			console.log(
				r.ok
					? `  ${head}  OK    profile=${r.profile ?? "?"}${r.status ? ` (status=${r.status})` : ""}`
					: `  ${head}  FAIL  ${r.message ?? ""}`,
			);
		} else {
			console.log(
				r.ok
					? `  ${head}  ACCEPTED — token received`
					: `  ${head}  rejected ${r.status ? `status=${r.status} ` : ""}${r.message ?? ""}`,
			);
		}
	}

	const accepted = results.find((r) => r.flow === "login" && r.ok);
	if (!accepted) {
		console.error("\nLogin did not produce a token — see per-phase summary above.");
		process.exit(1);
	}

	// Login succeeded — promote to a real login so we can fetch stations as an end-to-end sanity check.
	console.log(`\n==> Login phase accepted. Now running a real login + station list ...`);
	try {
		await cloud.login();
		console.log(`    real login profile=${cloud.getProfile() ?? "?"} dc=${cloud.getLastDc() ?? "n/a"}`);
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
