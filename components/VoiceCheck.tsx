/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { T } from "../i18n";
import * as Recorder from "../recorder";
import { settings } from "../settings";
import { Hint } from "./Hint";

const GROUPS = ["speaking", "mute", "channel"] as const;

function checkTime(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function VoiceCheck({ fallback }: { fallback: boolean; }) {
    const { micMode } = settings.use(["micMode"]);
    const [check, setCheck] = useState(() => Recorder.voiceGateCheck());

    useEffect(() => Recorder.subscribe(() => {
        const next = Recorder.voiceGateCheck();
        setCheck(previous => previous === next ? previous : next);
    }), []);

    if (micMode !== "discord") return null;

    const broken = fallback || check.broken.length > 0;

    const recheck = () => {
        Recorder.recheckVoiceGate();
        setCheck(Recorder.voiceGateCheck());
    };

    const tip = (
        <div className="vc-ir-voicecheck-tip">
            {GROUPS.map(group => {
                const ok = !check.broken.includes(group);

                return (
                    <div key={group}>
                        <span className={ok ? "vc-ir-voicecheck-ok" : "vc-ir-voicecheck-bad"}>{ok ? "✓" : "✗"}</span>
                        {T.voiceCheckPart[group]}
                    </div>
                );
            })}
            <div className="vc-ir-voicecheck-note">{T.voiceCheckNote(checkTime(check.checkedAt))}</div>
        </div>
    );

    return (
        <Hint text={tip}>
            {hint => (
                <button
                    className={"vc-ir-voicecheck" + (broken ? " vc-ir-voicecheck-broken" : "")}
                    onClick={recheck}
                    {...hint}
                >
                    <span className="vc-ir-voicecheck-dot" />
                    {broken ? T.voiceCheckBroken : T.voiceCheckOk}
                </button>
            )}
        </Hint>
    );
}
