import type CloudConnection from "./cloudConnection.js";
import { toKwh } from "./convert.js";
import type DeviceContext from "./deviceContext.js";
import { CLOUD_POLL_CONCURRENCY, DEFAULT_POLL_MS, MIN_POLL_MS, RELAY_POLL_DELAY_MS } from "./constants.js";
import { errorMessage, logOnError, mapLimit } from "./utils.js";

/**
 * Parse a string to number, returning 0 for NaN/undefined.
 *
 * @param v - String value to parse
 */
const num = (v: string | undefined | null): number => parseFloat(v as string) || 0;

/**
 * Languages we can write the weather description state value in. Mirrors the
 *  11 mandatory ioBroker languages. The state value is plain text, so we pick
 *  a single language at write-time based on the adapter's configured language.
 */
type WeatherLang = "en" | "de" | "ru" | "pt" | "nl" | "fr" | "it" | "es" | "pl" | "uk" | "zh-cn";
type WeatherDescription = Record<WeatherLang, string>;

/** OpenWeatherMap icon codes → human-readable descriptions in all 11 languages. */
const WEATHER_DESCRIPTIONS: Record<string, WeatherDescription> = {
	"01d": {
		en: "Clear sky",
		de: "Klarer Himmel",
		ru: "Ясное небо",
		pt: "Céu limpo",
		nl: "Heldere hemel",
		fr: "Ciel dégagé",
		it: "Cielo sereno",
		es: "Cielo despejado",
		pl: "Bezchmurnie",
		uk: "Ясне небо",
		"zh-cn": "晴空",
	},
	"01n": {
		en: "Clear sky",
		de: "Klarer Himmel",
		ru: "Ясное небо",
		pt: "Céu limpo",
		nl: "Heldere hemel",
		fr: "Ciel dégagé",
		it: "Cielo sereno",
		es: "Cielo despejado",
		pl: "Bezchmurnie",
		uk: "Ясне небо",
		"zh-cn": "晴空",
	},
	"02d": {
		en: "Few clouds",
		de: "Leicht bewölkt",
		ru: "Малооблачно",
		pt: "Pouco nublado",
		nl: "Licht bewolkt",
		fr: "Peu nuageux",
		it: "Poco nuvoloso",
		es: "Poco nuboso",
		pl: "Lekkie zachmurzenie",
		uk: "Малохмарно",
		"zh-cn": "少云",
	},
	"02n": {
		en: "Few clouds",
		de: "Leicht bewölkt",
		ru: "Малооблачно",
		pt: "Pouco nublado",
		nl: "Licht bewolkt",
		fr: "Peu nuageux",
		it: "Poco nuvoloso",
		es: "Poco nuboso",
		pl: "Lekkie zachmurzenie",
		uk: "Малохмарно",
		"zh-cn": "少云",
	},
	"03d": {
		en: "Scattered clouds",
		de: "Aufgelockert bewölkt",
		ru: "Переменная облачность",
		pt: "Nuvens dispersas",
		nl: "Verspreide bewolking",
		fr: "Nuages épars",
		it: "Nubi sparse",
		es: "Nubes dispersas",
		pl: "Zachmurzenie umiarkowane",
		uk: "Мінлива хмарність",
		"zh-cn": "多云",
	},
	"03n": {
		en: "Scattered clouds",
		de: "Aufgelockert bewölkt",
		ru: "Переменная облачность",
		pt: "Nuvens dispersas",
		nl: "Verspreide bewolking",
		fr: "Nuages épars",
		it: "Nubi sparse",
		es: "Nubes dispersas",
		pl: "Zachmurzenie umiarkowane",
		uk: "Мінлива хмарність",
		"zh-cn": "多云",
	},
	"04d": {
		en: "Overcast",
		de: "Bedeckt",
		ru: "Пасмурно",
		pt: "Encoberto",
		nl: "Zwaar bewolkt",
		fr: "Couvert",
		it: "Coperto",
		es: "Cubierto",
		pl: "Pochmurno",
		uk: "Хмарно",
		"zh-cn": "阴天",
	},
	"04n": {
		en: "Overcast",
		de: "Bedeckt",
		ru: "Пасмурно",
		pt: "Encoberto",
		nl: "Zwaar bewolkt",
		fr: "Couvert",
		it: "Coperto",
		es: "Cubierto",
		pl: "Pochmurno",
		uk: "Хмарно",
		"zh-cn": "阴天",
	},
	"09d": {
		en: "Shower rain",
		de: "Regenschauer",
		ru: "Ливень",
		pt: "Aguaceiros",
		nl: "Regenbui",
		fr: "Averses",
		it: "Rovesci di pioggia",
		es: "Chubascos",
		pl: "Przelotny deszcz",
		uk: "Злива",
		"zh-cn": "阵雨",
	},
	"09n": {
		en: "Shower rain",
		de: "Regenschauer",
		ru: "Ливень",
		pt: "Aguaceiros",
		nl: "Regenbui",
		fr: "Averses",
		it: "Rovesci di pioggia",
		es: "Chubascos",
		pl: "Przelotny deszcz",
		uk: "Злива",
		"zh-cn": "阵雨",
	},
	"10d": {
		en: "Rain",
		de: "Regen",
		ru: "Дождь",
		pt: "Chuva",
		nl: "Regen",
		fr: "Pluie",
		it: "Pioggia",
		es: "Lluvia",
		pl: "Deszcz",
		uk: "Дощ",
		"zh-cn": "雨",
	},
	"10n": {
		en: "Rain",
		de: "Regen",
		ru: "Дождь",
		pt: "Chuva",
		nl: "Regen",
		fr: "Pluie",
		it: "Pioggia",
		es: "Lluvia",
		pl: "Deszcz",
		uk: "Дощ",
		"zh-cn": "雨",
	},
	"11d": {
		en: "Thunderstorm",
		de: "Gewitter",
		ru: "Гроза",
		pt: "Trovoada",
		nl: "Onweer",
		fr: "Orage",
		it: "Temporale",
		es: "Tormenta",
		pl: "Burza",
		uk: "Гроза",
		"zh-cn": "雷暴",
	},
	"11n": {
		en: "Thunderstorm",
		de: "Gewitter",
		ru: "Гроза",
		pt: "Trovoada",
		nl: "Onweer",
		fr: "Orage",
		it: "Temporale",
		es: "Tormenta",
		pl: "Burza",
		uk: "Гроза",
		"zh-cn": "雷暴",
	},
	"13d": {
		en: "Snow",
		de: "Schnee",
		ru: "Снег",
		pt: "Neve",
		nl: "Sneeuw",
		fr: "Neige",
		it: "Neve",
		es: "Nieve",
		pl: "Śnieg",
		uk: "Сніг",
		"zh-cn": "雪",
	},
	"13n": {
		en: "Snow",
		de: "Schnee",
		ru: "Снег",
		pt: "Neve",
		nl: "Sneeuw",
		fr: "Neige",
		it: "Neve",
		es: "Nieve",
		pl: "Śnieg",
		uk: "Сніг",
		"zh-cn": "雪",
	},
	"50d": {
		en: "Mist/Fog",
		de: "Nebel",
		ru: "Туман",
		pt: "Nevoeiro",
		nl: "Mist",
		fr: "Brume / Brouillard",
		it: "Foschia / Nebbia",
		es: "Niebla",
		pl: "Mgła",
		uk: "Туман",
		"zh-cn": "雾",
	},
	"50n": {
		en: "Mist/Fog",
		de: "Nebel",
		ru: "Туман",
		pt: "Nevoeiro",
		nl: "Mist",
		fr: "Brume / Brouillard",
		it: "Foschia / Nebbia",
		es: "Niebla",
		pl: "Mgła",
		uk: "Туман",
		"zh-cn": "雾",
	},
};

