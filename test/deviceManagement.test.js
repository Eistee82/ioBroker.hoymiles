import assert from "node:assert";
import {
	DM_I18N,
	REQUIRED_LANGS,
	COMMAND_DEFS,
	SETTINGS_SCHEMA,
	buildControls,
	buildDeviceActions,
	buildDtuDeviceInfo,
	buildStationDeviceInfo,
	buildDeviceDetails,
	buildInstanceInfo,
	classifyDevice,
	isLocalDevice,
} from "../build/lib/deviceManagement.js";
import { WRITABLE_STATES } from "../build/lib/deviceContext.js";
import { inverterIcon } from "../build/lib/deviceIcons.js";

/**
 * Minimal adapter mock recording setState calls; getState/getForeignObject return preset maps.
 *
 * @param {object} states - Map of relative state id to ioBroker.State for getStateAsync.
 * @param {object} objs - Map of full object id to ioBroker.Object for getForeignObjectAsync.
 */
function makeMock(states = {}, objs = {}) {
	const setCalls = [];
	return {
		namespace: "hoymiles.0",
		setCalls,
		log: { info() {}, warn() {}, debug() {}, error() {} },
		async getStateAsync(id) {
			return id in states ? states[id] : null;
		},
		async setStateAsync(id, val, ack) {
			setCalls.push({ id, val, ack });
			return id;
		},
		async getForeignObjectAsync(id) {
			return id in objs ? objs[id] : null;
		},
		async getForeignObjectsAsync() {
			return {};
		},
		async dmScanNetwork() {
			return "scan-result";
		},
		async dmTestCloudLogin() {
			return "cloud-result";
		},
	};
}

// ============================================================
// deviceManagement – i18n completeness (11 mandatory languages)
// ============================================================
describe("deviceManagement – DM_I18N", function () {
	it("covers all 11 mandatory languages, non-empty, for every key", function () {
		assert.strictEqual(REQUIRED_LANGS.length, 11);
		for (const [key, translated] of Object.entries(DM_I18N)) {
			const langs = Object.keys(translated);
			assert.strictEqual(langs.length, REQUIRED_LANGS.length, `"${key}" has ${langs.length} languages`);
			for (const lang of REQUIRED_LANGS) {
				assert.strictEqual(typeof translated[lang], "string", `"${key}.${lang}" is not a string`);
				assert.ok(translated[lang].length > 0, `"${key}.${lang}" is empty`);
			}
		}
	});
});

// ============================================================
// deviceManagement – COMMAND_DEFS drift guard vs WRITABLE_STATES
// ============================================================
describe("deviceManagement – COMMAND_DEFS", function () {
	it("covers exactly the writable states (no drift)", function () {
		const cmdIds = COMMAND_DEFS.map(d => d.id).sort();
		const writable = [...WRITABLE_STATES].sort();
		assert.deepStrictEqual(cmdIds, writable);
	});

	it("every command label resolves to a translation", function () {
		for (const d of COMMAND_DEFS) {
			assert.ok(DM_I18N[d.label], `command "${d.id}" label "${d.label}" missing in DM_I18N`);
		}
	});
});

// ============================================================
// deviceManagement – device classification
// ============================================================
describe("deviceManagement – classifyDevice / isLocalDevice", function () {
	it("classifies a local DTU by native.host", function () {
		assert.strictEqual(classifyDevice({ native: { host: "192.168.1.5" } }), "dtu");
		assert.strictEqual(isLocalDevice({ native: { host: "192.168.1.5" } }), true);
	});

	it("classifies a cloud-only DTU (empty host) as dtu but not local", function () {
		assert.strictEqual(classifyDevice({ native: { host: "" } }), "dtu");
		assert.strictEqual(isLocalDevice({ native: { host: "" } }), false);
	});

	it("classifies a station by native.stationId", function () {
		assert.strictEqual(classifyDevice({ native: { stationId: 42 } }), "station");
	});

	it("returns null for unrelated objects", function () {
		assert.strictEqual(classifyDevice({ native: {} }), null);
	});
});

