/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { effectiveBitrate, saveReplay, startBuffer, stopBuffer } from "../controller";
import { formatClock, T } from "../i18n";
import * as Recorder from "../recorder";
import { DEFAULT_HOTKEY, settings } from "../settings";
import { AudioMeter } from "./AudioMeter";
import { formatBytes } from "./format";
import { RecordIcon, SaveIcon, StopIcon } from "./icons";
import { Keys } from "./Keys";
import { type Phase, phaseOf } from "./useStatus";

const STATE_LABEL: Record<Phase, () => string> = {
    pluginOff: () => T.statePluginOff,
    recording: () => T.stateRecording,
    grace: () => T.stateGrace,
    starting: () => T.stateStarting,
    recovering: () => T.stateRecovering,
    error: () => T.stateStopped,
    waiting: () => T.stateWaiting,
    stopped: () => T.stateStopped
};

const MEASURE_AFTER_SECONDS = 10;

function ceilingPerMinute(): number {
    return (effectiveBitrate() * 1_000_000 * 60) / 8;
}

function StateBadge({ phase }: { phase: Phase; }) {
    return (
        <span className={`vc-ir-state vc-ir-state-${phase}`}>
            <span className="vc-ir-state-dot" />
            {STATE_LABEL[phase]()}
        </span>
    );
}

function audioState(status: Recorder.RecorderStatus): { label: string; tone: "live" | "quiet" | "lost" | "off"; } {
    if (status.audioLevel === null) return { label: T.audioOff, tone: "off" };
    if (status.silentMs !== null && status.silentMs > Recorder.SILENCE_ALARM_MS) return { label: T.audioSilent, tone: "lost" };
    if (status.audioLevel > Recorder.AUDIBLE_PEAK) return { label: T.audioLive, tone: "live" };

    return { label: T.audioQuiet, tone: "quiet" };
}

function RunningHero({ status, phase }: { status: Recorder.RecorderStatus; phase: Phase; }) {
    const { bufferSeconds, hotkey } = settings.use(["bufferSeconds", "hotkey"]);
    const held = status.bufferedSeconds;
    const full = held >= bufferSeconds;
    const progress = Math.min(1, bufferSeconds > 0 ? held / bufferSeconds : 0);

    const ceiling = ceilingPerMinute();
    const measured = status.bufferedSeconds >= MEASURE_AFTER_SECONDS && status.bytesPerSecond !== null
        ? status.bytesPerSecond * 60
        : null;
    const audio = audioState(status);

    return (
        <div className={`vc-ir-hero vc-ir-hero-${phase}`}>
            <div className="vc-ir-hero-top">
                <StateBadge phase={phase} />
                <span className="vc-ir-hero-note">{full ? T.heroFull : T.heroFilling}</span>
            </div>

            <div className="vc-ir-clock">
                <span className="vc-ir-clock-value">{formatClock(held)}</span>
                <span className="vc-ir-clock-of">{T.heroOf(formatClock(bufferSeconds))}</span>
            </div>

            <div className="vc-ir-bar" role="progressbar" aria-valuemin={0} aria-valuemax={bufferSeconds} aria-valuenow={held}>
                <div className="vc-ir-bar-fill" style={{ transform: `scaleX(${progress.toFixed(4)})` }} />
            </div>

            <div className="vc-ir-tiles">
                <div className="vc-ir-tile">
                    <span className="vc-ir-tile-value">{formatBytes(status.bufferedBytes)}</span>
                    <span className="vc-ir-tile-label">{T.tileMemory}</span>
                </div>
                <div className="vc-ir-tile">
                    <span className="vc-ir-tile-value">{formatBytes(measured ?? ceiling)}</span>
                    <span className="vc-ir-tile-label">
                        {measured === null ? T.tileCeilingOnly : `${T.tilePerMinute}, ${T.tileCeiling(formatBytes(ceiling))}`}
                    </span>
                </div>
                <div className={`vc-ir-tile vc-ir-tile-audio vc-ir-audio-${audio.tone}`}>
                    <AudioMeter live={audio.tone !== "off"} />
                    <span className="vc-ir-tile-label">{audio.label}</span>
                </div>
            </div>

            {status.error && <div className="vc-ir-alert">{status.error}</div>}
            {status.voiceFallback && <div className="vc-ir-alert">{T.voiceGateMissing}</div>}

            <div className="vc-ir-actions">
                <button
                    className="vc-ir-button vc-ir-button-primary vc-ir-button-save"
                    disabled={status.saving}
                    onClick={() => void saveReplay(false)}
                >
                    {status.saving ? <span className="vc-ir-spinner" /> : <SaveIcon size={18} />}
                    <span className="vc-ir-button-text">
                        {status.saving ? T.buttonSaving : held > 0 ? T.buttonSave(formatClock(held)) : T.buttonSaveEmpty}
                    </span>
                    <Keys hotkey={hotkey || DEFAULT_HOTKEY} />
                </button>
                <button className="vc-ir-button vc-ir-button-ghost" onClick={() => void stopBuffer()}>
                    <StopIcon size={16} />
                    {T.buttonStop}
                </button>
            </div>
        </div>
    );
}

function IdleHero({ status, phase }: { status: Recorder.RecorderStatus; phase: Phase; }) {
    const hint = phase === "waiting" ? T.stateWaitingHint : phase === "stopped" ? T.stateStoppedHint : null;
    const canStart = phase !== "pluginOff" && phase !== "starting";

    return (
        <div className={`vc-ir-hero vc-ir-hero-idle vc-ir-hero-${phase}`}>
            <div className="vc-ir-hero-top">
                <StateBadge phase={phase} />
            </div>

            {hint && <p className="vc-ir-hero-hint">{hint}</p>}
            {status.error && <div className="vc-ir-alert">{status.error}</div>}

            {canStart && (
                <div className="vc-ir-actions">
                    <button className="vc-ir-button vc-ir-button-primary" onClick={() => void startBuffer(true)}>
                        <RecordIcon size={16} />
                        {T.buttonStart}
                    </button>
                </div>
            )}
        </div>
    );
}

export function Hero({ status }: { status: Recorder.RecorderStatus; }) {
    const phase = phaseOf(status);

    return status.running
        ? <RunningHero status={status} phase={phase} />
        : <IdleHero status={status} phase={phase} />;
}
