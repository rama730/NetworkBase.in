import { useCallback } from "react";
import { moveWorkspaceNodes } from "@/app/actions/files/mutations";
import type { ProjectNode } from "@/lib/db/schema";
import { getErrorMessage, type ExplorerOperation } from "./explorerTypes";

export function useExplorerDragDrop(options: {
  projectId: string;
  canEdit: boolean;
  canManageFiles?: boolean;
  nodesById: Record<string, ProjectNode>;
  storeSelectedNodeIds: string[];
  runUniqueMutation: <T>(key: string, fn: () => Promise<T>) => Promise<T | null>;
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  loadFolderContent: (parentId: string | null, mode: "refresh" | "append") => Promise<void>;
  toggleExpanded: (projectId: string, nodeId: string, expanded: boolean) => void;
  showToast: (msg: string, type: "success" | "error" | "info") => void;
  recordOperation: (op: Omit<ExplorerOperation, "id" | "at">) => void;
}) {
  const {
    projectId,
    canEdit,
    canManageFiles = canEdit,
    nodesById,
    storeSelectedNodeIds,
    runUniqueMutation,
    upsertNodes,
    loadFolderContent,
    toggleExpanded,
    showToast,
    recordOperation,
  } = options;

  const handleDropOnFolder = useCallback(
    async (folderId: string, draggedId: string) => {
      if (!canManageFiles) return;
      if (folderId === draggedId) return;

      let nodesToMove: string[] = [draggedId];
      if (storeSelectedNodeIds.includes(draggedId)) {
        nodesToMove = [...storeSelectedNodeIds];
      }

      nodesToMove = nodesToMove.filter((id) => id !== folderId);
      if (nodesToMove.length === 0) return;

      const sortedIds = [...nodesToMove].sort();
      const mutationKey = `drop-move:${projectId}:${folderId}:${sortedIds.join(",")}`;

      try {
        const result = await runUniqueMutation(mutationKey, async () => {
          const originalParents = new Map<string, string | null>();
          for (const id of nodesToMove) {
            originalParents.set(id, nodesById[id]?.parentId ?? null);
          }
          const staleParents = new Set<string | null>();
          for (const [id, oldParentId] of originalParents.entries()) {
            if (oldParentId !== folderId) staleParents.add(oldParentId);
          }

          const updatedNodes = (await moveWorkspaceNodes(
            sortedIds,
            folderId,
            projectId,
          )).nodes;
          if (updatedNodes.length > 0) upsertNodes(projectId, updatedNodes);

          if (updatedNodes.length > 0) {
            await Promise.all(
              Array.from(staleParents).map((pid) => loadFolderContent(pid, "refresh"))
            );
            await loadFolderContent(folderId, "refresh");
            toggleExpanded(projectId, folderId, true);
          }
          return { count: updatedNodes.length, originalParents };
        });

        if (!result || result.count === 0) return;
        recordOperation({
          label: `Moved ${result.count} item${result.count === 1 ? "" : "s"} to folder`,
          status: "success",
          undo: {
            label: "Undo",
            run: async () => {
              const groupedByParent: Record<string, string[]> = {};
              for (const [id, parentId] of result.originalParents.entries()) {
                const key = parentId ?? "__root__";
                if (!groupedByParent[key]) groupedByParent[key] = [];
                groupedByParent[key].push(id);
              }
              for (const [parentKey, ids] of Object.entries(groupedByParent)) {
                const pId = parentKey === "__root__" ? null : parentKey;
                if (ids.length > 0) {
                  const restored = (await moveWorkspaceNodes(ids, pId, projectId)).nodes;
                  if (restored.length > 0) upsertNodes(projectId, restored);
                  await loadFolderContent(pId, "refresh");
                }
              }
              await loadFolderContent(folderId, "refresh");
            },
          },
        });
      } catch (e: unknown) {
        showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      }
    },
    [
      canManageFiles,
      storeSelectedNodeIds,
      nodesById,
      projectId,
      runUniqueMutation,
      upsertNodes,
      loadFolderContent,
      toggleExpanded,
      showToast,
      recordOperation,
    ]
  );

  return { handleDropOnFolder };
}
