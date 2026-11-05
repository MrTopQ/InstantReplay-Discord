/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class DeadlineError extends Error {
    readonly name = "DeadlineError";
}

export function withDeadline<Value>(
    work: Promise<Value>,
    ms: number,
    message: string,
    discardLate?: (late: Value) => void
): Promise<Value> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;

    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            expired = true;
            reject(new DeadlineError(message));
        }, ms);
    });

    work.then(
        value => {
            if (!expired) return;

            try {
                discardLate?.(value);
            } catch (error) {
                console.error("[InstantReplay] could not discard a late result", error);
            }
        },
        () => void 0
    );

    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export function stopStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
}
