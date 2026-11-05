/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { T } from "../i18n";
import { prepareRelayWorker } from "../relay";
import {
    buildMixer,
    checkMixerAlive,
    checkSoundMissing,
    type DeviceSignatures,
    deviceSignatures,
    openMicrophone,
    teardownAudio
} from "./audio";
import {
    checkFrameSize,
    checkPipeAlive,
    relayUsable,
    releaseHeldStreams,
    resetFrameSizeWatch,
    resolveSourceId,
    takeCapture,
    videoTracksFor,
    watchCaptureEnd
} from "./capture";
import { discardRing, startRing } from "./ring";
import { monotonicNow, notify, type RecorderOptions, RESTART_DELAYS_MS, state } from "./state";

const MIME_CANDIDATES = [
    "video/mp4;codecs=avc1.640033,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2"
];

const SILENT_MIME_CANDIDATES = [
    "video/mp4;codecs=avc1.640033",
    "video/mp4;codecs=avc1.42E01E"
];

const SLOW_RESTART_MS = 5 * 60_000;
const CHECK_TICK_MS = 5000;
const RECORDER_FAILURE_LIMIT = 3;
const RECORDER_HEALTHY_MS = 60_000;

let checkTimer: ReturnType<typeof setInterval> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let autoRestarts = 0;
let recorderStartedAt = 0;
let recorderFailures = 0;
let startInFlight: Promise<void> | null = null;

function pickMimeType(hasAudio: boolean): string {
    const candidates = hasAudio ? MIME_CANDIDATES : SILENT_MIME_CANDIDATES;

    return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export function isRecovering(): boolean {
    return restartTimer !== null;
}

export function failRun(message: string): void {
    state.lastError = message;

    const lived = monotonicNow() - recorderStartedAt;
    recorderFailures = lived >= RECORDER_HEALTHY_MS ? 1 : recorderFailures + 1;

    teardown();
    notify();

    if (recorderFailures > RECORDER_FAILURE_LIMIT) {
        console.error("[InstantReplay] the recording keeps dying right after it starts, leaving the buffer down");
        return;
    }

    scheduleRestart();
}

export function retryLater(): void {
    if (state.stream || state.starting || state.lastError === T.errorNoFormat) return;

    scheduleRestart();
}

export function scheduleRestart(): void {
    const previous = state.options;
    if (!previous || restartTimer) return;

    const delay = RESTART_DELAYS_MS[autoRestarts] ?? SLOW_RESTART_MS;
    if (autoRestarts === RESTART_DELAYS_MS.length) {
        console.error("[InstantReplay] the capture is not coming back, slowing the attempts down");
    }

    autoRestarts++;

    const scheduledAt = state.stopId;

    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (scheduledAt !== state.stopId) return;

        start(state.options ?? previous).catch(error => {
            console.error("[InstantReplay] restart attempt failed", error);
            scheduleRestart();
        });
    }, delay);
}

export function onData(): void {
    checkSoundMissing();
    checkPipeAlive();
    checkFrameSize();
    checkMixerAlive();
}

export function teardown(): void {
    state.lifeId++;

    if (checkTimer !== null) {
        clearInterval(checkTimer);
        checkTimer = null;
    }
    if (restartTimer !== null) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }

    discardRing();

    for (const source of [state.stream, state.desktopStream, state.micStream]) {
        source?.getTracks().forEach(track => track.stop());
    }

    teardownAudio();
    state.videoPipe?.stop();
    state.videoPipe = null;
    releaseHeldStreams();

    state.stream = state.desktopStream = state.micStream = null;
    state.activeSourceId = "";
}

async function buildStream(next: RecorderOptions, sourceId: string, devices: DeviceSignatures): Promise<MediaStream> {
    state.desktopStream = await takeCapture(next, sourceId);

    if (next.micMode !== "off") {
        try {
            state.micStream = await openMicrophone(next.micMode);
        } catch (error) {
            console.error("[InstantReplay] no microphone at all, recording without it", error);
        }
    }

    const desktop = state.desktopStream;
    if (!desktop) throw new Error(T.errorNotRunning);

    const videoTracks = videoTracksFor(next, desktop);

    const hasAudio = desktop.getAudioTracks().length > 0 || state.micStream !== null;
    if (!hasAudio) return new MediaStream(videoTracks);

    const audioTracks = await buildMixer(desktop, devices);

    return new MediaStream([...videoTracks, ...audioTracks]);
}

export function settled(): Promise<void> {
    return startInFlight ?? Promise.resolve();
}

export function start(next: RecorderOptions): Promise<void> {
    if (state.stream) return Promise.resolve();

    if (state.starting && state.startingStopId !== state.stopId && startInFlight) {
        return startInFlight.then(() => start(next));
    }

    if (state.starting) return Promise.resolve();

    const attempt = runStart(next);
    const quiet = attempt.catch(() => void 0);

    startInFlight = quiet;
    void quiet.then(() => {
        if (startInFlight === quiet) startInFlight = null;
    });

    return attempt;
}

async function runStart(next: RecorderOptions): Promise<void> {
    state.starting = true;
    state.lastError = null;
    state.options = next;

    const startedAtStop = state.startingStopId = state.stopId;

    try {
        const devices = await deviceSignatures();

        if (relayUsable() && typeof Worker === "function") await prepareRelayWorker();

        state.activeSourceId = await resolveSourceId(next);
        const stream = await buildStream(next, state.activeSourceId, devices);
        state.stream = stream;

        if (startedAtStop !== state.stopId) {
            teardown();
            return;
        }

        state.mimeType = pickMimeType(stream.getAudioTracks().length > 0);
        if (!state.mimeType) {
            state.lastError = T.errorNoFormat;
            throw new Error(state.lastError);
        }

        watchCaptureEnd();
        resetFrameSizeWatch();

        startRing();

        checkTimer = setInterval(onData, CHECK_TICK_MS);
        state.runId++;

        recorderStartedAt = monotonicNow();
        autoRestarts = 0;
    } catch (error) {
        teardown();

        if (startedAtStop !== state.stopId) return;

        state.lastError ??= (error as Error)?.message || T.errorNoSource;
        throw error;
    } finally {
        state.starting = false;
        notify();
    }
}

export async function stop(): Promise<void> {
    state.stopId++;
    autoRestarts = 0;
    recorderFailures = 0;
    teardown();
    state.lastError = null;

    notify();
}

export async function restart(): Promise<void> {
    const previous = state.options;
    if (!previous) return;

    if (!state.stream || state.starting) return;

    teardown();
    notify();

    try {
        await start(previous);
    } catch (error) {
        console.error("[InstantReplay] could not restart the buffer", error);
        scheduleRestart();
    }
}
