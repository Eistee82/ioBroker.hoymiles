/**
 * Grid-profile (grid-connection file) decoding for the local DevConfigFetch (0xa3 0x07) path.
 *
 * The DTU returns the grid profile as a binary blob (field `data` of DevConfigFetchReqDTO,
 * possibly chunked over several packages). Each parameter is a 16-bit big-endian word at a
 * fixed byte `position`; the engineering value is `raw / multiple`. Positions, multipliers
 * and units were verified live against the S-Miles cloud's decoded grid profile (DE_VDE4105_2018,
 * HMS-800W-2T) — every value matched 1:1.
 *
 * Note: the cloud-TCP variant (cmd 0x22 0x0e) delivers the same blob little-endian; the LOCAL
 * DevConfigFetch blob is big-endian. This module decodes the local (big-endian) form.
 */

/** One grid-profile parameter: where it sits in the blob and how to scale/name it. */
export interface GridProfileParam {
	/** Byte offset of the 16-bit big-endian word in the blob. */
	pos: number;
	/** State id suffix under `gridProfile.` (camelCase). */
	key: string;
	/** Divisor applied to the raw word to get the engineering value. */
	multiple: number;
	/** ioBroker unit (empty for unitless / flags). */
	unit: string;
	/** True for on/off function flags (decoded as boolean). */
	flag?: boolean;
	/** English state name. */
	en: string;
	/** German state name. */
	de: string;
}

/**
 * Grid-profile parameter map. Order = display order. Covers the parameters the S-Miles
 * portal shows under "view grid profile". `countryStdCode`/`version` are numeric identifiers.
 */
