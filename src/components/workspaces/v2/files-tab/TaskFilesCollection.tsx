"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderOpen, Filter, MoreHorizontal, Link2, Upload, Search } from "lucide-react";
import { unlinkNodeFromTask, linkNodeToTask, updateTaskNodeLink } from "@/app/actions/files/links";
import { extractLabel, composeAnnotation } from "@/lib/workspaces/task-file-label";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { FolderListRowNode } from "./folder/FolderListRow";
import { toast, feedbackError } from "@/lib/feedback";
import {
  getTaskFileGroups,
  type TaskCollectionEntry,
  type TaskFileGroup,
} from "@/app/actions/files/collections";
import dynamic from "next/dynamic";
import { FolderListView } from "./folder/FolderListView";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type { FilesTabUploadConfirmResult } from "./upload/FilesTabUploadModal";

const FilesTabUploadModal = dynamic(
  () => import("./upload/FilesTabUploadModal").then((mod) => mod.FilesTabUploadModal),
  { ssr: false }
);
import { FilesViewsMenu, FilesHeaderSlot } from "./FilesHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { taskFilesHref } from "@/lib/files/task-navigation";
import { useFilesViews } from "./FilesViews";
import { formatRelativeTime } from "./folder/format";
import type { ProjectNode } from "@/lib/db/schema";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { FolderListHeader } from "./folder/FolderListHeader";
import {
  FolderListLoading,
  FolderListEmpty,
  FolderListError,
} from "./folder/FolderListStates";
import {
  FOLDER_LIST_GRID_TEMPLATE,
  FOLDER_LIST_ROW_HEIGHT_PX,
} from "./folder/layout";
import { FileTypeChip } from "./FileTypeChip";
import styles from "./folder/FolderList.module.css";
import { cn } from "@/lib/utils";

function deliverableReviewLabel(
  entry: TaskCollectionEntry,
  reviewStatus: TaskFileGroup["reviewStatus"],
) {
  const currentVersion = entry.node.currentVersion;
  const taskReview = reviewStatus === "pending" ? " · Task review pending" : reviewStatus === "rejected" ? " · Task changes requested" : "";
  if (entry.isCurrentRevisionApproved)
    return `Approved · version ${currentVersion}${taskReview}`;
  if (entry.approvedVersion)
    return `Current content awaiting review · previously approved version ${entry.approvedVersion}${taskReview}`;
  return `Review not recorded${taskReview}`;
}

function getTaskStatusBadgeClass(status: string) {
  const norm = status.toLowerCase().replace(/-/g, "_");
  if (norm === "done" || norm === "completed") {
    return "bg-[#EDF5F0] text-[#245A41] dark:bg-[#245A41]/20 dark:text-[#EDF5F0]";
  }
  if (norm === "in_progress") {
    return "bg-[#EEF4FD] text-[#2563C9] dark:bg-[#2563C9]/20 dark:text-[#EEF4FD]";
  }
  if (norm === "review" || norm === "in_review") {
    return "bg-[#FCF0EA] text-[#B23F1C] dark:bg-[#B23F1C]/20 dark:text-[#FCF0EA]";
  }
  return "bg-[#F3F0EA] text-[#6B7880] dark:bg-white/10 dark:text-muted-foreground";
}

type TaskStatusFilter = "all" | "todo" | "in_progress" | "done" | "review";

