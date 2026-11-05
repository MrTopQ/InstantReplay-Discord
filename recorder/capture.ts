/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { T } from "../i18n";
import type { CaptureSource } from "../native";
import { createRelayPipe, relaySupported, relayWorker, type VideoPipe } from "../relay";
import { attachAudio, SYSTEM_AUDIO } from "./audio";
import { DeadlineError, stopStream, withDeadline } from "./deadline";
import { restart, scheduleRestart, teardown } from "./lifecycle";
import { createPacer } from "./pacer";
import { monotonicNow, notify, type RecorderOptions, RESTART_DELAYS_MS, state } from "./state";

const Native = VencordNative.pluginHelpers.InstantReplay as PluginNative<typeof import("../native")>;

const FREEZE_LIMIT_MS = 6000;
const PIPE_FREEZE_LIMIT = 3;
const SWAP_RETRY_MS = [1000, 2000, 4000];
const CAPTURE_TIMEOUT_MS = 12_000;
const SOURCES_TIMEOUT_MS = 10_000;

const outputPacer = createPacer("following the output device", monotonicNow);

let cachedSources: CaptureSource[] = [];
let sourcesInFlight: Promise<CaptureSource[]> | null = null;

let relayDisabled = false;
let pipeFreezes = 0;
let capturedSize = "";
let heldStreams: MediaStream[] = [];
let swapChain: Promise<unknown> = Promise.resolve();
let regainingFor = -1;
let followRound = 0;

export function getCachedSources(): CaptureSource[] {
    return cachedSources;
}

export function refreshSources(): Promise<CaptureSource[]> {
    if (sourcesInFlight) return sourcesInFlight;

    const request = (async () => {
        try {
            cachedSources = await withDeadline(Native.getScreenSources(), SOURCES_TIMEOUT_MS, "listing the screens timed out");
        } catch (error) {
            console.error("[InstantReplay] could not list the screens", error);
        }

        return cachedSources;
    })();

    sourcesInFlight = request;
    void request.finally(() => {
        if (sourcesInFlight === request) sourcesInFlight = null;
    });

    return request;
}

export async function resolveSourceId(next: RecorderOptions): Promise<string> {
    if (next.source === "window") {
        const windowId = await withDeadline(Native.getWindowSourceId(), SOURCES_TIMEOUT_MS, "finding the Discord window timed out");
        if (windowId) return windowId;

        state.lastError = T.errorNoWindow;
        notify();
        throw new Error(state.lastError);
    }

    const sources = await refreshSources();
    const screen = sources[next.screenIndex] ?? sources[0];

    if (screen) {
        if (!sources[next.screenIndex]) {
            state.lastEvent = T.errorScreenGone(screen.name);
            console.error(`[InstantReplay] screen ${next.screenIndex} is gone, recording ${screen.name}`);
        }

        return screen.id;
    }

    state.lastError = T.errorNoSource;
    notify();
    throw new Error(state.lastError);
}

function captureConstraints(next: RecorderOptions, sourceId: string, exactSize: boolean): MediaStreamConstraints {
    return {
        audio: next.captureAudio ? { mandatory: { chromeMediaSource: "desktop" } } : false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                ...(exactSize ? { minWidth: next.width, minHeight: next.height } : {}),
                maxWidth: next.width,
                maxHeight: next.height,
                maxFrameRate: next.frameRate
            }
        }
    } as unknown as MediaStreamConstraints;
}

function requestCapture(constraints: MediaStreamConstraints): Promise<MediaStream> {
    return withDeadline(
        navigator.mediaDevices.getUserMedia(constraints),
        CAPTURE_TIMEOUT_MS,
        T.errorCaptureTimeout(CAPTURE_TIMEOUT_MS / 1000),
        stopStream
    );
}

export async function takeCapture(next: RecorderOptions, sourceId: string): Promise<MediaStream> {
    try {
        return await requestCapture(captureConstraints(next, sourceId, true));
    } catch (error) {
        if (error instanceof DeadlineError) throw error;

        console.error("[InstantReplay] exact frame size refused, falling back to an upper bound", error);

        return await requestCapture(captureConstraints(next, sourceId, false));
    }
}

export function relayUsable(): boolean {
    return !relayDisabled && relaySupported();
}

function createPipe(next: RecorderOptions): VideoPipe | null {
    if (!relayUsable()) return null;

    try {
        return createRelayPipe(next.width, next.height, next.frameRate, relayWorker());
    } catch (error) {
        console.error("[InstantReplay] the frame relay would not start, recording the capture directly", error);
        relayDisabled = true;
        return null;
    }
}

export function videoTracksFor(next: RecorderOptions, desktop: MediaStream): MediaStreamTrack[] {
    const pipe = createPipe(next);
    if (!pipe) return desktop.getVideoTracks();

    state.videoPipe = pipe;
    pipe.setSource(desktop);

    return [pipe.track];
}

export function watchCaptureEnd(): void {
    const [video] = state.desktopStream?.getVideoTracks() ?? [];
    if (!video) return;

    const onEnded = () => {
        if (state.desktopStream?.getVideoTracks()[0] !== video) return;

        console.error("[InstantReplay] the screen capture track ended");

        if (state.videoPipe && state.options) {
            state.lastEvent = T.errorCaptureLost;
            notify();
            void regainCapture();
            return;
        }

        state.lastEvent = state.lastError = T.errorCaptureEnded;
        teardown();
        notify();

        scheduleRestart();
    };

    video.addEventListener("ended", onEnded, { once: true });

    if (video.readyState === "ended") setTimeout(onEnded, 0);
}

