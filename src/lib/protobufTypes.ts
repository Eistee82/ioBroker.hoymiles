/**
 * Type definitions for Hoymiles protobuf message structures.
 * Extracted from ProtobufHandler for reusability and clarity.
 */

/** Inverter (SGS) data from RealData response. */
export interface SgsData {
	/** Inverter serial number (hex). */
	serialNumber: string;
	/** Firmware version (packed integer). */
	firmwareVersion: number;
	/** Grid voltage in V. */
	voltage: number;
	/** Grid frequency in Hz. */
	frequency: number;
	/** Active power output in W. */
	activePower: number;
	/** Reactive power in var. */
	reactivePower: number;
	/** Grid current in A. */
	current: number;
	/** Power factor (0–1). */
	powerFactor: number;
	/** Internal temperature in °C. */
	temperature: number;
	/** Active warning/alarm code. */
	warningNumber: number;
	/** CRC checksum of the data frame. */
	crcChecksum: number;
	/** Link status to DTU (0 = offline). */
	linkStatus: number;
	/** Current power limit in %. */
	powerLimit: number;
	/** RF modulation index / signal quality. */
}

/** PV string (port) data from RealData response. */
export interface PvData {
	/** Inverter serial number (hex). */
	serialNumber: string;
	/** PV port index (0-based). */
	portNumber: number;
	/** PV string voltage in V. */
	voltage: number;
	/** PV string current in A. */
	current: number;
	/** PV string power in W. */
	power: number;
	/** Lifetime energy in Wh. */
	energyTotal: number;
	/** Today's energy in Wh. */
	energyDaily: number;
	/** PV port error code. */
	errorCode: number;
}

/** Smart meter data from RealData response. */
export interface MeterData {
	/** Meter device type identifier. */
	deviceType: number;
	/** Meter serial number. */
	serialNumber: string;
	/** Total active power across all phases in W. */
	phaseTotalPower: number;
	/** Phase A active power in W. */
	phaseAPower: number;
	/** Phase B active power in W. */
	phaseBPower: number;
	/** Phase C active power in W. */
	phaseCPower: number;
	/** Total power factor. */
	powerFactorTotal: number;
	/** Total energy produced in Wh. */
	energyTotalPower: number;
	/** Total energy consumed in Wh. */
	energyTotalConsumed: number;
	/** Phase A exported energy in kWh. */
	energyPhaseAExport: number;
	/** Phase B exported energy in kWh. */
	energyPhaseBExport: number;
	/** Phase C exported energy in kWh. */
	energyPhaseCExport: number;
	/** Phase A imported energy in kWh. */
	energyPhaseAImport: number;
	/** Phase B imported energy in kWh. */
	energyPhaseBImport: number;
	/** Phase C imported energy in kWh. */
	energyPhaseCImport: number;
	/** Phase A power factor. */
	powerFactorPhaseA: number;
	/** Phase B power factor. */
	powerFactorPhaseB: number;
	/** Phase C power factor. */
	powerFactorPhaseC: number;
	/** Meter fault code. */
	faultCode: number;
	/** Phase A voltage in V. */
	voltagePhaseA: number;
	/** Phase B voltage in V. */
	voltagePhaseB: number;
	/** Phase C voltage in V. */
	voltagePhaseC: number;
	/** Phase A current in A. */
	currentPhaseA: number;
	/** Phase B current in A. */
	currentPhaseB: number;
	/** Phase C current in A. */
	currentPhaseC: number;
}

/** Decoded RealData protobuf response. */
export interface RealDataResult {
	/** DTU serial number (hex). */
	dtuSn: string;
	/** Unix timestamp of the data. */
	timestamp: number;
	/** Total DTU output power in W. */
	dtuPower: number;
	/** DTU daily energy in Wh. */
	dtuDailyEnergy: number;
	/** Inverter (SGS) data entries. */
	sgs: SgsData[];
	/** PV string data entries. */
	pv: PvData[];
	/** Smart meter data entries. */
	meter: MeterData[];
	/**
	 * Entry counts of the three sub-lists the adapter does not map to states yet
	 * (`rp_data`, `rsd_data`, `tgs_data`). The firmware reserves buffers for them, but whether
	 * these devices ever populate them is unproven — the counts make that answerable from a
	 * real device rather than by assumption.
	 */
	extraLists?: {
		/** Number of `rp_data` entries (RpMO: signature, channel, PV count, link). */
		rp: number;
		/** Number of `rsd_data` entries (rapid-shutdown devices). */
		rsd: number;
		/** Number of `tgs_data` entries (three-phase grid telemetry). */
		tgs: number;
	};
}

