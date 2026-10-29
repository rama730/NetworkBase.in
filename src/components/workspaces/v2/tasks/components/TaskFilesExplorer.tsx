"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { WorkspaceNode } from "@/lib/db/schema";
import { getWorkspaceNodes } from "@/app/actions/files/nodes";
import { updateTaskNodeLink } from "@/app/actions/files/links";
import {
  moveWorkspaceNodes,
} from "@/app/actions/files/mutations";
import { TaskFileRow } from "@/components/workspaces/v2/tasks/components/TaskFileRow";
import { toast, feedbackError } from "@/lib/feedback";
import { composeAnnotation } from "@/lib/workspaces/task-file-label";
import { TASK_WORKING_FILES_TITLE } from "@/lib/files/task-working-files";
import {
  inferTaskFileRole,
  replaceTaskFileRoleTag,
  type TaskFileRole,
} from "@/lib/workspaces/task-file-intelligence";

const MoveDialog = dynamic(() => import("@/components/workspaces/v2/explorer/ExplorerDialogsHost").then((mod) => mod.MoveDialog), { ssr: false });

type LinkedTaskNode = WorkspaceNode & {
  order?: number;
  annotation?: string | null;
  tags?: string[] | null;
};

interface TaskFilesExplorerProps {
  taskId: string;
  projectId: string;
  linkedNodes: LinkedTaskNode[];
  canEdit: boolean;
  canManageFiles?: boolean;
  onUnlink?: (nodeId: string) => void;
  onOpenFile?: (node: WorkspaceNode) => void;
  onShowHistory?: (node: WorkspaceNode) => void;
  onReplaceWithNewVersion?: (
    node: WorkspaceNode,
    file: File,
  ) => Promise<{ success: boolean; error?: string }> | void;
  highlightedNodeId?: string | null;
  onFilesChanged?: () => Promise<unknown> | void;
}

