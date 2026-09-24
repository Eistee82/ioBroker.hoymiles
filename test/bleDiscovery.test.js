import assert from "node:assert";
import { bleNameToSn, discoverGateways, isHoymilesAdvertisement } from "../build/lib/bleDiscovery.js";
import { EsphomeGateway } from "../build/lib/esphomeGateway.js";

describe("bleDiscovery", function () {
	describe("bleNameToSn", function () {
		it("takes the last 12 alphanumeric chars, uppercased", function () {
			assert.strictEqual(bleNameToSn("RMI-4161A031AB61"), "4161A031AB61");
			assert.strictEqual(bleNameToSn("rmi_4161a031ab61"), "4161A031AB61");
		});
		it("handles empty/short names", function () {
			assert.strictEqual(bleNameToSn(""), "");
			assert.strictEqual(bleNameToSn("ABC"), "ABC");
		});
	});

	describe("isHoymilesAdvertisement", function () {
		it("accepts a device advertising the Hoymiles service UUID", function () {
			assert.strictEqual(
				isHoymilesAdvertisement({
					name: "whatever",
					serviceUuidsList: ["0000e0ff-3c17-d293-8e48-14fe2e4da212"],
				}),
				true,
			);
		});
		it("accepts the app's inverter name prefixes (MI/RMI/AUS/MSA/MSH/RMSA)", function () {
			assert.strictEqual(isHoymilesAdvertisement({ name: "RMI-4161A031AB61" }), true);
			assert.strictEqual(isHoymilesAdvertisement({ name: "MI-4161A031AB61" }), true);
			assert.strictEqual(isHoymilesAdvertisement({ name: "MSA-1234567890AB" }), true);
		});
		it("rejects unrelated devices", function () {
			assert.strictEqual(isHoymilesAdvertisement({ name: "MyPhone" }), false);
			assert.strictEqual(isHoymilesAdvertisement({ name: "" }), false);
			assert.strictEqual(isHoymilesAdvertisement({ name: "TV-Living-Room-Soundbar-XL" }), false);
			// Real-world false positive the old shape heuristic let through (seen live in a scan).
			assert.strictEqual(isHoymilesAdvertisement({ name: "Hue ambiance lamp" }), false);
			// A WiFi-DTU name is not a balcony BLE device — the balcony scan only accepts MI/RMI/…
			assert.strictEqual(isHoymilesAdvertisement({ name: "DTUBI-410012345678" }), false);
		});
	});

	describe("EsphomeGateway.macToNumber / macToString", function () {
		it("round-trips a MAC through number and back", function () {
			const mac = "AA:BB:CC:DD:EE:FF";
			const num = EsphomeGateway.macToNumber(mac);
			assert.strictEqual(num, 0xaabbccddeeff);
			assert.strictEqual(EsphomeGateway.macToString(num), mac);
		});
		it("parses a MAC without separators", function () {
			assert.strictEqual(EsphomeGateway.macToNumber("aabbccddeeff"), 0xaabbccddeeff);
		});
	});

	describe("discoverGateways", function () {
		/** A stand-in for the esphome-native-api Discovery: records run/destroy, lets the test emit "info". */
		function fakeDiscovery() {
			const disc = {
				ran: 0,
				destroyed: 0,
				listeners: [],
				on(event, cb) {
					if (event === "info") {
						disc.listeners.push(cb);
					}
					return disc;
				},
				run() {
					disc.ran++;
				},
				destroy() {
					disc.destroyed++;
				},
				emit(info) {
					for (const cb of disc.listeners) {
						cb(info);
					}
				},
			};
			return disc;
		}

		it("waits with the adapter's delay, collects the answers and closes the mDNS socket afterwards", async function () {
			const disc = fakeDiscovery();
			const delays = [];
			const waiter = {
				delay: async ms => {
					delays.push(ms);
					// Answers arrive while the wait is pending.
					disc.emit({ address: "192.168.1.20", host: "proxy.local", port: 6053, name: "" });
					disc.emit({ host: "other.local", port: 0 });
					disc.emit({ address: "192.168.1.20", host: "proxy.local", port: 6053 }); // duplicate host
				},
			};
			const result = await discoverGateways(1234, waiter, undefined, () => disc);
			assert.deepStrictEqual(delays, [1234], "the wait goes through the injected delay(), nothing else");
			assert.strictEqual(disc.ran, 1);
			assert.strictEqual(disc.destroyed, 1, "the socket is closed once the wait is over");
			assert.deepStrictEqual(result, [
				{ host: "192.168.1.20", port: 6053, name: "proxy.local" },
				{ host: "other.local", port: 6053, name: "" },
			]);
		});

		it("closes the mDNS socket the moment the caller aborts, even though adapter.delay() never settles on unload", function () {
			const disc = fakeDiscovery();
			const abort = new AbortController();
			// adapter.delay() clears its timer on unload and leaves the promise pending forever — model exactly that.
			const waiter = { delay: () => new Promise(() => {}) };
			void discoverGateways(15000, waiter, abort.signal, () => disc);
			assert.strictEqual(disc.ran, 1);
			assert.strictEqual(disc.destroyed, 0, "still listening while nothing happened");
			abort.abort();
			assert.strictEqual(disc.destroyed, 1, "abort tears the socket down without waiting for the delay");
		});

		it("does not destroy twice when the delay ends after an abort", async function () {
			const disc = fakeDiscovery();
			const abort = new AbortController();
			let release;
			const waiter = { delay: () => new Promise(resolve => (release = resolve)) };
			const pending = discoverGateways(5000, waiter, abort.signal, () => disc);
			abort.abort();
			release();
			await pending;
			assert.strictEqual(disc.destroyed, 1);
		});

		it("opens no socket at all when the signal is already aborted", async function () {
			const disc = fakeDiscovery();
			const abort = new AbortController();
			abort.abort();
			let waited = false;
			const result = await discoverGateways(
				5000,
				{
					delay: async () => {
						waited = true;
					},
				},
				abort.signal,
				() => disc,
			);
			assert.deepStrictEqual(result, []);
			assert.strictEqual(disc.ran, 0);
			assert.strictEqual(waited, false);
		});

		it("survives a discovery that throws on destroy", async function () {
			const disc = fakeDiscovery();
			disc.destroy = () => {
				throw new Error("already closed");
			};
			const result = await discoverGateways(10, { delay: async () => {} }, undefined, () => disc);
			assert.deepStrictEqual(result, []);
		});
	});
});
