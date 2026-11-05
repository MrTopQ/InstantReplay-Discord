/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Messages } from "./en";

export const ru: Messages = {
    pluginDescription:
        "Держит кольцевой буфер экрана и по горячей клавише сохраняет последние минуты в файл. " +
        "Картинку берёт у оконного менеджера Windows, а не у видеокарты, поэтому работает на " +
        "гибридных ноутбуках, где ShadowPlay не видит цели для захвата и отказывается писать всё, " +
        "что не является игрой.",

    settingLanguage: "Язык текста плагина. «Авто» следует за языком, выбранным в Discord",
    settingLanguageAuto: "Авто (как в Discord)",
    settingBufferSeconds:
        "Сколько секунд хранить. Буфер живёт в оперативной памяти и держит ровно это окно, " +
        "не больше, поэтому окно вместе с битрейтом и задаёт расход",
    settingResolution: "Разрешение записи. Если клиент начнёт подтормаживать, опускай его первым",
    settingFrameRate: "Кадров в секунду",
    settingBitrate:
        "Битрейт видео в Мбит в секунду. Он же главный расход памяти, потому что буфер всё " +
        "время держит окно видео. Шести хватает с запасом, выше глазом почти не отличается",
    settingCaptureAudio:
        "Записывать системный звук. Windows отдаёт весь системный микс, поэтому музыка и браузер " +
        "попадут в клип вместе с Discord",
    settingMicMode:
        "Твой голос в клипах. Системный звук это только то, что играет в колонках, поэтому без микрофона " +
        "тебя самого в клипе не слышно. «Как в Discord» пишет голос только пока Discord тебя передаёт, по " +
        "активации голосом или рации, с громкостью и обработкой из его настроек голоса. В муте и вне звонка " +
        "голоса в клипе нет. Krisp повторить нельзя, вместо него обычный шумодав. Голос отстаёт от картинки " +
        "на 0,15 с, чтобы не обрезался первый слог",
    micModeDiscord: "Как в Discord, только когда говоришь в войсе",
    micModeAlways: "Микрофон целиком, всё время",
    micModeOff: "Не записывать",
    settingSource:
        "Что снимать. Захват одного окна не пускает в файл ничего постороннего с экрана, клип " +
        "меньше и кодировщику легче, но стрим, открытый отдельным окном, останется за кадром",
    sourceScreen: "Весь экран",
    sourceWindow: "Только Discord",
    settingGrace:
        "Сколько секунд буфер работает после выхода из голосового канала. Если за это время зайти в " +
        "другой канал, он продолжит работать и ничего не потеряет",
    settingSaveSoundVolume:
        "Громкость сигнала о сохранённом клипе, в процентах. Сигнал звучит сразу, как только клип пойман, " +
        "не дожидаясь файла, и слышен поверх полноэкранной игры, где Windows глушит свои уведомления. " +
        "На нуле сигнала нет",
    settingAnnounceSave: "Показывать уведомление о сохранённом клипе",
    settingNotifySound:
        "Звук у этого уведомления. Когда Discord не в фокусе, уведомление приходит от Windows и звенит её " +
        "звуком. Выключи, чтобы оно приходило молча",
    settingHotkey: "Горячая клавиша сохранения буфера",
    settingGlobalHotkey:
        "Перехватывать клавишу системно, чтобы она срабатывала и когда Discord свёрнут или поверх " +
        "него идёт игра. Комбинацию может уже держать другая программа, тогда плагин скажет об " +
        "этом, а не промолчит",
    settingScreen: "Какой экран записывать",
    screenPrimary: "основной",
    screenLabel: (index: number, name: string) => `Экран ${index + 1} (${name})`,
    settingMode: "Когда буферу работать",
    modeAlways: "Всегда, с запуска",
    modeVoice: "Только в голосовом канале",

    stateRecording: "Идёт запись",
    stateStarting: "Запускается",
    stateGrace: "Войс покинут, запись доживает",
    stateWaiting: "Ждёт голосового канала",
    stateStopped: "Остановлен",
    stateRecovering: "Упал и поднимется сам",
    statePluginOff: "Плагин выключен",
    stateWaitingHint: "Буфер запустится сам, как только зайдёшь в голосовой канал",
    stateStoppedHint: "Сейчас ничего не записывается",
    heroOf: (target: string) => `из ${target}`,
    heroFilling: "набирается",
    heroFull: "окно заполнено",
    tileMemory: "в памяти",
    tilePerMinute: "в минуту",
    tileCeiling: (max: string) => `потолок ${max}`,
    tileCeilingOnly: "в минуту, не больше",
    audioLive: "Звук идёт",
    audioQuiet: "Сейчас тихо",
    audioSilent: "Звук пропал",
    audioOff: "Звук выключен",
    buttonStart: "Запустить буфер",
    buttonStop: "Остановить",
    buttonSave: (duration: string) => `Сохранить последние ${duration}`,
    buttonSaveEmpty: "Сохранить повтор",
    buttonSaving: "Сохраняю",
    subtitle: (size: string, fps: number, mbps: number) => `${size}, ${fps} к/с, ${mbps} Мбит/с`,

    detailsShow: "Подробнее",
    detailsHide: "Скрыть подробности",
    detailFormat: "Формат",
    detailVideo: "Видеодорожка",
    videoRelay: "Ретранслятор кадров в воркере",
    videoPage: "Ретранслятор кадров на главном потоке Discord",
    videoDirect: "Прямо с захвата",
    detailFolder: "Папка с клипами",
    detailLastEvent: "Последнее событие",
    voiceCheckOk: "Голос как в Discord работает",
    voiceCheckBroken: "Голос как в Discord не работает",
    voiceCheckPart: {
        speaking: "Видно, когда ты говоришь",
        mute: "Видно мут и громкость микрофона",
        channel: "Видно, в каком ты канале"
    },
    voiceCheckNote: (time: string) => `Проверено в ${time}. Нажми, чтобы проверить ещё раз`,
    detailPatch:
        "Кнопка в строке заголовка держится на патче Discord. Пропала после обновления клиента, значит " +
        "патч не подошёл, и это чинится обновлением плагина, а не настройкой",

    sizeKB: (value: string) => `${value} КБ`,
    sizeMB: (value: string) => `${value} МБ`,
    sizeGB: (value: string) => `${value} ГБ`,
    dayToday: "сегодня",
    dayYesterday: "вчера",

    durationMinutes: (mins: number, secs: number) => `${mins} мин ${secs} с`,
    durationSeconds: (secs: number) => `${secs} с`,

    toastStarted: "Буфер повтора запущен",
    toastStartFailed: (message: string) => `Буфер повтора не запустился. ${message}`,
    toastNotRunning: "Буфер повтора не запущен",
    toastPluginOff: "InstantReplay выключен, запускать нечего",
    toastSaving: "Сохраняю повтор",
    toastSaved: (name: string) => `Повтор сохранён как ${name}`,
    toastSaveFailed: (message: string) => `Сохранить не удалось. ${message}`,
    toastGlobalHotkeyClaimed: (hotkey: string) => `${hotkey} перехвачена системно`,
    toastGlobalHotkeyBusy: (hotkey: string) =>
        `Другая программа уже держит ${hotkey}, поэтому комбинация срабатывает, только когда Discord в фокусе`,
    notifySavedTitle: "Повтор сохранён",
    notifySavedBody: (name: string, duration: string) => `${name}, ${duration}. Нажми, чтобы открыть папку`,

    errorNoFormat: "В этой сборке Chromium нет ни одного подходящего формата записи",
    errorNoSource: "Electron не сообщил ни одного экрана для захвата",
    errorNoWindow: "Electron не смог указать на окно Discord",
    errorCaptureTimeout: (seconds: number) => `Захват экрана не ответил за ${seconds} с, буфер попробует ещё раз`,
    errorCaptureEnded: "Захват экрана прекратился сам, буфер остановлен",
    errorCaptureLost: "Захват экрана прекратился. Буфер держит последний кадр и ждёт, когда картинка вернётся",
    errorCaptureBack: "Захват экрана вернулся, накопленное не пострадало",
    errorAudioStalled: "Звуковой микшер встал, обычно после отказа устройства вывода, поэтому буфер перезапущен",
    errorAudioEnded: "Источник звука пропал, буфер подхватывает новый",
    errorSizeChanged: (from: string, to: string) => `Размер кадра сменился с ${from} на ${to}, буфер поднят заново`,
    errorScreenGone: (name: string) => `Выбранного экрана нет, пишется «${name}»`,
    errorRelayFrozen: "Ретранслятор кадров не получил ни одного кадра, запись идёт прямо с захвата",
    voiceGateMissing:
        "Discord изменился, и плагин больше не видит, когда ты говоришь. Пока это не исправит обновление " +
        "плагина, голос пишется с микрофона целиком",
    errorNotRunning: "Буфер не запущен",
    errorAlreadySaving: "Сохранение уже идёт",
    errorBufferEmpty: "Буфер пуст",
    errorEmptyFile: "Буфер выдал пустой файл",
    errorNoSpace: "На диске с клипами не хватает свободного места",
    errorRecorder: (name: string) => `Запись прервалась с ошибкой ${name}`,
    errorNoDuration: "Клип ушёл без длительности в заголовке, плеер покажет 0:00 и не даст перемотку",
    errorStreamLost: "Поток записи перестал разбираться, запись поднята заново",
    errorStaleMain:
        "Главный процесс Discord остался от прошлой сборки плагина. Клип сохранён, но без " +
        "длительности. Полный перезапуск клиента, а не перезагрузка страницы, это чинит",

    toolboxSave: "Сохранить повтор",
    toolboxOpen: "Открыть InstantReplay",

    headerTooltip: (state: string) => `InstantReplay, ${state}`,
    headerState: {
        off: "буфер выключен",
        waiting: "ждёт голосового канала",
        live: "идёт запись",
        silent: "идёт запись, но звук пропал",
        saving: "сохраняет клип",
        error: "остановлен из-за сбоя"
    },

    clipsRecent: "Последние клипы",
    clipsNone: "Пока ничего не сохранено. Нажми горячую клавишу, когда случится момент",
    clipOpen: "Смотреть",
    clipReveal: "Показать в папке",
    clipsFolder: "Открыть папку",

    windowSettings: "Настройки",
    hotkeyChange: "Сменить горячую клавишу",
    hotkeyListening: "Нажми комбинацию",
    hotkeyNeedsModifier: "Добавь Ctrl, Alt или Win",
    hotkeyUnsupported: "Эту клавишу назначить нельзя",
    windowClose: "Закрыть"
};
