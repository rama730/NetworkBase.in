'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'discover-session-seen-projects';

/** Projects opened in this tab's session, for "Hide projects I've opened". */
export function useDiscoverSessionSeen() {
    const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
    const loaded = useRef(false);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) setSeenIds(new Set(JSON.parse(raw) as string[]));
        } catch {
            // Storage blocked or bad data: start empty.
        } finally {
            // Always, so the first project opened in a fresh session is saved too.
            loaded.current = true;
        }
    }, []);

    useEffect(() => {
        if (!loaded.current) return;
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seenIds).slice(-500)));
        } catch {
            // Storage blocked: the list lasts as long as the page.
        }
    }, [seenIds]);

    const markSeen = useCallback((projectId: string) => {
        setSeenIds((prev) => {
            if (prev.has(projectId)) return prev;
            const next = new Set(prev);
            next.add(projectId);
            return next;
        });
    }, []);

    return useMemo(() => ({ seenIds, markSeen }), [seenIds, markSeen]);
}
