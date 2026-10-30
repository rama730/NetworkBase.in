'use server';

import { blockVersion } from '@/lib/privacy/blocks';
import { DISCOVER_ANON_CACHE_TAG, FILTER_VIEWS, WORKSPACE_STATUS, WORKSPACE_TYPE, SORT_OPTIONS, type FilterView } from '@/constants/discover';
import { consumeRateLimit, consumeRateLimitForRoute } from '@/lib/security/rate-limit';
import { getDiscoverWorkspaces, InvalidDiscoverCursorError, StaleDiscoverFeedError } from '@/lib/data/discover';
import { getCachedData, cacheData } from '@/lib/redis';
import { DISCOVER_RANKING_SCHEMA_VERSION } from '@/lib/discover/ranking-config';
import { buildDiscoverSnapshotKey } from '@/lib/discover/snapshot-cache';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { DiscoverFilters } from '@/types/discover';
import { headers } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { getTrustedHeadersIp } from '@/lib/security/request-ip';
import { normalizeSearchQuery, tokenizeSearchQuery } from '@/lib/search/query';
import { recordGlobalSearchMetric } from '@/lib/search/observability';
import { createHash } from 'node:crypto';
import { WORKSPACE_TYPE_OPTIONS } from '@/lib/workspaces/workspace-create-options';
import { z } from 'zod';

const hubSearchInputSchema = z.object({
    filters: z.object({
        // Only values Discover offers: anything else would reach a Postgres enum and fail there.
        status: z.enum([WORKSPACE_STATUS.ALL, WORKSPACE_STATUS.IN_PROGRESS, WORKSPACE_STATUS.LAUNCHED]),
        type: z.enum([WORKSPACE_TYPE.ALL, ...WORKSPACE_TYPE_OPTIONS.map((type) => type.id)]),
        tech: z.array(z.string().trim().min(1).max(100)).max(20),
        sort: z.enum(Object.values(SORT_OPTIONS) as [string, ...string[]]),
        search: z.string().max(200).optional(),
        show: z.enum(['all', 'projects', 'organizations', 'updates']).optional(),
        org: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    }).strict(),
    cursor: z.string().max(1_000).optional(),
    limit: z.number().int().min(1).max(60),
    view: z.enum([FILTER_VIEWS.ALL, FILTER_VIEWS.TRENDING, FILTER_VIEWS.RECOMMENDATIONS, FILTER_VIEWS.FOLLOWING]),
    surface: z.enum(['full', 'preview']),
}).strict()
    // The trending order belongs to the Trending view (a ranked list); elsewhere it would be an unindexed full sort.
    .refine((input) => input.filters.sort !== SORT_OPTIONS.TRENDING || input.view === FILTER_VIEWS.TRENDING);

