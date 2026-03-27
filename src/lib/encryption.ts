import * as crypto from "node:crypto";

const SALT = "123456";

class Encryption {
	private readonly encRand: Buffer;

	constructor(encRand: Buffer | string) {
		if (typeof encRand === "string") {
			this.encRand = Buffer.from(encRand, "utf-8");
		} else {
			this.encRand = encRand;
		}
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
	 * Derive AES-128 key from encRand + msgId + seqNum.
	 *
	 * @param msgId - Message ID (command tag)
	 * @param seqNum - Sequence number
	 */
	private deriveKey(msgId: number, seqNum: number): Buffer {
		// Build key material: encRand + msgId (2 bytes BE) + seqNum (2 bytes BE)
		const msgIdBuf = Buffer.alloc(2);
		msgIdBuf.writeUInt16BE(msgId & 0xffff);
		const seqBuf = Buffer.alloc(2);
		seqBuf.writeUInt16BE(seqNum & 0xffff);
		const material = Buffer.concat([this.encRand, msgIdBuf, seqBuf]);

		// Triple SHA-256
		let hash = crypto.createHash("sha256").update(material).digest();
		hash = crypto.createHash("sha256").update(hash).digest();
		hash = crypto.createHash("sha256").update(hash).digest();
		return hash.subarray(0, 16);
	}

	/**
	 * Derive IV from encRand + salt + msgId + seqNum.
	 *
	 * @param msgId - Message ID (command tag)
	 * @param seqNum - Sequence number
	 */
	private deriveIv(msgId: number, seqNum: number): Buffer {
		const msgIdBuf = Buffer.alloc(2);
		msgIdBuf.writeUInt16BE(msgId & 0xffff);
		const seqBuf = Buffer.alloc(2);
		seqBuf.writeUInt16BE(seqNum & 0xffff);
		const saltBuf = Buffer.from(SALT, "utf-8");
		const material = Buffer.concat([this.encRand, saltBuf, msgIdBuf, seqBuf]);

		let hash = crypto.createHash("sha256").update(material).digest();
		hash = crypto.createHash("sha256").update(hash).digest();
		hash = crypto.createHash("sha256").update(hash).digest();
		return hash.subarray(0, 16);
	}

	/**
	 * Encrypt payload with AES-128-CBC (PKCS7 padding).
	 *
	 * @param payload - Data to encrypt
	 * @param msgId - Message ID for key derivation
	 * @param seqNum - Sequence number for key derivation
	 */
	encrypt(payload: Buffer, msgId: number, seqNum: number): Buffer {
		const key = this.deriveKey(msgId, seqNum);
		const iv = this.deriveIv(msgId, seqNum);
		const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
		cipher.setAutoPadding(true);
		return Buffer.concat([cipher.update(payload), cipher.final()]);
	}

	/**
	 * Decrypt payload with AES-128-CBC (PKCS7 unpadding).
	 *
	 * @param payload - Data to decrypt
	 * @param msgId - Message ID for key derivation
	 * @param seqNum - Sequence number for key derivation
	 */
	decrypt(payload: Buffer, msgId: number, seqNum: number): Buffer {
		const key = this.deriveKey(msgId, seqNum);
		const iv = this.deriveIv(msgId, seqNum);
		const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
		decipher.setAutoPadding(true);
		return Buffer.concat([decipher.update(payload), decipher.final()]);
	}
}

export = Encryption;
