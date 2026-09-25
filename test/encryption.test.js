import assert from "node:assert";
import Encryption from "../build/lib/encryption.js";
import { bleEncrypt, bleDecrypt } from "../build/lib/bleCrypto.js";
import { ProtobufHandler } from "../build/lib/protobufHandler.js";
import { crc16 } from "../build/lib/crc16.js";

const ENC_RAND = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");

// ============================================================
// encryption – dfs bit 25
// ============================================================
describe("encryption", function () {
	it("Encryption.isRequired returns false for 0", function () {
		assert.strictEqual(Encryption.isRequired(0), false);
	});

	it("Encryption.isRequired returns true for (1 << 25)", function () {
		assert.strictEqual(Encryption.isRequired(1 << 25), true);
	});

	it("Encryption.isRequired returns true for value with bit 25 set among others", function () {
		assert.strictEqual(Encryption.isRequired((1 << 25) | 0xff), true);
	});

	it("Encryption.isRequired returns false for null/undefined", function () {
		assert.strictEqual(Encryption.isRequired(null), false);
		assert.strictEqual(Encryption.isRequired(undefined), false);
	});

	it("isRequired returns false for values without bit 25", function () {
		assert.strictEqual(Encryption.isRequired(1), false);
		assert.strictEqual(Encryption.isRequired(0xffffff), false); // 24 bits set, bit 25 not
		assert.strictEqual(Encryption.isRequired(1 << 24), false);
	});

	// The two dfs words the 2T firmware writes: V01.00.07 (plain) and V01.01.01 (encrypting).
	it("isRequired tells the two known 2T firmware dfs words apart", function () {
		assert.strictEqual(Encryption.isRequired(0x4c0000c0), false, "V01.00.07 talks plain");
		assert.strictEqual(Encryption.isRequired(0x4e0000c0), true, "V01.01.01 encrypts");
	});

	it("encrypt and decrypt round-trip produces original data", function () {
		const enc = new Encryption(ENC_RAND);
		const original = Buffer.from("Hello, Hoymiles!");
		const encrypted = enc.encrypt(original, 0xa311, 42);
		const decrypted = enc.decrypt(encrypted, 0xa311, 42);
		assert.ok(Buffer.compare(original, decrypted) === 0);
	});

	it("ciphertext is as long as the plaintext plus the 16-byte tag (no padding)", function () {
		const enc = new Encryption(ENC_RAND);
		for (const len of [1, 5, 16, 17, 100]) {
			assert.strictEqual(enc.encrypt(Buffer.alloc(len, 1), 0xa311, 1).length, len + 16);
		}
	});

	it("different msgId/seqNum produces different ciphertext", function () {
		const enc = new Encryption(ENC_RAND);
		const original = Buffer.from("Hello, Hoymiles!");
		const encrypted1 = enc.encrypt(original, 0xa311, 1);
		const encrypted2 = enc.encrypt(original, 0xa311, 2);
		assert.ok(Buffer.compare(encrypted1, encrypted2) !== 0);
	});

	it("decrypt rejects a wrong sequence number (tag mismatch)", function () {
		const enc = new Encryption(ENC_RAND);
		const encrypted = enc.encrypt(Buffer.from("abc"), 0xa311, 1);
		assert.throws(() => enc.decrypt(encrypted, 0xa311, 2));
	});

	it("decrypt rejects an altered ciphertext", function () {
		const enc = new Encryption(ENC_RAND);
		const encrypted = enc.encrypt(Buffer.from("abcdef"), 0xa311, 1);
		encrypted[0] ^= 0x01;
		assert.throws(() => enc.decrypt(encrypted, 0xa311, 1));
	});

	it("decrypt rejects data too short for a tag", function () {
		const enc = new Encryption(ENC_RAND);
		assert.throws(() => enc.decrypt(Buffer.alloc(15), 0xa311, 1), /too short/);
	});

	it("accepts enc_rand as base64 string (how the protobuf layer hands it over)", function () {
		const encStr = new Encryption(ENC_RAND.toString("base64"));
		const encBuf = new Encryption(ENC_RAND);
		const ct = encStr.encrypt(Buffer.from("x"), 0xa311, 7);
		assert.ok(Buffer.compare(ct, encBuf.encrypt(Buffer.from("x"), 0xa311, 7)) === 0);
	});

	// The TCP scheme of firmware V01.01.01 IS the Bluetooth scheme of the WB series — the
	// firmware derives key, nonce and AAD exactly like libhmf.so does.
	it("uses the same AES-128-GCM recipe as the Bluetooth path", function () {
		const enc = new Encryption(ENC_RAND);
		const plain = Buffer.from("same recipe");
		const viaTcp = enc.encrypt(plain, 0xa311, 9);
		const viaBle = bleEncrypt(ENC_RAND, 0xa311, 9, plain).full;
		assert.ok(Buffer.compare(viaTcp, viaBle) === 0);
		assert.ok(Buffer.compare(bleDecrypt(ENC_RAND, 0xa311, 9, viaTcp), plain) === 0);
	});
});