export async function fetchDiscoverWorkspacesAction(
    filters: DiscoverFilters,
    cursor?: string,
    limit: number = 24,
    view: FilterView = FILTER_VIEWS.ALL,
    surface: 'full' | 'preview' = 'full',
) {
    const startedAt = performance.now();
    const validation = hubSearchInputSchema.safeParse({ filters, cursor, limit, view, surface });
    if (!validation.success) {
        return {
            success: false as const,
            schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
            projects: [],
            hasMore: false,
            code: 'VALIDATION' as const,
            error: 'Invalid workspace search request',
        };
    }
    ({ filters, cursor, limit, view, surface } = validation.data);
    const normalizedSearch = normalizeSearchQuery(filters.search);
    const recordPreview = (outcome: 'success' | 'empty' | 'rate-limited' | 'error', resultCount: number) => {
        if (surface !== 'preview' || !normalizedSearch) return;
        recordGlobalSearchMetric({
            domain: 'discover',
            scope: view,
            outcome,
            durationMs: performance.now() - startedAt,
            resultCount,
            queryLength: normalizedSearch.length,
            tokenCount: tokenizeSearchQuery(normalizedSearch).length,
        });
    };

    try {
        const { user } = await getViewerAuthContext();
        const headerStore = await headers();
        // No trusted IP: a browser fingerprint, so anonymous visitors don't all share one bucket.
        const ipAddress = getTrustedHeadersIp(headerStore)
            ?? `fp:${createHash('sha1').update(`${headerStore.get('user-agent') ?? ''}|${headerStore.get('accept-language') ?? ''}`).digest('hex').slice(0, 16)}`;
        const viewerKey = user?.id || `anon:${ipAddress}`;

        const readLimit = await consumeRateLimitForRoute('publicRead', `discover:${viewerKey}`, 180, 60);
        // A limiter outage (Redis down) is not the viewer's fault: let the read through rather than say "too many".
        if (!readLimit.allowed && !readLimit.degraded) {
            recordPreview('rate-limited', 0);
            return {
                success: false as const,
                projects: [],
                hasMore: false,
                schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                code: 'RATE_LIMITED' as const,
                retryAfterMs: 5_000,
                error: 'Too many requests. Wait a moment and try again.',
            };
        }

        if (normalizedSearch.length > 0) {
            const searchLimit = await consumeRateLimit(`discover-search:${viewerKey}`, 90, 60);
            if (!searchLimit.allowed && !searchLimit.degraded) {
                recordPreview('rate-limited', 0);
                return {
                    success: false as const,
                    projects: [],
                    hasMore: false,
                    schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                    code: 'RATE_LIMITED' as const,
                    retryAfterMs: 1_000,
                    error: 'Too many searches. Wait a moment and try again.',
                };
            }
        }

        // zod already checked every value; only order-insensitive bits are normalized (one cache entry per filter set).
        const normalizedLimit = limit;
        const normalizedCursor = cursor || undefined;
        const normalizedView = view;
        const normalizedFilters: DiscoverFilters = {
            ...filters,
            tech: Array.from(new Set(filters.tech)).sort(),
            search: normalizedSearch || undefined,
        };

        // Signed-out first pages without a search share a short cache; a search would make one entry per query.
        const shouldUseAnonEdgeCache = !user && !normalizedCursor && !normalizedSearch;

        if (shouldUseAnonEdgeCache) {
            const getCachedAnonymousDiscoverPage = unstable_cache(
                async () => getDiscoverWorkspaces(normalizedFilters, undefined, normalizedLimit, {
                    view: normalizedView,
                    viewerId: null,
                    surface,
                }),
                ['discover-anon', JSON.stringify({ normalizedFilters, normalizedLimit, normalizedView, surface })],
                { revalidate: 45, tags: [DISCOVER_ANON_CACHE_TAG] },
            );

            const result = await getCachedAnonymousDiscoverPage();
            recordPreview(result.projects.length > 0 ? 'success' : 'empty', result.projects.length);
            return {
                success: true as const,
                ...result,
            };
        }

        // The viewer's block version is part of the key: a block never waits out a cached answer (Blocking B18).
        const cacheKey = surface === 'preview' && normalizedSearch && !normalizedCursor
            ? `search:preview:hub:${viewerKey}:b${user?.id ? await blockVersion(user.id) : 0}:${buildDiscoverSnapshotKey({ normalizedFilters, normalizedView, normalizedLimit })}`
            : null;

        if (cacheKey) {
            const cached = await getCachedData<any>(cacheKey);
            if (cached) {
                recordPreview('success', cached.projects.length);
                return {
                    success: true as const,
                    projects: cached.projects as Awaited<ReturnType<typeof getDiscoverWorkspaces>>['projects'],
                    nextCursor: cached.nextCursor as Awaited<ReturnType<typeof getDiscoverWorkspaces>>['nextCursor'],
                    hasMore: cached.hasMore as boolean,
                    schemaVersion: cached.schemaVersion as string | number,
                };
            }
        }

        const dedupeKey = [
            'discover:projects',
            user?.id ?? `anon:${ipAddress}`,
            normalizedView,
            normalizedLimit,
            normalizedCursor ?? '',
            surface,
            JSON.stringify(normalizedFilters),
        ].join(':');

        return await runInFlightDeduped(dedupeKey, async () => {
            const result = await getDiscoverWorkspaces(normalizedFilters, normalizedCursor, normalizedLimit, {
                view: normalizedView,
                viewerId: user?.id ?? null,
                surface,
            });

            recordPreview(result.projects.length > 0 ? 'success' : 'empty', result.projects.length);

            const response = {
                projects: result.projects,
                nextCursor: result.nextCursor,
                hasMore: result.hasMore,
                schemaVersion: result.schemaVersion,
            };

            if (cacheKey && result && result.projects.length > 0) {
                // Short: a project made private shouldn't linger in someone's search preview.
                await cacheData(cacheKey, response, 60);
            }

            return {
                success: true as const,
                ...response,
            };
        });
    } catch (error) {
        recordPreview('error', 0);
        if (error instanceof StaleDiscoverFeedError) {
            return {
                success: false as const,
                schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                projects: [],
                hasMore: false,
                code: 'STALE_FEED' as const,
                error: error.message,
            };
        }
        if (error instanceof InvalidDiscoverCursorError) {
            return {
                success: false as const,
                schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                projects: [],
                hasMore: false,
                code: 'VALIDATION' as const,
                error: error.message,
            };
        }
        console.error('Error fetching hub projects:', error);
        return {
            success: false as const,
            schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
            projects: [],
            hasMore: false,
            code: 'TRANSIENT' as const,
            error: 'Couldn’t fetch workspaces'
        };
    }
}
