# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT

## Unterstützte Wechselrichter

Dieser Adapter ist für **Hoymiles HMS Mikrowechselrichter mit integriertem WiFi DTU** (DTUBI) konzipiert:

- **1T** (1 String): HMS-300W-1T, HMS-350W-1T, HMS-400W-1T, HMS-450W-1T, HMS-500W-1T
- **2T** (2 Strings): HMS-600W-2T, HMS-700W-2T, HMS-800W-2T (**Getestet**), HMS-900W-2T, HMS-1000W-2T
- **4T** (4 Strings, **nur DW-Variante**): HMS-1600DW-4T, HMS-1800DW-4T, HMS-2000DW-4T

> Dieser Adapter funktioniert **NICHT** mit: HMS-1600/1800/2000-4T ohne "DW", HM-Serie, MI-Serie, externen DTU-Sticks oder HMT-Dreiphasenmodellen.

## Konfiguration

Öffne die Adapter-Konfiguration in der ioBroker Admin-Oberfläche.

### Lokale Verbindung (TCP)

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| **Lokal aktivieren** | an | Direkte TCP/Protobuf-Verbindung aktivieren. Der Adapter hält eine persistente TCP-Verbindung mit Protobuf-Heartbeat. |
| **DTU Host** | (leer) | IP-Adresse oder Hostname des Wechselrichters. Leer lassen für automatische Suche beim Adapterstart. Die DTU-IP findest du auch in deiner Router-DHCP-Liste (Gerätename: DTUBI-*). |
| **Datenabfrage-Intervall** | 5s | Sekunden zwischen Datenanfragen (0-300). 0 = schnellstmöglich (~1s pro Zyklus). |
| **Config/Alarm Abfragefaktor** | 6 | Config und Alarme werden nur bei jedem X-ten Datenzyklus abgefragt. |
| **Cloud-Relay** | an | Echtzeitdaten im Namen der DTU an die Hoymiles Cloud weiterleiten. Ohne diese Option blockiert die lokale TCP-Verbindung den Cloud-Upload der DTU. |

### Cloud-Verbindung (S-Miles)

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| **Cloud aktivieren** | aus | Hoymiles S-Miles Cloud-API aktivieren |
| **S-Miles E-Mail** | — | E-Mail-Adresse des S-Miles Kontos |
| **S-Miles Passwort** | — | Passwort des S-Miles Kontos (verschlüsselt gespeichert) |
| **DTU Seriennummer** | (leer) | Bei mehreren Wechselrichtern im Account: DTU-Seriennummer eingeben um den richtigen zuzuordnen. Bei nur einem Wechselrichter leer lassen. |

Beide Verbindungen können gleichzeitig aktiv sein. Lokale Daten haben Vorrang — Cloud-Daten werden eingetragen wenn der DTU offline ist (z.B. nachts).
## Datenpunkte

### `hoymiles.0.grid.*` — Netzeinspeisung

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `grid.power` | number | W | Netzleistung |
| `grid.voltage` | number | V | Netzspannung |
| `grid.current` | number | A | Netzstrom |
| `grid.frequency` | number | Hz | Netzfrequenz |
| `grid.reactivePower` | number | var | Blindleistung |
| `grid.powerFactor` | number | — | Leistungsfaktor |
| `grid.dailyEnergy` | number | kWh | Tagesenergie |
| `grid.totalEnergy` | number | kWh | Gesamtenergie |
| `grid.monthEnergy` | number | kWh | Monatsenergie (Cloud) |
| `grid.yearEnergy` | number | kWh | Jahresenergie (Cloud) |
| `grid.co2Saved` | number | kg | CO2-Einsparung (Cloud) |
| `grid.treesPlanted` | number | — | Äquivalent gepflanzte Bäume (Cloud) |
| `grid.electricityPrice` | number | /kWh | Strompreis (Cloud) |
| `grid.currency` | string | — | Währungscode z.B. EUR, USD (Cloud) |
| `grid.todayIncome` | number | — | Tagesertrag (berechnet) |
| `grid.totalIncome` | number | — | Gesamtertrag (berechnet) |

### `hoymiles.0.pv0.*` / `hoymiles.0.pv1.*` — PV-Eingänge

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `pvX.power` | number | W | Panel-Leistung |
| `pvX.voltage` | number | V | Panel-Spannung |
| `pvX.current` | number | A | Panel-Strom |
| `pvX.dailyEnergy` | number | kWh | Tagesenergie |
| `pvX.totalEnergy` | number | kWh | Gesamtenergie |

