'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/lib/feedback';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverUpdateView } from '@/types/discover';
import { fetchDiscoverUpdate } from '@/hooks/discover/useDiscoverUpdates';

const PARAM = 'updateId';

/**
 * Which update's thread is open on Discover, and the URL and focus that go with it.
 *
 * Opening adds one history entry and closing removes it, so Back closes the thread and never reopens it. A
 * link to an update that isn't in the loaded feed is fetched on its own; one this viewer may not see says so
 * and the stale `?updateId=` is dropped from the address.
 */
export function useDiscoverUpdateThread(params: {
    viewerId: string | null;
    loaded: DiscoverUpdateView[];
    initialUpdateId?: string | null;
    initialUpdate?: DiscoverUpdateView | null;
}) {
    const { viewerId, loaded, initialUpdateId = null, initialUpdate = null } = params;
    const [selectedId, setSelectedId] = useState<string | null>(initialUpdateId);
    // The id as the latest event saw it: URL changes happen in handlers, never inside a state updater.
    const selectedRef = useRef<string | null>(initialUpdateId);
    const opener = useRef<HTMLElement | null>(null);
    // True when this page added the history entry the thread is showing for.
    const pushed = useRef(false);

    const fromFeed = selectedId ? loaded.find((update) => update.id === selectedId) ?? null : null;
    const single = useQuery({
        queryKey: queryKeys.discover.singleUpdate(viewerId, selectedId ?? ''),
        queryFn: ({ signal }) => fetchDiscoverUpdate(selectedId!, signal),
        enabled: Boolean(selectedId) && !fromFeed,
        // Never `null`: react-query would take that as an answer already in hand and not ask the server.
        initialData: initialUpdate?.id === selectedId ? initialUpdate : undefined,
        staleTime: 60_000,
        retry: false,
    });
    const selected = fromFeed ?? single.data ?? null;
    const loading = Boolean(selectedId) && !selected && single.isLoading;

    const writeUrl = useCallback((id: string | null, mode: 'push' | 'replace') => {
        const url = new URL(window.location.href);
        if (id) url.searchParams.set(PARAM, id);
        else url.searchParams.delete(PARAM);
        const next = url.pathname + url.search;
        if (mode === 'push') window.history.pushState(null, '', next);
        else window.history.replaceState(null, '', next);
    }, []);

    const select = useCallback((id: string | null) => {
        selectedRef.current = id;
        setSelectedId(id);
    }, []);

    const open = useCallback((id: string, from: HTMLElement | null) => {
        opener.current = from;
        // Opening another thread while one is open swaps it; it does not stack entries.
        const hadThread = Boolean(selectedRef.current);
        writeUrl(id, hadThread ? 'replace' : 'push');
        if (!hadThread) pushed.current = true;
        select(id);
    }, [select, writeUrl]);

    const restoreFocus = useCallback(() => {
        const target = opener.current;
        opener.current = null;
        if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }, []);

    const close = useCallback(() => {
        if (pushed.current) {
            // Back removes the entry we added; the popstate handler below clears the thread.
            pushed.current = false;
            window.history.back();
        } else {
            writeUrl(null, 'replace');
            select(null);
        }
        restoreFocus();
    }, [restoreFocus, select, writeUrl]);

    /** Drops the thread without touching history (a filter changed under it). */
    const reset = useCallback(() => {
        pushed.current = false;
        opener.current = null;
        if (selectedRef.current) writeUrl(null, 'replace');
        select(null);
    }, [select, writeUrl]);

    useEffect(() => {
        const onPopState = () => {
            const id = new URLSearchParams(window.location.search).get(PARAM);
            if (!id) pushed.current = false;
            select(id);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [select]);

    // A link to something this viewer can't open: say so once, and tidy the address.
    const missing = Boolean(selectedId) && !fromFeed && single.isFetched && single.data === null;
    useEffect(() => {
        if (!missing) return;
        // A warning, not an error: error toasts only show allowlisted copy, and this isn't a failure.
        toast.warning("That update isn't available");
        reset();
    }, [missing, reset]);

    return { selected, selectedId, loading, open, close, reset };
}
