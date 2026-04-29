![Logo](../../admin/hoymiles.png)

# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT

## Unterstützte Wechselrichter

Dieser Adapter ist für **Hoymiles HMS Mikrowechselrichter mit integriertem WiFi DTU** (DTUBI) konzipiert:

- **1T** (1 String): HMS-300W-1T, HMS-350W-1T, HMS-400W-1T, HMS-450W-1T, HMS-500W-1T
- **2T** (2 Strings): HMS-600W-2T, HMS-700W-2T, HMS-800W-2T (**Getestet**), HMS-900W-2T, HMS-1000W-2T (**Getestet Lokal**)
- **4T** (4 Strings, **nur DW-Variante**): HMS-1600DW-4T, HMS-1800DW-4T, HMS-2000DW-4T

> Dieser Adapter funktioniert **NICHT** mit: HMS-1600/1800/2000-4T ohne "DW", HM-Serie, MI-Serie, externen DTU-Sticks oder HMT-Dreiphasenmodellen.

## Konfiguration

Öffne die Adapter-Konfiguration in der ioBroker Admin-Oberfläche.

### Lokale Verbindung (TCP)

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| **Lokal aktivieren** | an | Direkte TCP/Protobuf-Verbindung aktivieren. Der Adapter hält eine persistente TCP-Verbindung mit Protobuf-Heartbeat. |
| **DTU-Geräte** | (leer) | Tabelle mit DTU IP-Adressen/Hostnamen. Pro DTU eine Zeile hinzufügen. |
| **Datenabfrage-Intervall** | 5s | Sekunden zwischen Datenanfragen (0-300). 0 = schnellstmöglich (~1s pro Zyklus). |
| **Config/Alarm Abfragefaktor** | 6 | Config und Alarme werden nur bei jedem X-ten Datenzyklus abgefragt. |
| **Cloud-Relay** | an | Echtzeitdaten im Namen der DTU an die Hoymiles Cloud weiterleiten. Ohne diese Option blockiert die lokale TCP-Verbindung den Cloud-Upload der DTU. |

### Cloud-Verbindung (S-Miles)

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| **Cloud aktivieren** | aus | Hoymiles S-Miles Cloud-API aktivieren |
| **S-Miles E-Mail** | — | E-Mail-Adresse des S-Miles Kontos |
| **S-Miles Passwort** | — | Passwort des S-Miles Kontos (verschlüsselt gespeichert) |

Alle Wechselrichter im Cloud-Account werden automatisch erkannt. Keine manuelle Seriennummer-Konfiguration nötig.

Beide Verbindungen können gleichzeitig aktiv sein. Lokale Daten haben Vorrang — Cloud-Daten werden eingetragen wenn die DTU offline ist (z.B. nachts).

## Verbindungsmodi

Der Adapter unterstützt verschiedene Verbindungsmodi je nach Konfiguration:

| | Nur Lokal | Lokal + Relay | Nur Cloud | Lokal + Cloud | Lokal + Relay + Cloud |
|---|---|---|---|---|---|
| **TCP-Polling** | ja | ja | — | ja | ja |
| **Reconnect** | Backoff 1–60s | Backoff 1–60s | — | Backoff 1–60s | Backoff 1–60s |
| **Cloud-Relay** | — | HB 60s, Daten alle `serverSendTime` | — | — | HB 60s, Daten alle `serverSendTime` |
| **Cloud beim Start** | — | — | Komplett-Fetch | Komplett-Fetch | Komplett-Fetch |
| **Cloud (WR online)** | — | — | Alle 5min | Alle `serverSendTime` | 30s nach Relay-Send |
| **Cloud (WR offline)** | — | — | Alle 5min | Nur Wetter + FW | Nur Wetter + FW |

### Automatischer Reconnect

Der Wechselrichter (DTU) ist nur erreichbar wenn er Strom produziert (Sonne scheint). Der Adapter verbindet sich automatisch mit exponentiellem Backoff (1s, 2s, 4s, ... max 60s). Bei erfolgreicher Verbindung wird der Backoff auf 1s zurückgesetzt.

