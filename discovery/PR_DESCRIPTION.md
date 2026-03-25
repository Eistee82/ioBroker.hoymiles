# Add Hoymiles HMS inverter discovery

## Adapter

- **Name:** [ioBroker.hoymiles](https://github.com/Eistee82/ioBroker.hoymiles)
- **npm:** [iobroker.hoymiles](https://www.npmjs.com/package/iobroker.hoymiles)
- **Type:** Solar inverter monitoring
- **Version:** 0.1.0

## Discovery method

- **Type:** `ip` — probes each IP on the local network
- **Port:** TCP 10081 (Hoymiles DTU protocol port)
- **Verification:** Sends a minimal Protobuf InfoData request and checks for the Hoymiles "HM" magic bytes + valid response (0xa2 0x01). Extracts DTU serial number from the response.
- **Timeout:** 1.5s per host, 2s total

## What it detects

Hoymiles HMS microinverters with integrated WiFi DTU (DTUBI):
- HMS-300W to HMS-500W (1T models)
- HMS-600W to HMS-1000W (2T models)
- HMS-1600DW to HMS-2000DW (4T models)

Tested with HMS-800W-2T.

## Files

- `lib/adapters/hoymiles.js` — the discovery module (self-contained, no external dependencies beyond `net` and `tools.js`)

## How to submit

1. Fork [ioBroker/ioBroker.discovery](https://github.com/ioBroker/ioBroker.discovery)
2. Copy `discovery/hoymiles.js` from this repo to `lib/adapters/hoymiles.js`
3. Add "Hoymiles" to the supported adapters list in README.md
4. Create PR
