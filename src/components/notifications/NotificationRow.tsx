"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BellOff, Check, ChevronRight, Clock, MoreHorizontal, RotateCcw } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkPending } from "@/components/ui/LinkPending";
import { NotificationWho } from "@/components/notifications/NotificationGlyph";
import { isPlainLeftClick } from "@/lib/navigation/links";
import { buildNotificationMuteScopes, formatAbsoluteTimestamp, formatRelativeTimestamp, getAggregateLabel, getNotificationReasonLabel, type NotificationBundle } from "@/lib/notifications/presentation";
import { notificationSentence } from "@/lib/notifications/sentence";
import { isTaskCode, whyYouGotIt } from "@/lib/notifications/tray-model";
import type { NotificationItem, NotificationMuteScope } from "@/lib/notifications/types";
import { projectUpdateDisplayText } from "@/lib/workspaces/updates";

const QUALIFIED_VIEW_MS = 750;
const FOCUS_VIEW_MS = 500;
const REPLY_KINDS = new Set(["task_comment_mention", "task_comment_reply", "project_update_mention", "project_update_comment", "project_update_reply"]);

export type OrgLevel = "all" | "important" | "off";
export type RowHandlers = {
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onViewed: (ids: string[]) => void;
    onDone: (item: NotificationItem) => void | Promise<unknown>;
    onMarkUnread: (item: NotificationItem) => void | Promise<unknown>;
    onSnooze: (item: NotificationItem, until: string) => void | Promise<unknown>;
    onMute: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onMuteWorkspace?: (item: NotificationItem, until: string | "forever") => void | Promise<unknown>;
    onOrgLevel?: (item: NotificationItem, level: OrgLevel) => void | Promise<unknown>;
    onReply?: (item: NotificationItem, text: string) => Promise<boolean>;
};

export function snoozePresets(now = new Date()) {
    const hour = new Date(now.getTime() + 3_600_000);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const monday = new Date(now);
    monday.setDate(monday.getDate() + (((8 - monday.getDay()) % 7) || 7));
    monday.setHours(9, 0, 0, 0);
    return [
        { label: "Snooze 1 hour", until: hour },
        { label: "Snooze until tomorrow 9:00", until: tomorrow },
        { label: "Snooze until Monday 9:00", until: monday },
    ];
}

function names(items: NotificationItem[]) {
    const seen: string[] = [];
    for (const item of items) {
        const name = item.preview?.actorName?.trim();
        if (name && !seen.includes(name)) seen.push(name);
    }
    if (seen.length <= 2) return seen.join(" and ");
    return `${seen.slice(0, 2).join(", ")} and ${seen.length - 2} ${seen.length - 2 === 1 ? "other" : "others"}`;
}

/**
 * One row (notifications mix): who, one sentence, one mono line of where and when. A thread is the same row with a
 * count on the corner and its children under it. Hover swaps the time for Snooze and Done; ⋯ opens with why it came.
 */
