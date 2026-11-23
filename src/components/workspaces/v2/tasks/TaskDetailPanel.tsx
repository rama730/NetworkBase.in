"use client";

import { ClassQuestions } from "@/components/organizations/ClassQuestions";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { projectTaskHref } from "@/lib/workspaces/task-presentation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bug,
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  FolderPlus,
  Laptop,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { AssignmentManageSection } from "@/components/organizations/AssignmentsPanel";
import { HandInChip } from "@/components/organizations/HandInSection";

import { deleteTaskAction, markTaskAsReadAction } from "@/app/actions/workspace";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { TaskStageControl } from "@/components/workspaces/v2/tasks/TaskStageControl";
import { ProjectWork } from "@/components/workspaces/v2/tasks/PlannerParts";
import { removeTaskFromWorkspaceTaskCaches } from "@/lib/workspaces/task-cache";
import { changeTaskTypeAction } from "@/app/actions/task";
import { changeTypeOptions } from "@/lib/workflows/bugs";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { useAddedWorkflows } from "@/components/workspaces/workflows/added-workflows";
import { formatTaskId } from "@/lib/workspace-key";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  normalizeTaskSurfacePerson,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/workspaces/task-presentation";
import {
  useTaskPanelResource,
  type TaskPanelTab,
} from "@/hooks/useTaskPanelResource";
import dynamic from "next/dynamic";

const CommentsTab = dynamic(() => import("./TaskDetailTabs/CommentsTab"), {
  loading: () => (
    <div className="space-y-3 p-4" aria-busy="true">
      <div className="nb-skeleton h-10 w-full rounded" />
      <div className="nb-skeleton h-24 w-full rounded" />
    </div>
  ),
  ssr: false,
});
import DetailsTab from "./TaskDetailTabs/DetailsTab";
const FilesTab = dynamic(() => import("./TaskDetailTabs/FilesTab"), {
  loading: () => (
    <div className="space-y-3 p-4" aria-busy="true">
      <div className="nb-skeleton h-10 w-full rounded" />
      <div className="nb-skeleton h-32 w-full rounded" />
    </div>
  ),
  ssr: false,
});
import SubtasksTab from "./TaskDetailTabs/SubtasksTab";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import TaskStatusBadge from "./badges/TaskStatusBadge";
import { isAssignmentMaster } from "@/lib/workspaces/task-presentation";
import { masterChip, MASTER_TAB_NOTES } from "@/lib/organizations/assignment-rules";
import { OpenInIdeButton, OpenInIdeSheet } from "@/components/workspaces/v2/files-tab/OpenInIdeButton";
import { StartWorkOnBranch } from "./StartWorkOnBranch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReportMenuItem, useReportDialog } from "@/components/reports/ReportDialog";
import { copyOrSay } from "@/lib/clipboard";
import { toast } from "@/lib/feedback";
import { TaskAgentQuestions } from "@/components/questions/TaskAgentQuestions";

const TONE_STATUS = { info: "active", warn: "draft", muted: "archived" } as const;

interface TaskDetailPanelProps {
  task: TaskSurfaceRecord | any;
  onClose: () => void;
  onTaskUpdated?: (task: TaskSurfaceRecord) => void;
  canEdit: boolean;
  /** Visitors read details and subtasks; comments, files and source links are for members. */
  isMember?: boolean;
  /** Organization admins outside the workspace review its group work (report §42.14 problem 36). */
  reviewsGroupWork?: boolean;
  canManageFiles?: boolean;
  isOwner?: boolean;
  /** Owners and admins plan sprints (decision 146): the Join-board sheet offers the running sprint to them. */
  canPlanSprints?: boolean;
  /** Report 38.5 W3: a project's Work tab adds existing tasks from these and opens New with Part of filled. */
  projectCandidates?: TaskSurfaceRecord[];
  onNewInProject?: (project: { id: string; title: string }) => void;
  onOpenTaskById?: (taskId: string) => void;
  sprints?: any[];
  members?: any[];
  projectId: string;
  projectSlug?: string;
  currentUserId?: string;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  initialTab?: TaskPanelTab | null;
  initialCommentId?: string | null;
  initialFileId?: string | null;
  workflowColumns?: { id: string; name: string }[];
}