### Nachtmodus

Wenn die lokale Verbindung abbricht (typischerweise bei Sonnenuntergang), wechselt der Adapter in den **Nachtmodus**:
- Das Cloud-Relay pausiert (sendet einmalig die letzten Daten, dann Trennung)
- Cloud-API reduziert sich auf Wetter-Updates und Firmware-Checks (keine Echtzeitdaten, da sich nichts ändert)
- Bei Wiederherstellung der lokalen Verbindung (Sonnenaufgang) verlässt der Adapter den Nachtmodus und nimmt den Normalbetrieb wieder auf

### State Quality

Der Adapter nutzt das ioBroker State-Quality-Attribut (`q`), um die Zuverlässigkeit und Herkunft der Datenwerte anzuzeigen:

| Quality | Wert | Bedeutung | Wann |
|---------|------|-----------|------|
| Gut | `0x00` (0) | Frische, lokale Daten | Normalbetrieb — Daten direkt von der DTU via TCP empfangen |
| Ersatzwert | `0x40` (64) | Cloud-Daten als Fallback | Wechselrichter-Daten von der Hoymiles Cloud-API statt lokal (Cloud-only Geräte) |
| Gerät nicht verbunden | `0x42` (66) | Veraltete Daten, Gerät offline | DTU-Verbindung verloren — Werte sind die letzten bekannten Messwerte vor dem Disconnect |

**Betroffene Datenpunkte:** `grid.*`, `pv*.*`, `inverter.temperature`, `inverter.active`, `inverter.warnCount`, `inverter.warnMessage`, `inverter.activePowerLimit`, `meter.*`

Info-States (`info.*`), Config-States (`config.*`) und Cloud-Stationsdaten werden **nicht** von Quality-Änderungen betroffen.

**Automatischer Reset:** Wenn die lokale DTU-Verbindung wiederhergestellt wird, setzt die nächste erfolgreiche Datenantwort alle betroffenen States automatisch auf Quality `0x00` (gut) zurück.

Das Quality-Attribut kann in Skripten und Visualisierungen genutzt werden, um zwischen aktuellen und veralteten Daten zu unterscheiden, z.B. durch Ausgrauen von Werten mit `q > 0`.

## Mehrere Wechselrichter

Dieser Adapter unterstützt mehrere Wechselrichter in einer einzigen Instanz:

- **Lokal:** Mehrere DTU IP-Adressen in der Gerätetabelle eintragen
- **Cloud:** Alle Wechselrichter und Stationen im Account werden automatisch erkannt

Jede DTU erstellt einen Geräteknoten mit der Seriennummer als ID:
```
hoymiles.0.4143A01CEDE4.grid.power
hoymiles.0.4143A01CEDE4.inverter.*
hoymiles.0.4143A01CEDE4.dtu.*
hoymiles.0.4143A01CEDE4.pv0.*
```

Cloud-Stationen erstellen aggregierte Geräteknoten:
```
hoymiles.0.station-12345.grid.power      ← Summe aller Wechselrichter
hoymiles.0.station-12345.grid.totalEnergy
hoymiles.0.station-12345.info.stationName
```

## Datenpunkte

### `<dtuSerial>.grid.*` — Netzeinspeisung (pro DTU)

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `grid.power` | number | W | Netzleistung |
| `grid.voltage` | number | V | Netzspannung |
| `grid.current` | number | A | Netzstrom |
| `grid.frequency` | number | Hz | Netzfrequenz |
| `grid.reactivePower` | number | var | Blindleistung |
| `grid.powerFactor` | number | — | Leistungsfaktor |
| `grid.dailyEnergy` | number | kWh | Tagesenergie |

### `<dtuSerial>.info.*` — Geräteinformation (pro DTU)

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `info.connected` | boolean | Gerät verbunden (lokal oder Cloud) |
| `info.lastResponse` | number | Letzte Antwortzeit (Unix-Timestamp, nur lokal) |

### `<dtuSerial>.pv0.*` / `pv1.*` / `pv2.*` / `pv3.*` — PV-Eingänge (pro DTU)

