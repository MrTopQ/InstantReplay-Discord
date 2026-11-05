/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const BOX_HEADER_BYTES = 16;

export interface ChunkShape {
    types: string[];
    fragmentOffset: number | null;
    fragmentEnd: number | null;
    danglingMoof: number | null;
    complete: boolean;
}

export async function describeChunk(chunk: Blob): Promise<ChunkShape> {
    const types: string[] = [];
    let fragmentOffset: number | null = null;
    let fragmentEnd: number | null = null;
    let danglingMoof: number | null = null;
    let offset = 0;

    while (offset + 8 <= chunk.size) {
        const header = new DataView(await chunk.slice(offset, offset + BOX_HEADER_BYTES).arrayBuffer());
        if (header.byteLength < 8) break;

        let size = header.getUint32(0);
        let headerSize = 8;

        if (size === 1) {
            if (header.byteLength < BOX_HEADER_BYTES) break;
            size = Number(header.getBigUint64(8));
            headerSize = BOX_HEADER_BYTES;
        }
        if (size === 0) size = chunk.size - offset;
        if (size < headerSize) break;

        const type = String.fromCharCode(
            header.getUint8(4), header.getUint8(5), header.getUint8(6), header.getUint8(7)
        );

        types.push(type);
        if (type === "moof") {
            if (fragmentOffset === null) fragmentOffset = offset;
            danglingMoof = offset;
        }

        offset += size;

        if (type === "mdat") {
            fragmentEnd = offset;
            danglingMoof = null;
        }

        if (offset > chunk.size) return { types, fragmentOffset, fragmentEnd, danglingMoof, complete: false };
    }

    return { types, fragmentOffset, fragmentEnd, danglingMoof, complete: offset === chunk.size };
}
