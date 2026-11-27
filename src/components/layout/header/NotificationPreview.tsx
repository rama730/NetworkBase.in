"use client";
import "@/components/notifications/notifications.css";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowUp, Bell, MoreHorizontal, Settings, X } from "lucide-react";

import { NotificationList } from "@/components/notifications/NotificationList";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import * as Popover from "@radix-ui/react-popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { Skeleton } from "@/components/ui/skeleton";
import { TabMarker } from "@/components/ui/TabMarker";
import { settingsTabHref } from "@/constants/routes";
import { useChanged } from "@/hooks/useChanged";
import type { useNotifications } from "@/hooks/useNotifications";
import type { RealtimeHealthState } from "@/components/providers/RealtimeProvider";
import { awaySummary, splitTray } from "@/lib/notifications/tray-model";
import { titleWithNeedsCount } from "@/lib/notifications/tab-title";
import { formatLongDate } from "@/lib/utils/date";

type Notifications = ReturnType<typeof useNotifications>;

function NotificationSkeleton() {
    return (
        <div role="status" aria-label="Loading notifications">
            <span className="sr-only">Loading notifications…</span>
            {[0, 1, 2].map((index) => (
                <div key={index} className="nb-nt-sk" aria-hidden="true">
                    <Skeleton kind="tile" className="h-[34px] w-[34px] shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                        <Skeleton className="h-3 w-4/5 rounded-sm" />
                        <Skeleton className="h-2.5 w-1/2 rounded-sm" />
                    </div>
                </div>
            ))}
        </div>
    );
}

const EDITABLE = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
};

/**
 * The bell and its tray (notifications mix; spec §31). The number is the Needs you count; a dot means new with nothing
 * waiting. Two tabs, Unread (Needs you, then New) and All; answers in the row; Done with Undo; keys; a phone sheet.
 */
