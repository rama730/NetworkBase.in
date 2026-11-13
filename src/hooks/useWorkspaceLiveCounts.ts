'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast';
import { liveTopics } from '@/lib/realtime/subscriptions';
import { releaseCardJoin, takeCardJoin } from '@/lib/realtime/update-live-state';
import { patchCountsInPages, type WorkspaceCounts } from '@/lib/workspaces/live-counts';
import { startVisibleDwell } from '@/lib/workspaces/visible-dwell';

const VIEW_DWELL_MS = 3_000;
const COUNTS_BATCH_MS = 250;
const RECONCILE_MIN_MS = 60_000;
const DISCONNECTED_POLL_MS = 60_000;
const HIDDEN_CATCH_UP_MS = 60_000;
const CARD_DWELL_MS = 1_000;
const CARD_LEAVE_MS = 10_000;

const lastCountsReconcile = new Map<string, number>();

/** The team never counts, so it sends nothing; the server still decides for everyone else. */
export function useWorkspaceViewBeacon(workspaceId: string | undefined, isTeam: boolean) {
    useEffect(() => {
        if (!workspaceId || isTeam) return;
        const sessionKey = `workspace:view:${workspaceId}`;
        try {
            if (window.sessionStorage.getItem(sessionKey)) return;
        } catch {
            // Storage can be unavailable in privacy-restricted browser modes; the server still de-duplicates.
        }
        return startVisibleDwell(VIEW_DWELL_MS, () => {
            void fetch(`/api/v1/workspaces/${workspaceId}/view`, { method: 'POST', keepalive: true }).then((response) => {
                if (!response.ok) return;
                try {
                    window.sessionStorage.setItem(sessionKey, '1');
                } catch {
                    // As above.
                }
            }).catch(() => undefined); // Offline: the next visit tries again.
        });
    }, [isTeam, workspaceId]);
}

export async function fetchWorkspaceCounts(workspaceId: string): Promise<WorkspaceCounts | null> {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/view`).catch(() => null);
    if (!response?.ok) return null;
    const body = await response.json().catch(() => null) as { data?: WorkspaceCounts } | null;
    return body?.data ?? null;
}

/** Every cached Discover page holding this workspace, so its card agrees with what was just learned. */
export function patchDiscoverCounts(queryClient: QueryClient, workspaceId: string, counts: WorkspaceCounts) {
    queryClient.setQueriesData({ queryKey: queryKeys.discover.projectsSimpleRoot() }, (old: never) => patchCountsInPages(old, workspaceId, counts));
}

/**
 * Listens to a workspace's topic. Recovery is silent: a dropped connection or a long sleep end in `catchUp`,
 * because events can't be replayed. Returns the function that stops listening.
 */
export function followWorkspaceTopic(workspaceId: string, onEvent: (event: string, payload: Record<string, unknown>) => void, catchUp: () => void) {
    let joined = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let hiddenAt = 0;
    const stopPoll = () => {
        if (poll) clearInterval(poll);
        poll = null;
    };
    const subscription = subscribeBroadcast(liveTopics.workspace(workspaceId), onEvent, (status) => {
        if (status === 'connected') {
            stopPoll();
            if (joined) catchUp();
            joined = true;
        } else if (status === 'disconnected' || status === 'disabled') {
            poll ??= setInterval(() => { if (!document.hidden) catchUp(); }, DISCONNECTED_POLL_MS);
        }
    });
    const onVisibility = () => {
        if (document.hidden) {
            hiddenAt = Date.now();
        } else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_CATCH_UP_MS) {
            catchUp();
        }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        stopPoll();
        subscription.unsubscribe();
    };
}

// A burst of changes across cards is one redraw.
const pendingCounts = new Map<string, WorkspaceCounts>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;
function queueCounts(queryClient: QueryClient, workspaceId: string, counts: WorkspaceCounts) {
    pendingCounts.set(workspaceId, counts);
    batchTimer ??= setTimeout(() => {
        batchTimer = null;
        for (const [id, next] of pendingCounts) patchDiscoverCounts(queryClient, id, next);
        pendingCounts.clear();
    }, COUNTS_BATCH_MS);
}

/**
 * A Discover card's counts, live only while it's on screen. Fast scrolling joins nothing, a card leaves a little after
 * it scrolls away, and joins share the update cards' budget. On joining it reads once, as it may have changed before.
 */
export function useWorkspaceCardLive(ref: RefObject<HTMLElement | null>, workspaceId: string, enabled: boolean) {
    const queryClient = useQueryClient();
    const [live, setLive] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!enabled || !element || typeof IntersectionObserver === 'undefined') return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let holding = false;
        const clear = () => {
            if (timer) clearTimeout(timer);
            timer = null;
        };
        const observer = new IntersectionObserver(([entry]) => {
            clear();
            if (entry?.isIntersecting) {
                if (holding) return;
                timer = setTimeout(() => {
                    if (!takeCardJoin()) return;
                    holding = true;
                    setLive(true);
                }, CARD_DWELL_MS);
            } else if (holding) {
                timer = setTimeout(() => {
                    holding = false;
                    releaseCardJoin();
                    setLive(false);
                }, CARD_LEAVE_MS);
            }
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            clear();
            if (holding) releaseCardJoin();
            setLive(false);
        };
    }, [enabled, ref, workspaceId]);

    useEffect(() => {
        if (!enabled || !workspaceId) return;
        if (!lastCountsReconcile.has(workspaceId)) {
            lastCountsReconcile.set(workspaceId, Date.now());
        }
    }, [enabled, workspaceId]);

    useEffect(() => {
        if (!live) return;
        const read = (force = false) => {
            const now = Date.now();
            if (!force && now - (lastCountsReconcile.get(workspaceId) ?? 0) < RECONCILE_MIN_MS) return;
            lastCountsReconcile.set(workspaceId, now);
            void fetchWorkspaceCounts(workspaceId).then((counts) => {
                if (counts) queueCounts(queryClient, workspaceId, counts);
            });
        };
        read(false);
        return followWorkspaceTopic(workspaceId, (event, payload) => {
            if (event !== 'workspace.changed') return;
            queueCounts(queryClient, workspaceId, {
                viewCount: typeof payload.view_count === 'number' ? payload.view_count : undefined,
                followersCount: typeof payload.followers_count === 'number' ? payload.followers_count : undefined,
            });
        }, () => read(true));
    }, [live, queryClient, workspaceId]);
}
