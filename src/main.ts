import * as utils from "@iobroker/adapter-core";
import DtuConnection from "./lib/dtuConnection";
import { ProtobufHandler, formatDtuVersion, formatSwVersion, formatInvVersion } from "./lib/protobufHandler";
import type { SgsData } from "./lib/protobufHandler";
import Encryption from "./lib/encryption";
import CloudConnection from "./lib/cloudConnection";
import { channels, states } from "./lib/stateDefinitions";
import { getAlarmDescription } from "./lib/alarmCodes";

class Hoymiles extends utils.Adapter {
	private connection: DtuConnection | null;
	private protobuf: ProtobufHandler | null;
	private encryption: Encryption | null;
	private encryptionRequired: boolean;

	private cloud: CloudConnection | null;
	private cloudPollTimer: ioBroker.Timeout | undefined;
	private cloudStationId: number | null;

	private pollTimer: ioBroker.Timeout | undefined;
	private pollActive: boolean;
	private infoPollCount: number;
	private lastSgsData: SgsData | null;
	private meterStatesCreated: boolean;
	private pollCount: number;
	private slowPollEvery: number;

	constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({ ...options, name: "hoymiles" });
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.connection = null;
		this.protobuf = null;
		this.encryption = null;
		this.encryptionRequired = false;

		this.cloud = null;
		this.cloudPollTimer = undefined;
		this.cloudStationId = null;

