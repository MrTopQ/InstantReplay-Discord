/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Chromium's MP4 muxer counts everything one MediaRecorder has written in 32 bits and kills the page
// with STATUS_BREAKPOINT once that passes 4 GiB, so no recorder may live that long.
export const MUXER_BYTE_LIMIT = 2 ** 32;
export const HARD_LIMIT_BYTES = 3.5 * 2 ** 30;
export const MIN_ROTATE_AT_BYTES = 512 * 2 ** 20;

export type RotationStep = "none" | "openSuccessor" | "promote" | "replace";

export interface RotationInput {
    emittedBytes: number;
    windowBytes: number;
    hasSuccessor: boolean;
    successorCovers: boolean;
}

export function rotateAtBytes(windowBytes: number): number {
    return Math.max(MIN_ROTATE_AT_BYTES, HARD_LIMIT_BYTES - windowBytes);
}

export function rotationStep({ emittedBytes, windowBytes, hasSuccessor, successorCovers }: RotationInput): RotationStep {
    if (emittedBytes >= HARD_LIMIT_BYTES) return hasSuccessor ? "promote" : "replace";
    if (hasSuccessor) return successorCovers ? "promote" : "none";

    return emittedBytes >= rotateAtBytes(windowBytes) ? "openSuccessor" : "none";
}

export function successorCovers(successorHeldMs: number, activeHeldMs: number, windowMs: number): boolean {
    return successorHeldMs > 0 && successorHeldMs >= Math.min(windowMs, activeHeldMs);
}
