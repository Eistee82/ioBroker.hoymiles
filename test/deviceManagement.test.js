import assert from "node:assert";
import {
	DM_I18N,
	REQUIRED_LANGS,
	COMMAND_DEFS,
	SETTINGS_SCHEMA,
	buildControls,
	buildDeviceActions,
	buildMeterSchema,
	buildDtuDeviceInfo,
	buildStationDeviceInfo,
	buildDeviceDetails,
	buildInstanceInfo,
	classifyDevice,
	isLocalDevice,
	resolveStationId,
} from "../build/lib/deviceManagement.js";
import { WRITABLE_STATES } from "../build/lib/deviceContext.js";
import { ACK_ICON, ACK_GROUND_ICON, inverterIcon } from "../build/lib/deviceIcons.js";

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

	it("files every control under a known section", function () {
		const known = new Set(["operation", "runtime"]);
		for (const d of COMMAND_DEFS.filter(c => c.ui === "control")) {
			assert.ok(known.has(d.group), `control "${d.id}" has no valid group (got ${d.group})`);
		}
	});

	it("splits control and setting by what the firmware persists, not by name", function () {
		// The names mislead here: inverter.powerLimit sounds like a runtime knob but is written
		// into the persisted structure 0x6b8dc+0x40 (two 4 KB sectors per change, §1), while
		// config.limitPowerMyPower is named "persistent" and lands in RAM only (§2, §15).
		const byUi = id => COMMAND_DEFS.find(d => d.id === id)?.ui;
		assert.strictEqual(byUi("inverter.powerLimit"), "setting");
		assert.strictEqual(byUi("inverter.powerFactorLimit"), "setting");
		assert.strictEqual(byUi("inverter.reactivePowerLimit"), "setting");
		assert.strictEqual(byUi("config.limitPowerMyPower"), "control");
		assert.strictEqual(byUi("config.serverSendTime"), "control");
		assert.strictEqual(byUi("inverter.active"), "control");
		assert.strictEqual(byUi("inverter.lock"), "control");
	});

	it("tells the user which values are volatile and which cost flash", function () {
		for (const d of COMMAND_DEFS.filter(c => c.ui === "setting")) {
			assert.strictEqual(d.help, "helpFlashWrite", `setting "${d.id}" lacks the flash warning`);
		}
		for (const d of COMMAND_DEFS.filter(c => c.ui === "control" && c.group === "runtime")) {
			assert.strictEqual(d.help, "helpVolatile", `runtime control "${d.id}" lacks the volatility note`);
		}
	});

	it("gives controls only data-URI icons, never a reserved name", function () {
		// A control's icon goes straight into <img src>, so a name like "socket" renders as a
		// broken image (an action's icon is resolved by name and may use one).
		for (const d of COMMAND_DEFS.filter(c => c.ui === "control" && c.icon)) {
			assert.ok(d.icon.startsWith("data:image/"), `control "${d.id}" icon "${d.icon}" is not a data URI`);
		}
	});

	it("gives every action an icon that renders (no question-mark fallback)", function () {
		// The GUI falls back to a question mark for an action whose id and icon it cannot resolve.
		const reserved = new Set(["refresh", "settings", "search", "info", "update", "add", "delete", "edit"]);
		for (const d of COMMAND_DEFS.filter(c => c.ui === "action")) {
			assert.ok(
				d.icon && (d.icon.startsWith("data:image/") || reserved.has(d.icon)),
				`action "${d.id}" would fall back to the question-mark icon`,
			);
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
	// Ids of the real controls, without the layout-only header/divider/read-out entries.
	const commandIds = controls => controls.filter(c => !["header", "divider", "info"].includes(c.type)).map(c => c.id);

	it("offers the volatile controls for a local device", function () {
		const ids = commandIds(buildControls(makeMock(), "SN1", true));
		assert.ok(ids.includes("inverter.active"));
		assert.ok(ids.includes("inverter.lock"));
		assert.ok(ids.includes("config.serverSendTime"));
		assert.ok(ids.includes("config.limitPowerMyPower"));
		// Momentary commands are actions, not controls.
		assert.ok(!ids.includes("inverter.reboot"));
		// Persisted values belong behind the gear icon, not in the control dialog.
		assert.ok(!ids.includes("inverter.powerLimit"));
		assert.ok(!ids.includes("inverter.powerFactorLimit"));
		assert.ok(!ids.includes("inverter.reactivePowerLimit"));
	});

	it("offers only cloud-capable controls for a cloud-only device", function () {
		const ids = commandIds(buildControls(makeMock(), "SN2", false));
		assert.deepStrictEqual(ids, ["inverter.active"]);
	});

	it("uses full namespace-prefixed stateId for the GUI binding", function () {
		const controls = buildControls(makeMock(), "SN1", true);
		const active = controls.find(c => c.id === "inverter.active");
		assert.strictEqual(active.stateId, "hoymiles.0.SN1.inverter.active");
	});

	it("control handler writes the underlying state with ack=false", async function () {
		const mock = makeMock({ "SN1.config.limitPowerMyPower": { val: 50, ack: false } });
		const controls = buildControls(mock, "SN1", true);
		const limit = controls.find(c => c.id === "config.limitPowerMyPower");
		await limit.handler("SN1", "config.limitPowerMyPower", 50);
		assert.deepStrictEqual(mock.setCalls, [{ id: "SN1.config.limitPowerMyPower", val: 50, ack: false }]);
	});

	it("groups the controls under section headings, in a fixed order", function () {
		const controls = buildControls(makeMock(), "SN1", true);
		const headers = controls.filter(c => c.type === "header").map(c => c.label.en);
		assert.deepStrictEqual(headers, ["Operation", "Runtime"]);
		// Every section but the first is preceded by a separator.
		assert.strictEqual(controls.filter(c => c.type === "divider").length, headers.length - 1);
	});

	it("skips a section whose controls are all unavailable", function () {
		// A cloud-only device keeps just inverter.active, so only "Operation" may remain.
		const controls = buildControls(makeMock(), "SN2", false);
		assert.deepStrictEqual(
			controls.filter(c => c.type === "header").map(c => c.label.en),
			["Operation"],
		);
		assert.strictEqual(controls.filter(c => c.type === "divider").length, 0);
	});

	it("widens the dialog through the first heading", function () {
		// The control dialog has no fullWidth, so it is only as wide as its widest child.
		const first = buildControls(makeMock(), "SN1", true)[0];
		assert.strictEqual(first.type, "header");
		assert.ok(first.style.minWidth, "the first heading must carry the dialog's minimum width");
	});

	it("puts a live read-out with label and unit in front of every slider", function () {
		const controls = buildControls(makeMock(), "SN1", true);
		const sliders = controls.filter(c => c.type === "slider");
		assert.ok(sliders.length >= 1);
		for (const slider of sliders) {
			// The slider itself carries no label — the read-out above it names the value, which
			// also keeps the slider from overlapping a label.
			assert.strictEqual(slider.label, undefined);
			const readout = controls[controls.indexOf(slider) - 1];
			assert.strictEqual(readout.type, "info");
			assert.strictEqual(readout.stateId, slider.stateId);
			assert.strictEqual(readout.unit, slider.unit);
			// The label carries its own trailing gap, because the GUI puts none between the two.
			for (const lang of REQUIRED_LANGS) {
				assert.ok(
					readout.label[lang].endsWith(":\u00A0"),
					`read-out label "${readout.label[lang]}" (${lang}) lacks the trailing gap`,
				);
			}
		}
	});

	it("read-out reads the slider's state although its own id differs", async function () {
		const mock = makeMock({ "SN1.config.limitPowerMyPower": { val: 70, ack: true } });
		const controls = buildControls(mock, "SN1", true);
		const readout = controls.find(c => c.id === "config.limitPowerMyPower#value");
		assert.ok(readout, "read-out control missing");
		const state = await readout.getStateHandler("SN1", "config.limitPowerMyPower#value");
		assert.strictEqual(state.val, 70);
	});
});

// ============================================================
// deviceManagement – actions (reboot buttons + settings form)
// ============================================================
describe("deviceManagement – buildDeviceActions", function () {
	it("offers reboot actions plus settings for a local device", async function () {
		const actions = await buildDeviceActions(makeMock(), "SN1", true);
		const ids = actions.map(a => a.id);
		assert.ok(ids.includes("inverter.reboot"));
		assert.ok(ids.includes("dtu.reboot"));
		assert.ok(ids.includes("settings"));
	});

	it("hides the acknowledge buttons while there is nothing to acknowledge", async function () {
		// A button that would clear nothing is noise; pressing it has no effect either.
		const ids = (await buildDeviceActions(makeMock(), "SN1", true)).map(a => a.id);
		assert.ok(!ids.includes("inverter.cleanWarnings"));
		assert.ok(!ids.includes("inverter.cleanGroundingFault"));
	});

	it("offers the warning acknowledge only while an alarm is active", async function () {
		const mock = makeMock({ "SN1.alarms.hasActive": { val: true, ack: true } });
		const ids = (await buildDeviceActions(mock, "SN1", true)).map(a => a.id);
		assert.ok(ids.includes("inverter.cleanWarnings"));
		// A general alarm is not a grounding fault.
		assert.ok(!ids.includes("inverter.cleanGroundingFault"));
	});

	it("offers the grounding acknowledge only while that specific fault stands", async function () {
		// Code 182 is the only grounding-related entry in the alarm code table.
		const mock = makeMock({
			"SN1.alarms.hasActive": { val: true, ack: true },
			"SN1.alarms.json": { val: JSON.stringify([{ code: 182, active: true }]), ack: true },
		});
		const ids = (await buildDeviceActions(mock, "SN1", true)).map(a => a.id);
		assert.ok(ids.includes("inverter.cleanGroundingFault"));
	});

	it("does not offer the grounding acknowledge on the WB series, where it does nothing", async function () {
		// Firmware-verified: on the WB line action 10 hits an empty arm and returns err 0, so the
		// user would get a success message for an action with no effect (ACTIONS_COMPARISON.md).
		const mock = makeMock({
			"SN1.alarms.hasActive": { val: true, ack: true },
			"SN1.alarms.json": { val: JSON.stringify([{ code: 182, active: true }]), ack: true },
		});
		for (const model of ["HMS-800-2WB", "HMS-1600-4WB"]) {
			const ids = (await buildDeviceActions(mock, "SN1", true, model)).map(a => a.id);
			assert.ok(!ids.includes("inverter.cleanGroundingFault"), `${model} must not offer it`);
			// The warning acknowledge (action 42) does work there and must stay.
			assert.ok(ids.includes("inverter.cleanWarnings"), `${model} must still offer the warning button`);
		}
		// The T series executes it (slot cmd 0x08), and an unknown model is not assumed broken.
		for (const model of ["HMS-800W-2T", "HMS-2000DW-4T", ""]) {
			const ids = (await buildDeviceActions(mock, "SN1", true, model)).map(a => a.id);
			assert.ok(ids.includes("inverter.cleanGroundingFault"), `${model || "unknown"} should offer it`);
		}
	});

	it("ignores a grounding fault that is no longer active", async function () {
		const mock = makeMock({
			"SN1.alarms.json": { val: JSON.stringify([{ code: 182, active: false }]), ack: true },
		});
		const ids = (await buildDeviceActions(mock, "SN1", true)).map(a => a.id);
		assert.ok(!ids.includes("inverter.cleanGroundingFault"));
	});

	it("survives an unreadable alarm list without offering the button", async function () {
		const mock = makeMock({ "SN1.alarms.json": { val: "{not json", ack: true } });
		const ids = (await buildDeviceActions(mock, "SN1", true)).map(a => a.id);
		assert.ok(!ids.includes("inverter.cleanGroundingFault"));
	});

	it("offers only cloud-capable actions and no settings for a cloud-only device", async function () {
		const actions = await buildDeviceActions(makeMock(), "SN2", false);
		const ids = actions.map(a => a.id).sort();
		assert.deepStrictEqual(ids, ["dtu.reboot", "inverter.reboot"]);
	});

	it("reboot action writes true with ack=false", async function () {
		const mock = makeMock();
		const actions = await buildDeviceActions(mock, "SN1", true);
		const reboot = actions.find(a => a.id === "inverter.reboot");
		const res = await reboot.handler("SN1", {});
		assert.deepStrictEqual(res, { refresh: "none" });
		assert.deepStrictEqual(mock.setCalls, [{ id: "SN1.inverter.reboot", val: true, ack: false }]);
	});

	it("settings action persists the values the form returns", async function () {
		const mock = makeMock();
		const actions = await buildDeviceActions(mock, "SN1", true);
		const settings = actions.find(a => a.id === "settings");
		const context = {
			showForm: async () => ({
				inverter_powerLimit: 80,
				inverter_powerFactorLimit: 0.9,
				inverter_reactivePowerLimit: 10,
			}),
		};
		await settings.handler("SN1", context);
		assert.deepStrictEqual(mock.setCalls, [
			{ id: "SN1.inverter.powerLimit", val: 80, ack: false },
			{ id: "SN1.inverter.powerFactorLimit", val: 0.9, ack: false },
			{ id: "SN1.inverter.reactivePowerLimit", val: 10, ack: false },
		]);
	});

	it("settings action rewrites only the fields the user changed", async function () {
		// Each of these costs two 4 KB flash sectors, so an untouched field must not be rewritten.
		const mock = makeMock({
			"SN1.inverter.powerLimit": { val: 80, ack: true },
			"SN1.inverter.powerFactorLimit": { val: 0.9, ack: true },
			"SN1.inverter.reactivePowerLimit": { val: 10, ack: true },
		});
		const actions = await buildDeviceActions(mock, "SN1", true);
		const settings = actions.find(a => a.id === "settings");
		const context = {
			showForm: async () => ({
				inverter_powerLimit: 80,
				inverter_powerFactorLimit: 0.8,
				inverter_reactivePowerLimit: 10,
			}),
		};
		await settings.handler("SN1", context);
		assert.deepStrictEqual(mock.setCalls, [{ id: "SN1.inverter.powerFactorLimit", val: 0.8, ack: false }]);
	});

	it("settings form is prefilled from the current values", async function () {
		const mock = makeMock({ "SN1.inverter.powerLimit": { val: 55, ack: true } });
		const actions = await buildDeviceActions(mock, "SN1", true);
		let seen;
		await actions
			.find(a => a.id === "settings")
			.handler("SN1", {
				showForm: async (_schema, opts) => {
					seen = opts.data;
					return undefined;
				},
			});
		assert.strictEqual(seen.inverter_powerLimit, 55);
	});

	it("settings action writes nothing when the form is cancelled", async function () {
		const mock = makeMock();
		const actions = await buildDeviceActions(mock, "SN1", true);
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

	it("ships the acknowledge icons at their rendered size, not larger", function () {
		// The Device Manager puts a data-URI action icon into a bare <img> with no width or
		// height, so the bitmap's own size is what appears on screen. A 64px icon dwarfed the
		// material icons next to it. PNG header: width and height are big-endian at byte 16/20.
		for (const [name, uri] of [
			["ACK_ICON", ACK_ICON],
			["ACK_GROUND_ICON", ACK_GROUND_ICON],
		]) {
			const png = Buffer.from(uri.split(",")[1], "base64");
			const width = png.readUInt32BE(16);
			const height = png.readUInt32BE(20);
			assert.strictEqual(width, 24, `${name} is ${width}px wide, expected 24`);
			assert.strictEqual(height, 24, `${name} is ${height}px high, expected 24`);
		}
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

	it("omits the signal display and local-only controls for a cloud-only DTU", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN2", { native: { host: "" }, common: {} });
		assert.strictEqual(info.status.rssi, undefined);
		assert.deepStrictEqual(
			info.controls.filter(c => !["header", "divider", "info"].includes(c.type)).map(c => c.id),
			["inverter.active"],
		);
	});

	it("shows the signal through the built-in slot, which every Admin version renders", async function () {
		// A custom indicator could carry the unit natively, but it needs dm-utils 3.2.0 while
		// Admin 7.8.x still ships the 3.0.x GUI, which drops the array silently — nothing at all
		// would show.
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.strictEqual(info.status.rssi.stateId, "hoymiles.0.SN1.dtu.signalQuality");
	});

	it("puts the percent sign on the signal value in the status line", async function () {
		// The slot has no unit option and renders its value verbatim, so the unit has to arrive
		// as part of the value — the mapping is looked up with the raw state value.
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		const mapping = info.status.rssi.mapping;
		assert.ok(mapping, "no mapping — the value would render without its unit");
		assert.strictEqual(mapping[48], "48 %");
		// Every value the firmware can produce must have an entry: a miss yields undefined and
		// hides the signal display altogether. The value is clamped to 0-100 (ADAPTER_FINDINGS §16).
		for (let i = 0; i <= 100; i++) {
			assert.strictEqual(mapping[i], `${i} %`, `quality ${i} has no mapping entry`);
		}
	});

	it("does not repeat the signal as a card row", async function () {
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.strictEqual(info.customInfo.schema.items.wifiQuality, undefined);
	});

	it("uses no feature that the 3.0.x Device Manager GUI would drop", async function () {
		// Guard against reaching for newer dm-utils features again: whatever the card shows must
		// survive on the oldest GUI the Admin still ships.
		const info = await buildDtuDeviceInfo(makeMock(), "SN1", { native: { host: "1.2.3.4" }, common: {} });
		assert.strictEqual(info.indicators, undefined, "indicators need dm-utils 3.2.0");
		for (const action of info.actions) {
			assert.strictEqual(action.title, undefined, "action.title needs dm-utils 3.2.0");
			assert.strictEqual(action.placement, undefined, "action.placement needs dm-utils 3.2.0");
		}
	});
});

describe("deviceManagement – buildStationDeviceInfo", function () {
	const stationObj = { native: { stationId: 5 }, common: { name: "My Plant" } };

	it("maps a station with status binding and no controls", async function () {
		const info = await buildStationDeviceInfo(makeMock(), "station-5", stationObj);
		assert.strictEqual(info.id, "station-5");
		assert.strictEqual(info.name, "My Plant");
		assert.strictEqual(info.status.connection.stateId, "hoymiles.0.station-5.info.stationStatus");
		assert.strictEqual(info.controls, undefined);
		assert.strictEqual(info.hasDetails, true);
	});

	it("shows power, the energy counters and the yield on the station card", async function () {
		const mock = makeMock({ "station-5.grid.currency": { val: "EUR", ack: true } });
		const items = (await buildStationDeviceInfo(mock, "station-5", stationObj)).customInfo.schema.items;
		assert.strictEqual(items.gridPower.oid, "hoymiles.0.station-5.grid.power");
		assert.strictEqual(items.gridDailyEnergy.oid, "hoymiles.0.station-5.grid.dailyEnergy");
		assert.strictEqual(items.gridYearEnergy.oid, "hoymiles.0.station-5.grid.yearEnergy");
		assert.strictEqual(items.gridTotalEnergy.oid, "hoymiles.0.station-5.grid.totalEnergy");
		// The energy counters come before the monetary yield.
		const order = Object.keys(items);
		assert.ok(order.indexOf("gridTotalEnergy") < order.indexOf("incomeToday"), `unexpected order: ${order}`);
	});

	it("labels the yield with the station's own currency", async function () {
		const mock = makeMock({ "station-5.grid.currency": { val: "EUR", ack: true } });
		const items = (await buildStationDeviceInfo(mock, "station-5", stationObj)).customInfo.schema.items;
		assert.strictEqual(items.incomeToday.oid, "hoymiles.0.station-5.grid.todayIncome");
		assert.strictEqual(items.incomeToday.unit, "EUR");
		assert.strictEqual(items.incomeTotal.oid, "hoymiles.0.station-5.grid.totalIncome");
		assert.strictEqual(items.incomeTotal.unit, "EUR");
	});

	it("omits the yield when no currency is known", async function () {
		// Without an electricity price the cloud writes no income, so a bare number would mislead.
		const items = (await buildStationDeviceInfo(makeMock(), "station-5", stationObj)).customInfo.schema.items;
		assert.strictEqual(items.incomeToday, undefined);
		assert.strictEqual(items.incomeTotal, undefined);
		assert.ok(items.gridYearEnergy, "the energy counters must stay regardless of the currency");
	});

	it("shows the PV utilization on the card, not as an indicator", async function () {
		// An indicator would put it in the status line, but that needs dm-utils 3.2.0 and the
		// Admin still ships the 3.0.x GUI, which drops indicators without a trace.
		const info = await buildStationDeviceInfo(makeMock(), "station-5", stationObj);
		assert.strictEqual(info.indicators, undefined, "indicators need dm-utils 3.2.0");
		const pv = info.customInfo.schema.items.pvUtilization;
		assert.ok(pv, "PV utilization missing from the card");
		assert.strictEqual(pv.oid, "hoymiles.0.station-5.grid.pvUtilization");
		assert.strictEqual(pv.unit, "%");
	});
});

// ============================================================
// deviceManagement – labels say the same thing everywhere
// ============================================================
describe("deviceManagement – labels", function () {
	it("uses every translation key it defines", function () {
		// A key left behind after a redesign is a text nobody reads but everyone has to translate.
		const used = new Set();
		for (const d of COMMAND_DEFS) {
			used.add(d.label);
			if (d.help) {
				used.add(d.help);
			}
		}
		// Keys used directly by the builders rather than through COMMAND_DEFS.
		for (const key of [
			"confirmRebootInverter",
			"confirmRebootDtu",
			"settings",
			"settingsTitle",
			"discover",
			"testCloud",
			"detailsHeader",
			"detailsInverter",
			"detailsDtu",
			"detailsNetwork",
			"detailsCloudServer",
			"detailsConnectedVia",
			"cardPower",
			"cardEnergyToday",
			"cardEnergyYear",
			"cardEnergyTotal",
			"cardIncomeToday",
			"cardIncomeTotal",
			"pvUtilization",
			"temperature",
			"pvString",
			"groupOperation",
			"groupRuntime",
			// Energy-meter action and its form (BLE devices only).
			"shellyMeter",
			"shellyMeterTitle",
			"shellyMac",
			"shellyMacHelp",
			"shellyMode",
			"shellyModeHelp",
			"shellyModeOff",
			"shellyModeMeter",
			"shellyModeZeroExport",
			"shellyNoneFound",
		]) {
			used.add(key);
		}
		const unused = Object.keys(DM_I18N).filter(k => !used.has(k));
		assert.deepStrictEqual(unused, [], `unused translation keys: ${unused.join(", ")}`);
	});

	it("never contradicts the section a control sits in", function () {
		// "Persistent power limit" under the heading "Runtime" was exactly that: the label
		// asserting the opposite of what the firmware does and the section says.
		for (const d of COMMAND_DEFS.filter(c => c.group === "runtime")) {
			for (const lang of REQUIRED_LANGS) {
				const label = DM_I18N[d.label][lang].toLowerCase();
				assert.ok(
					!/persistent|persistente|persistant|trwał|постоян|持久/.test(label),
					`"${d.id}" is a runtime value but its ${lang} label claims persistence: ${label}`,
				);
			}
		}
	});
});

// ============================================================
// deviceManagement – station mapping survives an adapter restart
// ============================================================
describe("deviceManagement – resolveStationId", function () {
	it("prefers the live mapping and asks to remember it", function () {
		const r = resolveStationId(7, { native: { host: "1.2.3.4" } });
		assert.strictEqual(r.stationId, 7);
		assert.strictEqual(r.persist, true);
	});

	it("does not rewrite the object when the mapping is unchanged", function () {
		const r = resolveStationId(7, { native: { host: "1.2.3.4", cloudStationId: 7 } });
		assert.strictEqual(r.stationId, 7);
		assert.strictEqual(r.persist, false);
	});

	it("falls back to the remembered station before the first cloud poll", function () {
		// This is the restart window: the runtime registry is still empty, and without the
		// fallback the card title would drop from the plant name to the model name.
		const r = resolveStationId(null, { native: { host: "1.2.3.4", cloudStationId: 7 } });
		assert.strictEqual(r.stationId, 7);
		assert.strictEqual(r.persist, false);
	});

	it("reports no station when neither source knows one", function () {
		const r = resolveStationId(null, { native: { host: "1.2.3.4" } });
		assert.strictEqual(r.stationId, null);
		assert.strictEqual(r.persist, false);
	});

	it("updates a stale remembered mapping", function () {
		const r = resolveStationId(9, { native: { host: "1.2.3.4", cloudStationId: 7 } });
		assert.strictEqual(r.stationId, 9);
		assert.strictEqual(r.persist, true);
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

	it("labels every row, so the panel is not a bare column of values", async function () {
		// The GUI does not derive a caption from the object behind `oid` — without an explicit
		// label the dialog showed values only. A label falling back to the state id (a string
		// rather than a translation object) means the id is missing from the state definitions.
		for (const [deviceId, objs] of [
			["SN1", { "hoymiles.0.SN1": { native: { host: "1.2.3.4" }, common: {} } }],
			["station-5", { "hoymiles.0.station-5": { native: { stationId: 5 }, common: {} } }],
		]) {
			const details = await buildDeviceDetails(makeMock({}, objs), deviceId);
			const rows = Object.entries(details.schema.items).filter(([, v]) => v.type === "state");
			assert.ok(rows.length > 0, `${deviceId} has no rows`);
			for (const [key, item] of rows) {
				assert.strictEqual(
					typeof item.label,
					"object",
					`row "${key}" of ${deviceId} falls back to its state id — unknown to stateDefinitions`,
				);
				assert.ok(item.label.en && item.label.de, `row "${key}" of ${deviceId} lacks en/de`);
			}
		}
	});

	it("hides network fields the device does not have", async function () {
		// GetConfig is one message for the whole DTU family and carries a wired half (plus APN and
		// GPRS fields). An HMS inverter has no Ethernet port and answers those with zeros — showing
		// them claimed an address the device does not have, and looked like a duplicate of the
		// WiFi rows.
		const objs = { "hoymiles.0.SN1": { native: { host: "192.168.1.5" }, common: {} } };
		const mock = makeMock(
			{
				"SN1.dtu.rssi": { val: 48, ack: true },
				"SN1.config.wifiSsid": { val: "AMSTK-PV", ack: true },
				"SN1.config.wifiMacAddress": { val: "40:F4:C9:86:9D:50", ack: true },
				"SN1.config.wifiIpAddress": { val: "0.0.0.0", ack: true },
				"SN1.config.ipAddress": { val: "0.0.0.0", ack: true },
				"SN1.config.macAddress": { val: "00:00:00:00:00:00", ack: true },
				"SN1.config.subnetMask": { val: "0.0.0.0", ack: true },
				"SN1.config.gateway": { val: "0.0.0.0", ack: true },
				"SN1.config.dnsServer": { val: "1.1.1.1", ack: true },
				"SN1.config.netDhcpSwitch": { val: 0, ack: true },
			},
			objs,
		);
		const items = (await buildDeviceDetails(mock, "SN1")).schema.items;
		assert.ok(items.ssid, "a filled field must stay");
		assert.ok(items.macAddress, "the WiFi MAC is filled and must stay");
		assert.ok(items.dnsServer, "1.1.1.1 is a real value");
		assert.strictEqual(items.lanIp, undefined, "0.0.0.0 must not be shown as an address");
		assert.strictEqual(items.lanMac, undefined, "an all-zero MAC must not be shown");
		assert.strictEqual(items.subnetMask, undefined);
		assert.strictEqual(items.gateway, undefined);
		assert.strictEqual(items.ipAddress, undefined, "an empty WiFi address must not be shown either");
		// A numeric 0 is an answer, not an absence — DHCP off is a real state.
		assert.ok(items.dhcp, "a numeric 0 must be kept");
	});

	it("shows the address the adapter is actually talking to", async function () {
		// The device often leaves its own WiFi address field empty; the host we connect to is known.
		const objs = { "hoymiles.0.SN1": { native: { host: "192.168.1.5" }, common: {} } };
		const mock = makeMock({ "SN1.config.wifiSsid": { val: "AMSTK-PV", ack: true } }, objs);
		const items = (await buildDeviceDetails(mock, "SN1")).schema.items;
		assert.strictEqual(items.connectedVia.data, "192.168.1.5");
	});

	it("drops the network section entirely when nothing in it is known", async function () {
		const objs = { "hoymiles.0.SN1": { native: { host: "192.168.1.5" }, common: {} } };
		const items = (await buildDeviceDetails(makeMock({}, objs), "SN1")).schema.items;
		assert.strictEqual(items._hNetwork, undefined, "no heading without content");
		assert.strictEqual(items.connectedVia, undefined);
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

	it("gives stations their own icon, distinct from inverters", async function () {
		const station = await buildStationDeviceInfo(makeMock(), "station-5", {
			native: { stationId: 5 },
			common: { name: "P" },
		});
		assert.ok(station.icon.startsWith("data:image/png;base64,"));
		assert.notStrictEqual(station.icon, inverterIcon("HMS-800W-2T"));
	});

	it("ships the acknowledge icons as self-contained PNG data URIs", function () {
		assert.ok(ACK_ICON.startsWith("data:image/png;base64,"));
		assert.ok(ACK_GROUND_ICON.startsWith("data:image/png;base64,"));
		assert.notStrictEqual(ACK_ICON, ACK_GROUND_ICON);
	});

	it("sizes the data-URI action icons so they match the material ones", async function () {
		// A data-URI icon lands in a bare <img> without width/height and would render at 64 px.
		const actions = await buildDeviceActions(makeMock(), "SN1", true);
		for (const action of actions.filter(a => a.icon?.startsWith("data:image/"))) {
			assert.ok(action.style?.["& img"]?.width, `action "${action.id}" does not size its icon`);
		}
	});
});

// ============================================================
// deviceManagement – settings schema
// ============================================================
describe("deviceManagement – SETTINGS_SCHEMA", function () {
	it("is a panel holding exactly the persisted commands", function () {
		assert.strictEqual(SETTINGS_SCHEMA.type, "panel");
		assert.deepStrictEqual(Object.keys(SETTINGS_SCHEMA.items).sort(), [
			"inverter_powerFactorLimit",
			"inverter_powerLimit",
			"inverter_reactivePowerLimit",
		]);
	});

	it("uses flat form keys, since JsonConfig reads a dot as a path", function () {
		for (const key of Object.keys(SETTINGS_SCHEMA.items)) {
			assert.ok(!key.includes("."), `form key "${key}" would arrive nested`);
		}
	});

	it("carries the wear note once, not under every field", function () {
		// The note applies to the whole dialog, so repeating it under each of the three fields
		// was just noise.
		const withHelp = Object.entries(SETTINGS_SCHEMA.items).filter(([, item]) => item.help);
		assert.strictEqual(withHelp.length, 1, `the note appears ${withHelp.length} times`);
		assert.strictEqual(withHelp[0][1].help.en, DM_I18N.helpFlashWrite.en);
	});

	it("keeps the help texts short enough to read in a dialog", function () {
		// These are hints in a form, not documentation.
		for (const key of ["helpFlashWrite", "helpVolatile"]) {
			for (const lang of REQUIRED_LANGS) {
				const text = DM_I18N[key][lang];
				assert.ok(text.length <= 200, `${key}.${lang} is ${text.length} characters long`);
			}
		}
	});
});

// ============================================================
// deviceManagement – energy meter action (BLE devices only)
// ============================================================
describe("deviceManagement – energy meter", function () {
	// The controls exist only on BLE devices, so their presence is the honest capability test:
	// a 2T has neither a meter input nor an energy management, and offering a button that cannot
	// work is worse than offering none.
	it("is not offered on a device without meter controls", async function () {
		const actions = await buildDeviceActions(makeMock(), "DTU123", true);
		assert.ok(!actions.some(a => a.id === "shellyMeter"), "no meter action without the controls");
	});

	it("is offered once the device has meter controls", async function () {
		const mock = makeMock({}, { "hoymiles.0.BLE123.meter.mode": { common: {} } });
		const actions = await buildDeviceActions(mock, "BLE123", true);
		const meter = actions.find(a => a.id === "shellyMeter");
		assert.ok(meter, "meter action missing");
		// A data-URI icon, so the Device Manager does not fall back to its question mark.
		assert.ok(String(meter.icon).startsWith("data:image/"), "needs its own icon");
	});

	it("is not offered on a cloud-only device", async function () {
		const mock = makeMock({}, { "hoymiles.0.BLE123.meter.mode": { common: {} } });
		const actions = await buildDeviceActions(mock, "BLE123", false);
		assert.ok(!actions.some(a => a.id === "shellyMeter"), "binding needs the local link");
	});

	it("writes the MAC before the mode", async function () {
		// The mode is what triggers the binding, so it has to find the address already in place.
		const mock = makeMock(
			{ "BLE123.meter.detected": { val: JSON.stringify(["bc2411b807c0"]) } },
			{ "hoymiles.0.BLE123.meter.mode": { common: {} } },
		);
		const actions = await buildDeviceActions(mock, "BLE123", true);
		const meter = actions.find(a => a.id === "shellyMeter");
		await meter.handler("BLE123", {
			showForm: async () => ({ mac: "bc2411b807c0", mode: 2 }),
		});
		const ids = mock.setCalls.map(c => c.id);
		assert.deepStrictEqual(ids, ["BLE123.meter.deviceId", "BLE123.meter.mode"]);
		assert.strictEqual(mock.setCalls[1].val, 2);
		// ack:false so the device context picks it up as a command rather than a readback.
		assert.strictEqual(mock.setCalls[1].ack, false);
	});

	it("re-sends an unchanged mode so a dead poll can be restarted", async function () {
		// The device's meter poll dies after a few minutes; re-binding is the documented way back,
		// and the command is idempotent.
		const mock = makeMock(
			{ "BLE123.meter.deviceId": { val: "bc2411b807c0" }, "BLE123.meter.mode": { val: 2 } },
			{ "hoymiles.0.BLE123.meter.mode": { common: {} } },
		);
		const actions = await buildDeviceActions(mock, "BLE123", true);
		const meter = actions.find(a => a.id === "shellyMeter");
		await meter.handler("BLE123", { showForm: async () => ({ mac: "bc2411b807c0", mode: 2 }) });
		assert.ok(
			mock.setCalls.some(c => c.id === "BLE123.meter.mode"),
			"mode must be written even when unchanged",
		);
	});

	it("writes nothing when the dialog is cancelled", async function () {
		const mock = makeMock({}, { "hoymiles.0.BLE123.meter.mode": { common: {} } });
		const actions = await buildDeviceActions(mock, "BLE123", true);
		const meter = actions.find(a => a.id === "shellyMeter");
		await meter.handler("BLE123", { showForm: async () => null });
		assert.deepStrictEqual(mock.setCalls, []);
	});
});

describe("deviceManagement – meter selection", function () {
	// Nobody should have to look up a MAC address: the inverter reports the meters it knows in
	// every info response (dtuInfo.shls), and those are offered for selection.
	it("offers what the inverter found, as a readable dropdown", function () {
		const schema = buildMeterSchema(["bc2411b807c0", "aabbccddeeff"]);
		assert.strictEqual(schema.items.mac.type, "select", "must be a selection, not free text");
		assert.deepStrictEqual(
			schema.items.mac.options.map(o => o.label),
			["BC:24:11:B8:07:C0", "AA:BB:CC:DD:EE:FF"],
			"shown colon-separated",
		);
		assert.deepStrictEqual(
			schema.items.mac.options.map(o => o.value),
			["bc2411b807c0", "aabbccddeeff"],
			"sent as bare hex, which is what the bind command needs",
		);
	});

	it("explains itself when the inverter found nothing", function () {
		// An empty dropdown would be a dead end the user cannot act on.
		const schema = buildMeterSchema([]);
		assert.strictEqual(schema.items.mac.type, "staticText");
		assert.ok(schema.items.mac.text.en.length > 0);
	});

	it("only offers the two modes that do something", function () {
		// 0 is the never-bound starting value, not a command — the device has no safe way to undo
		// a binding, so it must not be offered as if it did.
		const schema = buildMeterSchema(["bc2411b807c0"]);
		assert.deepStrictEqual(
			schema.items.mode.options.map(o => o.value),
			[1, 2],
		);
	});
});
