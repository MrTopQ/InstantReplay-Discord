/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface VideoPipe {
    track: MediaStreamTrack;
    runsIn: "worker" | "page";
    setSource(source: MediaStream): void;
    frameAge(): number;
    refresh(): void;
    seenFrame(): boolean;
    snapshot(maxWidth: number): Promise<Blob | null>;
    stop(): void;
}

interface TrackProcessor {
    readable: ReadableStream<VideoFrame>;
}

interface TrackGenerator extends MediaStreamTrack {
    writable: WritableStream<VideoFrame>;
}

type ProcessorClass = new (init: { track: MediaStreamTrack; }) => TrackProcessor;
type GeneratorClass = new (init: { kind: "video"; }) => TrackGenerator;

function processorClass(): ProcessorClass | null {
    const value = (globalThis as any).MediaStreamTrackProcessor;
    return typeof value === "function" ? value : null;
}

function generatorClass(): GeneratorClass | null {
    const value = (globalThis as any).MediaStreamTrackGenerator;
    return typeof value === "function" ? value : null;
}

export function monotonicNow(): number {
    return performance.timeOrigin + performance.now();
}

export function relaySupported(): boolean {
    return processorClass() !== null
        && generatorClass() !== null
        && typeof (globalThis as any).VideoFrame === "function";
}

interface RelayState {
    lastFreshAt: number;
    seenFrame: boolean;
}

interface RelayCore {
    setSource(readable: ReadableStream<VideoFrame> | null): void;
    refresh(): void;
    snapshot(maxWidth: number): Promise<Blob | null>;
    state(): RelayState;
    stop(): void;
}

