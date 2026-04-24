import CloudConnection, { CloudAuthError } from "./cloudConnection.js";
import CloudPoller from "./cloudPoller.js";
import DeviceContext, { type HoymilesAdapter } from "./deviceContext.js";
import type { ProtobufHandler } from "./protobufHandler.js";
import { stationChannels, stationStates } from "./stateDefinitions.js";
import { CLOUD_DISCOVER_CONCURRENCY, CLOUD_RETRY_INITIAL_MS, CLOUD_RETRY_MAX_MS } from "./constants.js";
import { errorMessage, mapLimit } from "./utils.js";

interface CloudManagerOptions {
	adapter: HoymilesAdapter;
	protobuf: ProtobufHandler;
	cloudUser: string;
	cloudPassword: string;
	enableLocal: boolean;
	enableCloudRelay: boolean;
	dataInterval: number;
	slowPollFactor: number;
	localContexts: DeviceContext[];
}

/**
 * Manages cloud connection lifecycle: login, device discovery, polling, and retry logic.
 * Extracted from main adapter class to separate cloud concerns from local connection management.
 */
class CloudManager {
	private readonly adapter: HoymilesAdapter;
	private readonly protobuf: ProtobufHandler;
	private readonly enableLocal: boolean;
	private readonly enableCloudRelay: boolean;
	private readonly dataInterval: number;
	private readonly slowPollFactor: number;
	private readonly localContexts: DeviceContext[];

	private cloud: CloudConnection;
	private cloudPoller: CloudPoller | null;
	private readonly pendingCloudMatches: Map<string, number>;
	private readonly stationDevices: Set<number>;
	private cloudRetryDelay: number;
	private retryTimer: ioBroker.Timeout | undefined;
	private deferredMatchTimer: ioBroker.Timeout | undefined;
	private authErrorActive: boolean;

	/**
	 * @param options - Configuration for the cloud manager
	 */
	constructor(options: CloudManagerOptions) {
		this.adapter = options.adapter;
		this.protobuf = options.protobuf;
		this.enableLocal = options.enableLocal;
		this.enableCloudRelay = options.enableCloudRelay;
		this.dataInterval = options.dataInterval;
		this.slowPollFactor = options.slowPollFactor;
		this.localContexts = options.localContexts;

		this.cloud = new CloudConnection(options.cloudUser, options.cloudPassword, msg =>
			this.adapter.log.debug(`Cloud: ${msg}`),
		);
		this.cloudPoller = null;
		this.pendingCloudMatches = new Map();
		this.stationDevices = new Set();
		this.cloudRetryDelay = CLOUD_RETRY_INITIAL_MS;
		this.authErrorActive = false;
	}

	/** Start cloud login, device discovery, and polling. */
	async start(): Promise<void> {
		try {
			await this._initCloudServices();
		} catch (err) {
			if (err instanceof CloudAuthError) {
				await this._handleAuthError(err);
				return;
			}
			this.adapter.log.error(`Cloud login failed: ${errorMessage(err)}`);
			await this.adapter.setStateAsync("info.cloudConnected", false, true);
			await this.adapter.updateConnectionState();
			this._retryLogin();
		}
	}

	/** Stop all cloud activity and clean up resources. */
	stop(): void {
		if (this.retryTimer) {
			this.adapter.clearTimeout(this.retryTimer);
			this.retryTimer = undefined;
		}
		if (this.deferredMatchTimer) {
			this.adapter.clearTimeout(this.deferredMatchTimer);
			this.deferredMatchTimer = undefined;
		}
		if (this.cloudPoller) {
			this.cloudPoller.stop();
			this.cloudPoller = null;
		}
		this.cloud.disconnect();
		this.pendingCloudMatches.clear();
		this.stationDevices.clear();
		// Clean up cloud-only DeviceContexts created by this manager
		const cloudOnly = [...this.adapter.devices.entries()].filter(
			([, ctx]) => ctx instanceof DeviceContext && !ctx.enableLocal,
		);
		for (const [serial, ctx] of cloudOnly) {
			try {
				ctx.disconnect();
			} catch {
				// ignore cleanup errors
			}
			this.adapter.devices.delete(serial);
		}
	}

	/** Whether the cloud connection has a valid token. */
	get hasToken(): boolean {
		return !!this.cloud.token;
	}

	/**
	 * Attempt to match a newly identified local device with pending cloud data.
	 *
	 * @param ctx - The device context that just learned its DTU serial
	 */
	matchLocalDeviceToCloud(ctx: DeviceContext): void {
		if (!ctx.dtuSerial) {
			return;
		}

		// Register in devices map
		if (!this.adapter.devices.has(ctx.dtuSerial)) {
			this.adapter.devices.set(ctx.dtuSerial, ctx);
		}

		// Check pending cloud matches
		const stationId = this.pendingCloudMatches.get(ctx.dtuSerial);
		if (stationId !== undefined) {
			ctx.cloudStationId = stationId;
			this.pendingCloudMatches.delete(ctx.dtuSerial);
			this.adapter.log.info(`Deferred cloud match resolved: DTU ${ctx.dtuSerial} → station ${stationId}`);
		}
	}

