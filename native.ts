/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { app, BrowserWindow, desktopCapturer, globalShortcut, type IpcMainInvokeEvent, shell } from "electron";
import { createWriteStream, existsSync, WriteStream } from "fs";
import { type FileHandle, mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from "fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";

import {
    fragmentShiftDeltas,
    type MovieInfo,
    parseMovie,
    planDurationPatch,
    planExactDurationPatch,
    shiftFragmentStarts,
    usesAbsoluteOffsets
} from "./mp4";

const OUTPUT_DIR_NAME = "Discord Replay";
const ALLOWED_EXTENSIONS = ["mp4", "mkv", "webm"];

const MOOV_SEARCH_BYTES = 1024 * 1024;

export interface CaptureSource {
    id: string;
    name: string;
}

export interface OpenFile {
    handle: number;
    path: string;
}

export interface SavedFile {
    path: string;
    seekable: boolean;
}

const MAX_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_PATH_LENGTH = 1024;
const MAX_SESSION_LENGTH = 128;
const MAX_HOTKEY_LENGTH = 64;
const MAX_LISTED_CLIPS = 100;
const MAX_CLIP_MS = 24 * 60 * 60 * 1000;

function isHandle(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isShortText(value: unknown, maxLength: number): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function ignoreBrokenConsole(): void {
    for (const stream of [process.stdout, process.stderr]) {
        try {
            stream?.on?.("error", () => void 0);
        } catch { }
    }
}

ignoreBrokenConsole();

function outputDir(): string {
    return join(app.getPath("videos"), OUTPUT_DIR_NAME);
}

async function ensureOutputDir(): Promise<string> {
    const dir = outputDir();
    await mkdir(dir, { recursive: true });
    return dir;
}

export async function getScreenSources(_: unknown): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }
    });

    return sources.map(source => ({ id: source.id, name: source.name }));
}

export async function getWindowSourceId(event: IpcMainInvokeEvent): Promise<string | null> {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window?.getMediaSourceId() ?? null;
}

interface Fragment {
    offset: number;
    size: number;
}

async function findFragments(file: FileHandle, size: number): Promise<Fragment[]> {
    const header = Buffer.alloc(16);
    const found: Fragment[] = [];
    let offset = 0;
    let lastWasMoof = false;

    while (offset + 8 <= size) {
        await file.read(header, 0, 16, offset);

        let boxSize = header.readUInt32BE(0);
        let headerSize = 8;
        if (boxSize === 1) {
            boxSize = Number(header.readBigUInt64BE(8));
            headerSize = 16;
        }

        if (boxSize < headerSize || offset + boxSize > size) {
            if (lastWasMoof) found.pop();
            break;
        }

        lastWasMoof = header.toString("latin1", 4, 8) === "moof";

        if (lastWasMoof) {
            if (boxSize > MAX_FRAGMENT_BYTES) {
                console.error(`[InstantReplay] a fragment claims ${boxSize} bytes, leaving the file alone`);
                return [];
            }

            found.push({ offset, size: boxSize });
        }

        offset += boxSize;
    }

    return found;
}

async function readFragment(file: FileHandle, fragment: Fragment): Promise<Buffer> {
    const moof = Buffer.alloc(fragment.size);
    await file.read(moof, 0, fragment.size, fragment.offset);

    return moof;
}

async function normalizeFragmentTimes(file: FileHandle, fragments: Fragment[], movie: MovieInfo): Promise<number> {
    if (!fragments.length) return 0;

    const first = await readFragment(file, fragments[0]);

    if (usesAbsoluteOffsets(first)) {
        console.warn("[InstantReplay] fragments point at absolute file offsets, the clip may be unplayable");
    }

    const deltas = fragmentShiftDeltas(movie, first);
    if (!deltas.size) return 0;

    for (const fragment of fragments) {
        const moof = await readFragment(file, fragment);

        shiftFragmentStarts(moof, deltas);
        await file.write(moof, 0, moof.length, fragment.offset);
    }

    const [trackId, delta] = [...deltas.entries()][0];
    return delta / (movie.tracks.get(trackId)?.timescale || 1);
}

