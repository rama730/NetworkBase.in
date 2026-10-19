'use client';

import { firstExternalMarkdownLink } from '@/lib/messaging/markdown-links';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { maskLinkPreviewAccess, invalidateLinkPreviewAccess, type PreviewSnapshot } from '@/lib/links/client-preview-cache';
import { PREVIEW_REFRESH_MS, PREVIEW_RETENTION_MS, PREVIEW_REQUEST_TIMEOUT_MS, previewSessionBinding, previewDisplayDeadline } from '@/lib/links/display-authorization';
import { useAuth } from '@/hooks/use-auth';
import { queryKeys } from '@/lib/query-keys';
import { getSessionIdentifierFromSession } from '@/lib/auth/session-identifier';
import { genericSharePreview, parseShareResource } from '@/lib/sharing/presentation';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export type { LinkPreviewData as LinkPreview } from '@/lib/links/preview-data';
import { normalizeLinkPreview, normalizePreviewRequestUrl, type LinkPreviewData as LinkPreview } from '@/lib/links/preview-data';

export function extractFirstUrl(content: string | null): string | null {
    return content ? firstExternalMarkdownLink(content, typeof window === "undefined" ? "https://networkbase.in" : window.location.origin) : null;
}

export async function fetchLinkPreview(url: string, signal?: AbortSignal, scope?: { viewerId: string; sessionBinding: string; onServerTime: (time: number) => void }): Promise<LinkPreview | null> {
    const normalized = normalizePreviewRequestUrl(url);
    if (!normalized) return null;
    url = normalized;
    const fallback = (): LinkPreview | null => {
        try {
            const domain = new URL(url).hostname;
            const resource = parseShareResource(url);
            return {
                title: null,
                description: null,
                image: null,
                domain,
                url,
                titleSource: null,
                health: 'unknown',
                checkedAt: new Date().toISOString(),
                resolvedHost: domain,
                contentType: null,
                ...(resource ? { firstParty: genericSharePreview(resource) } : {}),
            };
        } catch {
            return null;
        }
    };
    try {
        const res = await fetch(`/api/v1/link-preview?url=${encodeURIComponent(url)}`, { signal, cache: 'no-store', ...(scope ? { headers: { 'x-preview-viewer': scope.viewerId, 'x-preview-session': scope.sessionBinding } } : {}) });
        scope?.onServerTime(Date.parse(res.headers.get('Date') ?? '') || Date.now());
        if (!res.ok) return fallback();
        const json = await res.json();
        if (json.success && json.data) {
            return normalizeLinkPreview(json.data, url) ?? fallback();
        }
        return fallback();
    } catch (error) {
        if (signal?.aborted) throw error;
        return fallback();
    }
}

function pageVisible() { return document.visibilityState === 'visible'; }
function serverVisible() { return false; }

