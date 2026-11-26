"use client";

import { MyCommunityEvents } from "@/components/my-work/MyCommunityEvents";
import { TodaysMeetings } from "@/components/my-work/TodaysMeetings";
import { GoalCheckIns } from "@/components/my-work/GoalCheckIns";
import { UpNextLessons } from "@/components/my-work/UpNextLessons";
import { OffsiteInvites } from "@/components/my-work/OffsiteInvites";
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Clock, Copy, ExternalLink, Play, SlidersHorizontal, X } from "lucide-react";
import { readMySubmissionsAction } from "@/app/actions/assignments";
import { webLink } from "@/lib/organizations/assignment-rules";
import { fetchMyWorkTasksAction } from "@/app/actions/my-work";
import { fetchToReviewAction } from "@/app/actions/org-workspace";
import { updateTaskFieldAction, updateTaskStatusAction } from "@/app/actions/task";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore, createMyWorkTaskHandoff, MY_WORK_TASK_HANDOFF_STORAGE_KEY } from "@/stores/ui-store";
import { toast, feedbackError } from "@/lib/feedback";
import { TaskCard } from "@/components/workspaces/v2/tasks/TaskCard";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PixelPlace } from "@/components/ui/PixelPerson";
import { WorkspaceAvatar } from "@/components/workspaces/WorkspaceAvatar";
import { TASK_STATUS_PRESENTATION, type TaskWorkflowStatus } from "@/lib/workspaces/task-workflow";
import { taskDueDateKey } from "@/lib/workspaces/task-presentation";
import { formatTaskId } from "@/lib/workspace-key";
import { localDayKey, projectEnds } from "@/lib/workflows/planner";
import { format, parseISO } from "@/lib/utils/date";
import { addDaysKey, BUCKETS, bucketOf, dayDiff, dayName, dueLabel, inDay, nextMondayOffset, pickNextUp, type DayKey } from "@/lib/my-work/panel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyOrSay } from "@/lib/clipboard";

export type MyWorkTask = Awaited<ReturnType<typeof fetchMyWorkTasksAction>> extends infer Result
    ? Result extends { success: true; tasks: Array<infer Task> } ? Task : never
    : never;

/** What the ink head's week strip needs from the list: when each task is due, and whether it waits in review. */
export type MyWorkWeekItem = { diff: number | null; inReview: boolean };

interface MyWorkTasksTabProps {
    isActive?: boolean;
    /** The day picked in the ink head's week (Late, today, +1…+6), or none. */
    day?: DayKey | null;
    onDay?: (day: DayKey | null) => void;
    /** Pinned: opening a task keeps My work open. */
    pinned?: boolean;
    onWeek?: (items: MyWorkWeekItem[]) => void;
    /** How many tasks you finished in this panel ("You finished 3 tasks"). */
    finished?: number;
    onFinished?: (delta: number) => void;
    /** The signed-in person, to tell your tasks from the team's. */
    meId?: string | null;
}

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const OPEN_STATUSES: TaskWorkflowStatus[] = ["todo", "in_progress", "blocked"];
type MyWorkScope = "my" | "team" | "all";
type MyWorkStatusFilter = "all" | "overdue" | "missing" | (typeof OPEN_STATUSES)[number];
type Shown = "review" | TaskWorkflowStatus;
type Override = { status?: TaskWorkflowStatus; due?: string | null };

// Status in pixels: an empty box, a half box, a crossed box, a box with a dot, a tick.
const STATUS_PIXELS: Record<Shown, string[]> = {
    todo: ["######", "#....#", "#....#", "#....#", "#....#", "######"],
    in_progress: ["######", "###..#", "###..#", "###..#", "###..#", "######"],
    blocked: ["######", "##..##", "#.##.#", "#.##.#", "##..##", "######"],
    review: ["######", "#....#", "#.##.#", "#.##.#", "#....#", "######"],
    done: ["......", ".....#", "....##", "#..##.", "####..", ".##..."],
};
const STATUS_WORDS: Record<Shown, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", review: "In review", done: "Done" };

