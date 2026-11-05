/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { T } from "../i18n";
import * as Recorder from "../recorder";
import { ChevronIcon } from "./icons";
import { VoiceCheck } from "./VoiceCheck";

function Row({ label, children }: { label: string; children: ReactNode; }) {
    return (
        <div className="vc-ir-detail">
            <span className="vc-ir-detail-label">{label}</span>
            <span className="vc-ir-detail-value">{children}</span>
        </div>
    );
}

export function Details({ status, showPatchNote }: { status: Recorder.RecorderStatus; showPatchNote: boolean; }) {
    const [open, setOpen] = useState(false);
    const [outputDir, setOutputDir] = useState("");

    useEffect(() => {
        if (!open || outputDir) return;

        let alive = true;
        Recorder.getOutputDir()
            .then(dir => { if (alive) setOutputDir(dir); })
            .catch(() => void 0);

        return () => { alive = false; };
    }, [open]);

    const pipeline = (status as { pipeline?: string | null; }).pipeline ?? null;
    const pipelineLabel = pipeline === "worker" || pipeline === "relay" ? T.videoRelay : pipeline === "page" ? T.videoPage : T.videoDirect;

    return (
        <section className={"vc-ir-details" + (open ? " vc-ir-details-open" : "")}>
            <div className="vc-ir-details-bar">
                <button className="vc-ir-details-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
                    <ChevronIcon size={14} className="vc-ir-details-chevron" />
                    {open ? T.detailsHide : T.detailsShow}
                </button>
                <VoiceCheck fallback={status.voiceFallback} />
            </div>

            {open && (
                <div className="vc-ir-details-body">
                    {status.mimeType && <Row label={T.detailFormat}><code>{status.mimeType}</code></Row>}
                    {pipeline && <Row label={T.detailVideo}>{pipelineLabel}</Row>}
                    {outputDir && (
                        <Row label={T.detailFolder}>
                            <button className="vc-ir-path" onClick={() => void Recorder.openOutputDir()}>{outputDir}</button>
                        </Row>
                    )}
                    {status.lastEvent && <Row label={T.detailLastEvent}>{status.lastEvent}</Row>}
                    {showPatchNote && <p className="vc-ir-details-note">{T.detailPatch}</p>}
                </div>
            )}
        </section>
    );
}
