import { MWC_ALARM_CODES } from "./alarmCodesData.js";
const EXTRA_CODES = {
    1: { en: "Reset", de: "Neustart" },
    2: { en: "Time calibration", de: "Zeitkalibrierung" },
    3: {
        en: "EEPROM reading and writing error during operation",
        de: "EEPROM Lese-/Schreibfehler während des Betriebs",
    },
    4: { en: "Offline", de: "Offline" },
    11: { en: "Grid voltage surge", de: "Netzspannungsstoß" },
    12: { en: "Grid voltage sharp drop", de: "Starker Netzspannungsabfall" },
    13: { en: "Grid frequency mutation", de: "Sprunghafte Netzfrequenzänderung" },
    14: { en: "Grid phase mutation", de: "Sprunghafte Netzphasenänderung" },
    15: { en: "Grid transient fluctuation", de: "Transiente Netzschwankung" },
    36: { en: "INV overvoltage or overcurrent", de: "Wechselrichter Überspannung oder Überstrom" },
    38: { en: "Insufficient input power (shutting down)", de: "Eingangsleistung zu gering (Abschaltung)" },
    46: { en: "FB overvoltage", de: "FB Überspannung" },
    47: { en: "FB overcurrent", de: "FB Überstrom" },
    48: { en: "FB clamp overvoltage", de: "FB-Klemmung Überspannung" },
    49: { en: "FB clamp overvoltage", de: "FB-Klemmung Überspannung" },
    61: { en: "Calibration parameter error", de: "Kalibrierungsparameter fehlerhaft" },
    62: { en: "System configuration parameter error", de: "Systemkonfigurationsparameter fehlerhaft" },
    63: { en: "Abnormal power generation data", de: "Abnormale Stromerzeugungsdaten" },
    71: {
        en: "VW function enable (grid overvoltage power reduction)",
        de: "VW-Funktion aktiv (Leistungsreduzierung bei Netzüberspannung)",
    },
    72: {
        en: "FW function enable (grid overfrequency power reduction)",
        de: "FW-Funktion aktiv (Leistungsreduzierung bei Netzüberfrequenz)",
    },
    73: {
        en: "TW function enable (over-temperature power reduction)",
        de: "TW-Funktion aktiv (Leistungsreduzierung bei Übertemperatur)",
    },
    95: { en: "PV1 module in suspected shadow", de: "PV1-Modul vermutlich verschattet" },
    96: { en: "PV2 module in suspected shadow", de: "PV2-Modul vermutlich verschattet" },
    97: { en: "PV3 module in suspected shadow", de: "PV3-Modul vermutlich verschattet" },
    98: { en: "PV4 module in suspected shadow", de: "PV4-Modul vermutlich verschattet" },
    124: { en: "Shut down by remote control", de: "Ferngesteuert abgeschaltet" },
    126: { en: "EEPROM reading and writing error", de: "EEPROM Lese-/Schreibfehler" },
    130: { en: "Offline", de: "Offline" },
    150: { en: "DCI exceeded", de: "DC-Anteil überschritten" },
    182: { en: "Abnormal grounding", de: "Abnormale Erdung" },
    1111: { en: "Repeater", de: "Repeater" },
    2000: { en: "Standby", de: "Standby" },
    2001: { en: "Standby", de: "Standby" },
    2002: { en: "Standby", de: "Standby" },
    2003: { en: "Standby", de: "Standby" },
    2004: { en: "Standby", de: "Standby" },
    3001: { en: "Reset", de: "Neustart" },
    3002: { en: "Reset", de: "Neustart" },
    3003: { en: "Reset", de: "Neustart" },
    3004: { en: "Reset", de: "Neustart" },
    5011: { en: "PV1 MOSFET overcurrent", de: "PV1 MOSFET Überstrom" },
    5012: { en: "PV2 MOSFET overcurrent", de: "PV2 MOSFET Überstrom" },
    5013: { en: "PV3 MOSFET overcurrent", de: "PV3 MOSFET Überstrom" },
    5014: { en: "PV4 MOSFET overcurrent", de: "PV4 MOSFET Überstrom" },
    5020: { en: "H-bridge MOSFET overcurrent or overvoltage", de: "H-Brücke MOSFET Überstrom oder Überspannung" },
    5041: { en: "PV1 input overcurrent", de: "PV1 Eingangsstrom zu hoch" },
    5042: { en: "PV2 input overcurrent", de: "PV2 Eingangsstrom zu hoch" },
    5043: { en: "PV3 input overcurrent", de: "PV3 Eingangsstrom zu hoch" },
    5044: { en: "PV4 input overcurrent", de: "PV4 Eingangsstrom zu hoch" },
    5060: { en: "Abnormal bias", de: "Abnormale Vorspannung" },
    5141: { en: "FB clamp overvoltage", de: "FB-Klemmung Überspannung" },
    5142: { en: "FB clamp overvoltage", de: "FB-Klemmung Überspannung" },
    5143: { en: "FB clamp overvoltage", de: "FB-Klemmung Überspannung" },
    5144: { en: "FB clamp overvoltage", de: "FB-Klemmung Überspannung" },
    5160: { en: "Grid transient fluctuation", de: "Transiente Netzschwankung" },
};
const ALARM_CODES = { ...EXTRA_CODES, ...MWC_ALARM_CODES };
function getAlarmDescription(code, lang) {
    const l = (lang || "en");
    const entry = ALARM_CODES[code];
    if (!entry) {
        return l === "de" ? `Unbekannter Code: ${code}` : `Unknown code: ${code}`;
    }
    return entry[l] || entry.en;
}
export { ALARM_CODES, getAlarmDescription };
//# sourceMappingURL=alarmCodes.js.map