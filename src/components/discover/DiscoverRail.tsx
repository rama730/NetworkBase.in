"use client";

import { type ReactNode } from "react";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";

export function DiscoverRail({ scrollContainer, children, label = "People and profile" }: {
    scrollContainer: HTMLElement | null;
    children: ReactNode;
    /** What the rail holds right now: people and legal links, or an open update thread. */
    label?: string;
}) {
    const stickyRail = useBottomStickyRail({ scrollContainer });

    return (
        <aside {...stickyRail} aria-label={label}
            className="nb-discover-rail sticky space-y-4 self-start">
            {children}
        </aside>
    );
}
