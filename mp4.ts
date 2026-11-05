/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Box {
    contentStart: number;
    end: number;
}

export interface DurationField {
    offset: number;
    bytes: 4 | 8;
}

export interface TrackInfo {
    timescale: number;
    isVideo: boolean;
    defaultSampleDuration: number;
    tkhdDuration: DurationField | null;
    mdhdDuration: DurationField | null;
}

export interface MovieInfo {
    movieTimescale: number;
    mvhdDuration: DurationField;
    tracks: Map<number, TrackInfo>;
}

export interface DurationWrite {
    offset: number;
    bytes: Buffer;
}

export interface DurationPatch {
    writes: DurationWrite[];
    timescale: number;
    duration: number;
}

export function findBox(buffer: Buffer, start: number, end: number, type: string): Box | null {
    let offset = start;

    while (offset + 8 <= end) {
        let size = buffer.readUInt32BE(offset);
        let headerSize = 8;

        if (size === 1) {
            if (offset + 16 > end) return null;
            size = Number(buffer.readBigUInt64BE(offset + 8));
            headerSize = 16;
        }
        if (size === 0) size = end - offset;
        if (size < headerSize || offset + size > end) return null;

        if (buffer.toString("latin1", offset + 4, offset + 8) === type) {
            return { contentStart: offset + headerSize, end: offset + size };
        }
        offset += size;
    }

    return null;
}

function eachBox(buffer: Buffer, start: number, end: number, type: string): Box[] {
    const found: Box[] = [];
    let offset = start;

    while (offset + 8 <= end) {
        let size = buffer.readUInt32BE(offset);
        let headerSize = 8;

        if (size === 1) {
            if (offset + 16 > end) break;
            size = Number(buffer.readBigUInt64BE(offset + 8));
            headerSize = 16;
        }
        if (size === 0) size = end - offset;
        if (size < headerSize || offset + size > end) break;

        if (buffer.toString("latin1", offset + 4, offset + 8) === type) {
            found.push({ contentStart: offset + headerSize, end: offset + size });
        }
        offset += size;
    }

    return found;
}

function trackIdOf(buffer: Buffer, tkhd: Box): number | null {
    const version = buffer[tkhd.contentStart];
    const offset = tkhd.contentStart + (version === 1 ? 20 : 12);

    return offset + 4 <= tkhd.end ? buffer.readUInt32BE(offset) : null;
}

function durationFieldOf(buffer: Buffer, box: Box, offsets: { v0: number; v1: number; }): DurationField | null {
    const version = buffer[box.contentStart];
    if (version !== 0 && version !== 1) return null;

    const bytes = version === 1 ? 8 : 4;
    const offset = box.contentStart + (version === 1 ? offsets.v1 : offsets.v0);

    return offset + bytes <= box.end ? { offset, bytes } : null;
}

const TKHD_DURATION = { v0: 20, v1: 28 };
const MDHD_DURATION = { v0: 16, v1: 24 };
const MVHD_DURATION = { v0: 16, v1: 24 };

export function parseMovie(head: Buffer): MovieInfo | null {
    const moov = findBox(head, 0, head.length, "moov");
    if (!moov) return null;

    const mvhd = findBox(head, moov.contentStart, moov.end, "mvhd");
    if (!mvhd) return null;

    const version = head[mvhd.contentStart];
    if (version !== 0 && version !== 1) return null;

    const mvhdDuration = durationFieldOf(head, mvhd, MVHD_DURATION);
    if (!mvhdDuration) return null;

    const movieTimescale = head.readUInt32BE(mvhd.contentStart + (version === 1 ? 20 : 12));
    if (!movieTimescale) return null;

    const defaults = new Map<number, number>();
    const mvex = findBox(head, moov.contentStart, moov.end, "mvex");
    if (mvex) {
        for (const trex of eachBox(head, mvex.contentStart, mvex.end, "trex")) {
            if (trex.contentStart + 16 > trex.end) continue;
            defaults.set(head.readUInt32BE(trex.contentStart + 4), head.readUInt32BE(trex.contentStart + 12));
        }
    }

    const tracks = new Map<number, TrackInfo>();
    for (const trak of eachBox(head, moov.contentStart, moov.end, "trak")) {
        const tkhd = findBox(head, trak.contentStart, trak.end, "tkhd");
        const mdia = findBox(head, trak.contentStart, trak.end, "mdia");
        if (!tkhd || !mdia) continue;

        const trackId = trackIdOf(head, tkhd);
        const mdhd = findBox(head, mdia.contentStart, mdia.end, "mdhd");
        if (trackId === null || !mdhd) continue;

        const mdhdVersion = head[mdhd.contentStart];
        const timescaleOffset = mdhd.contentStart + (mdhdVersion === 1 ? 20 : 12);
        if (timescaleOffset + 4 > mdhd.end) continue;

        const hdlr = findBox(head, mdia.contentStart, mdia.end, "hdlr");
        const handler = hdlr && hdlr.contentStart + 12 <= hdlr.end
            ? head.toString("latin1", hdlr.contentStart + 8, hdlr.contentStart + 12)
            : "";

        tracks.set(trackId, {
            timescale: head.readUInt32BE(timescaleOffset),
            isVideo: handler === "vide",
            defaultSampleDuration: defaults.get(trackId) ?? 0,
            tkhdDuration: durationFieldOf(head, tkhd, TKHD_DURATION),
            mdhdDuration: durationFieldOf(head, mdhd, MDHD_DURATION)
        });
    }

    return { movieTimescale, mvhdDuration, tracks };
}

