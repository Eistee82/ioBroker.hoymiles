# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT

## Supported Inverters

This adapter is designed for **Hoymiles HMS microinverters with integrated WiFi DTU** (DTUBI):

- **1T** (1 string): HMS-300W-1T, HMS-350W-1T, HMS-400W-1T, HMS-450W-1T, HMS-500W-1T
- **2T** (2 strings): HMS-600W-2T, HMS-700W-2T, HMS-800W-2T (**Tested**), HMS-900W-2T, HMS-1000W-2T
- **4T** (4 strings, **DW variant only**): HMS-1600DW-4T, HMS-1800DW-4T, HMS-2000DW-4T

> This adapter does **NOT** work with: HMS-1600/1800/2000-4T without "DW", HM series, MI series, external DTU sticks, or HMT three-phase models.

## Configuration

Open the adapter configuration in the ioBroker admin interface.

### Local Connection (TCP)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable local** | on | Enable direct TCP/Protobuf connection. The adapter maintains a persistent TCP connection with protobuf heartbeat. |
| **DTU Host** | (empty) | IP address or hostname of the inverter. Leave empty for auto-discovery on adapter start. You can also find the DTU IP in your router's DHCP client list (device name: DTUBI-*). |
| **Data query interval** | 5s | Seconds between data requests (0-300). Set 0 for fastest possible (~1s per cycle). |
| **Config/alarm poll factor** | 6 | Config and alarms are queried every Nth data cycle. |
| **Cloud Relay** | on | Forward real-time data to Hoymiles Cloud on behalf of the DTU. Without this, the local TCP connection blocks the DTU from uploading to the cloud. |

### Cloud Connection (S-Miles)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable cloud** | off | Enable Hoymiles S-Miles Cloud API |
| **S-Miles Email** | — | Your S-Miles account email |
| **S-Miles Password** | — | Your S-Miles account password (stored encrypted) |
| **DTU Serial** | (empty) | For multiple inverters in your account: enter DTU serial to match the correct one. Leave empty for single inverter setups. |

Both connections can be enabled simultaneously. Local data has priority — cloud data fills in when the DTU is offline (e.g. at night).
## States

### `hoymiles.0.grid.*` — Grid Output

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `grid.power` | number | W | Grid output power |
| `grid.voltage` | number | V | Grid voltage |
| `grid.current` | number | A | Grid current |
| `grid.frequency` | number | Hz | Grid frequency |
| `grid.reactivePower` | number | var | Reactive power |
| `grid.powerFactor` | number | — | Power factor |
| `grid.dailyEnergy` | number | kWh | Daily energy yield |
| `grid.totalEnergy` | number | kWh | Total lifetime energy |
| `grid.monthEnergy` | number | kWh | Monthly energy (cloud) |
| `grid.yearEnergy` | number | kWh | Yearly energy (cloud) |
| `grid.co2Saved` | number | kg | CO2 saved (cloud) |
| `grid.treesPlanted` | number | — | Equivalent trees planted (cloud) |
| `grid.electricityPrice` | number | /kWh | Electricity price (cloud) |
| `grid.currency` | string | — | Currency code e.g. EUR, USD (cloud) |
| `grid.todayIncome` | number | — | Today's income (calculated) |
| `grid.totalIncome` | number | — | Total income (calculated) |

### `hoymiles.0.pv0.*` / `hoymiles.0.pv1.*` — PV Panel Inputs

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `pvX.power` | number | W | Panel power |
| `pvX.voltage` | number | V | Panel voltage |
| `pvX.current` | number | A | Panel current |
| `pvX.dailyEnergy` | number | kWh | Daily energy |
| `pvX.totalEnergy` | number | kWh | Total energy |

### `hoymiles.0.inverter.*` — Inverter Status & Control

| State | Type | Unit | Writable | Description |
|-------|------|------|----------|-------------|
| `inverter.temperature` | number | °C | no | Inverter temperature |
| `inverter.powerLimit` | number | % | no | Current power limit |
| `inverter.powerLimitSet` | number | % | **yes** | Set power limit (2-100%) |
| `inverter.active` | boolean | — | **yes** | Turn inverter on/off |
| `inverter.reboot` | boolean | — | **yes** | Reboot inverter (button) |
| `inverter.warnCount` | number | — | no | Active warning count |
| `inverter.linkStatus` | number | — | no | Link status |
| `inverter.rfSignal` | number | — | no | RF signal strength |
| `inverter.serialNumber` | string | — | no | Serial number |
| `inverter.firmwareVersion` | number | — | no | Firmware version |
| `inverter.crcChecksum` | number | — | no | CRC checksum |
| `inverter.dtuPower` | number | W | no | DTU reported total power |
| `inverter.dtuDailyEnergy` | number | kWh | no | DTU reported daily energy |

