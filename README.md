![Logo](admin/hoymiles.png)
# ioBroker.hoymiles

![Number of Installations](https://iobroker.live/badges/hoymiles-installed.svg)
[![NPM version](https://img.shields.io/npm/v/iobroker.hoymiles.svg)](https://www.npmjs.com/package/iobroker.hoymiles)

![Test and Release](https://github.com/Eistee82/ioBroker.hoymiles/workflows/Test%20and%20Release/badge.svg)
[![Downloads](https://img.shields.io/npm/dm/iobroker.hoymiles.svg)](https://www.npmjs.com/package/iobroker.hoymiles)
[![License](https://img.shields.io/github/license/Eistee82/ioBroker.hoymiles)](https://github.com/Eistee82/ioBroker.hoymiles/blob/main/LICENSE)
[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/eistee)

**If you like this adapter, please consider a donation:**

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://paypal.me/eistee)

## Disclaimer

**All product and company names or logos are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them or any associated subsidiaries! This personal project is maintained in spare time and has no business goal.**

**THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.** Use at your own risk. The authors are not responsible for any damage to your inverter, DTU, or any other equipment. This adapter communicates directly with your hardware — incorrect use of commands (power limit, reboot, on/off) can affect your solar installation.

This adapter is not affiliated with, endorsed by, or connected to Hoymiles Power Electronics Inc. in any way.

## Description

ioBroker adapter for [**Hoymiles**](https://www.hoymiles.com/) **HMS-xxxW-xT** microinverters with integrated WiFi DTU (DTUBI).

Two connection modes (independently configurable):
- **Local:** Direct TCP/Protobuf communication on port 10081 — no cloud, no gateway needed
- **Cloud:** Hoymiles S-Miles Cloud API — monthly/yearly energy, CO2 savings, income calculation

## Documentation

- 🇺🇸 [English Documentation](docs/en/README.md)
- 🇩🇪 [Deutsche Dokumentation](docs/de/README.md)

## Features

- Dual mode: local TCP/Protobuf and/or S-Miles Cloud API
- Continuous polling with request queue for reliable data retrieval
- Performance data mode for real-time monitoring
- Configurable poll pause between cycles (0 = fastest possible)
- Configurable slow poll factor for config/alarm queries (reduces DTU traffic)
- Real-time data: power, voltage, current, frequency, energy, temperature
- Per-panel monitoring (PV0/PV1)
- Energy aggregates: daily, monthly, yearly, total (kWh)
- Income calculation based on electricity price (cloud)
- CO2 savings tracking (cloud)
- Power limit control (2-100%), inverter on/off/reboot, DTU reboot
- Alarm and warning monitoring (109 codes DE/EN)
- AES encryption support for newer DTU firmware
- Network discovery module for ioBroker.discovery
- TypeScript, ESLint, Prettier, GitHub CI/CD
- Full i18n: en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn

## Configuration

Open the adapter configuration in the ioBroker admin interface.

### Local Connection (TCP)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable local** | on | Enable direct TCP/Protobuf connection |
| **DTU Host** | (empty) | IP address or hostname of the inverter. Leave empty for auto-discovery on adapter start. |
| **Pause between polls** | 30 | Pause between poll cycles in seconds. 0 = no pause (fastest possible, ~2-4s per cycle). |
| **Config/alarm poll factor** | 6 | Config and alarms are only queried every Nth poll. Reduces DTU traffic during fast polling. |

> **Note:** Very short poll intervals (below ~15s) keep the TCP connection to the DTU busy and can prevent the inverter from uploading data to the Hoymiles Cloud. If you use cloud monitoring in parallel, keep the pause at 30s or higher.

### Cloud Connection (S-Miles)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable cloud** | off | Enable Hoymiles S-Miles Cloud API |
| **S-Miles Email** | — | Your S-Miles account email |
| **S-Miles Password** | — | Your S-Miles account password (stored encrypted) |
| **DTU Serial** | (empty) | For multiple inverters in your account: enter DTU serial to match the correct one. Leave empty for single inverter setups. |
| **Cloud Poll Interval** | 300s | Cloud query interval (60-3600 seconds) |

Both connections can be enabled simultaneously. Local data has priority — cloud data fills in when the DTU is offline (e.g. at night).

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
| HMS-800W-2T | **Tested** (Local + Cloud) |
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

## Multiple Inverters

If you have multiple inverters, simply create multiple adapter instances:

- `hoymiles.0` → Inverter 1 (e.g. 192.168.178.87)
- `hoymiles.1` → Inverter 2 (e.g. 192.168.178.88)

Each instance has its own configuration and runs independently.

## Changelog

### 0.1.0 (2026-03-26)
- (@Eistee82) First tested release — HMS-800W-2T verified with local TCP and S-Miles Cloud
- (@Eistee82) Direct TCP/Protobuf communication with Hoymiles HMS inverters (integrated WiFi DTU)
- (@Eistee82) Hoymiles S-Miles Cloud API integration (dual mode: local and/or cloud)
- (@Eistee82) Continuous polling with request queue for reliable data retrieval
- (@Eistee82) Performance data mode for real-time monitoring
- (@Eistee82) Configurable poll pause between cycles (0 = no pause, fastest possible)
- (@Eistee82) Configurable slow poll factor for config/alarm queries
- (@Eistee82) Real-time data: grid power, voltage, current, frequency, energy
- (@Eistee82) Per-panel data (PV0/PV1): voltage, current, power, energy
- (@Eistee82) Energy aggregates: daily, monthly, yearly, total (kWh)
- (@Eistee82) Inverter control: power limit (2-100%), on/off, reboot
- (@Eistee82) DTU control: reboot, configuration readout
- (@Eistee82) Alarm and warning monitoring (109 codes DE/EN)
- (@Eistee82) Dynamic state creation based on active modes (local/cloud)
- (@Eistee82) Dynamic meter state creation (only when meter detected)
- (@Eistee82) AES encryption support for newer DTU firmware
- (@Eistee82) Network discovery module for ioBroker.discovery
- (@Eistee82) Full i18n: en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn

## License

MIT License

Copyright (c) 2026 Eistee82

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
