![Logo](../../admin/hoymiles.png)

# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT

## Supported Inverters

This adapter is designed for **Hoymiles HMS microinverters with integrated WiFi DTU** (DTUBI):

- **1T** (1 string): HMS-300W-1T, HMS-350W-1T, HMS-400W-1T, HMS-450W-1T, HMS-500W-1T
- **2T** (2 strings): HMS-600W-2T, HMS-700W-2T, HMS-800W-2T (**Tested**), HMS-900W-2T, HMS-1000W-2T (**Tested Local**)
- **4T** (4 strings, **DW variant only**): HMS-1600DW-4T, HMS-1800DW-4T, HMS-2000DW-4T

> This adapter does **NOT** work with: HMS-1600/1800/2000-4T without "DW", HM series, MI series, external DTU sticks, or HMT three-phase models.

## Configuration

Open the adapter configuration in the ioBroker admin interface.

### Local Connection (TCP)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable local** | on | Enable direct TCP/Protobuf connection. The adapter maintains a persistent TCP connection with protobuf heartbeat. |
| **DTU devices** | (empty) | Table of DTU IP addresses/hostnames. Add one row per DTU. |
| **Data query interval** | 5s | Seconds between data requests (0-300). Set 0 for fastest possible (~1s per cycle). |
| **Config/alarm poll factor** | 6 | Config and alarms are queried every Nth data cycle. |
| **Cloud Relay** | on | Forward real-time data to Hoymiles Cloud on behalf of the DTU. Without this, the local TCP connection blocks the DTU from uploading to the cloud. |

### Cloud Connection (S-Miles)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable cloud** | off | Enable Hoymiles S-Miles Cloud API |
| **S-Miles Email** | — | Your S-Miles account email |
| **S-Miles Password** | — | Your S-Miles account password (stored encrypted) |

All inverters in your cloud account are automatically discovered. No manual serial number configuration needed.

Both connections can be enabled simultaneously. Local data has priority — cloud data fills in when the DTU is offline (e.g. at night).

## Connection Modes

The adapter supports several connection modes depending on the configuration:

| | Local only | Local + Relay | Cloud only | Local + Cloud | Local + Relay + Cloud |
|---|---|---|---|---|---|
| **TCP polling** | yes | yes | — | yes | yes |
| **Reconnect** | Backoff 1–60s | Backoff 1–60s | — | Backoff 1–60s | Backoff 1–60s |
| **Cloud Relay** | — | HB 60s, data every `serverSendTime` | — | — | HB 60s, data every `serverSendTime` |
| **Cloud on start** | — | — | Full fetch | Full fetch | Full fetch |
| **Cloud (WR online)** | — | — | Every 5min | Every `serverSendTime` | 30s after relay send |
| **Cloud (WR offline)** | — | — | Every 5min | Weather + FW only | Weather + FW only |

### Automatic Reconnect

The inverter (DTU) is only reachable when producing power (sun is shining). The adapter automatically reconnects with exponential backoff (1s, 2s, 4s, ... up to 60s max). When the connection succeeds, the backoff resets to 1s.

### Night Mode

When the local connection drops (typically at sunset), the adapter enters **night mode**:
- The cloud relay pauses (sends one final data upload, then disconnects)
- Cloud API reduces to weather updates and firmware checks only (no real-time data, since nothing changes)
- When the local connection is restored (sunrise), the adapter exits night mode and resumes normal operation

### State Quality

The adapter uses ioBroker's state quality attribute (`q`) to indicate the reliability and source of data values:

| Quality | Value | Meaning | When |
|---------|-------|---------|------|
| Good | `0x00` (0) | Fresh, locally sourced data | Normal operation — data received directly from DTU via TCP |
| Substitute | `0x40` (64) | Cloud-sourced fallback data | Inverter data fetched from the Hoymiles Cloud API instead of local TCP (cloud-only devices) |
| Device not connected | `0x42` (66) | Stale data, device offline | DTU connection lost — values are the last known readings before disconnect |

**Affected states:** `grid.*`, `pv*.*`, `inverter.temperature`, `inverter.active`, `inverter.warnCount`, `inverter.warnMessage`, `inverter.activePowerLimit`, `meter.*`

Info states (`info.*`), config states (`config.*`), and station-level cloud data are **not** affected by quality changes.

**Automatic reset:** When the local DTU connection is restored, the next successful data response automatically resets all affected states back to quality `0x00` (good).

You can use the quality attribute in scripts and visualizations to distinguish between fresh and stale data, e.g. by dimming or greying out values with `q > 0`.

