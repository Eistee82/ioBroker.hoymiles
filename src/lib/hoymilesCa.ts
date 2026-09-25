/**
 * Hoymiles' own root certificate authority.
 *
 * DTUs with firmware V01.01.01 and later talk to the cloud over TLS (port 10083) and verify the
 * server certificate (`*.hoymiles.com`) against this self-signed CA, which the firmware carries
 * in its image. The cloud relay uses the same anchor when it talks to the cloud in the DTU's name,
 * so it accepts exactly the server the DTU would accept.
 *
 * Extracted from `DTUBI_OTA_B_V01.01.01` (HMS-800W-2T DTU firmware); the identical certificate
 * is also served by `dataeu.hoymiles.com:10083` as the issuer of its leaf certificate.
 * Subject: C=CN, O=Hoymiles Power Electronics Inc., CN=Hoymiles Organization Validation CA - SHA256 - G2
 */
export const HOYMILES_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICszCCAlmgAwIBAgIJANvWBtDFCRRsMAoGCCqGSM49BAMCMIG0MQswCQYDVQQG
EwJDTjERMA8GA1UECAwIWmhlSmlhbmcxETAPBgNVBAcMCEhhbmdaaG91MSgwJgYD
VQQKDB9Ib3ltaWxlcyBQb3dlciBFbGVjdHJvbmljcyBJbmMuMRkwFwYDVQQLDBB3
d3cuaG95bWlsZXMuY29tMTowOAYDVQQDDDFIb3ltaWxlcyBPcmdhbml6YXRpb24g
VmFsaWRhdGlvbiBDQSAtIFNIQTI1NiAtIEcyMCAXDTIzMTEyODA1NTIzNloYDzMw
MjMwMzMxMDU1MjM2WjCBtDELMAkGA1UEBhMCQ04xETAPBgNVBAgMCFpoZUppYW5n
MREwDwYDVQQHDAhIYW5nWmhvdTEoMCYGA1UECgwfSG95bWlsZXMgUG93ZXIgRWxl
Y3Ryb25pY3MgSW5jLjEZMBcGA1UECwwQd3d3LmhveW1pbGVzLmNvbTE6MDgGA1UE
AwwxSG95bWlsZXMgT3JnYW5pemF0aW9uIFZhbGlkYXRpb24gQ0EgLSBTSEEyNTYg
LSBHMjBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABG0nifia1BkSE+xeWX2wWX3b
qoxd8ygj39Ysx3mLZn1bJ8BPCnTpxE2eMOMOSjSQwEecEPKTinNUSmMDMhGnHtKj
UDBOMB0GA1UdDgQWBBS+sFiA0rSgzY04IcB9HxQ1hppgazAfBgNVHSMEGDAWgBS+
sFiA0rSgzY04IcB9HxQ1hppgazAMBgNVHRMEBTADAQH/MAoGCCqGSM49BAMCA0gA
MEUCICSvqni7wgOGsMwEiS0u/tTNQGo5Hu23K4JydwurATZdAiEA9/7G7NnUaj+3
04jdNHQohl+7nPjMR1vvUZqoywuPOgs=
-----END CERTIFICATE-----
`;