/** Cloud polling states that determine what data is fetched and at what interval. */
type CloudPollState = "POLLING_ACTIVE" | "RELAY_TRIGGERED" | "NIGHT_MODE";

interface CloudPollerOptions {
	cloud: CloudConnection;
	adapter: ioBroker.Adapter;
	devices: Map<string, DeviceContext>;
	stationDevices: Set<number>;
	slowPollFactor: number;
	hasRelay: boolean;
}

/**
 * Handles periodic cloud data polling for station and inverter data.
 *
 * State machine:
 * - POLLING_ACTIVE: Self-timed polling at pollIntervalMs (cloud-only or local+cloud without relay)
 * - RELAY_TRIGGERED: Polls triggered by relay dataSent events (+30s delay), no own timer
 * - NIGHT_MODE: Only weather + firmware checks (local offline / night)
 */
class CloudPoller {
	private static readonly PORT_COUNT_RE = /(\d+)T$/;

	private readonly cloud: CloudConnection;
	private readonly adapter: ioBroker.Adapter;
	private readonly devices: Map<string, DeviceContext>;
	private readonly stationDevices: Set<number>;
	private readonly slowPollFactor: number;
	private readonly hasRelay: boolean;

	private state: CloudPollState;
	private pollCount: number;
	private pollTimer: ioBroker.Timeout | undefined;
	private pollIntervalMs: number;
	private stationCoords: Map<number, { lat: number; lon: number; tzOffsetS: number }>;
	private lastFirmwareCheckDay: number;
	private initialFetchDone: boolean;