export function initSegmentLength(head: Buffer): number | null {
    let offset = 0;

    while (offset + 8 <= head.length) {
        let size = head.readUInt32BE(offset);
        let headerSize = 8;

        if (size === 1) {
            if (offset + 16 > head.length) return null;
            size = Number(head.readBigUInt64BE(offset + 8));
            headerSize = 16;
        }
        if (size < headerSize) return null;

        if (head.toString("latin1", offset + 4, offset + 8) === "moof") return offset;

        offset += size;
    }

    return null;
}

export function fragmentStarts(moof: Buffer): Map<number, number> {
    const starts = new Map<number, number>();

    const outer = findBox(moof, 0, moof.length, "moof");
    const from = outer?.contentStart ?? 0;
    const to = outer?.end ?? moof.length;

    for (const traf of eachBox(moof, from, to, "traf")) {
        const tfhd = findBox(moof, traf.contentStart, traf.end, "tfhd");
        const tfdt = findBox(moof, traf.contentStart, traf.end, "tfdt");
        if (!tfhd || !tfdt || tfhd.contentStart + 8 > tfhd.end) continue;

        const trackId = moof.readUInt32BE(tfhd.contentStart + 4);
        const version = moof[tfdt.contentStart];
        if (tfdt.contentStart + (version === 1 ? 12 : 8) > tfdt.end) continue;

        starts.set(trackId, version === 1
            ? Number(moof.readBigUInt64BE(tfdt.contentStart + 4))
            : moof.readUInt32BE(tfdt.contentStart + 4));
    }

    return starts;
}

export function shiftFragmentStarts(moof: Buffer, deltas: Map<number, number>): void {
    const outer = findBox(moof, 0, moof.length, "moof");
    const from = outer?.contentStart ?? 0;
    const to = outer?.end ?? moof.length;

    for (const traf of eachBox(moof, from, to, "traf")) {
        const tfhd = findBox(moof, traf.contentStart, traf.end, "tfhd");
        const tfdt = findBox(moof, traf.contentStart, traf.end, "tfdt");
        if (!tfhd || !tfdt || tfhd.contentStart + 8 > tfhd.end) continue;

        const delta = deltas.get(moof.readUInt32BE(tfhd.contentStart + 4));
        if (!delta) continue;

        const version = moof[tfdt.contentStart];
        if (tfdt.contentStart + (version === 1 ? 12 : 8) > tfdt.end) continue;

        if (version === 1) {
            const shifted = moof.readBigUInt64BE(tfdt.contentStart + 4) - BigInt(delta);
            moof.writeBigUInt64BE(shifted > 0n ? shifted : 0n, tfdt.contentStart + 4);
        } else {
            const shifted = moof.readUInt32BE(tfdt.contentStart + 4) - delta;
            moof.writeUInt32BE(shifted > 0 ? shifted : 0, tfdt.contentStart + 4);
        }
    }
}

export function fragmentShiftDeltas(movie: MovieInfo, firstMoof: Buffer): Map<number, number> {
    const starts = fragmentStarts(firstMoof);
    const deltas = new Map<number, number>();

    let base = Infinity;
    for (const [trackId, start] of starts) {
        const timescale = movie.tracks.get(trackId)?.timescale;
        if (timescale) base = Math.min(base, start / timescale);
    }

    if (!Number.isFinite(base) || base <= 0) return deltas;

    for (const [trackId, track] of movie.tracks) {
        if (track.timescale) deltas.set(trackId, Math.round(base * track.timescale));
    }

    return deltas;
}

export function usesAbsoluteOffsets(moof: Buffer): boolean {
    const outer = findBox(moof, 0, moof.length, "moof");
    const from = outer?.contentStart ?? 0;
    const to = outer?.end ?? moof.length;

    for (const traf of eachBox(moof, from, to, "traf")) {
        const tfhd = findBox(moof, traf.contentStart, traf.end, "tfhd");
        if (!tfhd || tfhd.contentStart + 4 > tfhd.end) continue;

        if (moof.readUInt32BE(tfhd.contentStart) & 0x000001) return true;
    }

    return false;
}

