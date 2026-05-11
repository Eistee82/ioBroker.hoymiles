import { toKwh } from "./convert.js";
import { CLOUD_POLL_CONCURRENCY, DEFAULT_POLL_MS, MIN_POLL_MS, RELAY_POLL_DELAY_MS } from "./constants.js";
import { errorMessage, logOnError, mapLimit } from "./utils.js";
import { stationStateMap, buildStateCommon } from "./stateDefinitions.js";
const num = (v) => parseFloat(v) || 0;
const WEATHER_DESCRIPTIONS = {
    "01d": { en: "Clear sky", de: "Klarer Himmel" },
    "01n": { en: "Clear sky", de: "Klarer Himmel" },
    "02d": { en: "Few clouds", de: "Leicht bewölkt" },
    "02n": { en: "Few clouds", de: "Leicht bewölkt" },
    "03d": { en: "Scattered clouds", de: "Aufgelockert bewölkt" },
    "03n": { en: "Scattered clouds", de: "Aufgelockert bewölkt" },
    "04d": { en: "Overcast", de: "Bedeckt" },
    "04n": { en: "Overcast", de: "Bedeckt" },
    "09d": { en: "Shower rain", de: "Regenschauer" },
    "09n": { en: "Shower rain", de: "Regenschauer" },
    "10d": { en: "Rain", de: "Regen" },
    "10n": { en: "Rain", de: "Regen" },
    "11d": { en: "Thunderstorm", de: "Gewitter" },
    "11n": { en: "Thunderstorm", de: "Gewitter" },
    "13d": { en: "Snow", de: "Schnee" },
    "13n": { en: "Snow", de: "Schnee" },
    "50d": { en: "Mist/Fog", de: "Nebel" },
    "50n": { en: "Mist/Fog", de: "Nebel" },
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
    stationStateObjects = new Set();
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
    async writeStationState(deviceId, suffix, value) {
        if (value === null || value === undefined || value === "") {
            return;
        }
        const fullId = `${deviceId}.${suffix}`;
        if (!this.stationStateObjects.has(fullId)) {
            const def = stationStateMap.get(suffix);
            if (def) {
                await this.adapter.extendObjectAsync(fullId, {
                    type: "state",
                    common: buildStateCommon(def),
                    native: {},
                });
            }
            this.stationStateObjects.add(fullId);
        }
        await this.boundSetState(fullId, value, true);
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
        const w = (suffix, value) => this.writeStationState(deviceId, suffix, value);
        const lastDataStr = data.last_data_time || "";
        await Promise.all([
            w("grid.power", num(data.real_power)),
            w("grid.dailyEnergy", toKwh(data.today_eq)),
            w("grid.monthEnergy", toKwh(data.month_eq)),
            w("grid.yearEnergy", toKwh(data.year_eq)),
            w("grid.totalEnergy", toKwh(data.total_eq)),
            w("grid.co2Saved", Math.round(num(data.co2_emission_reduction) / 10) / 100),
            w("grid.treesPlanted", num(data.plant_tree)),
            w("grid.isBalance", !!data.is_balance),
            w("grid.isReflux", !!data.is_reflux),
            w("info.lastCloudUpdate", data.data_time ? new Date(`${data.data_time} UTC`).getTime() : null),
            w("info.lastDataTime", lastDataStr ? new Date(`${lastDataStr} UTC`).getTime() : null),
        ]);
    }
    async pollStationDetails(stationId, deviceId, realtimeData) {
        try {
            const details = await this.cloud.getStationDetails(stationId);
            const w = (suffix, value) => this.writeStationState(deviceId, suffix, value);
            const lat = details.latitude != null ? num(details.latitude) : null;
            const lon = details.longitude != null ? num(details.longitude) : null;
            const tzOffsetS = details.timezone?.offset ?? 0;
            if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
                this.stationCoords.set(stationId, { lat, lon, tzOffsetS });
            }
            const price = details.electricity_price ?? null;
            await Promise.all([
                w("info.stationName", details.name || null),
                w("info.stationId", stationId),
                w("info.systemCapacity", details.capacitor != null ? num(details.capacitor) : null),
                w("info.address", details.address || null),
                w("info.latitude", lat),
                w("info.longitude", lon),
                w("info.stationStatus", details.status ?? null),
                w("info.installedAt", details.create_at ? new Date(`${details.create_at} UTC`).getTime() : null),
                w("info.timezone", details.timezone?.tz_name || null),
                w("grid.electricityPrice", price),
                w("grid.currency", details.money_unit || null),
                w("grid.todayIncome", price ? Math.round(toKwh(realtimeData.today_eq) * price * 100) / 100 : null),
                w("grid.totalIncome", price ? Math.round(toKwh(realtimeData.total_eq) * price * 100) / 100 : null),
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
                writes.push(s(`${sn}.inverter.model`, inv.model_no || "", true));
                if (!isLocal) {
                    writes.push(s(`${sn}.inverter.serialNumber`, inv.sn || "", true), s(`${sn}.inverter.swVersion`, inv.soft_ver || "", true), s(`${sn}.inverter.hwVersion`, inv.hard_ver || "", true), s(`${sn}.inverter.linkStatus`, inv.warn_data?.connect ? 1 : 0, true));
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
            const w = (suffix, value) => this.writeStationState(deviceId, suffix, value);
            const desc = WEATHER_DESCRIPTIONS[weather.icon];
            await Promise.all([
                w("weather.icon", weather.icon || null),
                w("weather.description", desc?.en || weather.icon || null),
                w("weather.temperature", weather.temp ?? null),
                w("weather.sunrise", weather.sunrise ? weather.sunrise * 1000 : null),
                w("weather.sunset", weather.sunset ? weather.sunset * 1000 : null),
            ]);
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