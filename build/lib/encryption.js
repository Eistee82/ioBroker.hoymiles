"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const crypto = __importStar(require("node:crypto"));
const SALT = "123456";
class Encryption {
    encRand;
    constructor(encRand) {
        if (typeof encRand === "string") {
            this.encRand = Buffer.from(encRand, "utf-8");
        }
        else {
            this.encRand = encRand;
        }
    }
    /**
     * Check if encryption is required (bit 25 of dfs field).
     *
     * @param dfs - Device feature flags from DTU info response
     */
    static isRequired(dfs) {
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
    deriveKey(msgId, seqNum) {
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
    deriveIv(msgId, seqNum) {
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
    encrypt(payload, msgId, seqNum) {
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
    decrypt(payload, msgId, seqNum) {
        const key = this.deriveKey(msgId, seqNum);
        const iv = this.deriveIv(msgId, seqNum);
        const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(payload), decipher.final()]);
    }
}
module.exports = Encryption;
//# sourceMappingURL=encryption.js.map