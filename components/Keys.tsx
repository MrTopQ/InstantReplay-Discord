/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function Keys({ hotkey }: { hotkey: string; }) {
    const parts = hotkey.split("+").map(part => part.trim()).filter(Boolean);

    return (
        <span className="vc-ir-keys">
            {parts.map(part => <kbd key={part} className="vc-ir-key">{part}</kbd>)}
        </span>
    );
}
