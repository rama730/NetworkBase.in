"use client";

import React, { useEffect, useMemo, useState, useDeferredValue, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaceTasksAction } from "@/app/actions/workspace";
import { queryKeys } from "@/lib/query-keys";
import {
    useUIStore,
    createWorkspaceTaskHandoff,
    WORKSPACE_TASK_HANDOFF_STORAGE_KEY,
} from "@/stores/ui-store";
import { ListChecks, MoreHorizontal, Search, X, ChevronDown, Copy, ExternalLink, Calendar, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TaskCard } from "@/components/projects/v2/tasks/TaskCard";
import TaskPriorityBadge from "@/components/projects/v2/tasks/badges/TaskPriorityBadge";
import TaskStatusBadge from "@/components/projects/v2/tasks/badges/TaskStatusBadge";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { TASK_STATUS_PRESENTATION, type TaskWorkflowStatus } from "@/lib/projects/task-workflow";
import {
    normalizeTaskSurfaceRecord,
    calculateTaskTimeHealth,
} from "@/lib/projects/task-presentation";
import { formatTaskId } from "@/lib/project-key";
import { format, parseISO } from "@/lib/utils/date";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkspaceTasksTabProps {
    isActive?: boolean;
}

type WorkspaceTask = Awaited<ReturnType<typeof fetchWorkspaceTasksAction>> extends infer Result
    ? Result extends { success: true; tasks: Array<infer Task> } ? Task : never
    : never;

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const OPEN_STATUSES: TaskWorkflowStatus[] = ["todo", "in_progress", "blocked"];
type WorkspaceScope = "my" | "team" | "all";
type WorkspaceStatusFilter = "all" | (typeof OPEN_STATUSES)[number];
type ViewDensity = "cards" | "rows";

