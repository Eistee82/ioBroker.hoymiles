![Logo](../../admin/hoymiles.png)

# ioBroker.hoymiles — Hoymiles HMS-xxxW-xT / HMS-xxx-xWB

## Unterstützte Wechselrichter

Dieser Adapter ist für **Hoymiles HMS Mikrowechselrichter mit integrierter WiFi- (oder WiFi+Bluetooth-) DTU** (DTUBI) konzipiert.

**Lokal** = direkte TCP/Protobuf-Verbindung auf Port 10081. **Cloud** = S-Miles Cloud API — automatische Erkennung, Echtzeitdaten (schneller Burst-Kanal ~1,5–3 s), Energie-Aggregate, Netzprofil, Wechselrichter ein/aus + Neustart.

| Modell | Strings | Lokal (TCP) | Cloud | Status |
|--------|:---:|:---:|:---:|--------|
| HMS-300W-1T | 1 | ✅ | ✅ | Ungetestet |
| HMS-350W-1T | 1 | ✅ | ✅ | Ungetestet |
| HMS-400W-1T | 1 | ✅ | ✅ | Ungetestet |
| HMS-450W-1T | 1 | ✅ | ✅ | Ungetestet |
| HMS-500W-1T | 1 | ✅ | ✅ | Ungetestet |
| HMS-600W-2T | 2 | ✅ | ✅ | Ungetestet |
| HMS-700W-2T | 2 | ✅ | ✅ | Ungetestet |
| HMS-800W-2T | 2 | ✅ | ✅ | **Getestet** (Lokal + Cloud) |
| HMS-900W-2T | 2 | ✅ | ✅ | Ungetestet |
| HMS-1000W-2T | 2 | ✅ | ✅ | **Getestet** (Lokal) |
| HMS-1600DW-4T | 4 | ✅ | ✅ | Ungetestet |
| HMS-1800DW-4T | 4 | ✅ | ✅ | Ungetestet |
| HMS-2000DW-4T | 4 | ✅ | ✅ | Ungetestet |
| HMS-600-2WB | 2 | ❌¹ | ✅ | Ungetestet |
| HMS-700-2WB | 2 | ❌¹ | ✅ | Ungetestet |
| HMS-800-2WB | 2 | ❌¹ | ✅ | **Getestet** (Cloud: Echtzeit-Burst, Netzprofil, ein/aus + Neustart) |
| HMS-900-2WB | 2 | ❌¹ | ✅ | Ungetestet |
| HMS-1000-2WB | 2 | ❌¹ | ✅ | Ungetestet |
| HMS-1600-4WB | 4 | ❌¹ | ✅ | Ungetestet |
| HMS-1800-4WB | 4 | ❌¹ | ✅ | Ungetestet |
| HMS-2000-4WB | 4 | ❌¹ | ✅ | Ungetestet |