export default function NotificationPreview({ n, connectionHealth }: { n: Notifications; connectionHealth: RealtimeHealthState }) {
    const pathname = usePathname();
    const [now, setNow] = useState(() => new Date());
    const [confirmDone, setConfirmDone] = useState(false);
    const [keysOpen, setKeysOpen] = useState(false);
    const [showSnoozed, setShowSnoozed] = useState(false);
    const [scopeCleared, setScopeCleared] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [newSince, setNewSince] = useState(0);
    const [announce, setAnnounce] = useState("");
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const firstIdRef = useRef<string | null>(null);
    const needsKeysRef = useRef<Set<string> | null>(null);
    const swipeRef = useRef<{ el: HTMLElement; x: number; y: number; id: string; timer: ReturnType<typeof setTimeout> | null } | null>(null);

    const isOpen = n.isTrayOpen;
    const filter = n.activeFilter;
    const needs = n.needs;
    const needsCount = n.needsYouCount;
    const healthy = connectionHealth === "healthy";
    const connectionLabel = connectionHealth === "offline" ? "Offline" : connectionHealth === "unavailable" ? "Live updates off" : "Reconnecting";
    const shape = useMemo(() => splitTray(n.items, needs, filter, now), [n.items, needs, filter, now]);
    // Rows that a Needs you item stands for are counted once: only linked rows still unseen are taken off "new".
    const linkedUnseen = needs.filter((item) => item.notificationId && n.items.some((row) => row.id === item.notificationId && !row.seenAt)).length;
    const unreadTotal = needsCount + Math.max(0, n.unreadCount - linkedUnseen);
    const badgeChanged = useChanged(needsCount);

    // Inside a workspace or organization, its own rows come first (the same scope chip as the search box).
    const scopeSlug = useMemo(() => /^\/(?:workspaces|org)\/([^/?#]+)/.exec(pathname ?? "")?.[1] ?? null, [pathname]);
    useEffect(() => setScopeCleared(false), [scopeSlug]);
    const inScope = scopeSlug && !scopeCleared
        ? (bundle: { lead: { entityRefs: { projectSlug?: string | null; projectId?: string | null } | null } }) => bundle.lead.entityRefs?.projectSlug === scopeSlug || bundle.lead.entityRefs?.projectId === scopeSlug
        : undefined;
    const scopeLabel = inScope ? (shape.fresh.find(inScope)?.lead.preview?.contextLabel ?? null) : null;

    const away = isOpen ? awaySummary({ lastOpenedAt: n.lastOpenedAt, needsCount, items: n.items, now }) : null;
    const bellLabel = `Notifications, ${needsCount} need you, ${Math.max(0, unreadTotal - needsCount)} new`;

    useEffect(() => { if (isOpen) setNow(new Date()); }, [isOpen]);

    // ⇧N opens the tray from anywhere (like ⌘K for search), outside text fields.
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || event.key !== "N" || EDITABLE(event.target)) return;
            event.preventDefault();
            n.setTrayOpen(true);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [n]);

    // The tab title carries the Needs you count; re-applied when a page sets its own title.
    useEffect(() => {
        const apply = () => { const next = titleWithNeedsCount(document.title, needsCount); if (next !== document.title) document.title = next; };
        apply();
        // Watch the whole head: a navigation may replace the <title> element itself.
        const observer = new MutationObserver(apply);
        observer.observe(document.head, { childList: true, characterData: true, subtree: true });
        return () => { observer.disconnect(); document.title = titleWithNeedsCount(document.title, 0); };
    }, [needsCount]);

    // Screen readers hear Needs you arrivals only.
    useEffect(() => {
        const keys = new Set(needs.map((item) => item.key));
        const before = needsKeysRef.current;
        needsKeysRef.current = keys;
        if (!before) return;
        const arrived = needs.find((item) => !before.has(item.key));
        if (arrived) setAnnounce(`Needs you: ${arrived.sentence.actor}${arrived.sentence.verb}${arrived.sentence.object}${arrived.context ? `, in ${arrived.context}` : ""}. ${keys.size} need you.`);
    }, [needs]);

    // Scrolled down, new rows wait behind "↑ N new" instead of shoving the list.
    useEffect(() => {
        const first = n.items[0]?.id ?? null;
        if (firstIdRef.current && first && first !== firstIdRef.current && (bodyRef.current?.scrollTop ?? 0) > 40) {
            const index = n.items.findIndex((item) => item.id === firstIdRef.current);
            if (index > 0) setNewSince((count) => count + index);
        }
        firstIdRef.current = first;
    }, [n.items]);

    const rows = () => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(".nb-nt-row[data-notification-row], .nb-nt-row[data-needs-you]") ?? []);
    const itemFor = (el: HTMLElement | undefined) => {
        const id = el?.dataset.notificationId;
        return id ? n.items.find((item) => item.id === id) ?? n.snoozed.find((item) => item.id === id) ?? null : null;
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (EDITABLE(event.target)) return;
        const list = rows();
        const current = list[activeIndex];
        const move = (step: number) => {
            const next = Math.max(0, Math.min(list.length - 1, activeIndex + step));
            setActiveIndex(next);
            list[next]?.focus();
        };
        const click = (selector: string) => current?.querySelector<HTMLElement>(selector)?.click();
        switch (event.key) {
            case "j": case "ArrowDown": event.preventDefault(); move(1); return;
            case "k": case "ArrowUp": event.preventDefault(); move(-1); return;
            case "Enter": if (current) { event.preventDefault(); click(".nb-nt-main, .nb-nt-t1"); } return;
            case "a": case "A": event.preventDefault(); click(".nb-nt-acts .nb-nt-btn[data-kind='primary'], .nb-nt-acts .nb-nt-btn"); return;
            case "e": event.preventDefault(); click("button[aria-label='Done']"); return;
            case "E": if (event.shiftKey) { event.preventDefault(); setConfirmDone(true); } return;
            case "s": event.preventDefault(); click("button[aria-label^='Snooze']"); return;
            case "r": { const item = itemFor(current); if (item?.seenAt) { event.preventDefault(); void n.markUnread(item.id); } return; }
            case "?": event.preventDefault(); setKeysOpen(true); return;
            default: return;
        }
    };

    // Phone: swipe a row left for Done; hold it for its ⋯ menu.
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== "touch") return;
        const el = (event.target as HTMLElement).closest<HTMLElement>(".nb-nt-row[data-notification-row]");
        const id = el?.dataset.notificationId;
        if (!el || !id) return;
        const timer = setTimeout(() => { el.querySelector<HTMLElement>("button[aria-label='More for this notification']")?.click(); swipeRef.current = null; }, 550);
        swipeRef.current = { el, x: event.clientX, y: event.clientY, id, timer };
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const swipe = swipeRef.current;
        if (!swipe) return;
        const dx = event.clientX - swipe.x;
        if (Math.abs(event.clientY - swipe.y) > 12 && Math.abs(dx) < 12) { if (swipe.timer) clearTimeout(swipe.timer); swipeRef.current = null; return; }
        if (Math.abs(dx) > 8 && swipe.timer) { clearTimeout(swipe.timer); swipe.timer = null; }
        if (dx < 0) swipe.el.style.transform = `translateX(${Math.max(dx, -120)}px)`;
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        const swipe = swipeRef.current;
        swipeRef.current = null;
        if (!swipe) return;
        if (swipe.timer) clearTimeout(swipe.timer);
        swipe.el.style.transform = "";
        if (event.clientX - swipe.x <= -96) {
            const item = n.items.find((entry) => entry.id === swipe.id);
            if (item) void n.done(item);
        }
    };

    const handlers = {
        onOpen: (item: Parameters<typeof n.openItem>[0]) => n.openItem(item),
        onViewed: n.stageViewedNotifications,
        onDone: n.done,
        onMarkUnread: (item: { id: string }) => n.markUnread(item.id),
        onSnooze: (item: { id: string }, until: string) => n.snooze(item.id, until),
        onMute: (_item: unknown, scope: Parameters<typeof n.muteScope>[0]) => n.muteScope(scope),
        onMuteWorkspace: n.muteWorkspace,
        onOrgLevel: n.setOrgLevel,
        onReply: n.reply,
    };
    const empty = !n.isLoading && needs.length === 0 && shape.fresh.length === 0 && shape.earlier.length === 0 && !shape.activity;
    const readLoaded = n.items.filter((item) => item.seenAt).length;

    return (
        <>
            <Popover.Root open={isOpen} onOpenChange={n.setTrayOpen}>
                <Popover.Trigger asChild>
                    <button type="button" aria-label={healthy ? bellLabel : `${bellLabel} (${connectionLabel})`} title={`${needsCount} need you · ${Math.max(0, unreadTotal - needsCount)} new · ⇧N`} className="nb-cell nb-cell-icon nb-topbar-bell group relative outline-none">
                        <Bell className="size-5" strokeWidth={1.65} aria-hidden="true" />
                        {needsCount > 0 ? (
                            <span key={needsCount} data-settle={badgeChanged || undefined} className="nb-topbar-badge">{needsCount > 9 ? "9+" : needsCount}</span>
                        ) : n.unreadCount > 0 ? <span className="nb-topbar-badge nb-topbar-badge--dot" /> : null}
                        {!healthy ? <span aria-hidden className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-[2px] ring-2 ring-background" style={{ background: connectionHealth === "reconnecting" ? "var(--status-warning)" : "var(--muted-foreground)" }} /> : null}
                    </button>
                </Popover.Trigger>
                <Popover.Portal>
                <Popover.Content
                    align="end"
                    sideOffset={8}
                    // A panel of tabs and lists, not a menu of items (a popover is a labelled dialog).
                    aria-label="Notifications"
                    className="nb-nt nb-nt-panel z-50 mr-2 flex flex-col overflow-hidden border border-border bg-card p-0 text-card-foreground md:mr-0 max-md:mr-0 max-md:h-[calc(100dvh-var(--ui-topnav-height)-8px)] max-md:!max-h-none max-md:border-x-0"
                    style={{ maxHeight: "min(40rem, calc(100dvh - var(--ui-topnav-height) - 1rem))" }}
                    onKeyDown={onKeyDown}
                >
                    <div role="status" aria-live="polite" className="sr-only">{announce}</div>
                    <div className="nb-nt-hd">
                        <h2 className="nb-card-title">
                            Notifications
                            {!healthy ? <span className="inline-flex h-5 items-center rounded-[3px] px-[7px] font-mono text-[11px] font-medium uppercase tracking-[.09em]" style={{ background: connectionHealth === "reconnecting" ? "var(--status-warning-soft)" : "var(--secondary)", color: connectionHealth === "reconnecting" ? "var(--status-warning)" : "var(--muted-foreground)" }}>{connectionLabel}</span> : null}
                            {inScope && scopeSlug ? <span className="nb-nt-scope">In {scopeLabel ?? scopeSlug}<button type="button" aria-label="Show everywhere" onClick={() => setScopeCleared(true)}><X className="size-3" aria-hidden="true" /></button></span> : null}
                        </h2>
                        {unreadTotal - needsCount > 0 ? <button type="button" className="nb-nt-btn" data-kind="ghost" onClick={() => void n.markAllRead()}>Mark all read</button> : null}
                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild><button type="button" className="nb-nt-ib" aria-label="More notification actions"><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onClick={() => setConfirmDone(true)}>Done with all read…</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setKeysOpen(true)}>Keys</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link href={settingsTabHref("notifications")} className="nb-nt-ib" aria-label="Notification settings"><Settings aria-hidden="true" /></Link>
                    </div>
                    <div className="nb-nt-tabs" role="tablist" aria-label="Notification filter">
                        {(["unread", "all"] as const).map((id) => (
                            <button key={id} type="button" role="tab" id={`notifications-filter-${id}`} aria-selected={filter === id} aria-controls="notifications-filter-panel" tabIndex={filter === id ? 0 : -1} className="nb-nt-tab nb-ui-label" onClick={() => { setActiveIndex(-1); n.setActiveFilter(id); }}>
                                {id === "unread" ? "Unread" : "All"}
                                {id === "unread" ? <span className="nb-meta" aria-hidden="true">{unreadTotal}</span> : null}
                            </button>
                        ))}
                        <TabMarker overlap />
                    </div>
                    {n.quiet ? (
                        <div className="nb-nt-note" data-tone="warn">
                            <span className="flex-1">{n.quiet.kind === "paused" ? "Paused" : "Quiet hours"} until {formatLongDate(n.quiet.until)}. Safety notices still come through.</span>
                            {n.quiet.kind === "paused" ? <button type="button" className="nb-nt-btn" onClick={() => void n.resume()}>Resume</button> : <Link href={settingsTabHref("notifications")} className="nb-nt-btn">Change</Link>}
                        </div>
                    ) : null}
                    {away ? <div className="nb-nt-away"><span className="nb-ui-label">{away.split(":")[0]}</span><span className="nb-meta">{away.split(": ").slice(1).join(": ")}</span></div> : null}
                    {n.coachKind ? (
                        <div className="nb-nt-coach">
                            <span className="nb-compact">You’ve cleared three of these. <b className="font-semibold">Turn this kind off?</b> You can turn it back on in Settings.</span>
                            <span className="flex gap-1.5"><button type="button" className="nb-nt-btn" data-kind="primary" onClick={() => void n.coachTurnOff()}>Turn off</button><button type="button" className="nb-nt-btn" data-kind="ghost" onClick={n.coachKeep}>Keep</button></span>
                        </div>
                    ) : null}
                    {n.isError ? (
                        <div className="nb-nt-note"><span className="flex-1">Couldn’t load new notifications. Showing what was here.</span><button type="button" className="nb-nt-btn" onClick={() => void n.refresh()}>Retry</button></div>
                    ) : null}
                    <div
                        ref={bodyRef}
                        id="notifications-filter-panel"
                        role="tabpanel"
                        aria-labelledby={`notifications-filter-${filter}`}
                        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain app-scroll app-scroll-y [overflow-anchor:none]"
                        style={n.isError ? { opacity: 0.6 } : undefined}
                        onScroll={(event) => { if (event.currentTarget.scrollTop < 20 && newSince) setNewSince(0); }}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => { const swipe = swipeRef.current; swipeRef.current = null; if (swipe?.timer) clearTimeout(swipe.timer); if (swipe) swipe.el.style.transform = ""; }}
                    >
                        {newSince > 0 ? <button type="button" className="nb-nt-new" onClick={() => { bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }); setNewSince(0); }}><ArrowUp className="size-3.5" aria-hidden="true" />{newSince} new</button> : null}
                        {n.isLoading && n.items.length === 0 && needs.length === 0 ? <NotificationSkeleton /> : empty ? (
                            <div className="nb-nt-empty">
                                <span className="nb-micro">{filter === "unread" ? "All caught up" : "Nothing yet"}</span>
                                <span className="nb-compact text-muted-foreground">{filter === "unread" ? "Nothing needs you, and you’ve seen everything new." : "Notifications about your work, people and organizations show here."}</span>
                                {filter === "unread" ? <button type="button" className="nb-nt-btn mt-1.5" onClick={() => n.setActiveFilter("all")}>See all notifications</button> : null}
                            </div>
                        ) : (
                            <NotificationList
                                filter={filter}
                                now={now}
                                needs={needs}
                                shape={shape}
                                scopeLabel={inScope ? scopeLabel ?? scopeSlug : null}
                                inScope={inScope}
                                handIn={n.handIn}
                                activeKey={null}
                                onAct={n.act}
                                snoozedCount={filter === "unread" && !showSnoozed ? n.snoozed.length : 0}
                                onShowSnoozed={() => setShowSnoozed(true)}
                                {...handlers}
                            />
                        )}
                        {showSnoozed && n.snoozed.length ? (
                            <section aria-label="Snoozed">
                                <div className="nb-nt-label"><span className="nb-micro"><b>Snoozed</b></span><span className="nb-nt-n">{n.snoozed.length}</span></div>
                                {n.snoozed.map((item) => <NotificationRow key={item.id} bundle={{ key: item.id, lead: item, items: [item] }} now={now} {...handlers} />)}
                            </section>
                        ) : null}
                        {n.hasMore ? (
                            <div className="border-t border-border px-4 py-3">
                                <button type="button" className="nb-nt-btn w-full" disabled={n.isLoadingMore} onClick={() => void n.loadMore()}>{n.isLoadingMore ? <><PixelBeat />Loading earlier ones…</> : "Load earlier"}</button>
                            </div>
                        ) : null}
                    </div>
                    <div className="nb-nt-ft">
                        <Link href="/notifications" className="nb-ui-label hover:underline" onClick={() => n.setTrayOpen(false)}>See all</Link>
                        <span className="nb-nt-keys"><span className="nb-nt-kbd">J</span><span className="nb-nt-kbd">K</span><span className="nb-meta">move</span><span className="nb-nt-kbd">E</span><span className="nb-meta">done</span><span className="nb-nt-kbd">?</span></span>
                    </div>
                </Popover.Content>
                </Popover.Portal>
            </Popover.Root>

            <Dialog open={confirmDone} onOpenChange={setConfirmDone}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Mark read notifications done?</DialogTitle>
                        <DialogDescription>{readLoaded ? `${readLoaded} or more read notifications leave the tray.` : "Every read notification leaves the tray."} Unread ones and anything that needs you stay.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter paper>
                        <button type="button" className="nb-nt-btn h-[34px]" onClick={() => setConfirmDone(false)}>Cancel</button>
                        <button type="button" className="nb-nt-btn h-[34px]" data-kind="primary" onClick={() => { setConfirmDone(false); void n.dismissRead(); }}>Mark read ones done</button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Keys in notifications</DialogTitle></DialogHeader>
                    <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 nb-compact">
                        {[["⇧ N", "Open notifications"], ["J K", "Move down and up"], ["↵", "Open"], ["A", "The row’s main button: Accept, Review, Answer"], ["E", "Done"], ["S", "Snooze until tomorrow 9:00"], ["R", "Mark unread"], ["⇧ E", "Done with all read"]].map(([keys, what]) => (
                            <div key={keys} className="contents"><dt className="flex gap-1">{keys!.split(" ").map((k) => <span key={k} className="nb-nt-kbd">{k}</span>)}</dt><dd>{what}</dd></div>
                        ))}
                    </dl>
                </DialogContent>
            </Dialog>
        </>
    );
}