	/** Timestamp (ms) of last cloud realtime data fetch per DTU serial. */
	private lastRealtimeFetch: Map<string, number>;
	private pollInProgress: boolean;

	/** Cached bound setStateAsync to avoid re-creating closures on every poll. */
	private readonly boundSetState: ioBroker.Adapter["setStateAsync"];
	/** Cached last cloudConnected value to avoid redundant state writes. */
	private lastCloudConnected: boolean | undefined;

	/**
	 * @param options - Cloud poller configuration
	 */
	constructor(options: CloudPollerOptions) {
		this.cloud = options.cloud;
		this.adapter = options.adapter;
		this.devices = options.devices;
		this.stationDevices = options.stationDevices;
		this.slowPollFactor = options.slowPollFactor;
		this.hasRelay = options.hasRelay;

		this.state = "POLLING_ACTIVE";
		this.pollCount = 0;
		this.pollTimer = undefined;
		this.pollIntervalMs = DEFAULT_POLL_MS;
		this.stationCoords = new Map();
		this.lastFirmwareCheckDay = -1;
		this.lastRealtimeFetch = new Map();
		this.initialFetchDone = false;
		this.pollInProgress = false;
		this.boundSetState = this.adapter.setStateAsync.bind(this.adapter);
	}

	/**
	 * Initial full fetch of all cloud data on adapter start.
	 * Forces a slow poll cycle to get station details, weather, firmware, etc.
	 * After completion, sets the state based on whether a relay is active.
	 */
	async initialFetch(): Promise<void> {
		if (this.initialFetchDone) {
			return;
		}
		this.initialFetchDone = true;
		this.pollCount = 0;

		// Set state before poll to prevent race with onLocalDisconnected
		if (this.hasRelay) {
			this.state = "RELAY_TRIGGERED";
		} else {
			this.state = "POLLING_ACTIVE";
		}
		await this.poll(true);
	}

	/**
	 * Schedule self-rescheduling cloud poll timer.
	 * Only effective when state is POLLING_ACTIVE.
	 */
	scheduleCloudPoll(): void {
		if (this.state !== "POLLING_ACTIVE") {
			return;
		}
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.pollTimer = this.adapter.setTimeout(async () => {
			this.pollTimer = undefined;
			// Re-check state — may have changed during the wait
			if (this.state !== "POLLING_ACTIVE") {
				return;
			}
			await this.poll();
			this.scheduleCloudPoll();
		}, this.pollIntervalMs);
	}

