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
import { inverterIcon, STATION_ICON } from "./deviceIcons.js";

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
		it: "Inverter on/off",
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
		en: "Clear warnings",
		de: "Warnungen löschen",
		ru: "Очистить предупреждения",
		pt: "Limpar avisos",
		nl: "Waarschuwingen wissen",
		fr: "Effacer les avertissements",
		it: "Cancella avvisi",
		es: "Borrar advertencias",
		pl: "Wyczyść ostrzeżenia",
		uk: "Очистити попередження",
		"zh-cn": "清除警告",
	},
	cleanGroundingFault: {
		en: "Clear grounding fault",
		de: "Erdungsfehler löschen",
		ru: "Сбросить ошибку заземления",
		pt: "Limpar falha de aterramento",
		nl: "Aardingsfout wissen",
		fr: "Effacer le défaut de mise à la terre",
		it: "Cancella guasto di terra",
		es: "Borrar fallo de puesta a tierra",
		pl: "Wyczyść błąd uziemienia",
		uk: "Скинути помилку заземлення",
		"zh-cn": "清除接地故障",
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
		en: "Persistent power limit",
		de: "Persistentes Leistungslimit",
		ru: "Постоянное ограничение мощности",
		pt: "Limite de potência persistente",
		nl: "Permanente vermogenslimiet",
		fr: "Limite de puissance permanente",
		it: "Limite di potenza persistente",
		es: "Límite de potencia persistente",
		pl: "Trwały limit mocy",
		uk: "Постійне обмеження потужності",
		"zh-cn": "持久功率限制",
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
	helpSendTime: {
		en: "How often the DTU uploads to the cloud (minutes).",
		de: "Wie oft die DTU in die Cloud sendet (Minuten).",
		ru: "Как часто DTU отправляет данные в облако (минуты).",
		pt: "Com que frequência o DTU envia para a nuvem (minutos).",
		nl: "Hoe vaak de DTU naar de cloud uploadt (minuten).",
		fr: "Fréquence d'envoi du DTU vers le cloud (minutes).",
		it: "Con quale frequenza il DTU carica nel cloud (minuti).",
		es: "Con qué frecuencia el DTU sube a la nube (minutos).",
		pl: "Jak często DTU wysyła dane do chmury (minuty).",
		uk: "Як часто DTU надсилає дані в хмару (хвилини).",
		"zh-cn": "DTU上传到云端的频率（分钟）。",
	},
	helpPersistentLimit: {
		en: "Power limit stored in the DTU; survives a restart (2–100%).",
		de: "In der DTU gespeichertes Leistungslimit; übersteht einen Neustart (2–100%).",
		ru: "Ограничение мощности, хранящееся в DTU; сохраняется после перезапуска (2–100%).",
		pt: "Limite de potência armazenado no DTU; persiste após reinício (2–100%).",
		nl: "In de DTU opgeslagen vermogenslimiet; blijft na herstart behouden (2–100%).",
		fr: "Limite de puissance stockée dans le DTU ; conservée après un redémarrage (2–100%).",
		it: "Limite di potenza memorizzato nel DTU; sopravvive a un riavvio (2–100%).",
		es: "Límite de potencia almacenado en el DTU; persiste tras un reinicio (2–100%).",
		pl: "Limit mocy zapisany w DTU; przetrwa restart (2–100%).",
		uk: "Обмеження потужності, збережене в DTU; зберігається після перезапуску (2–100%).",
		"zh-cn": "存储在DTU中的功率限制；重启后保留（2–100%）。",
	},
} satisfies Record<string, Translated>;

/** A controllable writable state, and how it should appear on the device card. */
interface CommandDef {
	/** State id relative to the device node, e.g. `inverter.powerLimit`. Must be in WRITABLE_STATES. */
	id: string;
	/** `control` = stateful widget (switch/slider/number); `action` = momentary button. */
	ui: "control" | "action";
	/** Widget kind for controls. */
	kind?: "switch" | "slider" | "number";
	/** Translation key in {@link DM_I18N} for the label. */
	label: keyof typeof DM_I18N;
	/** Translation key for a confirmation prompt (actions only). `true` = generic GUI confirm. */
	confirm?: keyof typeof DM_I18N | true;
	icon?: string;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	/** Available on cloud-only devices (subset the cloud control channel can actuate). */
	cloudCapable: boolean;
}

