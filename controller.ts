/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { Settings } from "@api/Settings";
import { PluginNative } from "@utils/types";
import { showToast } from "@webpack/common";

import { formatDuration, T } from "./i18n";
import * as Recorder from "./recorder";
import { toMicMode } from "./recorder/transmission";
import {
    DEFAULT_HOTKEY,
    DEFAULT_RESOLUTION,
    MAX_BITRATE_MBPS,
    MIN_BITRATE_MBPS,
    RESOLUTIONS,
    settings
} from "./settings";
import { playFailed, playSaved } from "./sound";

const Native = VencordNative.pluginHelpers.InstantReplay as PluginNative<typeof import("./native")>;

const HOTKEY_BRIDGE = "$InstantReplaySave";

let active = false;

function describeError(error: unknown): string {
    const { name, message } = (error ?? {}) as { name?: string; message?: string; };
    return [name, message].filter(Boolean).join(" ") || String(error);
}

export function setActive(value: boolean): void {
    active = value;

    Recorder.notifyListeners();
}

export function isActive(): boolean {
    return active;
}

export function effectiveBitrate(): number {
    return Math.min(MAX_BITRATE_MBPS, Math.max(MIN_BITRATE_MBPS, settings.store.bitrateMbps));
}

export function currentOptions(): Recorder.RecorderOptions {
    const size = RESOLUTIONS[settings.store.resolution] ?? RESOLUTIONS[DEFAULT_RESOLUTION];
    const bitrate = effectiveBitrate();

    return {
        bufferSeconds: settings.store.bufferSeconds,
        captureAudio: settings.store.captureAudio,
        micMode: toMicMode(settings.store.micMode),
        width: size.width,
        height: size.height,
        frameRate: settings.store.frameRate,
        videoBitsPerSecond: bitrate * 1_000_000,
        screenIndex: Number(settings.store.screenIndex) || 0,
        source: settings.store.source === "window" ? "window" : "screen"
    };
}

let stoppedByUser = false;

export function isStoppedByUser(): boolean {
    return stoppedByUser;
}

export function clearStoppedByUser(): void {
    stoppedByUser = false;
}

export async function stopBuffer(): Promise<void> {
    stoppedByUser = true;
    await Recorder.stop();
}

export async function startBuffer(notify: boolean): Promise<void> {
    if (!active) {
        if (notify) showToast({ text: T.toastPluginOff, variant: "critical" });
        return;
    }

    stoppedByUser = false;

    try {
        await Recorder.start(currentOptions());

        if (notify && Recorder.getStatus().running) showToast({ text: T.toastStarted, variant: "success" });
    } catch (error) {
        console.error(`[InstantReplay] failed to start, ${describeError(error)}`, error);
        showToast({ text: T.toastStartFailed((error as Error).message), variant: "critical" });

        if (!notify && active) Recorder.retryLater();
    }
}

function goesToWindows(): boolean {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;

    const mode = (Settings.notifications as { useNative?: string; } | undefined)?.useNative;
    return mode === "always" || (mode === "not-focused" && !document.hasFocus());
}

function showSilentWindowsNotification(title: string, body: string, path: string): boolean {
    try {
        const notification = new Notification(title, { body, silent: true });
        notification.onclick = () => void Recorder.reveal(path);
        return true;
    } catch (error) {
        console.error("[InstantReplay] could not show a silent notification", error);
        return false;
    }
}

function announceSaved(path: string, seconds: number): void {
    if (!settings.store.announceSave) return;

    const title = T.notifySavedTitle;
    const body = T.notifySavedBody(path.split(/[\\/]/).pop() ?? path, formatDuration(seconds));

    if (settings.store.notifySound === false && goesToWindows() && showSilentWindowsNotification(title, body, path)) return;

    showNotification({
        title,
        body,
        onClick: () => void Recorder.reveal(path),
        dismissOnClick: true
    }).catch(error => {
        console.error("[InstantReplay] could not show the saved notification", error);
    });
}

export async function saveReplay(reveal: boolean): Promise<void> {
    const status = Recorder.getStatus();

    if (!status.running) {
        playFailed();
        showToast({ text: T.toastNotRunning, variant: "critical" });
        return;
    }
    if (status.saving) {
        showToast({ text: T.errorAlreadySaving, variant: "default" });
        return;
    }

    const heldSeconds = status.bufferedSeconds;

    showToast({ text: T.toastSaving, variant: "default" });

    try {
        const path = await Recorder.save({ onCaptured: playSaved });

        showToast({ text: T.toastSaved(path.split(/[\\/]/).pop() ?? path), variant: "success" });

        announceSaved(path, heldSeconds);
        if (reveal) void Recorder.reveal(path);
    } catch (error) {
        console.error(`[InstantReplay] failed to save, ${describeError(error)}`, error);

        playFailed();
        showToast({ text: T.toastSaveFailed((error as Error).message), variant: "critical" });
    }
}

let restarting = false;
let restartQueued = false;

export async function restartIfRunning(): Promise<void> {
    if (!active) return;

    const status = Recorder.getStatus();
    if (!status.running && !status.starting && !status.recovering) return;

    if (restarting) {
        restartQueued = true;
        return;
    }

    restarting = true;
    try {
        do {
            restartQueued = false;

            await Recorder.stop();
            await Recorder.settled();
            await startBuffer(false);
        } while (restartQueued && active);
    } finally {
        restarting = false;
    }
}

export function installHotkeyBridge(): void {
    (window as any)[HOTKEY_BRIDGE] = () => {
        void saveReplay(false);
        return true;
    };
}

export function removeHotkeyBridge(): void {
    delete (window as any)[HOTKEY_BRIDGE];
}

export async function pauseGlobalHotkey(): Promise<void> {
    try {
        await Native.unregisterGlobalHotkey();
    } catch (error) {
        console.error("[InstantReplay] could not pause the hotkey", error);
    }
}

export async function applyGlobalHotkey(notify: boolean): Promise<void> {
    const hotkey = settings.store.hotkey || DEFAULT_HOTKEY;

    try {
        if (!active || !settings.store.globalHotkey) {
            await Native.unregisterGlobalHotkey();
            return;
        }

        const claimed = await Native.registerGlobalHotkey(hotkey);

        if (!notify && claimed) return;

        showToast({ text: claimed ? T.toastGlobalHotkeyClaimed(hotkey) : T.toastGlobalHotkeyBusy(hotkey), variant: claimed ? "success" : "critical" });
    } catch (error) {
        console.error("[InstantReplay] global hotkey failed", error);
    }
}
