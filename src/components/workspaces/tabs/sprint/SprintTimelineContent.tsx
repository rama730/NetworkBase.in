"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from "react";
import { readUrlParam, useUrlMirror } from "@/lib/navigation/url-state";
import { formatTaskDueDate } from "@/lib/workspaces/task-presentation";
import Link from "next/link";
import { FileText, ChevronDown, CheckCircle2, Circle, FolderUp, Link2, ListTodo, User } from "lucide-react";

import {
  SPRINT_TASK_STATUS_PRESENTATION,
  type SprintTimelineRow,
  type SprintHealthSummary,
} from "@/lib/workspaces/sprint-detail";
import { sprintTimelinePersonName } from "@/lib/workspaces/sprint-presentation";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import { TASK_WORKING_FILES_TITLE } from "@/lib/files/task-working-files";
import { calculateTaskTimeHealth, getTaskTitlePresentation } from "@/lib/workspaces/task-presentation";
import { format } from "@/lib/utils/date";
import { useAuth } from "@/hooks/use-auth";
import { paceLine, sprintPace, sprintPhase, sprintTime, workGroups, workProgress } from "@/lib/workspaces/sprint-plan";
import { ASSIGNMENT_CHIP_CLASS, AssignmentIcon, AssignmentStagesPanel, cardLine, copyChip, copyStageLine, HandIn, Instructions, StageBar } from "@/components/workspaces/tabs/sprint/AssignmentStages";
import { assignmentChip } from "@/lib/organizations/assignment-chip";

