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

// === Per-DTU device channels & states (prefixed with <dtuSerial>.) ===

const channels: ChannelDefinition[] = [
	{ id: "info", name: { en: "Device information", de: "Geräteinformationen" } },
	{ id: "grid", name: { en: "Grid output", de: "Netzeinspeisung" } },
	// PV channels (pv0, pv1, pv2, pv3) are created dynamically based on pvNumber
	{ id: "inverter", name: { en: "Inverter", de: "Wechselrichter" } },
	{ id: "dtu", name: { en: "DTU", de: "DTU" } },
	{ id: "alarms", name: { en: "Alarms & warnings", de: "Alarme & Warnungen" }, source: "local" },
	{ id: "config", name: { en: "DTU configuration", de: "DTU-Konfiguration" }, source: "local" },
	// meter channel is created dynamically when meter data is first received
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
		min: 0,
		max: 100,
		source: "local",
	}),
	n("inverter.activePowerLimit", "Active power limit (live)", "Aktives Leistungslimit (live)", "value", "%", {
		source: "local",
	}),
	b("inverter.active", "Inverter active", "Wechselrichter aktiv", "switch", { write: true, source: "local" }),
	b("inverter.reboot", "Reboot inverter", "Wechselrichter neustarten", "button", { write: true, source: "local" }),
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
	b("inverter.cleanWarnings", "Clean warnings", "Warnungen löschen", "button", { write: true, source: "local" }),
	b("inverter.cleanGroundingFault", "Clean grounding fault", "Erdungsfehler löschen", "button", {
		write: true,
		source: "local",
	}),
	b("inverter.lock", "Lock inverter", "Wechselrichter sperren", "switch", { write: true, source: "local" }),
	n("inverter.warnCount", "Active warning code", "Aktiver Warnungscode", "value", "", { source: "local" }),
	s("inverter.warnMessage", "Active warning message", "Aktive Warnungsmeldung", "text", { source: "local" }),
	n("inverter.linkStatus", "Link status", "Verbindungsstatus", "value", ""),
	s("inverter.model", "Model", "Modell", "text", { source: "cloud" }),

	// === DTU ===
	b("dtu.fwUpdateAvailable", "Firmware update available", "Firmware-Update verfügbar", "indicator", {
		source: "cloud",
	}),
	s("dtu.serialNumber", "Serial number", "Seriennummer", "text"),
	s("dtu.hwVersion", "Hardware version", "Hardware-Version", "text"),
	s("dtu.swVersion", "Software version", "Software-Version", "text"),
	n("dtu.rssi", "Signal strength", "Signalstärke", "value", "dBm", { source: "local" }),
	s("dtu.wifiVersion", "WiFi version", "WLAN-Version", "text", { source: "local" }),
	b("dtu.reboot", "Reboot DTU", "DTU neustarten", "button", { write: true, source: "local" }),
	n("dtu.stepTime", "Step time", "Schrittzeit", "value", "s", { source: "local" }),
	n("dtu.rfHwVersion", "RF hardware version", "RF Hardware-Version", "value", "", { source: "local" }),
	n("dtu.rfSwVersion", "RF software version", "RF Software-Version", "value", "", { source: "local" }),
	n("dtu.accessModel", "Network access mode", "Netzwerk-Zugangsart", "value", "", {
		states: { 0: "GPRS", 1: "WiFi", 2: "Ethernet" },
		source: "local",
	}),
	n("dtu.communicationTime", "Last communication", "Letzte Kommunikation", "value.time", "", { source: "local" }),
	n("dtu.connState", "DTU error code", "DTU Fehlercode", "value", "", { states: { 0: "OK" }, source: "local" }),
	n("dtu.mode485", "RS485 mode", "RS485 Modus", "value", "", {
		states: { 0: "Reflux/Auto", 1: "Remote Control" },
		source: "local",
	}),
	n("dtu.sub1gFrequencyBand", "Sub-1G frequency band", "Sub-1G Frequenzband", "value", "", { source: "local" }),
	s(
		"dtu.searchResult",
		"AutoSearch result (inverter serials)",
		"AutoSearch-Ergebnis (Wechselrichter-Seriennummern)",
		"json",
		{ source: "local" },
	),

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
	s("config.wifiSsid", "WiFi SSID", "WLAN SSID", "text", { source: "local" }),
	n("config.wifiRssi", "WiFi RSSI", "WLAN Signalstärke", "value", "dBm", { source: "local" }),
	b("config.zeroExportEnable", "Zero export enabled", "Nulleinspeisung aktiviert", "switch.enable", {
		write: true,
		source: "local",
	}),
	n("config.zeroExport433Addr", "Zero export 433MHz address", "Nulleinspeisung 433MHz Adresse", "value", "", {
		source: "local",
	}),
	{
		id: "config.meterKind",
		name: { en: "Meter type", de: "Zählertyp" },
		type: "string",
		role: "text",
		states: {
			0: "No Meter",
			1: "Single-phase",
			2: "Two-phase",
			3: "Three-phase",
			5: "CT (G3)",
			6: "Meter 1S/1T (G3)",
			7: "Meter 2S/2T (G3)",
		},
		unit: "",
		source: "local",
	},
	s("config.meterInterface", "Meter interface", "Zähler-Schnittstelle", "text", { source: "local" }),
	n("config.netDhcpSwitch", "DHCP enabled", "DHCP aktiviert", "value", "", { source: "local" }),
	s("config.dtuApSsid", "DTU AP SSID", "DTU AP SSID", "text", { source: "local" }),
	n("config.netmodeSelect", "Network mode", "Netzwerkmodus", "value", "", {
		states: { 0: "GPRS", 1: "WiFi", 2: "Ethernet" },
		source: "local",
	}),
	n("config.channelSelect", "Channel select", "Kanalauswahl", "value", "", { source: "local" }),
	n("config.sub1gSweepSwitch", "Sub-1G sweep", "Sub-1G Sweep", "value", "", { source: "local" }),
	n("config.sub1gWorkChannel", "Sub-1G work channel", "Sub-1G Arbeitskanal", "value", "", { source: "local" }),
	n("config.invType", "Inverter type", "Wechselrichter-Typ", "value", "", { source: "local" }),
	s("config.netIpAddress", "IP address", "IP-Adresse", "text", { source: "local" }),
	s("config.netSubnetMask", "Subnet mask", "Subnetzmaske", "text", { source: "local" }),
	s("config.netGateway", "Default gateway", "Standard-Gateway", "text", { source: "local" }),
	s("config.wifiIpAddress", "WiFi IP address", "WLAN IP-Adresse", "text", { source: "local" }),
	s("config.netMacAddress", "MAC address", "MAC-Adresse", "text", { source: "local" }),
	s("config.wifiMacAddress", "WiFi MAC address", "WLAN MAC-Adresse", "text", { source: "local" }),
];

// === Station channels & states (prefixed with station-<stationId>.) ===

const stationChannels: ChannelDefinition[] = [
	{ id: "grid", name: { en: "Station grid output", de: "Anlagen-Netzeinspeisung" } },
	{ id: "info", name: { en: "Station info", de: "Anlagen-Info" } },
	{ id: "weather", name: { en: "Weather at station", de: "Wetter am Standort" } },
];

const stationStates: StateDefinition[] = [
	// Grid aggregates
	n("grid.power", "Total power", "Gesamtleistung", "value.power", "W"),
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
	} as ioBroker.StateCommon;
}

export type { ChannelDefinition, StateDefinition };
export { channels, states, stationChannels, stationStates, stationStateMap, buildStateCommon };
