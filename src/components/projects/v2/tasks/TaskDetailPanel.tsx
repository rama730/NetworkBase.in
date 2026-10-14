"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { projectTaskHref } from "@/lib/projects/task-presentation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
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
  X,
} from "lucide-react";

import { deleteTaskAction, markTaskAsReadAction } from "@/app/actions/project";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";
import { removeTaskFromProjectTaskCaches } from "@/lib/projects/task-cache";
import { formatTaskId } from "@/lib/project-key";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  normalizeTaskSurfacePerson,
  normalizeTaskSurfaceRecord,
  type TaskSurfaceRecord,
} from "@/lib/projects/task-presentation";
import {
  useTaskPanelResource,
  type TaskPanelTab,
} from "@/hooks/useTaskPanelResource";

import CommentsTab from "./TaskDetailTabs/CommentsTab";
import DetailsTab from "./TaskDetailTabs/DetailsTab";
import FilesTab from "./TaskDetailTabs/FilesTab";
import SubtasksTab from "./TaskDetailTabs/SubtasksTab";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import TaskStatusBadge from "./badges/TaskStatusBadge";
import { OpenInIdeButton, OpenInIdeSheet } from "@/components/projects/v2/files-tab/OpenInIdeButton";
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

interface TaskDetailPanelProps {
  task: TaskSurfaceRecord | any;
  onClose: () => void;
  onTaskUpdated?: (task: TaskSurfaceRecord) => void;
  canEdit: boolean;
  /** Visitors read details and subtasks; comments, files and source links are for members. */
  isMember?: boolean;
  canManageFiles?: boolean;
  isOwner?: boolean;
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
  canManageFiles = false,
  isOwner = false,
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
  const [activeTab, setActiveTab] = useState<TaskPanelTab>(
    initialTab ?? "details",
  );
  const [showRealtimeIssue, setShowRealtimeIssue] = useState(false);
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

  const restrictedTab = !isMember && (activeTab === "comments" || activeTab === "files");
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
    setActiveTab(initialTab ?? "details");
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

  const tabs = useMemo(
    () => [
      { id: "details" as const, label: "Details", icon: CheckSquare },
      {
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
    [resource.counts.comments, resource.counts.files, resource.counts.subtasks],
  );
  const completedSubtaskCount = resource.counts.completedSubtasks;

  const confirmDeleteTask = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const result = await deleteTaskAction(resource.task.id, projectId);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete task");
      }

      removeTaskFromProjectTaskCaches(queryClient, projectId, resource.task.id);
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
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        void navigator.clipboard.writeText(
                          `${window.location.origin}${projectTaskHref(projectSlug || projectId, resource.task.id)}`,
                        );
                      }
                      setCopiedTaskId(true);
                      setTimeout(() => setCopiedTaskId(false), 2000);
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
                  <TaskStatusBadge status={resource.task.status} />
                  <TaskPriorityBadge priority={resource.task.priority} />
                  {showRealtimeIssue ? (
                    <span className="rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Live updates reconnecting
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden md:contents">
                  <OpenInIdeButton
                    projectId={projectId}
                    projectSlug={projectSlug}
                    taskId={resource.task.id}
                  />
                </span>
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
                        void navigator.clipboard?.writeText(`${window.location.origin}${projectTaskHref(projectSlug || projectId, resource.task.id)}`);
                      }}
                    >
                      <Copy className="size-4" />
                      Copy task link
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setIdeSheetOpen(true)}>
                      <Laptop className="size-4" />
                      Connect desktop IDE
                    </DropdownMenuItem>
                    {workflowColumns && workflowColumns.length > 1 && canEditTask ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <FolderPlus className="size-4 mr-2" />
                          Move to section
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
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Task details"
              className="grid w-full grid-cols-4 items-center gap-1 overflow-visible px-3 pb-0 sm:px-4 max-md:flex max-md:overflow-x-auto"
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
            {resource.loadedTabs.details ? (
              <div
                id="task-panel-details"
                role="tabpanel"
                aria-labelledby="task-tab-details"
                hidden={activeTab !== "details"}
              >
                <DetailsTab
                  task={resource.task}
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
                  onReviewApproved={(updatedAt) =>
                    onTaskUpdated?.({
                      ...resource.task,
                      reviewStatus: "none",
                      updatedAt,
                    })
                  }
                  onOpenTab={setActiveTab}
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
                />
              </div>
            ) : null}

            {restrictedTab ? (
              <div
                id={`task-panel-${activeTab}`}
                role="tabpanel"
                aria-labelledby={`task-tab-${activeTab}`}
                className="p-6 text-sm text-muted-foreground"
              >
                {activeTab === "comments" ? "Comments" : "Files"} on tasks are visible to project members.
              </div>
            ) : null}

            {resource.loadedTabs.comments && !restrictedTab ? (
              <div
                id="task-panel-comments"
                role="tabpanel"
                aria-labelledby="task-tab-comments"
                hidden={activeTab !== "comments"}
              >
                <CommentsTab
                  projectId={projectId}
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
            ) : null}

            {resource.loadedTabs.files && !restrictedTab ? (
              <div
                id="task-panel-files"
                role="tabpanel"
                aria-labelledby="task-tab-files"
                hidden={activeTab !== "files"}
              >
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
        title="Delete Task"
        description="The task is removed from the board. Its working files move to a “Recovered task files” folder in Project Files."
        confirmLabel="Delete"
        variant="destructive"
        overlayClassName="z-[300] bg-black/60"
        contentClassName="z-[301]"
        onConfirm={confirmDeleteTask}
      />
    </>
  );
}
