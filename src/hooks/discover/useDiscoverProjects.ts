'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Project, DiscoverFilters } from '@/types/discover';
import { SORT_OPTIONS, type FilterView } from '@/constants/discover';
import { queryKeys } from '@/lib/query-keys';
import { mapPublicProjectToDiscoverProject, type PublicProjectsFeedItem } from '@/lib/projects/public-feed';

const PAGE_SIZE = 24;

/** A feed failure people can act on: the message is ours (never a server body), `code` says if a retry helps. */
export class DiscoverFeedError extends Error {
    constructor(readonly code: 'TRANSIENT' | 'RATE_LIMITED' | 'VALIDATION' | 'STALE_FEED') {
        super(code === 'RATE_LIMITED'
            ? 'Too many requests. Wait a moment, then try again.'
            : code === 'VALIDATION'
                ? "That link’s filters aren’t valid. Clear filters to start over."
                : code === 'STALE_FEED'
                    ? 'This list changed since you opened it.'
                    : "Projects didn’t load. Check your connection and try again.");
        this.name = 'DiscoverFeedError';
    }
}

type PublicProjectsApiResponse = {
    success: true
    data: {
        projects: PublicProjectsFeedItem[]
        nextCursor: string | null
    }
} | {
    success: false
    message?: string
}

async function fetchPublicProjectsPage(cursor: string | undefined) {
    const searchParams = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor) searchParams.set('cursor', cursor);

    const response = await fetch(`/api/v1/projects?${searchParams.toString()}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
    }).catch(() => null);
    if (!response) throw new DiscoverFeedError('TRANSIENT');
    if (response.status === 429) throw new DiscoverFeedError('RATE_LIMITED');
    if (response.status === 400) throw new DiscoverFeedError('VALIDATION');
    const payload = await response.json().catch(() => null) as PublicProjectsApiResponse | null;
    if (!response.ok || !payload?.success) throw new DiscoverFeedError('TRANSIENT');

    return {
        projects: payload.data.projects.map(mapPublicProjectToDiscoverProject),
        nextCursor: payload.data.nextCursor || undefined,
        hasMore: Boolean(payload.data.nextCursor),
    };
}

/**
 * `isDefault` (the unfiltered newest feed, lib/discover/query) reads the shared, cached API and can
 * start from the server-rendered page; everything else goes through the server action.
 */
/**
 * Filtered, searched and ranked pages: a GET to the Discover route, so the browser can cancel a superseded
 * search (the query's abort signal) and a follow isn't queued behind it.
 */
async function fetchDiscoverPage(filters: DiscoverFilters, view: FilterView, cursor: string | undefined, signal: AbortSignal | undefined) {
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

    const response = await fetch(`/api/v1/discover/projects?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal,
    });
    const body = await response.json().catch(() => null) as {
        success?: boolean;
        data?: { projects: Project[]; nextCursor: string | null; hasMore: boolean };
        details?: { code?: string };
    } | null;
    if (response.ok && body?.success && body.data) {
        return { projects: body.data.projects, nextCursor: body.data.nextCursor ?? undefined, hasMore: body.data.hasMore };
    }
    const code = body?.details?.code;
    if (response.status === 429) throw new DiscoverFeedError('RATE_LIMITED');
    if (response.status === 400) throw new DiscoverFeedError(code === 'STALE_FEED' ? 'STALE_FEED' : 'VALIDATION');
    throw new DiscoverFeedError('TRANSIENT');
}

export function useDiscoverProjects(
    viewerId: string | null,
    filters: DiscoverFilters,
    view: FilterView,
    isDefault: boolean,
    initialProjectsPage?: {
        projects?: Project[];
        nextCursor?: string;
        hasMore?: boolean;
        renderedAt?: number;
    } | null,
) {
    return useInfiniteQuery({
        queryKey: queryKeys.discover.projectsSimple(viewerId, view, filters),
        queryFn: async ({ pageParam = undefined as string | undefined, signal }) => {
            if (isDefault) return fetchPublicProjectsPage(pageParam);
            return fetchDiscoverPage(filters, view, pageParam, signal);
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
        staleTime: 120_000,
        refetchOnWindowFocus: false,
        // The last results stay on screen (dimmed) while a new scope or filter loads.
        placeholderData: keepPreviousData,
        // Only a network hiccup is worth retrying; a rate limit or a bad link would fail again.
        retry: (count, error) => count < 2 && !(error instanceof DiscoverFeedError && error.code !== 'TRANSIENT'),
        // The server renders the default feed; use it rather than fetching it again.
        initialData: initialProjectsPage && isDefault ? {
            pages: [{
                projects: initialProjectsPage.projects || [],
                nextCursor: initialProjectsPage.nextCursor,
                hasMore: Boolean(initialProjectsPage.hasMore),
            }],
            pageParams: [undefined],
        } : undefined,
        // Its age is when the server read it, not when this hook ran (a garbage-collected query re-seeds from it).
        initialDataUpdatedAt: initialProjectsPage?.renderedAt,
    });
}