// ============================================================
// encryption – which tags the DTU encrypts
// ============================================================
describe("encryption – isEncryptedTag", function () {
	it("encrypts the local request and response tags", function () {
		for (const tag of [0xa202, 0xa211, 0xa209, 0xa302, 0xa311, 0xa305, 0xa310, 0xa317]) {
			assert.strictEqual(Encryption.isEncryptedTag(tag), true, `0x${tag.toString(16)}`);
		}
	});

	it("keeps the InfoData request and response plain", function () {
		assert.strictEqual(Encryption.isEncryptedTag(0xa301), false);
		assert.strictEqual(Encryption.isEncryptedTag(0xa201), false);
	});

	it("keeps the cloud tags plain", function () {
		for (const tag of [0x2201, 0x2202, 0x220c, 0x2301, 0x2305, 0x230e, 0x2313]) {
			assert.strictEqual(Encryption.isEncryptedTag(tag), false, `0x${tag.toString(16)}`);
		}
	});

	it("stops at the firmware's upper bound", function () {
		assert.strictEqual(Encryption.isEncryptedTag(0xa317), true);
		assert.strictEqual(Encryption.isEncryptedTag(0xa318), false);
		assert.strictEqual(Encryption.isEncryptedTag(0x2314), false);
		assert.strictEqual(Encryption.isEncryptedTag(0x2315), true);
	});
});

// ============================================================
// encryption – frames on the wire
// ============================================================
describe("encryption – encryptFrame / wireLength", function () {
	const protobuf = new ProtobufHandler();
	const enc = new Encryption(ENC_RAND);

	it("re-frames an encrypted request: CRC and totalLen over the ciphertext, tag beyond totalLen", function () {
		const payload = Buffer.from([0x08, 0x01, 0x10, 0x02, 0x18, 0x03]);
		const plain = protobuf.buildMessage(0xa3, 0x11, payload, 5);
		const wire = enc.encryptFrame(plain);

		assert.strictEqual(wire.length, 10 + payload.length + 16, "16-byte tag appended");
		assert.strictEqual(wire[0], 0x48);
		assert.strictEqual(wire[1], 0x4d);
		assert.strictEqual(wire.readUInt16BE(2), 0xa311, "tag unchanged");
		assert.strictEqual(wire.readUInt16BE(4), 5, "sequence unchanged");
		assert.strictEqual(wire.readUInt16BE(8), 10 + payload.length, "totalLen excludes the tag");
		const ct = wire.subarray(10, 10 + payload.length);
		assert.strictEqual(wire.readUInt16BE(6), crc16(ct), "CRC over the ciphertext");
		assert.ok(Buffer.compare(ct, payload) !== 0, "payload is encrypted");

		// The DTU decrypts with (tag, seq) from the header
		const back = enc.decrypt(wire.subarray(10), 0xa311, 5);
		assert.ok(Buffer.compare(back, payload) === 0);
	});

	it("the DTU's own parser would accept the frame (CRC check on the ciphertext)", function () {
		const plain = protobuf.buildMessage(0xa3, 0x05, Buffer.from([1, 2, 3]), 77);
		const wire = enc.encryptFrame(plain);
		const parsed = protobuf.parseResponse(wire);
		assert.ok(parsed, "parseResponse must accept the CRC over the ciphertext");
		assert.strictEqual(parsed.payload.length, 3, "payload = ciphertext without tag");
	});

	it("leaves the InfoData request plain", function () {
		const plain = protobuf.buildMessage(0xa3, 0x01, Buffer.from([1, 2, 3]), 1);
		assert.ok(Buffer.compare(enc.encryptFrame(plain), plain) === 0);
	});

	it("leaves cloud frames plain", function () {
		const plain = protobuf.buildMessage(0x22, 0x0c, Buffer.from([1, 2, 3]), 1);
		assert.ok(Buffer.compare(enc.encryptFrame(plain), plain) === 0);
	});

	it("leaves a frame without payload plain (no tag)", function () {
		const plain = protobuf.buildMessage(0xa3, 0x02, Buffer.alloc(0), 1);
		assert.ok(Buffer.compare(enc.encryptFrame(plain), plain) === 0);
	});

	it("returns something that is not an HM frame unchanged", function () {
		const junk = Buffer.from([1, 2, 3]);
		assert.strictEqual(enc.encryptFrame(junk), junk);
	});

	it("wireLength adds the tag only for encrypted tags with a payload", function () {
		const encrypted = protobuf.buildMessage(0xa2, 0x11, Buffer.alloc(30), 1);
		assert.strictEqual(Encryption.wireLength(encrypted, true), 40 + 16);
		assert.strictEqual(Encryption.wireLength(encrypted, false), 40, "plain DTU: no tag");

		const info = protobuf.buildMessage(0xa2, 0x01, Buffer.alloc(30), 1);
		assert.strictEqual(Encryption.wireLength(info, true), 40, "InfoData is plain");

		const empty = protobuf.buildMessage(0xa2, 0x02, Buffer.alloc(0), 1);
		assert.strictEqual(Encryption.wireLength(empty, true), 10, "empty payload carries no tag");

		const cloud = protobuf.buildMessage(0x23, 0x05, Buffer.alloc(4), 1);
		assert.strictEqual(Encryption.wireLength(cloud, true), 14, "cloud tags are plain");
	});
});
