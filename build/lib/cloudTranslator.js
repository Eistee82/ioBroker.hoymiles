export const CLOUD_DOWNLINK_TAGS = [
    {
        low: 0x01,
        name: "InfoDataRes",
        kind: "ack",
        decode: { proto: "APPInformationData", message: "APPInfoDataResDTO" },
    },
    {
        low: 0x02,
        name: "HBRes",
        kind: "ack",
        decode: { proto: "APPHeartbeatPB", message: "HBResDTO" },
    },
    {
        low: 0x05,
        name: "CommandRes",
        kind: "command",
        decode: { proto: "CommandPB", message: "CommandResDTO" },
    },
    {
        low: 0x06,
        name: "CommandStatusRes",
        kind: "ack",
        decode: { proto: "CommandPB", message: "CommandStatusResDTO" },
    },
    {
        low: 0x07,
        name: "DevConfigFetchRes",
        kind: "config",
        decode: { proto: "DevConfig", message: "DevConfigFetchResDTO" },
    },
    {
        low: 0x08,
        name: "DevConfigPutRes",
        kind: "config",
        decode: { proto: "DevConfig", message: "DevConfigPutResDTO" },
    },
    {
        low: 0x09,
        name: "WarnInfoRes / GetConfigRes",
        kind: "ack",
        note: "the 2T dispatches this as GetConfig, the 2WB logs it as WarnInfoRes",
    },
    { low: 0x0a, name: "WaveRes", kind: "unverified" },
    { low: 0x0b, name: "downlink 0x0b", kind: "unverified" },
    {
        low: 0x0c,
        name: "RealRes",
        kind: "ack",
        decode: { proto: "RealDataNew", message: "RealDataNewResDTO" },
    },
    { low: 0x0d, name: "HistoryRes", kind: "ack" },
    { low: 0x0e, name: "DevCfgReportRes", kind: "config" },
    { low: 0x12, name: "DTUSetConfigRes", kind: "config" },
    { low: 0x13, name: "DTUGetConfigRes", kind: "config" },
];
const BY_LOW = new Map(CLOUD_DOWNLINK_TAGS.map(t => [t.low, t]));
export function describeCloudTag(low) {
    return BY_LOW.get(low);
}
export function cloudTagLabel(low) {
    const info = BY_LOW.get(low);
    const hex = `0x23${low.toString(16).padStart(2, "0")}`;
    return info ? `${hex} ${info.name}` : `${hex} (not dispatched by either firmware)`;
}
export const REFUSED_ACTIONS = new Map([
    [2, "starts an OTA firmware download"],
    [15, "starts an OTA firmware download"],
    [52, "writes persistent state whose contract is not established"],
    [53, "writes persistent state whose contract is not established"],
    [54, "writes persistent state whose contract is not established"],
    [56, "writes persistent state whose contract is not established"],
    [57, "writes persistent state whose contract is not established"],
]);
export function refusalReason(action) {
    return REFUSED_ACTIONS.get(action) ?? null;
}
//# sourceMappingURL=cloudTranslator.js.map