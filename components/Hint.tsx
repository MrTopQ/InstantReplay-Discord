/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ReactDOM, useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";
import type { ReactNode, SyntheticEvent } from "react";

const SHOW_DELAY_MS = 120;
const WARM_WINDOW_MS = 400;
const GAP_PX = 8;
const EDGE_PX = 8;
const TITLE_BAR_PX = 40;
const ARROW_INSET_PX = 12;

let lastHiddenAt = 0;

interface Placement {
    left: number;
    top: number;
    below: boolean;
    arrow: number;
}

function place(anchor: DOMRect, width: number, height: number): Placement {
    const below = anchor.top - GAP_PX - height < TITLE_BAR_PX;
    const centre = anchor.left + anchor.width / 2;
    const left = Math.max(EDGE_PX, Math.min(centre - width / 2, window.innerWidth - width - EDGE_PX));
    const arrow = Math.min(Math.max(centre - left, ARROW_INSET_PX), Math.max(ARROW_INSET_PX, width - ARROW_INSET_PX));

    return { left, top: below ? anchor.bottom + GAP_PX : anchor.top - GAP_PX - height, below, arrow };
}

function Bubble({ anchor, text }: { anchor: DOMRect; text: ReactNode; }) {
    const ref = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState<Placement | null>(null);

    useLayoutEffect(() => {
        const bubble = ref.current;
        if (!bubble) return;

        const { width, height } = bubble.getBoundingClientRect();
        setAt(place(anchor, width, height));
    }, [anchor]);

    return (
        <div
            ref={ref}
            className={"vc-ir-scope vc-ir-hint" + (at?.below ? " vc-ir-hint-below" : "")}
            role="tooltip"
            style={at
                ? { left: at.left, top: at.top, ["--ir-hint-arrow" as string]: `${at.arrow}px` }
                : { left: 0, top: 0, visibility: "hidden" }}
        >
            {text}
        </div>
    );
}

export interface HintTargetProps {
    onMouseEnter(event: SyntheticEvent<HTMLElement>): void;
    onMouseLeave(): void;
    onFocus(event: SyntheticEvent<HTMLElement>): void;
    onBlur(): void;
}

export function Hint({ text, children }: { text: ReactNode; children: (props: HintTargetProps) => ReactNode; }) {
    const [anchor, setAnchor] = useState<DOMRect | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const shown = useRef(false);

    const hide = () => {
        clearTimeout(timer.current);
        if (shown.current) lastHiddenAt = Date.now();
        shown.current = false;
        setAnchor(null);
    };

    const show = (event: SyntheticEvent<HTMLElement>) => {
        if (!text) return;

        const target = event.currentTarget;
        const reveal = () => {
            if (!target.isConnected) return;
            shown.current = true;
            setAnchor(target.getBoundingClientRect());
        };

        clearTimeout(timer.current);
        if (Date.now() - lastHiddenAt < WARM_WINDOW_MS) reveal();
        else timer.current = setTimeout(reveal, SHOW_DELAY_MS);
    };

    useEffect(() => {
        if (!anchor) return;

        window.addEventListener("scroll", hide, true);
        window.addEventListener("resize", hide);
        window.addEventListener("blur", hide);
        return () => {
            window.removeEventListener("scroll", hide, true);
            window.removeEventListener("resize", hide);
            window.removeEventListener("blur", hide);
        };
    }, [anchor]);

    useEffect(() => () => clearTimeout(timer.current), []);

    const target = children({ onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide });
    if (!anchor || !text) return <>{target}</>;

    let bubble: ReactNode = null;
    try {
        bubble = ReactDOM.createPortal(<Bubble anchor={anchor} text={text} />, document.body);
    } catch (error) {
        console.warn("[InstantReplay] could not draw a hint", error);
    }

    return <>{target}{bubble}</>;
}
