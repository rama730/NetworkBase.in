"use client";

import { useState } from "react";
import { formatTaskDueDate } from "@/lib/workspaces/task-presentation";
import Link from "next/link";
import { FileText, ChevronDown, CheckCircle2, Circle, FolderUp, Link2, ListTodo } from "lucide-react";

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

type Props = {
  projectSlug: string;
  projectKey?: string | null;
  sprintReference: string | null;
  sprint?: import("@/lib/workspaces/sprint-detail").SprintListItem | null;
  summary?: SprintHealthSummary | null;
  rows: SprintTimelineRow[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
};

export function SprintTimelineContent({
  projectSlug,
  projectKey,
  sprintReference,
  sprint,
  summary,
  rows,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: Props) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const toggleTask = (taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const tasks = rows
    .filter((r): r is Extract<SprintTimelineRow, { kind: "task" }> => r.kind === "task")
    .map((r) => r.task);
  const lifecycleRows = rows.filter((row) => row.kind !== "task");

  return (
    <div className="space-y-4">
      {summary || lifecycleRows.length > 0 ? (
        <div
          aria-label="Sprint summary"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-muted-foreground">
            {summary ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">{summary.completionPercentage}%</span>
                  <span>done</span>
                </div>
                <span className="text-border">·</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">{summary.completedTasks}/{summary.totalTasks}</span>
                  <span>tasks</span>
                </div>
                {summary.blockedTasks > 0 ? (
                  <>
                    <span className="text-border">·</span>
                    <div className="flex items-center gap-1.5 text-destructive font-medium">
                      <span>{summary.blockedTasks}</span>
                      <span>blocked</span>
                    </div>
                  </>
                ) : null}
                {summary.linkedFileCount > 0 ? (
                  <>
                    <span className="text-border">·</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground">{summary.linkedFileCount}</span>
                      <span>file{summary.linkedFileCount === 1 ? "" : "s"}</span>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
            {lifecycleRows.length > 0 ? (
              <>
                {summary ? <span className="text-border">·</span> : null}
                <ol
                  className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"
                  aria-label="Sprint history"
                >
                  {lifecycleRows.map((row) => (
                    <li key={`${row.kind}:${row.id}`} className="inline-flex items-center gap-1 text-[11px]">
                      <span>{row.kind === "kickoff" ? "Started" : "Completed"}</span>
                      {row.occurredAt ? (
                        <time dateTime={row.occurredAt} className="font-medium text-foreground">
                          {format(new Date(row.occurredAt), "MMM d, yyyy")}
                        </time>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </div>

          {summary ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-[2px] bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-[180ms] motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, Math.max(0, summary.completionPercentage))}%` }}
                />
              </div>
              <span className="font-mono text-[11px] font-medium text-muted-foreground">
                {summary.completionPercentage}%
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <div className="nb-empty-state nb-grid-ground rounded-[8px] py-16" role="status">
          <ListTodo className="nb-empty-state-icon mb-3" aria-hidden="true" />
          <h3 className="nb-empty-state-title">No tasks in this sprint yet.</h3>
          <p className="nb-empty-state-desc">Add tasks from the Tasks tab to start this sprint.</p>
        </div>
      ) : (
      <ul className="divide-y divide-border/60 rounded-[8px] border border-border bg-card overflow-hidden shadow-none">
        {tasks.map((task) => {
          // Live-fix 31: a main assignment reads "12/40", its class progress, never "Unassigned".
          const assignee = task.assignmentProgress ? `${task.assignmentProgress.done}/${task.assignmentProgress.total}` : sprintTimelinePersonName(task.assignee, "Unassigned");
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
          const isDone = titlePresentation.isCompleted;

          return (
            <li key={task.id} className={cn("group flex flex-col transition-colors hover:bg-muted/40", isRemoved && "bg-muted/40 text-muted-foreground")}>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <div className="mt-1 flex shrink-0">
                    <UserAvatar identity={task.assignee} size={32} roundedClassName="rounded-[5px]" />
                  </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center rounded-[3px] px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] ring-1 ring-inset", status.toneClassName)}>
                      {task.reviewStatus === "pending" ? "In review" : status.label}
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
                          : "text-foreground hover:text-primary transition-colors",
                      )}
                      aria-label={titlePresentation.ariaLabel}
                    >
                      {task.title}
                    </Link>
                    {isRemoved && <span className="rounded-[3px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Removed</span>}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground font-medium">
                    {taskReference ? <span>{taskReference}</span> : null}
                    {taskReference ? <span>·</span> : null}
                    <span>{assignee}</span>
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
                    {task.description ? (
                      <div className="whitespace-pre-wrap text-foreground">{task.description}</div>
                    ) : (
                      <p className="italic text-muted-foreground">No description provided.</p>
                    )}
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

                    <div className="mt-4 pt-4 border-t border-border">
                      <Link href={taskHref} className="nb-ui-label text-foreground underline underline-offset-4 transition-colors hover:text-primary">
                        View full task details
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </>
          </li>
          );
        })}
      </ul>
      )}
      {hasMore && onLoadMore ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center justify-center rounded-[5px] border border-border bg-card px-4 text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-input hover:bg-muted active:translate-y-px disabled:cursor-wait disabled:opacity-60"
          >
            {isLoadingMore ? "Loading tasks…" : "Load more tasks"}
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