	/** Delegate relay data sent event to CloudPoller. */
	onRelayDataSent(): void {
		this.cloudPoller?.onRelayDataSent();
	}

	/**
	 * Delegate local connected event to CloudPoller.
	 *
	 * @param ctx - The device context that just connected
	 */
	onLocalConnected(ctx: DeviceContext): void {
		if (this.cloudPoller && ctx.cloudSendTimeMin > 0) {
			this.cloudPoller.setServerSendTime(ctx.cloudSendTimeMin);
		}
		this.cloudPoller?.onLocalConnected();
	}

	/**
	 * Notify CloudPoller that a local connection was lost.
	 * Enters night mode if ALL local connections are offline.
	 */
	onLocalDisconnected(): void {
		const anyConnected = this.localContexts.some(c => c.connection?.connected);
		if (!anyConnected) {
			void this.cloudPoller?.onLocalDisconnected();
		}
	}

	/** Perform cloud login, device discovery, and start cloud polling. */
	private async _initCloudServices(): Promise<void> {
		await this.cloud.login();
		this.adapter.log.info("Cloud login successful");
		await this.adapter.setStateAsync("info.cloudConnected", true, true);
		// Clear any previous auth error — a successful login means the credentials are valid
		await this.adapter.setStateAsync("info.cloudLastError", "", true);
		await this.adapter.updateConnectionState();

		await this._discoverDevices();

		const hasActiveRelay = this.enableCloudRelay && this.enableLocal;
		this.cloudPoller = new CloudPoller({
			cloud: this.cloud,
			adapter: this.adapter,
			devices: this.adapter.devices,
			stationDevices: this.stationDevices,
			slowPollFactor: this.slowPollFactor,
			hasRelay: hasActiveRelay,
		});
		await this.cloudPoller.initialFetch();
		if (!hasActiveRelay) {
			this.cloudPoller.scheduleCloudPoll();
		}
	}

	/** Retry cloud login with exponential backoff (60s → 120s → 240s → max 600s). */
	private _retryLogin(): void {
		if (this.retryTimer || this.authErrorActive) {
			return; // Already retrying, or paused due to permanent auth error
		}
		const delay = this.cloudRetryDelay;
		this.adapter.log.info(`Will retry cloud login in ${Math.round(delay / 1000)}s...`);
		this.retryTimer = this.adapter.setTimeout(async () => {
			this.retryTimer = undefined;
			try {
				await this._initCloudServices();
				this.cloudRetryDelay = CLOUD_RETRY_INITIAL_MS; // Reset on success
			} catch (retryErr) {
				if (retryErr instanceof CloudAuthError) {
					await this._handleAuthError(retryErr);
					return;
				}
				this.adapter.log.error(`Cloud login retry failed: ${errorMessage(retryErr)}`);
				this.cloudRetryDelay = Math.min(this.cloudRetryDelay * 2, CLOUD_RETRY_MAX_MS);
				this._retryLogin();
			}
		}, delay);
	}

	/**
	 * Handle a permanent authentication failure: stop retrying, persist the error so
	 * the admin UI can surface it, register a system notification (visible as red
	 * banner in the admin header), and leave the cloud marked offline until the user
	 * updates credentials. An adapter restart (triggered by config change) resets
	 * authErrorActive via the new CloudManager instance.
	 *
	 * @param err - The auth error reported by the cloud
	 */
	private async _handleAuthError(err: CloudAuthError): Promise<void> {
		this.authErrorActive = true;
		this.adapter.log.error(
			`Cloud authentication failed: ${err.message}. Further retries are suspended until credentials are updated — otherwise the Hoymiles account may be locked out.`,
		);
		try {
			await this.adapter.setStateAsync("info.cloudConnected", false, true);
			await this.adapter.setStateAsync("info.cloudLastError", err.message, true);
			await this.adapter.updateConnectionState();
			if (typeof this.adapter.registerNotification === "function") {
				await this.adapter.registerNotification(
					"hoymiles",
					"cloudAuth",
					`Cloud authentication failed: ${err.message}`,
				);
			}
		} catch (stateErr) {
			this.adapter.log.warn(`Failed to persist cloud auth error state: ${errorMessage(stateErr)}`);
		}
	}