function WorkspaceTasksSkeleton() {
    return (
        <div className="space-y-4 py-1" aria-busy="true" aria-label="Loading workspace tasks">
            {[1, 2].map((group) => (
                <div key={group} className="space-y-2">
                    <div className="flex items-center gap-2">
                        <div aria-hidden="true" className="nb-skeleton h-4 w-4 rounded-[3px]" />
                        <div aria-hidden="true" className="nb-skeleton h-4 w-32 rounded-[3px]" />
                        <div aria-hidden="true" className="nb-skeleton h-4 w-12 rounded-[3px]" />
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        {[1, 2].map((card) => (
                            <div key={card} className="h-28 rounded-[8px] border border-border/60 bg-card p-3 space-y-3">
                                <div aria-hidden="true" className="nb-skeleton h-4 w-3/4 rounded-[3px]" />
                                <div className="flex gap-2">
                                    <div aria-hidden="true" className="nb-skeleton h-5 w-16 rounded-[3px]" />
                                    <div aria-hidden="true" className="nb-skeleton h-5 w-12 rounded-[3px]" />
                                </div>
                                <div className="flex items-center justify-between border-t border-border/40 pt-2">
                                    <div aria-hidden="true" className="nb-skeleton h-4 w-20 rounded-[3px]" />
                                    <div aria-hidden="true" className="nb-skeleton h-4 w-14 rounded-[3px]" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function TaskRow({
    task,
    onClick,
    onCopyLink,
    onOpenInNewTab,
}: {
    task: WorkspaceTask;
    onClick: () => void;
    onCopyLink: (e: React.MouseEvent) => void;
    onOpenInNewTab: (e: React.MouseEvent) => void;
}) {
    const taskRecord = normalizeTaskSurfaceRecord(task);
    const dueDate = taskRecord.dueDate ? parseISO(taskRecord.dueDate) : null;
    const hasValidDueDate = Boolean(dueDate && !Number.isNaN(dueDate.getTime()));
    const timeHealth = calculateTaskTimeHealth(taskRecord, taskRecord.sprint ?? null);
    const taskIdString = taskRecord.taskNumber && (taskRecord.projectKey || task.project?.key)
        ? formatTaskId(taskRecord.projectKey || task.project?.key, taskRecord.taskNumber)
        : null;

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick();
                }
            }}
            className={cn(
                "group relative flex min-h-[40px] w-full items-center justify-between gap-2.5 rounded-[6px] border border-border/70 bg-card px-2.5 py-1.5 transition-colors cursor-pointer",
                "hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
            )}
        >
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <TaskStatusBadge status={taskRecord.status} reviewStatus={taskRecord.reviewStatus} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {task.title}
                </span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <TaskPriorityBadge priority={taskRecord.priority} className="hidden sm:inline-flex" />

                {hasValidDueDate && (taskRecord.status !== "done" || taskRecord.reviewStatus === "pending") && (
                    <div
                        className={cn(
                            "flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] font-semibold",
                            timeHealth.state === "overdue" || timeHealth.state === "overtime"
                                ? "border-destructive/20 bg-destructive/10 text-destructive"
                                : "border-border bg-muted/40 text-muted-foreground",
                        )}
                    >
                        <Calendar className="size-3" />
                        {format(dueDate!, "MMM d")}
                    </div>
                )}

                {taskRecord.assignee ? (
                    <div title={taskRecord.assignee.fullName ?? undefined}>
                        <UserAvatar
                            identity={{
                                fullName: taskRecord.assignee.fullName,
                                avatarUrl: taskRecord.assignee.avatarUrl,
                            }}
                            size={18}
                            className="size-[18px]"
                            roundedClassName="rounded-[3px]"
                            fallbackClassName="text-[10px] max-md:text-[11px]"
                        />
                    </div>
                ) : (
                    <div className="size-[18px] rounded-[3px] border border-dashed border-border/80 flex items-center justify-center text-muted-foreground" title="Unassigned">
                        <User className="size-2.5" />
                    </div>
                )}

                {taskIdString && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                        {taskIdString}
                    </span>
                )}

                <div className="hidden items-center gap-0.5 group-hover:flex pl-1">
                    <button
                        type="button"
                        onClick={onCopyLink}
                        title="Copy task link"
                        aria-label="Copy task link"
                        className="rounded-[3px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                        <Copy className="h-3 w-3" />
                    </button>
                    <button
                        type="button"
                        onClick={onOpenInNewTab}
                        title="Open task in new tab"
                        aria-label="Open task in new tab"
                        className="rounded-[3px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                        <ExternalLink className="h-3 w-3" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function WorkspaceTasksTab({ isActive = true }: WorkspaceTasksTabProps) {
    const router = useRouter();
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const setWorkspaceTaskHandoff = useUIStore((s) => s.setWorkspaceTaskHandoff);
    // The workspace is a cross-project overview: do not hide team work just
    // because the viewer has no personal assignment in that project.
    const [scope, setScope] = useState<WorkspaceScope>("all");
    const [status, setStatus] = useState<WorkspaceStatusFilter>("all");
    const [search, setSearch] = useState("");
    const [density, setDensity] = useState<ViewDensity>("cards");
    const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [isNavigating, setIsNavigating] = useState(false);
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    const deferredSearch = useDeferredValue(search);

    useEffect(() => {
        // A blocked navigation must not leave the launcher permanently inert
        // when the user reopens it.
        if (!isWorkspaceOpen) setIsNavigating(false);
    }, [isWorkspaceOpen]);

    // Fetch tasks, enabled ONLY when drawer is open and tab is active
    const query = useQuery({
        queryKey: queryKeys.workspace.tasks(scope, limit),
        queryFn: () => fetchWorkspaceTasksAction(limit, scope),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });
    const { data, isLoading, error } = query;

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

    const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
    const visibleTasks = useMemo(() => {
        const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();
        return tasks.filter((task) => {
            const matchesStatus = status === "all" || task.status === status;
            const matchesSearch = !normalizedSearch
                || task.title.toLocaleLowerCase().includes(normalizedSearch)
                || task.project?.title?.toLocaleLowerCase().includes(normalizedSearch);
            return matchesStatus && matchesSearch;
        });
    }, [deferredSearch, status, tasks]);

    const groups = useMemo(() => {
        const grouped = new Map<string, { id: string; slug: string | null; title: string; key: string; tasks: WorkspaceTask[] }>();
        for (const task of visibleTasks) {
            const project = task.project || { id: "unknown", slug: null, title: "Project", key: "TASK" };
            const group = grouped.get(project.id) ?? {
                id: project.id,
                slug: project.slug ?? null,
                title: project.title || "Project",
                key: project.key || "TASK",
                tasks: [],
            };
            group.tasks.push(task);
            grouped.set(project.id, group);
        }
        // Keep the API's urgency-aware task order when grouping,
        // rather than re-sorting projects alphabetically and burying work that
        // needs attention.
        return Array.from(grouped.values());
    }, [visibleTasks]);

    if (isLoading) {
        return <WorkspaceTasksSkeleton />;
    }

    if (error || (data && !data.success)) {
        return (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                <p className="text-xs font-medium text-destructive">
                    Failed to load tasks. Please try again later.
                </p>
                <button type="button" onClick={() => void query.refetch()} className="mt-2 text-xs font-semibold text-destructive underline underline-offset-2">Try again</button>
            </div>
        );
    }

    const handleTaskClick = (task: WorkspaceTask) => {
        if (isNavigating) return;
        const projectId = task.project?.id || task.projectId;
        const projectIdentifier = task.project?.slug || projectId;
        if (!projectId || !projectIdentifier) return;

        setIsNavigating(true);
        const handoff = createWorkspaceTaskHandoff(projectId, task.id);
        setWorkspaceTaskHandoff(handoff);
        // The navigation can remount the client runtime. Preserve this one
        // transition in the browser session while keeping the URL clean.
        try {
            window.sessionStorage.setItem(
                WORKSPACE_TASK_HANDOFF_STORAGE_KEY,
                JSON.stringify(handoff),
            );
        } catch {
            // In-memory handoff still covers browsers with blocked storage.
        }
        // Router.push is sufficient here. A prefetch immediately
        // followed by a navigation has no user-visible benefit and competes
        // with the task surface's own data request.
        router.push(`/projects/${projectIdentifier}?tab=tasks`);
        setWorkspaceOpen(false);
    };

    const handleCopyTaskLink = (e: React.MouseEvent, task: WorkspaceTask) => {
        e.stopPropagation();
        const projectId = task.project?.id || task.projectId;
        const projectIdentifier = task.project?.slug || projectId;
        const url = `${window.location.origin}/projects/${projectIdentifier}?tab=tasks`;
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                toast.success("Task link copied to clipboard");
            }).catch(() => {
                toast.info("Task link copied");
            });
        }
    };

    const handleOpenTaskInNewTab = (e: React.MouseEvent, task: WorkspaceTask) => {
        e.stopPropagation();
        const projectId = task.project?.id || task.projectId;
        const projectIdentifier = task.project?.slug || projectId;
        window.open(`/projects/${projectIdentifier}?tab=tasks`, "_blank", "noopener,noreferrer");
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

    const resetScope = (nextScope: WorkspaceScope) => {
        setScope(nextScope);
        setLimit(PAGE_SIZE);
    };

    const filteredEmpty = tasks.length > 0 && visibleTasks.length === 0;
    const isEmpty = tasks.length === 0 || filteredEmpty;

    const hasActiveFilters = scope !== "all" || status !== "all" || search.trim().length > 0;

    const taskFiltersMenu = (
        <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="Filter workspace tasks"
                            title="Filter workspace tasks"
                            className={cn(
                                "nb-touch-target nb-icon-button h-8 w-8 rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                hasActiveFilters
                                    ? "border border-border bg-muted/80 text-primary"
                                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            <MoreHorizontal className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[202] w-72 p-2">
                        <DropdownMenuLabel>Show tasks</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={scope} onValueChange={(value) => resetScope(value as WorkspaceScope)}>
                            <DropdownMenuRadioItem value="all">All open work</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="my">My tasks</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="team">Team tasks</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Status</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={status} onValueChange={(value) => setStatus(value as WorkspaceStatusFilter)}>
                            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                            {OPEN_STATUSES.map((taskStatus) => (
                                <DropdownMenuRadioItem key={taskStatus} value={taskStatus}>
                                    {TASK_STATUS_PRESENTATION[taskStatus].label}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Density</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={density} onValueChange={(value) => setDensity(value as ViewDensity)}>
                            <DropdownMenuRadioItem value="cards">Card view</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="rows">Compact rows</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Search</DropdownMenuLabel>
                        <label className="relative block px-1 pb-1">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="Search tasks or projects"
                                className="nb-touch-target h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                            />
                        </label>
                    </DropdownMenuContent>
        </DropdownMenu>
    );

    return (
        <div id="workspace-tasks-panel" role="tabpanel" aria-labelledby="workspace-tasks-tab" className="space-y-3" aria-busy={isNavigating}>
            {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-[5px] border border-border/70 bg-muted/40 px-2.5 py-1.5 text-xs">
                    <span className="text-muted-foreground">Filtered:</span>
                    {scope !== "all" && (
                        <span className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {scope === "my" ? "My tasks" : "Team tasks"}
                            <button type="button" onClick={() => resetScope("all")} className="text-muted-foreground hover:text-foreground" aria-label="Clear scope filter">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    )}
                    {status !== "all" && (
                        <span className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            {TASK_STATUS_PRESENTATION[status]?.label ?? status}
                            <button type="button" onClick={() => setStatus("all")} className="text-muted-foreground hover:text-foreground" aria-label="Clear status filter">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    )}
                    {search.trim() && (
                        <span className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                            &ldquo;{search.trim()}&rdquo;
                            <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground" aria-label="Clear search">
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => { resetScope("all"); setStatus("all"); setSearch(""); }}
                        className="ml-auto text-xs font-medium text-primary hover:underline"
                    >
                        Clear all
                    </button>
                </div>
            )}

            {isEmpty ? (
                <div className="nb-empty-state nb-grid-ground relative py-12">
                    <div className="absolute right-3 top-3">{taskFiltersMenu}</div>
                    <ListChecks className="nb-empty-state-icon" aria-hidden="true" />
                    <h4 className="nb-card-title text-foreground">{filteredEmpty ? "No tasks match these filters" : "No open tasks in this view"}</h4>
                    <p className="nb-compact mx-auto mt-1 max-w-xs text-muted-foreground">
                        {filteredEmpty ? "Try another status, scope, or search phrase." : scope === "my" ? "You have no active tasks assigned to you right now." : scope === "team" ? "No other team tasks are open right now." : "No open tasks are available in your projects right now."}
                    </p>
                    {filteredEmpty ? <button type="button" onClick={() => { setSearch(""); setStatus("all"); }} className="mt-3 text-xs font-semibold text-primary hover:underline">Clear filters</button> : null}
                </div>
            ) : groups.map((group, index) => {
                const isCollapsed = collapsedProjects.has(group.id);
                return (
                    <section key={group.id} className={cn("space-y-2", index > 0 && "border-t border-border/50 pt-3")}>
                        <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => toggleProjectCollapse(group.id)}
                                className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-[3px] text-left"
                                aria-expanded={!isCollapsed}
                                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.title} tasks`}
                            >
                                <ChevronDown
                                    className={cn(
                                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                                        isCollapsed && "-rotate-90",
                                    )}
                                    aria-hidden="true"
                                />
                                <span className="min-w-0 truncate">{group.title}</span>
                                <span className="nb-meta rounded-[3px] bg-secondary px-1.5 py-0.5 uppercase">{group.key}</span>
                                <span className="nb-meta rounded-[3px] bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title={`${group.tasks.length} open task${group.tasks.length === 1 ? "" : "s"}`}>
                                    {group.tasks.length}
                                </span>
                            </button>
                            <div className="flex items-center gap-1.5">
                                <Link
                                    href={`/projects/${group.slug || group.id}?tab=tasks`}
                                    onClick={() => setWorkspaceOpen(false)}
                                    className="text-[11px] text-muted-foreground hover:text-primary transition-colors hidden sm:inline-block"
                                    aria-label={`Open ${group.title} tasks`}
                                >
                                    Open project
                                </Link>
                                {index === 0 ? taskFiltersMenu : null}
                            </div>
                        </div>
                        {!isCollapsed && (
                            <div className={cn("grid grid-cols-1 gap-2", density === "rows" && "gap-1.5")}>
                                {group.tasks.map((task) => (
                                    density === "rows" ? (
                                        <TaskRow
                                            key={task.id}
                                            task={task}
                                            onClick={() => handleTaskClick(task)}
                                            onCopyLink={(e) => handleCopyTaskLink(e, task)}
                                            onOpenInNewTab={(e) => handleOpenTaskInNewTab(e, task)}
                                        />
                                    ) : (
                                        <div key={task.id} className="group relative">
                                            <TaskCard task={task} onClick={() => handleTaskClick(task)} />
                                            <div className="absolute right-2 top-2 hidden items-center gap-0.5 group-hover:flex rounded-[4px] border border-border/80 bg-card/95 p-0.5 shadow-2xs backdrop-blur-xs z-10">
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleCopyTaskLink(e, task)}
                                                    title="Copy task link"
                                                    aria-label="Copy task link"
                                                    className="rounded-[3px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleOpenTaskInNewTab(e, task)}
                                                    title="Open task in new tab"
                                                    aria-label="Open task in new tab"
                                                    className="rounded-[3px] p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                                >
                                                    <ExternalLink className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                    </section>
                );
            })}
            {data?.success && data.hasMore ? (
                <div ref={sentinelRef} className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground">Showing the first {limit} open tasks.</p>
                    <button
                        type="button"
                        onClick={() => setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE))}
                        disabled={limit >= MAX_PAGE_SIZE}
                        className="text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
                    >
                        {limit >= MAX_PAGE_SIZE ? "Open a project to view more" : "Load more tasks"}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
