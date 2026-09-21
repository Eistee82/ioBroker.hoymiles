import { DeviceManagement } from "@iobroker/dm-utils";
import { MAX_PV_PORTS } from "./deviceContext.js";
import { ACK_ICON, ACK_GROUND_ICON, inverterIcon, METER_ICON, STATION_ICON } from "./deviceIcons.js";
import { states as DTU_STATES, stationStates as STATION_STATES } from "./stateDefinitions.js";
const STATE_BY_ID = new Map([...DTU_STATES, ...STATION_STATES].map(d => [d.id, d]));
const ACTION_ICON_STYLE = { "& img": { width: 22, height: 22 } };
const RSSI_PERCENT_TEXT = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [i, `${i} %`]));
const HEADER_STYLE = {
    backgroundColor: "transparent",
    fontWeight: 600,
    fontSize: "0.75rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: 0.7,
    marginTop: 14,
    marginBottom: 2,
};
const FIRST_HEADER_STYLE = {
    ...HEADER_STYLE,
    marginTop: 0,
    minWidth: "min(552px, 80vw)",
};
const DIVIDER_STYLE = { marginTop: 12, opacity: 0.4 };
export const REQUIRED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"];
export const DM_I18N = {
    shellyMeter: {
        en: "Energy meter",
        de: "Energiezähler",
        ru: "Счётчик энергии",
        pt: "Contador de energia",
        nl: "Energiemeter",
        fr: "Compteur d'énergie",
        it: "Contatore di energia",
        es: "Contador de energía",
        pl: "Licznik energii",
        uk: "Лічильник енергії",
        "zh-cn": "电能表",
    },
    shellyMeterTitle: {
        en: "Connect an energy meter",
        de: "Energiezähler verbinden",
        ru: "Подключить счётчик энергии",
        pt: "Ligar um contador de energia",
        nl: "Energiemeter verbinden",
        fr: "Connecter un compteur d'énergie",
        it: "Collegare un contatore di energia",
        es: "Conectar un contador de energía",
        pl: "Podłącz licznik energii",
        uk: "Підключити лічильник енергії",
        "zh-cn": "连接电能表",
    },
    shellyMac: {
        en: "Meter MAC address",
        de: "MAC-Adresse des Zählers",
        ru: "MAC-адрес счётчика",
        pt: "Endereço MAC do contador",
        nl: "MAC-adres van de meter",
        fr: "Adresse MAC du compteur",
        it: "Indirizzo MAC del contatore",
        es: "Dirección MAC del contador",
        pl: "Adres MAC licznika",
        uk: "MAC-адреса лічильника",
        "zh-cn": "电能表 MAC 地址",
    },
    shellyMacHelp: {
        en: "The meter is identified by its MAC address, not by its name. The inverter must already have found it on the network.",
        de: "Der Zähler wird über seine MAC-Adresse angesprochen, nicht über seinen Namen. Der Wechselrichter muss ihn im Netzwerk bereits gefunden haben.",
        ru: "Счётчик определяется по MAC-адресу, а не по имени. Инвертор должен уже найти его в сети.",
        pt: "O contador é identificado pelo endereço MAC, não pelo nome. O inversor já o deve ter encontrado na rede.",
        nl: "De meter wordt via zijn MAC-adres aangesproken, niet via zijn naam. De omvormer moet hem al op het netwerk hebben gevonden.",
        fr: "Le compteur est identifié par son adresse MAC, pas par son nom. L'onduleur doit déjà l'avoir trouvé sur le réseau.",
        it: "Il contatore è identificato dall'indirizzo MAC, non dal nome. L'inverter deve averlo già trovato in rete.",
        es: "El contador se identifica por su dirección MAC, no por su nombre. El inversor ya debe haberlo encontrado en la red.",
        pl: "Licznik jest identyfikowany po adresie MAC, a nie po nazwie. Falownik musi go już znaleźć w sieci.",
        uk: "Лічильник визначається за MAC-адресою, а не за іменем. Інвертор має вже знайти його в мережі.",
        "zh-cn": "电能表通过 MAC 地址识别，而非名称。逆变器必须已在网络中找到它。",
    },
    shellyNoneFound: {
        en: "The inverter has not found a meter yet. Make sure the meter is on the same network and announces itself, then try again in a few minutes.",
        de: "Der Wechselrichter hat noch keinen Zähler gefunden. Stelle sicher, dass der Zähler im selben Netzwerk ist und sich ankündigt, und versuche es in ein paar Minuten erneut.",
        ru: "Инвертор ещё не нашёл счётчик. Убедитесь, что счётчик в той же сети и объявляет себя, и повторите через несколько минут.",
        pt: "O inversor ainda não encontrou nenhum contador. Verifique se o contador está na mesma rede e se se anuncia, e tente novamente dentro de alguns minutos.",
        nl: "De omvormer heeft nog geen meter gevonden. Zorg dat de meter in hetzelfde netwerk zit en zichzelf aankondigt, en probeer het over een paar minuten opnieuw.",
        fr: "L'onduleur n'a pas encore trouvé de compteur. Vérifiez que le compteur est sur le même réseau et qu'il s'annonce, puis réessayez dans quelques minutes.",
        it: "L'inverter non ha ancora trovato alcun contatore. Verifica che il contatore sia sulla stessa rete e che si annunci, poi riprova tra qualche minuto.",
        es: "El inversor aún no ha encontrado ningún contador. Comprueba que el contador esté en la misma red y que se anuncie, e inténtalo de nuevo en unos minutos.",
        pl: "Falownik nie znalazł jeszcze licznika. Upewnij się, że licznik jest w tej samej sieci i się rozgłasza, i spróbuj ponownie za kilka minut.",
        uk: "Інвертор ще не знайшов лічильник. Переконайтеся, що лічильник у тій самій мережі та оголошує себе, і спробуйте за кілька хвилин.",
        "zh-cn": "逆变器尚未找到电能表。请确认电能表在同一网络中并已广播，几分钟后再试。",
    },
    shellyMode: {
        en: "Mode",
        de: "Betriebsart",
        ru: "Режим",
        pt: "Modo",
        nl: "Modus",
        fr: "Mode",
        it: "Modalità",
        es: "Modo",
        pl: "Tryb",
        uk: "Режим",
        "zh-cn": "模式",
    },
    shellyModeHelp: {
        en: "Meter only reads values. Zero export additionally lets the inverter throttle itself so no power is fed into the grid.",
        de: "Nur Zähler liest lediglich Werte. Nulleinspeisung lässt den Wechselrichter zusätzlich selbst herunterregeln, damit nichts ins Netz fließt.",
        ru: "«Только счётчик» лишь считывает значения. «Нулевая отдача» дополнительно позволяет инвертору снижать мощность, чтобы ничего не уходило в сеть.",
        pt: "Apenas contador limita-se a ler valores. Injeção zero permite ainda que o inversor se reduza para não injetar na rede.",
        nl: "Alleen meter leest enkel waarden. Nul-teruglevering laat de omvormer zichzelf bovendien terugregelen zodat er niets het net in gaat.",
        fr: "Compteur seul se contente de lire les valeurs. Injection zéro permet en plus à l'onduleur de se brider pour ne rien injecter sur le réseau.",
        it: "Solo contatore si limita a leggere i valori. Immissione zero consente inoltre all'inverter di ridursi da solo per non immettere in rete.",
        es: "Solo contador únicamente lee valores. Inyección cero permite además que el inversor se reduzca para no verter a la red.",
        pl: "Tylko licznik jedynie odczytuje wartości. Zerowy eksport dodatkowo pozwala falownikowi ograniczać moc, aby nic nie trafiało do sieci.",
        uk: "«Лише лічильник» тільки зчитує значення. «Нульова віддача» додатково дозволяє інвертору знижувати потужність, щоб нічого не йшло в мережу.",
        "zh-cn": "仅计量只读取数值。零馈电还会让逆变器自行降功率，使电力不流入电网。",
    },
    shellyModeOff: {
        en: "Off",
        de: "Aus",
        ru: "Выкл.",
        pt: "Desligado",
        nl: "Uit",
        fr: "Désactivé",
        it: "Spento",
        es: "Apagado",
        pl: "Wyłączony",
        uk: "Вимк.",
        "zh-cn": "关闭",
    },
    shellyModeMeter: {
        en: "Meter only",
        de: "Nur Zähler",
        ru: "Только счётчик",
        pt: "Apenas contador",
        nl: "Alleen meter",
        fr: "Compteur seul",
        it: "Solo contatore",
        es: "Solo contador",
        pl: "Tylko licznik",
        uk: "Лише лічильник",
        "zh-cn": "仅计量",
    },
    shellyModeZeroExport: {
        en: "Zero export",
        de: "Nulleinspeisung",
        ru: "Нулевая отдача",
        pt: "Injeção zero",
        nl: "Nul-teruglevering",
        fr: "Injection zéro",
        it: "Immissione zero",
        es: "Inyección cero",
        pl: "Zerowy eksport",
        uk: "Нульова віддача",
        "zh-cn": "零馈电",
    },
    powerLimit: {
        en: "Power limit",
        de: "Leistungslimit",
        ru: "Ограничение мощности",
        pt: "Limite de potência",
        nl: "Vermogenslimiet",
        fr: "Limite de puissance",
        it: "Limite di potenza",
        es: "Límite de potencia",
        pl: "Limit mocy",
        uk: "Обмеження потужності",
        "zh-cn": "功率限制",
    },
    active: {
        en: "Inverter on/off",
        de: "Wechselrichter ein/aus",
        ru: "Инвертор вкл/выкл",
        pt: "Inversor lig/desl",
        nl: "Omvormer aan/uit",
        fr: "Onduleur marche/arrêt",
        it: "Inverter acceso/spento",
        es: "Inversor on/off",
        pl: "Falownik wł/wył",
        uk: "Інвертор увімк/вимк",
        "zh-cn": "逆变器开/关",
    },
    rebootInverter: {
        en: "Reboot inverter",
        de: "Wechselrichter neustarten",
        ru: "Перезагрузить инвертор",
        pt: "Reiniciar inversor",
        nl: "Omvormer herstarten",
        fr: "Redémarrer l'onduleur",
        it: "Riavvia inverter",
        es: "Reiniciar inversor",
        pl: "Uruchom ponownie falownik",
        uk: "Перезавантажити інвертор",
        "zh-cn": "重启逆变器",
    },
    rebootDtu: {
        en: "Reboot DTU",
        de: "DTU neustarten",
        ru: "Перезагрузить DTU",
        pt: "Reiniciar DTU",
        nl: "DTU herstarten",
        fr: "Redémarrer le DTU",
        it: "Riavvia DTU",
        es: "Reiniciar DTU",
        pl: "Uruchom ponownie DTU",
        uk: "Перезавантажити DTU",
        "zh-cn": "重启DTU",
    },
    powerFactorLimit: {
        en: "Power factor limit",
        de: "Leistungsfaktor-Limit",
        ru: "Ограничение коэффициента мощности",
        pt: "Limite do fator de potência",
        nl: "Vermogensfactorlimiet",
        fr: "Limite de facteur de puissance",
        it: "Limite del fattore di potenza",
        es: "Límite del factor de potencia",
        pl: "Limit współczynnika mocy",
        uk: "Обмеження коефіцієнта потужності",
        "zh-cn": "功率因数限制",
    },
    reactivePowerLimit: {
        en: "Reactive power limit",
        de: "Blindleistungs-Limit",
        ru: "Ограничение реактивной мощности",
        pt: "Limite de potência reativa",
        nl: "Blindvermogenlimiet",
        fr: "Limite de puissance réactive",
        it: "Limite di potenza reattiva",
        es: "Límite de potencia reactiva",
        pl: "Limit mocy biernej",
        uk: "Обмеження реактивної потужності",
        "zh-cn": "无功功率限制",
    },
    cleanWarnings: {
        en: "Acknowledge warnings",
        de: "Warnungen quittieren",
        ru: "Квитировать предупреждения",
        pt: "Confirmar avisos",
        nl: "Waarschuwingen bevestigen",
        fr: "Acquitter les avertissements",
        it: "Conferma avvisi",
        es: "Confirmar advertencias",
        pl: "Potwierdź ostrzeżenia",
        uk: "Квитувати попередження",
        "zh-cn": "确认警告",
    },
    cleanGroundingFault: {
        en: "Acknowledge grounding fault",
        de: "Erdungsfehler quittieren",
        ru: "Квитировать ошибку заземления",
        pt: "Confirmar falha de aterramento",
        nl: "Aardingsfout bevestigen",
        fr: "Acquitter le défaut de mise à la terre",
        it: "Conferma guasto di terra",
        es: "Confirmar fallo de puesta a tierra",
        pl: "Potwierdź błąd uziemienia",
        uk: "Квитувати помилку заземлення",
        "zh-cn": "确认接地故障",
    },
    lock: {
        en: "Lock inverter",
        de: "Wechselrichter sperren",
        ru: "Заблокировать инвертор",
        pt: "Bloquear inversor",
        nl: "Omvormer vergrendelen",
        fr: "Verrouiller l'onduleur",
        it: "Blocca inverter",
        es: "Bloquear inversor",
        pl: "Zablokuj falownik",
        uk: "Заблокувати інвертор",
        "zh-cn": "锁定逆变器",
    },
    serverSendTime: {
        en: "Cloud send interval",
        de: "Cloud-Sendeintervall",
        ru: "Интервал отправки в облако",
        pt: "Intervalo de envio para a nuvem",
        nl: "Cloud-verzendinterval",
        fr: "Intervalle d'envoi au cloud",
        it: "Intervallo di invio al cloud",
        es: "Intervalo de envío a la nube",
        pl: "Interwał wysyłania do chmury",
        uk: "Інтервал надсилання в хмару",
        "zh-cn": "云端发送间隔",
    },
    limitPowerMyPower: {
        en: "Power limit (DTU config field)",
        de: "Leistungslimit (DTU-Konfigfeld)",
        ru: "Ограничение мощности (поле конфигурации DTU)",
        pt: "Limite de potência (campo de config. do DTU)",
        nl: "Vermogenslimiet (DTU-configuratieveld)",
        fr: "Limite de puissance (champ de config. DTU)",
        it: "Limite di potenza (campo di config. DTU)",
        es: "Límite de potencia (campo de config. del DTU)",
        pl: "Limit mocy (pole konfiguracji DTU)",
        uk: "Обмеження потужності (поле конфігурації DTU)",
        "zh-cn": "功率限制（DTU 配置字段）",
    },
    confirmRebootInverter: {
        en: "Really reboot the inverter?",
        de: "Wechselrichter wirklich neustarten?",
        ru: "Действительно перезагрузить инвертор?",
        pt: "Reiniciar mesmo o inversor?",
        nl: "De omvormer echt herstarten?",
        fr: "Vraiment redémarrer l'onduleur ?",
        it: "Riavviare davvero l'inverter?",
        es: "¿Reiniciar realmente el inversor?",
        pl: "Naprawdę uruchomić ponownie falownik?",
        uk: "Дійсно перезавантажити інвертор?",
        "zh-cn": "确实要重启逆变器吗？",
    },
    confirmRebootDtu: {
        en: "Really reboot the DTU?",
        de: "DTU wirklich neustarten?",
        ru: "Действительно перезагрузить DTU?",
        pt: "Reiniciar mesmo o DTU?",
        nl: "De DTU echt herstarten?",
        fr: "Vraiment redémarrer le DTU ?",
        it: "Riavviare davvero il DTU?",
        es: "¿Reiniciar realmente el DTU?",
        pl: "Naprawdę uruchomić ponownie DTU?",
        uk: "Дійсно перезавантажити DTU?",
        "zh-cn": "确实要重启DTU吗？",
    },
    settings: {
        en: "Settings",
        de: "Einstellungen",
        ru: "Настройки",
        pt: "Configurações",
        nl: "Instellingen",
        fr: "Paramètres",
        it: "Impostazioni",
        es: "Configuración",
        pl: "Ustawienia",
        uk: "Налаштування",
        "zh-cn": "设置",
    },
    settingsTitle: {
        en: "Inverter settings",
        de: "Wechselrichter-Einstellungen",
        ru: "Настройки инвертора",
        pt: "Configurações do inversor",
        nl: "Omvormerinstellingen",
        fr: "Paramètres de l'onduleur",
        it: "Impostazioni dell'inverter",
        es: "Configuración del inversor",
        pl: "Ustawienia falownika",
        uk: "Налаштування інвертора",
        "zh-cn": "逆变器设置",
    },
    discover: {
        en: "Scan network",
        de: "Netzwerk durchsuchen",
        ru: "Сканировать сеть",
        pt: "Verificar rede",
        nl: "Netwerk scannen",
        fr: "Analyser le réseau",
        it: "Scansiona la rete",
        es: "Escanear la red",
        pl: "Skanuj sieć",
        uk: "Сканувати мережу",
        "zh-cn": "扫描网络",
    },
    testCloud: {
        en: "Test cloud login",
        de: "Cloud-Login testen",
        ru: "Проверить вход в облако",
        pt: "Testar login na nuvem",
        nl: "Cloud-login testen",
        fr: "Tester la connexion au cloud",
        it: "Prova accesso al cloud",
        es: "Probar inicio de sesión en la nube",
        pl: "Testuj logowanie do chmury",
        uk: "Перевірити вхід у хмару",
        "zh-cn": "测试云登录",
    },
    detailsHeader: {
        en: "Device information",
        de: "Geräteinformationen",
        ru: "Информация об устройстве",
        pt: "Informações do dispositivo",
        nl: "Apparaatinformatie",
        fr: "Informations sur l'appareil",
        it: "Informazioni sul dispositivo",
        es: "Información del dispositivo",
        pl: "Informacje o urządzeniu",
        uk: "Інформація про пристрій",
        "zh-cn": "设备信息",
    },
    cardPower: {
        en: "Current power",
        de: "Aktuelle Leistung",
        ru: "Текущая мощность",
        pt: "Potência atual",
        nl: "Huidig vermogen",
        fr: "Puissance actuelle",
        it: "Potenza attuale",
        es: "Potencia actual",
        pl: "Bieżąca moc",
        uk: "Поточна потужність",
        "zh-cn": "当前功率",
    },
    cardEnergyToday: {
        en: "Energy today",
        de: "Tagesenergie",
        ru: "Энергия за сегодня",
        pt: "Energia hoje",
        nl: "Energie vandaag",
        fr: "Énergie du jour",
        it: "Energia oggi",
        es: "Energía de hoy",
        pl: "Energia dziś",
        uk: "Енергія за сьогодні",
        "zh-cn": "今日发电量",
    },
    temperature: {
        en: "Temperature",
        de: "Temperatur",
        ru: "Температура",
        pt: "Temperatura",
        nl: "Temperatuur",
        fr: "Température",
        it: "Temperatura",
        es: "Temperatura",
        pl: "Temperatura",
        uk: "Температура",
        "zh-cn": "温度",
    },
    pvString: {
        en: "String",
        de: "Strang",
        ru: "Стринг",
        pt: "String",
        nl: "String",
        fr: "Chaîne",
        it: "Stringa",
        es: "Cadena",
        pl: "Łańcuch",
        uk: "Стрінг",
        "zh-cn": "组串",
    },
    detailsInverter: {
        en: "Inverter",
        de: "Wechselrichter",
        ru: "Инвертор",
        pt: "Inversor",
        nl: "Omvormer",
        fr: "Onduleur",
        it: "Inverter",
        es: "Inversor",
        pl: "Falownik",
        uk: "Інвертор",
        "zh-cn": "逆变器",
    },
    detailsDtu: {
        en: "DTU / firmware",
        de: "DTU / Firmware",
        ru: "DTU / прошивка",
        pt: "DTU / firmware",
        nl: "DTU / firmware",
        fr: "DTU / micrologiciel",
        it: "DTU / firmware",
        es: "DTU / firmware",
        pl: "DTU / firmware",
        uk: "DTU / прошивка",
        "zh-cn": "DTU / 固件",
    },
    detailsNetwork: {
        en: "Network",
        de: "Netzwerk",
        ru: "Сеть",
        pt: "Rede",
        nl: "Netwerk",
        fr: "Réseau",
        it: "Rete",
        es: "Red",
        pl: "Sieć",
        uk: "Мережа",
        "zh-cn": "网络",
    },
    detailsConnectedVia: {
        en: "Connected via",
        de: "Verbunden über",
        ru: "Подключено через",
        pt: "Ligado através de",
        nl: "Verbonden via",
        fr: "Connecté via",
        it: "Collegato tramite",
        es: "Conectado mediante",
        pl: "Połączono przez",
        uk: "З'єднано через",
        "zh-cn": "连接地址",
    },
    detailsCloudServer: {
        en: "Cloud server",
        de: "Cloud-Server",
        ru: "Облачный сервер",
        pt: "Servidor na nuvem",
        nl: "Cloudserver",
        fr: "Serveur cloud",
        it: "Server cloud",
        es: "Servidor en la nube",
        pl: "Serwer chmury",
        uk: "Хмарний сервер",
        "zh-cn": "云服务器",
    },
    groupRuntime: {
        en: "Runtime",
        de: "Laufzeit",
        ru: "Во время работы",
        pt: "Tempo de execução",
        nl: "Tijdelijk",
        fr: "Exécution",
        it: "Temporaneo",
        es: "Tiempo de ejecución",
        pl: "Czas pracy",
        uk: "Під час роботи",
        "zh-cn": "运行时",
    },
    helpVolatile: {
        en: "Runtime only — the device forgets this value on restart.",
        de: "Nur zur Laufzeit — das Gerät vergisst diesen Wert beim Neustart.",
        ru: "Только во время работы — DTU забывает это значение при перезапуске.",
        pt: "Apenas em tempo de execução — o DTU esquece este valor ao reiniciar.",
        nl: "Alleen tijdens runtime — de DTU vergeet deze waarde bij herstart.",
        fr: "Uniquement à l'exécution — le DTU oublie cette valeur au redémarrage.",
        it: "Solo runtime — il DTU dimentica questo valore al riavvio.",
        es: "Solo en tiempo de ejecución — el DTU olvida este valor al reiniciar.",
        pl: "Tylko w czasie pracy — DTU zapomina tę wartość po restarcie.",
        uk: "Лише під час роботи — DTU забуває це значення після перезапуску.",
        "zh-cn": "仅运行时有效 — DTU 重启后会忘记此值。",
    },
    helpFlashWrite: {
        en: "These values stay in the device and survive a restart. Frequent changes wear out its memory — not suitable for automatic control.",
        de: "Diese Werte bleiben im Gerät gespeichert und überstehen einen Neustart. Häufiges Ändern verschleißt den Speicher — nicht für automatische Regelung geeignet.",
        ru: "Эти значения сохраняются в устройстве и переживают перезапуск. Частые изменения изнашивают память — не подходит для автоматического регулирования.",
        pt: "Estes valores ficam guardados no aparelho e persistem após reinício. Alterações frequentes desgastam a memória — não é adequado para regulação automática.",
        nl: "Deze waarden blijven in het apparaat opgeslagen en blijven na herstart behouden. Vaak wijzigen slijt het geheugen — niet geschikt voor automatische regeling.",
        fr: "Ces valeurs restent enregistrées dans l'appareil et sont conservées après un redémarrage. Des modifications fréquentes usent la mémoire — ne convient pas à une régulation automatique.",
        it: "Questi valori restano memorizzati nell'apparecchio e sopravvivono a un riavvio. Modifiche frequenti usurano la memoria — non adatto a una regolazione automatica.",
        es: "Estos valores permanecen guardados en el aparato y persisten tras un reinicio. Los cambios frecuentes desgastan la memoria — no es adecuado para una regulación automática.",
        pl: "Te wartości pozostają zapisane w urządzeniu i przetrwają restart. Częste zmiany zużywają pamięć — nie nadaje się do automatycznej regulacji.",
        uk: "Ці значення залишаються збереженими у пристрої та переживають перезапуск. Часті зміни зношують пам'ять — не підходить для автоматичного регулювання.",
        "zh-cn": "这些值保存在设备中，重启后保留。频繁更改会磨损存储器 — 不适合自动调节。",
    },
    groupOperation: {
        en: "Operation",
        de: "Betrieb",
        ru: "Работа",
        pt: "Operação",
        nl: "Bedrijf",
        fr: "Fonctionnement",
        it: "Funzionamento",
        es: "Funcionamiento",
        pl: "Praca",
        uk: "Робота",
        "zh-cn": "运行",
    },
    cardEnergyYear: {
        en: "Energy this year",
        de: "Jahresenergie",
        ru: "Энергия за год",
        pt: "Energia do ano",
        nl: "Energie dit jaar",
        fr: "Énergie de l'année",
        it: "Energia dell'anno",
        es: "Energía del año",
        pl: "Energia w roku",
        uk: "Енергія за рік",
        "zh-cn": "年发电量",
    },
    cardEnergyTotal: {
        en: "Total energy",
        de: "Gesamtenergie",
        ru: "Всего энергии",
        pt: "Energia total",
        nl: "Totale energie",
        fr: "Énergie totale",
        it: "Energia totale",
        es: "Energía total",
        pl: "Energia całkowita",
        uk: "Загальна енергія",
        "zh-cn": "总发电量",
    },
    cardIncomeToday: {
        en: "Income today",
        de: "Tagesertrag",
        ru: "Доход за сегодня",
        pt: "Receita de hoje",
        nl: "Opbrengst vandaag",
        fr: "Revenu du jour",
        it: "Ricavo di oggi",
        es: "Ingresos de hoy",
        pl: "Przychód dziś",
        uk: "Дохід за сьогодні",
        "zh-cn": "今日收益",
    },
    cardIncomeTotal: {
        en: "Total income",
        de: "Gesamtertrag",
        ru: "Общий доход",
        pt: "Receita total",
        nl: "Totale opbrengst",
        fr: "Revenu total",
        it: "Ricavo totale",
        es: "Ingresos totales",
        pl: "Przychód całkowity",
        uk: "Загальний дохід",
        "zh-cn": "总收益",
    },
    pvUtilization: {
        en: "PV utilization",
        de: "PV-Auslastung",
        ru: "Загрузка PV",
        pt: "Utilização PV",
        nl: "PV-benutting",
        fr: "Utilisation PV",
        it: "Utilizzo FV",
        es: "Utilización FV",
        pl: "Wykorzystanie PV",
        uk: "Завантаження PV",
        "zh-cn": "光伏利用率",
    },
};
export const COMMAND_DEFS = [
    { id: "inverter.active", ui: "control", kind: "switch", label: "active", group: "operation", cloudCapable: true },
    { id: "inverter.lock", ui: "control", kind: "switch", label: "lock", group: "operation", cloudCapable: false },
    {
        id: "config.limitPowerMyPower",
        ui: "control",
        kind: "slider",
        label: "limitPowerMyPower",
        help: "helpVolatile",
        min: 2,
        max: 100,
        unit: "%",
        group: "runtime",
        cloudCapable: false,
    },
    {
        id: "config.serverSendTime",
        ui: "control",
        kind: "number",
        label: "serverSendTime",
        help: "helpVolatile",
        min: 1,
        unit: "min",
        group: "runtime",
        cloudCapable: false,
    },
    {
        id: "inverter.powerLimit",
        ui: "setting",
        kind: "slider",
        label: "powerLimit",
        help: "helpFlashWrite",
        min: 2,
        max: 100,
        unit: "%",
        cloudCapable: false,
    },
    {
        id: "inverter.powerFactorLimit",
        ui: "setting",
        kind: "number",
        label: "powerFactorLimit",
        help: "helpFlashWrite",
        min: -1,
        max: 1,
        step: 0.1,
        cloudCapable: false,
    },
    {
        id: "inverter.reactivePowerLimit",
        ui: "setting",
        kind: "number",
        label: "reactivePowerLimit",
        help: "helpFlashWrite",
        min: -50,
        max: 50,
        unit: "°",
        cloudCapable: false,
    },
    {
        id: "inverter.reboot",
        ui: "action",
        label: "rebootInverter",
        confirm: "confirmRebootInverter",
        icon: "refresh",
        cloudCapable: true,
    },
    {
        id: "dtu.reboot",
        ui: "action",
        label: "rebootDtu",
        confirm: "confirmRebootDtu",
        icon: "refresh",
        cloudCapable: true,
    },
    {
        id: "inverter.cleanWarnings",
        ui: "action",
        label: "cleanWarnings",
        confirm: true,
        requires: "activeAlarms",
        icon: ACK_ICON,
        style: ACTION_ICON_STYLE,
        cloudCapable: false,
    },
    {
        id: "inverter.cleanGroundingFault",
        ui: "action",
        label: "cleanGroundingFault",
        confirm: true,
        requires: "groundingFault",
        uselessOn: /\d+WB\b/i,
        icon: ACK_GROUND_ICON,
        style: ACTION_ICON_STYLE,
        cloudCapable: false,
    },
];
const CONTROL_GROUPS = [
    { key: "operation", label: "groupOperation" },
    { key: "runtime", label: "groupRuntime" },
];
function sid(adapter, deviceId, suffix) {
    return `${adapter.namespace}.${deviceId}.${suffix}`;
}
const STATE_NOT_FOUND = { error: { code: 404, message: "state not found" } };
export function isLocalDevice(obj) {
    const host = obj.native?.host;
    return typeof host === "string" && host.length > 0;
}
export function classifyDevice(obj) {
    const native = (obj.native ?? {});
    if (native.stationId !== undefined && native.stationId !== null) {
        return "station";
    }
    if (typeof native.host === "string") {
        return "dtu";
    }
    return null;
}
function labelWithGap(base) {
    const out = {};
    for (const lang of REQUIRED_LANGS) {
        out[lang] = `${base[lang]}:\u00A0`;
    }
    return out;
}
const VALUE_SUFFIX = "#value";
function formKey(stateId) {
    return stateId.replace(/\./g, "_");
}
export function buildControls(adapter, deviceId, isLocal) {
    const controls = [];
    const readState = (suffix) => async () => (await adapter.getStateAsync(`${deviceId}.${suffix}`)) ?? STATE_NOT_FOUND;
    for (const group of CONTROL_GROUPS) {
        const defs = COMMAND_DEFS.filter(d => d.ui === "control" && d.group === group.key && (isLocal || d.cloudCapable));
        if (!defs.length) {
            continue;
        }
        const isFirst = controls.length === 0;
        if (!isFirst) {
            controls.push({ id: `_divider_${group.key}`, type: "divider", style: DIVIDER_STYLE });
        }
        controls.push({
            id: `_header_${group.key}`,
            type: "header",
            label: DM_I18N[group.label],
            style: isFirst ? FIRST_HEADER_STYLE : HEADER_STYLE,
        });
        for (const d of defs) {
            if (d.kind === "slider") {
                controls.push({
                    id: `${d.id}${VALUE_SUFFIX}`,
                    type: "info",
                    label: labelWithGap(DM_I18N[d.label]),
                    stateId: sid(adapter, deviceId, d.id),
                    unit: d.unit,
                    getStateHandler: readState(d.id),
                });
            }
            controls.push({
                id: d.id,
                type: d.kind ?? "number",
                label: d.kind === "slider" ? undefined : DM_I18N[d.label],
                stateId: sid(adapter, deviceId, d.id),
                icon: d.icon,
                min: d.min,
                max: d.max,
                step: d.step,
                unit: d.unit,
                handler: async (_devId, _controlId, state) => {
                    await adapter.setStateAsync(`${deviceId}.${d.id}`, state, false);
                    return (await adapter.getStateAsync(`${deviceId}.${d.id}`)) ?? STATE_NOT_FOUND;
                },
                getStateHandler: readState(d.id),
            });
        }
    }
    return controls;
}
export const SETTING_DEFS = COMMAND_DEFS.filter(d => d.ui === "setting");
const ALARM_CODE_GROUNDING = 182;
async function hasSomethingToAcknowledge(adapter, deviceId, kind) {
    if (kind === "activeAlarms") {
        const state = await adapter.getStateAsync(`${deviceId}.alarms.hasActive`);
        return state?.val === true;
    }
    const json = await adapter.getStateAsync(`${deviceId}.alarms.json`);
    if (typeof json?.val !== "string" || !json.val) {
        return false;
    }
    try {
        const alarms = JSON.parse(json.val);
        if (!Array.isArray(alarms)) {
            return false;
        }
        return alarms.some(a => {
            const entry = a;
            return entry?.active === true && entry?.code === ALARM_CODE_GROUNDING;
        });
    }
    catch {
        return false;
    }
}
export const SETTINGS_SCHEMA = {
    type: "panel",
    items: Object.fromEntries(SETTING_DEFS.map((d, index) => [
        formKey(d.id),
        {
            type: d.kind === "slider" ? "slider" : "number",
            label: DM_I18N[d.label],
            help: index === 0 && d.help ? DM_I18N[d.help] : undefined,
            min: d.min,
            max: d.max,
            step: d.step,
            unit: d.unit,
            sm: 12,
        },
    ])),
};
export function buildMeterSchema(detected) {
    return {
        type: "panel",
        items: {
            mac: detected.length
                ? {
                    type: "select",
                    label: DM_I18N.shellyMac,
                    help: DM_I18N.shellyMacHelp,
                    options: detected.map(m => ({ label: formatMeterMac(m), value: m })),
                    sm: 12,
                }
                : {
                    type: "staticText",
                    text: DM_I18N.shellyNoneFound,
                    sm: 12,
                },
            mode: {
                type: "select",
                label: DM_I18N.shellyMode,
                help: DM_I18N.shellyModeHelp,
                options: [
                    { label: DM_I18N.shellyModeMeter, value: 1 },
                    { label: DM_I18N.shellyModeZeroExport, value: 2 },
                ],
                sm: 12,
            },
        },
    };
}
function formatMeterMac(mac) {
    return /^[0-9a-f]{12}$/i.test(mac) ? (mac.toUpperCase().match(/.{2}/g) ?? []).join(":") : mac;
}
export async function buildDeviceActions(adapter, deviceId, isLocal, model = "") {
    const offered = [];
    for (const d of COMMAND_DEFS.filter(d => d.ui === "action" && (isLocal || d.cloudCapable))) {
        if (d.uselessOn && model && d.uselessOn.test(model)) {
            continue;
        }
        if (d.requires && !(await hasSomethingToAcknowledge(adapter, deviceId, d.requires))) {
            continue;
        }
        offered.push(d);
    }
    const actions = offered.map(d => ({
        id: d.id,
        icon: d.icon,
        style: d.style,
        description: DM_I18N[d.label],
        confirmation: d.confirm === true ? true : d.confirm ? DM_I18N[d.confirm] : undefined,
        handler: async () => {
            await adapter.setStateAsync(`${deviceId}.${d.id}`, true, false);
            return { refresh: "none" };
        },
    }));
    if (isLocal) {
        actions.push({
            id: "settings",
            icon: "settings",
            description: DM_I18N.settings,
            handler: async (_devId, context) => {
                const data = {};
                for (const d of SETTING_DEFS) {
                    const state = await adapter.getStateAsync(`${deviceId}.${d.id}`);
                    if (typeof state?.val === "number") {
                        data[formKey(d.id)] = state.val;
                    }
                }
                const result = await context.showForm(SETTINGS_SCHEMA, {
                    data,
                    title: DM_I18N.settingsTitle,
                });
                if (result) {
                    for (const d of SETTING_DEFS) {
                        const value = result[formKey(d.id)];
                        if (value === undefined || value === null) {
                            continue;
                        }
                        if (Number(value) === data[formKey(d.id)]) {
                            continue;
                        }
                        await adapter.setStateAsync(`${deviceId}.${d.id}`, Number(value), false);
                    }
                }
                return { refresh: "none" };
            },
        });
    }
    if (isLocal && (await adapter.getForeignObjectAsync(`${adapter.namespace}.${deviceId}.meter.mode`))) {
        actions.push({
            id: "shellyMeter",
            icon: METER_ICON,
            description: DM_I18N.shellyMeter,
            handler: async (_devId, context) => {
                const macState = await adapter.getStateAsync(`${deviceId}.meter.deviceId`);
                const modeState = await adapter.getStateAsync(`${deviceId}.meter.mode`);
                const detected = await adapter.getStateAsync(`${deviceId}.meter.detected`);
                const current = String(macState?.val ?? "");
                let macs = [];
                try {
                    const parsed = JSON.parse(String(detected?.val ?? "[]"));
                    macs = Array.isArray(parsed) ? parsed.map(String) : [];
                }
                catch {
                    macs = [];
                }
                if (current && !macs.includes(current)) {
                    macs.unshift(current);
                }
                const result = await context.showForm(buildMeterSchema(macs), {
                    data: {
                        mac: current || macs[0] || "",
                        mode: typeof modeState?.val === "number" ? modeState.val : 0,
                    },
                    title: DM_I18N.shellyMeterTitle,
                });
                if (!result) {
                    return { refresh: "none" };
                }
                const mac = String(result.mac ?? "").trim();
                if (mac && mac !== String(macState?.val ?? "")) {
                    await adapter.setStateAsync(`${deviceId}.meter.deviceId`, mac, false);
                }
                if (result.mode !== undefined && result.mode !== null) {
                    await adapter.setStateAsync(`${deviceId}.meter.mode`, Number(result.mode), false);
                }
                return { refresh: "none" };
            },
        });
    }
    return actions;
}
function cardStateItem(adapter, deviceId, suffix, label, unit, digits) {
    return { type: "state", oid: sid(adapter, deviceId, suffix), foreign: true, label, unit, narrow: true, digits };
}
function appendIndex(base, n) {
    const out = {};
    for (const lang of REQUIRED_LANGS) {
        out[lang] = `${base[lang]} ${n}`;
    }
    return out;
}
function gridCardItems(adapter, deviceId) {
    return {
        gridPower: cardStateItem(adapter, deviceId, "grid.power", DM_I18N.cardPower, "W"),
        gridDailyEnergy: cardStateItem(adapter, deviceId, "grid.dailyEnergy", DM_I18N.cardEnergyToday, "kWh", 2),
    };
}
async function buildStationCardInfo(adapter, deviceId) {
    const items = gridCardItems(adapter, deviceId);
    items.pvUtilization = cardStateItem(adapter, deviceId, "grid.pvUtilization", DM_I18N.pvUtilization, "%", 0);
    items.gridYearEnergy = cardStateItem(adapter, deviceId, "grid.yearEnergy", DM_I18N.cardEnergyYear, "kWh", 1);
    items.gridTotalEnergy = cardStateItem(adapter, deviceId, "grid.totalEnergy", DM_I18N.cardEnergyTotal, "kWh", 1);
    const currencyState = await adapter.getStateAsync(`${deviceId}.grid.currency`);
    const currency = typeof currencyState?.val === "string" ? currencyState.val : "";
    if (currency) {
        items.incomeToday = cardStateItem(adapter, deviceId, "grid.todayIncome", DM_I18N.cardIncomeToday, currency, 2);
        items.incomeTotal = cardStateItem(adapter, deviceId, "grid.totalIncome", DM_I18N.cardIncomeTotal, currency, 2);
    }
    return { id: deviceId, schema: { type: "panel", items } };
}
async function buildDtuCardInfo(adapter, deviceId) {
    const items = gridCardItems(adapter, deviceId);
    for (let i = 0; i < MAX_PV_PORTS; i++) {
        const state = await adapter.getStateAsync(`${deviceId}.pv${i}.power`);
        if (state !== null && state !== undefined) {
            items[`pv${i}Power`] = cardStateItem(adapter, deviceId, `pv${i}.power`, appendIndex(DM_I18N.pvString, i + 1), "W");
        }
    }
    items.temperature = cardStateItem(adapter, deviceId, "inverter.temperature", DM_I18N.temperature, "°C", 1);
    return { id: deviceId, schema: { type: "panel", items } };
}
export async function buildDtuDeviceInfo(adapter, deviceId, obj, stationName) {
    const local = isLocalDevice(obj);
    const modelState = await adapter.getStateAsync(`${deviceId}.inverter.model`);
    const model = typeof modelState?.val === "string" && modelState.val ? modelState.val : "";
    const name = stationName ? `${stationName} · ${deviceId}` : model ? `${model} (${deviceId})` : deviceId;
    const status = {
        connection: {
            stateId: sid(adapter, deviceId, "info.connected"),
            mapping: { true: "connected", false: "disconnected" },
        },
    };
    if (local) {
        status.rssi = {
            stateId: sid(adapter, deviceId, "dtu.signalQuality"),
            mapping: RSSI_PERCENT_TEXT,
        };
    }
    return {
        id: deviceId,
        name,
        icon: inverterIcon(model),
        model: model || undefined,
        status,
        update: {
            available: { stateId: sid(adapter, deviceId, "dtu.fwUpdateAvailable") },
            version: { stateId: sid(adapter, deviceId, "dtu.swVersion") },
        },
        customInfo: await buildDtuCardInfo(adapter, deviceId),
        controls: buildControls(adapter, deviceId, local),
        actions: await buildDeviceActions(adapter, deviceId, local, model),
        hasDetails: true,
    };
}
export function resolveStationId(liveStationId, obj) {
    const remembered = obj.native?.cloudStationId;
    const known = typeof remembered === "number" ? remembered : null;
    if (liveStationId != null) {
        return { stationId: liveStationId, persist: liveStationId !== known };
    }
    return { stationId: known, persist: false };
}
const STATION_CONNECTED_MAP = {
    0: "disconnected",
    10: "connected",
    20: "connected",
    30: "connected",
    40: "connected",
    50: "connected",
    60: "connected",
};
export async function buildStationDeviceInfo(adapter, deviceId, obj) {
    const name = obj.common?.name || deviceId;
    return {
        id: deviceId,
        name,
        icon: STATION_ICON,
        status: {
            connection: {
                stateId: sid(adapter, deviceId, "info.stationStatus"),
                mapping: STATION_CONNECTED_MAP,
            },
        },
        customInfo: await buildStationCardInfo(adapter, deviceId),
        hasDetails: true,
    };
}
const EMPTY_NETWORK_VALUES = new Set(["0.0.0.0", "00:00:00:00:00:00", "0.0.0.0.0.0", ""]);
async function hasMeaningfulValue(adapter, deviceId, suffix) {
    const state = await adapter.getStateAsync(`${deviceId}.${suffix}`);
    if (state === null || state === undefined || state.val === null || state.val === undefined) {
        return false;
    }
    if (typeof state.val === "string") {
        return !EMPTY_NETWORK_VALUES.has(state.val.trim());
    }
    return true;
}
export async function buildDeviceDetails(adapter, deviceId) {
    const obj = await adapter.getForeignObjectAsync(`${adapter.namespace}.${deviceId}`);
    if (!obj) {
        return { error: "device not found" };
    }
    const kind = classifyDevice(obj);
    const items = {
        _header: { type: "header", text: DM_I18N.detailsHeader, size: 2 },
    };
    const addState = (key, suffix) => {
        items[key] = {
            type: "state",
            oid: sid(adapter, deviceId, suffix),
            foreign: true,
            label: STATE_BY_ID.get(suffix)?.name ?? suffix,
            addColon: true,
            newLine: true,
            control: "text",
            readOnly: true,
            narrow: true,
        };
    };
    const addHeader = (key, label) => {
        items[`${key}_h`] = { type: "header", text: label, size: 4, newLine: true };
        items[key] = { type: "divider", color: "primary" };
    };
    if (kind === "station") {
        addState("capacity", "info.systemCapacity");
        addState("status", "info.stationStatus");
        addState("address", "info.address");
        addState("lastUpdate", "info.lastCloudUpdate");
    }
    else {
        addHeader("_hInverter", DM_I18N.detailsInverter);
        addState("model", "inverter.model");
        addState("invSerial", "inverter.serialNumber");
        addState("invHw", "inverter.hwVersion");
        addState("invSw", "inverter.swVersion");
        addHeader("_hDtu", DM_I18N.detailsDtu);
        addState("dtuSerial", "dtu.serialNumber");
        addState("dtuSw", "dtu.swVersion");
        addState("dtuHw", "dtu.hwVersion");
        addState("wifiVersion", "dtu.wifiVersion");
        addState("fwUpdate", "dtu.fwUpdateAvailable");
        if (isLocalDevice(obj)) {
            const network = [
                ["rssi", "dtu.signalQuality"],
                ["ssid", "config.wifiSsid"],
                ["ipAddress", "config.wifiIpAddress"],
                ["macAddress", "config.wifiMacAddress"],
                ["lanIp", "config.ipAddress"],
                ["lanMac", "config.macAddress"],
                ["subnetMask", "config.subnetMask"],
                ["gateway", "config.gateway"],
                ["dnsServer", "config.dnsServer"],
                ["dhcp", "config.netDhcpSwitch"],
            ];
            const present = [];
            for (const [key, suffix] of network) {
                if (await hasMeaningfulValue(adapter, deviceId, suffix)) {
                    present.push([key, suffix]);
                }
            }
            if (present.length) {
                addHeader("_hNetwork", DM_I18N.detailsNetwork);
                const host = obj.native.host;
                if (typeof host === "string" && host) {
                    items.connectedVia = {
                        type: "staticInfo",
                        label: DM_I18N.detailsConnectedVia,
                        data: host,
                        addColon: true,
                        newLine: true,
                    };
                }
                for (const [key, suffix] of present) {
                    addState(key, suffix);
                }
            }
            addHeader("_hCloud", DM_I18N.detailsCloudServer);
            addState("serverDomain", "config.serverDomain");
            addState("serverPort", "config.serverPort");
        }
    }
    return {
        id: deviceId,
        schema: { type: "panel", items },
    };
}
export function buildInstanceInfo(adapter) {
    return {
        apiVersion: "v3",
        actions: [
            {
                id: "discover",
                icon: "search",
                title: DM_I18N.discover,
                timeout: 120000,
                handler: async (context) => {
                    const summary = await adapter.dmScanNetwork();
                    await context.showMessage(summary);
                    return { refresh: true };
                },
            },
            {
                id: "testCloud",
                icon: "info",
                title: DM_I18N.testCloud,
                timeout: 60000,
                handler: async (context) => {
                    const summary = await adapter.dmTestCloudLogin();
                    await context.showMessage(summary);
                    return { refresh: false };
                },
            },
        ],
    };
}
export class HoymilesDeviceManagement extends DeviceManagement {
    getInstanceInfo() {
        return buildInstanceInfo(this.adapter);
    }
    async loadDevices(context) {
        const objs = await this.adapter.getForeignObjectsAsync(`${this.adapter.namespace}.*`, "device");
        const entries = Object.entries(objs);
        const infos = [];
        for (const [fullId, obj] of entries) {
            const deviceId = fullId.slice(this.adapter.namespace.length + 1);
            const kind = classifyDevice(obj);
            if (kind === "dtu") {
                const live = this.adapter.devices.get(deviceId)?.cloudStationId ?? null;
                const { stationId, persist } = resolveStationId(live, obj);
                if (persist && stationId != null) {
                    await this.adapter.extendObjectAsync(deviceId, { native: { cloudStationId: stationId } });
                }
                let stationName;
                if (stationId != null) {
                    const cn = objs[`${this.adapter.namespace}.station-${stationId}`]?.common?.name;
                    if (typeof cn === "string" && cn) {
                        stationName = cn;
                    }
                }
                infos.push(await buildDtuDeviceInfo(this.adapter, deviceId, obj, stationName));
            }
            else if (kind === "station") {
                infos.push(await buildStationDeviceInfo(this.adapter, deviceId, obj));
            }
        }
        context.setTotalDevices(infos.length);
        for (const info of infos) {
            context.addDevice(info);
        }
    }
    getDeviceDetails(id) {
        return buildDeviceDetails(this.adapter, id);
    }
}
//# sourceMappingURL=deviceManagement.js.map