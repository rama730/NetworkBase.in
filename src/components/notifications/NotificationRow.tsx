"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellOff, Clock, ExternalLink, EyeOff, MoreVertical, RotateCcw } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    buildNotificationMuteScopes,
    formatAbsoluteTimestamp,
    formatRelativeTimestamp,
    getAggregateLabel,
    getNotificationReasonLabel,
} from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationMuteScope } from "@/lib/notifications/types";
import { projectUpdateDisplayText } from "@/lib/workspaces/updates";
import { NotificationAvatar } from "@/components/notifications/NotificationAvatar";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { LinkPending } from "@/components/ui/LinkPending";
import { isPlainLeftClick } from "@/lib/navigation/links";

const QUALIFIED_VIEW_MS = 750;
const FOCUS_VIEW_MS = 500;

function snoozePresets() {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const tomorrowMorning = new Date(now);
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
    tomorrowMorning.setHours(9, 0, 0, 0);
    const nextMondayMorning = new Date(now);
    const daysUntilMonday = ((8 - nextMondayMorning.getDay()) % 7) || 7;
    nextMondayMorning.setDate(nextMondayMorning.getDate() + daysUntilMonday);
    nextMondayMorning.setHours(9, 0, 0, 0);
    return [
        { label: "Snooze 1 hour", until: inOneHour },
        { label: "Snooze until tomorrow", until: tomorrowMorning },
        { label: "Snooze until next week", until: nextMondayMorning },
    ];
}

