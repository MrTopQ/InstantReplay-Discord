/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describeChunk } from "../fmp4";
import { T } from "../i18n";
import { failRun, onData, restart, scheduleRestart, teardown } from "./lifecycle";
import { rotationStep, successorCovers } from "./rotation";
import { monotonicNow, notify, state } from "./state";

const DATA_INTERVAL_MS = 1000;
const STOP_TIMEOUT_MS = 5000;
const PENDING_TAIL_LIMIT = 64 * 1024 * 1024;
const KEYFRAME_INTERVAL_MS = 3000;
const RING_BYTES_HEADROOM = 1.5;
const SUCCESSOR_RETRY_MS = 60_000;
const MB = 1024 * 1024;

interface Fragment {
    blob: Blob;
    bytes: number;
    arrivedAt: number;
}

interface Ring {
    recorder: MediaRecorder;
    init: Blob | null;
    fragments: Fragment[];
    bytes: number;
    start: number;
    end: number;
    emitted: number;
    admitChain: Promise<void>;
    pendingTail: Blob | null;
    closing: boolean;
}

export interface ClosedRecording {
    init: Blob;
    fragments: Blob[];
    startedAt: number;
    endedAt: number;
}

let active: Ring | null = null;
let successor: Ring | null = null;
let successorRetryAt = 0;

function newRecorder(): MediaRecorder {
    return new MediaRecorder(state.stream!, {
        mimeType: state.mimeType,
        videoBitsPerSecond: state.options!.videoBitsPerSecond,
        videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS
    } as MediaRecorderOptions);
}

function isLive(ring: Ring): boolean {
    return ring === active || ring === successor;
}

function handleRecorderError(ring: Ring, event: Event): void {
    const name = (event as any)?.error?.name ?? "unknown";

    if (ring === active) {
        failRun(T.errorRecorder(name));
        return;
    }

    if (ring === successor) {
        console.error(`[InstantReplay] the next recording failed with ${name}, the current one keeps going`);
        dropSuccessor();
    }
}

function openRing(): Ring {
    const recorder = newRecorder();
    const now = monotonicNow();

    const ring: Ring = {
        recorder,
        init: null,
        fragments: [],
        bytes: 0,
        start: now,
        end: now,
        emitted: 0,
        admitChain: Promise.resolve(),
        pendingTail: null,
        closing: false
    };

    recorder.ondataavailable = event => {
        if (event.data.size > 0) {
            const arrivedAt = monotonicNow();
            ring.emitted += event.data.size;

            ring.admitChain = ring.admitChain
                .then(() => admit(ring, event.data, arrivedAt))
                .then(rotate)
                .catch(error => console.error("[InstantReplay] could not take a chunk in", error));
        }

        if (ring === active) onData();
    };
    recorder.onerror = event => handleRecorderError(ring, event);

    recorder.start(DATA_INTERVAL_MS);

    state.videoPipe?.refresh();

    return ring;
}

function retire(ring: Ring | null): void {
    if (!ring) return;

    ring.recorder.ondataavailable = null;
    ring.recorder.onstop = null;
    ring.recorder.onerror = null;

    if (ring.recorder.state !== "inactive") ring.recorder.stop();
}

export function startRing(): void {
    retire(successor);
    successor = null;

    active = openRing();
}

function admitFragment(ring: Ring, blob: Blob, arrivedAt: number): void {
    ring.fragments.push({ blob, bytes: blob.size, arrivedAt });
    ring.bytes += blob.size;
}

function holdTail(ring: Ring, chunk: Blob): void {
    if (chunk.size <= PENDING_TAIL_LIMIT) {
        ring.pendingTail = chunk;
        return;
    }

    ring.pendingTail = null;

    if (ring === successor) {
        console.error(`[InstantReplay] the next recording stopped parsing with ${chunk.size} bytes of held tail, dropping it`);
        dropSuccessor();
        return;
    }

    console.error(`[InstantReplay] the stream stopped parsing with ${chunk.size} bytes of held tail, restarting the recording`);

    state.lastEvent = T.errorStreamLost;
    void restart();
}

async function admit(ring: Ring, incoming: Blob, arrivedAt: number): Promise<void> {
    if (!isLive(ring)) return;

    const chunk = ring.pendingTail ? new Blob([ring.pendingTail, incoming]) : incoming;
    ring.pendingTail = null;

    const shape = await describeChunk(chunk);
    if (!isLive(ring)) return;

    if (!shape.complete) {
        holdTail(ring, chunk);
        return;
    }

    ring.end = arrivedAt;

    if (!ring.fragments.length) {
        const cut = shape.fragmentOffset ?? chunk.size;
        const head = chunk.slice(0, cut);

        ring.init = ring.init ? new Blob([ring.init, head]) : head;
        if (shape.fragmentEnd !== null) admitFragment(ring, chunk.slice(cut, shape.fragmentEnd), arrivedAt);

        if (shape.danglingMoof !== null) holdTail(ring, chunk.slice(shape.danglingMoof));

        return;
    }

    if (shape.types[0] !== "moof") return;

    if (shape.fragmentEnd !== null) admitFragment(ring, chunk.slice(0, shape.fragmentEnd), arrivedAt);
    if (shape.danglingMoof !== null) holdTail(ring, chunk.slice(shape.danglingMoof));

    trimRing(ring);
}

function dropOldestFragment(ring: Ring): void {
    ring.start = ring.fragments[0].arrivedAt;
    ring.bytes -= ring.fragments[0].bytes;
    ring.fragments.shift();
}