PV-Channels werden dynamisch basierend auf dem Wechselrichter-Modell erstellt (1T = 1 Channel, 2T = 2 Channels, 4T = 4 Channels).

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `pvX.power` | number | W | Panel-Leistung |
| `pvX.voltage` | number | V | Panel-Spannung |
| `pvX.current` | number | A | Panel-Strom |
| `pvX.dailyEnergy` | number | kWh | Tagesenergie (nur lokal) |
| `pvX.totalEnergy` | number | kWh | Gesamtenergie (nur lokal) |

### `<dtuSerial>.inverter.*` — Wechselrichter-Status & Steuerung (pro DTU)

| Datenpunkt | Typ | Einheit | Schreibbar | Beschreibung |
|------------|-----|---------|------------|--------------|
| `inverter.serialNumber` | string | — | nein | Seriennummer |
| `inverter.model` | string | — | nein | Modell (Cloud) |
| `inverter.hwVersion` | string | — | nein | Hardware-Version |
| `inverter.swVersion` | string | — | nein | Software-Version |
| `inverter.temperature` | number | °C | nein | Temperatur |
| `inverter.powerLimit` | number | % | **ja** | Leistungslimit (2-100%, lokal) |
| `inverter.activePowerLimit` | number | % | nein | Aktives Leistungslimit (live, lokal) |
| `inverter.active` | boolean | — | **ja** | Wechselrichter ein/aus (lokal) |
| `inverter.reboot` | boolean | — | **ja** | Wechselrichter neustarten (lokal) |
| `inverter.powerFactorLimit` | number | — | **ja** | Leistungsfaktor-Limit (-1 bis 1, lokal) |
| `inverter.reactivePowerLimit` | number | ° | **ja** | Blindleistungs-Limit (-50 bis 50, lokal) |
| `inverter.cleanWarnings` | boolean | — | **ja** | Warnungen löschen (lokal) |
| `inverter.cleanGroundingFault` | boolean | — | **ja** | Erdungsfehler löschen (lokal) |
| `inverter.lock` | boolean | — | **ja** | Wechselrichter sperren/entsperren (lokal) |
| `inverter.warnCount` | number | — | nein | Aktiver Warnungscode (lokal) |
| `inverter.warnMessage` | string | — | nein | Aktive Warnungsmeldung (lokal) |
| `inverter.linkStatus` | number | — | nein | Verbindungsstatus |

### `<dtuSerial>.dtu.*` — DTU-Information (pro DTU, nur lokal)

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `dtu.serialNumber` | string | — | DTU Seriennummer |
| `dtu.swVersion` | string | — | Software-Version |
| `dtu.hwVersion` | string | — | Hardware-Version |
| `dtu.rssi` | number | dBm | Signalstärke |
| `dtu.reboot` | boolean | — | DTU neustarten (**schreibbar**) |
| `dtu.wifiVersion` | string | — | WLAN-Version |
| `dtu.fwUpdateAvailable` | boolean | — | Firmware-Update verfügbar (1x täglich via Cloud geprüft) |
| `dtu.stepTime` | number | s | Schrittzeit |
| `dtu.rfHwVersion` | number | — | RF Hardware-Version |
| `dtu.rfSwVersion` | number | — | RF Software-Version |
| `dtu.accessModel` | number | — | Netzwerk-Zugangsart (0=GPRS, 1=WiFi, 2=Ethernet) |
| `dtu.communicationTime` | number | — | Letzte Kommunikation (Unix-Timestamp) |
| `dtu.connState` | number | — | DTU Fehlercode (0=OK) |
| `dtu.mode485` | number | — | RS485 Modus (0=Reflux/Auto, 1=Remote Control) |
| `dtu.sub1gFrequencyBand` | number | — | Sub-1G Frequenzband |
| `dtu.searchResult` | string | — | AutoSearch-Ergebnis (Wechselrichter-Seriennummern, JSON) |

