"use client";

import { memo } from "react";
import { formatTaskDueDate } from "@/lib/workspaces/task-presentation";
import {
  Calendar,
  CheckSquare,
  Lock,
  MessageSquare,
  Paperclip,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/workspaces/sprint-detail";
import {
  calculateTaskTimeHealth,
  getTaskTitlePresentation,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/workspaces/task-presentation";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import TaskStatusBadge from "./badges/TaskStatusBadge";
import { formatTaskId } from "@/lib/workspace-key";


interface TaskCardProps {
  task: TaskSurfaceRecord | any;
  onClick?: (task: TaskSurfaceRecord) => void;
  activeAssignableMemberIds?: Set<string>;
  showStatus?: boolean;
  dragHandleRef?: (element: HTMLElement | null) => void;
  dragAttributes?: React.HTMLAttributes<HTMLButtonElement>;
  dragListeners?: Record<string, any>;
}


/** "Draft", "0 of 40", "12 of 40 done · 6 to review" or "All done · 2 excused" (report §16.1). */
function assignmentProgressLine(p: { draft: boolean; closed: boolean; done: number; total: number; toReview: number; excused: number }) {
  if (p.draft) return "Draft";
  if (p.total === 0) return "Nobody has joined yet";
  if (p.done >= p.total) return `All done${p.excused ? ` · ${p.excused} excused` : ""}`;
  return [`${p.done} of ${p.total} done`, p.toReview ? `${p.toReview} to review` : null, p.closed ? "Closed" : null].filter(Boolean).join(" · ");
}

/** Mockup task 4: the card's chips, its progress bar's width and the line under it. */
export function assignmentCardBits(p: { draft: boolean; closed: boolean; done: number; total: number; toReview: number; excused: number; teams?: boolean }) {
  const chips = [p.draft ? "Draft" : null, "Assignment", p.teams ? "Groups" : null, p.toReview ? `${p.toReview} to review` : null].filter((c): c is string => Boolean(c));
  return { chips, percent: p.total ? Math.round((p.done / p.total) * 100) : 0, line: assignmentProgressLine(p) };
}

export type Task = TaskSurfaceRecord;

type TaskMetaIndicatorProps = {
  title: string;
  icon: typeof CheckSquare;
  label: string | number;
  unreadCount?: number;
};

function TaskMetaIndicator({
  title,
  icon: Icon,
  label,
  unreadCount = 0,
}: TaskMetaIndicatorProps) {
  const hasUnread = unreadCount > 0;

  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-[3px] border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] font-medium"
      title={title}
      aria-label={
        hasUnread
          ? `${title}, ${label}, ${unreadCount} new`
          : `${title}, ${label}`
      }
    >
      <Icon
        className={cn(
          "size-3 transition-colors duration-[180ms]",
          hasUnread ? "text-rose-500 dark:text-rose-400 drop-shadow-[0_0_3px_rgba(244,63,94,0.3)]" : "text-muted-foreground"
        )}
      />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function TaskMetaIndicators({
  subtaskCount,
  completedSubtaskCount,
  newSubtaskCount,
  fileCount,
  newFileCount,
  commentCount,
  newCommentCount,
}: Pick<
  TaskSurfaceRecord,
  | "subtaskCount"
  | "completedSubtaskCount"
  | "newSubtaskCount"
  | "fileCount"
  | "newFileCount"
  | "commentCount"
  | "newCommentCount"
>) {
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-muted-foreground"
      aria-label={`Task activity summary: ${completedSubtaskCount ?? 0} of ${subtaskCount ?? 0} subtasks complete, ${fileCount ?? 0} attachments, ${commentCount ?? 0} comments`}
    >
      {(subtaskCount ?? 0) > 0 && (
        <TaskMetaIndicator
          title="Subtasks"
          icon={CheckSquare}
          label={`${completedSubtaskCount ?? 0}/${subtaskCount}`}
          unreadCount={newSubtaskCount}
        />
      )}
      {((fileCount ?? 0) > 0 || (newFileCount ?? 0) > 0) && (
        <TaskMetaIndicator
          title="Files"
          icon={Paperclip}
          label={Math.max(fileCount ?? 0, newFileCount ?? 0)}
          unreadCount={newFileCount}
        />
      )}
      {(commentCount ?? 0) > 0 && (
        <TaskMetaIndicator
          title="Comments"
          icon={MessageSquare}
          label={commentCount ?? 0}
          unreadCount={newCommentCount}
        />
      )}
    </div>
  );
}

export const TaskCard = memo(function TaskCard({
  task,
  onClick,
  activeAssignableMemberIds,
  showStatus = true,
  dragHandleRef,
  dragAttributes,
  dragListeners,
}: TaskCardProps) {
  const taskRecord = normalizeTaskSurfaceRecord(task);
  const titlePresentation = getTaskTitlePresentation(taskRecord);
  const bits = taskRecord.assignmentProgress ? assignmentCardBits(taskRecord.assignmentProgress) : null;
  const assigneeRemoved = Boolean(
    taskRecord.assigneeId &&
    taskRecord.assignee &&
    activeAssignableMemberIds &&
    !activeAssignableMemberIds.has(taskRecord.assigneeId),
  );
  const timeHealth = calculateTaskTimeHealth(
    taskRecord,
    taskRecord.sprint ?? null,
  );
  const dueDateLabel = formatTaskDueDate(taskRecord.dueDate);
  const hasValidDueDate = Boolean(dueDateLabel);

  const cardButton = (
    <button
      ref={dragHandleRef}
      {...dragAttributes}
      {...dragListeners}
      type="button"
      data-testid="task-card"
      onClick={() => onClick?.(taskRecord)}
      className={cn(
        "group relative min-h-[128px] w-full min-w-0 cursor-pointer overflow-hidden rounded-[8px] bg-card transition-colors duration-[180ms]",
        "border border-border shadow-2xs hover:border-border/80",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
      )}
    >
      <div className="grid min-h-[128px] grid-rows-[auto_auto_auto] gap-3 p-3">
        {/* Mockup task 4: an assignment's chips sit above its title, its class progress below. */}
        {bits ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {bits.chips.map((chip) => (
              <span key={chip} className="nb-status" data-status={chip === "Draft" || chip.endsWith("to review") ? "draft" : "archived"}>{chip}</span>
            ))}
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5">
          <h4
            className={cn(
              "min-w-0 line-clamp-3 text-left text-[13px] font-medium leading-[18px] tracking-tight text-foreground",
              titlePresentation.className,
            )}
            title={taskRecord.title}
            aria-label={titlePresentation.ariaLabel}
          >
            {taskRecord.title}
          </h4>
        </div>
        {bits ? (
          <div className="space-y-1">
            <div className="h-[5px] overflow-hidden rounded-[3px] bg-muted" role="img" aria-label={bits.line}>
              <div className="h-full bg-primary" style={{ width: `${bits.percent}%` }} />
            </div>
            <p className="font-mono text-[12px] text-muted-foreground">{bits.line}</p>
          </div>
        ) : null}

        {/* Keep the card compact: stable status first (if enabled), then semantic labels without a horizontal scroller. */}
        <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-1.5">
          {showStatus && taskRecord.reviewStatus !== "pending" && (
            <TaskStatusBadge status={taskRecord.status} className="shrink-0" />
          )}
          <div className="shrink-0">
            <TaskPriorityBadge priority={taskRecord.priority} />
          </div>
          {taskRecord.reviewStatus === "pending" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              <Lock className="size-3" />
              In review
            </span>
          )}
          {timeHealth.state === "overdue" && (
            <span className="shrink-0 rounded-[3px] border border-destructive/20 bg-destructive/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-destructive">
              Overdue
            </span>
          )}
          {timeHealth.state === "unfinished" && (
            <span className="shrink-0 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Incomplete
            </span>
          )}
          {timeHealth.state === "overtime" && (
            <span className="shrink-0 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Overtime
            </span>
          )}
          {assigneeRemoved && (
            <span className="shrink-0 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              Needs reassignment
            </span>
          )}
          {taskRecord.sprint?.name && (
            <span
              className={cn(
                "max-w-[112px] shrink-0 truncate rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-semibold",
                taskRecord.sprint.status
                  ? SPRINT_STATUS_PRESENTATION[taskRecord.sprint.status]
                      .toneClassName
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
              title={taskRecord.sprint.name}
            >
              {taskRecord.sprint.name}
            </span>
          )}
          {taskRecord.storyPoints != null && (
            <span data-story-point className="shrink-0 rounded-[3px] border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
              {taskRecord.storyPoints} pts
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/50 pt-1.5">
          {/* Avatar + task counts share one fixed footer row; names belong in the tooltip. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {taskRecord.assignee ? (
              <div
                className="shrink-0"
                title={
                  assigneeRemoved
                    ? `${taskRecord.assignee.fullName} was removed from the workspace`
                    : taskRecord.assignee.fullName ?? undefined
                }
              >
                <UserAvatar
                  identity={{
                    fullName: taskRecord.assignee.fullName,
                    avatarUrl: taskRecord.assignee.avatarUrl,
                  }}
                  size={20}
                  className="size-5"
                  roundedClassName="rounded-[3px]"
                  fallbackClassName="text-[11px]"
                />
              </div>
            ) : (
              <div
                className="flex size-5 shrink-0 items-center justify-center rounded-[3px] border border-dashed border-border bg-muted/40"
                title="Unassigned"
              >
                <User className="size-3 text-muted-foreground" />
              </div>
            )}
            <TaskMetaIndicators {...taskRecord} />
            {/* Decisions 6 and 14, gap 24: the assignment card shows class progress; it moves by itself. */}
            {taskRecord.assignmentProgress ? null : taskRecord.assignmentId && !taskRecord.fromLabel ? (
              <span className="rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground">Assignment</span>
            ) : null}
            {taskRecord.fromLabel ? (
              <span className="truncate rounded-[3px] border border-border px-1 text-[10px] text-muted-foreground" title={`From ${taskRecord.fromLabel}`}>
                From {taskRecord.fromLabel}{taskRecord.teamName ? ` · ${taskRecord.teamName}` : ""}
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {hasValidDueDate && !titlePresentation.isCompleted && (
              <div
                className={cn(
                  "flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                  timeHealth.state === "overdue" ||
                    timeHealth.state === "overtime"
                    ? "border-destructive/20 bg-destructive/10 text-destructive"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                <Calendar className="size-3" />
                {dueDateLabel}
              </div>
            )}
            <span className="whitespace-nowrap font-mono text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              {taskRecord.taskNumber && taskRecord.projectKey
                ? formatTaskId(taskRecord.projectKey, taskRecord.taskNumber)
                : "Task"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );

  return cardButton;
});
