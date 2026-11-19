"use client";

import { createElement, memo, useEffect, useState } from "react";
import { markMoveSeen, moveSeen } from "@/lib/organizations/move-seen";
import { useSprintPath } from "@/components/workspaces/v2/tasks/SprintPathContext";
import { AssignmentIcon, audienceLabel, cardLine, copyChip, copyStageLine, publishLine, StageBar } from "@/components/workspaces/tabs/sprint/AssignmentStages";
import { assignmentChip } from "@/lib/organizations/assignment-chip";
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
import { useKnownWorkflows } from "@/components/workspaces/workflows/added-workflows";
import { workflowIcon } from "@/components/workspaces/workflows/workflow-icons";
import { ownTabOf, typeChip } from "@/lib/workflows/display";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";


interface TaskCardProps {
  task: TaskSurfaceRecord | any;
  onClick?: (task: TaskSurfaceRecord) => void;
  activeAssignableMemberIds?: Set<string>;
  showStatus?: boolean;
  dragHandleRef?: (element: HTMLElement | null) => void;
  dragAttributes?: React.HTMLAttributes<HTMLButtonElement>;
  dragListeners?: Record<string, any>;
}

export type Task = TaskSurfaceRecord;

// Member card lifecycle (2026-11-10): the footer's one shrinking item. When fewer than 3rem are left for its text,
// the text wraps onto a second line that the one-line height hides, so the icon stays and no letter sliver shows.
const FOOTER_LABEL = "flex h-4 min-w-0 flex-wrap items-center gap-x-1 overflow-hidden text-[11px] leading-4 text-muted-foreground";
const FOOTER_LABEL_TEXT = "min-w-12 flex-1 truncate";

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
    <span
      className="flex shrink-0 items-center gap-0.5"
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
    </span>
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
  const subtasks = (subtaskCount ?? 0) > 0;
  const files = (fileCount ?? 0) > 0 || (newFileCount ?? 0) > 0;
  const comments = (commentCount ?? 0) > 0;
  if (!subtasks && !files && !comments) return null;
  // Member card lifecycle (2026-11-10): one chip for all counts, and it keeps its size. It used to be a shrinkable
  // box of fixed chips, so the From label was painted over them when the footer ran out of room (ALM-1).
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-[3px] border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[11px] font-medium text-muted-foreground"
      aria-label={`Task activity summary: ${completedSubtaskCount ?? 0} of ${subtaskCount ?? 0} subtasks complete, ${fileCount ?? 0} attachments, ${commentCount ?? 0} comments`}
    >
      {subtasks && (
        <TaskMetaIndicator
          title="Subtasks"
          icon={CheckSquare}
          label={`${completedSubtaskCount ?? 0}/${subtaskCount}`}
          unreadCount={newSubtaskCount}
        />
      )}
      {files && (
        <TaskMetaIndicator
          title="Files"
          icon={Paperclip}
          label={Math.max(fileCount ?? 0, newFileCount ?? 0)}
          unreadCount={newFileCount}
        />
      )}
      {comments && (
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
  const known = useKnownWorkflows();
  const chip = typeChip(taskRecord.itemType, taskRecord.stage, taskRecord.status);
  const typeIcon = taskRecord.itemType && WORKFLOW_TYPES[taskRecord.itemType] ? workflowIcon(WORKFLOW_TYPES[taskRecord.itemType]!.icon) : null;
  const ownTab = taskRecord.itemType ? ownTabOf(taskRecord.itemType) : null;
  const typeHidden = Boolean(known && ownTab && !known.includes(ownTab.id));
  const sprintPath = useSprintPath(taskRecord.sprint?.id, taskRecord.sprint?.name ?? "");
  const titlePresentation = getTaskTitlePresentation(taskRecord);
  const dueDateLabel = formatTaskDueDate(taskRecord.dueDate);
  // Board view dropdown §6a: an assignment card is a task card — title, then where everyone is, then the task card's
  // chips and footer, with who it's for where a task shows its assignee.
  const master = taskRecord.assignmentProgress ?? null;
  const stages = taskRecord.assignmentStages ?? null;
  const scheduled = Boolean(master?.draft && taskRecord.publishAt);
  const line = master && !master.draft && stages && stages.total + stages.counts.excused > 0 ? cardLine(stages) : null;
  const allApproved = Boolean(line?.allDone);
  // Assignment flow: a closed assignment says when it closed, before where everyone ended up.
  const closedPrefix = master?.closed ? `Closed${master.closedAt ? ` ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(master.closedAt))}` : ""} · ` : "";
  const ownStage = taskRecord.copyStage ?? null;
  const ownChip = ownStage ? copyChip(ownStage) : null;
  // Sprint work list redesign (2026-11-09): the same chip as a sprint's list; the board leaves out what its line says.
  const masterChip = master ? assignmentChip({ draft: master.draft, scheduled, closed: master.closed, toReview: master.toReview }, stages, { quiet: true }) : null;
  const cardName = master ? ["Assignment", taskRecord.title, line?.text ?? (master.draft ? (scheduled ? "scheduled" : "draft") : "nobody has it yet"),
    master.toReview ? `${master.toReview} to review` : null, dueDateLabel ? `due ${dueDateLabel}` : null].filter(Boolean).join(", ") : undefined;
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
  // Member card lifecycle (2026-11-10): a copy's date is what its holder owes next. The due date while working, the
  // fix-by date once returned, nothing after hand-in or when missing (the stage line says it). Timing chips follow.
  const owesWork = !ownStage || ownStage.state === "not_started" || ownStage.state === "in_progress" || ownStage.state === "returned";
  const fixByLabel = ownStage?.state === "returned" ? formatTaskDueDate(ownStage.fixBy) : null;
  const deadlineLabel = ownStage ? fixByLabel ?? (owesWork ? dueDateLabel : null) : titlePresentation.isCompleted ? null : dueDateLabel;
  const timing = owesWork ? timeHealth.state : null;
  const isCopy = Boolean(taskRecord.assignmentId);
  // Assignment flow decision 3: handed-in, approved and excused copies can't be dragged; the lock says so.
  const lockedCopy = Boolean(ownStage && (ownStage.state === "submitted" || ownStage.state === "excused" || (ownStage.state === "done" && ownStage.reviewRequired)));
  const lockReason = ownStage?.state === "submitted" ? "Waiting for review" : ownStage?.state === "excused" ? "Excused" : "Approved work is locked";
  const stuck = Boolean(ownStage?.stuck);
  // Why it moved (an auto start, a teammate's move), until its person opens the card. Read after mount: storage is per browser.
  const lastMove = taskRecord.lastMove ?? null;
  const [moveHidden, setMoveHidden] = useState(true);
  useEffect(() => { setMoveHidden(!lastMove || moveSeen(taskRecord.id, lastMove.at)); }, [lastMove, taskRecord.id]);
  const open = () => {
    if (lastMove && !moveHidden) { markMoveSeen(taskRecord.id, lastMove.at); setMoveHidden(true); }
    onClick?.(taskRecord);
  };

  const cardButton = (
    <button
      ref={dragHandleRef}
      {...dragAttributes}
      {...dragListeners}
      type="button"
      data-testid="task-card"
      aria-label={cardName}
      onClick={open}
      className={cn(
        "group relative min-h-[128px] w-full min-w-0 cursor-pointer overflow-hidden rounded-[8px] bg-card text-left transition-colors duration-[180ms]",
        "border border-border shadow-2xs hover:border-border/80",
        master?.draft && "border-dashed",
        "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
      )}
    >
      <div className="grid min-h-[128px] grid-rows-[auto_auto_auto] gap-3 p-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <h4
            className={cn(
              "min-w-0 line-clamp-3 text-left text-[13px] font-medium leading-[18px] tracking-tight text-foreground",
              master ? (allApproved ? "text-muted-foreground" : "") : titlePresentation.className,
            )}
            title={taskRecord.title}
            aria-label={master ? undefined : titlePresentation.ariaLabel}
          >
            {taskRecord.title}
          </h4>
          {lockedCopy ? (
            <span className="ml-auto shrink-0 self-start text-muted-foreground" title={lockReason} aria-label={lockReason}>
              <Lock className="size-3" />
            </span>
          ) : null}
        </div>
        {master ? (
          master.draft ? (
            <p className="font-mono text-[11px] text-muted-foreground">{scheduled ? publishLine(taskRecord.publishAt!) : `Not published · goes to ${audienceLabel(taskRecord.audience).replace(/^Everyone · (\d+)$/, "$1 people")}`}</p>
          ) : line && stages ? (
            <div className="space-y-1.5">
              <StageBar stages={stages} />
              <p className={cn("font-mono text-[11px]", allApproved ? "text-[var(--status-success)]" : "text-muted-foreground")}>{closedPrefix}{line.text}</p>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground">{master.closed ? `${closedPrefix}nobody had it` : "Nobody has it yet. People get it when they join."}</p>
          )
        ) : ownStage && ownStage.state !== "not_started" && ownStage.state !== "in_progress" ? (
          <p className={cn("line-clamp-2 font-mono text-[11px]", ownChip?.tone === "danger" ? "text-[var(--status-danger)]" : ownChip?.tone === "success" ? "text-[var(--status-success)]" : "text-muted-foreground")}>{copyStageLine(ownStage)}</p>
        ) : stuck ? (
          // Assignment flow decision 6: what's in the way, while it sits in Blocked.
          <p className="line-clamp-2 font-mono text-[11px] text-[var(--status-danger)]">{taskRecord.stuckNote ? `Stuck: ${taskRecord.stuckNote}` : "Stuck"}</p>
        ) : null}
        {!master && lastMove && !moveHidden ? (
          <p data-why-moved className="line-clamp-2 rounded-[4px] bg-primary/10 px-1.5 py-1 font-mono text-[11px] text-primary">{lastMove.text}</p>
        ) : null}

        {/* Keep the card compact: stable status first (if enabled), then semantic labels without a horizontal scroller. */}
        <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-1.5">
          {masterChip ? (
            <span className={cn("shrink-0 rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-semibold",
              masterChip.tone === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" : masterChip.tone === "accent" ? "border-primary/30 text-primary" : "border-border bg-muted/40 text-muted-foreground")}>{masterChip.label}</span>
          ) : null}
          {ownChip ? (
            <span className={cn("shrink-0 rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-semibold",
              ownChip.tone === "danger" ? "border-destructive/20 bg-destructive/10 text-destructive" : ownChip.tone === "success" ? "border-[var(--status-success)]/30 text-[var(--status-success)]" : "border-border bg-muted/40 text-muted-foreground")}>{ownChip.label}</span>
          ) : null}
          {stuck ? (
            <span className="shrink-0 rounded-[3px] border border-destructive/20 bg-destructive/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-destructive">Blocked</span>
          ) : null}
          {showStatus && taskRecord.reviewStatus !== "pending" && !master && (
            <TaskStatusBadge status={taskRecord.status} className="shrink-0" />
          )}
          <div className="shrink-0">
            <TaskPriorityBadge priority={taskRecord.priority} />
          </div>
          {chip ? <span data-testid="type-chip" className="shrink-0 rounded-[3px] border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">{chip}</span> : null}
          {/* Report 38.5 S9: the project this is Part of, one line, truncated. */}
          {taskRecord.partOf ? (
            <span data-testid="partof-chip" title={`Part of ${taskRecord.partOf.title}`} className="inline-flex min-w-0 max-w-[12rem] shrink items-center gap-1 rounded-[3px] border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {createElement(workflowIcon("FolderKanban"), { "aria-hidden": true, className: "size-3 shrink-0" })}<span className="truncate">{taskRecord.partOf.title}</span>
            </span>
          ) : null}
          {taskRecord.reviewStatus === "pending" && !ownChip && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground">
              <Lock className="size-3" />
              In review
            </span>
          )}
          {timing === "overdue" && (
            <span className="shrink-0 rounded-[3px] border border-destructive/20 bg-destructive/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-destructive">
              Overdue
            </span>
          )}
          {timing === "unfinished" && (
            <span className="shrink-0 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Incomplete
            </span>
          )}
          {timing === "overtime" && (
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
                "max-w-[180px] shrink-0 truncate rounded-[3px] border px-2 py-0.5 font-mono text-[11px] font-semibold",
                taskRecord.sprint.status
                  ? SPRINT_STATUS_PRESENTATION[taskRecord.sprint.status]
                      .toneClassName
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
              title={sprintPath}
            >
              {sprintPath}
            </span>
          )}
          {taskRecord.storyPoints != null && (
            <span data-story-point className="shrink-0 rounded-[3px] border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
              {taskRecord.storyPoints} pts
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-1.5 border-t border-border/50 pt-1.5">
          {/* Avatar + task counts share one fixed footer row; names belong in the tooltip.
              Member card lifecycle (2026-11-10): at most one item here may shrink (the label); everything else keeps
              its size, and this side clips at its edge, so nothing is ever painted over anything else. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {master ? (
              <span className={FOOTER_LABEL} title={audienceLabel(taskRecord.audience)}>
                <AssignmentIcon allDone={allApproved} className="size-3.5" />
                <span className={FOOTER_LABEL_TEXT}>{audienceLabel(taskRecord.audience)}</span>
              </span>
            ) : isCopy ? (
              // Decisions 6 and 14, gap 24: on a copy the slot says who it's from; the holder's own avatar says nothing.
              <span className={FOOTER_LABEL} title={taskRecord.fromLabel ? `Assignment from ${taskRecord.fromLabel}` : "Assignment"}>
                <AssignmentIcon className="size-3.5" />
                <span className={FOOTER_LABEL_TEXT}>{taskRecord.fromLabel ? `From ${taskRecord.fromLabel}${taskRecord.teamName ? ` · ${taskRecord.teamName}` : ""}` : "Assignment"}</span>
              </span>
            ) : taskRecord.assignee ? (
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
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {deadlineLabel && (
              <div
                data-deadline={fixByLabel ? "fix-by" : "due"}
                title={fixByLabel ? `Fix by ${fixByLabel}` : `Due ${deadlineLabel}`}
                className={cn(
                  "flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-semibold",
                  fixByLabel || timing === "overdue" || timing === "overtime"
                    ? "border-destructive/20 bg-destructive/10 text-destructive"
                    : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}
              >
                <Calendar className="size-3" />
                {deadlineLabel}
              </div>
            )}
            {typeIcon ? (
              // Report 38.2 S5: the type's icon before NB-n; faded when its workflow is hidden here.
              <span title={typeHidden ? `${ownTab?.name ?? "This workflow"} is hidden in this workspace` : WORKFLOW_TYPES[taskRecord.itemType!]?.label} className={cn("inline-flex", typeHidden && "opacity-40")}>
                {createElement(typeIcon, { "aria-label": WORKFLOW_TYPES[taskRecord.itemType!]?.label, className: "size-3.5 text-muted-foreground" })}
              </span>
            ) : null}
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
