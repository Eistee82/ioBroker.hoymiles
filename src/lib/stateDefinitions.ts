import { GRID_PROFILE_SCHEMA } from "./gridProfile.js";

// source?: "local" = only from local TCP, "cloud" = only from cloud API, undefined = available from both

interface ChannelDefinition {
	id: string;
	name: ioBroker.StringOrTranslated;
	source?: "local" | "cloud";
}

interface StateDefinition {
	id: string;
	name: ioBroker.StringOrTranslated;
	type: ioBroker.CommonType;
	role: string;
	unit?: string;
	write?: boolean;
	min?: number;
	max?: number;
	states?: Record<number | string, string>;
	source?: "local" | "cloud";
}

// Factory helpers to reduce repetition in state definitions
type Extra = Partial<Pick<StateDefinition, "write" | "min" | "max" | "states" | "source">>;
const n = (id: string, en: string, de: string, role: string, unit: string, extra?: Extra): StateDefinition => ({
	id,
	name: { en, de },
	type: "number",
	role,
	unit,
	...extra,
});
const s = (id: string, en: string, de: string, role: string, extra?: Extra): StateDefinition => ({
	id,
	name: { en, de },
	type: "string",
	role,
	unit: "",
	...extra,
});
const b = (id: string, en: string, de: string, role: string, extra?: Extra): StateDefinition => ({
	id,
	name: { en, de },
	type: "boolean",
	role,
	unit: "",
	...extra,
});

/**
 * Shelly/ecotracker meter states — **not** part of {@link states}.
 *
 * Only a BLE device can take such a meter at all (the 2T has neither a meter input nor an energy
 * management, firmware-verified), and even there the branch is only worth creating once a meter
 * actually reports. `DeviceContext` therefore creates these on demand, the same way it handles the
 * wired meter channel.
 *
 * The values ride on the local RealData message; the cloud exposes no equivalent per-inverter flow.
 * The energy flow itself is firmware-proven (format string at `0x4080b6d8`, cross-checked by
 * `load = grid + plug - sp` at `0x4080b6b0`).
 *
 * `meter.mode` is the switch the user operates. Its numbers are the device types the firmware
 * itself checks for, so nothing has to be translated on the way down: 0 unbinds, 1 polls the meter
 * without regulating, 2 makes it the grid device the zero-export regulation works on.
 */
export const meterControlStates: StateDefinition[] = [
	// 0 is the "never bound" starting value, not a command: the device offers no safe way to undo a
	// binding. `action 90` (Cmd_Clr_All_Networking) would do it but is destructive — it memsets the
	// whole 0x700-byte network block at 0x71838, which is also where `action 80` keeps the inverter
	// assignment. Switching to 1 stops the regulation and is the honest "off".
	n("meter.mode", "Meter mode", "Zählermodus", "level", "", {
		source: "local",
		write: true,
		min: 0,
		max: 2,
		states: { 0: "not bound", 1: "meter only", 2: "zero export" },
	}),
	s("meter.deviceId", "Meter MAC", "Zähler-MAC", "text", { source: "local", write: true }),
	s("meter.detected", "Detected meters (JSON)", "Erkannte Zähler (JSON)", "json", { source: "local" }),
	b("meter.connected", "Meter delivering data", "Zähler liefert Daten", "indicator.connected", {
		source: "local",
	}),
	n("meter.lastData", "Last meter reading", "Letzter Zählerwert", "value.time", "", { source: "local" }),
];

/**
 * Measured values. Created only once a meter actually reports, so a device whose meter was never
 * bound does not grow a branch full of zeros.
 */
export const meterMeasurementStates: StateDefinition[] = [
	// Energy flow as the DTU computes it (RealDataNew field 13), in watts.
	n("meter.gridPower", "Grid exchange power", "Netzaustauschleistung", "value.power", "W", {
		source: "local",
	}),
	n("meter.pvPower", "PV power (meter view)", "PV-Leistung (Zählersicht)", "value.power", "W", {
		source: "local",
	}),
	n("meter.loadPower", "House load", "Hausverbrauch", "value.power", "W", { source: "local" }),
	n("meter.storagePower", "Storage power", "Speicherleistung", "value.power", "W", { source: "local" }),
	n("meter.plugPower", "Plug power", "Steckdosenleistung", "value.power", "W", { source: "local" }),

	// Per-phase readings from the meter itself (RealDataNew field 14). Scales measured against the
	// meter's own API: voltage in tenths of a volt, current in hundredths of an ampere, power in
	// tenths of a watt. Frequency comes once per device, unscaled.
	n("meter.frequency", "Grid frequency", "Netzfrequenz", "value.frequency", "Hz", { source: "local" }),
	...[1, 2, 3].flatMap(p => [
		n(`meter.l${p}Voltage`, `Voltage L${p}`, `Spannung L${p}`, "value.voltage", "V", { source: "local" }),
		n(`meter.l${p}Current`, `Current L${p}`, `Strom L${p}`, "value.current", "A", { source: "local" }),
		n(`meter.l${p}Power`, `Power L${p}`, `Leistung L${p}`, "value.power", "W", { source: "local" }),
	]),
];

/**
 * Channels of a hybrid (storage) inverter such as the HAT series — **not** part of {@link channels}.
 *
 * A microinverter has no battery, no backup output and no grid meter of its own, so these branches
 * are only created once the cloud device tree actually reports a hybrid inverter. `grid` and
 * `inverter` are absent here on purpose: they already exist for every device and merely gain the
 * extra states from {@link hybridStates}.
 */
