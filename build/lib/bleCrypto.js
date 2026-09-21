import * as crypto from "node:crypto";
import { crc16 } from "./crc16.js";
import { HM_MAGIC_0, HM_MAGIC_1 } from "./constants.js";
const SN_CONST = Buffer.from("Hoymiles@#123456", "ascii");
const HM_HEADER_SIZE = 10;
const GCM_TAG_LEN = 16;
const sha256 = (b) => crypto.createHash("sha256").update(b).digest();
const sha256x3 = (b) => sha256(sha256(sha256(b)));
export function bleKey(encRand) {
    return sha256x3(encRand.subarray(0, 16)).subarray(0, 16);
}
export function bleNonce(encRand, msgId, seq) {
    const h = Buffer.alloc(4 + 16);
    h.writeUInt16LE(msgId & 0xffff, 0);
    h.writeUInt16LE(seq & 0xffff, 2);
    encRand.subarray(0, 16).copy(h, 4);
    return sha256x3(h).subarray(20, 32);
}
export function bleAad(msgId, seq) {
    const a = Buffer.alloc(4);
    a.writeUInt32LE(((msgId & 0xffff) | ((seq & 0xffff) << 16)) >>> 0, 0);
    return a;
}
export function bleEncrypt(encRand, msgId, seq, plain) {
    const c = crypto.createCipheriv("aes-128-gcm", bleKey(encRand), bleNonce(encRand, msgId, seq), {
        authTagLength: GCM_TAG_LEN,
    });
    c.setAAD(bleAad(msgId, seq));
    const ct = Buffer.concat([c.update(plain), c.final()]);
    const tag = c.getAuthTag();
    return { ct, tag, full: Buffer.concat([ct, tag]) };
}
export function bleDecrypt(encRand, msgId, seq, ctPlusTag) {
    const ct = ctPlusTag.subarray(0, ctPlusTag.length - GCM_TAG_LEN);
    const tag = ctPlusTag.subarray(ctPlusTag.length - GCM_TAG_LEN);
    const d = crypto.createDecipheriv("aes-128-gcm", bleKey(encRand), bleNonce(encRand, msgId, seq), {
        authTagLength: GCM_TAG_LEN,
    });
    d.setAAD(bleAad(msgId, seq));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
}
export function snCbcKey(sn) {
    return sha256x3(Buffer.concat([sn, SN_CONST])).subarray(0, 16);
}
export function snCbcIv(sn, msgId, seq) {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(msgId & 0xffff, 0);
    h.writeUInt16BE(seq & 0xffff, 2);
    return sha256x3(Buffer.concat([h, sn])).subarray(16, 32);
}
export function snEncrypt(sn, msgId, seq, plain) {
    const c = crypto.createCipheriv("aes-128-cbc", snCbcKey(sn), snCbcIv(sn, msgId, seq));
    c.setAutoPadding(true);
    return Buffer.concat([c.update(plain), c.final()]);
}
export function snDecrypt(sn, msgId, seq, ct) {
    const d = crypto.createDecipheriv("aes-128-cbc", snCbcKey(sn), snCbcIv(sn, msgId, seq));
    d.setAutoPadding(true);
    return Buffer.concat([d.update(ct), d.final()]);
}
export function bleBuildFrame(tag, payload, opts) {
    const seq = opts.seq & 0xffff;
    const mode = opts.mode ?? "plain";
    let body;
    let crcInput;
    if (mode === "gcm") {
        if (!opts.encRand) {
            throw new Error("gcm mode requires encRand");
        }
        const { ct, full } = bleEncrypt(opts.encRand, tag, seq, payload);
        crcInput = ct;
        body = full;
    }
    else if (mode === "sncbc") {
        if (!opts.sn) {
            throw new Error("sncbc mode requires sn");
        }
        const ct = snEncrypt(opts.sn, tag, seq, payload);
        crcInput = ct;
        body = ct;
    }
    else {
        crcInput = payload;
        body = payload;
    }
    const hdr = Buffer.alloc(HM_HEADER_SIZE);
    hdr[0] = HM_MAGIC_0;
    hdr[1] = HM_MAGIC_1;
    hdr.writeUInt16BE(tag & 0xffff, 2);
    hdr.writeUInt16BE(seq, 4);
    hdr.writeUInt16BE(crc16(crcInput), 6);
    hdr.writeUInt16BE(crcInput.length + HM_HEADER_SIZE, 8);
    return Buffer.concat([hdr, body]);
}
export function bleParseFrame(buf) {
    if (buf.length < HM_HEADER_SIZE || buf[0] !== HM_MAGIC_0 || buf[1] !== HM_MAGIC_1) {
        return null;
    }
    return {
        tag: buf.readUInt16BE(2),
        seq: buf.readUInt16BE(4),
        crc: buf.readUInt16BE(6),
        totalLen: buf.readUInt16BE(8),
        payload: buf.subarray(HM_HEADER_SIZE),
    };
}
export function pbFindBytes(buf, fieldNo) {
    let i = 0;
    while (i < buf.length) {
        let tag = 0;
        let sh = 0;
        let b;
        do {
            b = buf[i++];
            tag |= (b & 0x7f) << sh;
            sh += 7;
        } while (b & 0x80 && i < buf.length);
        const fno = tag >>> 3;
        const wt = tag & 7;
        if (wt === 2) {
            let len = 0;
            let s2 = 0;
            let c;
            do {
                c = buf[i++];
                len |= (c & 0x7f) << s2;
                s2 += 7;
            } while (c & 0x80 && i < buf.length);
            const val = buf.subarray(i, i + len);
            i += len;
            if (fno === fieldNo) {
                return val;
            }
        }
        else if (wt === 0) {
            let c;
            do {
                c = buf[i++];
            } while (c & 0x80 && i < buf.length);
        }
        else if (wt === 5) {
            i += 4;
        }
        else if (wt === 1) {
            i += 8;
        }
        else {
            break;
        }
    }
    return null;
}
export function pbFindNested(buf, path) {
    let cur = buf;
    for (const target of path) {
        if (!cur) {
            return null;
        }
        cur = pbFindBytes(cur, target);
    }
    return cur;
}
export function pbFindVarint(buf, fieldNo) {
    let i = 0;
    while (i < buf.length) {
        let tag = 0;
        let sh = 0;
        let b;
        do {
            b = buf[i++];
            tag |= (b & 0x7f) << sh;
            sh += 7;
        } while (b & 0x80 && i < buf.length);
        const fno = tag >>> 3;
        const wt = tag & 7;
        if (wt === 0) {
            let n = 0;
            let s = 0;
            let c;
            do {
                c = buf[i++];
                n |= (c & 0x7f) << s;
                s += 7;
            } while (c & 0x80 && i < buf.length);
            if (fno === fieldNo) {
                return n;
            }
        }
        else if (wt === 2) {
            let l = 0;
            let s = 0;
            let c;
            do {
                c = buf[i++];
                l |= (c & 0x7f) << s;
                s += 7;
            } while (c & 0x80 && i < buf.length);
            i += l;
        }
        else if (wt === 5) {
            i += 4;
        }
        else if (wt === 1) {
            i += 8;
        }
        else {
            break;
        }
    }
    return null;
}
export function extractEncRand(decryptedBootstrap) {
    const enc = pbFindNested(decryptedBootstrap, [8, 27]);
    if (enc && enc.length >= 16) {
        return Buffer.from(enc.subarray(0, 16));
    }
    return null;
}
//# sourceMappingURL=bleCrypto.js.map