¹ Die **WB-Serie** (vermarktet als **„HiFlow Pro"**) hat keinen lokalen TCP-Port — der einzige lokale Kanal ist Bluetooth LE, alle Daten gehen an die Hoymiles-Cloud. Diese Wechselrichter funktionieren ab Werk **cloud-only**; zusätzlich sind lokale Daten möglich, indem der Cloud-Upload auf den eingebauten Relay-Server des Adapters umgeleitet wird — siehe [Wechselrichter über ioBroker umleiten](#wechselrichter-über-iobroker-umleiten). Alle WB-Modelle nutzen dieselbe DTU-Plattform; getestet ist bisher nur die HMS-800-2WB.

**Cloud-only-Betrieb:** Jeder unterstützte Wechselrichter im S-Miles-Konto funktioniert auch ganz ohne lokale Verbindung — der Adapter erkennt ihn automatisch und liefert über die Cloud Echtzeitleistung (Burst-Kanal), Energie-Aggregate, das Netzprofil sowie die Befehle ein/aus + Neustart (`inverter.active` / `inverter.reboot`). Die übrigen Befehle (Leistungslimit, Sperren, Warnungen löschen, …) erfordern die lokale TCP-Verbindung.

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
| **Schnelle Echtzeitdaten (Cloud)** | ein | Für Wechselrichter **ohne** lokale Verbindung schnelle Sekunden-Leistungsdaten aus der Cloud abrufen (derselbe „Burst"-Kanal, den die Live-Ansicht der S-Miles-App nutzt). Aktualisiert `grid.power` und `pvN.power` etwa alle 1,5–3 s (servergesteuert) statt nur alle ~80 s. Betrifft nur reine Cloud-Geräte; lokal verbundene Wechselrichter behalten ihre direkten lokalen Echtzeitdaten. |

Alle Wechselrichter im Cloud-Account werden automatisch erkannt. Keine manuelle Seriennummer-Konfiguration nötig.

Beide Verbindungen können gleichzeitig aktiv sein. Lokale Daten haben Vorrang — Cloud-Daten werden eingetragen wenn die DTU offline ist (z.B. nachts).

#### Account-Typen — S-Miles Installer / Enduser / Home

Der Adapter akzeptiert Accounts aus allen drei offiziellen Hoymiles-Apps:

- **S-Miles Installer** (`com.hm.hemaiInstall1`)
- **S-Miles Enduser** (`com.hm.hemaiClient1`)
- **S-Miles Home** (`com.hm.balcony`)

Login ist ein einzelner v3-Flow plus anschließender Profil-Probe (`region_c → pre-insp → login → probe`):

- **pre-insp + login** entscheiden die Auth-Variante. Hoymiles hat 2026 alle Konten auf Argon2id (`v=3 + Salt`) vereinheitlicht — Installer-, Enduser- und Home-Konten nutzen heute dieselbe Argon2id-Challenge (Parameter aus der S-Miles-Home-Android-App: `t=3, m=32 MiB, p=1, hashLen=32, V13`). `v` ist damit kein Profil-Signal mehr. Die klassische `md5hex(password).sha256base64(password)`-Challenge bleibt als Fallback für Regionen, die noch `v=2` ausliefern.
- **probe** (`/pvm/.../select_by_page`) entscheidet anschließend, welche Daten-API der Server für dieses Konto freigibt:
  - probe akzeptiert → **installer**-Profil — das Konto funktioniert auf `global.hoymiles.com` und nutzt die volle `/pvm/...`-Web-API inkl. `latitude`/`longitude`/`address`/`local_time`/`status`/`warn_data` und Firmware-Versionsstrings.
  - probe abgelehnt (Server: *„can only be used for logging in to the S-Miles Home app"*) → **home**-Profil — vom Server auf `/pvmc/.../*_c` beschränkt. Diese Surface liefert die obigen Felder nicht, dafür aber Rückspeise-/Eigenverbrauchs-Energie und Strom-Tarif. Für die fehlenden Felder legt der Adapter **keine** States an — sie erscheinen nur, wenn die jeweilige Antwort den Wert tatsächlich enthält. `latitude` / `longitude` / `address` werden für Home-Konten zusätzlich über den `pvm-ext/station-ak/find`-Endpoint nachgeladen, den auch die S-Miles-Home-App selbst nutzt — damit funktioniert die Wetter-Abfrage.

> **Hinweis:** `dataeu.hoymiles.com:10081` ist der EU-Cloud-Relay-Server, an den DTUs ihre Daten pushen — **kein** User-Login-Server. Der Adapter regelt das Cloud-Relay automatisch (siehe *Cloud-Relay*).

#### Cloud-Login testen

Wenn unsicher: Knopf **Cloud-Login testen** neben dem Passwortfeld klicken. Er läuft die vier Phasen einmal mit den aktuellen Zugangsdaten durch (`region_c`, `pre-insp`, `login`, `probe`) und meldet `v` und Salt-Vorhandensein aus pre-insp, ob der Login einen Token produziert hat und welches Profil die Probe zuweist (`installer` / `home`). Das Ergebnis steht im Adapter-Log — gut für Forum-Bug-Reports. Der Test speichert keinen Token und ändert keinen Adapter-Zustand.

## Wechselrichter über ioBroker umleiten

Neuere Wechselrichter mit integrierter WiFi-DTU (z. B. **HMS-800-2WB**) öffnen keinen lokalen TCP-Port mehr — ihr einziger lokaler Kanal ist Bluetooth LE, und alle Daten gehen direkt in die Hoymiles-Cloud. Damit ioBroker die Echtzeitdaten trotzdem lokal mitlesen (und später steuern) kann, arbeitet der Adapter als **Relay-Server**: Du leitest den Cloud-Upload des Wechselrichters auf ioBroker um, und der Adapter reicht jedes Paket 1:1 an die echte Hoymiles-Cloud weiter, während er eine Kopie mitliest. Cloud-Portal und S-Miles-App funktionieren unverändert weiter.

Es gibt zwei unabhängige lokale Wege — wähle den, den deine Hardware unterstützt:

| Wechselrichter | Lokaler Kanal | Nutzung |
| --- | --- | --- |
| Ältere HMS-*-*T (offener TCP-Port 10081) | direktes TCP | **Lokale Verbindung (TCP)** oben |
| HMS-800-2WB & neuer (nur BLE, kein TCP) | Umleitung auf ioBroker | **dieser Abschnitt** |

### 1. Relay-Server im Adapter aktivieren

In den Adapter-Einstellungen (Tab Cloud) **Relay-Server aktivieren (Wechselrichter auf ioBroker umleiten)** einschalten und setzen:

- **Relay-Server-Port** — der TCP-Port, auf dem der Adapter lauscht (Standard `10081`). Genau diesen Port trägst du später im Wechselrichter ein.
- **Hoymiles-Zielserver** — der Regionalserver, an den der Relay weiterleitet. Muss die Region deines Accounts sein (z. B. `dataeu.hoymiles.com` für Europa), sonst bekommen Cloud/App keine Daten mehr.
- **Hoymiles-Zielserver-Port** — Standard `10081`.

Stelle sicher, dass der ioBroker-Host aus dem Netz des Wechselrichters erreichbar ist und der Port nicht durch eine Firewall blockiert wird.

### 2. Wechselrichter mit dem Web-Tool umleiten

Die Umleitung selbst läuft per Bluetooth über ein kleines Browser-Tool — keine App-Installation nötig:

**[Umleitungs-Tool öffnen →](https://eistee82.github.io/ioBroker.hoymiles/app/)** (oder den QR-Code aus den Adapter-Einstellungen mit dem Handy scannen)

> **Wichtig:** Das Tool nutzt **Web Bluetooth**, das nur in **Chrome / Edge unter Android oder am Desktop** funktioniert. **iOS / Safari wird nicht unterstützt** (Apple implementiert Web Bluetooth nicht). Nutze ein Android-Handy oder einen Laptop in Bluetooth-Reichweite des Wechselrichters.

Schritte im Tool:

1. **Verbinden** tippen und deinen Wechselrichter wählen (Name beginnt mit `RMI-…` / `HMS-…`).
2. Den **Bluetooth-PIN** des Wechselrichters eingeben (den du bei der Einrichtung in der S-Miles-App gesetzt hast; Werksstandard `123456`, falls nie geändert). Das Tool speichert ihn nicht.
3. Nach dem Pairing erscheinen die Live-Daten (AC-Leistung, Netzspannung/-frequenz, Temperatur, PV-Werte pro Strang).
4. Im Bereich **Server** die Option **Eigene Adresse** wählen und die **ioBroker-IP** sowie den **Relay-Server-Port** aus Schritt 1 eintragen. Speichern.
5. Der Wechselrichter lädt jetzt zu ioBroker hoch. Innerhalb weniger Minuten füllt der Adapter die `<dtuSerial>.*`-Datenpunkte.

### 3. Werks-Server wiederherstellen

Das Tool merkt sich beim ersten Verbinden den ursprünglichen Hoymiles-Server jedes Wechselrichters (pro Seriennummer). Zum Rückgängigmachen der Umleitung das Tool öffnen, verbinden und in der Server-Liste den mit **„Geräte-Standard"** markierten Eintrag wählen (oder den passenden Regionalserver), dann speichern.

Das Web-Tool funktioniert außerdem eigenständig als **lokaler Live-Daten-Viewer** für jeden unterstützten Wechselrichter, ganz ohne Umleitung.

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
| Gerät nicht verbunden | `0x42` (66) | Veraltete Daten, Gerät offline | DTU-Verbindung verloren — Werte sind die letzten bekannten Messwerte vor dem Disconnect. Wird auch bei Cloud-Station-`grid.*` gesetzt, wenn der letzte Cloud-Upload der Station älter als ~20 min ist (DTU sendet nicht). |

**Betroffene Datenpunkte:** `grid.*`, `pv*.*`, `inverter.temperature`, `inverter.active`, `inverter.warnCount`, `inverter.warnMessage`, `inverter.activePowerLimit`, `meter.*` — sowie die Cloud-Station-Messwerte `station-<id>.grid.*` (mit `0x42` markiert, solange die Station offline/veraltet ist).

Info-States (`info.*`), Config-States (`config.*`) und statische Cloud-Stationsdaten (Name, Adresse, Koordinaten, Warn-Flags) werden **nicht** von Quality-Änderungen betroffen.

**Automatischer Reset:** Wenn die lokale DTU-Verbindung wiederhergestellt wird, setzt die nächste erfolgreiche Datenantwort alle betroffenen States automatisch auf Quality `0x00` (gut) zurück. Ebenso: sobald eine Cloud-Station wieder Daten sendet, geht die `grid.*`-Quality auf `0x00` zurück und der Adapter führt sofort einen vollständigen Refresh durch (Details, Geräte, Firmware, Warnungen), bevor er zum normalen Poll-Zyklus zurückkehrt.

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
| `pvX.errorCode` | number | | Fehlercode pro Strang, 0 im Normalbetrieb (nur lokal) |

### `<dtuSerial>.inverter.*` — Wechselrichter-Status & Steuerung (pro DTU)

| Datenpunkt | Typ | Einheit | Schreibbar | Beschreibung |
|------------|-----|---------|------------|--------------|
| `inverter.serialNumber` | string | — | nein | Seriennummer |
| `inverter.model` | string | — | nein | Modell (Cloud) |
| `inverter.hwVersion` | string | — | nein | Hardware-Version |
| `inverter.swVersion` | string | — | nein | Software-Version |
| `inverter.temperature` | number | °C | nein | Temperatur |
| `inverter.powerLimit` | number | % | **ja** | **Laufzeit**-Leistungslimit (RAM-only, **kein Flash-/NVM-Verschleiß — sekündliches Schreiben unbedenklich**). **Mit diesem Datenpunkt lässt sich eine Nulleinspeisung realisieren** / dynamische Drosselung. 2-100%, lokal |
| `inverter.activePowerLimit` | number | % | nein | Aktives Leistungslimit (live, lokal) |
| `inverter.active` | boolean | — | **ja** | Wechselrichter ein/aus (lokal; bei reinen Cloud-Geräten über die Cloud) |
| `inverter.reboot` | boolean | — | **ja** | Wechselrichter neustarten (lokal; bei reinen Cloud-Geräten über die Cloud) |
| `inverter.powerFactorLimit` | number | — | **ja** | Leistungsfaktor-Limit (-1 bis 1, lokal) |
| `inverter.reactivePowerLimit` | number | ° | **ja** | Blindleistungs-Limit (-50 bis 50, lokal) |
| `inverter.cleanWarnings` | boolean | — | **ja** | Warnungen löschen (lokal) |
| `inverter.cleanGroundingFault` | boolean | — | **ja** | Erdungsfehler löschen (lokal) |
| `inverter.lock` | boolean | — | **ja** | Wechselrichter sperren/entsperren (lokal) |
| `inverter.warnCount` | number | — | nein | SGSMO-Feld `warning_number`, Rohwert (lokal) — kein dokumentierter Warn-Code |
| `inverter.warnMessage` | string | — | nein | Aktive Warnungsmeldung aus der WCode-Alarmliste (lokal) |
| `inverter.linkStatus` | number | — | nein | Verbindungsstatus |
| `inverter.modulationIndexSignal` | number | — | nein | SGSMO #20, roher gepackter Wert (Modulationsindex + Signal; genaue Dekodierung noch unbestätigt, lokal) |

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
| `dtu.accessModel` | number | — | Netzwerk-Zugangsart (0=GPRS, 1=WiFi, 2=Ethernet) |
| `dtu.communicationTime` | number | — | Letzte Kommunikation (Unix-Timestamp) |
| `dtu.connState` | number | — | DTU Fehlercode (0=OK) |
| `dtu.searchResult` | string | — | AutoSearch-Ergebnis (Wechselrichter-Seriennummern, JSON) |

### `station-<id>.grid.*` — Stations-Aggregate (Cloud)

| Datenpunkt | Typ | Einheit | Beschreibung |
|------------|-----|---------|--------------|
| `grid.power` | number | W | Gesamtleistung der Station (live in ~1,5–3 s über den Burst-Kanal, sonst ~80 s) |
| `grid.gridPower` | number | W | Netzaustauschleistung (Echtzeit, +Bezug/−Einspeisung) — nur bei Anlagen mit Zähler ≠ 0 |
| `grid.loadPower` | number | W | Last-/Verbrauchsleistung (Echtzeit) |
| `grid.batteryPower` | number | W | Batterieleistung (Echtzeit, +Laden/−Entladen) — nur bei Batteriesystemen |
| `grid.pvUtilization` | number | % | PV-Auslastung (Echtzeit) |
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

### `station-<id>.warn.*` — Anlagen-Warnungen (Cloud)

Netz- und Zähler-Warnflags aus dem Cloud-Datensatz `station/find`. Alle boolesch — `true` bedeutet, die Bedingung ist gerade aktiv. Bei Installer-Konten kommen die Flags aus `station/find`; bei S-Miles-Home-Konten (wo `find_c` sie auslässt) fällt der Adapter auf die `realtime_c`-Antwort zurück. Dieser Fallback-Block trägt sechs der Flags — aber **nicht** `warn.powerLimited`, das es nur im Installer-Datensatz `station/find` gibt — daher bleibt `warn.powerLimited` bei Home-Konten auch bei aktiver Drosselung `false`. Die States erscheinen erst, sobald die Cloud aus einer der beiden Quellen einen `warn_data`-Block liefert.

| State | Typ | Beschreibung |
|-------|-----|--------------|
| `warn.stationOffline` | boolean | Anlage offline / Netzspannung weg. Wird gegen die Daten-Frische gegengeprüft: eine Anlage, die noch aktuelle Daten hochlädt, wird nie als offline gemeldet — auch wenn die Cloud kurzzeitig `s_uoff` setzt (z.B. während das Cloud-Relay beim Adapter-Start die DTU-Verbindung übernimmt) |
| `warn.gridUnstable` | boolean | Netzspannung instabil |
| `warn.gridFault` | boolean | Netzfehler / Netz-Anomalie |
| `warn.deviceAlarm` | boolean | Wechselrichter-Alarm — ein Wechselrichter hat eine aktive Störung (z. B. „PVx kein Eingang", wenn ein DC-Strang gezogen wird). Dieselbe Bedingung erscheint lokal und schneller unter `alarms.lastCode`/`alarms.lastMessage` |
| `warn.deviceIdWarning` | boolean | Geräte-ID-Warnung (ID-Konflikt / Diebstahlschutz) |
| `warn.meterFault` | boolean | Zählerfehler / Zähler-Warnung |
| `warn.powerLimited` | boolean | Leistungsreduktion aktiv (Drosselung / Leistungslimit). **Nur Installer-Konten** — bei Home-Konten nicht geliefert |

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
| `alarms.lastMessage` | string | Letzte Alarmmeldung (in der ioBroker-Systemsprache, sonst Englisch) |
| `alarms.lastData1` | number | Letzter Alarm Daten 1 (Rohwert Sensor) |
| `alarms.lastData2` | number | Letzter Alarm Daten 2 (Rohwert Sensor) |

### `<dtuSerial>.config.*` — DTU-Konfiguration (pro DTU, lokal)

> ⚠️ **WARNUNG — `config.*`-Datenpunkte (besonders `config.limitPowerMyPower`) NIEMALS häufig oder in einer automatisierten Schleife schreiben.** Jeder Schreibvorgang programmiert den **internen Flash der integrierten DTU** (das WiFi-Modul im HMS-xT). Flash hat eine begrenzte Lebensdauer (≈ einige zehntausend Zyklen); wiederholtes hochfrequentes Schreiben — z. B. eine sekündliche Nulleinspeisungs-Schleife — nutzt ihn ab und kann das **Gerät dauerhaft zerstören (bricken)**. Diese Datenpunkte nur für gelegentliche, dauerhafte Einstellungen verwenden.
> **Für dynamische / häufige Leistungsbegrenzung (Nulleinspeisung) stattdessen `inverter.powerLimit` nutzen** — ein Laufzeit-Befehl im RAM, **ohne Flash-Schreibvorgang und ohne Verschleiß**, sekündliches Schreiben unbedenklich.

| Datenpunkt | Typ | Einheit | Schreibbar | Beschreibung |
|------------|-----|---------|------------|--------------|
| `config.serverDomain` | string | — | nein | Cloud-Server Domain |
| `config.serverPort` | number | — | nein | Cloud-Server Port |
| `config.serverSendTime` | number | min | **ja** | Cloud-Sendeintervall (Minuten). ⚠️ Persistent (DTU-Flash) — nicht häufig schreiben, siehe Warnung oben |
| `config.limitPowerMyPower` | number | % | **ja** | **Persistentes** Leistungslimit (im DTU-Flash gespeichert, übersteht Neustart; 2-100%, lokal). ⚠️ **Nur für dauerhafte Begrenzung — niemals in einer Schleife schreiben (nutzt DTU-Flash ab). Für dynamische Nulleinspeisung `inverter.powerLimit` nutzen** (siehe Warnung oben) |
| `config.wifiSsid` | string | — | nein | WLAN SSID |
| `config.wifiRssi` | number | dBm | nein | WLAN Signalstärke (echtes dBm, z.B. −65) |
| `config.invType` | number | — | nein | Wechselrichter-Typ |
| `config.netmodeSelect` | number | — | nein | Netzwerkmodus (0=GPRS, 1=WiFi, 2=Ethernet) |
| `config.netDhcpSwitch` | number | — | nein | DHCP aktiviert |
| `config.wifiIpAddress` | string | — | nein | WLAN IP-Adresse |
| `config.wifiMacAddress` | string | — | nein | WLAN MAC-Adresse |
| `config.dtuApSsid` | string | — | nein | DTU Access-Point SSID |

### `<dtuSerial>.gridProfile.*` — Netzprofil (pro DTU, lokal — bei reinen Cloud-Geräten über die Cloud gelesen)

Das Netz-Anschlussprofil des Wechselrichters (Netz-/Sicherheitsparameter), lokal über DevConfigFetch gelesen. Alle nur lesbar. Spannungs-/Frequenzwerte richten sich nach der aktiven Netznorm (z. B. `DE_VDE4105_2018`). Funktions-Flags sind boolesch (`true` = Funktion aktiv).

| State | Typ | Einheit | Schreibbar | Beschreibung |
|-------|-----|---------|------------|--------------|
| `gridProfile.standard` | string | — | nein | Netznorm-Name (z. B. DE_VDE4105_2018) |
| `gridProfile.countryStdCode` | number | — | nein | Ländernorm-Code |
| `gridProfile.version` | number | — | nein | Netzprofil-Version |
| `gridProfile.nominalVoltage` | number | V | nein | Nennspannung |
| `gridProfile.lowVoltage1` | number | V | nein | Unterspannung 1 (LV1) |
| `gridProfile.lowVoltage1TripTime` | number | s | nein | LV1 max. Auslösezeit |
| `gridProfile.highVoltage1` | number | V | nein | Überspannung 1 (HV1) |
| `gridProfile.highVoltage1TripTime` | number | s | nein | HV1 max. Auslösezeit |
| `gridProfile.lowVoltage2` | number | V | nein | Unterspannung 2 (LV2) |
| `gridProfile.lowVoltage2TripTime` | number | s | nein | LV2 max. Auslösezeit |
| `gridProfile.avgHighVoltage10min` | number | V | nein | 10-Min-Mittel Überspannung |
| `gridProfile.nominalFrequency` | number | Hz | nein | Nennfrequenz |
| `gridProfile.lowFrequency1` | number | Hz | nein | Unterfrequenz 1 (LF1) |
| `gridProfile.lowFrequency1TripTime` | number | s | nein | LF1 max. Auslösezeit |
| `gridProfile.highFrequency1` | number | Hz | nein | Überfrequenz 1 (HF1) |
| `gridProfile.highFrequency1TripTime` | number | s | nein | HF1 max. Auslösezeit |
| `gridProfile.islandingDetection` | boolean | — | nein | Inselerkennung aktiv |
| `gridProfile.reconnectTime` | number | s | nein | Wiederzuschaltzeit |
| `gridProfile.reconnectHighVoltage` | number | V | nein | Wiederzuschalt-Überspannung |
| `gridProfile.reconnectLowVoltage` | number | V | nein | Wiederzuschalt-Unterspannung |
| `gridProfile.reconnectHighFrequency` | number | Hz | nein | Wiederzuschalt-Überfrequenz |
| `gridProfile.reconnectLowFrequency` | number | Hz | nein | Wiederzuschalt-Unterfrequenz |
| `gridProfile.rampUpRateNormal` | number | %/s | nein | Normale Hochlaufrate |
| `gridProfile.rampUpRateSoftStart` | number | %/s | nein | Soft-Start-Hochlaufrate |
| `gridProfile.freqWattActive` | boolean | — | nein | Frequenz-Watt aktiv |
| `gridProfile.freqWattStart` | number | Hz | nein | Frequenz-Watt Start (Fstart) |
| `gridProfile.freqWattDroopSlope` | number | %Pn/Hz | nein | Frequenz-Watt Droop-Steigung |
| `gridProfile.recoveryRampRate` | number | %Pn/s | nein | Wiederanlauf-Rampe |
| `gridProfile.recoveryHighFrequency` | number | Hz | nein | Wiederanlauf-Überfrequenz |
| `gridProfile.recoveryLowFrequency` | number | Hz | nein | Wiederanlauf-Unterfrequenz |
| `gridProfile.activePowerControlActive` | boolean | — | nein | Wirkleistungssteuerung aktiv |
| `gridProfile.powerRampRate` | number | %Pn/s | nein | Leistungs-Rampe |
| `gridProfile.voltVarActive` | boolean | — | nein | Volt-Var aktiv |
| `gridProfile.voltVarV1` | number | V | nein | Volt-Var Sollwert V1 |
| `gridProfile.voltVarQ1` | number | %Pn | nein | Volt-Var Sollwert Q1 |
| `gridProfile.voltVarV2` | number | V | nein | Volt-Var Sollwert V2 |
| `gridProfile.voltVarV3` | number | V | nein | Volt-Var Sollwert V3 |
| `gridProfile.voltVarV4` | number | V | nein | Volt-Var Sollwert V4 |
| `gridProfile.voltVarQ4` | number | %Pn | nein | Volt-Var Sollwert Q4 |
| `gridProfile.specifiedPowerFactorActive` | boolean | — | nein | Fester Leistungsfaktor aktiv |
| `gridProfile.powerFactor` | number | — | nein | Leistungsfaktor (cos φ) |
| `gridProfile.wattPowerFactorActive` | boolean | — | nein | Watt-Leistungsfaktor aktiv |
| `gridProfile.wattPowerFactorStart` | number | %Pn | nein | Watt-PF Startleistung |
| `gridProfile.powerFactorAtRatedPower` | number | — | nein | Leistungsfaktor bei Nennleistung |
| `gridProfile.reactivePowerControlActive` | boolean | — | nein | Blindleistungssteuerung aktiv |
| `gridProfile.reactivePower` | number | %Sn | nein | Blindleistung (VAR) |

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

### Einen Fehler melden

Damit aus „geht nicht" etwas Behebbares wird, erzeugt der Adapter ein gezieltes, **anonymisiertes** Diagnose-Log:

1. Öffne im ioBroker-Admin die Instanz-Einstellungen des Adapters und setze das **Log-Level** auf `debug`.
2. Starte die Instanz neu und lass sie ein paar Minuten laufen (ein bis zwei Cloud-Poll-Zyklen).
3. Exportiere das Log und filtere die Zeilen mit der Markierung `[diag]` heraus.

Die `[diag]`-Zeilen enthalten die rohen Cloud-API-Antworten (Login-Ablauf, Anlagenliste/-details, Gerätebaum, Echtzeit, Firmware) sowie die Entscheidungs-Ergebnisse des Adapters. DTU-/Wechselrichter-Seriennummern und die Konto-E-Mail werden durch stabile Hash-Tokens ersetzt, GPS-Koordinaten / Adresse / Anlagenname werden geschwärzt — die `[diag]`-Zeilen sind also gefahrlos in einem öffentlichen Forum-Bugreport postbar. (Andere, nicht mit `[diag]` markierte Debug-Zeilen können weiterhin die echte Seriennummer enthalten — schick daher gezielt die `[diag]`-Zeilen.)
