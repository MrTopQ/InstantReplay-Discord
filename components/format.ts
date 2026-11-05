/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { activeLanguage, T } from "../i18n";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

export function formatBytes(bytes: number): string {
    if (bytes < MB) return T.sizeKB(String(Math.round(bytes / KB)));
    if (bytes < GB) return T.sizeMB(String(Math.round(bytes / MB)));

    return T.sizeGB((bytes / GB).toFixed(1));
}

function startOfDay(at: Date): number {
    return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

export function formatSavedAt(savedAt: number, now = Date.now()): string {
    const at = new Date(savedAt);
    const language = activeLanguage();
    const time = at.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((startOfDay(new Date(now)) - startOfDay(at)) / 86_400_000);

    if (days === 0) return `${T.dayToday}, ${time}`;
    if (days === 1) return `${T.dayYesterday}, ${time}`;

    const date = at.toLocaleDateString(language, { day: "numeric", month: "short" });
    return `${date}, ${time}`;
}

export function clipTitle(name: string): string {
    return name.replace(/^Replay\s+/, "").replace(/\.(mp4|mkv|webm)$/i, "");
}

export function audioLevelToMeter(peak: number | null): number {
    if (peak === null || peak <= 0) return 0;

    const db = 20 * Math.log10(peak);
    return Math.min(1, Math.max(0, (db + 60) / 60));
}
