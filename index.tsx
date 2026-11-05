/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { debounce } from "@shared/debounce";
import definePlugin from "@utils/types";

import type { RtcStateEvent } from "./callTracker";
import { renderHeaderButton } from "./components/HeaderButton";
import { closeWindow } from "./components/Overlay";
import { openReplayWindow } from "./components/ReplayWindow";
import {
    applyGlobalHotkey,
    clearStoppedByUser,
    installHotkeyBridge,
    removeHotkeyBridge,
    restartIfRunning,
    saveReplay,
    setActive
} from "./controller";
import { registerHotkey, unregisterHotkey } from "./hotkey";
import { T } from "./i18n";
import * as Recorder from "./recorder";
import {
    DEFAULT_HOTKEY,
    migrateSettings,
    onBufferSecondsChanged,
    onCaptureSettingsChanged,
    onHotkeySettingsChanged,
    onModeChanged,
    settings
} from "./settings";
import { forgetSound } from "./sound";
import { StatusPanel } from "./StatusPanel";
import {
    cancelPendingStop,
    handleCallCreate,
    handleCallDelete,
    handleChannelSelect,
    handleRtcState,
    handleVoiceStateUpdates,
    startVoiceWatch,
    stopVoiceWatch,
    syncWithVoice,
    VoiceStateUpdate
} from "./voice";

const HOTKEY_SETTLE_MS = 600;

onCaptureSettingsChanged(restartIfRunning);
onModeChanged(syncWithVoice);
onBufferSecondsChanged(() => Recorder.setBufferSeconds(settings.store.bufferSeconds));
onHotkeySettingsChanged(debounce(() => applyGlobalHotkey(true), HOTKEY_SETTLE_MS));

const releaseHotkeyOnUnload = () => {
    VencordNative.pluginHelpers.InstantReplay.unregisterGlobalHotkey().catch(() => void 0);
};

const plugin = definePlugin({
    name: "InstantReplay",
    get description() {
        return T.pluginDescription;
    },
    authors: [
        {
            name: "TopQ",
            id: 523800559791374356n
        }
    ],

    settings,
    settingsAboutComponent: StatusPanel,
    requiresRestart: false,

    patches: [
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(?<=trailing:.{0,80}?\{children:\[)/,
                replace: "$self.renderHeaderButton(),"
            }
        }
    ],

    renderHeaderButton: () => renderHeaderButton(plugin),

    get toolboxActions() {
        return {
            [T.toolboxSave]: () => saveReplay(true),
            [T.toolboxOpen]: () => openReplayWindow(plugin)
        };
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceStateUpdate[]; }) {
            handleVoiceStateUpdates(voiceStates);
        },
        VOICE_CHANNEL_SELECT({ channelId }: { channelId?: string | null; }) {
            handleChannelSelect(channelId);
        },
        CALL_CREATE({ channelId }: { channelId?: string | null; }) {
            handleCallCreate(channelId);
        },
        CALL_DELETE({ channelId }: { channelId?: string | null; }) {
            handleCallDelete(channelId);
        },
        RTC_CONNECTION_STATE(event: RtcStateEvent) {
            handleRtcState(event);
        }
    },

    async start() {
        migrateSettings();
        setActive(true);

        registerHotkey(() => settings.store.hotkey || DEFAULT_HOTKEY, () => void saveReplay(false));
        installHotkeyBridge();
        void applyGlobalHotkey(false);
        window.addEventListener("pagehide", releaseHotkeyOnUnload);

        void Recorder.refreshSources();

        VencordNative.pluginHelpers.InstantReplay.releaseOpenFiles(Recorder.SESSION)
            .catch(error => console.error("[InstantReplay] startup cleanup failed", error));

        clearStoppedByUser();
        startVoiceWatch();
        await syncWithVoice();
    },

    async stop() {
        setActive(false);

        closeWindow({ animate: false, reason: "plugin stopped" });
        unregisterHotkey();
        removeHotkeyBridge();
        window.removeEventListener("pagehide", releaseHotkeyOnUnload);
        VencordNative.pluginHelpers.InstantReplay.unregisterGlobalHotkey()
            .catch(error => console.error("[InstantReplay] could not release the hotkey", error));
        cancelPendingStop();
        stopVoiceWatch();
        forgetSound();

        await Recorder.stop();
    }
});

export default plugin;