function relayCore(writable: WritableStream<VideoFrame>, width: number, height: number, frameRate: number): RelayCore {
    const IDLE_FRAME_MS = 500;
    const PULSE_TICK_MS = 250;
    const SNAPSHOT_QUALITY = 0.8;

    const i420Size = (w: number, h: number) => w * h + 2 * Math.ceil(w / 2) * Math.ceil(h / 2);
    const clock = () => performance.timeOrigin + performance.now();

    const writer = writable.getWriter();

    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
    let generation = 0;
    let stopped = false;

    let held: VideoFrame | null = null;
    let still: { data: Uint8Array; init: VideoFrameBufferInit; } | null = null;
    let copying = false;
    let copyBroken = false;

    let lastTimestamp = 0;
    let lastEmitAt = 0;
    let lastFreshAt = clock();
    let seenFrame = false;

    const frameGapMs = 1000 / frameRate;
    let nextFrameDueAt = clock();

    let black: Uint8Array | null = null;

    let fitter: OffscreenCanvasRenderingContext2D | null = null;
    let fitted = "";
    let fitFailures = 0;

    function send(frame: VideoFrame, now: number): void {
        if (stopped || (writer.desiredSize ?? 1) <= 0) {
            frame.close();
            return;
        }

        lastTimestamp = frame.timestamp;
        lastEmitAt = now;

        writer.write(frame).catch(() => frame.close());
    }

    function syntheticTimestamp(now: number): number {
        return lastTimestamp + Math.max(1, Math.round((now - lastEmitAt) * 1000));
    }

    function blackFrame(timestamp: number): VideoFrame {
        if (!black) {
            const luma = width * height;

            black = new Uint8Array(i420Size(width, height));
            black.fill(16, 0, luma);
            black.fill(128, luma);
        }

        return new VideoFrame(black, { format: "I420", codedWidth: width, codedHeight: height, timestamp });
    }

    function frameSize(frame: VideoFrame): { width: number; height: number; } {
        return {
            width: frame.visibleRect?.width ?? frame.displayWidth,
            height: frame.visibleRect?.height ?? frame.displayHeight
        };
    }

    function fit(frame: VideoFrame): VideoFrame | null {
        const size = frameSize(frame);
        if (size.width === width && size.height === height) return frame;

        try {
            if (!fitter) {
                fitter = new OffscreenCanvas(width, height).getContext("2d", { alpha: false });
                if (!fitter) throw new Error("no 2d context");
            }

            const scale = Math.min(width / size.width, height / size.height);
            const drawWidth = size.width * scale;
            const drawHeight = size.height * scale;

            const geometry = `${drawWidth}x${drawHeight}`;
            if (geometry !== fitted) {
                fitted = geometry;
                fitter.fillStyle = "#000000";
                fitter.fillRect(0, 0, width, height);
            }

            fitter.drawImage(frame, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

            return new VideoFrame(fitter.canvas, { timestamp: frame.timestamp });
        } catch (error) {
            if (fitFailures++ === 0) console.error("[InstantReplay] relay: could not fit a frame", error);
            return null;
        } finally {
            frame.close();
        }
    }

    function onSourceFrame(frame: VideoFrame): void {
        const now = clock();

        if (now < nextFrameDueAt) {
            if (seenFrame) lastFreshAt = now;

            frame.close();
            return;
        }
        nextFrameDueAt = Math.max(now + 1, nextFrameDueAt + frameGapMs);

        const ready = fit(frame);
        if (!ready) return;

        lastFreshAt = now;
        seenFrame = true;

        held?.close();
        held = ready.clone();
        still = null;

        send(ready, now);
    }

    async function captureStill(source: VideoFrame): Promise<void> {
        copying = true;

        try {
            const data = new Uint8Array(source.allocationSize());
            const layout = await source.copyTo(data);
            const size = frameSize(source);

            if (stopped || held !== source) return;
            if (!source.format) throw new Error("the frame has no pixel format");

            still = {
                data,
                init: {
                    format: source.format,
                    codedWidth: size.width,
                    codedHeight: size.height,
                    layout,
                    colorSpace: source.colorSpace?.toJSON?.(),
                    timestamp: 0
                }
            };

            held = null;
            source.close();
        } catch (error) {
            if (stopped || held !== source) return;

            copyBroken = true;
            console.error("[InstantReplay] relay: could not copy the last frame, the still picture will repeat it as is", error);
        } finally {
            copying = false;
        }
    }

    async function pulse(force = false): Promise<void> {
        if (copying) return;

        const askedAt = clock();
        if (!still && held && !copyBroken) await captureStill(held);

        const now = clock();
        if (stopped || (force ? lastEmitAt > askedAt : now - lastEmitAt < IDLE_FRAME_MS)) return;

        if (still) {
            send(new VideoFrame(still.data, { ...still.init, timestamp: syntheticTimestamp(now) }), now);
            return;
        }

        if (held) {
            send(held.clone(), now);
            return;
        }

        send(blackFrame(syntheticTimestamp(now)), now);
    }

    function drawScaled(source: VideoFrame, maxWidth: number): OffscreenCanvas | null {
        const size = frameSize(source);
        if (!size.width || !size.height) return null;

        const scale = Math.min(1, maxWidth / size.width);
        const surface = new OffscreenCanvas(Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale)));
        const context = surface.getContext("2d", { alpha: false });
        if (!context) return null;

        context.drawImage(source, 0, 0, surface.width, surface.height);
        return surface;
    }

    async function snapshot(maxWidth: number): Promise<Blob | null> {
        if (stopped) return null;

        let surface: OffscreenCanvas | null = null;

        if (held) {
            surface = drawScaled(held, maxWidth);
        } else if (still) {
            const copy = new VideoFrame(still.data, still.init);

            try {
                surface = drawScaled(copy, maxWidth);
            } finally {
                copy.close();
            }
        }

        if (!surface) return null;

        return surface.convertToBlob({ type: "image/jpeg", quality: SNAPSHOT_QUALITY });
    }

    async function pump(source: ReadableStreamDefaultReader<VideoFrame>, mine: number): Promise<void> {
        try {
            for (;;) {
                const { value, done } = await source.read();
                if (done) return;

                if (stopped || mine !== generation) {
                    value.close();
                    return;
                }

                onSourceFrame(value);
            }
        } catch (error) {
            if (!stopped && mine === generation) console.error("[InstantReplay] relay: the capture stopped handing over frames", error);
        }
    }

    send(blackFrame(0), clock());

    const timer = setInterval(() => {
        if (clock() - lastEmitAt >= IDLE_FRAME_MS) void pulse();
    }, PULSE_TICK_MS);

    return {
        setSource(readable: ReadableStream<VideoFrame> | null) {
            generation++;

            const previous = reader;
            reader = null;
            void previous?.cancel().catch(() => void 0);

            lastFreshAt = clock();

            if (!readable) return;

            try {
                reader = readable.getReader();
                void pump(reader, generation);
            } catch (error) {
                console.error("[InstantReplay] relay: could not attach to the capture", error);
            }
        },

        refresh() {
            if (seenFrame && clock() - lastFreshAt < 2 * frameGapMs) return;

            void pulse(true);
        },

        snapshot,

        state() {
            return { lastFreshAt, seenFrame };
        },

        stop() {
            stopped = true;
            generation++;
            clearInterval(timer);

            void reader?.cancel().catch(() => void 0);
            reader = null;

            held?.close();
            held = null;
            still = null;

            void writer.close().catch(() => void 0);
        }
    };
}

