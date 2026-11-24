"use client";

import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Bell } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { NotificationBundleRow } from "@/components/notifications/NotificationBundleRow";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import {
    bundleNotifications,
    filterNotifications,
    groupNotificationsByTime,
} from "@/lib/notifications/presentation";
import type {
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";

const GROUP_LABELS = {
    new: "Unread",
    today: "Today",
    earlier: "Earlier",
} as const;

export function NotificationList(props: {
    items: NotificationItem[];
    filter: NotificationTrayFilter;
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onViewed: (notificationIds: string[]) => void;
    onMarkUnread: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
    emptyState?: ReactNode;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void | Promise<unknown>;
}) {
    const {
        items,
        filter,
        onOpen,
        onViewed,
        onMarkUnread,
        onDismiss,
        onMuteScope,
        onSnooze,
        emptyState,
        hasMore,
        isLoadingMore,
        onLoadMore,
    } = props;
    const filteredItems = useMemo(() => filterNotifications(items, filter), [items, filter]);
    const importantItems = useMemo(() => filteredItems.filter((item) => item.importance === "important"), [filteredItems]);
    const regularItems = useMemo(() => filteredItems.filter((item) => item.importance !== "important"), [filteredItems]);
    const grouped = useMemo(() => groupNotificationsByTime(regularItems), [regularItems]);

    const importantBundles = useMemo(() => bundleNotifications(importantItems), [importantItems]);
    const groupBundles = useMemo(() => {
        return {
            new: bundleNotifications(grouped.new),
            today: bundleNotifications(grouped.today),
            earlier: bundleNotifications(grouped.earlier),
        };
    }, [grouped]);

    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const first = containerRef.current?.querySelector<HTMLElement>("[data-notification-row]");
        if (first && containerRef.current && !containerRef.current.contains(document.activeElement)) {
            first.setAttribute("tabindex", "0");
        }
    }, [filteredItems.length]);

    const focusRow = (direction: 1 | -1) => {
        const root = containerRef.current;
        if (!root) return;
        const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-notification-row]"));
        if (rows.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const currentIndex = rows.findIndex((row) => row === active || row.contains(active));
        const nextIndex = currentIndex === -1
            ? (direction === 1 ? 0 : rows.length - 1)
            : Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
        const target = rows[nextIndex];
        if (!target) return;
        rows.forEach((row) => row.setAttribute("tabindex", "-1"));
        target.setAttribute("tabindex", "0");
        target.focus({ preventScroll: false });
    };

    const resolveFocusedItem = (): NotificationItem | null => {
        const active = document.activeElement as HTMLElement | null;
        const row = active?.closest<HTMLElement>("[data-notification-row]");
        const id = row?.dataset.notificationId;
        if (!id) return null;
        return filteredItems.find((item) => item.id === id) ?? null;
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        switch (event.key) {
            case "j":
            case "ArrowDown":
                event.preventDefault();
                focusRow(1);
                return;
            case "k":
            case "ArrowUp":
                event.preventDefault();
                focusRow(-1);
                return;
            case "Enter": {
                const item = resolveFocusedItem();
                if (!item) return;
                event.preventDefault();
                void onOpen(item);
                return;
            }
            case "e": {
                const item = resolveFocusedItem();
                if (!item) return;
                event.preventDefault();
                void onDismiss(item);
                return;
            }
            case "r": {
                const item = resolveFocusedItem();
                if (!item || !item.seenAt) return;
                event.preventDefault();
                void onMarkUnread(item);
                return;
            }
            default:
                return;
        }
    };

    if (filteredItems.length === 0) {
        return (
            <div className="p-4">
                <EmptyState
                    icon={Bell}
                    title="No notifications"
                    description={emptyState ?? "You’re all caught up."}
                    compact
                    className="rounded-xl"
                />
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            onKeyDown={handleKeyDown}
            role="region"
            aria-label="Notifications list. Press J or down arrow to move down, K or up arrow to move up, Enter to open, E to dismiss, R to mark as unread."
            className="pb-3"
        >
            {importantItems.length > 0 ? (
                <section aria-label="Notifications needing attention">
                    <div className="nb-micro sticky top-0 z-10 border-b border-border bg-card dark:bg-[#141A1E] px-4 py-2 text-destructive shadow-2xs">
                        Needs attention
                    </div>
                    <div role="list" className="divide-y divide-border">
                        {importantBundles.map((bundle) => (
                            <div role="listitem" key={bundle.key + ":" + bundle.lead.id}>
                                {bundle.items.length > 1 ? (
                                    <NotificationBundleRow
                                        bundle={bundle}
                                        onOpen={onOpen}
                                        onViewed={onViewed}
                                        onMarkUnread={onMarkUnread}
                                        onDismiss={onDismiss}
                                        onMuteScope={onMuteScope}
                                        onSnooze={onSnooze}
                                    />
                                ) : (
                                    <NotificationRow
                                        item={bundle.lead}
                                        onOpen={onOpen}
                                        onViewed={onViewed}
                                        onMarkUnread={onMarkUnread}
                                        onDismiss={onDismiss}
                                        onMuteScope={onMuteScope}
                                        onSnooze={onSnooze}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
            {(["new", "today", "earlier"] as const).map((group) => {
                const groupItems = grouped[group];
                if (groupItems.length === 0) return null;
                return (
                    <section key={group} aria-label={`${GROUP_LABELS[group]} notifications`}>
                        <div className="nb-micro sticky top-0 z-10 border-b border-border bg-card dark:bg-[#141A1E] px-4 py-2 text-muted-foreground shadow-2xs">
                            {GROUP_LABELS[group]}
                        </div>
                        <div role="list" className="divide-y divide-border">
                            {groupBundles[group].map((bundle) => (
                                <div role="listitem" key={bundle.key + ":" + bundle.lead.id}>
                                    {bundle.items.length > 1 ? (
                                        <NotificationBundleRow
                                            bundle={bundle}
                                            onOpen={onOpen}
                                            onViewed={onViewed}
                                            onMarkUnread={onMarkUnread}
                                            onDismiss={onDismiss}
                                            onMuteScope={onMuteScope}
                                            onSnooze={onSnooze}
                                        />
                                    ) : (
                                        <NotificationRow
                                            item={bundle.lead}
                                            onOpen={onOpen}
                                            onViewed={onViewed}
                                            onMarkUnread={onMarkUnread}
                                            onDismiss={onDismiss}
                                            onMuteScope={onMuteScope}
                                            onSnooze={onSnooze}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                );
            })}
            {hasMore ? (
                <div className="border-t border-border px-4 py-3">
                    <Button pending={isLoadingMore} pendingLabel="Loading"
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={isLoadingMore || !onLoadMore}
                        onClick={() => onLoadMore?.()}
                    >
                        {"Load earlier"}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
