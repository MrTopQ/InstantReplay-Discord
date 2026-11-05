/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginNative } from "@utils/types";

import { T } from "../i18n";
import type { SavedFile } from "../native";
import { expectedClipBytes, takeRecording } from "./ring";
import { notify, state } from "./state";
import { grabThumb, storeThumb } from "./thumb";

const Native = VencordNative.pluginHelpers.InstantReplay as PluginNative<typeof import("../native")>;

export const SESSION = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const WRITE_CHUNK_SIZE = 16 * 1024 * 1024;

export interface SaveHooks {
    onCaptured?: () => void;
}

async function writeRecording(handle: number, onCaptured?: () => void): Promise<number> {
    const closed = await takeRecording();
    if (!closed) throw new Error(T.errorBufferEmpty);

    try {
        onCaptured?.();
    } catch (error) {
        console.error("[InstantReplay] the capture callback failed", error);
    }

    const blob = new Blob([closed.init, ...closed.fragments], { type: state.mimeType });
    if (blob.size === 0) throw new Error(T.errorEmptyFile);

    for (let offset = 0; offset < blob.size; offset += WRITE_CHUNK_SIZE) {
        const slice = blob.slice(offset, offset + WRITE_CHUNK_SIZE);
        await Native.writeChunk(handle, new Uint8Array(await slice.arrayBuffer()));
    }

    return Math.max(0, closed.endedAt - closed.startedAt);
}

async function finishClip(handle: number, durationMs: number): Promise<string> {
    const saved: SavedFile | string = await Native.finishFile(handle, durationMs);

    if (typeof saved === "string") {
        state.lastEvent = T.errorStaleMain;
        notify();

        return saved;
    }

    if (!saved.seekable) {
        state.lastEvent = T.errorNoDuration;
        notify();
    }

    return saved.path;
}

async function hasRoom(bytes: number): Promise<boolean> {
    if (typeof Native.hasRoomFor !== "function") return true;

    return Native.hasRoomFor(bytes);
}

async function saveFromRing(hooks: SaveHooks): Promise<string> {
    const thumb = grabThumb();

    const expected = expectedClipBytes();
    if (expected > 0 && !await hasRoom(expected)) throw new Error(T.errorNoSpace);

    const { handle } = await Native.beginFile("mp4", SESSION);

    const durationMs = await writeRecording(handle, hooks.onCaptured).catch(async error => {
        await Native.abortFile(handle).catch(() => void 0);
        throw error;
    });

    const path = await finishClip(handle, durationMs);
    void storeThumb(path, thumb);

    return path;
}

export async function save(hooks: SaveHooks = {}): Promise<string> {
    if (!state.stream || !state.options) throw new Error(T.errorNotRunning);
    if (state.saving) throw new Error(T.errorAlreadySaving);

    state.saving = true;
    notify();

    try {
        return await saveFromRing(hooks);
    } finally {
        state.saving = false;
        notify();
    }
}