	/**
	 * Called when a cloud relay sends data.
	 * Schedules a poll 30s later to fetch the updated cloud data.
	 */
	onRelayDataSent(): void {
		if (this.state === "NIGHT_MODE") {
			return;
		}
		this.state = "RELAY_TRIGGERED";
		// Cancel any pending timer
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.pollTimer = this.adapter.setTimeout(async () => {
			this.pollTimer = undefined;
			if (this.state === "NIGHT_MODE") {
				return;
			}
			await this.poll();
			// Do NOT self-reschedule — wait for next relay trigger
		}, RELAY_POLL_DELAY_MS);
	}

	/**
	 * Called when a local DTU connection is established.
	 * Exits NIGHT_MODE and enters the appropriate active state.
	 */
	onLocalConnected(): void {
		if (this.state === "NIGHT_MODE") {
			// Cancel any pending night poll timer
			if (this.pollTimer) {
				this.adapter.clearTimeout(this.pollTimer);
				this.pollTimer = undefined;
			}
			if (this.hasRelay) {
				this.state = "RELAY_TRIGGERED";
				// Wait for first relay dataSent event to trigger a poll
			} else {
				this.state = "POLLING_ACTIVE";
				this.scheduleCloudPoll();
			}
		}
	}

	/**
	 * Called when ALL local DTU connections are offline (e.g. night).
	 * Performs one final poll, then enters NIGHT_MODE with reduced polling.
	 */
	async onLocalDisconnected(): Promise<void> {
		// Cancel any pending timer first to prevent stale polls after state change
		this.stop();

		// One last full poll to capture final state
		await logOnError(
			() => this.poll(),
			msg => this.adapter.log.warn(msg),
			"Final poll before night mode failed",
		);

		this.state = "NIGHT_MODE";
		this.scheduleNightPoll();
	}

	/**
	 * Update the poll interval from DTU serverSendTime config.
	 * If in POLLING_ACTIVE state, restarts the poll timer with the new interval.
	 *
	 * @param minutes - Interval in minutes (minimum 1, values ≤ 0 are ignored)
	 */
	setServerSendTime(minutes: number): void {
		if (minutes <= 0) {
			return;
		}
		this.pollIntervalMs = Math.max(minutes * 60 * 1000, MIN_POLL_MS);
		// Restart poll timer if actively self-scheduling
		if (this.state === "POLLING_ACTIVE" && this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
			this.scheduleCloudPoll();
		}
	}

	/** Stop any pending poll timer. */
	stop(): void {
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		this.lastRealtimeFetch.clear();
	}

