/**
 * Hoymiles Microinverter Alarm/Warning Codes
 *
 * Source: S-Miles Enduser APK - assets/warn_code.json
 * These codes are used across HM, HMS, and HMT series microinverters.
 * The WCode field in the AlarmData protobuf message maps to these codes.
 *
 * German translations provided where the Chinese source text clarifies
 * the technical meaning beyond what the English translation conveys.
 */

interface AlarmTranslation {
	en: string;
	de: string;
}

const ALARM_CODES: Record<number, AlarmTranslation> = {
	1: {
		en: "Reset",
		de: "Neustart",
	},
	2: {
		en: "Time calibration",
		de: "Zeitkalibrierung",
	},
	3: {
		en: "EEPROM reading and writing error during operation",
		de: "EEPROM Lese-/Schreibfehler während des Betriebs",
	},
	4: {
		en: "Offline",
		de: "Offline",
	},
	11: {
		en: "Grid voltage surge",
		de: "Netzspannungsstoß",
	},
	12: {
		en: "Grid voltage sharp drop",
		de: "Starker Netzspannungsabfall",
	},
	13: {
		en: "Grid frequency mutation",
		de: "Sprunghafte Netzfrequenzänderung",
	},
	14: {
		en: "Grid phase mutation",
		de: "Sprunghafte Netzphasenänderung",
	},
	15: {
		en: "Grid transient fluctuation",
		de: "Transiente Netzschwankung",
	},
	36: {
		en: "INV overvoltage or overcurrent",
		de: "Wechselrichter Überspannung oder Überstrom",
	},
	46: {
		en: "FB overvoltage",
		de: "FB Überspannung",
	},
	47: {
		en: "FB overcurrent",
		de: "FB Überstrom",
	},
	48: {
		en: "FB clamp overvoltage",
		de: "FB-Klemmung Überspannung",
	},
	49: {
		en: "FB clamp overvoltage",
		de: "FB-Klemmung Überspannung",
	},
	61: {
		en: "Calibration parameter error",
		de: "Kalibrierungsparameter fehlerhaft",
	},
	62: {
		en: "System configuration parameter error",
		de: "Systemkonfigurationsparameter fehlerhaft",
	},
	63: {
		en: "Abnormal power generation data",
		de: "Abnormale Stromerzeugungsdaten",
	},
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
	95: {
		en: "PV1 module in suspected shadow",
		de: "PV1-Modul vermutlich verschattet",
	},
	96: {
		en: "PV2 module in suspected shadow",
		de: "PV2-Modul vermutlich verschattet",
	},
	97: {
		en: "PV3 module in suspected shadow",
		de: "PV3-Modul vermutlich verschattet",
	},
	98: {
		en: "PV4 module in suspected shadow",
		de: "PV4-Modul vermutlich verschattet",
	},
	121: {
		en: "Over temperature protection",
		de: "Übertemperaturschutz",
	},
	122: {
		en: "Microinverter is suspected of being stolen",
		de: "Mikrowechselrichter steht unter Diebstahlverdacht",
	},
	123: {
		en: "Locked by remote control",
		de: "Ferngesteuert gesperrt",
	},
	124: {
		en: "Shut down by remote control",
		de: "Ferngesteuert abgeschaltet",
	},
	125: {
		en: "Grid configuration parameter error",
		de: "Netzkonfigurationsparameter fehlerhaft",
	},
	126: {
		en: "EEPROM reading and writing error",
		de: "EEPROM Lese-/Schreibfehler",
	},
	127: {
		en: "Firmware error",
		de: "Firmware-Fehler",
	},
	128: {
		en: "Hardware configuration error",
		de: "Hardware-Konfigurationsfehler",
	},
	129: {
		en: "Abnormal bias",
		de: "Abnormale Vorspannung",
	},
	130: {
		en: "Offline",
		de: "Offline",
	},
	141: {
		en: "Grid overvoltage",
		de: "Netzüberspannung",
	},
	142: {
		en: "10 min value grid overvoltage",
		de: "10-Minuten-Mittelwert Netzüberspannung",
	},
	143: {
		en: "Grid undervoltage",
		de: "Netzunterspannung",
	},
	144: {
		en: "Grid overfrequency",
		de: "Netzüberfrequenz",
	},
	145: {
		en: "Grid underfrequency",
		de: "Netzunterfrequenz",
	},
	146: {
		en: "Rapid grid frequency change rate",
		de: "Schnelle Netzfrequenzänderungsrate",
	},
	147: {
		en: "Power grid outage",
		de: "Stromausfall",
	},
	148: {
		en: "Grid disconnection",
		de: "Netztrennung",
	},
	149: {
		en: "Island detected",
		de: "Inselbildung erkannt",
	},
	150: {
		en: "DCI exceeded",
		de: "DC-Anteil überschritten",
	},
	181: {
		en: "Abnormal insulation impedance",
		de: "Abnormaler Isolationswiderstand",
	},
	182: {
		en: "Abnormal grounding",
		de: "Abnormale Erdung",
	},
	205: {
		en: "MPPT-A input overvoltage",
		de: "MPPT-A Eingangsüberspannung",
	},
	206: {
		en: "MPPT-B input overvoltage",
		de: "MPPT-B Eingangsüberspannung",
	},
	207: {
		en: "MPPT-A input undervoltage",
		de: "MPPT-A Eingangsunterspannung",
	},
	208: {
		en: "MPPT-B input undervoltage",
		de: "MPPT-B Eingangsunterspannung",
	},
	209: {
		en: "PV1 no input",
		de: "PV1 kein Eingang",
	},
	210: {
		en: "PV2 no input",
		de: "PV2 kein Eingang",
	},
	211: {
		en: "PV3 no input",
		de: "PV3 kein Eingang",
	},
	212: {
		en: "PV4 no input",
		de: "PV4 kein Eingang",
	},
	213: {
		en: "PV1 & PV2 abnormal wiring",
		de: "PV1 & PV2 abnormale Verkabelung",
	},
	214: {
		en: "PV3 & PV4 abnormal wiring",
		de: "PV3 & PV4 abnormale Verkabelung",
	},
	301: {
		en: "FB-A short circuit failure",
		de: "FB-A Kurzschlussfehler",
	},
	302: {
		en: "FB-B short circuit failure",
		de: "FB-B Kurzschlussfehler",
	},
	303: {
		en: "FB-A overcurrent protection failure",
		de: "FB-A Überstromschutz ausgefallen",
	},
	304: {
		en: "FB-B overcurrent protection failure",
		de: "FB-B Überstromschutz ausgefallen",
	},
	305: {
		en: "FB-A clamp circuit failure",
		de: "FB-A Klemmschaltungsfehler",
	},
	306: {
		en: "FB-B clamp circuit failure",
		de: "FB-B Klemmschaltungsfehler",
	},
	307: {
		en: "INV power device failure",
		de: "Wechselrichter Leistungsbauelement ausgefallen",
	},
	308: {
		en: "INV overcurrent or overvoltage protection failure",
		de: "Wechselrichter Überstrom- oder Überspannungsschutz ausgefallen",
	},
	1111: {
		en: "Repeater",
		de: "Repeater",
	},
	2000: {
		en: "Standby",
		de: "Standby",
	},
	2001: {
		en: "Standby",
		de: "Standby",
	},
	2002: {
		en: "Standby",
		de: "Standby",
	},
	2003: {
		en: "Standby",
		de: "Standby",
	},
	2004: {
		en: "Standby",
		de: "Standby",
	},
	3001: {
		en: "Reset",
		de: "Neustart",
	},
	3002: {
		en: "Reset",
		de: "Neustart",
	},
	3003: {
		en: "Reset",
		de: "Neustart",
	},
	3004: {
		en: "Reset",
		de: "Neustart",
	},
	5011: {
		en: "PV1 MOSFET overcurrent",
		de: "PV1 MOSFET Überstrom",
	},
	5012: {
		en: "PV2 MOSFET overcurrent",
		de: "PV2 MOSFET Überstrom",
	},
	5013: {
		en: "PV3 MOSFET overcurrent",
		de: "PV3 MOSFET Überstrom",
	},
	5014: {
		en: "PV4 MOSFET overcurrent",
		de: "PV4 MOSFET Überstrom",
	},
	5020: {
		en: "H-bridge MOSFET overcurrent or overvoltage",
		de: "H-Brücke MOSFET Überstrom oder Überspannung",
	},
	5041: {
		en: "PV1 input overcurrent",
		de: "PV1 Eingangsstrom zu hoch",
	},
	5042: {
		en: "PV2 input overcurrent",
		de: "PV2 Eingangsstrom zu hoch",
	},
	5043: {
		en: "PV3 input overcurrent",
		de: "PV3 Eingangsstrom zu hoch",
	},
	5044: {
		en: "PV4 input overcurrent",
		de: "PV4 Eingangsstrom zu hoch",
	},
	5051: {
		en: "PV1 input overvoltage/undervoltage",
		de: "PV1 Eingangsüberspannung/Unterspannung",
	},
	5052: {
		en: "PV2 input overvoltage/undervoltage",
		de: "PV2 Eingangsüberspannung/Unterspannung",
	},
	5053: {
		en: "PV3 input overvoltage/undervoltage",
		de: "PV3 Eingangsüberspannung/Unterspannung",
	},
	5054: {
		en: "PV4 input overvoltage/undervoltage",
		de: "PV4 Eingangsüberspannung/Unterspannung",
	},
	5060: {
		en: "Abnormal bias",
		de: "Abnormale Vorspannung",
	},
	5070: {
		en: "Over temperature protection",
		de: "Übertemperaturschutz",
	},
	5080: {
		en: "Grid overvoltage/undervoltage",
		de: "Netzüberspannung/Unterspannung",
	},
	5090: {
		en: "Grid overfrequency/underfrequency",
		de: "Netzüberfrequenz/Unterfrequenz",
	},
	5100: {
		en: "Island detected",
		de: "Inselbildung erkannt",
	},
	5110: {
		en: "GFDI fault",
		de: "GFDI-Fehler (Erdschlusserkennung)",
	},
	5120: {
		en: "EEPROM reading and writing error",
		de: "EEPROM Lese-/Schreibfehler",
	},
	5141: {
		en: "FB clamp overvoltage",
		de: "FB-Klemmung Überspannung",
	},
	5142: {
		en: "FB clamp overvoltage",
		de: "FB-Klemmung Überspannung",
	},
	5143: {
		en: "FB clamp overvoltage",
		de: "FB-Klemmung Überspannung",
	},
	5144: {
		en: "FB clamp overvoltage",
		de: "FB-Klemmung Überspannung",
	},
	5150: {
		en: "10 min value grid overvoltage",
		de: "10-Minuten-Mittelwert Netzüberspannung",
	},
	5160: {
		en: "Grid transient fluctuation",
		de: "Transiente Netzschwankung",
	},
	5200: {
		en: "Firmware error",
		de: "Firmware-Fehler",
	},
	5511: {
		en: "PV1 MOSFET overcurrent (H-side)",
		de: "PV1 MOSFET Überstrom (H-Seite)",
	},
	5512: {
		en: "PV2 MOSFET overcurrent (H-side)",
		de: "PV2 MOSFET Überstrom (H-Seite)",
	},
	5513: {
		en: "PV3 MOSFET overcurrent (H-side)",
		de: "PV3 MOSFET Überstrom (H-Seite)",
	},
	5514: {
		en: "PV4 MOSFET overcurrent (H-side)",
		de: "PV4 MOSFET Überstrom (H-Seite)",
	},
	5520: {
		en: "H-bridge MOSFET overcurrent or overvoltage",
		de: "H-Brücke MOSFET Überstrom oder Überspannung",
	},
	8310: {
		en: "Shut down by remote control",
		de: "Ferngesteuert abgeschaltet",
	},
	8320: {
		en: "Locked by remote control",
		de: "Ferngesteuert gesperrt",
	},
	9000: {
		en: "Microinverter is suspected of being stolen",
		de: "Mikrowechselrichter steht unter Diebstahlverdacht",
	},
};

/**
 * Get the alarm description for a given code
 *
 * @param code - The alarm/warning code
 * @param lang - Language code ("en" or "de")
 * @returns The alarm description, or "Unknown alarm code: {code}" if not found
 */
function getAlarmDescription(code: number, lang?: string): string {
	lang = lang || "en";
	const entry = ALARM_CODES[code];
	if (!entry) {
		return `Unknown alarm code: ${code}`;
	}
	return entry[lang as keyof AlarmTranslation] || entry.en;
}

export { ALARM_CODES, getAlarmDescription };