// ============================================================
// deviceManagement – controls (local vs cloud-only)
// ============================================================
describe("deviceManagement – buildControls", function () {
	it("offers all stateful controls for a local device", function () {
		const controls = buildControls(makeMock(), "SN1", true);
		const ids = controls.map(c => c.id);
		assert.ok(ids.includes("inverter.powerLimit"));
		assert.ok(ids.includes("inverter.active"));
		assert.ok(ids.includes("inverter.lock"));
		assert.ok(ids.includes("config.serverSendTime"));
		assert.ok(ids.includes("config.limitPowerMyPower"));
		// Momentary commands are actions, not controls.
		assert.ok(!ids.includes("inverter.reboot"));
	});

	it("offers only cloud-capable controls for a cloud-only device", function () {
		const controls = buildControls(makeMock(), "SN2", false);
		const ids = controls.map(c => c.id);
		assert.deepStrictEqual(ids, ["inverter.active"]);
	});

	it("uses full namespace-prefixed stateId for the GUI binding", function () {
		const controls = buildControls(makeMock(), "SN1", true);
		const active = controls.find(c => c.id === "inverter.active");
		assert.strictEqual(active.stateId, "hoymiles.0.SN1.inverter.active");
	});

	it("control handler writes the underlying state with ack=false", async function () {
		const mock = makeMock({ "SN1.inverter.powerLimit": { val: 50, ack: false } });
		const controls = buildControls(mock, "SN1", true);
		const powerLimit = controls.find(c => c.id === "inverter.powerLimit");
		await powerLimit.handler("SN1", "inverter.powerLimit", 50);
		assert.deepStrictEqual(mock.setCalls, [{ id: "SN1.inverter.powerLimit", val: 50, ack: false }]);
	});
});

// ============================================================
// deviceManagement – actions (reboot buttons + settings form)
// ============================================================
describe("deviceManagement – buildDeviceActions", function () {
	it("offers reboot/clean actions plus settings for a local device", function () {
		const actions = buildDeviceActions(makeMock(), "SN1", true);
		const ids = actions.map(a => a.id);
		assert.ok(ids.includes("inverter.reboot"));
		assert.ok(ids.includes("dtu.reboot"));
		assert.ok(ids.includes("inverter.cleanWarnings"));
		assert.ok(ids.includes("settings"));
	});

	it("offers only cloud-capable actions and no settings for a cloud-only device", function () {
		const actions = buildDeviceActions(makeMock(), "SN2", false);
		const ids = actions.map(a => a.id).sort();
		assert.deepStrictEqual(ids, ["dtu.reboot", "inverter.reboot"]);
	});

	it("reboot action writes true with ack=false", async function () {
		const mock = makeMock();
		const actions = buildDeviceActions(mock, "SN1", true);
		const reboot = actions.find(a => a.id === "inverter.reboot");
		const res = await reboot.handler("SN1", {});
		assert.deepStrictEqual(res, { refresh: "none" });
		assert.deepStrictEqual(mock.setCalls, [{ id: "SN1.inverter.reboot", val: true, ack: false }]);
	});

	it("settings action persists the values the form returns", async function () {
		const mock = makeMock();
		const actions = buildDeviceActions(mock, "SN1", true);
		const settings = actions.find(a => a.id === "settings");
		const context = { showForm: async () => ({ serverSendTime: 10, limitPowerMyPower: 80 }) };
		await settings.handler("SN1", context);
		assert.deepStrictEqual(mock.setCalls, [
			{ id: "SN1.config.serverSendTime", val: 10, ack: false },
			{ id: "SN1.config.limitPowerMyPower", val: 80, ack: false },
		]);
	});

	it("settings action writes nothing when the form is cancelled", async function () {
		const mock = makeMock();
		const actions = buildDeviceActions(mock, "SN1", true);
		const settings = actions.find(a => a.id === "settings");
		const context = { showForm: async () => undefined };
		await settings.handler("SN1", context);
		assert.strictEqual(mock.setCalls.length, 0);
	});
});

