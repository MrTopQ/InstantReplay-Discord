/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as Recorder from "./recorder";
import { settings } from "./settings";

const SAVED_TONES = [659, 880, 1319];
const SAVED_TONE_MS = 70;

const FAILED_TONES = [330, 220];
const FAILED_TONE_MS = 140;

const CHIME_GAIN = 0.18;

let chimeContext: AudioContext | null = null;

let sleepTimer: ReturnType<typeof setTimeout> | null = null;

const SLEEP_AFTER_MS = 500;

function sleepAfter(ctx: AudioContext, playMs: number): void {
    if (sleepTimer) clearTimeout(sleepTimer);

    sleepTimer = setTimeout(() => {
        sleepTimer = null;
        if (chimeContext === ctx) void ctx.suspend?.().catch(() => void 0);
    }, playMs + SLEEP_AFTER_MS);
}

function chimeAudioContext(): AudioContext | null {
    if (chimeContext) return chimeContext;

    try {
        chimeContext = new AudioContext();
        return chimeContext;
    } catch (error) {
        console.error("[InstantReplay] no audio context for the chime", error);
        return null;
    }
}

function volume(): number {
    const percent = settings.store.saveSoundVolume ?? 70;
    return Math.min(1, Math.max(0, percent / 100));
}

function awakeContext(): { ctx: AudioContext; owned: boolean; } | null {
    const mixer = Recorder.runningAudioContext();
    if (mixer) return { ctx: mixer, owned: false };

    const own = chimeAudioContext();
    return own ? { ctx: own, owned: true } : null;
}

function playTones(tones: number[], toneMs: number, level: number): void {
    const target = awakeContext();
    if (!target) return;

    const { ctx, owned } = target;

    try {
        if (owned && sleepTimer) clearTimeout(sleepTimer);
        const awake = owned ? ctx.resume?.() ?? Promise.resolve() : Promise.resolve();

        tones.forEach((frequency, index) => {
            const startAt = ctx.currentTime + index * (toneMs / 1000);
            const endAt = startAt + toneMs / 1000;

            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();

            oscillator.type = "sine";
            oscillator.frequency.value = frequency;

            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(level, startAt + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

            oscillator.connect(gain);
            gain.connect(ctx.destination);

            oscillator.start(startAt);
            oscillator.stop(endAt + 0.02);
        });

        if (owned) void awake.catch(() => void 0).then(() => sleepAfter(ctx, tones.length * toneMs));
    } catch (error) {
        console.error("[InstantReplay] the chime failed", error);
    }
}

export function playSaved(): void {
    const level = volume();
    if (level <= 0) return;

    playTones(SAVED_TONES, SAVED_TONE_MS, CHIME_GAIN * level);
}

export function playFailed(): void {
    const level = volume();
    if (level <= 0) return;

    playTones(FAILED_TONES, FAILED_TONE_MS, CHIME_GAIN * level);
}

export function forgetSound(): void {
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = null;

    try {
        void chimeContext?.close?.();
    } catch (error) {
        console.error("[InstantReplay] could not close the chime context", error);
    }

    chimeContext = null;
}
