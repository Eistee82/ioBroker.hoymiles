import { toKwh } from "./convert.js";
import { MAX_PV_PORTS } from "./deviceContext.js";
import { CLOUD_POLL_CONCURRENCY, CLOUD_STATION_STALE_MS, DEFAULT_POLL_MS, MIN_POLL_MS, RELAY_POLL_DELAY_MS, } from "./constants.js";
import { formatDtuVersion, formatSwVersion } from "./protobufHandler.js";
import { anonymize, deriveStationTzOffsetMs, errorMessage, logOnError, mapLimit, stationWallClockToEpoch, } from "./utils.js";
import { stationStateMap, stationIndicatorStateMap, stationIndicatorChannels, hybridStateMap, hybridChannels, buildStateCommon, } from "./stateDefinitions.js";
import { mapCloudGridProfile } from "./gridProfile.js";
import { CLOUD_DEV_TYPE_BATTERY, CLOUD_DEV_TYPE_BATTERY_PACK, CLOUD_DEV_TYPE_HYBRID_INVERTER, REAL_INDICATOR_TYPE_PV, mapBatterySettings, DAY_CURVES, ENERGY_STATS_MODES, hybridInverterActive, inverterHasPv, mapCloudAlarms, mapDayCurve, mapDryContactSettings, mapEnergyStats, mapIncomeStats, mapRealIndicators, mapStorageStationData, stationIndicatorTypes, } from "./hybridCloud.js";
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
const hybridChannelMap = new Map(hybridChannels.map(c => [c.id, c]));
const stationIndicatorChannelMap = new Map(stationIndicatorChannels.map(c => [c.id, c]));
const isHybridInverter = (node) => node.type === CLOUD_DEV_TYPE_HYBRID_INVERTER;
const BATTERY_SETTINGS_MAX_ATTEMPTS = 3;
class CloudPoller {
    static PORT_COUNT_RE = /(\d+)\s*(?:T|WB)$/i;
    cloud;
    adapter;
    devices;
    stationDevices;
    slowPollFactor;
    hasRelay;
    burstActiveStations;
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
    gridProfileRead = new Set();
    hybridObjects = new Map();
    reportedUnknownKeys = new Set();
    multiBatteryReported = new Set();
    batterySettingsAttempts = new Map();
    dryContactAttempts = new Map();
    inverterWithoutPv = new Set();
    constructor(options) {
        this.cloud = options.cloud;
        this.adapter = options.adapter;
        this.devices = options.devices;
        this.stationDevices = options.stationDevices;
        this.slowPollFactor = options.slowPollFactor;
        this.hasRelay = options.hasRelay;
        this.burstActiveStations = options.burstActiveStations;
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
            const def = stationStateMap.get(suffix) ?? stationIndicatorStateMap.get(suffix);
            const channelId = suffix.slice(0, suffix.indexOf("."));
            const channel = stationIndicatorChannelMap.get(channelId);
            if (channel && !this.stationStateObjects.has(`${deviceId}.${channelId}`)) {
                this.stationStateObjects.add(`${deviceId}.${channelId}`);
                await this.adapter.setObjectNotExistsAsync(`${deviceId}.${channelId}`, {
                    type: "channel",
                    common: { name: channel.name },
                    native: {},
                });
            }
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
            let anyStationLive = false;
            await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async (stationId) => {
                const deviceId = `station-${stationId}`;
                if (await this.stationResumedUploading(stationId)) {
                    anyStationLive = true;
                }
                await this.pollWeather(stationId, deviceId);
                if (this.firmwareCheckDue(stationId)) {
                    await this.pollFirmwareStatus(stationId);
                }
            });
            await this.setCloudConnected(true);
            if (anyStationLive && this.state === "NIGHT_MODE") {
                this.adapter.log.info("Cloud station is uploading again — resuming active cloud polling (no local connection needed)");
                this.state = "POLLING_ACTIVE";
                await this.poll();
                this.scheduleCloudPoll();
            }
        }
        catch (err) {
            this.adapter.log.warn(`Night poll failed: ${errorMessage(err)}`);
            await this.setCloudConnected(false);
        }
    }
    async stationResumedUploading(stationId) {
        try {
            const data = await this.cloud.getStationRealtime(stationId);
            const epoch = stationWallClockToEpoch(data.data_time, this.stationTzOffsetMs.get(stationId) ?? 0);
            return epoch != null && Date.now() - epoch < CLOUD_STATION_STALE_MS;
        }
        catch (err) {
            this.adapter.log.debug(`Night wake-up check failed for station ${stationId}: ${errorMessage(err)}`);
            return false;
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
        await this.pollStationIndicators(stationId, deviceId, data.reflux_station_data, online);
        const storage = mapStorageStationData(data.reflux_station_data);
        if (storage) {
            await this.pollEnergyStats(stationId, deviceId, online, slowPoll, storage.hasBattery);
        }
        if (slowPoll) {
            await this.pollIncome(stationId, deviceId);
            await this.pollWeather(stationId, deviceId);
            if (this.firmwareCheckDue(stationId)) {
                await this.pollFirmwareStatus(stationId);
            }
        }
        await this.pollDevicesAndInverters(stationId, slowPoll, online);
        if (online && storage?.battery.length) {
            const hybrids = this.hybridDevicesOf(stationId);
            await this.ensureBatteryControls(hybrids);
            const attempts = this.batterySettingsAttempts.get(stationId) ?? 0;
            if (hybrids.length > 0 && attempts < BATTERY_SETTINGS_MAX_ATTEMPTS) {
                void this.readBatterySettings(stationId);
            }
            const relayAttempts = this.dryContactAttempts.get(stationId) ?? 0;
            if (hybrids.length > 0 && relayAttempts < BATTERY_SETTINGS_MAX_ATTEMPTS) {
                void this.readDryContactSettings(stationId);
            }
        }
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
        const writes = [
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
        ];
        const burstOwnsFlow = this.burstActiveStations.has(stationId);
        if (!burstOwnsFlow) {
            writes.push(w("grid.power", num(data.real_power)));
        }
        const storage = mapStorageStationData(data.reflux_station_data);
        if (inverterHasPv(data.reflux_station_data)) {
            this.inverterWithoutPv.delete(stationId);
        }
        else {
            this.inverterWithoutPv.add(stationId);
        }
        if (storage) {
            const ws = (suffix, value) => w(suffix, value).catch(err => {
                this.adapter.log.warn(`Cloud state write failed: ${errorMessage(err)}`);
            });
            for (const sn of this.hybridDevicesOf(stationId)) {
                for (const b of storage.battery) {
                    writes.push(this.writeHybridState(sn, b.suffix, b.val, q).catch(err => {
                        this.adapter.log.warn(`Cloud state write failed: ${errorMessage(err)}`);
                    }));
                }
            }
            if (!burstOwnsFlow) {
                for (const f of storage.flow) {
                    writes.push(ws(f.suffix, f.val));
                }
            }
        }
        await Promise.all(writes);
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
    async pollDevicesAndInverters(stationId, isSlowPoll, online) {
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
        for (const dtu of deviceTree) {
            const dev = this.devices.get(dtu.sn);
            if (dev && dtu.children?.some(isHybridInverter)) {
                dev.hybridInverter = true;
            }
        }
        await this.updateCloudConnectedStates(deviceTree);
        if (isSlowPoll && deviceTree.length > 0) {
            await this.updateDeviceVersions(deviceTree);
            await this.pollHybridExtras(stationId, deviceTree, online);
            await this.pollGridProfiles(deviceTree);
        }
        await this.pollInverterRealtimeData(stationId, deviceTree, online);
    }
    async pollGridProfiles(deviceTree) {
        for (const dtu of deviceTree) {
            const dev = this.devices.get(dtu.sn);
            if (!dev?.dtuSerial || dev.connection?.connected || this.gridProfileRead.has(dev.dtuSerial)) {
                continue;
            }
            const inv = dtu.children?.[0];
            if (!inv?.sn || isHybridInverter(inv)) {
                continue;
            }
            try {
                const params = await this.cloud.readGridProfileViaCloud(inv.sn, dtu.sn);
                const decoded = mapCloudGridProfile(params);
                const writes = [
                    this.boundSetState(`${dev.dtuSerial}.gridProfile.standard`, decoded.standard, true),
                ];
                for (const [key, val] of Object.entries(decoded.values)) {
                    writes.push(this.boundSetState(`${dev.dtuSerial}.gridProfile.${key}`, val, true));
                }
                await Promise.all(writes);
                this.gridProfileRead.add(dev.dtuSerial);
                this.adapter.log.debug(`Grid profile read via cloud for ${anonymize(dev.dtuSerial, "dtu")}: ${decoded.standard}`);
            }
            catch (err) {
                this.adapter.log.debug(`Cloud grid profile read failed for ${anonymize(dev.dtuSerial, "dtu")}: ${errorMessage(err)}`);
            }
        }
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
                if (inv.sn) {
                    dtuDevice.setCloudInverterSn(inv.sn);
                }
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
    async pollInverterRealtimeData(stationId, deviceTree, online) {
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
            const hybrids = [];
            for (const inv of dtu.children || []) {
                if (!inv.id) {
                    continue;
                }
                if (isHybridInverter(inv)) {
                    hybrids.push(inv);
                }
                else {
                    microIds.push(inv.id);
                }
            }
            if (microIds.length === 0 && hybrids.length === 0) {
                continue;
            }
            dtuTasks.push({ dtu, dtuDev, sn, microIds, hybrids });
        }
        if (dtuTasks.length === 0) {
            return;
        }
        await mapLimit(dtuTasks, CLOUD_POLL_CONCURRENCY, async ({ dtu, dtuDev, sn, microIds, hybrids }) => {
            try {
                this.lastRealtimeFetch.set(sn, now);
                for (const inv of hybrids) {
                    await this.pollHybridInverter(stationId, dtuDev, sn, inv, online);
                }
                if (microIds.length === 0) {
                    return;
                }
                const s = this.boundSetState;
                const devConnected = dtu.children?.some(inv => inv.warn_data?.connect) ?? false;
                const q = online && devConnected ? 0x00 : 0x42;
                const cs = (id, val) => s(id, { val, ack: true, q }).then(() => { });
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
                const children = (dtu.children || []).filter(inv => !isHybridInverter(inv));
                const portRules = await this.cloud.getMicroPortRules();
                if (!dtuDev.pvStatesCreated && children.length > 0) {
                    let maxPorts = 0;
                    for (const inv of children) {
                        maxPorts = Math.max(maxPorts, this.resolvePortCount(inv, portRules, dtuDev.pvCount));
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
                    const portCount = this.resolvePortCount(inv, portRules, dtuDev.pvCount);
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
    async pollHybridInverter(stationId, dtuDev, sn, inv, online) {
        const q = online && inv.warn_data?.connect ? 0x00 : 0x42;
        const writes = [];
        const invData = await this.cloud.getRealIndicators(stationId, {
            type: CLOUD_DEV_TYPE_HYBRID_INVERTER,
            inv_list: [{ id: inv.id, sn: inv.sn, type: CLOUD_DEV_TYPE_HYBRID_INVERTER }],
        });
        const mapped = mapRealIndicators(invData);
        this.reportUnknownKeys(invData?.title, mapped.unknownKeys);
        for (const v of mapped.values) {
            if (v.id === "grid.power" && dtuDev.burstActive) {
                continue;
            }
            writes.push(this.writeHybridState(sn, v.id, v.val, q));
        }
        const active = hybridInverterActive(mapped.values, inv.warn_data?.connect === true);
        if (active !== null) {
            writes.push(this.writeHybridState(sn, "inverter.active", active, q));
        }
        const reportedInputs = typeof invData?.pv_total === "number" ? invData.pv_total : 0;
        let pvValues = 0;
        if (reportedInputs > 0 && !this.inverterWithoutPv.has(stationId)) {
            const pvData = await this.cloud.getRealIndicators(stationId, {
                type: REAL_INDICATOR_TYPE_PV,
                inv_list: [{ id: inv.id, sn: inv.sn, type: CLOUD_DEV_TYPE_HYBRID_INVERTER }],
            });
            const pvMapped = mapRealIndicators(pvData);
            this.reportUnknownKeys(pvData?.title, pvMapped.unknownKeys);
            pvValues = pvMapped.pv.length;
            const pvInputs = Math.min(Math.max(reportedInputs, ...pvMapped.pv.map(v => v.port + 1)), MAX_PV_PORTS);
            if (!dtuDev.pvStatesCreated || pvInputs > dtuDev.pvCount) {
                await dtuDev.createPvStates(Math.max(pvInputs, dtuDev.pvCount), true);
                dtuDev.pvStatesCreated = true;
            }
            for (const v of pvMapped.values) {
                writes.push(this.writeHybridState(sn, v.id, v.val, q));
            }
            for (const v of pvMapped.pv) {
                if (v.port >= dtuDev.pvCount) {
                    continue;
                }
                if (v.field === "dailyEnergy") {
                    await this.createHybridObjectOnce(`${sn}.pv${v.port}.dailyEnergy`, () => this.adapter.extendObjectAsync(`${sn}.pv${v.port}.dailyEnergy`, {
                        type: "state",
                        common: {
                            name: { en: `PV${v.port} daily energy`, de: `PV${v.port} Tagesenergie` },
                            type: "number",
                            role: "value.energy",
                            unit: "kWh",
                            read: true,
                            write: false,
                            def: 0,
                        },
                        native: {},
                    }));
                }
                writes.push(this.writeHybridState(sn, `pv${v.port}.${v.field}`, v.val, q));
            }
        }
        const batteries = (inv.children ?? []).filter(c => c.type === CLOUD_DEV_TYPE_BATTERY || c.type === CLOUD_DEV_TYPE_BATTERY_PACK);
        if (batteries.length > 1 && !this.multiBatteryReported.has(sn)) {
            this.multiBatteryReported.add(sn);
            this.adapter.log.warn(`Hybrid inverter ${anonymize(sn, "dtu")} reports ${batteries.length} batteries — only the first one is read. Please open an issue so the others can be supported.`);
        }
        for (const bat of batteries.slice(0, 1)) {
            const batConnected = !!bat.warn_data?.connect;
            const bq = online && batConnected ? 0x00 : 0x42;
            const extend = (bat.extend_data ?? {});
            const capacity = num(String(extend.bms_capacitor ?? ""));
            const identity = [
                ["battery.serialNumber", bat.sn || null],
                ["battery.model", bat.model_no || null],
                ["battery.swVersion", bat.soft_ver || null],
                ["battery.hwVersion", bat.hard_ver || null],
                ["battery.capacity", capacity > 0 ? capacity : null],
                ["battery.connected", batConnected],
            ];
            for (const [id, val] of identity) {
                if (val !== null) {
                    writes.push(this.writeHybridState(sn, id, val, 0x00));
                }
            }
            const batData = await this.cloud.getRealIndicators(stationId, {
                type: bat.type,
                inv_list: [{ id: inv.id, sn: inv.sn, type: 0 }],
                dev_sn: bat.sn,
            });
            const batMapped = mapRealIndicators(batData);
            this.reportUnknownKeys(batData?.title, batMapped.unknownKeys);
            for (const v of batMapped.values) {
                if (v.id === "battery.soc" && this.burstActiveStations.has(stationId)) {
                    continue;
                }
                writes.push(this.writeHybridState(sn, v.id, v.val, bq));
            }
        }
        const results = await Promise.allSettled(writes);
        for (const r of results) {
            if (r.status === "rejected") {
                this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
            }
        }
        this.adapter.log.debug(`Hybrid inverter ${anonymize(sn, "dtu")}: ${mapped.values.length} inverter value(s), ${pvValues} PV value(s), data_time=${invData?.last_data_time ?? "n/a"}`);
    }
    async pollStationIndicators(stationId, deviceId, storageBlock, online) {
        const quality = online ? 0x00 : 0x42;
        for (const type of stationIndicatorTypes(storageBlock)) {
            const data = await this.cloud.getRealIndicators(stationId, { type });
            const mapped = mapRealIndicators(data);
            this.reportUnknownKeys(data?.title, mapped.unknownKeys);
            const results = await Promise.allSettled(mapped.values.map(v => this.writeStationState(deviceId, v.id, v.val, quality)));
            for (const r of results) {
                if (r.status === "rejected") {
                    this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
                }
            }
        }
    }
    async pollEnergyStats(stationId, deviceId, online, slowPoll, hasBattery) {
        const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
        const today = new Date(Date.now() + offsetMs).toISOString().substring(0, 10);
        const quality = online ? 0x00 : 0x42;
        for (const { mode, period, slowPoll: slowOnly } of ENERGY_STATS_MODES) {
            if (slowOnly && !slowPoll) {
                continue;
            }
            let values;
            try {
                values = mapEnergyStats(period, await this.cloud.getStationEnergyStats(stationId, mode, today), hasBattery);
            }
            catch (err) {
                this.adapter.log.debug(`Energy stats (${period}) failed for station ${stationId}: ${errorMessage(err)}`);
                continue;
            }
            const results = await Promise.allSettled(values.map(v => this.writeStationState(deviceId, v.suffix, v.val, quality)));
            for (const r of results) {
                if (r.status === "rejected") {
                    this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
                }
            }
        }
    }
    hybridDevicesOf(stationId) {
        const serials = [];
        for (const dev of this.devices.values()) {
            if (dev.cloudStationId === stationId && dev.hybridInverter && dev.dtuSerial) {
                serials.push(dev.dtuSerial);
            }
        }
        return serials;
    }
    async ensureBatteryControls(serials) {
        for (const sn of serials) {
            for (const suffix of ["battery.readSettings", "dryContact.readSettings"]) {
                const fullId = `${sn}.${suffix}`;
                if (this.hybridObjects.has(fullId)) {
                    continue;
                }
                await this.writeHybridState(sn, suffix, false, 0x00);
                this.adapter.subscribeStates(fullId);
            }
        }
    }
    async readDryContactSettings(stationId) {
        const attempts = (this.dryContactAttempts.get(stationId) ?? 0) + 1;
        this.dryContactAttempts.set(stationId, attempts);
        const serials = this.hybridDevicesOf(stationId);
        try {
            const result = await this.cloud.readDryContactSettings(stationId);
            this.dryContactAttempts.set(stationId, BATTERY_SETTINGS_MAX_ATTEMPTS);
            const values = mapDryContactSettings(result);
            if (values.length === 0) {
                this.adapter.log.debug(`Dry-contact settings of station ${stationId}: nothing to read`);
                return;
            }
            for (const sn of serials) {
                for (const v of values) {
                    await this.writeHybridState(sn, v.suffix, v.val, 0x00);
                }
                await this.writeHybridState(sn, "dryContact.settingsUpdated", Date.now(), 0x00);
            }
            this.adapter.log.debug(`Dry-contact settings of station ${stationId} read`);
        }
        catch (err) {
            const again = attempts < BATTERY_SETTINGS_MAX_ATTEMPTS
                ? " — will try again on a later poll"
                : ` — giving up for this adapter run after ${attempts} attempts; press dryContact.readSettings to try again`;
            this.adapter.log.warn(`Reading the dry-contact settings of station ${stationId} failed: ${errorMessage(err)}${again}`);
        }
        finally {
            for (const sn of serials) {
                await this.boundSetState(`${sn}.dryContact.readSettings`, false, true).catch(() => { });
            }
        }
    }
    async pollIncome(stationId, deviceId) {
        let values;
        try {
            values = mapIncomeStats(await this.cloud.getIncomeStats(stationId));
        }
        catch (err) {
            this.adapter.log.debug(`Income stats failed for station ${stationId}: ${errorMessage(err)}`);
            return;
        }
        for (const r of await Promise.allSettled(values.map(v => this.writeStationState(deviceId, v.suffix, v.val)))) {
            if (r.status === "rejected") {
                this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
            }
        }
    }
    async pollHybridExtras(stationId, deviceTree, online) {
        const q = online ? 0x00 : 0x42;
        const offsetMs = this.stationTzOffsetMs.get(stationId) ?? 0;
        const today = new Date(Date.now() + offsetMs).toISOString().substring(0, 10);
        const dayStart = stationWallClockToEpoch(`${today} 00:00:00`, offsetMs) ?? Date.now();
        for (const dtu of deviceTree) {
            const dev = this.devices.get(dtu.sn);
            if (!dev?.dtuSerial || dev.connection?.connected) {
                continue;
            }
            const sn = dev.dtuSerial;
            for (const inv of (dtu.children ?? []).filter(isHybridInverter)) {
                const writes = [];
                try {
                    const alarms = mapCloudAlarms([
                        await this.cloud.getCloudAlarms(stationId, inv.sn, "flesw"),
                        await this.cloud.getCloudAlarms(stationId, dtu.sn, "fldw"),
                    ]);
                    writes.push(this.writeHybridState(sn, "alarms.cloudActiveCount", alarms.count, q));
                    writes.push(this.writeHybridState(sn, "alarms.cloudActiveJson", alarms.json, q));
                    const battery = (inv.children ?? []).find(child => child.type === CLOUD_DEV_TYPE_BATTERY);
                    let stepWritten = false;
                    for (const spec of DAY_CURVES) {
                        if (spec.needsPv && this.inverterWithoutPv.has(stationId)) {
                            continue;
                        }
                        if ((spec.devType === CLOUD_DEV_TYPE_BATTERY && !battery) || !inv.id || !inv.sn) {
                            continue;
                        }
                        const curve = mapDayCurve(await this.cloud.getIndicatorDayCurve(stationId, spec.devType, [{ id: inv.id, sn: inv.sn }], spec.indicator, today), dayStart);
                        if (!curve) {
                            continue;
                        }
                        writes.push(this.writeHybridState(sn, spec.suffix, curve.json, q));
                        if (!stepWritten) {
                            stepWritten = true;
                            writes.push(this.writeHybridState(sn, "history.startTime", curve.startTime, q));
                            writes.push(this.writeHybridState(sn, "history.stepTime", curve.stepTime, q));
                        }
                    }
                }
                catch (err) {
                    this.adapter.log.debug(`Hybrid extras failed for ${anonymize(sn, "dtu")}: ${errorMessage(err)}`);
                }
                for (const r of await Promise.allSettled(writes)) {
                    if (r.status === "rejected") {
                        this.adapter.log.warn(`Cloud state write failed: ${errorMessage(r.reason)}`);
                    }
                }
            }
        }
    }
    async readBatterySettings(stationId) {
        const attempts = (this.batterySettingsAttempts.get(stationId) ?? 0) + 1;
        this.batterySettingsAttempts.set(stationId, attempts);
        const serials = this.hybridDevicesOf(stationId);
        try {
            const values = mapBatterySettings(await this.cloud.readBatterySettings(stationId));
            this.batterySettingsAttempts.set(stationId, BATTERY_SETTINGS_MAX_ATTEMPTS);
            if (values.length === 0) {
                this.adapter.log.debug(`Battery settings of station ${stationId}: the device returned no mode`);
                return;
            }
            for (const sn of serials) {
                for (const v of values) {
                    await this.writeHybridState(sn, v.suffix, v.val, 0x00);
                }
                await this.writeHybridState(sn, "battery.settingsUpdated", Date.now(), 0x00);
            }
            this.adapter.log.debug(`Battery settings of station ${stationId} read`);
        }
        catch (err) {
            const again = attempts < BATTERY_SETTINGS_MAX_ATTEMPTS
                ? " — will try again on a later poll"
                : ` — giving up for this adapter run after ${attempts} attempts; press battery.readSettings to try again`;
            this.adapter.log.warn(`Reading the battery settings of station ${stationId} failed: ${errorMessage(err)}${again}`);
        }
        finally {
            for (const sn of serials) {
                await this.boundSetState(`${sn}.battery.readSettings`, false, true).catch(() => { });
            }
        }
    }
    async writeHybridState(sn, suffix, val, quality) {
        const fullId = `${sn}.${suffix}`;
        const def = hybridStateMap.get(suffix);
        if (def) {
            const channelId = suffix.slice(0, suffix.indexOf("."));
            const channel = hybridChannelMap.get(channelId);
            if (channel) {
                await this.createHybridObjectOnce(`${sn}.${channelId}`, () => this.adapter.setObjectNotExistsAsync(`${sn}.${channelId}`, {
                    type: "channel",
                    common: { name: channel.name },
                    native: {},
                }));
            }
            await this.createHybridObjectOnce(fullId, () => this.adapter.extendObjectAsync(fullId, {
                type: "state",
                common: buildStateCommon(def),
                native: {},
            }));
        }
        await this.boundSetState(fullId, { val, ack: true, q: quality });
    }
    createHybridObjectOnce(id, create) {
        let pending = this.hybridObjects.get(id);
        if (!pending) {
            pending = create().catch(err => {
                this.hybridObjects.delete(id);
                throw err;
            });
            this.hybridObjects.set(id, pending);
        }
        return pending;
    }
    reportUnknownKeys(title, keys) {
        const fresh = keys.filter(k => !this.reportedUnknownKeys.has(`${title}:${k}`));
        if (fresh.length === 0) {
            return;
        }
        for (const k of fresh) {
            this.reportedUnknownKeys.add(`${title}:${k}`);
        }
        this.adapter.log.debug(`Cloud indicator set ${title ?? "?"}: no state for key(s) ${fresh.join(", ")}`);
    }
    resolvePortCount(inv, portRules, knownPvCount) {
        const sn = inv.sn || "";
        const fromRules = portRules.get(sn.slice(0, 4)) ?? portRules.get(sn.slice(0, 3));
        if (fromRules) {
            return Math.min(fromRules, MAX_PV_PORTS);
        }
        const known = Number.isFinite(knownPvCount) ? knownPvCount : 0;
        const match = CloudPoller.PORT_COUNT_RE.exec(inv.model_no || "");
        if (!match) {
            this.adapter.log.debug(`No port rule for serial prefix and no port count in model "${inv.model_no}", ` +
                `falling back to ${Math.max(known, 2)}`);
        }
        const fromModel = match ? parseInt(match[1], 10) : 2;
        return Math.min(Math.max(fromModel, known, 1), MAX_PV_PORTS);
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