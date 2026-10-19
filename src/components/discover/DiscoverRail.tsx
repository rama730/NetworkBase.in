"use client";

import { type ReactNode } from "react";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";

export function DiscoverRail({ scrollContainer, children }: {
    scrollContainer: HTMLElement | null;
    children: ReactNode;
}) {
    const stickyRail = useBottomStickyRail({ scrollContainer });

    return (
        <aside {...stickyRail} aria-label="People and profile"
            className="nb-discover-rail sticky space-y-4 self-start">
            {children}
        </aside>
    );
}
