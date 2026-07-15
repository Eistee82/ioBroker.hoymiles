/**
 * Hoymiles Microinverter Alarm/Warning Codes
 *
 * The WCode field in the AlarmData protobuf message maps to these codes. They are used
 * across HM, HMS, and HMT series microinverters.
 *
 * Two sources, merged at the bottom into {@link ALARM_CODES}:
 * - {@link MWC_ALARM_CODES} (`./alarmCodesData.ts`): auto-generated from the Hoymiles cloud
 *   `monitor/api/0/option/mwc` dictionary, localized into all supported languages by the
 *   cloud itself. Regenerate via `.dev-server/fetch-alarm-codes.mjs`.
 * - {@link EXTRA_CODES} (below): hand-maintained codes the cloud dictionary does not list
 *   (DTU/system/Gen2 codes and field-observed codes). English + German only; other
 *   languages fall back to English.
 */
import { MWC_ALARM_CODES } from "./alarmCodesData.js";

/** Adapter-supported languages for alarm texts (the 11 ioBroker translation languages). */
type AlarmLang = "en" | "de" | "ru" | "pt" | "nl" | "fr" | "it" | "es" | "pl" | "uk" | "zh-cn";

/**
 * One alarm code's text in the supported languages. `en` is always present; every other
 * language is optional and falls back to `en` when absent (see {@link getAlarmDescription}).
 */
export type AlarmTranslation = { en: string } & Partial<Record<AlarmLang, string>>;

/**
 * Codes not present in the cloud `mwc` dictionary — DTU/system-level and Gen2 codes from the
 * S-Miles app's `warn_code.json`, plus codes observed in the field. English + German only.
 */
const EXTRA_CODES: Record<number, AlarmTranslation> = {
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
	// Code 38: undocumented, not in the S-Miles app warn_code.json nor the cloud mwc dictionary.
	// Observed when the inverter shuts down at sunset due to low input power.
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

/**
 * All alarm codes. The cloud `mwc` dictionary wins on the (few) overlapping codes because it is
 * authoritative and fully localized; `EXTRA_CODES` supplies everything the cloud does not list.
 */
const ALARM_CODES: Record<number, AlarmTranslation> = { ...EXTRA_CODES, ...MWC_ALARM_CODES };

/**
 * Get the alarm description for a given code in the requested language, falling back to English
 * when that language is not available for the code.
 *
 * @param code - The alarm/warning code
 * @param lang - Language code (one of the supported adapter languages); defaults to "en"
 * @returns The localized alarm description, or "Unknown code: {code}" if the code is unknown
 */
function getAlarmDescription(code: number, lang?: string): string {
	const l = (lang || "en") as keyof AlarmTranslation;
	const entry = ALARM_CODES[code];
	if (!entry) {
		// The inverter firmware can raise codes neither the app nor the cloud documents —
		// surface the raw number so it isn't lost.
		return l === "de" ? `Unbekannter Code: ${code}` : `Unknown code: ${code}`;
	}
	return entry[l] || entry.en;
}

export { ALARM_CODES, getAlarmDescription };
