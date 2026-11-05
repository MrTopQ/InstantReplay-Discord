/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { closeModal, createRoot, Modal, openModal, ReactDOM, useEffect, useRef } from "@webpack/common";
import type { ReactNode } from "react";

const CLOSE_ANIMATION_MS = 120;
const MODAL_KEY = "vc-instant-replay";
const FOCUSABLE = "button:not([disabled]):not([tabindex='-1']), [tabindex='0']";

interface OpenWindow {
    close(reason: string): void;
    destroy(reason: string): void;
    isShown(): boolean;
}

function noteClosed(reason: string): void {
    console.info(`[InstantReplay] window closed (${reason})`);
}

let current: OpenWindow | null = null;
let keyInterceptor: ((event: KeyboardEvent) => void) | null = null;

export function interceptKeys(handler: ((event: KeyboardEvent) => void) | null): void {
    keyInterceptor = handler;
}

const prefersLessMotion = () => {
    try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
};

const isTypingKey = (event: KeyboardEvent) =>
    typeof event.key === "string" && event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;

const takesText = (element: Element | null) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || (element as HTMLElement | null)?.isContentEditable === true;

function Frame({ label, onClose, children }: { label: string; onClose: (reason: string) => void; children: ReactNode; }) {
    const windowRef = useRef<HTMLElement>(null);
    const pressedOnBackdrop = useRef(false);
    const holdsAttention = useRef(true);

    useEffect(() => {
        windowRef.current?.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        const box = windowRef.current;
        if (!box) return;

        const ours = (node: EventTarget | null) => node instanceof Node && (box.parentElement ?? box).contains(node);

        const onPointerDown = (event: PointerEvent) => {
            holdsAttention.current = ours(event.target);
        };
        const onFocusIn = (event: FocusEvent) => {
            if (event.target === document.body) return;
            holdsAttention.current = ours(event.target);
        };

        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("focusin", onFocusIn, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("focusin", onFocusIn, true);
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const box = windowRef.current;
            if (!box || event.defaultPrevented) return;

            const target = event.target instanceof Element ? event.target : null;
            const inside = target != null && box.contains(target);
            const onBarePage = target == null || target === document.body || target === document.documentElement;
            if (!inside && !(onBarePage && holdsAttention.current)) return;

            if (keyInterceptor) {
                event.preventDefault();
                event.stopPropagation();
                keyInterceptor(event);
                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose("esc");
                return;
            }

            if (event.key === "Tab") {
                const focusable = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null);
                if (!focusable.length) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                const active = document.activeElement;

                if (!inside || (event.shiftKey ? active === first : active === last)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                }
                return;
            }

            if (isTypingKey(event) && !takesText(target)) event.stopPropagation();
        };

        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [onClose]);

    return (
        <div
            className="vc-ir-overlay"
            onMouseDown={event => {
                pressedOnBackdrop.current = event.target === event.currentTarget;
            }}
            onClick={event => {
                if (pressedOnBackdrop.current && event.target === event.currentTarget) onClose("backdrop");
            }}
        >
            <section
                ref={windowRef}
                className="vc-ir-window"
                role="dialog"
                aria-modal="true"
                aria-label={label}
                tabIndex={-1}
            >
                {children}
            </section>
        </div>
    );
}

function openOwnRoot(label: string, render: (close: () => void) => ReactNode): OpenWindow {
    const host = document.createElement("div");
    host.className = "vc-ir-scope vc-ir-root";
    document.body.appendChild(host);

    let root: ReturnType<typeof createRoot>;
    try {
        root = createRoot(host);
    } catch (error) {
        host.remove();
        throw error;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let state: "open" | "closing" | "gone" = "open";

    const self: OpenWindow = {
        destroy(reason: string) {
            if (state === "gone") return;
            if (state === "open") noteClosed(reason);
            state = "gone";
            if (current === self) current = null;

            try {
                root.unmount();
            } finally {
                host.remove();
                if (previousFocus?.isConnected && !current) previousFocus.focus({ preventScroll: true });
            }
        },
        close(reason: string) {
            if (state !== "open") return;
            noteClosed(reason);
            state = "closing";
            if (current === self) current = null;

            if (prefersLessMotion()) {
                self.destroy(reason);
                return;
            }

            host.classList.add("vc-ir-root-closing");
            setTimeout(() => self.destroy(reason), CLOSE_ANIMATION_MS);
        },
        isShown() {
            return state === "open" && host.isConnected && host.querySelector(".vc-ir-window") !== null;
        }
    };

    const crashed = (data: { error?: Error; }) => {
        console.error("[InstantReplay] the window crashed", data?.error);
        setTimeout(() => self.destroy("crash"), 0);
    };

    const tree = (
        <Frame label={label} onClose={self.close}>
            <ErrorBoundary noop onError={crashed}>{render(() => self.close("button"))}</ErrorBoundary>
        </Frame>
    );

    try {
        if (typeof ReactDOM?.flushSync === "function") ReactDOM.flushSync(() => root.render(tree));
        else root.render(tree);
    } catch (error) {
        self.destroy("failed to draw");
        throw error;
    }

    return self;
}

function openDiscordModal(label: string, render: (close: () => void) => ReactNode): OpenWindow {
    const self: OpenWindow = {
        close: reason => {
            noteClosed(reason);
            closeModal(MODAL_KEY);
        },
        destroy: reason => {
            noteClosed(reason);
            closeModal(MODAL_KEY);
        },
        isShown: () => true
    };

    openModal(
        props => (
            <ErrorBoundary>
                <Modal {...props} size="md" title={label}>
                    <div className="vc-ir-scope vc-ir-window vc-ir-window-embedded">{render(props.onClose)}</div>
                </Modal>
            </ErrorBoundary>
        ),
        {
            modalKey: MODAL_KEY,
            onCloseCallback: () => {
                if (current === self) current = null;
            }
        }
    );

    return self;
}

export function isWindowOpen(): boolean {
    if (current && !current.isShown()) {
        const stale = current;
        current = null;
        stale.destroy("lost from the page");
    }

    return current !== null;
}

export function closeWindow({ animate = true, reason = "closed by the plugin" } = {}): void {
    const open = current;
    current = null;
    if (!open) return;

    if (animate) open.close(reason);
    else open.destroy(reason);
}

export function openWindow(label: string, render: (close: () => void) => ReactNode): void {
    closeWindow({ animate: false, reason: "replaced" });

    try {
        current = openOwnRoot(label, render);
        return;
    } catch (error) {
        console.warn("[InstantReplay] the window could not be drawn on its own, using a Discord modal", error);
    }

    try {
        current = openDiscordModal(label, render);
    } catch (error) {
        current = null;
        console.error("[InstantReplay] the window could not be opened at all", error);
    }
}
