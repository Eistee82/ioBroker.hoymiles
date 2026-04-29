import { toKwh } from "./convert.js";
import { CLOUD_POLL_CONCURRENCY, DEFAULT_POLL_MS, MIN_POLL_MS, RELAY_POLL_DELAY_MS } from "./constants.js";
import { errorMessage, logOnError, mapLimit } from "./utils.js";
const num = (v) => parseFloat(v) || 0;
const WEATHER_DESCRIPTIONS = {
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
class CloudPoller {
    static PORT_COUNT_RE = /(\d+)T$/;
    cloud;
    adapter;
    devices;
    stationDevices;
    slowPollFactor;
    hasRelay;
    state;
    pollCount;
    pollTimer;
    pollIntervalMs;
    stationCoords;
    lastFirmwareCheckDay;
    initialFetchDone;
    lastRealtimeFetch;
    pollInProgress;
    boundSetState;
    lastCloudConnected;
    constructor(options) {
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
    async initialFetch() {
        if (this.initialFetchDone) {
            return;
        }
        this.initialFetchDone = true;
        this.pollCount = 0;
        if (this.hasRelay) {
            this.state = "RELAY_TRIGGERED";
        }
        else {
            this.state = "POLLING_ACTIVE";
        }
        await this.poll(true);
    }
    scheduleCloudPoll() {
        if (this.state !== "POLLING_ACTIVE") {
            return;
        }
        if (this.pollTimer) {
            this.adapter.clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.pollTimer = this.adapter.setTimeout(async () => {
            this.pollTimer = undefined;
            if (this.state !== "POLLING_ACTIVE") {
                return;
            }
            await this.poll();
            this.scheduleCloudPoll();
        }, this.pollIntervalMs);
    }
    onRelayDataSent() {
        if (this.state === "NIGHT_MODE") {
            return;
        }
        this.state = "RELAY_TRIGGERED";
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
        }, RELAY_POLL_DELAY_MS);
    }
    onLocalConnected() {
        if (this.state === "NIGHT_MODE") {
            if (this.pollTimer) {
                this.adapter.clearTimeout(this.pollTimer);
                this.pollTimer = undefined;
            }
            if (this.hasRelay) {
                this.state = "RELAY_TRIGGERED";
            }
            else {
                this.state = "POLLING_ACTIVE";
                this.scheduleCloudPoll();
            }
        }
    }
    async onLocalDisconnected() {
        this.stop();
        await logOnError(() => this.poll(), msg => this.adapter.log.warn(msg), "Final poll before night mode failed");
        this.state = "NIGHT_MODE";
        this.scheduleNightPoll();
    }
    setServerSendTime(minutes) {
        if (minutes <= 0) {
            return;
        }
        this.pollIntervalMs = Math.max(minutes * 60 * 1000, MIN_POLL_MS);
        if (this.state === "POLLING_ACTIVE" && this.pollTimer) {
            this.adapter.clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
            this.scheduleCloudPoll();
        }
    }
    stop() {
        if (this.pollTimer) {
            this.adapter.clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.lastRealtimeFetch.clear();
    }
    async poll(forceSlowPoll = false) {
        if (!this.cloud || this.pollInProgress) {
            return;
        }
        this.pollInProgress = true;
        try {
            this.pollCount++;
            const isSlowPoll = forceSlowPoll || this.pollCount % this.slowPollFactor === 0;
            await this.cloud.ensureToken();
            await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async (stationId) => {
                try {
                    await this.pollStation(stationId, isSlowPoll);
                }
                catch (stationErr) {
                    this.adapter.log.warn(`Cloud poll failed for station ${stationId}: ${errorMessage(stationErr)}`);
                }
            });
            await this.setCloudConnected(true);
        }
        catch (err) {
            this.adapter.log.warn(`Cloud poll failed: ${errorMessage(err)}`);
            await this.setCloudConnected(false);
        }
        finally {
            this.pollInProgress = false;
        }
    }
    scheduleNightPoll() {
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
    async nightPoll() {
        try {
            await this.cloud.ensureToken();
            if (this.state !== "NIGHT_MODE") {
                return;
            }
            await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async (stationId) => {
                const deviceId = `station-${stationId}`;
                await this.pollWeather(stationId, deviceId);
                const today = new Date().getDate();
                if (today !== this.lastFirmwareCheckDay) {
                    this.lastFirmwareCheckDay = today;
                    await this.pollFirmwareStatus(stationId);
                }
            });
            await this.setCloudConnected(true);
        }
        catch (err) {
            this.adapter.log.warn(`Night poll failed: ${errorMessage(err)}`);
            await this.setCloudConnected(false);
        }
    }
    async pollStation(stationId, isSlowPoll) {
        const deviceId = `station-${stationId}`;
        const data = await this.cloud.getStationRealtime(stationId);
        await this.setStationRealtimeStates(deviceId, data);
        if (isSlowPoll) {
            await this.pollStationDetails(stationId, deviceId, data);
            await this.pollWeather(stationId, deviceId);
            const today = new Date().getDate();
            if (today !== this.lastFirmwareCheckDay) {
                this.lastFirmwareCheckDay = today;
                await this.pollFirmwareStatus(stationId);
            }
        }
        await this.pollDevicesAndInverters(stationId, isSlowPoll);
        this.adapter.log.debug(`Cloud data (station ${stationId}): ${data.real_power}W, today=${toKwh(data.today_eq).toFixed(2)}kWh, total=${toKwh(data.total_eq).toFixed(2)}kWh`);
    }
    async setStationRealtimeStates(deviceId, data) {
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
            s(`${deviceId}.info.lastCloudUpdate`, data.data_time ? new Date(`${data.data_time} UTC`).getTime() : 0, true),
            s(`${deviceId}.info.lastDataTime`, lastDataStr ? new Date(`${lastDataStr} UTC`).getTime() : 0, true),
        ]);
    }
    async pollStationDetails(stationId, deviceId, realtimeData) {
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
                s(`${deviceId}.info.installedAt`, details.create_at ? new Date(`${details.create_at} UTC`).getTime() : 0, true),
                s(`${deviceId}.info.timezone`, details.timezone?.tz_name || "", true),
                s(`${deviceId}.grid.electricityPrice`, price, true),
                s(`${deviceId}.grid.currency`, details.money_unit || "EUR", true),
                s(`${deviceId}.grid.todayIncome`, Math.round(toKwh(realtimeData.today_eq) * price * 100) / 100, true),
                s(`${deviceId}.grid.totalIncome`, Math.round(toKwh(realtimeData.total_eq) * price * 100) / 100, true),
            ]);
        }
        catch (err) {
            this.adapter.log.debug(`Cloud station details failed for ${stationId}: ${errorMessage(err)}`);
        }
    }
    async pollDevicesAndInverters(stationId, isSlowPoll) {
        let hasCloudOnlyDtus = false;
        for (const d of this.devices.values()) {
            if (d.cloudStationId === stationId && d.dtuSerial && !d.connection?.connected) {
                hasCloudOnlyDtus = true;
                break;
            }
        }
        let deviceTree = [];
        if (hasCloudOnlyDtus || isSlowPoll) {
            try {
                deviceTree = await this.cloud.getDeviceTree(stationId);
            }
            catch (err) {
                this.adapter.log.debug(`Cloud device tree failed for station ${stationId}: ${errorMessage(err)}`);
            }
        }
        if (isSlowPoll && deviceTree.length > 0) {
            await this.updateDeviceVersions(deviceTree);
        }
        await this.pollInverterRealtimeData(stationId, deviceTree);
    }
    async updateDeviceVersions(deviceTree) {
        const s = this.boundSetState;
        for (const dtu of deviceTree) {
            const dtuDevice = this.devices.get(dtu.sn);
            if (!dtuDevice?.dtuSerial) {
                continue;
            }
            const sn = dtuDevice.dtuSerial;
            const isLocal = dtuDevice.connection?.connected;
            const writes = [];
            if (!isLocal) {
                writes.push(s(`${sn}.dtu.serialNumber`, dtu.sn || "", true), s(`${sn}.dtu.swVersion`, dtu.soft_ver || "", true), s(`${sn}.dtu.hwVersion`, dtu.hard_ver || "", true));
            }
            if (dtu.children?.[0]) {
                const inv = dtu.children[0];
                const model = inv.model_no || "";
                writes.push(s(`${sn}.inverter.model`, model, true));
                if (!isLocal) {
                    writes.push(s(`${sn}.inverter.serialNumber`, inv.sn || "", true), s(`${sn}.inverter.swVersion`, inv.soft_ver || "", true), s(`${sn}.inverter.hwVersion`, inv.hard_ver || "", true), s(`${sn}.inverter.linkStatus`, inv.warn_data?.connect ? 1 : 0, true));
                }
                if (model) {
                    await dtuDevice.refreshDeviceNameWithModel(model);
                }
            }
            await Promise.all(writes);
        }
    }
    async pollInverterRealtimeData(stationId, deviceTree) {
        if (deviceTree.length === 0) {
            return;
        }
        const now = Date.now();
        const tzOffsetS = this.stationCoords.get(stationId)?.tzOffsetS ?? 0;
        const today = new Date(now + tzOffsetS * 1000).toISOString().substring(0, 10);
        const dtuTasks = [];
        for (const dtu of deviceTree) {
            const dtuDev = this.devices.get(dtu.sn);
            if (!dtuDev?.dtuSerial || dtuDev.connection?.connected) {
                continue;
            }
            const sn = dtuDev.dtuSerial;
            const lastFetch = this.lastRealtimeFetch.get(sn) || 0;
            if (now - lastFetch < this.pollIntervalMs) {
                continue;
            }
            const microIds = [];
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
        await mapLimit(dtuTasks, CLOUD_POLL_CONCURRENCY, async ({ dtu, dtuDev, sn, microIds }) => {
            try {
                this.lastRealtimeFetch.set(sn, now);
                const s = this.boundSetState;
                const cs = (id, val) => s(id, { val, ack: true, q: 0x40 }).then(() => { });
                const values = await this.cloud.getMicroRealtimeData(stationId, microIds, today, [
                    "MI_POWER",
                    "MI_NET_V",
                    "MI_NET_RATE",
                    "MI_TEMPERATURE",
                ]);
                if (!values) {
                    return;
                }
                const writes = [s(`${sn}.info.connected`, true, true).then(() => { })];
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
                const pvTasks = [];
                const children = dtu.children || [];
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
                        this.adapter.log.debug(`Could not extract port count from model "${inv.model_no}", using default: 2`);
                    }
                    const portCount = Math.min(Math.max(portMatch ? parseInt(portMatch[1], 10) : 2, 1), 6);
                    for (let p = 1; p <= portCount; p++) {
                        pvTasks.push(this.cloud
                            .getModuleRealtimeData(stationId, inv.id, p, today, [
                            "MODULE_POWER",
                            "MODULE_V",
                            "MODULE_I",
                        ])
                            .then(modValues => this.setPvStates(cs, sn, p - 1, modValues)));
                    }
                }
                await Promise.all(pvTasks);
            }
            catch (err) {
                this.adapter.log.debug(`Cloud realtime data failed for DTU ${sn}: ${errorMessage(err)}`);
            }
        });
        for (const sn of this.lastRealtimeFetch.keys()) {
            if (!this.devices.has(sn)) {
                this.lastRealtimeFetch.delete(sn);
            }
        }
        for (const sid of this.stationCoords.keys()) {
            if (!this.stationDevices.has(sid)) {
                this.stationCoords.delete(sid);
            }
        }
    }
    async setPvStates(cs, sn, pvIndex, modValues) {
        if (!modValues) {
            return;
        }
        const prefix = `${sn}.pv${pvIndex}`;
        const writes = [];
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
    async pollWeather(stationId, deviceId) {
        const coords = this.stationCoords.get(stationId);
        if (!coords) {
            return;
        }
        try {
            const weather = await this.cloud.getWeather(coords.lat, coords.lon);
            const s = this.boundSetState;
            await s(`${deviceId}.weather.icon`, weather.icon || "", true);
            const desc = WEATHER_DESCRIPTIONS[weather.icon];
            const lang = (this.adapter.language ?? "en");
            await s(`${deviceId}.weather.description`, desc?.[lang] || desc?.en || weather.icon || "", true);
            await s(`${deviceId}.weather.temperature`, weather.temp ?? 0, true);
            await s(`${deviceId}.weather.sunrise`, (weather.sunrise || 0) * 1000, true);
            await s(`${deviceId}.weather.sunset`, (weather.sunset || 0) * 1000, true);
        }
        catch (err) {
            this.adapter.log.debug(`Weather data failed for station ${stationId}: ${errorMessage(err)}`);
        }
    }
    async setCloudConnected(connected) {
        if (connected !== this.lastCloudConnected) {
            this.lastCloudConnected = connected;
            await this.adapter.setStateAsync("info.cloudConnected", connected, true);
        }
    }
    async pollFirmwareStatus(stationId) {
        try {
            for (const device of this.devices.values()) {
                if (device.cloudStationId !== stationId || !device.dtuSerial) {
                    continue;
                }
                const fw = await this.cloud.checkFirmwareUpdate(stationId, device.dtuSerial);
                await this.adapter.setStateAsync(`${device.dtuSerial}.dtu.fwUpdateAvailable`, fw.upgrade > 0, true);
            }
        }
        catch (err) {
            this.adapter.log.debug(`Firmware check failed for station ${stationId}: ${errorMessage(err)}`);
        }
    }
}
export default CloudPoller;
//# sourceMappingURL=cloudPoller.js.map