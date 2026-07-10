import { BURST_MIN_INTERVAL_MS, BURST_MAX_INTERVAL_MS, BURST_URI_REFRESH_MS } from "./constants.js";
import { anonymize, errorMessage } from "./utils.js";
class BurstPoller {
    cloud;
    adapter;
    devices;
    stationDevices;
    stations;
    stopped;
    constructor(options) {
        this.cloud = options.cloud;
        this.adapter = options.adapter;
        this.devices = options.devices;
        this.stationDevices = options.stationDevices;
        this.stations = new Map();
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
            for (const inv of data.mis ?? []) {
                await this.writeInverter(sb, inv);
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
    async writeInverter(sb, inv) {
        const target = sb.targets.get(inv.sn);
        if (!target) {
            return;
        }
        const sn = target.dtuSerial;
        const cs = (id, val) => this.adapter.setStateAsync(id, { val, ack: true, q: 0x40 }).then(() => { });
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
}
export default BurstPoller;
//# sourceMappingURL=burstPoller.js.map