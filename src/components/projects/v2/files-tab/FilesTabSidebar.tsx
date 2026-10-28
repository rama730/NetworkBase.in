// Files sidebar: collection navigation or project tree; search lives in the workspace menu.

"use client";

import dynamic from "next/dynamic";
import { toast, feedbackError } from "@/lib/feedback";

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, PanelLeftClose } from "lucide-react";

const EMPTY_FOLDER_SIZES: Record<string, number> = {};
import {
  useFilesWorkspaceView,
  fileCollectionViews,
} from "./FilesWorkspaceViews";

import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { isInternalTaskWorkingFilesNode } from "@/lib/files/task-working-files";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FilePlus2,
  FileUp,
  FolderOpen,
  FolderPlus,
  FolderInput,
  History,
  Info,
  ListTodo,
  Pencil,
  Star,
  StarOff,
  Trash2,
  Upload,
} from "lucide-react";

import { useExplorerDragDrop } from "../explorer/useExplorerDragDrop";
import { useExplorerMutations } from "../explorer/useExplorerMutations";
import { useTreeContext } from "../explorer/ExplorerContextMenu";
import {
  ExplorerTree,
  useRowsToRender,
  useVisibleRows,
} from "../explorer/ExplorerTree";
import { EMPTY_ARRAY, EMPTY_OBJECT } from "../explorer/explorerTypes";
import { useExplorerOperationLog } from "../explorer/useExplorerOperationLog";

import { useNavigateTo } from "./hooks/useNavigateTo";
import { FilesTabBootContext } from "./hooks/useFolderContents";
import { FILES_TAB_SIDEBAR_WIDTH_PX } from "./sidebarSearch";

const ExplorerDialogsHost = dynamic(() => import("../explorer/ExplorerDialogsHost").then((mod) => mod.ExplorerDialogsHost), { ssr: false });

// Re-export the pure helpers so consumers (Task 3.2 tests, FilesTabMain's
// collapsed-state floating toggle) can depend on a single import path.
export {
  FILES_TAB_SIDEBAR_WIDTH_PX,
  computeVisibleIdsForSearch,
} from "./sidebarSearch";

