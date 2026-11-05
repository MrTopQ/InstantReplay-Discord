/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange, OptionType } from "@utils/types";

import { AUTO_LANGUAGE, LANGUAGE_CODES, LANGUAGE_LABELS, resetLocaleCache, T } from "./i18n";
import { getCachedSources } from "./recorder";

export const DEFAULT_HOTKEY = "Ctrl+Alt+S";

export const DEFAULT_RESOLUTION = "1280x720";

export const RESOLUTIONS: Record<string, { width: number; height: number; }> = {
    "1920x1080": { width: 1920, height: 1080 },
    "1600x900": { width: 1600, height: 900 },
    "1280x720": { width: 1280, height: 720 },
    "854x480": { width: 854, height: 480 }
};

const BUFFER_SECONDS = makeRange(30, 600, 30);
const FRAME_RATES = makeRange(15, 60, 15);
const BITRATES_MBPS = makeRange(2, 12, 2);
export const MIN_BITRATE_MBPS = 2;
export const MAX_BITRATE_MBPS = 12;
const GRACE_SECONDS = makeRange(0, 300, 30);

let captureChanged: () => void = () => { };
let hotkeyChanged: () => void = () => { };
let modeChanged: () => void = () => { };
let bufferChanged: () => void = () => { };

export function onCaptureSettingsChanged(handler: () => void): void {
    captureChanged = handler;
}

export function onBufferSecondsChanged(handler: () => void): void {
    bufferChanged = handler;
}

export function onHotkeySettingsChanged(handler: () => void): void {
    hotkeyChanged = handler;
}

export function onModeChanged(handler: () => void): void {
    modeChanged = handler;
}

export function migrateSettings(): void {
    const store = settings.store as Record<string, unknown>;

    if (store.captureMic !== undefined) {
        if (store.captureMic === false) settings.store.micMode = "off";
        delete store.captureMic;
    }

    if (store.saveSound !== undefined) {
        if (store.saveSound === "off") settings.store.saveSoundVolume = 0;
        delete store.saveSound;
    }
}

const notifyCaptureChange = () => captureChanged();
const notifyHotkeyChange = () => hotkeyChanged();
const notifyModeChange = () => modeChanged();
const notifyBufferChange = () => bufferChanged();

export const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        get description() {
            return T.settingLanguage;
        },
        get options() {
            return [
                { label: T.settingLanguageAuto, value: AUTO_LANGUAGE, default: true },
                ...LANGUAGE_CODES.map(code => ({ label: LANGUAGE_LABELS[code] ?? code, value: code }))
            ];
        },
        onChange: resetLocaleCache
    },
    bufferSeconds: {
        type: OptionType.SLIDER,
        get description() {
            return T.settingBufferSeconds;
        },
        markers: BUFFER_SECONDS,
        default: 120,
        stickToMarkers: true,
        target: "DESKTOP",
        onChange: notifyBufferChange
    },
    resolution: {
        type: OptionType.SELECT,
        get description() {
            return T.settingResolution;
        },
        get options() {
            return Object.keys(RESOLUTIONS).map(value => ({
                label: value,
                value,
                default: value === DEFAULT_RESOLUTION
            }));
        },
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    frameRate: {
        type: OptionType.SLIDER,
        get description() {
            return T.settingFrameRate;
        },
        markers: FRAME_RATES,
        default: 30,
        stickToMarkers: true,
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    bitrateMbps: {
        type: OptionType.SLIDER,
        get description() {
            return T.settingBitrate;
        },
        markers: BITRATES_MBPS,
        default: 6,
        stickToMarkers: true,
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    source: {
        type: OptionType.SELECT,
        get description() {
            return T.settingSource;
        },
        get options() {
            return [
                { label: T.sourceScreen, value: "screen", default: true },
                { label: T.sourceWindow, value: "window" }
            ];
        },
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    captureAudio: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingCaptureAudio;
        },
        default: true,
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    micMode: {
        type: OptionType.SELECT,
        get description() {
            return T.settingMicMode;
        },
        get options() {
            return [
                { label: T.micModeDiscord, value: "discord", default: true },
                { label: T.micModeAlways, value: "always" },
                { label: T.micModeOff, value: "off" }
            ];
        },
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    screenIndex: {
        type: OptionType.SELECT,
        get description() {
            return T.settingScreen;
        },
        disabled() {
            return this.store.source === "window";
        },
        get options() {
            const sources = getCachedSources();

            if (!sources.length) {
                return [{ label: T.screenLabel(0, T.screenPrimary), value: "0", default: true }];
            }

            return sources.map((source, index) => ({
                label: T.screenLabel(index, source.name),
                value: String(index),
                default: index === 0
            }));
        },
        target: "DESKTOP",
        onChange: notifyCaptureChange
    },
    saveSoundVolume: {
        type: OptionType.SLIDER,
        get description() {
            return T.settingSaveSoundVolume;
        },
        markers: makeRange(0, 100, 10),
        default: 70,
        stickToMarkers: false,
        target: "DESKTOP"
    },
    announceSave: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingAnnounceSave;
        },
        default: true,
        target: "DESKTOP"
    },
    notifySound: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingNotifySound;
        },
        default: true,
        target: "DESKTOP",
        disabled() {
            return !this.store.announceSave;
        }
    },
    hotkey: {
        type: OptionType.STRING,
        get description() {
            return T.settingHotkey;
        },
        default: DEFAULT_HOTKEY,
        target: "DESKTOP",
        onChange: notifyHotkeyChange
    },
    globalHotkey: {
        type: OptionType.BOOLEAN,
        get description() {
            return T.settingGlobalHotkey;
        },
        default: true,
        target: "DESKTOP",
        onChange: notifyHotkeyChange
    },
    mode: {
        type: OptionType.SELECT,
        get description() {
            return T.settingMode;
        },
        get options() {
            return [
                { label: T.modeVoice, value: "voice", default: true },
                { label: T.modeAlways, value: "always" }
            ];
        },
        target: "DESKTOP",
        onChange: notifyModeChange
    },
    graceSeconds: {
        type: OptionType.SLIDER,
        get description() {
            return T.settingGrace;
        },
        markers: GRACE_SECONDS,
        default: 60,
        stickToMarkers: true,
        target: "DESKTOP",
        disabled() {
            return this.store.mode === "always";
        }
    }
});
