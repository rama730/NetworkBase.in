"use client";
import "@/components/notifications/notifications.css";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { SlidersHorizontal, X } from "lucide-react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { LegalLinks } from "@/components/legal/LegalLinks";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { NeedsYouRow } from "@/components/notifications/NeedsYouRow";
import { NotificationRow, snoozePresets } from "@/components/notifications/NotificationRow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterPanel } from "@/components/ui/filter-panel";
import { RailSection } from "@/components/ui/rail-section";
import { SearchField } from "@/components/ui/SearchField";
import { TabMarker } from "@/components/ui/TabMarker";
import {
    actOnNotificationAction,
    dismissNotificationAction,
    markNotificationsSeenAction,
    markNotificationUnreadAction,
    muteNotificationScopeAction,
    readNeedsYouAction,
    readNotificationsAction,
    restoreNotificationAction,
    snoozeNotificationAction,
    updateNotificationPreferencesAction,
} from "@/app/actions/notifications";
import { createTaskCommentAction } from "@/app/actions/task-comment";
import { createWorkspaceUpdateCommentAction } from "@/app/actions/workspace/updates";
import { updateMySettingsAction } from "@/app/actions/workspace/member-journey";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";
import { useNotificationPreferences } from "@/hooks/useSettingsQueries";
import { settingsTabHref } from "@/constants/routes";
import { toast } from "@/lib/feedback";
import type { NeedsYouItem, NotificationAct } from "@/lib/notifications/needs-you";
import { DEFAULT_ORG_NOTIFICATION_CHOICE, formatMinuteOfDay, isNotificationPauseActive, orgChoiceFor } from "@/lib/notifications/preferences";
import { splitTray } from "@/lib/notifications/tray-model";
import type { NotificationBundle } from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationKind } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

type Tab = "needs" | "unread" | "all";
const FAMILIES: Array<{ id: string; label: string; kinds: NotificationKind[] }> = [
    { id: "code", label: "Code", kinds: ["merge_request", "branch_saves"] },
    { id: "tasks", label: "Tasks", kinds: ["task_assigned", "task_reminder", "task_status_attention", "task_comment_mention", "task_comment_reply", "task_report_submitted", "task_file_version", "task_file_replaced", "task_file_needs_review", "file_version_added", "project_task_activity", "project_file_activity"] },
    { id: "people", label: "People", kinds: ["connection_request_received", "connection_request_accepted", "application_received", "application_decision", "project_application_activity", "project_member_joined", "project_member_journey", "chat_invite"] },
    { id: "organizations", label: "Organizations", kinds: ["org_membership", "org_assignment", "org_announcement", "org_credit"] },
    { id: "agents", label: "Agents", kinds: ["agent_question", "agent_access_request", "agent_access_expiring", "agent_session_summary"] },
    { id: "safety", label: "Safety", kinds: ["trust_safety", "project_security_alert"] },
];

/**
 * The notifications page (notifications mix round two): the tray's whole history on Network's frame. Needs you,
 * Unread and All; search, a family filter and a workspace filter; select many to mark done or read; the rail says
 * what's quiet right now and where notifications reach you.
 */
