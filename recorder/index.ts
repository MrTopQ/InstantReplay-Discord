/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import type { ClipInfo } from "../native";
import { sampleAudio, silentForMs, usesVoiceFallback } from "./audio";
import { isRecovering } from "./lifecycle";
import { bufferedBytes, ringBytesPerSecond, ringHeldMs } from "./ring";
import { notify, state } from "./state";

export { recheckVoiceGate, runningAudioContext, type VoiceGateCheck, voiceGateCheck } from "./audio";
export { getCachedSources, refreshSources } from "./capture";
export { retryLater, settled, start, stop } from "./lifecycle";
export { setBufferSeconds } from "./ring";
export { save, type SaveHooks, SESSION } from "./save";
export { AUDIBLE_PEAK, type RecorderOptions, SILENCE_ALARM_MS, subscribe } from "./state";
export type { ClipInfo };

const Native = VencordNative.pluginHelpers.InstantReplay as PluginNative<typeof import("../native")>;

const METER_FRESH_MS = 50;

export interface RecorderStatus {
    running: boolean;
    starting: boolean;
    recovering: boolean;
    bytesPerSecond: number | null;
    lastEvent: string | null;
    audioLevel: number | null;
    silentMs: number | null;
    bufferedSeconds: number;
    bufferedBytes: number;
    saving: boolean;
    mimeType: string;
    error: string | null;
    runId: number;
    pipeline: "worker" | "page" | "direct" | null;
    voiceFallback: boolean;
}

export function notifyListeners(): void {
    notify();
}

function currentPipeline(): RecorderStatus["pipeline"] {
    if (state.stream === null) return null;

    return state.videoPipe?.runsIn ?? "direct";
}

export function getStatus(): RecorderStatus {
    const bufferedSeconds = Math.floor(ringHeldMs() / 1000);
    const bytesPerSecond = ringBytesPerSecond();
    const audioLevel = sampleAudio();

    return {
        running: state.stream !== null,
        starting: state.starting && state.startingStopId === state.stopId,
        recovering: isRecovering(),
        lastEvent: state.lastEvent,
        audioLevel,
        silentMs: audioLevel === null ? null : silentForMs(),
        bytesPerSecond,
        bufferedSeconds,
        bufferedBytes: bufferedBytes(),
        saving: state.saving,
        mimeType: state.mimeType,
        error: state.lastError,
        runId: state.runId,
        pipeline: currentPipeline(),
        voiceFallback: state.stream !== null && usesVoiceFallback()
    };
}

export function readAudioLevel(): number | null {
    return sampleAudio(METER_FRESH_MS);
}

export function getOutputDir(): Promise<string> {
    return Native.getOutputDir();
}

export function reveal(path: string): Promise<void> {
    return Native.revealFile(path).catch(error => {
        console.error("[InstantReplay] could not open the folder", error);
    });
}

export function openOutputDir(): Promise<void> {
    return Native.openOutputDir().catch(error => {
        console.error("[InstantReplay] could not open the clips folder", error);
    });
}

export function listClips(limit: number): Promise<ClipInfo[]> {
    return Native.listClips(limit)
        .then(clips => clips.map(clip => ({ ...clip, thumb: clip.thumb ?? null })))
        .catch(error => {
            console.error("[InstantReplay] could not list the clips", error);
            return [] as ClipInfo[];
        });
}

export function openClip(path: string): Promise<void> {
    return Native.openClip(path).catch(error => {
        console.error("[InstantReplay] could not open the clip", error);
    });
}