## Multiple Inverters

This adapter supports multiple inverters in a single instance:

- **Local:** Add multiple DTU IP addresses in the device table
- **Cloud:** All inverters and stations in your account are automatically discovered

Each DTU creates a device node using its serial number as ID:
```
hoymiles.0.4143A01CEDE4.grid.power
hoymiles.0.4143A01CEDE4.inverter.*
hoymiles.0.4143A01CEDE4.dtu.*
hoymiles.0.4143A01CEDE4.pv0.*
```

Cloud stations create aggregated device nodes:
```
hoymiles.0.station-12345.grid.power      ← Sum of all inverters
hoymiles.0.station-12345.grid.totalEnergy
hoymiles.0.station-12345.info.stationName
```

## States

### `<dtuSerial>.grid.*` — Grid Output (per DTU)

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `grid.power` | number | W | Grid output power |
| `grid.voltage` | number | V | Grid voltage |
| `grid.current` | number | A | Grid current |
| `grid.frequency` | number | Hz | Grid frequency |
| `grid.reactivePower` | number | var | Reactive power |
| `grid.powerFactor` | number | — | Power factor |
| `grid.dailyEnergy` | number | kWh | Daily energy yield |

### `<dtuSerial>.info.*` — Device Information (per DTU)

| State | Type | Description |
|-------|------|-------------|
| `info.connected` | boolean | Device connected (local or cloud) |
| `info.lastResponse` | number | Last response time (Unix timestamp, local only) |

### `<dtuSerial>.pv0.*` / `pv1.*` / `pv2.*` / `pv3.*` — PV Panel Inputs (per DTU)

PV channels are created dynamically based on the inverter model (1T = 1 channel, 2T = 2 channels, 4T = 4 channels).

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `pvX.power` | number | W | Panel power |
| `pvX.voltage` | number | V | Panel voltage |
| `pvX.current` | number | A | Panel current |
| `pvX.dailyEnergy` | number | kWh | Daily energy (local only) |
| `pvX.totalEnergy` | number | kWh | Total energy (local only) |

### `<dtuSerial>.inverter.*` — Inverter Status & Control (per DTU)

| State | Type | Unit | Writable | Description |
|-------|------|------|----------|-------------|
| `inverter.serialNumber` | string | — | no | Inverter serial number |
| `inverter.model` | string | — | no | Inverter model (cloud) |
| `inverter.hwVersion` | string | — | no | Hardware version |
| `inverter.swVersion` | string | — | no | Software version |
| `inverter.temperature` | number | °C | no | Inverter temperature |
| `inverter.powerLimit` | number | % | **yes** | Power limit (2-100%, local) |
| `inverter.activePowerLimit` | number | % | no | Active power limit (live, local) |
| `inverter.active` | boolean | — | **yes** | Turn inverter on/off (local) |
| `inverter.reboot` | boolean | — | **yes** | Reboot inverter (button, local) |
| `inverter.powerFactorLimit` | number | — | **yes** | Power factor limit (-1 to 1, local) |
| `inverter.reactivePowerLimit` | number | ° | **yes** | Reactive power limit (-50 to 50, local) |
| `inverter.cleanWarnings` | boolean | — | **yes** | Clean warnings (button, local) |
| `inverter.cleanGroundingFault` | boolean | — | **yes** | Clean grounding fault (button, local) |
| `inverter.lock` | boolean | — | **yes** | Lock/unlock inverter (local) |
| `inverter.warnCount` | number | — | no | Active warning code (local) |
| `inverter.warnMessage` | string | — | no | Active warning message (local) |
| `inverter.linkStatus` | number | — | no | Link status |

### `<dtuSerial>.dtu.*` — DTU Information (per DTU, local only)

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `dtu.serialNumber` | string | — | DTU serial number |
| `dtu.swVersion` | string | — | Software version |
| `dtu.hwVersion` | string | — | Hardware version |
| `dtu.rssi` | number | dBm | Signal strength |
| `dtu.reboot` | boolean | — | Reboot DTU (**writable**, button) |
| `dtu.wifiVersion` | string | — | WiFi version |
| `dtu.fwUpdateAvailable` | boolean | — | Firmware update available (checked once daily via cloud) |
| `dtu.stepTime` | number | s | Step time |
| `dtu.rfHwVersion` | number | — | RF hardware version |
| `dtu.rfSwVersion` | number | — | RF software version |
| `dtu.accessModel` | number | — | Network access mode (0=GPRS, 1=WiFi, 2=Ethernet) |
| `dtu.communicationTime` | number | — | Last communication (Unix timestamp) |
| `dtu.connState` | number | — | DTU error code (0=OK) |
| `dtu.mode485` | number | — | RS485 mode (0=Reflux/Auto, 1=Remote Control) |
| `dtu.sub1gFrequencyBand` | number | — | Sub-1G frequency band |
| `dtu.searchResult` | string | — | AutoSearch result (inverter serials, JSON) |

