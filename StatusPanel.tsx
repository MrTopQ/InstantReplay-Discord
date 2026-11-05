/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect } from "@webpack/common";

import { Details } from "./components/Details";
import { Hero } from "./components/Hero";
import { useRecorderStatus } from "./components/useStatus";
import * as Recorder from "./recorder";

export function StatusPanel() {
    const status = useRecorderStatus();

    useEffect(() => {
        void Recorder.refreshSources();
    }, []);

    return (
        <div className="vc-ir-scope vc-ir-embed">
            <Hero status={status} />
            <Details status={status} showPatchNote={false} />
        </div>
    );
}
