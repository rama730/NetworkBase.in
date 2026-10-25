'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'discover-hidden-updates';

/** Updates the person hid from Discover, for this tab's session (the Updates tab hides the same way). */
export function useHiddenUpdates() {
    const [hidden, setHidden] = useState<Set<string>>(new Set());

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
        } catch {
            // Storage blocked or bad data: start empty.
        }
    }, []);

    const hide = useCallback((updateId: string) => {
        setHidden((current) => {
            const next = new Set(current).add(updateId);
            try {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next).slice(-500)));
            } catch {
                // Storage blocked: hidden until the page reloads.
            }
            return next;
        });
    }, []);

    return useMemo(() => ({ hidden, hide }), [hidden, hide]);
}
