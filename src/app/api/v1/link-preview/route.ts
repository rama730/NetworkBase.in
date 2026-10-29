import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/app/api/v1/_envelope';
import { enforceRouteLimit, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import {
    fetchPublicUrlWithRedirectValidation,
    assertPublicNetworkUrl,
    readBoundedBody,
    UnsafeOutboundUrlError,
} from '@/lib/security/outbound-url';
import { isSafeHttpUrl } from '@/lib/security/urls';
import { logger } from '@/lib/logger';
import { normalizeLinkDestinationTitle } from '@/lib/links/destination-title';
import { readPreviewMetadata } from '@/lib/links/preview-metadata';
import { parseShareResource, shareOrigin } from '@/lib/sharing/presentation';
import { readSharePreview } from '@/lib/sharing/read';
import { normalizePreviewRequestUrl } from '@/lib/links/preview-data';
import { normalizeLinkPreview, type LinkPreviewData } from '@/lib/links/preview-data';
import { getRedisClient } from '@/lib/redis';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { PREVIEW_DISPLAY_LEASE_MS } from '@/lib/links/display-authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FETCH_SIZE = 512 * 1024; // 512KB max HTML to download
const MAX_META_CONTENT_LENGTH = 8 * 1024;
const FETCH_TIMEOUT_MS = 5000;

const PUBLIC_PREVIEW_CACHE_HEADERS = {
    'Cache-Control': 'private, max-age=86400',
};
const FALLBACK_PREVIEW_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300' };

function previewHealth(status: number): LinkPreviewData['health'] {
    if (status === 404 || status === 410) return 'unavailable';
    return status >= 200 && status < 500 ? 'active' : 'unknown';
}

function isYouTubeUrl(url: URL) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

function isGoogleScholarUrl(url: URL) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'scholar.google.com' || host.endsWith('.scholar.google.com');
}

async function fetchYouTubeOEmbed(url: string): Promise<LinkPreviewData | null> {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('url', url);

    let release: (() => void) | null = null;
    try {
        const fetched = await fetchPublicUrlWithRedirectValidation({
            url: endpoint,
            timeoutMs: FETCH_TIMEOUT_MS,
            maxRedirects: 2,
            init: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                    'Accept': 'application/json',
                },
            },
        });
        const { response } = fetched;
        release = fetched.release;
        if (!response.ok) return null;
        const { bytes, truncated } = await readBoundedBody(response, MAX_META_CONTENT_LENGTH * 4);
        if (truncated) return null;
        const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
        const title = normalizeLinkDestinationTitle(payload.title, 'youtube');
        if (!title) return null;
        const thumbnail = typeof payload.thumbnail_url === 'string' && isSafeHttpUrl(payload.thumbnail_url)
            ? payload.thumbnail_url.slice(0, 2000)
            : null;
        return {
            title,
            description: normalizeLinkDestinationTitle(payload.author_name)?.slice(0, 500) || null,
            image: thumbnail,
            domain: new URL(url).hostname,
            url,
            titleSource: 'provider',
            health: 'active',
            checkedAt: new Date().toISOString(),
            resolvedHost: new URL(url).hostname,
            contentType: 'application/json',
        };
    } catch {
        return null;
    } finally {
        release?.();
    }
}

