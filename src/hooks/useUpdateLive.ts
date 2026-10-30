'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { readWorkspaceUpdateAction } from '@/app/actions/workspace/updates';
import { removeUpdate, replaceUpdate, updatePages, type UpdatesPage } from '@/components/workspaces/updates/update-helpers';
import { fetchDiscoverUpdate } from '@/hooks/discover/useDiscoverUpdates';
import { queryKeys } from '@/lib/query-keys';
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast';
import { acceptSeq, likesInFlight, releaseCardJoin, takeCardJoin } from '@/lib/realtime/update-live-state';

// Live update cards (the "Update card real-time" report). The database announces every change as a small event with
// ids and counts; this applies them to every cache holding that post. Text and names only ever come from the normal
// per-viewer reads, so private profiles, blocks and moderation stay in one place.

const COUNTS_BATCH_MS = 250;
const LIKERS_EVERY_MS = 3_000;
const COMMENTS_SETTLE_MS = 300;
const COMMENTS_JITTER_MS = 400;
const RECONCILE_MIN_MS = 30_000;
const DISCONNECTED_POLL_MS = 60_000;
const HIDDEN_CATCH_UP_MS = 60_000;
const CARD_DWELL_MS = 1_000;
const CARD_LEAVE_MS = 10_000;

type CountFields = { id: string; likeCount: number; commentCount: number };

function roots(projectId: string): QueryKey[] {
    return [queryKeys.discover.pulseRoot(), queryKeys.project.detail.updates(projectId)];
}

/** One change to one post, everywhere it is shown: Discover pages, the opened post, the workspace list. */
export function patchUpdateEverywhere<T extends { id: string }>(queryClient: QueryClient, projectId: string, updateId: string, change: (item: T) => T) {
    for (const root of roots(projectId)) {
        queryClient.setQueriesData<never>({ queryKey: root }, ((old: never) =>
            updatePages(old, (item) => (item.id === updateId ? (change(item as unknown as T) as unknown as typeof item) : item))) as never);
    }
    queryClient.setQueriesData<T>({ queryKey: ['discover', 'update'] }, (old) => (old && old.id === updateId ? change(old) : old));
}

function removeEverywhere(queryClient: QueryClient, projectId: string, updateId: string) {
    for (const root of roots(projectId)) {
        queryClient.setQueriesData<never>({ queryKey: root }, ((old: never) => removeUpdate(old, updateId)) as never);
    }
    queryClient.setQueriesData<{ id: string } | null>({ queryKey: ['discover', 'update'] }, (old) => (old && old.id === updateId ? null : old));
}

const holds = (data: unknown, updateId: string) =>
    Boolean((data as { pages?: UpdatesPage[] } | undefined)?.pages?.some((page) => Array.isArray(page?.updates) && page.updates.some((u) => u.id === updateId)));

/** Re-read one post through the viewer's own reads: new content, or gone if they can no longer see it. */
async function refreshPost(queryClient: QueryClient, projectId: string, updateId: string) {
    // The list may sit under a filter (organization feeds), so every cached version of it counts.
    const lists = queryClient.getQueriesData({ queryKey: queryKeys.project.detail.updates(projectId) }).filter(([, data]) => holds(data, updateId));
    if (lists.length) {
        const result = await readWorkspaceUpdateAction(projectId, updateId).catch(() => null);
        if (result?.success && result.data) {
            for (const [key] of lists) queryClient.setQueryData(key, (existing: never) => replaceUpdate(existing, updateId, result.data!));
        } else if (result) {
            removeEverywhere(queryClient, projectId, updateId);
        }
    }
    const inDiscover = queryClient.getQueriesData({ queryKey: queryKeys.discover.pulseRoot() }).some(([, data]) => holds(data, updateId))
        || queryClient.getQueriesData<{ id: string } | null>({ queryKey: ['discover', 'update'] }).some(([, data]) => data?.id === updateId);
    if (!inDiscover) return;
    const fresh = await fetchDiscoverUpdate(updateId).catch(() => undefined);
    if (fresh === undefined) return;
    if (fresh === null) return removeEverywhere(queryClient, projectId, updateId);
    queryClient.setQueriesData<never>({ queryKey: queryKeys.discover.pulseRoot() }, ((old: never) =>
        updatePages(old, (item) => (item.id === updateId ? (fresh as unknown as typeof item) : item))) as never);
    queryClient.setQueriesData<{ id: string } | null>({ queryKey: ['discover', 'update'] }, (old) => (old && old.id === updateId ? fresh : old));
}

const lastReconcile = new Map<string, number>();
function reconcilePost(queryClient: QueryClient, projectId: string, updateId: string) {
    const now = Date.now();
    if (now - (lastReconcile.get(updateId) ?? 0) < RECONCILE_MIN_MS) return;
    lastReconcile.set(updateId, now);
    void refreshPost(queryClient, projectId, updateId);
}

