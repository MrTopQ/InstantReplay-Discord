/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Hotkey {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
}

export function parseHotkey(raw: string | undefined): Hotkey | null {
    const parts = (raw ?? "").split("+").map(part => part.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return null;

    const hotkey: Hotkey = { key: "", ctrl: false, shift: false, alt: false, meta: false };

    for (const part of parts) {
        if (part === "ctrl" || part === "control") hotkey.ctrl = true;
        else if (part === "shift") hotkey.shift = true;
        else if (part === "alt" || part === "option") hotkey.alt = true;
        else if (part === "meta" || part === "cmd" || part === "win") hotkey.meta = true;
        else hotkey.key = part;
    }

    return hotkey.key ? hotkey : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element?.tagName) return false;

    const tag = element.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || element.isContentEditable === true;
}

export function matches(event: KeyboardEvent, hotkey: Hotkey): boolean {
    if (event.ctrlKey !== hotkey.ctrl) return false;
    if (event.shiftKey !== hotkey.shift) return false;
    if (event.altKey !== hotkey.alt) return false;
    if (event.metaKey !== hotkey.meta) return false;

    const key = event.key?.toLowerCase() ?? "";
    const code = event.code?.toLowerCase() ?? "";

    return key === hotkey.key
        || code === hotkey.key
        || code === `key${hotkey.key}`
        || code === `digit${hotkey.key}`
        || code === `numpad${hotkey.key}`;
}

export type ComboCapture =
    | { kind: "combo"; combo: string; }
    | { kind: "waiting"; }
    | { kind: "needsModifier"; }
    | { kind: "unsupported"; };

interface PressedKeys {
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

const MODIFIER_CODES = new Set([
    "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight"
]);

const NAMED_KEYS = new Set(["Space", "Insert", "Delete", "Home", "End", "PageUp", "PageDown"]);

function keyName(code: string): string | null {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;

    return NAMED_KEYS.has(code) ? code : null;
}

export function captureCombo(pressed: PressedKeys): ComboCapture {
    if (MODIFIER_CODES.has(pressed.code)) return { kind: "waiting" };

    const key = keyName(pressed.code);
    if (!key) return { kind: "unsupported" };

    const isFunctionKey = /^F\d{1,2}$/.test(key);
    if (!isFunctionKey && !pressed.ctrlKey && !pressed.altKey && !pressed.metaKey) return { kind: "needsModifier" };

    const parts = [
        pressed.ctrlKey && "Ctrl",
        pressed.altKey && "Alt",
        pressed.shiftKey && "Shift",
        pressed.metaKey && "Win",
        key
    ].filter(Boolean);

    return { kind: "combo", combo: parts.join("+") };
}

let handler: ((event: KeyboardEvent) => void) | null = null;
let suspended = false;

export function suspendLocalHotkey(value: boolean): void {
    suspended = value;
}

export function registerHotkey(getRaw: () => string, action: () => void): void {
    unregisterHotkey();

    handler = (event: KeyboardEvent) => {
        if (event.repeat || suspended) return;

        const hotkey = parseHotkey(getRaw());
        if (!hotkey) return;

        const hasModifier = hotkey.ctrl || hotkey.shift || hotkey.alt || hotkey.meta;
        if (!hasModifier && isTypingTarget(event.target)) return;
        if (!matches(event, hotkey)) return;

        event.preventDefault();
        event.stopPropagation();
        action();
    };

    window.addEventListener("keydown", handler, { capture: true });
}

export function unregisterHotkey(): void {
    if (!handler) return;

    window.removeEventListener("keydown", handler, { capture: true });
    handler = null;
}