export function fragmentEndTime(moof: Buffer, tracks: Map<number, TrackInfo>): { trackId: number; endTime: number; } | null {
    let best: { trackId: number; endTime: number; } | null = null;

    const outer = findBox(moof, 0, moof.length, "moof");
    const from = outer?.contentStart ?? 0;
    const to = outer?.end ?? moof.length;

    for (const traf of eachBox(moof, from, to, "traf")) {
        const tfhd = findBox(moof, traf.contentStart, traf.end, "tfhd");
        const tfdt = findBox(moof, traf.contentStart, traf.end, "tfdt");
        if (!tfhd || !tfdt || tfhd.contentStart + 8 > tfhd.end) continue;

        const trackId = moof.readUInt32BE(tfhd.contentStart + 4);
        const track = tracks.get(trackId);
        if (!track) continue;

        const tfhdFlags = moof.readUInt32BE(tfhd.contentStart) & 0xffffff;
        let cursor = tfhd.contentStart + 8;
        if (tfhdFlags & 0x000001) cursor += 8;
        if (tfhdFlags & 0x000002) cursor += 4;

        let sampleDuration = track.defaultSampleDuration;
        if (tfhdFlags & 0x000008) {
            if (cursor + 4 > tfhd.end) continue;
            sampleDuration = moof.readUInt32BE(cursor);
        }

        const tfdtVersion = moof[tfdt.contentStart];
        if (tfdt.contentStart + (tfdtVersion === 1 ? 12 : 8) > tfdt.end) continue;
        const startTime = tfdtVersion === 1
            ? Number(moof.readBigUInt64BE(tfdt.contentStart + 4))
            : moof.readUInt32BE(tfdt.contentStart + 4);

        let span = 0;
        for (const trun of eachBox(moof, traf.contentStart, traf.end, "trun")) {
            if (trun.contentStart + 8 > trun.end) continue;

            const flags = moof.readUInt32BE(trun.contentStart) & 0xffffff;
            const sampleCount = moof.readUInt32BE(trun.contentStart + 4);

            if (!(flags & 0x000100)) {
                span += sampleCount * sampleDuration;
                continue;
            }

            let entry = trun.contentStart + 8;
            if (flags & 0x000001) entry += 4;
            if (flags & 0x000004) entry += 4;

            const stride = 4
                + (flags & 0x000200 ? 4 : 0)
                + (flags & 0x000400 ? 4 : 0)
                + (flags & 0x000800 ? 4 : 0);

            for (let i = 0; i < sampleCount && entry + stride <= trun.end; i++, entry += stride) {
                span += moof.readUInt32BE(entry);
            }
        }

        const endTime = startTime + span;
        if (!best || (track.isVideo && endTime > 0)) best = { trackId, endTime };
        if (track.isVideo) break;
    }

    return best;
}

export function planDurationPatch(head: Buffer, durationMs: number): DurationPatch | null {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

    const movie = parseMovie(head);
    if (!movie) return null;

    return buildPatch(movie, Math.round((durationMs / 1000) * movie.movieTimescale));
}

export function planExactDurationPatch(head: Buffer, lastMoof: Buffer): DurationPatch | null {
    const movie = parseMovie(head);
    if (!movie) return null;

    const fragment = fragmentEndTime(lastMoof, movie.tracks);
    if (!fragment || fragment.endTime <= 0) return null;

    const track = movie.tracks.get(fragment.trackId);
    if (!track?.timescale) return null;

    const duration = Math.round((fragment.endTime / track.timescale) * movie.movieTimescale);

    return buildPatch(movie, duration);
}

function encode(field: DurationField, value: number): DurationWrite | null {
    const bytes = Buffer.alloc(field.bytes);

    if (field.bytes === 8) bytes.writeBigUInt64BE(BigInt(value));
    else {
        if (value > 0xffffffff) return null;
        bytes.writeUInt32BE(value);
    }

    return { offset: field.offset, bytes };
}

function buildPatch(movie: MovieInfo, duration: number): DurationPatch | null {
    if (!Number.isSafeInteger(duration) || duration <= 0) return null;

    const movieWrite = encode(movie.mvhdDuration, duration);
    if (!movieWrite) return null;

    const writes = [movieWrite];

    for (const track of movie.tracks.values()) {
        if (track.tkhdDuration) {
            const write = encode(track.tkhdDuration, duration);
            if (write) writes.push(write);
        }
        if (track.mdhdDuration && track.timescale) {
            const own = Math.round((duration / movie.movieTimescale) * track.timescale);
            const write = encode(track.mdhdDuration, own);
            if (write) writes.push(write);
        }
    }

    return { writes, timescale: movie.movieTimescale, duration };
}
