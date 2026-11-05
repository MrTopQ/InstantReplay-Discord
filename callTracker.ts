/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RtcStateEvent {
    state?: string;
    channelId?: string | null;
    guildId?: string | null;
    streamKey?: string | null;
    willReconnect?: boolean;
}

export interface CallTracker {
    effective(selected: string | null | undefined): string | null;
    onChannelSelect(channelId: string | null | undefined): void;
    onCallCreate(channelId: string | null | undefined): void;
    onCallDelete(channelId: string | null | undefined): void;
    onRtcState(event: RtcStateEvent): void;
}

const CONNECTED_STATES = new Set(["RTC_CONNECTING", "RTC_CONNECTED"]);

export function createCallTracker(): CallTracker {
    const ended = new Set<string>();

    return {
        effective(selected) {
            return selected && !ended.has(selected) ? selected : null;
        },

        onChannelSelect(channelId) {
            if (channelId) ended.delete(channelId);
        },

        onCallCreate(channelId) {
            if (channelId) ended.delete(channelId);
        },

        onCallDelete(channelId) {
            if (channelId) ended.add(channelId);
        },

        onRtcState({ state, channelId, guildId, streamKey, willReconnect }) {
            if (!channelId || streamKey) return;

            if (state === "DISCONNECTED" && !willReconnect && guildId == null) ended.add(channelId);
            else if (state && CONNECTED_STATES.has(state)) ended.delete(channelId);
        }
    };
}