/**
 * Single source of truth binding every writable state to its Device-Manager widget.
 * Kept consistent with {@link WRITABLE_STATES} by a unit test, so neither can drift.
 */
export const COMMAND_DEFS: CommandDef[] = [
	{
		id: "inverter.powerLimit",
		ui: "control",
		kind: "slider",
		label: "powerLimit",
		min: 0,
		max: 100,
		unit: "%",
		cloudCapable: false,
	},
	{ id: "inverter.active", ui: "control", kind: "switch", label: "active", icon: "socket", cloudCapable: true },
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
		id: "inverter.powerFactorLimit",
		ui: "control",
		kind: "number",
		label: "powerFactorLimit",
		min: -1,
		max: 1,
		step: 0.1,
		cloudCapable: false,
	},
	{
		id: "inverter.reactivePowerLimit",
		ui: "control",
		kind: "number",
		label: "reactivePowerLimit",
		min: -50,
		max: 50,
		unit: "°",
		cloudCapable: false,
	},
	{ id: "inverter.cleanWarnings", ui: "action", label: "cleanWarnings", confirm: true, cloudCapable: false },
	{
		id: "inverter.cleanGroundingFault",
		ui: "action",
		label: "cleanGroundingFault",
		confirm: true,
		cloudCapable: false,
	},
	{ id: "inverter.lock", ui: "control", kind: "switch", label: "lock", cloudCapable: false },
	{
		id: "config.serverSendTime",
		ui: "control",
		kind: "number",
		label: "serverSendTime",
		min: 1,
		unit: "min",
		cloudCapable: false,
	},
	{
		id: "config.limitPowerMyPower",
		ui: "control",
		kind: "slider",
		label: "limitPowerMyPower",
		min: 2,
		max: 100,
		unit: "%",
		cloudCapable: false,
	},
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
 * Build the stateful controls for one DTU. Local-only commands are omitted entirely for
 * cloud-only devices (dm-utils controls have no "disabled" flag), leaving just the
 * cloud-actuatable subset so the card never offers a control that would do nothing.
 *
 * @param adapter - Adapter surface used to read/write states.
 * @param deviceId - DTU device id (its serial), the state-tree prefix.
 * @param isLocal - Whether the DTU has a local TCP link (enables the local-only controls).
 */
export function buildControls(adapter: DmAdapterLike, deviceId: string, isLocal: boolean): DeviceControl<string>[] {
	return COMMAND_DEFS.filter(d => d.ui === "control" && (isLocal || d.cloudCapable)).map(d => {
		const label = DM_I18N[d.label];
		const stateId = sid(adapter, deviceId, d.id);
		const control: DeviceControl<string> = {
			id: d.id,
			type: d.kind ?? "number",
			label,
			stateId,
			icon: d.icon,
			min: d.min,
			max: d.max,
			step: d.step,
			unit: d.unit,
			handler: async (_devId, controlId, state: ControlState) => {
				await adapter.setStateAsync(`${deviceId}.${controlId}`, state, false);
				return (await adapter.getStateAsync(`${deviceId}.${controlId}`)) ?? STATE_NOT_FOUND;
			},
			getStateHandler: async (_devId, controlId) =>
				(await adapter.getStateAsync(`${deviceId}.${controlId}`)) ?? STATE_NOT_FOUND,
		};
		return control;
	});
}

/** JsonConfig schema for the per-inverter settings form (SetConfig values). */
export const SETTINGS_SCHEMA: JsonFormSchema = {
	type: "panel",
	items: {
		serverSendTime: {
			type: "number",
			label: DM_I18N.serverSendTime,
			help: DM_I18N.helpSendTime,
			min: 1,
			sm: 12,
		},
		limitPowerMyPower: {
			type: "slider",
			label: DM_I18N.limitPowerMyPower,
			help: DM_I18N.helpPersistentLimit,
			min: 2,
			max: 100,
			sm: 12,
		},
	},
};

/**
 * Build the momentary actions for one DTU (reboots, clear-warning buttons) plus the settings
 * form. Each writes the underlying writable state with `ack: false` so the existing command
 * route actuates it. Local-only actions are skipped for cloud-only devices.
 *
 * @param adapter - Adapter surface used to read/write states.
 * @param deviceId - DTU device id (its serial), the state-tree prefix.
 * @param isLocal - Whether the DTU has a local TCP link (enables the local-only actions + settings).
 */
