'use server';

import { DISCOVER_ANON_CACHE_TAG, FILTER_VIEWS, PROJECT_STATUS, PROJECT_TYPE, SORT_OPTIONS, type FilterView } from '@/constants/discover';
import { consumeRateLimit, consumeRateLimitForRoute } from '@/lib/security/rate-limit';
import { getDiscoverProjects, InvalidDiscoverCursorError } from '@/lib/data/discover';
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
import { z } from 'zod';

const hubSearchInputSchema = z.object({
    filters: z.object({
        // Only values Discover offers: anything else would reach a Postgres enum and fail there.
        status: z.enum([PROJECT_STATUS.ALL, PROJECT_STATUS.IN_PROGRESS, PROJECT_STATUS.LAUNCHED]),
        type: z.enum(Object.values(PROJECT_TYPE) as [string, ...string[]]),
        tech: z.array(z.string().trim().min(1).max(100)).max(20),
        sort: z.enum(Object.values(SORT_OPTIONS) as [string, ...string[]]),
        search: z.string().max(200).optional(),
    }).strict(),
    cursor: z.string().max(1_000).optional(),
    limit: z.number().int().min(1).max(60),
    view: z.enum([FILTER_VIEWS.ALL, FILTER_VIEWS.TRENDING, FILTER_VIEWS.RECOMMENDATIONS, FILTER_VIEWS.FOLLOWING]),
    surface: z.enum(['full', 'preview']),
}).strict();

export async function fetchDiscoverProjectsAction(
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
            error: 'Invalid project search request',
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
        if (!readLimit.allowed) {
            recordPreview('rate-limited', 0);
            return {
                success: false as const,
                projects: [],
                hasMore: false,
                schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                code: 'RATE_LIMITED' as const,
                retryAfterMs: 5_000,
                error: 'Too many requests. Please wait a moment and try again.',
            };
        }

        if (normalizedSearch.length > 0) {
            const searchLimit = await consumeRateLimit(`discover-search:${viewerKey}`, 90, 60);
            if (!searchLimit.allowed) {
                recordPreview('rate-limited', 0);
                return {
                    success: false as const,
                    projects: [],
                    hasMore: false,
                    schemaVersion: DISCOVER_RANKING_SCHEMA_VERSION,
                    code: 'RATE_LIMITED' as const,
                    retryAfterMs: 1_000,
                    error: 'Too many searches. Please wait a moment and try again.',
                };
            }
        }

        const normalizedLimit = Math.max(1, Math.min(limit, 60));
        const normalizedCursor = cursor || undefined;
        const normalizedView = view || FILTER_VIEWS.ALL;
        const normalizedFilters: DiscoverFilters = {
            status: filters.status || 'all',
            type: filters.type || 'all',
            tech: Array.isArray(filters.tech) ? Array.from(new Set(filters.tech)).sort() : [],
            sort: filters.sort || 'newest',
            search: normalizedSearch || undefined,
        };

        const shouldUseAnonEdgeCache = !user && !normalizedCursor;

        if (shouldUseAnonEdgeCache) {
            const getCachedAnonymousDiscoverPage = unstable_cache(
                async () => getDiscoverProjects(normalizedFilters, undefined, normalizedLimit, {
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

        const cacheKey = surface === 'preview' && normalizedSearch && !normalizedCursor
            ? `search:preview:hub:${viewerKey}:${buildDiscoverSnapshotKey({ normalizedFilters, normalizedView, normalizedLimit })}`
            : null;

        if (cacheKey) {
            const cached = await getCachedData<any>(cacheKey);
            if (cached) {
                recordPreview('success', cached.projects.length);
                return {
                    success: true as const,
                    projects: cached.projects as Awaited<ReturnType<typeof getDiscoverProjects>>['projects'],
                    nextCursor: cached.nextCursor as Awaited<ReturnType<typeof getDiscoverProjects>>['nextCursor'],
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
            const result = await getDiscoverProjects(normalizedFilters, normalizedCursor, normalizedLimit, {
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
            error: 'Failed to fetch projects'
        };
    }
}
