/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";

import { effectiveBitrate } from "../controller";
import { T } from "../i18n";
import { settings } from "../settings";
import { ClipList } from "./ClipList";
import { Details } from "./Details";
import { Hero } from "./Hero";
import { Hint } from "./Hint";
import { HotkeyPicker } from "./HotkeyPicker";
import { CloseIcon, ReplayIcon, SettingsIcon } from "./icons";
import { closeWindow, isWindowOpen, openWindow } from "./Overlay";
import { phaseOf, useRecorderStatus } from "./useStatus";

const TITLE = "InstantReplay";

function ReplayWindow({ plugin, onClose }: { plugin: any; onClose: () => void; }) {
    const status = useRecorderStatus();
    const { resolution, frameRate } = settings.use(["resolution", "frameRate", "bitrateMbps"]);
    const phase = phaseOf(status);

    const openSettings = () => {
        closeWindow({ animate: false, reason: "opened settings" });
        openPluginModal(plugin);
    };

    return (
        <div className={`vc-ir-shell vc-ir-shell-${phase}`}>
            <header className="vc-ir-head">
                <span className="vc-ir-head-icon"><ReplayIcon width={22} height={22} /></span>
                <div className="vc-ir-head-text">
                    <span className="vc-ir-head-title">{TITLE}</span>
                    <span className="vc-ir-head-line">{T.subtitle(resolution.replace("x", "×"), frameRate, effectiveBitrate())}</span>
                </div>
                <HotkeyPicker />
                <Hint text={T.windowSettings}>
                    {hint => (
                        <button className="vc-ir-icon-button" aria-label={T.windowSettings} onClick={openSettings} {...hint}>
                            <SettingsIcon size={18} />
                        </button>
                    )}
                </Hint>
                <Hint text={T.windowClose}>
                    {hint => (
                        <button className="vc-ir-icon-button" aria-label={T.windowClose} onClick={onClose} {...hint}>
                            <CloseIcon size={18} />
                        </button>
                    )}
                </Hint>
            </header>

            <div className="vc-ir-body">
                <Hero status={status} />
                <ClipList />
                <Details status={status} showPatchNote={true} />
            </div>
        </div>
    );
}

export function toggleReplayWindow(plugin: any): void {
    if (isWindowOpen()) {
        closeWindow({ reason: "header button" });
        return;
    }

    openWindow(TITLE, close => <ReplayWindow plugin={plugin} onClose={close} />);
}

export function openReplayWindow(plugin: any): void {
    openWindow(TITLE, close => <ReplayWindow plugin={plugin} onClose={close} />);
}
