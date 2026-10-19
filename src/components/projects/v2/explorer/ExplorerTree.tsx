"use client";

import React, { useMemo, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { FolderPlus } from "lucide-react";
import { FileTreeItem, type FileTreeItemContext } from "./FileTreeItem";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import type { VisibleRow } from "./utils/buildVisibleRows";
import { buildVisibleRows } from "./utils/buildVisibleRows";
import { isTextLike, isAssetLike } from "../utils/fileKind";
import type { FilesViewMode } from "@/stores/filesWorkspaceStore";
import { filesParentKey } from "@/stores/filesWorkspaceStore";





// --- Visible rows computation ---

export function useVisibleRows(params: {
  projectId: string;
  treeVersion: number;
  explorerMode: string;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  expandedFolderIds: Record<string, boolean>;
  folderMeta: Record<string, { nextCursor: string | null; hasMore: boolean }>;
  sort: "name" | "updated" | "type";
  foldersFirst: boolean;
  viewMode: string;
}) {
  const {
    projectId,
    treeVersion,
    explorerMode,
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sort,
    foldersFirst,
    viewMode,
  } = params;

  const [sortedChildren, setSortedChildren] = useState<Record<string, string[]>>({});
  const workerRef = useRef<Worker | null>(null);
  const latestJobRef = useRef<string>("");
  const latestChildrenRef = useRef<Record<string, string[]>>({});

  // Initialize Worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('./utils/sort.worker.ts', import.meta.url));
    workerRef.current.onmessage = (e: MessageEvent<{ jobId: string; sortedChildrenByParentId: Record<string, string[]> }>) => {
      if (e.data.jobId !== latestJobRef.current) return;
      setSortedChildren(e.data.sortedChildrenByParentId);
    };
    workerRef.current.onerror = (event) => {
      const jobIdAtError = latestJobRef.current;
      const fallbackChildren = latestChildrenRef.current;
      console.error("[ExplorerTree] sort worker error", {
        jobId: jobIdAtError,
        message: event.message,
        fileName: event.filename,
        line: event.lineno,
        column: event.colno,
      });
      // Apply fallback only when this is still the active job; ignore stale race.
      queueMicrotask(() => {
        if (jobIdAtError !== latestJobRef.current) return;
        setSortedChildren(fallbackChildren);
      });
    };
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Dispatch Sort Payload
  useEffect(() => {
    if (workerRef.current) {
      const jobId = `${projectId}-${treeVersion}-${sort}-${foldersFirst}`;
      latestJobRef.current = jobId;
      latestChildrenRef.current = childrenByParentId;
      workerRef.current.postMessage({
        jobId,
        nodesById,
        childrenByParentId,
        sort,
        foldersFirst,
      });
    }
  }, [projectId, treeVersion, nodesById, childrenByParentId, sort, foldersFirst]);

  const includeFileByMode = useMemo(() => {
    return (node: ProjectNode) => {
      if (node.type !== "file") return true;
      if (viewMode === "all") return true;
      if (viewMode === "assets") return isAssetLike(node);
      return isTextLike(node) || !isAssetLike(node);
    };
  }, [viewMode]);

  const visibleRows = useMemo(() => {
    return buildVisibleRows({
      projectId,
      treeVersion,
      mode: explorerMode,
      nodesById,
      childrenByParentId,
      loadedChildren,
      expandedFolderIds,
      folderMeta,
      sort,
      foldersFirst,
      viewMode,
      sortedChildrenByParentId: sortedChildren,
      includeNode: (n) => (n.type === "folder" ? true : includeFileByMode(n)),
    });
  }, [
    projectId,
    treeVersion,
    explorerMode,
    nodesById,
    childrenByParentId,
    loadedChildren,
    expandedFolderIds,
    folderMeta,
    sort,
    foldersFirst,
    viewMode,
    sortedChildren,
    includeFileByMode,
  ]);

  return { visibleRows, includeFileByMode };
}

// --- Rows-to-render resolver for all explorer modes ---

export function useRowsToRender(params: {
  effectiveMode: string;
  visibleRows: VisibleRow[];
  searchResults?: ProjectNode[];
  trashNodesState?: ProjectNode[];
  favorites?: Record<string, boolean>;
  recents?: string[];
  nodesById?: Record<string, ProjectNode>;
  includeFileByMode?: (node: ProjectNode) => boolean;
}) {
  return params.visibleRows;
}

// --- Main tree/grid rendering component ---

export function ExplorerTree({
  rowsToRender,
  contextValue,
  nodesById,
  childrenByParentId,
  effectiveSelectedNodeIds,
  selectedNodeId,
  viewMode,
  effectiveMode,
  isBooting,
  isTrashLoading,
  accessError,
  onSelect,
  onToggleFolder,
  onDropOnFolder,
}: {
  rowsToRender: VisibleRow[];
  contextValue: FileTreeItemContext;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  effectiveSelectedNodeIds: string[];
  selectedNodeId: string | null | undefined;
  viewMode: FilesViewMode;
  effectiveMode: string;
  isBooting: boolean;
  isTrashLoading: boolean;
  accessError: string | null;
  onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
  onToggleFolder: (node: ProjectNode) => void;
  onDropOnFolder?: (folderId: string, draggedId: string) => void;
}) {
  const safeRowsToRender = useMemo(
    () =>
      rowsToRender.filter(
        (row) => row.kind !== "node" || Boolean(contextValue.nodesById[row.nodeId]),
      ),
    [contextValue.nodesById, rowsToRender],
  );

  const firstNodeId = useMemo(() => {
    const first = safeRowsToRender.find((r) => r.kind === "node");
    return first && first.kind === "node" ? first.nodeId : undefined;
  }, [safeRowsToRender]);

  const treeContextValue = useMemo(
    () => ({
      ...contextValue,
      firstNodeId,
    }),
    [contextValue, firstNodeId],
  );


  if (accessError) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100">Files unavailable</div>
        <div className="mt-1">
          {accessError === "Forbidden"
            ? "You don't have permission to view this project's files."
            : accessError}
        </div>
      </div>
    );
  }

  if (isBooting || (effectiveMode === "trash" && isTrashLoading)) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading files tree"
        className="flex flex-col gap-1 p-2 animate-pulse"
      >
        <span className="sr-only">Loading files…</span>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-8 flex items-center gap-2 px-2 rounded"
            style={{ paddingLeft: `${8 + (i % 3) * 16}px` }}
          >
            <div className="size-4 rounded bg-muted/60 shrink-0" />
            <div
              className="h-3.5 rounded bg-muted/50"
              style={{ width: `${70 + ((i * 43) % 90)}px` }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (safeRowsToRender.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          role="status"
          className="nb-empty-state nb-grid-ground w-full max-w-sm p-8 text-center"
        >
          <div className="nb-empty-state-icon-box mb-3">
            <FolderPlus className="nb-empty-state-icon" />
          </div>
          <p className="nb-card-title text-foreground mb-1">
            {effectiveMode === "trash" ? "Trash is empty" : "No files yet"}
          </p>
          <p className="nb-compact text-muted-foreground">
            {effectiveMode === "trash"
              ? "Deleted files will appear here."
              : "Create a file or folder to get started."}
          </p>
        </div>
      </div>
    );
  }



  return (
    <div role="tree" aria-label="Files tree" className="h-full">
      <Virtuoso
        data={safeRowsToRender}
        context={treeContextValue}
        computeItemKey={(_, row) =>
          row.kind === "node"
            ? `${row.kind}:${row.nodeId}`
            : `${row.kind}:${"parentId" in row ? row.parentId : "root"}`
        }
        itemContent={(_, row, context) => (
          <div className="h-8 min-h-[32px] [@media(pointer:coarse)]:h-11 px-2" role="none">
            <FileTreeItem row={row} context={context} />
          </div>
        )}
        style={{ height: "100%" }}
      />
    </div>
  );
}
