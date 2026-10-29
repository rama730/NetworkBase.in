import { createHash } from 'node:crypto'
import { z } from 'zod'

import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope'
import { consumeRateLimitForRoute } from '@/lib/security/rate-limit'
import { decodePublicProjectsCursor } from '@/lib/projects/public-feed'
import {
    PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT,
    PUBLIC_PROJECTS_FEED_MAX_LIMIT,
    queryAndCachePublicProjectsFeed,
    readPublicProjectsFeedCache,
    forViewer,
} from '@/lib/projects/public-feed-service'
import type { PublicProjectsFeedItem } from '@/lib/projects/public-feed'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { logger } from '@/lib/logger'
import { getTrustedRequestIp } from '@/lib/security/request-ip'

function getRequestId(request: Request) {
    const fromHeader = request.headers.get('x-request-id')?.trim()
    return fromHeader && fromHeader.length > 0 ? fromHeader : crypto.randomUUID()
}

function getRequestPath(request: Request) {
    try {
        return new URL(request.url).pathname
    } catch {
        return '/api/v1/projects'
    }
}

function getRequestIp(request: Request) {
    const trustedIp = getTrustedRequestIp(request)
    if (trustedIp) return trustedIp

    const requestPath = getRequestPath(request)
    const userAgent = request.headers.get('user-agent')?.trim() || 'ua:missing'
    const acceptLanguage = request.headers.get('accept-language')?.trim() || 'lang:missing'
    const fingerprint = createHash('sha1')
        .update(`${userAgent}|${acceptLanguage}|${requestPath}`)
        .digest('hex')
        .slice(0, 16)

    logger.warn('api.v1.projects.missing_forwarded_ip', {
        route: requestPath,
        missingHeaders: ['trusted-remote-ip'],
        fingerprint,
    })

    return `missing-ip:${fingerprint}`
}

// A project made private must leave shared caches quickly: a minute fresh, a minute stale at most.
// A signed-in response is filtered for that viewer (blocks), so it is never shared.
function cacheHeaders(state: 'fresh' | 'stale', viewerId: string | null) {
    if (viewerId) {
        return { 'Cache-Control': 'private, no-store', 'X-Cache-State': state }
    }
    if (state === 'stale') {
        return {
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
            'X-Cache-State': 'stale',
        }
    }

    return {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
        'X-Cache-State': 'fresh',
    }
}

/** The ETag covers the whole body, so any change to any project (or the cursor) is a new tag. */
function feedETag(body: { projects: PublicProjectsFeedItem[]; nextCursor: string | null }) {
    return `W/"feed-${createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 20)}"`
}

function logProjectsRequest(
    request: Request,
    params: {
        requestId: string
        startedAt: number
        status: number
        success: boolean
        source: string
        cacheState?: 'fresh' | 'stale' | 'miss'
        errorCode?: string
    },
) {
    logger.info('api.v1.projects.request', {
        requestId: params.requestId,
        route: getRequestPath(request),
        action: 'projects.get',
        durationMs: Date.now() - params.startedAt,
        status: params.status,
        success: params.success,
        source: params.source,
        cacheState: params.cacheState ?? null,
        errorCode: params.errorCode ?? null,
        sampleRate: params.success ? 0.02 : 1,
    })
}

