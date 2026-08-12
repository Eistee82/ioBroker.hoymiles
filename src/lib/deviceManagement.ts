import { DeviceManagement } from "@iobroker/dm-utils";
import type { AdapterInstance } from "@iobroker/adapter-core";
import type {
	DeviceInfo,
	DeviceControl,
	DeviceAction,
	DeviceDetails,
	InstanceDetails,
	DeviceLoadContext,
	ActionContext,
	ControlState,
	JsonFormSchema,
	ErrorResponse,
} from "@iobroker/dm-utils";
import { MAX_PV_PORTS } from "./deviceContext.js";
import { ACK_ICON, ACK_GROUND_ICON, inverterIcon, METER_ICON, STATION_ICON } from "./deviceIcons.js";
import { states as DTU_STATES, stationStates as STATION_STATES } from "./stateDefinitions.js";

/**
 * State id (relative to the device node) to its definition.
 *
 * The details panel labels its rows from here rather than repeating the texts: these are the very
 * names the adapter puts on the objects, so the panel cannot drift away from the object tree, and
 * a renamed state carries its new name into the dialog by itself.
 */
const STATE_BY_ID = new Map([...DTU_STATES, ...STATION_STATES].map(d => [d.id, d]));

/**
 * Sizes the data-URI action icons. The Device Manager hands a `data:image/…` icon to a plain
 * `<img>` without width or height, so it would otherwise render at its natural 64 px next to the
 * 24 px material icons. The action's `style` reaches the button as MUI `sx`, so the image can be
 * sized from here.
 */
const ACTION_ICON_STYLE = { "& img": { width: 22, height: 22 } };

/**
 * Signal quality (0-100) to the text the status line should show.
 *
 * The built-in signal slot prints its value verbatim and has no unit option of its own, so the
 * unit has to arrive as part of the value. A `ValueOrState` mapping is looked up with the raw
 * state value and whatever it yields is rendered (`StateOrObjectHandler`: `callback(mapping[val])`),
 * which makes "48 %" appear where "48" used to.
 *
 * The table spans exactly the range the firmware can produce: the value is
 * `clamp(2 * (95 - |rssi_dBm|), 0, 100)`, so 0-100 is complete. A value outside it would find no
 * entry and hide the indicator — hence the clamp on our side too, rather than trusting the range.
 */
const RSSI_PERCENT_TEXT: Record<number, number> = Object.fromEntries(
	Array.from({ length: 101 }, (_, i) => [i, `${i} %`]),
) as unknown as Record<number, number>;

/**
 * Section heading inside the control dialog.
 *
 * `backgroundColor` is reset because the Device Manager paints headers with its hard-coded
 * "primary" (`#111` in the control dialog), which reads as a black bar in both themes. The colour
 * itself is left alone so the text keeps inheriting the theme foreground.
 */
const HEADER_STYLE: Record<string, unknown> = {
	backgroundColor: "transparent",
	fontWeight: 600,
	fontSize: "0.75rem",
	letterSpacing: "0.08em",
	textTransform: "uppercase",
	opacity: 0.7,
	marginTop: 14,
	marginBottom: 2,
};

/**
 * The first heading additionally sets the dialog width. The Device Manager opens the control
 * dialog as a plain `<Dialog>` without `fullWidth`, so MUI sizes it to its content and caps it at
 * the default `sm` breakpoint (600 px). Without a wide child the dialog collapsed to roughly the
 * slider's own `min-width: 300px`, which is what made the slider overlap its label. Asking for
 * 552 px (600 px minus the dialog padding) takes it to that cap; `80vw` keeps it from overflowing
 * on a narrow screen, where a fixed width could not shrink.
 */
const FIRST_HEADER_STYLE: Record<string, unknown> = {
	...HEADER_STYLE,
	marginTop: 0,
	minWidth: "min(552px, 80vw)",
};

/** Separator drawn between two sections. */
const DIVIDER_STYLE: Record<string, unknown> = { marginTop: 12, opacity: 0.4 };

/**
 * Device Manager integration (`@iobroker/dm-utils`).
 *
 * Presents every DTU/inverter and every cloud station on the ioBroker "Device Manager" tab,
 * with live status, all controllable states as controls/actions, a settings form and a
 * read-only details view. It never introduces a parallel command path: controls and actions
 * write the existing writable states (with `ack: false`), so they flow through the adapter's
 * normal `onStateChange → DeviceContext.handleStateChange` route (which already prefers the
 * local TCP link and falls back to the cloud). The device list is read from the object DB, so
 * no adapter-internal registry has to be exposed.
 */

/** The 11 mandatory adapter languages — every DM label must cover all of them. */
export const REQUIRED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"] as const;

type Translated = { [lang in (typeof REQUIRED_LANGS)[number]]: string };

/**
 * All user-facing Device-Manager strings, each in the 11 mandatory languages. Kept in one
 * place so completeness can be asserted by a unit test (see test/deviceManagement.test.js).
 */
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
} satisfies Record<string, Translated>;

