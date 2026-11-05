/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef } from "@webpack/common";

import * as Recorder from "../recorder";
import { audioLevelToMeter } from "./format";

const METER_TICK_MS = 100;

export function AudioMeter({ live }: { live: boolean; }) {
    const fill = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = fill.current;
        if (!element) return;

        if (!live) {
            element.style.clipPath = "inset(0 100% 0 0)";
            return;
        }

        const tick = () => {
            const hidden = (1 - audioLevelToMeter(Recorder.readAudioLevel())) * 100;
            element.style.clipPath = `inset(0 ${hidden.toFixed(1)}% 0 0)`;
        };

        tick();
        const timer = setInterval(tick, METER_TICK_MS);
        return () => clearInterval(timer);
    }, [live]);

    return (
        <div className="vc-ir-meter" aria-hidden={true}>
            <div ref={fill} className="vc-ir-meter-fill" />
        </div>
    );
}
