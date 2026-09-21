import assert from "node:assert";
import { EventEmitter } from "node:events";
import { EsphomeGateway } from "../build/lib/esphomeGateway.js";

const MAC = EsphomeGateway.macToNumber("AA:BB:CC:DD:EE:FF");
const OTHER_MAC = EsphomeGateway.macToNumber("11:22:33:44:55:66");
const DEVICE_CONNECTION_EVENT = "message.BluetoothDeviceConnectionResponse";
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Gateway wired to a bare EventEmitter instead of a real Native-API client, so a test can push the
 * proxy messages by hand. `start()` would open a TCP connection, so the client is injected.
 */
function makeGateway() {
	const gateway = new EsphomeGateway("192.0.2.10", 6053, silentLog);
	const connection = new EventEmitter();
	gateway.client = { connection };
	return { gateway, connection };
}

describe("EsphomeGateway.onDeviceDisconnect", function () {
	// This subscription is the only signal that a BLE inverter went away while the proxy itself
	// stays connected — the nightly power-down of an HMS-800-2WB.
	it("fires when the proxy reports this device as disconnected", function () {
		const { gateway, connection } = makeGateway();
		let fired = 0;
		gateway.onDeviceDisconnect(MAC, () => fired++);

		connection.emit(DEVICE_CONNECTION_EVENT, { address: MAC, connected: false });

		assert.strictEqual(fired, 1);
	});

	it("ignores a successful connect and other devices", function () {
		const { gateway, connection } = makeGateway();
		let fired = 0;
		gateway.onDeviceDisconnect(MAC, () => fired++);

		// The reply to our own connectDevice() — not a disconnect.
		connection.emit(DEVICE_CONNECTION_EVENT, { address: MAC, connected: true });
		// Another inverter behind the same proxy dropping out must not tear down this session.
		connection.emit(DEVICE_CONNECTION_EVENT, { address: OTHER_MAC, connected: false });

		assert.strictEqual(fired, 0);
	});

	it("stops firing after unsubscribe", function () {
		const { gateway, connection } = makeGateway();
		let fired = 0;
		const unsubscribe = gateway.onDeviceDisconnect(MAC, () => fired++);

		unsubscribe();
		connection.emit(DEVICE_CONNECTION_EVENT, { address: MAC, connected: false });

		assert.strictEqual(fired, 0);
		assert.strictEqual(connection.listenerCount(DEVICE_CONNECTION_EVENT), 0, "listener must be removed");
	});
});