/** Section of the control dialog a control is filed under. Order is fixed by {@link CONTROL_GROUPS}. */
type ControlGroup = "operation" | "runtime";

/**
 * A controllable writable state, and how it should appear on the device card.
 *
 * The split between `control` and `setting` follows what the firmware actually does, not what the
 * state names suggest — and the two disagree. `inverter.powerLimit` sounds like a runtime knob but
 * is written into the persisted structure `0x6b8dc+0x40` and costs two 4 KB flash sectors per
 * change; `config.limitPowerMyPower` is named "persistent" but lands in `0x6c204`, outside that
 * structure, and is gone after a restart. See _fwanalysis/ADAPTER_FINDINGS.md §1, §2 and §15.
 */
interface CommandDef {
	/** State id relative to the device node, e.g. `inverter.powerLimit`. Must be in WRITABLE_STATES. */
	id: string;
	/**
	 * `control` = volatile, lives in the control dialog; `setting` = persisted in the DTU, lives in
	 * the settings form behind the gear icon; `action` = momentary button on the card.
	 */
	ui: "control" | "action" | "setting";
	/** Widget kind for controls. */
	kind?: "switch" | "slider" | "number";
	/** Translation key in {@link DM_I18N} for the label. */
	label: keyof typeof DM_I18N;
	/** Translation key for the help line under a settings field, or the tooltip of a control. */
	help?: keyof typeof DM_I18N;
	/** Translation key for a confirmation prompt (actions only). `true` = generic GUI confirm. */
	confirm?: keyof typeof DM_I18N | true;
	/**
	 * Action icon. Only a `data:image/…` URI or one of the Device Manager's own reserved names
	 * renders — anything else falls back to a question mark. Controls are stricter still: their
	 * icon is passed to `<img src>` unchanged, so a reserved name would show a broken image there.
	 */
	icon?: string;
	/** `sx` style for the action button; used to size the data-URI icons. */
	style?: Record<string, unknown>;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	/** Section of the control dialog (controls only). */
	group?: ControlGroup;
	/**
	 * Only offer this action while the device actually has something for it to clear. An
	 * acknowledge button with nothing to acknowledge is noise, and pressing it does nothing.
	 */
	requires?: "activeAlarms" | "groundingFault";
	/**
	 * Models whose firmware accepts this command but does nothing with it. Offering it there would
	 * report success for an action that provably had no effect.
	 */
	uselessOn?: RegExp;
	/** Available on cloud-only devices (subset the cloud control channel can actuate). */
	cloudCapable: boolean;
}

/**
 * Single source of truth binding every writable state to its Device-Manager widget.
 * Kept consistent with {@link WRITABLE_STATES} by a unit test, so neither can drift.
 */
export const COMMAND_DEFS: CommandDef[] = [
	// === Control dialog — nothing here survives a DTU restart ===
	// --- Operation ---
	// No icon: a switch passes its icon straight to `<img src>`, so a reserved name like "socket"
	// would render as a broken image. The label alone carries the meaning here.
	{ id: "inverter.active", ui: "control", kind: "switch", label: "active", group: "operation", cloudCapable: true },
	{ id: "inverter.lock", ui: "control", kind: "switch", label: "lock", group: "operation", cloudCapable: false },
	// --- Runtime values (RAM-only, firmware-verified §2/§15) ---
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

	// === Settings form — persisted in the DTU, two 4 KB flash sectors per change (§1) ===
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
	// --- Actions (card footer) ---
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
		// Firmware-verified: on the WB series action 10 lands in an empty arm and returns err 0 —
		// it reports success and does nothing (ACTIONS_COMPARISON.md). Proven on the HMS-800-2WB;
		// the whole WB line shares that firmware platform. The 2T executes it (slot cmd 0x08).
		uselessOn: /\d+WB\b/i,
		icon: ACK_GROUND_ICON,
		style: ACTION_ICON_STYLE,
		cloudCapable: false,
	},
];

/** Order and headings of the control-dialog sections. */
const CONTROL_GROUPS: Array<{ key: ControlGroup; label: keyof typeof DM_I18N }> = [
	{ key: "operation", label: "groupOperation" },
	{ key: "runtime", label: "groupRuntime" },
];

/** Minimal adapter surface the DM builders need; keeps them testable with a plain mock. */
interface DmAdapterLike {
	namespace: string;
	log: ioBroker.Logger;
	getStateAsync(id: string): ioBroker.GetStatePromise;
	setStateAsync(id: string, val: ioBroker.StateValue, ack: boolean): Promise<unknown>;
	getForeignObjectsAsync(pattern: string, type: "device"): Promise<Record<string, ioBroker.Object>>;
	getForeignObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
	dmScanNetwork(): Promise<string>;
	dmTestCloudLogin(): Promise<string>;
}

/**
 * The concrete adapter surface the DM backend binds to: a full ioBroker adapter plus the two
 * Hoymiles-specific helper methods the instance actions call. Declared here (instead of importing
 * the concrete `Hoymiles` class) so the adapter class need not be exported and no import cycle
 * arises; the running `Hoymiles` instance satisfies it structurally.
 */
