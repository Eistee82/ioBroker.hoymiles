# ioBroker.hoymiles

[![License](https://img.shields.io/github/license/Eistee82/ioBroker.hoymiles)](https://github.com/Eistee82/ioBroker.hoymiles/blob/main/LICENSE)

## ⚠️ Status: UNTESTED

**This adapter has not been tested with real hardware yet.** It is based on protocol reverse-engineering from [hoymiles-wifi](https://github.com/suaveolent/hoymiles-wifi) and [dtuGateway](https://github.com/ohAnd/dtuGateway). Use at your own risk. Feedback and bug reports are welcome!

## Description

ioBroker adapter for **Hoymiles HMS-xxxW-xT** microinverters with integrated WiFi DTU (DTUBI).

Communicates directly with the inverter's built-in WiFi DTU via TCP/Protobuf on port 10081 — **no cloud, no gateway, no additional hardware required**.

## Documentation

🇺🇸 [Documentation](docs/en/README.md)

🇩🇪 [Dokumentation](docs/de/README.md)

## Features

- Direct local TCP/Protobuf communication
- Real-time data: power, voltage, current, frequency, energy, temperature
- Per-panel monitoring (PV0/PV1)
- Power limit control (2-100%)
- Inverter on/off/reboot
- Cloud pause mode (optional, for Hoymiles cloud compatibility)
- Alarm and warning monitoring (109 codes DE/EN)
- AES encryption support for newer DTU firmware
- Historical power data

## Supported Inverters

This adapter is designed for **Hoymiles HMS microinverters with integrated WiFi DTU** (DTUBI):

**1 String (1T):**

| Model | Status |
|-------|--------|
| HMS-300W-1T | Untested |
| HMS-350W-1T | Untested |
| HMS-400W-1T | Untested |
| HMS-450W-1T | Untested |
| HMS-500W-1T | Untested |

**2 Strings (2T):**

| Model | Status |
|-------|--------|
| HMS-600W-2T | Untested |
| HMS-700W-2T | Untested |
| HMS-800W-2T | Untested |
| HMS-900W-2T | Untested |
| HMS-1000W-2T | Untested |

**4 Strings (4T) — only DW variant:**

| Model | Status |
|-------|--------|
| HMS-1600DW-4T | Untested |
| HMS-1800DW-4T | Untested |
| HMS-2000DW-4T | Untested |

> **Important:** This adapter **only** works with HMS models that have **integrated WiFi**. It does **NOT** work with:
> - HMS-1600/1800/2000-4T **without** "DW" (these use Sub-1G RF and need an external DTU)
> - HM series (no WiFi, RF only)
> - MI series (no WiFi, RF only)
> - HMS/HMT with external DTU-Pro or DTU-WLite sticks
> - HMT three-phase models

## Changelog

### WORK IN PROGRESS
- (@Eistee82) Initial project setup
- (@Eistee82) Direct TCP/Protobuf communication with Hoymiles HMS inverters (integrated WiFi DTU)
- (@Eistee82) Real-time data: grid power, voltage, current, frequency, energy
- (@Eistee82) Per-panel data (PV0/PV1): voltage, current, power, energy
- (@Eistee82) Inverter status: temperature, power limit, link status, warnings
- (@Eistee82) Device information: serial numbers, firmware versions, signal strength
- (@Eistee82) DTU configuration readout: server domain, WiFi SSID, RSSI
- (@Eistee82) Cloud pause mode for Hoymiles cloud compatibility
- (@Eistee82) Power limit control (2-100%)
- (@Eistee82) Inverter on/off/reboot commands
- (@Eistee82) Alarm and warning monitoring with JSON export (109 codes DE/EN)
- (@Eistee82) AES encryption support for newer DTU firmware
- (@Eistee82) Historical power data
- (@Eistee82) Full i18n: en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn

## License

MIT License — see [LICENSE](LICENSE) for details.