export const hybridChannels: ChannelDefinition[] = [
	{ id: "eps", name: { en: "Backup (EPS) output", de: "Notstrom-Ausgang (EPS)" }, source: "cloud" },
	{ id: "battery", name: { en: "Battery", de: "Batterie" }, source: "cloud" },
];

/**
 * States of a hybrid (storage) inverter — **not** part of {@link states}, created on demand.
 *
 * Everything here comes from the cloud's `select_real_indicators_data` endpoint, which the S-Miles
 * web portal uses for its device detail view. No local protocol is known for these devices, hence
 * `source: "cloud"` throughout. Signs are passed through exactly as the cloud delivers them.
 */
export const hybridStates: StateDefinition[] = [
	// Inverter AC side, per phase (the aggregate goes to the existing grid.power / grid.frequency).
	...[1, 2, 3].flatMap(p => [
		n(`grid.l${p}Voltage`, `Voltage L${p}`, `Spannung L${p}`, "value.voltage", "V", { source: "cloud" }),
		n(`grid.l${p}Current`, `Current L${p}`, `Strom L${p}`, "value.current", "A", { source: "cloud" }),
		n(`grid.l${p}Power`, `Active power L${p}`, `Wirkleistung L${p}`, "value.power", "W", { source: "cloud" }),
		n(`grid.l${p}ReactivePower`, `Reactive power L${p}`, `Blindleistung L${p}`, "value.power.reactive", "var", {
			source: "cloud",
		}),
	]),
	n("inverter.operatingState", "Operating state", "Betriebsstatus", "value", "", { source: "cloud" }),
	s("inverter.operatingStateText", "Operating state (text)", "Betriebsstatus (Text)", "text", {
		source: "cloud",
	}),
	n("inverter.busVoltage", "DC bus voltage", "Zwischenkreisspannung", "value.voltage", "V", { source: "cloud" }),
	n("inverter.drmMode", "DRM mode", "DRM-Modus", "value", "", { source: "cloud" }),

	// Backup output
	...[1, 2, 3].flatMap(p => [
		n(`eps.l${p}Voltage`, `EPS voltage L${p}`, `EPS-Spannung L${p}`, "value.voltage", "V", { source: "cloud" }),
		n(`eps.l${p}Current`, `EPS current L${p}`, `EPS-Strom L${p}`, "value.current", "A", { source: "cloud" }),
		n(`eps.l${p}Power`, `EPS active power L${p}`, `EPS-Wirkleistung L${p}`, "value.power", "W", {
			source: "cloud",
		}),
	]),

	// Battery: identity from the device tree, measurements from the battery's own indicator set.
	s("battery.serialNumber", "Battery serial number", "Batterie-Seriennummer", "text", { source: "cloud" }),
	s("battery.model", "Battery model", "Batteriemodell", "text", { source: "cloud" }),
	s("battery.swVersion", "Battery firmware version", "Batterie-Firmware-Version", "text", { source: "cloud" }),
	s("battery.hwVersion", "Battery hardware version", "Batterie-Hardware-Version", "text", { source: "cloud" }),
	n("battery.capacity", "Battery capacity", "Batteriekapazität", "value", "kWh", { source: "cloud" }),
	b("battery.connected", "Battery online", "Batterie online", "indicator.connected", { source: "cloud" }),
	s("battery.type", "Battery type", "Batterietyp", "text", { source: "cloud" }),
	n("battery.soc", "State of charge", "Ladezustand", "value.battery", "%", { source: "cloud" }),
	n("battery.soh", "State of health", "Gesundheitszustand", "value", "%", { source: "cloud" }),
	n("battery.state", "Battery state", "Batteriestatus", "value", "", { source: "cloud" }),
	s("battery.stateText", "Battery state (text)", "Batteriestatus (Text)", "text", { source: "cloud" }),
	s("battery.faultCode", "Battery fault code", "Batterie-Fehlercode", "text", { source: "cloud" }),
	n("battery.voltage", "Battery voltage", "Batteriespannung", "value.voltage", "V", { source: "cloud" }),
	n("battery.current", "Battery current", "Batteriestrom", "value.current", "A", { source: "cloud" }),
	n("battery.power", "Battery power", "Batterieleistung", "value.power", "W", { source: "cloud" }),
	n("battery.maxChargeCurrent", "Max. charge current", "Max. Ladestrom", "value.current", "A", {
		source: "cloud",
	}),
	n("battery.maxDischargeCurrent", "Max. discharge current", "Max. Entladestrom", "value.current", "A", {
		source: "cloud",
	}),
	n("battery.chargeCutoffVoltage", "Charge cut-off voltage", "Ladeschlussspannung", "value.voltage", "V", {
		source: "cloud",
	}),
	n("battery.dischargeCutoffVoltage", "Discharge cut-off voltage", "Entladeschlussspannung", "value.voltage", "V", {
		source: "cloud",
	}),
	n("battery.cellTempMax", "Max. cell temperature", "Max. Zelltemperatur", "value.temperature", "°C", {
		source: "cloud",
	}),
	n("battery.cellTempMin", "Min. cell temperature", "Min. Zelltemperatur", "value.temperature", "°C", {
		source: "cloud",
	}),
	n("battery.moduleTempMax", "Max. module temperature", "Max. Modultemperatur", "value.temperature", "°C", {
		source: "cloud",
	}),
	n("battery.moduleTempMin", "Min. module temperature", "Min. Modultemperatur", "value.temperature", "°C", {
		source: "cloud",
	}),
	n("battery.cellVoltageMax", "Max. cell voltage", "Max. Zellspannung", "value.voltage", "V", {
		source: "cloud",
	}),
	n("battery.cellVoltageMin", "Min. cell voltage", "Min. Zellspannung", "value.voltage", "V", {
		source: "cloud",
	}),
	n("battery.moduleVoltageMax", "Max. module voltage", "Max. Modulspannung", "value.voltage", "V", {
		source: "cloud",
	}),
	n("battery.moduleVoltageMin", "Min. module voltage", "Min. Modulspannung", "value.voltage", "V", {
		source: "cloud",
	}),
	// The same battery as the inverter measures it at its own terminals.
	n(
		"battery.inverterVoltage",
		"Battery voltage (at inverter)",
		"Batteriespannung (am Wechselrichter)",
		"value.voltage",
		"V",
		{ source: "cloud" },
	),
	n(
		"battery.inverterCurrent",
		"Battery current (at inverter)",
		"Batteriestrom (am Wechselrichter)",
		"value.current",
		"A",
		{ source: "cloud" },
	),
	n(
		"battery.inverterPower",
		"Battery power (at inverter)",
		"Batterieleistung (am Wechselrichter)",
		"value.power",
		"W",
		{ source: "cloud" },
	),

	// Values the reference system does not deliver, but which belong to the cloud's vocabulary for
	// these devices (named in its public indicator dictionary). Created only when they arrive.
	n("inverter.pvPower", "PV power (all inputs)", "PV-Leistung (alle Eingänge)", "value.power", "W", {
		source: "cloud",
	}),
	n("inverter.pvEnergyToday", "PV energy today", "PV-Energie heute", "value.energy", "kWh", { source: "cloud" }),
	n(
		"inverter.pvHeatsinkTemperature",
		"PV heatsink temperature",
		"PV-Kühlkörpertemperatur",
		"value.temperature",
		"°C",
		{ source: "cloud" },
	),
	n(
		"inverter.heatsinkTemperature",
		"Inverter heatsink temperature",
		"Wechselrichter-Kühlkörpertemperatur",
		"value.temperature",
		"°C",
		{ source: "cloud" },
	),
	n(
		"inverter.batteryHeatsinkTemperature",
		"Battery-stage heatsink temperature",
		"Kühlkörpertemperatur der Batteriestufe",
		"value.temperature",
		"°C",
		{ source: "cloud" },
	),
	s("inverter.powerFaultCode", "Power fault code", "Fehlercode Leistungsteil", "text", { source: "cloud" }),
	s("inverter.safetyFaultCode", "Safety fault code", "Fehlercode Sicherheitsteil", "text", { source: "cloud" }),
	n("battery.chargeToday", "Charged today", "Heute geladen", "value.energy", "kWh", { source: "cloud" }),
	n("battery.dischargeToday", "Discharged today", "Heute entladen", "value.energy", "kWh", { source: "cloud" }),
	n("battery.cycles", "Charge cycles", "Ladezyklen", "value", "", { source: "cloud" }),
	n("battery.heating", "Heating status", "Heizstatus", "value", "", { source: "cloud" }),
	s("battery.heatingText", "Heating status (text)", "Heizstatus (Text)", "text", { source: "cloud" }),
];