export async function GET(request: NextRequest) {
    try {
        const rlResponse = await enforceRouteLimit(request, 'api:v1:link-preview:get', 60, 60);
        if (rlResponse) return rlResponse;

        const { user, response } = await requireAuthenticatedUser();
        if (response || !user) return response ?? jsonError('Sign in to continue', 401, 'UNAUTHORIZED');

        const rawUrl = request.nextUrl.searchParams.get('url');
        const origin = shareOrigin(request.url);
        const url = rawUrl ? normalizePreviewRequestUrl(rawUrl,origin) : null;
        if (!url) {
            return jsonError('Missing or invalid url parameter', 400, 'BAD_REQUEST');
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
        } catch {
            return jsonError('Invalid URL', 400, 'BAD_REQUEST');
        }

        let validationTimer: ReturnType<typeof setTimeout> | undefined;
        // Resolve our resources from authorized domain data. Never scrape ourselves or share
        // the sender's card through the URL-only public Redis cache below.
        const resource = parseShareResource(url,origin);
        if (resource) {
            const viewer = await getViewerAuthContext();
            // A derived binding, not the forbidden raw server auth context/session.
            const sessionBinding = viewer.userId === user.id && viewer.snapshot?.sessionId
                ? createHash('sha256').update(viewer.snapshot.sessionId).digest('hex') : null;
            const expectedActor = request.headers.get('x-preview-viewer');
            const expectedSession = request.headers.get('x-preview-session');
            if ((expectedActor && expectedActor !== user.id) || (expectedSession && expectedSession !== sessionBinding)) {
                return jsonError('Preview account changed. Retry with the current account.', 401, 'UNAUTHORIZED');
            }
            const firstParty = await readSharePreview(url, user?.id ?? null,origin);
            const issuedAt = new Date();
            const displayAuthorization = firstParty?.state === 'ready' && sessionBinding ? {
                viewerId: user.id, sessionBinding, resourceKey: firstParty.entityKey ?? firstParty.url,
                issuedAt: issuedAt.toISOString(), expiresAt: new Date(Math.min(issuedAt.getTime() + PREVIEW_DISPLAY_LEASE_MS, (viewer.snapshot?.expiresAt ?? Infinity) * 1000)).toISOString(),
            } : null;
            const preview = normalizeLinkPreview({ url, domain: parsedUrl.hostname, displayAuthorization,
                title: firstParty?.title ?? null, description: firstParty?.description ?? null,
                image: null, firstParty, health: firstParty?.state === 'unknown' ? 'unknown' : firstParty?.state === 'unavailable' ? 'unavailable' : 'active' }, url,origin);
            return jsonSuccess(preview, undefined, { headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization', 'Date': issuedAt.toUTCString() } });
        }
        try {
            await Promise.race([
                assertPublicNetworkUrl(parsedUrl),
                new Promise<never>((_resolve, reject) => { validationTimer = setTimeout(() => reject(new Error('URL validation timed out')), FETCH_TIMEOUT_MS); }),
            ]);
        } catch (error) {
            if (error instanceof UnsafeOutboundUrlError) return jsonError('URL is not allowed', 400, 'BAD_REQUEST');
            return jsonSuccess(normalizeLinkPreview({ url, domain: parsedUrl.hostname }, url), undefined, { headers: FALLBACK_PREVIEW_CACHE_HEADERS });
        } finally {
            if (validationTimer) clearTimeout(validationTimer);
        }

        // Redis cache check
        const redis = getRedisClient();
        const cacheKey = `link-preview:v2:${createHash('sha256').update(url).digest('hex')}`;
        if (redis) {
            try {
                const cached = await redis.get<LinkPreviewData>(cacheKey);
                const safeCached = normalizeLinkPreview(cached, url);
                if (safeCached) {
                    return jsonSuccess(safeCached, undefined, {
                        headers: PUBLIC_PREVIEW_CACHE_HEADERS,
                    });
                }
            } catch {
                // Fall back to live fetch if Redis fails
            }
        }

        // YouTube watch URLs contain only the route name (`watch`) locally.
        // oEmbed is the provider-supported, keyless source for the exact video
        // title and is both more stable and cheaper than parsing the full page.
        if (isYouTubeUrl(parsedUrl)) {
            const youtubePreview = await fetchYouTubeOEmbed(url);
            if (youtubePreview) {
                if (redis) {
                    redis.set(cacheKey, youtubePreview, { ex: 7 * 24 * 3600 }).catch(() => {});
                }
                return jsonSuccess(youtubePreview, undefined, {
                    headers: PUBLIC_PREVIEW_CACHE_HEADERS,
                });
            }
        }

        let html: string;
        let releaseFetch: (() => void) | null = null;
        try {
            const { response: res, resolvedUrl, release } = await fetchPublicUrlWithRedirectValidation({
                url,
                timeoutMs: FETCH_TIMEOUT_MS,
                maxRedirects: 3,
                init: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                        'Accept': 'text/html',
                    },
                },
            });
            releaseFetch = release;
            parsedUrl = resolvedUrl;

            if (!res.ok) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                    titleSource: null,
                    health: previewHealth(res.status),
                    checkedAt: new Date().toISOString(),
                    resolvedHost: parsedUrl.hostname,
                    contentType: res.headers.get('content-type'),
                }, undefined, { headers: FALLBACK_PREVIEW_CACHE_HEADERS });
            }

            // Only process HTML responses
            const contentType = res.headers.get('content-type') || '';
            if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType.trim())) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                    titleSource: null,
                    health: 'active',
                    checkedAt: new Date().toISOString(),
                    resolvedHost: parsedUrl.hostname,
                    contentType,
                }, undefined, { headers: PUBLIC_PREVIEW_CACHE_HEADERS });
            }

            // Read a bounded amount of HTML under the same deadline as the request.
            if (!res.body) {
                return jsonSuccess<LinkPreviewData>({
                    title: null,
                    description: null,
                    image: null,
                    domain: parsedUrl.hostname,
                    url,
                    titleSource: null,
                    health: 'active',
                    checkedAt: new Date().toISOString(),
                    resolvedHost: parsedUrl.hostname,
                    contentType,
                }, undefined, { headers: PUBLIC_PREVIEW_CACHE_HEADERS });
            }
            const bytes = (await readBoundedBody(res, MAX_FETCH_SIZE)).bytes;
            const encoding = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? 'utf-8';
            try { html = new TextDecoder(encoding).decode(bytes); }
            catch { html = new TextDecoder().decode(bytes); }
        } catch (error) {
            if (error instanceof UnsafeOutboundUrlError) {
                logger.warn('link-preview.outbound_url_blocked', {
                    module: 'api',
                    userId: user?.id ?? undefined,
                    requestedHost: parsedUrl.hostname,
                    error: error.message,
                });
                return jsonError('URL is not allowed', 400, 'BAD_REQUEST');
            }
            // Fetch failed (timeout, network error, etc.)
            return jsonSuccess<LinkPreviewData>({
                title: null,
                description: null,
                image: null,
                domain: parsedUrl.hostname,
                url,
                titleSource: null,
                health: 'unknown',
                checkedAt: new Date().toISOString(),
                resolvedHost: parsedUrl.hostname,
                contentType: null,
            }, undefined, { headers: FALLBACK_PREVIEW_CACHE_HEADERS });
        } finally {
            releaseFetch?.();
        }

        const extracted = readPreviewMetadata(html, parsedUrl);
        const platform = isYouTubeUrl(parsedUrl) ? 'youtube' : isGoogleScholarUrl(parsedUrl) ? 'google-scholar' : null;
        const preview: LinkPreviewData = {
            ...extracted,
            title: normalizeLinkDestinationTitle(extracted.title, platform, false),
            domain: parsedUrl.hostname,
            url,
            health: 'active',
            checkedAt: new Date().toISOString(),
            resolvedHost: parsedUrl.hostname,
            contentType: 'text/html',
        };

        if (redis && preview.health === 'active') {
            redis.set(cacheKey, preview, { ex: 7 * 24 * 3600 }).catch(() => {});
        }

        return jsonSuccess(preview, undefined, {
            headers: PUBLIC_PREVIEW_CACHE_HEADERS,
        });
    } catch (error) {
        console.error('Link preview error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