interface HoymilesDmAdapter extends AdapterInstance {
	dmScanNetwork(): Promise<string>;
	dmTestCloudLogin(): Promise<string>;
	/**
	 * Runtime device registry, keyed by DTU serial. Only `cloudStationId` is read here — to name
	 * an inverter after the cloud station (plant) the user named in the S-Miles app.
	 */
	devices: ReadonlyMap<string, { cloudStationId: number | null }>;
}

/**
 * Full foreign state id (namespace-prefixed) for the GUI to bind/subscribe to.
 *
 * @param adapter - Adapter, for its `namespace`.
 * @param deviceId - Device id (state-tree prefix).
 * @param suffix - State suffix relative to the device node.
 */
function sid(adapter: DmAdapterLike, deviceId: string, suffix: string): string {
	return `${adapter.namespace}.${deviceId}.${suffix}`;
}

const STATE_NOT_FOUND: ErrorResponse = { error: { code: 404, message: "state not found" } };

/**
 * True if a device object is a locally-reachable DTU (non-empty `native.host`).
 *
 * @param obj - The ioBroker device object created by this adapter.
 */
export function isLocalDevice(obj: ioBroker.Object): boolean {
	const host = (obj.native as { host?: unknown } | undefined)?.host;
	return typeof host === "string" && host.length > 0;
}

/**
 * Classify a device object created by this adapter as a DTU, a cloud station, or neither.
 *
 * @param obj - The ioBroker device object (its `native` carries `host` or `stationId`).
 */
export function classifyDevice(obj: ioBroker.Object): "dtu" | "station" | null {
	const native = (obj.native ?? {}) as { host?: unknown; stationId?: unknown };
	if (native.stationId !== undefined && native.stationId !== null) {
		return "station";
	}
	if (typeof native.host === "string") {
		return "dtu";
	}
	return null;
}

/**
 * Suffix a colon and a non-breaking space onto every language of a translation.
 *
 * The Device Manager renders an `info` control as label directly followed by the value, with no
 * spacing of its own and no way to style it from the backend, so the gap has to travel inside the
 * label ("Power limit" -> "Power limit: 70 %").
 *
 * @param base - The translated label.
 */
function labelWithGap(base: Translated): Translated {
	const out = {} as Translated;
	for (const lang of REQUIRED_LANGS) {
		out[lang] = `${base[lang]}:\u00A0`;
	}
	return out;
}

/** Suffix used for the read-out control that accompanies a slider. Never a state id. */
const VALUE_SUFFIX = "#value";

/**
 * Form-field key for a state id. JsonConfig reads a dot as a path separator, so `inverter.foo`
 * would arrive nested; the flat key keeps the returned data addressable.
 *
 * @param stateId - State id relative to the device node.
 */
function formKey(stateId: string): string {
	return stateId.replace(/\./g, "_");
}

/**
 * Build the stateful controls for one DTU, grouped into labelled sections.
 *
 * Local-only commands are omitted entirely for cloud-only devices (dm-utils controls have no
 * "disabled" flag), leaving just the cloud-actuatable subset so the card never offers a control
 * that would do nothing. Sections with no remaining control are skipped along with their heading.
 *
 * Every slider is preceded by a read-only `info` line carrying the live value and its unit,
 * because the Device Manager's slider only reveals its value while it is being dragged
 * (`valueLabelDisplay="auto"`). The slider itself is then rendered without a label, which also
 * keeps it from overlapping one.
 *
 * @param adapter - Adapter surface used to read/write states.
 * @param deviceId - DTU device id (its serial), the state-tree prefix.
 * @param isLocal - Whether the DTU has a local TCP link (enables the local-only controls).
 */
export function buildControls(adapter: DmAdapterLike, deviceId: string, isLocal: boolean): DeviceControl<string>[] {
	const controls: DeviceControl<string>[] = [];

	// Reads the state a control is bound to, regardless of the control's own id — the read-out
	// line accompanying a slider carries a synthetic id but must read the slider's state.
	const readState = (suffix: string) => async (): Promise<ioBroker.State | ErrorResponse> =>
		(await adapter.getStateAsync(`${deviceId}.${suffix}`)) ?? STATE_NOT_FOUND;

	for (const group of CONTROL_GROUPS) {
		const defs = COMMAND_DEFS.filter(
			d => d.ui === "control" && d.group === group.key && (isLocal || d.cloudCapable),
		);
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
				// A slider states its name on the read-out line above it.
				label: d.kind === "slider" ? undefined : DM_I18N[d.label],
				stateId: sid(adapter, deviceId, d.id),
				icon: d.icon,
				min: d.min,
				max: d.max,
				step: d.step,
				unit: d.unit,
				handler: async (_devId, _controlId, state: ControlState) => {
					await adapter.setStateAsync(`${deviceId}.${d.id}`, state, false);
					return (await adapter.getStateAsync(`${deviceId}.${d.id}`)) ?? STATE_NOT_FOUND;
				},
				getStateHandler: readState(d.id),
			});
		}
	}

	return controls;
}

