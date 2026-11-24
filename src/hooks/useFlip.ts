'use client';

import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** FLIP for lists that open in place (create wizard v6: role rows): call `capture()` before the change; after the next
 *  render each `[data-flip]` child that moved slides from where it was. Reduced motion skips it. */
export function useFlip(container: RefObject<HTMLElement | null>, ms = 220) {
    const before = useRef<Map<string, number> | null>(null);
    const capture = useCallback(() => {
        const root = container.current;
        if (!root) return;
        before.current = new Map([...root.querySelectorAll<HTMLElement>('[data-flip]')].map((el) => [el.dataset.flip!, el.getBoundingClientRect().top]));
    }, [container]);
    useLayoutEffect(() => {
        const previous = before.current;
        const root = container.current;
        before.current = null;
        if (!previous || !root) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true') return;
        for (const el of root.querySelectorAll<HTMLElement>('[data-flip]')) {
            const top = previous.get(el.dataset.flip!);
            const dy = top === undefined ? 0 : top - el.getBoundingClientRect().top;
            if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.16,1,.3,1)' });
        }
    });
    return capture;
}