// ============================================================
// deviceManagement – DeviceInfo mapping
// ============================================================
describe("deviceManagement – buildDtuDeviceInfo", function () {
	it("maps a local DTU with live status bindings, controls and actions", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.strictEqual(info.id, "SN1");
		assert.strictEqual(info.hasDetails, true);
		assert.strictEqual(info.status.connection.stateId, "hoymiles.0.SN1.info.connected");
		assert.strictEqual(info.status.rssi.stateId, "hoymiles.0.SN1.dtu.rssi");
		assert.ok(info.controls.length > 1);
		assert.ok(info.actions.length > 1);
		// An `update` field (bound to the firmware-update state) keeps the DM's "only updatable"
		// toggle button visible so that global filter can always be switched off again.
		assert.strictEqual(info.update.available.stateId, "hoymiles.0.SN1.dtu.fwUpdateAvailable");
	});

	it("shows grid power/energy, one line per existing PV string and temperature on the card", async function () {
		// This inverter has two strings: pv0/pv1 states exist, pv2+ do not.
		const mock = makeMock({
			"SN1.pv0.power": { val: 120 },
			"SN1.pv1.power": { val: 95 },
		});
		const info = await buildDtuDeviceInfo(mock, "SN1", { native: { host: "1.2.3.4" }, common: {} });
		const items = info.customInfo.schema.items;
		assert.strictEqual(items.gridPower.type, "state");
		assert.strictEqual(items.gridPower.oid, "hoymiles.0.SN1.grid.power");
		assert.strictEqual(items.gridPower.foreign, true);
		assert.strictEqual(items.gridDailyEnergy.oid, "hoymiles.0.SN1.grid.dailyEnergy");
		assert.strictEqual(items.pv0Power.oid, "hoymiles.0.SN1.pv0.power");
		assert.strictEqual(items.pv0Power.label.en, "String 1");
		assert.strictEqual(items.pv1Power.oid, "hoymiles.0.SN1.pv1.power");
		assert.strictEqual(items.pv2Power, undefined);
		assert.strictEqual(items.temperature.oid, "hoymiles.0.SN1.inverter.temperature");
		assert.strictEqual(items.temperature.unit, "°C");
	});

	it("adds no PV string lines when the inverter has none", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		const stringItems = Object.keys(info.customInfo.schema.items).filter(k => k.startsWith("pv"));
		assert.strictEqual(stringItems.length, 0);
	});

	it("falls back to the serial when no model name is known", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.strictEqual(info.name, "SN1");
	});

	it("uses the cloud model name in the title when available", async function () {
		const mock = makeMock({ "SN1.inverter.model": { val: "HMS-2000-4WB", ack: true } });
		const info = await buildDtuDeviceInfo(mock, "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.strictEqual(info.name, "HMS-2000-4WB (SN1)");
	});

	it("names the inverter after its station (the app name) plus the DTU serial", async function () {
		const info = await buildDtuDeviceInfo(
			makeMock(),
			"SN1",
			{ native: { host: "1.2.3.4" }, common: {} },
			"Zuhause",
		);
		assert.strictEqual(info.name, "Zuhause · SN1");
	});

	it("omits rssi and local-only controls for a cloud-only DTU", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN2", { native: { host: "" }, common: {} });
		assert.strictEqual(info.status.rssi, undefined);
		assert.deepStrictEqual(
			info.controls.map(c => c.id),
			["inverter.active"],
		);
	});
});

describe("deviceManagement – buildStationDeviceInfo", function () {
	it("maps a station with status binding and no controls", function () {
		const info = buildStationDeviceInfo(makeMock(), "station-5", {
			native: { stationId: 5 },
			common: { name: "My Plant" },
		});
		assert.strictEqual(info.id, "station-5");
		assert.strictEqual(info.name, "My Plant");
		assert.strictEqual(info.status.connection.stateId, "hoymiles.0.station-5.info.stationStatus");
		assert.strictEqual(info.controls, undefined);
		assert.strictEqual(info.hasDetails, true);
	});

	it("shows live power and daily energy on the station card via customInfo", function () {
		const info = buildStationDeviceInfo(makeMock(), "station-5", {
			native: { stationId: 5 },
			common: { name: "My Plant" },
		});
		assert.strictEqual(info.customInfo.schema.items.gridPower.oid, "hoymiles.0.station-5.grid.power");
		assert.strictEqual(info.customInfo.schema.items.gridDailyEnergy.oid, "hoymiles.0.station-5.grid.dailyEnergy");
	});
});

