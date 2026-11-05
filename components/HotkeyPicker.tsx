/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";

import { applyGlobalHotkey, pauseGlobalHotkey } from "../controller";
import { captureCombo, suspendLocalHotkey } from "../hotkey";
import { T } from "../i18n";
import { DEFAULT_HOTKEY, settings } from "../settings";
import { Hint } from "./Hint";
import { KeyboardIcon } from "./icons";
import { Keys } from "./Keys";
import { interceptKeys } from "./Overlay";

export function HotkeyPicker() {
    const { hotkey } = settings.use(["hotkey"]);
    const current = hotkey || DEFAULT_HOTKEY;

    const [listening, setListening] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const button = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!listening) return;

        let done = false;

        const finish = (combo: string | null) => {
            if (done) return;
            done = true;

            setListening(false);
            setProblem(null);

            if (combo && combo !== current) settings.store.hotkey = combo;
            else void applyGlobalHotkey(false);
        };

        suspendLocalHotkey(true);
        void pauseGlobalHotkey();

        interceptKeys(event => {
            if (event.repeat) return;

            if (event.key === "Escape") {
                finish(null);
                return;
            }

            const captured = captureCombo(event);

            if (captured.kind === "combo") finish(captured.combo);
            else if (captured.kind === "needsModifier") setProblem(T.hotkeyNeedsModifier);
            else if (captured.kind === "unsupported") setProblem(T.hotkeyUnsupported);
        });

        const onPointerDown = (event: PointerEvent) => {
            if (!button.current?.contains(event.target as Node)) finish(null);
        };
        const onBlur = () => finish(null);

        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("blur", onBlur);

        return () => {
            interceptKeys(null);
            suspendLocalHotkey(false);
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("blur", onBlur);

            if (!done) {
                done = true;
                void applyGlobalHotkey(false);
            }
        };
    }, [listening]);

    return (
        <Hint text={listening ? null : T.hotkeyChange}>
            {hint => (
                <button
                    ref={button}
                    className={"vc-ir-hotkey" + (listening ? " vc-ir-hotkey-listening" : "") + (problem ? " vc-ir-hotkey-problem" : "")}
                    aria-label={T.hotkeyChange}
                    aria-pressed={listening}
                    onClick={() => setListening(value => !value)}
                    {...hint}
                >
                    <KeyboardIcon size={16} />
                    {listening
                        ? <span className="vc-ir-hotkey-prompt" aria-live="polite">{problem ?? T.hotkeyListening}</span>
                        : <Keys hotkey={current} />}
                </button>
            )}
        </Hint>
    );
}
