"use client";

import { WorkWithAgent } from "../components/WorkWithAgent";
import { HandInSection } from "@/components/organizations/HandInSection";
import { MasterEditButton } from "@/components/organizations/MasterEditButton";
import { isAssignmentMaster } from "@/lib/workspaces/task-presentation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { formatTaskDueDate, isTaskOverdue } from "@/lib/workspaces/task-presentation";
import {
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Edit3,
  ExternalLink,
  Flag,
  FolderPlus,
  Lock,
  MessageSquareQuote,
  Search,
  TriangleAlert,
  User,
  X as XIcon,
  Zap,
} from "lucide-react";
import { addDays, format, formatDistanceToNow } from "@/lib/utils/date";
import { AgentNotes } from "./AgentNotes";
import { AgentPresence } from "./AgentPresence";
import { ChangeSetPresence } from "../../files-tab/ChangeSetPresence";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { listTaskSourceMessages } from "@/app/actions/chat/messages";
import { queryKeys } from "@/lib/query-keys";
import { approveTaskReviewAction, requestTaskChangesAction, resubmitTaskReviewAction, getTaskReviewStateAction } from "@/app/actions/task";
import type { TaskFileReadinessWarning } from "@/lib/workspaces/task-file-intelligence";
import { normalizeTaskTitleDraft } from "@/lib/workspaces/task-file-intelligence";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/workspaces/sprint-detail";
import {
  getTaskTitlePresentation,
  isAssignableSprintOption,
  normalizeAssignableMembers,
  normalizeSprintOptions,
  type TaskSurfaceRecord,
} from "@/lib/workspaces/task-presentation";
import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/workspaces/task-workflow";
import type { TaskPanelTab } from "@/hooks/useTaskPanelResource";
import { buildWorkspacePersonReference } from "@/lib/workspaces/settings-policies";
import { messageHref } from "@/lib/messaging/routes";
import { useTaskCompletionPolicy } from "@/hooks/useTaskCompletionPolicy";
import { completionActionLabel } from "@/lib/workspaces/task-completion-policy";
import { cn } from "@/lib/utils";