export function buildDeviceActions(adapter: DmAdapterLike, deviceId: string, isLocal: boolean): DeviceAction<string>[] {
	const actions: DeviceAction<string>[] = COMMAND_DEFS.filter(
		d => d.ui === "action" && (isLocal || d.cloudCapable),
	).map(d => ({
		id: d.id,
		icon: d.icon,
		description: DM_I18N[d.label],
		confirmation: d.confirm === true ? true : d.confirm ? DM_I18N[d.confirm] : undefined,
		handler: async (): Promise<{ refresh: "none" }> => {
			await adapter.setStateAsync(`${deviceId}.${d.id}`, true, false);
			return { refresh: "none" };
		},
	}));

	// Settings form — only for locally-reachable devices (config.* commands are local-only).
	if (isLocal) {
		actions.push({
			id: "settings",
			icon: "settings",
			description: DM_I18N.settings,
			handler: async (_devId, context: ActionContext): Promise<{ refresh: "none" }> => {
				const sendTime = await adapter.getStateAsync(`${deviceId}.config.serverSendTime`);
				const limit = await adapter.getStateAsync(`${deviceId}.config.limitPowerMyPower`);
				const result = await context.showForm(SETTINGS_SCHEMA, {
					data: {
						serverSendTime: typeof sendTime?.val === "number" ? sendTime.val : undefined,
						limitPowerMyPower: typeof limit?.val === "number" ? limit.val : undefined,
					},
					title: DM_I18N.settingsTitle,
				});
				if (result) {
					if (result.serverSendTime !== undefined && result.serverSendTime !== null) {
						await adapter.setStateAsync(
							`${deviceId}.config.serverSendTime`,
							Number(result.serverSendTime),
							false,
						);
					}
					if (result.limitPowerMyPower !== undefined && result.limitPowerMyPower !== null) {
						await adapter.setStateAsync(
							`${deviceId}.config.limitPowerMyPower`,
							Number(result.limitPowerMyPower),
							false,
						);
					}
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
 * Live values on a station card (dm-utils `customInfo`): the aggregated grid power and daily
 * energy, bound to states via `oid` + `foreign` so the GUI keeps them live.
 *
 * @param adapter - Adapter surface, for its namespace.
 * @param deviceId - Station device id (`station-<id>`).
 */
function buildStationCardInfo(adapter: DmAdapterLike, deviceId: string): DeviceDetails<string> {
	return { id: deviceId, schema: { type: "panel", items: gridCardItems(adapter, deviceId) } };
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
	if (local) {
		status.rssi = { stateId: sid(adapter, deviceId, "dtu.rssi") };
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
		actions: buildDeviceActions(adapter, deviceId, local),
		hasDetails: true,
	};
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
export function buildStationDeviceInfo(
	adapter: DmAdapterLike,
	deviceId: string,
	obj: ioBroker.Object,
): DeviceInfo<string> {
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
		customInfo: buildStationCardInfo(adapter, deviceId),
		hasDetails: true,
	};
}

/**
 * Read-only details panel. Field labels come from the states' own object names (via `oid`).
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

	const addState = (key: string, suffix: string): void => {
		items[key] = { type: "state", oid: `${deviceId}.${suffix}`, control: "text", readOnly: true, narrow: true };
	};

	if (kind === "station") {
		addState("capacity", "info.systemCapacity");
		addState("status", "info.stationStatus");
		addState("address", "info.address");
		addState("lastUpdate", "info.lastCloudUpdate");
	} else {
		addState("model", "inverter.model");
		addState("invSerial", "inverter.serialNumber");
		addState("invHw", "inverter.hwVersion");
		addState("invSw", "inverter.swVersion");
		addState("dtuSerial", "dtu.serialNumber");
		addState("dtuSw", "dtu.swVersion");
		addState("rssi", "dtu.rssi");
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
				const stationId = this.adapter.devices.get(deviceId)?.cloudStationId ?? null;
				let stationName: string | undefined;
				if (stationId != null) {
					const cn = objs[`${this.adapter.namespace}.station-${stationId}`]?.common?.name;
					if (typeof cn === "string" && cn) {
						stationName = cn;
					}
				}
				infos.push(await buildDtuDeviceInfo(this.adapter, deviceId, obj, stationName));
			} else if (kind === "station") {
				infos.push(buildStationDeviceInfo(this.adapter, deviceId, obj));
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