function trimRing(ring: Ring): void {
    if (!state.options) return;
    const windowMs = state.options.bufferSeconds * 1000;

    while (ring.fragments.length > 1 && ring.end - ring.fragments[0].arrivedAt >= windowMs) dropOldestFragment(ring);

    const limit = ringByteLimit();
    while (ring.fragments.length > 1 && ring.bytes > limit) dropOldestFragment(ring);
}

function ringByteLimit(): number {
    if (!state.options) return Number.POSITIVE_INFINITY;

    return (state.options.videoBitsPerSecond / 8) * state.options.bufferSeconds * RING_BYTES_HEADROOM;
}

function heldMs(ring: Ring): number {
    if (!ring.init || !ring.fragments.length) return 0;

    return Math.max(0, ring.end - ring.start);
}

function openSuccessor(): void {
    if (monotonicNow() < successorRetryAt) return;

    try {
        successor = openRing();
        console.log(`[InstantReplay] the recording has written ${Math.round(active!.emitted / MB)} MB, starting the next one beside it`);
    } catch (error) {
        successor = null;
        successorRetryAt = monotonicNow() + SUCCESSOR_RETRY_MS;
        console.error("[InstantReplay] could not start the next recording, trying again later", error);
    }
}

function dropSuccessor(): void {
    retire(successor);
    successor = null;
    successorRetryAt = monotonicNow() + SUCCESSOR_RETRY_MS;
}

function promoteSuccessor(): void {
    const previous = active;
    if (!successor || !previous) return;

    console.log(`[InstantReplay] the next recording holds ${Math.round(heldMs(successor) / 1000)} s, retiring the one that wrote ${Math.round(previous.emitted / MB)} MB`);

    active = successor;
    successor = null;
    retire(previous);

    notify();
}

function rotate(): void {
    const current = active;
    if (!current || current.closing || !state.stream || !state.options) return;

    const step = rotationStep({
        emittedBytes: current.emitted,
        windowBytes: ringByteLimit(),
        hasSuccessor: successor !== null,
        successorCovers: successor !== null && successorCovers(heldMs(successor), heldMs(current), state.options.bufferSeconds * 1000)
    });

    if (step === "openSuccessor") openSuccessor();
    else if (step === "promote") promoteSuccessor();
    else if (step === "replace") {
        console.error(`[InstantReplay] the recording has written ${Math.round(current.emitted / MB)} MB with no next one ready, starting over`);
        retire(current);
        replaceRing();
    }
}

export function setBufferSeconds(seconds: number): void {
    if (!state.options || state.options.bufferSeconds === seconds) return;

    state.options = { ...state.options, bufferSeconds: seconds };

    if (active) trimRing(active);
    if (successor) trimRing(successor);
    notify();
}

function currentRecording(ring: Ring): ClosedRecording | null {
    if (!ring.init || !ring.fragments.length) return null;

    return {
        init: ring.init,
        fragments: ring.fragments.map(fragment => fragment.blob),
        startedAt: ring.start,
        endedAt: ring.end
    };
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
    return new Promise<void>(resolve => {
        const timer = setTimeout(() => {
            console.error("[InstantReplay] the recorder never reported a stop, taking what it wrote");
            resolve();
        }, STOP_TIMEOUT_MS);

        recorder.addEventListener("stop", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });

        recorder.stop();
    });
}

async function closeRing(ring: Ring | null): Promise<ClosedRecording | null> {
    if (!ring) return null;

    ring.closing = true;
    const snapshot = ring === active ? currentRecording(ring) : null;

    if (ring.recorder.state !== "inactive") await stopRecorder(ring.recorder);

    await ring.admitChain;

    if (ring !== active) return snapshot;

    ring.recorder.ondataavailable = null;
    ring.recorder.onerror = null;

    return currentRecording(ring);
}

function replaceRing(): void {
    if (!state.stream || !state.options) return;

    try {
        startRing();
    } catch (error) {
        console.error("[InstantReplay] could not open the next recording", error);

        state.lastError = T.errorRecorder((error as Error)?.name ?? "unknown");
        teardown();
        scheduleRestart();
    }
}

function followClosedRing(): void {
    if (!successor) {
        replaceRing();
        return;
    }

    console.log(`[InstantReplay] the clip took the current recording, the next one carries on with ${Math.round(heldMs(successor) / 1000)} s`);

    active = successor;
    successor = null;
    notify();
}

export async function takeRecording(): Promise<ClosedRecording | null> {
    const closing = active;

    try {
        return await closeRing(closing);
    } finally {
        if (active === closing) followClosedRing();
    }
}

export function discardRing(): void {
    retire(active);
    retire(successor);

    active = null;
    successor = null;
    successorRetryAt = 0;
}

export function expectedClipBytes(): number {
    return (active?.init?.size ?? 0) + (active?.bytes ?? 0);
}

function ringMemory(ring: Ring | null): number {
    return ring ? (ring.init?.size ?? 0) + ring.bytes + (ring.pendingTail?.size ?? 0) : 0;
}

export function bufferedBytes(): number {
    return ringMemory(active) + ringMemory(successor);
}

export function ringHeldMs(): number {
    if (!state.options || !active?.fragments.length) return 0;

    return Math.min(Math.max(0, active.end - active.start), state.options.bufferSeconds * 1000);
}

export function ringBytesPerSecond(): number | null {
    if (!active) return null;

    const measuredMs = Math.max(0, active.end - active.start);

    return measuredMs > 0 && active.bytes > 0 ? (active.bytes / measuredMs) * 1000 : null;
}
