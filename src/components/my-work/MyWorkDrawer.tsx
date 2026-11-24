"use client";
import { TabMarker } from "@/components/ui/TabMarker";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Inbox, ListChecks, Pin, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useUIStore } from "@/stores/ui-store";
import { queryKeys } from "@/lib/query-keys";
import { getMyWorkSummaryAction } from "@/app/actions/my-work";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { useAuth } from "@/hooks/useAuth";
import { useTypedPath } from "@/components/auth/AuthPanel";
import { useChanged } from "@/hooks/useChanged";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { localDayKey } from "@/lib/workflows/planner";
import { fullDayName, inDay, inkLine, requestsLine, weekColumns, dayName, type DayKey } from "@/lib/my-work/panel";
import MyWorkTasksTab, { type MyWorkWeekItem } from "./MyWorkTasksTab";
import { MyWorkWeek, useMyWeek } from "./MyWorkWeek";
import MyWorkRequestsTab, { type MyWorkWaiting } from "./MyWorkRequestsTab";
import { MyWorkEditor } from "./MyWorkEditor";
import { useDocumentTitlePrefix } from "@/hooks/useDocumentTitlePrefix";

const PIN_KEY = "nb:my-work-pinned";

/** A count chip that settles in when its number changes. */
function Count({ value, hot, label }: { value: number; hot?: boolean; label: string }) {
    const changed = useChanged(value);
    return <span className="nb-mw-n" data-hot={hot || undefined} data-settle={changed || undefined} aria-label={label}>{value > 99 ? "99+" : String(value).padStart(2, "0")}</span>;
}

/** The sidebar's right edge, so the panel opens beside it (0 on phones, where the sidebar is a menu). */
function useSidebarEdge(active: boolean) {
    const [edge, setEdge] = useState(0);
    useEffect(() => {
        if (!active) return;
        const sidebar = document.querySelector<HTMLElement>(".nb-sidebar");
        const measure = () => setEdge(sidebar && getComputedStyle(sidebar).display !== "none" ? Math.round(sidebar.getBoundingClientRect().width) : 0);
        measure();
        if (!sidebar) return;
        const observer = new ResizeObserver(measure);
        observer.observe(sidebar);
        window.addEventListener("resize", measure);
        return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
    }, [active]);
    return edge;
}

/**
 * My work (shell redesign v3): a panel beside the sidebar. The ink head types the path, says what matters in one serif
 * line and shows the week as a hairline strip (a day is the filter); Requests shows who is waiting. Two tab cells, the
 * list, and a footer with Open in editor. Pinned, it stays open while you open tasks and nothing dims.
 */
