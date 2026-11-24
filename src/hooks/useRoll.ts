'use client';

import { useEffect, useRef, useState } from 'react';

/** Ease-out (cubic) from `from` to `to` at progress `k` (0–1). Lands exactly on `to` at 1. */
export function rollValue(from: number, to: number, k: number): number {
    if (k >= 1) return to;
    return from + (to - from) * (1 - Math.pow(1 - Math.max(0, k), 3));
}

const reduced = () => typeof window === 'undefined'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.reduceMotion === 'true';

/** A number that rolls to its new value (file counts, openings). Shows the new value at once under reduced motion. */
export function useRoll(value: number, ms = 380): number {
    const [shown, setShown] = useState(value);
    const from = useRef(value);
    useEffect(() => {
        if (reduced() || from.current === value) { from.current = value; setShown(value); return; }
        const start = performance.now(), a = from.current;
        let frame = 0;
        const step = (now: number) => {
            const k = Math.min(1, (now - start) / ms);
            setShown(Math.round(rollValue(a, value, k)));
            if (k < 1) frame = requestAnimationFrame(step);
            else from.current = value;
        };
        frame = requestAnimationFrame(step);
        return () => { cancelAnimationFrame(frame); from.current = value; };
    }, [value, ms]);
    return shown;
}