export function TaskFilesCollection({ projectId }: { projectId: string }) {
  const workspace = useFilesViews()!;
  const { taskId, query, view, selectTask } = workspace;
  const search = query;
  const role = workspace.fileRole;
  const setRole = workspace.setFileRole;
  const { canEdit, canManageFiles } = useFilesTabRole();

  // Sorting & Filtering state
  const [sortColumn, setSortColumn] = useState<"name" | "updated" | "size">("updated");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [inlineQuery, setInlineQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  // Direct upload to task state
  const [targetUploadTask, setTargetUploadTask] = useState<{ id: string; title: string } | null>(null);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[] | null>(null);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const directUploadInputRef = useRef<HTMLInputElement>(null);

  const [unlinkTarget, setUnlinkTarget] = useState<FolderListRowNode | null>(
    null,
  );
  const [unlinking, setUnlinking] = useState(false);
  const queryClient = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: ["files-task-collections", projectId, view, taskId, search, role],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getTaskFileGroups(projectId, {
        deliverables: view === "deliverables",
        cursor: taskId ? undefined : pageParam,
        fileCursor: taskId ? pageParam : undefined,
        taskId: taskId ?? undefined,
        query: search,
        role: role === "all" ? undefined : role,
      }),
    initialData: () => {
      if (!taskId || search || role !== "all") return undefined;
      const cached = queryClient.getQueriesData<{
        pages: Array<{ groups: TaskFileGroup[] }>;
      }>({ queryKey: ["files-task-collections", projectId, view] });
      const group = cached
        // A group found through task/filename search already contains its
        // first file page. Reuse it while the direct task query revalidates.
        .filter(([key]) => !key[3] && key[5] === "all")
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.groups) ?? [])
        .find((group) => group.id === taskId);
      return group
        ? {
            pages: [{ groups: [group], nextCursor: null }],
            pageParams: [undefined],
          }
        : undefined;
    },
    initialDataUpdatedAt: 0,
    getNextPageParam: (page) => (taskId ? page.groups[0]?.nextFileCursor : page.nextCursor) ?? undefined,
    staleTime: 60_000,
    // ponytail: back off idle polling to 5m to eliminate client-side egress churn. ceiling: 5m polling interval. upgrade: WebSocket Realtime push invalidation for remote lists.
  });

  const groups = useMemo(
    () => Array.from(new Map(result.data?.pages.flatMap(page => page.groups).map(group => [group.id, group]) ?? []).values()),
    [result.data?.pages],
  );

  // Live status counts computed synchronously over groups (0 network latency)
  const statusCounts = useMemo(() => {
    let todo = 0;
    let in_progress = 0;
    let done = 0;
    let review = 0;
    for (const g of groups) {
      const norm = g.status.toLowerCase().replace(/-/g, "_");
      if (norm === "todo" || norm === "backlog") todo++;
      else if (norm === "in_progress") in_progress++;
      else if ((norm === "done" || norm === "completed") && g.reviewStatus !== "pending") done++;
      if (
        norm === "review" ||
        norm === "in_review" ||
        g.reviewStatus === "pending" ||
        g.reviewStatus === "rejected"
      )
        review++;
    }
    return {
      all: groups.length,
      todo,
      in_progress,
      done,
      review,
    };
  }, [groups]);

  // Filtered and sorted task groups
  const filteredGroups = useMemo(() => {
    let list = [...groups];

    if (inlineQuery.trim()) {
      const q = inlineQuery.trim().toLowerCase();
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.entries.some(
            (e) =>
              e.node.name.toLowerCase().includes(q) ||
              (e.annotation && e.annotation.toLowerCase().includes(q)) ||
              Boolean((e.node as { annotation?: string | null }).annotation?.toLowerCase().includes(q)),
          ),
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((g) => {
        const norm = g.status.toLowerCase().replace(/-/g, "_");
        if (statusFilter === "todo") return norm === "todo" || norm === "backlog";
        if (statusFilter === "in_progress") return norm === "in_progress";
        if (statusFilter === "done") return (norm === "done" || norm === "completed") && g.reviewStatus !== "pending";
        if (statusFilter === "review")
          return norm === "review" || norm === "in_review" || g.reviewStatus === "pending" || g.reviewStatus === "rejected";
        return true;
      });
    }

    list.sort((a, b) => {
      let diff = 0;
      if (sortColumn === "name") {
        diff = a.title.localeCompare(b.title);
      } else if (sortColumn === "updated") {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        diff = timeA - timeB;
      } else if (sortColumn === "size") {
        const countA = a.deliverables + a.references + a.working;
        const countB = b.deliverables + b.references + b.working;
        diff = countA - countB;
      }
      return sortDirection === "asc" ? diff : -diff;
    });

    return list;
  }, [groups, inlineQuery, statusFilter, sortColumn, sortDirection, view]);

  const handleSort = useCallback((column: "name" | "updated" | "size") => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection(column === "name" ? "asc" : "desc");
    }
  }, [sortColumn]);

  const selected = groups.find((group) => group.id === taskId);
  const setTaskTitle = workspace.setTaskTitle;
  useEffect(() => { if (selected?.title) setTaskTitle(selected.title); }, [selected?.title, setTaskTitle]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if (
        (event as CustomEvent<{ projectId?: string }>).detail?.projectId !==
        projectId
      )
        return;
      void queryClient.invalidateQueries({
        queryKey: ["files-task-collections", projectId],
      });
    };
    window.addEventListener("project:task-files-changed", refresh);
    return () =>
      window.removeEventListener("project:task-files-changed", refresh);
  }, [projectId, queryClient]);

  // Keyboard navigation across tasks
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        target?.closest('[role="dialog"]')
      ) {
        return;
      }
      if (!taskId) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev === null ? 0 : Math.min(filteredGroups.length - 1, prev + 1),
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev === null ? filteredGroups.length - 1 : Math.max(0, prev - 1),
          );
        } else if (e.key === "Enter" && focusedIndex !== null && filteredGroups[focusedIndex]) {
          e.preventDefault();
          selectTask(filteredGroups[focusedIndex].id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        selectTask(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [taskId, focusedIndex, filteredGroups, selectTask]);

  // Direct upload picker triggers
  const handleDirectFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setPendingUploadFiles(files);
    }
    e.target.value = "";
  };

  const handleConfirmUpload = async (confirmResult: FilesTabUploadConfirmResult) => {
    const filesToUpload = confirmResult.files ?? pendingUploadFiles;
    if (!filesToUpload || filesToUpload.length === 0) return;

    setIsProcessingUpload(true);
    try {
      const { buildProjectFileKey } = await import("@/lib/storage/workspace-file-key");
      const { getBatchUploadUrls } = await import("@/app/actions/upload");
      const { finalizeBatchUpload } = await import("@/app/actions/files/mutations");

      const plans = filesToUpload.map((file) => ({
        file,
        key: buildProjectFileKey(projectId, crypto.randomUUID()),
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }));

      const batchNodes: ProjectNode[] = [];
      for (let offset = 0; offset < plans.length; offset += 16) {
        const chunk = plans.slice(offset, offset + 16);
        const batch = await getBatchUploadUrls(
          chunk.map(({ key, contentType, sizeBytes }) => ({ key, contentType, sizeBytes })),
        );
        if ("error" in batch) {
          throw new Error(batch.error || "Couldn’t generate upload URLs");
        }

        await Promise.all(
          chunk.map(async ({ file, key, contentType }) => {
            const url = batch.urls?.[key];
            const uploadToken = batch.uploadTokens?.[key];
            const storageKey = batch.storageKeys?.[key];
            const operationId = batch.uploadIntentIds?.[key];
            if (!url || !uploadToken || !storageKey || !operationId) throw new Error("Upload allocation unavailable");
            await uploadToSupabaseSignedUrl({
              bucket: "project-files",
              storagePath: storageKey,
              uploadToken,
              uploadUrl: url,
              contentType,
              operationId,
            }, file, { cacheProfile: "immutable" });
          }),
        );

        batchNodes.push(...await finalizeBatchUpload(
          projectId,
          confirmResult.targetFolderId ?? null,
          chunk.map(({ file, key, contentType }) => ({
            name: file.name,
            s3Key: batch.storageKeys[key]!,
            size: file.size,
            mimeType: contentType,
            uploadIntentId: batch.uploadIntentIds?.[key] ?? undefined,
          })),
        ));
      }

      const targetTaskId = confirmResult.taskId ?? targetUploadTask?.id;
      if (targetTaskId && batchNodes.length > 0) {
        for (const node of batchNodes) {
          await linkNodeToTask(targetTaskId, node.id, {
            role: confirmResult.role,
            annotation: confirmResult.label,
          });
        }
      }

      toast.success(
        filesToUpload.length === 1
          ? `Uploaded ${filesToUpload[0]?.name ?? "file"} to task`
          : `Uploaded ${filesToUpload.length} files to task`,
      );

      void queryClient.invalidateQueries({
        queryKey: ["files-task-collections", projectId],
      });
      window.dispatchEvent(
        new CustomEvent("project:task-files-changed", {
          detail: { projectId, taskId: targetTaskId },
        }),
      );
    } catch (err) {
      toast.error(feedbackError(err instanceof Error ? err.message : "Couldn’t upload file to task", "Couldn’t upload file to task"));
    } finally {
      setIsProcessingUpload(false);
      setPendingUploadFiles(null);
      setTargetUploadTask(null);
    }
  };
  // ponytail: deduplicate task entries across paginated cache layers. ceiling: React Query page cache. upgrade: normalized entity store if task file counts exceed 5,000.
  const visibleEntries = React.useMemo(() => {
    const map = new Map<string, TaskCollectionEntry>();
    for (const page of result.data?.pages ?? []) {
      for (const group of page.groups) {
        if (group.id === taskId) {
          for (const entry of group.entries) {
            map.set(entry.node.id, entry);
          }
        }
      }
    }
    const list = Array.from(map.values());
    const order: Record<string, number> = { deliverable: 0, working: 1, reference: 2 };
    return list.sort((a, b) => (order[a.role] ?? 1) - (order[b.role] ?? 1));
  }, [result.data?.pages, taskId]);

  const taskLabels = React.useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const entry of visibleEntries) {
      map[entry.node.id] = extractLabel(entry.annotation || (entry.node as { annotation?: string | null }).annotation);
    }
    return map;
  }, [visibleEntries]);

  const handleTaskLabelChange = useCallback(
    async (node: FolderListRowNode, newLabel: string | null) => {
      if (!taskId) return;
      const currentEntry = visibleEntries.find((e) => e.node.id === node.id);
      const existingAnnotation = currentEntry?.annotation ?? (node as { annotation?: string | null }).annotation ?? null;
      const nextAnnotation = composeAnnotation(newLabel, existingAnnotation);

      // Optimistic cache update across task collections
      queryClient.setQueriesData<{ pages: Array<{ groups: TaskFileGroup[] }> }>(
        { queryKey: ["files-task-collections", projectId] },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              groups: page.groups.map((group) => {
                if (group.id !== taskId) return group;
                return {
                  ...group,
                  entries: group.entries.map((entry) => {
                    if (entry.node.id !== node.id) return entry;
                    return {
                      ...entry,
                      annotation: nextAnnotation,
                      node: {
                        ...entry.node,
                        annotation: nextAnnotation,
                      },
                    };
                  }),
                };
              }),
            })),
          };
        },
      );

      try {
        await updateTaskNodeLink(taskId, node.id, { annotation: nextAnnotation });
        toast.success(newLabel ? "Label updated" : "Label removed");
        window.dispatchEvent(
          new CustomEvent("project:task-files-changed", {
            detail: { projectId, taskId },
          }),
        );
      } catch (err) {
        toast.error(feedbackError(err instanceof Error ? err.message : "Couldn’t update label", "Couldn’t update label"));
        void queryClient.invalidateQueries({
          queryKey: ["files-task-collections", projectId],
        });
      }
    },
    [taskId, projectId, visibleEntries, queryClient],
  );
  const groupScrollRef = useRef<HTMLDivElement>(null);
  const groupScrollKey = `${view}:groups:${query}`;
  React.useLayoutEffect(() => {
    if (!taskId && groupScrollRef.current)
      groupScrollRef.current.scrollTop =
        workspace.scrollOffsets.current.get(groupScrollKey) ?? 0;
  }, [taskId, groupScrollKey, result.isPending, workspace.scrollOffsets]);
  const initialLoading =
    query !== search ||
    result.isPending ||
    (taskId && !selected && (result.hasNextPage || result.isFetching));
  const taskMenuItems = taskId ? <>
    <DropdownMenuSub><DropdownMenuSubTrigger><Filter className="size-4" />File purpose</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuRadioGroup aria-label="File purpose" value={role} onValueChange={value => setRole(value as "all" | "deliverable" | "reference" | "working")}>
      <DropdownMenuRadioItem value="all">All files</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="deliverable">Final files</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="working">Draft files</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="reference">References</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
    <DropdownMenuItem asChild><a href={`?tab=tasks&drawerType=task&drawerId=${taskId}&panelTab=files`} onClick={event => { event.currentTarget.href = taskFilesHref(window.location.search, taskId!); }}><ArrowRight className="size-4" />Open task files…</a></DropdownMenuItem>
  </> : null;
  return (
    <div
      aria-label={view === "deliverables" ? "Final files" : "Task files"}
      className={cn(
        styles.container,
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background relative",
      )}
    >
      <input
        ref={directUploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleDirectFileSelected}
      />

      {(!selected || initialLoading) && (
        <FilesViewsMenu projectId={projectId}>
          {taskMenuItems}
        </FilesViewsMenu>
      )}
      {result.isError && (
        <div
          role="alert"
          className="m-4 mb-0 rounded-[5px] border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
        >
          {result.error.message}{" "}
          <button onClick={() => void result.refetch()} className="underline font-medium">
            Retry
          </button>
        </div>
      )}
      {taskId ? (
        selected ? (
          <div className="min-h-0 flex-1">
            <FolderListView
              projectId={projectId}
              folderId={null}
              canEdit={canEdit}
              canManageFiles={canManageFiles}
              collection={{
                preserveOrder: true,
                menuItems: taskMenuItems,
                onUnlink: canEdit ? setUnlinkTarget : undefined,
                nodes: visibleEntries.map((entry) => entry.node),
                labels: Object.fromEntries(
                  visibleEntries.map((entry) => [
                    entry.node.id,
                    entry.role === "deliverable" || view === "deliverables"
                      ? `Final file · ${deliverableReviewLabel(entry, selected.reviewStatus)}`
                      : entry.role === "reference"
                        ? "Reference"
                        : "Draft file",
                  ]),
                ),
                taskLabels,
                onTaskLabelChange: canEdit ? handleTaskLabelChange : undefined,
                emptyMessage: "No files match these filters.",
                footer: result.hasNextPage ? (
                  <button
                    type="button"
                    disabled={result.isFetchingNextPage}
                    onClick={() => void result.fetchNextPage()}
                    className="m-3 min-h-9 rounded-[5px] border border-border px-4 text-xs font-medium hover:bg-[#F3F0EA] dark:hover:bg-muted"
                  >
                    {result.isFetchingNextPage ? "Loading…" : "Load more files"}
                  </button>
                ) : undefined,
              }}
            />
          </div>
        ) : initialLoading ? (
          <div
            role="table"
            aria-label="Task files listing"
            className="flex min-h-0 flex-1 flex-col"
          >
            <FolderListHeader />
            <FolderListLoading />
          </div>
        ) : (
          <div
            role="table"
            aria-label="Task files listing"
            className="flex min-h-0 flex-1 flex-col"
          >
            <FolderListHeader />
            <FolderListEmpty
              message={
                search || role !== "all"
                  ? "No files match these filters. Clear the search or choose All files."
                  : "This task has no accessible files in this view. It may have been removed or its file roles changed."
              }
            />
          </div>
        )
      ) : (
        <>
          {!taskId && canEdit && (
            <FilesHeaderSlot slot="actions">
              <div className="flex items-center gap-1.5 mr-1">
                <button
                  type="button"
                  onClick={() => {
                    const first = groups[0];
                    if (first) {
                      setTargetUploadTask({ id: first.id, title: first.title });
                      directUploadInputRef.current?.click();
                    } else {
                      toast.info("Create a task first to attach files to tasks");
                    }
                  }}
                  className="nb-touch-target flex h-8 items-center gap-1.5 rounded-[5px] bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                  aria-label="Upload to task"
                >
                  <Upload className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              </div>
            </FilesHeaderSlot>
          )}

          <div
            role="table"
            aria-label={view === "deliverables" ? "Final files listing" : "Task files listing"}
            className="flex min-h-0 flex-1 flex-col"
          >
            {/* Status Filter Segmented Control Bar with Live Counts & Search */}
            <div
              role="toolbar"
              aria-label="Task status filters"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DBD5C8] bg-[#FAF8F5] px-4 py-1.5 dark:border-border dark:bg-card"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-mono font-medium text-[#6B7880] dark:text-muted-foreground">
                  Status:
                </span>
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "todo", label: "To do" },
                    { id: "in_progress", label: "In progress" },
                    { id: "done", label: "Completed" },
                    { id: "review", label: "In review" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`task-filter-${item.id}`}
                    onClick={() => setStatusFilter(item.id)}
                    className={cn(
                      "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[11px] font-mono transition-colors",
                      statusFilter === item.id
                        ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                        : "border border-[#DBD5C8]/70 bg-white text-[#4C5A61] hover:bg-[#E8E3D9] hover:text-[#141A1E] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-white/10 dark:hover:text-foreground",
                    )}
                  >
                    <span>{item.label}</span>
                    <span
                      className={cn(
                        "text-[10px] max-md:text-[11px] tabular-nums",
                        statusFilter === item.id
                          ? "text-white/80"
                          : "text-[#8E9AA1] dark:text-muted-foreground",
                      )}
                    >
                      {statusCounts[item.id]}
                    </span>
                  </button>
                ))}
              </div>

              {/* Quick inline fuzzy filter for high scale task lists */}
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 size-3 text-[#6B7880] dark:text-muted-foreground" />
                <input
                  type="search"
                  value={inlineQuery}
                  onChange={(e) => setInlineQuery(e.target.value)}
                  placeholder="Filter tasks…"
                  className="h-6 w-36 rounded-[3px] border border-[#DBD5C8] bg-white pl-6 pr-2 text-[11px] font-mono text-[#141A1E] placeholder:text-[#8E9AA1] focus:border-[#D14E24] focus:outline-none dark:border-border dark:bg-card dark:text-foreground sm:w-48"
                />
              </div>
            </div>

            <FolderListHeader
              sort={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
            />
            <div
              ref={groupScrollRef}
              onScroll={(event) => {
                if (!taskId && !result.isPending) {
                  workspace.scrollOffsets.current.set(
                    groupScrollKey,
                    event.currentTarget.scrollTop,
                  );
                }
              }}
              className="flex-1 min-h-0 overflow-y-auto"
            >
              {initialLoading ? (
                <FolderListLoading />
              ) : result.isError && !result.data ? (
                <FolderListError onRetry={() => void result.refetch()} />
              ) : filteredGroups.length === 0 ? (
                <FolderListEmpty
                  message={
                    search || inlineQuery
                      ? "No tasks or filenames match your search."
                      : statusFilter !== "all"
                        ? "No tasks match the selected status filter."
                        : "No files you can open in this view yet. Add or link files from a task’s Files panel."
                  }
                />
              ) : (
                <div role="rowgroup">
                  {filteredGroups.map((group, index) => {
                    const count =
                      view === "deliverables"
                        ? group.deliverables
                        : group.deliverables + group.references + group.working;

                    // Clean role formatting: omit zero roles to avoid clutter
                    const activeRoleTags: Array<{ key: string; label: string; className: string }> = [];
                    if (group.deliverables > 0) {
                      activeRoleTags.push({
                        key: "d",
                        label: `${group.deliverables}d`,
                        className: "font-semibold text-[#B23F1C] dark:text-[#E27D60]",
                      });
                    }
                    if (group.working > 0) {
                      activeRoleTags.push({
                        key: "w",
                        label: `${group.working}w`,
                        className: "text-[#2563C9] dark:text-[#60A5FA]",
                      });
                    }
                    if (group.references > 0) {
                      activeRoleTags.push({
                        key: "r",
                        label: `${group.references}r`,
                        className: "text-[#6B7880] dark:text-muted-foreground",
                      });
                    }

                    const sizeText =
                      view === "deliverables"
                        ? `${group.deliverables} ${group.deliverables === 1 ? "deliverable" : "deliverables"}`
                        : group.deliverables > 0
                          ? `${group.deliverables}d · ${group.working}w · ${group.references}r`
                          : group.working > 0 || group.references > 0
                            ? `${group.working}w · ${group.references}r`
                            : "0 files";
                    const sizeTooltip =
                      view === "deliverables"
                        ? `${group.deliverables} final files`
                        : `${group.deliverables} final files, ${group.working} working, ${group.references} references (${count} total)`;
                  const updatedText = group.updatedAt
                    ? formatRelativeTime(group.updatedAt)
                    : "—";
                  const byLabel =
                    group.entries.find((e) => e.node.updatedByName)?.node
                      .updatedByName ?? "—";
                  const avatarUrl =
                    group.entries.find((e) => e.node.updatedByAvatarUrl)?.node
                      .updatedByAvatarUrl ?? undefined;
                  const isFocused = focusedIndex === index;

                  return (
                    <div
                      key={group.id}
                      role="row"
                      data-testid="files-tab-task-group-row"
                      data-task-id={group.id}
                      style={{
                        gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE,
                        minHeight: FOLDER_LIST_ROW_HEIGHT_PX,
                      }}
                      onClick={() => selectTask(group.id)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectTask(group.id);
                        }
                      }}
                      tabIndex={0}
                      className={cn(
                        "group grid cursor-pointer items-center gap-x-3 border-b border-[#E8E3D9] px-4 text-sm outline-none transition-colors",
                        isFocused
                          ? "bg-[#F3F0EA] dark:bg-white/5 ring-1 ring-inset ring-[#D14E24]/50"
                          : "hover:bg-[#F3F0EA]/70 focus-visible:bg-[#F3F0EA]/70",
                        "dark:border-white/10 dark:hover:bg-white/5 dark:focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D14E24]",
                      )}
                    >
                      <div
                        role="cell"
                        data-column="name"
                        className="flex min-w-0 items-center gap-2.5"
                      >
                        <FileTypeChip
                          name={group.title}
                          isFolder={true}
                          isOpen={false}
                        />
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            data-testid="files-tab-task-group-title"
                            className="truncate font-semibold text-[#141A1E] dark:text-foreground"
                            title={group.title}
                          >
                            {group.title}
                          </span>
                          {group.reviewStatus !== "pending" && <span
                            data-testid="task-group-status-badge"
                            className={cn(
                              "shrink-0 inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-mono font-medium uppercase tracking-wider",
                              getTaskStatusBadgeClass(group.status),
                            )}
                          >
                            {group.status.replaceAll("_", " ")}
                          </span>}
                          {group.reviewStatus === "pending" && (
                            <span
                              data-testid="task-group-review-badge"
                              className="shrink-0 inline-flex items-center gap-1 rounded-[3px] bg-[#FCF0EA] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-mono font-medium text-[#B23F1C] dark:bg-[#B23F1C]/20 dark:text-[#FCF0EA]"
                            >
                              <span className="size-1 rounded-[1px] bg-[#B23F1C]" />
                              Review pending
                            </span>
                          )}
                          {group.reviewStatus === "rejected" && (
                            <span
                              data-testid="task-group-review-badge"
                              className="shrink-0 inline-flex items-center gap-1 rounded-[3px] bg-[#FCF0EA] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-mono font-medium text-[#B23F1C] dark:bg-[#B23F1C]/20 dark:text-[#FCF0EA]"
                            >
                              <span className="size-1 rounded-[1px] bg-[#B23F1C]" />
                              Changes requested
                            </span>
                          )}
                        </div>
                        <span
                          data-file-mobile-meta
                          className="sm:hidden truncate text-xs text-[#6B7880] dark:text-muted-foreground"
                        >
                          {[
                            group.status.replaceAll("_", " "),
                            sizeText,
                            updatedText !== "—" ? updatedText : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>

                      <div
                        role="cell"
                        data-column="updated"
                        className="min-w-0 truncate font-mono text-xs text-[#6B7880] dark:text-muted-foreground"
                        title={group.updatedAt ?? undefined}
                      >
                        {updatedText}
                      </div>

                      <div
                        role="cell"
                        data-column="size"
                        title={sizeTooltip}
                        className="min-w-0 text-right font-mono text-xs tabular-nums text-[#6B7880] dark:text-muted-foreground"
                      >
                        {view === "deliverables" ? (
                          sizeText
                        ) : activeRoleTags.length > 0 ? (
                          <span className="inline-flex items-center justify-end gap-1">
                            {activeRoleTags.map((tag, i) => (
                              <React.Fragment key={tag.key}>
                                {i > 0 && <span className="text-[#8E9AA1] dark:text-muted-foreground">·</span>}
                                <span className={tag.className}>{tag.label}</span>
                              </React.Fragment>
                            ))}
                          </span>
                        ) : (
                          "0 files"
                        )}
                      </div>

                      <div
                        role="cell"
                        data-column="by"
                        className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[#6B7880] dark:text-muted-foreground"
                        title={byLabel}
                      >
                        {byLabel !== "—" && (
                          <UserAvatar
                            identity={{
                              fullName: byLabel,
                              avatarUrl,
                            }}
                            size={18}
                            roundedClassName="rounded-[3px]"
                            fallbackClassName="text-[9px] font-mono bg-[#E8E3D9] text-[#141A1E] dark:bg-white/10 dark:text-foreground"
                          />
                        )}
                        <span className="truncate">{byLabel}</span>
                      </div>

                      <div
                        role="cell"
                        data-column="actions"
                        onClick={(event) => event.stopPropagation()}
                        className="flex justify-end"
                      >
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Actions for ${group.title}`}
                              className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-[#6B7880] hover:text-[#141A1E] hover:bg-[#F3F0EA] focus-visible:ring-2 focus-visible:ring-[#D14E24] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                            >
                              <MoreHorizontal aria-hidden="true" className="size-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => selectTask(group.id)}>
                              <FolderOpen className="mr-2 size-4 text-[#D14E24]" />
                              Open task files
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setTargetUploadTask({ id: group.id, title: group.title });
                                directUploadInputRef.current?.click();
                              }}
                            >
                              <Upload className="mr-2 size-4 text-[#D14E24]" />
                              Upload file to task…
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a
                                href={`?tab=tasks&taskId=${group.id}`}
                                onClick={(event) => {
                                  event.currentTarget.href = taskFilesHref(
                                    window.location.search,
                                    group.id,
                                  );
                                }}
                              >
                                <ArrowRight className="mr-2 size-4 text-muted-foreground" />
                                View in Tasks board
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                const url = new URL(window.location.href);
                                url.searchParams.set("tab", "files");
                                url.searchParams.set("filesView", view);
                                url.searchParams.set("filesTask", group.id);
                                void navigator.clipboard.writeText(url.toString());
                                toast.success("Task link copied");
                              }}
                            >
                              <Link2 className="mr-2 size-4 text-muted-foreground" />
                              Copy link
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {result.hasNextPage && (
              <div className="p-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => void result.fetchNextPage()}
                  disabled={result.isFetchingNextPage}
                  className="min-h-9 rounded-[5px] border border-border px-4 text-xs font-medium hover:bg-[#F3F0EA] dark:hover:bg-muted"
                >
                  {result.isFetchingNextPage ? "Loading…" : "Load more tasks"}
                </button>
              </div>
            )}
          </div>
        </div>
      </>
    )}

      {/* Direct upload modal scoped to target task */}
      {pendingUploadFiles && targetUploadTask && (
        <FilesTabUploadModal
          projectId={projectId}
          isOpen={true}
          files={pendingUploadFiles}
          currentFolderId={null}
          currentFolderName="All files"
          existingFiles={[]}
          activeTaskId={targetUploadTask.id}
          activeTaskTitle={targetUploadTask.title}
          isProcessing={isProcessingUpload}
          onConfirm={handleConfirmUpload}
          onCancel={() => {
            setPendingUploadFiles(null);
            setTargetUploadTask(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!unlinkTarget}
        onOpenChange={(open) => {
          if (!open && !unlinking) setUnlinkTarget(null);
        }}
        title="Remove file from this task?"
        description={`Remove “${unlinkTarget?.name ?? ""}” from this task. The original file and its other task links will remain unchanged.`}
        confirmLabel="Remove from task"
        loading={unlinking}
        autoCloseOnConfirm={false}
        onConfirm={async () => {
          if (!unlinkTarget || !taskId) return;
          setUnlinking(true);
          try {
            await unlinkNodeFromTask(taskId, unlinkTarget.id);
            setUnlinkTarget(null);
            void queryClient.invalidateQueries({
              queryKey: ["files-task-collections", projectId],
            });
            window.dispatchEvent(
              new CustomEvent("project:task-files-changed", {
                detail: { projectId, taskId },
              }),
            );
            toast.success(
              "File removed from this task", { description: "The original file is unchanged." },
            );
          } catch (error) {
            toast.error(
              feedbackError(error instanceof Error
                ? error.message
                : "Couldn’t remove this task link", "Couldn’t remove this task link"),
            );
          } finally {
            setUnlinking(false);
          }
        }}
      />
    </div>
  );
}
