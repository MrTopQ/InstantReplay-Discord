/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { notify, state } from "./state";

const Native = VencordNative.pluginHelpers.InstantReplay as PluginNative<typeof import("../native")>;

const THUMB_WIDTH = 320;
const THUMB_TIMEOUT_MS = 1500;

async function takeThumb(): Promise<Blob | null> {
    return state.videoPipe?.snapshot(THUMB_WIDTH) ?? null;
}

export function grabThumb(): Promise<Blob | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeout = new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), THUMB_TIMEOUT_MS);
    });

    const grab = takeThumb().catch(error => {
        console.error("[InstantReplay] could not grab a thumbnail", error);
        return null;
    });

    return Promise.race([grab, timeout]).finally(() => {
        if (timer !== null) clearTimeout(timer);
    });
}

export async function storeThumb(clipPath: string, pending: Promise<Blob | null>): Promise<void> {
    try {
        if (typeof Native.saveThumb !== "function") return;

        const blob = await pending;
        if (!blob) return;

        await Native.saveThumb(clipPath, new Uint8Array(await blob.arrayBuffer()));
        notify();
    } catch (error) {
        console.error("[InstantReplay] could not store the clip thumbnail", error);
    }
}