type Props = {
  projectSlug: string;
  projectKey?: string | null;
  sprintReference: string | null;
  sprint?: import("@/lib/workspaces/sprint-detail").SprintListItem | null;
  summary?: SprintHealthSummary | null;
  /** Off on a Unit's page, where SprintInsights shows the same numbers. */
  showSummary?: boolean;
  rows: SprintTimelineRow[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Sprint cleanup §4: an organization's admins see Review and Remind on an assignment's stages. */
  canManageAssignments?: boolean;
};

export function SprintTimelineContent({
  projectSlug,
  projectKey,
  sprintReference,
  sprint,
  summary,
  showSummary = true,
  rows,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  canManageAssignments = false,
}: Props) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const toggleTask = (taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const tasks = rows
    .filter((r): r is Extract<SprintTimelineRow, { kind: "task" }> => r.kind === "task")
    .map((r) => r.task);
  const lifecycleRows = rows.filter((row) => row.kind !== "task");
  const { user } = useAuth();
  const [by, setBy] = useState<"state" | "person">(() => (readUrlParam("tlby") === "person" ? "person" : "state"));
  const [mine, setMine] = useState(() => readUrlParam("tlmine") === "1");
  useUrlMirror({ tlby: by !== "state" ? by : null, tlmine: mine ? "1" : null }); // unified back R3
  const view = workGroups(tasks, by, mine ? user?.id : null);
  const visibleCount = view.groups.reduce((n, g) => n + g.tasks.length, 0);
  const time = sprint ? sprintTime(sprint) : null;
  const work = workProgress(summary ?? { totalTasks: 0, completedTasks: 0, totalStoryPoints: 0, completedStoryPoints: 0 });
  const pace = sprint && sprintPhase(sprint) === "running" && time ? sprintPace(time.percent, work.percent) : null;

  return (
    <div className="space-y-4">
      {/* Sprint redesign §5.3: time passed and work done side by side, and whether the pace holds. */}
      {summary && showSummary ? (
        <div aria-label="Sprint summary" className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="rounded-md bg-muted p-3">
            <p className="text-[12px] text-muted-foreground">Time{time ? ` · day ${time.day} of ${time.days}` : ""}</p>
            <p className="text-[20px] font-semibold leading-tight text-foreground">{time ? `${time.percent}%` : "—"}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-background"><div className="h-full bg-muted-foreground" style={{ width: `${time?.percent ?? 0}%` }} /></div>
          </div>
          <div className="rounded-md bg-muted p-3">
            <p className="text-[12px] text-muted-foreground">{work.unit === "points" ? "Points" : "Tasks"} done · {work.done} of {work.total}</p>
            <p className="text-[20px] font-semibold leading-tight text-foreground">
              {work.percent}%
              {pace ? <span className={cn("ml-2 text-[12px] font-normal", pace === "behind" ? "text-[var(--status-danger)]" : pace === "ahead" ? "text-[var(--status-success)]" : "text-muted-foreground")}>{pace}</span> : null}
              {summary.blockedTasks > 0 ? <span className="ml-2 text-[12px] font-normal text-[var(--status-danger)]">{summary.blockedTasks} blocked</span> : null}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-background"><div className="h-full bg-primary transition-[width] duration-[180ms] motion-reduce:transition-none" style={{ width: `${Math.min(100, work.percent)}%` }} /></div>
            {/* Sprint redesign (2026-11-09): the pace says why. */}
            {pace && time ? <p className={cn("mt-1 text-[12px]", pace === "behind" ? "text-[var(--status-danger)]" : "text-muted-foreground")}>{paceLine(time.percent, work.percent).replace(/^[a-z ]+ · /, "")}</p> : null}
          </div>
        </div>
      ) : null}
      {lifecycleRows.length > 0 ? (
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground" aria-label="Sprint history">
          {lifecycleRows.map((row) => (
            <li key={`${row.kind}:${row.id}`} className="inline-flex items-center gap-1">
              <span>{row.kind === "kickoff" ? "Started" : "Closed"}</span>
              {row.occurredAt ? <time dateTime={row.occurredAt} className="font-medium text-foreground">{format(new Date(row.occurredAt), "MMM d, yyyy")}</time> : null}
            </li>
          ))}
          {summary && summary.linkedFileCount > 0 ? <li>· {summary.linkedFileCount} file{summary.linkedFileCount === 1 ? "" : "s"} on its work</li> : null}
        </ol>
      ) : null}
      {tasks.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <h3 className="flex-1 text-[15px] font-semibold">Work in this sprint · {visibleCount}</h3>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Group by
            <select value={by} onChange={(e) => setBy(e.target.value as "state" | "person")} className="nb-touch-target h-[30px] rounded-[5px] border border-border bg-card px-2 text-xs text-foreground">
              <option value="state">State</option>
              <option value="person">Person</option>
            </select>
          </label>
          {user?.id ? (
            <button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={cn("nb-touch-target inline-flex h-[30px] items-center rounded-[5px] border px-2.5 text-xs", mine ? "border-foreground font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>Mine</button>
          ) : null}
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <div className="nb-empty-state nb-grid-ground rounded-[8px] py-16" role="status">
          <ListTodo className="nb-empty-state-icon mb-3" aria-hidden="true" />
          <h3 className="nb-empty-state-title">No work in this sprint yet</h3>
          <p className="nb-empty-state-desc">Open New sprint and pick Add work to bring tasks from the backlog.</p>
        </div>
      ) : (
      <div className="space-y-4">
      {visibleCount === 0 ? <p className="text-sm text-muted-foreground">Nothing assigned to you in this sprint.</p> : null}
      {view.groups.map((group) => (
      <section key={group.key} aria-labelledby={`sprint-work-${group.key}`} className="space-y-1.5">
      <h4 id={`sprint-work-${group.key}`} className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.09em]", group.key === "blocked" ? "text-[var(--status-danger)]" : "text-muted-foreground")}>{group.title} · {group.tasks.length}</h4>
      <ul aria-labelledby={`sprint-work-${group.key}`} className="divide-y divide-border/60 rounded-[8px] border border-border bg-card overflow-hidden shadow-none">
        {group.tasks.map((task) => {
          // Sprint work list redesign (2026-11-09): an assignment looks as it does on the board — its clipboard icon (ticked
          // once all are approved), its own chip, who it's for, and the same bar and line ("0 of 1 approved · 1 in review").
          const master = task.assignmentProgress ?? null;
          const stages = task.assignmentStages ?? null;
          const line = master && stages && stages.total + stages.counts.excused > 0 ? cardLine(stages) : null;
          const allApproved = Boolean(line?.allDone);
          const chip = master ? assignmentChip({ draft: master.draft, scheduled: master.scheduled, closed: master.closed }, stages)
            : task.copyStage ? copyChip(task.copyStage) : null;
          const forWhom = !master ? null : stages && stages.total ? `${stages.total} ${stages.teams ? (stages.total === 1 ? "group" : "groups") : (stages.total === 1 ? "person" : "people")}` : "Nobody yet";
          const assignee = master ? `Assignment · ${forWhom}` : sprintTimelinePersonName(task.assignee, "Unassigned");
          const ownStage = task.copyStage ? copyStageLine(task.copyStage) : null;
          const taskReference = task.taskNumber == null ? null : `${projectKey?.trim() || "Task"}-${task.taskNumber}`;

          const completedSubtasks = task.subtasks?.filter(st => st.completed).length ?? 0;
          const totalSubtasks = task.subtasks?.length ?? 0;

          const timeHealth = calculateTaskTimeHealth(
            {
              status: task.status,
              reviewStatus: task.reviewStatus,
              dueDate: task.dueDate,
              completedAt: task.completedAt,
              updatedAt: task.updatedAt,
            },
            sprint ? { status: sprint.status, endDate: sprint.endDate, completedAt: sprint.completedAt } : null
          );

          // Native linking, no complex "UI inside UI" accordion state
          const taskHref = `/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({
            tab: "tasks",
            drawerType: "task",
            drawerId: taskReference ?? task.id,
            from: "sprint",
            ...(sprintReference ? { sprint: sprintReference } : {}),
          }).toString()}`;

          const status = SPRINT_TASK_STATUS_PRESENTATION[task.status];
          const titlePresentation = getTaskTitlePresentation(task);
          const isRemoved = task.isDeleted || task.membershipState === "historical";
          const isExpanded = expandedTaskId === task.id;
          // An assignment everyone finished reads quiet, not struck through (the board's rule).
          const isDone = titlePresentation.isCompleted && !master;

          return (
            <li key={task.id} className={cn("group flex flex-col transition-colors hover:bg-muted/40", isRemoved && "bg-muted/40 text-muted-foreground")}>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <div className="mt-1 flex shrink-0">
                    {master ? (
                      <span title="Assignment" className={cn("flex size-8 items-center justify-center rounded-[5px] border bg-card", allApproved ? "border-[var(--status-success)] text-[var(--status-success)]" : "border-border text-foreground")}>
                        <AssignmentIcon allDone={allApproved} className="size-4" />
                      </span>
                    ) : task.assignee ? (
                      <UserAvatar identity={task.assignee} size={32} roundedClassName="rounded-[5px]" />
                    ) : (
                      <span title="Unassigned" className="flex size-8 items-center justify-center rounded-[5px] border border-dashed border-border bg-muted">
                        <User className="size-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center rounded-[3px] px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] ring-1 ring-inset", chip ? ASSIGNMENT_CHIP_CLASS[chip.tone] : status.toneClassName)}>
                      {chip ? chip.label : task.reviewStatus === "pending" ? "In review" : status.label}
                    </span>
                    {!isDone && timeHealth.state === "overdue" && (
                      <span className="inline-flex items-center rounded-[3px] border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-destructive">
                        Overdue
                      </span>
                    )}
                    {!isDone && timeHealth.state === "unfinished" && (
                      <span className="nb-status nb-sprint-tone-warning">
                        Incomplete
                      </span>
                    )}
                    {!isDone && timeHealth.state === "overtime" && (
                      <span className="nb-status nb-sprint-tone-warning">
                        Overtime
                      </span>
                    )}
                    <Link
                      href={taskHref}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "truncate text-sm font-semibold hover:underline",
                        isDone
                          ? "line-through text-muted-foreground decoration-muted-foreground/40 hover:text-foreground"
                          : (timeHealth.state === "overdue" || timeHealth.state === "unfinished")
                          ? "text-destructive hover:text-destructive/90"
                          : master && allApproved ? "text-muted-foreground hover:text-foreground"
                          : "text-foreground hover:text-primary transition-colors",
                      )}
                      aria-label={titlePresentation.ariaLabel}
                    >
                      {task.title}
                    </Link>
                    {isRemoved && <span className="rounded-[3px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Removed</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground font-medium [&>span]:whitespace-nowrap">
                    {taskReference ? <span>{taskReference}</span> : null}
                    {taskReference ? <span>·</span> : null}
                    <span className="inline-flex items-center gap-1">{task.assignmentId ? <><span>{assignee}</span><span>·</span><AssignmentIcon className="size-3" /><span>Assignment</span></> : assignee}</span>
                    {task.storyPoints != null && (
                      <>
                        <span>·</span>
                        <span data-story-point className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">
                          {task.storyPoints} PTS
                        </span>
                      </>
                    )}
                    {totalSubtasks > 0 && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {completedSubtasks}/{totalSubtasks}
                        </span>
                      </>
                    )}
                    {task.dueDate && (
                      <>
                        <span>·</span>
                        <span className={cn(
                          "inline-flex items-center gap-1",
                          !isDone && (timeHealth.state === "overdue" || timeHealth.state === "unfinished" || timeHealth.state === "overtime")
                            ? "text-destructive font-semibold"
                            : ""
                        )}>
                          Due {formatTaskDueDate(task.dueDate)}
                        </span>
                      </>
                    )}
                  </div>
                  {master && !isExpanded ? (
                    master.draft ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">{master.scheduled ? "Not published yet · goes out on its date" : "Not published yet"}</p>
                    : line && stages ? (
                      <div className="mt-1.5 max-w-xs space-y-1">
                        <StageBar stages={stages} />
                        <p className={cn("font-mono text-[11px]", allApproved ? "text-[var(--status-success)]" : "text-muted-foreground")}>{line.text}</p>
                      </div>
                    ) : <p className="mt-1 font-mono text-[11px] text-muted-foreground">Nobody has it yet. People get it when they join.</p>
                  ) : null}
                  {ownStage ? <p className={cn("mt-1 text-xs font-medium", task.copyStage?.state === "returned" || task.copyStage?.state === "missing" ? "text-[var(--status-danger)]" : "text-foreground")}>{ownStage}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 pl-4">
                <button
                  type="button"
                  onClick={() => toggleTask(task.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`sprint-task-${task.id}`}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${task.title}`}
                  className="nb-touch-target inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <div className={isExpanded ? "rotate-180 transition-transform duration-150" : "transition-transform duration-150"}>
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </button>
              </div>
            </div>

            <>
              {isExpanded && (
                <div
                  key="content"
                  id={`sprint-task-${task.id}`}
                  className="overflow-hidden animate-in fade-in duration-150"
                >
                  <div className="px-4 pb-4 pl-[3.75rem] text-sm text-muted-foreground">
                    {/* Sprint cleanup §4: a main assignment opens to where everyone is; a copy says where this person is. */}
                    {task.assignmentStages ? (
                      <AssignmentStagesPanel masterId={task.id} stages={task.assignmentStages} canManage={canManageAssignments} assignmentHref={taskHref}
                        reviewHref={`/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({ tab: "tasks", taskScope: "review", assignment: task.id }).toString()}`} />
                    ) : null}
                    {task.copyStage ? <HandIn stage={task.copyStage} /> : null}
                    {task.description && task.assignmentStages ? <Instructions text={task.description} /> : task.description ? (
                      <div className="whitespace-pre-wrap text-foreground">{task.description}</div>
                    ) : !task.assignmentStages && !ownStage && !task.subtasks?.length && !task.linkedFiles?.length ? (
                      <p className="text-muted-foreground">{sprintTimelinePersonName(task.assignee, "Nobody assigned")}{task.dueDate ? ` · Due ${formatTaskDueDate(task.dueDate)}` : " · No due date"}</p>
                    ) : null}
                    {/* Subtasks Section */}
                    {task.subtasks && task.subtasks.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">Subtasks</h4>
                        <ul className="space-y-1.5">
                          {task.subtasks.map((subtask) => (
                            <li key={subtask.id} className={cn("flex items-start gap-2 text-xs", subtask.completed && "opacity-50 line-through")}>
                              {subtask.completed ? (
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--status-success)]" />
                              ) : (
                                <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span>{subtask.title}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Deliverables Section */}
                    {task.linkedFiles && task.linkedFiles.filter(f => f.role === "deliverable").length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-[color:var(--status-success)]">Final files</h4>
                        <ul className="space-y-1.5">
                          {task.linkedFiles.filter(f => f.role === "deliverable").map((file) => (
                            <li key={file.nodeId} className="flex items-center gap-2 text-xs font-medium text-foreground">
                              <FolderUp className="h-3.5 w-3.5 shrink-0 text-[color:var(--status-success)]" />
                              <Link href={`/workspaces/${encodeURIComponent(projectSlug)}?tab=files&fileId=${encodeURIComponent(file.nodeId)}`} className="truncate hover:underline">{file.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Task working files and references */}
                    {task.linkedFiles && task.linkedFiles.filter(f => f.role === "working").length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">{TASK_WORKING_FILES_TITLE}</h4>
                        <ul className="space-y-1.5">
                          {task.linkedFiles.filter(f => f.role === "working").map((file) => (
                            <li key={file.nodeId} className="flex items-center gap-2 text-xs">
                              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <Link href={`/workspaces/${encodeURIComponent(projectSlug)}?tab=files&fileId=${encodeURIComponent(file.nodeId)}`} className="truncate text-muted-foreground hover:text-foreground hover:underline transition-colors">{file.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {task.linkedFiles && task.linkedFiles.filter(f => f.role === "reference").length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-foreground">Task references</h4>
                        <ul className="space-y-1.5">
                          {task.linkedFiles.filter(f => f.role === "reference").map((file) => (
                            <li key={file.nodeId} className="flex items-center gap-2 text-xs">
                              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <Link href={`/workspaces/${encodeURIComponent(projectSlug)}?tab=files&fileId=${encodeURIComponent(file.nodeId)}`} className="truncate text-muted-foreground hover:text-foreground hover:underline transition-colors">{file.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {task.assignmentStages ? null : (
                    <div className="mt-4 pt-4 border-t border-border">
                      <Link href={taskHref} className="nb-ui-label text-foreground underline underline-offset-4 transition-colors hover:text-primary">
                        Open
                      </Link>
                    </div>
                    )}
                  </div>
                </div>
              )}
            </>
          </li>
          );
        })}
      </ul>
      </section>
      ))}
      {view.removed.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Taken out of this sprint · {view.removed.length}</summary>
          <ul className="mt-2 space-y-1 pl-4 text-muted-foreground">
            {view.removed.map((task) => <li key={task.id}>{task.title}{task.isDeleted ? " · deleted" : ""}</li>)}
          </ul>
        </details>
      ) : null}
      </div>
      )}
      {hasMore && onLoadMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center justify-center rounded-[5px] border border-border bg-card px-4 text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-input hover:bg-muted active:translate-y-px disabled:cursor-wait disabled:opacity-60"
          >
            {isLoadingMore ? <><PixelBeat />Loading tasks…</> : "Load more tasks"}
          </button>
        </div>
      ) : null}
      {sprint?.status === "completed" && summary && summary.completedTasks < summary.totalTasks ? (
        <div className="flex items-center gap-2 rounded-[5px] border border-border bg-muted/30 px-3.5 py-2 font-mono text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-[1px] bg-[var(--status-warning)]" />
          <span>
            Sprint closed with {summary.totalTasks - summary.completedTasks} task{summary.totalTasks - summary.completedTasks === 1 ? "" : "s"} retained in its history.
          </span>
        </div>
      ) : null}
    </div>
  );
}