### `station-<id>.grid.*` — Stations-Aggregate (Cloud)

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `grid.power` | number | W | Gesamtleistung der Station |
| `grid.dailyEnergy` | number | kWh | Tagesenergie |
| `grid.monthEnergy` | number | kWh | Monatsenergie |
| `grid.yearEnergy` | number | kWh | Jahresenergie |
| `grid.totalEnergy` | number | kWh | Gesamtenergie |
| `grid.co2Saved` | number | kg | CO2-Einsparung |
| `grid.treesPlanted` | number | — | Bäume-Äquivalent |
| `grid.electricityPrice` | number | /kWh | Strompreis |
| `grid.currency` | string | — | Währungscode |
| `grid.isBalance` | boolean | — | Nulleinspeisung aktiv |
| `grid.isReflux` | boolean | — | Rückspeisung aktiv |
| `grid.todayIncome` | number | — | Tagesertrag |
| `grid.totalIncome` | number | — | Gesamtertrag |

### `station-<id>.info.*` — Stationsinformation (Cloud)

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `info.stationName` | string | Anlagenname |
| `info.stationId` | number | Anlagen-ID |
| `info.systemCapacity` | number | Anlagenleistung (kWp) |
| `info.address` | string | Anlagenstandort |
| `info.latitude` | number | GPS-Breitengrad |
| `info.longitude` | number | GPS-Längengrad |
| `info.stationStatus` | number | Anlagenstatus |
| `info.installedAt` | number | Installationsdatum |
| `info.timezone` | string | Zeitzone |
| `info.lastCloudUpdate` | number | Letztes Cloud-Update |
| `info.lastDataTime` | number | Letzte DTU-Datenzeit |