async function patchMp4Duration(path: string, finalName: string, durationMs: number): Promise<boolean> {
    if (!finalName.endsWith(".mp4")) return false;

    const file = await open(path, "r+");
    try {
        const { size } = await file.stat();
        const head = Buffer.alloc(Math.min(MOOV_SEARCH_BYTES, size));
        await file.read(head, 0, head.length, 0);

        const movie = parseMovie(head);
        const fragments = movie ? await findFragments(file, size) : [];

        if (movie && fragments.length) await normalizeFragmentTimes(file, fragments, movie);

        const moof = fragments.length ? await readFragment(file, fragments[fragments.length - 1]) : null;
        const patch = (moof && planExactDurationPatch(head, moof)) || planDurationPatch(head, durationMs);

        if (!patch) {
            console.error("[InstantReplay] no duration could be worked out, the clip will show 0:00");
            return false;
        }

        for (const write of patch.writes) {
            await file.write(write.bytes, 0, write.bytes.length, write.offset);
        }

        return true;
    } finally {
        await file.close();
    }
}

interface OpenWrite {
    stream: WriteStream;
    partial: string;
    final: string;
    failure: Error | null;
    session: string;
    owner: number;
    finalizing: boolean;
    detachWindowListener: () => void;
}

const PARTIAL_SUFFIX = ".part";

const openFiles = new Map<number, OpenWrite>();
let nextHandle = 1;

const MAX_OPEN_PER_WINDOW = 4;

const MAX_FRAGMENT_BYTES = 8 * 1024 * 1024;

const STRAY_IDLE_MS = 60_000;

const RENAME_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000, 3000];

const PROCESS_STARTED_AT = Date.now() - process.uptime() * 1000;

interface NameClaim {
    self?: OpenWrite;
    renaming?: string;
}

