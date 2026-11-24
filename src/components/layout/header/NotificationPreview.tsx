"use client";
import { TabMarker } from "@/components/ui/TabMarker";

import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";
import { Bell, Settings } from "lucide-react";
import { useChanged } from "@/hooks/useChanged";

import { NotificationList } from "@/components/notifications/NotificationList";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { settingsTabHref } from "@/constants/routes";
import type {
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { MyReviewsList } from "@/components/notifications/MyReviewsList";
import type { RealtimeHealthState } from "@/components/providers/RealtimeProvider";

const FILTERS: Array<{ id: NotificationTrayFilter; label: string }> = [
    { id: "unread", label: "Unread" },
    { id: "all", label: "All" },
    { id: "reviews", label: "My reviews" },
];

type NotificationPreviewProps = {
    unreadCount: number;
    unreadImportantCount: number;
    items: NotificationItem[];
    activeFilter: NotificationTrayFilter;
    isOpen: boolean;
    isLoading: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    connectionHealth: RealtimeHealthState;
    onOpenChange: (open: boolean) => void;
    onFilterChange: (filter: NotificationTrayFilter) => void;
    onOpenItem: (item: NotificationItem) => Promise<unknown>;
    onItemsViewed: (notificationIds: string[]) => void;
    onMarkUnread: (notificationId: string) => Promise<unknown>;
    onDismiss: (notificationId: string) => Promise<unknown>;
    onClearAll?: () => Promise<unknown>;
    onMuteScope: (scope: NotificationMuteScope) => Promise<unknown>;
    onSnooze: (notificationId: string, snoozedUntil: string) => Promise<unknown>;
    onLoadMore: () => Promise<unknown>;
};

function NotificationSkeleton() {
    return (
        <div className="divide-y divide-border" role="status" aria-label="Loading notifications">
            <span className="sr-only">Loading notifications…</span>
            {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex min-h-16 gap-3 px-4 py-3" aria-hidden="true">
                    <Skeleton kind="tile" className="h-[34px] w-[34px] shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                        <Skeleton className="h-3.5 w-4/5 rounded-sm" />
                        <Skeleton className="h-3 w-3/5 rounded-sm" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function NotificationPreview(props: NotificationPreviewProps) {
    const {
        unreadCount,
        unreadImportantCount,
        items,
        activeFilter,
        isOpen,
        isLoading,
        hasMore,
        isLoadingMore,
        connectionHealth,
        onOpenChange,
        onFilterChange,
        onOpenItem,
        onItemsViewed,
        onMarkUnread,
        onDismiss,
        onClearAll,
        onMuteScope,
        onSnooze,
        onLoadMore,
    } = props;
    const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);

    const isRealtimeHealthy = connectionHealth === "healthy";
    const connectionNotice = connectionHealth === "offline"
        ? "You are offline. Live updates will resume when the connection returns."
        : connectionHealth === "unavailable"
            ? "Live updates are unavailable."
            : "Live updates are reconnecting.";
    const label = unreadImportantCount > 0
        ? `Open notifications, ${unreadImportantCount} need attention, ${unreadCount} new total`
        : unreadCount > 0
            ? `Open notifications, ${unreadCount} new`
            : "Open notifications";

    const handleFilterKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % FILTERS.length;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + FILTERS.length) % FILTERS.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = FILTERS.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextFilter = FILTERS[nextIndex];
        if (!nextFilter) return;
        onFilterChange(nextFilter.id);
        filterRefs.current[nextIndex]?.focus();
    };

    const badgeChanged = useChanged(unreadImportantCount);
    return (
        <DropdownMenu modal={false} open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={isRealtimeHealthy ? label : `${label} (${connectionNotice})`}
                    // A top-bar cell (shell redesign): a 20px bell, the count as an orange square that settles in once.
                    className="nb-cell nb-cell-icon nb-topbar-bell group relative outline-none"
                >
                    <Bell className="size-5" strokeWidth={1.65} aria-hidden="true" />
                    {unreadImportantCount > 0 ? (
                        <span key={unreadImportantCount} data-settle={badgeChanged || undefined} className="nb-topbar-badge">
                            {unreadImportantCount > 9 ? "9+" : unreadImportantCount}
                        </span>
                    ) : unreadCount > 0 ? (
                        <span className="nb-topbar-badge nb-topbar-badge--dot" />
                    ) : null}
                    {!isRealtimeHealthy ? (
                        <span
                            aria-hidden
                            title={connectionNotice}
                            className={cn(
                                "absolute bottom-0.5 right-0.5 h-2 w-2 rounded-[2px] ring-2 ring-background",
                                connectionHealth === "reconnecting" ? "bg-[var(--status-warning)]" : "bg-destructive",
                            )}
                        />
                    ) : null}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={8}
                className="mr-2 flex w-[min(26rem,calc(100vw-1.5rem))] max-w-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl duration-[180ms] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 md:mr-0 dark:border-border dark:bg-card max-md:mr-0 max-md:h-[calc(100dvh-var(--ui-topnav-height)-8px)] max-md:!max-h-none max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-x-0 max-md:shadow-none"
                style={{ maxHeight: "min(38rem, calc(100dvh - var(--ui-topnav-height) - 1rem))" }}
            >
                <div role="status" aria-live="polite" className="sr-only">
                    {unreadCount > 0 ? `${unreadCount} new notifications` : "No new notifications"}
                </div>
                <div className="shrink-0 px-4 pt-3.5 pb-2.5 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="nb-card-title text-foreground">Notifications</h3>
                                {unreadCount > 0 ? (
                                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
                                        {unreadCount} new
                                    </span>
                                ) : null}
                            </div>
                            {!isRealtimeHealthy ? (
                                <p className={cn(
                                    "nb-compact mt-1",
                                    connectionHealth === "reconnecting" ? "text-[var(--status-warning)]" : "text-destructive",
                                )}>{connectionNotice}</p>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                            {activeFilter === "all" && items.length > 0 ? (
                                <button
                                    type="button"
                                    onClick={() => void onClearAll?.()}
                                    aria-label="Clear all notifications"
                                    className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground hover:text-foreground transition-colors font-medium py-1 px-1.5 rounded-[4px] hover:bg-muted active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    Clear all
                                </button>
                            ) : null}
                            <Link
                                href={settingsTabHref("notifications")}
                                className="nb-icon-button nb-touch-target h-8 w-8 rounded-md transition-colors outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                                aria-label="Notification settings"
                            >
                                <Settings className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                    <div className="nb-seg" data-fill="" role="tablist" aria-label="Notification filter" aria-orientation="horizontal">
                        {FILTERS.map((filter, index) => (
                            <button
                                key={filter.id}
                                ref={(node) => { filterRefs.current[index] = node; }}
                                type="button"
                                role="tab"
                                id={`notifications-filter-${filter.id}`}
                                aria-selected={activeFilter === filter.id}
                                aria-controls="notifications-filter-panel"
                                tabIndex={activeFilter === filter.id ? 0 : -1}
                                onClick={() => onFilterChange(filter.id)}
                                onKeyDown={(event) => handleFilterKeyDown(event, index)}
                            >
                                <span>{filter.label}</span>
                                {filter.id === "unread" && unreadCount > 0 ? (
                                    <span className="nb-seg-n">{unreadCount}</span>
                                ) : null}
                            </button>
                        ))}
                        <TabMarker />
                    </div>
                </div>
                <div id="notifications-filter-panel" role="tabpanel" aria-labelledby={`notifications-filter-${activeFilter}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain app-scroll app-scroll-y [overflow-anchor:none]">
                    {activeFilter === "reviews" ? (
                        <MyReviewsList />
                    ) : isLoading ? (
                        <NotificationSkeleton />
                    ) : (
                        <NotificationList
                            items={items}
                            filter={activeFilter}
                            onOpen={onOpenItem}
                            onViewed={onItemsViewed}
                            onMarkUnread={(item) => onMarkUnread(item.id)}
                            onDismiss={(item) => onDismiss(item.id)}
                            onMuteScope={(_item, scope) => onMuteScope(scope)}
                            onSnooze={(item, snoozedUntil) => onSnooze(item.id, snoozedUntil)}
                            hasMore={hasMore}
                            isLoadingMore={isLoadingMore}
                            onLoadMore={onLoadMore}
                            emptyState={activeFilter === "unread" ? "You’re all caught up." : "No notifications yet."}
                        />
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