### `station-<id>.weather.*` — Wetter am Standort (Cloud)

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `weather.icon` | string | — | Wetter-Icon-Code ([OpenWeatherMap](https://openweathermap.org/weather-conditions)) |
| `weather.description` | string | — | Wetterbeschreibung (z.B. "Klarer Himmel", "Regen", "Schnee") |
| `weather.temperature` | number | °C | Aktuelle Temperatur am Anlagenstandort |
| `weather.sunrise` | number | — | Sonnenaufgang (Unix-Timestamp ms) |
| `weather.sunset` | number | — | Sonnenuntergang (Unix-Timestamp ms) |

> **Wetter-Icon-Codes:** Die Codes folgen der [OpenWeatherMap-Konvention](https://openweathermap.org/weather-conditions). Um das Icon als Bild anzuzeigen: `https://openweathermap.org/img/wn/{icon}@2x.png`

### `<dtuSerial>.alarms.*` — Alarmdaten (pro DTU, lokal)

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `alarms.count` | number | Gesamtzahl Alarme |
| `alarms.activeCount` | number | Aktive (ungelöste) Alarme |
| `alarms.hasActive` | boolean | Hat aktive Alarme |
| `alarms.json` | string | Vollständige Alarmliste als JSON |
| `alarms.lastCode` | number | Letzter Alarm-Code |
| `alarms.lastStartTime` | number | Letzter Alarm Startzeit |
| `alarms.lastEndTime` | number | Letzter Alarm Endzeit |
| `alarms.lastMessage` | string | Letzte Alarmmeldung (Deutsch) |
| `alarms.lastData1` | number | Letzter Alarm Daten 1 (Rohwert Sensor) |
| `alarms.lastData2` | number | Letzter Alarm Daten 2 (Rohwert Sensor) |

### `<dtuSerial>.config.*` — DTU-Konfiguration (pro DTU, lokal)

| Datenpunkt | Typ | Einheit | Schreibbar | Beschreibung |
|------------|-----|---------|------------|--------------|
| `config.serverDomain` | string | — | nein | Cloud-Server Domain |
| `config.serverPort` | number | — | nein | Cloud-Server Port |
| `config.serverSendTime` | number | min | **ja** | Cloud-Sendeintervall (Minuten) |
| `config.wifiSsid` | string | — | nein | WLAN SSID |
| `config.wifiRssi` | number | dBm | nein | WLAN Signalstärke |
| `config.zeroExportEnable` | boolean | — | **ja** | Nulleinspeisung aktiviert |
| `config.zeroExport433Addr` | number | — | nein | Nulleinspeisung 433MHz-Sensoradresse |
| `config.meterKind` | string | — | nein | Zählertyp (0=Kein, 1=1-Phasen, 2=2-Phasen, 3=3-Phasen, 5=CT G3, 6=Meter 1S/1T G3, 7=Meter 2S/2T G3) |
| `config.meterInterface` | string | — | nein | Zähler-Schnittstelle |
| `config.invType` | number | — | nein | Wechselrichter-Typ |
| `config.netmodeSelect` | number | — | nein | Netzwerkmodus (0=GPRS, 1=WiFi, 2=Ethernet) |
| `config.netDhcpSwitch` | number | — | nein | DHCP aktiviert |
| `config.netIpAddress` | string | — | nein | Ethernet IP-Adresse |
| `config.netSubnetMask` | string | — | nein | Ethernet Subnetzmaske |
| `config.netGateway` | string | — | nein | Ethernet Gateway |
| `config.netMacAddress` | string | — | nein | Ethernet MAC-Adresse |
| `config.wifiIpAddress` | string | — | nein | WLAN IP-Adresse |
| `config.wifiMacAddress` | string | — | nein | WLAN MAC-Adresse |
| `config.dtuApSsid` | string | — | nein | DTU Access-Point SSID |
| `config.channelSelect` | number | — | nein | Kanalauswahl |
| `config.sub1gSweepSwitch` | number | — | nein | Sub-1G Sweep |
| `config.sub1gWorkChannel` | number | — | nein | Sub-1G Arbeitskanal |

### `<dtuSerial>.meter.*` — Energiezähler (pro DTU, lokal, dynamisch)

Meter-States werden automatisch erstellt wenn erstmals Zählerdaten von der DTU empfangen werden. Nur verfügbar wenn ein kompatibler Energiezähler angeschlossen ist.

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `meter.totalPower` | number | W | Gesamtleistung (alle Phasen) |
| `meter.phaseAPower` | number | W | Phase A Leistung |
| `meter.phaseBPower` | number | W | Phase B Leistung |
| `meter.phaseCPower` | number | W | Phase C Leistung |
| `meter.powerFactorTotal` | number | — | Leistungsfaktor gesamt |
| `meter.energyTotalExport` | number | kWh | Gesamtenergie Export (Einspeisung) |
| `meter.energyTotalImport` | number | kWh | Gesamtenergie Import (Verbrauch) |
| `meter.voltagePhaseA` | number | V | Spannung Phase A |
| `meter.voltagePhaseB` | number | V | Spannung Phase B |
| `meter.voltagePhaseC` | number | V | Spannung Phase C |
| `meter.currentPhaseA` | number | A | Strom Phase A |
| `meter.currentPhaseB` | number | A | Strom Phase B |
| `meter.currentPhaseC` | number | A | Strom Phase C |
| `meter.faultCode` | number | — | Zähler-Fehlercode |

### Adapter-Ebene

| Datenpunkt | Typ | Beschreibung |
|------------|-----|--------------|
| `info.connection` | boolean | Mindestens ein Gerät verbunden (lokal oder Cloud) |
| `info.cloudConnected` | boolean | Cloud-API verbunden |
| `info.cloudLastError` | string | Letzter permanenter Cloud-Anmeldefehler (leer bei OK). Nicht-leere Werte pausieren automatische Wiederholungsversuche bis die Zugangsdaten korrigiert sind. |

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
- Bei einem dauerhaften Authentifizierungsfehler (falsche Zugangsdaten, gesperrtes Konto) stoppt der Adapter den Wiederholungs-Loop, um weitere Kontosperren zu vermeiden. Der Fehler wird nach `info.cloudLastError` geschrieben und eine ioBroker-Alert-Notification (Scope `hoymiles`, Kategorie `cloudAuth`) ausgelöst. Korrigiere die Zugangsdaten und speichere die Konfiguration, um den State zu löschen und Wiederholungsversuche fortzusetzen.