function timestamp(): string {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, "0");

    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
        + ` ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function closeStream(stream: WriteStream): Promise<void> {
    return new Promise(resolve => {
        if (stream.closed) {
            resolve();
            return;
        }

        stream.once("close", resolve);
        stream.end();
    });
}

function isNameTaken(candidate: string, claim?: NameClaim): boolean {
    for (const file of openFiles.values()) {
        if (file === claim?.self) continue;
        if (file.partial === candidate + PARTIAL_SUFFIX || file.final === candidate) return true;
    }

    if (existsSync(candidate)) return true;

    const partial = candidate + PARTIAL_SUFFIX;
    return partial !== claim?.renaming && existsSync(partial);
}

function freePath(base: string, extension: string, claim?: NameClaim): string {
    let candidate = `${base}.${extension}`;

    for (let counter = 2; isNameTaken(candidate, claim); counter++) {
        candidate = `${base} (${counter}).${extension}`;
    }

    return candidate;
}

export async function beginFile(event: IpcMainInvokeEvent, extension: string, session: string): Promise<OpenFile> {
    if (!isShortText(session, MAX_SESSION_LENGTH)) throw new Error("Invalid session");

    const owner = event.sender.id;

    const mine = [...openFiles.values()].filter(file => file.owner === owner).length;
    if (mine >= MAX_OPEN_PER_WINDOW) throw new Error("Too many clips are already being written");

    const safeExtension = typeof extension === "string" && ALLOWED_EXTENSIONS.includes(extension) ? extension : "webm";
    const final = freePath(join(await ensureOutputDir(), `Replay ${timestamp()}`), safeExtension);

    const partial = final + PARTIAL_SUFFIX;

    const handle = nextHandle++;
    const entry: OpenWrite = {
        stream: createWriteStream(partial, { flags: "wx" }),
        partial,
        final,
        failure: null,
        session,
        owner,
        finalizing: false,
        detachWindowListener: () => void 0
    };

    entry.stream.on("error", error => {
        entry.failure = error as Error;
        console.error("[InstantReplay] write stream failed", error);
    });

    const windowGone = () => {
        if (openFiles.get(handle) !== entry || entry.finalizing) return;

        console.error("[InstantReplay] the window writing a clip is gone, closing its file");
        openFiles.delete(handle);

        void closeStream(entry.stream).then(() => rm(entry.partial, { force: true })).catch(() => void 0);
    };

    event.sender.once("destroyed", windowGone);
    entry.detachWindowListener = () => event.sender.removeListener("destroyed", windowGone);

    openFiles.set(handle, entry);

    try {
        await new Promise<void>((resolve, reject) => {
            entry.stream.once("open", () => resolve());
            entry.stream.once("error", reject);
        });
    } catch (error) {
        entry.detachWindowListener();
        openFiles.delete(handle);
        throw error;
    }

    return { handle, path: final };
}

function ownedFile(event: IpcMainInvokeEvent, handle: unknown): OpenWrite | undefined {
    if (!isHandle(handle)) return undefined;

    const file = openFiles.get(handle);
    return file?.owner === event.sender.id ? file : undefined;
}

export async function writeChunk(event: IpcMainInvokeEvent, handle: number, chunk: Uint8Array): Promise<void> {
    const file = ownedFile(event, handle);
    if (!file) throw new Error(`Unknown file handle ${handle}`);
    if (file.failure) throw file.failure;

    if (file.finalizing) throw new Error(`Clip ${handle} is already being finished`);

    const data = asBytes(chunk);
    if (!data || data.byteLength === 0 || data.byteLength > MAX_CHUNK_BYTES) throw new Error("Invalid chunk");

    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);

    await new Promise<void>((resolve, reject) => {
        file.stream.write(bytes, error => error ? reject(error) : resolve());
    });
}

const RENAME_BUSY_CODES = ["EBUSY", "EPERM", "EACCES"];

async function renameWhenFree(from: string, to: string): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(from, to);
            return true;
        } catch (error) {
            const busy = RENAME_BUSY_CODES.includes((error as NodeJS.ErrnoException)?.code ?? "");
            if (!busy || attempt >= RENAME_RETRY_DELAYS_MS.length) {
                console.error("[InstantReplay] the file would not take its name", error);
                return false;
            }

            await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]));
        }
    }
}

async function claimName(file: OpenWrite): Promise<string> {
    if (await renameWhenFree(file.partial, file.final)) return file.final;

    const extension = extname(file.final).slice(1);
    const fallbackPath = freePath(file.final.slice(0, -(extension.length + 1)), extension, {
        self: file,
        renaming: file.partial
    });

    await rename(file.partial, fallbackPath);
    return fallbackPath;
}

export async function finishFile(event: IpcMainInvokeEvent, handle: number, durationMs: number): Promise<SavedFile> {
    const file = ownedFile(event, handle);
    if (!file) throw new Error(`Unknown file handle ${handle}`);
    if (file.finalizing) throw new Error(`Clip ${handle} is already being finished`);

    file.finalizing = true;
    const fallbackMs = clampNumber(durationMs, 0, MAX_CLIP_MS, 0);

    try {
        await closeStream(file.stream);

        if (file.failure) {
            await rm(file.partial, { force: true }).catch(() => void 0);
            throw file.failure;
        }

        let seekable = false;
        try {
            seekable = await patchMp4Duration(file.partial, file.final, fallbackMs);
        } catch (error) {
            console.error("[InstantReplay] failed to patch duration", error);
        }

        return { path: await claimName(file), seekable };
    } finally {
        file.detachWindowListener();
        openFiles.delete(handle);
    }
}

export async function abortFile(event: IpcMainInvokeEvent, handle: number): Promise<void> {
    const file = ownedFile(event, handle);

    if (!file || file.finalizing) return;

    file.finalizing = true;

    try {
        await closeStream(file.stream);
        await rm(file.partial, { force: true }).catch(() => void 0);
    } finally {
        file.detachWindowListener();
        openFiles.delete(handle);
    }
}

let recoveringStrays = false;

async function recoverStrayParts(): Promise<number> {
    if (recoveringStrays) return 0;
    recoveringStrays = true;

    try {
        const dir = outputDir();

        const held = new Set([...openFiles.values()].map(file => file.partial));

        let recovered = 0;
        for (const name of await readdir(dir).catch(() => [] as string[])) {
            if (!name.endsWith(PARTIAL_SUFFIX)) continue;

            const partial = join(dir, name);
            const final = partial.slice(0, -PARTIAL_SUFFIX.length);

            if (held.has(partial)) continue;

            const extension = extname(final).slice(1).toLowerCase();
            if (!ALLOWED_EXTENSIONS.includes(extension)) continue;

            const info = await stat(partial).catch(() => null);
            if (!info) continue;

            const stale = info.mtimeMs < PROCESS_STARTED_AT || Date.now() - info.mtimeMs >= STRAY_IDLE_MS;
            if (!stale) continue;

            try {
                await patchMp4Duration(partial, final, 0).catch(() => false);

                const base = final.slice(0, -(extension.length + 1));
                await rename(partial, freePath(base, extension, { renaming: partial }));
                recovered++;
            } catch (error) {
                console.error("[InstantReplay] could not recover a leftover file", error);
            }
        }

        return recovered;
    } finally {
        recoveringStrays = false;
    }
}

export async function releaseOpenFiles(event: IpcMainInvokeEvent, session: string): Promise<number> {
    const orphans = !isShortText(session, MAX_SESSION_LENGTH) ? [] : [...openFiles.entries()]
        .filter(([, file]) => file.owner === event.sender.id && file.session !== session && !file.finalizing)
        .map(([handle]) => handle);

    for (const handle of orphans) await abortFile(event, handle);

    const recovered = await recoverStrayParts();
    if (recovered) console.log(`[InstantReplay] gave ${recovered} leftover file(s) their name back`);

    return orphans.length;
}

function insideOutputDir(path: unknown): string | null {
    if (!isShortText(path, MAX_PATH_LENGTH)) return null;

    const target = resolve(path);
    const inside = relative(outputDir(), target);

    return !inside || inside.startsWith("..") || isAbsolute(inside) ? null : target;
}

function hasVideoExtension(path: string): boolean {
    return ALLOWED_EXTENSIONS.some(extension => path.toLowerCase().endsWith(`.${extension}`));
}

export async function revealFile(_: unknown, path: string): Promise<void> {
    const target = insideOutputDir(path);
    if (!target) return;

    shell.showItemInFolder(target);
}

export async function getOutputDir(_: unknown): Promise<string> {
    return outputDir();
}

export async function openOutputDir(_: unknown): Promise<void> {
    const failure = await shell.openPath(await ensureOutputDir());
    if (failure) console.error("[InstantReplay] could not open the clips folder", failure);
}

export interface ClipInfo {
    name: string;
    path: string;
    bytes: number;
    savedAt: number;
    durationMs: number;
    thumb: string | null;
}

const THUMB_DIR_NAME = ".thumbs";
const THUMB_EXTENSION = ".jpg";
const THUMB_MAX_BYTES = 2 * 1024 * 1024;

async function thumbDir(): Promise<string> {
    const dir = join(outputDir(), THUMB_DIR_NAME);
    const created = await mkdir(dir, { recursive: true });

    if (created && process.platform === "win32") execFile("attrib", ["+h", dir], { windowsHide: true }, () => void 0);

    return dir;
}

function asBytes(value: unknown): Uint8Array | null {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return null;
}

export async function saveThumb(_: unknown, clipPath: string, bytes: Uint8Array): Promise<void> {
    const target = insideOutputDir(clipPath);
    if (!target || !hasVideoExtension(target) || relative(outputDir(), dirname(target)) !== "") return;

    const clip = await stat(target).catch(() => null);
    if (!clip?.isFile()) return;

    const data = asBytes(bytes);
    if (!data || data.byteLength === 0 || data.byteLength > THUMB_MAX_BYTES) return;

    const dir = await thumbDir();
    await writeFile(join(dir, basename(target) + THUMB_EXTENSION), data);
}

async function readThumb(dir: string, clipName: string): Promise<string | null> {
    try {
        const path = join(dir, THUMB_DIR_NAME, clipName + THUMB_EXTENSION);
        const info = await stat(path);
        if (!info.isFile() || info.size > THUMB_MAX_BYTES) return null;

        return `data:image/jpeg;base64,${(await readFile(path)).toString("base64")}`;
    } catch {
        return null;
    }
}

async function pruneOrphanThumbs(dir: string, clipNames: Set<string>): Promise<void> {
    const thumbs = join(dir, THUMB_DIR_NAME);

    for (const name of await readdir(thumbs).catch(() => [] as string[])) {
        if (!name.endsWith(THUMB_EXTENSION)) continue;

        const clipName = name.slice(0, -THUMB_EXTENSION.length);
        if (clipNames.has(clipName) || existsSync(join(dir, clipName))) continue;

        await rm(join(thumbs, name), { force: true }).catch(() => void 0);
    }
}

async function clipDuration(path: string): Promise<number> {
    try {
        const file = await open(path, "r");

        try {
            const { size } = await file.stat();
            const head = Buffer.alloc(Math.min(MOOV_SEARCH_BYTES, size));
            await file.read(head, 0, head.length, 0);

            const movie = parseMovie(head);
            if (!movie?.movieTimescale) return 0;

            const { offset, bytes } = movie.mvhdDuration;
            const value = bytes === 8 ? Number(head.readBigUInt64BE(offset)) : head.readUInt32BE(offset);

            return Math.round((value / movie.movieTimescale) * 1000);
        } finally {
            await file.close();
        }
    } catch {
        return 0;
    }
}

export async function listClips(_: unknown, limit: number): Promise<ClipInfo[]> {
    const dir = await ensureOutputDir();

    const names = (await readdir(dir))
        .filter(name => ALLOWED_EXTENSIONS.some(extension => name.endsWith(`.${extension}`)));

    const found: ClipInfo[] = [];
    for (const name of names) {
        const path = join(dir, name);
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) continue;

        found.push({ name, path, bytes: info.size, savedAt: info.mtimeMs, durationMs: 0, thumb: null });
    }

    const newest = found.sort((a, b) => b.savedAt - a.savedAt).slice(0, Math.floor(clampNumber(limit, 0, MAX_LISTED_CLIPS, 0)));

    const listed: ClipInfo[] = [];
    for (const clip of newest) {
        listed.push({ ...clip, durationMs: await clipDuration(clip.path), thumb: await readThumb(dir, clip.name) });
    }

    void pruneOrphanThumbs(dir, new Set(names));

    return listed;
}

export async function openClip(_: unknown, path: string): Promise<void> {
    const target = insideOutputDir(path);
    if (!target || !hasVideoExtension(target)) return;

    const failure = await shell.openPath(target);
    if (failure) console.error("[InstantReplay] could not open the clip", failure);
}

const FILESYSTEM_HEADROOM = 1.1;

export async function hasRoomFor(_: unknown, bytes: number): Promise<boolean> {
    try {
        const { bavail, bsize } = await statfs(await ensureOutputDir());
        return bavail * bsize > clampNumber(bytes, 0, Number.MAX_SAFE_INTEGER, 0) * FILESYSTEM_HEADROOM;
    } catch {
        return true;
    }
}

const META_ALIASES = ["meta", "win", "windows", "super", "cmd", "command"];

function toAccelerator(hotkey: string): string {
    return hotkey
        .split("+")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => (META_ALIASES.includes(part.toLowerCase()) ? "Super" : part))
        .join("+");
}

let registered: string | null = null;
let hotkeyOwner: number | null = null;
let detachHotkeyOwnerListener: (() => void) | null = null;

function releaseHotkey(): void {
    detachHotkeyOwnerListener?.();
    detachHotkeyOwnerListener = null;

    if (!registered) return;

    try {
        globalShortcut.unregister(registered);
    } catch (error) {
        console.error("[InstantReplay] could not release the hotkey", error);
    }

    registered = null;
    hotkeyOwner = null;
}

export function registerGlobalHotkey(event: IpcMainInvokeEvent, hotkey: string): boolean {
    if (!isShortText(hotkey, MAX_HOTKEY_LENGTH)) return false;

    releaseHotkey();

    const accelerator = toAccelerator(hotkey);
    if (!accelerator) return false;

    const { sender } = event;

    try {
        const claimed = globalShortcut.register(accelerator, () => {
            if (sender.isDestroyed()) {
                releaseHotkey();
                return;
            }

            try {
                void sender.executeJavaScript("window.$InstantReplaySave?.()").catch(() => void 0);
            } catch (error) {
                console.error("[InstantReplay] could not reach the page on the hotkey", error);
            }
        });

        if (claimed) {
            registered = accelerator;
            const ownerId = sender.id;
            hotkeyOwner = ownerId;

            const ownerGone = () => {
                if (hotkeyOwner === ownerId) releaseHotkey();
            };

            sender.once("destroyed", ownerGone);
            detachHotkeyOwnerListener = () => sender.removeListener("destroyed", ownerGone);
        }

        return claimed;
    } catch (error) {
        console.error("[InstantReplay] could not claim the hotkey system wide", error);
        return false;
    }
}

export function unregisterGlobalHotkey(event: IpcMainInvokeEvent): void {
    if (hotkeyOwner !== null && hotkeyOwner !== event.sender.id) return;

    releaseHotkey();
}