	/** Discover all stations and DTUs from the cloud account. */
	private async _discoverDevices(): Promise<void> {
		const stationList = await this.cloud.getStationList();
		if (stationList.length === 0) {
			this.adapter.log.error("No stations found in cloud account");
			return;
		}

		// Build index for O(1) serial lookup instead of O(n) scan per DTU
		const localBySerial = new Map<string, DeviceContext>();
		for (const ctx of this.localContexts) {
			if (ctx.dtuSerial) {
				localBySerial.set(ctx.dtuSerial, ctx);
			}
		}

		// Fetch all station devices and device trees in parallel (avoids N+1 sequential API calls)
		const stationData = await mapLimit(stationList, CLOUD_DISCOVER_CONCURRENCY, async station => {
			await this._createStationDevice(station.id, station.name);
			try {
				const deviceTree = await this.cloud.getDeviceTree(station.id);
				return { station, deviceTree };
			} catch (err) {
				this.adapter.log.warn(`Failed to get device tree for station ${station.name}: ${errorMessage(err)}`);
				return { station, deviceTree: [] as Array<{ sn?: string }> };
			}
		});

		// Process results sequentially (mutates shared state: devices map, pendingCloudMatches)
		for (const { station, deviceTree } of stationData) {
			try {
				for (const dtu of deviceTree) {
					const dtuSerial = dtu.sn;
					if (!dtuSerial) {
						continue;
					}

					// Check if a local device already has this serial
					const localCtx = localBySerial.get(dtuSerial);
					const matched = !!localCtx;
					if (localCtx) {
						localCtx.cloudStationId = station.id;
						this.adapter.devices.set(dtuSerial, localCtx);
						this.adapter.log.info(`Cloud matched DTU ${dtuSerial} to local device at ${localCtx.host}`);
					}

					if (!matched) {
						// Check if any local device hasn't reported serial yet — defer matching
						const hasUnidentified = this.localContexts.some(ctx => !ctx.dtuSerial);
						if (hasUnidentified) {
							this.pendingCloudMatches.set(dtuSerial, station.id);
							this.adapter.log.debug(
								`Deferred cloud match for DTU ${dtuSerial} (waiting for local serial)`,
							);
						} else {
							// Create cloud-only device context
							const ctx = new DeviceContext({
								adapter: this.adapter,
								protobuf: this.protobuf,
								host: "",
								enableLocal: false,
								enableCloud: true,
								enableCloudRelay: false,
								dataInterval: this.dataInterval,
								slowPollFactor: this.slowPollFactor,
							});
							ctx.cloudStationId = station.id;
							await ctx.initFromSerial(dtuSerial);
							this.adapter.devices.set(dtuSerial, ctx);
							this.adapter.log.info(`Created cloud-only device for DTU ${dtuSerial}`);
						}
					}
				}
			} catch (err) {
				this.adapter.log.warn(
					`Failed to process device tree for station ${station.name}: ${errorMessage(err)}`,
				);
			}
		}

		// Register local contexts that already have serials
		for (const ctx of this.localContexts) {
			if (ctx.dtuSerial && !this.adapter.devices.has(ctx.dtuSerial)) {
				this.adapter.devices.set(ctx.dtuSerial, ctx);
			}
		}

		// Resolve unmatched deferred cloud devices after 60s timeout
		if (this.pendingCloudMatches.size > 0) {
			this.deferredMatchTimer = this.adapter.setTimeout(async () => {
				this.deferredMatchTimer = undefined;
				try {
					for (const [serial, stationId] of this.pendingCloudMatches) {
						if (!this.adapter.devices.has(serial)) {
							const ctx = new DeviceContext({
								adapter: this.adapter,
								protobuf: this.protobuf,
								host: "",
								enableLocal: false,
								enableCloud: true,
								enableCloudRelay: false,
								dataInterval: this.dataInterval,
								slowPollFactor: this.slowPollFactor,
							});
							ctx.cloudStationId = stationId;
							await ctx.initFromSerial(serial);
							this.adapter.devices.set(serial, ctx);
							this.adapter.log.info(
								`Deferred match timeout: created cloud-only device for DTU ${serial}`,
							);
						}
					}
				} catch (err) {
					this.adapter.log.error(
						`Deferred cloud device creation failed: ${err instanceof Error ? err.message : String(err)}`,
					);
				} finally {
					this.pendingCloudMatches.clear();
				}
			}, CLOUD_RETRY_INITIAL_MS);
		}
	}

	/**
	 * Create station-level device with aggregated cloud data states.
	 *
	 * @param stationId - Cloud station ID
	 * @param stationName - Human-readable station name
	 */
	private async _createStationDevice(stationId: number, stationName: string): Promise<void> {
		if (this.stationDevices.has(stationId)) {
			return;
		}

		const deviceId = `station-${stationId}`;

		await this.adapter.extendObjectAsync(deviceId, {
			type: "device",
			common: {
				name: stationName,
				statusStates: { onlineId: "info.stationStatus" },
				icon: "hoymiles.png",
			} as ioBroker.DeviceCommon,
			native: { stationId },
		});

		await Promise.all(
			stationChannels.map(ch =>
				this.adapter.setObjectNotExistsAsync(`${deviceId}.${ch.id}`, {
					type: "channel",
					common: { name: ch.name },
					native: {},
				}),
			),
		);

		await Promise.all(
			stationStates.map(def => {
				const common: Partial<ioBroker.StateCommon> = {
					name: def.name,
					type: def.type,
					role: def.role,
					unit: def.unit || "",
					read: true,
					write: false,
					def: def.type === "boolean" ? false : def.type === "number" ? 0 : "",
					states: def.states,
				};
				return this.adapter.extendObjectAsync(`${deviceId}.${def.id}`, {
					type: "state",
					common: common as ioBroker.StateCommon,
					native: {},
				});
			}),
		);

		this.stationDevices.add(stationId);
		this.adapter.log.info(`Station device created: ${stationName} (${deviceId})`);
	}
}

export default CloudManager;