/** The commands that live behind the gear icon: everything the DTU persists. */
export const SETTING_DEFS = COMMAND_DEFS.filter(d => d.ui === "setting");

/**
 * Alarm code the device reports for a grounding fault. The only grounding-related entry in the
 * code table, so it alone decides whether that acknowledge button has anything to act on.
 */
const ALARM_CODE_GROUNDING = 182;

/**
 * True if the device currently has something for an acknowledge button to clear.
 *
 * Unknown counts as nothing: while the alarm list has not been read (a fresh start, or a device
 * that never answers it) there is no known fault, and offering a button that would clear nothing
 * is worse than leaving it out until the next poll brings the answer.
 *
 * @param adapter - Adapter surface used to read the alarm states.
 * @param deviceId - Device id (state-tree prefix).
 * @param kind - Which acknowledge button is asking.
 */
async function hasSomethingToAcknowledge(
	adapter: DmAdapterLike,
	deviceId: string,
	kind: "activeAlarms" | "groundingFault",
): Promise<boolean> {
	if (kind === "activeAlarms") {
		const state = await adapter.getStateAsync(`${deviceId}.alarms.hasActive`);
		return state?.val === true;
	}

	// The grounding button is only useful while that specific fault stands, so the alarm list is
	// searched for an active entry with its code rather than reacting to any alarm at all.
	const json = await adapter.getStateAsync(`${deviceId}.alarms.json`);
	if (typeof json?.val !== "string" || !json.val) {
		return false;
	}
	try {
		const alarms: unknown = JSON.parse(json.val);
		if (!Array.isArray(alarms)) {
			return false;
		}
		return alarms.some(a => {
			const entry = a as { code?: unknown; active?: unknown };
			return entry?.active === true && entry?.code === ALARM_CODE_GROUNDING;
		});
	} catch {
		// A malformed list says nothing about the device; treat it as "no known fault".
		return false;
	}
}

/**
 * JsonConfig schema for the per-inverter settings form, derived from {@link SETTING_DEFS} so the
 * form and the command table cannot drift apart. Every field carries the flash warning, because
 * each of these three writes two 4 KB sectors.
 *
 * The form key is the state id with dots replaced — JsonConfig treats a dotted key as a path.
 */
export const SETTINGS_SCHEMA: JsonFormSchema = {
	type: "panel",
	items: Object.fromEntries(
		SETTING_DEFS.map((d, index) => [
			formKey(d.id),
			{
				type: d.kind === "slider" ? "slider" : "number",
				label: DM_I18N[d.label],
				// The note applies to the whole dialog — every field here is persisted — so it is
				// shown once instead of repeated under each of the three.
				help: index === 0 && d.help ? DM_I18N[d.help] : undefined,
				min: d.min,
				max: d.max,
				step: d.step,
				unit: d.unit,
				sm: 12,
			},
		]),
	),
};

/**
 * Form for connecting an energy meter. Deliberately just two fields: the address identifies the
 * meter, the mode decides what the inverter does with it.
 */
/**
 * Form for connecting an energy meter.
 *
 * The address is picked from what the inverter itself found — nobody should have to look up a MAC
 * address. `detected` comes from `dtuInfo.shls`, which the device sends in every info response.
 *
 * @param detected - meter MACs the device reported, most recent selection first
 */
