import { BURST_MIN_INTERVAL_MS, BURST_MAX_INTERVAL_MS, BURST_URI_REFRESH_MS, BURST_MAX_FAILURES, CLOUD_POLL_CONCURRENCY, } from "./constants.js";
import { stationStateMap, buildStateCommon } from "./stateDefinitions.js";
import { anonymize, errorMessage, mapLimit } from "./utils.js";
const num = (v) => (typeof v === "number" ? v : parseFloat(String(v)) || 0);
class BurstPoller {
    cloud;
    adapter;
    devices;
    stationDevices;
    burstActiveStations;
    stations;
    stationStateObjects;
    stopped;
    constructor(options) {
        this.cloud = options.cloud;
        this.adapter = options.adapter;
        this.devices = options.devices;
        this.stationDevices = options.stationDevices;
        this.burstActiveStations = options.burstActiveStations;
        this.stations = new Map();
        this.stationStateObjects = new Set();
        this.stopped = false;
    }
    async start() {
        await mapLimit([...this.stationDevices], CLOUD_POLL_CONCURRENCY, async (stationId) => {
            if (this.stopped) {
                return;
            }
            try {
                await this.startStation(stationId);
            }
            catch (err) {
                this.adapter.log.debug(`Burst: station ${stationId} start failed: ${errorMessage(err)}`);
            }
        });
    }
    stop() {
        this.stopped = true;
        for (const sb of this.stations.values()) {
            sb.stopped = true;
            this.burstActiveStations.delete(sb.stationId);
            for (const t of sb.targets.values()) {
                t.dev.burstActive = false;
            }
            if (sb.timer) {
                this.adapter.clearTimeout(sb.timer);
                sb.timer = undefined;
            }
        }
        this.stations.clear();
    }
    releaseDtu(dtuSerial) {
        for (const sb of this.stations.values()) {
            let removed = false;
            for (const [invSn, t] of sb.targets) {
                if (t.dtuSerial === dtuSerial) {
                    t.dev.burstActive = false;
                    sb.targets.delete(invSn);
                    removed = true;
                }
            }
            if (removed) {
                this.adapter.log.info(sb.targets.size === 0
                    ? `Burst: all inverters of station ${sb.stationId} now served locally — keeping only the live station-level power aggregate`
                    : `Burst: DTU ${dtuSerial} now served locally`);
            }
        }
    }
    async startStation(stationId) {
        const targets = new Map();
        let deviceTree = [];
        try {
            deviceTree = await this.cloud.getDeviceTree(stationId);
        }
        catch (err) {
            this.adapter.log.debug(`Burst: device tree for station ${stationId} failed: ${errorMessage(err)}`);
            return;
        }
        for (const dtu of deviceTree) {
            const dev = this.devices.get(dtu.sn);
            if (!dev?.dtuSerial || dev.enableLocal || dev.connection?.connected) {
                continue;
            }
            for (const inv of dtu.children ?? []) {
                if (inv.sn) {
                    targets.set(inv.sn, { dtuSerial: dev.dtuSerial, dev });
                }
            }
        }
        const uri = await this.cloud.getRealtimeUri(stationId);
        for (const t of targets.values()) {
            t.dev.burstActive = true;
        }
        this.burstActiveStations.add(stationId);
        const sb = {
            stationId,
            uri,
            uriFetchedAt: Date.now(),
            targets,
            timer: undefined,
            stopped: false,
            consecutiveFailures: 0,
            claimReleased: false,
        };
        this.stations.set(stationId, sb);
        this.adapter.log.info(targets.size === 0
            ? `Burst realtime started for station ${stationId} (station-level power aggregate only — all inverters served locally)`
            : `Burst realtime started for station ${stationId} (${targets.size} cloud-only inverter(s))`);
        void this.poll(sb);
    }
    async poll(sb) {
        if (sb.stopped || this.stopped) {
            return;
        }
        let nextDelay;
        try {
            if (Date.now() - sb.uriFetchedAt > BURST_URI_REFRESH_MS) {
                sb.uri = await this.cloud.getRealtimeUri(sb.stationId);
                sb.uriFetchedAt = Date.now();
            }
            let dly;
            if (sb.targets.size > 0) {
                const data = await this.cloud.pollRealtimeBurst(sb.uri, {
                    m: 3,
                    mis: [...sb.targets.keys()],
                    t: 1,
                });
                const quality = data.con === 1 ? 0x00 : 0x42;
                for (const inv of data.mis ?? []) {
                    await this.writeInverter(sb, inv, quality);
                }
                dly = data.dly;
            }
            const stationData = await this.cloud.pollRealtimeBurst(sb.uri, { m: 0, t: 1 });
            if (stationData.power) {
                const sq = stationData.con === 1 ? 0x00 : 0x42;
                await this.writeStation(sb.stationId, stationData.power, sq);
            }
            if (sb.claimReleased) {
                for (const t of sb.targets.values()) {
                    t.dev.burstActive = true;
                }
                this.burstActiveStations.add(sb.stationId);
                sb.claimReleased = false;
                this.adapter.log.info(`Burst realtime for station ${sb.stationId} resumed`);
            }
            sb.consecutiveFailures = 0;
            nextDelay = Math.min(Math.max(dly ?? stationData.dly ?? BURST_MIN_INTERVAL_MS, BURST_MIN_INTERVAL_MS), BURST_MAX_INTERVAL_MS);
        }
        catch (err) {
            sb.uriFetchedAt = 0;
            nextDelay = BURST_MAX_INTERVAL_MS;
            sb.consecutiveFailures++;
            if (!sb.claimReleased && sb.consecutiveFailures >= BURST_MAX_FAILURES) {
                for (const t of sb.targets.values()) {
                    t.dev.burstActive = false;
                }
                this.burstActiveStations.delete(sb.stationId);
                sb.claimReleased = true;
                this.adapter.log.info(`Burst realtime for station ${sb.stationId} paused after ${BURST_MAX_FAILURES} consecutive failures — the slow cloud poller takes over until the burst recovers`);
            }
            this.adapter.log.debug(`Burst: poll failed for station ${sb.stationId}: ${errorMessage(err)}`);
        }
        if (sb.stopped || this.stopped) {
            return;
        }
        sb.timer = this.adapter.setTimeout(() => {
            sb.timer = undefined;
            void this.poll(sb);
        }, nextDelay);
    }
    async writeInverter(sb, inv, quality) {
        const target = sb.targets.get(inv.sn);
        if (!target) {
            return;
        }
        const sn = target.dtuSerial;
        const cs = (id, val) => this.adapter.setStateAsync(id, { val, ack: true, q: quality }).then(() => { });
        const strings = [inv.p1, inv.p2, inv.p3, inv.p4].map(num);
        const activePv = strings.reduce((max, p, i) => (p > 0 ? i + 1 : max), 0);
        if (activePv > target.dev.pvCount && target.dev.deviceId) {
            await target.dev.createPvStates(activePv, true);
        }
        const writes = [cs(`${sn}.grid.power`, num(inv.pac))];
        for (let i = 0; i < target.dev.pvCount; i++) {
            writes.push(cs(`${sn}.pv${i}.power`, strings[i] ?? 0));
        }
        await Promise.allSettled(writes);
        this.adapter.log.debug(`Burst ${anonymize(sn, "dtu")}: pac=${num(inv.pac)}W pv=[${strings.slice(0, target.dev.pvCount).join(",")}]`);
    }
    async writeStation(stationId, power, quality) {
        const deviceId = `station-${stationId}`;
        const ws = (suffix, val) => this.writeStationState(deviceId, suffix, val, quality);
        await Promise.allSettled([
            ws("grid.power", num(power.pv)),
            ws("grid.gridPower", num(power.grid)),
            ws("grid.loadPower", num(power.load)),
            ws("grid.batteryPower", num(power.bat)),
            ws("grid.pvUtilization", num(power.pvr)),
        ]);
    }
    async writeStationState(deviceId, suffix, val, quality) {
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
        await this.adapter.setStateAsync(fullId, { val, ack: true, q: quality });
    }
}
export default BurstPoller;
//# sourceMappingURL=burstPoller.js.map