// A burst of likes is one redraw per post; a burst of comments is one reload of the open thread, a moment apart for
// each viewer so they don't all ask at once. Closed threads have no observer, so they fetch nothing.
const pendingCounts = new Map<string, { likes?: number; comments?: number; projectId: string }>();
let countsTimer: ReturnType<typeof setTimeout> | null = null;
const commentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const likerTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flushCounts(queryClient: QueryClient) {
    countsTimer = null;
    for (const [updateId, { likes, comments, projectId }] of pendingCounts) {
        patchUpdateEverywhere<CountFields>(queryClient, projectId, updateId, (item) => ({
            ...item,
            likeCount: typeof likes === 'number' && !likesInFlight.has(updateId) ? likes : item.likeCount,
            commentCount: typeof comments === 'number' ? comments : item.commentCount,
        }));
        if (!likerTimers.has(updateId)) {
            likerTimers.set(updateId, setTimeout(() => {
                likerTimers.delete(updateId);
                void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.updateLikes(projectId, updateId) });
            }, LIKERS_EVERY_MS));
        }
    }
    pendingCounts.clear();
}

// ponytail: reloads the open thread as one batch, not comment by comment. Upgrade: fetch by comment id if threads grow past a page.
function reloadThreadSoon(queryClient: QueryClient, projectId: string, updateId: string) {
    if (commentTimers.has(updateId)) return;
    commentTimers.set(updateId, setTimeout(() => {
        commentTimers.delete(updateId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.updateComments(projectId, updateId) });
    }, COMMENTS_SETTLE_MS + Math.random() * COMMENTS_JITTER_MS));
}

function applyEvent(queryClient: QueryClient, projectId: string, event: string, payload: Record<string, unknown>) {
    if (event.startsWith('comment.')) {
        if (typeof payload.updateId === 'string') reloadThreadSoon(queryClient, projectId, payload.updateId);
        return;
    }
    const updateId = typeof payload.id === 'string' ? payload.id : null;
    if (!updateId || !acceptSeq(updateId, payload.seq)) return;
    if (event === 'update.counts') {
        pendingCounts.set(updateId, { likes: payload.likes as number, comments: payload.comments as number, projectId });
        countsTimer ??= setTimeout(() => flushCounts(queryClient), COUNTS_BATCH_MS);
    } else if (event === 'update.removed') {
        removeEverywhere(queryClient, projectId, updateId);
    } else if (event === 'update.changed') {
        void refreshPost(queryClient, projectId, updateId);
    }
}

/**
 * Listens to one topic. Recovery is silent (RT10): a dropped connection, a long sleep or a Realtime outage end in
 * `catchUp`, never a banner. Events can't be replayed, so catching up is simply reading again.
 */
function useTopic(topic: string | null, projectId: string, catchUp: () => void, onEvent?: (event: string, payload: Record<string, unknown>) => void) {
    const queryClient = useQueryClient();
    const catchUpRef = useRef(catchUp);
    const onEventRef = useRef(onEvent);
    useEffect(() => {
        catchUpRef.current = catchUp;
        onEventRef.current = onEvent;
    });

    useEffect(() => {
        if (!topic) return;
        let joined = false;
        let poll: ReturnType<typeof setInterval> | null = null;
        let hiddenAt = 0;
        const stopPoll = () => {
            if (poll) clearInterval(poll);
            poll = null;
        };
        const subscription = subscribeBroadcast(topic, (event, payload) => {
            applyEvent(queryClient, projectId, event, payload);
            onEventRef.current?.(event, payload);
        }, (status) => {
            if (status === 'connected') {
                stopPoll();
                if (joined) catchUpRef.current();
                joined = true;
            } else if (status === 'disconnected' || status === 'disabled') {
                poll ??= setInterval(() => catchUpRef.current(), DISCONNECTED_POLL_MS);
            }
        });
        const onVisibility = () => {
            if (document.hidden) {
                hiddenAt = Date.now();
            } else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_CATCH_UP_MS) {
                catchUpRef.current();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            stopPoll();
            subscription.unsubscribe();
        };
    }, [projectId, queryClient, topic]);
}

/**
 * A workspace's Updates tab. New posts go through `onCreated`, not onto the page (RT5). The workspace topic carries only
 * posts everyone there can read; members also join the members' topic. A post with a narrower audience stays on its own
 * topic, which its card joins (`useUpdatePostLive`).
 */
// ponytail: a new post with a narrower audience shows no pill; it appears on the next load. Upgrade: a topic per audience.
export function useWorkspaceUpdatesLive(projectId: string, enabled: boolean, isMember: boolean, onCreated: (updateId: string) => void) {
    const queryClient = useQueryClient();
    const catchUp = () => void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.updates(projectId) });
    const onEvent = (event: string, payload: Record<string, unknown>) => {
        if (event === 'update.created' && typeof payload.id === 'string') onCreated(payload.id);
    };
    useTopic(enabled ? `updates:workspace:${projectId}` : null, projectId, catchUp, onEvent);
    useTopic(enabled && isMember ? `updates:members:${projectId}` : null, projectId, catchUp, onEvent);
}

/** One post: an opened thread, or a card on screen. */
export function useUpdatePostLive(projectId: string, updateId: string, enabled: boolean) {
    const queryClient = useQueryClient();
    useTopic(enabled ? `updates:post:${updateId}` : null, projectId, () => reconcilePost(queryClient, projectId, updateId));
}

/**
 * A Discover card: live only while it's on screen (RT4). Fast scrolling joins nothing; a card leaves a little after it
 * scrolls away. On joining it re-reads once, since it may have changed before the join.
 */
export function useUpdateCardLive(ref: RefObject<HTMLElement | null>, projectId: string, updateId: string, enabled: boolean) {
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
                    reconcilePost(queryClient, projectId, updateId);
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
        };
    }, [enabled, projectId, queryClient, ref, updateId]);
    useUpdatePostLive(projectId, updateId, live);
}
