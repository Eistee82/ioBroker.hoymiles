import { toKwh } from "./convert.js";
import { CLOUD_POLL_CONCURRENCY, CLOUD_STATION_STALE_MS, DEFAULT_POLL_MS, MIN_POLL_MS, RELAY_POLL_DELAY_MS, } from "./constants.js";
import { formatDtuVersion, formatSwVersion } from "./protobufHandler.js";
import { anonymize, deriveStationTzOffsetMs, errorMessage, logOnError, mapLimit, stationWallClockToEpoch, } from "./utils.js";
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
    stationTzOffsetMs;
    lastFirmwareCheckDay;
    initialFetchDone;
    lastRealtimeFetch;
    stationOnline = new Map();
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
        this.stationTzOffsetMs = new Map();
        this.lastFirmwareCheckDay = new Map();
        this.lastRealtimeFetch = new Map();
        this.initialFetchDone = false;
        this.pollInProgress = false;
        this.boundSetState = this.adapter.setStateAsync.bind(this.adapter);
    }
    async writeStationState(deviceId, suffix, value, quality) {
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
        if (quality !== undefined) {
            await this.boundSetState(fullId, { val: value, ack: true, q: quality });
        }
        else {
            await this.boundSetState(fullId, value, true);
        }
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
        this.stationOnline.clear();
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
                if (this.firmwareCheckDue(stationId)) {
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
        const online = this.isStationFresh(stationId, data.data_time);
        const cameOnline = online && this.stationOnline.get(stationId) === false;
        this.stationOnline.set(stationId, online);
        if (cameOnline) {
            this.adapter.log.info(`Cloud station ${stationId} back online → forcing full refresh`);
        }
        const slowPoll = isSlowPoll || cameOnline;
        if (slowPoll) {
            await this.pollStationDetails(stationId, deviceId, data, online);
        }
        await this.setStationRealtimeStates(stationId, deviceId, data, online);
        if (slowPoll) {
            await this.pollWeather(stationId, deviceId);
            if (this.firmwareCheckDue(stationId)) {
                await this.pollFirmwareStatus(stationId);
            }
        }
        await this.pollDevicesAndInverters(stationId, slowPoll);
        this.adapter.log.debug(`Cloud data (station ${stationId}): ${data.real_power}W, today=${toKwh(data.today_eq).toFixed(2)}kWh, total=${toKwh(data.total_eq).toFixed(2)}kWh, online=${online}`);
    }
    isStationFresh(stationId, dataTime) {
        const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
        const epoch = stationWallClockToEpoch(dataTime, offsetMs);
        if (epoch == null) {
            return true;
        }
        return Date.now() - epoch < CLOUD_STATION_STALE_MS;
    }
    async setStationRealtimeStates(stationId, deviceId, data, online) {
        const q = online ? 0x00 : 0x42;
        const w = (suffix, value, quality = q) => this.writeStationState(deviceId, suffix, value, quality);
        const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
        const cloudUpdateEpoch = stationWallClockToEpoch(data.data_time, offsetMs);
        this.adapter.log.debug(`[diag] station ${stationId} lastCloudUpdate: data_time="${data.data_time ?? "<none>"}" ` +
            `offset=${offsetMs / 3600000}h → ${cloudUpdateEpoch != null ? new Date(cloudUpdateEpoch).toISOString() : "n/a"}`);
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
            w("info.lastCloudUpdate", cloudUpdateEpoch, 0x00),
            w("info.lastDataTime", stationWallClockToEpoch(data.last_data_time, offsetMs), 0x00),
        ]);
    }
    async pollStationDetails(stationId, deviceId, realtimeData, online) {
        try {
            const details = await this.cloud.getStationDetails(stationId);
            const w = (suffix, value) => this.writeStationState(deviceId, suffix, value);
            let lat = details.latitude != null ? num(details.latitude) : null;
            let lon = details.longitude != null ? num(details.longitude) : null;
            let address = details.address ?? null;
            const tzSource = details.local_time ?? realtimeData.local_time ?? null;
            const derivedOffsetMs = deriveStationTzOffsetMs(details.local_time, realtimeData.local_time);
            if (derivedOffsetMs != null) {
                this.stationTzOffsetMs.set(stationId, derivedOffsetMs);
            }
            const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
            const tzOffsetS = Math.round(offsetMs / 1000);
            this.adapter.log.debug(`[diag] station ${stationId} tz: local_time="${tzSource ?? "<none>"}" → offset=${offsetMs / 3600000}h`);
            if (lat == null || lon == null || (lat === 0 && lon === 0)) {
                try {
                    const ext = await this.cloud.getStationExtInfo(stationId);
                    if (ext) {
                        const extLat = ext.latitude != null ? num(ext.latitude) : null;
                        const extLon = ext.longitude != null ? num(ext.longitude) : null;
                        if (extLat != null && extLon != null && (extLat !== 0 || extLon !== 0)) {
                            lat = extLat;
                            lon = extLon;
                            address = ext.address ?? address;
                        }
                    }
                }
                catch (err) {
                    this.adapter.log.debug(`Station ext-info failed for ${stationId}: ${errorMessage(err)}`);
                }
            }
            if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
                this.stationCoords.set(stationId, { lat, lon, tzOffsetS });
            }
            const price = details.electricity_price ?? null;
            const wd = details.warn_data ?? realtimeData.warn_data;
            const wdSource = details.warn_data ? "station/find" : realtimeData.warn_data ? "realtime (home)" : "absent";
            this.adapter.log.debug(`[diag] station ${stationId} warn_data: ${wdSource}`);
            const stationOffline = online ? false : wd?.s_uoff;
            if (online && wd?.s_uoff) {
                this.adapter.log.debug(`[diag] station ${stationId}: s_uoff=true but realtime data is fresh → reporting stationOffline=false`);
            }
            await Promise.all([
                w("info.stationName", details.name || null),
                w("info.stationId", stationId),
                w("info.systemCapacity", details.capacitor != null ? num(details.capacitor) : null),
                w("info.address", address || null),
                w("info.latitude", lat),
                w("info.longitude", lon),
                w("info.stationStatus", details.status ?? null),
                w("info.installedAt", stationWallClockToEpoch(details.create_at, offsetMs)),
                w("info.timezone", details.timezone?.tz_name || null),
                w("grid.electricityPrice", price),
                w("grid.currency", details.money_unit || null),
                w("grid.todayIncome", price ? Math.round(toKwh(realtimeData.today_eq) * price * 100) / 100 : null),
                w("grid.totalIncome", price ? Math.round(toKwh(realtimeData.total_eq) * price * 100) / 100 : null),
                w("warn.stationOffline", stationOffline),
                w("warn.gridUnstable", wd?.s_ustable),
                w("warn.gridFault", wd?.g_warn),
                w("warn.deviceAlarm", wd?.l3_warn),
                w("warn.deviceIdWarning", wd?.s_uid),
                w("warn.meterFault", wd?.me_warn),
                w("warn.powerLimited", wd?.pw_off),
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
        await this.updateCloudConnectedStates(deviceTree);
        if (isSlowPoll && deviceTree.length > 0) {
            await this.updateDeviceVersions(deviceTree);
        }
        await this.pollInverterRealtimeData(stationId, deviceTree);
    }
    async updateCloudConnectedStates(deviceTree) {
        for (const dtu of deviceTree) {
            const dtuDev = this.devices.get(dtu.sn);
            if (!dtuDev?.dtuSerial) {
                continue;
            }
            const sn = anonymize(dtuDev.dtuSerial, "dtu");
            if (dtuDev.connection != null) {
                this.adapter.log.debug(`[diag] connected: ${sn} locally-configured → cloud leaves info.connected alone`);
                continue;
            }
            const online = dtu.children?.some(inv => inv.warn_data?.connect) ?? false;
            this.adapter.log.debug(`[diag] connected: ${sn} cloud-only → info.connected=${online} (from warn_data.connect)`);
            await this.boundSetState(`${dtuDev.dtuSerial}.info.connected`, online, true);
        }
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
            const writeIfFilled = (id, val) => {
                if (val) {
                    writes.push(s(id, val, true));
                }
            };
            writeIfFilled(`${sn}.dtu.serialNumber`, dtu.sn || "");
            writeIfFilled(`${sn}.dtu.swVersion`, dtu.soft_ver || "");
            writeIfFilled(`${sn}.dtu.hwVersion`, dtu.hard_ver || "");
            if (dtu.children?.[0]) {
                const inv = dtu.children[0];
                writeIfFilled(`${sn}.inverter.model`, inv.model_no || "");
                writeIfFilled(`${sn}.inverter.serialNumber`, inv.sn || "");
                writeIfFilled(`${sn}.inverter.swVersion`, inv.soft_ver || "");
                writeIfFilled(`${sn}.inverter.hwVersion`, inv.hard_ver || "");
                if (!isLocal) {
                    writes.push(s(`${sn}.inverter.linkStatus`, inv.warn_data?.connect ? 1 : 0, true));
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
                const writes = [];
                if (values.MI_POWER !== undefined && !dtuDev.burstActive) {
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
                            .then(modValues => this.setPvStates(cs, sn, p - 1, modValues, dtuDev.burstActive)));
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
        for (const sid of this.stationTzOffsetMs.keys()) {
            if (!this.stationDevices.has(sid)) {
                this.stationTzOffsetMs.delete(sid);
            }
        }
        for (const sid of this.lastFirmwareCheckDay.keys()) {
            if (!this.stationDevices.has(sid)) {
                this.lastFirmwareCheckDay.delete(sid);
            }
        }
    }
    async setPvStates(cs, sn, pvIndex, modValues, skipPower = false) {
        if (!modValues) {
            return;
        }
        const prefix = `${sn}.pv${pvIndex}`;
        const writes = [];
        if (modValues.MODULE_POWER !== undefined && !skipPower) {
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
    firmwareCheckDue(stationId) {
        const today = new Date().getDate();
        if (this.lastFirmwareCheckDay.get(stationId) === today) {
            return false;
        }
        this.lastFirmwareCheckDay.set(stationId, today);
        return true;
    }
    async pollFirmwareStatus(stationId) {
        try {
            for (const device of this.devices.values()) {
                if (device.cloudStationId !== stationId || !device.dtuSerial) {
                    continue;
                }
                const fw = await this.cloud.checkFirmwareUpdate(stationId, device.dtuSerial);
                const sn = device.dtuSerial;
                const fwDevices = fw.devices ?? [];
                this.adapter.log.debug(`[diag] firmware: ${anonymize(sn, "dtu")} station ${stationId} → ` +
                    `updateAvailable=${fw.upgrade > 0} devices=${fwDevices.length}`);
                const writes = [
                    this.boundSetState(`${sn}.dtu.fwUpdateAvailable`, fw.upgrade > 0, true).then(() => { }),
                ];
                for (const fwDev of fwDevices) {
                    if (fwDev.devType === 1 && fwDev.currentVer > 0) {
                        writes.push(this.boundSetState(`${sn}.dtu.swVersion`, formatDtuVersion(fwDev.currentVer), true).then(() => { }));
                    }
                    else if (fwDev.devType === 3 && fwDev.currentVer > 0) {
                        writes.push(this.boundSetState(`${sn}.inverter.swVersion`, formatSwVersion(fwDev.currentVer), true).then(() => { }));
                    }
                }
                await Promise.all(writes);
            }
        }
        catch (err) {
            this.adapter.log.debug(`Firmware check failed for station ${stationId}: ${errorMessage(err)}`);
        }
    }
}
export default CloudPoller;
//# sourceMappingURL=cloudPoller.js.map