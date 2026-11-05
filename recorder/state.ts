/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { VideoPipe } from "../relay";
import type { MicMode } from "./transmission";

export { monotonicNow } from "../relay";

export interface RecorderOptions {
    bufferSeconds: number;
    captureAudio: boolean;
    micMode: MicMode;
    width: number;
    height: number;
    frameRate: number;
    videoBitsPerSecond: number;
    screenIndex: number;
    source: "screen" | "window";
}

export const RESTART_DELAYS_MS = [2000, 5000, 10_000, 20_000, 40_000, 60_000];

export const AUDIBLE_PEAK = 0.002;

export const SILENCE_ALARM_MS = 120_000;

interface RecorderState {
    stream: MediaStream | null;
    desktopStream: MediaStream | null;
    micStream: MediaStream | null;
    videoPipe: VideoPipe | null;
    activeSourceId: string;
    options: RecorderOptions | null;
    mimeType: string;
    saving: boolean;
    lastError: string | null;
    lastEvent: string | null;
    runId: number;
    starting: boolean;
    stopId: number;
    startingStopId: number;
    lifeId: number;
}

export const state: RecorderState = {
    stream: null,
    desktopStream: null,
    micStream: null,
    videoPipe: null,
    activeSourceId: "",
    options: null,
    mimeType: "",
    saving: false,
    lastError: null,
    lastEvent: null,
    runId: 0,
    starting: false,
    stopId: 0,
    startingStopId: 0,
    lifeId: 0
};

const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function notify(): void {
    for (const listener of listeners) {
        try {
            listener();
        } catch (error) {
            console.error("[InstantReplay] a status listener threw", error);
        }
    }
}
