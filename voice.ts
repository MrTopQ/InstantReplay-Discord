/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { AuthenticationStore, SelectedChannelStore, UserStore } from "@webpack/common";

import { createCallTracker, type RtcStateEvent } from "./callTracker";
import { clearStoppedByUser, isActive, isStoppedByUser, startBuffer } from "./controller";
import * as Recorder from "./recorder";
import { settings } from "./settings";

export interface VoiceStateUpdate {
    userId: string;
    sessionId?: string;
    channelId?: string | null;
    oldChannelId?: string | null;
}

const VOICE_WATCH_MS = 15_000;

const calls = createCallTracker();
let syncedChannel: string | null = null;
let voiceWatch: ReturnType<typeof setInterval> | null = null;

function currentVoiceChannel(): string | null {
    try {
        return calls.effective(SelectedChannelStore.getVoiceChannelId());
    } catch {
        return null;
    }
}

export function isInVoice(): boolean {
    return currentVoiceChannel() !== null;
}

function followChannelChange(): void {
    setTimeout(() => {
        if (settings.store.mode === "always" || currentVoiceChannel() === syncedChannel) return;

        clearStoppedByUser();
        void syncWithVoice();
    }, 0);
}

export function handleChannelSelect(channelId: string | null | undefined): void {
    calls.onChannelSelect(channelId);
    followChannelChange();
}

export function handleCallCreate(channelId: string | null | undefined): void {
    calls.onCallCreate(channelId);
    followChannelChange();
}

export function handleCallDelete(channelId: string | null | undefined): void {
    calls.onCallDelete(channelId);
    followChannelChange();
}

export function handleRtcState(event: RtcStateEvent): void {
    calls.onRtcState(event);
    followChannelChange();
}

export function startVoiceWatch(): void {
    stopVoiceWatch();

    voiceWatch = setInterval(() => {
        if (settings.store.mode === "always" || syncedChannel === null) return;
        if (currentVoiceChannel() !== syncedChannel) void syncWithVoice();
    }, VOICE_WATCH_MS);
}

export function stopVoiceWatch(): void {
    if (voiceWatch === null) return;

    clearInterval(voiceWatch);
    voiceWatch = null;
}

let pendingStop: ReturnType<typeof setTimeout> | null = null;

export function cancelPendingStop(): void {
    if (!pendingStop) return;

    clearTimeout(pendingStop);
    pendingStop = null;
    Recorder.notifyListeners();
}

export function isWindingDown(): boolean {
    return pendingStop !== null;
}

export async function syncWithVoice(): Promise<void> {
    try {
        await followVoice();
    } finally {
        Recorder.notifyListeners();
    }
}

async function followVoice(): Promise<void> {
    syncedChannel = currentVoiceChannel();
    if (!isActive()) return;

    const { running, starting, recovering } = Recorder.getStatus();
    const alive = running || starting || recovering;

    if (settings.store.mode === "always") {
        cancelPendingStop();
        if (!alive && !isStoppedByUser()) await startBuffer(false);
        return;
    }

    if (isInVoice()) {
        cancelPendingStop();
        if (!alive && !isStoppedByUser()) await startBuffer(false);
        return;
    }

    if (!alive || pendingStop) return;

    const grace = Math.max(0, settings.store.graceSeconds ?? 0);
    if (grace === 0) {
        await Recorder.stop();
        return;
    }

    pendingStop = setTimeout(() => {
        pendingStop = null;

        if (isInVoice() || !isActive() || settings.store.mode === "always") {
            Recorder.notifyListeners();
            return;
        }

        void Recorder.stop();
    }, grace * 1000);
}

export function handleVoiceStateUpdates(voiceStates: VoiceStateUpdate[]): void {
    if (settings.store.mode === "always") return;

    const me = UserStore.getCurrentUser()?.id;
    if (!me) return;

    const session = currentSessionId();
    const moved = voiceStates.filter(state =>
        state.userId === me
        && state.channelId !== state.oldChannelId
        && (!session || !state.sessionId || state.sessionId === session));
    if (!moved.length) return;

    clearStoppedByUser();

    void syncWithVoice();
}

function currentSessionId(): string | null {
    try {
        return AuthenticationStore.getSessionId() ?? null;
    } catch {
        return null;
    }
}