/** Lookup map (suffix → definition) for the on-demand hybrid states. */
export const hybridStateMap: Map<string, StateDefinition> = new Map(hybridStates.map(d => [d.id, d]));

/**
 * Channels of the station-level measuring points — **not** part of {@link stationChannels}.
 *
 * A grid meter, the loads, a PV meter or a generator belong to the plant, not to one inverter, so
 * they live below `station-<id>`. Each is created only when the cloud flags it as present
 * (`icon_grid`, `icon_load`, `icon_pvi`, `icon_gen`): for anything absent it answers with a
 * template full of zeros, which must not turn into states.
 */
export const stationIndicatorChannels: ChannelDefinition[] = [
	{ id: "battery", name: { en: "Battery", de: "Batterie" }, source: "cloud" },
	{ id: "gridMeter", name: { en: "Grid meter", de: "Netzzähler" }, source: "cloud" },
	{ id: "load", name: { en: "Loads", de: "Verbraucher" }, source: "cloud" },
	{
		id: "pvMeter",
		name: { en: "PV meter (third-party inverter)", de: "PV-Zähler (Fremd-Wechselrichter)" },
		source: "cloud",
	},
	{ id: "generator", name: { en: "Generator", de: "Generator" }, source: "cloud" },
];

/**
 * Per-phase and total AC readings shared by the three-phase measuring points.
 *
 * @param ch - Channel id.
 * @param withCurrent - Whether the set delivers phase currents and reactive power.
 */
