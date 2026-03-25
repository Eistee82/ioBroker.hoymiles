"use strict";

const crypto = require("crypto");

class Encryption {
    constructor(encRand) {
        this.encRand = encRand;
        this.key = null;
        this.iv = null;
        if (encRand && encRand.length >= 16) {
            this.key = Buffer.from(encRand.slice(0, 16));
            this.iv = Buffer.from(encRand.slice(0, 16));
        }
    }

    static isRequired(dfs) {
        if (!dfs) return false;
        return ((Number(dfs) >> 25) & 1) === 1;
    }

    encrypt(payload) {
        if (!this.key) {
            throw new Error("Encryption not initialized: no enc_rand available");
        }
        const cipher = crypto.createCipheriv("aes-128-cbc", this.key, this.iv);
        cipher.setAutoPadding(true);
        return Buffer.concat([cipher.update(payload), cipher.final()]);
    }

    decrypt(payload) {
        if (!this.key) {
            throw new Error("Decryption not initialized: no enc_rand available");
        }
        const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(payload), decipher.final()]);
    }
}

module.exports = Encryption;