export const GRID_PROFILE_SCHEMA: GridProfileParam[] = [
	{ pos: 0, key: "countryStdCode", multiple: 1, unit: "", en: "Country standard code", de: "Ländernorm-Code" },
	{ pos: 2, key: "version", multiple: 1, unit: "", en: "Grid profile version", de: "Netzprofil-Version" },
	{ pos: 6, key: "nominalVoltage", multiple: 10, unit: "V", en: "Nominal voltage", de: "Nennspannung" },
	{ pos: 8, key: "lowVoltage1", multiple: 10, unit: "V", en: "Low voltage 1 (LV1)", de: "Unterspannung 1 (LV1)" },
	{
		pos: 10,
		key: "lowVoltage1TripTime",
		multiple: 10,
		unit: "s",
		en: "LV1 max trip time",
		de: "LV1 max. Auslösezeit",
	},
	{ pos: 12, key: "highVoltage1", multiple: 10, unit: "V", en: "High voltage 1 (HV1)", de: "Überspannung 1 (HV1)" },
	{
		pos: 14,
		key: "highVoltage1TripTime",
		multiple: 10,
		unit: "s",
		en: "HV1 max trip time",
		de: "HV1 max. Auslösezeit",
	},
	{ pos: 16, key: "lowVoltage2", multiple: 10, unit: "V", en: "Low voltage 2 (LV2)", de: "Unterspannung 2 (LV2)" },
	{
		pos: 18,
		key: "lowVoltage2TripTime",
		multiple: 100,
		unit: "s",
		en: "LV2 max trip time",
		de: "LV2 max. Auslösezeit",
	},
	{
		pos: 20,
		key: "avgHighVoltage10min",
		multiple: 10,
		unit: "V",
		en: "10-min average high voltage",
		de: "10-Min-Mittel Überspannung",
	},
	{ pos: 24, key: "nominalFrequency", multiple: 100, unit: "Hz", en: "Nominal frequency", de: "Nennfrequenz" },
	{
		pos: 26,
		key: "lowFrequency1",
		multiple: 100,
		unit: "Hz",
		en: "Low frequency 1 (LF1)",
		de: "Unterfrequenz 1 (LF1)",
	},
	{
		pos: 28,
		key: "lowFrequency1TripTime",
		multiple: 10,
		unit: "s",
		en: "LF1 max trip time",
		de: "LF1 max. Auslösezeit",
	},
	{
		pos: 30,
		key: "highFrequency1",
		multiple: 100,
		unit: "Hz",
		en: "High frequency 1 (HF1)",
		de: "Überfrequenz 1 (HF1)",
	},
	{
		pos: 32,
		key: "highFrequency1TripTime",
		multiple: 10,
		unit: "s",
		en: "HF1 max trip time",
		de: "HF1 max. Auslösezeit",
	},
	{
		pos: 36,
		key: "islandingDetection",
		multiple: 1,
		unit: "",
		flag: true,
		en: "Islanding detection active",
		de: "Inselerkennung aktiv",
	},
	{ pos: 40, key: "reconnectTime", multiple: 10, unit: "s", en: "Reconnect time", de: "Wiederzuschaltzeit" },
	{
		pos: 42,
		key: "reconnectHighVoltage",
		multiple: 10,
		unit: "V",
		en: "Reconnect high voltage",
		de: "Wiederzuschalt-Überspannung",
	},
	{
		pos: 44,
		key: "reconnectLowVoltage",
		multiple: 10,
		unit: "V",
		en: "Reconnect low voltage",
		de: "Wiederzuschalt-Unterspannung",
	},
	{
		pos: 46,
		key: "reconnectHighFrequency",
		multiple: 100,
		unit: "Hz",
		en: "Reconnect high frequency",
		de: "Wiederzuschalt-Überfrequenz",
	},
	{
		pos: 48,
		key: "reconnectLowFrequency",
		multiple: 100,
		unit: "Hz",
		en: "Reconnect low frequency",
		de: "Wiederzuschalt-Unterfrequenz",
	},
	{
		pos: 52,
		key: "rampUpRateNormal",
		multiple: 100,
		unit: "%/s",
		en: "Normal ramp-up rate",
		de: "Normale Hochlaufrate",
	},
	{
		pos: 54,
		key: "rampUpRateSoftStart",
		multiple: 100,
		unit: "%/s",
		en: "Soft-start ramp-up rate",
		de: "Soft-Start-Hochlaufrate",
	},
	{
		pos: 58,
		key: "freqWattActive",
		multiple: 1,
		unit: "",
		flag: true,
		en: "Frequency-Watt active",
		de: "Frequenz-Watt aktiv",
	},
	{
		pos: 60,
		key: "freqWattStart",
		multiple: 100,
		unit: "Hz",
		en: "Frequency-Watt start (Fstart)",
		de: "Frequenz-Watt Start (Fstart)",
	},
	{
		pos: 62,
		key: "freqWattDroopSlope",
		multiple: 10,
		unit: "%Pn/Hz",
		en: "Frequency-Watt droop slope",
		de: "Frequenz-Watt Droop-Steigung",
	},
	{
		pos: 64,
		key: "recoveryRampRate",
		multiple: 100,
		unit: "%Pn/s",
		en: "Recovery ramp rate",
		de: "Wiederanlauf-Rampe",
	},
	{
		pos: 66,
		key: "recoveryHighFrequency",
		multiple: 100,
		unit: "Hz",
		en: "Recovery high frequency",
		de: "Wiederanlauf-Überfrequenz",
	},
	{
		pos: 68,
		key: "recoveryLowFrequency",
		multiple: 100,
		unit: "Hz",
		en: "Recovery low frequency",
		de: "Wiederanlauf-Unterfrequenz",
	},
	{
		pos: 72,
		key: "activePowerControlActive",
		multiple: 1,
		unit: "",
		flag: true,
		en: "Active power control active",
		de: "Wirkleistungssteuerung aktiv",
	},
	{ pos: 74, key: "powerRampRate", multiple: 100, unit: "%Pn/s", en: "Power ramp rate", de: "Leistungs-Rampe" },
	{ pos: 78, key: "voltVarActive", multiple: 1, unit: "", flag: true, en: "Volt-Var active", de: "Volt-Var aktiv" },
	{ pos: 80, key: "voltVarV1", multiple: 10, unit: "V", en: "Volt-Var set point V1", de: "Volt-Var Sollwert V1" },
	{ pos: 82, key: "voltVarQ1", multiple: 10, unit: "%Pn", en: "Volt-Var set point Q1", de: "Volt-Var Sollwert Q1" },
	{ pos: 84, key: "voltVarV2", multiple: 10, unit: "V", en: "Volt-Var set point V2", de: "Volt-Var Sollwert V2" },
	{ pos: 86, key: "voltVarV3", multiple: 10, unit: "V", en: "Volt-Var set point V3", de: "Volt-Var Sollwert V3" },
	{ pos: 88, key: "voltVarV4", multiple: 10, unit: "V", en: "Volt-Var set point V4", de: "Volt-Var Sollwert V4" },
	{ pos: 90, key: "voltVarQ4", multiple: 10, unit: "%Pn", en: "Volt-Var set point Q4", de: "Volt-Var Sollwert Q4" },
	{
		pos: 94,
		key: "specifiedPowerFactorActive",
		multiple: 1,
		unit: "",
		flag: true,
		en: "Specified power factor active",
		de: "Fester Leistungsfaktor aktiv",
	},
	{ pos: 96, key: "powerFactor", multiple: 100, unit: "", en: "Power factor (cos φ)", de: "Leistungsfaktor (cos φ)" },
	{
		pos: 100,
		key: "wattPowerFactorActive",
		multiple: 1,
		unit: "",
		flag: true,
		en: "Watt-power-factor active",
		de: "Watt-Leistungsfaktor aktiv",
	},
	{
		pos: 102,
		key: "wattPowerFactorStart",
		multiple: 10,
		unit: "%Pn",
		en: "Watt-PF start power",
		de: "Watt-PF Startleistung",
	},
	{
		pos: 104,
		key: "powerFactorAtRatedPower",
		multiple: 100,
		unit: "",
		en: "Power factor at rated power",
		de: "Leistungsfaktor bei Nennleistung",
	},
	{
		pos: 108,
		key: "reactivePowerControlActive",
		multiple: 1,
		unit: "",
		flag: true,
		en: "Reactive power control active",
		de: "Blindleistungssteuerung aktiv",
	},
	{
		pos: 110,
		key: "reactivePower",
		multiple: 10,
		unit: "%Sn",
		en: "Reactive power (VAR)",
		de: "Blindleistung (VAR)",
	},
];

