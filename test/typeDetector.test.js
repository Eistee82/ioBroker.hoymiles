import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// `@iobroker/type-detector` is a CJS package without an `exports` map, so the
// default import lands on the namespace object (with the actual class on
// `.default`). Unwrap once to get the constructor.
import detectorModule, { Types } from "@iobroker/type-detector";
const ChannelDetector = detectorModule.default ?? detectorModule;
import { channels, states, stationChannels, stationStates } from "../build/lib/stateDefinitions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const enWords = JSON.parse(readFileSync(join(__dirname, "..", "src", "lib", "i18n", "en.json"), "utf8"));

function makeObject(id, type, common, native) {
	return { _id: id, type, common, native: native ?? {} };
}

// Resolve the state name from our i18n key like the runtime adapter would.
function resolveName(nameKey) {
	return enWords[nameKey] ?? nameKey;
}

// Build a state common-object the way deviceContext / cloudManager do.
// Fills the `read`/`write`/`def` defaults that they apply at runtime.
function commonForState(def) {
	return {
		name: resolveName(def.nameKey),
		type: def.type,
		role: def.role,
		unit: def.unit ?? "",
		read: true,
		write: def.write ?? false,
		def: def.type === "boolean" ? false : def.type === "number" ? 0 : "",
		min: def.min,
		max: def.max,
		states: def.states,
	};
}

function buildDtuObjects(serial) {
	const objs = {};
	objs[serial] = makeObject(serial, "device", {
		name: `Hoymiles DTU ${serial}`,
		statusStates: { onlineId: "info.connected" },
		icon: "hoymiles.png",
	});
	for (const ch of channels) {
		objs[`${serial}.${ch.id}`] = makeObject(`${serial}.${ch.id}`, "channel", { name: resolveName(ch.nameKey) });
	}
	for (const def of states) {
		objs[`${serial}.${def.id}`] = makeObject(`${serial}.${def.id}`, "state", commonForState(def));
	}
	return objs;
}

function buildStationObjects(stationId) {
	const id = `station-${stationId}`;
	const objs = {};
	objs[id] = makeObject(id, "device", {
		name: `Test station ${stationId}`,
		statusStates: { onlineId: "info.stationStatus" },
		icon: "hoymiles.png",
	});
	for (const ch of stationChannels) {
		objs[`${id}.${ch.id}`] = makeObject(`${id}.${ch.id}`, "channel", { name: resolveName(ch.nameKey) });
	}
	for (const def of stationStates) {
		objs[`${id}.${def.id}`] = makeObject(`${id}.${def.id}`, "state", commonForState(def));
	}
	return objs;
}

function detect(objects, id) {
	const detector = new ChannelDetector();
	return detector.detect({ objects, id, ignoreCache: true }) ?? [];
}

/**
 * Pull the parent channel id (everything except the last dot-segment) from a state id.
 *
 * @param stateId Full state id, e.g. `TEST1234.inverter.powerLimit`
 */
function parentChannel(stateId) {
	const i = stateId.lastIndexOf(".");
	return i === -1 ? stateId : stateId.slice(0, i);
}

/**
 * Find a detected pattern of `type` whose primary state lives under a channel ending in `channelSuffix`.
 *
 * @param result Array returned by `ChannelDetector.detect`
 * @param type Expected `Types` enum value
 * @param channelSuffix Suffix the parent channel must end with (e.g. `.inverter`)
 */
function findDetected(result, type, channelSuffix) {
	return result.find(p => p.type === type && p.states.some(s => parentChannel(s.id).endsWith(channelSuffix)));
}

function summarise(result) {
	return result.map(p => `${p.type}[${p.states.map(s => s.id).join(",")}]`).join(" | ");
}

describe("type-detector — per-DTU device", function () {
	const serial = "TEST1234";
	const objects = buildDtuObjects(serial);
	const result = detect(objects, serial);
	const detectedTypes = new Set(result.map(r => r.type));

	it("detects at least one device-type from the DTU object tree", function () {
		assert.ok(result.length > 0, `expected detection, got 0 patterns. types: ${[...detectedTypes].join(",")}`);
	});

	it("detects 'percentage' for inverter.powerLimit (level + unit %)", function () {
		const pct = findDetected(result, Types.percentage, ".inverter");
		assert.ok(pct, `expected percentage on .inverter; got: ${summarise(result)}`);
	});

	it("does NOT detect 'thermostat' or 'dimmer' (sanity check)", function () {
		assert.ok(!detectedTypes.has(Types.thermostat), "unexpected: thermostat detected");
		assert.ok(!detectedTypes.has(Types.dimmer), "unexpected: dimmer detected");
	});
});

describe("type-detector — per-station device", function () {
	const objects = buildStationObjects(1);
	const result = detect(objects, "station-1");

	it("detects 'weatherCurrent' for the .weather channel (icon + temperature)", function () {
		const w = findDetected(result, Types.weatherCurrent, ".weather");
		assert.ok(w, `expected weatherCurrent on .weather; got: ${summarise(result)}`);
	});

	it("detects 'location' for the .info channel (gps.latitude + gps.longitude)", function () {
		const loc = findDetected(result, Types.location, ".info");
		assert.ok(loc, `expected location on .info; got: ${summarise(result)}`);
	});
});

describe("type-detector — patterns sanity", function () {
	it("type-detector exports the device-types our adapter relies on", function () {
		assert.strictEqual(Types.weatherCurrent, "weatherCurrent");
		assert.strictEqual(Types.location, "location");
		assert.strictEqual(Types.percentage, "percentage");
		// The slider pattern is named `levelSlider` internally but exposed via the `slider` enum entry.
		assert.strictEqual(Types.slider, "slider");
	});
});