### `hoymiles.0.inverter.*` — Wechselrichter-Status & Steuerung

| Datenpunkt | Typ | Einheit | Schreibbar | Beschreibung |
|------------|-----|---------|------------|--------------|
| `inverter.temperature` | number | °C | nein | Wechselrichter-Temperatur |
| `inverter.powerLimit` | number | % | nein | Aktuelles Leistungslimit |
| `inverter.powerLimitSet` | number | % | **ja** | Leistungslimit setzen (2-100%) |
| `inverter.active` | boolean | — | **ja** | Wechselrichter ein/aus |
| `inverter.reboot` | boolean | — | **ja** | Wechselrichter neustarten |
| `inverter.warnCount` | number | — | nein | Anzahl aktiver Warnungen |
| `inverter.linkStatus` | number | — | nein | Verbindungsstatus |
| `inverter.rfSignal` | number | — | nein | RF-Signalstärke |
| `inverter.serialNumber` | string | — | nein | Seriennummer |
| `inverter.firmwareVersion` | number | — | nein | Firmware-Version |
| `inverter.crcChecksum` | number | — | nein | CRC-Prüfsumme |
| `inverter.dtuPower` | number | W | nein | DTU gemeldete Gesamtleistung |
| `inverter.dtuDailyEnergy` | number | kWh | nein | DTU Tagesenergie |

### `hoymiles.0.info.*` — Geräte- & Anlageninformationen

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `info.connection` | boolean | Verbunden (lokal oder Cloud) |
| `info.dtuConnState` | number | DTU Verbindungs-/Fehlerstatus |
| `info.cloudConnected` | boolean | Cloud-API verbunden |
| `info.lastCloudUpdate` | string | Letztes Cloud-Update |
| `info.lastResponse` | number | Letzte lokale Antwort |
| `info.dtuSerial` | string | DTU Seriennummer |
| `info.dtuSwVersion` | string | DTU Software-Version |
| `info.dtuHwVersion` | string | DTU Hardware-Version |
| `info.dtuRssi` | number | DTU Signalstärke (dBm) |
| `info.dtuStepTime` | number | DTU Schrittzeit (s) |
| `info.dtuRfHwVersion` | number | DTU RF Hardware-Version |
| `info.dtuRfSwVersion` | number | DTU RF Software-Version |
| `info.accessModel` | number | Zugriffsmodell |
| `info.communicationTime` | number | Kommunikationszeit (s) |
| `info.wifiVersion` | string | WLAN-Version |
| `info.dtu485Mode` | number | DTU 485 Modus |
| `info.sub1gFrequencyBand` | number | Sub-1G Frequenzband |
| `info.inverterSerial` | string | Wechselrichter Seriennummer |
| `info.inverterSwVersion` | string | Wechselrichter Software-Version |
| `info.inverterHwVersion` | string | Wechselrichter Hardware-Version |
| `info.inverterModel` | string | Wechselrichter-Modell (z.B. HMS-800W-2T) |
| `info.stationName` | string | Anlagenname (Cloud) |
| `info.stationId` | number | Anlagen-ID (Cloud) |
| `info.systemCapacity` | number | Anlagenleistung in kWp (Cloud) |
| `info.address` | string | Anlagenstandort (Cloud) |
| `info.latitude` | number | GPS-Breitengrad (Cloud) |
| `info.longitude` | number | GPS-Längengrad (Cloud) |
| `info.stationStatus` | number | Anlagenstatus-Code (Cloud) |
| `info.installedAt` | string | Installationsdatum (Cloud) |
| `info.timezone` | string | Zeitzone (Cloud) |

### `hoymiles.0.alarms.*` — Alarme & Warnungen

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `alarms.count` | number | Anzahl aktiver Alarme |
| `alarms.lastCode` | number | Letzter Alarmcode |
| `alarms.lastMessage` | string | Letzte Alarmbeschreibung |
| `alarms.lastTime` | number | Letzter Alarm-Zeitstempel |
| `alarms.json` | string | Alle Alarme als JSON-Array |

