"use client";

import { readShellPart } from "@/lib/shell-batch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
    type InfiniteData,
} from "@tanstack/react-query";
import { toast, feedbackError } from "@/lib/feedback";
import { formatLongDate } from "@/lib/utils/date";

import {
    actOnNotificationAction,
    dismissAllNotificationsAction,
    dismissNotificationAction,
    dismissReadNotificationsAction,
    markAllNotificationsReadAction,
    readHandInProgressAction,
    readNeedsYouAction,
    readSnoozedNotificationsAction,
    restoreNotificationAction,
    updateNotificationPreferencesAction,
    markNotificationReadAction,
    markNotificationUnreadAction,
    markNotificationsSeenAction,
    muteNotificationScopeAction,
    readNotificationsAction,
    snoozeNotificationAction,
} from "@/app/actions/notifications";
import {
    markNotificationsSeenInInfiniteData,
    patchNotificationReadStateInInfiniteData,
    removeNotificationFromInfiniteData,
    upsertNotificationInInfiniteData,
} from "@/lib/notifications/cache";
import {
    getNotificationReason,
    buildNotificationHref,
    getNarrowestNotificationMuteScope,
    shouldSuppressNotificationToast,
} from "@/lib/notifications/presentation";
import { showBrowserNotification } from "@/lib/notifications/browser-push";
import { createTaskCommentAction } from "@/app/actions/task-comment";
import { createWorkspaceUpdateCommentAction } from "@/app/actions/workspace/updates";
import { updateMySettingsAction } from "@/app/actions/workspace/member-journey";
import type { NeedsYouItem, NotificationAct } from "@/lib/notifications/needs-you";
import { useNotificationPreferences } from "@/hooks/useSettingsQueries";
import { DEFAULT_ORG_NOTIFICATION_CHOICE, getNotificationPauseUntil, getQuietHoursResumeAt, isNotificationPauseActive, isQuietHoursActive, orgChoiceFor } from "@/lib/notifications/preferences";
import type {
    NotificationFeedPage,
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";
import { queryKeys } from "@/lib/query-keys";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { useAuth } from "@/hooks/use-auth";

const DEFAULT_LIMIT = 20;
// Mirrors the server-side upper bound in markNotificationsSeen. Keeping the
// client batches within it prevents a large review session from being marked
// optimistically while only its first 50 rows are persisted.
const QUALIFIED_VIEW_BATCH_SIZE = 50;
const TOAST_BATCH_MS = 1_200;
const NOTIFICATION_RESYNC_MS = 300;
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;
const IDLE_FLUSH_DEBOUNCE_MS = 400;

/** `needs` is the Needs you count: the bell's number (notifications mix). */
type UnreadCounts = { total: number; important: number; needs?: number };

const ZERO_COUNTS: UnreadCounts = { total: 0, important: 0, needs: 0 };
const NEEDS_KEY = ["notifications", "needs-you"] as const;
const SNOOZED_KEY = ["notifications", "snoozed"] as const;
const LAST_OPEN_KEY = "nb:notif:lastOpen";

function deriveUnreadCounts(data: InfiniteData<NotificationFeedPage> | undefined): UnreadCounts {
    if (!data) return ZERO_COUNTS;
    const head = data.pages[0];
    if (head && (head.unreadCount > 0 || head.unreadImportantCount > 0)) {
        return { total: head.unreadCount, important: head.unreadImportantCount };
    }
    const unread = data.pages.flatMap((page) => page.items).filter((item) => !item.seenAt && !item.dismissedAt);
    return {
        total: unread.length,
        important: unread.filter((item) => item.importance === "important").length,
    };
}

export function useNotifications(limit: number = DEFAULT_LIMIT) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const pathname = usePathname();
    const { user, isAuthenticated } = useAuth();
    const { isConnected, notificationStatus, subscribeUserNotifications } = useRealtime();
    const [isTrayOpen, setIsTrayOpen] = useState(false);
    const [activeFilter, setActiveFilter] = useState<NotificationTrayFilter>("unread");
    const [isIdle, setIsIdle] = useState(false);
    const isTrayOpenRef = useRef(false);
    const viewedNotificationIdsRef = useRef(new Set<string>());
    const toastQueueRef = useRef<NeedsYouItem[]>([]);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queueImportantToastRef = useRef<(item: NeedsYouItem) => void>(() => { });
    const isIdleRef = useRef(false);
    const browserDeliveryEnabledRef = useRef<boolean>(false);
    const preferencesQuery = useNotificationPreferences({
        // Browser delivery is evaluated when a realtime row arrives. Fetching
        // it only while the tray is open made the preference ineffective for
        // the normal (closed-bell) state.
        enabled: Boolean(isAuthenticated && user?.id),
    });
    useEffect(() => {
        isTrayOpenRef.current = isTrayOpen;
    }, [isTrayOpen]);

    useEffect(() => {
        browserDeliveryEnabledRef.current = Boolean(preferencesQuery.data?.delivery?.browser);
    }, [preferencesQuery.data]);

    // Unread is a server query (notifications mix), so each tab keeps its own pages.
    const notificationsQueryKey = useMemo(() => [...queryKeys.notifications.page(limit), activeFilter] as const, [limit, activeFilter]);
    const unreadCountQueryKey = useMemo(() => queryKeys.notifications.unreadCount(), []);
    const getCurrentSearch = useCallback(() => {
        return typeof window === "undefined" ? "" : window.location.search;
    }, []);

    const adjustUnreadCounts = useCallback((delta: { total: number; important: number }) => {
        queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, (current = ZERO_COUNTS) => ({
            total: Math.max(0, current.total + delta.total),
            important: Math.max(0, current.important + delta.important),
        }));
    }, [queryClient, unreadCountQueryKey]);

    const patchNotificationCache = useCallback((
        updater: (existing: InfiniteData<NotificationFeedPage> | undefined) =>
            InfiniteData<NotificationFeedPage> | undefined,
    ) => {
        // Both tabs' pages (Unread and All are cached apart): a row done, snoozed or seen in one is patched in the other.
        queryClient.setQueriesData<InfiniteData<NotificationFeedPage>>({ queryKey: queryKeys.notifications.page(limit) }, (existing) => {
            // The loaded feed can be only one page, while the bell counter is a
            // global value. Mutations adjust that counter explicitly; deriving
            // from this partial cache would both under-count and double-apply.
            return updater(existing);
        });
    }, [limit, queryClient]);

    const unreadCountQuery = useQuery<UnreadCounts>({
        queryKey: unreadCountQueryKey,
        enabled: Boolean(isAuthenticated && user?.id),
        queryFn: async () => {
            const result = await readShellPart("notificationUnreadCount");
            if (!result.success) {
                throw new Error(result.error || "Couldn’t load notification count");
            }
            return { total: result.unreadCount, important: result.unreadImportantCount, needs: result.needsYouCount ?? 0 };
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
    });

    const query = useInfiniteQuery({
        queryKey: notificationsQueryKey,
        enabled: Boolean(isAuthenticated && user?.id && isTrayOpen),
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const result = await readNotificationsAction(limit, pageParam, { unreadOnly: activeFilter === "unread" });
            if (!result.success || !result.page) {
                throw new Error(result.error || "Couldn’t fetch notifications");
            }
            queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, (current = ZERO_COUNTS) => ({
                ...current,
                total: result.page!.unreadCount,
                important: result.page!.unreadImportantCount,
            }));
            return result.page satisfies NotificationFeedPage;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
    });

    const openItem = useCallback(async (
        item: NotificationItem,
        source: "notification_bell" | "notification_toast" = "notification_bell",
    ) => {
        const href = buildNotificationHref(item);
        if (!item.readAt) {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const previousUnreadCounts = queryClient.getQueryData<UnreadCounts>(unreadCountQueryKey);
            const readAt = new Date().toISOString();
            patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, {
                ...item,
                readAt,
                seenAt: item.seenAt ?? readAt,
            }));
            if (!item.seenAt) {
                adjustUnreadCounts({ total: -1, important: item.importance === "important" ? -1 : 0 });
            }
            try {
                const result = await markNotificationReadAction(item.id);
                if (!result.success || !result.item) {
                    throw new Error(result.error || "Couldn’t mark notification read");
                }
                patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, result.item!));
            } catch (error) {
                if (previous) {
                    queryClient.setQueryData(notificationsQueryKey, previous);
                }
                if (previousUnreadCounts) {
                    queryClient.setQueryData(unreadCountQueryKey, previousUnreadCounts);
                } else {
                    void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
                }
                toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t mark notification read", "Couldn’t mark notification read"));
            }
        }
        if (!href) return false;
        router.push(href);
        viewedNotificationIdsRef.current.clear();
        isTrayOpenRef.current = false;
        setIsTrayOpen(false);
        return true;
    }, [
        adjustUnreadCounts,
        notificationsQueryKey,
        patchNotificationCache,
        queryClient,
        router,
        unreadCountQueryKey,
    ]);

    // Toasts are for Needs you arrivals only (notifications mix), each with its row's main answer.
    const actRef = useRef<(item: NeedsYouItem, act: NotificationAct & { questionKey?: string }) => Promise<boolean>>(async () => false);
    const flushToastQueue = useCallback(() => {
        const queued = toastQueueRef.current;
        toastQueueRef.current = [];
        toastTimerRef.current = null;
        if (queued.length === 0) return;
        const openTrayNow = () => { isTrayOpenRef.current = true; setActiveFilter("unread"); setIsTrayOpen(true); };
        if (queued.length > 3) {
            toast.info(`${queued.length} things need you`, { action: { label: "Open notifications", onClick: openTrayNow }, duration: 0 });
            return;
        }
        for (const item of queued) {
            const title = `${item.sentence.actor}${item.sentence.verb}${item.sentence.object}`.trim();
            const primary = item.primary;
            toast.info(title, {
                description: item.context ?? undefined,
                action: primary && primary.act !== "open"
                    ? { label: primary.label, onClick: () => void actRef.current(item, primary) }
                    : { label: primary?.label ?? "Open", onClick: () => { router.push(item.href); } },
                duration: 0,
            });
        }
    }, [router]);

    const queueImportantToast = useCallback((item: NeedsYouItem) => {
        const prefs = preferencesQuery.data;
        const held = prefs ? isNotificationPauseActive(prefs) || isQuietHoursActive(prefs) : false;
        const visible = typeof document === "undefined" ? true : document.visibilityState === "visible";
        // Pause and quiet hours hold toasts too; safety notices still come through the tray.
        if (isTrayOpenRef.current || !visible || held) return;
        toastQueueRef.current.push(item);
        // Idle users get a single flush on return, not a cascade of toasts mid-AFK.
        if (isIdleRef.current) return;
        if (toastTimerRef.current) return;
        toastTimerRef.current = setTimeout(flushToastQueue, TOAST_BATCH_MS);
    }, [flushToastQueue, preferencesQuery.data]);

    useEffect(() => {
        queueImportantToastRef.current = queueImportantToast;
    }, [queueImportantToast]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let flushTimer: ReturnType<typeof setTimeout> | null = null;

        const resumeFromIdle = () => {
            if (!isIdleRef.current) return;
            isIdleRef.current = false;
            setIsIdle(false);
            // Debounce so toggling tabs or jiggling the mouse doesn't fire
            // a half-built toast batch.
            if (flushTimer) clearTimeout(flushTimer);
            flushTimer = setTimeout(() => {
                if (toastQueueRef.current.length > 0) {
                    flushToastQueue();
                }
                flushTimer = null;
            }, IDLE_FLUSH_DEBOUNCE_MS);
        };

        const resetIdleTimer = () => {
            if (idleTimer) clearTimeout(idleTimer);
            resumeFromIdle();
            idleTimer = setTimeout(() => {
                isIdleRef.current = true;
                setIsIdle(true);
            }, IDLE_THRESHOLD_MS);
        };

        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                resetIdleTimer();
            }
        };

        const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "focus"] as const;
        for (const name of events) {
            window.addEventListener(name, resetIdleTimer, { passive: true });
        }
        document.addEventListener("visibilitychange", handleVisibility);
        resetIdleTimer();

        return () => {
            if (idleTimer) clearTimeout(idleTimer);
            if (flushTimer) clearTimeout(flushTimer);
            for (const name of events) {
                window.removeEventListener(name, resetIdleTimer);
            }
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [flushToastQueue]);

    useEffect(() => {
        if (!isConnected) return;
        void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
        if (isTrayOpenRef.current) {
            void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
        }
    }, [isConnected, notificationsQueryKey, queryClient, unreadCountQueryKey]);

    // Authentication hydration and a cold Realtime tenant are normal startup
    // states. Only a terminal channel status should be presented as a failure.
    const isRealtimeHealthy = notificationStatus !== 'disconnected';

    // Events say only that a row changed. Re-read the feed once per burst: it applies the snooze and
    // block rules, and its first page brings the new items and the exact unread counts together.
    useEffect(() => {
        if (!user?.id || !isAuthenticated) return;
        const freshIds = new Set<string>();
        let timer: ReturnType<typeof setTimeout> | null = null;
        const resync = async () => {
            timer = null;
            const fresh = new Set(freshIds);
            freshIds.clear();
            if (fresh.size === 0) {
                void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
                void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
                return;
            }
            const result = await readNotificationsAction(20);
            if (!result.success || !result.page) return;
            const { items, unreadCount, unreadImportantCount } = result.page;
            queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, (current = ZERO_COUNTS) => ({ ...current, total: unreadCount, important: unreadImportantCount }));
            void queryClient.invalidateQueries({ queryKey: NEEDS_KEY });
            for (const item of items) {
                if (!fresh.has(item.id)) continue;
                patchNotificationCache((existing) => upsertNotificationInInfiniteData(existing, item));
                if (item.seenAt) continue;
                if (browserDeliveryEnabledRef.current) {
                    showBrowserNotification({
                        item,
                        enabled: true,
                        tabVisible: typeof document === "undefined" ? true : document.visibilityState === "visible",
                        onClickHref: (href) => {
                            void markNotificationReadAction(item.id).finally(() => {
                                try {
                                    router.push(href);
                                } catch {
                                    // router not ready — skip
                                }
                            });
                        },
                    });
                }
            }
            if (isTrayOpenRef.current) {
                // Re-fetch once so the feed can resolve the actor profile rather
                // than relying on an incomplete realtime preview snapshot.
                void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
            }
        };
        const unsubscribe = subscribeUserNotifications((event) => {
            if (event.kind !== "notification") return;
            const { eventType, new: next, old: previous } = event.payload;
            if (eventType === "DELETE" && typeof previous?.id === "string") {
                const removedId = previous.id;
                patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, removedId));
            }
            const hasNewActivity = eventType === "INSERT" || (eventType === "UPDATE" && next?.activity_at !== previous?.activity_at);
            if (hasNewActivity && typeof next?.id === "string") freshIds.add(next.id);
            timer ??= setTimeout(() => void resync(), NOTIFICATION_RESYNC_MS);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [
        isAuthenticated,
        adjustUnreadCounts,
        notificationsQueryKey,
        patchNotificationCache,
        router,
        subscribeUserNotifications,
        user?.id,
    ]);



    useEffect(() => {
        return () => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    const markVisibleSeenMutation = useMutation({
        mutationFn: async (notificationIds: string[]) => {
            const result = await markNotificationsSeenAction(notificationIds);
            if (!result.success) {
                throw new Error(result.error || "Couldn’t mark notifications seen");
            }
            return result;
        },
        onMutate: async (notificationIds) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const current = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const seenAt = new Date().toISOString();
            const targets = current?.pages
                .flatMap((page) => page.items)
                .filter((item) => notificationIds.includes(item.id) && !item.seenAt) ?? [];
            if (targets.length > 0) {
                patchNotificationCache((existing) => markNotificationsSeenInInfiniteData(existing, targets.map((item) => item.id), seenAt));
                adjustUnreadCounts({
                    total: -targets.length,
                    important: -targets.filter((item) => item.importance === "important").length,
                });
            }
            return { targetIds: targets.map((item) => item.id) };
        },
        onError: (error) => {
            // Do not restore an old snapshot: another visible batch may have
            // succeeded meanwhile. The authoritative refetch repairs the cache.
            void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t update notification state", "Couldn’t update notification state"));
        },
        onSuccess: (result) => {
            for (const item of result.items) {
                patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, item));
            }
        },
    });

    const markUnreadMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const result = await markNotificationUnreadAction(notificationId);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Couldn’t mark notification unread");
            }
            return result.item;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => {
                if (!target) return existing;
                return patchNotificationReadStateInInfiniteData(existing, {
                    ...target,
                    readAt: null,
                    seenAt: null,
                });
            });
            if (target?.seenAt) {
                adjustUnreadCounts({ total: 1, important: target.importance === "important" ? 1 : 0 });
            }
            return { previous, target };
        },
        onError: (error, _notificationId, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t mark notification unread", "Couldn’t mark notification unread"));
        },
        onSuccess: (item) => {
            patchNotificationCache((existing) => patchNotificationReadStateInInfiniteData(existing, item));
        },
    });

    const dismissMutation = useMutation({
        mutationFn: async (notificationId: string) => {
            const result = await dismissNotificationAction(notificationId);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Couldn’t dismiss notification");
            }
            return result.item;
        },
        onMutate: async (notificationId) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, notificationId));
            if (target && !target.seenAt) {
                adjustUnreadCounts({ total: -1, important: target.importance === "important" ? -1 : 0 });
            }
            return { previous };
        },
        onError: (error, _notificationId, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t dismiss notification", "Couldn’t dismiss notification"));
        },
    });

    const dismissAllMutation = useMutation({
        mutationFn: async () => {
            const result = await dismissAllNotificationsAction();
            if (!result.success) throw new Error(result.error || "Couldn’t clear notifications");
            return result;
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            queryClient.setQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey, (existing) => {
                if (!existing) return existing;
                return {
                    ...existing,
                    pages: existing.pages.map((page) => ({
                        ...page,
                        items: [],
                        unreadCount: 0,
                        unreadImportantCount: 0,
                    })),
                };
            });
            queryClient.setQueryData(unreadCountQueryKey, { total: 0, important: 0 });
            return { previous };
        },
        onError: (error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t clear notifications", "Couldn’t clear notifications"));
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.success("All notifications cleared");
        },
    });

    const muteMutation = useMutation({
        mutationFn: async (scope: NotificationMuteScope) => {
            const result = await muteNotificationScopeAction(scope);
            if (!result.success) throw new Error(result.error || "Couldn’t turn off notifications");
            return result.preferences;
        },
        onError: (error) => {
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t turn off notifications", "Couldn’t turn off notifications"));
        },
    });

    const snoozeMutation = useMutation({
        mutationFn: async ({ notificationId, snoozedUntil }: { notificationId: string; snoozedUntil: string }) => {
            const result = await snoozeNotificationAction(notificationId, snoozedUntil);
            if (!result.success || !result.item) {
                throw new Error(result.error || "Couldn’t snooze notification");
            }
            return result.item;
        },
        onMutate: async ({ notificationId }) => {
            await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
            const previous = queryClient.getQueryData<InfiniteData<NotificationFeedPage>>(notificationsQueryKey);
            const target = previous?.pages.flatMap((page) => page.items).find((item) => item.id === notificationId);
            patchNotificationCache((existing) => removeNotificationFromInfiniteData(existing, notificationId));
            if (target && !target.seenAt) {
                adjustUnreadCounts({ total: -1, important: target.importance === "important" ? -1 : 0 });
            }
            return { previous };
        },
        onError: (error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(notificationsQueryKey, context.previous);
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t snooze notification", "Couldn’t snooze notification"));
        },
        onSuccess: (_item, { snoozedUntil }) => {
            toast.success(`Snoozed until ${formatLongDate(snoozedUntil)}`);
        },
    });

    const items = useMemo(
        () => query.data?.pages.flatMap((page) => page.items).filter((item) => !item.dismissedAt) ?? [],
        [query.data?.pages],
    );
    const unreadCounts = unreadCountQuery.data ?? deriveUnreadCounts(query.data);
    const unreadCount = unreadCounts.total;
    const unreadImportantCount = unreadCounts.important;
    const loadMore = useCallback(() => query.fetchNextPage(), [query]);
    const refresh = useCallback(() => query.refetch(), [query]);
    const commitViewedNotifications = useCallback((notificationIds: string[]) => {
        const ids = Array.from(new Set(notificationIds.filter(Boolean)));
        if (ids.length === 0) return;
        void (async () => {
            for (let index = 0; index < ids.length; index += QUALIFIED_VIEW_BATCH_SIZE) {
                try {
                    await markVisibleSeenMutation.mutateAsync(ids.slice(index, index + QUALIFIED_VIEW_BATCH_SIZE));
                } catch {
                    // The mutation already restores/revalidates and shows the
                    // actionable failure. Continue so one failed batch cannot
                    // strand later, independently reviewed notifications.
                }
            }
        })();
    }, [markVisibleSeenMutation]);
    const stageViewedNotifications = useCallback((notificationIds: string[]) => {
        if (!isTrayOpenRef.current) return;
        for (const notificationId of notificationIds) {
            const important = queryClient.getQueriesData<InfiniteData<NotificationFeedPage>>({ queryKey: queryKeys.notifications.page(limit) })
                .some(([, data]) => data?.pages.some((page) => page.items.some((item) => item.id === notificationId && item.importance === "important")));
            if (notificationId && !important) viewedNotificationIdsRef.current.add(notificationId);
        }
    }, [limit, queryClient]);
    useEffect(() => {
        if (!isTrayOpen) return;
        for (const item of items) {
            // Important notices stay in Needs you until opened or done, so looking at the tray doesn't count.
            if (!item.seenAt && item.importance !== "important") {
                viewedNotificationIdsRef.current.add(item.id);
            }
        }
    }, [isTrayOpen, items]);

    const setTrayOpen = useCallback((open: boolean) => {
        if (open) {
            viewedNotificationIdsRef.current.clear();
            for (const item of items) {
                if (!item.seenAt && item.importance !== "important") viewedNotificationIdsRef.current.add(item.id);
            }
            isTrayOpenRef.current = true;
            setIsTrayOpen(true);
            return;
        }
        const viewedIds = Array.from(viewedNotificationIdsRef.current);
        viewedNotificationIdsRef.current.clear();
        isTrayOpenRef.current = false;
        setIsTrayOpen(false);
        commitViewedNotifications(viewedIds);
    }, [commitViewedNotifications, items]);
    const openTray = useCallback(() => setTrayOpen(true), [setTrayOpen]);
    const closeTray = useCallback(() => setTrayOpen(false), [setTrayOpen]);
    const markUnread = useCallback((notificationId: string) => markUnreadMutation.mutateAsync(notificationId), [markUnreadMutation]);
    const dismiss = useCallback((notificationId: string) => dismissMutation.mutateAsync(notificationId), [dismissMutation]);
    const dismissAll = useCallback(() => dismissAllMutation.mutateAsync(), [dismissAllMutation]);
    const muteScope = useCallback((scope: NotificationMuteScope) => muteMutation.mutateAsync(scope), [muteMutation]);
    const muteItemType = useCallback((item: NotificationItem) => muteMutation.mutateAsync(getNarrowestNotificationMuteScope(item)), [muteMutation]);
    const snooze = useCallback((notificationId: string, snoozedUntil: string) =>
        snoozeMutation.mutateAsync({ notificationId, snoozedUntil }), [snoozeMutation]);

    // ---- Notifications mix: Needs you, answers in the row, Done with Undo, the noise coach, levels, snoozed ----
    const needsQuery = useQuery({
        queryKey: NEEDS_KEY,
        enabled: Boolean(isAuthenticated && user?.id),
        queryFn: async () => {
            const result = await readNeedsYouAction();
            if (!result.success) throw new Error(result.error || "Couldn’t load what needs you");
            return result.items as NeedsYouItem[];
        },
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    });
    const needs = useMemo(() => needsQuery.data ?? [], [needsQuery.data]);
    const seenNeedKeysRef = useRef<Set<string> | null>(null);
    useEffect(() => {
        if (!needsQuery.data) return;
        const keys = new Set(needsQuery.data.map((item) => item.key));
        const before = seenNeedKeysRef.current;
        seenNeedKeysRef.current = keys;
        queryClient.setQueryData<UnreadCounts>(unreadCountQueryKey, (current = ZERO_COUNTS) => ({ ...current, needs: keys.size }));
        if (!before) return; // the first read is what was already waiting, not an arrival
        for (const item of needsQuery.data) if (!before.has(item.key)) queueImportantToastRef.current(item);
    }, [needsQuery.data, queryClient, unreadCountQueryKey]);

    const act = useCallback(async (item: NeedsYouItem, choice: NotificationAct & { questionKey?: string }) => {
        const result = await actOnNotificationAction({ key: item.key, notificationId: item.notificationId ?? undefined }, { act: choice.act, value: choice.value, questionKey: choice.questionKey });
        if (!result.success) {
            toast.error(result.error || "Couldn’t do that just now");
            return false;
        }
        window.setTimeout(() => {
            void queryClient.invalidateQueries({ queryKey: NEEDS_KEY });
            void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
        }, 1_400);
        return true;
    }, [queryClient, unreadCountQueryKey]);
    useEffect(() => { actRef.current = act; }, [act]);

    const doneKindsRef = useRef(new Map<string, number>());
    const [coachKind, setCoachKind] = useState<string | null>(null);
    const done = useCallback(async (item: NotificationItem) => {
        try {
            await dismissMutation.mutateAsync(item.id);
        } catch {
            return;
        }
        void queryClient.invalidateQueries({ queryKey: NEEDS_KEY });
        toast.success("Marked done.", {
            action: { label: "Undo", onClick: () => void restoreNotificationAction(item.id).then(() => {
                void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
                void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
            }) },
            duration: 5_000,
        });
        // Noise coach: the third Done of one kind in a sitting offers to turn that kind off (never safety notices).
        if (item.kind === "trust_safety") return;
        const n = (doneKindsRef.current.get(item.kind) ?? 0) + 1;
        doneKindsRef.current.set(item.kind, n);
        if (n === 3) setCoachKind(item.kind);
    }, [dismissMutation, notificationsQueryKey, queryClient, unreadCountQueryKey]);
    const coachTurnOff = useCallback(async () => {
        if (!coachKind) return;
        await muteMutation.mutateAsync({ kind: "notification_type", value: coachKind });
        setCoachKind(null);
        doneKindsRef.current.set(coachKind, -1_000);
        toast.success("Turned off. You can turn it back on in Settings › Notifications.");
    }, [coachKind, muteMutation]);
    const coachKeep = useCallback(() => {
        if (coachKind) doneKindsRef.current.set(coachKind, -1_000);
        setCoachKind(null);
    }, [coachKind]);

    const markAllRead = useCallback(async () => {
        const result = await markAllNotificationsReadAction();
        if (!result.success) { toast.error(result.error || "Couldn’t mark them read"); return; }
        await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() });
    }, [queryClient]);
    const dismissRead = useCallback(async () => {
        const result = await dismissReadNotificationsAction();
        if (!result.success) { toast.error(result.error || "Couldn’t mark them done"); return 0; }
        await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() });
        toast.success(result.count === 1 ? "1 read notification marked done." : `${result.count} read notifications marked done.`);
        return result.count;
    }, [queryClient]);

    const reply = useCallback(async (item: NotificationItem, text: string) => {
        const refs = item.entityRefs ?? {};
        if (!refs.projectId) return false;
        const parent = refs.parentCommentId ?? refs.commentId ?? null;
        const result = refs.updateId
            ? await createWorkspaceUpdateCommentAction(refs.projectId, refs.updateId, text, parent)
            : refs.taskId ? await createTaskCommentAction(refs.taskId, refs.projectId, text, parent) : null;
        if (!result || !result.success) {
            toast.error((result && "error" in result && result.error) || "Couldn’t send the reply");
            return false;
        }
        return true;
    }, []);

    const muteWorkspace = useCallback(async (item: NotificationItem, until: string | "forever") => {
        const projectId = item.entityRefs?.projectId;
        if (!projectId) return;
        const result = await updateMySettingsAction(projectId, { muteUntil: until });
        if (!result.success) { toast.error(("error" in result && result.error) || "Couldn’t mute it"); return; }
        const where = item.preview?.contextLabel ?? "This workspace";
        toast.success(until === "forever" ? `${where} is muted until you turn it back on.` : `${where} is muted until ${formatLongDate(until)}.`, {
            action: { label: "Undo", onClick: () => void updateMySettingsAction(projectId, { muteUntil: null }) },
        });
    }, []);
    const setOrgLevel = useCallback(async (item: NotificationItem, level: "all" | "important" | "off") => {
        const orgId = item.entityRefs?.orgId;
        const prefs = preferencesQuery.data;
        if (!orgId || !prefs) return;
        const next = { ...prefs, organizations: { ...prefs.organizations, [orgId]: { ...(orgChoiceFor(prefs, orgId) ?? DEFAULT_ORG_NOTIFICATION_CHOICE), level } } };
        const result = await updateNotificationPreferencesAction(next, ["organizations"]);
        if (!result.success) { toast.error(result.error || "Couldn’t change it"); return; }
        void preferencesQuery.refetch();
        toast.success(level === "all" ? "You’ll get everything from it." : level === "important" ? "Only important notifications from it now." : "Off, except safety notices.");
    }, [preferencesQuery]);

    const snoozedQuery = useQuery({
        queryKey: SNOOZED_KEY,
        enabled: Boolean(isAuthenticated && user?.id && isTrayOpen),
        queryFn: async () => {
            const result = await readSnoozedNotificationsAction();
            if (!result.success) throw new Error(result.error || "Couldn’t load snoozed notifications");
            return result.items as NotificationItem[];
        },
        staleTime: 60_000,
    });

    const handInIds = useMemo(() => Array.from(new Set(items
        .filter((item) => item.kind === "org_assignment" && item.aggregateCount > 1 && item.entityRefs?.taskId)
        .map((item) => item.entityRefs!.taskId!))).sort(), [items]);
    const handInQuery = useQuery({
        queryKey: ["notifications", "hand-in", handInIds.join(",")],
        enabled: isTrayOpen && handInIds.length > 0,
        queryFn: async () => (await readHandInProgressAction(handInIds)).progress as Record<string, { handedIn: number; total: number }>,
        staleTime: 60_000,
    });

    // The away summary compares with when the tray was last open (this browser only).
    const [lastOpenedAt, setLastOpenedAt] = useState<string | null>(null);
    useEffect(() => {
        if (!isTrayOpen) return;
        try {
            setLastOpenedAt(window.localStorage.getItem(LAST_OPEN_KEY));
            window.localStorage.setItem(LAST_OPEN_KEY, new Date().toISOString());
        } catch {
            setLastOpenedAt(null);
        }
    }, [isTrayOpen]);

    const quiet = useMemo(() => {
        const prefs = preferencesQuery.data;
        if (!prefs) return null;
        const until = isNotificationPauseActive(prefs) ? getNotificationPauseUntil(prefs) : isQuietHoursActive(prefs) ? getQuietHoursResumeAt(prefs) : null;
        return until ? { kind: isNotificationPauseActive(prefs) ? "paused" as const : "quiet" as const, until: until.toISOString() } : null;
    }, [preferencesQuery.data]);
    const resume = useCallback(async () => {
        const prefs = preferencesQuery.data;
        if (!prefs) return;
        // Resume lifts a pause; quiet hours are a schedule, changed in Settings (never switched off from here).
        const result = await updateNotificationPreferencesAction({ ...prefs, pausedUntil: null }, ["pausedUntil"]);
        if (!result.success) toast.error(result.error || "Couldn’t resume");
        else void preferencesQuery.refetch();
    }, [preferencesQuery]);

    const needsYouCount = unreadCountQuery.data?.needs ?? needs.length;

    return useMemo(() => ({
        needs,
        needsYouCount,
        needsLoading: needsQuery.isLoading,
        act,
        done,
        coachKind,
        coachTurnOff,
        coachKeep,
        markAllRead,
        dismissRead,
        reply,
        muteWorkspace,
        setOrgLevel,
        snoozed: snoozedQuery.data ?? [],
        handIn: handInQuery.data ?? {},
        lastOpenedAt,
        quiet,
        resume,
        isError: query.isError,
        items,
        unreadCount,
        unreadImportantCount,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        isRealtimeHealthy,
        isIdle,
        hasMore: Boolean(query.hasNextPage),
        isLoadingMore: query.isFetchingNextPage,
        activeFilter,
        setActiveFilter,
        isTrayOpen,
        openTray,
        closeTray,
        setTrayOpen,
        loadMore,
        refresh,
        stageViewedNotifications,
        markUnread,
        dismiss,
        dismissAll,
        muteScope,
        muteItemType,
        snooze,
        openItem,
    }), [
        items,
        unreadCount,
        unreadImportantCount,
        query.isLoading,
        query.isFetching,
        isRealtimeHealthy,
        isIdle,
        query.hasNextPage,
        query.isFetchingNextPage,
        activeFilter,
        isTrayOpen,
        openTray,
        closeTray,
        setTrayOpen,
        loadMore,
        refresh,
        stageViewedNotifications,
        markUnread,
        dismiss,
        dismissAll,
        muteScope,
        muteItemType,
        snooze,
        openItem,
        needs,
        needsYouCount,
        needsQuery.isLoading,
        act,
        done,
        coachKind,
        coachTurnOff,
        coachKeep,
        markAllRead,
        dismissRead,
        reply,
        muteWorkspace,
        setOrgLevel,
        snoozedQuery.data,
        handInQuery.data,
        lastOpenedAt,
        quiet,
        resume,
        query.isError,
    ]);
}
