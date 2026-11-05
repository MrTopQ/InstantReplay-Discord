/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings } from "@api/Settings";
import { LocaleStore } from "@webpack/common";

import { en, type Messages } from "./locales/en";
import { ru } from "./locales/ru";

export const PLUGIN_NAME = "InstantReplay";

export const AUTO_LANGUAGE = "auto";
const FALLBACK_LOCALE = "en-US";

const dictionaries: Record<string, Messages> = {
    "en-US": en,
    ru
};

export const LANGUAGE_LABELS: Record<string, string> = {
    "en-US": "English",
    ru: "Русский"
};

export const LANGUAGE_CODES = Object.keys(dictionaries);

function preferredLanguage(): string {
    try {
        return (PlainSettings as any).plugins?.[PLUGIN_NAME]?.language || AUTO_LANGUAGE;
    } catch {
        return AUTO_LANGUAGE;
    }
}

function discordLocale(): string {
    try {
        const fromStore = (LocaleStore as any)?.locale;
        if (fromStore) return fromStore;
    } catch { }

    try {
        const stored = window.localStorage?.getItem("locale");
        if (stored) return JSON.parse(stored);
    } catch { }

    return FALLBACK_LOCALE;
}

function resolveLocale(): string {
    const preferred = preferredLanguage();
    const wanted = preferred === AUTO_LANGUAGE ? discordLocale() : preferred;

    if (dictionaries[wanted]) return wanted;

    const base = String(wanted).split("-")[0];
    return LANGUAGE_CODES.find(code => code.split("-")[0] === base) ?? FALLBACK_LOCALE;
}

const LOCALE_CACHE_MS = 1000;
let cachedLocale = "";
let cachedAt = 0;

export function resetLocaleCache(): void {
    cachedAt = 0;
}

function activeLocale(): string {
    const now = Date.now();

    if (now - cachedAt > LOCALE_CACHE_MS) {
        cachedLocale = resolveLocale();
        cachedAt = now;
    }

    return cachedLocale;
}

export function activeLanguage(): string {
    return activeLocale() || FALLBACK_LOCALE;
}

export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return mins > 0 ? T.durationMinutes(mins, secs) : T.durationSeconds(secs);
}

export function formatClock(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    const mins = Math.floor(whole / 60);
    const secs = whole % 60;

    return `${mins}:${String(secs).padStart(2, "0")}`;
}

export const T: Messages = new Proxy({} as Messages, {
    get(_target, key: string | symbol) {
        const active = dictionaries[activeLocale()] ?? en;
        return (active as any)[key] ?? (en as any)[key];
    }
});
