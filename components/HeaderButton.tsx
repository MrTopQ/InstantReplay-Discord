/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect, useState } from "@webpack/common";
import type { ReactElement } from "react";

import { isActive } from "../controller";
import { T } from "../i18n";
import * as Recorder from "../recorder";
import { settings } from "../settings";
import { isInVoice } from "../voice";
import { ReplayIcon } from "./icons";
import { toggleReplayWindow } from "./ReplayWindow";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

type Indicator = "off" | "waiting" | "live" | "silent" | "saving" | "error";

const DOT_COLOURS: Record<Indicator, string | undefined> = {
    off: undefined,
    waiting: undefined,
    live: "var(--status-danger, #f23f43)",
    silent: "var(--status-warning, #f0b232)",
    saving: "var(--brand-500, #5865f2)",
    error: "var(--status-warning, #f0b232)"
};

function indicatorOf(): Indicator | null {
    if (!isActive()) return null;

    const status = Recorder.getStatus();

    if (status.error && !status.running) return "error";
    if (status.saving) return "saving";
    if (!status.running) return settings.store.mode !== "always" && !isInVoice() ? "waiting" : "off";
    if (status.silentMs !== null && status.silentMs > Recorder.SILENCE_ALARM_MS) return "silent";

    return "live";
}

function InstantReplayHeaderButton({ plugin }: { plugin: any; }) {
    const [state, setState] = useState<Indicator | null>(indicatorOf);

    useEffect(() => Recorder.subscribe(() => setState(indicatorOf())), []);

    if (!state) return null;

    return (
        <HeaderBarIcon
            className="vc-ir-header-btn"
            onClick={() => toggleReplayWindow(plugin)}
            tooltip={T.headerTooltip(T.headerState[state])}
            icon={ReplayHeaderIcon[state]}
        />
    );
}

const ReplayHeaderIcon = Object.fromEntries(
    (Object.keys(DOT_COLOURS) as Indicator[]).map(state => [
        state,
        () => <ReplayIcon width={20} height={20} className="vc-ir-header-icon" dot={DOT_COLOURS[state]} />
    ])
) as Record<Indicator, () => ReactElement>;

export function renderHeaderButton(plugin: any) {
    return (
        <ErrorBoundary noop key="vc-ir-header-btn">
            <InstantReplayHeaderButton plugin={plugin} />
        </ErrorBoundary>
    );
}