export function StatusPixels({ status }: { status: Shown }) {
    return (
        <span className="nb-mw-st" data-s={status} aria-hidden="true">
            <svg viewBox="0 0 6 6" shapeRendering="crispEdges">
                {STATUS_PIXELS[status].flatMap((row, y) => [...row].map((bit, x) => (bit === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
            </svg>
        </span>
    );
}

function MyWorkTasksSkeleton() {
    return (
        <div className="grid gap-1" aria-busy="true" aria-label="Loading your tasks">
            {[60, 72, 48, 66, 54].map((width) => (
                <div key={width} className="nb-mw-ghost">
                    <div aria-hidden="true" className="nb-skeleton h-3 w-3 rounded-[2px]" />
                    <div aria-hidden="true" className="nb-skeleton h-3 rounded-[3px]" style={{ width: `${width}%` }} />
                    <div aria-hidden="true" className="nb-skeleton h-3 w-11 rounded-[3px]" />
                </div>
            ))}
        </div>
    );
}

/** The task's place: its workspace picture or default figure, tiny. */
function MiniPlace({ task }: { task: MyWorkTask }) {
    const project = task.project;
    if (!project) return null;
    return <WorkspaceAvatar project={{ id: project.id, title: project.title, coverImage: project.coverImage ?? null, kind: project.kind }} parentId={project.parentId ?? null} size="row" className="size-[14px] rounded-[3px] border-0 ring-0" />;
}

/** "From Ms. Rao", Missing / Late / Returned and the team on assignment copies (report §29.2), as quiet tags. */
function OrgTags({ task }: { task: MyWorkTask }) {
    if (!task.org) return null;
    return (
        <>
            {task.org.fromName ? <span className="truncate">From {task.org.fromName}</span> : null}
            {task.org.teamName ? <span className="nb-mw-tag">{task.org.teamName}</span> : null}
            {task.org.copyState === "missing" ? <span className="nb-mw-tag" data-tone="bad">Missing</span>
                : task.org.copyState === "returned" ? <span className="nb-mw-tag">Returned</span>
                : task.org.late ? <span className="nb-mw-tag" data-tone="bad">Late</span> : null}
        </>
    );
}

function MoveMenu({ trigger, onMove, todayKey, align = "end" }: { trigger: React.ReactNode; onMove: (offset: number | null) => void; todayKey: string; align?: "start" | "end" }) {
    const monday = nextMondayOffset(todayKey);
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="z-[202] w-48">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onMove(0)}>Today<span className="nb-mw-when ml-auto">{dayName(todayKey, 0)}</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(1)}>Tomorrow<span className="nb-mw-when ml-auto">{dayName(todayKey, 1)}</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(monday)}>Next week<span className="nb-mw-when ml-auto">Mon</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove(null)}>No date</DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default function MyWorkTasksTab({ isActive = true, day = null, onDay, pinned = false, onWeek, finished = 0, onFinished, meId = null }: MyWorkTasksTabProps) {
    const router = useRouter();
    const queryClient = useQueryClient();
    const isMyWorkOpen = useUIStore((s) => s.isMyWorkOpen);
    const setMyWorkOpen = useUIStore((s) => s.setMyWorkOpen);
    const setMyWorkTaskHandoff = useUIStore((s) => s.setMyWorkTaskHandoff);
    // The workspace is a cross-project overview: do not hide team work just
    // because the viewer has no personal assignment in that project.
    const [scope, setScope] = useState<MyWorkScope>("all");
    const [status, setStatus] = useState<MyWorkStatusFilter>("all");
    // Organization filter (All · Personal · each org) and the review / hand-in views (report §29.2).
    const [orgFilter, setOrgFilter] = useState<string>("all");
    const [lens, setLens] = useState<"review" | "submitted" | null>(null);
    const [group, setGroup] = useState<"time" | "workspace">("time");
    const [density, setDensity] = useState<"rows" | "cards">("rows");
    const [search, setSearch] = useState("");
    const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [isNavigating, setIsNavigating] = useState(false);
    // Optimistic edits made here (status, due date) until the list refetches; rows finishing and rows just handed to you.
    const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
    const [leaving, setLeaving] = useState<Set<string>>(new Set());
    const [gone, setGone] = useState<Set<string>>(new Set());
    const [fading, setFading] = useState<Set<string>>(new Set());
    const [fresh, setFresh] = useState<Set<string>>(new Set());
    const [nextSwap, setNextSwap] = useState(false);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const seenRef = useRef<Set<string> | null>(null);
    const deferredSearch = useDeferredValue(search);
    const todayKey = localDayKey();

    useEffect(() => {
        // A blocked navigation must not leave the launcher permanently inert
        // when the user reopens it.
        if (!isMyWorkOpen) setIsNavigating(false);
    }, [isMyWorkOpen]);

    // Fetch tasks, enabled ONLY when drawer is open and tab is active
    const query = useQuery({
        queryKey: queryKeys.myWork.tasks(scope, limit),
        queryFn: () => fetchMyWorkTasksAction(limit, scope),
        enabled: isMyWorkOpen && isActive,
        staleTime: 30_000,
    });
    const { data, isLoading, error } = query;
    const reviewQuery = useQuery({
        queryKey: queryKeys.myWork.toReview(),
        queryFn: () => fetchToReviewAction(),
        enabled: isMyWorkOpen && isActive,
        staleTime: 30_000,
    });
    const toReview = reviewQuery.data ?? [];
    // Decision 68: what they've handed in, with Download.
    const submissions = useQuery({ queryKey: ["my-submissions"], queryFn: () => readMySubmissionsAction(), enabled: isMyWorkOpen && isActive, staleTime: 30_000 });
    const handedIn = submissions.data?.success ? submissions.data.rows : [];

    // Infinite auto-scroll sentinel
    useEffect(() => {
        if (!sentinelRef.current || !data?.hasMore || limit >= MAX_PAGE_SIZE || isLoading) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE));
            }
        }, { rootMargin: "200px" });
        observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, [data?.hasMore, limit, isLoading]);

    // Every task, with what the panel reads from it: days to due, yours or the team's, the status it shows.
    const tasks = useMemo(() => (data?.tasks ?? []).filter((task) => !gone.has(task.id)).map((task) => {
        const local = overrides.get(task.id);
        const dueKey = local && "due" in local ? local.due ?? null : taskDueDateKey(task.dueDate as string | null);
        const status = (local?.status ?? task.status) as TaskWorkflowStatus;
        const inReview = task.reviewStatus === "pending" && !local?.status;
        const shown: Shown = leaving.has(task.id) ? "done" : inReview ? "review" : status;
        const mine = Boolean(meId && (task.assigneeId === meId || task.assignee?.id === meId));
        return { task, dueKey, diff: dayDiff(dueKey, todayKey), status, inReview, shown, mine };
    }), [data?.tasks, gone, overrides, leaving, meId, todayKey]);

    // A task someone just handed you slides in with a NEW tag (not on the first load).
    useEffect(() => {
        if (!data?.tasks) return;
        const ids = data.tasks.map((task) => task.id);
        if (seenRef.current) {
            const added = ids.filter((id) => !seenRef.current!.has(id));
            if (added.length) {
                setFresh((prev) => new Set([...prev, ...added]));
                setTimeout(() => setFresh((prev) => { const next = new Set(prev); added.forEach((id) => next.delete(id)); return next; }), 6000);
                ids.forEach((id) => seenRef.current!.add(id));
            }
        } else seenRef.current = new Set(ids);
    }, [data?.tasks]);

    // The ink head's week strip reads the same list.
    useEffect(() => {
        onWeek?.(tasks.filter((t) => !leaving.has(t.task.id)).map((t) => ({ diff: t.diff, inReview: t.inReview })));
    }, [tasks, leaving, onWeek]);

    const orgOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const { task } of tasks) if (task.org?.id && !seen.has(task.org.id)) seen.set(task.org.id, task.org.context.split(" / ")[0]!);
        return [...seen.entries()];
    }, [tasks]);

    const filtered = Boolean(deferredSearch.trim() || status !== "all" || orgFilter !== "all" || scope !== "all" || day != null || lens);
    const visibleTasks = useMemo(() => {
        const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();
        return tasks.filter(({ task, diff, status: current }) => {
            if (orgFilter === "personal" ? Boolean(task.org?.id) : orgFilter !== "all" && task.org?.id !== orgFilter) return false;
            if (status === "missing" && task.org?.copyState !== "missing") return false;
            if (status === "overdue" && !(diff != null && diff < 0)) return false;
            if (OPEN_STATUSES.includes(status as TaskWorkflowStatus) && current !== status) return false;
            if (day != null && !inDay(diff, day)) return false;
            return !normalizedSearch
                || task.title.toLocaleLowerCase().includes(normalizedSearch)
                || task.project?.title?.toLocaleLowerCase().includes(normalizedSearch)
                || Boolean(task.org?.context?.toLocaleLowerCase().includes(normalizedSearch));
        });
    }, [deferredSearch, status, tasks, orgFilter, day]);
    const nextUp = useMemo(() => (filtered ? null : pickNextUp(tasks.filter((t) => !leaving.has(t.task.id) && t.task.itemType !== "project"))), [filtered, tasks, leaving]);
    const listed = visibleTasks.filter((t) => t.task.id !== nextUp?.task.id);

    const groups = useMemo(() => {
        const grouped = new Map<string, { id: string; slug: string | null; title: string; project: MyWorkTask["project"]; items: typeof listed }>();
        for (const item of listed) {
            const project = item.task.project || { id: "unknown", slug: null, title: "Workspace", key: "TASK" };
            const entry = grouped.get(project.id) ?? { id: project.id, slug: project.slug ?? null, title: item.task.org?.context || project.title || "Workspace", project: item.task.project, items: [] };
            entry.items.push(item);
            grouped.set(project.id, entry);
        }
        // Keep the API's urgency-aware task order when grouping,
        // rather than re-sorting projects alphabetically and burying work that
        // needs attention.
        return Array.from(grouped.values());
    }, [listed]);

    if (isLoading) {
        return <MyWorkTasksSkeleton />;
    }

    if (error || (data && !data.success)) {
        return (
            <div className="nb-mw-error">
                Couldn’t load your tasks. Check your connection and try again.
                <button type="button" onClick={() => void query.refetch()}>Try again</button>
            </div>
        );
    }

    const projectOf = (task: MyWorkTask) => ({ projectId: task.project?.id || task.projectId, identifier: task.project?.slug || task.project?.id || task.projectId });

    const handleTaskClick = (task: MyWorkTask) => {
        if (isNavigating) return;
        const { projectId, identifier: projectIdentifier } = projectOf(task);
        if (!projectId || !projectIdentifier) return;

        setIsNavigating(true);
        const handoff = createMyWorkTaskHandoff(projectId, task.id);
        setMyWorkTaskHandoff(handoff);
        // The navigation can remount the client runtime. Preserve this one
        // transition in the browser session while keeping the URL clean.
        try {
            window.sessionStorage.setItem(
                MY_WORK_TASK_HANDOFF_STORAGE_KEY,
                JSON.stringify(handoff),
            );
        } catch {
            // In-memory handoff still covers browsers with blocked storage.
        }
        // Router.push is sufficient here. A prefetch immediately
        // followed by a navigation has no user-visible benefit and competes
        // with the task surface's own data request.
        router.push(`/workspaces/${projectIdentifier}?tab=tasks`);
        // Pinned, My work stays open beside the task.
        if (pinned) setTimeout(() => setIsNavigating(false), 600);
        else setMyWorkOpen(false);
    };

    const handleCopyTaskLink = (task: MyWorkTask) => {
        const url = `${window.location.origin}/workspaces/${projectOf(task).identifier}?tab=tasks`;
        // A failed copy used to say "copied" too; it says so now.
        copyOrSay(url, () => toast.success("Task link copied"));
    };

    const handleOpenTaskInNewTab = (task: MyWorkTask) => {
        window.open(`/workspaces/${projectOf(task).identifier}?tab=tasks`, "_blank", "noopener,noreferrer");
    };

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.myWork.root() });
    };
    const setOverride = (id: string, value: Override | null) => setOverrides((prev) => {
        const next = new Map(prev);
        if (value) next.set(id, { ...next.get(id), ...value }); else next.delete(id);
        return next;
    });

    /** Finish work in place: the row ticks, then leaves; Next up brings in the next one. Undo puts it back. */
    const changeStatus = async (task: MyWorkTask, to: TaskWorkflowStatus, quiet = false) => {
        const { projectId } = projectOf(task);
        if (!projectId) return;
        const from = (overrides.get(task.id)?.status ?? task.status) as TaskWorkflowStatus;
        if (from === to) return;
        const wasNext = nextUp?.task.id === task.id;
        if (to === "done") {
            setLeaving((prev) => new Set(prev).add(task.id));
            if (wasNext) setNextSwap(true);
            onFinished?.(1);
        } else setOverride(task.id, { status: to });
        const result = await updateTaskStatusAction(task.id, to, projectId);
        if (!result.success) {
            setLeaving((prev) => { const next = new Set(prev); next.delete(task.id); return next; });
            setOverride(task.id, null);
            if (to === "done") onFinished?.(-1);
            toast.error(feedbackError(result.error ?? "Couldn’t change the status", "Couldn’t change the status"));
            return;
        }
        if (to === "done") {
            // The row shows its tick, slides out, then leaves the list.
            setTimeout(() => setFading((prev) => new Set(prev).add(task.id)), 600);
            setTimeout(() => {
                setGone((prev) => new Set(prev).add(task.id));
                setLeaving((prev) => { const next = new Set(prev); next.delete(task.id); return next; });
                setFading((prev) => { const next = new Set(prev); next.delete(task.id); return next; });
                setNextSwap(false);
                refresh();
            }, 920);
        } else refresh();
        if (quiet) return;
        toast.success(to === "done" ? `Done: ${task.title}` : `${formatKey(task) ?? "Task"} is ${STATUS_WORDS[to].toLowerCase()}`, {
            action: {
                label: "Undo",
                onClick: () => {
                    setGone((prev) => { const next = new Set(prev); next.delete(task.id); return next; });
                    if (to === "done") onFinished?.(-1);
                    setOverride(task.id, { status: from });
                    void updateTaskStatusAction(task.id, from, projectId).then((undone) => {
                        if (!undone.success) toast.error(feedbackError(undone.error ?? "Couldn’t undo", "Couldn’t undo"));
                        refresh();
                    });
                },
            },
        });
    };

    const moveTask = async (task: MyWorkTask, offset: number | null) => {
        const { projectId } = projectOf(task);
        if (!projectId) return;
        const before = overrides.get(task.id)?.due !== undefined ? overrides.get(task.id)!.due ?? null : taskDueDateKey(task.dueDate as string | null);
        const to = offset == null ? null : addDaysKey(todayKey, offset);
        setOverride(task.id, { due: to });
        const result = await updateTaskFieldAction(task.id, "dueDate", to, projectId);
        if (!result.success) {
            setOverride(task.id, null);
            toast.error(feedbackError(result.error ?? "Couldn’t move it", "Couldn’t move it"));
            return;
        }
        refresh();
        toast.success(`Moved to ${offset == null ? "no date" : dueLabel(offset, todayKey).toLowerCase()}`, {
            action: {
                label: "Undo",
                onClick: () => {
                    setOverride(task.id, { due: before });
                    void updateTaskFieldAction(task.id, "dueDate", before, projectId).then(refresh);
                },
            },
        });
    };

    const toggleProjectCollapse = (projectId: string) => {
        setCollapsedProjects((prev) => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
            }
            return next;
        });
    };

    const resetScope = (nextScope: MyWorkScope) => {
        setScope(nextScope);
        setLimit(PAGE_SIZE);
    };
    const clearAll = () => { resetScope("all"); setStatus("all"); setOrgFilter("all"); setSearch(""); setLens(null); onDay?.(null); };

    const menuOn = scope !== "all" || status !== "all" || orgFilter !== "all";
    const taskFiltersMenu = (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <button type="button" className="nb-mw-fbtn" data-on={menuOn} aria-label="Filter tasks" title="Filter and group">
                    <SlidersHorizontal className="size-3.5" aria-hidden="true" />View
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[202] w-60">
                <DropdownMenuLabel>Show tasks</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={scope} onValueChange={(value) => resetScope(value as MyWorkScope)}>
                    <DropdownMenuRadioItem value="all">All open tasks</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="my">Assigned to me</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="team">Team tasks</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={status} onValueChange={(value) => setStatus(value as MyWorkStatusFilter)}>
                    <DropdownMenuRadioItem value="all">Any status</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="overdue">Overdue</DropdownMenuRadioItem>
                    {OPEN_STATUSES.map((value) => <DropdownMenuRadioItem key={value} value={value}>{TASK_STATUS_PRESENTATION[value]?.label ?? value}</DropdownMenuRadioItem>)}
                    <DropdownMenuRadioItem value="missing">Missing hand-ins</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {orgOptions.length > 0 ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Organization</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={orgFilter} onValueChange={setOrgFilter}>
                            <DropdownMenuRadioItem value="all">Everywhere</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="personal">Personal workspaces</DropdownMenuRadioItem>
                            {orgOptions.map(([id, title]) => <DropdownMenuRadioItem key={id} value={id}>{title}</DropdownMenuRadioItem>)}
                        </DropdownMenuRadioGroup>
                    </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Group</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={group} onValueChange={(value) => setGroup(value as "time" | "workspace")}>
                    <DropdownMenuRadioItem value="time">By time</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="workspace">By workspace</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Show as</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={density} onValueChange={(value) => setDensity(value as "rows" | "cards")}>
                    <DropdownMenuRadioItem value="rows">List</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="cards">Cards</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );

    const tools = (
        <label className="nb-mw-search" style={{ ["--n" as string]: 1 }}>
            <SearchIcon />
            <input id="nb-mw-q" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks or workspaces" aria-label="Search tasks or workspaces" />
            <kbd aria-hidden="true">/</kbd>
            {taskFiltersMenu}
        </label>
    );

    const chips: Array<[string, string, () => void]> = [];
    if (scope !== "all") chips.push(["scope", scope === "my" ? "Assigned to me" : "Team tasks", () => resetScope("all")]);
    if (status !== "all") chips.push(["status", status === "overdue" ? "Overdue" : status === "missing" ? "Missing hand-ins" : TASK_STATUS_PRESENTATION[status]?.label ?? status, () => setStatus("all")]);
    if (orgFilter !== "all") chips.push(["organization", orgFilter === "personal" ? "Personal workspaces" : orgOptions.find(([id]) => id === orgFilter)?.[1] ?? "Organization", () => setOrgFilter("all")]);
    if (search.trim()) chips.push(["search", `“${search.trim()}”`, () => setSearch("")]);
    const chipRow = chips.length ? (
        <div className="nb-mw-filters" style={{ ["--n" as string]: 2 }}>
            <span>Filtered:</span>
            {chips.map(([key, label, clear]) => <span key={key} className="nb-mw-chip">{label}<button type="button" onClick={clear} aria-label={`Clear ${key} filter`}><X className="size-3" aria-hidden="true" /></button></span>)}
            {chips.length > 1 ? <button type="button" className="nb-mw-link" onClick={clearAll}>Clear all</button> : null}
        </div>
    ) : null;

    const dueTone = (diff: number | null) => (diff == null ? undefined : diff < 0 ? "late" : diff === 0 ? "today" : undefined);
    const formatKey = (task: MyWorkTask) => (task.taskNumber && (task.projectKey || task.project?.key) ? formatTaskId(task.projectKey || task.project?.key, task.taskNumber) : null);

    const row = (item: (typeof tasks)[number], inGroup = false) => {
        const { task, diff, shown, mine } = item;
        const key = formatKey(task);
        const isLeaving = leaving.has(task.id);
        return (
            <div
                key={task.id}
                className={cn("nb-mw-task", fading.has(task.id) && "nb-mw-gone")}
                data-task={task.id}
                data-done={isLeaving || undefined}
                data-new={fresh.has(task.id) || undefined}
                onKeyDown={(event) => {
                    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return;
                    if (event.key === "e" || event.key === "E") { event.preventDefault(); void changeStatus(task, "done"); }
                    if (event.key === "s" || event.key === "S") { event.preventDefault(); void changeStatus(task, "in_progress"); }
                }}
                {...swipeHandlers(task)}
            >
                {item.inReview ? (
                    <button type="button" className="nb-mw-stb" disabled aria-label="In review" title="In review: waiting for a decision"><StatusPixels status="review" /></button>
                ) : (
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <button type="button" className="nb-mw-stb" aria-label={`Status: ${STATUS_WORDS[shown]}. Change status`} title={STATUS_WORDS[shown]}><StatusPixels status={shown} /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="z-[202] w-48">
                            <DropdownMenuRadioGroup value={item.status} onValueChange={(value) => void changeStatus(task, value as TaskWorkflowStatus)}>
                                {(["todo", "in_progress", "blocked", "done"] as const).map((value) => (
                                    <DropdownMenuRadioItem key={value} value={value}><StatusPixels status={value} />{STATUS_WORDS[value]}</DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                <button type="button" className="nb-mw-open" onClick={() => handleTaskClick(task)}>
                    <b>{task.title}</b>
                    <span>
                        {inGroup ? null : <><MiniPlace task={task} /><span className="nb-mw-wsn">{task.org?.context || task.project?.title || "Workspace"}</span>{key ? " · " : ""}</>}
                        {key}
                        {inGroup ? ` · ${STATUS_WORDS[shown]}` : null}
                        {fresh.has(task.id) ? <span className="nb-mw-tag" data-tone="new">New</span> : null}
                        {/* A2.6: a request that needs you says why. */}
                        {task.needsYou ? <span className="nb-mw-tag" data-testid="my-work-needs-you">{task.needsYou === "waiting" ? "Waiting on you" : "Did this solve it?"}</span> : null}
                        <OrgTags task={task} />
                    </span>
                </button>
                <span className="nb-mw-due" data-tone={dueTone(diff)}>
                    {/* A1.5: a project of yours says when it ends ("Ends Friday" this week). */}
                    {task.itemType === "project" && item.dueKey && diff != null && diff >= 0 ? projectEnds(item.dueKey, todayKey) ?? `Ends ${dueLabel(diff, todayKey)}` : dueLabel(diff, todayKey)}
                </span>
                {mine || !task.assignee ? null : (
                    <span title={task.assignee.fullName ?? undefined}>
                        <UserAvatar identity={{ fullName: task.assignee.fullName, avatarUrl: task.assignee.avatarUrl }} size={20} className="size-5" roundedClassName="rounded-[4px]" fallbackClassName="text-[10px]" />
                    </span>
                )}
                <span className="nb-mw-tools">
                    <MoveMenu todayKey={todayKey} onMove={(offset) => void moveTask(task, offset)} trigger={<button type="button" title="Move to…" aria-label="Move to…"><Clock className="size-3.5" aria-hidden="true" /></button>} />
                    <button type="button" onClick={() => handleCopyTaskLink(task)} title="Copy task link" aria-label="Copy task link"><Copy className="size-3.5" aria-hidden="true" /></button>
                    <button type="button" onClick={() => handleOpenTaskInNewTab(task)} title="Open task in new tab" aria-label="Open task in new tab"><ExternalLink className="size-3.5" aria-hidden="true" /></button>
                </span>
                {isLeaving ? <span className="sr-only" role="status">Done</span> : null}
            </div>
        );
    };

    // Touch: swipe a row right to finish it, left to move it to tomorrow.
    function swipeHandlers(task: MyWorkTask) {
        let start: { x: number; y: number } | null = null;
        let dx = 0;
        const reset = (el: HTMLElement) => { el.style.transform = ""; delete el.dataset.swipe; };
        return {
            onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => { if (event.pointerType !== "mouse") { start = { x: event.clientX, y: event.clientY }; dx = 0; } },
            onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                if (!start) return;
                dx = event.clientX - start.x;
                if (Math.abs(event.clientY - start.y) > 24 && Math.abs(dx) < 24) { start = null; reset(event.currentTarget); return; }
                event.currentTarget.style.transform = `translateX(${Math.max(-90, Math.min(90, dx))}px)`;
                event.currentTarget.dataset.swipe = dx > 30 ? "right" : dx < -30 ? "left" : "";
            },
            onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
                if (!start) return;
                start = null; reset(event.currentTarget);
                if (dx > 70) void changeStatus(task, "done"); else if (dx < -70) void moveTask(task, 1);
            },
            onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => { start = null; reset(event.currentTarget); },
        };
    }

    const back = (title: string) => (
        <div className="nb-mw-sec-h" style={{ ["--n" as string]: 2 }}>
            <button type="button" className="nb-mw-back" onClick={() => setLens(null)}>← All tasks</button>{title}
        </div>
    );

    if (lens === "submitted") {
        return (
            <>
                {tools}
                {back("Handed in")}
                <ul className="nb-mw-list" aria-label="Handed in" style={{ ["--n" as string]: 3 }}>
                    {submissions.data?.success && handedIn.length === 0 ? <li className="nb-mw-sub px-1">Nothing handed in yet.</li> : null}
                    {handedIn.map((row) => (
                        <li key={row.copyId} className="nb-mw-item">
                            <span className="nb-mw-icon"><StatusPixels status="done" /></span>
                            <span className="min-w-0"><b>{row.title}</b><span className="nb-mw-sub">{row.org} · Version {row.version} · {row.state === "waiting" ? "Waiting for review" : row.state === "approved" ? "Approved" : row.state === "returned" ? "Returned" : row.state}</span></span>
                            <span className="nb-mw-when">{format(parseISO(row.at), "MMM d")}</span>
                            {row.files.length || webLink(row.link) ? (
                                <span className="links">
                                    {row.files.map((f) => <a key={f.nodeId} href={`/api/v1/workspaces/${row.projectId}/files/${f.nodeId}/preview?download=1`}>Download {f.name}</a>)}
                                    {webLink(row.link) ? <a href={webLink(row.link)!} target="_blank" rel="noreferrer noopener">Open link</a> : null}
                                </span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </>
        );
    }
    if (lens === "review") {
        return (
            <>
                {tools}
                {back("To review")}
                <ul className="nb-mw-list" aria-label="Submissions to review" style={{ ["--n" as string]: 3 }}>
                    {toReview.map((row) => (
                        <li key={row.id}>
                            <Link href={row.href} onClick={() => { if (!pinned) setMyWorkOpen(false); }} className="nb-mw-item">
                                <span className="nb-mw-icon"><StatusPixels status="review" /></span>
                                <span className="min-w-0"><b>{row.who}</b><span className="nb-mw-sub">{row.title} · {row.context}</span></span>
                                {row.submittedAt ? <span className="nb-mw-when">{format(parseISO(row.submittedAt), "MMM d")}</span> : <span />}
                            </Link>
                        </li>
                    ))}
                </ul>
            </>
        );
    }

    const open = tasks.filter((t) => !leaving.has(t.task.id));
    if (!open.length && !data?.hasMore) {
        return (
            <>
                {tools}
                <div className="nb-empty-state nb-grid-ground nb-mw-empty nb-mw-caught" style={{ ["--n" as string]: 3 }}>
                    <span className="nb-mw-fig"><PixelPlace kind="workspace" identityKey="my-work-clear" size={54} /></span>
                    <b>{finished ? `You finished ${finished} ${finished === 1 ? "task" : "tasks"}` : "No open tasks"}</b>
                    <span>{scope === "my" ? "Nothing is assigned to you right now." : scope === "team" ? "No other team tasks are open."  : "New tasks land here the moment someone hands you one."}</span>
                </div>
            </>
        );
    }

    const nextCard = nextUp ? (() => {
        const { task, diff } = nextUp;
        const key = formatKey(task);
        return (
            <section className="nb-mw-next" aria-label="Next up" data-swap={nextSwap || undefined} style={{ ["--n" as string]: 2 }}>
                <div className="nb-mw-next-in" key={task.id}>
                    <div className="nb-mw-next-k"><span>Next up</span><span className="nb-mw-due" data-tone={dueTone(diff)}>{dueLabel(diff, todayKey) || "No date"}</span></div>
                    <h3>{task.title}</h3>
                    <div className="meta">
                        <span className="ws"><MiniPlace task={task} /><span className="truncate">{task.org?.context || task.project?.title}</span></span>
                        {key ? <span>{key}</span> : null}
                        <span>{STATUS_WORDS[nextUp.shown]}</span>
                    </div>
                    <div className="nb-mw-acts">
                        <Button size="sm" data-done-btn onClick={() => void changeStatus(task, "done")}><Check className="size-3.5" aria-hidden="true" />Mark done</Button>
                        {nextUp.status === "todo" ? <Button size="sm" variant="outline" onClick={() => void changeStatus(task, "in_progress")}><Play className="size-3.5" aria-hidden="true" />Start</Button> : null}
                        <Button size="sm" variant="outline" onClick={() => handleTaskClick(task)}>Open</Button>
                        <MoveMenu todayKey={todayKey} align="start" onMove={(offset) => void moveTask(task, offset)} trigger={<Button size="sm" variant="ghost" className="text-muted-foreground"><Clock className="size-3.5" aria-hidden="true" />Move to…</Button>} />
                    </div>
                </div>
            </section>
        );
    })() : null;

    const timeSections = BUCKETS.map(({ id, label }, index) => {
        const items = listed.filter((t) => bucketOf(t.diff) === id).sort((a, b) => (a.diff ?? 9_999) - (b.diff ?? 9_999));
        if (!items.length) return null;
        return (
            <section key={id} className="nb-mw-sec" style={{ ["--n" as string]: index + 3 }}>
                <div className="nb-mw-sec-h" data-tone={id === "late" ? "late" : undefined}>{label} · <b>{items.length}</b></div>
                {items.map((item) => row(item))}
            </section>
        );
    });

    const workspaceGroups = groups.map((group, index) => {
        const isCollapsed = collapsedProjects.has(group.id);
        return (
            <section key={group.id} className="nb-mw-sec" style={{ ["--n" as string]: index + 3 }}>
                <div className="nb-mw-ghead" data-open={!isCollapsed}>
                    <button type="button" className="tg" onClick={() => toggleProjectCollapse(group.id)} aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.title} tasks`}><ChevronDown className="size-3.5" aria-hidden="true" /></button>
                    {group.items[0] ? <MiniPlace task={group.items[0].task} /> : <span />}
                    <b title={group.title}>{group.title}<span className="cnt">{group.items.length}</span></b>
                    <Link href={`/workspaces/${group.slug || group.id}?tab=tasks`} onClick={() => { if (!pinned) setMyWorkOpen(false); }} className="nb-mw-go" aria-label={`Open ${group.title} tasks`}>Open →</Link>
                </div>
                {isCollapsed ? null : <div className="nb-mw-kids">{group.items.map((item) => row(item, true))}</div>}
            </section>
        );
    });

    const cards = (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" style={{ ["--n" as string]: 3 }}>
            {listed.map(({ task }) => <TaskCard key={task.id} task={task} onClick={() => handleTaskClick(task)} />)}
        </div>
    );

    const orgWork = !filtered && (toReview.length > 0 || handedIn.length > 0) ? (
        <section className="nb-mw-sec" style={{ ["--n" as string]: 9 }}>
            <div className="nb-mw-sec-h">Organization work</div>
            <div className="nb-mw-list">
                {toReview.length > 0 ? (
                    <button type="button" className="nb-mw-item" onClick={() => setLens("review")}>
                        <span className="nb-mw-icon"><StatusPixels status="review" /></span>
                        <span className="min-w-0"><b>To review</b><span className="nb-mw-sub">Hand-ins waiting for your decision</span></span>
                        <span className="nb-mw-when">{toReview.length} →</span>
                    </button>
                ) : null}
                {handedIn.length > 0 ? (
                    <button type="button" className="nb-mw-item" onClick={() => setLens("submitted")}>
                        <span className="nb-mw-icon"><StatusPixels status="done" /></span>
                        <span className="min-w-0"><b>Handed in</b><span className="nb-mw-sub">What you submitted and where it stands</span></span>
                        <span className="nb-mw-when">{handedIn.length} →</span>
                    </button>
                ) : null}
            </div>
        </section>
    ) : null;

    const nothingMatches = filtered && listed.length === 0 && !nextCard;
    return (
        <>
            {tools}
            {chipRow}
            <TodaysMeetings />
            <MyCommunityEvents />
            <GoalCheckIns />
            <UpNextLessons />
            <OffsiteInvites />
            {nextCard}
            {nothingMatches ? (
                <div className="nb-empty-state nb-grid-ground nb-mw-empty" style={{ ["--n" as string]: 3 }}>
                    <span className="nb-mw-fig"><PixelPlace kind="workspace" identityKey="my-work-empty" size={54} /></span>
                    <b>No tasks match these filters</b>
                    <span>Try another day, status or search.</span>
                    <button type="button" className="nb-mw-link" onClick={clearAll}>Clear filters</button>
                </div>
            ) : density === "cards" ? cards : group === "time" ? timeSections : workspaceGroups}
            {orgWork}
            {data?.success && data.hasMore ? (
                <div ref={sentinelRef} className="nb-mw-more">
                    <span>Showing the first {limit} open tasks</span>
                    <button
                        type="button"
                        onClick={() => setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE))}
                        disabled={limit >= MAX_PAGE_SIZE}
                        className="nb-mw-link disabled:cursor-not-allowed disabled:text-muted-foreground"
                    >
                        {limit >= MAX_PAGE_SIZE ? "Open a workspace to view more" : "Load more tasks"}
                    </button>
                </div>
            ) : null}
        </>
    );
}

function SearchIcon() {
    return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>;
}
