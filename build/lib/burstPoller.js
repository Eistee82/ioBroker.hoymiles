import { BURST_MIN_INTERVAL_MS, BURST_MAX_INTERVAL_MS, BURST_URI_REFRESH_MS } from "./constants.js";
import { stationStateMap, buildStateCommon } from "./stateDefinitions.js";
import { anonymize, errorMessage } from "./utils.js";
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
        for (const stationId of this.stationDevices) {
            if (this.stopped) {
                return;
            }
            try {
                await this.startStation(stationId);
            }
            catch (err) {
                this.adapter.log.debug(`Burst: station ${stationId} start failed: ${errorMessage(err)}`);
            }
        }
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
            if (!dev?.dtuSerial || dev.connection?.connected) {
                continue;
            }
            for (const inv of dtu.children ?? []) {
                if (inv.sn) {
                    targets.set(inv.sn, { dtuSerial: dev.dtuSerial, dev });
                }
            }
        }
        if (targets.size === 0) {
            return;
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
        };
        this.stations.set(stationId, sb);
        this.adapter.log.info(`Burst realtime started for station ${stationId} (${targets.size} cloud-only inverter(s))`);
        void this.poll(sb);
    }
    async poll(sb) {
        if (sb.stopped || this.stopped) {
            return;
        }
        let nextDelay = BURST_MIN_INTERVAL_MS;
        try {
            if (Date.now() - sb.uriFetchedAt > BURST_URI_REFRESH_MS) {
                sb.uri = await this.cloud.getRealtimeUri(sb.stationId);
                sb.uriFetchedAt = Date.now();
            }
            const data = await this.cloud.pollRealtimeBurst(sb.uri, {
                m: 3,
                mis: [...sb.targets.keys()],
                t: 1,
            });
            const quality = data.con === 1 ? 0x00 : 0x42;
            for (const inv of data.mis ?? []) {
                await this.writeInverter(sb, inv, quality);
            }
            const stationData = await this.cloud.pollRealtimeBurst(sb.uri, { m: 0, t: 1 });
            if (stationData.power) {
                const sq = stationData.con === 1 ? 0x00 : 0x42;
                await this.writeStation(sb.stationId, stationData.power, sq);
            }
            nextDelay = Math.min(Math.max(data.dly ?? BURST_MIN_INTERVAL_MS, BURST_MIN_INTERVAL_MS), BURST_MAX_INTERVAL_MS);
        }
        catch (err) {
            sb.uriFetchedAt = 0;
            nextDelay = BURST_MAX_INTERVAL_MS;
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
        const strings = [inv.p1, inv.p2, inv.p3, inv.p4];
        const activePv = strings.reduce((max, p, i) => (p > 0 ? i + 1 : max), 0);
        if (activePv > target.dev.pvCount && target.dev.deviceId) {
            await target.dev.createPvStates(activePv, true);
        }
        const writes = [cs(`${sn}.grid.power`, inv.pac)];
        for (let i = 0; i < target.dev.pvCount; i++) {
            writes.push(cs(`${sn}.pv${i}.power`, strings[i] ?? 0));
        }
        await Promise.all(writes);
        this.adapter.log.debug(`Burst ${anonymize(sn, "dtu")}: pac=${inv.pac}W pv=[${strings.slice(0, target.dev.pvCount).join(",")}]`);
    }
    async writeStation(stationId, power, quality) {
        const deviceId = `station-${stationId}`;
        const ws = (suffix, val) => this.writeStationState(deviceId, suffix, val, quality);
        await Promise.all([
            ws("grid.power", power.pv),
            ws("grid.gridPower", power.grid),
            ws("grid.loadPower", power.load),
            ws("grid.batteryPower", power.bat),
            ws("grid.pvUtilization", power.pvr),
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