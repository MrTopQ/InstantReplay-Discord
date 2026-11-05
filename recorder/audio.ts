/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { MediaEngineStore, SelectedChannelStore } from "@webpack/common";

import { T } from "../i18n";
import { followOutputDevice } from "./capture";
import { stopStream, withDeadline } from "./deadline";
import { failRun } from "./lifecycle";
import { createPacer } from "./pacer";
import { AUDIBLE_PEAK, monotonicNow, notify, SILENCE_ALARM_MS, state } from "./state";
import { brokenGroups, type DiscordVoiceProcessing, type GateGroup, inputGain, micConstraints, type MicMode, missingParts } from "./transmission";

const SpeakingStore = findStoreLazy("SpeakingStore");

export const SYSTEM_AUDIO = "system audio";
const MICROPHONE = "microphone";

const MIX_SAMPLE_RATE = 48_000;
const RESUME_TIMEOUT_MS = 3000;
const DEVICE_LIST_TIMEOUT_MS = 5000;
const MICROPHONE_TIMEOUT_MS = 8000;
const ANALYSER_FFT_SIZE = 1024;
const DEVICE_SETTLE_MS = 700;
const MIXER_STALL_MS = 6000;
const PEAK_FRESH_MS = 250;
const VOICE_DELAY_S = 0.15;
const GATE_OPEN_S = 0.01;
const GATE_CLOSE_S = 0.04;

export interface DeviceSignatures {
    output: string;
    input: string;
}

let audioContext: AudioContext | null = null;
let audioNodes: AudioNode[] = [];
let audioInputs: MediaStream[] = [];
let mixDestination: MediaStreamAudioDestinationNode | null = null;
let mixHub: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
let audibleAt = 0;
let soundMissing = false;
let lastPeak: number | null = null;
let lastPeakAt = 0;
let mixerTime = -1;
let mixerMovedAt = 0;

const audioSources = new Map<string, MediaStreamAudioSourceNode>();
const microphonePacer = createPacer("re-taking the microphone", monotonicNow);

let deviceWatch: (() => void) | null = null;
let outputSignature = "";
let inputSignature = "";
let requestedMode: MicMode = "always";
let microphoneMode: MicMode = "always";
let voiceFallback = false;
let closeVoiceGate: (() => void) | null = null;

function createMixerContext(): AudioContext {
    try {
        return new AudioContext({ sampleRate: MIX_SAMPLE_RATE });
    } catch (error) {
        console.error("[InstantReplay] the audio graph refused a fixed rate, taking the device one", error);
        return new AudioContext();
    }
}

async function chosenMicrophoneId(): Promise<string | null> {
    try {
        const chosen = MediaEngineStore.getInputDeviceId();
        if (!chosen || chosen === "default") return null;

        const name: string | undefined = (MediaEngineStore as any).getInputDevices?.()?.[chosen]?.name;
        if (!name) return null;

        const inputs = (await listDevices()).filter(device =>
            device.kind === "audioinput" && device.label
            && device.deviceId !== "default" && device.deviceId !== "communications");

        const match = inputs.find(device => device.label === name)
            ?? inputs.find(device => device.label.startsWith(name));

        return match?.deviceId ?? null;
    } catch {
        return null;
    }
}

function listDevices(): Promise<MediaDeviceInfo[]> {
    return withDeadline(navigator.mediaDevices.enumerateDevices(), DEVICE_LIST_TIMEOUT_MS, "listing the audio devices timed out");
}

function requestMicrophone(constraints: MediaTrackConstraints): Promise<MediaStream> {
    return withDeadline(
        navigator.mediaDevices.getUserMedia({ audio: constraints }),
        MICROPHONE_TIMEOUT_MS,
        "the microphone did not answer in time",
        stopStream
    );
}

function discordProcessing(): DiscordVoiceProcessing | null {
    try {
        const store = MediaEngineStore as any;

        return {
            echoCancellation: Boolean(store.getEchoCancellation()),
            noiseSuppression: Boolean(store.getNoiseSuppression()),
            noiseCancellation: Boolean(store.getNoiseCancellation?.()),
            automaticGainControl: Boolean(store.getAutomaticGainControl())
        };
    } catch (error) {
        console.error("[InstantReplay] could not read Discord's voice processing, using the raw microphone", error);
        return null;
    }
}

function readPart(read: () => unknown): unknown {
    try {
        return read();
    } catch {
        return undefined;
    }
}

