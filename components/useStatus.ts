/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { isActive } from "../controller";
import * as Recorder from "../recorder";
import { settings } from "../settings";
import { isInVoice, isWindingDown } from "../voice";

export type Phase = "pluginOff" | "recording" | "grace" | "starting" | "recovering" | "error" | "waiting" | "stopped";

const POLL_MS = 1000;

function sameStatus(a: Recorder.RecorderStatus, b: Recorder.RecorderStatus): boolean {
    for (const key of Object.keys(b) as (keyof Recorder.RecorderStatus)[]) {
        if (key === "audioLevel" || key === "silentMs") continue;
        if (a[key] !== b[key]) return false;
    }

    const aSilent = (a.silentMs ?? 0) > Recorder.SILENCE_ALARM_MS;
    const bSilent = (b.silentMs ?? 0) > Recorder.SILENCE_ALARM_MS;
    const aAudible = a.audioLevel !== null && a.audioLevel > Recorder.AUDIBLE_PEAK;
    const bAudible = b.audioLevel !== null && b.audioLevel > Recorder.AUDIBLE_PEAK;

    return aSilent === bSilent && aAudible === bAudible && (a.audioLevel === null) === (b.audioLevel === null);
}

interface Snapshot {
    status: Recorder.RecorderStatus;
    phase: Phase;
}

function takeSnapshot(): Snapshot {
    const status = Recorder.getStatus();
    return { status, phase: phaseOf(status) };
}

export function useRecorderStatus(): Recorder.RecorderStatus {
    const [{ status }, setSnapshot] = useState<Snapshot>(takeSnapshot);

    useEffect(() => {
        const update = () => {
            const next = takeSnapshot();
            setSnapshot(previous =>
                previous.phase === next.phase && sameStatus(previous.status, next.status) ? previous : next);
        };

        const unsubscribe = Recorder.subscribe(update);
        const timer = setInterval(update, POLL_MS);
        update();

        return () => {
            unsubscribe();
            clearInterval(timer);
        };
    }, []);

    return status;
}

export function phaseOf(status: Recorder.RecorderStatus): Phase {
    if (!isActive()) return "pluginOff";
    if (status.running) return isWindingDown() ? "grace" : "recording";
    if (status.starting) return "starting";
    if (status.recovering) return "recovering";
    if (status.error) return "error";
    if (settings.store.mode !== "always" && !isInVoice()) return "waiting";

    return "stopped";
}