function readableFor(Processor: ProcessorClass, source: MediaStream): ReadableStream<VideoFrame> | null {
    const [track] = source.getVideoTracks();
    if (!track) return null;

    try {
        return new Processor({ track }).readable;
    } catch (error) {
        console.error("[InstantReplay] relay: could not attach to the capture", error);
        return null;
    }
}

export function createRelayPipe(width: number, height: number, frameRate: number, worker: Worker | null = null): VideoPipe {
    const Processor = processorClass();
    const Generator = generatorClass();
    if (!Processor || !Generator) throw new Error("MediaStreamTrackProcessor is not available");

    const generator = new Generator({ kind: "video" });

    if (worker) return workerPipe(worker, generator, Processor, width, height, frameRate);

    const core = relayCore(generator.writable, width, height, frameRate);

    return {
        track: generator,
        runsIn: "page",

        setSource(source: MediaStream) {
            core.setSource(readableFor(Processor, source));
        },

        frameAge() {
            return monotonicNow() - core.state().lastFreshAt;
        },

        refresh() {
            core.refresh();
        },

        seenFrame() {
            return core.state().seenFrame;
        },

        snapshot(maxWidth: number) {
            return core.snapshot(maxWidth);
        },

        stop() {
            core.stop();
            generator.stop();
        }
    };
}

function workerMain(core: typeof relayCore): void {
    const STATE_POST_MS = 1000;

    let current: RelayCore | null = null;
    let currentId = 0;
    let postedState = "";

    function replySnapshot(id: number, request: number, blob: Blob | null): void {
        postMessage({ type: "snapshot", id, request, blob });
    }

    self.onmessage = (event: MessageEvent) => {
        const { data: message } = event;

        if (message.type === "start") {
            current?.stop();
            currentId = message.id;
            current = core(message.writable, message.width, message.height, message.frameRate);
            return;
        }

        if (message.id !== currentId || !current) {
            if (message.type === "snapshot") replySnapshot(message.id, message.request, null);
            return;
        }

        if (message.type === "source") current.setSource(message.readable ?? null);
        else if (message.type === "refresh") current.refresh();
        else if (message.type === "snapshot") {
            const { id, request } = message;

            current.snapshot(message.maxWidth).then(
                blob => replySnapshot(id, request, blob),
                error => {
                    console.error("[InstantReplay] relay: could not take a snapshot", error);
                    replySnapshot(id, request, null);
                }
            );
        } else if (message.type === "stop") {
            current.stop();
            current = null;
        }
    };

    setInterval(() => {
        if (!current) return;

        const state = current.state();
        const key = `${currentId}:${state.lastFreshAt}:${state.seenFrame}`;
        if (key === postedState) return;

        postedState = key;
        postMessage({ type: "state", id: currentId, state, sentAt: performance.timeOrigin + performance.now() });
    }, STATE_POST_MS);

    postMessage({ type: "ready" });
}

const WORKER_READY_MS = 2000;
const WORKER_CREATION_LIMIT = 3;
const SNAPSHOT_REPLY_TIMEOUT_MS = 2000;

let workerStarting: Promise<Worker | null> | null = null;
let workerInstance: Worker | null = null;
let workerFaulted = false;
let workerCreations = 0;

function onWorkerError(worker: Worker, event: Event): void {
    if (workerInstance !== worker) return;

    console.error("[InstantReplay] relay: the worker reported an error, the next start takes a fresh one", (event as ErrorEvent).message);
    workerFaulted = true;
}

