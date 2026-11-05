/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const FIRST_GAP_MS = 2000;
const LONGEST_GAP_MS = 60_000;
const CALM_MS = 60_000;

export interface Pacer {
    request(task: () => Promise<void>): void;
}

export function createPacer(name: string, clock: () => number): Pacer {
    let gap = FIRST_GAP_MS;
    let allowedAt = Number.NEGATIVE_INFINITY;
    let askedAt = Number.NEGATIVE_INFINITY;
    let queued: (() => Promise<void>) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
        timer = null;

        const task = queued;
        queued = null;
        if (!task) return;

        allowedAt = clock() + gap;
        gap = Math.min(gap * 2, LONGEST_GAP_MS);

        task().catch(error => console.error(`[InstantReplay] ${name} failed`, error));
    };

    return {
        request(task) {
            const now = clock();

            if (now - askedAt >= CALM_MS) {
                gap = FIRST_GAP_MS;
                allowedAt = now;
            }

            askedAt = now;
            queued = task;

            if (timer !== null) return;

            const wait = allowedAt - now;
            if (wait <= 0) {
                run();
                return;
            }

            console.log(`[InstantReplay] ${name} again so soon, waiting ${Math.round(wait)} ms`);
            timer = setTimeout(run, wait);
        }
    };
}
