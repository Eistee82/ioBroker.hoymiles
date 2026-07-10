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
	modulationIndexSignal: number;
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
}

/** DTU hardware/software information from InfoData response. */
export interface DtuInfo {
	/** Device kind identifier. */
	deviceKind: number;
	/** Software version (packed integer). */
	swVersion: number;
	/** Hardware version (packed integer). */
	hwVersion: number;
	/** WiFi signal strength in dBm. */
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
	/** WiFi RSSI in dBm. */
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
	/** Power samples array in W. */
	powerArray: number[];
	/** Lifetime energy in Wh. */
	totalEnergy: number;
	/** Today's energy in Wh. */
	dailyEnergy: number;
	/** Sample interval in seconds. */
	stepTime: number;
	/** First sample Unix timestamp. */
	startTime: number;
	/** Relative power in %. */
	relativePower: number;
	/** Active warning code. */
	warningNumber: number;
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
