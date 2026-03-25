# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT

## Supported Inverters

This adapter is designed for **Hoymiles HMS microinverters with integrated WiFi DTU** (DTUBI):

- **1T** (1 string): HMS-300W-1T, HMS-350W-1T, HMS-400W-1T, HMS-450W-1T, HMS-500W-1T
- **2T** (2 strings): HMS-600W-2T, HMS-700W-2T, HMS-800W-2T, HMS-900W-2T, HMS-1000W-2T
- **4T** (4 strings, **DW variant only**): HMS-1600DW-4T, HMS-1800DW-4T, HMS-2000DW-4T

> This adapter does **NOT** work with: HMS-1600/1800/2000-4T without "DW", HM series, MI series, external DTU sticks, or HMT three-phase models.

## Configuration

Open the adapter configuration in the ioBroker admin interface.

| Setting | Default | Description |
|---------|---------|-------------|
| **DTU Host** | — | IP address or hostname of the inverter (required) |
| **Poll Interval** | 30s | Data query interval (10-300 seconds) |
| **Cloud Pause** | enabled | Periodically disconnects for cloud uploads |
| **Pause Duration** | 40s | How long to pause (20-120 seconds) |

### Cloud Pause

The TCP connection to the DTU **blocks the Hoymiles cloud upload**. When the adapter is connected, the inverter cannot send data to the Hoymiles cloud (S-Miles app).

If you want to keep using the Hoymiles cloud, enable the **Cloud Pause**. The adapter will disconnect at minutes 14:40, 29:40, 44:40, and 59:40 of each hour for the configured pause duration, allowing the DTU to upload data to the cloud.

If you don't need the Hoymiles cloud, you can disable the cloud pause for uninterrupted local monitoring.

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
| `inverter.dtuPower` | number | W | no | DTU reported total power |
| `inverter.dtuDailyEnergy` | number | kWh | no | DTU reported daily energy |

### `hoymiles.0.info.*` — Device Information

| State | Type | Description |
|-------|------|-------------|
| `info.connection` | boolean | DTU connected |
| `info.dtuSerial` | string | DTU serial number |
| `info.inverterSerial` | string | Inverter serial number |
| `info.dtuSwVersion` | string | DTU software version |
| `info.dtuHwVersion` | string | DTU hardware version |
| `info.inverterSwVersion` | string | Inverter software version |
| `info.inverterHwVersion` | string | Inverter hardware version |
| `info.dtuRssi` | number | DTU signal strength (dBm) |
| `info.cloudPaused` | boolean | Cloud pause currently active |

### `hoymiles.0.alarms.*` — Alarms & Warnings

| State | Type | Description |
|-------|------|-------------|
| `alarms.count` | number | Number of active alarms |
| `alarms.lastCode` | number | Last alarm code |
| `alarms.lastMessage` | string | Last alarm description |
| `alarms.lastTime` | number | Last alarm timestamp |
| `alarms.json` | string | All alarms as JSON array |

### `hoymiles.0.config.*` — DTU Configuration (read-only)

| State | Type | Description |
|-------|------|-------------|
| `config.serverDomain` | string | Cloud server domain |
| `config.serverPort` | number | Cloud server port |
| `config.serverSendTime` | number | Cloud upload interval (s) |
| `config.wifiSsid` | string | Connected WiFi network |
| `config.wifiRssi` | number | WiFi signal strength (dBm) |
| `config.zeroExportEnable` | boolean | Zero export enabled |

## Protocol

This adapter communicates directly with the Hoymiles DTU using a binary protocol:

- **Transport:** TCP port 10081
- **Encoding:** Protocol Buffers (protobuf)
- **Frame:** 10-byte header (`HM` magic + command ID + CRC16 + length) + protobuf payload
- **Authentication:** None (local network only)
- **Encryption:** Optional AES-128-CBC (detected automatically via DTU info response)

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

### Cloud not working
- Enable the Cloud Pause in the adapter settings
- Increase the pause duration if cloud data appears incomplete (try 60s)