### `hoymiles.0.info.*` — Device & Station Information

| State | Type | Description |
|-------|------|-------------|
| `info.connection` | boolean | Connected (local or cloud) |
| `info.dtuConnState` | number | DTU connection/error state |
| `info.cloudConnected` | boolean | Cloud API connected |
| `info.lastCloudUpdate` | string | Last cloud data timestamp |
| `info.lastResponse` | number | Last local response timestamp |
| `info.dtuSerial` | string | DTU serial number |
| `info.dtuSwVersion` | string | DTU software version |
| `info.dtuHwVersion` | string | DTU hardware version |
| `info.dtuRssi` | number | DTU signal strength (dBm) |
| `info.dtuStepTime` | number | DTU step time (s) |
| `info.dtuRfHwVersion` | number | DTU RF hardware version |
| `info.dtuRfSwVersion` | number | DTU RF software version |
| `info.accessModel` | number | Access model |
| `info.communicationTime` | number | Communication time (s) |
| `info.wifiVersion` | string | WiFi version |
| `info.dtu485Mode` | number | DTU 485 mode |
| `info.sub1gFrequencyBand` | number | Sub-1G frequency band |
| `info.inverterSerial` | string | Inverter serial number |
| `info.inverterSwVersion` | string | Inverter software version |
| `info.inverterHwVersion` | string | Inverter hardware version |
| `info.inverterModel` | string | Inverter model (e.g. HMS-800W-2T) |
| `info.stationName` | string | Station name (cloud) |
| `info.stationId` | number | Station ID (cloud) |
| `info.systemCapacity` | number | System capacity in kWp (cloud) |
| `info.address` | string | Station address (cloud) |
| `info.latitude` | number | GPS latitude (cloud) |
| `info.longitude` | number | GPS longitude (cloud) |
| `info.stationStatus` | number | Station status code (cloud) |
| `info.installedAt` | string | Installation date (cloud) |
| `info.timezone` | string | Timezone (cloud) |

### `hoymiles.0.alarms.*` — Alarms & Warnings

| State | Type | Description |
|-------|------|-------------|
| `alarms.count` | number | Number of active alarms |
| `alarms.lastCode` | number | Last alarm code |
| `alarms.lastMessage` | string | Last alarm description |
| `alarms.lastTime` | number | Last alarm timestamp |
| `alarms.json` | string | All alarms as JSON array |

### `hoymiles.0.config.*` — DTU Configuration (read-only, local only)

| State | Type | Description |
|-------|------|-------------|
| `config.serverDomain` | string | Cloud server domain |
| `config.serverPort` | number | Cloud server port |
| `config.serverSendTime` | number | Cloud upload interval (s) |
| `config.wifiSsid` | string | Connected WiFi network |
| `config.wifiRssi` | number | WiFi signal strength (dBm) |
| `config.zeroExportEnable` | boolean | Zero export enabled (**writable**) |
| `config.zeroExport433Addr` | number | Zero export 433MHz meter address |
| `config.meterKind` | string | Meter type |
| `config.meterInterface` | string | Meter interface |
| `config.dhcpSwitch` | number | DHCP enabled |
| `config.dtuApSsid` | string | DTU access point SSID |
| `config.netmodeSelect` | number | Network mode |
| `config.channelSelect` | number | Channel selection |
| `config.sub1gSweepSwitch` | number | Sub-1G sweep |
| `config.sub1gWorkChannel` | number | Sub-1G work channel |
| `config.invType` | number | Inverter type code |
| `config.ipAddress` | string | IP address |
| `config.subnetMask` | string | Subnet mask |
| `config.gateway` | string | Default gateway |
| `config.wifiIpAddress` | string | WiFi IP address |
| `config.macAddress` | string | MAC address |
| `config.wifiMacAddress` | string | WiFi MAC address |

### `hoymiles.0.meter.*` — Energy Meter (local only)

| State | Type | Unit | Description |
|-------|------|------|-------------|
| `meter.totalPower` | number | W | Total power |
| `meter.phaseAPower` | number | W | Phase A power |
| `meter.phaseBPower` | number | W | Phase B power |
| `meter.phaseCPower` | number | W | Phase C power |
| `meter.powerFactorTotal` | number | — | Power factor total |
| `meter.energyTotalExport` | number | kWh | Total energy export |
| `meter.energyTotalImport` | number | kWh | Total energy import |
| `meter.voltagePhaseA` | number | V | Voltage phase A |
| `meter.voltagePhaseB` | number | V | Voltage phase B |
| `meter.voltagePhaseC` | number | V | Voltage phase C |
| `meter.currentPhaseA` | number | A | Current phase A |
| `meter.currentPhaseB` | number | A | Current phase B |
| `meter.currentPhaseC` | number | A | Current phase C |
| `meter.faultCode` | number | — | Fault code |

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
