import assert from "node:assert";
import {
	bleKey,
	bleNonce,
	bleAad,
	bleEncrypt,
	bleDecrypt,
	snCbcKey,
	snCbcIv,
	snEncrypt,
	snDecrypt,
	bleBuildFrame,
	bleParseFrame,
	pbFindBytes,
	pbFindNested,
	pbFindVarint,
	extractEncRand,
} from "../build/lib/bleCrypto.js";
import { crc16 } from "../build/lib/crc16.js";

// A deterministic 16-byte encRand and SN for reproducible vectors.
const ENC_RAND = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const SN = Buffer.from("4161A031AB61", "ascii");

describe("bleCrypto", function () {
	// ----------------------------------------------------------
	// Key/nonce/aad derivation — endianness and lengths
	// ----------------------------------------------------------
	describe("GCM key/nonce/aad derivation", function () {
		it("key is 16 bytes and depends only on encRand (not msgId/seq)", function () {
			const key = bleKey(ENC_RAND);
			assert.strictEqual(key.length, 16);
			// Only the first 16 bytes of encRand matter.
			const padded = Buffer.concat([ENC_RAND, Buffer.from([0xde, 0xad])]);
			assert.deepStrictEqual(bleKey(padded), key);
		});

		it("nonce is 12 bytes and varies with msgId/seq", function () {
			const n1 = bleNonce(ENC_RAND, 0xa311, 1);
			const n2 = bleNonce(ENC_RAND, 0xa311, 2);
			assert.strictEqual(n1.length, 12);
			assert.notDeepStrictEqual(n1, n2);
		});

		it("aad is uint32LE(msgId | (seq << 16))", function () {
			const aad = bleAad(0xa311, 0x0002);
			// bytes: [msgId_lo, msgId_hi, seq_lo, seq_hi]
			assert.deepStrictEqual(aad, Buffer.from([0x11, 0xa3, 0x02, 0x00]));
		});
	});

	// ----------------------------------------------------------
	// GCM round-trip
	// ----------------------------------------------------------
	describe("GCM encrypt/decrypt round-trip", function () {
		it("decrypt(encrypt(x)) === x", function () {
			const plain = Buffer.from("hello hoymiles ble world", "utf8");
			const { full } = bleEncrypt(ENC_RAND, 0xa311, 7, plain);
			const back = bleDecrypt(ENC_RAND, 0xa311, 7, full);
			assert.deepStrictEqual(back, plain);
		});

		it("appends a 16-byte tag", function () {
			const plain = Buffer.from([1, 2, 3, 4]);
			const { ct, tag, full } = bleEncrypt(ENC_RAND, 0xa311, 1, plain);
			assert.strictEqual(tag.length, 16);
			assert.strictEqual(full.length, ct.length + 16);
			assert.strictEqual(ct.length, plain.length); // GCM is a stream cipher, ct len === pt len
		});

		it("throws on tag mismatch (tampered ciphertext)", function () {
			const plain = Buffer.from("secret", "utf8");
			const { full } = bleEncrypt(ENC_RAND, 0xa311, 1, plain);
			const tampered = Buffer.from(full);
			tampered[0] ^= 0xff;
			assert.throws(() => bleDecrypt(ENC_RAND, 0xa311, 1, tampered));
		});

		it("throws with wrong seq (nonce/aad mismatch)", function () {
			const plain = Buffer.from("secret", "utf8");
			const { full } = bleEncrypt(ENC_RAND, 0xa311, 1, plain);
			assert.throws(() => bleDecrypt(ENC_RAND, 0xa311, 2, full));
		});
	});

	// ----------------------------------------------------------
	// SN-CBC bootstrap round-trip
	// ----------------------------------------------------------
	describe("SN-CBC encrypt/decrypt round-trip", function () {
		it("key is 16 bytes and iv is 16 bytes", function () {
			assert.strictEqual(snCbcKey(SN).length, 16);
			assert.strictEqual(snCbcIv(SN, 0xa201, 1).length, 16);
		});

		it("decrypt(encrypt(x)) === x", function () {
			const plain = Buffer.from("bootstrap-payload-123", "utf8");
			const ct = snEncrypt(SN, 0xa201, 3, plain);
			const back = snDecrypt(SN, 0xa201, 3, ct);
			assert.deepStrictEqual(back, plain);
		});

		it("uses big-endian msgId/seq for the IV (differs from GCM little-endian)", function () {
			// If BE/LE were confused, these two IVs would collide; assert they differ.
			const ivBe = snCbcIv(SN, 0x0102, 0x0304);
			const ivSwapped = snCbcIv(SN, 0x0201, 0x0403);
			assert.notDeepStrictEqual(ivBe, ivSwapped);
		});
	});

	// ----------------------------------------------------------
	// Frame build/parse
	// ----------------------------------------------------------
	describe("bleBuildFrame / bleParseFrame", function () {
		it("plain frame: header, crc and totalLen are correct", function () {
			const payload = Buffer.from([0xaa, 0xbb, 0xcc]);
			const frame = bleBuildFrame(0xa301, payload, { mode: "plain", seq: 5 });
			assert.strictEqual(frame[0], 0x48);
			assert.strictEqual(frame[1], 0x4d);
			const parsed = bleParseFrame(frame);
			assert.strictEqual(parsed.tag, 0xa301);
			assert.strictEqual(parsed.seq, 5);
			assert.strictEqual(parsed.crc, crc16(payload));
			assert.strictEqual(parsed.totalLen, payload.length + 10);
			assert.deepStrictEqual(parsed.payload, payload);
		});

		it("gcm frame: crc is over ciphertext-without-tag, payload carries the tag", function () {
			const payload = Buffer.from("realdata-request", "utf8");
			const frame = bleBuildFrame(0xa311, payload, { mode: "gcm", encRand: ENC_RAND, seq: 9 });
			const parsed = bleParseFrame(frame);
			// totalLen counts the ciphertext (== plaintext length for GCM) + header, NOT the tag.
			assert.strictEqual(parsed.totalLen, payload.length + 10);
			// payload = ciphertext + 16-byte tag
			assert.strictEqual(parsed.payload.length, payload.length + 16);
			const back = bleDecrypt(ENC_RAND, parsed.tag, parsed.seq, parsed.payload);
			assert.deepStrictEqual(back, payload);
		});

		it("sncbc frame: round-trips through snDecrypt", function () {
			const payload = Buffer.from("hi", "utf8");
			const frame = bleBuildFrame(0xa301, payload, { mode: "sncbc", sn: SN, seq: 2 });
			const parsed = bleParseFrame(frame);
			const back = snDecrypt(SN, parsed.tag, parsed.seq, parsed.payload);
			assert.deepStrictEqual(back, payload);
		});

		it("throws when gcm mode is missing encRand", function () {
			assert.throws(() => bleBuildFrame(0xa311, Buffer.alloc(0), { mode: "gcm", seq: 1 }));
		});

		it("throws when sncbc mode is missing sn", function () {
			assert.throws(() => bleBuildFrame(0xa301, Buffer.alloc(1), { mode: "sncbc", seq: 1 }));
		});

		it("bleParseFrame returns null for non-HM buffers", function () {
			assert.strictEqual(bleParseFrame(Buffer.from([0x00, 0x01, 0x02])), null);
			assert.strictEqual(bleParseFrame(Buffer.from("XX", "ascii")), null);
		});
	});

	// ----------------------------------------------------------
	// Protobuf field scanners
	// ----------------------------------------------------------
	describe("protobuf field scanners", function () {
		it("pbFindVarint finds a wire-0 field and returns null when absent", function () {
			// field 11 = varint 3  -> tag = (11<<3)|0 = 0x58
			const buf = Buffer.from([0x58, 0x03]);
			assert.strictEqual(pbFindVarint(buf, 11), 3);
			assert.strictEqual(pbFindVarint(buf, 12), null);
		});

		it("pbFindBytes finds a wire-2 field", function () {
			// field 1 = bytes "ab" -> tag 0x0a, len 2
			const buf = Buffer.from([0x0a, 0x02, 0x61, 0x62]);
			assert.deepStrictEqual(pbFindBytes(buf, 1), Buffer.from("ab", "ascii"));
		});

		it("pbFindNested descends a field path and extractEncRand reads 8.27", function () {
			// Build: field 8 { field 27 = <16 bytes> }
			const inner = Buffer.concat([Buffer.from([0xda, 0x01, 0x10]), ENC_RAND]); // f27 (tag 0xda 0x01), len 16
			const outer = Buffer.concat([Buffer.from([0x42, inner.length]), inner]); // f8 (tag 0x42)
			assert.deepStrictEqual(pbFindNested(outer, [8, 27]), ENC_RAND);
			assert.deepStrictEqual(extractEncRand(outer), ENC_RAND);
		});

		it("extractEncRand returns null when field is absent", function () {
			assert.strictEqual(extractEncRand(Buffer.from([0x08, 0x01])), null);
		});
	});
});