export default function NotificationsPageClient() {
    const queryClient = useQueryClient();
    const stickyRail = useBottomStickyRail();
    const prefsQuery = useNotificationPreferences();
    const prefs = prefsQuery.data;
    const [tab, setTab] = useState<Tab>("needs");
    const [value, setValue] = useState("");
    const [q] = useDebounce(value.trim(), 300);
    const [family, setFamily] = useState<string | null>(null);
    const [projectId, setProjectId] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const now = useMemo(() => new Date(), []);

    const needsQuery = useQuery({
        queryKey: ["notifications", "needs-you"],
        queryFn: async () => {
            const result = await readNeedsYouAction();
            if (!result.success) throw new Error(result.error || "Couldn’t load what needs you");
            return result.items as NeedsYouItem[];
        },
        staleTime: 15_000,
    });
    const kinds = FAMILIES.find((f) => f.id === family)?.kinds;
    const listQuery = useInfiniteQuery({
        queryKey: ["notifications", "page-view", tab, q, family, projectId],
        enabled: tab !== "needs",
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const result = await readNotificationsAction(30, pageParam, { unreadOnly: tab === "unread", q: q || undefined, kinds, projectId: projectId ?? undefined });
            if (!result.success || !result.page) throw new Error(result.error || "Couldn’t load notifications");
            return result.page;
        },
        getNextPageParam: (page) => page.nextCursor ?? undefined,
    });
    const items = useMemo(() => listQuery.data?.pages.flatMap((page) => page.items) ?? [], [listQuery.data]);
    const needs = needsQuery.data ?? [];
    const shape = useMemo(() => splitTray(items, [], tab === "unread" ? "unread" : "all", now), [items, tab, now]);
    const workspaces = useMemo(() => {
        const map = new Map<string, string>();
        for (const item of items) if (item.entityRefs?.projectId && item.preview?.contextLabel) map.set(item.entityRefs.projectId, item.preview.contextLabel);
        return Array.from(map, ([id, label]) => ({ id, label }));
    }, [items]);
    const unreadCount = listQuery.data?.pages[0]?.unreadCount ?? null;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["notifications"] });

    const handlers = {
        onOpen: (item: NotificationItem) => { if (item.href) window.location.assign(item.href); },
        onViewed: (ids: string[]) => { if (ids.length) void markNotificationsSeenAction(ids); },
        onDone: async (item: NotificationItem) => {
            const result = await dismissNotificationAction(item.id);
            if (!result.success) { toast.error(result.error || "Couldn’t mark it done"); return; }
            refresh();
            toast.success("Marked done.", { action: { label: "Undo", onClick: () => void restoreNotificationAction(item.id).then(refresh) }, duration: 5_000 });
        },
        onMarkUnread: async (item: NotificationItem) => { await markNotificationUnreadAction(item.id); refresh(); },
        onSnooze: async (item: NotificationItem, until: string) => { await snoozeNotificationAction(item.id, until); refresh(); },
        onMute: async (_item: NotificationItem, scope: Parameters<typeof muteNotificationScopeAction>[0]) => {
            const result = await muteNotificationScopeAction(scope);
            if (result.success) { toast.success("Turned off."); void prefsQuery.refetch(); }
        },
        onMuteWorkspace: async (item: NotificationItem, until: string | "forever") => {
            if (!item.entityRefs?.projectId) return;
            const result = await updateMySettingsAction(item.entityRefs.projectId, { muteUntil: until });
            if (result.success) toast.success(`${item.preview?.contextLabel ?? "The workspace"} is muted.`);
        },
        onOrgLevel: async (item: NotificationItem, level: "all" | "important" | "off") => {
            const orgId = item.entityRefs?.orgId;
            if (!orgId || !prefs) return;
            const next = { ...prefs, organizations: { ...prefs.organizations, [orgId]: { ...(orgChoiceFor(prefs, orgId) ?? DEFAULT_ORG_NOTIFICATION_CHOICE), level } } };
            const result = await updateNotificationPreferencesAction(next, ["organizations"]);
            if (result.success) { toast.success("Changed."); void prefsQuery.refetch(); }
        },
        onReply: async (item: NotificationItem, text: string) => {
            const refs = item.entityRefs ?? {};
            if (!refs.projectId) return false;
            const parent = refs.parentCommentId ?? refs.commentId ?? null;
            const result = refs.updateId ? await createWorkspaceUpdateCommentAction(refs.projectId, refs.updateId, text, parent)
                : refs.taskId ? await createTaskCommentAction(refs.taskId, refs.projectId, text, parent) : null;
            return Boolean(result?.success);
        },
    };
    const act = async (item: NeedsYouItem, choice: NotificationAct & { questionKey?: string }) => {
        const result = await actOnNotificationAction({ key: item.key, notificationId: item.notificationId ?? undefined }, { act: choice.act, value: choice.value, questionKey: choice.questionKey });
        if (!result.success) { toast.error(result.error || "Couldn’t do that just now"); return false; }
        window.setTimeout(refresh, 1_400);
        return true;
    };

    const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const bulk = async (what: "done" | "read" | "snooze") => {
        const ids = Array.from(selected);
        if (what === "read") await markNotificationsSeenAction(ids);
        else for (const id of ids) {
            if (what === "done") await dismissNotificationAction(id);
            else await snoozeNotificationAction(id, snoozePresets()[1]!.until.toISOString());
        }
        setSelected(new Set());
        refresh();
        toast.success(what === "done" ? `${ids.length} marked done.` : what === "read" ? `${ids.length} marked read.` : `${ids.length} snoozed until tomorrow 9:00.`);
    };

    const selectable = (bundle: NotificationBundle) => (
        <div key={bundle.key + bundle.lead.id} className="flex items-start">
            <span className="pl-3 pt-[22px]"><Checkbox aria-label="Select" checked={selected.has(bundle.lead.id)} onCheckedChange={() => toggle(bundle.lead.id)} /></span>
            <div className="min-w-0 flex-1"><NotificationRow bundle={bundle} now={now} {...handlers} /></div>
        </div>
    );
    const section = (label: string, bundles: NotificationBundle[]) => bundles.length ? (
        <section aria-label={label}>
            <div className="nb-nt-label"><span className="nb-micro"><b>{label}</b></span><span className="nb-nt-n">{bundles.length}</span></div>
            {bundles.map(selectable)}
        </section>
    ) : null;
    const activeFilters = (family ? 1 : 0) + (projectId ? 1 : 0);
    const muted = (prefs?.mutedScopes ?? []).slice(0, 6);
    const quietLabel = prefs?.quietHours?.enabled ? `${formatMinuteOfDay(prefs.quietHours.startMinute)}–${formatMinuteOfDay(prefs.quietHours.endMinute)}` : null;
    const counts: Record<Tab, number | null> = { needs: needs.length, unread: unreadCount, all: null };

    return (
        <div data-scroll-root="route" className="nb-nt h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter bg-background">
            <div className="nb-network-page min-h-full bg-background px-4 sm:px-6">
                <div className="mx-auto w-full max-w-[1240px] pb-8 pt-6">
                    <div className="nb-network-columns">
                        <div className="nb-network-main min-w-0">
                            <h1 className="nb-page-title">Notifications</h1>
                            <p className="nb-body mt-1 text-muted-foreground">Everything that reached you. Read ones stay 90 days, done ones 30.</p>
                            <div className="nb-network-toolbar mt-4 flex min-w-0 flex-wrap-reverse items-start gap-2 border-b border-border">
                                <div className="-mb-px self-end flex max-w-full min-w-0 shrink-0 items-stretch gap-2 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Notifications">
                                    {(["needs", "unread", "all"] as const).map((key) => (
                                        <button key={key} type="button" role="tab" aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => { setTab(key); setSelected(new Set()); }}
                                            className={cn("nb-ui-label inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-2 py-3 transition-colors", tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                                            {key === "needs" ? "Needs you" : key === "unread" ? "Unread" : "All"}
                                            {counts[key] !== null ? <span className="nb-meta"><span aria-hidden="true">{counts[key]}</span><span className="sr-only"> notifications</span></span> : null}
                                        </button>
                                    ))}
                                    <TabMarker overlap />
                                </div>
                                {tab !== "needs" ? (
                                    <div className="nb-network-controls mb-2 flex max-w-full min-w-0 flex-wrap items-center gap-2">
                                        <SearchField value={value} onChange={setValue} label="Search notifications" className="w-64 max-w-full" />
                                        <FilterPanel open={filtersOpen} onOpenChange={setFiltersOpen} activeFilters={activeFilters} onClear={() => { setFamily(null); setProjectId(null); }}
                                            trigger={<Button type="button" variant="outline" aria-haspopup="dialog" className="bg-card pointer-coarse:h-11"><SlidersHorizontal className="size-4" aria-hidden="true" />Filters{activeFilters ? <span className="nb-tab-count">{activeFilters}<span className="sr-only"> active</span></span> : null}</Button>}>
                                            <fieldset>
                                                <legend className="nb-ui-label mb-2">Kind</legend>
                                                {FAMILIES.map((f) => (
                                                    <label key={f.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                                                        <Checkbox checked={family === f.id} onCheckedChange={(on) => setFamily(on === true ? f.id : null)} />
                                                        <span className="nb-compact">{f.label}</span>
                                                    </label>
                                                ))}
                                            </fieldset>
                                            {workspaces.length ? (
                                                <label className="mt-4 flex flex-col gap-2">
                                                    <span className="nb-ui-label">Workspace</span>
                                                    <select className="nb-select" value={projectId ?? ""} onChange={(event) => setProjectId(event.target.value || null)}>
                                                        <option value="">All workspaces</option>
                                                        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                                                    </select>
                                                </label>
                                            ) : null}
                                        </FilterPanel>
                                    </div>
                                ) : null}
                            </div>
                            {activeFilters ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {family ? <button type="button" className="nb-tag inline-flex items-center gap-1" onClick={() => setFamily(null)}>{FAMILIES.find((f) => f.id === family)?.label}<X className="size-3" aria-label="Remove" /></button> : null}
                                    {projectId ? <button type="button" className="nb-tag inline-flex items-center gap-1" onClick={() => setProjectId(null)}>{workspaces.find((w) => w.id === projectId)?.label ?? "Workspace"}<X className="size-3" aria-label="Remove" /></button> : null}
                                </div>
                            ) : null}
                            {selected.size ? (
                                <div className="mt-3 flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-background nb-compact">
                                    <span className="flex-1">{selected.size} selected</span>
                                    <button type="button" className="nb-nt-btn" onClick={() => void bulk("done")}>Done</button>
                                    <button type="button" className="nb-nt-btn" onClick={() => void bulk("read")}>Mark read</button>
                                    <button type="button" className="nb-nt-btn" onClick={() => void bulk("snooze")}>Snooze</button>
                                </div>
                            ) : null}
                            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
                                {tab === "needs" ? (
                                    needsQuery.isLoading ? <p role="status" className="nb-waiting nb-compact p-4 text-muted-foreground"><PixelBeat />Loading what needs you…</p>
                                        : needs.length ? (
                                            <section aria-label="Needs you">
                                                <div className="nb-nt-label"><span className="nb-micro"><b>Needs you</b></span><span className="nb-nt-n" data-tone="act">{needs.length}</span><span className="nb-micro nb-nt-aside">Oldest waiting first</span></div>
                                                {needs.map((item) => item.source === "important" && item.notification
                                                    ? <NotificationRow key={item.key} bundle={{ key: item.key, lead: item.notification, items: [item.notification] }} now={now} {...handlers} />
                                                    : <NeedsYouRow key={item.key} item={item} now={now} onAct={act} />)}
                                            </section>
                                        ) : <div className="nb-nt-empty"><span className="nb-micro">Nothing needs you</span><span className="nb-compact text-muted-foreground">Reviews, requests and questions for you show here until you answer them.</span></div>
                                ) : listQuery.isLoading ? <p role="status" className="nb-waiting nb-compact p-4 text-muted-foreground"><PixelBeat />Loading notifications…</p>
                                    : listQuery.isError ? <div className="nb-nt-note"><span className="flex-1">Couldn’t load notifications.</span><button type="button" className="nb-nt-btn" onClick={() => void listQuery.refetch()}>Retry</button></div>
                                    : items.length === 0 ? <div className="nb-nt-empty"><span className="nb-micro">{q || activeFilters ? "Nothing matches" : tab === "unread" ? "All caught up" : "Nothing yet"}</span><span className="nb-compact text-muted-foreground">{q || activeFilters ? "Try fewer words or clear the filters." : "Notifications about your work, people and organizations show here."}</span></div>
                                    : (
                                        <>
                                            {section(tab === "unread" ? "New" : "Today", shape.fresh)}
                                            {shape.activity ? section("Activity", shape.activity.items.map((item) => ({ key: item.id, lead: item, items: [item] }))) : null}
                                            {section("Earlier", shape.earlier)}
                                        </>
                                    )}
                            </div>
                            {tab !== "needs" && listQuery.hasNextPage ? (
                                <div className="mt-4 flex justify-center"><button type="button" className="nb-nt-btn" disabled={listQuery.isFetchingNextPage} onClick={() => void listQuery.fetchNextPage()}>{listQuery.isFetchingNextPage ? <><PixelBeat />Loading earlier ones…</> : "Load earlier"}</button></div>
                            ) : null}
                            <div className="nb-network-mobile-footer pt-6"><LegalLinks align="start" showCopyright className="text-[11px]" /></div>
                        </div>
                        <aside {...stickyRail} aria-label="About your notifications" className="nb-network-rail sticky self-start space-y-4">
                            <RailSection title="Quiet right now">
                                <ul className="space-y-2 nb-compact">
                                    {prefs && isNotificationPauseActive(prefs) ? <li className="flex justify-between gap-2">Paused<span className="nb-meta">until {new Date(prefs.pausedUntil!).toLocaleString()}</span></li> : null}
                                    {quietLabel ? <li className="flex justify-between gap-2">Quiet hours<span className="nb-meta">{quietLabel}</span></li> : null}
                                    {muted.map((scope) => <li key={`${scope.kind}:${scope.value}`} className="flex justify-between gap-2"><span className="truncate">{scope.label ?? scope.value}</span><span className="nb-meta">off</span></li>)}
                                    {prefs ? Object.entries(prefs.organizations ?? {}).filter(([, choice]) => choice.level !== "all").map(([id, choice]) => <li key={id} className="flex justify-between gap-2"><span className="truncate">An organization</span><span className="nb-meta">{choice.level === "important" ? "important only" : "off"}</span></li>) : null}
                                    {prefs && !isNotificationPauseActive(prefs) && !quietLabel && muted.length === 0 ? <li className="text-muted-foreground">Nothing is muted.</li> : null}
                                </ul>
                                <Link href={settingsTabHref("notifications")} className="nb-nt-btn mt-3">Change in Settings</Link>
                            </RailSection>
                            <RailSection title="Where they reach you">
                                <ul className="space-y-2 nb-compact">
                                    <li className="flex justify-between gap-2">In the app<span className="nb-meta">everything</span></li>
                                    <li className="flex justify-between gap-2">This browser<span className="nb-meta">{prefs?.delivery.browser ? "on" : "off"}</span></li>
                                    <li className="flex justify-between gap-2">Phone push<span className="nb-meta">{prefs?.delivery.push ? "needs you and important" : "off"}</span></li>
                                    <li className="flex justify-between gap-2">Email<span className="nb-meta">{prefs?.delivery.email ? "on" : "off"}</span></li>
                                </ul>
                            </RailSection>
                            <LegalLinks align="start" showCopyright className="text-[11px]" />
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    );
}
