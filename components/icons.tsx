/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

interface IconProps {
    size?: number;
    className?: string;
}

function Stroke({ size = 20, className, children }: IconProps & { children: ReactNode; }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden={true}
        >
            {children}
        </svg>
    );
}

export function ReplayIcon({ width = 20, height = 20, className, dot }: { width?: number; height?: number; className?: string; dot?: string; }) {
    return (
        <svg
            width={width}
            height={height}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            aria-hidden={true}
        >
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            {dot && (
                <>
                    <circle cx={18.5} cy={18.5} r={5.5} fill="var(--bg-base-primary, var(--background-base-lowest, #121214))" stroke="none" />
                    <circle cx={18.5} cy={18.5} r={3.5} fill={dot} stroke="none" />
                </>
            )}
        </svg>
    );
}

export const CloseIcon = (props: IconProps) => (
    <Stroke {...props}>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
    </Stroke>
);

export const PlayIcon = (props: IconProps) => (
    <Stroke {...props}>
        <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
    </Stroke>
);

export const FolderIcon = (props: IconProps) => (
    <Stroke {...props}>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Stroke>
);

export const SettingsIcon = (props: IconProps) => (
    <Stroke {...props}>
        <path d="M4 6h10" />
        <path d="M18 6h2" />
        <circle cx={16} cy={6} r={2} />
        <path d="M4 12h3" />
        <path d="M11 12h9" />
        <circle cx={9} cy={12} r={2} />
        <path d="M4 18h12" />
        <circle cx={18} cy={18} r={2} />
    </Stroke>
);

export const FilmIcon = (props: IconProps) => (
    <Stroke {...props}>
        <rect x={3} y={4} width={18} height={16} rx={2} />
        <path d="M7 4v16" />
        <path d="M17 4v16" />
        <path d="M3 9h4" />
        <path d="M3 15h4" />
        <path d="M17 9h4" />
        <path d="M17 15h4" />
    </Stroke>
);

export const KeyboardIcon = (props: IconProps) => (
    <Stroke {...props}>
        <rect x={2.5} y={6} width={19} height={12} rx={2.5} />
        <path d="M6.5 10h.01" />
        <path d="M10 10h.01" />
        <path d="M13.5 10h.01" />
        <path d="M17 10h.01" />
        <path d="M8 14h8" />
    </Stroke>
);

export const ChevronIcon = (props: IconProps) => (
    <Stroke {...props}>
        <path d="m9 6 6 6-6 6" />
    </Stroke>
);

export const SaveIcon = (props: IconProps) => (
    <Stroke {...props}>
        <path d="M12 4v11" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 20h14" />
    </Stroke>
);

export const StopIcon = (props: IconProps) => (
    <Stroke {...props}>
        <rect x={6} y={6} width={12} height={12} rx={2} fill="currentColor" />
    </Stroke>
);

export const RecordIcon = (props: IconProps) => (
    <Stroke {...props}>
        <circle cx={12} cy={12} r={6} fill="currentColor" stroke="none" />
    </Stroke>
);