function spawnWorker(): Promise<Worker | null> {
    return new Promise(resolve => {
        let worker: Worker;

        try {
            const source = `var __name = t => t;\n(${workerMain.toString()})(${relayCore.toString()});`;
            const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

            worker = new Worker(url);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("[InstantReplay] relay: no worker, the relay stays on the page", error);
            resolve(null);
            return;
        }

        let settled = false;

        const settle = (ready: boolean, reason: string) => {
            if (settled) return;
            settled = true;

            clearTimeout(timer);
            worker.removeEventListener("message", onReady);
            worker.removeEventListener("error", onStartError);

            if (ready) {
                worker.addEventListener("error", event => onWorkerError(worker, event));
                resolve(worker);
                return;
            }

            console.error(`[InstantReplay] relay: the worker did not come up (${reason}), the relay stays on the page`);
            worker.terminate();
            resolve(null);
        };

        const onReady = (event: MessageEvent) => {
            if (event.data?.type === "ready") settle(true, "ready");
        };

        const onStartError = () => settle(false, "error");

        const timer = setTimeout(() => settle(false, "timeout"), WORKER_READY_MS);

        worker.addEventListener("message", onReady);
        worker.addEventListener("error", onStartError);
    });
}

function retireWorker(): void {
    workerInstance?.terminate();
    workerInstance = null;
    workerFaulted = false;
}

export function prepareRelayWorker(): Promise<Worker | null> {
    if (workerStarting) return workerStarting;
    if (workerInstance && !workerFaulted) return Promise.resolve(workerInstance);
    if (workerCreations >= WORKER_CREATION_LIMIT) return Promise.resolve(workerInstance);

    retireWorker();
    workerCreations++;

    const starting = spawnWorker().then(worker => {
        workerInstance = worker;
        if (workerStarting === starting) workerStarting = null;

        return worker;
    });

    workerStarting = starting;

    return starting;
}

export function relayWorker(): Worker | null {
    return workerInstance;
}

let nextPipeId = 1;
let nextSnapshotRequest = 1;

function onPageClock(reported: RelayState, sentAt: number): RelayState {
    const age = Math.max(0, sentAt - reported.lastFreshAt);

    return { lastFreshAt: monotonicNow() - age, seenFrame: reported.seenFrame };
}

function workerPipe(
    worker: Worker,
    generator: TrackGenerator,
    Processor: ProcessorClass,
    width: number,
    height: number,
    frameRate: number
): VideoPipe {
    const id = nextPipeId++;
    let state: RelayState = { lastFreshAt: monotonicNow(), seenFrame: false };
    const pendingSnapshots = new Map<number, (blob: Blob | null) => void>();

    const onMessage = (event: MessageEvent) => {
        const message = event.data;
        if (message?.id !== id) return;

        if (message.type === "state") state = onPageClock(message.state, message.sentAt);
        else if (message.type === "snapshot") pendingSnapshots.get(message.request)?.(message.blob ?? null);
    };

    worker.addEventListener("message", onMessage);

    const { writable } = generator;
    worker.postMessage({ type: "start", id, writable, width, height, frameRate }, [writable as unknown as Transferable]);

    const alive = () => relayWorker() === worker;

    return {
        track: generator,
        runsIn: "worker",

        setSource(source: MediaStream) {
            state = { ...state, lastFreshAt: monotonicNow() };

            const readable = readableFor(Processor, source);
            if (readable) worker.postMessage({ type: "source", id, readable }, [readable as unknown as Transferable]);
            else worker.postMessage({ type: "source", id, readable: null });
        },

        frameAge() {
            return alive() ? monotonicNow() - state.lastFreshAt : Number.POSITIVE_INFINITY;
        },

        refresh() {
            worker.postMessage({ type: "refresh", id });
        },

        seenFrame() {
            return alive() && state.seenFrame;
        },

        snapshot(maxWidth: number) {
            if (!alive()) return Promise.resolve(null);

            const request = nextSnapshotRequest++;

            return new Promise<Blob | null>(resolve => {
                let timer: ReturnType<typeof setTimeout> | null = null;

                const finish = (blob: Blob | null) => {
                    if (timer !== null) clearTimeout(timer);
                    pendingSnapshots.delete(request);
                    resolve(blob);
                };

                timer = setTimeout(() => finish(null), SNAPSHOT_REPLY_TIMEOUT_MS);
                pendingSnapshots.set(request, finish);
                worker.postMessage({ type: "snapshot", id, request, maxWidth });
            });
        },

        stop() {
            worker.postMessage({ type: "stop", id });
            worker.removeEventListener("message", onMessage);
            generator.stop();

            for (const finish of [...pendingSnapshots.values()]) finish(null);
        }
    };
}
