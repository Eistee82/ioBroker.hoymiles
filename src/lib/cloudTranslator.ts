/**
 * Cloud downlink translation table — **for the TCP devices (HMS-*-xT) only**.
 *
 * Why this is not a general "cloud" module: the relay exists solely because a TCP DTU serves
 * a single socket on port 10081. While the adapter holds it, the DTU cannot talk to the cloud,
 * so the adapter uploads on its behalf and consequently receives the cloud's downlinks. A BLE
 * device (HMS-800-2WB) has no local TCP port; the adapter reaches it over GATT and never takes
 * its cloud socket away, so that device keeps its own cloud connection and no relay runs for
 * it. Tags that only the 2WB firmware dispatches therefore cannot arrive here and are
 * deliberately absent from this table — they are documented in
 * `_fwanalysis/hms800-2wb/INTERFACE_REFERENCE_2WB.md`, which is firmware documentation rather
 * than a description of what the relay can see.
 *
 * Everything the cloud sends back arrives as an HM frame with a `0x23NN` tag. Two facts from
 * the firmware shape how those frames must be treated, and both are easy to get wrong:
 *
 * 1. **Most `0x23NN` frames are acknowledgements, not commands.** Both firmwares share the
 *    cloud family for these low bytes, but only the 2WB spells the names out in its log —
 *    `TAG_HBRes`, `TAG_RealRes`, `TAG_InfoDataRes`. That is where the names below come from,
 *    and they say plainly what these frames are: the cloud's answer to an upload *we* sent. They carry the server time, a timezone
 *    offset and an error code. Forwarding one to the device would be nonsense; dropping it
 *    silently loses the time sync and hides upload rejections.
 * 2. **Request and response families are symmetric and separate.** In `hm_proto_parse_dispatch`
 *    the handler for `0x2305` (@`0x4081509c`) stores the tag `0x2305` in one pending slot
 *    (`gp-108278`) and answers on `0x2205`/`0x2206`; the handler for `0xa305` (@`0x40816574`)
 *    stores `0xa305` in a *different* slot (`gp-108276`) and answers on `0xa206`. Both live
 *    in the same dispatcher and are reachable over the same local socket — so a cloud-tagged
 *    command can be handed to the device unchanged, and its answer comes back cloud-tagged.
 *    That is why forwarding works without re-encoding, and why the tag must **not** be
 *    rewritten to the `0xa3` family on the way.
 *
 * Evidence: `_fwanalysis/DISPATCH_2T.md` (2T, every tag simulated), `_fwanalysis/hms800-2wb/DISPATCH_2WB.md`
 * (2WB, log labels are the firmware's own strings), `_fwanalysis/INTERFACE_REFERENCE_2T.md` §3.
 */

/** How the relay has to treat an incoming cloud frame. */
export type CloudTagKind =
	/** The cloud acknowledges an upload of ours. Consume it; never forward it to the device. */
	| "ack"
	/** A genuine command for the device. May be handed to the local connection. */
	| "command"
	/**
	 * Carries or requests configuration. Reported by name and never forwarded — the adapter has
	 * no proven contract for these, and a configuration write is the one thing that must not be
	 * passed through on a guess. Grouped separately from `unverified` because their purpose *is*
	 * established even though their payload handling is not.
	 */
	| "config"
	/** Known to exist, but its contract is not established. Reported, never guessed at. */
	| "unverified";

/** What the firmware dispatches for one `0x23NN` downlink tag. */
export interface CloudTagInfo {
	/** Low byte of the `0x23NN` downlink tag. */
	low: number;
	/** Name the firmware itself uses (taken from the 2WB log strings; the family is shared). */
	name: string;
	/** How the relay has to treat it. */
	kind: CloudTagKind;
	/** Proto message carrying the payload, where the adapter has a definition for it. */
	decode?: {
		/** Proto file name as registered in the handler. */
		proto: string;
		/** Message name inside that file. */
		message: string;
	};
	/** Short note for the log when the tag cannot be acted on. */
	note?: string;
}

/**
 * Every downlink tag the TCP firmware dispatches. Exhaustive: each of the 1024 possible tag
 * values was simulated through the switch (`_fwanalysis/DISPATCH_2T.md`), so a tag missing from
 * this table is one the device would drop into its default branch.
 */
export const CLOUD_DOWNLINK_TAGS: readonly CloudTagInfo[] = [
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
] as const;

const BY_LOW = new Map(CLOUD_DOWNLINK_TAGS.map(t => [t.low, t]));

/**
 * Look up a downlink tag.
 *
 * @param low - Low byte of the `0x23NN` tag.
 * @returns The table entry, or `undefined` when the firmware dispatches no such tag.
 */
export function describeCloudTag(low: number): CloudTagInfo | undefined {
	return BY_LOW.get(low);
}

/**
 * Human-readable label for a downlink tag — used in every log line so an unhandled frame is
 * still identifiable instead of appearing as a bare number.
 *
 * @param low - Low byte of the `0x23NN` tag.
 */
export function cloudTagLabel(low: number): string {
	const info = BY_LOW.get(low);
	const hex = `0x23${low.toString(16).padStart(2, "0")}`;
	return info ? `${hex} ${info.name}` : `${hex} (not dispatched by either firmware)`;
}

/**
 * Action codes that must never be executed just because the cloud asked for them.
 *
 * `2` and `15` are established: `ACTIONS_2T.md` shows the payload being parsed against the
 * literal `"http://"` and turned into a download descriptor — an OTA firmware download.
 * Relaying that unattended can leave the user with a bricked device.
 *
 * `52`–`57` are refused as a **precaution, not on a proven contract**: their arms allocate a
 * buffer, split the payload on `\r` and write into persistent locations. What exactly they
 * configure is not established, so the safe direction is to refuse. If one of them turns out
 * to be harmless, removing it from this list is the smaller correction.
 */
export const REFUSED_ACTIONS: ReadonlyMap<number, string> = new Map([
	[2, "starts an OTA firmware download"],
	[15, "starts an OTA firmware download"],
	[52, "writes persistent state whose contract is not established"],
	[53, "writes persistent state whose contract is not established"],
	[54, "writes persistent state whose contract is not established"],
	[56, "writes persistent state whose contract is not established"],
	[57, "writes persistent state whose contract is not established"],
]);

/**
 * Whether a command action may be handed to the device unattended.
 *
 * @param action - Action code from `CommandResDTO`.
 * @returns `null` when forwarding is allowed, otherwise the reason it is refused.
 */
export function refusalReason(action: number): string | null {
	return REFUSED_ACTIONS.get(action) ?? null;
}