export default function TaskDetailPanel({
  task,
  onClose,
  onTaskUpdated,
  canEdit,
  isMember = true,
  reviewsGroupWork = false,
  canManageFiles = false,
  isOwner = false,
  canPlanSprints = isOwner,
  projectCandidates = [],
  onNewInProject,
  onOpenTaskById,
  sprints = [],
  members = [],
  projectId,
  projectSlug,
  currentUserId,
  currentUserName = null,
  currentUserAvatarUrl = null,
  initialTab = "details",
  initialCommentId = null,
  initialFileId = null,
  workflowColumns = [],
}: TaskDetailPanelProps) {
  const queryClient = useQueryClient();
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
  }, []);
  // Review UX 1.1: an admin opens a main assignment on its Assignment tab, the class in full.
  const showAssignmentTab = canEdit && isAssignmentMaster(task);
  const startTab = (tab: TaskPanelTab | null | undefined): TaskPanelTab => (!tab || tab === "details") && showAssignmentTab ? "assignment" : tab ?? "details";
  const [activeTab, setActiveTab] = useState<TaskPanelTab>(startTab(initialTab));
  const [showRealtimeIssue, setShowRealtimeIssue] = useState(false);
  const [conversation, setConversation] = useState<"private" | "class">("private");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState(false);
  const [ideSheetOpen, setIdeSheetOpen] = useState(false);

  const normalizedTask = useMemo(
    () => normalizeTaskSurfaceRecord(task),
    [task],
  );

  const readReceiptTaskIdRef = useRef<string | null>(null);

  const restrictedTab = !isMember && !(reviewsGroupWork && normalizedTask.assignmentId) && (activeTab === "comments" || activeTab === "files");
  const resource = useTaskPanelResource({
    task: normalizedTask,
    projectId,
    // A restricted tab never loads: its read would only come back Forbidden.
    activeTab: restrictedTab ? "details" : activeTab,
    currentUserId,
    canEdit,
    sprints,
    members,
    onTaskUpdated,
  });
  // Report a task from its "⋯" (C15); the server refuses your own task with a plain message.
  const reportTask = useReportDialog({ kind: "task", targetId: resource.task.id, noun: "task" });

  const canEditTask = canEdit && !resource.isDeleted;

  const currentUser = useMemo(() => {
    const found = members.find(
      (m: any) =>
        m?.id === currentUserId ||
        m?.userId === currentUserId ||
        m?.user_id === currentUserId ||
        m?.user?.id === currentUserId,
    );
    const person = found ? normalizeTaskSurfacePerson(found?.user ?? found) : null;
    const fullName =
      person?.fullName ||
      currentUserName ||
      (found as any)?.displayName ||
      (found as any)?.fullName ||
      (found as any)?.name ||
      "You";
    const avatarUrl =
      person?.avatarUrl ||
      currentUserAvatarUrl ||
      (found as any)?.avatarUrl ||
      (found as any)?.profile?.avatarUrl ||
      (found as any)?.user?.avatarUrl ||
      null;
    const username =
      (found as any)?.username ||
      (found as any)?.user?.username ||
      null;

    return {
      id: currentUserId || person?.id,
      fullName,
      username,
      avatarUrl,
    };
  }, [members, currentUserId, currentUserName, currentUserAvatarUrl]);

  useEffect(() => {
    setActiveTab(startTab(initialTab));
  }, [initialTab, normalizedTask.id]);

  useEffect(() => {
    void resource.ensureTabLoaded(activeTab);
  }, [activeTab, resource.ensureTabLoaded]);

  useEffect(() => {
    if (resource.isRealtimeConnected) {
      setShowRealtimeIssue(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRealtimeIssue(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [resource.isRealtimeConnected]);

  // Ponytail Optimistic Read Receipts
  useEffect(() => {
    if (
      normalizedTask.id &&
      readReceiptTaskIdRef.current !== normalizedTask.id &&
      ((normalizedTask.newSubtaskCount && normalizedTask.newSubtaskCount > 0) ||
        (normalizedTask.newCommentCount &&
          normalizedTask.newCommentCount > 0) ||
        (normalizedTask.newFileCount && normalizedTask.newFileCount > 0))
    ) {
      readReceiptTaskIdRef.current = normalizedTask.id;
      onTaskUpdated?.({
        ...normalizedTask,
        newSubtaskCount: 0,
        newCommentCount: 0,
        newFileCount: 0,
      });
      markTaskAsReadAction(normalizedTask.id).catch((error) => {
        logger.error("Failed to mark task as read in background", { error });
      });
    }
  }, [
    normalizedTask.id,
    normalizedTask.newSubtaskCount,
    normalizedTask.newCommentCount,
    normalizedTask.newFileCount,
    onTaskUpdated,
    normalizedTask,
  ]);

  const progress = isAssignmentMaster(resource.task) ? resource.task.assignmentProgress : null;
  const masterState = progress ? masterChip({ publishedAt: progress.draft ? null : "published", closedAt: progress.closed ? "closed" : null }) : null;
  // Review UX 1.9–1.11: on a main assignment, each tab says what it holds.
  const MASTER_TAB_NOTE = (tab: keyof typeof MASTER_TAB_NOTES) => isAssignmentMaster(resource.task)
    ? <p className="border-b border-border bg-muted/30 px-6 py-2 text-[12px] text-muted-foreground max-md:px-4">{MASTER_TAB_NOTES[tab]}</p> : null;
  const tabs = useMemo(
    () => [
      ...(showAssignmentTab ? [{ id: "assignment" as const, label: "Assignment", icon: Users }] : []),
      { id: "details" as const, label: "Details", icon: CheckSquare },
      // Report 38.5 S5: a project's work replaces its subtasks.
      resource.task.itemType === "project"
        ? { id: "subtasks" as const, label: "Work", icon: CheckCircle2, count: undefined }
        : {
        id: "subtasks" as const,
        label: "Subtasks",
        icon: CheckCircle2,
        count: resource.counts.subtasks,
      },
      {
        id: "comments" as const,
        label: "Comments",
        icon: MessageCircle,
        count: resource.counts.comments,
      },
      {
        id: "files" as const,
        label: "Files",
        icon: Paperclip,
        count: resource.counts.files,
      },
    ],
    [resource.counts.comments, resource.counts.files, resource.counts.subtasks, showAssignmentTab, resource.task.itemType],
  );
  const completedSubtaskCount = resource.counts.completedSubtasks;

  // Report 38.6 rollout 3 (A2.3): a plain task becomes a bug at a stage that keeps its status.
  const bugsAdded = useAddedWorkflows().includes("bugs");
  const changeToBug = async (stage: string) => {
    const result = await changeTaskTypeAction({ projectId, taskIds: [resource.task.id], toType: "bug", stage });
    if (!result.success) return void toast.error(result.error);
    const onBoard = WORKFLOW_TYPES.bug!.stages.find((s) => s.key === stage)?.onBoard ?? true;
    onTaskUpdated?.({ ...resource.task, itemType: "bug", stage, onBoard, ...(!onBoard && { sprintId: null }) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) });
    toast.success(`Now a bug · ${WORKFLOW_TYPES.bug!.stages.find((s) => s.key === stage)?.label ?? stage}`);
  };

  const confirmDeleteTask = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const result = await deleteTaskAction(resource.task.id, projectId);
      if (!result.success) {
        throw new Error(result.error || "Couldn’t delete task");
      }

      removeTaskFromWorkspaceTaskCaches(queryClient, projectId, resource.task.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.project.detail.sprintDetailRoot(projectId),
      });
      onClose();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "An error occurred while deleting the task",
      );
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          presentation="right-drawer"
          data-testid="task-detail-panel"
          showCloseButton={false}
          overlayClassName="z-[200] bg-black/60 backdrop-blur-none"
          onCloseAutoFocus={(event) => {
            if (openerRef.current) {
              event.preventDefault();
              openerRef.current.focus();
            }
          }}
          className="bottom-0 left-auto right-0 top-0 z-[201] flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 border-l border-border bg-card p-0 shadow-2xl sm:w-[580px] sm:max-w-[580px]"
        >
          <DialogTitle className="sr-only">{resource.task.title}</DialogTitle>
          <TaskAgentQuestions taskId={resource.task.id} />
          <div className="flex-shrink-0 border-b border-border">
            {deleteError ? (
              <div className="mx-4 mt-4 rounded-[5px] border border-destructive/20 md:mx-6 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {deleteError}
              </div>
            ) : null}

            <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
              <div className="flex items-center gap-3 min-w-0 max-md:gap-1">
                {/* Phones: Back on the left; Delete moves into ⋯ away from dismiss (spec §09). */}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Back to tasks"
                  className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      const taskIdFormatted =
                        resource.task.taskNumber && resource.task.projectKey
                          ? formatTaskId(
                              resource.task.projectKey,
                              resource.task.taskNumber,
                            )
                          : "Task";
                      copyOrSay(`${window.location.origin}${projectTaskHref(projectSlug || projectId, resource.task.id)}`, () => {
                        setCopiedTaskId(true);
                        setTimeout(() => setCopiedTaskId(false), 2000);
                      });
                    }}
                    title="Click to copy task link"
                    aria-label="Copy task link"
                    className="group inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 font-mono text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground transition hover:bg-muted hover:text-foreground shrink-0"
                  >
                    <span>
                      {resource.task.taskNumber && resource.task.projectKey
                        ? formatTaskId(
                            resource.task.projectKey,
                            resource.task.taskNumber,
                          )
                        : "Task"}
                    </span>
                    {copiedTaskId ? (
                      <Check className="size-3 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
                    ) : (
                      <Copy className="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                  {masterState ? (
                    // Review UX 1.7: a main assignment shows its own life, not a status derived from the copies.
                    <span className="nb-status" data-status={TONE_STATUS[masterState.tone]}>{masterState.label}</span>
                  ) : resource.task.assignmentId ? (
                    // Review UX 5.2: a copy's header chip is the Hand in card's own, for the student and the teacher alike.
                    <HandInChip copyId={resource.task.id} fallback={<TaskStatusBadge status={resource.task.status} reviewStatus={resource.task.reviewStatus} />} />
                  ) : <TaskStatusBadge status={resource.task.status} reviewStatus={resource.task.reviewStatus} />}
                  <TaskPriorityBadge priority={resource.task.priority} />
                  {showRealtimeIssue ? (
                    <span className="rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Live updates reconnecting
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Mockup task 1: a main assignment is managed, not coded; its copies keep the editor. */}
                {isAssignmentMaster(resource.task) ? null : (
                  <StartWorkOnBranch projectId={projectId} task={resource.task} />
                )}
                {isAssignmentMaster(resource.task) ? null : (
                  <span className="hidden md:contents">
                    <OpenInIdeButton
                      projectId={projectId}
                      projectSlug={projectSlug}
                      taskId={resource.task.id}
                      taskNumber={resource.task.taskNumber ?? null}
                    />
                  </span>
                )}
                {isOwner ? (
                  <button
                    onClick={() => {
                      setDeleteError(null);
                      setShowDeleteConfirm(true);
                    }}
                    disabled={isDeleting}
                    aria-label="Delete task"
                    className="nb-touch-target size-8 flex items-center justify-center rounded-[5px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50 max-md:hidden"
                    title="Delete task"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
                <button
                  onClick={onClose}
                  aria-label="Close task details"
                  className="nb-touch-target size-8 flex items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-md:hidden"
                >
                  <X className="size-4" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="Task actions" className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted">
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[210] w-52">
                    <DropdownMenuItem
                      onSelect={() => {
                        copyOrSay(`${window.location.origin}${projectTaskHref(projectSlug || projectId, resource.task.id)}`, () => toast.success("Task link copied"));
                      }}
                    >
                      <Copy className="size-4" />
                      Copy task link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIdeSheetOpen(true)}>
                      <Laptop className="size-4" />
                      Connect your code editor
                    </DropdownMenuItem>
                    {workflowColumns && workflowColumns.length > 1 && canEditTask ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FolderPlus className="size-4 mr-2" />
                          Move to column
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent className="w-48 z-[220]">
                            {workflowColumns.map((col) => (
                              <DropdownMenuItem
                                key={col.id}
                                disabled={resource.task.workflowColumnId === col.id}
                                onSelect={() => void resource.taskMutations.moveToColumn(col.id)}
                              >
                                {col.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                    ) : null}
                    {bugsAdded && canEditTask && !resource.task.itemType && resource.task.kind !== "assignment" ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Bug className="size-4 mr-2" />
                          Change to a bug
                        </DropdownMenuSubTrigger>
                        <DropdownMenuPortal>
                          <DropdownMenuSubContent className="w-48 z-[220]">
                            {changeTypeOptions(resource.task.status).map((stage) => (
                              <DropdownMenuItem key={stage} onSelect={() => void changeToBug(stage)}>
                                {WORKFLOW_TYPES.bug!.stages.find((s) => s.key === stage)?.label ?? stage}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuPortal>
                      </DropdownMenuSub>
                    ) : null}
                    {isOwner ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={isDeleting}
                          onSelect={() => {
                            setDeleteError(null);
                            setShowDeleteConfirm(true);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Delete task
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    <ReportMenuItem noun="task" target={reportTask.target} onReport={reportTask.open} />
                  </DropdownMenuContent>
                </DropdownMenu>
                {reportTask.dialog}
              </div>
            </div>
            {/* Report 38.2 S7: a typed item says where it shows and moves between stages; a plain task shows nothing. */}
            {resource.task.itemType ? (
              <div className="px-4 pb-2 sm:px-5">
                <TaskStageControl projectId={projectId} task={resource.task} canEdit={canEditTask} canPlanSprints={canPlanSprints} sprints={sprints}
                  onMoved={(moved) => onTaskUpdated?.({ ...resource.task, stage: moved.stage, status: moved.status as typeof resource.task.status, onBoard: moved.onBoard, sprintId: moved.sprintId })} />
              </div>
            ) : null}

            <div
              role="tablist"
              aria-label="Task details"
              className="grid w-full grid-flow-col auto-cols-fr items-center gap-1 overflow-visible px-3 pb-0 sm:px-4 max-md:flex max-md:overflow-x-auto"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  id={`task-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`task-panel-${tab.id}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Home") {
                      event.preventDefault();
                      const first = tabs[0];
                      if (first) {
                        setActiveTab(first.id);
                        requestAnimationFrame(() =>
                          document.getElementById(`task-tab-${first.id}`)?.focus(),
                        );
                      }
                      return;
                    }
                    if (event.key === "End") {
                      event.preventDefault();
                      const last = tabs[tabs.length - 1];
                      if (last) {
                        setActiveTab(last.id);
                        requestAnimationFrame(() =>
                          document.getElementById(`task-tab-${last.id}`)?.focus(),
                        );
                      }
                      return;
                    }
                    const currentIndex = tabs.findIndex(
                      (candidate) => candidate.id === tab.id,
                    );
                    const direction =
                      event.key === "ArrowRight"
                        ? 1
                        : event.key === "ArrowLeft"
                          ? -1
                          : 0;
                    if (!direction) return;
                    event.preventDefault();
                    const next =
                      tabs[(currentIndex + direction + tabs.length) % tabs.length];
                    if (!next) return;
                    setActiveTab(next.id);
                    requestAnimationFrame(() =>
                      document.getElementById(`task-tab-${next.id}`)?.focus(),
                    );
                  }}
                  className={cn(
                    "flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-2.5 text-xs font-medium transition-colors max-md:min-h-11 max-md:shrink-0 max-md:px-3 max-md:pb-0",
                    activeTab === tab.id
                      ? "border-primary text-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <tab.icon aria-hidden="true" className="size-3.5" />
                  <span className="min-w-0 truncate">{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 ? (
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border px-1 font-mono text-[10px] font-semibold max-md:text-[11px]",
                        activeTab === tab.id
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : "border-border bg-muted/60 text-muted-foreground",
                      )}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex-1 overflow-y-auto bg-card">
            {resource.isDeleted ? (
              <p role="status" className="border-b border-border bg-muted/50 px-6 py-2 text-xs text-muted-foreground">
                This task was deleted. It is shown read-only.
              </p>
            ) : null}
            {showAssignmentTab && resource.task.projectId ? (
              <div
                id="task-panel-assignment"
                role="tabpanel"
                aria-labelledby="task-tab-assignment"
                hidden={activeTab !== "assignment"}
                className="p-6 max-md:p-4"
              >
                <AssignmentManageSection orgId={resource.task.projectId} masterId={resource.task.id} />
              </div>
            ) : null}

            {resource.loadedTabs.details ? (
              <div
                id="task-panel-details"
                role="tabpanel"
                aria-labelledby="task-tab-details"
                hidden={activeTab !== "details"}
              >
                <DetailsTab
                  task={resource.task}
                  projectSlug={projectSlug ?? null}
                  onUploadFiles={(files) => resource.fileMutations.uploadFiles(files)}
                  onRemoveFile={resource.fileMutations.unlinkAttachment}
                  canEdit={canEditTask}
                  canReadSourceMessages={isMember}
                  canManageSprint={isOwner}
                  isMutating={resource.taskMutations.isMutating}
                  mutationError={resource.taskMutations.mutationError}
                  members={members}
                  sprints={sprints}
                  subtaskCount={resource.counts.subtasks}
                  completedSubtaskCount={completedSubtaskCount}
                  attachmentCount={resource.counts.files}
                  fileWarnings={resource.fileWarnings}
                  fileWarningSummary={resource.fileWarningSummary}
                  onUpdateField={resource.taskMutations.updateField}
                  onUpdateStatus={resource.taskMutations.updateStatus}
                  onUpdateAssignee={resource.taskMutations.updateAssignee}
                  onReviewApproved={(updatedAt, status = "done", reviewStatus = "none") =>
                    onTaskUpdated?.({
                      ...resource.task,
                      status,
                      reviewStatus,
                      completedAt: status === "done" && reviewStatus === "none" ? updatedAt : null,
                      ...(reviewStatus === "pending" ? { reviewSubmittedAt: updatedAt } : {}),
                      updatedAt,
                    })
                  }
                  onOpenTab={setActiveTab}
                  onOpenConversation={(kind) => { setConversation(kind); setActiveTab("comments"); }}
                  workflowColumns={workflowColumns}
                  onMoveToColumn={resource.taskMutations.moveToColumn}
                />
              </div>
            ) : null}

            {resource.loadedTabs.subtasks ? (
              <div
                id="task-panel-subtasks"
                role="tabpanel"
                aria-labelledby="task-tab-subtasks"
                hidden={activeTab !== "subtasks"}
              >
                {MASTER_TAB_NOTE("subtasks")}
                {resource.task.itemType === "project" ? (
                  <ProjectWork projectId={projectId} project={{ id: resource.task.id, title: resource.task.title }} canEdit={canEditTask} candidates={projectCandidates}
                    onNewTask={() => onNewInProject?.({ id: resource.task.id, title: resource.task.title })} onOpenTask={(id) => onOpenTaskById?.(id)} />
                ) : (
                <SubtasksTab
                  subtasks={resource.subtasks}
                  totalCount={resource.counts.subtasks}
                  completedTotal={resource.counts.completedSubtasks}
                  hasMore={resource.subtasksHasMore}
                  onLoadMore={resource.loadMoreSubtasks}
                  isLoading={resource.loading.subtasks}
                  error={resource.errors.subtasks}
                  canEdit={canEditTask}
                  onAddSubtask={resource.addSubtask}
                  onToggleSubtask={resource.toggleSubtask}
                  onDeleteSubtask={resource.removeSubtask}
                  onUpdateSubtask={resource.updateSubtask}
                  onRetry={resource.loadSubtasks}
                  nameOf={(userId) => {
                    const m = members.find((member: any) => member?.id === userId);
                    return m ? m.fullName || m.username || null : null;
                  }}
                />
                )}
              </div>
            ) : null}

            {restrictedTab ? (
              <div
                id={`task-panel-${activeTab}`}
                role="tabpanel"
                aria-labelledby={`task-tab-${activeTab}`}
                className="p-6 text-sm text-muted-foreground"
              >
                {activeTab === "comments" ? "Comments" : "Files"} on tasks are visible to workspace members.
              </div>
            ) : null}

            {resource.loadedTabs.comments && !restrictedTab ? (
              <div
                id="task-panel-comments"
                role="tabpanel"
                aria-labelledby="task-tab-comments"
                hidden={activeTab !== "comments"}
              >
                {MASTER_TAB_NOTE("comments")}
                {/* Decision 16: a copy has two conversations; private is the default, the worse mistake being the other. */}
                {normalizedTask.assignmentId ? (
                  <div className="flex flex-wrap items-center gap-2 px-6 pt-4 text-sm max-md:px-4" role="group" aria-label="Conversation">
                    <Button type="button" size="sm" variant={conversation === "private" ? "default" : "outline"} aria-pressed={conversation === "private"} onClick={() => setConversation("private")}>Private with admins</Button>
                    <Button type="button" size="sm" variant={conversation === "class" ? "default" : "outline"} aria-pressed={conversation === "class"} onClick={() => setConversation("class")}>Class questions</Button>
                    <span className="basis-full text-[12px] text-muted-foreground">{conversation === "private" ? "Only you, your group and the organization’s admins see this." : "Everyone with this assignment sees this."}</span>
                  </div>
                ) : null}
                {normalizedTask.assignmentId && conversation === "class" ? <ClassQuestions copyId={normalizedTask.id} /> : null}
                <div hidden={Boolean(normalizedTask.assignmentId) && conversation === "class"}>
                <CommentsTab
                  projectId={projectId}
                  taskId={resource.task?.id}
                  comments={resource.comments}
                  totalCount={resource.counts.comments}
                  hasMore={Boolean(resource.commentNextCursor)}
                  isLoading={resource.loading.comments}
                  isLoadingMore={resource.commentLoadingMore}
                  error={resource.errors.comments}
                  canEdit={canEditTask}
                  currentUserId={currentUserId}
                  currentUser={currentUser}
                  members={members}
                  presenceStatus={resource.discussionPresenceStatus}
                  topLevelTypingUsers={resource.commentTyping.topLevel}
                  replyTypingUsersByParentId={
                    resource.commentTyping.repliesByParentId
                  }
                  onAddComment={resource.addComment}
                  onToggleLike={resource.toggleCommentLike}
                  onDeleteComment={resource.deleteComment}
                  onLoadOlderComments={resource.loadOlderComments}
                  onSendTyping={resource.sendCommentTyping}
                  initialCommentId={initialCommentId}
                />
                </div>
              </div>
            ) : null}

            {resource.loadedTabs.files && !restrictedTab ? (
              <div
                id="task-panel-files"
                role="tabpanel"
                aria-labelledby="task-tab-files"
                hidden={activeTab !== "files"}
              >
                {MASTER_TAB_NOTE("files")}
                <FilesTab
                  projectId={projectId}
                  projectSlug={projectSlug}
                  taskId={resource.task.id}
                  canEdit={canEditTask}
                  canManageFiles={canManageFiles}
                  attachments={resource.attachments}
                  isLoading={resource.loading.attachments}
                  error={resource.errors.attachments}
                  isUploading={resource.fileMutations.isUploading}
                  onUploadFiles={resource.fileMutations.uploadFiles}
                  onUploadFolders={async (folders, options) => {
                    const result =
                      await resource.fileMutations.uploadFolders(folders, options);
                    return result.success
                      ? { success: true }
                      : { success: false, error: result.error };
                  }}
                  onUnlink={resource.fileMutations.unlinkAttachment}
                  onFilesChanged={resource.loadAttachments}
                  onSaveAsNewVersion={async (nodeId, file, options) => {
                    const result =
                      await resource.fileMutations.saveAsNewVersion(
                        nodeId,
                        file,
                        options,
                      );
                    if (result.success) {
                      // Emit telemetry (Req 16.3) — version replaced from task panel
                      logger.metric("files_tab.version_replaced", {
                        module: "files-tab",
                        source: "task_panel",
                        projectId,
                        nodeId,
                        newVersion: result.version?.version,
                      });
                      return { success: true };
                    }
                    return { success: false, error: result.error };
                  }}
                  initialFileId={initialFileId}
                />
              </div>
            ) : null}

          </div>
        </DialogContent>
      </Dialog>

      <OpenInIdeSheet layered open={ideSheetOpen} onOpenChange={setIdeSheetOpen} projectId={projectId} projectSlug={projectSlug} taskId={resource.task.id} />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete task"
        description="The task is removed from the board. Its draft files move to a “Recovered task files” folder in Workspace Files."
        confirmLabel="Delete"
        variant="destructive"
        overlayClassName="z-[300] bg-black/60"
        contentClassName="z-[301]"
        onConfirm={confirmDeleteTask}
      />
    </>
  );
}