export function useLinkPreview(url: string | null, options: { active?: boolean } = {}) {
    const { user, session } = useAuth();
    const client = useQueryClient();
    const online = useOnlineStatus();
    const visible = useSyncExternalStore(callback => {
        const changed = () => {
            if (!pageVisible() || !navigator.onLine) maskLinkPreviewAccess(client);
            callback();
        };
        document.addEventListener('visibilitychange', changed);
        window.addEventListener('offline', changed);
        const returned = (event: PageTransitionEvent) => { if (event.persisted) void invalidateLinkPreviewAccess(client); };
        window.addEventListener('pageshow', returned);
        const focused = () => void client.invalidateQueries({ queryKey: queryKeys.sharing.linksRoot(), predicate: query => Boolean((query.state.data as PreviewSnapshot | undefined)?.preview?.firstParty) }, { cancelRefetch: false });
        window.addEventListener('focus', focused);
        return () => {
            document.removeEventListener('visibilitychange', changed);
            window.removeEventListener('offline', changed);
            window.removeEventListener('pageshow', returned);
            window.removeEventListener('focus', focused);
        };
    }, pageVisible, serverVisible);
    const resource = useMemo(() => url ? parseShareResource(url) : null, [url]);
    const firstParty = Boolean(resource);
    const viewerId = user?.id ?? null;
    const sessionId = getSessionIdentifierFromSession(session);
    const displayActive = visible && online;
    const active = options.active !== false && displayActive;
    const query = useQuery({
        queryKey: queryKeys.sharing.link(normalizePreviewRequestUrl(url ?? ''), viewerId, sessionId),
        queryFn: async ({ signal }): Promise<PreviewSnapshot> => {
            const startedAt = performance.now();
            const startedWallAt = Date.now();
            const binding = firstParty && sessionId ? await previewSessionBinding(sessionId) : null;
            if (signal.aborted) throw signal.reason;
            let serverTime = Date.now();
            const controller = new AbortController();
            const canceled = () => controller.abort(signal.reason);
            signal.addEventListener('abort', canceled, { once: true });
            const timeout = setTimeout(() => controller.abort(), PREVIEW_REQUEST_TIMEOUT_MS);
            let result: LinkPreview | null;
            try {
                result = await fetchLinkPreview(url!, controller.signal,
                    firstParty && viewerId && binding ? { viewerId, sessionBinding: binding, onServerTime: time => { serverTime = time; } } : undefined);
            } finally {
                clearTimeout(timeout);
                signal.removeEventListener('abort', canceled);
            }
            if (signal.aborted) throw signal.reason;
            // Keep content structurally stable when only authorization is renewed.
            const { displayAuthorization = null, ...preview } = result ?? {};
            const authorization = result?.firstParty?.state === 'ready' ? displayAuthorization : null;
            const deadline = previewDisplayDeadline(authorization, { viewerId, sessionBinding: binding,
                resourceKey: result?.firstParty?.entityKey ?? result?.firstParty?.url ?? null, startedAt, serverTime });
            return { preview: result ? preview as LinkPreview : null, authorization, deadline,
                wallDeadline: deadline ? startedWallAt + deadline - startedAt : 0 };

        },
        enabled: Boolean(url) && active && (!firstParty || Boolean(viewerId && sessionId)),
        staleTime: firstParty ? state => state.state.data?.authorization ? PREVIEW_REFRESH_MS : 0 : 24 * 60 * 60_000,
        gcTime: firstParty ? PREVIEW_RETENTION_MS : 24 * 60 * 60_000,
        refetchOnWindowFocus: firstParty,
        refetchOnReconnect: firstParty,
        refetchInterval: firstParty && active ? state => state.state.fetchStatus === 'fetching' ? false
            : Math.max(1, PREVIEW_REFRESH_MS - (Date.now() - (Math.max(state.state.dataUpdatedAt, state.state.errorUpdatedAt) || Date.now()))) : false,
        retry: false,
    });
    const snapshot = query.data;
    const proofValid = useSyncExternalStore(callback => {
        if (!firstParty || !displayActive || !snapshot?.authorization) return () => {};
        const timer = setTimeout(callback, Math.max(0, Math.min(snapshot.deadline - performance.now(), snapshot.wallDeadline - Date.now())) + 1);
        return () => clearTimeout(timer);
    }, () => Boolean(snapshot?.authorization && snapshot.deadline > performance.now() && snapshot.wallDeadline > Date.now()), serverVisible);
    const allowed = displayActive && !query.isError && proofValid;
    const masked = useMemo((): LinkPreview | undefined => resource ? {
        url: url!, domain: new URL(url!).hostname, title: null, description: null, image: null,
        firstParty: { ...genericSharePreview(resource), description: !online
            ? 'Offline. Reconnect to load this preview.' : 'Checking preview access. Retry if it cannot be verified.' },
    } : undefined, [url, resource, online]);
    // A failed/expired/revoked proof cannot be rescued by old content or isFetching.
    const data = firstParty && !allowed ? snapshot?.preview?.firstParty && snapshot.preview.firstParty.state !== 'ready' && displayActive
        ? snapshot?.preview ?? masked : masked : snapshot?.preview;
    return { ...query, data, isPaused: !online || query.isPaused };
}
