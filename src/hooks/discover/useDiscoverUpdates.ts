'use client';

import { useEffect, useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { FILTER_VIEWS, SORT_OPTIONS, type FilterView } from '@/constants/discover';
import { FEED_GROUP } from '@/lib/discover/feed-interleaving';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverFilters, DiscoverUpdatesPage, DiscoverUpdateView } from '@/types/discover';

/** Enough for most of a page of 24 projects (one slot per two), topped up by LEAD. */
const PAGE_SIZE = 8;
/** Updates are kept this many ahead of the cards that need them, so a slot is never built before its update arrives. */
const LEAD = 4;
const NEW_POSTS_POLL_MS = 60_000;

async function fetchUpdatesPage(filters: DiscoverFilters, view: FilterView, cursor: string | undefined, signal: AbortSignal | undefined): Promise<DiscoverUpdatesPage> {
    const params = new URLSearchParams({
        view,
        status: filters.status || 'all',
        type: filters.type || 'all',
        sort: filters.sort || SORT_OPTIONS.NEWEST,
        limit: String(PAGE_SIZE),
    });
    if (filters.tech?.length) params.set('tech', filters.tech.join(','));
    if (filters.search) params.set('q', filters.search);
    if (filters.show && filters.show !== 'all') params.set('show', filters.show);
    if (filters.org) params.set('org', filters.org);
    if (cursor) params.set('cursor', cursor);

    const response = await fetch(`/api/v1/discover/updates?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
    });
    const body = await response.json().catch(() => null) as { success?: boolean; data?: DiscoverUpdatesPage } | null;
    if (!response.ok || !body?.success || !body.data) throw new Error(`Updates did not load (${response.status})`);
    return body.data;
}

/** One update by id: null when it isn't available to this viewer (private project, hidden tab, blocked, deleted). */
export async function fetchDiscoverUpdate(updateId: string, signal?: AbortSignal): Promise<DiscoverUpdateView | null> {
    const response = await fetch(`/api/v1/discover/updates/${encodeURIComponent(updateId)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
    });
    if (response.status === 404 || response.status === 400) return null;
    const body = await response.json().catch(() => null) as { success?: boolean; data?: { update: DiscoverUpdateView } } | null;
    if (!response.ok || !body?.success || !body.data) throw new Error(`Update did not load (${response.status})`);
    return body.data.update;
}

/**
 * The update cards for the feed: paged with the same filters as the project cards and kept just ahead of how
 * far the projects have loaded. A failed read leaves the feed without updates (and says so through `isError`);
 * it is never cached as "no updates".
 */
export function useDiscoverUpdates(params: {
    viewerId: string | null;
    filters: DiscoverFilters;
    view: FilterView;
    isDefault: boolean;
    /** Project cards loaded so far: sets how many updates are needed. */
    loadedProjects: number;
    /** Posts alone: they page by themselves (`fetchMore`), and new ones are counted, not dropped in (RT5). */
    postsOnly?: boolean;
    initialPage?: DiscoverUpdatesPage | null;
}) {
    const { viewerId, filters, view, isDefault, loadedProjects, initialPage, postsOnly = false } = params;
    const query = useInfiniteQuery({
        queryKey: queryKeys.discover.pulse(viewerId, view, filters),
        queryFn: ({ pageParam, signal }) => fetchUpdatesPage(filters, view, pageParam, signal),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) => last.nextCursor ?? undefined,
        staleTime: 120_000,
        refetchOnWindowFocus: false,
        // The last updates stay on screen while a new scope or filter loads, so cards don't vanish and reappear.
        placeholderData: keepPreviousData,
        retry: (count) => count < 2,
        initialData: initialPage && isDefault ? { pages: [initialPage], pageParams: [undefined] } : undefined,
    });

    const updates = useMemo(() => {
        const seen = new Set<string>();
        return (query.data?.pages ?? []).flatMap((page) => page.updates).filter((update) => !seen.has(update.id) && Boolean(seen.add(update.id)));
    }, [query.data]);

    const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
    const needed = postsOnly ? 0 : Math.floor(loadedProjects / FEED_GROUP) + LEAD;
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && !isError && updates.length < needed) void fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, isError, updates.length, needed, fetchNextPage]);

    // Newest first only: a ranked list has no "new" to wait behind a button.
    const watchNew = postsOnly && view !== FILTER_VIEWS.TRENDING && Boolean(viewerId);
    const latest = useQuery({
        queryKey: [...queryKeys.discover.pulse(viewerId, view, filters), 'latest'],
        queryFn: ({ signal }) => fetchUpdatesPage(filters, view, undefined, signal),
        enabled: watchNew,
        refetchInterval: NEW_POSTS_POLL_MS,
        refetchIntervalInBackground: false,
        staleTime: NEW_POSTS_POLL_MS,
    });
    const newest = updates[0]?.createdAt ?? '';
    const known = useMemo(() => new Set(updates.map((update) => update.id)), [updates]);
    const newCount = watchNew ? (latest.data?.updates ?? []).filter((update) => update.createdAt > newest && !known.has(update.id)).length : 0;

    return {
        updates,
        isError: query.isError,
        isLoading: query.isLoading,
        hasMore: Boolean(hasNextPage),
        isFetchingMore: isFetchingNextPage,
        fetchMoreFailed: query.isFetchNextPageError,
        fetchMore: fetchNextPage,
        newCount,
        showNew: () => void query.refetch(),
    };
}