function serialSwap<Result>(fallback: Result, task: () => Promise<Result>): Promise<Result> {
    const requestedLife = state.lifeId;
    const guarded = () => (state.lifeId === requestedLife ? task() : Promise.resolve(fallback));

    const run = swapChain.then(guarded, guarded);
    swapChain = run.catch(() => void 0);

    return run;
}

function adoptCapture(fresh: MediaStream): void {
    const previous = state.desktopStream;

    state.desktopStream = fresh;
    heldStreams.push(fresh);

    state.videoPipe!.setSource(fresh);
    watchCaptureEnd();
    attachAudio(SYSTEM_AUDIO, fresh);

    if (previous && previous !== fresh) {
        previous.getTracks().forEach(track => track.stop());
        heldStreams = heldStreams.filter(held => held !== previous);
    }

    notify();
}

function captureAlive(): boolean {
    const [video] = state.desktopStream?.getVideoTracks() ?? [];

    return video?.readyState === "live";
}

async function sameSource(): Promise<string> {
    return state.activeSourceId;
}

function swapCapture(sourceFor: (options: RecorderOptions) => Promise<string>): Promise<boolean> {
    return serialSwap(false, async () => {
        if (!state.videoPipe || !state.options) return false;

        const startedAtStop = state.stopId;

        try {
            const sourceId = await sourceFor(state.options);
            if (startedAtStop !== state.stopId || !state.videoPipe || !state.options) return false;

            const fresh = await takeCapture(state.options, sourceId);

            if (startedAtStop !== state.stopId || !state.videoPipe) {
                fresh.getTracks().forEach(track => track.stop());
                return false;
            }

            state.activeSourceId = sourceId;
            adoptCapture(fresh);

            return true;
        } catch (error) {
            console.error("[InstantReplay] could not take the capture again", error);
            return false;
        }
    });
}

async function regainCapture(): Promise<void> {
    if (regainingFor === state.lifeId) return;
    const life = regainingFor = state.lifeId;

    try {
        for (const delay of RESTART_DELAYS_MS) {
            await new Promise(resolve => setTimeout(resolve, delay));
            if (life !== state.lifeId || !state.videoPipe) return;

            if (captureAlive() || await swapCapture(resolveSourceId)) {
                console.log("[InstantReplay] the capture came back, the ring never noticed");
                state.lastEvent = T.errorCaptureBack;
                notify();
                return;
            }
        }

        if (life !== state.lifeId || !state.videoPipe) return;

        console.error("[InstantReplay] the capture did not come back, dropping the buffer");

        state.lastError = T.errorCaptureEnded;
        teardown();
        notify();

        scheduleRestart();
    } finally {
        if (regainingFor === life) regainingFor = -1;
    }
}

async function swapUntilFollowed(life: number, round: number): Promise<void> {
    const current = () => life === state.lifeId && round === followRound && state.videoPipe !== null;

    for (const delay of [...SWAP_RETRY_MS, null]) {
        if (await swapCapture(sameSource) || !current()) return;

        if (!captureAlive()) {
            console.error("[InstantReplay] could not swap the capture and the old one is gone too");
            void regainCapture();
            return;
        }

        if (delay === null) {
            console.error("[InstantReplay] the capture would not follow the new output, staying on the old one");
            return;
        }

        console.error(`[InstantReplay] could not swap the capture, keeping the old one and trying again in ${delay} ms`);

        await new Promise(resolve => setTimeout(resolve, delay));
        if (!current()) return;
    }
}

async function followNow(): Promise<void> {
    if (!state.videoPipe || !state.options || !state.activeSourceId) {
        console.log("[InstantReplay] the default output changed, restarting to follow it");
        await restart();
        return;
    }

    console.log("[InstantReplay] the default output changed, swapping the capture underneath the video track");

    await swapUntilFollowed(state.lifeId, ++followRound);
}

export function followOutputDevice(): void {
    const life = state.lifeId;

    outputPacer.request(async () => {
        if (life === state.lifeId) await followNow();
    });
}

export function releaseHeldStreams(): void {
    for (const held of heldStreams) held.getTracks().forEach(track => track.stop());
    heldStreams = [];
}

export function checkPipeAlive(): void {
    const pipe = state.videoPipe;
    if (!pipe) return;

    if (pipe.seenFrame()) {
        pipeFreezes = 0;
        return;
    }

    if (pipe.frameAge() < FREEZE_LIMIT_MS) return;

    const delivered = (state.desktopStream?.getVideoTracks()[0] as any)?.stats?.totalFrames;
    if (delivered === 0) return;

    pipeFreezes++;
    console.error(`[InstantReplay] the frame relay never received a frame, attempt ${pipeFreezes}`);

    if (pipeFreezes >= PIPE_FREEZE_LIMIT) {
        pipeFreezes = 0;
        relayDisabled = true;
        state.lastEvent = T.errorRelayFrozen;
    }

    void restart();
}

function frameSize(): string {
    const [video] = state.desktopStream?.getVideoTracks() ?? [];
    const settings = video?.getSettings();

    return settings?.width && settings?.height ? `${settings.width}x${settings.height}` : "";
}

export function resetFrameSizeWatch(): void {
    capturedSize = "";
}

export function checkFrameSize(): void {
    if (state.videoPipe) return;

    const size = frameSize();
    if (!size) return;

    if (!capturedSize) {
        capturedSize = size;
        return;
    }
    if (size === capturedSize) return;

    console.log(`[InstantReplay] capture size went ${capturedSize} to ${size}, restarting the buffer`);
    state.lastEvent = T.errorSizeChanged(capturedSize, size);
    void restart();
}
