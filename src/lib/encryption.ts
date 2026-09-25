import { bleDecrypt, bleEncrypt } from "./bleCrypto.js";
import { crc16 } from "./crc16.js";
import { HM_HEADER_SIZE, HM_MAGIC_0, HM_MAGIC_1, LOCAL_GCM_TAG_LEN } from "./constants.js";

/** First and last tag the DTU encrypts; everything outside (the cloud tags 0x22xx/0x23xx) stays plain. */
const ENCRYPTED_TAG_MIN = 0x2315;
const ENCRYPTED_TAG_MAX = 0xa317;
/** InfoData response — carries `dfs` and `enc_rand`, so it is always plain. */
const TAG_INFO_RESPONSE = 0xa201;
/** InfoData request — the DTU accepts it plain, it is what starts the encrypted session. */
const TAG_INFO_REQUEST = 0xa301;

/**
 * Encryption of the local TCP protocol (DTU firmware V01.01.01 and later).
 *
 * A DTU that sets bit 25 of `dfs` in its InfoData response expects every local frame to be
 * AES-128-GCM encrypted — the very scheme the WB series uses over Bluetooth
 * ({@link bleEncrypt} / {@link bleDecrypt}): key and nonce are derived from the 16-byte `enc_rand`
 * the DTU sends in the clear, the message id (= the tag) and the sequence number.
 *
 * On the wire the frame keeps its 10-byte HM header. CRC and `totalLen` cover the ciphertext only;
 * the 16-byte authentication tag follows the ciphertext **beyond** `totalLen`. Two frames stay
 * plain: the InfoData request (`0xa301`) and its response (`0xa201`). Frames with an empty payload
 * carry neither ciphertext nor tag. The cloud tags (`0x22xx`/`0x23xx`) are never encrypted.
 *
 * Firmware-verified for the HMS-800W-2T, DTU firmware V01.01.01
 * (`_fwanalysis/dtu_v01.01.01/LOCAL_ENCRYPTION_V01_01_01.md`). Earlier firmware (V01.00.07) does not
 * set bit 25 and talks plain — this class is then never used.
 */
class Encryption {
	private readonly encRand: Buffer;

	/** @param encRand - Random seed from the DTU's InfoData (base64 string or raw bytes) */
	constructor(encRand: Buffer | string) {
		this.encRand = typeof encRand === "string" ? Buffer.from(encRand, "base64") : Buffer.from(encRand);
	}

	/**
	 * Check if encryption is required (bit 25 of dfs field).
	 *
	 * @param dfs - Device feature flags from DTU info response
	 */
	static isRequired(dfs: number | null | undefined): boolean {
		if (!dfs) {
			return false;
		}
		return ((Number(dfs) >> 25) & 1) === 1;
	}

	/**
	 * Whether the DTU encrypts frames with this tag once encryption is on.
	 *
	 * @param tag - 16-bit HM tag (message id)
	 */
	static isEncryptedTag(tag: number): boolean {
		return (
			tag >= ENCRYPTED_TAG_MIN &&
			tag <= ENCRYPTED_TAG_MAX &&
			tag !== TAG_INFO_RESPONSE &&
			tag !== TAG_INFO_REQUEST
		);
	}

	/**
	 * Number of bytes a frame occupies on the wire: `totalLen` from the header, plus the 16-byte
	 * authentication tag when the frame is encrypted and carries a payload.
	 *
	 * @param header - At least the 10-byte HM header of the frame
	 * @param encryptionActive - Whether the DTU currently encrypts (bit 25 seen)
	 */
	static wireLength(header: Buffer, encryptionActive: boolean): number {
		const tag = (header[2] << 8) | header[3];
		const totalLen = (header[8] << 8) | header[9];
		if (encryptionActive && totalLen > HM_HEADER_SIZE && Encryption.isEncryptedTag(tag)) {
			return totalLen + LOCAL_GCM_TAG_LEN;
		}
		return totalLen;
	}

	/**
	 * Encrypt a payload. Returns `ciphertext ‖ tag(16)`.
	 *
	 * @param payload - Plain protobuf payload
	 * @param msgId - HM tag of the frame
	 * @param seqNum - Sequence number of the frame
	 */
	encrypt(payload: Buffer, msgId: number, seqNum: number): Buffer {
		return bleEncrypt(this.encRand, msgId, seqNum, payload).full;
	}

	/**
	 * Decrypt `ciphertext ‖ tag(16)`.
	 *
	 * @param ctPlusTag - Ciphertext followed by the 16-byte authentication tag
	 * @param msgId - HM tag of the frame
	 * @param seqNum - Sequence number of the frame
	 * @throws {Error} If the tag is missing or does not verify (wrong key, altered data)
	 */
	decrypt(ctPlusTag: Buffer, msgId: number, seqNum: number): Buffer {
		if (ctPlusTag.length < LOCAL_GCM_TAG_LEN) {
			throw new Error(`frame too short for an authentication tag (${ctPlusTag.length} bytes)`);
		}
		return bleDecrypt(this.encRand, msgId, seqNum, ctPlusTag);
	}

	/**
	 * Turn a plain HM frame into the encrypted wire frame the DTU expects. Frames the DTU keeps
	 * plain (InfoData request/response, cloud tags, empty payload) are returned unchanged.
	 *
	 * @param frame - Complete plain HM frame (header + protobuf payload)
	 */
	encryptFrame(frame: Buffer): Buffer {
		if (frame.length < HM_HEADER_SIZE || frame[0] !== HM_MAGIC_0 || frame[1] !== HM_MAGIC_1) {
			return frame;
		}
		const tag = (frame[2] << 8) | frame[3];
		const seq = (frame[4] << 8) | frame[5];
		const payload = frame.subarray(HM_HEADER_SIZE);
		if (payload.length === 0 || !Encryption.isEncryptedTag(tag)) {
			return frame;
		}
		const { ct, full } = bleEncrypt(this.encRand, tag, seq, payload);
		const header = Buffer.from(frame.subarray(0, HM_HEADER_SIZE));
		header.writeUInt16BE(crc16(ct), 6);
		header.writeUInt16BE(HM_HEADER_SIZE + ct.length, 8);
		return Buffer.concat([header, full]);
	}
}

export default Encryption;