const acStates = (ch: string, withCurrent: boolean): StateDefinition[] => [
	...(withCurrent
		? [
				n(`${ch}.power`, "Total active power", "Gesamt-Wirkleistung", "value.power", "W", { source: "cloud" }),
				n(
					`${ch}.reactivePower`,
					"Total reactive power",
					"Gesamt-Blindleistung",
					"value.power.reactive",
					"var",
					{
						source: "cloud",
					},
				),
				n(`${ch}.frequency`, "Frequency", "Frequenz", "value.frequency", "Hz", { source: "cloud" }),
			]
		: []),
	...[1, 2, 3].flatMap(p => [
		n(`${ch}.l${p}Voltage`, `Voltage L${p}`, `Spannung L${p}`, "value.voltage", "V", { source: "cloud" }),
		n(`${ch}.l${p}Power`, `Active power L${p}`, `Wirkleistung L${p}`, "value.power", "W", { source: "cloud" }),
		...(withCurrent
			? [
					n(`${ch}.l${p}Current`, `Current L${p}`, `Strom L${p}`, "value.current", "A", { source: "cloud" }),
					n(
						`${ch}.l${p}ReactivePower`,
						`Reactive power L${p}`,
						`Blindleistung L${p}`,
						"value.power.reactive",
						"var",
						{ source: "cloud" },
					),
				]
			: []),
	]),
];

/** States of the station-level measuring points, created on demand. */
export const stationIndicatorStates: StateDefinition[] = [
	// The plant's battery as a whole. (The live battery power stays where earlier versions put it,
	// in `grid.batteryPower`, next to the rest of the power flow.) `e2b_total` = "charged" and
	// `efb_total` = "discharged" were checked against the portal's dashboard.
	n("battery.soc", "State of charge", "Ladezustand", "value.battery", "%", { source: "cloud" }),
	n("battery.capacity", "Installed capacity", "Installierte Kapazität", "value", "kWh", { source: "cloud" }),
	n("battery.chargeToday", "Charged today", "Heute geladen", "value.energy", "kWh", { source: "cloud" }),
	n("battery.dischargeToday", "Discharged today", "Heute entladen", "value.energy", "kWh", { source: "cloud" }),
	// 1-6 are the S-Miles app's own mode table; 7 and 8 follow the order of the portal's mode dialog,
	// whose per-mode parameters match (a meter power target for peak shaving, charge/discharge time
	// windows for time of use). The app knows a mode 9 that is not identified.
	n("battery.workMode", "Working mode", "Betriebsmodus", "value", "", {
		source: "cloud",
		states: {
			1: "Self-consumption",
			2: "Economy",
			3: "Backup",
			4: "Off-grid",
			5: "Forced charging",
			6: "Forced discharging",
			7: "Peak shaving",
			8: "Time of use",
		},
	}),
	// Filled by reading the battery settings from the device (`battery.readSettings`).
	n("battery.reserveSoc", "Reserved state of charge", "Reservierter Ladezustand", "value", "%", {
		source: "cloud",
	}),
	s("battery.settingsJson", "Battery settings (JSON)", "Batterie-Einstellungen (JSON)", "json", {
		source: "cloud",
	}),
	n("battery.settingsUpdated", "Settings last read", "Einstellungen zuletzt gelesen", "value.time", "", {
		source: "cloud",
	}),
	b("battery.readSettings", "Read battery settings", "Batterie-Einstellungen lesen", "button", {
		source: "cloud",
		write: true,
	}),
	// Grid meter at the point of connection
	b("gridMeter.connected", "Grid meter online", "Netzzähler online", "indicator.connected", { source: "cloud" }),
	...acStates("gridMeter", true),
	n("gridMeter.powerFactor", "Total power factor", "Gesamt-Leistungsfaktor", "value", "", { source: "cloud" }),
	n("gridMeter.importToday", "Imported today", "Heute bezogen", "value.energy", "kWh", { source: "cloud" }),
	n("gridMeter.exportToday", "Exported today", "Heute eingespeist", "value.energy", "kWh", { source: "cloud" }),
	...[1, 2, 3].flatMap(p => [
		n(`gridMeter.l${p}PowerFactor`, `Power factor L${p}`, `Leistungsfaktor L${p}`, "value", "", {
			source: "cloud",
		}),
		n(`gridMeter.l${p}ImportToday`, `Imported today L${p}`, `Heute bezogen L${p}`, "value.energy", "kWh", {
			source: "cloud",
		}),
		n(`gridMeter.l${p}ExportToday`, `Exported today L${p}`, `Heute eingespeist L${p}`, "value.energy", "kWh", {
			source: "cloud",
		}),
	]),

	// Loads
	...acStates("load", false),
	n("load.mode", "Load mode", "Lastmodus", "value", "", { source: "cloud" }),
	s("load.modeText", "Load mode (text)", "Lastmodus (Text)", "text", { source: "cloud" }),
	n("load.energyToday", "Consumed today", "Heute verbraucht", "value.energy", "kWh", { source: "cloud" }),
	...[1, 2, 3].map(p =>
		n(`load.l${p}EnergyToday`, `Consumed today L${p}`, `Heute verbraucht L${p}`, "value.energy", "kWh", {
			source: "cloud",
		}),
	),

	// PV meter: a third-party PV inverter measured by a meter of its own
	b("pvMeter.connected", "PV meter online", "PV-Zähler online", "indicator.connected", { source: "cloud" }),
	...acStates("pvMeter", true),
	n("pvMeter.energyToday", "Energy today", "Energie heute", "value.energy", "kWh", { source: "cloud" }),
	...[1, 2, 3].map(p =>
		n(`pvMeter.l${p}EnergyToday`, `Energy today L${p}`, `Energie heute L${p}`, "value.energy", "kWh", {
			source: "cloud",
		}),
	),

	// Generator
	n("generator.state", "Generator status", "Generatorstatus", "value", "", { source: "cloud" }),
	s("generator.stateText", "Generator status (text)", "Generatorstatus (Text)", "text", { source: "cloud" }),
	...acStates("generator", true),
	n("generator.energyToday", "Energy today", "Energie heute", "value.energy", "kWh", { source: "cloud" }),
	...[1, 2, 3].map(p =>
		n(`generator.l${p}EnergyToday`, `Energy today L${p}`, `Energie heute L${p}`, "value.energy", "kWh", {
			source: "cloud",
		}),
	),
];