### `station-<id>.grid.*` — Station Aggregates (cloud)

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `grid.power` | number | W | Total station power |
| `grid.dailyEnergy` | number | kWh | Daily energy |
| `grid.monthEnergy` | number | kWh | Monthly energy |
| `grid.yearEnergy` | number | kWh | Yearly energy |
| `grid.totalEnergy` | number | kWh | Total lifetime energy |
| `grid.co2Saved` | number | kg | CO2 saved |
| `grid.treesPlanted` | number | — | Equivalent trees planted |
| `grid.electricityPrice` | number | /kWh | Electricity price |
| `grid.currency` | string | — | Currency code |
| `grid.isBalance` | boolean | — | Zero export active |
| `grid.isReflux` | boolean | — | Feed-in active |
| `grid.todayIncome` | number | — | Today's income |
| `grid.totalIncome` | number | — | Total income |

### `station-<id>.info.*` — Station Information (cloud)

| State | Type | Description |
|-------|------|-------------|
| `info.stationName` | string | Station name |
| `info.stationId` | number | Station ID |
| `info.systemCapacity` | number | System capacity (kWp) |
| `info.address` | string | Station address |
| `info.latitude` | number | GPS latitude |
| `info.longitude` | number | GPS longitude |
| `info.stationStatus` | number | Station status |
| `info.installedAt` | number | Installation date |
| `info.timezone` | string | Timezone |
| `info.lastCloudUpdate` | number | Last cloud update time |
| `info.lastDataTime` | number | Last DTU data time |