/** DTU hardware/software information from InfoData response. */
export interface DtuInfo {
	/** Device kind identifier. */
	deviceKind: number;
	/** Software version (packed integer). */
	swVersion: number;
	/** Hardware version (packed integer). */
	hwVersion: number;
	/** WiFi signal quality, 0-100 — not dBm. Same derived value as {@link ConfigResult.wifiRssi}. */
	signalStrength: number;
	/** DTU error code. */
	errorCode: number;
	/** Dynamic frequency selection channel. */
	dfs: number;
	/** Encryption random seed (null if unset). */
	encRand: string | null;
	/** DTU type identifier. */
	type: number;
	/** DTU step time in seconds. */
	dtuStepTime: number;
	/** RF module hardware version. */
	dtuRfHwVersion: number;
	/** RF module software version. */
	dtuRfSwVersion: number;
	/** Access model (AP/STA). */
	accessModel: number;
	/**
	 * Network meters the DTU knows about, as lower-case hex MACs.
	 *
	 * Comes from `dtuInfo.shls`, which the device fills in every info response. Observed empty
	 * before a meter was ever bound and carrying the meter's MAC afterwards — so the adapter can
	 * offer these for selection instead of asking the user to type a MAC.
	 */
	knownMeters: string[];
	/** Communication time in seconds. */
	communicationTime: number;
	/** WiFi module firmware version. */
	wifiVersion: string;
	/** RS-485 bus mode. */
	dtu485Mode: number;
	/** Sub-1GHz frequency band selection. */
	sub1gFrequencyBand: number;
}

/** Per-inverter hardware info from InfoData response. */
export interface PvInfo {
	/** Device kind identifier. */
	kind: number;
	/** Inverter serial number (hex). */
	sn: string;
	/** Hardware version (packed integer). */
	hwVersion: number;
	/** Software version (packed integer). */
	swVersion: number;
	/** Grid profile version. */
	gridVersion: number;
	/** Bootloader version. */
	bootVersion: number;
}

/** Decoded InfoData protobuf response. */
export interface InfoDataResult {
	/** DTU serial number (hex). */
	dtuSn: string;
	/** Unix timestamp. */
	timestamp: number;
	/** Number of connected devices. */
	deviceNumber: number;
	/** Number of PV inverters. */
	pvNumber: number;
	/** DTU hardware/software info (null if absent). */
	dtuInfo: DtuInfo | null;
	/** Per-inverter info entries. */
	pvInfo: PvInfo[];
}

/** Fields for SetConfig protobuf request. */
export interface SetConfigFields {
	/** Power limit in % of rated power. */
	limitPowerMypower: number;
	/** Zero-export enable flag (0/1). */
	zeroExportEnable: number;
	/** Sub-1GHz 433MHz address for zero-export meter. */
	zeroExport_433Addr: number;
	/** Meter kind identifier string. */
	meterKind: string;
	/** Meter interface type string. */
	meterInterface: string;
	/** Server send interval in seconds. */
	serverSendTime: number;
	/** Cloud server port. */
	serverport: number;
	/** Cloud server domain name. */
	serverDomainName: string;
	/** WiFi SSID. */
	wifiSsid: string;
	/** WiFi password. */
	wifiPassword: string;
}

/** Decoded GetConfig protobuf response. */
export interface ConfigResult {
	/** Active power limit in %. */
	limitPower: number;
	/** Zero-export enable flag (0/1). */
	zeroExportEnable: number;
	/** 433MHz address for zero-export meter. */
	zeroExport433Addr: number;
	/** Meter kind identifier. */
	meterKind: string;
	/** Meter interface type. */
	meterInterface: string;
	/** Server send interval in seconds. */
	serverSendTime: number;
	/** WiFi signal quality, `clamp(2 * (95 - |rssi_dBm|), 0, 100)` — not dBm despite the name. */
	wifiRssi: number;
	/** Cloud server port. */
	serverPort: number;
	/** Cloud server domain. */
	serverDomain: string;
	/** WiFi SSID. */
	wifiSsid: string;
	/** DTU serial number (hex). */
	dtuSn: string;
	/** DHCP on/off (0/1). */
	dhcpSwitch: number;
	/** Inverter type identifier. */
	invType: number;
	/** Network mode selection. */
	netmodeSelect: number;
	/** RF channel selection. */
	channelSelect: number;
	/** Sub-1GHz sweep enable (0/1). */
	sub1gSweepSwitch: number;
	/** Sub-1GHz working channel. */
	sub1gWorkChannel: number;
	/** DTU AP SSID. */
	dtuApSsid: string;
	/** Ethernet IP address. */
	ipAddress: string;
	/** Ethernet subnet mask. */
	subnetMask: string;
	/** Ethernet gateway. */
	gateway: string;
	/** WiFi IP address. */
	wifiIpAddress: string;
	/** Ethernet MAC address. */
	macAddress: string;
	/** WiFi MAC address. */
	wifiMacAddress: string;
	/** DNS server the DTU uses (GetConfig `cable_dns_0..3`). */
	dnsServer: string;
	/** Inverter lock duration in seconds (GetConfig `lock_time`); 0 when no lock is set. */
	lockTime: number;
}