function showFilesToast(
  message: string,
  type: "success" | "error" | "info" | "warning" = "info",
) {
  if (type === "success") toast.success(message);
  else if (type === "error") toast.error(feedbackError(message, "Action couldn’t finish"));
  else if (type === "warning") toast.warning(message);
  else toast.info(message);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface FilesTabSidebarProps {
  projectId: string;
  /** Shortcut for `role !== "Role_Viewer"`. Mirrors the design.md prop shape. */
  canEdit: boolean;
  canManageFiles?: boolean;
  /** Optional project display name used by the empty-state row. */
  projectName?: string;
}

// ─── Component ───────────────────────────────────────────────────────

export function FilesTabSidebar({
  projectId,
  canEdit,
  canManageFiles = false,
  projectName,
}: FilesTabSidebarProps): React.JSX.Element {
  // ── Store selectors ───────────────────────────────────────────────
  const sidebarCollapsed = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.ui?.sidebarCollapsed ?? false,
  );
  const toggleSidebar = useFilesWorkspaceStore((s) => s.toggleSidebar);

  const nodesById = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.nodesById || EMPTY_OBJECT,
  );
  const childrenByParentId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.childrenByParentId || EMPTY_OBJECT,
  );
  const loadedChildren = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.loadedChildren || EMPTY_OBJECT,
  );
  const expandedFolderIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.expandedFolderIds || EMPTY_OBJECT,
  );
  const folderMeta = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.folderMeta || EMPTY_OBJECT,
  );
  const treeVersion = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.treeVersion || 0,
  );
  const sort = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.sort || "name",
  );
  const foldersFirst = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.foldersFirst ?? true,
  );
  const favorites = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.favorites || EMPTY_OBJECT,
  );
  const recents = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.recents || EMPTY_ARRAY,
  );
  const taskLinkCounts = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.taskLinkCounts || EMPTY_OBJECT,
  );
  const locksByNodeId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.locksByNodeId || EMPTY_OBJECT,
  );
  const currentLocationId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.currentLocationId ?? null,
  );
  const selectedFolderId = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedFolderId ?? null,
  );
  const storeSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.byProjectId[projectId]?.selectedNodeIds || EMPTY_ARRAY,
  );

  const upsertNodes = useFilesWorkspaceStore((s) => s.upsertNodes);
  const setChildren = useFilesWorkspaceStore((s) => s.setChildren);
  const setSelectedNode = useFilesWorkspaceStore((s) => s.setSelectedNode);
  const setSelectedNodeIds = useFilesWorkspaceStore(
    (s) => s.setSelectedNodeIds,
  );
  const toggleExpanded = useFilesWorkspaceStore((s) => s.toggleExpanded);
  const toggleFavorite = useFilesWorkspaceStore((s) => s.toggleFavorite);

  // ── Navigation (single write path) ────────────────────────────────
  const navigateTo = useNavigateTo(projectId);

  const workspaceView = useFilesWorkspaceView();
  const renderNodesById = nodesById as Record<string, ProjectNode>;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const closeOnSmallScreen = () => {
      const collapsed =
        useFilesWorkspaceStore.getState().byProjectId[projectId]?.ui
          .sidebarCollapsed;
      if (collapsed !== undefined && collapsed !== media.matches)
        toggleSidebar(projectId);
    };
    closeOnSmallScreen();
    const stopHydration =
      useFilesWorkspaceStore.persist.onFinishHydration(closeOnSmallScreen);
    media.addEventListener("change", closeOnSmallScreen);
    return () => {
      stopHydration();
      media.removeEventListener("change", closeOnSmallScreen);
    };
  }, [projectId, toggleSidebar]);

  useEffect(() => {
    if (sidebarCollapsed || !window.matchMedia("(max-width: 767px)").matches)
      return;
    const sidebar = document.querySelector<HTMLElement>(
      '[data-testid="files-tab-sidebar"][data-collapsed="false"]',
    );
    const controls = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter(
        (element) =>
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden",
      );
    controls()[0]?.focus();
    const close = (event: KeyboardEvent) => {
      // Nested menus/dialogs own their own Escape and focus scope.
      if (
        event.defaultPrevented ||
        document.querySelector(
          '[role="dialog"], [role="menu"][data-state="open"]',
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        toggleSidebar(projectId);
      }
      if (event.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (
          !sidebar?.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-testid="files-tab-sidebar-expand"]',
          )
          ?.focus(),
      );
    };
  }, [sidebarCollapsed, projectId, toggleSidebar]);

  // ── Performance mark (Req 16.5, Task 11.1) ────────────────────────
  //
  // Emit `files-tab:sidebar-interactive` on the first paint where the
  // sidebar is actually visible (not collapsed). A `useRef` guard keeps
  // the mark idempotent across subsequent re-renders so the single
  // User Timing entry represents the first interactive moment. The
  // `typeof performance !== "undefined"` guard keeps this safe during
  // SSR / non-DOM test environments.
  const sidebarInteractiveMarkedRef = useRef(false);
  useEffect(() => {
    if (sidebarCollapsed) return;
    if (sidebarInteractiveMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:sidebar-interactive");
    sidebarInteractiveMarkedRef.current = true;
  }, [sidebarCollapsed]);

  // ── Data bootstrapping ────────────────────────────────────────────
  const bootContext = useContext(FilesTabBootContext);
  if (!bootContext) {
    throw new Error("FilesTabSidebar must be used within FilesTabBootContext");
  }
  const {
    isBooting,
    accessError,
    loadFolderContent,
    handleToggleFolder,
    handleLoadMore,
  } = bootContext;

  // ── Operations log (powers undo on rename/delete/move) ────────────
  const { recordOperation } = useExplorerOperationLog();

  // ── Derived selected node (coerced to the legacy explorer shape) ──
  const selectedNode = currentLocationId
    ? ((nodesById as Record<string, ProjectNode>)[currentLocationId] ?? null)
    : null;

  // ── Mutations (create / rename / delete / move / upload) ─────────
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
    openCreate,
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
    handleDownloadFolder,
    uploadFilesDirectly,
    runUniqueMutation,
  } = useExplorerMutations({
    projectId,
    canEdit,
    canManageFiles,
    selectedNode,
    selectedFolderId,
    nodesById: renderNodesById,
    childrenByParentId: childrenByParentId as Record<string, string[]>,
    loadedChildren: loadedChildren as Record<string, boolean>,
    storeSelectedNodeIds: storeSelectedNodeIds as string[],
    upsertNodes,
    setChildren,
    toggleExpanded,
    setSelectedNode,
    setSelectedNodeIds,
    loadFolderContent,
    onOpenFile: (node) => navigateTo(node.id),
    showToast: showFilesToast,
    recordOperation,
  });

  const { visibleRows, includeFileByMode } = useVisibleRows({
    projectId,
    treeVersion,
    explorerMode: "tree",
    nodesById: nodesById as Record<string, ProjectNode>,
    childrenByParentId: childrenByParentId as Record<string, string[]>,
    loadedChildren: loadedChildren as Record<string, boolean>,
    expandedFolderIds: expandedFolderIds as Record<string, boolean>,
    folderMeta: folderMeta as Record<
      string,
      { nextCursor: string | null; hasMore: boolean }
    >,
    sort: sort as "name" | "updated" | "type",
    foldersFirst: foldersFirst as boolean,
    viewMode: "all",
  });

  // The tree is navigation, not a second search surface. Internal task
  // storage stays hidden here; its authorized collection owns those files.
  const rowsToRender = useRowsToRender({
    effectiveMode: "tree",
    visibleRows: visibleRows.filter((row) => {
      if (row.kind !== "node") return true;
      const node = (nodesById as Record<string, ProjectNode>)[row.nodeId];
      if (node && isInternalTaskWorkingFilesNode(node)) return false;
      return true;
    }),
    searchResults: [],
    trashNodesState: [],
    favorites: favorites as Record<string, boolean>,
    recents: recents as string[],
    nodesById: nodesById as Record<string, ProjectNode>,
    includeFileByMode,
  });

  // Aria metadata — mirrors ExplorerShell so `FileTreeRow` can render
  // `aria-level` / `aria-posinset` / `aria-setsize`.
  const treeItemMetaByNodeId = useMemo(() => {
    const siblingsByParentId = new Map<string, string[]>();
    for (const row of rowsToRender) {
      if (row.kind !== "node") continue;
      const parentKey = row.parentId ?? "__root__";
      const siblings = siblingsByParentId.get(parentKey) ?? [];
      siblings.push(row.nodeId);
      siblingsByParentId.set(parentKey, siblings);
    }
    const meta: Record<
      string,
      { ariaLevel: number; ariaPosInSet: number; ariaSetSize: number }
    > = {};
    for (const row of rowsToRender) {
      if (row.kind !== "node") continue;
      const siblings = siblingsByParentId.get(row.parentId ?? "__root__") ?? [];
      const pos = siblings.indexOf(row.nodeId);
      meta[row.nodeId] = {
        ariaLevel: row.level + 1,
        ariaPosInSet: pos >= 0 ? pos + 1 : 1,
        ariaSetSize: siblings.length || 1,
      };
    }
    return meta;
  }, [rowsToRender]);

  // ── Row-click handler: single write path to currentLocationId ─────
  const handleSelect = useCallback(
    (node: ProjectNode) => {
      navigateTo(node.id);
      if (window.matchMedia("(max-width: 767px)").matches)
        toggleSidebar(projectId);
    },
    [navigateTo, toggleSidebar, projectId, workspaceView],
  );

  // ── Drag & drop (preserved — Q4 keep) ─────────────────────────────
  const { handleDropOnFolder } = useExplorerDragDrop({
    projectId,
    canEdit,
    canManageFiles,
    nodesById: renderNodesById,
    storeSelectedNodeIds: storeSelectedNodeIds as string[],
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast: showFilesToast,
    recordOperation,
  });

  // ── Desktop file drop onto a folder row (preserved upload path) ───
  const handleDesktopFileDrop = useCallback(
    (files: File[], targetFolderId: string) => {
      if (!canEdit || files.length === 0) return;
      void uploadFilesDirectly(files, targetFolderId);
    },
    [canEdit, uploadFilesDirectly],
  );

  // ── Context-menu portal state (preserved — Q5 keep) ───────────────
  const [contextMenuState, setContextMenuState] = useState<{
    open: boolean;
    x: number;
    y: number;
    node: ProjectNode | null;
  }>({ open: false, x: 0, y: 0, node: null });

  const handleContextMenu = useCallback(
    (node: ProjectNode, e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenuState({ open: true, x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  // ── Inline rename wiring (preserved) ──────────────────────────────
  const handleRenameChange = useCallback(
    (v: string) => setRenameState((prev) => ({ ...prev, value: v })),
    [setRenameState],
  );
  const handleInlineRenameConfirm = useCallback(() => {
    if (!renameState.nodeId) return;
    void confirmRename();
  }, [renameState.nodeId, confirmRename]);
  const handleInlineRenameCancel = useCallback(() => {
    setRenameState({ nodeId: null, value: "", original: "" });
  }, [setRenameState]);

  // ── Tree context ──────────────────────────────────────────────────
  //
  // We pass `currentLocationId` as `selectedNodeId` so the tree renderer
  // highlights the Files-tab v3 navigation position. `selectedNodeIds` is
  // forced to `[]` and `mode` to `"default"` so the multi-select
  // checkbox column never renders (Q1 dropped, Req 15.15).
  const contextValue = useTreeContext({
    projectId,
    // Share the renderer's node snapshot so tree rows retain stable heights.
    nodesById: renderNodesById,
    selectedNodeId: currentLocationId,
    effectiveSelectedNodeIds: EMPTY_ARRAY,
    expandedFolderIds: expandedFolderIds as Record<string, boolean>,
    favorites: favorites as Record<string, boolean>,
    taskLinkCounts: taskLinkCounts as Record<string, number>,
    locksByNodeId: locksByNodeId as Record<
      string,
      {
        lockedBy: string;
        lockedByName?: string | null;
        clientKind?: "web" | "vscode";
        expiresAt: number;
      }
    >,
    mode: "default",
    canEdit,
    canMove: canManageFiles,
    projectName: projectName || "Project",
    effectiveMode: "tree",
    renameNodeId: renameState.nodeId,
    renameValue: renameState.value,
    onRenameChange: handleRenameChange,
    onRenameConfirm: handleInlineRenameConfirm,
    onRenameCancel: handleInlineRenameCancel,
    onDesktopFileDrop: handleDesktopFileDrop,
    folderSizes: EMPTY_FOLDER_SIZES,
    treeItemMetaByNodeId,
    handleSelect,
    handleToggleFolder,
    handleDropOnFolder,
    handleLoadMore,
    openCreate,
    openCreateInFolder,
    handleUploadToFolder,
    handleUploadFolderToFolder: openFolderUpload,
    handleDownloadFolder,
    openRename,
    handleMoveFromMenu,
    handleDeleteFromMenu,
    handleTaskLinksClick: () => {
      /* Task-link insights panel is removed in v3 (Req 15.16). */
    },
    toggleFavorite,
    loadFolderContent,
    runUniqueMutation,
    showToast: showFilesToast,
    recordOperation,
    setTrashNodesState: () => undefined,
    onContextMenu: handleContextMenu,
  });

  // ── Authoritative task count sync for task collection contract ──
  const authoritativeTaskCount = useMemo(() => {
    return Object.values(taskLinkCounts).reduce((acc, c) => acc + (c || 0), 0);
  }, [taskLinkCounts]);

  // ── Render ────────────────────────────────────────────────────────
  const collapsedToggleLabel = sidebarCollapsed
    ? "Show sidebar"
    : "Hide sidebar";

  if (sidebarCollapsed) {
    // Collapsed: width 0, no border. A floating expand control sits in
    // its own element so users can re-open the sidebar (Req 2.4–2.5).
    // NOTE: The visible Sidebar_Reopen_Control now lives in FilesTabMain
    // (Req 18.1–18.6). This aside retains zero width for layout purposes.
    return (
      <>
        {uploadCollisionDialog}
        <aside
          data-testid="files-tab-sidebar"
          data-collapsed="true"
          aria-label="File sidebar"
          style={{ width: 0 }}
          className="shrink-0 overflow-hidden"
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close file sidebar"
        onClick={() => toggleSidebar(projectId)}
        className="absolute inset-0 z-20 bg-black/30 md:hidden"
      />
      <aside
        data-testid="files-tab-sidebar"
        data-collapsed="false"
        aria-label="File sidebar"
        style={{ width: FILES_TAB_SIDEBAR_WIDTH_PX }}
        className="shrink-0 flex flex-col h-full border-r border-[#DBD5C8] dark:border-white/10 bg-card dark:bg-background max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:max-w-[85vw] max-md:shadow-xl md:resize-x md:overflow-auto md:min-w-52 md:max-w-[40vw]"
      >
        <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-[#DBD5C8] px-3 dark:border-white/10">
          {workspaceView?.sidebarMode === "tree" ? (
            <button
              type="button"
              onClick={workspaceView.showCollections}
              className="flex min-h-9 flex-1 items-center gap-2 rounded-[5px] text-xs font-medium text-[#374349] dark:text-muted-foreground hover:text-[#141A1E] dark:hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#D14E24]"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to Files
            </button>
          ) : (
            <span className="flex-1 text-xs font-semibold text-[#141A1E] dark:text-foreground">Files</span>
          )}
          <button
            type="button"
            onClick={() => toggleSidebar(projectId)}
            aria-label={collapsedToggleLabel}
            title={collapsedToggleLabel}
            data-testid="files-tab-sidebar-collapse"
            className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-[#6B7880] hover:bg-[#F3F0EA] hover:text-[#141A1E] focus-visible:ring-2 focus-visible:ring-[#D14E24] dark:hover:bg-muted dark:hover:text-foreground"
          >
            <PanelLeftClose aria-hidden="true" className="size-4" />
          </button>
        </div>
        {workspaceView?.sidebarMode === "collections" ? (
          <nav
            aria-label="File collections"
            className="flex-1 space-y-1 overflow-y-auto p-2"
          >
            {fileCollectionViews
              .filter(
                (item) =>
                  item.id !== "deliverables" &&
                  (canEdit || item.id !== "trash") &&
                  (workspaceView.canReadTasks ||
                     !["tasks", "deliverables"].includes(item.id)) &&
                  (item.id !== "github" || workspaceView.canOpenGitHub),
              )
              .map(({ id, Icon }) => {
                const label = workspaceView.viewLabel(id);
                const isActive = workspaceView.view === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      workspaceView.selectView(id);
                      if (
                        id !== "project" &&
                        window.matchMedia("(max-width: 767px)").matches
                      )
                        toggleSidebar(projectId);
                    }}
                    className={cn(
                      "flex min-h-8 [@media(pointer:coarse)]:min-h-11 w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D14E24]",
                      isActive
                        ? "bg-[#F3F0EA] font-semibold text-[#141A1E] dark:bg-white/10 dark:text-foreground"
                        : "text-[#374349] font-medium hover:bg-[#F3F0EA]/70 hover:text-[#141A1E] dark:text-muted-foreground dark:hover:bg-white/5 dark:hover:text-foreground",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0",
                        isActive ? "text-[#D14E24]" : "text-[#6B7880] dark:text-muted-foreground",
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
          </nav>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ExplorerTree
                rowsToRender={rowsToRender}
                contextValue={contextValue}
                nodesById={renderNodesById}
                childrenByParentId={childrenByParentId}
                effectiveSelectedNodeIds={EMPTY_ARRAY as string[]}
                selectedNodeId={currentLocationId}
                viewMode="code"
                effectiveMode="tree"
                isBooting={isBooting}
                isTrashLoading={false}
                accessError={accessError}
                onSelect={handleSelect}
                onToggleFolder={handleToggleFolder}
                onDropOnFolder={canManageFiles ? handleDropOnFolder : undefined}
              />
            </div>
          </>
        )}
        {/* Context-menu portal (preserved — Q5 keep) */}
        <DropdownMenu
          open={contextMenuState.open}
          onOpenChange={(open) =>
            setContextMenuState((prev) => ({ ...prev, open }))
          }
        >
          {/* See FolderListView: the installed Radix DropdownMenu package has
            no Anchor export, so this controlled inert trigger is the
            collision-aware virtual anchor. */}
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
            className="z-50 w-48 [&_[role=menuitem]]:min-h-10"
          >
            {contextMenuState.node ? (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    if (contextMenuState.node)
                      contextValue.openNode(contextMenuState.node);
                  }}
                >
                  <FolderOpen className="w-4 h-4 mr-2" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (contextMenuState.node)
                      toggleFavorite(projectId, contextMenuState.node.id);
                  }}
                >
                  {contextMenuState.node &&
                  (favorites as Record<string, boolean>)[
                    contextMenuState.node.id
                  ] ? (
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
                {contextMenuState.node.type === "file" && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        if (contextMenuState.node) {
                          contextValue.openNode(contextMenuState.node);
                          workspaceView?.setInspector("details");
                        }
                      }}
                    >
                      <Info className="w-4 h-4 mr-2" />
                      Details
                    </DropdownMenuItem>
                    {canEdit && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (contextMenuState.node)
                            contextValue.openNode(contextMenuState.node);
                        }}
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                    )}
                    {canEdit && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (contextMenuState.node) {
                            contextValue.openNode(contextMenuState.node);
                            workspaceView?.setInspector("version_history");
                          }
                        }}
                      >
                        <FileUp className="w-4 h-4 mr-2" />
                        Upload revision…
                      </DropdownMenuItem>
                    )}
                    {canEdit && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (contextMenuState.node) {
                            contextValue.openNode(contextMenuState.node);
                            workspaceView?.setInspector("linked_tasks");
                          }
                        }}
                      >
                        <ListTodo className="w-4 h-4 mr-2" />
                        Attach to task…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => {
                        if (contextMenuState.node) {
                          contextValue.openNode(contextMenuState.node);
                          workspaceView?.setInspector("version_history");
                        }
                      }}
                    >
                      <History className="w-4 h-4 mr-2" />
                      Version history
                    </DropdownMenuItem>
                    {workspaceView && (
                      <DropdownMenuItem
                        onClick={() => {
                          if (contextMenuState.node) {
                            contextValue.openNode(contextMenuState.node);
                            workspaceView?.setInspector("linked_tasks");
                          }
                        }}
                      >
                        <ListTodo className="w-4 h-4 mr-2" />
                        Linked tasks
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {canEdit && contextMenuState.node.type === "folder" && (
                  <>
                    <DropdownMenuItem
                      onSelect={() =>
                        openCreateInFolder(contextMenuState.node!.id, "file")
                      }
                    >
                      <FilePlus2 className="w-4 h-4 mr-2" />
                      New file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        openCreateInFolder(contextMenuState.node!.id, "folder")
                      }
                    >
                      <FolderPlus className="w-4 h-4 mr-2" />
                      New folder
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        handleUploadToFolder(contextMenuState.node!.id)
                      }
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Upload file
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        openFolderUpload(contextMenuState.node!.id)
                      }
                    >
                      <FolderInput className="w-4 h-4 mr-2" />
                      Upload folder
                    </DropdownMenuItem>
                  </>
                )}
                {canEdit && (
                  <>
                    <DropdownMenuItem
                      onSelect={() => openRename(contextMenuState.node!)}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Rename…
                    </DropdownMenuItem>
                    {canManageFiles ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          handleMoveFromMenu(contextMenuState.node!)
                        }
                      >
                        <FolderInput className="w-4 h-4 mr-2" />
                        Move…
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                      onSelect={() =>
                        handleDeleteFromMenu(contextMenuState.node!)
                      }
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Move to trash
                    </DropdownMenuItem>
                  </>
                )}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Dialogs (create / rename / delete / move) — reuses existing host */}
        {uploadCollisionDialog}
        <ExplorerDialogsHost
          canEdit={canEdit}
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

        {/* Dev-only guardrails: surface suspicious states as console warnings
          rather than overlays. The test suite reads DOM `data-*` attributes,
          not warning text. */}
        {process.env.NODE_ENV !== "production" && accessError ? (
          <AccessErrorDevWarning error={accessError} />
        ) : null}
      </aside>
    </>
  );
}

export default FilesTabSidebar;

// ─── Internal helpers ────────────────────────────────────────────────

function AccessErrorDevWarning({ error }: { error: string }): null {
  useEffect(() => {
    console.warn("[files-tab-sidebar] access error", { error });
  }, [error]);
  return null;
}
