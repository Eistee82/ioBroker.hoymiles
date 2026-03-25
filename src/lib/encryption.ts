import * as crypto from "node:crypto";

class Encryption {
	private readonly key: Buffer | null;
	private readonly iv: Buffer | null;

	constructor(encRand: string) {
		this.key = null;
		this.iv = null;
		if (encRand && encRand.length >= 16) {
			this.key = Buffer.from(encRand.slice(0, 16));
			this.iv = Buffer.from(encRand.slice(0, 16));
		}
	}

	static isRequired(dfs: number | null | undefined): boolean {
		if (!dfs) {
			return false;
		}
		return ((Number(dfs) >> 25) & 1) === 1;
	}

	encrypt(payload: Buffer): Buffer {
		if (!this.key || !this.iv) {
			throw new Error("Encryption not initialized: no enc_rand available");
		}
		const cipher = crypto.createCipheriv("aes-128-cbc", this.key, this.iv);
		cipher.setAutoPadding(true);
		return Buffer.concat([cipher.update(payload), cipher.final()]);
	}

	decrypt(payload: Buffer): Buffer {
		if (!this.key || !this.iv) {
			throw new Error("Decryption not initialized: no enc_rand available");
		}
		const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
		decipher.setAutoPadding(true);
		return Buffer.concat([decipher.update(payload), decipher.final()]);
	}
}

export = Encryption;
