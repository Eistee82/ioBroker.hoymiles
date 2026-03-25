"use strict";

const channels = [
    { id: "grid", name: { en: "Grid output", de: "Netzeinspeisung" } },
    { id: "pv0", name: { en: "PV input 0", de: "PV-Eingang 0" } },
    { id: "pv1", name: { en: "PV input 1", de: "PV-Eingang 1" } },
    { id: "inverter", name: { en: "Inverter status", de: "Wechselrichter-Status" } },
    { id: "info", name: { en: "Device information", de: "Geräteinformationen" } },
    { id: "alarms", name: { en: "Alarms & warnings", de: "Alarme & Warnungen" } },
    { id: "events", name: { en: "Events", de: "Ereignisse" } },
    { id: "history", name: { en: "Historical data", de: "Historische Daten" } },
    { id: "config", name: { en: "DTU configuration", de: "DTU-Konfiguration" } },
];

const states = [
    // Grid (from SGSMO)
    { id: "grid.power", name: { en: "Grid power", de: "Netzleistung" }, type: "number", role: "value.power", unit: "W" },
    { id: "grid.voltage", name: { en: "Grid voltage", de: "Netzspannung" }, type: "number", role: "value.voltage", unit: "V" },
    { id: "grid.current", name: { en: "Grid current", de: "Netzstrom" }, type: "number", role: "value.current", unit: "A" },
    { id: "grid.frequency", name: { en: "Grid frequency", de: "Netzfrequenz" }, type: "number", role: "value", unit: "Hz" },
    { id: "grid.reactivePower", name: { en: "Reactive power", de: "Blindleistung" }, type: "number", role: "value", unit: "var" },
    { id: "grid.powerFactor", name: { en: "Power factor", de: "Leistungsfaktor" }, type: "number", role: "value", unit: "" },
    { id: "grid.dailyEnergy", name: { en: "Daily energy", de: "Tagesenergie" }, type: "number", role: "value.energy", unit: "Wh" },
    { id: "grid.totalEnergy", name: { en: "Total energy", de: "Gesamtenergie" }, type: "number", role: "value.energy", unit: "Wh" },

    // PV0
    { id: "pv0.power", name: { en: "PV0 power", de: "PV0 Leistung" }, type: "number", role: "value.power", unit: "W" },
    { id: "pv0.voltage", name: { en: "PV0 voltage", de: "PV0 Spannung" }, type: "number", role: "value.voltage", unit: "V" },
    { id: "pv0.current", name: { en: "PV0 current", de: "PV0 Strom" }, type: "number", role: "value.current", unit: "A" },
    { id: "pv0.dailyEnergy", name: { en: "PV0 daily energy", de: "PV0 Tagesenergie" }, type: "number", role: "value.energy", unit: "Wh" },
    { id: "pv0.totalEnergy", name: { en: "PV0 total energy", de: "PV0 Gesamtenergie" }, type: "number", role: "value.energy", unit: "Wh" },

    // PV1
    { id: "pv1.power", name: { en: "PV1 power", de: "PV1 Leistung" }, type: "number", role: "value.power", unit: "W" },
    { id: "pv1.voltage", name: { en: "PV1 voltage", de: "PV1 Spannung" }, type: "number", role: "value.voltage", unit: "V" },
    { id: "pv1.current", name: { en: "PV1 current", de: "PV1 Strom" }, type: "number", role: "value.current", unit: "A" },
    { id: "pv1.dailyEnergy", name: { en: "PV1 daily energy", de: "PV1 Tagesenergie" }, type: "number", role: "value.energy", unit: "Wh" },
    { id: "pv1.totalEnergy", name: { en: "PV1 total energy", de: "PV1 Gesamtenergie" }, type: "number", role: "value.energy", unit: "Wh" },

    // Inverter
    { id: "inverter.temperature", name: { en: "Temperature", de: "Temperatur" }, type: "number", role: "value.temperature", unit: "°C" },
    { id: "inverter.powerLimit", name: { en: "Power limit (current)", de: "Leistungslimit (aktuell)" }, type: "number", role: "value", unit: "%" },
    { id: "inverter.powerLimitSet", name: { en: "Set power limit", de: "Leistungslimit setzen" }, type: "number", role: "level", unit: "%", write: true, min: 2, max: 100 },
    { id: "inverter.active", name: { en: "Inverter active", de: "Wechselrichter aktiv" }, type: "boolean", role: "switch", write: true },
    { id: "inverter.reboot", name: { en: "Reboot inverter", de: "Wechselrichter neustarten" }, type: "boolean", role: "button", write: true },
    { id: "inverter.warnCount", name: { en: "Warning count", de: "Warnungsanzahl" }, type: "number", role: "value", unit: "" },
    { id: "inverter.linkStatus", name: { en: "Link status", de: "Verbindungsstatus" }, type: "number", role: "value", unit: "" },
    { id: "inverter.rfSignal", name: { en: "RF signal", de: "RF-Signal" }, type: "number", role: "value", unit: "" },
    { id: "inverter.serialNumber", name: { en: "Serial number", de: "Seriennummer" }, type: "string", role: "text", unit: "" },
    { id: "inverter.firmwareVersion", name: { en: "Firmware version", de: "Firmware-Version" }, type: "number", role: "value", unit: "" },
    { id: "inverter.crcChecksum", name: { en: "CRC checksum", de: "CRC-Prüfsumme" }, type: "number", role: "value", unit: "" },
    { id: "inverter.dtuPower", name: { en: "DTU reported power", de: "DTU gemeldete Leistung" }, type: "number", role: "value.power", unit: "W" },
    { id: "inverter.dtuDailyEnergy", name: { en: "DTU daily energy", de: "DTU Tagesenergie" }, type: "number", role: "value.energy", unit: "Wh" },

    // Info
    { id: "info.connection", name: { en: "DTU connected", de: "DTU verbunden" }, type: "boolean", role: "indicator.connected", unit: "" },
    { id: "info.dtuConnState", name: { en: "DTU connection state", de: "DTU Verbindungsstatus" }, type: "number", role: "value", unit: "" },
    { id: "info.lastResponse", name: { en: "Last response time", de: "Letzte Antwortzeit" }, type: "number", role: "value.time", unit: "" },
    { id: "info.dtuRssi", name: { en: "DTU signal strength", de: "DTU Signalstärke" }, type: "number", role: "value", unit: "dBm" },
    { id: "info.firmwareVersion", name: { en: "Gateway firmware", de: "Gateway-Firmware" }, type: "string", role: "text", unit: "" },
    { id: "info.dtuSerial", name: { en: "DTU serial number", de: "DTU Seriennummer" }, type: "string", role: "text", unit: "" },
    { id: "info.inverterSerial", name: { en: "Inverter serial number", de: "Wechselrichter Seriennummer" }, type: "string", role: "text", unit: "" },
    { id: "info.dtuHwVersion", name: { en: "DTU hardware version", de: "DTU Hardware-Version" }, type: "string", role: "text", unit: "" },
    { id: "info.dtuSwVersion", name: { en: "DTU software version", de: "DTU Software-Version" }, type: "string", role: "text", unit: "" },
    { id: "info.inverterHwVersion", name: { en: "Inverter hardware version", de: "Wechselrichter Hardware-Version" }, type: "string", role: "text", unit: "" },
    { id: "info.inverterSwVersion", name: { en: "Inverter software version", de: "Wechselrichter Software-Version" }, type: "string", role: "text", unit: "" },
    { id: "info.cloudPaused", name: { en: "Cloud pause active", de: "Cloud-Pause aktiv" }, type: "boolean", role: "indicator", unit: "" },

    // Alarms
    { id: "alarms.count", name: { en: "Alarm count", de: "Alarmanzahl" }, type: "number", role: "value", unit: "" },
    { id: "alarms.lastCode", name: { en: "Last alarm code", de: "Letzter Alarmcode" }, type: "number", role: "value", unit: "" },
    { id: "alarms.lastMessage", name: { en: "Last alarm message", de: "Letzte Alarmmeldung" }, type: "string", role: "text", unit: "" },
    { id: "alarms.lastTime", name: { en: "Last alarm time", de: "Letzte Alarmzeit" }, type: "number", role: "value.time", unit: "" },
    { id: "alarms.json", name: { en: "All alarms (JSON)", de: "Alle Alarme (JSON)" }, type: "string", role: "json", unit: "" },

    // Events
    { id: "events.lastCode", name: { en: "Last event code", de: "Letzter Ereigniscode" }, type: "number", role: "value", unit: "" },
    { id: "events.lastGridVoltage", name: { en: "Event grid voltage", de: "Ereignis Netzspannung" }, type: "number", role: "value.voltage", unit: "V" },
    { id: "events.lastGridFrequency", name: { en: "Event grid frequency", de: "Ereignis Netzfrequenz" }, type: "number", role: "value", unit: "Hz" },
    { id: "events.lastGridPower", name: { en: "Event grid power", de: "Ereignis Netzleistung" }, type: "number", role: "value.power", unit: "W" },
    { id: "events.lastPvVoltage", name: { en: "Event PV voltage", de: "Ereignis PV-Spannung" }, type: "number", role: "value.voltage", unit: "V" },
    { id: "events.lastTemperature", name: { en: "Event temperature", de: "Ereignis Temperatur" }, type: "number", role: "value.temperature", unit: "°C" },
    { id: "events.lastTime", name: { en: "Event time", de: "Ereigniszeitpunkt" }, type: "number", role: "value.time", unit: "" },
    { id: "events.json", name: { en: "All events (JSON)", de: "Alle Ereignisse (JSON)" }, type: "string", role: "json", unit: "" },

    // History
    { id: "history.powerJson", name: { en: "Power history (JSON)", de: "Leistungsverlauf (JSON)" }, type: "string", role: "json", unit: "" },

    // Config (from GetConfig)
    { id: "config.serverDomain", name: { en: "Cloud server domain", de: "Cloud-Server Domain" }, type: "string", role: "text", unit: "" },
    { id: "config.serverPort", name: { en: "Cloud server port", de: "Cloud-Server Port" }, type: "number", role: "value", unit: "" },
    { id: "config.serverSendTime", name: { en: "Cloud send interval", de: "Cloud-Sendeintervall" }, type: "number", role: "value", unit: "s" },
    { id: "config.wifiSsid", name: { en: "WiFi SSID", de: "WLAN SSID" }, type: "string", role: "text", unit: "" },
    { id: "config.wifiRssi", name: { en: "WiFi RSSI", de: "WLAN Signalstärke" }, type: "number", role: "value", unit: "dBm" },
    { id: "config.zeroExportEnable", name: { en: "Zero export enabled", de: "Nulleinspeisung aktiviert" }, type: "boolean", role: "indicator", unit: "" },
    { id: "config.dhcpSwitch", name: { en: "DHCP enabled", de: "DHCP aktiviert" }, type: "number", role: "value", unit: "" },
];

module.exports = { channels, states };