const projectsQuerySchema = z.object({
    limit: z
        .string()
        .optional()
        .transform((v) => (v ? Number(v) : PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT))
        .pipe(z.number().int().min(1).max(PUBLIC_PROJECTS_FEED_MAX_LIMIT)),
    cursor: z.string().optional(),
})

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const { searchParams } = new URL(request.url)

    const queryParse = projectsQuerySchema.safeParse({
        limit: searchParams.get('limit') ?? undefined,
        cursor: searchParams.get('cursor') ?? undefined,
    })

    if (!queryParse.success) {
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 400,
            success: false,
            source: 'request',
            errorCode: 'BAD_REQUEST',
        })
        return jsonError('Invalid pagination parameters', 400, 'BAD_REQUEST')
    }

    const limit = queryParse.data.limit
    const rawCursor = queryParse.data.cursor ?? null
    const cursor = decodePublicProjectsCursor(rawCursor)
    // A cursor that doesn't decode is a bad request, not page 1 again (that would repeat the feed).
    if (rawCursor && !cursor) {
        logProjectsRequest(request, { requestId, startedAt, status: 400, success: false, source: 'request', errorCode: 'BAD_REQUEST' })
        return jsonError('Invalid pagination cursor', 400, 'BAD_REQUEST')
    }

    const unavailable = (errorCode: string, error?: unknown) => {
        if (error) {
            logger.error('api.v1.projects.error', {
                requestId,
                route: getRequestPath(request),
                errorMessage: error instanceof Error ? error.message : String(error),
            })
        }
        logProjectsRequest(request, { requestId, startedAt, status: 503, success: false, source: 'database', cacheState: 'miss', errorCode })
        const response = jsonError('Feed temporarily unavailable', 503, 'INTERNAL_ERROR')
        response.headers.set('Cache-Control', 'private, no-store')
        return response
    }

    // No session means anonymous. Failing to read one is an error, never "anonymous": that would skip the
    // block filter and hand a signed-in viewer a publicly cacheable body.
    let viewerId: string | null
    try {
        viewerId = (await getViewerAuthContext()).userId ?? null
    } catch (error) {
        return unavailable('AUTH_UNAVAILABLE', error)
    }

    const respond = async (
        page: { projects: PublicProjectsFeedItem[]; nextCursor: string | null },
        state: 'fresh' | 'stale',
        source: 'redis' | 'redis-stale' | 'database',
        cacheState: 'fresh' | 'stale' | 'miss',
    ) => {
        const body = { projects: await forViewer(page.projects, viewerId), nextCursor: page.nextCursor }
        const etag = feedETag(body)
        // The body depends on who's asking (blocks): shared caches must key on the session.
        const headers = { ETag: etag, ...cacheHeaders(state, viewerId), Vary: 'Cookie, Authorization', 'X-Request-Id': requestId }
        const ifNoneMatch = request.headers.get('if-none-match')
        if (ifNoneMatch && ifNoneMatch.split(',').map((tag) => tag.trim()).includes(etag)) {
            return new Response(null, { status: 304, headers })
        }
        logProjectsRequest(request, { requestId, startedAt, status: 200, success: true, source, cacheState })
        return jsonSuccess({ ...body, source }, undefined, { headers })
    }

    // One try for every path, and every respond() awaited, so a failure anywhere (cache, block lookup,
    // database) reaches the stale fallback or the 503 below.
    let staleCache: Awaited<ReturnType<typeof readPublicProjectsFeedCache>>['stale'] = null
    try {
        const cached = await readPublicProjectsFeedCache(limit, cursor)
        if (cached.fresh) return await respond(cached.fresh.value, 'fresh', 'redis', 'fresh')
        staleCache = cached.stale

        const rateLimitKey = `api:v1:projects:get:${getRequestIp(request)}`
        const rateLimit = await consumeRateLimitForRoute('publicRead', rateLimitKey, 180, 60)

        if (!rateLimit.allowed) {
            if (rateLimit.degraded && staleCache) return await respond(staleCache.value, 'stale', 'redis-stale', 'stale')

            const status = rateLimit.degraded ? 503 : 429
            logProjectsRequest(request, {
                requestId,
                startedAt,
                status,
                success: false,
                source: 'rate-limit',
                cacheState: 'miss',
                errorCode: rateLimit.degraded ? 'SERVICE_UNAVAILABLE' : 'RATE_LIMITED',
            })
            return jsonError(
                rateLimit.degraded ? 'Feed temporarily unavailable' : 'Too many attempts. Try again in a minute.',
                status,
                rateLimit.degraded ? 'INTERNAL_ERROR' : 'RATE_LIMITED',
            )
        }

        // The cache was just read and missed: go straight to the database (no second Redis read).
        const payload = await queryAndCachePublicProjectsFeed(limit, cursor)
        return await respond(payload, 'fresh', 'database', 'miss')
    } catch (error) {
        if (staleCache) {
            logger.warn('api.v1.projects.origin_failed_serving_stale', {
                requestId,
                route: getRequestPath(request),
                error: error instanceof Error ? error.message : String(error),
            })
            try {
                return await respond(staleCache.value, 'stale', 'redis-stale', 'stale')
            } catch (staleError) {
                return unavailable('INTERNAL_ERROR', staleError)
            }
        }
        return unavailable('INTERNAL_ERROR', error)
    }
}