// ============================================================
// deviceManagement – details panel
// ============================================================
describe("deviceManagement – buildDeviceDetails", function () {
	it("builds a DTU details panel with inverter/DTU fields", async function () {
		const mock = makeMock({}, { "hoymiles.0.SN1": { native: { host: "1.2.3.4" }, common: {} } });
		const details = await buildDeviceDetails(mock, "SN1");
		assert.strictEqual(details.id, "SN1");
		assert.strictEqual(details.schema.type, "panel");
		assert.ok(details.schema.items.model);
		assert.ok(details.schema.items.dtuSerial);
	});

	it("builds a station details panel with plant fields", async function () {
		const mock = makeMock({}, { "hoymiles.0.station-5": { native: { stationId: 5 }, common: {} } });
		const details = await buildDeviceDetails(mock, "station-5");
		assert.ok(details.schema.items.capacity);
		assert.ok(details.schema.items.status);
	});

	it("returns an error object when the device is unknown", async function () {
		const details = await buildDeviceDetails(makeMock(), "missing");
		assert.ok(details.error);
	});
});

// ============================================================
// deviceManagement – instance actions
// ============================================================
describe("deviceManagement – buildInstanceInfo", function () {
	it("declares api v3 and the discover/test actions (no custom refresh — the DM has one)", function () {
		const info = buildInstanceInfo(makeMock());
		assert.strictEqual(info.apiVersion, "v3");
		assert.deepStrictEqual(info.actions.map(a => a.id).sort(), ["discover", "testCloud"]);
	});

	it("gives the slow scan/cloud actions a generous backend timeout", function () {
		const info = buildInstanceInfo(makeMock());
		const discover = info.actions.find(a => a.id === "discover");
		const testCloud = info.actions.find(a => a.id === "testCloud");
		assert.ok(discover.timeout >= 60000, "discover needs a long timeout for the subnet scan");
		assert.ok(testCloud.timeout >= 30000, "testCloud needs a long timeout for login diagnostics");
	});

	it("discover action shows the scan result and reloads", async function () {
		const info = buildInstanceInfo(makeMock());
		let shown;
		const ctx = {
			showMessage: async m => {
				shown = m;
			},
		};
		const res = await info.actions.find(a => a.id === "discover").handler(ctx);
		assert.strictEqual(shown, "scan-result");
		assert.deepStrictEqual(res, { refresh: true });
	});

	it("test-cloud action shows the diagnostics summary without reloading", async function () {
		const info = buildInstanceInfo(makeMock());
		let shown;
		const ctx = {
			showMessage: async m => {
				shown = m;
			},
		};
		const res = await info.actions.find(a => a.id === "testCloud").handler(ctx);
		assert.strictEqual(shown, "cloud-result");
		assert.deepStrictEqual(res, { refresh: false });
	});
});

// ============================================================
// deviceManagement – device icons
// ============================================================
describe("deviceManagement – icons", function () {
	it("uses self-contained PNG data-URI icons", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.ok(info.icon.startsWith("data:image/png;base64,"));
	});

	it("picks a distinct icon for three-phase (HMT) vs micro inverters", function () {
		assert.ok(inverterIcon("HMT-1800-6T").startsWith("data:image/png;base64,"));
		assert.notStrictEqual(inverterIcon("HMT-1800-6T"), inverterIcon("HMS-800W-2T"));
	});

	it("defaults to the micro-inverter icon when the model is unknown", function () {
		assert.strictEqual(inverterIcon(""), inverterIcon("HMS-2000-4WB"));
	});

	it("gives stations their own icon, distinct from inverters", function () {
		const station = buildStationDeviceInfo(makeMock(), "station-5", {
			native: { stationId: 5 },
			common: { name: "P" },
		});
		assert.ok(station.icon.startsWith("data:image/png;base64,"));
		assert.notStrictEqual(station.icon, inverterIcon("HMS-800W-2T"));
	});
});

// ============================================================
// deviceManagement – settings schema
// ============================================================
describe("deviceManagement – SETTINGS_SCHEMA", function () {
	it("is a panel with the two SetConfig fields", function () {
		assert.strictEqual(SETTINGS_SCHEMA.type, "panel");
		assert.ok(SETTINGS_SCHEMA.items.serverSendTime);
		assert.ok(SETTINGS_SCHEMA.items.limitPowerMyPower);
	});
});
