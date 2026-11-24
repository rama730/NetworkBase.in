'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const reduced = () => typeof window === 'undefined'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.reduceMotion === 'true';

/** A removed chip stays for its leave animation (`data-leaving`), then goes (create wizard v6 motion). Reduced motion
 *  removes it at once. */
export function useLeaving(ms = 150) {
    const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
    const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
    useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);
    const leave = useCallback((key: string, remove: () => void) => {
        if (reduced()) { remove(); return; }
        setLeaving((current) => new Set(current).add(key));
        const timer = setTimeout(() => {
            timers.current.delete(timer);
            remove();
            setLeaving((current) => { const next = new Set(current); next.delete(key); return next; });
        }, ms);
        timers.current.add(timer);
    }, [ms]);
    return [useCallback((key: string) => leaving.has(key), [leaving]), leave] as const;
}