/** Lookup map (suffix → definition) for the on-demand station measuring points. */
export const stationIndicatorStateMap: Map<string, StateDefinition> = new Map(
	stationIndicatorStates.map(d => [d.id, d]),
);

// === Per-DTU device channels & states (prefixed with <dtuSerial>.) ===

const channels: ChannelDefinition[] = [
	{ id: "info", name: { en: "Device information", de: "Geräteinformationen" } },
	{ id: "grid", name: { en: "Grid output", de: "Netzeinspeisung" } },
	// PV channels (pv0, pv1, pv2, pv3) are created dynamically based on pvNumber
	{ id: "inverter", name: { en: "Inverter", de: "Wechselrichter" } },
	{ id: "dtu", name: { en: "DTU", de: "DTU" } },
	{ id: "alarms", name: { en: "Alarms & warnings", de: "Alarme & Warnungen" }, source: "local" },
	{ id: "config", name: { en: "DTU configuration", de: "DTU-Konfiguration" }, source: "local" },
	// No source restriction: the grid profile is read locally (DevConfigFetch) or, for cloud-only
	// devices, over the cloud (pvm-ctl action 41) — the states are the same either way.
	{ id: "gridProfile", name: { en: "Grid profile", de: "Netzprofil" } },
	// meter channel is created dynamically when meter data is first received
	// shelly channel likewise (see meterMeasurementStates) — only a BLE device can take such a meter at all,
	// so listing it here would grow an empty branch on every 2T as well
];

// Grid-profile states are generated from the shared schema so decode + state list never drift.
// No source restriction (see the gridProfile channel above).
const gridProfileStates: StateDefinition[] = [
	s("gridProfile.standard", "Grid standard", "Netznorm", "text"),
	...GRID_PROFILE_SCHEMA.map(p =>
		p.flag
			? b(`gridProfile.${p.key}`, p.en, p.de, "indicator")
			: n(`gridProfile.${p.key}`, p.en, p.de, "value", p.unit),
	),
];