function gatePartsMissing(): string[] {
    return missingParts({
        "SpeakingStore.isCurrentUserSpeaking": readPart(() => SpeakingStore.isCurrentUserSpeaking),
        "SpeakingStore.addChangeListener": readPart(() => SpeakingStore.addChangeListener),
        "MediaEngineStore.isSelfMute": readPart(() => MediaEngineStore.isSelfMute),
        "MediaEngineStore.addChangeListener": readPart(() => MediaEngineStore.addChangeListener),
        "SelectedChannelStore.getVoiceChannelId": readPart(() => SelectedChannelStore.getVoiceChannelId),
        "SelectedChannelStore.addChangeListener": readPart(() => SelectedChannelStore.addChangeListener)
    });
}

export interface VoiceGateCheck {
    checkedAt: number;
    broken: GateGroup[];
}

let lastCheck: VoiceGateCheck | null = null;

function runCheck(): string[] {
    const missing = gatePartsMissing();
    lastCheck = { checkedAt: Date.now(), broken: brokenGroups(missing) };
    return missing;
}

export function voiceGateCheck(): VoiceGateCheck {
    if (!lastCheck) runCheck();
    return lastCheck!;
}

export function recheckVoiceGate(): void {
    const healthy = runCheck().length === 0;

    if (state.micStream && requestedMode === "discord" && healthy === voiceFallback) {
        console.log(`[InstantReplay] the voice check now says ${healthy ? "healthy" : "broken"}, re-taking the microphone`);
        requestReattach(MICROPHONE);
    }

    notify();
}

function resolveMode(mode: MicMode): MicMode {
    voiceFallback = false;
    if (mode !== "discord") return mode;

    const missing = runCheck();
    if (!missing.length) return mode;

    console.error(`[InstantReplay] Discord no longer has ${missing.join(", ")}, recording the whole microphone instead`);
    voiceFallback = true;
    state.lastEvent = T.voiceGateMissing;
    notify();

    return "always";
}

export function usesVoiceFallback(): boolean {
    return voiceFallback;
}

export async function openMicrophone(mode: MicMode = requestedMode): Promise<MediaStream> {
    requestedMode = mode;
    microphoneMode = resolveMode(mode);

    const processing = micConstraints(microphoneMode, microphoneMode === "discord" ? discordProcessing() : null);
    const deviceId = await chosenMicrophoneId();

    if (deviceId) {
        try {
            return await requestMicrophone({ ...processing, deviceId: { exact: deviceId } });
        } catch (error) {
            console.error("[InstantReplay] the chosen microphone refused, trying the default one", error);
        }
    }

    return requestMicrophone(processing);
}

function isTransmitting(): boolean {
    try {
        return SelectedChannelStore.getVoiceChannelId() != null
            && !MediaEngineStore.isSelfMute()
            && Boolean(SpeakingStore.isCurrentUserSpeaking());
    } catch {
        return false;
    }
}

function currentInputGain(): number {
    try {
        return inputGain((MediaEngineStore as any).getInputVolume?.());
    } catch {
        return 1;
    }
}

function gateVoice(node: AudioNode, context: AudioContext, hub: AudioNode): void {
    closeVoiceGate?.();

    let open = isTransmitting();
    let level = currentInputGain();

    const delay = context.createDelay(1);
    delay.delayTime.value = VOICE_DELAY_S;
    const volume = context.createGain();
    volume.gain.value = level;
    const gate = context.createGain();
    gate.gain.value = open ? 1 : 0;

    node.connect(delay);
    delay.connect(volume);
    volume.connect(gate);
    gate.connect(hub);
    audioNodes.push(delay, volume, gate);

    const follow = () => {
        try {
            const now = context.currentTime;
            const nextLevel = currentInputGain();

            if (nextLevel !== level) {
                level = nextLevel;
                volume.gain.setTargetAtTime(level, now, GATE_OPEN_S);
            }

            const nextOpen = isTransmitting();
            if (nextOpen === open) return;

            open = nextOpen;
            gate.gain.cancelScheduledValues(now);

            if (open) gate.gain.setTargetAtTime(1, now, GATE_OPEN_S);
            else gate.gain.setTargetAtTime(0, now + VOICE_DELAY_S, GATE_CLOSE_S);
        } catch (error) {
            console.error("[InstantReplay] the voice gate could not follow Discord", error);
        }
    };

    const stores = [SpeakingStore, MediaEngineStore, SelectedChannelStore].filter(store => {
        try {
            store.addChangeListener(follow);
            return true;
        } catch (error) {
            console.error("[InstantReplay] the voice gate could not listen to a Discord store", error);
            return false;
        }
    });

    closeVoiceGate = () => {
        closeVoiceGate = null;

        for (const store of stores) {
            try {
                store.removeChangeListener(follow);
            } catch (error) {
                console.error("[InstantReplay] could not let go of a Discord store", error);
            }
        }

        for (const held of [delay, volume, gate]) held.disconnect();
        audioNodes = audioNodes.filter(held => held !== delay && held !== volume && held !== gate);
    };
}