		this.pollTimer = undefined;
		this.pollActive = false;
		this.infoPollCount = 0;
		this.lastSgsData = null;
		this.meterStatesCreated = false;
		this.pollCount = 0;
		this.slowPollEvery = 1;
	}

	private async onReady(): Promise<void> {
		const enableLocal = (this.config as Record<string, unknown>).enableLocal !== false;
		const enableCloud = !!(this.config as Record<string, unknown>).enableCloud;

		if (!enableLocal && !enableCloud) {
			this.log.error(
				"Neither local nor cloud connection is enabled. Please enable at least one in the adapter settings.",
			);
			return;
		}

		// Load protobuf definitions (needed for local mode)
		if (enableLocal) {
			this.protobuf = new ProtobufHandler();
			try {
				await this.protobuf.loadProtos();
				this.log.info("Protobuf definitions loaded successfully");
			} catch (err) {
				this.log.error(`Failed to load protobuf definitions: ${(err as Error).message}`);
				return;
			}
		}

		// Create state objects (only for active modes)
		await this.createStateObjects(enableLocal, enableCloud);

		// Subscribe to writable states
		this.subscribeStates("inverter.powerLimit");
		this.subscribeStates("inverter.active");
		this.subscribeStates("inverter.reboot");
		this.subscribeStates("config.zeroExportEnable");
		this.subscribeStates("dtu.reboot");

		// --- Local TCP connection ---
		if (enableLocal) {
			const host = (this.config as Record<string, unknown>).host as string | undefined;
			if (!host) {
				this.log.error(
					"Local connection enabled but no DTU host configured. Use the search button in adapter settings.",
				);
			} else {
				this.log.info(`Starting local connection to DTU at ${host}:10081`);
				this.connection = new DtuConnection(host, 10081);

				this.connection.on("connected", () => {
					this.log.info("Connected to DTU");
					void this.updateConnectionState();
					void this.requestInfo();
					// Enable performance data mode for continuous polling
					if (this.protobuf) {
						this.setTimeout(() => {
							if (this.protobuf && this.connection?.connected) {
								this.log.info("Enabling performance data mode");
								const ts = Math.floor(Date.now() / 1000);
								const msg = this.protobuf.encodePerformanceDataMode(ts);
								void this.connection.send(msg);
							}
						}, 2000);
					}
					this.setTimeout(() => this.startPollCycle(), 3000);
				});

				this.connection.on("disconnected", () => {
					this.log.warn("Disconnected from DTU");
					void this.updateConnectionState();
					this.stopPollCycle();
				});

				this.connection.on("message", (message: Buffer) => {
					this.handleResponse(message);
				});

				this.connection.on("reconnectPause", (paused: boolean) => {
					this.log.debug(`Reconnect pause: ${paused ? "waiting for DTU" : "reconnecting"}`);
					void this.setStateAsync("dtu.reconnectPaused", paused, true);
					if (paused) {
						this.stopPollCycle();
					}
				});

				this.connection.on("error", (err: Error, count: number) => {
					if (count === 1) {
						this.log.warn(`DTU not reachable: ${err.message}`);
					} else if (count && count % 10 === 0) {
						this.log.info(`DTU still not reachable (attempt ${count}), retrying...`);
					}
				});

				this.connection.connect();
			}
		}

		// --- Cloud connection ---
		if (enableCloud) {
			const cloudUser = (this.config as Record<string, unknown>).cloudUser as string | undefined;
			const cloudPassword = (this.config as Record<string, unknown>).cloudPassword as string | undefined;
			if (!cloudUser || !cloudPassword) {
				this.log.error("Cloud connection enabled but credentials not configured.");
			} else {
				this.log.info("Starting cloud connection to Hoymiles S-Miles API");
				this.cloud = new CloudConnection(cloudUser, cloudPassword);

				try {
					await this.cloud.login();
					this.log.info("Cloud login successful");
					await this.setStateAsync("info.cloudConnected", true, true);
					await this.updateConnectionState();

					// Get station list and match by DTU serial number
					const stationList = await this.cloud.getStationList();
					if (stationList.length === 0) {
						this.log.error("No stations found in cloud account");
					} else {
						let matchedStation = stationList[0]; // fallback: first station

						if (stationList.length > 1) {
							// Priority 1: DTU SN from config
							// Priority 2: DTU SN from local connection
							const configDtuSn = (this.config as Record<string, unknown>).cloudDtuSerial as
								| string
								| undefined;
							const localDtuSn = await this.getStateAsync("dtu.serialNumber");
							const dtuSn = configDtuSn || (localDtuSn?.val as string | undefined);

							if (dtuSn) {
								this.log.info(`Matching cloud station by DTU SN: ${dtuSn}`);
								for (const station of stationList) {
									try {
										const devices = await this.cloud.getDeviceTree(station.id);
										const found = devices.some(d => d.sn === dtuSn || d.dtu_sn === dtuSn);
										if (found) {
											matchedStation = station;
											this.log.info(`Matched: ${station.name} (ID: ${station.id})`);
											break;
										}
									} catch {
										// ignore errors, try next station
									}
								}
							} else {
								this.log.warn(
									"Multiple stations found but no DTU serial configured. Using first station. " +
										"Set cloudDtuSerial in config to select the correct one.",
								);
							}
						}

						this.cloudStationId = matchedStation.id;
						await this.setStateAsync("info.stationName", matchedStation.name, true);
						await this.setStateAsync("info.stationId", this.cloudStationId, true);
						this.log.info(`Cloud station: ${matchedStation.name} (ID: ${this.cloudStationId})`);

						// Initial cloud data fetch + start recurring poll chain
						await this.pollCloudData();
						this.scheduleCloudPoll();
					}
				} catch (err) {
					this.log.error(`Cloud login failed: ${(err as Error).message}`);
					await this.setStateAsync("info.cloudConnected", false, true);
					await this.updateConnectionState();
				}
			}
		}
	}

	private async updateConnectionState(): Promise<void> {
		const localOk = this.connection && this.connection.connected;
		const cloudOk = this.cloud && this.cloud.token;
		await this.setStateAsync("info.connection", !!(localOk || cloudOk), true);
	}

	private scheduleCloudPoll(): void {
		const cloudInterval = (((this.config as Record<string, unknown>).cloudPollInterval as number) || 300) * 1000;
		this.cloudPollTimer = this.setTimeout(async () => {
			await this.pollCloudData();
			this.scheduleCloudPoll();
		}, cloudInterval);
	}

	private async createStateObjects(enableLocal: boolean, enableCloud: boolean): Promise<void> {
		// Create channels (only for active sources)
		for (const ch of channels) {
			if (ch.id === "info") {
				continue;
			}
			if (ch.source === "local" && !enableLocal) {
				continue;
			}
			if (ch.source === "cloud" && !enableCloud) {
				continue;
			}
			await this.setObjectNotExistsAsync(ch.id, {
				type: "channel",
				common: { name: ch.name },
				native: {},
			});
		}

		// Create or update states (only for active sources)
		for (const def of states) {
			if (def.id === "info.connection") {
				continue;
			}
			if (def.source === "local" && !enableLocal) {
				continue;
			}
			if (def.source === "cloud" && !enableCloud) {
				continue;
			}
			const common: Record<string, unknown> = {
				name: def.name,
				type: def.type,
				role: def.role,
				unit: def.unit || "",
				read: true,
				write: def.write || false,
				min: def.min,
				max: def.max,
			};
			if (def.states) {
				common.states = def.states;
			}
			await this.extendObjectAsync(def.id, {
				type: "state",
				common: common as unknown as ioBroker.StateCommon,
				native: {},
			});

			// Initialize button/switch states with false if they have no value yet
			if (def.write && def.type === "boolean") {
				const current = await this.getStateAsync(def.id);
				if (!current || current.val === null) {
					await this.setStateAsync(def.id, false, true);
				}
			}
		}
	}

	private async createMeterStates(): Promise<void> {
		this.log.info("Meter detected, creating meter states");
		await this.setObjectNotExistsAsync("meter", {
			type: "channel",
			common: { name: { en: "Energy meter", de: "Energiezähler" } },
			native: {},
		});
		const meterDefs: Array<{ id: string; name: ioBroker.StringOrTranslated; role: string; unit: string }> = [
			{
				id: "meter.totalPower",
				name: { en: "Total power", de: "Gesamtleistung" },
				role: "value.power",
				unit: "W",
			},
			{
				id: "meter.phaseAPower",
				name: { en: "Phase A power", de: "Phase A Leistung" },
				role: "value.power",
				unit: "W",
			},
			{
				id: "meter.phaseBPower",
				name: { en: "Phase B power", de: "Phase B Leistung" },
				role: "value.power",
				unit: "W",
			},
			{
				id: "meter.phaseCPower",
				name: { en: "Phase C power", de: "Phase C Leistung" },
				role: "value.power",
				unit: "W",
			},
			{
				id: "meter.powerFactorTotal",
				name: { en: "Power factor total", de: "Leistungsfaktor gesamt" },
				role: "value",
				unit: "",
			},
			{
				id: "meter.energyTotalExport",
				name: { en: "Total energy export", de: "Gesamtenergie Export" },
				role: "value.energy",
				unit: "kWh",
			},
			{
				id: "meter.energyTotalImport",
				name: { en: "Total energy import", de: "Gesamtenergie Import" },
				role: "value.energy",
				unit: "kWh",
			},
			{
				id: "meter.voltagePhaseA",
				name: { en: "Voltage phase A", de: "Spannung Phase A" },
				role: "value.voltage",
				unit: "V",
			},
			{
				id: "meter.voltagePhaseB",
				name: { en: "Voltage phase B", de: "Spannung Phase B" },
				role: "value.voltage",
				unit: "V",
			},
			{
				id: "meter.voltagePhaseC",
				name: { en: "Voltage phase C", de: "Spannung Phase C" },
				role: "value.voltage",
				unit: "V",
			},
			{
				id: "meter.currentPhaseA",
				name: { en: "Current phase A", de: "Strom Phase A" },
				role: "value.current",
				unit: "A",
			},
			{
				id: "meter.currentPhaseB",
				name: { en: "Current phase B", de: "Strom Phase B" },
				role: "value.current",
				unit: "A",
			},
			{
				id: "meter.currentPhaseC",
				name: { en: "Current phase C", de: "Strom Phase C" },
				role: "value.current",
				unit: "A",
			},
			{ id: "meter.faultCode", name: { en: "Fault code", de: "Fehlercode" }, role: "value", unit: "" },
		];
		for (const def of meterDefs) {
			await this.extendObjectAsync(def.id, {
				type: "state",
				common: { name: def.name, type: "number", role: def.role, unit: def.unit, read: true, write: false },
				native: {},
			});
		}
	}

	private startPollCycle(): void {
		this.stopPollCycle();
		const slowVal = (this.config as Record<string, unknown>).slowPollFactor;
		this.slowPollEvery = Number(slowVal) || 6;
		this.pollCount = 0;
		this.pollActive = true;
		this.log.info(`Poll cycle started: continuous mode, config/alarms every ${this.slowPollEvery} polls`);

		// Start the chain
		void this.pollNext();
	}

	private stopPollCycle(): void {
		this.pollActive = false;
		if (this.pollTimer) {
			this.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
	}

	/**
	 * Request queue: after each response, send the next request immediately.
	 * Sequence: RealData → (every N: Config → Alarms) → (every 60: Info) → repeat
	 */
	private async pollNext(): Promise<void> {
		if (!this.pollActive || !this.connection?.connected || this.connection.reconnectPaused) {
			return;
		}

		// RealData (every poll)
		await this.requestRealData();

		// Config + Alarms (every N polls)
		this.pollCount++;
		if (this.pollCount >= this.slowPollEvery) {
			this.pollCount = 0;
			await this.requestConfig();
			await this.requestAlarms();

			// Info every 6x slow poll (~every 36 slow polls = rare)
			this.infoPollCount = (this.infoPollCount || 0) + 1;
			if (this.infoPollCount >= 6) {
				this.infoPollCount = 0;
				await this.requestInfo();
			}
		}

		// Chain next poll with configurable pause (0 = continuous)
		if (this.pollActive && this.connection?.connected && !this.connection.reconnectPaused) {
			const pauseMs = (Number((this.config as Record<string, unknown>).pollInterval) ?? 30) * 1000;
			this.pollTimer = this.setTimeout(() => void this.pollNext(), pauseMs > 0 ? pauseMs : 100);
		}
	}

	private waitForResponse(): Promise<void> {
		return new Promise(resolve => {
			let timer: ioBroker.Timeout | undefined;
			const done = (): void => {
				if (timer) {
					this.clearTimeout(timer);
					timer = undefined;
				}
				this.removeListener("responseHandled", done);
				resolve();
			};
			timer = this.setTimeout(done, 5000);
			this.once("responseHandled" as string, done);
		});
	}

	private async requestRealData(): Promise<void> {
		if (!this.protobuf || !this.connection) {
			return;
		}
		const timestamp = Math.floor(Date.now() / 1000);
		const msg = this.protobuf.encodeRealDataNewRequest(timestamp);
		const sent = await this.connection.send(msg);
		if (!sent) {
			return;
		}
		await this.waitForResponse();
	}

	private async requestInfo(): Promise<void> {
		if (!this.protobuf || !this.connection) {
			return;
		}
		const timestamp = Math.floor(Date.now() / 1000);
		const msg = this.protobuf.encodeInfoRequest(timestamp);
		const sent = await this.connection.send(msg);
		if (!sent) {
			this.log.debug("Failed to send Info request");
		}
	}

	private async requestConfig(): Promise<void> {
		if (!this.protobuf || !this.connection) {
			return;
		}
		const timestamp = Math.floor(Date.now() / 1000);
		const msg = this.protobuf.encodeGetConfigRequest(timestamp);
		const sent = await this.connection.send(msg);
		if (sent) {
			await this.waitForResponse();
		}
	}

	private async requestAlarms(): Promise<void> {
		if (!this.protobuf || !this.connection) {
			return;
		}
		const timestamp = Math.floor(Date.now() / 1000);
		const msg = this.protobuf.encodeAlarmTrigger(timestamp);
		const sent = await this.connection.send(msg);
		if (sent) {
			await this.waitForResponse();
		}
	}

	private handleResponse(message: Buffer): void {
		if (!this.protobuf) {
			return;
		}
		try {
			const parsed = this.protobuf.parseResponse(message);
			if (!parsed) {
				this.log.debug("Could not parse response message");
				return;
			}

			const { cmdHigh, cmdLow, payload } = parsed;
			this.log.debug(
				`Response: cmd=0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}, payload=${payload.length} bytes`,
			);

			// Decrypt if needed
			let decryptedPayload = payload;
			if (this.encryptionRequired && this.encryption) {
				// Info response is never encrypted
				if (!(cmdHigh === 0xa2 && cmdLow === 0x01)) {
					try {
						decryptedPayload = this.encryption.decrypt(payload);
					} catch (err) {
						this.log.warn(`Decryption failed: ${(err as Error).message}`);
						return;
					}
				}
			}

			// DTU responses use 0xa2 prefix (App->DTU requests use 0xa3)
			if (cmdHigh === 0xa2 && cmdLow === 0x11) {
				// RealDataNew response
				void this.handleRealData(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x01) {
				// AppInfoData response
				void this.handleInfoData(payload); // Always unencrypted
			} else if (cmdHigh === 0xa2 && cmdLow === 0x09) {
				// GetConfig response
				void this.handleConfigData(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x04) {
				// AlarmData / WarnData response
				void this.handleAlarmData(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x15) {
				// HistPower response
				void this.handleHistPower(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x10) {
				// SetConfig response
				this.log.info("SetConfig response received");
			} else if ((cmdHigh === 0xa2 && cmdLow === 0x05) || (cmdHigh === 0x23 && cmdLow === 0x05)) {
				// Command response
				this.handleCommandResponse(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x02) {
				// Heartbeat response
				this.log.debug("Heartbeat response received");
			} else if (cmdHigh === 0xa2 && cmdLow === 0x14) {
				// NetworkInfo response
				void this.handleNetworkInfo(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x06) {
				// CommandStatus response
				this.log.debug("CommandStatus response received");
			} else if (cmdHigh === 0xa2 && cmdLow === 0x16) {
				// HistEnergy response
				this.log.debug(`HistEnergy response: ${decryptedPayload.length} bytes`);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x13) {
				// AutoSearch response
				void this.handleAutoSearch(decryptedPayload);
			} else if (cmdHigh === 0xa2 && cmdLow === 0x07) {
				// DevConfigFetch response
				void this.handleDevConfigFetch(decryptedPayload);
			} else {
				this.log.debug(`Unknown command response: 0x${cmdHigh.toString(16)} 0x${cmdLow.toString(16)}`);
			}
		} catch (err) {
			this.log.warn(`Error handling response: ${(err as Error).message}`);
		}
		// Signal to waitForResponse that a response was processed
		this.emit("responseHandled");
	}

	private async handleRealData(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			const data = this.protobuf.decodeRealDataNew(payload);
			this.log.debug(
				`RealData: power=${data.dtuPower}W, dailyEnergy=${data.dtuDailyEnergy}, sgs=${data.sgs.length}, pv=${data.pv.length}, meter=${data.meter.length}`,
			);

			await this.setStateAsync("info.lastResponse", Math.floor(Date.now() / 1000), true);

			// Inverter active status: active when producing power
			await this.setStateAsync("inverter.active", data.sgs.length > 0 && data.dtuPower > 0, true);

			// Grid data (from first SGSMO entry)
			if (data.sgs.length > 0) {
				const sgs = data.sgs[0];
				this.lastSgsData = sgs;
				await this.setStateAsync("grid.power", sgs.activePower, true);
				await this.setStateAsync("grid.voltage", sgs.voltage, true);
				await this.setStateAsync("grid.current", sgs.current, true);
				await this.setStateAsync("grid.frequency", sgs.frequency, true);
				await this.setStateAsync("grid.reactivePower", sgs.reactivePower, true);
				await this.setStateAsync("grid.powerFactor", sgs.powerFactor, true);

				await this.setStateAsync("inverter.temperature", sgs.temperature, true);
				await this.setStateAsync("inverter.warnCount", sgs.warningNumber, true);
				await this.setStateAsync("inverter.linkStatus", sgs.linkStatus, true);
				await this.setStateAsync("inverter.serialNumber", sgs.serialNumber, true);
			}

			// PV data (DTU uses port 1,2 → map to pv0,pv1)
			for (const pv of data.pv) {
				const pvIndex = pv.portNumber - 1;
				// Only handle pv0 and pv1
				if (pvIndex < 0 || pvIndex > 1) {
					continue;
				}
				const prefix = `pv${pvIndex}`;
				await this.setStateAsync(`${prefix}.power`, pv.power, true);
				await this.setStateAsync(`${prefix}.voltage`, pv.voltage, true);
				await this.setStateAsync(`${prefix}.current`, pv.current, true);
				await this.setStateAsync(`${prefix}.dailyEnergy`, Math.round(pv.energyDaily) / 1000, true);
				await this.setStateAsync(`${prefix}.totalEnergy`, Math.round(pv.energyTotal / 100) / 10, true);
			}

			// Meter data (from first MeterMO entry) - create states dynamically on first receive
			if (data.meter.length > 0) {
				if (!this.meterStatesCreated) {
					await this.createMeterStates();
					this.meterStatesCreated = true;
				}
				const m = data.meter[0];
				await this.setStateAsync("meter.totalPower", m.phaseTotalPower, true);
				await this.setStateAsync("meter.phaseAPower", m.phaseAPower, true);
				await this.setStateAsync("meter.phaseBPower", m.phaseBPower, true);
				await this.setStateAsync("meter.phaseCPower", m.phaseCPower, true);
				await this.setStateAsync("meter.powerFactorTotal", m.powerFactorTotal, true);
				await this.setStateAsync("meter.energyTotalExport", m.energyTotalPower, true);
				await this.setStateAsync("meter.energyTotalImport", m.energyTotalConsumed, true);
				await this.setStateAsync("meter.voltagePhaseA", m.voltagePhaseA, true);
				await this.setStateAsync("meter.voltagePhaseB", m.voltagePhaseB, true);
				await this.setStateAsync("meter.voltagePhaseC", m.voltagePhaseC, true);
				await this.setStateAsync("meter.currentPhaseA", m.currentPhaseA, true);
				await this.setStateAsync("meter.currentPhaseB", m.currentPhaseB, true);
				await this.setStateAsync("meter.currentPhaseC", m.currentPhaseC, true);
				await this.setStateAsync("meter.faultCode", m.faultCode, true);
			}

			// DTU aggregated values
			await this.setStateAsync("grid.dailyEnergy", Math.round(data.dtuDailyEnergy) / 1000, true);

			// grid.totalEnergy is set from cloud API only (AC output).
			// PV totals are DC input and include inverter conversion losses.
		} catch (err) {
			this.log.warn(`Error decoding RealData: ${(err as Error).message}`);
		}
	}

	private async handleInfoData(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			const info = this.protobuf.decodeInfoData(payload);
			this.log.info(`Device info: DTU SN=${info.dtuSn}, devices=${info.deviceNumber}, PVs=${info.pvNumber}`);

			await this.setStateAsync("dtu.serialNumber", info.dtuSn, true);

			if (info.dtuInfo) {
				const di = info.dtuInfo;
				await this.setStateAsync("dtu.swVersion", formatDtuVersion(di.swVersion), true);
				await this.setStateAsync("dtu.hwVersion", formatDtuVersion(di.hwVersion).replace("V", "H"), true);
				await this.setStateAsync("dtu.rssi", di.signalStrength, true);
				await this.setStateAsync("dtu.connState", di.errorCode, true);
				await this.setStateAsync("dtu.stepTime", di.dtuStepTime, true);
				await this.setStateAsync("dtu.rfHwVersion", di.dtuRfHwVersion, true);
				await this.setStateAsync("dtu.rfSwVersion", di.dtuRfSwVersion, true);
				await this.setStateAsync("dtu.accessModel", di.accessModel, true);
				await this.setStateAsync(
					"dtu.communicationTime",
					new Date(di.communicationTime * 1000).toISOString(),
					true,
				);
				await this.setStateAsync("dtu.wifiVersion", di.wifiVersion, true);
				await this.setStateAsync("dtu.mode485", di.dtu485Mode, true);
				await this.setStateAsync("dtu.sub1gFrequencyBand", di.sub1gFrequencyBand, true);

				// Check encryption requirement
				if (Encryption.isRequired(di.dfs)) {
					this.log.info("DTU requires encrypted communication");
					this.encryptionRequired = true;
					if (di.encRand) {
						this.encryption = new Encryption(di.encRand);
						this.log.info("Encryption initialized with enc_rand from DTU");
					} else {
						this.log.warn("Encryption required but no enc_rand received");
					}
				} else {
					this.log.info("DTU does not require encryption");
					this.encryptionRequired = false;
				}
			}

			if (info.pvInfo.length > 0) {
				const pv = info.pvInfo[0];
				await this.setStateAsync("inverter.serialNumber", pv.sn, true);
				await this.setStateAsync(
					"inverter.hwVersion",
					formatInvVersion(pv.bootVersion).replace("V", "H"),
					true,
				);
				await this.setStateAsync("inverter.swVersion", formatSwVersion(pv.gridVersion), true);
			}
		} catch (err) {
			this.log.warn(`Error decoding InfoData: ${(err as Error).message}`);
		}
	}

	private async handleConfigData(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			const config = this.protobuf.decodeGetConfig(payload);
			this.log.debug(
				`Config: server=${config.serverDomain}:${config.serverPort}, sendTime=${config.serverSendTime}s`,
			);

			// Power limit from config (limitPower 1000 = 100%)
			await this.setStateAsync("inverter.powerLimit", config.limitPower / 10, true);

			await this.setStateAsync("config.serverDomain", config.serverDomain, true);
			await this.setStateAsync("config.serverPort", config.serverPort, true);
			await this.setStateAsync("config.serverSendTime", config.serverSendTime, true);
			await this.setStateAsync("config.wifiSsid", config.wifiSsid, true);
			await this.setStateAsync("config.wifiRssi", config.wifiRssi, true);
			await this.setStateAsync("config.zeroExportEnable", !!config.zeroExportEnable, true);
			await this.setStateAsync("config.zeroExport433Addr", config.zeroExport433Addr, true);
			await this.setStateAsync("config.meterKind", config.meterKind, true);
			await this.setStateAsync("config.meterInterface", config.meterInterface, true);
			await this.setStateAsync("config.dhcpSwitch", config.dhcpSwitch, true);
			await this.setStateAsync("config.dtuApSsid", config.dtuApSsid, true);
			await this.setStateAsync("config.netmodeSelect", config.netmodeSelect, true);
			await this.setStateAsync("config.channelSelect", config.channelSelect, true);
			await this.setStateAsync("config.sub1gSweepSwitch", config.sub1gSweepSwitch, true);
			await this.setStateAsync("config.sub1gWorkChannel", config.sub1gWorkChannel, true);
			await this.setStateAsync("config.invType", config.invType, true);
			await this.setStateAsync("config.ipAddress", config.ipAddress, true);
			await this.setStateAsync("config.subnetMask", config.subnetMask, true);
			await this.setStateAsync("config.gateway", config.gateway, true);
			await this.setStateAsync("config.wifiIpAddress", config.wifiIpAddress, true);
			await this.setStateAsync("config.macAddress", config.macAddress, true);
			await this.setStateAsync("config.wifiMacAddress", config.wifiMacAddress, true);
		} catch (err) {
			this.log.warn(`Error decoding Config: ${(err as Error).message}`);
		}
	}

	private async handleAlarmData(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			// Try legacy AlarmData format first
			const data = this.protobuf.decodeAlarmData(payload);
			this.log.debug(`Alarms received: ${data.alarms.length} entries`);

			await this.setStateAsync("alarms.count", data.alarms.length, true);

			// Enrich alarms with descriptions
			const enrichedAlarms = data.alarms.map(a => ({
				...a,
				description_en: getAlarmDescription(a.code, "en"),
				description_de: getAlarmDescription(a.code, "de"),
			}));
			await this.setStateAsync("alarms.json", JSON.stringify(enrichedAlarms), true);

			if (data.alarms.length > 0) {
				const last = data.alarms[data.alarms.length - 1];
				await this.setStateAsync("alarms.lastCode", last.code, true);
				await this.setStateAsync("alarms.lastTime", last.startTime, true);
				const desc = getAlarmDescription(last.code, "de");
				await this.setStateAsync("alarms.lastMessage", `${desc} (Code ${last.code})`, true);

				// Grid context at alarm time
				if (this.lastSgsData) {
					await this.setStateAsync("alarms.lastGridVoltage", this.lastSgsData.voltage, true);
					await this.setStateAsync("alarms.lastGridFrequency", this.lastSgsData.frequency, true);
					await this.setStateAsync("alarms.lastTemperature", this.lastSgsData.temperature, true);
				}
			}
		} catch {
			// If legacy format fails, try newer WarnData format
			try {
				this.log.debug("Legacy AlarmData decode failed, trying WarnData format");
				void this.handleWarnData(payload);
			} catch (err2) {
				this.log.warn(`Error decoding AlarmData/WarnData: ${(err2 as Error).message}`);
			}
		}
	}

	private async handleWarnData(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			const data = this.protobuf.decodeWarnData(payload);
			this.log.debug(`WarnData received: ${data.warnings.length} entries`);

			await this.setStateAsync("alarms.count", data.warnings.length, true);

			// Write enriched warnings as JSON
			await this.setStateAsync("alarms.json", JSON.stringify(data.warnings), true);

			if (data.warnings.length > 0) {
				const last = data.warnings[data.warnings.length - 1];
				await this.setStateAsync("alarms.lastCode", last.code, true);
				await this.setStateAsync("alarms.lastTime", last.startTime, true);
				await this.setStateAsync("alarms.lastMessage", `${last.descriptionDe} (Code ${last.code})`, true);

				// Grid context at alarm time
				if (this.lastSgsData) {
					await this.setStateAsync("alarms.lastGridVoltage", this.lastSgsData.voltage, true);
					await this.setStateAsync("alarms.lastGridFrequency", this.lastSgsData.frequency, true);
					await this.setStateAsync("alarms.lastTemperature", this.lastSgsData.temperature, true);
				}
			}
		} catch (err) {
			this.log.warn(`Error decoding WarnData: ${(err as Error).message}`);
		}
	}

	private async handleHistPower(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			const data = this.protobuf.decodeHistPower(payload);
			this.log.debug(
				`HistPower: ${data.powerArray.length} entries, step=${data.stepTime}s, daily=${data.dailyEnergy}Wh, total=${data.totalEnergy}Wh, start=${data.startTime}, relPower=${data.relativePower}, warns=${data.warningNumber}`,
			);

			await this.setStateAsync("history.powerJson", JSON.stringify(data.powerArray), true);
			await this.setStateAsync("history.dailyEnergy", data.dailyEnergy, true);
			await this.setStateAsync("history.totalEnergy", Math.round(data.totalEnergy / 100) / 10, true);
			await this.setStateAsync("history.stepTime", data.stepTime, true);
		} catch (err) {
			this.log.warn(`Error decoding HistPower: ${(err as Error).message}`);
		}
	}

	private async handleAutoSearch(payload: Buffer): Promise<void> {
		if (!this.protobuf) {
			return;
		}
		try {
			const ReqDTO = this.protobuf.protos.AutoSearch.lookupType("AutoSearchReqDTO");
			const msg = ReqDTO.decode(payload);
			const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;

			const serialNumbers = (obj.miSerialNumbers as number[]) || [];
			const hexSerials = serialNumbers.map(sn => (Number(sn) || 0).toString(16).toUpperCase());
			this.log.info(`AutoSearch found ${hexSerials.length} inverter(s): ${hexSerials.join(", ")}`);

			await this.setStateAsync("dtu.searchResult", JSON.stringify(hexSerials), true);
		} catch (err) {
			this.log.warn(`Error decoding AutoSearch: ${(err as Error).message}`);
		}
	}

	private handleDevConfigFetch(payload: Buffer): void {
		if (!this.protobuf) {
			return;
		}
		try {
			const ReqDTO = this.protobuf.protos.DevConfig.lookupType("DevConfigFetchReqDTO");
			ReqDTO.decode(payload);
			this.log.debug("DevConfig response received");
		} catch (err) {
			this.log.warn(`Error decoding DevConfig: ${(err as Error).message}`);
		}
	}

	private handleNetworkInfo(payload: Buffer): void {
		if (!this.protobuf) {
			return;
		}
		try {
			const ReqDTO = this.protobuf.protos.NetworkInfo.lookupType("NetworkInfoReqDTO");
			ReqDTO.decode(payload);
			this.log.debug("NetworkInfo response received");
		} catch (err) {
			this.log.debug(`Error decoding NetworkInfo: ${(err as Error).message}`);
		}
	}

	private handleCommandResponse(payload: Buffer): void {
		if (!this.protobuf) {
			return;
		}
		try {
			const ReqDTO = this.protobuf.protos.CommandPB.lookupType("CommandReqDTO");
			const msg = ReqDTO.decode(payload);
			const obj = ReqDTO.toObject(msg, { longs: Number, defaults: true }) as Record<string, unknown>;
			const errCode = obj.errCode as number | undefined;
			this.log.info(
				`Command response: action=${String(obj.action)}, error=${String(errCode)}, packageNow=${String(obj.packageNow)}`,
			);

			if (errCode !== undefined && errCode !== null && errCode !== 0) {
				this.log.warn(`Command failed with error code: ${String(errCode)}`);
			}

			// Alarm list response with no data → set states to empty
			if (obj.action === 50 && errCode === 0 && (obj.packageNow === 0 || obj.packageNow === undefined)) {
				this.log.debug("Alarm list query returned no active alarms");
				void this.setStateAsync("alarms.count", 0, true);
				void this.setStateAsync("alarms.json", "[]", true);
			}
		} catch (err) {
			this.log.debug(`Error decoding command response: ${(err as Error).message}`);
		}
	}

	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack) {
			return;
		}
		if (!this.connection || !this.connection.connected || !this.protobuf) {
			this.log.warn("Cannot send command: not connected to DTU");
			return;
		}

		const timestamp = Math.floor(Date.now() / 1000);
		const stateId = id.split(".").slice(2).join(".");

		if (stateId === "inverter.powerLimit") {
			const percent = Number(state.val);
			if (percent < 2 || percent > 100) {
				this.log.warn(`Power limit must be between 2 and 100, got ${percent}`);
				return;
			}
			this.log.info(`Setting power limit to ${percent}%`);
			const msg = this.protobuf.encodeSetPowerLimit(percent, timestamp);
			await this.connection.send(msg);
		} else if (stateId === "inverter.active") {
			if (state.val) {
				this.log.info("Turning inverter ON");
				const msg = this.protobuf.encodeInverterOn(timestamp);
				await this.connection.send(msg);
			} else {
				this.log.info("Turning inverter OFF");
				const msg = this.protobuf.encodeInverterOff(timestamp);
				await this.connection.send(msg);
			}
		} else if (stateId === "inverter.reboot") {
			if (state.val) {
				this.log.info("Rebooting inverter");
				const msg = this.protobuf.encodeInverterReboot(timestamp);
				await this.connection.send(msg);
				// Reset button state
				this.setTimeout(() => void this.setStateAsync("inverter.reboot", false, true), 1000);
			}
		} else if (stateId === "dtu.reboot") {
			if (state.val) {
				this.log.info("Rebooting DTU");
				const msg = this.protobuf.encodeDtuReboot(timestamp);
				await this.connection.send(msg);
				this.setTimeout(() => void this.setStateAsync("dtu.reboot", false, true), 1000);
			}
		} else if (stateId === "config.zeroExportEnable") {
			const enable = !!state.val;
			this.log.info(`Setting zero export: ${enable ? "enabled" : "disabled"}`);
			const msg = this.protobuf.encodeSetConfig(timestamp, {
				zeroExportEnable: enable ? 1 : 0,
			});
			await this.connection.send(msg);
		}
	}

	private async pollCloudData(): Promise<void> {
		if (!this.cloud || !this.cloudStationId) {
			return;
		}

		try {
			await this.cloud.ensureToken();
			const data = await this.cloud.getStationRealtime(this.cloudStationId);

			const dtuConnected = this.connection && this.connection.connected;
			const toKwh = (wh: string): number => Math.round((parseFloat(wh) || 0) / 10) / 100;

			// Cloud-exclusive states (no local equivalent): always update
			await this.setStateAsync("grid.monthEnergy", toKwh(data.month_eq), true);
			await this.setStateAsync("grid.yearEnergy", toKwh(data.year_eq), true);
			await this.setStateAsync(
				"grid.co2Saved",
				Math.round((parseFloat(data.co2_emission_reduction) || 0) / 10) / 100,
				true,
			);
			await this.setStateAsync("grid.treesPlanted", parseFloat(data.plant_tree) || 0, true);
			await this.setStateAsync("info.lastCloudUpdate", data.data_time || "", true);
			await this.setStateAsync("info.cloudConnected", true, true);

			// Total energy always from cloud (AC output, not available locally)
			await this.setStateAsync("grid.totalEnergy", toKwh(data.total_eq), true);

			// Power/daily energy: only from cloud when DTU not connected (local has priority)
			if (!dtuConnected) {
				const power = parseFloat(data.real_power) || 0;
				await this.setStateAsync("grid.power", power, true);
				await this.setStateAsync("grid.dailyEnergy", toKwh(data.today_eq), true);
			}

			// Station details
			try {
				const details = await this.cloud.getStationDetails(this.cloudStationId);
				await this.setStateAsync("info.systemCapacity", parseFloat(details.capacitor) || 0, true);
				await this.setStateAsync("info.address", details.address || "", true);
				await this.setStateAsync("info.latitude", parseFloat(details.latitude) || 0, true);
				await this.setStateAsync("info.longitude", parseFloat(details.longitude) || 0, true);
				await this.setStateAsync("info.stationStatus", details.status || 0, true);
				await this.setStateAsync("info.installedAt", details.create_at || "", true);
				await this.setStateAsync("info.timezone", details.timezone?.tz_name || "", true);
				await this.setStateAsync("grid.electricityPrice", details.electricity_price || 0, true);

				// Currency from cloud (dynamic, not hardcoded EUR)
				const currency = details.money_unit || "EUR";
				await this.setStateAsync("grid.currency", currency, true);

				// Power limit → shared state
				if (!dtuConnected) {
					await this.setStateAsync("inverter.powerLimit", parseFloat(details.config?.power_limit) || 0, true);
				}

				// Calculate income
				const price = details.electricity_price || 0;
				await this.setStateAsync(
					"grid.todayIncome",
					Math.round(toKwh(data.today_eq) * price * 100) / 100,
					true,
				);
				await this.setStateAsync(
					"grid.totalIncome",
					Math.round(toKwh(data.total_eq) * price * 100) / 100,
					true,
				);
			} catch (detailErr) {
				this.log.debug(`Cloud station details failed: ${(detailErr as Error).message}`);
			}

			// Device tree → write into info.* and inverter.*
			try {
				const devices = await this.cloud.getDeviceTree(this.cloudStationId);
				if (devices.length > 0) {
					const dtu = devices[0];
					if (!dtuConnected) {
						await this.setStateAsync("dtu.serialNumber", dtu.sn || "", true);
						await this.setStateAsync("dtu.swVersion", dtu.soft_ver || "", true);
						await this.setStateAsync("dtu.hwVersion", dtu.hard_ver || "", true);
					}
					if (dtu.children && dtu.children.length > 0) {
						const inv = dtu.children[0];
						await this.setStateAsync("inverter.model", inv.model_no || "", true);
						if (!dtuConnected) {
							await this.setStateAsync("inverter.serialNumber", inv.sn || "", true);
							await this.setStateAsync("inverter.swVersion", inv.soft_ver || "", true);
							await this.setStateAsync("inverter.hwVersion", inv.hard_ver || "", true);
							await this.setStateAsync("inverter.linkStatus", inv.warn_data?.connect ? 1 : 0, true);
						}
					}
				}
			} catch (devErr) {
				this.log.debug(`Cloud device tree failed: ${(devErr as Error).message}`);
			}

			const todayKwh = toKwh(data.today_eq).toFixed(2);
			const monthKwh = toKwh(data.month_eq).toFixed(2);
			const totalKwh = toKwh(data.total_eq).toFixed(2);
			this.log.debug(
				`Cloud data: ${data.real_power}W, today=${todayKwh}kWh, month=${monthKwh}kWh, total=${totalKwh}kWh`,
			);
		} catch (err) {
			this.log.warn(`Cloud poll failed: ${(err as Error).message}`);
			await this.setStateAsync("info.cloudConnected", false, true);
			await this.updateConnectionState();
		}
	}

	private onUnload(callback: () => void): void {
		try {
			this.stopPollCycle();
			if (this.cloudPollTimer) {
				this.clearTimeout(this.cloudPollTimer);
				this.cloudPollTimer = undefined;
			}
			if (this.connection) {
				this.connection.disconnect();
				this.connection = null;
			}
			if (this.cloud) {
				this.cloud.disconnect();
				this.cloud = null;
			}
			void this.setStateAsync("info.connection", false, true);
			void this.setStateAsync("dtu.reconnectPaused", false, true);
			void this.setStateAsync("info.cloudConnected", false, true);
		} catch {
			// ignore
		}
		callback();
	}
}

if (require.main !== module) {
	module.exports = (options: Partial<utils.AdapterOptions>): Hoymiles => new Hoymiles(options);
} else {
	(() => new Hoymiles())();
}