export function NotificationRow(props: {
    bundle: NotificationBundle;
    now: Date;
    active?: boolean;
    handIn?: { handedIn: number; total: number } | null;
} & RowHandlers) {
    const { bundle, now, active, handIn, onOpen, onViewed, onDone, onMarkUnread, onSnooze, onMute, onMuteWorkspace, onOrgLevel, onReply } = props;
    const item = bundle.lead;
    const count = bundle.items.length;
    const [open, setOpen] = useState(false);
    const [replying, setReplying] = useState(false);
    const [draft, setDraft] = useState("");
    const [replied, setReplied] = useState(false);
    const [sending, setSending] = useState(false);
    const [missing, setMissing] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unreadIds = useMemo(() => bundle.items.filter((i) => !i.seenAt).map((i) => i.id), [bundle.items]);
    const isNew = unreadIds.length > 0;
    const sentence = notificationSentence(item);
    const actor = item.actorUserId || item.preview?.actorName ? { id: item.actorUserId, name: item.preview?.actorName ?? null, avatarUrl: item.preview?.actorAvatarUrl ?? null } : null;
    const bodyText = item.body ? projectUpdateDisplayText(item.body) : null;
    const secondaryText = item.preview?.secondaryText ? projectUpdateDisplayText(item.preview.secondaryText) : null;
    const snippet = bodyText ?? (secondaryText && secondaryText !== bodyText && secondaryText !== item.title ? secondaryText : null);
    const relative = formatRelativeTimestamp(item.activityAt) ?? "now";
    const absolute = formatAbsoluteTimestamp(item.activityAt) ?? undefined;
    const backFromSnooze = Boolean(item.snoozedUntil && new Date(item.snoozedUntil) <= now && !item.seenAt);
    const isHandIn = item.kind === "org_assignment" && item.aggregateCount > 1 && /^New submission for /.test(item.title);
    const handInTitle = isHandIn ? item.title.replace(/^New submission for /, "") : null;
    const aggregate = getAggregateLabel(item.kind, item.aggregateCount);
    const meta = [sentence.context, count > 1 ? `${count} updates` : isHandIn ? null : aggregate].filter(Boolean).join(" · ");
    const showWorkspaceMute = Boolean(item.entityRefs?.projectId && !item.entityRefs?.orgId && onMuteWorkspace);
    // The workspace has its own timed mute below, so its standing mute isn't offered twice.
    const muteScopes = buildNotificationMuteScopes(item).filter((scope) => !(scope.kind === "project" && showWorkspaceMute)).slice(0, 3);
    const placeName = sentence.context && !isTaskCode(sentence.context) ? sentence.context : null;
    const reasonLabel = getNotificationReasonLabel(item.reason);
    const canReply = Boolean(onReply) && REPLY_KINDS.has(item.kind) && Boolean(item.entityRefs?.projectId && (item.entityRefs?.taskId || item.entityRefs?.updateId));

    useEffect(() => {
        if (!isNew || !rowRef.current || typeof IntersectionObserver === "undefined") return;
        const element = rowRef.current;
        const markViewed = () => { viewTimerRef.current = null; onViewed(unreadIds); };
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting && entry.intersectionRatio >= 0.6 && !viewTimerRef.current) {
                viewTimerRef.current = setTimeout(markViewed, QUALIFIED_VIEW_MS);
            } else if (viewTimerRef.current) {
                clearTimeout(viewTimerRef.current);
                viewTimerRef.current = null;
            }
        }, { threshold: [0, 0.6, 1] });
        observer.observe(element);
        return () => { observer.disconnect(); if (viewTimerRef.current) clearTimeout(viewTimerRef.current); viewTimerRef.current = null; };
    // A new unread set restarts the qualified-view timer.
    }, [isNew, unreadIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleOpen = async () => {
        setMissing(false);
        if ((await onOpen(item)) === false) setMissing(true);
    };
    const sendReply = async () => {
        if (!onReply || !draft.trim()) return;
        setSending(true);
        const ok = await onReply(item, draft.trim());
        setSending(false);
        if (ok) { setReplied(true); setReplying(false); setDraft(""); }
    };

    const sentenceNode = isHandIn ? (
        <span className="nb-nt-t1 nb-compact">{handIn ? <><b>{handIn.handedIn} of {handIn.total}</b> handed in </> : <><b>{item.aggregateCount} new submissions</b> for </>}<b>{handInTitle}</b></span>
    ) : (
        <span className="nb-nt-t1 nb-compact">
            {count > 1 && names(bundle.items) ? <b>{names(bundle.items)}</b> : sentence.actor ? <b>{sentence.actor}</b> : null}
            {count > 1 && names(bundle.items) && !sentence.actor ? ` · ${sentence.verb}` : sentence.verb}
            {sentence.object ? <b>{sentence.object}</b> : null}
        </span>
    );
    const body = (
        <>
            <NotificationWho actor={actor} glyph={sentence.glyph} tone={sentence.tone} count={count} />
            <span className="nb-nt-tx">
                {sentenceNode}
                {snippet && !isHandIn ? <span className="nb-nt-snip">{snippet}</span> : null}
                {isHandIn && handIn ? <span className="nb-nt-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round((handIn.handedIn / Math.max(1, handIn.total)) * 100))}%` }} /></span> : null}
                <span className="nb-nt-meta nb-meta">
                    {backFromSnooze ? <span className="nb-nt-wait">Back from snooze</span> : null}
                    {meta ? <span>{meta}</span> : null}
                </span>
                {missing ? <span className="nb-compact font-medium text-[var(--status-warning)]">This item is no longer available.</span> : null}
            </span>
        </>
    );
    const label = `${isNew ? "Unread" : "Read"} ${reasonLabel}: ${item.title}, ${relative}`;

    return (
        <div>
            <div
                ref={rowRef}
                className="nb-nt-row"
                data-notification-row
                data-notification-id={item.id}
                data-unread={isNew || undefined}
                data-active={active || undefined}
                tabIndex={-1}
            >
                <span className="flex min-w-0 flex-1 flex-col">
                    {item.href && item.href.startsWith("/") ? (
                        <Link href={item.href} prefetch={false} aria-label={label} className="nb-nt-main nb-pressable" onClick={(event) => { if (isPlainLeftClick(event)) { event.preventDefault(); void handleOpen(); } }}>
                            {body}
                            <LinkPending />
                        </Link>
                    ) : (
                        <button type="button" aria-label={label} className="nb-nt-main" onClick={() => void handleOpen()}>{body}</button>
                    )}
                    {isHandIn || canReply || replied ? (
                        <span className="nb-nt-acts" style={{ paddingLeft: 46 }}>
                            {isHandIn && item.href ? <Link href={item.href} prefetch={false} className="nb-nt-btn" data-kind="primary">Open review queue</Link> : null}
                            {canReply && !replying && !replied ? <button type="button" className="nb-nt-btn" onClick={() => setReplying(true)}>Reply</button> : null}
                            {replied ? <span className="nb-nt-ok"><Check className="size-4" aria-hidden="true" />Replied</span> : null}
                        </span>
                    ) : null}
                    {replying ? (
                        <span className="nb-nt-reply" style={{ paddingLeft: 46 }}>
                            <label className="nb-micro" htmlFor={`nb-nt-reply-${item.id}`}>Reply{sentence.actor ? ` to ${sentence.actor}` : ""}</label>
                            <textarea
                                id={`nb-nt-reply-${item.id}`}
                                value={draft}
                                autoFocus
                                maxLength={4000}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendReply(); } event.stopPropagation(); }}
                            />
                            <span className="flex items-center gap-1.5">
                                <button type="button" className="nb-nt-btn" data-kind="primary" disabled={sending || !draft.trim()} onClick={() => void sendReply()}>{sending ? "Sending…" : "Send"}</button>
                                <button type="button" className="nb-nt-btn" data-kind="ghost" onClick={() => setReplying(false)}>Cancel</button>
                                <span className="nb-meta ml-auto">⌘↵ sends</span>
                            </span>
                        </span>
                    ) : null}
                </span>
                <span className="nb-nt-side">
                    <span className="nb-nt-when nb-meta" title={absolute}>{relative}</span>
                    <span className="nb-nt-hov">
                        <button type="button" className="nb-nt-ib" aria-label="Snooze until tomorrow 9:00" onClick={() => void onSnooze(item, snoozePresets(now)[1]!.until.toISOString())}><Clock aria-hidden="true" /></button>
                        <button type="button" className="nb-nt-ib" aria-label="Done" onClick={() => void onDone(item)}><Check aria-hidden="true" /></button>
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <button type="button" className="nb-nt-ib" aria-label="More for this notification"><MoreHorizontal aria-hidden="true" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-72">
                                <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
                                    <span className="nb-micro">Why you got this</span>
                                    <span className="nb-compact text-foreground">{whyYouGotIt(item)}</span>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {item.seenAt ? <DropdownMenuItem onClick={() => void onMarkUnread(item)}><RotateCcw className="mr-2 size-4" />Mark unread</DropdownMenuItem> : null}
                                {snoozePresets(now).map((preset) => (
                                    <DropdownMenuItem key={preset.label} onClick={() => void onSnooze(item, preset.until.toISOString())}><Clock className="mr-2 size-4" />{preset.label}</DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                {muteScopes.map((scope) => (
                                    <DropdownMenuItem key={`${scope.kind}:${scope.value}`} onClick={() => void onMute(item, scope)}>
                                        <BellOff className="mr-2 size-4" />{scope.kind === "notification_type" ? `Turn off ${reasonLabel.toLowerCase()} notifications` : `Mute ${scope.label ?? scope.kind}`}
                                    </DropdownMenuItem>
                                ))}
                                {item.entityRefs?.orgId && onOrgLevel ? (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="nb-micro font-normal">From {placeName ?? "this organization"}</DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => void onOrgLevel(item, "all")}>Everything</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => void onOrgLevel(item, "important")}>Important only</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => void onOrgLevel(item, "off")}>Off, except safety notices</DropdownMenuItem>
                                    </>
                                ) : showWorkspaceMute && onMuteWorkspace ? (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuLabel className="nb-micro font-normal">Mute {placeName ?? "this workspace"}</DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => void onMuteWorkspace(item, snoozePresets(now)[0]!.until.toISOString())}>For 1 hour</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => void onMuteWorkspace(item, snoozePresets(now)[1]!.until.toISOString())}>Until tomorrow 9:00</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => void onMuteWorkspace(item, "forever")}>Until I turn it back on</DropdownMenuItem>
                                    </>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </span>
                    {isNew ? <span className="nb-nt-mark" aria-hidden="true" /> : null}
                    {count > 1 ? (
                        <button type="button" className="nb-nt-ib" aria-expanded={open} aria-label={open ? "Hide the thread" : `Show ${count} updates`} onClick={() => setOpen((v) => !v)}>
                            <ChevronRight aria-hidden="true" style={open ? { transform: "rotate(90deg)" } : undefined} />
                        </button>
                    ) : null}
                </span>
            </div>
            {open && count > 1 ? (
                <div className="nb-nt-kids">
                    {bundle.items.map((child) => (
                        <div key={child.id} className="nb-nt-kid">
                            <span className="nb-nt-tx">
                                <span className="nb-compact">{child.title}</span>
                                <span className="nb-meta">{formatRelativeTimestamp(child.activityAt) ?? "now"}</span>
                            </span>
                            <button type="button" className="nb-nt-ib" aria-label="Done" onClick={() => void onDone(child)}><Check aria-hidden="true" /></button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