export async function buildMixer(desktop: MediaStream, devices: DeviceSignatures): Promise<MediaStreamTrack[]> {
    const created = createMixerContext();
    audioContext = created;

    mixerTime = -1;
    mixerMovedAt = monotonicNow();

    created.addEventListener("error", () => {
        if (audioContext === created) console.error(`[InstantReplay] mixer: the audio device failed, state ${created.state}`);
    });

    created.addEventListener("statechange", () => {
        if (created.state !== "suspended" || audioContext !== created) return;

        console.error("[InstantReplay] the audio graph fell asleep, waking it up");
        void created.resume().catch(error => {
            console.error("[InstantReplay] could not wake the audio graph", error);
        });
    });

    if (created.state === "suspended") {
        await Promise.race([created.resume(), new Promise(resolve => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
    }

    const context = audioContext;
    if (!context) throw new Error(T.errorNotRunning);

    const destination = context.createMediaStreamDestination();
    const hub = context.createGain();
    const meter = context.createAnalyser();
    meter.fftSize = ANALYSER_FFT_SIZE;

    mixDestination = destination;
    mixHub = hub;
    analyser = meter;

    audibleAt = monotonicNow();

    hub.connect(destination);
    hub.connect(meter);
    audioNodes.push(destination, hub, meter);

    attachAudio(SYSTEM_AUDIO, desktop);
    if (state.micStream) attachAudio(MICROPHONE, state.micStream);

    watchDeviceChanges(devices);

    return destination.stream.getAudioTracks();
}

export async function deviceSignatures(): Promise<DeviceSignatures> {
    try {
        const devices = await listDevices();
        const signature = (kind: MediaDeviceKind) => {
            const preferred = devices.find(device => device.kind === kind && device.deviceId === "default")
                ?? devices.find(device => device.kind === kind);

            return preferred ? `${preferred.groupId}|${preferred.label}` : "";
        };

        return { output: signature("audiooutput"), input: signature("audioinput") };
    } catch {
        return { output: "", input: "" };
    }
}

function watchDeviceChanges(baseline: DeviceSignatures): void {
    outputSignature = baseline.output;
    inputSignature = baseline.input;

    deviceWatch?.();

    let settle: ReturnType<typeof setTimeout> | null = null;

    const onChange = () => {
        if (settle) clearTimeout(settle);

        settle = setTimeout(() => {
            settle = null;
            void syncAudioDevices();
        }, DEVICE_SETTLE_MS);
    };

    navigator.mediaDevices.addEventListener("devicechange", onChange);

    deviceWatch = () => {
        if (settle) clearTimeout(settle);
        navigator.mediaDevices.removeEventListener("devicechange", onChange);
    };

    void syncAudioDevices();
}

async function syncAudioDevices(): Promise<void> {
    if (!audioContext || !mixHub) return;

    const life = state.lifeId;
    const { output, input } = await deviceSignatures();

    if (life !== state.lifeId || !audioContext || !mixHub) return;

    if (output && !outputSignature) outputSignature = output;
    if (input && !inputSignature) inputSignature = input;

    if (output && output !== outputSignature) {
        outputSignature = output;
        state.lastEvent = T.errorAudioEnded;

        followOutputDevice();

        if (life !== state.lifeId || !audioContext || !mixHub) return;
    }

    if (input && input !== inputSignature) {
        inputSignature = input;

        const chosen = MediaEngineStore.getInputDeviceId();
        const followsDefault = !chosen || chosen === "default";

        if (state.micStream && followsDefault) {
            console.log("[InstantReplay] the default input changed, re-taking the microphone");
            requestReattach(MICROPHONE);
        }
    }
}

export function runningAudioContext(): AudioContext | null {
    return audioContext?.state === "running" ? audioContext : null;
}

export function attachAudio(name: string, source: MediaStream): void {
    const tracks = source.getAudioTracks();
    if (!tracks.length || !audioContext || !mixHub) return;

    detachAudio(name);

    const input = new MediaStream(tracks);
    audioInputs.push(input);

    const node = audioContext.createMediaStreamSource(input);
    if (name === MICROPHONE && microphoneMode === "discord") gateVoice(node, audioContext, mixHub);
    else node.connect(mixHub);
    audioNodes.push(node);
    audioSources.set(name, node);

    const onEnded = () => {
        if (audioSources.get(name) !== node) return;

        console.error(`[InstantReplay] the ${name} track ended, swapping it for the current device`);
        requestReattach(name);
    };

    tracks[0].addEventListener("ended", onEnded, { once: true });

    if (tracks[0].readyState === "ended") setTimeout(onEnded, 0);
}

function detachAudio(name: string): void {
    const node = audioSources.get(name);
    if (!node) return;

    if (name === MICROPHONE) closeVoiceGate?.();
    node.disconnect();
    audioSources.delete(name);
    audioNodes = audioNodes.filter(held => held !== node);
    audioInputs = audioInputs.filter(held => held !== node.mediaStream);
}

function requestReattach(name: string): void {
    if (!audioContext || !mixDestination) return;

    if (name !== MICROPHONE) {
        console.error("[InstantReplay] the system loopback died, swapping the capture to get a new one");

        state.lastEvent = T.errorAudioEnded;
        notify();

        followOutputDevice();
        return;
    }

    const life = state.lifeId;

    microphonePacer.request(async () => {
        if (life === state.lifeId) await reattachMicrophone();
    });
}

async function reattachMicrophone(): Promise<void> {
    if (!audioContext || !mixDestination) return;

    detachAudio(MICROPHONE);

    const life = state.lifeId;

    try {
        const fresh = await openMicrophone();

        if (life !== state.lifeId || !audioContext || !mixDestination) {
            fresh.getTracks().forEach(track => track.stop());
            return;
        }

        const previous = state.micStream;
        state.micStream = fresh;
        attachAudio(MICROPHONE, fresh);

        if (previous && previous !== fresh) previous.getTracks().forEach(track => track.stop());

        state.lastEvent = T.errorAudioEnded;
        notify();
    } catch (error) {
        console.error(`[InstantReplay] could not pick up the new ${MICROPHONE} device`, error);

        state.lastEvent = T.errorAudioEnded;
        notify();
    }
}

export function sampleAudio(freshMs = PEAK_FRESH_MS): number | null {
    if (!analyser) return null;

    const now = monotonicNow();
    if (lastPeak !== null && now - lastPeakAt < freshMs) return lastPeak;

    if (!samples || samples.length !== analyser.fftSize) samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);

    let peak = 0;
    for (const sample of samples) {
        const value = Math.abs(sample);
        if (value > peak) peak = value;
    }

    if (peak > AUDIBLE_PEAK) audibleAt = now;

    lastPeak = peak;
    lastPeakAt = now;

    return peak;
}

export function silentForMs(): number {
    return Math.max(0, monotonicNow() - audibleAt);
}

export function checkSoundMissing(): void {
    const missing = sampleAudio() !== null && silentForMs() > SILENCE_ALARM_MS;
    if (missing === soundMissing) return;

    soundMissing = missing;
    notify();
}

export function checkMixerAlive(): void {
    if (!audioContext) return;

    const now = monotonicNow();
    const time = audioContext.currentTime;

    if (time !== mixerTime) {
        mixerTime = time;
        mixerMovedAt = now;
        return;
    }

    if (now - mixerMovedAt < MIXER_STALL_MS) return;

    failRun(T.errorAudioStalled);
}

export function teardownAudio(): void {
    for (const node of audioNodes) node.disconnect();
    audioNodes = [];
    audioInputs = [];

    closeVoiceGate?.();
    deviceWatch?.();
    deviceWatch = null;
    outputSignature = "";
    inputSignature = "";

    audioSources.clear();
    lastPeak = null;
    mixDestination = null;
    mixHub = null;
    analyser = null;
    samples = null;
    soundMissing = false;
    voiceFallback = false;

    void audioContext?.close().catch(() => void 0);
    audioContext = null;
}