/** Known country-standard codes → human-readable name (extend as observed). */
const COUNTRY_STD_NAMES: Record<number, string> = {
	768: "DE_VDE4105_2018",
};

/**
 * Swap the byte order of every 16-bit word in a buffer. The grid-file blob is big-endian on
 * the local DevConfigFetch interface (0xa3 0x07) but little-endian on the cloud interface
 * (0x22 0x0e) — used to translate between the two when the relay serves the cloud. An odd
 * trailing byte (shouldn't occur for grid files) is copied through unchanged.
 *
 * @param buf - Source buffer.
 */
export function byteSwap16(buf: Buffer): Buffer {
	const out = Buffer.from(buf);
	for (let i = 0; i + 1 < out.length; i += 2) {
		const tmp = out[i];
		out[i] = out[i + 1];
		out[i + 1] = tmp;
	}
	return out;
}

/** Decoded grid profile: each schema key → value (flags as boolean), plus `standard` name. */
export interface DecodedGridProfile {
	/** Schema key → decoded value (numbers scaled by `multiple`, flags as boolean). */
	values: Record<string, number | boolean>;
	/** Human-readable grid standard name (e.g. "DE_VDE4105_2018") or "code <n>". */
	standard: string;
}

/**
 * Decode a grid-profile blob (big-endian 16-bit words) into named values using {@link GRID_PROFILE_SCHEMA}.
 * Parameters whose position lies beyond the blob length are skipped.
 *
 * @param blob - Raw grid-file bytes (reassembled across packages if chunked).
 */
export function decodeGridProfile(blob: Buffer): DecodedGridProfile {
	const values: Record<string, number | boolean> = {};
	for (const p of GRID_PROFILE_SCHEMA) {
		if (p.pos + 2 > blob.length) {
			continue;
		}
		const raw = blob.readUInt16BE(p.pos);
		values[p.key] = p.flag ? raw !== 0 : raw / p.multiple;
	}
	const code = typeof values.countryStdCode === "number" ? values.countryStdCode : null;
	const standard = code != null ? COUNTRY_STD_NAMES[code] || `code ${code}` : "";
	return { values, standard };
}
