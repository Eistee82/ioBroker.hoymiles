# Older Changelog

This file holds older changelog entries for `iobroker.hoymiles`. The current changelog (the latest few releases plus `WORK IN PROGRESS`) lives in [README.md](README.md#changelog).

### 0.3.0 (2026-04-03)
- (@Eistee82) Multi-inverter support: multiple DTUs in a single adapter instance
- (@Eistee82) Cloud auto-discovery: all inverters and stations in the account are automatically detected
- (@Eistee82) Station-level aggregated data as separate device (power, energy, CO2, income)
- (@Eistee82) Per-inverter and per-panel cloud realtime data (power, voltage, current, temperature)
- (@Eistee82) Network discovery: scan for DTUs via admin UI button
- (@Eistee82) Weather data per station: temperature, icon, description, sunrise/sunset
- (@Eistee82) Firmware update check: daily check via cloud API
- (@Eistee82) State quality (`q`): marks data as stale on disconnect (`0x42`), substitute for cloud fallback (`0x40`), auto-reset on reconnect
- (@Eistee82) Night mode: reduced cloud polling when inverter is offline (weather + firmware only)
- (@Eistee82) Cloud relay: configurable RealData interval from DTU serverSendTime, exponential backoff
- (@Eistee82) Cloud login retry with exponential backoff (60s → max 600s)
- (@Eistee82) Automatic config migration from v0.2.0 single-device format
- (@Eistee82) Migrated to ESM (ECMAScript Modules) with Node.js >= 20.11.0
- (@Eistee82) Fix: automatic reconnect when DTU is offline at adapter start
- (@Eistee82) Fix: various connection lifecycle issues (socket cleanup, stale events, timer resets)

### 0.2.0 (2026-03-27)
- (@Eistee82) Protocol rewrite based on original Hoymiles app decompilation and PCAP analysis
- (@Eistee82) Persistent TCP connection with protobuf heartbeat (20s idle keepalive)
- (@Eistee82) Cloud Relay: forwards inverter data to Hoymiles Cloud on behalf of DTU (heartbeat every 60s, RealData every 5 min)
- (@Eistee82) Automatic cloud poll timing derived from DTU sendTime config
- (@Eistee82) Sequence numbers in message framing (0-60000 wrap-around)
- (@Eistee82) AES-128-CBC encryption with SHA-256 key derivation for newer DTU firmware
- (@Eistee82) New commands: power factor limit, reactive power limit, clean warnings, clean grounding fault, lock/unlock inverter
- (@Eistee82) Configurable data interval (0 = fastest, ~1s per cycle)
- (@Eistee82) Writable cloud send interval (config.serverSendTime)
- (@Eistee82) 5-minute idle timeout with automatic reconnect

### 0.1.0 (2026-03-26)
- (@Eistee82) First tested release — HMS-800W-2T verified with local TCP and S-Miles Cloud
- (@Eistee82) Direct TCP/Protobuf communication with Hoymiles HMS inverters (integrated WiFi DTU)
- (@Eistee82) Hoymiles S-Miles Cloud API integration (dual mode: local and/or cloud)
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
