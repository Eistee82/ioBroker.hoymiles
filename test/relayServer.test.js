import assert from "node:assert";
import net from "node:net";
import { once } from "node:events";
import RelayServer from "../build/lib/relayServer.js";
import { ProtobufHandler } from "../build/lib/protobufHandler.js";
import { RELAY_SERVER_MAX_BUFFER_SIZE, RELAY_SERVER_IDLE_TIMEOUT_MS } from "../build/lib/constants.js";

// ============================================================
// Helpers: build HM-framed cloud-tag messages via the shared protobuf handler
// ============================================================
let protobuf;

function buildHeartbeat(dtuSn, seq = 1) {
	const HBReqDTO = protobuf.getType("APPHeartbeatPB", "HBReqDTO");
	const msg = HBReqDTO.create({ offset: 28800, time: 1700000000, dtuSerialNumber: dtuSn });
	return protobuf.buildMessage(0x22, 0x02, HBReqDTO.encode(msg).finish(), seq);
}

function buildRealData(dtuSn, dtuPower = 1000, cmdLow = 0x0c, seq = 2) {
	const ReqDTO = protobuf.getType("RealDataNew", "RealDataNewReqDTO");
	const msg = ReqDTO.create({ offset: 28800, time: 1700000000, deviceSerialNumber: dtuSn, dtuPower });
	return protobuf.buildMessage(0x22, cmdLow, ReqDTO.encode(msg).finish(), seq);
}

function buildRoutineDownlinkPoll(seq = 3) {
	const ResDTO = protobuf.getType("RealDataNew", "RealDataNewResDTO");
	const msg = ResDTO.create({ offset: 28800, time: 1700000000 });
	return protobuf.buildMessage(0x23, 0x0c, ResDTO.encode(msg).finish(), seq);
}

function buildDownlinkCommand(action = 41, tid = 5, seq = 4) {
	const ResDTO = protobuf.getType("CommandPB", "CommandResDTO");
	const msg = ResDTO.create({ time: 1700000000, action, tid, devKind: 1, packageNub: 1 });
	return protobuf.buildMessage(0x23, 0x05, ResDTO.encode(msg).finish(), seq);
}

function buildUplinkGridProfileUpload(seq = 6) {
	const ReqDTO = protobuf.getType("DevConfig", "DevConfigFetchReqDTO");
	const msg = ReqDTO.create({ requestTime: 1700000000, transactionId: 5, data: Buffer.from([1, 2, 3, 4]) });
	return protobuf.buildMessage(0x22, 0x0e, ReqDTO.encode(msg).finish(), seq);
}