const states: StateDefinition[] = [
	// === Grid (from SGSMO / Cloud) ===
	n("grid.power", "Grid power", "Netzleistung", "value.power", "W"),
	n("grid.voltage", "Grid voltage", "Netzspannung", "value.voltage", "V"),
	n("grid.current", "Grid current", "Netzstrom", "value.current", "A", { source: "local" }),
	n("grid.frequency", "Grid frequency", "Netzfrequenz", "value", "Hz"),
	n("grid.reactivePower", "Reactive power", "Blindleistung", "value", "var", { source: "local" }),
	n("grid.powerFactor", "Power factor", "Leistungsfaktor", "value", "", { source: "local" }),
	n("grid.dailyEnergy", "Daily energy", "Tagesenergie", "value.energy", "kWh", { source: "local" }),
	// PV states are created dynamically based on pvNumber from DTU info response
	// (see createPvStates() in deviceContext.ts)

	// === Inverter ===
	s("inverter.serialNumber", "Serial number", "Seriennummer", "text"),
	s("inverter.hwVersion", "Hardware version", "Hardware-Version", "text"),
	s("inverter.swVersion", "Software version", "Software-Version", "text"),
	n("inverter.temperature", "Temperature", "Temperatur", "value.temperature", "\u00b0C"),
	n("inverter.powerLimit", "Power limit", "Leistungslimit", "level", "%", {
		write: true,
		// 2, not 0: the command handler rejects anything below POWER_LIMIT_MIN, so a state that
		// advertised 0 promised a range the adapter refuses to send.
		min: 2,
		max: 100,
		source: "local",
	}),
	n("inverter.activePowerLimit", "Active power limit (live)", "Aktives Leistungslimit (live)", "value", "%", {
		source: "local",
	}),
	// No source restriction: available for both local and cloud-only devices. The command handler
	// routes to the local TCP link when connected, otherwise sends the same command over the cloud.
	b("inverter.active", "Inverter active", "Wechselrichter aktiv", "switch", { write: true }),
	b("inverter.reboot", "Reboot inverter", "Wechselrichter neustarten", "button", { write: true }),
	n("inverter.powerFactorLimit", "Power factor limit", "Leistungsfaktor-Limit", "level", "", {
		write: true,
		min: -1,
		max: 1,
		source: "local",
	}),
	n("inverter.reactivePowerLimit", "Reactive power limit", "Blindleistungs-Limit", "level", "°", {
		write: true,
		min: -50,
		max: 50,
		source: "local",
	}),
	b("inverter.cleanWarnings", "Acknowledge warnings", "Warnungen quittieren", "button", {
		write: true,
		source: "local",
	}),
	b("inverter.cleanGroundingFault", "Acknowledge grounding fault", "Erdungsfehler quittieren", "button", {
		write: true,
		source: "local",
	}),
	b("inverter.lock", "Lock inverter", "Wechselrichter sperren", "switch", { write: true, source: "local" }),
	n("inverter.warnCount", "SGSMO warning_number (raw value)", "SGSMO-Feld warning_number (Rohwert)", "value", "", {
		source: "local",
	}),
	s(
		"inverter.warnMessage",
		"Active warning message (from WCode alarm list)",
		"Aktive Warnungsmeldung (aus WCode-Alarmliste)",
		"text",
		{ source: "local" },
	),
	n("inverter.linkStatus", "Link status", "Verbindungsstatus", "value", ""),
	// SGSMO field #20 used to be exposed here as "modulation index / signal". It is neither:
	// 0x408136de-0x408136ea loads two adjacent single bytes and packs them as (a << 16) | b. Both
	// are plain increment counters — a is bumped in `dtu_cmd_dispatch_pending` right after
	// `hm_nrf3_build_uart_frame_with_payload` (one per command frame sent to the inverter), b in
	// `hm_nrf3_build_realdata_packet` (one per realtime packet built). They wrap at 256, which is
	// exactly what the erratic readings showed. On the WB series the encoder writes a constant 0
	// into the same slot (`movi55 $r0,#0x0` at 0x4080b636). Internal traffic counters with no
	// meaning for a user — removed rather than published under a name that claims otherwise.
	s("inverter.model", "Model", "Modell", "text", { source: "cloud" }),

	// === DTU ===
	b("dtu.fwUpdateAvailable", "Firmware update available", "Firmware-Update verfügbar", "indicator", {
		source: "cloud",
	}),
	s("dtu.serialNumber", "Serial number", "Seriennummer", "text"),
	s("dtu.hwVersion", "Hardware version", "Hardware-Version", "text"),
	s("dtu.swVersion", "Software version", "Software-Version", "text"),
	// Not dBm: the value the DTU reports in InfoData is the same derived 0-100 signal quality that
	// `config.wifiSignalQuality` and `NetworkInfo.csq` carry, `clamp(2 * (95 - |rssi_dBm|), 0, 100)`.
	// Firmware-verified on both devices: the 0xa201 builder (`hm_build_send_cmd_a201@0x408162f0`)
	// fills `APPInfoDataReqDTO.dtu_info.signal_strength` — field 8 at offset 0x20, field 9 at 0x20
	// inside it, so `$r6+0x40` — from the very byte that holds the clamped quality
	// (2T `4081640a lbsi.gp $r0,[+#-109642]` = 0x6BC9E; 2WB `4080f652 lbsi.gp $r0,[+#-83830]`),
	// not from the neighbouring byte that holds the raw signed dBm. See _fwanalysis/
	// ADAPTER_FINDINGS.md §16.
	n("dtu.signalQuality", "Signal quality", "Signalqualität", "value.signal", "%", { source: "local" }),
	s("dtu.wifiVersion", "WiFi version", "WLAN-Version", "text", { source: "local" }),
	// No source restriction: the command handler routes to the local TCP link when connected,
	// otherwise reboots the DTU over the cloud (ECommandAction.DTU_REBOOT) for cloud-only devices.
	b("dtu.reboot", "Reboot DTU", "DTU neustarten", "button", { write: true }),
	n("dtu.stepTime", "Step time", "Schrittzeit", "value", "s", { source: "local" }),
	n("dtu.accessModel", "Network access mode", "Netzwerk-Zugangsart", "value", "", {
		states: { 0: "GPRS", 1: "WiFi", 2: "Ethernet" },
		source: "local",
	}),
	n("dtu.communicationTime", "Last communication", "Letzte Kommunikation", "value.time", "", { source: "local" }),
	n("dtu.connState", "DTU error code", "DTU Fehlercode", "value", "", { states: { 0: "OK" }, source: "local" }),
	// "dtu.searchResult" used to live here, fed by an AutoSearch (a313) response. That response
	// never arrives: DISPATCH_2T.md lists no handler for a313 on either device, a live probe left
	// it unanswered for 15 s while a311 replied in 0.24 s, and `encodeAutoSearch()` was never
	// called by anything — so the request was not even sent. Removed along with its encoder and
	// handler rather than kept as a state that can only ever stay empty.

	// === Per-device info ===
	b("info.connected", "Connected", "Verbunden", "indicator.connected"),
	n("info.lastResponse", "Last response time", "Letzte Antwortzeit", "value.time", "", { source: "local" }),

	// === Alarms ===
	n("alarms.count", "Alarm count", "Alarmanzahl", "value", "", { source: "local" }),
	n("alarms.activeCount", "Active alarm count", "Aktive Alarme", "value", "", { source: "local" }),
	b("alarms.hasActive", "Has active alarms", "Aktive Alarme vorhanden", "indicator.alarm", { source: "local" }),
	n("alarms.lastCode", "Last alarm code", "Letzter Alarmcode", "value", "", { source: "local" }),
	s("alarms.lastMessage", "Last alarm message", "Letzte Alarmmeldung", "text", { source: "local" }),
	n("alarms.lastStartTime", "Last alarm start time", "Letzter Alarm Startzeit", "value.time", "", {
		source: "local",
	}),
	n("alarms.lastEndTime", "Last alarm end time", "Letzter Alarm Endzeit", "value.time", "", { source: "local" }),
	n("alarms.lastData1", "Last alarm data 1 (raw sensor)", "Letzter Alarm Daten 1 (Rohwert)", "value", "", {
		source: "local",
	}),
	n("alarms.lastData2", "Last alarm data 2 (raw sensor)", "Letzter Alarm Daten 2 (Rohwert)", "value", "", {
		source: "local",
	}),
	s("alarms.json", "All alarms (JSON)", "Alle Alarme (JSON)", "json", { source: "local" }),

	// === Config (from GetConfig) ===
	s("config.serverDomain", "Cloud server domain", "Cloud-Server Domain", "text", { source: "local" }),
	n("config.serverPort", "Cloud server port", "Cloud-Server Port", "value", "", { source: "local" }),
	n("config.serverSendTime", "Cloud send interval", "Cloud-Sendeintervall", "level", "min", {
		write: true,
		source: "local",
	}),
	// Persistent power limit stored in the DTU (SetConfig limit_power_mypower). Survives a
	// power cycle because the DTU re-applies it to the inverter on startup. For dynamic
	// zero-export use inverter.powerLimit (runtime, RAM-only) instead — see README.
	// Deliberately NOT called "persistent": on the HMS-800W-2T the value does not survive a
	// restart (firmware-verified), and the adapter used to promise the opposite.
	n("config.limitPowerMyPower", "Power limit (DTU config field)", "Leistungslimit (DTU-Konfigfeld)", "level", "%", {
		write: true,
		min: 2,
		max: 100,
		source: "local",
	}),
	s("config.wifiSsid", "WiFi SSID", "WLAN SSID", "text", { source: "local" }),
	// NOT dBm, despite the field name. The firmware derives this from the raw RSSI as
	// clamp(2 * (95 - |rssi_dBm|), 0, 100) and calls the two values "rssi" and "wifi_rssi" in its
	// own debug output — this state carries the second one. A live reading of 46 corresponds to
	// roughly -72 dBm. The raw dBm value stays in the neighbouring byte and is not reachable
	// through any message the adapter uses. See _fwanalysis/ADAPTER_FINDINGS.md.
	n("config.wifiSignalQuality", "WiFi signal quality", "WLAN-Signalqualität", "value.signal", "%", {
		source: "local",
	}),
	n("config.netDhcpSwitch", "DHCP enabled", "DHCP aktiviert", "value", "", { source: "local" }),
	s("config.dtuApSsid", "DTU AP SSID", "DTU AP SSID", "text", { source: "local" }),
	n("config.netmodeSelect", "Network mode", "Netzwerkmodus", "value", "", {
		states: { 0: "GPRS", 1: "WiFi", 2: "Ethernet" },
		source: "local",
	}),
	n("config.invType", "Inverter type", "Wechselrichter-Typ", "value", "", { source: "local" }),
	s("config.wifiIpAddress", "WiFi IP address", "WLAN IP-Adresse", "text", { source: "local" }),
	s("config.wifiMacAddress", "WiFi MAC address", "WLAN MAC-Adresse", "text", { source: "local" }),
	// The DTU reports these in every GetConfig; they were decoded but never written anywhere.
	s("config.ipAddress", "IP address", "IP-Adresse", "text", { source: "local" }),
	s("config.subnetMask", "Subnet mask", "Subnetzmaske", "text", { source: "local" }),
	s("config.gateway", "Default gateway", "Standard-Gateway", "text", { source: "local" }),
	s("config.dnsServer", "DNS server", "DNS-Server", "text", { source: "local" }),
	s("config.macAddress", "MAC address", "MAC-Adresse", "text", { source: "local" }),
	// Which meter the DTU is configured for. Empty on a device that cannot take one — the
	// HMS-800W-2T has no meter input at all (firmware-verified), so an empty value there is
	// the correct answer, not a missing read.
	s("config.meterKind", "Meter type", "Zählertyp", "text", { source: "local" }),
	s("config.meterInterface", "Meter interface", "Zähler-Schnittstelle", "text", { source: "local" }),
	n("config.zeroExportEnable", "Zero export enabled", "Nulleinspeisung aktiv", "value", "", {
		source: "local",
	}),
	n("config.zeroExport433Addr", "Zero export 433 MHz address", "Nulleinspeisung 433-MHz-Adresse", "value", "", {
		source: "local",
	}),
	n("config.lockTime", "Inverter lock duration", "Wechselrichter-Sperrdauer", "value", "s", {
		source: "local",
	}),

	// === Grid profile (from DevConfigFetch, local) ===
	...gridProfileStates,
];