### `hoymiles.0.config.*` — DTU-Konfiguration (nur lesen, nur lokal)

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `config.serverDomain` | string | Cloud-Server Domain |
| `config.serverPort` | number | Cloud-Server Port |
| `config.serverSendTime` | number | Cloud-Upload-Intervall (s) |
| `config.wifiSsid` | string | Verbundenes WLAN |
| `config.wifiRssi` | number | WLAN Signalstärke (dBm) |
| `config.zeroExportEnable` | boolean | Nulleinspeisung aktiviert (**schreibbar**) |
| `config.zeroExport433Addr` | number | Nulleinspeisung 433MHz Zähleradresse |
| `config.meterKind` | string | Zählertyp |
| `config.meterInterface` | string | Zähler-Schnittstelle |
| `config.dhcpSwitch` | number | DHCP aktiviert |
| `config.dtuApSsid` | string | DTU Access-Point SSID |
| `config.netmodeSelect` | number | Netzwerkmodus |
| `config.channelSelect` | number | Kanalauswahl |
| `config.sub1gSweepSwitch` | number | Sub-1G Sweep |
| `config.sub1gWorkChannel` | number | Sub-1G Arbeitskanal |
| `config.invType` | number | Wechselrichter-Typcode |
| `config.ipAddress` | string | IP-Adresse |
| `config.subnetMask` | string | Subnetzmaske |
| `config.gateway` | string | Standard-Gateway |
| `config.wifiIpAddress` | string | WLAN IP-Adresse |
| `config.macAddress` | string | MAC-Adresse |
| `config.wifiMacAddress` | string | WLAN MAC-Adresse |

### `hoymiles.0.meter.*` — Energiezähler (nur lokal)

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `meter.totalPower` | number | W | Gesamtleistung |
| `meter.phaseAPower` | number | W | Phase A Leistung |
| `meter.phaseBPower` | number | W | Phase B Leistung |
| `meter.phaseCPower` | number | W | Phase C Leistung |
| `meter.powerFactorTotal` | number | — | Leistungsfaktor gesamt |
| `meter.energyTotalExport` | number | kWh | Gesamtenergie Export |
| `meter.energyTotalImport` | number | kWh | Gesamtenergie Import |
| `meter.voltagePhaseA` | number | V | Spannung Phase A |
| `meter.voltagePhaseB` | number | V | Spannung Phase B |
| `meter.voltagePhaseC` | number | V | Spannung Phase C |
| `meter.currentPhaseA` | number | A | Strom Phase A |
| `meter.currentPhaseB` | number | A | Strom Phase B |
| `meter.currentPhaseC` | number | A | Strom Phase C |
| `meter.faultCode` | number | — | Fehlercode |

## Protokoll

### Lokal (TCP/Protobuf)

- **Transport:** TCP Port 10081
- **Kodierung:** Protocol Buffers (Protobuf)
- **Frame:** 10-Byte Header (`HM` Magic + Command-ID + CRC16 + Länge) + Protobuf-Payload, mit Sequenznummern (0-60000)
- **Authentifizierung:** Keine (nur lokales Netzwerk)
- **Verschlüsselung:** Optionales AES-128-CBC mit SHA-256 Schlüsselableitung (automatisch erkannt)
- **Heartbeat:** Protobuf-Heartbeat alle 20s für die persistente Verbindung
- **Reconnect:** 5 Minuten Idle-Timeout, automatische Wiederverbindung mit exponentiellem Backoff (1s-60s)

### Cloud (S-Miles API)

- **Base-URL:** `https://neapi.hoymiles.com`
- **Authentifizierung:** MD5+SHA256 Credential-Hash mit Nonce
- **Daten:** Stations-Echtzeit, Gerätebaum, Stationsdetails
- **Passwort:** Verschlüsselt in der ioBroker-Konfiguration gespeichert

### Danksagung

Protokoll-Reverse-Engineering durch die Community:
- [hoymiles-wifi](https://github.com/suaveolent/hoymiles-wifi) — Python-Bibliothek (primäre Referenz)
- [dtuGateway](https://github.com/ohAnd/dtuGateway) — ESP32-Gateway
- [Hoymiles-DTU-Proto](https://github.com/henkwiedig/Hoymiles-DTU-Proto) — Originale Protobuf-Definitionen

## Fehlerbehebung

### Adapter kann keine Verbindung herstellen
- Prüfe ob die DTU IP-Adresse korrekt ist (DHCP-Tabelle des Routers prüfen)
- Stelle sicher, dass keine andere Anwendung auf Port 10081 verbunden ist
- Wenn das dtuGateway ESP32 noch läuft, stoppe es zuerst

### Keine Daten nach Verbindung
- DTU-Firmware V01.01.00 und neuer kann die lokale Protobuf-Kommunikation brechen
- Aktualisiere die DTU-Firmware NICHT, wenn dir lokaler Zugang wichtig ist

### Cloud-Login fehlgeschlagen
- Prüfe E-Mail und Passwort des S-Miles Kontos
- Stelle sicher, dass du dich unter https://global.hoymiles.com/website/login einloggen kannst
