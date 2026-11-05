/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { formatClock, T } from "../i18n";
import * as Recorder from "../recorder";
import { formatBytes, formatSavedAt } from "./format";
import { Hint } from "./Hint";
import { ChevronIcon, FilmIcon, FolderIcon, PlayIcon } from "./icons";

const SHOWN = 4;
const THUMB_WAIT_MS = 5000;

function Thumb({ clip }: { clip: Recorder.ClipInfo; }) {
    const [broken, setBroken] = useState(false);
    const { thumb } = clip as { thumb?: string | null; };

    return (
        <span className="vc-ir-thumb">
            {thumb && !broken
                ? <img src={thumb} alt="" draggable={false} onError={() => setBroken(true)} />
                : <FilmIcon size={22} className="vc-ir-thumb-empty" />}
            <span className="vc-ir-thumb-play"><PlayIcon size={18} /></span>
            {clip.durationMs > 0 && <span className="vc-ir-thumb-badge">{formatClock(clip.durationMs / 1000)}</span>}
        </span>
    );
}

function ClipRow({ clip }: { clip: Recorder.ClipInfo; }) {
    return (
        <li className="vc-ir-clip">
            <Hint text={clip.name}>
                {hint => (
                    <button className="vc-ir-clip-main" onClick={() => void Recorder.openClip(clip.path)} {...hint}>
                        <Thumb clip={clip} />
                        <span className="vc-ir-clip-text">
                            <span className="vc-ir-clip-title">{formatSavedAt(clip.savedAt)}</span>
                            <span className="vc-ir-clip-meta">{formatBytes(clip.bytes)}</span>
                        </span>
                    </button>
                )}
            </Hint>
            <Hint text={T.clipReveal}>
                {hint => (
                    <button className="vc-ir-icon-button" aria-label={T.clipReveal} onClick={() => void Recorder.reveal(clip.path)} {...hint}>
                        <FolderIcon size={18} />
                    </button>
                )}
            </Hint>
        </li>
    );
}

export function ClipList() {
    const [clips, setClips] = useState<Recorder.ClipInfo[] | null>(null);

    useEffect(() => {
        let alive = true;
        let wasSaving = Recorder.getStatus().saving;
        let awaitingThumbUntil = 0;

        const load = () => Recorder.listClips(SHOWN).then(found => {
            if (alive) setClips(found);
        });

        const update = () => {
            const { saving } = Recorder.getStatus();

            if (wasSaving && !saving) {
                awaitingThumbUntil = Date.now() + THUMB_WAIT_MS;
                void load();
            } else if (!saving && Date.now() < awaitingThumbUntil) {
                void load();
            }

            wasSaving = saving;
        };

        void load();
        const unsubscribe = Recorder.subscribe(update);

        return () => {
            alive = false;
            unsubscribe();
        };
    }, []);

    return (
        <section className="vc-ir-section">
            <header className="vc-ir-section-head">
                <h3 className="vc-ir-section-title">{T.clipsRecent}</h3>
                <button className="vc-ir-link" onClick={() => void Recorder.openOutputDir()}>
                    {T.clipsFolder}
                    <ChevronIcon size={14} />
                </button>
            </header>

            {clips && clips.length === 0 && (
                <div className="vc-ir-empty">
                    <FilmIcon size={22} />
                    <span>{T.clipsNone}</span>
                </div>
            )}

            {clips && clips.length > 0 && (
                <ul className="vc-ir-clips">
                    {clips.map(clip => <ClipRow key={clip.path} clip={clip} />)}
                </ul>
            )}

            {!clips && <div className="vc-ir-clips-loading" />}
        </section>
    );
}
