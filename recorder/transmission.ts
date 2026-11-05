/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type MicMode = "off" | "always" | "discord";

export interface DiscordVoiceProcessing {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    noiseCancellation: boolean;
    automaticGainControl: boolean;
}

const DEFAULT_INPUT_VOLUME = 100;
const MAX_INPUT_GAIN = 2;

const RAW_MIC: MediaTrackConstraints = {
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: true
};

export function toMicMode(value: unknown): MicMode {
    return value === "off" || value === "always" ? value : "discord";
}

export type GateGroup = "speaking" | "mute" | "channel";

export const GATE_GROUPS: Record<GateGroup, string> = {
    speaking: "SpeakingStore",
    mute: "MediaEngineStore",
    channel: "SelectedChannelStore"
};

export function brokenGroups(missing: readonly string[]): GateGroup[] {
    return (Object.keys(GATE_GROUPS) as GateGroup[])
        .filter(group => missing.some(part => part.startsWith(GATE_GROUPS[group] + ".")));
}

export function missingParts(parts: Record<string, unknown>): string[] {
    return Object.entries(parts)
        .filter(([, part]) => typeof part !== "function")
        .map(([name]) => name);
}

export function inputGain(volume: unknown): number {
    const value = typeof volume === "number" && Number.isFinite(volume) ? volume : DEFAULT_INPUT_VOLUME;
    return Math.min(MAX_INPUT_GAIN, Math.max(0, value / DEFAULT_INPUT_VOLUME));
}

export function micConstraints(mode: MicMode, discord: DiscordVoiceProcessing | null): MediaTrackConstraints {
    if (mode !== "discord" || !discord) return RAW_MIC;

    return {
        echoCancellation: discord.echoCancellation,
        autoGainControl: discord.automaticGainControl,
        noiseSuppression: discord.noiseSuppression || discord.noiseCancellation
    };
}