	/**
	 * Run a single cloud poll cycle across all stations.
	 *
	 * @param forceSlowPoll - If true, forces a slow poll cycle (station details, weather, firmware)
	 */
	async poll(forceSlowPoll = false): Promise<void> {
		if (!this.cloud || this.pollInProgress) {
			return;
		}

		this.pollInProgress = true;
		try {
			this.pollCount++;
			const isSlowPoll = forceSlowPoll || this.pollCount % this.slowPollFactor === 0;

			await this.cloud.ensureToken();

			await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async stationId => {
				try {
					await this.pollStation(stationId, isSlowPoll);
				} catch (stationErr) {
					this.adapter.log.warn(`Cloud poll failed for station ${stationId}: ${errorMessage(stationErr)}`);
				}
			});

			await this.setCloudConnected(true);
		} catch (err) {
			this.adapter.log.warn(`Cloud poll failed: ${errorMessage(err)}`);
			await this.setCloudConnected(false);
		} finally {
			this.pollInProgress = false;
		}
	}

	// --- Private polling sub-methods ---

	/** Schedule a reduced poll (weather + firmware only) for night mode. */
	private scheduleNightPoll(): void {
		if (this.state !== "NIGHT_MODE") {
			return;
		}
		if (this.pollTimer) {
			this.adapter.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		const interval = this.slowPollFactor * DEFAULT_POLL_MS;
		this.pollTimer = this.adapter.setTimeout(async () => {
			this.pollTimer = undefined;
			if (this.state !== "NIGHT_MODE") {
				return;
			}
			await this.nightPoll();
			this.scheduleNightPoll();
		}, interval);
	}

	/** Night mode poll: only weather and firmware checks. */
	private async nightPoll(): Promise<void> {
		try {
			await this.cloud.ensureToken();
			// State may have changed during async ensureToken (e.g. local reconnect)
			if (this.state !== "NIGHT_MODE") {
				return;
			}
			await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async stationId => {
				const deviceId = `station-${stationId}`;
				await this.pollWeather(stationId, deviceId);
				const today = new Date().getDate();
				if (today !== this.lastFirmwareCheckDay) {
					this.lastFirmwareCheckDay = today;
					await this.pollFirmwareStatus(stationId);
				}
			});
			await this.setCloudConnected(true);
		} catch (err) {
			this.adapter.log.warn(`Night poll failed: ${errorMessage(err)}`);
			await this.setCloudConnected(false);
		}
	}

	private async pollStation(stationId: number, isSlowPoll: boolean): Promise<void> {
		const deviceId = `station-${stationId}`;

		// Station realtime data (every cycle)
		const data = await this.cloud.getStationRealtime(stationId);
		await this.setStationRealtimeStates(deviceId, data);

		// Station details + weather (slow poll ~30min), firmware (once per day)
		if (isSlowPoll) {
			await this.pollStationDetails(stationId, deviceId, data);
			await this.pollWeather(stationId, deviceId);
			const today = new Date().getDate();
			if (today !== this.lastFirmwareCheckDay) {
				this.lastFirmwareCheckDay = today;
				await this.pollFirmwareStatus(stationId);
			}
		}

		// Device tree + per-inverter data
		await this.pollDevicesAndInverters(stationId, isSlowPoll);

		this.adapter.log.debug(
			`Cloud data (station ${stationId}): ${data.real_power}W, today=${toKwh(data.today_eq).toFixed(2)}kWh, total=${toKwh(data.total_eq).toFixed(2)}kWh`,
		);
	}

	private async setStationRealtimeStates(
		deviceId: string,
		data: Awaited<ReturnType<CloudConnection["getStationRealtime"]>>,
	): Promise<void> {
		const s = this.boundSetState;
		const lastDataStr = data.last_data_time || "";
		await Promise.all([
			s(`${deviceId}.grid.power`, num(data.real_power), true),
			s(`${deviceId}.grid.dailyEnergy`, toKwh(data.today_eq), true),
			s(`${deviceId}.grid.monthEnergy`, toKwh(data.month_eq), true),
			s(`${deviceId}.grid.yearEnergy`, toKwh(data.year_eq), true),
			s(`${deviceId}.grid.totalEnergy`, toKwh(data.total_eq), true),
			s(`${deviceId}.grid.co2Saved`, Math.round(num(data.co2_emission_reduction) / 10) / 100, true),
			s(`${deviceId}.grid.treesPlanted`, num(data.plant_tree), true),
			s(`${deviceId}.grid.isBalance`, !!data.is_balance, true),
			s(`${deviceId}.grid.isReflux`, !!data.is_reflux, true),
			s(
				`${deviceId}.info.lastCloudUpdate`,
				data.data_time ? new Date(`${data.data_time} UTC`).getTime() : 0,
				true,
			),
			s(`${deviceId}.info.lastDataTime`, lastDataStr ? new Date(`${lastDataStr} UTC`).getTime() : 0, true),
		]);
	}

	private async pollStationDetails(
		stationId: number,
		deviceId: string,
		realtimeData: Awaited<ReturnType<CloudConnection["getStationRealtime"]>>,
	): Promise<void> {
		try {
			const details = await this.cloud.getStationDetails(stationId);
			const s = this.boundSetState;
			const lat = num(details.latitude);
			const lon = num(details.longitude);
			const tzOffsetS = details.timezone?.offset ?? 0;
			if (lat !== 0 || lon !== 0) {
				this.stationCoords.set(stationId, { lat, lon, tzOffsetS });
			}
			const price = details.electricity_price || 0;
			await Promise.all([
				s(`${deviceId}.info.stationName`, details.name || "", true),
				s(`${deviceId}.info.stationId`, stationId, true),
				s(`${deviceId}.info.systemCapacity`, num(details.capacitor), true),
				s(`${deviceId}.info.address`, details.address || "", true),
				s(`${deviceId}.info.latitude`, lat, true),
				s(`${deviceId}.info.longitude`, lon, true),
				s(`${deviceId}.info.stationStatus`, details.status || 0, true),
				s(
					`${deviceId}.info.installedAt`,
					details.create_at ? new Date(`${details.create_at} UTC`).getTime() : 0,
					true,
				),
				s(`${deviceId}.info.timezone`, details.timezone?.tz_name || "", true),
				s(`${deviceId}.grid.electricityPrice`, price, true),
				s(`${deviceId}.grid.currency`, details.money_unit || "EUR", true),
				s(`${deviceId}.grid.todayIncome`, Math.round(toKwh(realtimeData.today_eq) * price * 100) / 100, true),
				s(`${deviceId}.grid.totalIncome`, Math.round(toKwh(realtimeData.total_eq) * price * 100) / 100, true),
			]);
		} catch (err) {
			this.adapter.log.debug(`Cloud station details failed for ${stationId}: ${errorMessage(err)}`);
		}
	}

	private async pollDevicesAndInverters(stationId: number, isSlowPoll: boolean): Promise<void> {
		let hasCloudOnlyDtus = false;
		for (const d of this.devices.values()) {
			if (d.cloudStationId === stationId && d.dtuSerial && !d.connection?.connected) {
				hasCloudOnlyDtus = true;
				break;
			}
		}

		let deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>> = [];
		if (hasCloudOnlyDtus || isSlowPoll) {
			try {
				deviceTree = await this.cloud.getDeviceTree(stationId);
			} catch (err) {
				this.adapter.log.debug(`Cloud device tree failed for station ${stationId}: ${errorMessage(err)}`);
			}
		}

		// DTU/inverter versions (slow poll only)
		if (isSlowPoll && deviceTree.length > 0) {
			await this.updateDeviceVersions(deviceTree);
		}

		// Per-inverter + per-PV realtime data
		await this.pollInverterRealtimeData(stationId, deviceTree);
	}

	private async updateDeviceVersions(
		deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>>,
	): Promise<void> {
		const s = this.boundSetState;
		for (const dtu of deviceTree) {
			const dtuDevice = this.devices.get(dtu.sn);
			if (!dtuDevice?.dtuSerial) {
				continue;
			}
			const sn = dtuDevice.dtuSerial;
			const isLocal = dtuDevice.connection?.connected;

			const writes: Array<Promise<unknown>> = [];
			if (!isLocal) {
				writes.push(
					s(`${sn}.dtu.serialNumber`, dtu.sn || "", true),
					s(`${sn}.dtu.swVersion`, dtu.soft_ver || "", true),
					s(`${sn}.dtu.hwVersion`, dtu.hard_ver || "", true),
				);
			}
			if (dtu.children?.[0]) {
				const inv = dtu.children[0];
				const model = inv.model_no || "";
				writes.push(s(`${sn}.inverter.model`, model, true));
				if (!isLocal) {
					writes.push(
						s(`${sn}.inverter.serialNumber`, inv.sn || "", true),
						s(`${sn}.inverter.swVersion`, inv.soft_ver || "", true),
						s(`${sn}.inverter.hwVersion`, inv.hard_ver || "", true),
						s(`${sn}.inverter.linkStatus`, inv.warn_data?.connect ? 1 : 0, true),
					);
				}
				if (model) {
					await dtuDevice.refreshDeviceNameWithModel(model);
				}
			}
			await Promise.all(writes);
		}
	}

	private async pollInverterRealtimeData(
		stationId: number,
		deviceTree: Awaited<ReturnType<CloudConnection["getDeviceTree"]>>,
	): Promise<void> {
		if (deviceTree.length === 0) {
			return;
		}

		const now = Date.now();
		const tzOffsetS = this.stationCoords.get(stationId)?.tzOffsetS ?? 0;
		const today = new Date(now + tzOffsetS * 1000).toISOString().substring(0, 10);

		// Collect DTUs that need fetching (skip local-connected and recently fetched)
		const dtuTasks: Array<{
			dtu: (typeof deviceTree)[0];
			dtuDev: DeviceContext;
			sn: string;
			microIds: number[];
		}> = [];

		for (const dtu of deviceTree) {
			const dtuDev = this.devices.get(dtu.sn);
			if (!dtuDev?.dtuSerial || dtuDev.connection?.connected) {
				continue;
			}

			const sn = dtuDev.dtuSerial;

			// Skip if last fetch was within pollIntervalMs (serverSendTime-based throttling)
			const lastFetch = this.lastRealtimeFetch.get(sn) || 0;
			if (now - lastFetch < this.pollIntervalMs) {
				continue;
			}

			const microIds: number[] = [];
			for (const inv of dtu.children || []) {
				if (inv.id) {
					microIds.push(inv.id);
				}
			}
			if (microIds.length === 0) {
				continue;
			}

			dtuTasks.push({ dtu, dtuDev, sn, microIds });
		}

		if (dtuTasks.length === 0) {
			return;
		}

		// Fetch DTUs with limited concurrency
		await mapLimit(dtuTasks, CLOUD_POLL_CONCURRENCY, async ({ dtu, dtuDev, sn, microIds }) => {
			try {
				this.lastRealtimeFetch.set(sn, now);
				const s = this.boundSetState;
				// Cloud-sourced data states use q=0x40 (substitute value from device/instance)
				const cs = (id: string, val: ioBroker.StateValue): Promise<void> =>
					s(id, { val, ack: true, q: 0x40 }).then(() => {});

				// Inverter-level metrics
				const values = await this.cloud.getMicroRealtimeData(stationId, microIds, today, [
					"MI_POWER",
					"MI_NET_V",
					"MI_NET_RATE",
					"MI_TEMPERATURE",
				]);
				if (!values) {
					return; // Error already logged in CloudConnection
				}

				const writes: Array<Promise<void>> = [s(`${sn}.info.connected`, true, true).then(() => {})];
				if (values.MI_POWER !== undefined) {
					writes.push(cs(`${sn}.grid.power`, values.MI_POWER));
				}
				if (values.MI_NET_V !== undefined) {
					writes.push(cs(`${sn}.grid.voltage`, values.MI_NET_V));
				}
				if (values.MI_NET_RATE !== undefined) {
					writes.push(cs(`${sn}.grid.frequency`, values.MI_NET_RATE));
				}
				if (values.MI_TEMPERATURE !== undefined) {
					writes.push(cs(`${sn}.inverter.temperature`, values.MI_TEMPERATURE));
				}
				const writeResults = await Promise.allSettled(writes);
				for (const r of writeResults) {
					if (r.status === "rejected") {
						this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
					}
				}

				// Per-PV port metrics (parallel per port)
				const pvTasks: Array<Promise<void>> = [];
				const children = dtu.children || [];

				// Ensure PV states exist for the max port count across all inverter children
				if (!dtuDev.pvStatesCreated && children.length > 0) {
					let maxPorts = 0;
					for (const inv of children) {
						const m = CloudPoller.PORT_COUNT_RE.exec(inv.model_no || "");
						maxPorts = Math.max(maxPorts, Math.min(Math.max(m ? parseInt(m[1], 10) : 2, 1), 6));
					}
					if (maxPorts > 0) {
						await dtuDev.createPvStates(maxPorts, true);
						dtuDev.pvStatesCreated = true;
					}
				}

				for (const inv of children) {
					if (!inv.id) {
						continue;
					}
					const portMatch = CloudPoller.PORT_COUNT_RE.exec(inv.model_no || "");
					if (!portMatch) {
						this.adapter.log.debug(
							`Could not extract port count from model "${inv.model_no}", using default: 2`,
						);
					}
					const portCount = Math.min(Math.max(portMatch ? parseInt(portMatch[1], 10) : 2, 1), 6);

					for (let p = 1; p <= portCount; p++) {
						pvTasks.push(
							this.cloud
								.getModuleRealtimeData(stationId, inv.id, p, today, [
									"MODULE_POWER",
									"MODULE_V",
									"MODULE_I",
								])
								.then(modValues => this.setPvStates(cs, sn, p - 1, modValues)),
						);
					}
				}
				await Promise.all(pvTasks);
			} catch (err) {
				this.adapter.log.debug(`Cloud realtime data failed for DTU ${sn}: ${errorMessage(err)}`);
			}
		});

		// Clean up stale entries for DTUs no longer in the device map
		for (const sn of this.lastRealtimeFetch.keys()) {
			if (!this.devices.has(sn)) {
				this.lastRealtimeFetch.delete(sn);
			}
		}

		// Clean up stale station coordinate entries
		for (const sid of this.stationCoords.keys()) {
			if (!this.stationDevices.has(sid)) {
				this.stationCoords.delete(sid);
			}
		}
	}

	private async setPvStates(
		cs: (id: string, val: ioBroker.StateValue, ack?: boolean) => Promise<void>,
		sn: string,
		pvIndex: number,
		modValues: Record<string, number> | null,
	): Promise<void> {
		if (!modValues) {
			return;
		}
		const prefix = `${sn}.pv${pvIndex}`;
		const writes: Array<Promise<void>> = [];
		if (modValues.MODULE_POWER !== undefined) {
			writes.push(cs(`${prefix}.power`, modValues.MODULE_POWER));
		}
		if (modValues.MODULE_V !== undefined) {
			writes.push(cs(`${prefix}.voltage`, modValues.MODULE_V));
		}
		if (modValues.MODULE_I !== undefined) {
			writes.push(cs(`${prefix}.current`, modValues.MODULE_I));
		}
		const pvResults = await Promise.allSettled(writes);
		for (const r of pvResults) {
			if (r.status === "rejected") {
				this.adapter.log.warn(`PV state write failed: ${errorMessage(r.reason)}`);
			}
		}
	}

	private async pollWeather(stationId: number, deviceId: string): Promise<void> {
		const coords = this.stationCoords.get(stationId);
		if (!coords) {
			return;
		}
		try {
			const weather = await this.cloud.getWeather(coords.lat, coords.lon);
			const s = this.boundSetState;
			await s(`${deviceId}.weather.icon`, weather.icon || "", true);
			const desc = WEATHER_DESCRIPTIONS[weather.icon];
			// Pick the description in the adapter's configured language; fall back to English,
			// then to the raw icon code if the description map has no entry for the icon.
			const lang = (this.adapter.language ?? "en") as WeatherLang;
			await s(`${deviceId}.weather.description`, desc?.[lang] || desc?.en || weather.icon || "", true);
			await s(`${deviceId}.weather.temperature`, weather.temp ?? 0, true);
			await s(`${deviceId}.weather.sunrise`, (weather.sunrise || 0) * 1000, true);
			await s(`${deviceId}.weather.sunset`, (weather.sunset || 0) * 1000, true);
		} catch (err) {
			this.adapter.log.debug(`Weather data failed for station ${stationId}: ${errorMessage(err)}`);
		}
	}

	private async setCloudConnected(connected: boolean): Promise<void> {
		if (connected !== this.lastCloudConnected) {
			this.lastCloudConnected = connected;
			await this.adapter.setStateAsync("info.cloudConnected", connected, true);
		}
	}

	private async pollFirmwareStatus(stationId: number): Promise<void> {
		try {
			for (const device of this.devices.values()) {
				if (device.cloudStationId !== stationId || !device.dtuSerial) {
					continue;
				}
				const fw = await this.cloud.checkFirmwareUpdate(stationId, device.dtuSerial);
				await this.adapter.setStateAsync(`${device.dtuSerial}.dtu.fwUpdateAvailable`, fw.upgrade > 0, true);
			}
		} catch (err) {
			this.adapter.log.debug(`Firmware check failed for station ${stationId}: ${errorMessage(err)}`);
		}
	}
}

export default CloudPoller;
