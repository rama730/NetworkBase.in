// Task 5.1 — `FolderListView`.
//
// GitHub-style four-column file list that renders the children of the
// current folder (or the project root when `folderId === null`). Owns:
//   * data wiring via `useFolderContents` (Task 2.6),
//   * navigation via `useNavigateTo` (Task 2.3),
//   * mutation plumbing via `useExplorerMutations` + `useExplorerDragDrop`
//     (preserved modules per Q4 / Q5),
//   * the context-menu portal identical to the sidebar (Q5),
//   * dialog host for create / rename / delete / move (canEdit-gated).
//
// Requirements: Req 4.1–4.10, Req 7.1–7.2, Req 8.1–8.3, Req 11.1–11.4,
// Req 12.1–12.6. See design.md § FolderListView.

"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import dynamic from "next/dynamic";
import { extOf } from "@/components/workspaces/v2/utils/fileKind";
import { toast, feedbackError } from "@/lib/feedback";

import * as React from "react";
import {
  FilePlus2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  Lock,
  Star,
  StarOff,
  Trash2,
  Upload,
  X,
  MoreHorizontal, Download, Info, History, ListTodo, ArrowDownWideNarrow, FileUp, Link2, Tag,
} from "@/components/ui/icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspaceNodes } from "@/app/actions/files/nodes";
import { useFilesViews } from "../FilesViews";
import { FolderAccessDialog } from "@/components/organizations/OrgFilesPanel";
import { FilesViewsMenu, FilesHeaderSlot } from "../FilesHeader";
import type { TaskFileRole } from "@/lib/workspaces/task-file-intelligence";
import { isTextLike as isTextFile } from "../../utils/fileKind";
import type { WorkspaceNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import {
  isInternalTaskWorkingFilesNode,
  isWorkspaceSystemRoot,
} from "@/lib/files/task-working-files";
import { useFilesStore } from "@/stores/filesStore";

import { EMPTY_ARRAY, EMPTY_OBJECT } from "../../explorer/explorerTypes";
import { useExplorerDragDrop } from "../../explorer/useExplorerDragDrop";
import { useExplorerMutations } from "../../explorer/useExplorerMutations";
import { useExplorerOperationLog } from "../../explorer/useExplorerOperationLog";

import { useFolderContents, FilesTabBootContext } from "../hooks/useFolderContents";
import { useNavigateTo } from "../hooks/useNavigateTo";
import { FolderListHeader } from "./FolderListHeader";
import {
  FolderListEmpty,
  FolderListError,
  FolderListLoading,
} from "./FolderListStates";
import {
  FolderListRow,
  type FolderListRowNode,
  type GitChangeStatus,
} from "./FolderListRow";
import { sortFolderListNodes } from "./sort";
import styles from "./FolderList.module.css";
import { placeDrop } from "@/lib/files/place-drop";
import { pastedFiles, resolveDropTarget } from "@/lib/files/drop-target";
import { validateUploadSelection } from "@/lib/files/upload-validator";
import { extractFoldersFromDataTransfer } from "@/lib/files/folder-drop";
import { downloadWorkspaceNode } from "../file/downloadWorkspaceNode";
import { downloadFile, workspaceExportUrl } from "@/lib/download";
import { copyText } from "@/lib/clipboard";

const TaskSearchPicker = dynamic(() => import("../picker/TaskSearchPicker").then((mod) => mod.TaskSearchPicker), { ssr: false });
const RevisionControlModal = dynamic(() => import("@/components/ui/RevisionControlModal").then((mod) => mod.RevisionControlModal), { ssr: false });
const ExplorerDialogsHost = dynamic(() => import("../../explorer/ExplorerDialogsHost").then((mod) => mod.ExplorerDialogsHost), { ssr: false });

/**
 * Stable empty reference for the git `changedFiles` slice. The store
 * default is an empty array but we still want a single referentially
 * stable fallback so Zustand selector comparisons (`Object.is`) do not
 * treat missing-project workspaces as changing on every render.
 */
const EMPTY_GIT_CHANGED_FILES: readonly {
  nodeId: string;
  status: GitChangeStatus;
}[] = Object.freeze([]) as readonly {
  nodeId: string;
  status: GitChangeStatus;
}[];

// Zustand selectors must return the same fallback reference until the store
// supplies metadata. An inline object here is a new external-store snapshot
// on every render, which makes React retry forever before the folder loads.
const EMPTY_FOLDER_PAGE = Object.freeze({
  nextCursor: null,
  hasMore: false,
});

function showFilesToast(message: string, type: "success" | "error" | "info" | "warning" = "info") {
  if (type === "success") toast.success(message);
  else if (type === "error") toast.error(feedbackError(message, "Action couldn’t finish"));
  else if (type === "warning") toast.warning(message);
  else toast.info(message);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface FolderListViewProps {
  projectId: string;
  /** `null` means "project root". */
  folderId: string | null;
  canEdit: boolean;
  canManageFiles?: boolean;
  className?: string;
  collection?: {
    menuItems?: React.ReactNode;
    nodes: FolderListRowNode[];
    loading?: boolean;
    footer?: React.ReactNode;
    labels?: Record<string, string>;
    taskLabels?: Record<string, string | null>;
    onTaskLabelChange?: (node: FolderListRowNode, newLabel: string | null) => void;
    preserveOrder?: boolean;
    emptyMessage?: string;
    onUnlink?: (node: FolderListRowNode) => void;
  };
}

interface FolderListRowItemProps {
  projectId: string;
  node: FolderListRowNode;
  canEdit: boolean;
  canMove?: boolean;
  selected?: boolean;
  onSelectionChange?: (nodeId: string, selected: boolean) => void;
  showActions?: boolean;
  subtitle?: string;
  taskLabel?: string | null;
  onTaskLabelChange?: (node: FolderListRowNode, newLabel: string | null) => void;
  isEditingTaskLabel?: boolean;
  onStartEditTaskLabel?: () => void;
  onCancelEditTaskLabel?: () => void;
  isFavorite: boolean;
  gitChange?: GitChangeStatus | null;
  taskLinkCount?: number;
  onNavigate: (nodeId: string) => void;
  onToggleFavorite: (nodeId: string) => void;
  onContextMenu: (node: FolderListRowNode, event: React.MouseEvent) => void;
  onDropOnFolder?: (targetFolderId: string, draggedNodeId: string) => void;
  onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;
  renderMenu: (node: FolderListRowNode) => React.ReactNode;
}

const FolderListRowItem = React.memo(function FolderListRowItem({
  projectId,
  node,
  canEdit,
  canMove,
  selected,
  onSelectionChange,
  showActions,
  subtitle,
  taskLabel,
  onTaskLabelChange,
  isEditingTaskLabel,
  onStartEditTaskLabel,
  onCancelEditTaskLabel,
  isFavorite,
  gitChange,
  taskLinkCount,
  onNavigate,
  onToggleFavorite,
  onContextMenu,
  onDropOnFolder,
  onDesktopFileDrop,
  renderMenu,
}: FolderListRowItemProps) {
  // ponytail: memoize actions per row to prevent breaking React.memo on unchanged rows. ceiling: per-row actions menu. upgrade: virtualized row action menu if table rows exceed 10,000.
  const actions = React.useMemo(
    () => (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${node.name}`}
            className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-[#6B7880] hover:text-[#141A1E] hover:bg-[#F3F0EA] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
          {renderMenu(node)}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [node, renderMenu],
  );

  return (
    <FolderListRow
      projectId={projectId}
      node={node}
      canEdit={canEdit}
      canMove={canMove}
      selected={selected}
      onSelectionChange={onSelectionChange}
      showActions={showActions}
      subtitle={subtitle}
      taskLabel={taskLabel}
      onTaskLabelChange={onTaskLabelChange}
      isEditingTaskLabel={isEditingTaskLabel}
      onStartEditTaskLabel={onStartEditTaskLabel}
      onCancelEditTaskLabel={onCancelEditTaskLabel}
      actions={actions}
      isFavorite={isFavorite}
      gitChange={gitChange}
      taskLinkCount={taskLinkCount}
      onNavigate={onNavigate}
      onToggleFavorite={onToggleFavorite}
      onContextMenu={onContextMenu}
      onDropOnFolder={onDropOnFolder}
      onDesktopFileDrop={onDesktopFileDrop}
    />
  );
});

// ─── Component ───────────────────────────────────────────────────────

export function FolderListView({
  projectId,
  folderId,
  canEdit,
  canManageFiles = false,
  className,
  collection,
}: FolderListViewProps): React.JSX.Element {
  // ── Store selectors ───────────────────────────────────────────────
  const nodesById = useFilesStore(
    (s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJECT,
  ) as Record<string, WorkspaceNode>;
  const childrenByParentId = useFilesStore(
    (s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJECT,
  ) as Record<string, string[]>;
  const loadedChildren = useFilesStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJECT,
  ) as Record<string, boolean>;
  const favorites = useFilesStore(
    (s) => s.byProjectId[projectId]?.favorites || EMPTY_OBJECT,
  ) as Record<string, boolean>;
  const sort = useFilesStore(s => s.byProjectId[projectId]?.sort ?? "name");
  const setSort = useFilesStore(s => s.setSort);
  const selectedFolderId = useFilesStore(
    (s) => s.byProjectId[projectId]?.selectedFolderId ?? null,
  );
  const storeSelectedNodeIds = useFilesStore(
    (s) => s.byProjectId[projectId]?.selectedNodeIds || EMPTY_ARRAY,
  ) as string[];
  const gitChangedFiles = useFilesStore(
    (s) =>
      s.byProjectId[projectId]?.git?.changedFiles ?? EMPTY_GIT_CHANGED_FILES,
  );
  const folderPage = useFilesStore(
    (s) =>
      s.byProjectId[projectId]?.folderMeta?.[folderId ?? "__root__"] ??
      EMPTY_FOLDER_PAGE,
  );

  const taskLinkCounts = useFilesStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT,
  ) as Record<string, number>;
  const currentFolderIsSystemManaged = Boolean(
    folderId && nodesById[folderId] && isInternalTaskWorkingFilesNode(nodesById[folderId]),
  );
  const canEditCurrentFolder = canEdit && !currentFolderIsSystemManaged;
  const workspace = useFilesViews();
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [editingLabelNodeId, setEditingLabelNodeId] = React.useState<string | null>(null);
  // Report §7.8, decision 11: folder access lives in each folder's menu, for organization admins only.
  const [accessFolder, setAccessFolder] = React.useState<WorkspaceNode | null>(null);
  const orgAdminFolders = workspace?.org?.mode === "org" && workspace.org.isAdmin ? workspace.org : null;
  // Report §7.8 stages: an organization with no files yet says who sees what's added.
  const orgRootEmpty = workspace?.org?.mode === "org" && !folderId && !collection ? workspace.org : null;
  // Search is committed from the dialog, not on every keystroke. Applying it
  // synchronously prevents stale, clickable rows under a new query label.
  const search = workspace?.query ?? "";

  const upsertNodes = useFilesStore((s) => s.upsertNodes);
  const setChildren = useFilesStore((s) => s.setChildren);
  const setSelectedNode = useFilesStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesStore(
    (s) => s.setSelectedNodeIds,
  );
  const toggleExpanded = useFilesStore((s) => s.toggleExpanded);
  const toggleFavorite = useFilesStore((s) => s.toggleFavorite);

  // ── Navigation (single write path to currentLocationId) ───────────
  const navigateTo = useNavigateTo(projectId);

  // ── Explorer boot (provides loadFolderContent + handlers) ─────────
  const bootContext = React.useContext(FilesTabBootContext);
  if (!bootContext) {
    throw new Error("FolderListView must be used within FilesTabBootContext");
  }
  const { loadFolderContent } = bootContext;
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const loadMore = async () => {
    if (!folderPage.hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      await loadFolderContent(folderId, "append");
    } catch (error) {
      toast.error(
        feedbackError(error instanceof Error ? error.message : "Couldn’t load more files", "Couldn’t load more files"),
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  // ── Folder contents (status / children / retry) ───────────────────
  const cachedFolder = useFolderContents(projectId, folderId, !collection && !search && sort === "name");
  const serverList = useInfiniteQuery({
    queryKey: ["files-directory", projectId, folderId, search, sort],
    enabled: !collection && (!!search || sort !== "name"),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getWorkspaceNodes(projectId, folderId, search, 100, pageParam, { sort }),
    getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 60_000,
    // ponytail: back off idle polling to 5m to eliminate client-side egress churn. ceiling: 5m polling interval. upgrade: WebSocket Realtime push invalidation for remote lists.
  });
  const remoteList = !collection && (!!search || sort !== "name");
  const folder = collection ? { status: collection.loading ? "loading" as const : "ready" as const, children: collection.nodes, retry: () => {}, refreshError: false }
    : remoteList ? { status: serverList.isPending ? "loading" as const : serverList.isError && !serverList.data ? "error" as const : "ready" as const,
        children: serverList.data?.pages.flatMap(page => page.nodes) ?? [], retry: () => { void serverList.refetch(); }, refreshError: serverList.isError && !!serverList.data }
    : cachedFolder;
  const hasMore = !collection && (remoteList ? serverList.hasNextPage : folderPage.hasMore);
  React.useEffect(() => { if (collection) upsertNodes(projectId, collection.nodes); else if (remoteList && serverList.data) upsertNodes(projectId, serverList.data.pages.flatMap(page => page.nodes)); }, [collection, remoteList, serverList.data, projectId, upsertNodes]);

  // ── Sorted children per Req 4.2 ────────────────────────────────────
  const sortedChildren = React.useMemo<FolderListRowNode[]>(() => {
    if (folder.status !== "ready") return [];
    const sorted = !collection || collection.preserveOrder ? folder.children as FolderListRowNode[] : sortFolderListNodes(folder.children, sort) as FolderListRowNode[];
    return folderId === null
      ? sorted.filter((node) => !isWorkspaceSystemRoot(node))
      : sorted;
  }, [folder.status, folder.children, folderId, sort, collection]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrollKey = `${workspace?.view ?? "project"}:${workspace?.taskId ?? ""}:${folderId ?? "root"}:${search}:${sort}`;
  React.useLayoutEffect(() => {
    if (folder.status === "ready" && scrollRef.current) scrollRef.current.scrollTop = workspace?.scrollOffsets.current.get(scrollKey) ?? 0;
  }, [scrollKey, folder.status, workspace?.scrollOffsets]);

  // ponytail: O(1) Set lookup replaces O(N*M) array scans. ceiling: 10,000 files per view. upgrade: TanStack Virtual windowing for >50,000 files.
  const selectedNodeIdSet = React.useMemo(() => new Set(storeSelectedNodeIds), [storeSelectedNodeIds]);
  const selectedItems = React.useMemo(
    () => sortedChildren.filter(node => selectedNodeIdSet.has(node.id) && !isInternalTaskWorkingFilesNode(node)),
    [sortedChildren, selectedNodeIdSet],
  );
  React.useEffect(() => { setSelectedNodeIds(projectId, []); setSelectionMode(false); }, [projectId, folderId, search, sort, workspace?.view, workspace?.taskId, collection?.preserveOrder, setSelectedNodeIds]);
  const selectItem = React.useCallback((id: string, selected: boolean) => {
    const current = useFilesStore.getState().byProjectId[projectId]?.selectedNodeIds ?? [];
    if (selected && current.length >= 200) { toast.info("Select up to 200 items per operation"); return; }
    setSelectedNodeIds(projectId, selected ? [...new Set([...current, id])] : current.filter(value => value !== id));
  }, [projectId, setSelectedNodeIds]);

  const gitChangeByNodeId = React.useMemo(() => {
    const map: Record<string, GitChangeStatus> = {};
    for (const entry of gitChangedFiles) {
      if (entry && typeof entry.nodeId === "string") {
        map[entry.nodeId] = entry.status;
      }
    }
    return map;
  }, [gitChangedFiles]);

  // ── Operations log + mutations ────────────────────────────────────
  const { recordOperation } = useExplorerOperationLog();

  // The mutations hook expects a `selectedNode`. For the folder-list
  // context, "selected" means the current folder (or null for root).
  const selectedNode = folderId ? nodesById[folderId] ?? null : null;

  const {
    uploadCollisionDialog,
    createDialog,
    setCreateDialog,
    deleteDialog,
    setDeleteDialog,
    moveDialog,
    setMoveDialog,
    renameState,
    setRenameState,
    openCreateInFolder,
    confirmCreate,
    openFolderUpload,
    openRename,
    confirmRename,
    openDelete,
    openMove,
    confirmMove,
    confirmDelete,
    handleMoveFromMenu,
    handleDeleteFromMenu,
    handleUploadToFolder,
    uploadFilesDirectly,
    runUniqueMutation,
  } = useExplorerMutations({
    projectId,
    canEdit: canEditCurrentFolder,
    canManageFiles,
    selectedNode,
    selectedFolderId,
    nodesById,
    childrenByParentId,
    loadedChildren,
    storeSelectedNodeIds,
    upsertNodes,
    setChildren,
    toggleExpanded,
    setSelectedNode,
    setSelectedNodeIds,
    loadFolderContent,
    onOpenFile: (node) => navigateTo(node.id),
    onFolderCreated: orgAdminFolders ? setAccessFolder : undefined,
    showToast: showFilesToast,
    recordOperation,
  });

  // ── Drag & drop (preserved — Q4 keep) ─────────────────────────────
  const { handleDropOnFolder } = useExplorerDragDrop({
    projectId,
    canEdit: canEditCurrentFolder,
    canManageFiles,
    nodesById,
    storeSelectedNodeIds,
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast: showFilesToast,
    recordOperation,
  });

  // ── Drag & Drop state (matching Task Panel UX) ─────────────────────
  const [isDragActive, setIsDragActive] = React.useState(false);
  const dragCounterRef = React.useRef(0);

  const queryClient = useQueryClient();

  // ── Attach to task state & handler ─────────────────────────────────
  const [attachTaskNode, setAttachTaskNode] = React.useState<FolderListRowNode | null>(null);
  const [isAttachingTask, setIsAttachingTask] = React.useState(false);

  const handleAttachTaskSelect = React.useCallback(
    async (taskId: string, role: TaskFileRole) => {
      if (!attachTaskNode) return;
      setIsAttachingTask(true);
      try {
        const { linkNodeToTask } = await import("@/app/actions/files/links");
        await linkNodeToTask(taskId, attachTaskNode.id, { role });
        toast.success("File attached to task");
        // The event refreshes the real linked-task and task-collection queries.
        window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId, taskId } }));
        setAttachTaskNode(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn’t attach file to task";
        toast.error(feedbackError(msg, "Action couldn’t finish"));
      } finally {
        setIsAttachingTask(false);
      }
    },
    [attachTaskNode, projectId, queryClient]
  );

  // ── Revision upload state & handler ────────────────────────────────
  const [targetRevisionNode, setTargetRevisionNode] = React.useState<FolderListRowNode | null>(null);
  const [pendingRevisionFile, setPendingRevisionFile] = React.useState<File | null>(null);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = React.useState(false);

  const triggerRevisionFileInput = (node: FolderListRowNode) => {
      setTargetRevisionNode(node);
      const fileInputEl = document.createElement("input");
      fileInputEl.type = "file";
      fileInputEl.style.display = "none";
      fileInputEl.onchange = (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const expectedExt = extOf(node.name);
        const uploadedExt = extOf(file.name);
        if (expectedExt !== uploadedExt) {
          const label = (ext: string) => (ext ? `.${ext}` : "no extension");
          toast.warning(`Extension mismatch: expected ${label(expectedExt)} but received ${label(uploadedExt)}`);
          return;
        }

        setPendingRevisionFile(file);
        setIsRevisionModalOpen(true);
      };
      fileInputEl.click();
    };

  const handleRevisionOptionSelected = React.useCallback(
    async (choice: { option: "commit"; comment?: string }) => {
      if (!pendingRevisionFile || !targetRevisionNode) return;
      const file = pendingRevisionFile;
      const node = targetRevisionNode;
      setPendingRevisionFile(null);
      // Retry brings the same file back to the version dialog (0.8 #6).
      const reopen = () => { setTargetRevisionNode(node); setPendingRevisionFile(file); setIsRevisionModalOpen(true); };

      try {
        const [{ saveFileRevision }, { logger }] = await Promise.all([
          import("@/hooks/useFileVersions"),
          import("@/lib/logger"),
        ]);
        const result = await saveFileRevision({
          projectId,
          nodeId: node.id,
          file,
          mode: "new_revision",
          comment: choice.comment || "Uploaded in Files",
          baseVersion: node.currentVersion,
        });

        if (result.success) {
          toast.success(`Saved as v${result.version.version}`);
          upsertNodes(projectId, [result.node]);
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));

          logger.metric("files_tab.version_replaced", {
            module: "files-tab",
            source: "files_tab",
            projectId,
            nodeId: node.id,
            revisionMode: "new_revision",
            newVersion: result.version.version,
          });
        } else {
          toast.error(feedbackError(result.error || "Couldn’t save version", "Couldn’t save version"), { retry: reopen });
        }
      } catch {
        toast.error("Couldn’t save version", { retry: reopen });
      }
    },
    [pendingRevisionFile, targetRevisionNode, projectId, upsertNodes]
  );

  const resetDragState = React.useCallback(() => {
    dragCounterRef.current = 0;
    setIsDragActive(false);
  }, []);

  // Global window listeners for drag cancellation (OS dragend, window drop, or Escape)
  React.useEffect(() => {
    const handleGlobalDragEnd = () => resetDragState();
    const handleGlobalDrop = () => resetDragState();
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        resetDragState();
      }
    };

    window.addEventListener("dragend", handleGlobalDragEnd);
    window.addEventListener("drop", handleGlobalDrop);
    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("drop", handleGlobalDrop);
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [resetDragState]);

  const handleDragEnter = (e: React.DragEvent) => {
    if (!canEdit) return;
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!canEdit) return;
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setIsDragActive(false);
      }
    };

  const handleDrop = (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      resetDragState();

      const dataTransfer = e.dataTransfer;
      void extractFoldersFromDataTransfer(dataTransfer).then((extracted) => {
        const allFiles: File[] = [
          ...extracted.looseFiles,
          ...extracted.folders.flatMap((folder) =>
            folder.files.map((item) => {
              const fullRelativePath = item.relativePath
                ? `${folder.name}/${item.relativePath}`
                : `${folder.name}/${item.file.name}`;
              try {
                Object.defineProperty(item.file, "webkitRelativePath", {
                  value: fullRelativePath,
                  configurable: true,
                });
              } catch {}
              return item.file;
            }),
          ),
        ];
        const rawFiles = allFiles.length > 0 ? allFiles : Array.from(dataTransfer.files || []);
        if (rawFiles.length === 0) return;

        const validation = validateUploadSelection(rawFiles, {
          isFolder: rawFiles.some((f) => f.webkitRelativePath?.includes("/")),
        });
        if (!validation.valid) {
          if (validation.error) toast.error(feedbackError(validation.error, "Action couldn’t finish"));
          return;
        }

        void dropInto(validation.files, folderId);
      }).catch((error) => {
        toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t read dropped folder", "Couldn’t read dropped folder"));
      });
    };

  // ── Drops and picks place files directly (CLI report §19.2): no pop-up ──────────
  const folderPath = React.useCallback(
    (id: string | null) => (id ? nodesById[id]?.path ?? "this folder" : "All files"),
    [nodesById],
  );
  const dropInto = React.useCallback(
    async (files: File[], targetFolderId: string | null) =>
      placeDrop({
        projectId,
        parentId: targetFolderId,
        where: folderPath(targetFolderId),
        files,
        uploadNew: (fresh, parentId) => uploadFilesDirectly(fresh, parentId),
        onChanged: () => void loadFolderContent(folderId, "refresh"),
      }),
    [projectId, folderPath, uploadFilesDirectly, loadFolderContent, folderId],
  );

  // ⌘V / Ctrl+V with files or a screenshot: same as dropping on the folder you're viewing (A10.4).
  React.useEffect(() => {
    if (!canEditCurrentFolder) return;
    const onPaste = (event: ClipboardEvent) => {
      // An open task panel or dialog takes the paste instead.
      if (document.querySelector("[role=dialog]")) return;
      const files = pastedFiles(event);
      if (!files) return;
      event.preventDefault();
      void dropInto(files, folderId);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEditCurrentFolder, dropInto, folderId]);

  const handleDesktopFileDrop = React.useCallback(
    (files: File[], targetNodeId: string) => {
      if (!canEdit || files.length === 0) return;
      resetDragState();
      const validation = validateUploadSelection(files, {
        isFolder: files.some((f) => f.webkitRelativePath?.includes("/")),
      });
      if (!validation.valid) {
        if (validation.error) toast.error(feedbackError(validation.error, "Action couldn’t finish"));
        return;
      }
      const node = nodesById[targetNodeId];
      if (node?.type === "file") {
        // A file row: one same-type file is a new version of it; anything else goes into its folder.
        const target = resolveDropTarget(
          { kind: "file", id: node.id, name: node.name, parentId: node.parentId ?? null, parentPath: folderPath(node.parentId ?? null), version: Number((node as { currentVersion?: number }).currentVersion ?? 1) },
          validation.files,
        );
        if (target.kind === "version") {
          const file = validation.files[0]!;
          const attempt = async (): Promise<void> => {
            const { saveFileRevision } = await import("@/hooks/useFileVersions");
            const res = await saveFileRevision({ projectId, nodeId: node.id, file, mode: "new_revision" });
            if (!res.success) { toast.error(feedbackError(res.error, "Couldn’t save the new version"), { retry: () => void attempt() }); return; }
            upsertNodes(projectId, [res.node]);
            const previous = res.version.basedOnVersion ?? res.version.version - 1;
            toast.success(`${node.name} · v${previous} → v${res.version.version}`, {
              duration: 8_000,
              action: { label: "Undo", onClick: () => void import("@/lib/files/place-drop").then(({ undoDrop }) => undoDrop(projectId, { created: [], versions: [{ nodeId: node.id, name: node.name, previous, version: res.version.version }], skipped: [] }, () => void loadFolderContent(folderId, "refresh"))) },
            });
          };
          void attempt();
          return;
        }
        void dropInto(validation.files, node.parentId ?? null);
        return;
      }
      void dropInto(validation.files, targetNodeId);
    },
    [canEdit, resetDragState, nodesById, folderPath, projectId, upsertNodes, loadFolderContent, folderId, dropInto],
  );

  // ── Toolbar Upload actions with rigorous selection validation ─────
  const triggerFilesPicker = React.useCallback(() => {
    if (!canEditCurrentFolder) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const rawFiles = Array.from(input.files || []);
      const validation = validateUploadSelection(rawFiles, { isFolder: false });
      if (!validation.valid) {
        if (validation.error) toast.error(feedbackError(validation.error, "Action couldn’t finish"));
        return;
      }
      void dropInto(validation.files, folderId);
    };
    input.click();
  }, [canEditCurrentFolder, folderId, dropInto]);

  const triggerFolderPicker = React.useCallback(() => {
    if (!canEditCurrentFolder) return;
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => {
      const rawFiles = Array.from(input.files || []);
      const validation = validateUploadSelection(rawFiles, { isFolder: true });
      if (!validation.valid) {
        if (validation.error) toast.error(feedbackError(validation.error, "Action couldn’t finish"));
        return;
      }
      void dropInto(validation.files, folderId);
    };
    input.click();
  }, [canEditCurrentFolder, folderId, dropInto]);

  // ── Stable row callbacks ──────────────────────────────────────────
  const handleToggleFavorite = React.useCallback(
    (nodeId: string) => {
      toggleFavorite(projectId, nodeId);
    },
    [projectId, toggleFavorite],
  );

  // ── Context-menu portal state (preserved — Q5 keep) ───────────────
  const [contextMenuState, setContextMenuState] = React.useState<{
    open: boolean;
    x: number;
    y: number;
    node: FolderListRowNode | null;
  }>({ open: false, x: 0, y: 0, node: null });

  const handleContextMenu = React.useCallback(
    (node: FolderListRowNode, e: React.MouseEvent) => {
      let x = e.clientX;
      let y = e.clientY;
      if (x === 0 && y === 0 && e.currentTarget) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        x = rect.left;
        y = rect.bottom;
      }
      setContextMenuState({ open: true, x, y, node });
    },
    [],
  );

  const noopContextMenu = React.useCallback(
    (_node: FolderListRowNode, event: React.MouseEvent) => {
      event.preventDefault();
    },
    [],
  );

  const handleOpenFromMenu = React.useCallback(
    (node: FolderListRowNode) => {
      navigateTo(node.id);
    },
    [navigateTo],
  );


  const downloadNode = React.useCallback(async (node: FolderListRowNode) => {
    await downloadWorkspaceNode(projectId, node.id, node.name);
  }, [projectId]);

  const copyLink = React.useCallback(async (node: FolderListRowNode) => {
    const url = new URL(window.location.href); url.searchParams.set("tab", "files"); url.searchParams.set("fileId", node.id); url.searchParams.delete("path");
    try { await copyText(url.toString()); toast.success("File link copied"); } catch { toast.error("Couldn’t copy the link"); }
  }, []);

  const openInspector = React.useCallback((node: FolderListRowNode, panel: string) => {
    const url = new URL(window.location.href); url.searchParams.set("filesPanel", panel); window.history.replaceState(window.history.state, "", url);
    navigateTo(node.id);
  }, [navigateTo]);

  const renderMenu = React.useCallback((menuNode: FolderListRowNode) => <>          {menuNode ? (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  if (menuNode)
                    handleOpenFromMenu(menuNode);
                }}
              >
                <FolderOpen className="w-4 h-4 mr-2" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (menuNode)
                    toggleFavorite(projectId, menuNode.id);
                }}
              >
                {menuNode &&
                favorites[menuNode.id] ? (
                  <>
                    <StarOff className="w-4 h-4 mr-2" />
                    Unstar
                  </>
                ) : (
                  <>
                    <Star className="w-4 h-4 mr-2" />
                    Star
                  </>
                )}
              </DropdownMenuItem>
              {menuNode.type === "file" && (
                <>
                  <DropdownMenuItem onSelect={() => openInspector(menuNode, "details")}>
                    <Info className="mr-2 size-4" />
                    Details
                  </DropdownMenuItem>
                  {canEdit && isTextFile(menuNode) && (
                    <DropdownMenuItem
                      onSelect={() => handleOpenFromMenu(menuNode)}
                    >
                      <Pencil className="mr-2 size-4" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canEdit && (
                    <DropdownMenuItem
                      onSelect={() => triggerRevisionFileInput(menuNode)}
                      aria-label="Upload a file version"
                    >
                      <FileUp className="mr-2 size-4" />
                      Upload version…
                    </DropdownMenuItem>
                  )}
                  {canEdit && workspace?.canReadTasks && (
                    <DropdownMenuItem onSelect={() => setAttachTaskNode(menuNode)}>
                      <ListTodo className="mr-2 size-4" />
                      Link to task…
                    </DropdownMenuItem>
                  )}
                  {workspace?.canReadTasks && (
                    <DropdownMenuItem onSelect={() => openInspector(menuNode, "linked_tasks")}>
                      <Link2 className="mr-2 size-4" />
                      Linked tasks
                    </DropdownMenuItem>
                  )}
                  {canEdit && !isInternalTaskWorkingFilesNode(menuNode) && (
                    <DropdownMenuItem onSelect={() => openRename(menuNode)}>
                      <Pencil className="mr-2 size-4" />
                      Rename it
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => openInspector(menuNode, "version_history")}>
                    <History className="mr-2 size-4" />
                    Versions
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void downloadNode(menuNode)}>
                    <Download className="mr-2 size-4" />
                    Download
                  </DropdownMenuItem>
                </>
              )}
              {menuNode.type === "folder" && !isInternalTaskWorkingFilesNode(menuNode) && (
                <DropdownMenuItem onSelect={() => void downloadFile(workspaceExportUrl(projectId, menuNode!.name, { folderId: menuNode!.id }))}>
                  <Download className="mr-2 size-4" />
                  Download as zip
                </DropdownMenuItem>
              )}
              {canEdit && !isInternalTaskWorkingFilesNode(menuNode) && menuNode.type === "folder" && (
                <>
                  <DropdownMenuItem
                    onSelect={() =>
                      openCreateInFolder(menuNode!.id, "file")
                    }
                  >
                    <FilePlus2 className="w-4 h-4 mr-2" />
                    New file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      openCreateInFolder(menuNode!.id, "folder")
                    }
                  >
                    <FolderPlus className="w-4 h-4 mr-2" />
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      handleUploadToFolder(menuNode!.id)
                    }
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload file
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      openFolderUpload(menuNode!.id)
                    }
                  >
                    <FolderInput className="w-4 h-4 mr-2" />
                    Upload folder
                  </DropdownMenuItem>
                </>
              )}
              {canEdit && collection?.onUnlink && <DropdownMenuItem onSelect={() => collection.onUnlink?.(menuNode)}><ListTodo className="mr-2 size-4" />Remove from this task</DropdownMenuItem>}
              {canEdit && collection?.onTaskLabelChange && <DropdownMenuItem onSelect={() => setEditingLabelNodeId(menuNode.id)}><Tag className="mr-2 size-4" />Edit label…</DropdownMenuItem>}
              {canEdit && !isInternalTaskWorkingFilesNode(menuNode) && (
                <>
                  {menuNode.type === "folder" && (
                    <DropdownMenuItem
                      onSelect={() => openRename(menuNode!)}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Rename…
                    </DropdownMenuItem>
                  )}
                  {menuNode.type === "folder" && orgAdminFolders ? (
                    <DropdownMenuItem onSelect={() => setAccessFolder(menuNode!)}>
                      <Lock className="w-4 h-4 mr-2" />
                      Who can see this?
                    </DropdownMenuItem>
                  ) : null}
                  {canManageFiles ? (
                    <DropdownMenuItem
                      onSelect={() => handleMoveFromMenu(menuNode!)}
                    >
                      <FolderInput className="w-4 h-4 mr-2" />
                      Move…
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem variant="destructive"
                    onSelect={() =>
                      handleDeleteFromMenu(menuNode!)
                    }
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Move to trash
                  </DropdownMenuItem>
                </>
              )}
            </>
          ) : null}</>, [
    handleOpenFromMenu,
    toggleFavorite,
    projectId,
    favorites,
    downloadNode,
    copyLink,
    openInspector,
    workspace?.canReadTasks,
    canEdit,
    openCreateInFolder,
    handleUploadToFolder,
    openFolderUpload,
    collection,
    openRename,
    canManageFiles,
    handleMoveFromMenu,
    handleDeleteFromMenu,
    setAttachTaskNode,
    setTargetRevisionNode,
    orgAdminFolders,
  ]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      data-testid="files-tab-folder-list-view"
      className={cn(
        styles.container,
        "flex h-full min-h-0 flex-col overflow-hidden bg-card dark:bg-background relative",
        className,
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!selectionMode && !search && canEditCurrentFolder && (!collection || Boolean(workspace?.taskId)) && (
        <FilesHeaderSlot slot="actions">
          <div className="flex items-center gap-1.5 mr-1">
            {/* Folder access from the folder's own header too, not only its menu (step 8 gap). */}
            {folderId && orgAdminFolders && nodesById[folderId] ? (
              <button type="button" onClick={() => setAccessFolder(nodesById[folderId]!)} title="Who can see this folder?"
                className="nb-touch-target flex h-8 items-center gap-1.5 rounded-[5px] border border-border px-2.5 text-xs hover:bg-muted">
                <Lock className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Who can see this?</span>
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="nb-touch-target flex h-8 items-center gap-1.5 rounded-[5px] bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                  aria-label="Upload files or folder"
                >
                  <Upload className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-[8px] border border-border bg-card p-1 shadow-md">
                <DropdownMenuItem onSelect={triggerFilesPicker} className="rounded-[5px] text-xs">
                  <Upload className="mr-2 size-3.5" />
                  Upload files…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={triggerFolderPicker} className="rounded-[5px] text-xs">
                  <FolderInput className="mr-2 size-3.5" />
                  Upload folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {!collection && (
              <button
                type="button"
                onClick={() => openCreateInFolder(folderId, "folder")}
                className="nb-touch-target flex h-8 items-center gap-1.5 rounded-[5px] border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
                aria-label="New folder"
              >
                <FolderPlus className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">New folder</span>
              </button>
            )}
          </div>
        </FilesHeaderSlot>
      )}
      <FilesViewsMenu projectId={projectId} selectionMode={selectionMode}>
        {selectionMode ? <>
          <DropdownMenuItem onSelect={() => setSelectedNodeIds(projectId, sortedChildren.filter(node => !isInternalTaskWorkingFilesNode(node)).slice(0, 200).map(node => node.id))}>Select loaded items (up to 200)</DropdownMenuItem>
          {canManageFiles && <DropdownMenuItem disabled={!selectedItems.length} onSelect={() => openMove(selectedItems)}><FolderInput className="size-4" />Move…</DropdownMenuItem>}
          <DropdownMenuItem disabled={!selectedItems.length || selectedItems.length > 100} onSelect={() => void downloadFile(workspaceExportUrl(projectId, "Selected files", { ids: selectedItems.map(node => node.id) }))}><Download className="size-4" />{selectedItems.length > 100 ? "Download (up to 100)" : "Download as zip"}</DropdownMenuItem>
          {canEditCurrentFolder && <DropdownMenuItem disabled={!selectedItems.length} variant="destructive" onSelect={() => openDelete(selectedItems)}><Trash2 className="size-4" />Move to trash…</DropdownMenuItem>}
        </> : <>
          {!collection && <DropdownMenuSub>
            <DropdownMenuSubTrigger><ArrowDownWideNarrow className="size-4" />Sort</DropdownMenuSubTrigger>
            <DropdownMenuSubContent><DropdownMenuRadioGroup aria-label="Sort files" value={sort} onValueChange={value => setSort(projectId, value as "name" | "updated" | "type")}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="updated">Last updated</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="type">File type</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup></DropdownMenuSubContent>
          </DropdownMenuSub>}
          {collection?.menuItems}
          {!collection && !search && canEditCurrentFolder && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={triggerFilesPicker}><Upload className="size-4" />Upload files…</DropdownMenuItem>
            <DropdownMenuItem onSelect={triggerFolderPicker}><FolderInput className="size-4" />Upload folder…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreateInFolder(folderId, "file")}><FilePlus2 className="size-4" />New file…</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openCreateInFolder(folderId, "folder")}><FolderPlus className="size-4" />New folder…</DropdownMenuItem>
          </>}
          <DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setSelectionMode(true); setSelectedNodeIds(projectId, []); }}>Select items</DropdownMenuItem>
        </>}
      </FilesViewsMenu>
      {selectionMode && <FilesHeaderSlot slot="status"><span role="status">{selectedItems.length} selected</span><button type="button" className="min-h-10 rounded px-2 hover:bg-muted" onClick={() => { setSelectionMode(false); setSelectedNodeIds(projectId, []); }}>Done</button></FilesHeaderSlot>}
      <div role="table" aria-label="File listing" className="flex min-h-0 flex-1 flex-col">
      <FolderListHeader sort={collection?.preserveOrder ? undefined : sort} />

      {folder.refreshError ? <div role="status" className="px-4 py-2 text-sm text-amber-700 dark:text-amber-300">Showing cached files. Refresh failed. <button type="button" onClick={folder.retry} className="underline">Retry</button></div> : null}

      <div ref={scrollRef} data-scroll-memory="files-list" onScroll={event => { if (folder.status === "ready") workspace?.scrollOffsets.current.set(scrollKey, event.currentTarget.scrollTop); }} className="flex-1 min-h-0 overflow-y-auto">
        {folder.status === "loading" ? (
          <FolderListLoading />
        ) : folder.status === "error" ? (
          <FolderListError onRetry={folder.retry} />
        ) : sortedChildren.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <FolderListEmpty
              className="py-0"
              message={
                collection?.emptyMessage ?? (search ? "No matching files." : currentFolderIsSystemManaged
                  ? "No task files have been added yet"
                  : orgRootEmpty && !search ? (orgRootEmpty.isAdmin ? "Share materials here" : "No files shared yet")
                  : undefined)
              }
              hint={orgRootEmpty && !search ? (orgRootEmpty.isAdmin ? `Everyone in ${orgRootEmpty.title} can see what you add.` : null) : undefined}
            />
            {!collection && !search && canEditCurrentFolder ? (
              <p className="text-sm text-muted-foreground">Use the toolbar or actions menu to upload files or create a folder.</p>
            ) : null}
          </div>
        ) : (
          <div role="rowgroup">
            {sortedChildren.map((node) => {
              const isSystemManaged = isInternalTaskWorkingFilesNode(node);
              const gitChange = gitChangeByNodeId[node.id] ?? null;
              return (
                <FolderListRowItem
                  key={node.id}
                  projectId={projectId}
                  node={node}
                  canEdit={canEdit && !isSystemManaged}
                  canMove={canManageFiles && !isSystemManaged}
                  selected={selectedNodeIdSet.has(node.id)}
                  onSelectionChange={selectionMode ? selectItem : undefined}
                  showActions={true}
                  subtitle={collection?.labels?.[node.id] ?? (search ? (node.path.startsWith("/.system/") ? "Task files" : node.path) : undefined)}
                  taskLabel={collection?.taskLabels?.[node.id]}
                  onTaskLabelChange={collection?.onTaskLabelChange ? (n, label) => { setEditingLabelNodeId(null); collection.onTaskLabelChange?.(n, label); } : undefined}
                  isEditingTaskLabel={editingLabelNodeId === node.id}
                  onStartEditTaskLabel={() => setEditingLabelNodeId(node.id)}
                  onCancelEditTaskLabel={() => setEditingLabelNodeId(null)}
                  isFavorite={!!favorites[node.id]}
                  gitChange={gitChange}
                  taskLinkCount={taskLinkCounts[node.id] ?? 0}
                  onNavigate={navigateTo}
                  onToggleFavorite={handleToggleFavorite}
                  onContextMenu={isSystemManaged ? noopContextMenu : handleContextMenu}
                  onDropOnFolder={!isSystemManaged && canManageFiles ? handleDropOnFolder : undefined}
                  onDesktopFileDrop={!isSystemManaged && canEdit ? handleDesktopFileDrop : undefined}
                  renderMenu={renderMenu}
                />
              );
            })}
            {hasMore ? (
              <div className="flex justify-center p-4">
                <button
                  type="button"
                  disabled={isLoadingMore || serverList.isFetchingNextPage}
                  onClick={() => remoteList ? void serverList.fetchNextPage() : void loadMore()}
                  className="rounded-[5px] border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoadingMore || serverList.isFetchingNextPage ? <><PixelBeat />Loading…</> : "Load more"}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      </div>
      {collection?.footer}

      {/* Context-menu portal (preserved — Q5 keep). Gated entirely on
          `canEdit` for mutation entries so `Role_Viewer` never sees
          upload / create / rename / move / delete affordances. */}
      <DropdownMenu
        modal={false}
        open={contextMenuState.open}
        onOpenChange={(open) =>
          setContextMenuState((prev) => ({ ...prev, open }))
        }
      >
        {/* The installed Radix DropdownMenu package has no Anchor export.
            This controlled, inert trigger is the supported virtual anchor;
            DropdownMenuContent can therefore flip and shift at viewport edges. */}
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            style={{
              position: "fixed",
              left: contextMenuState.x,
              top: contextMenuState.y,
              width: 1,
              height: 1,
              pointerEvents: "none",
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          sticky="always"
          className="z-50 w-48"
        >
          {contextMenuState.node && renderMenu(contextMenuState.node)}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs (create / rename / delete / move) — reuses existing host */}
      {uploadCollisionDialog}
      <ExplorerDialogsHost
        canEdit={canEditCurrentFolder}
        canManageFiles={canManageFiles}
        projectId={projectId}
        createDialog={createDialog}
        setCreateDialog={setCreateDialog}
        confirmCreate={async () => {
          await confirmCreate();
        }}
        renameState={renameState}
        setRenameState={setRenameState}
        confirmRename={async () => {
          await confirmRename();
        }}
        deleteDialog={deleteDialog}
        setDeleteDialog={setDeleteDialog}
        confirmDelete={async () => {
          await confirmDelete();
        }}
        moveDialog={moveDialog}
        setMoveDialog={setMoveDialog}
        confirmMove={async () => {
          await confirmMove();
        }}
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragActive && (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Upload to ${folderPath(folderId)}`}
          onClick={resetDragState}
          className="absolute inset-0 z-40 flex flex-col items-center justify-center nb-drop-hint cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,transform] animate-in fade-in-50 duration-[130ms]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col items-center gap-2.5 p-6 rounded-[8px] bg-card shadow-xl border border-border cursor-default"
          >
            <button
              type="button"
              onClick={resetDragState}
              aria-label="Dismiss drop overlay"
              className="nb-touch-target absolute top-2.5 right-2.5 size-7 rounded-[5px] flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[#F3F0EA] dark:hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
            <Upload className="size-8 text-[#D14E24] animate-none" />
            <p className="font-semibold text-sm text-foreground">
              Upload to {folderPath(folderId)}
            </p>
            <p className="text-xs text-muted-foreground">
              Files with the same name become new versions. Drop on a file for a new version of it.
            </p>
          </div>
        </div>
      )}

      {/* TaskSearchPicker Dialog for Attach task action */}
      {attachTaskNode && (
        <TaskSearchPicker
          projectId={projectId}
          isOpen={Boolean(attachTaskNode)}
          isSaving={isAttachingTask}
          onClose={() => setAttachTaskNode(null)}
          onSelect={handleAttachTaskSelect}
        />
      )}

      {accessFolder && orgAdminFolders ? (
        <FolderAccessDialog orgId={orgAdminFolders.orgId} orgTitle={orgAdminFolders.title} folder={accessFolder} open
          onOpenChange={(open) => { if (!open) setAccessFolder(null); }}
          onSaved={(metadata) => upsertNodes(projectId, [{ ...accessFolder, metadata } as WorkspaceNode])} />
      ) : null}

      {/* RevisionControlModal for Upload revision action */}
      {isRevisionModalOpen && targetRevisionNode && (
        <RevisionControlModal
          isOpen={isRevisionModalOpen}
          onOpenChange={setIsRevisionModalOpen}
          fileName={targetRevisionNode.name}
          onSelectOption={handleRevisionOptionSelected}
        />
      )}
    </div>
  );
}

export default FolderListView;