export function buildMeterSchema(detected: string[]): JsonFormSchema {
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
						// Nothing found yet — say so instead of showing an empty dropdown the user
						// cannot get past.
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

/**
 * Render a bare hex MAC as the usual colon-separated form, so it is readable in the dropdown.
 *
 * @param mac - 12 hex digits
 */
function formatMeterMac(mac: string): string {
	return /^[0-9a-f]{12}$/i.test(mac) ? (mac.toUpperCase().match(/.{2}/g) ?? []).join(":") : mac;
}

/**
 * Build the momentary actions for one DTU (reboots, clear-warning buttons) plus the settings
 * form. Each writes the underlying writable state with `ack: false` so the existing command
 * route actuates it. Local-only actions are skipped for cloud-only devices.
 *
 * @param adapter - Adapter surface used to read/write states.
 * @param deviceId - DTU device id (its serial), the state-tree prefix.
 * @param isLocal - Whether the DTU has a local TCP link (enables the local-only actions + settings).
 * @param model - Inverter model name; hides commands its firmware accepts but ignores.
 */
export async function buildDeviceActions(
	adapter: DmAdapterLike,
	deviceId: string,
	isLocal: boolean,
	model = "",
): Promise<DeviceAction<string>[]> {
	const offered: CommandDef[] = [];
	for (const d of COMMAND_DEFS.filter(d => d.ui === "action" && (isLocal || d.cloudCapable))) {
		if (d.uselessOn && model && d.uselessOn.test(model)) {
			continue;
		}
		if (d.requires && !(await hasSomethingToAcknowledge(adapter, deviceId, d.requires))) {
			continue;
		}
		offered.push(d);
	}

	const actions: DeviceAction<string>[] = offered.map(d => ({
		id: d.id,
		icon: d.icon,
		style: d.style,
		description: DM_I18N[d.label],
		confirmation: d.confirm === true ? true : d.confirm ? DM_I18N[d.confirm] : undefined,
		handler: async (): Promise<{ refresh: "none" }> => {
			await adapter.setStateAsync(`${deviceId}.${d.id}`, true, false);
			return { refresh: "none" };
		},
	}));

	// Settings form — only for locally-reachable devices; none of the persisted commands can be
	// actuated over the cloud control channel.
	if (isLocal) {
		actions.push({
			id: "settings",
			icon: "settings",
			description: DM_I18N.settings,
			handler: async (_devId, context: ActionContext): Promise<{ refresh: "none" }> => {
				const data: Record<string, number> = {};
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
						// Only write what the user actually moved. Each of these costs two flash
						// sectors, so rewriting an untouched field would be pure wear.
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

	// Energy meter — only offered where the hardware can take one. The controls exist solely on BLE
	// devices, so their presence is the honest test: a 2T has neither a meter input nor an energy
	// management, and a button that cannot work is worse than no button.
	if (isLocal && (await adapter.getForeignObjectAsync(`${adapter.namespace}.${deviceId}.meter.mode`))) {
		actions.push({
			id: "shellyMeter",
			icon: METER_ICON,
			description: DM_I18N.shellyMeter,
			handler: async (_devId, context: ActionContext): Promise<{ refresh: "none" }> => {
				const macState = await adapter.getStateAsync(`${deviceId}.meter.deviceId`);
				const modeState = await adapter.getStateAsync(`${deviceId}.meter.mode`);
				// The inverter reports the meters it knows in every info response; offer those
				// instead of asking for a MAC address. Whatever is already selected stays in the
				// list even if the device did not mention it this round.
				const detected = await adapter.getStateAsync(`${deviceId}.meter.detected`);
				const current = String(macState?.val ?? "");
				let macs: string[] = [];
				try {
					const parsed: unknown = JSON.parse(String(detected?.val ?? "[]"));
					macs = Array.isArray(parsed) ? parsed.map(String) : [];
				} catch {
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
				// MAC first: the mode is what triggers the binding, so it has to find the address
				// already in place.
				const mac = String(result.mac ?? "").trim();
				if (mac && mac !== String(macState?.val ?? "")) {
					await adapter.setStateAsync(`${deviceId}.meter.deviceId`, mac, false);
				}
				if (result.mode !== undefined && result.mode !== null) {
					// Always written, even when unchanged: re-sending is how a poll that died gets
					// restarted, and the device treats the command as idempotent.
					await adapter.setStateAsync(`${deviceId}.meter.mode`, Number(result.mode), false);
				}
				return { refresh: "none" };
			},
		});
	}

	return actions;
}

/** One read-only live value on a card, bound to a state via `oid` + `foreign`. */
type CardStateItem = {
	type: "state";
	oid: string;
	foreign: true;
	label: ioBroker.StringOrTranslated;
	unit: string;
	narrow: true;
	digits?: number;
};

/**
 * Build one live card value bound to `<deviceId>.<suffix>`.
 *
 * @param adapter - Adapter surface, for its namespace.
 * @param deviceId - Device id (state-tree prefix).
 * @param suffix - State suffix relative to the device node.
 * @param label - Display label.
 * @param unit - Unit shown after the value.
 * @param digits - Optional number of decimals.
 */
function cardStateItem(
	adapter: DmAdapterLike,
	deviceId: string,
	suffix: string,
	label: ioBroker.StringOrTranslated,
	unit: string,
	digits?: number,
): CardStateItem {
	return { type: "state", oid: sid(adapter, deviceId, suffix), foreign: true, label, unit, narrow: true, digits };
}

/**
 * Suffix a 1-based index onto every language of a translation (e.g. "String" → "String 3").
 *
 * @param base - The translated word to index.
 * @param n - The 1-based index to append.
 */
function appendIndex(base: Translated, n: number): Translated {
	const out = {} as Translated;
	for (const lang of REQUIRED_LANGS) {
		out[lang] = `${base[lang]} ${n}`;
	}
	return out;
}

/**
 * Grid power + daily energy — shown on every card (DTU and station).
 *
 * @param adapter - Adapter surface, for its namespace.
 * @param deviceId - Device id (state-tree prefix).
 */
function gridCardItems(adapter: DmAdapterLike, deviceId: string): Record<string, CardStateItem> {
	return {
		gridPower: cardStateItem(adapter, deviceId, "grid.power", DM_I18N.cardPower, "W"),
		gridDailyEnergy: cardStateItem(adapter, deviceId, "grid.dailyEnergy", DM_I18N.cardEnergyToday, "kWh", 2),
	};
}

/**
 * Live values on a station card (dm-utils `customInfo`): the aggregated grid power and the energy
 * counters, followed by the monetary yield. All bound to states via `oid` + `foreign` so the GUI
 * keeps them live.
 *
 * The two income lines are only added when the station knows its currency: the cloud fills
 * `todayIncome`/`totalIncome` only where an electricity price is configured, and a bare number
 * without its currency would be meaningless. The currency itself is a plain string state, which
 * the card cannot bind as a unit, so it is read once here and baked into the label's unit.
 *
 * @param adapter - Adapter surface, for its namespace and state reads.
 * @param deviceId - Station device id (`station-<id>`).
 */
async function buildStationCardInfo(adapter: DmAdapterLike, deviceId: string): Promise<DeviceDetails<string>> {
	const items: Record<string, CardStateItem> = gridCardItems(adapter, deviceId);
	// How much of the installed peak power the plant is producing right now. This belongs in the
	// status line as an icon, but custom indicators need dm-utils 3.2.0 and the Admin still ships
	// the 3.0.x GUI, which drops them without a trace — so it goes on the card, where it renders
	// on every version.
	items.pvUtilization = cardStateItem(adapter, deviceId, "grid.pvUtilization", DM_I18N.pvUtilization, "%", 0);
	items.gridYearEnergy = cardStateItem(adapter, deviceId, "grid.yearEnergy", DM_I18N.cardEnergyYear, "kWh", 1);
	items.gridTotalEnergy = cardStateItem(adapter, deviceId, "grid.totalEnergy", DM_I18N.cardEnergyTotal, "kWh", 1);

	const currencyState = await adapter.getStateAsync(`${deviceId}.grid.currency`);
	const currency = typeof currencyState?.val === "string" ? currencyState.val : "";
	if (currency) {
		items.incomeToday = cardStateItem(adapter, deviceId, "grid.todayIncome", DM_I18N.cardIncomeToday, currency, 2);
		items.incomeTotal = cardStateItem(adapter, deviceId, "grid.totalIncome", DM_I18N.cardIncomeTotal, currency, 2);
	}

	return { id: deviceId, schema: { type: "panel", items } as JsonFormSchema };
}

/**
 * Live values on an inverter card: grid power + daily energy, then one line per PV string that
 * exists on this inverter (the count varies by model — a state is added only where a
 * `pvN.power` state is present), plus the inverter temperature. All bound via `oid` + `foreign`.
 *
 * @param adapter - Adapter surface, for its namespace and state reads.
 * @param deviceId - DTU device id (its serial).
 */
async function buildDtuCardInfo(adapter: DmAdapterLike, deviceId: string): Promise<DeviceDetails<string>> {
	const items: Record<string, CardStateItem> = gridCardItems(adapter, deviceId);
	for (let i = 0; i < MAX_PV_PORTS; i++) {
		const state = await adapter.getStateAsync(`${deviceId}.pv${i}.power`);
		if (state !== null && state !== undefined) {
			items[`pv${i}Power`] = cardStateItem(
				adapter,
				deviceId,
				`pv${i}.power`,
				appendIndex(DM_I18N.pvString, i + 1),
				"W",
			);
		}
	}
	items.temperature = cardStateItem(adapter, deviceId, "inverter.temperature", DM_I18N.temperature, "°C", 1);

	return { id: deviceId, schema: { type: "panel", items } as JsonFormSchema };
}

/**
 * Build the DeviceInfo for one DTU/inverter (async: reads the model name for a nice title).
 *
 * The card title prefers the name of the cloud station (plant) the inverter belongs to — the
 * name the user gave it in the S-Miles app — combined with the DTU serial, since the cloud
 * carries no per-inverter name and the serial keeps every inverter distinct (e.g.
 * `Zuhause · 4143A01CEDE4`). Without a station it falls back to `model (serial)` or the serial.
 *
 * @param adapter - Adapter surface used to read states.
 * @param deviceId - DTU device id (its serial).
 * @param obj - The ioBroker device object (its `native.host` decides local vs cloud-only).
 * @param stationName - The inverter's station (app) name, if it belongs to one.
 */
export async function buildDtuDeviceInfo(
	adapter: DmAdapterLike,
	deviceId: string,
	obj: ioBroker.Object,
	stationName?: string,
): Promise<DeviceInfo<string>> {
	const local = isLocalDevice(obj);
	const modelState = await adapter.getStateAsync(`${deviceId}.inverter.model`);
	const model = typeof modelState?.val === "string" && modelState.val ? modelState.val : "";
	const name = stationName ? `${stationName} · ${deviceId}` : model ? `${model} (${deviceId})` : deviceId;

	const status: DeviceInfo<string>["status"] = {
		connection: {
			stateId: sid(adapter, deviceId, "info.connected"),
			mapping: { true: "connected", false: "disconnected" },
		},
	};

	// The signal goes through the built-in `status.rssi` slot rather than a custom indicator.
	// Custom indicators would carry a unit of their own, but they only exist from dm-utils 3.2.0
	// and the Admin still ships the 3.0.x GUI (Admin 7.8.x depends on `@iobroker/dm-utils ^3.0.0`),
	// where an `indicators` array is dropped silently and nothing shows at all.
	//
	// The slot has no unit option, so the unit travels inside the value: the mapping turns the
	// raw quality into the text to display. Colour still follows the slot's dBm thresholds, which
	// put every 0-100 value in the same band — the reading is right, the shade is not graded.
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
		// Firmware-update info from the cloud (`dtu.fwUpdateAvailable`). Besides showing a real
		// update indicator, having an `update` field makes the Device Manager's "only updatable"
		// toggle button appear — without it that global (cross-adapter) filter can hide every
		// device with no button left to switch it off ("all devices filtered out").
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

/**
 * Resolve which cloud station a DTU belongs to, preferring the live registry and falling back to
 * what was last remembered on the device object.
 *
 * `cloudStationId` only exists in the runtime registry and starts out `null`, so in the window
 * between an adapter restart and the first cloud poll the station is unknown — the card title
 * would drop to the model name and stay there until the page is reloaded. Remembering the mapping
 * on the device object closes that window.
 *
 * @param liveStationId - Station id from the runtime registry, or null if not mapped (yet).
 * @param obj - The DTU device object, whose `native.cloudStationId` holds the remembered mapping.
 * @returns The station id to use, and whether the object needs updating.
 */
export function resolveStationId(
	liveStationId: number | null,
	obj: ioBroker.Object,
): { stationId: number | null; persist: boolean } {
	const remembered = (obj.native as { cloudStationId?: unknown } | undefined)?.cloudStationId;
	const known = typeof remembered === "number" ? remembered : null;
	if (liveStationId != null) {
		return { stationId: liveStationId, persist: liveStationId !== known };
	}
	return { stationId: known, persist: false };
}

/** Station status codes that mean the plant is reachable (everything but 0 = Offline). */
const STATION_CONNECTED_MAP: Record<number, "connected" | "disconnected"> = {
	0: "disconnected",
	10: "connected",
	20: "connected",
	30: "connected",
	40: "connected",
	50: "connected",
	60: "connected",
};

/**
 * Build the DeviceInfo for one cloud station (aggregate plant node; no controls).
 *
 * @param adapter - Adapter surface used to build state bindings.
 * @param deviceId - Station device id (`station-<id>`).
 * @param obj - The ioBroker device object (its `common.name` is the plant name).
 */
export async function buildStationDeviceInfo(
	adapter: DmAdapterLike,
	deviceId: string,
	obj: ioBroker.Object,
): Promise<DeviceInfo<string>> {
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

/**
 * Values a device reports for a network field it does not have. An HMS inverter answers the
 * family-wide GetConfig message with an all-zero wired half; showing those rows would state an
 * address the device does not have.
 */
const EMPTY_NETWORK_VALUES = new Set(["0.0.0.0", "00:00:00:00:00:00", "0.0.0.0.0.0", ""]);

/**
 * True if the device reports something worth showing for this field.
 *
 * A missing state is skipped, and so is one whose value is a placeholder for "not present". The
 * numeric 0 is kept — for a flag such as DHCP it is a real answer, not an absence.
 *
 * @param adapter - Adapter surface used to read the state.
 * @param deviceId - Device id (state-tree prefix).
 * @param suffix - State suffix relative to the device node.
 */
async function hasMeaningfulValue(adapter: DmAdapterLike, deviceId: string, suffix: string): Promise<boolean> {
	const state = await adapter.getStateAsync(`${deviceId}.${suffix}`);
	if (state === null || state === undefined || state.val === null || state.val === undefined) {
		return false;
	}
	if (typeof state.val === "string") {
		return !EMPTY_NETWORK_VALUES.has(state.val.trim());
	}
	return true;
}

/**
 * Read-only details panel. Field labels come from the state definitions.
 *
 * @param adapter - Adapter surface used to read the device object.
 * @param deviceId - Device id (DTU serial or `station-<id>`).
 */
export async function buildDeviceDetails(
	adapter: DmAdapterLike,
	deviceId: string,
): Promise<DeviceDetails<string> | { error: string }> {
	const obj = await adapter.getForeignObjectAsync(`${adapter.namespace}.${deviceId}`);
	if (!obj) {
		return { error: "device not found" };
	}
	const kind = classifyDevice(obj);
	const items: Record<string, unknown> = {
		_header: { type: "header", text: DM_I18N.detailsHeader, size: 2 },
	};

	// The panel used to rely on the GUI pulling each row's caption from the object behind `oid`.
	// It does not — the dialog showed a bare column of values — so the label is set explicitly,
	// taken from the state definition so it stays the same text the object carries.
	//
	// `newLine` and `addColon` follow the layout the zigbee2mqtt adapter uses for the same kind of
	// panel: without `newLine` the fields flow into the JsonConfig grid instead of forming one
	// labelled row each. `foreign` with the namespace-qualified id is how a state row is bound
	// there and on our own cards; the relative form happened to resolve but is not the documented
	// one.
	const addState = (key: string, suffix: string): void => {
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

	// Section heading inside the details panel.
	const addHeader = (key: string, label: Translated): void => {
		items[`${key}_h`] = { type: "header", text: label, size: 4, newLine: true };
		items[key] = { type: "divider", color: "primary" };
	};

	if (kind === "station") {
		addState("capacity", "info.systemCapacity");
		addState("status", "info.stationStatus");
		addState("address", "info.address");
		addState("lastUpdate", "info.lastCloudUpdate");
	} else {
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

		// Network identity — only ever filled over the local link, so a cloud-only device simply
		// shows nothing here rather than a column of empty rows.
		//
		// The wired fields (`config.ipAddress`, `config.macAddress`, subnet, gateway, DNS) are not
		// a duplicate of the WiFi ones: GetConfig is one message for the whole Hoymiles DTU family
		// and also carries APN, GPRS and Sub-1GHz fields. An HMS inverter has a WiFi SoC and no
		// Ethernet port, so its wired half stays at 0.0.0.0 / 00:00:00:00:00:00 forever. Rather
		// than deciding by model, each row is dropped when the device reports nothing for it —
		// that also hides a WiFi field the device leaves empty, instead of claiming 0.0.0.0 is
		// the address.
		if (isLocalDevice(obj)) {
			const network: Array<[string, string]> = [
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
			const present: Array<[string, string]> = [];
			for (const [key, suffix] of network) {
				if (await hasMeaningfulValue(adapter, deviceId, suffix)) {
					present.push([key, suffix]);
				}
			}
			if (present.length) {
				addHeader("_hNetwork", DM_I18N.detailsNetwork);
				// The address the adapter actually talks to. The device's own WiFi field is often
				// left empty, and this one is known for certain — it is the connection in use.
				const host = (obj.native as { host?: unknown }).host;
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
		schema: { type: "panel", items } as JsonFormSchema,
	};
}

/**
 * Instance-level actions shown above the device list (refresh / scan / cloud-login test).
 *
 * @param adapter - Adapter surface providing the scan / cloud-login diagnostics.
 */
export function buildInstanceInfo(adapter: DmAdapterLike): InstanceDetails {
	return {
		apiVersion: "v3",
		actions: [
			// No custom "refresh" action — the Device Manager toolbar already has a built-in
			// refresh button; adding our own only duplicated it.
			{
				id: "discover",
				icon: "search",
				title: DM_I18N.discover,
				// The scan probes every host of the local /24 subnet(s) on port 10081. With a
				// 1.5 s per-host timeout an empty subnet takes ~10 s (more with several NICs) —
				// well past the GUI's default backend wait, which is why it reported "no response
				// from backend". Give it a generous window so the GUI waits for the real result.
				timeout: 120000,
				handler: async (context: ActionContext): Promise<{ refresh: boolean }> => {
					const summary = await adapter.dmScanNetwork();
					await context.showMessage(summary);
					return { refresh: true };
				},
			},
			{
				id: "testCloud",
				icon: "info",
				title: DM_I18N.testCloud,
				// Cloud login diagnostics make several sequential HTTP calls; also past the default.
				timeout: 60000,
				handler: async (context: ActionContext): Promise<{ refresh: boolean }> => {
					const summary = await adapter.dmTestCloudLogin();
					await context.showMessage(summary);
					return { refresh: false };
				},
			},
		],
	};
}

/**
 * Device Manager backend for the Hoymiles adapter. Thin shell over the exported pure builders
 * (which are unit-tested); the base class handles all `dm:*` messaging via the adapter message
 * channel (bound in its constructor, torn down with the adapter instance — no explicit cleanup).
 */
export class HoymilesDeviceManagement extends DeviceManagement<HoymilesDmAdapter> {
	protected override getInstanceInfo(): InstanceDetails {
		return buildInstanceInfo(this.adapter);
	}

	protected override async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
		const objs = await this.adapter.getForeignObjectsAsync(`${this.adapter.namespace}.*`, "device");
		const entries = Object.entries(objs);

		const infos: DeviceInfo<string>[] = [];
		for (const [fullId, obj] of entries) {
			const deviceId = fullId.slice(this.adapter.namespace.length + 1);
			const kind = classifyDevice(obj);
			if (kind === "dtu") {
				// Name the inverter after its cloud station (the app plant name) plus its DTU
				// serial, which keeps every inverter distinct. Falls back to model/serial below.
				//
				const live = this.adapter.devices.get(deviceId)?.cloudStationId ?? null;
				const { stationId, persist } = resolveStationId(live, obj);
				if (persist && stationId != null) {
					await this.adapter.extendObjectAsync(deviceId, { native: { cloudStationId: stationId } });
				}
				let stationName: string | undefined;
				if (stationId != null) {
					const cn = objs[`${this.adapter.namespace}.station-${stationId}`]?.common?.name;
					if (typeof cn === "string" && cn) {
						stationName = cn;
					}
				}
				infos.push(await buildDtuDeviceInfo(this.adapter, deviceId, obj, stationName));
			} else if (kind === "station") {
				infos.push(await buildStationDeviceInfo(this.adapter, deviceId, obj));
			}
		}
		context.setTotalDevices(infos.length);
		for (const info of infos) {
			context.addDevice(info);
		}
	}

	protected override getDeviceDetails(id: string): Promise<DeviceDetails<string> | { error: string }> {
		return buildDeviceDetails(this.adapter, id);
	}
}