// === Station channels & states (prefixed with station-<stationId>.) ===

const stationChannels: ChannelDefinition[] = [
	{ id: "grid", name: { en: "Station grid output", de: "Anlagen-Netzeinspeisung" } },
	{ id: "info", name: { en: "Station info", de: "Anlagen-Info" } },
	{ id: "weather", name: { en: "Weather at station", de: "Wetter am Standort" } },
	{ id: "warn", name: { en: "Station warnings", de: "Anlagen-Warnungen" } },
];

const stationStates: StateDefinition[] = [
	// Grid aggregates
	n("grid.power", "Total power", "Gesamtleistung", "value.power", "W"),
	// Realtime power-flow (from the burst channel m:0). Created on demand — only present when the
	// realtime burst is active for the station. Non-zero grid/battery only on metered/battery systems.
	n("grid.gridPower", "Grid exchange power", "Netzaustauschleistung", "value.power", "W"),
	n("grid.loadPower", "Load power", "Lastleistung", "value.power", "W"),
	n("grid.batteryPower", "Battery power", "Batterieleistung", "value.power", "W"),
	n("grid.pvUtilization", "PV utilization", "PV-Auslastung", "value", "%"),
	// Plants with a battery or a grid meter only (created on demand): the day's energy balance as
	// the S-Miles dashboard shows it. Checked against the portal: `efg_total` = "from grid",
	// `e2g_total` = "to grid". The battery's share lives in the station's `battery` channel.
	n("grid.consumptionToday", "Consumption today", "Verbrauch heute", "value.energy", "kWh"),
	n("grid.gridImportToday", "Grid import today", "Netzbezug heute", "value.energy", "kWh"),
	n("grid.gridExportToday", "Grid export today", "Netzeinspeisung heute", "value.energy", "kWh"),
	n("grid.dailyEnergy", "Daily energy", "Tagesenergie", "value.energy", "kWh"),
	n("grid.monthEnergy", "Month energy", "Monatsenergie", "value.energy", "kWh"),
	n("grid.yearEnergy", "Year energy", "Jahresenergie", "value.energy", "kWh"),
	n("grid.totalEnergy", "Total energy (AC)", "Gesamtenergie (AC)", "value.energy", "kWh"),
	n("grid.co2Saved", "CO2 saved", "CO2-Einsparung", "value", "kg"),
	n("grid.treesPlanted", "Trees planted equivalent", "Bäume-Äquivalent", "value", ""),
	b("grid.isBalance", "Zero export active", "Nulleinspeisung aktiv", "indicator"),
	b("grid.isReflux", "Feed-in active", "Rückspeisung aktiv", "indicator"),
	n("grid.electricityPrice", "Electricity price", "Strompreis", "value", "/kWh"),
	s("grid.currency", "Currency", "Währung", "text"),
	n("grid.todayIncome", "Today income", "Tagesertrag", "value", ""),
	n("grid.totalIncome", "Total income", "Gesamtertrag", "value", ""),

	// Station info
	s("info.stationName", "Station name", "Anlagenname", "text"),
	n("info.stationId", "Station ID", "Anlagen-ID", "value", ""),
	n("info.systemCapacity", "System capacity", "Anlagenleistung", "value", "kWp"),
	s("info.address", "Station address", "Anlagenstandort", "text"),
	n("info.latitude", "Latitude", "Breitengrad", "value.gps.latitude", "\u00b0"),
	n("info.longitude", "Longitude", "Längengrad", "value.gps.longitude", "\u00b0"),
	n("info.stationStatus", "Station status", "Anlagenstatus", "value", "", {
		states: {
			0: "Offline",
			10: "Standby",
			20: "Starting",
			30: "Producing",
			40: "Producing (normal)",
			50: "Fault",
			60: "Maintenance",
		},
	}),
	n("info.installedAt", "Installation date", "Installationsdatum", "value.time", ""),
	s("info.timezone", "Timezone", "Zeitzone", "text"),
	n("info.lastCloudUpdate", "Last cloud update", "Letztes Cloud-Update", "value.time", ""),
	n("info.lastDataTime", "Last DTU data time", "Letzte DTU-Datenzeit", "value.time", ""),

	// Weather
	s("weather.icon", "Weather icon code (OpenWeatherMap)", "Wetter-Icon-Code (OpenWeatherMap)", "weather.icon"),
	s("weather.description", "Weather description", "Wetterbeschreibung", "weather.state"),
	n("weather.temperature", "Temperature", "Temperatur", "value.temperature", "°C"),
	n("weather.sunrise", "Sunrise", "Sonnenaufgang", "date.sunrise", ""),
	n("weather.sunset", "Sunset", "Sonnenuntergang", "date.sunset", ""),

	// Station warnings (warn_data — cloud only). Field meanings verified against the
	// S-Miles app decompile. `l3_warn` aggregates microinverter alarms (e.g. "PVx no
	// input" when a string is pulled), hence "Inverter alarm". `powerLimited`/`pw_off`
	// is only present in the installer `station/find` record — the home `realtime_c`
	// fallback omits it, so it stays false on home accounts (see README).
	b("warn.stationOffline", "Station offline", "Anlage offline", "indicator.alarm"),
	b("warn.gridUnstable", "Grid voltage unstable", "Netzspannung instabil", "indicator.alarm"),
	b("warn.gridFault", "Grid fault", "Netzfehler", "indicator.alarm"),
	b("warn.deviceAlarm", "Inverter alarm", "Wechselrichter-Alarm", "indicator.alarm"),
	b("warn.deviceIdWarning", "Device ID warning", "Geräte-ID-Warnung", "indicator.alarm"),
	b("warn.meterFault", "Meter fault", "Zählerfehler", "indicator.alarm"),
	b("warn.powerLimited", "Power output limited", "Leistungsreduktion aktiv", "indicator.alarm"),
];

/**
 * Lookup map (suffix → definition) for cloud-station states. Used by the poller's
 * `writeStationState` helper to create state objects on demand.
 */
const stationStateMap: Map<string, StateDefinition> = new Map(stationStates.map(d => [d.id, d]));

/**
 * Build the ioBroker `common` block from a state definition. Mirrors the prior
 * inline construction in `_createStationDevice` so the on-demand path produces
 * the same object shape.
 *
 * @param def - Definition entry from `states` / `stationStates`.
 */
function buildStateCommon(def: StateDefinition): ioBroker.StateCommon {
	return {
		name: def.name,
		type: def.type,
		role: def.role,
		unit: def.unit || "",
		read: true,
		write: !!def.write,
		def: def.type === "boolean" ? false : def.type === "number" ? 0 : "",
		states: def.states,
	};
}

export type { ChannelDefinition, StateDefinition };
export { channels, states, stationChannels, stationStates, stationStateMap, buildStateCommon };
