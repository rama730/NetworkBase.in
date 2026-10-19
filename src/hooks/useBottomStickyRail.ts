"use client";

import { useLayoutEffect, useRef } from "react";

export function useBottomStickyRail({ scrollContainer, topInset = "24px" }: {
    scrollContainer?: HTMLElement | null;
    topInset?: string;
} = {}) {
    const ref = useRef<HTMLElement>(null);

    useLayoutEffect(() => {
        const rail = ref.current;
        const root = scrollContainer ?? rail?.closest<HTMLElement>('[data-scroll-root="route"]');
        if (!rail || !root) return;

        const align = () => {
            // A negative top lets a tall rail scroll until its bottom is visible.
            rail.style.setProperty("--rail-bottom-top", `${root.clientHeight - rail.offsetHeight - 24}px`);
        };
        align();
        const observer = new ResizeObserver(align);
        observer.observe(rail);
        observer.observe(root);
        return () => observer.disconnect();
    }, [scrollContainer]);

    return { ref, style: { top: `min(${topInset}, var(--rail-bottom-top, ${topInset}))` } };
}
