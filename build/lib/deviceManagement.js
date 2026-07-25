import { DeviceManagement } from "@iobroker/dm-utils";
import { MAX_PV_PORTS } from "./deviceContext.js";
import { inverterIcon, STATION_ICON } from "./deviceIcons.js";
export const REQUIRED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"];
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
};
export const COMMAND_DEFS = [
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
export function buildControls(adapter, deviceId, isLocal) {
    return COMMAND_DEFS.filter(d => d.ui === "control" && (isLocal || d.cloudCapable)).map(d => {
        const label = DM_I18N[d.label];
        const stateId = sid(adapter, deviceId, d.id);
        const control = {
            id: d.id,
            type: d.kind ?? "number",
            label,
            stateId,
            icon: d.icon,
            min: d.min,
            max: d.max,
            step: d.step,
            unit: d.unit,
            handler: async (_devId, controlId, state) => {
                await adapter.setStateAsync(`${deviceId}.${controlId}`, state, false);
                return (await adapter.getStateAsync(`${deviceId}.${controlId}`)) ?? STATE_NOT_FOUND;
            },
            getStateHandler: async (_devId, controlId) => (await adapter.getStateAsync(`${deviceId}.${controlId}`)) ?? STATE_NOT_FOUND,
        };
        return control;
    });
}
export const SETTINGS_SCHEMA = {
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
export function buildDeviceActions(adapter, deviceId, isLocal) {
    const actions = COMMAND_DEFS.filter(d => d.ui === "action" && (isLocal || d.cloudCapable)).map(d => ({
        id: d.id,
        icon: d.icon,
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
                        await adapter.setStateAsync(`${deviceId}.config.serverSendTime`, Number(result.serverSendTime), false);
                    }
                    if (result.limitPowerMyPower !== undefined && result.limitPowerMyPower !== null) {
                        await adapter.setStateAsync(`${deviceId}.config.limitPowerMyPower`, Number(result.limitPowerMyPower), false);
                    }
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
function buildStationCardInfo(adapter, deviceId) {
    return { id: deviceId, schema: { type: "panel", items: gridCardItems(adapter, deviceId) } };
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
        status.rssi = { stateId: sid(adapter, deviceId, "dtu.rssi") };
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
        actions: buildDeviceActions(adapter, deviceId, local),
        hasDetails: true,
    };
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
export function buildStationDeviceInfo(adapter, deviceId, obj) {
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
        items[key] = { type: "state", oid: `${deviceId}.${suffix}`, control: "text", readOnly: true, narrow: true };
    };
    if (kind === "station") {
        addState("capacity", "info.systemCapacity");
        addState("status", "info.stationStatus");
        addState("address", "info.address");
        addState("lastUpdate", "info.lastCloudUpdate");
    }
    else {
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
                const stationId = this.adapter.devices.get(deviceId)?.cloudStationId ?? null;
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
                infos.push(buildStationDeviceInfo(this.adapter, deviceId, obj));
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