export default function MyWorkDrawer() {
    const isMyWorkOpen = useUIStore((s) => s.isMyWorkOpen);
    useDocumentTitlePrefix(isMyWorkOpen ? "My work" : null); // unified back R8
    const setMyWorkOpen = useUIStore((s) => s.setMyWorkOpen);
    const activeTab = useUIStore((s) => s.myWorkTab);
    const setActiveTab = useUIStore((s) => s.setMyWorkTab);
    const { pendingConnections } = useNetworkNotifications();
    const { user } = useAuth();
    const edge = useSidebarEdge(isMyWorkOpen);
    const contentRef = useRef<HTMLDivElement>(null);
    const [pinned, setPinned] = useState(false);
    const [day, setDay] = useState<DayKey | null>(null);
    const [week, setWeek] = useState<MyWorkWeekItem[] | null>(null);
    const myWeek = useMyWeek(isMyWorkOpen);
    const inClass = Boolean(myWeek.data?.success && myWeek.data.inClass);
    const [view, setView] = useState<"week" | "list">("week");
    const [finished, setFinished] = useState(0);
    const [handled, setHandled] = useState(0);
    const [load, setLoad] = useState(false);
    const [dir, setDir] = useState<"next" | "prev" | null>(null);
    // The code editor sheet (footer): Esc closes it before the panel.
    const [editorOpen, setEditorOpen] = useState(false);

    useEffect(() => {
        try { setPinned(window.localStorage.getItem(PIN_KEY) === "1"); } catch { /* a per-viewer convenience */ }
    }, []);
    const togglePin = () => setPinned((on) => {
        try { window.localStorage.setItem(PIN_KEY, on ? "0" : "1"); } catch { /* remembered for this visit only */ }
        return !on;
    });

    // Each open: the head drops and the rest rises (once), and the counters start from zero.
    useEffect(() => {
        if (!isMyWorkOpen) return;
        setLoad(true); setFinished(0); setHandled(0); setEditorOpen(false);
        const timer = setTimeout(() => setLoad(false), 900);
        return () => clearTimeout(timer);
    }, [isMyWorkOpen]);

    const { data: summary } = useQuery({
        queryKey: queryKeys.myWork.summary(),
        queryFn: getMyWorkSummaryAction,
        enabled: isMyWorkOpen,
        staleTime: 30_000,
    });
    const taskCount = summary?.success ? summary.taskCount : 0;
    // Project invitations are already included in the workspace summary; only
    // add connection requests from the shared Connections attention source.
    const requestCount = (summary?.success ? summary.requestCount : 0) + pendingConnections;
    const tabs = [
        { id: "tasks" as const, label: "Tasks", icon: ListChecks, count: taskCount },
        { id: "requests" as const, label: "Requests", icon: Inbox, count: requestCount },
    ];

    // Who is waiting, for the Requests head: the Requests tab reports it from the queries it already reads.
    const [waitingNow, setWaitingNow] = useState<MyWorkWaiting | null>(null);
    const waiting = waitingNow?.people ?? [];
    const invitations = waitingNow?.invitations ?? 0;

    const switchTab = useCallback((tab: "tasks" | "requests") => {
        if (tab === activeTab) return;
        setDir(tab === "requests" ? "next" : "prev");
        setActiveTab(tab);
        setTimeout(() => setDir(null), 300);
    }, [activeTab, setActiveTab]);

    const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        const next = tabs[nextIndex]!;
        switchTab(next.id);
        document.getElementById(`workspace-${next.id}-tab`)?.focus();
    };

    // "/" finds; ↑↓ move through tasks, review rows and Next up.
    const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const typing = (event.target as HTMLElement).closest("input, textarea, [contenteditable='true']");
        if (event.key === "/" && !typing) { event.preventDefault(); document.getElementById("nb-mw-q")?.focus(); return; }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !typing && !(event.target as HTMLElement).closest("[role='menu'], [role='tablist']")) {
            const rows = [...(contentRef.current?.querySelectorAll<HTMLElement>(".nb-mw-next [data-done-btn], .nb-mw-open, .nb-mw-body a.nb-mw-item, .nb-mw-body button.nb-mw-item") ?? [])];
            if (!rows.length) return;
            event.preventDefault();
            const at = rows.indexOf(document.activeElement as HTMLElement);
            rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
        }
    };

    const todayKey = localDayKey();
    const items = week ?? [];
    const late = items.filter((t) => t.diff != null && t.diff < 0).length;
    const line = activeTab === "requests"
        ? waitingNow === null ? { em: "", rest: "Checking who is waiting…" } : requestsLine(waiting.length, invitations)
        : week === null ? { em: "", rest: "Gathering your work…" }
        : inkLine({
            late,
            today: items.filter((t) => t.diff === 0).length,
            week: items.filter((t) => t.diff != null && t.diff >= 0 && t.diff < 7).length,
            total: items.length,
            day,
            dayCount: day == null ? 0 : items.filter((t) => inDay(t.diff, day)).length,
            dayName: typeof day === "number" ? fullDayName(todayKey, day) : undefined,
        });
    const dueParam = activeTab === "tasks" && day != null ? `?due=${day === "late" ? "late" : day === 0 ? "today" : dayName(todayKey, day).toLowerCase()}` : "";
    const target = `my-work/${activeTab}${dueParam}`;
    const shown = useTypedPath(target, 22);

    return (
        <DialogPrimitive.Root open={isMyWorkOpen} onOpenChange={setMyWorkOpen} modal={!pinned}>
            <DialogPrimitive.Portal>
                {pinned ? null : <DialogPrimitive.Overlay className="nb-mw-scrim" style={{ ["--nb-mw-left" as string]: `${edge}px` }} />}
                <DialogPrimitive.Content
                    ref={contentRef}
                    data-testid="my-work-drawer"
                    id="my-work-drawer"
                    className="nb-mw"
                    data-load={load || undefined}
                    style={{ ["--nb-mw-left" as string]: `${edge}px` }}
                    onKeyDown={onPanelKeyDown}
                    onEscapeKeyDown={(event) => { if (editorOpen) { event.preventDefault(); setEditorOpen(false); } }}
                    // The panel takes focus itself, so no focus ring lands on a tab when it opens.
                    onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }); }}
                    onCloseAutoFocus={(event) => {
                        const launcher = document.getElementById("my-work-launcher");
                        if (!launcher) return;
                        event.preventDefault();
                        launcher.focus();
                    }}
                    // Pinned, the page stays usable: clicking it doesn't close the panel. A toast's Undo never does.
                    onInteractOutside={(event) => {
                        const target = event.target as HTMLElement | null;
                        if (pinned || target?.closest("[data-sonner-toaster], [data-sonner-toast]")) event.preventDefault();
                    }}
                >
                    <DialogPrimitive.Title className="sr-only">My work</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">Review open work and waiting requests.</DialogPrimitive.Description>

                    <div className="nb-mw-ink">
                        <div className="nb-mw-ink-top">
                            <div className="nb-mw-path" data-typing={shown !== target || undefined} aria-hidden="true">
                                <span>networkbase&nbsp;/&nbsp;</span><b>{shown}</b><span className="nb-mw-caret" />
                            </div>
                            <button type="button" className="nb-mw-ib" aria-pressed={pinned} onClick={togglePin} aria-label="Keep My work open" title={pinned ? "Pinned: stays open while you open tasks" : "Keep open while you work"}>
                                <Pin className="size-[15px]" aria-hidden="true" />
                            </button>
                            <DialogPrimitive.Close className="nb-mw-ib" aria-label="Close My work" title="Close  Esc">
                                <X className="size-[15px]" aria-hidden="true" />
                            </DialogPrimitive.Close>
                        </div>
                        <div className="nb-mw-ink-mid" style={{ ["--n" as string]: 1 }}>
                            <p className="nb-mw-line" aria-live="polite">{line.em ? <em>{line.em}</em> : null}{line.rest}</p>
                            {activeTab === "tasks" ? (
                                <div className="nb-mw-week" role="group" aria-label="This week: pick a day to see what's due">
                                    {weekColumns(todayKey).map(({ key, label }) => {
                                        const due = items.filter((t) => inDay(t.diff, key));
                                        return (
                                            <button key={String(key)} type="button" className="nb-mw-col" data-today={key === 0 || undefined} aria-pressed={day === key} aria-label={`${label}, ${due.length} due`} onClick={() => setDay(day === key ? null : key)}>
                                                <span className="lab">{label}</span>
                                                <span className="nb-mw-px">
                                                    {due.slice(0, 4).map((t, index) => <i key={index} className={t.diff != null && t.diff < 0 ? "late" : t.inReview ? "rev" : undefined} />)}
                                                    {due.length > 4 ? <b>+{due.length - 4}</b> : null}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="nb-mw-faces">
                                    {waiting.length ? (
                                        <>
                                            <span className="stack">{waiting.slice(0, 5).map((person) => <UserAvatar key={person.key} identity={{ id: person.key, fullName: person.name, avatarUrl: person.avatarUrl }} size={26} className="size-[26px]" roundedClassName="rounded-[5px]" />)}</span>
                                            <span className="truncate">{waiting.slice(0, 2).map((person) => person.name.split(" ")[0]).join(", ")}{waiting.length > 2 ? ` +${waiting.length - 2}` : ""}{invitations ? ` · ${invitations} invitation${invitations === 1 ? "" : "s"}` : ""}</span>
                                        </>
                                    ) : invitations ? <span>{invitations} invitation{invitations === 1 ? "" : "s"} to answer</span>
                                        : <span>{handled ? `You answered ${handled} ${handled === 1 ? "request" : "requests"} just now.` : "Nothing waiting on you."}</span>}
                                </div>
                            )}
                        </div>
                    </div>

                    <div role="tablist" aria-label="My work" className="nb-mw-tabs" style={{ ["--n" as string]: 2 }}>
                        {tabs.map((tab, index) => {
                            const Icon = tab.icon;
                            const selected = activeTab === tab.id;
                            return <button
                                key={tab.id}
                                id={`workspace-${tab.id}-tab`}
                                data-testid={`workspace-tab-${tab.id}`}
                                type="button"
                                onClick={() => switchTab(tab.id)}
                                onKeyDown={(event) => onTabKeyDown(event, index)}
                                role="tab"
                                tabIndex={selected ? 0 : -1}
                                aria-selected={selected}
                                aria-controls={`workspace-${tab.id}-panel`}
                                className="nb-mw-tab"
                            >
                                <Icon className="size-4" aria-hidden="true" />
                                <span>{tab.label}</span>
                                <Count value={tab.count} hot={tab.id === "requests" && tab.count > 0} label={tab.id === "tasks" ? `${tab.count} tasks assigned to you` : `${tab.count} pending invitations`} />
                            </button>;
                        })}
                        <TabMarker overlap />
                    </div>

                    <div id={`workspace-${activeTab}-panel`} role="tabpanel" aria-labelledby={`workspace-${activeTab}-tab`} className="nb-mw-body" data-dir={dir ?? undefined}>
                        {activeTab === "tasks" ? (
                            <>
                                {/* B1.7a (report 30.4 call 1): people in a class open on Week; List is today's view, kept mounted for the strip. */}
                                {inClass ? (
                                    <div role="group" aria-label="Show" className="flex gap-1 px-3 pt-2 text-[12px]">
                                        {(["week", "list"] as const).map((v) => (
                                            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                                                className={view === v ? "rounded-sm bg-foreground px-2 py-1 font-semibold text-background" : "rounded-sm px-2 py-1 text-muted-foreground hover:bg-muted"}>{v === "week" ? "Week" : "List"}</button>
                                        ))}
                                    </div>
                                ) : null}
                                {inClass && view === "week" ? <MyWorkWeek keepOpen={pinned} /> : null}
                                <div hidden={inClass && view === "week"}>
                                    <MyWorkTasksTab isActive day={day} onDay={setDay} pinned={pinned} onWeek={setWeek} finished={finished} onFinished={(delta) => setFinished((n) => Math.max(0, n + delta))} meId={user?.id ?? null} />
                                </div>
                            </>
                        ) : (
                            <MyWorkRequestsTab isActive onWaiting={setWaitingNow} onHandled={(delta) => setHandled((n) => Math.max(0, n + delta))} />
                        )}
                    </div>

                    <div className="nb-mw-foot" style={{ ["--n" as string]: 8 }}>
                        <MyWorkEditor open={editorOpen} onOpenChange={setEditorOpen} />
                        <span className="nb-mw-hint" aria-hidden="true">
                            {activeTab === "tasks"
                                ? <><span><b>E</b> done</span><span><b>S</b> start</span><span><b>↑↓</b> move</span></>
                                : <><span><b>←→</b> tabs</span><span><b>Esc</b> close</span></>}
                        </span>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
