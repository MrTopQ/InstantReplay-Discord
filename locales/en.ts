/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const en = {
    pluginDescription:
        "Keeps a rolling buffer of the screen and writes the last minutes to a file on a hotkey. " +
        "The picture comes from the Windows compositor rather than from the graphics card, so this " +
        "works on hybrid laptops where ShadowPlay reports no capture target and refuses to record " +
        "anything outside of games.",

    settingLanguage: "Language of the plugin's own text. Auto follows the language Discord is set to",
    settingLanguageAuto: "Auto (follow Discord)",
    settingBufferSeconds:
        "How many seconds to keep. The buffer lives in memory and holds this window and no more, " +
        "so the window together with the bitrate is what sets the cost",
    settingResolution: "Recording resolution. Drop it first if the client starts stuttering",
    settingFrameRate: "Frames per second",
    settingBitrate:
        "Video bitrate in Mbps. It is also what the buffer costs in memory, since one window of " +
        "video is held at all times. Six is plenty, and the eye barely tells the difference above it",
    settingCaptureAudio:
        "Record system audio. Windows hands over the whole system mix, so music and the browser land " +
        "in the clip together with Discord",
    settingMicMode:
        "Your voice in clips. System audio only carries what the speakers play, so without the microphone " +
        "you are the one person missing from your own clips. \"As in Discord\" records your voice only while " +
        "Discord transmits it, by voice activity or push to talk, with the volume and processing from its voice " +
        "settings. Muted or outside a call, the clip has no voice. Krisp cannot be repeated, plain noise " +
        "suppression stands in for it. The voice trails the picture by 0.15 s so the first syllable is not cut",
    micModeDiscord: "As in Discord, only while you talk in voice",
    micModeAlways: "The whole microphone, all the time",
    micModeOff: "Do not record",
    settingSource:
        "What to capture. Capturing the window alone keeps everything else on screen out of the " +
        "file and gives the encoder less work, but a stream opened in its own window falls outside it",
    sourceScreen: "Whole screen",
    sourceWindow: "Discord only",
    settingGrace:
        "Seconds the buffer keeps running after you leave a voice channel. Joining another channel " +
        "within that time keeps it going and loses nothing",
    settingSaveSoundVolume:
        "How loud the saved clip chime is, in percent. It plays the moment the clip is captured, without " +
        "waiting for the file, and is heard over a fullscreen game where Windows mutes its own notifications. " +
        "At zero there is no chime",
    settingAnnounceSave: "Show a notification when a clip is saved",
    settingNotifySound:
        "Let that notification make a sound. While Discord is not in focus the notification comes from Windows " +
        "and plays its own sound. Turn this off to get it silently",
    settingHotkey: "Hotkey that saves the buffer",
    settingGlobalHotkey:
        "Claim the hotkey system wide, so it also fires while Discord sits in the tray or a game is " +
        "in front. Another program may already hold the combination, and then the plugin says so " +
        "instead of going quiet",
    settingScreen: "Which screen to record",
    screenPrimary: "primary",
    screenLabel: (index: number, name: string) => `Screen ${index + 1} (${name})`,
    settingMode: "When the buffer should run",
    modeAlways: "Always, from launch",
    modeVoice: "Only while in a voice channel",

    stateRecording: "Recording",
    stateStarting: "Starting",
    stateGrace: "Left voice, winding down",
    stateWaiting: "Waiting for a voice channel",
    stateStopped: "Stopped",
    stateRecovering: "Down, coming back on its own",
    statePluginOff: "The plugin is off",
    stateWaitingHint: "The buffer starts by itself as soon as you join a voice channel",
    stateStoppedHint: "Nothing is being recorded right now",
    heroOf: (target: string) => `of ${target}`,
    heroFilling: "filling up",
    heroFull: "window is full",
    tileMemory: "in memory",
    tilePerMinute: "per minute",
    tileCeiling: (max: string) => `ceiling ${max}`,
    tileCeilingOnly: "per minute at most",
    audioLive: "Sound is flowing",
    audioQuiet: "Quiet right now",
    audioSilent: "Sound is gone",
    audioOff: "Sound is off",
    buttonStart: "Start buffer",
    buttonStop: "Stop",
    buttonSave: (duration: string) => `Save last ${duration}`,
    buttonSaveEmpty: "Save replay",
    buttonSaving: "Saving",
    subtitle: (size: string, fps: number, mbps: number) => `${size}, ${fps} fps, ${mbps} Mbps`,

    detailsShow: "Details",
    detailsHide: "Hide details",
    detailFormat: "Format",
    detailVideo: "Video track",
    videoRelay: "Frame relay in a worker",
    videoPage: "Frame relay on Discord's main thread",
    videoDirect: "Straight from the capture",
    detailFolder: "Clips folder",
    detailLastEvent: "Last event",
    voiceCheckOk: "Voice as in Discord works",
    voiceCheckBroken: "Voice as in Discord is broken",
    voiceCheckPart: {
        speaking: "Sees when you talk",
        mute: "Sees your mute and microphone volume",
        channel: "Sees which channel you are in"
    },
    voiceCheckNote: (time: string) => `Checked at ${time}. Click to check again`,
    detailPatch:
        "The title bar button rides on a patch of Discord. If it disappears after a client update the " +
        "patch stopped matching, which an update to this plugin fixes, not a setting",

    sizeKB: (value: string) => `${value} KB`,
    sizeMB: (value: string) => `${value} MB`,
    sizeGB: (value: string) => `${value} GB`,
    dayToday: "today",
    dayYesterday: "yesterday",

    durationMinutes: (mins: number, secs: number) => `${mins} min ${secs} s`,
    durationSeconds: (secs: number) => `${secs} s`,

    toastStarted: "Replay buffer running",
    toastStartFailed: (message: string) => `Replay buffer failed to start. ${message}`,
    toastNotRunning: "Replay buffer is not running",
    toastPluginOff: "InstantReplay is switched off, so there is nothing to start",
    toastSaving: "Saving replay",
    toastSaved: (name: string) => `Replay saved as ${name}`,
    toastSaveFailed: (message: string) => `Save failed. ${message}`,
    toastGlobalHotkeyClaimed: (hotkey: string) => `${hotkey} claimed system wide`,
    toastGlobalHotkeyBusy: (hotkey: string) =>
        `Another program already holds ${hotkey}, so it only fires while Discord has focus`,
    notifySavedTitle: "Replay saved",
    notifySavedBody: (name: string, duration: string) => `${name}, ${duration}. Click to open the folder`,

    errorNoFormat: "This Chromium build offers no recording format the plugin can use",
    errorNoSource: "Electron reported no screen to capture",
    errorNoWindow: "Electron could not point at the Discord window",
    errorCaptureTimeout: (seconds: number) => `The screen capture did not answer within ${seconds} s, the buffer will try again`,
    errorCaptureEnded: "The screen capture ended on its own, so the buffer stopped",
    errorCaptureLost: "The screen capture ended. The buffer keeps the last frame and waits for the picture to come back",
    errorCaptureBack: "The screen capture came back, nothing held was lost",
    errorAudioStalled: "The audio mixer stopped, usually after the output device failed, so the buffer restarted",
    errorAudioEnded: "The audio source went away, the buffer is picking up the new one",
    errorSizeChanged: (from: string, to: string) => `The frame size went from ${from} to ${to}, so the buffer restarted`,
    errorScreenGone: (name: string) => `The chosen screen is gone, recording "${name}" instead`,
    errorRelayFrozen: "The frame relay never received a frame, so recording now goes straight from the capture",
    voiceGateMissing:
        "Discord changed and the plugin can no longer see when you talk. Until a plugin update fixes that, " +
        "your voice comes from the whole microphone",
    errorNotRunning: "The buffer is not running",
    errorAlreadySaving: "A save is already in progress",
    errorBufferEmpty: "The buffer is empty",
    errorEmptyFile: "The buffer produced an empty file",
    errorNoSpace: "Not enough free space on the drive holding the clips",
    errorRecorder: (name: string) => `Recorder failed with ${name}`,
    errorNoDuration: "The clip went out without a length in its header, so players will show 0:00 and refuse to seek",
    errorStreamLost: "The recording stream stopped parsing, so the recorder was restarted",
    errorStaleMain:
        "Discord's main process is still running an older build of this plugin. The clip was saved, " +
        "but without a length. A full restart of the client, not a page reload, is what fixes it",

    toolboxSave: "Save replay",
    toolboxOpen: "Open InstantReplay",

    headerTooltip: (state: string) => `InstantReplay, ${state}`,
    headerState: {
        off: "buffer is off",
        waiting: "waiting for a voice channel",
        live: "recording",
        silent: "recording, but the sound is gone",
        saving: "saving a clip",
        error: "stopped after a failure"
    } as Record<string, string>,

    clipsRecent: "Latest clips",
    clipsNone: "Nothing saved yet. Press the hotkey during a moment worth keeping",
    clipOpen: "Play",
    clipReveal: "Show in folder",
    clipsFolder: "Open folder",

    windowSettings: "Settings",
    hotkeyChange: "Change the hotkey",
    hotkeyListening: "Press a combination",
    hotkeyNeedsModifier: "Add Ctrl, Alt or Win",
    hotkeyUnsupported: "This key cannot be used",
    windowClose: "Close"
};

export type Messages = typeof en;