/** Single alarm entry from AlarmData response. */
export interface AlarmEntry {
	/** Inverter serial number (hex). */
	sn: string;
	/** Alarm code. */
	code: number;
	/** Alarm instance number. */
	num: number;
	/** Alarm start Unix timestamp. */
	startTime: number;
	/** Alarm end Unix timestamp (0 if active). */
	endTime: number;
	/** Alarm-specific data field 1. */
	data1: number;
	/** Alarm-specific data field 2. */
	data2: number;
}

/** Decoded AlarmData protobuf response. */
export interface AlarmDataResult {
	/** DTU serial number (hex). */
	dtuSn: string;
	/** Unix timestamp. */
	timestamp: number;
	/** List of alarm entries. */
	alarms: AlarmEntry[];
}

/** Parsed HM protocol frame header. */
export interface ParsedResponse {
	/** Command high byte. */
	cmdHigh: number;
	/** Command low byte. */
	cmdLow: number;
	/** Protobuf payload data. */
	payload: Buffer;
	/** Total frame length in bytes. */
	totalLen: number;
}

/** Historical power data for one inverter. */
export interface HistPowerResult {
	/** Inverter serial number (hex). */
	serialNumber: string;
	/**
	 * Power samples in W, converted from the device's 0.1 W units.
	 *
	 * ⚠ The 0.1 W factor is **empirical, not instruction-level proven**. Field 13 is copied out of
	 * a CRC8-protected byte group of the flash record with no scaling step anywhere on that path,
	 * so the firmware does not state the unit. Two independent measurements pin it down instead:
	 * integrating a full measured day at the reported step yields 4495 Wh against the 4500 Wh the
	 * device reports as its own daily energy (0.12 % apart), and `relative_power` 40 alongside a
	 * RealData reading of 4.3 W in the same minute fits 4.0 W. A factor of 1 or 0.01 would be off
	 * by a power of ten either way. See `_fwanalysis/ADAPTER_FINDINGS.md` §18/§19.
	 */
	powerArray: number[];
	/** Lifetime energy in Wh. */
	totalEnergy: number;
	/** Today's energy in Wh. */
	dailyEnergy: number;
	/**
	 * Seconds between two samples (60 on the 2T, 300 on the 2WB).
	 *
	 * A device-wide configuration constant, not computed per request. The firmware confirms the
	 * unit from a second direction: the task that writes the flash records derives its interval
	 * from the very same constant, multiplied by 1000 into milliseconds.
	 */
	stepTime: number;
	/** Relative power in %. */
	relativePower: number;
	/** Active warning code. */
	warningNumber: number;
	/** Number of pages the device splits the day into; a page holds at most 200 samples. */
	pageCount: number;
	/** Unix timestamp of the first sample **of this page**. */
	absoluteStart: number;
}

/** Single warning entry with localized descriptions. */
export interface WarnEntry {
	/** Inverter serial number (hex). */
	sn: string;
	/** Warning code. */
	code: number;
	/** Warning instance number. */
	num: number;
	/** Warning start Unix timestamp. */
	startTime: number;
	/** Warning end Unix timestamp (0 if active). */
	endTime: number;
	/** Warning-specific data field 1. */
	data1: number;
	/** Warning-specific data field 2. */
	data2: number;
	/** English description text. */
	descriptionEn: string;
	/** German description text. */
	descriptionDe: string;
}

/** Decoded WarnData protobuf response. */
export interface WarnDataResult {
	/** DTU serial number (hex). */
	dtuSn: string;
	/** Unix timestamp. */
	timestamp: number;
	/** Total number of warn-list packages (1 = single package). */
	packageNub: number;
	/** Index of this package (0-based). */
	packageNow: number;
	/** Device kind the warnings refer to (warn_device field). */
	warnDevice: number;
	/** List of warning entries. */
	warnings: WarnEntry[];
}

/** Single event entry from EventData response. */
export interface EventEntry {
	/** Event code identifier. */
	eventCode: number;
	/** Event status flag. */
	eventStatus: number;
	/** Event occurrence count. */
	eventCount: number;
	/** PV voltage at event time in V. */
	pvVoltage: number;
	/** Grid voltage at event time in V. */
	gridVoltage: number;
	/** Grid frequency at event time in Hz. */
	gridFrequency: number;
	/** Grid power at event time in W. */
	gridPower: number;
	/** Temperature at event time in °C. */
	temperature: number;
	/** Micro-inverter ID (hex). */
	miId: string;
	/** Event start Unix timestamp. */
	startTimestamp: number;
}

/** Decoded EventData protobuf response. */
export interface EventDataResult {
	/** Pagination offset. */
	offset: number;
	/** Unix timestamp. */
	timestamp: number;
	/** List of event entries. */
	events: EventEntry[];
}
