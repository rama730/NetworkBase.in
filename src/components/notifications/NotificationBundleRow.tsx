"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellOff, ChevronDown, ChevronRight, ExternalLink, MoreVertical } from "@/components/ui/icons";

import { NotificationRow } from "@/components/notifications/NotificationRow";
import { NotificationAvatar } from "@/components/notifications/NotificationAvatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    buildNotificationMuteScopes,
    bundleUnreadCount,
    formatAbsoluteTimestamp,
    formatRelativeTimestamp,
    getBundleSummary,
    getNotificationReasonLabel,
    type NotificationBundle,
} from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationMuteScope } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const QUALIFIED_VIEW_MS = 750;

type Handlers = {
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onViewed: (notificationIds: string[]) => void;
    onMarkUnread: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
};

export function NotificationBundleRow(props: { bundle: NotificationBundle } & Handlers) {
    const { bundle, onOpen, onViewed, onMarkUnread, onDismiss, onMuteScope, onSnooze } = props;
    const [expanded, setExpanded] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lead = bundle.lead;
    const count = bundle.items.length;
    const newCount = bundleUnreadCount(bundle);
    const summary = useMemo(() => getBundleSummary(bundle), [bundle]);
    const reasonLabel = getNotificationReasonLabel(lead.reason);
    const relative = formatRelativeTimestamp(lead.activityAt) ?? "Just now";
    const absolute = formatAbsoluteTimestamp(lead.activityAt);
    const muteScopes = useMemo(() => buildNotificationMuteScopes(lead), [lead]);
    const markBundleViewed = () => {
        viewTimerRef.current = null;
        if (!lead.seenAt) onViewed([lead.id]);
    };

    useEffect(() => {
        if (lead.seenAt || !rowRef.current || typeof IntersectionObserver === "undefined") return;
        const element = rowRef.current;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting && entry.intersectionRatio >= 0.6 && !viewTimerRef.current) {
                viewTimerRef.current = setTimeout(markBundleViewed, QUALIFIED_VIEW_MS);
            } else if (viewTimerRef.current) {
                clearTimeout(viewTimerRef.current);
                viewTimerRef.current = null;
            }
        }, { threshold: [0, 0.6, 1] });
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
            viewTimerRef.current = null;
        };
    // The current bundle is intentionally re-evaluated after every state patch.
    }, [lead.id, newCount]);

    const handleOpenLead = async () => {
        await onOpen(lead);
    };

    return (
        <div>
            <div
                ref={rowRef}
                data-notification-row
                data-notification-id={lead.id}
                tabIndex={-1}
                onFocus={() => {
                    if (!lead.seenAt && !viewTimerRef.current) viewTimerRef.current = setTimeout(markBundleViewed, 500);
                }}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && viewTimerRef.current) {
                        clearTimeout(viewTimerRef.current);
                        viewTimerRef.current = null;
                    }
                }}
                className={cn(
                    "group relative flex min-h-16 items-start gap-2 px-4 py-3 outline-none transition-[background-color,box-shadow] duration-[130ms] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    newCount > 0
                        ? "bg-primary/[0.04] hover:bg-primary/[0.07] dark:bg-primary/[0.08] dark:hover:bg-primary/[0.12]"
                        : "hover:bg-muted/60",
                )}
            >
                <button
                    type="button"
                    onClick={() => void handleOpenLead()}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left outline-none active:translate-y-px"
                    aria-label={`${newCount > 0 ? `${newCount} new` : "Read"} grouped ${reasonLabel}: ${lead.title}`}
                >
                    <div className="relative mt-0.5 shrink-0">
                        <NotificationAvatar actorUserId={lead.actorUserId} actorName={lead.preview?.actorName} fallbackName={summary} avatarUrl={lead.preview?.actorAvatarUrl} size={34} />
                        <span className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-[3px] bg-foreground px-1 font-mono text-[10px] font-semibold leading-none text-background ring-2 ring-card shadow-2xs">
                            {count}
                        </span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className={cn("nb-compact line-clamp-1 text-foreground", newCount > 0 ? "font-semibold" : "font-medium")}>{summary || lead.title}</p>
                        {summary ? <p className="nb-compact mt-0.5 line-clamp-1 text-muted-foreground">{lead.title}</p> : null}
                        <div className="nb-meta mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            {lead.preview?.contextLabel ? <span>{lead.preview.contextLabel}</span> : null}
                            {lead.preview?.contextLabel ? <span aria-hidden="true" className="text-muted-foreground/40 font-bold">·</span> : null}
                            <span title={absolute ?? undefined}>{relative}</span>
                            <span aria-hidden="true" className="text-muted-foreground/40 font-bold">·</span>
                            <span>{count} updates</span>
                        </div>
                    </div>
                </button>

                <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                    <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        aria-expanded={expanded}
                        aria-label={expanded ? "Collapse grouped notifications" : `Expand ${count} grouped notifications`}
                        className="nb-icon-button nb-touch-target h-7 w-7 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={expanded ? "Collapse group" : `Expand ${count} updates`}
                    >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <button type="button" className="nb-icon-button nb-touch-target h-7 w-7 rounded-md opacity-100 transition-[background-color,color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100" aria-label="Grouped notification actions">
                                <MoreVertical className="h-4 w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => void handleOpenLead()} disabled={!lead.href}>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Open latest
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {muteScopes.slice(0, 3).map((scope) => (
                                <DropdownMenuItem key={`${scope.kind}:${scope.value}`} onClick={() => void onMuteScope(lead, scope)}>
                                    <BellOff className="mr-2 h-4 w-4" />
                                    {scope.kind === "notification_type" ? `Turn off ${reasonLabel}` : `Mute ${scope.label ?? scope.kind}`}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {expanded ? (
                <div className="relative pb-2 bg-muted/10">
                    {/* Continuous vertical drafting thread rail */}
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-[33px] top-0 bottom-4 w-px bg-border/80 dark:bg-border"
                    />
                    <div className="space-y-0.5">
                        {bundle.items.map((item) => (
                            <div key={item.id} className="relative flex items-start pl-8 pr-2">
                                {/* Drafting-table branching elbow */}
                                <span
                                    aria-hidden="true"
                                    className="pointer-events-none absolute left-[33px] top-3.5 h-3 w-3 rounded-bl-[6px] border-b border-l border-border/80 dark:border-border"
                                />
                                <div className="min-w-0 flex-1 pl-2">
                                    <NotificationRow
                                        item={item}
                                        onOpen={onOpen}
                                        onViewed={onViewed}
                                        onMarkUnread={onMarkUnread}
                                        onDismiss={onDismiss}
                                        onMuteScope={onMuteScope}
                                        onSnooze={onSnooze}
                                        compact
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
