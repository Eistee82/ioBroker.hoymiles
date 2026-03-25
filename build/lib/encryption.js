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
class Encryption {
    key;
    iv;
    constructor(encRand) {
        this.key = null;
        this.iv = null;
        if (encRand && encRand.length >= 16) {
            this.key = Buffer.from(encRand.slice(0, 16));
            this.iv = Buffer.from(encRand.slice(0, 16));
        }
    }
    static isRequired(dfs) {
        if (!dfs) {
            return false;
        }
        return ((Number(dfs) >> 25) & 1) === 1;
    }
    encrypt(payload) {
        if (!this.key || !this.iv) {
            throw new Error("Encryption not initialized: no enc_rand available");
        }
        const cipher = crypto.createCipheriv("aes-128-cbc", this.key, this.iv);
        cipher.setAutoPadding(true);
        return Buffer.concat([cipher.update(payload), cipher.final()]);
    }
    decrypt(payload) {
        if (!this.key || !this.iv) {
            throw new Error("Decryption not initialized: no enc_rand available");
        }
        const decipher = crypto.createDecipheriv("aes-128-cbc", this.key, this.iv);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(payload), decipher.final()]);
    }
}
module.exports = Encryption;
//# sourceMappingURL=encryption.js.map