export function NotificationRow(props: {
    item: NotificationItem;
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onViewed: (notificationIds: string[]) => void;
    onMarkUnread: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
    compact?: boolean;
}) {
    const { item, onOpen, onViewed, onMarkUnread, onDismiss, onMuteScope, onSnooze, compact = false } = props;
    const [destinationMissing, setDestinationMissing] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const preview = item.preview;
    const relativeTime = formatRelativeTimestamp(item.activityAt) ?? "Just now";
    const absoluteTime = formatAbsoluteTimestamp(item.activityAt);
    const aggregateLabel = getAggregateLabel(item.kind, item.aggregateCount);
    const muteScopes = useMemo(() => buildNotificationMuteScopes(item), [item]);
    const reasonLabel = getNotificationReasonLabel(item.reason);
    const isNew = !item.seenAt;
    const isImportant = item.importance === "important";
    const bodyText = item.body ? projectUpdateDisplayText(item.body) : null;
    const secondaryText = preview?.secondaryText ? projectUpdateDisplayText(preview.secondaryText) : null;
    const showSecondaryText = Boolean(
        secondaryText
        && secondaryText !== bodyText
        && secondaryText !== item.title
        && (!bodyText || !bodyText.toLowerCase().includes(secondaryText.toLowerCase())),
    );

    const clearViewTimers = () => {
        if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
        viewTimerRef.current = null;
        focusTimerRef.current = null;
    };

    const markViewed = () => {
        viewTimerRef.current = null;
        focusTimerRef.current = null;
        if (isNew) onViewed([item.id]);
    };

    useEffect(() => {
        if (!isNew || !rowRef.current || typeof IntersectionObserver === "undefined") return;
        const element = rowRef.current;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting && entry.intersectionRatio >= 0.6 && !viewTimerRef.current) {
                viewTimerRef.current = setTimeout(markViewed, QUALIFIED_VIEW_MS);
            } else if (viewTimerRef.current) {
                clearTimeout(viewTimerRef.current);
                viewTimerRef.current = null;
            }
        }, { threshold: [0, 0.6, 1] });
        observer.observe(element);
        return () => {
            observer.disconnect();
            clearViewTimers();
        };
    // The item ID/seen state intentionally restarts the qualified-view timer.
    }, [item.id, isNew]);

    const handleOpen = async () => {
        setDestinationMissing(false);
        const opened = await onOpen(item);
        if (opened === false) setDestinationMissing(true);
    };

    const metadata = [
        preview?.contextLabel,
        showSecondaryText ? secondaryText : null,
        aggregateLabel,
        relativeTime,
    ].filter((value): value is string => Boolean(value));

    return (
        <div
            ref={rowRef}
            data-notification-row
            data-notification-id={item.id}
            tabIndex={-1}
            onFocus={() => {
                if (isNew && !focusTimerRef.current) focusTimerRef.current = setTimeout(markViewed, FOCUS_VIEW_MS);
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearViewTimers();
            }}
            className={cn(
                "group relative flex items-start gap-2 outline-none transition-[background-color,box-shadow] duration-[130ms] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                compact ? "min-h-12 px-3 py-2" : "min-h-16 px-4 py-3",
                isNew
                    ? "bg-primary/[0.04] hover:bg-primary/[0.07] dark:bg-primary/[0.08] dark:hover:bg-primary/[0.12]"
                    : "hover:bg-muted/60",
            )}
        >
            {/* A real link when the item has an address: Cmd/middle-click opens a new tab (unified back B15). */}
            {(() => {
                const shared = {
                    onFocus: () => { if (isNew) focusTimerRef.current = setTimeout(markViewed, FOCUS_VIEW_MS); },
                    onBlur: clearViewTimers,
                    "aria-label": `${isNew ? "Unread" : "Read"} ${reasonLabel}: ${item.title}${relativeTime ? `, ${relativeTime}` : ""}`,
                    className: "nb-pressable relative flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left outline-none",
                };
                const body = (
                    <>
                <div className="relative mt-0.5 shrink-0">
                    <NotificationAvatar actorUserId={item.actorUserId} actorName={preview?.actorName} avatarUrl={preview?.actorAvatarUrl} size={compact ? 26 : 34} />
                    {isNew ? (
                        <span
                            aria-label={isImportant ? "Needs attention" : "Unread"}
                            className={cn(
                                "absolute -right-0.5 -top-0.5 size-2 rounded-[2px] ring-2 ring-card",
                                isImportant ? "bg-destructive" : "bg-primary",
                            )}
                        />
                    ) : null}
                </div>

                <div className="min-w-0 flex-1">
                    <p className={cn("nb-compact line-clamp-2 text-foreground", isNew ? "font-semibold" : "font-medium")}>{item.title}</p>
                    {bodyText ? (
                        <p className="nb-notif-body">{bodyText}</p>
                    ) : null}
                    <div className="nb-meta mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        {metadata.map((value, index) => (
                            <span key={`${value}:${index}`} className="inline-flex items-center gap-1.5">
                                {index > 0 ? <span aria-hidden="true" className="text-muted-foreground/40 font-bold">·</span> : null}
                                {value === preview?.contextLabel ? <span className="nb-state-tag">{value}</span>
                                    : <span className={value === relativeTime ? "nb-notif-time" : undefined} title={value === relativeTime ? absoluteTime ?? undefined : undefined}>{value}</span>}
                            </span>
                        ))}
                    </div>
                    {destinationMissing ? (
                        <p className="nb-compact mt-2 font-medium text-[var(--status-warning)]">This item is no longer available.</p>
                    ) : null}
                </div>
                    </>
                );
                return item.href && item.href.startsWith("/") ? (
                    <Link
                        href={item.href}
                        prefetch={false}
                        {...shared}
                        onClick={(event) => { if (isPlainLeftClick(event)) { event.preventDefault(); void handleOpen(); } }}
                    >
                        {body}
                        <LinkPending />
                    </Link>
                ) : (
                    <button type="button" onClick={() => void handleOpen()} {...shared}>{body}</button>
                );
            })()}

            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="nb-icon-button nb-touch-target mt-0.5 h-7 w-7 shrink-0 opacity-100 transition-[background-color,color,opacity,transform] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                        aria-label="Notification actions"
                    >
                        <MoreVertical className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => void handleOpen()} disabled={!item.href}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open
                    </DropdownMenuItem>
                    {item.seenAt ? (
                        <DropdownMenuItem onClick={() => void onMarkUnread(item)}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Mark as unread
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => void onDismiss(item)}>
                        <EyeOff className="mr-2 h-4 w-4" />
                        Dismiss
                    </DropdownMenuItem>
                    {onSnooze ? (
                        <>
                            <DropdownMenuSeparator />
                            {snoozePresets().map((preset) => (
                                <DropdownMenuItem key={preset.label} onClick={() => void onSnooze(item, preset.until.toISOString())}>
                                    <Clock className="mr-2 h-4 w-4" />
                                    {preset.label}
                                </DropdownMenuItem>
                            ))}
                        </>
                    ) : null}
                    <DropdownMenuSeparator />
                    {muteScopes.slice(0, 3).map((scope) => (
                        <DropdownMenuItem key={`${scope.kind}:${scope.value}`} onClick={() => void onMuteScope(item, scope)}>
                            <BellOff className="mr-2 h-4 w-4" />
                            {scope.kind === "notification_type" ? `Turn off ${reasonLabel}` : `Mute ${scope.label ?? scope.kind}`}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