### `station-<id>.weather.*` — Weather at Station (cloud)

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `weather.icon` | string | — | Weather icon code ([OpenWeatherMap](https://openweathermap.org/weather-conditions)) |
| `weather.description` | string | — | Weather description in German (e.g. "Klarer Himmel", "Regen") |
| `weather.temperature` | number | °C | Current temperature at station location |
| `weather.sunrise` | number | — | Sunrise time (Unix timestamp ms) |
| `weather.sunset` | number | — | Sunset time (Unix timestamp ms) |

> **Weather icon codes:** The icon codes follow the [OpenWeatherMap convention](https://openweathermap.org/weather-conditions). To display the icon as an image, use: `https://openweathermap.org/img/wn/{icon}@2x.png`

### `<dtuSerial>.alarms.*` — Alarm Data (per DTU, local)

| State | Type | Description |
|-------|------|-------------|
| `alarms.count` | number | Total alarm count |
| `alarms.activeCount` | number | Active (unresolved) alarm count |
| `alarms.hasActive` | boolean | Has active alarms |
| `alarms.json` | string | Full alarm list as JSON |
| `alarms.lastCode` | number | Last alarm code |
| `alarms.lastStartTime` | number | Last alarm start time |
| `alarms.lastEndTime` | number | Last alarm end time |
| `alarms.lastMessage` | string | Last alarm message (German) |
| `alarms.lastData1` | number | Last alarm data 1 (raw sensor value) |
| `alarms.lastData2` | number | Last alarm data 2 (raw sensor value) |

### `<dtuSerial>.config.*` — DTU Configuration (per DTU, local)

| State | Type | Unit | Writable | Description |
|-------|------|------|----------|-------------|
| `config.serverDomain` | string | — | no | Cloud server domain |
| `config.serverPort` | number | — | no | Cloud server port |
| `config.serverSendTime` | number | min | **yes** | Cloud send interval (minutes) |
| `config.wifiSsid` | string | — | no | WiFi SSID |
| `config.wifiRssi` | number | dBm | no | WiFi signal strength |
| `config.zeroExportEnable` | boolean | — | **yes** | Zero export enabled |
| `config.zeroExport433Addr` | number | — | no | Zero export 433MHz sensor address |
| `config.meterKind` | string | — | no | Meter type (0=None, 1=1-phase, 2=2-phase, 3=3-phase, 5=CT G3, 6=Meter 1S/1T G3, 7=Meter 2S/2T G3) |
| `config.meterInterface` | string | — | no | Meter interface |
| `config.invType` | number | — | no | Inverter type |
| `config.netmodeSelect` | number | — | no | Network mode (0=GPRS, 1=WiFi, 2=Ethernet) |
| `config.netDhcpSwitch` | number | — | no | DHCP enabled |
| `config.netIpAddress` | string | — | no | Ethernet IP address |
| `config.netSubnetMask` | string | — | no | Ethernet subnet mask |
| `config.netGateway` | string | — | no | Ethernet gateway |
| `config.netMacAddress` | string | — | no | Ethernet MAC address |
| `config.wifiIpAddress` | string | — | no | WiFi IP address |
| `config.wifiMacAddress` | string | — | no | WiFi MAC address |
| `config.dtuApSsid` | string | — | no | DTU access point SSID |
| `config.channelSelect` | number | — | no | Channel select |
| `config.sub1gSweepSwitch` | number | — | no | Sub-1G sweep |
| `config.sub1gWorkChannel` | number | — | no | Sub-1G work channel |

### `<dtuSerial>.meter.*` — Energy Meter (per DTU, local, dynamic)

Meter states are created automatically when meter data is first received from the DTU. Only available if a compatible energy meter is connected.

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `meter.totalPower` | number | W | Total power (all phases) |
| `meter.phaseAPower` | number | W | Phase A power |
| `meter.phaseBPower` | number | W | Phase B power |
| `meter.phaseCPower` | number | W | Phase C power |
| `meter.powerFactorTotal` | number | — | Power factor total |
| `meter.energyTotalExport` | number | kWh | Total energy export (feed-in) |
| `meter.energyTotalImport` | number | kWh | Total energy import (consumption) |
| `meter.voltagePhaseA` | number | V | Voltage phase A |
| `meter.voltagePhaseB` | number | V | Voltage phase B |
| `meter.voltagePhaseC` | number | V | Voltage phase C |
| `meter.currentPhaseA` | number | A | Current phase A |
| `meter.currentPhaseB` | number | A | Current phase B |
| `meter.currentPhaseC` | number | A | Current phase C |
| `meter.faultCode` | number | — | Meter fault code |

### Adapter-level States

| State | Type | Description |
|-------|------|-------------|
| `info.connection` | boolean | Any device connected (local or cloud) |
| `info.cloudConnected` | boolean | Cloud API connected |
| `info.cloudLastError` | string | Last permanent cloud login error (empty when OK). Non-empty values pause automatic retries until credentials are corrected. |

## Protocol

### Local (TCP/Protobuf)

- **Transport:** TCP port 10081
- **Encoding:** Protocol Buffers (protobuf)
- **Frame:** 10-byte header (`HM` magic + command ID + CRC16 + length) + protobuf payload, with sequence numbers (0-60000)
- **Authentication:** None (local network only)
- **Encryption:** Optional AES-128-CBC with SHA-256 key derivation (detected automatically via DTU info response)
- **Heartbeat:** Protobuf heartbeat every 20s to maintain the persistent connection
- **Reconnect:** 5-minute idle timeout, automatic reconnect with exponential backoff (1s-60s)

### Cloud (S-Miles API)

- **Base URL:** `https://neapi.hoymiles.com`
- **Authentication:** MD5+SHA256 credential hash with nonce
- **Data:** Station realtime, device tree, station details
- **Password:** Stored encrypted in ioBroker config

### Acknowledgments

Protocol reverse-engineering by the community:
- [hoymiles-wifi](https://github.com/suaveolent/hoymiles-wifi) — Python library (primary reference)
- [dtuGateway](https://github.com/ohAnd/dtuGateway) — ESP32 gateway
- [Hoymiles-DTU-Proto](https://github.com/henkwiedig/Hoymiles-DTU-Proto) — Original protobuf definitions

## Troubleshooting

### Adapter can't connect
- Verify the DTU IP address is correct (check your router's DHCP table)
- Make sure no other application is connected to port 10081 (only one connection at a time)
- If you have the dtuGateway ESP32 running, stop it first

### No data after connecting
- DTU firmware V01.01.00 and newer may break local protobuf communication
- Do NOT update the DTU firmware if local access is important to you
- Check the adapter log for protobuf decode errors

### Cloud login failed
- Check your S-Miles email and password
- Make sure you can login at https://global.hoymiles.com/website/login
- On a permanent authentication error (wrong credentials, account locked) the adapter stops the retry loop to avoid further account lockouts. The error is written to `info.cloudLastError` and an ioBroker alert notification (scope `hoymiles`, category `cloudAuth`) is raised. Correct the credentials and save the configuration to clear the state and resume retries.