interface DetailsTabProps {
  task: TaskSurfaceRecord;
  canEdit: boolean;
  /** Source chat messages are members-only; visitors never query them. */
  canReadSourceMessages?: boolean;
  canManageSprint?: boolean;
  isMutating: boolean;
  mutationError: string | null;
  members?: any[];
  sprints?: any[];
  subtaskCount: number;
  completedSubtaskCount: number;
  attachmentCount: number;
  fileWarnings?: TaskFileReadinessWarning[];
  fileWarningSummary?: string | null;
  onUpdateField: (
    field:
      | "title"
      | "description"
      | "priority"
      | "sprintId"
      | "dueDate"
      | "storyPoints",
    value: unknown,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateStatus: (
    status: string,
  ) => Promise<{ success: boolean; error?: string }>;
  onUpdateAssignee: (
    assigneeId: string | null,
  ) => Promise<{ success: boolean; error?: string }>;
  onReviewApproved: (updatedAt: string, status?: "done" | "in_progress" | "todo" | "blocked", reviewStatus?: "none" | "pending" | "rejected") => void;
  onOpenTab: (tab: TaskPanelTab) => void;
  /** Review UX 2.11: the Hand in card opens the copy's private conversation or class questions. */
  onOpenConversation?: (kind: "private" | "class") => void;
  /** Hand in takes files straight in (step 13 gap), through the panel's own upload. */
  onUploadFiles?: (files: File[]) => Promise<{ success: boolean; error?: string }>;
  /** Live loop 34: take an earlier file off work that's open again. */
  onRemoveFile?: (nodeId: string) => Promise<{ success: boolean; error?: string }>;
  workflowColumns?: { id: string; name: string }[];
  onMoveToColumn?: (columnId: string) => Promise<{ success: boolean; error?: string }>;
  /** For "Work with an agent" (CLI report A9.6). */
  projectSlug?: string | null;
}

export default function DetailsTab({
  task,
  canEdit,
  canReadSourceMessages = true,
  canManageSprint = false,
  isMutating,
  mutationError,
  members = [],
  sprints = [],
  subtaskCount,
  completedSubtaskCount,
  attachmentCount,
  fileWarnings = [],
  fileWarningSummary = null,
  onUpdateField,
  onUpdateStatus,
  onUpdateAssignee,
  onReviewApproved,
  onUploadFiles,
  onRemoveFile,
  onOpenTab,
  onOpenConversation,
  workflowColumns,
  onMoveToColumn,
  projectSlug = null,
}: DetailsTabProps) {
  const policy = useTaskCompletionPolicy(task.projectId ?? "");
  const master = isAssignmentMaster(task);
  // Student check 5 (assignmentWriteBlock, reassignBlock): a copy's title, instructions and due date are set by the
  // organization, Submit hands it in, and only a team copy changes hands.
  // Review UX 1.8: a main assignment's set fields change for everyone through Edit for everyone, never here.
  const canEditSet = canEdit && !task.assignmentId && !master;
  const copyKeepsPerson = Boolean(task.assignmentId) && !task.teamName;
  const reviewState = useQuery({
    queryKey: ["task-review-state", task.id, task.updatedAt, completedSubtaskCount, attachmentCount],
    enabled: Boolean(task.projectId),
    staleTime: 0,
    queryFn: async () => {
      const result = await getTaskReviewStateAction(task.id, task.projectId!);
      if (!result.success) throw new Error(result.error);
      return result;
    },
  });
  const canReview = canEdit && policy.data?.canManage;
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [changesReason, setChangesReason] = useState("");
  const titlePresentation = getTaskTitlePresentation(task);
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [titleDraft, setTitleDraft] = useState(task.title);

  // Concurrency Focus Protection for Title
  useEffect(() => {
    if (document.activeElement !== titleInputRef.current) {
      setTitleDraft(task.title);
    }
  }, [task.title]);

  // Description Edit & Markdown Preview State
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  // Kept for the tab while editing, so leaving and coming back keeps it (unified back B12).
  const [descriptionDraft, setDescriptionDraft, clearDescriptionDraft] = useSessionDraft(
    isEditingDescription ? `draft:task-description:${task.id}` : null,
    task.description || "",
  );

  // Concurrency Focus Protection for Description
  useEffect(() => {
    if (!isEditingDescription) {
      setDescriptionDraft(task.description || "");
    }
  }, [task.description, isEditingDescription]);

  // Assignee Search Filter State
  const [assigneeSearch, setAssigneeSearch] = useState("");

  const availableSprints = useMemo(
    () => normalizeSprintOptions(sprints),
    [sprints],
  );
  const availableMembers = useMemo(
    () => normalizeAssignableMembers(members),
    [members],
  );
  const availableMemberIds = useMemo(
    () => new Set(availableMembers.map((member) => member.id)),
    [availableMembers],
  );
  const currentAssigneeUnavailable = Boolean(
    task.assigneeId && !availableMemberIds.has(task.assigneeId),
  );
  const currentAssigneeReference = task.assignee
    ? buildWorkspacePersonReference({
        person: task.assignee,
        isActiveMember: !currentAssigneeUnavailable,
      })
    : null;
  const currentAssigneeLabel =
    currentAssigneeReference?.displayName ||
    task.assignee?.fullName ||
    "Unassigned";

  const filteredMembers = useMemo(() => {
    if (!assigneeSearch.trim()) return availableMembers;
    const query = assigneeSearch.toLowerCase();
    return availableMembers.filter((m) =>
      (m.identity?.fullName || "").toLowerCase().includes(query),
    );
  }, [availableMembers, assigneeSearch]);

  const createdAtLabel =
    task.createdAt && Number.isFinite(Date.parse(task.createdAt))
      ? format(new Date(task.createdAt), "MMM d, yyyy h:mm a")
      : "Unknown";
  const creatorName = task.creator?.fullName || "Unknown";
  const creatorAvatar = task.creator?.avatarUrl || null;

  const updatedAtLabel = useMemo(() => {
    if (!task.updatedAt || !Number.isFinite(Date.parse(task.updatedAt))) return null;
    try {
      return formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true });
    } catch {
      return null;
    }
  }, [task.updatedAt]);

  const isOverdue = isTaskOverdue(task);

  const setDueDatePreset = (daysFromToday: number | null) => {
    if (daysFromToday === null) {
      void onUpdateField("dueDate", null);
      return;
    }
    const targetDate = addDays(new Date(), daysFromToday);
    void onUpdateField("dueDate", format(targetDate, "yyyy-MM-dd"));
  };

  const saveDescription = async () => {
    const trimmed = descriptionDraft.trim();
    if (trimmed !== (task.description || "").trim()) {
      const result = await onUpdateField("description", trimmed);
      // Leave edit mode only once it saved; a failure keeps the draft open to retry.
      if (!result.success) return;
    }
    clearDescriptionDraft();
    setIsEditingDescription(false);
  };

  // Story points commit on blur or Enter, never per keystroke.
  const [pointsDraft, setPointsDraft] = useState(task.storyPoints == null ? "" : String(task.storyPoints));
  useEffect(() => {
    setPointsDraft(task.storyPoints == null ? "" : String(task.storyPoints));
  }, [task.storyPoints]);
  const commitPoints = () => {
    const trimmed = pointsDraft.trim();
    const next = trimmed ? Number.parseInt(trimmed, 10) : null;
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > 100)) {
      setPointsDraft(task.storyPoints == null ? "" : String(task.storyPoints));
      return;
    }
    if (next !== (task.storyPoints ?? null)) void onUpdateField("storyPoints", next);
  };

  // Mockup task 1: a main assignment has no files of its own, so the final-file check never applies to it.
  const showDoneWarnings = task.status === "done" && fileWarnings.length > 0 && !master;
  const sourceLinksQuery = useQuery({
    queryKey: queryKeys.chat.taskSource(task.id),
    enabled: canReadSourceMessages,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await listTaskSourceMessages({ taskId: task.id });
      if (!result.success)
        throw new Error("Couldn’t load source message");
      return result.links;
    },
  });
  const sourceLinks = sourceLinksQuery.data ?? [];

  const [isApproving, setIsApproving] = React.useState(false);
  const queryClient = useQueryClient();
  const [reviewError, setReviewError] = React.useState<string | null>(null);

  const handleApprove = async () => {
    if (!task.projectId) return;
    setReviewError(null);
    setIsApproving(true);
    try {
      const res = await approveTaskReviewAction(task.id, task.projectId, task.updatedAt ?? undefined);
      if (res.success && res.updatedAt) {
        onReviewApproved(res.updatedAt);
        void queryClient.invalidateQueries({
          queryKey: ["files-task-collections", task.projectId],
        });
      } else setReviewError(res.error || "Couldn’t approve task review");
    } finally {
      setIsApproving(false);
    }
  };

  const updateReview = async (resubmit: boolean) => {
    if (!task.projectId || !task.updatedAt) return;
    setIsApproving(true);
    setReviewError(null);
    try {
      const result = resubmit
        ? await resubmitTaskReviewAction(task.id, task.projectId, task.updatedAt)
        : await requestTaskChangesAction(task.id, task.projectId, changesReason, task.updatedAt);
      if (!result.success) throw new Error(result.error);
      onReviewApproved(result.updatedAt, result.status, result.reviewStatus);
      setRequestingChanges(false);
      setChangesReason("");
      void reviewState.refetch();
      void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(task.projectId) });
    } catch (error) { setReviewError(error instanceof Error ? error.message : "Couldn’t update review"); }
    finally { setIsApproving(false); }
  };

  return (
    // Read-only viewers see values at full contrast, not as faded disabled controls.
    <div
      data-readonly={canEdit ? undefined : ""}
      className="min-w-0 space-y-6 p-6 max-md:p-4 data-[readonly]:[&_:disabled]:opacity-100 data-[readonly]:[&_:disabled]:cursor-default"
    >
      {task.projectId ? <AgentPresence projectId={task.projectId} taskId={task.id} /> : null}
      {task.projectId ? <ChangeSetPresence projectId={task.projectId} taskId={task.id} /> : null}
      {mutationError ? (
        <div className="rounded-[5px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {mutationError}
        </div>
      ) : null}

      {/* Decision 85: an assignment copy is handed in here, for every hand-in type. */}
      {task.assignmentId ? (
        <HandInSection copyId={task.id} onOpenFiles={() => onOpenTab("files")} onUploadFiles={onUploadFiles} onRemoveFile={onRemoveFile} onOpenConversation={onOpenConversation}
          onSubmitted={(review) => onReviewApproved(new Date().toISOString(), "done", review ? "pending" : "none")}
          onReviewed={(decision) => onReviewApproved(new Date().toISOString(), decision === "approve" ? "done" : "in_progress", decision === "approve" ? "none" : "rejected")} />
      ) : null}

      {/* Review UX 2.1, 3.12: a hand-in is reviewed through its own card and the queue, not this generic box. */}
      {task.reviewStatus === "pending" && !master && !task.assignmentId ? (
        <div className="rounded-[6px] border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-foreground">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <div className="space-y-2 flex-1">
              <div className="font-semibold text-foreground">In review</div>
              <div className="text-xs text-muted-foreground">
                Waiting for an owner or admin to approve. Final files are added to Files separately.
                {reviewState.data?.submittedAt ? ` Submitted ${formatDistanceToNow(new Date(reviewState.data.submittedAt), { addSuffix: true })}.` : ""}
              </div>
              {reviewError ? (
                <p className="text-xs text-destructive">{reviewError}</p>
              ) : null}
              {reviewState.data?.changed ? <p className="text-xs text-amber-700 dark:text-amber-300">This task changed after it was submitted. Submit it again for review.</p> : null}
              {reviewState.isError ? <p role="alert" className="text-xs text-destructive">Couldn’t check this submission. <button type="button" className="underline" onClick={() => void reviewState.refetch()}>Retry</button></p> : null}
              {canReview ? (
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleApprove()}
                    disabled={isApproving || !reviewState.data || reviewState.data.changed}
                    className="nb-touch-target inline-flex h-[34px] items-center gap-1.5 px-3 rounded-[5px] bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    <Check className="size-3.5" />
                    {isApproving ? "Saving…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRequestingChanges((value) => !value)}
                    disabled={isApproving}
                    className="nb-touch-target inline-flex h-[34px] items-center gap-1.5 px-3 rounded-[5px] border border-border bg-card text-foreground text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <XIcon className="size-3.5" />
                    Request changes
                  </button>
                </div>
              ) : null}
              {canEdit && (reviewState.data?.changed || !reviewState.data?.submittedAt || Boolean(reviewError)) ? <button type="button" disabled={isApproving} className="nb-touch-target text-xs font-medium underline" onClick={() => void updateReview(true)}>Submit again</button> : null}
              {requestingChanges && canReview ? <div className="space-y-2 border-t border-border pt-3">
                <label htmlFor="task-review-reason" className="text-xs font-medium">What needs to change?</label>
                <textarea id="task-review-reason" value={changesReason} onChange={(event) => setChangesReason(event.target.value)} maxLength={2000} rows={3} className="w-full rounded-[5px] border border-border bg-background px-3 py-2 text-sm" />
                <div className="flex gap-3"><button type="button" disabled={isApproving || !changesReason.trim()} className="nb-touch-target text-xs font-medium disabled:opacity-50" onClick={() => void updateReview(false)}>Move back to In progress</button><button type="button" className="nb-touch-target text-xs" onClick={() => setRequestingChanges(false)}>Cancel</button></div>
              </div> : null}
            </div>
          </div>
        </div>
      ) : null}
      {task.reviewStatus === "rejected" && !master && !task.assignmentId && reviewState.data?.reason ? <p className="border-b border-border pb-3 text-sm"><span className="font-medium">Changes requested: </span>{reviewState.data.reason}</p> : null}
      {reviewState.data?.completedAt && !task.assignmentId ? <p className="nb-meta text-muted-foreground">Completed {format(new Date(reviewState.data.completedAt), "MMM d, yyyy h:mm a")}</p> : null}

      {showDoneWarnings ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-2">
              <div className="font-medium">
                {fileWarningSummary ||
                  "Task files need follow-up."}
              </div>
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-200">
                {fileWarnings.map((warning) => (
                  <li key={warning.code} className="list-inside list-disc">
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {/* Title & Metadata Block */}
      <div className="space-y-3">
        <div className="relative">
          <textarea
            key={`title-${task.id}`}
            ref={(el) => {
              titleInputRef.current = el;
              if (el) {
                el.style.height = "0px";
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            value={titleDraft}
            onChange={(event) => {
              setTitleDraft(event.target.value);
              event.target.style.height = "0px";
              event.target.style.height = `${event.target.scrollHeight}px`;
            }}
            onBlur={(event) => {
              const normalized = normalizeTaskTitleDraft(event.target.value);
              if (!normalized) {
                setTitleDraft(task.title); // revert on empty
                return;
              }
              if (normalized !== task.title) {
                // A failed save keeps the draft (the rollback would otherwise overwrite it).
                void onUpdateField("title", normalized).then((result) => {
                  if (!result.success) {
                    setTitleDraft(normalized);
                    titleInputRef.current?.focus();
                  }
                });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            disabled={!canEditSet || isMutating}
            rows={1}
            aria-label={titlePresentation.ariaLabel ?? "Task title"}
            className={cn(
              "w-full resize-none overflow-hidden rounded-[5px] border border-transparent bg-transparent text-lg font-semibold tracking-[-0.01em] text-foreground leading-snug outline-none transition placeholder:text-muted-foreground/50 focus:border-border/80 focus:bg-background/50 px-1 -mx-1 disabled:opacity-60",
              titlePresentation.className,
              titlePresentation.isCompleted &&
                "focus:no-underline focus:text-foreground",
            )}
            placeholder="Task title"
          />
        </div>

        {/* Report 38.3 S6: a row of a document's list says where it came from. */}
        {task.source ? (
          <p className="text-xs text-muted-foreground" data-testid="task-from-line">
            From: <a href={`?tab=docs&doc=${encodeURIComponent(task.source.docSlug)}`} className="font-medium text-foreground underline-offset-2 hover:underline">{task.source.docTitle}</a>
          </p>
        ) : null}
        {/* Creator & Live Telemetry Metadata */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Created by</span>
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <UserAvatar
              identity={{
                fullName: creatorName,
                avatarUrl: creatorAvatar,
              }}
              size={18}
            />
            <span>{creatorName}</span>
          </div>
          <span className="text-muted-foreground/40">·</span>
          <div
            className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground"
            title={task.createdAt ?? undefined}
          >
            <Clock className="size-3 text-muted-foreground" />
            <span>{createdAtLabel}</span>
          </div>
          {updatedAtLabel ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[11px] text-muted-foreground">
                Updated {updatedAtLabel}
              </span>
            </>
          ) : null}
          <span className="text-muted-foreground/40">·</span>
          <span
            className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground"
            title="Autosave status"
          >
            <span
              className={cn(
                "size-1.5 rounded-[1px] transition-colors",
                isMutating ? "bg-amber-500 animate-pulse" : "bg-emerald-500",
              )}
            />
            {isMutating ? "Saving…" : "Saved"}
          </span>
        </div>
      </div>

      {sourceLinksQuery.error ? (
        <div className="rounded-[5px] border border-destructive/20 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          {sourceLinksQuery.error instanceof Error
            ? sourceLinksQuery.error.message
            : "Couldn’t load source messages"}
        </div>
      ) : null}

      {sourceLinks.map((sourceLink, index) => (
        <div
          key={`${sourceLink.channel_id}:${sourceLink.seq}:${index}`}
          className="rounded-[6px] border border-border bg-card px-4 py-3 text-sm text-foreground"
        >
          <div className="flex items-start gap-3">
            <MessageSquareQuote className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-foreground">
                Created from message
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {sourceLink.channel_name
                  ? `In #${sourceLink.channel_name}`
                  : "Open the original conversation."}
              </div>
            </div>
            {sourceLink.channel_id ? (
              <a
                href={messageHref(sourceLink.channel_id, sourceLink.seq, sourceLink.thread_root_seq)}
                className="inline-flex items-center gap-1 rounded-[5px] border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
              >
                Open source
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      ))}

      {master && canEdit && task.projectId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[5px] border border-border bg-muted/30 px-3 py-2 text-[13px] text-muted-foreground">
          <span>The title, instructions, due date and priority change for everyone.</span>
          <MasterEditButton orgId={task.projectId} masterId={task.id} />
        </div>
      ) : null}

      {/* Description Block (Markdown Preview + Autogrow Editor) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Description
          </label>
          {!isEditingDescription && task.description && canEditSet ? (
            <button
              type="button"
              onClick={() => setIsEditingDescription(true)}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition"
            >
              <Edit3 className="size-3" />
              Edit
            </button>
          ) : null}
        </div>

        {isEditingDescription ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              rows={4}
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void saveDescription();
                } else if (e.key === "Escape") {
                  clearDescriptionDraft();
                  setIsEditingDescription(false);
                }
              }}
              placeholder="Add a detailed description or context for this task… (supports Markdown)"
              className="min-h-[100px] w-full resize-y rounded-[5px] border border-primary bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none transition placeholder:text-muted-foreground/60 shadow-2xs"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <span className="font-mono text-[11px] text-muted-foreground">
                <kbd className="rounded-[3px] border border-border bg-muted/50 px-1 py-0.5 text-[10px] max-md:text-[11px]">
                  ⌘/Ctrl
                </kbd>{" "}
                +{" "}
                <kbd className="rounded-[3px] border border-border bg-muted/50 px-1 py-0.5 text-[10px] max-md:text-[11px]">
                  Enter
                </kbd>{" "}
                to save ·{" "}
                <kbd className="rounded-[3px] border border-border bg-muted/50 px-1 py-0.5 text-[10px] max-md:text-[11px]">
                  Esc
                </kbd>{" "}
                to cancel
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    clearDescriptionDraft();
                    setIsEditingDescription(false);
                  }}
                  className="nb-touch-target h-7 rounded-[4px] border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveDescription()}
                  className="nb-touch-target h-7 rounded-[4px] bg-primary px-3 text-xs font-medium text-primary-foreground shadow-2xs hover:bg-primary/90 transition"
                >
                  Save description
                </button>
              </div>
            </div>
          </div>
        ) : task.description ? (
          <div
            onClick={() => canEditSet && setIsEditingDescription(true)}
            className={cn(
              "group relative min-h-[72px] w-full rounded-[5px] border border-border/80 bg-background px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground transition",
              "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary",
              canEditSet
                ? "cursor-pointer hover:border-foreground/30 hover:bg-muted/10"
                : "",
            )}
            role={canEditSet ? "button" : undefined}
            tabIndex={canEditSet ? 0 : -1}
            onKeyDown={(e) => {
              if (canEditSet && (e.key === "Enter" || e.key === " ")) {
                setIsEditingDescription(true);
              }
            }}
            aria-label="Edit description"
          >
            <div className="max-w-none text-[13px] leading-relaxed break-words space-y-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-[3px] [&_code]:font-mono [&_code]:text-xs [&_a]:text-primary [&_a]:underline">
              <ReactMarkdown>{task.description}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canEditSet}
            onClick={() => setIsEditingDescription(true)}
            className="flex min-h-[64px] w-full items-center justify-start rounded-[5px] border border-dashed border-border bg-muted/10 px-3.5 py-3 text-[13px] text-muted-foreground/70 transition hover:border-foreground/30 hover:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed text-left"
          >
            <span className="flex items-center gap-1.5">
              <Edit3 className="size-3.5 text-muted-foreground/60" />
              Add a detailed description or context for this task… (supports Markdown)
            </span>
          </button>
        )}
      </div>

      {/* Properties Section (Unboxed, direct on panel surface); review UX 2.12: on a copy they fold under More details. */}
      <MoreDetails fold={Boolean(task.assignmentId)}>
      <div className="space-y-3 pt-1">
        <div className="border-b border-border/60 pb-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Properties
          </h3>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {/* Status Dropdown: a main assignment has no status, section or assignee of its own (problem 8). */}
          {master ? null : <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <Flag className="size-3 text-muted-foreground" />
              Status
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit || isMutating || task.reviewStatus === "pending"}
                  className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground flex items-center justify-between transition hover:border-foreground/30 focus:border-primary disabled:opacity-50"
                  aria-label="Select status"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2 rounded-[2px]",
                        task.status === "done"
                          ? "bg-emerald-500"
                          : task.status === "in_progress"
                            ? "bg-sky-500"
                            : task.status === "blocked"
                              ? "bg-rose-500"
                              : "bg-muted-foreground/60",
                      )}
                    />
                    <span className="font-medium">
                      {task.reviewStatus === "pending" ? "In review" : getTaskStatusPresentation(task.status).label}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 p-1">
                {TASK_WORKFLOW_STATUSES.filter((s) => !(task.assignmentId && s === "done")).map((status) => {
                  const pres = getTaskStatusPresentation(status);
                  const isSelected = task.status === status;
                  return (
                    <DropdownMenuItem
                      key={status}
                      disabled={status === "done" && !policy.data}
                      onClick={() => void onUpdateStatus(status)}
                      className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-[2px]",
                            status === "done"
                              ? "bg-emerald-500"
                              : status === "in_progress"
                                ? "bg-sky-500"
                                : status === "blocked"
                                  ? "bg-rose-500"
                                  : "bg-muted-foreground/60",
                          )}
                        />
                        <span className="font-medium">{status === "done" ? completionActionLabel(policy.data?.reviewRequired ?? false) : pres.label}</span>
                      </span>
                      {isSelected ? (
                        <Check className="size-3.5 text-primary stroke-[2.5]" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>}

          {/* Section Dropdown */}
          {!master && workflowColumns && workflowColumns.length > 0 ? (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <FolderPlus className="size-3 text-muted-foreground" />
                Section
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!canEdit || isMutating}
                    className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground flex items-center justify-between transition hover:border-foreground/30 focus:border-primary disabled:opacity-50"
                    aria-label="Select section"
                  >
                    <span className="font-medium truncate">
                      {workflowColumns.find((c) => c.id === task.workflowColumnId)?.name ?? "Select section"}
                    </span>
                    <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 p-1">
                  {workflowColumns.map((col) => {
                    const isSelected = task.workflowColumnId === col.id;
                    return (
                      <DropdownMenuItem
                        key={col.id}
                        onClick={() => void onMoveToColumn?.(col.id)}
                        className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                      >
                        <span className="font-medium truncate">{col.name}</span>
                        {isSelected ? (
                          <Check className="size-3.5 text-primary stroke-[2.5]" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          {/* Priority Dropdown */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              Priority
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit || master || isMutating}
                  className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground flex items-center justify-between transition hover:border-foreground/30 focus:border-primary disabled:opacity-50"
                  aria-label="Select priority"
                >
                  <span className="flex items-center gap-2">
                    <Flag className="size-3 text-muted-foreground" />
                    <span className="font-medium">
                      {getTaskPriorityPresentation(task.priority).label}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44 p-1">
                {TASK_PRIORITY_VALUES.map((priority) => {
                  const pres = getTaskPriorityPresentation(priority);
                  const isSelected = task.priority === priority;
                  return (
                    <DropdownMenuItem
                      key={priority}
                      onClick={() => void onUpdateField("priority", priority)}
                      className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                    >
                      <span className="font-medium">{pres.label}</span>
                      {isSelected ? (
                        <Check className="size-3.5 text-primary stroke-[2.5]" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Assignee Dropdown with Search */}
          {master ? null : <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <User className="size-3 text-muted-foreground" />
              Assignee
            </label>
            <DropdownMenu
              onOpenChange={(open) => {
                if (!open) setAssigneeSearch("");
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit || copyKeepsPerson || isMutating}
                  className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground flex items-center justify-between transition hover:border-foreground/30 focus:border-primary disabled:opacity-50"
                  aria-label="Select assignee"
                >
                  <div className="flex items-center gap-2 min-w-0 truncate">
                    {task.assignee ? (
                      <UserAvatar
                        identity={{
                          fullName: currentAssigneeLabel,
                          avatarUrl: task.assignee.avatarUrl || null,
                        }}
                        size={18}
                      />
                    ) : (
                      <User className="size-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="truncate font-medium">
                      {currentAssigneeLabel}
                    </span>
                  </div>
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 p-1 space-y-1">
                <div className="px-2 pt-1 pb-1">
                  <div className="relative flex items-center">
                    <Search className="absolute left-2 size-3 text-muted-foreground" />
                    <input
                      value={assigneeSearch}
                      onChange={(e) => setAssigneeSearch(e.target.value)}
                      placeholder="Search team members…"
                      className="nb-touch-target h-[28px] w-full rounded-[3px] border border-border bg-muted/40 pl-7 pr-2 text-xs text-foreground outline-none focus:border-primary"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
                <DropdownMenuItem
                  onClick={() => void onUpdateAssignee(null)}
                  className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                >
                  <span className="text-muted-foreground">Unassigned</span>
                  {!task.assigneeId ? (
                    <Check className="size-3.5 text-primary stroke-[2.5]" />
                  ) : null}
                </DropdownMenuItem>
                <div className="max-h-52 overflow-y-auto space-y-0.5">
                  {filteredMembers.map((member) => {
                    const isSelected = task.assigneeId === member.id;
                    return (
                      <DropdownMenuItem
                        key={member.id}
                        onClick={() => void onUpdateAssignee(member.id)}
                        className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0 truncate">
                          <UserAvatar identity={member.identity} size={18} />
                          <span className="truncate font-medium">
                            {member.identity?.fullName || "Unknown"}
                          </span>
                        </div>
                        {isSelected ? (
                          <Check className="size-3.5 text-primary stroke-[2.5]" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                  {filteredMembers.length === 0 ? (
                    <div className="py-2 text-center text-xs text-muted-foreground">
                      No members match search
                    </div>
                  ) : null}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {currentAssigneeUnavailable ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Removed from workspace · needs reassignment
              </p>
            ) : null}
          </div>}

          {/* Sprint Dropdown */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <Zap className="size-3 text-muted-foreground" />
              Sprint
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={!canEdit || !canManageSprint || isMutating}
                  className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground flex items-center justify-between transition hover:border-foreground/30 focus:border-primary disabled:opacity-50"
                  aria-label="Select sprint"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Zap className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate font-medium">
                      {availableSprints.find((s) => s.id === task.sprintId)
                        ?.name || "Backlog"}
                    </span>
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-56 p-1 max-h-56 overflow-y-auto space-y-0.5"
              >
                <DropdownMenuItem
                  onClick={() => void onUpdateField("sprintId", null)}
                  className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer"
                >
                  <span className="font-medium">Backlog</span>
                  {!task.sprintId ? (
                    <Check className="size-3.5 text-primary stroke-[2.5]" />
                  ) : null}
                </DropdownMenuItem>
                {availableSprints.map((sprint) => {
                  const isSelected = task.sprintId === sprint.id;
                  const assignable = isAssignableSprintOption(sprint);
                  return (
                    <DropdownMenuItem
                      key={sprint.id}
                      disabled={!assignable}
                      onClick={() =>
                        assignable && void onUpdateField("sprintId", sprint.id)
                      }
                      className="flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer disabled:opacity-50"
                    >
                      <div className="truncate min-w-0">
                        <span className="font-medium truncate">{sprint.name}</span>
                        {!assignable && sprint.status ? (
                          <span className="text-[10px] max-md:text-[11px] text-muted-foreground ml-1.5">
                            (
                            {SPRINT_STATUS_PRESENTATION[sprint.status]?.label ||
                              "Unavailable"}
                            )
                          </span>
                        ) : null}
                      </div>
                      {isSelected ? (
                        <Check className="size-3.5 text-primary stroke-[2.5]" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Due date with Quick Presets & Overdue Status */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="task-due-date" className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                <Calendar className="size-3 text-muted-foreground" />
                Due date
              </label>
              {isOverdue ? (
                <span className="inline-flex items-center rounded-[3px] border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">
                  Overdue
                </span>
              ) : null}
            </div>
            <input
              id="task-due-date"
              type="date"
              value={task.dueDate ? task.dueDate.slice(0, 10) : ""}
              onChange={(event) =>
                void onUpdateField("dueDate", event.target.value || null)
              }
              disabled={!canEditSet || isMutating}
              className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus:border-primary disabled:opacity-50"
            />
            <div className={cn("flex flex-wrap items-center gap-1 pt-0.5", !canEditSet && "hidden")}>
              <button
                type="button"
                disabled={!canEditSet || isMutating}
                onClick={() => setDueDatePreset(0)}
                className="nb-touch-target h-5 rounded-[3px] border border-border bg-muted/30 px-1.5 font-mono text-[10px] font-medium max-md:text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-50"
              >
                Today
              </button>
              <button
                type="button"
                disabled={!canEditSet || isMutating}
                onClick={() => setDueDatePreset(7)}
                className="nb-touch-target h-5 rounded-[3px] border border-border bg-muted/30 px-1.5 font-mono text-[10px] font-medium max-md:text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-50"
              >
                +1 Week
              </button>
              <button
                type="button"
                disabled={!canEditSet || isMutating}
                onClick={() => setDueDatePreset(14)}
                className="nb-touch-target h-5 rounded-[3px] border border-border bg-muted/30 px-1.5 font-mono text-[10px] font-medium max-md:text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-50"
              >
                +2 Weeks
              </button>
              {task.dueDate ? (
                <button
                  type="button"
                  disabled={!canEditSet || isMutating}
                  onClick={() => setDueDatePreset(null)}
                  className="nb-touch-target h-5 rounded-[3px] border border-border bg-muted/30 px-1.5 font-mono text-[10px] font-medium max-md:text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition disabled:opacity-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Story points */}
          <div className="space-y-1.5" data-story-point>
            <label htmlFor="task-story-points" className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <Zap className="size-3 text-muted-foreground" />
              Estimate
            </label>
            <input
              id="task-story-points"
              type="number"
              min={0}
              max={100}
              value={pointsDraft}
              onChange={(event) => setPointsDraft(event.target.value)}
              onBlur={commitPoints}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPoints();
                }
              }}
              placeholder="No estimate"
              disabled={!canEdit || master || isMutating}
              className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 font-mono text-[13px] text-foreground outline-none transition focus:border-primary disabled:opacity-50"
            />
            <div className={cn("flex flex-wrap items-center gap-1 pt-0.5", !canEdit && "hidden")}>
              <span className="shrink-0 font-mono text-[10px] max-md:text-[11px] uppercase tracking-[0.06em] text-muted-foreground mr-0.5 whitespace-nowrap">
                Presets:
              </span>
              {[1, 2, 3, 5, 8, 13].map((points) => (
                <button
                  key={points}
                  type="button"
                  onClick={() =>
                    void onUpdateField(
                      "storyPoints",
                      task.storyPoints === points ? null : points,
                    )
                  }
                  disabled={!canEdit || master || isMutating}
                  className={cn(
                    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] border font-mono text-[10px] max-md:text-[11px] font-semibold transition-colors disabled:opacity-50",
                    task.storyPoints === points
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {points}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      </MoreDetails>
      {task.projectId ? <AgentNotes projectId={task.projectId} taskId={task.id} /> : null}
      <WorkWithAgent projectSlug={projectSlug} taskNumber={task.taskNumber} canEdit={canEdit} />
    </div>
  );
}

function MoreDetails({ fold, children }: { fold: boolean; children: React.ReactNode }) {
  if (!fold) return <>{children}</>;
  return (
    <details className="group border-t border-border pt-3">
      <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">More details</summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}
