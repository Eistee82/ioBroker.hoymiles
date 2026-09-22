import { bleDecrypt, bleEncrypt } from "./bleCrypto.js";
import { crc16 } from "./crc16.js";
import { HM_HEADER_SIZE, HM_MAGIC_0, HM_MAGIC_1, LOCAL_GCM_TAG_LEN } from "./constants.js";
const ENCRYPTED_TAG_MIN = 0x2315;
const ENCRYPTED_TAG_MAX = 0xa317;
const TAG_INFO_RESPONSE = 0xa201;
const TAG_INFO_REQUEST = 0xa301;
class Encryption {
    encRand;
    constructor(encRand) {
        this.encRand = typeof encRand === "string" ? Buffer.from(encRand, "base64") : Buffer.from(encRand);
    }
    static isRequired(dfs) {
        if (!dfs) {
            return false;
        }
        return ((Number(dfs) >> 25) & 1) === 1;
    }
    static isEncryptedTag(tag) {
        return (tag >= ENCRYPTED_TAG_MIN &&
            tag <= ENCRYPTED_TAG_MAX &&
            tag !== TAG_INFO_RESPONSE &&
            tag !== TAG_INFO_REQUEST);
    }
    static wireLength(header, encryptionActive) {
        const tag = (header[2] << 8) | header[3];
        const totalLen = (header[8] << 8) | header[9];
        if (encryptionActive && totalLen > HM_HEADER_SIZE && Encryption.isEncryptedTag(tag)) {
            return totalLen + LOCAL_GCM_TAG_LEN;
        }
        return totalLen;
    }
    encrypt(payload, msgId, seqNum) {
        return bleEncrypt(this.encRand, msgId, seqNum, payload).full;
    }
    decrypt(ctPlusTag, msgId, seqNum) {
        if (ctPlusTag.length < LOCAL_GCM_TAG_LEN) {
            throw new Error(`frame too short for an authentication tag (${ctPlusTag.length} bytes)`);
        }
        return bleDecrypt(this.encRand, msgId, seqNum, ctPlusTag);
    }
    encryptFrame(frame) {
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
//# sourceMappingURL=encryption.js.map