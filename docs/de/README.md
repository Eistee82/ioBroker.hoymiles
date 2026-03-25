# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT WiFi Mikrowechselrichter

## Unterstützte Wechselrichter

Dieser Adapter ist für **Hoymiles HMS Mikrowechselrichter mit integriertem WiFi DTU** (DTUBI) konzipiert:

- **1T** (1 String): HMS-300W-1T, HMS-350W-1T, HMS-400W-1T, HMS-450W-1T, HMS-500W-1T
- **2T** (2 Strings): HMS-600W-2T, HMS-700W-2T, HMS-800W-2T, HMS-900W-2T, HMS-1000W-2T
- **4T** (4 Strings, **nur DW-Variante**): HMS-1600DW-4T, HMS-1800DW-4T, HMS-2000DW-4T

> Dieser Adapter funktioniert **NICHT** mit: HMS-1600/1800/2000-4T ohne "DW", HM-Serie, MI-Serie, externen DTU-Sticks oder HMT-Dreiphasenmodellen.

## Konfiguration

Öffne die Adapter-Konfiguration in der ioBroker Admin-Oberfläche.

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| **DTU Host** | — | IP-Adresse oder Hostname des Wechselrichters (Pflicht) |
| **Abfrageintervall** | 30s | Zeitabstand zwischen Datenabfragen (10-300 Sekunden) |
| **Cloud-Pause** | aktiviert | Trennt periodisch die Verbindung für Cloud-Uploads |
| **Pause-Dauer** | 40s | Dauer der Pause (20-120 Sekunden) |

### Cloud-Pause

Die TCP-Verbindung zum DTU **blockiert den Hoymiles Cloud-Upload**. Solange der Adapter verbunden ist, kann der Wechselrichter keine Daten an die Hoymiles-Cloud (S-Miles App) senden.

Wenn du die Hoymiles-Cloud weiterhin nutzen möchtest, aktiviere die **Cloud-Pause**. Der Adapter trennt die Verbindung bei Minute 14:40, 29:40, 44:40 und 59:40 jeder Stunde für die konfigurierte Dauer, damit der DTU Daten in die Cloud hochladen kann.

Wenn du die Hoymiles-Cloud nicht brauchst, kannst du die Cloud-Pause deaktivieren für ununterbrochene lokale Überwachung.

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
| `inverter.dtuPower` | number | W | nein | DTU gemeldete Gesamtleistung |
| `inverter.dtuDailyEnergy` | number | kWh | nein | DTU Tagesenergie |

### `hoymiles.0.info.*` — Geräteinformationen

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `info.connection` | boolean | DTU verbunden |
| `info.dtuSerial` | string | DTU Seriennummer |
| `info.inverterSerial` | string | Wechselrichter Seriennummer |
| `info.dtuSwVersion` | string | DTU Software-Version |
| `info.dtuHwVersion` | string | DTU Hardware-Version |
| `info.inverterSwVersion` | string | Wechselrichter Software-Version |
| `info.inverterHwVersion` | string | Wechselrichter Hardware-Version |
| `info.dtuRssi` | number | DTU Signalstärke (dBm) |
| `info.cloudPaused` | boolean | Cloud-Pause gerade aktiv |

### `hoymiles.0.alarms.*` — Alarme & Warnungen

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `alarms.count` | number | Anzahl aktiver Alarme |
| `alarms.lastCode` | number | Letzter Alarmcode |
| `alarms.lastMessage` | string | Letzte Alarmbeschreibung |
| `alarms.lastTime` | number | Letzter Alarm-Zeitstempel |
| `alarms.json` | string | Alle Alarme als JSON-Array |

### `hoymiles.0.config.*` — DTU-Konfiguration (nur lesen)

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `config.serverDomain` | string | Cloud-Server Domain |
| `config.serverPort` | number | Cloud-Server Port |
| `config.serverSendTime` | number | Cloud-Upload-Intervall (s) |
| `config.wifiSsid` | string | Verbundenes WLAN |
| `config.wifiRssi` | number | WLAN Signalstärke (dBm) |
| `config.zeroExportEnable` | boolean | Nulleinspeisung aktiviert |

## Protokoll

Dieser Adapter kommuniziert direkt mit der Hoymiles DTU über ein binäres Protokoll:

- **Transport:** TCP Port 10081
- **Kodierung:** Protocol Buffers (Protobuf)
- **Frame:** 10-Byte Header (`HM` Magic + Command-ID + CRC16 + Länge) + Protobuf-Payload
- **Authentifizierung:** Keine (nur lokales Netzwerk)
- **Verschlüsselung:** Optionales AES-128-CBC (wird automatisch über DTU-Info-Antwort erkannt)

### Danksagung

Protokoll-Reverse-Engineering durch die Community:
- [hoymiles-wifi](https://github.com/suaveolent/hoymiles-wifi) — Python-Bibliothek (primäre Referenz)
- [dtuGateway](https://github.com/ohAnd/dtuGateway) — ESP32-Gateway
- [Hoymiles-DTU-Proto](https://github.com/henkwiedig/Hoymiles-DTU-Proto) — Originale Protobuf-Definitionen

## Fehlerbehebung

### Adapter kann keine Verbindung herstellen
- Prüfe ob die DTU IP-Adresse korrekt ist (DHCP-Tabelle des Routers prüfen)
- Stelle sicher, dass keine andere Anwendung auf Port 10081 verbunden ist (nur eine Verbindung gleichzeitig möglich)
- Wenn das dtuGateway ESP32 noch läuft, stoppe es zuerst

### Keine Daten nach Verbindung
- DTU-Firmware V01.01.00 und neuer kann die lokale Protobuf-Kommunikation brechen
- Aktualisiere die DTU-Firmware NICHT, wenn dir lokaler Zugang wichtig ist
- Prüfe das Adapter-Log auf Protobuf-Dekodierfehler

### Cloud funktioniert nicht
- Aktiviere die Cloud-Pause in den Adapter-Einstellungen
- Erhöhe die Pause-Dauer wenn Cloud-Daten unvollständig erscheinen (versuche 60s)