// Waits until `predicate()` is true, polling every few ms (bounded by mocha's own test timeout).
async function waitUntil(predicate) {
	while (!predicate()) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

describe("relayServer", function () {
	before(async function () {
		this.timeout(10000);
		protobuf = new ProtobufHandler();
		await protobuf.loadProtos();
	});

	// ============================================================
	// Lifecycle (no network needed)
	// ============================================================
	describe("lifecycle", function () {
		it("starts not listening with no sessions", function () {
			const relay = new RelayServer(protobuf);
			assert.strictEqual(relay.listening, false);
			assert.strictEqual(relay.sessionCount, 0);
			relay.stop();
		});

		it("stop() before start() does not throw", function () {
			const relay = new RelayServer(protobuf);
			assert.doesNotThrow(() => relay.stop());
		});

		it("stop() is idempotent", function () {
			const relay = new RelayServer(protobuf);
			relay.stop();
			assert.doesNotThrow(() => relay.stop());
		});

		it("sendToDevice returns false when no session matches", function () {
			const relay = new RelayServer(protobuf);
			assert.strictEqual(relay.sendToDevice("UNKNOWN", Buffer.alloc(0)), false);
			relay.stop();
		});

		it("start() twice is a no-op (does not throw, does not rebind)", async function () {
			this.timeout(5000);
			const relay = new RelayServer(protobuf);
			relay.start(0, "127.0.0.1", 1);
			await once(relay, "listening");
			assert.doesNotThrow(() => relay.start(0, "127.0.0.1", 2));
			relay.stop();
		});
	});

	// ============================================================
	// Buffer-overflow guard (white-box: TS `private` compiles to a plain method)
	// ============================================================
	describe("_sniff buffer overflow guard", function () {
		it("discards and emits 'error' when a single chunk exceeds the max sniff buffer", function () {
			const relay = new RelayServer(protobuf);
			const session = {
				id: 1,
				dtuSn: "",
				upBuffer: Buffer.alloc(0),
				downBuffer: Buffer.alloc(0),
				closed: false,
				idleTimer: null,
				clientSocket: { writable: false },
				cloudSocket: { writable: false },
			};
			const huge = Buffer.alloc(RELAY_SERVER_MAX_BUFFER_SIZE + 1, 0xee);
			let errorEvent = null;
			relay.on("error", err => {
				errorEvent = err;
			});
			relay._sniff(session, huge, "uplink");
			assert.ok(errorEvent, "should emit an error event");
			assert.match(errorEvent.message, /overflow/);
			assert.strictEqual(session.upBuffer.length, 0, "buffer should be discarded");
		});

		it("RELAY_SERVER_IDLE_TIMEOUT_MS is a sane positive duration", function () {
			assert.strictEqual(typeof RELAY_SERVER_IDLE_TIMEOUT_MS, "number");
			assert.ok(RELAY_SERVER_IDLE_TIMEOUT_MS > 0);
		});
	});

	// ============================================================
	// Full TCP proxy behavior against a mock upstream "cloud" server
	// ============================================================
	describe("with a mock upstream cloud server", function () {
		let cloudServer;
		let cloudPort;
		let cloudSockets;
		let relays;

		before(function (done) {
			cloudSockets = [];
			cloudServer = net.createServer(socket => {
				cloudSockets.push(socket);
			});
			cloudServer.listen(0, "127.0.0.1", () => {
				cloudPort = cloudServer.address().port;
				done();
			});
		});

		after(function (done) {
			cloudServer.close(() => done());
		});

		beforeEach(function () {
			relays = [];
		});

		afterEach(function () {
			for (const s of cloudSockets) {
				s.destroy();
			}
			cloudSockets = [];
			for (const relay of relays) {
				relay.stop();
			}
		});

		/** Start a RelayServer forwarding to the mock cloud and return it plus its bound port. */
		async function startRelay() {
			const relay = new RelayServer(protobuf);
			relays.push(relay);
			relay.start(0, "127.0.0.1", cloudPort);
			const [port] = await once(relay, "listening");
			return { relay, port };
		}

		/**
		 * Connect a fake device client to the relay and wait for the mock cloud to see the matching (new) socket.
		 *
		 * @param port - Relay server port to connect to.
		 */
		async function connectClient(port) {
			const before = cloudSockets.length;
			const client = net.createConnection(port, "127.0.0.1");
			await once(client, "connect");
			await waitUntil(() => cloudSockets.length > before);
			const cloudSocket = cloudSockets[cloudSockets.length - 1];
			return { client, cloudSocket };
		}

		it("emits 'connection' when a device dials in", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const connPromise = once(relay, "connection");
			const client = net.createConnection(port, "127.0.0.1");
			await once(client, "connect");
			const [evt] = await connPromise;
			assert.strictEqual(typeof evt.sessionId, "number");
			assert.ok(evt.remoteAddress.includes(":"));
			assert.strictEqual(relay.sessionCount, 1);
			client.destroy();
		});

		it("forwards uplink bytes transparently to the real cloud", async function () {
			this.timeout(5000);
			const { port } = await startRelay();
			const { client, cloudSocket } = await connectClient(port);
			const dataPromise = once(cloudSocket, "data");
			client.write(Buffer.from([1, 2, 3, 4, 5]));
			const [received] = await dataPromise;
			assert.deepStrictEqual([...received], [1, 2, 3, 4, 5]);
			client.destroy();
		});

		it("forwards downlink bytes transparently to the device", async function () {
			this.timeout(5000);
			const { port } = await startRelay();
			const { client, cloudSocket } = await connectClient(port);
			const dataPromise = once(client, "data");
			cloudSocket.write(Buffer.from([9, 8, 7]));
			const [received] = await dataPromise;
			assert.deepStrictEqual([...received], [9, 8, 7]);
			client.destroy();
		});

		it("identifies the device from an uplink heartbeat and emits 'deviceIdentified'", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client } = await connectClient(port);
			const idPromise = once(relay, "deviceIdentified");
			client.write(buildHeartbeat("HM1234567890"));
			const [evt] = await idPromise;
			assert.strictEqual(evt.dtuSn, "HM1234567890");
			assert.strictEqual(typeof evt.sessionId, "number");
			client.destroy();
		});

		it("still forwards the heartbeat bytes to the cloud while sniffing it", async function () {
			this.timeout(5000);
			const { port } = await startRelay();
			const { client, cloudSocket } = await connectClient(port);
			const frame = buildHeartbeat("HM0000000001");
			const dataPromise = once(cloudSocket, "data");
			client.write(frame);
			const [received] = await dataPromise;
			assert.deepStrictEqual([...received], [...frame]);
			client.destroy();
		});

		it("decodes uplink RealData and emits 'realData' with the dtuSn learned from the payload", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client } = await connectClient(port);
			const realDataPromise = once(relay, "realData");
			client.write(buildRealData("HM2222222222", 543));
			const [evt] = await realDataPromise;
			assert.strictEqual(evt.dtuSn, "HM2222222222");
			assert.strictEqual(evt.statusOnly, false);
			assert.ok(evt.data);
			assert.strictEqual(evt.data.dtuSn, "HM2222222222");
			assert.strictEqual(evt.data.dtuPower, 54.3); // SCALE_POWER = 10
			client.destroy();
		});

		it("marks statusOnly=true for the 0x0d RealData variant", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client } = await connectClient(port);
			const realDataPromise = once(relay, "realData");
			client.write(buildRealData("HM3333333333", 100, 0x0d));
			const [evt] = await realDataPromise;
			assert.strictEqual(evt.statusOnly, true);
			client.destroy();
		});

		it("does not emit 'command' for routine downlink realdata polling (0x23 0x0c)", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { cloudSocket } = await connectClient(port);
			let commandSeen = false;
			relay.on("command", () => {
				commandSeen = true;
			});
			cloudSocket.write(buildRoutineDownlinkPoll());
			// Give the event loop a chance to process/emit before asserting absence.
			await new Promise(resolve => setTimeout(resolve, 100));
			assert.strictEqual(commandSeen, false);
		});

		it("emits 'command' (direction=downlink) for a non-routine downlink frame", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { cloudSocket } = await connectClient(port);
			const cmdPromise = once(relay, "command");
			cloudSocket.write(buildDownlinkCommand(41, 7));
			const [evt] = await cmdPromise;
			assert.strictEqual(evt.direction, "downlink");
			assert.strictEqual(evt.cmdHigh, 0x23);
			assert.strictEqual(evt.cmdLow, 0x05);
		});

		it("emits 'command' (direction=uplink) for a non-routine uplink frame (grid-profile upload)", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client } = await connectClient(port);
			const cmdPromise = once(relay, "command");
			client.write(buildUplinkGridProfileUpload());
			const [evt] = await cmdPromise;
			assert.strictEqual(evt.direction, "uplink");
			assert.strictEqual(evt.cmdHigh, 0x22);
			assert.strictEqual(evt.cmdLow, 0x0e);
			client.destroy();
		});

		it("sendToDevice writes directly to the matched session, bypassing the cloud", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client, cloudSocket } = await connectClient(port);
			const idPromise = once(relay, "deviceIdentified");
			// The heartbeat itself is legitimately forwarded to the cloud — drain that event
			// before arming the "must not receive" check below, or it races with this assertion.
			const heartbeatForwarded = once(cloudSocket, "data");
			client.write(buildHeartbeat("HM4444444444"));
			await Promise.all([idPromise, heartbeatForwarded]);

			let cloudSawInjected = false;
			cloudSocket.on("data", () => {
				cloudSawInjected = true;
			});
			const injected = Buffer.from([0xaa, 0xbb, 0xcc]);
			const clientDataPromise = once(client, "data");
			const ok = relay.sendToDevice("HM4444444444", injected);
			assert.strictEqual(ok, true);
			const [received] = await clientDataPromise;
			assert.deepStrictEqual([...received], [0xaa, 0xbb, 0xcc]);
			await new Promise(resolve => setTimeout(resolve, 50));
			assert.strictEqual(cloudSawInjected, false, "injected frame must not be forwarded to the real cloud");
			client.destroy();
		});

		it("sendToDevice returns false for an unidentified/unknown dtuSn", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			await connectClient(port);
			assert.strictEqual(relay.sendToDevice("NOPE", Buffer.alloc(1)), false);
		});

		it("supports multiple simultaneous sessions, isolated by dtuSn", async function () {
			this.timeout(8000);
			const { relay, port } = await startRelay();
			const { client: clientA } = await connectClient(port);
			const { client: clientB } = await connectClient(port);

			const idA = once(relay, "deviceIdentified");
			clientA.write(buildHeartbeat("HM_AAAA0001"));
			await idA;
			const idB = once(relay, "deviceIdentified");
			clientB.write(buildHeartbeat("HM_BBBB0002"));
			await idB;

			assert.strictEqual(relay.sessionCount, 2);

			const dataA = once(clientA, "data");
			const okA = relay.sendToDevice("HM_AAAA0001", Buffer.from([1]));
			assert.strictEqual(okA, true);
			const [receivedA] = await dataA;
			assert.strictEqual(receivedA[0], 1);

			// clientB must not receive traffic meant for clientA.
			let bGotData = false;
			clientB.on("data", () => {
				bGotData = true;
			});
			await new Promise(resolve => setTimeout(resolve, 50));
			assert.strictEqual(bGotData, false);

			clientA.destroy();
			clientB.destroy();
		});

		it("emits 'disconnection' with reason 'client closed' when the device drops", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client } = await connectClient(port);
			const idPromise = once(relay, "deviceIdentified");
			client.write(buildHeartbeat("HM5555555555"));
			await idPromise;

			const discPromise = once(relay, "disconnection");
			client.destroy();
			const [evt] = await discPromise;
			assert.strictEqual(evt.reason, "client closed");
			assert.strictEqual(evt.dtuSn, "HM5555555555");
			assert.strictEqual(relay.sessionCount, 0);
		});

		it("emits 'disconnection' with reason 'upstream closed' when the cloud drops", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client, cloudSocket } = await connectClient(port);
			const discPromise = once(relay, "disconnection");
			cloudSocket.destroy();
			const [evt] = await discPromise;
			assert.strictEqual(evt.reason, "upstream closed");
			assert.strictEqual(relay.sessionCount, 0);
			client.destroy();
		});

		it("stop() tears down active sessions and closes both legs", async function () {
			this.timeout(5000);
			const { relay, port } = await startRelay();
			const { client, cloudSocket } = await connectClient(port);
			const clientClosePromise = once(client, "close");
			const cloudClosePromise = once(cloudSocket, "close");
			relay.stop();
			await Promise.all([clientClosePromise, cloudClosePromise]);
			assert.strictEqual(relay.sessionCount, 0);
			assert.strictEqual(relay.listening, false);
		});
	});
});