export function TaskFilesExplorer({
  taskId,
  projectId,
  linkedNodes,
  canEdit,
  canManageFiles = false,
  onUnlink,
  onOpenFile,
  onShowHistory,
  onReplaceWithNewVersion,
  highlightedNodeId = null,
  onFilesChanged,
}: TaskFilesExplorerProps) {
  // Simple local state for folder expansion and loaded children
  const [expandedFolderIds, setExpandedFolderIds] = useState<
    Record<string, boolean>
  >({});
  const [loadedChildren, setLoadedChildren] = useState<
    Record<string, WorkspaceNode[]>
  >({});
  const [childCursors, setChildCursors] = useState<Record<string, string | null>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>(
    {},
  );
  const [locationDialog, setLocationDialog] = useState<{
    open: boolean;
    nodes: WorkspaceNode[];
    targetFolderId: string | null;
    mode: "move" | "publish";
  }>({ open: false, nodes: [], targetFolderId: null, mode: "move" });

  const confirmLocationChange = useCallback(async () => {
    if (!locationDialog.nodes.length || !canManageFiles) return;
    const ids = locationDialog.nodes.map((node) => node.id);
    try {
      const result = locationDialog.mode === "publish"
        ? await moveWorkspaceNodes(ids, locationDialog.targetFolderId, projectId, { mode: "publish" })
        : await moveWorkspaceNodes(ids, locationDialog.targetFolderId, projectId);
      if (result.nodes.length > 0) {
        toast.success(
          locationDialog.mode === "publish"
            ? "Added to Files"
            : "Moved in Files",
        );
        await onFilesChanged?.();
      }
      setLocationDialog({ open: false, nodes: [], targetFolderId: null, mode: "move" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "File operation failed";
      toast.error(feedbackError(message, "Action couldn’t finish"));
      throw error;
    }
  }, [canManageFiles, locationDialog, onFilesChanged, projectId]);

  const handleToggle = useCallback(
    async (node: WorkspaceNode) => {
      if (node.type !== "folder") return;

      const isExpanded = !!expandedFolderIds[node.id];
      const nextExpanded = !isExpanded;
      setExpandedFolderIds((prev) => ({ ...prev, [node.id]: nextExpanded }));

      if (nextExpanded && !loadedChildren[node.id]) {
        setLoadingFolders((prev) => ({ ...prev, [node.id]: true }));
        try {
          const res = await getWorkspaceNodes(projectId, node.id, undefined, 100, undefined, { taskId });
          const nodes = res.nodes;
          setLoadedChildren((prev) => ({ ...prev, [node.id]: nodes }));
          setChildCursors((prev) => ({ ...prev, [node.id]: res.nextCursor }));
        } catch (e) {
          console.error("Failed to load folder children", e);
        } finally {
          setLoadingFolders((prev) => ({ ...prev, [node.id]: false }));
        }
      }
    },
    [expandedFolderIds, loadedChildren, projectId],
  );

  const loadMoreChildren = useCallback(async (folderId: string) => {
    const cursor = childCursors[folderId];
    if (!cursor || loadingFolders[folderId]) return;
    setLoadingFolders((prev) => ({ ...prev, [folderId]: true }));
    try {
      const res = await getWorkspaceNodes(projectId, folderId, undefined, 100, cursor, { taskId });
      setLoadedChildren((prev) => ({
        ...prev,
        [folderId]: [...(prev[folderId] ?? []), ...res.nodes],
      }));
      setChildCursors((prev) => ({ ...prev, [folderId]: res.nextCursor }));
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t load more files", "Couldn’t load more files"));
    } finally {
      setLoadingFolders((prev) => ({ ...prev, [folderId]: false }));
    }
  }, [childCursors, loadingFolders, projectId]);

  const handleAnnotationChange = useCallback(
    async (nodeId: string, val: string | null) => {
      const value = val ? val.trim() : null;
      try {
        await updateTaskNodeLink(taskId, nodeId, { annotation: value });
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Couldn’t save note";
        toast.error(feedbackError(message, "Action couldn’t finish"));
      }
    },
    [taskId],
  );

  const handleTagChange = useCallback(
    async (nodeId: string, newTags: string[]) => {
      try {
        await updateTaskNodeLink(taskId, nodeId, { tags: newTags });
        await onFilesChanged?.();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Couldn’t save tags";
        toast.error(feedbackError(message, "Action couldn’t finish"));
      }
    },
    [onFilesChanged, taskId],
  );

  const handleMoveToDeliverables = useCallback(
    (node: WorkspaceNode) => {
      void handleTagChange(
        node.id,
        replaceTaskFileRoleTag((node as LinkedTaskNode).tags, "deliverable"),
      );
    },
    [handleTagChange],
  );

  const handleMoveToWorkingFiles = useCallback(
    (node: WorkspaceNode) => {
      void handleTagChange(
        node.id,
        replaceTaskFileRoleTag((node as LinkedTaskNode).tags, "working"),
      );
    },
    [handleTagChange],
  );

  const handleMoveToReferences = useCallback(
    (node: WorkspaceNode) => {
      void handleTagChange(
        node.id,
        replaceTaskFileRoleTag((node as LinkedTaskNode).tags, "reference"),
      );
    },
    [handleTagChange],
  );

  const isDeliverableNode = (node: LinkedTaskNode) =>
    inferTaskFileRole(node) === "deliverable";

  const deliverableRoots = useMemo(() => {
    return linkedNodes
      .filter((n) => isDeliverableNode(n))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [linkedNodes]);

  const referenceRoots = useMemo(() => {
    return linkedNodes
      .filter((n) => inferTaskFileRole(n) === "reference")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [linkedNodes]);

  const workingRoots = useMemo(() => {
    return linkedNodes
      .filter((n) => inferTaskFileRole(n) === "working")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [linkedNodes]);

  const renderNodeList = (
    nodes: LinkedTaskNode[],
    level: number,
    role: TaskFileRole,
  ) => {
    return (
      <div className="flex flex-col gap-0.5">
        {nodes.map((node) => {
          const isExpanded = !!expandedFolderIds[node.id];
          const isLoading = !!loadingFolders[node.id];
          const children = loadedChildren[node.id] || [];

          return (
            <React.Fragment key={`${node.id}-${level}`}>
              <div style={{ paddingLeft: `${level * 20}px` }}>
                <TaskFileRow
                  node={node}
                  canEdit={canEdit}
                  canManageFiles={canManageFiles}
                  isExpanded={isExpanded}
                  onToggleExpanded={handleToggle}
                  onOpen={(n) => {
                    if (n.type === "folder") {
                      handleToggle(n);
                    } else {
                      onOpenFile?.(n);
                    }
                  }}
                  onShowHistory={
                    onShowHistory ? (n) => onShowHistory(n) : undefined
                  }
                  onUnlink={
                    level === 0 && onUnlink ? (n) => onUnlink(n.id) : undefined
                  }
                  onReplaceWithNewVersion={onReplaceWithNewVersion}
                  isDeliverable={role === "deliverable"}
                  fileRole={role}
                  onMoveToDeliverables={
                    level === 0 ? handleMoveToDeliverables : undefined
                  }
                  onMoveToWorkingFiles={
                    level === 0 ? handleMoveToWorkingFiles : undefined
                  }
                  onMoveToReferences={
                    level === 0 ? handleMoveToReferences : undefined
                  }
                  onLabelChange={(n, newLabel) => {
                    const nextAnnotation = composeAnnotation(
                      newLabel,
                      (n as any).annotation,
                    );
                    void handleAnnotationChange(n.id, nextAnnotation || "");
                  }}
                  onMoveInProjectFiles={(selectedNode) =>
                    setLocationDialog({
                      open: true,
                      nodes: [selectedNode],
                      targetFolderId: selectedNode.parentId ?? null,
                      mode: "move",
                    })
                  }
                  onPublishToProjectFiles={(selectedNode) =>
                    setLocationDialog({
                      open: true,
                      nodes: [selectedNode],
                      targetFolderId: null,
                      mode: "publish",
                    })
                  }
                  isHighlighted={node.id === highlightedNodeId}
                />
              </div>
              {isExpanded && isLoading && (
                <div
                  className="flex items-center gap-2 py-2 pl-8 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${16 + (level + 1) * 20}px` }}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </div>
              )}
              {isExpanded &&
                children.length > 0 &&
                renderNodeList(
                  children as LinkedTaskNode[],
                  level + 1,
                  role,
                )}
              {isExpanded && childCursors[node.id] && (
                <button
                  type="button"
                  onClick={() => void loadMoreChildren(node.id)}
                  className="ml-8 mt-1 text-xs font-medium text-primary hover:underline"
                  style={{ marginLeft: `${16 + (level + 1) * 20}px` }}
                >
                  Load more
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col space-y-8 pb-10">
      <div className="flex flex-col">
        <div className="mb-3 px-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-foreground">
            Task references
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Files supplied with the task brief or explicitly linked as context.
          </p>
        </div>
        <div data-testid="task-files-list-references" className="flex flex-col gap-2">
          {referenceRoots.length === 0 ? (
            <div className="rounded-[5px] border border-dashed border-border bg-card/60 nb-grid-ground py-6 text-center text-xs font-medium text-muted-foreground" role="status">
              No task references attached.
            </div>
          ) : (
            renderNodeList(referenceRoots, 0, "reference")
          )}
        </div>
      </div>

      {/* Deliverables Section */}
      <div className="flex flex-col">
        <div className="mb-3 px-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-foreground">
            Final files
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The finished output resolving this task.
          </p>
        </div>
        <div
          data-testid="task-files-list-deliverables"
          className="flex flex-col gap-2"
        >
          {deliverableRoots.length === 0 ? (
            <div className="rounded-[5px] border border-dashed border-border bg-card/60 nb-grid-ground py-6 text-center text-xs font-medium text-muted-foreground" role="status">
              No final files confirmed yet.
            </div>
          ) : (
            renderNodeList(deliverableRoots, 0, "deliverable")
          )}
        </div>
      </div>

      {/* Active task work */}
      <div className="flex flex-col">
        <div className="mb-3 px-2 mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-foreground">
            {TASK_WORKING_FILES_TITLE}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drafts and active assets used while completing this task.
          </p>
        </div>
        <div
          data-testid="task-files-list-working"
          className="flex flex-col gap-2"
        >
          {workingRoots.length === 0 ? (
            <div className="rounded-[5px] border border-dashed border-border bg-card/60 nb-grid-ground py-6 text-center text-xs font-medium text-muted-foreground" role="status">
              No draft files attached.
            </div>
          ) : (
            renderNodeList(workingRoots, 0, "working")
          )}
        </div>
      </div>
      <MoveDialog
        moveDialog={locationDialog}
        setMoveDialog={(next) =>
          setLocationDialog((current) => {
            const resolved = typeof next === "function" ? next(current) : next;
            return { ...resolved, mode: current.mode };
          })
        }
        confirmMove={confirmLocationChange}
        canEdit={canManageFiles}
        projectId={projectId}
        mode={locationDialog.mode}
      />
    </div>
  );
}
