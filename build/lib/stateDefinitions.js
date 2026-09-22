import { GRID_PROFILE_SCHEMA } from "./gridProfile.js";
const n = (id, en, de, role, unit, extra) => ({
    id,
    name: { en, de },
    type: "number",
    role,
    unit,
    ...extra,
});
const s = (id, en, de, role, extra) => ({
    id,
    name: { en, de },
    type: "string",
    role,
    unit: "",
    ...extra,
});
const b = (id, en, de, role, extra) => ({
    id,
    name: { en, de },
    type: "boolean",
    role,
    unit: "",
    ...extra,
});
export const meterControlStates = [
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
export const meterMeasurementStates = [
    n("meter.gridPower", "Grid exchange power", "Netzaustauschleistung", "value.power", "W", {
        source: "local",
    }),
    n("meter.pvPower", "PV power (meter view)", "PV-Leistung (Zählersicht)", "value.power", "W", {
        source: "local",
    }),
    n("meter.loadPower", "House load", "Hausverbrauch", "value.power", "W", { source: "local" }),
    n("meter.storagePower", "Storage power", "Speicherleistung", "value.power", "W", { source: "local" }),
    n("meter.plugPower", "Plug power", "Steckdosenleistung", "value.power", "W", { source: "local" }),
    n("meter.frequency", "Grid frequency", "Netzfrequenz", "value.frequency", "Hz", { source: "local" }),
    ...[1, 2, 3].flatMap(p => [
        n(`meter.l${p}Voltage`, `Voltage L${p}`, `Spannung L${p}`, "value.voltage", "V", { source: "local" }),
        n(`meter.l${p}Current`, `Current L${p}`, `Strom L${p}`, "value.current", "A", { source: "local" }),
        n(`meter.l${p}Power`, `Power L${p}`, `Leistung L${p}`, "value.power", "W", { source: "local" }),
    ]),
];
export const hybridChannels = [
    { id: "eps", name: { en: "Backup (EPS) output", de: "Notstrom-Ausgang (EPS)" }, source: "cloud" },
    { id: "battery", name: { en: "Battery", de: "Batterie" }, source: "cloud" },
    { id: "dryContact", name: { en: "Dry contacts (relay)", de: "Trockenkontakte (Relais)" }, source: "cloud" },
    { id: "history", name: { en: "Power history", de: "Leistungsverlauf" }, source: "cloud" },
];
export const hybridStates = [
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
    ...[1, 2, 3].flatMap(p => [
        n(`eps.l${p}Voltage`, `EPS voltage L${p}`, `EPS-Spannung L${p}`, "value.voltage", "V", { source: "cloud" }),
        n(`eps.l${p}Current`, `EPS current L${p}`, `EPS-Strom L${p}`, "value.current", "A", { source: "cloud" }),
        n(`eps.l${p}Power`, `EPS active power L${p}`, `EPS-Wirkleistung L${p}`, "value.power", "W", {
            source: "cloud",
        }),
    ]),
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
    n("battery.inverterVoltage", "Battery voltage (at inverter)", "Batteriespannung (am Wechselrichter)", "value.voltage", "V", { source: "cloud" }),
    n("battery.inverterCurrent", "Battery current (at inverter)", "Batteriestrom (am Wechselrichter)", "value.current", "A", { source: "cloud" }),
    n("battery.inverterPower", "Battery power (at inverter)", "Batterieleistung (am Wechselrichter)", "value.power", "W", { source: "cloud" }),
    n("inverter.pvPower", "PV power (all inputs)", "PV-Leistung (alle Eingänge)", "value.power", "W", {
        source: "cloud",
    }),
    n("inverter.pvEnergyToday", "PV energy today", "PV-Energie heute", "value.energy", "kWh", { source: "cloud" }),
    n("inverter.pvHeatsinkTemperature", "PV heatsink temperature", "PV-Kühlkörpertemperatur", "value.temperature", "°C", { source: "cloud" }),
    n("inverter.heatsinkTemperature", "Inverter heatsink temperature", "Wechselrichter-Kühlkörpertemperatur", "value.temperature", "°C", { source: "cloud" }),
    n("inverter.batteryHeatsinkTemperature", "Battery-stage heatsink temperature", "Kühlkörpertemperatur der Batteriestufe", "value.temperature", "°C", { source: "cloud" }),
    s("inverter.powerFaultCode", "Power fault code", "Fehlercode Leistungsteil", "text", { source: "cloud" }),
    s("inverter.safetyFaultCode", "Safety fault code", "Fehlercode Sicherheitsteil", "text", { source: "cloud" }),
    n("battery.cycles", "Charge cycles", "Ladezyklen", "value", "", { source: "cloud" }),
    n("battery.heating", "Heating status", "Heizstatus", "value", "", { source: "cloud" }),
    s("battery.heatingText", "Heating status (text)", "Heizstatus (Text)", "text", { source: "cloud" }),
];
export const batterySettingStates = [
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
];
hybridStates.push(...batterySettingStates);
export const hybridExtraStates = [
    n("dryContact.mode", "Relay mode", "Relaismodus", "value", "", { source: "cloud" }),
    s("dryContact.settingsJson", "Relay settings (JSON)", "Relais-Einstellungen (JSON)", "json", { source: "cloud" }),
    n("dryContact.settingsUpdated", "Settings last read", "Einstellungen zuletzt gelesen", "value.time", "", {
        source: "cloud",
    }),
    b("dryContact.readSettings", "Read relay settings", "Relais-Einstellungen lesen", "button", {
        source: "cloud",
        write: true,
    }),
    n("alarms.cloudActiveCount", "Active alarms (cloud)", "Aktive Alarme (Cloud)", "value", "", { source: "cloud" }),
    s("alarms.cloudActiveJson", "Active alarms (cloud, JSON)", "Aktive Alarme (Cloud, JSON)", "json", {
        source: "cloud",
    }),
    s("history.powerJson", "Power history (JSON)", "Leistungsverlauf (JSON)", "json", { source: "cloud" }),
    s("history.batteryPowerJson", "Battery power history (JSON)", "Batterieleistungsverlauf (JSON)", "json", {
        source: "cloud",
    }),
    s("history.pvPowerJson", "PV power history (JSON)", "PV-Leistungsverlauf (JSON)", "json", { source: "cloud" }),
    s("history.socJson", "State of charge history (JSON)", "Ladezustandsverlauf (JSON)", "json", { source: "cloud" }),
    n("history.startTime", "First sample time", "Zeit des ersten Werts", "value.time", "", { source: "cloud" }),
    n("history.stepTime", "Step between samples", "Abstand der Werte", "value", "s", { source: "cloud" }),
];
hybridStates.push(...hybridExtraStates);
export const hybridStateMap = new Map(hybridStates.map(d => [d.id, d]));
export const stationIndicatorChannels = [
    { id: "gridMeter", name: { en: "Grid meter", de: "Netzzähler" }, source: "cloud" },
    { id: "load", name: { en: "Loads", de: "Verbraucher" }, source: "cloud" },
    {
        id: "pvMeter",
        name: { en: "PV meter (third-party inverter)", de: "PV-Zähler (Fremd-Wechselrichter)" },
        source: "cloud",
    },
    { id: "generator", name: { en: "Generator", de: "Generator" }, source: "cloud" },
];
const acStates = (ch, withCurrent) => [
    ...(withCurrent
        ? [
            n(`${ch}.power`, "Total active power", "Gesamt-Wirkleistung", "value.power", "W", { source: "cloud" }),
            n(`${ch}.reactivePower`, "Total reactive power", "Gesamt-Blindleistung", "value.power.reactive", "var", {
                source: "cloud",
            }),
            n(`${ch}.frequency`, "Frequency", "Frequenz", "value.frequency", "Hz", { source: "cloud" }),
        ]
        : []),
    ...[1, 2, 3].flatMap(p => [
        n(`${ch}.l${p}Voltage`, `Voltage L${p}`, `Spannung L${p}`, "value.voltage", "V", { source: "cloud" }),
        n(`${ch}.l${p}Power`, `Active power L${p}`, `Wirkleistung L${p}`, "value.power", "W", { source: "cloud" }),
        ...(withCurrent
            ? [
                n(`${ch}.l${p}Current`, `Current L${p}`, `Strom L${p}`, "value.current", "A", { source: "cloud" }),
                n(`${ch}.l${p}ReactivePower`, `Reactive power L${p}`, `Blindleistung L${p}`, "value.power.reactive", "var", { source: "cloud" }),
            ]
            : []),
    ]),
];
export const stationIndicatorStates = [
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
    ...acStates("load", false),
    n("load.mode", "Load mode", "Lastmodus", "value", "", { source: "cloud" }),
    s("load.modeText", "Load mode (text)", "Lastmodus (Text)", "text", { source: "cloud" }),
    n("load.energyToday", "Consumed today", "Heute verbraucht", "value.energy", "kWh", { source: "cloud" }),
    ...[1, 2, 3].map(p => n(`load.l${p}EnergyToday`, `Consumed today L${p}`, `Heute verbraucht L${p}`, "value.energy", "kWh", {
        source: "cloud",
    })),
    b("pvMeter.connected", "PV meter online", "PV-Zähler online", "indicator.connected", { source: "cloud" }),
    ...acStates("pvMeter", true),
    n("pvMeter.energyToday", "Energy today", "Energie heute", "value.energy", "kWh", { source: "cloud" }),
    ...[1, 2, 3].map(p => n(`pvMeter.l${p}EnergyToday`, `Energy today L${p}`, `Energie heute L${p}`, "value.energy", "kWh", {
        source: "cloud",
    })),
    n("generator.state", "Generator status", "Generatorstatus", "value", "", { source: "cloud" }),
    s("generator.stateText", "Generator status (text)", "Generatorstatus (Text)", "text", { source: "cloud" }),
    ...acStates("generator", true),
    n("generator.energyToday", "Energy today", "Energie heute", "value.energy", "kWh", { source: "cloud" }),
    ...[1, 2, 3].map(p => n(`generator.l${p}EnergyToday`, `Energy today L${p}`, `Energie heute L${p}`, "value.energy", "kWh", {
        source: "cloud",
    })),
];
export const stationIndicatorStateMap = new Map(stationIndicatorStates.map(d => [d.id, d]));
const channels = [
    { id: "info", name: { en: "Device information", de: "Geräteinformationen" } },
    { id: "grid", name: { en: "Grid output", de: "Netzeinspeisung" } },
    { id: "inverter", name: { en: "Inverter", de: "Wechselrichter" } },
    { id: "dtu", name: { en: "DTU", de: "DTU" } },
    { id: "alarms", name: { en: "Alarms & warnings", de: "Alarme & Warnungen" }, source: "local" },
    { id: "config", name: { en: "DTU configuration", de: "DTU-Konfiguration" }, source: "local" },
    { id: "gridProfile", name: { en: "Grid profile", de: "Netzprofil" } },
];
const gridProfileStates = [
    s("gridProfile.standard", "Grid standard", "Netznorm", "text"),
    ...GRID_PROFILE_SCHEMA.map(p => p.flag
        ? b(`gridProfile.${p.key}`, p.en, p.de, "indicator")
        : n(`gridProfile.${p.key}`, p.en, p.de, "value", p.unit)),
];
const states = [
    n("grid.power", "Grid power", "Netzleistung", "value.power", "W"),
    n("grid.voltage", "Grid voltage", "Netzspannung", "value.voltage", "V"),
    n("grid.current", "Grid current", "Netzstrom", "value.current", "A", { source: "local" }),
    n("grid.frequency", "Grid frequency", "Netzfrequenz", "value", "Hz"),
    n("grid.reactivePower", "Reactive power", "Blindleistung", "value", "var", { source: "local" }),
    n("grid.powerFactor", "Power factor", "Leistungsfaktor", "value", "", { source: "local" }),
    n("grid.dailyEnergy", "Daily energy", "Tagesenergie", "value.energy", "kWh", { source: "local" }),
    s("inverter.serialNumber", "Serial number", "Seriennummer", "text"),
    s("inverter.hwVersion", "Hardware version", "Hardware-Version", "text"),
    s("inverter.swVersion", "Software version", "Software-Version", "text"),
    n("inverter.temperature", "Temperature", "Temperatur", "value.temperature", "\u00b0C"),
    n("inverter.powerLimit", "Power limit", "Leistungslimit", "level", "%", {
        write: true,
        min: 2,
        max: 100,
        source: "local",
    }),
    n("inverter.activePowerLimit", "Active power limit (live)", "Aktives Leistungslimit (live)", "value", "%", {
        source: "local",
    }),
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
    s("inverter.warnMessage", "Active warning message (from WCode alarm list)", "Aktive Warnungsmeldung (aus WCode-Alarmliste)", "text", { source: "local" }),
    n("inverter.linkStatus", "Link status", "Verbindungsstatus", "value", ""),
    s("inverter.model", "Model", "Modell", "text", { source: "cloud" }),
    b("dtu.fwUpdateAvailable", "Firmware update available", "Firmware-Update verfügbar", "indicator", {
        source: "cloud",
    }),
    s("dtu.serialNumber", "Serial number", "Seriennummer", "text"),
    s("dtu.hwVersion", "Hardware version", "Hardware-Version", "text"),
    s("dtu.swVersion", "Software version", "Software-Version", "text"),
    n("dtu.signalQuality", "Signal quality", "Signalqualität", "value.signal", "%", { source: "local" }),
    s("dtu.wifiVersion", "WiFi version", "WLAN-Version", "text", { source: "local" }),
    b("dtu.reboot", "Reboot DTU", "DTU neustarten", "button", { write: true }),
    n("dtu.stepTime", "Step time", "Schrittzeit", "value", "s", { source: "local" }),
    n("dtu.accessModel", "Network access mode", "Netzwerk-Zugangsart", "value", "", {
        states: { 0: "GPRS", 1: "WiFi", 2: "Ethernet" },
        source: "local",
    }),
    n("dtu.communicationTime", "Last communication", "Letzte Kommunikation", "value.time", "", { source: "local" }),
    n("dtu.connState", "DTU error code", "DTU Fehlercode", "value", "", { states: { 0: "OK" }, source: "local" }),
    b("info.connected", "Connected", "Verbunden", "indicator.connected"),
    n("info.lastResponse", "Last response time", "Letzte Antwortzeit", "value.time", "", { source: "local" }),
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
    s("config.serverDomain", "Cloud server domain", "Cloud-Server Domain", "text", { source: "local" }),
    n("config.serverPort", "Cloud server port", "Cloud-Server Port", "value", "", { source: "local" }),
    n("config.serverSendTime", "Cloud send interval", "Cloud-Sendeintervall", "level", "min", {
        write: true,
        source: "local",
    }),
    n("config.limitPowerMyPower", "Power limit (DTU config field)", "Leistungslimit (DTU-Konfigfeld)", "level", "%", {
        write: true,
        min: 2,
        max: 100,
        source: "local",
    }),
    s("config.wifiSsid", "WiFi SSID", "WLAN SSID", "text", { source: "local" }),
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
    s("config.ipAddress", "IP address", "IP-Adresse", "text", { source: "local" }),
    s("config.subnetMask", "Subnet mask", "Subnetzmaske", "text", { source: "local" }),
    s("config.gateway", "Default gateway", "Standard-Gateway", "text", { source: "local" }),
    s("config.dnsServer", "DNS server", "DNS-Server", "text", { source: "local" }),
    s("config.macAddress", "MAC address", "MAC-Adresse", "text", { source: "local" }),
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
    ...gridProfileStates,
];
const stationChannels = [
    { id: "grid", name: { en: "Station grid output", de: "Anlagen-Netzeinspeisung" } },
    { id: "info", name: { en: "Station info", de: "Anlagen-Info" } },
    { id: "weather", name: { en: "Weather at station", de: "Wetter am Standort" } },
    { id: "warn", name: { en: "Station warnings", de: "Anlagen-Warnungen" } },
];
const stationStates = [
    n("grid.power", "Total power", "Gesamtleistung", "value.power", "W"),
    n("grid.gridPower", "Grid exchange power", "Netzaustauschleistung", "value.power", "W"),
    n("grid.loadPower", "Load power", "Lastleistung", "value.power", "W"),
    n("grid.batteryPower", "Battery power", "Batterieleistung", "value.power", "W"),
    n("grid.pvUtilization", "PV utilization", "PV-Auslastung", "value", "%"),
    n("grid.consumptionToday", "Consumption today", "Verbrauch heute", "value.energy", "kWh"),
    n("grid.gridImportToday", "Grid import today", "Netzbezug heute", "value.energy", "kWh"),
    n("grid.gridExportToday", "Grid export today", "Netzeinspeisung heute", "value.energy", "kWh"),
    n("grid.batteryChargeToday", "Battery charged today", "Batterieladung heute", "value.energy", "kWh"),
    n("grid.batteryDischargeToday", "Battery discharged today", "Batterieentladung heute", "value.energy", "kWh"),
    ...[
        ["Month", "this month", "diesen Monat"],
        ["Year", "this year", "dieses Jahr"],
        ["Total", "total", "gesamt"],
    ].flatMap(([p, en, de]) => [
        n(`grid.gridImport${p}`, `Grid import ${en}`, `Netzbezug ${de}`, "value.energy", "kWh"),
        n(`grid.gridExport${p}`, `Grid export ${en}`, `Netzeinspeisung ${de}`, "value.energy", "kWh"),
        n(`grid.consumption${p}`, `Consumption ${en}`, `Verbrauch ${de}`, "value.energy", "kWh"),
        n(`grid.batteryCharge${p}`, `Battery charged ${en}`, `Batterieladung ${de}`, "value.energy", "kWh"),
        n(`grid.batteryDischarge${p}`, `Battery discharged ${en}`, `Batterieentladung ${de}`, "value.energy", "kWh"),
    ]),
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
    n("grid.monthIncome", "Income this month", "Ertrag diesen Monat", "value", ""),
    n("grid.yearIncome", "Income this year", "Ertrag dieses Jahr", "value", ""),
    n("grid.todayCost", "Electricity cost today", "Stromkosten heute", "value", ""),
    n("grid.monthCost", "Electricity cost this month", "Stromkosten diesen Monat", "value", ""),
    n("grid.yearCost", "Electricity cost this year", "Stromkosten dieses Jahr", "value", ""),
    n("grid.totalCost", "Electricity cost total", "Stromkosten gesamt", "value", ""),
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
    s("weather.icon", "Weather icon code (OpenWeatherMap)", "Wetter-Icon-Code (OpenWeatherMap)", "weather.icon"),
    s("weather.description", "Weather description", "Wetterbeschreibung", "weather.state"),
    n("weather.temperature", "Temperature", "Temperatur", "value.temperature", "°C"),
    n("weather.sunrise", "Sunrise", "Sonnenaufgang", "date.sunrise", ""),
    n("weather.sunset", "Sunset", "Sonnenuntergang", "date.sunset", ""),
    b("warn.stationOffline", "Station offline", "Anlage offline", "indicator.alarm"),
    b("warn.gridUnstable", "Grid voltage unstable", "Netzspannung instabil", "indicator.alarm"),
    b("warn.gridFault", "Grid fault", "Netzfehler", "indicator.alarm"),
    b("warn.deviceAlarm", "Inverter alarm", "Wechselrichter-Alarm", "indicator.alarm"),
    b("warn.deviceIdWarning", "Device ID warning", "Geräte-ID-Warnung", "indicator.alarm"),
    b("warn.meterFault", "Meter fault", "Zählerfehler", "indicator.alarm"),
    b("warn.powerLimited", "Power output limited", "Leistungsreduktion aktiv", "indicator.alarm"),
];
const stationStateMap = new Map(stationStates.map(d => [d.id, d]));
function buildStateCommon(def) {
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
export { channels, states, stationChannels, stationStates, stationStateMap, buildStateCommon };
//# sourceMappingURL=stateDefinitions.js.map