"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ProjectNode } from "@/lib/db/schema";
import {
  moveProjectNodes,
  bulkRestoreNodes,
  bulkTrashNodes,
  createFileNode,
  finalizeBatchUpload,
  createFolder,
  renameNode,
  bulkCreateFolderTree,
  getUploadCollisionSummary,
} from "@/app/actions/files/mutations";
import { getBatchUploadUrls, getUploadPresignedUrl } from "@/app/actions/upload";
import { filesParentKey, useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";
import { buildProjectFileKey } from "@/lib/storage/project-file-key";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import { FILES_RUNTIME_BUDGETS } from "@/lib/files/runtime-budgets";
import { planUploadCopyNames, selectUploadFiles } from "@/lib/files/upload-collisions";
import { validateUploadSelection } from "@/lib/files/upload-validator";
import { useUploadCollisionDecision } from "./useUploadCollisionDecision";
import { useFileTransfers } from "../files-tab/FileTransfers";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";

interface UseExplorerMutationsOptions {
  projectId: string;
  canEdit: boolean;
  canManageFiles?: boolean;
  selectedNode: ProjectNode | null;
  selectedFolderId: string | null | undefined;
  nodesById: Record<string, ProjectNode>;
  childrenByParentId: Record<string, string[]>;
  loadedChildren: Record<string, boolean>;
  storeSelectedNodeIds: string[];
  upsertNodes: (projectId: string, nodes: ProjectNode[]) => void;
  setChildren: (projectId: string, parentId: string | null, childIds: string[]) => void;
  toggleExpanded: (projectId: string, folderId: string, expanded?: boolean) => void;
  setSelectedNode: (projectId: string, nodeId: string, folderId: string | null) => void;
  setSelectedNodeIds: (projectId: string, nodeIds: string[]) => void;
  loadFolderContent: (parentId: string | null, mode?: "append" | "refresh") => Promise<void>;
  onOpenFile: (node: ProjectNode) => void;
  onNodeDeleted?: (nodeId: string) => void;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  recordOperation: (operation: Omit<ExplorerOperation, "id" | "at">) => void;
}

export function useExplorerMutations({
  projectId,
  canEdit,
  canManageFiles = canEdit,
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
  onOpenFile,
  onNodeDeleted,
  showToast,
  recordOperation,
}: UseExplorerMutationsOptions) {
  const { chooseUploadCollision, uploadCollisionDialog } = useUploadCollisionDecision();
  const transfers = useFileTransfers();
  const transferRef = useRef(transfers);
  transferRef.current = transfers;
  const [createDialog, setCreateDialog] = useState<
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
  >({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; nodes: ProjectNode[] }>({
    open: false,
    nodes: [],
  });
  const [moveDialog, setMoveDialog] = useState<{
    open: boolean;
    nodes: ProjectNode[];
    targetFolderId: string | null;
  }>({ open: false, nodes: [], targetFolderId: null });
  const [renameState, setRenameState] = useState<{
    nodeId: string | null;
    value: string;
    original: string;
  }>({ nodeId: null, value: "", original: "" });

  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const refreshAfterMutation = useCallback(async (parentId: string | null, mode: "append" | "refresh" = "refresh") => {
    await loadFolderContent(parentId, mode).catch(() => showToast("Change saved. Folder refresh failed; the list will retry automatically.", "warning"));
  }, [loadFolderContent, showToast]);
  const mutationInFlightKeysRef = useRef<Set<string>>(new Set());

  const runInMutationQueue = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = mutationQueueRef.current.then(fn, fn);
    mutationQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

  const runUniqueMutation = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
      if (mutationInFlightKeysRef.current.has(key)) return null;
      mutationInFlightKeysRef.current.add(key);
      try {
        return await runInMutationQueue(fn);
      } finally {
        mutationInFlightKeysRef.current.delete(key);
        window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
      }
    },
    [runInMutationQueue, projectId]
  );

  const uploadWithPresignedUrl = useCallback(
    async (key: string, file: Blob, contentType: string, sizeBytes: number) => {
      const presigned = await getUploadPresignedUrl(key, contentType, sizeBytes);
      if ("error" in presigned) {
        throw new Error(presigned.error || "Failed to prepare upload");
      }
      await uploadToSupabaseSignedUrl({
        bucket: "project-files",
        storagePath: presigned.storageKey,
        uploadToken: presigned.token,
        uploadUrl: presigned.url,
        contentType,
        operationId: presigned.uploadIntentId,
      }, file, { cacheProfile: "immutable" });
      return presigned;
    },
    []
  );

  const openCreate = useCallback(
    (kind: "file" | "folder") => {
      if (!canEdit) return;
      const parentId =
        selectedNode?.type === "folder"
          ? selectedNode.id
          : selectedNode?.parentId ?? selectedFolderId ?? null;
      setCreateDialog({ open: true, kind, parentId, name: "" });
    },
    [canEdit, selectedFolderId, selectedNode]
  );

  const openCreateInFolder = useCallback(
    (folderId: string | null, kind: "file" | "folder") => {
      if (!canEdit) return;
      if (folderId) {
        setSelectedNode(projectId, folderId, folderId);
        setSelectedNodeIds(projectId, [folderId]);
      }
      setCreateDialog({ open: true, kind, parentId: folderId, name: "" });
    },
    [canEdit, projectId, setSelectedNode, setSelectedNodeIds]
  );

  const confirmCreate = useCallback(async () => {
    if (!createDialog.open) return;
    const name = createDialog.name.trim();
    if (!name) return;
    if (!canEdit) return;

    const parentId = createDialog.parentId ?? null;
    const mutationKey = `create:${projectId}:${createDialog.kind}:${parentId ?? "root"}:${name.toLowerCase()}`;

    try {
      const createdNode = await runUniqueMutation(mutationKey, async () => {
        if (!loadedChildren[filesParentKey(parentId)]) {
          await loadFolderContent(parentId, "refresh");
        }
        const siblingIds = childrenByParentId[filesParentKey(parentId)] || [];
        const siblings = siblingIds.map((id) => nodesById[id]).filter(Boolean);
        const dup = siblings.some((s) => s?.name.toLowerCase() === name.toLowerCase());
        if (dup) throw new Error("A file/folder with that name already exists here.");

        if (createDialog.kind === "folder") {
          return (await createFolder(projectId, parentId, name)) as ProjectNode;
        }

        const fileExt = name.includes(".") ? name.split(".").pop() : "txt";
        const storagePath = buildProjectFileKey(projectId, `${Math.random().toString(36).substring(2)}.${fileExt}`);
        const emptyBlob = new Blob([""], { type: "text/plain" });
        const uploadSession = await uploadWithPresignedUrl(storagePath, emptyBlob, "text/plain", emptyBlob.size);

        return (await createFileNode(projectId, parentId, {
          name,
          s3Key: uploadSession.storageKey,
          size: 0,
          mimeType: "text/plain",
          uploadIntentId: uploadSession.uploadIntentId,
        })) as ProjectNode;
      });

      if (!createdNode) return;
      upsertNodes(projectId, [createdNode]);
      const parentKey = filesParentKey(parentId);
      const currentChildren = childrenByParentId[parentKey] || [];
      if (!currentChildren.includes(createdNode.id)) {
        setChildren(projectId, parentId, [...currentChildren, createdNode.id]);
      }

      if (parentId) toggleExpanded(projectId, parentId, true);
      // Creation undo could trash another collaborator's subsequent edits.
      // Use the normal, explicitly confirmed Trash action instead.
      showToast(`Created ${createDialog.kind} ${createdNode.name}`, "success");
      setCreateDialog({ open: false });
    } catch (e: unknown) {
      showToast(`Create failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: `Create failed (${createDialog.kind})`,
        status: "error",
      });
    }
  }, [
    canEdit,
    childrenByParentId,
    createDialog,
    loadedChildren,
    loadFolderContent,
    nodesById,
    projectId,
    recordOperation,
    runUniqueMutation,
    setChildren,
    showToast,
    toggleExpanded,
    uploadWithPresignedUrl,
    upsertNodes,
  ]);

const FALLBACK_EXT_MIME: Record<string, string> = {
  ts: "text/typescript",
  tsx: "text/typescript",
  js: "text/javascript",
  jsx: "text/javascript",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  sql: "text/x-sql",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  html: "text/html",
  css: "text/css",
};

function resolveFileMimeType(file: File): string {
  if (file.type && file.type.length > 0) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return FALLBACK_EXT_MIME[ext] || "application/octet-stream";
}

  // Picker and flat drag/drop uploads share collision, finalization, and retry behavior.
  const uploadFiles = useCallback(async (files: File[], parentId: string | null): Promise<ProjectNode[]> => {
    if (!canEdit || !files.length) return [];
    const validation = validateUploadSelection(files, { isFolder: false });
    if (!validation.valid) {
      showToast(validation.error || "Invalid file selection", "error");
      return [];
    }
    const validatedFiles = validation.files;
    const failed: File[] = [];
    const createdNodes: ProjectNode[] = [];
    const mutationKey = `upload:${projectId}:${parentId ?? "root"}:${validatedFiles.map(file => file.name).sort().join(",")}`;
    let progress: string | number | undefined;
    let transferId: string | undefined;
    try {
      const outcome = await runUniqueMutation(mutationKey, async () => {
        const collisions = await getUploadCollisionSummary(projectId, parentId, validatedFiles.map(file => file.name));
        const choice = await chooseUploadCollision(collisions, true);
        if (choice === "cancel") return null;
        let eligible = selectUploadFiles(validatedFiles, [...collisions.existingFiles, ...collisions.existingFolders]);
        if (choice === "keep_both") {
          const occupied = [...collisions.existingFiles, ...collisions.existingFolders];
          let names = planUploadCopyNames(validatedFiles.map(file => file.name), occupied);
          // Resolve suffix collisions against persisted names, not just cached rows.
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const conflicts = await getUploadCollisionSummary(projectId, parentId, names);
            if (!conflicts.existingFiles.length && !conflicts.existingFolders.length) break;
            occupied.push(...conflicts.existingFiles, ...conflicts.existingFolders);
            names = planUploadCopyNames(validatedFiles.map(file => file.name), occupied);
            if (attempt === 19) throw new Error("Too many matching names. Rename the files and try again.");
          }
          eligible = validatedFiles.map((file, index) => new File([file], names[index]!, { type: file.type, lastModified: file.lastModified }));
        }
        const skipped = validatedFiles.length - eligible.length;
        if (!eligible.length) return skipped;
        transferId = transferRef.current?.start(validatedFiles.length === 1 ? validatedFiles[0]!.name : `${validatedFiles.length} files`, eligible.length);
        progress = toast.loading(`Uploading 0 of ${eligible.length} files…`);
        let completed = 0;
        // The server accepts at most 50 intents per request so transfer and verification work stay bounded.
        for (let offset = 0; offset < eligible.length; offset += 16) {
          const plans = eligible.slice(offset, offset + 16).map(file => ({
            file, key: buildProjectFileKey(projectId, crypto.randomUUID()),
            contentType: resolveFileMimeType(file), sizeBytes: file.size,
          }));
          const batch = await getBatchUploadUrls(plans.map(({ key, contentType, sizeBytes }) => ({ key, contentType, sizeBytes })));
          if ("error" in batch) {
            failed.push(...plans.map(plan => plan.file));
            completed += plans.length;
            if (transferId) transferRef.current?.update(transferId, { completed, failed: failed.length });
            continue;
          }
          // Publish the verified files in the same bounded 50-item batch.
          const successfullyUploadedToS3: Array<{
            file: File;
            requestKey: string;
            storageKey: string;
            contentType: string;
          }> = [];

          await runWithConcurrency(plans, Math.max(1, FILES_RUNTIME_BUDGETS.saveAllConcurrency), async ({ file, key, contentType }) => {
            try {
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
              successfullyUploadedToS3.push({ file, requestKey: key, storageKey, contentType });
            } catch {
              failed.push(file);
            } finally {
              completed += 1;
              if (transferId) transferRef.current?.update(transferId, { completed, failed: failed.length });
              toast.loading(`Uploading ${completed} of ${eligible.length} files…`, { id: progress });
            }
          });

          if (successfullyUploadedToS3.length > 0) {
            try {
              const batchNodes = await finalizeBatchUpload(
                projectId,
                parentId,
                successfullyUploadedToS3.map(({ file, requestKey, storageKey, contentType }) => ({
                  name: file.name,
                  s3Key: storageKey,
                  size: file.size,
                  mimeType: contentType,
                  uploadIntentId: batch.uploadIntentIds?.[requestKey] ?? undefined,
                }))
              );
              createdNodes.push(...(batchNodes as ProjectNode[]));
            } catch {
              // Resilient fallback to individual commits if batch call encounters an error
              for (const { file, requestKey, storageKey, contentType } of successfullyUploadedToS3) {
                try {
                  const node = await createFileNode(projectId, parentId, {
                    name: file.name,
                    s3Key: storageKey,
                    size: file.size,
                    mimeType: contentType,
                    uploadIntentId: batch.uploadIntentIds?.[requestKey] ?? undefined,
                  });
                  createdNodes.push(node as ProjectNode);
                } catch {
                  failed.push(file);
                }
              }
            }
          }
        }
        return skipped;
      });
      if (outcome === null) return [];
      if (createdNodes.length) {
        upsertNodes(projectId, createdNodes);
        const current = useFilesWorkspaceStore.getState().byProjectId[projectId]?.childrenByParentId[filesParentKey(parentId)] ?? [];
        setChildren(projectId, parentId, [...new Set([...current, ...createdNodes.map(node => node.id)])]);
        if (parentId) toggleExpanded(projectId, parentId, true);
        void loadFolderContent(parentId, "refresh").catch(() => showToast("Files uploaded. Folder refresh failed; the list will retry automatically.", "warning"));
        window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
      }
      if (progress !== undefined) toast.dismiss(progress);
      if (transferId) transferRef.current?.update(transferId, { status: failed.length ? "error" : "done", retry: failed.length ? () => void uploadFiles(failed, parentId) : undefined, error: failed.length ? failed.map(file => file.name).join(", ") : undefined });
      if (failed.length) {
        toast.error(`${createdNodes.length} uploaded; ${failed.length} need retry`, {
          description: failed.map(file => file.name).join(", ").slice(0, 300),
          duration: Infinity,
          action: { label: "Retry failed", onClick: () => void uploadFiles(failed, parentId) },
        });
      } else {
        showToast(`${createdNodes.length} file(s) uploaded${outcome ? `; ${outcome} existing or duplicate files skipped` : ""}`, createdNodes.length ? "success" : "info");
      }
      recordOperation({ label: `Uploaded ${createdNodes.length} file(s), ${failed.length} need retry`, status: failed.length ? "error" : "success" });
      if (files.length === 1 && createdNodes.length === 1) onOpenFile(createdNodes[0]!);
    } catch (error) {
      if (progress !== undefined) toast.dismiss(progress);
      if (transferId) transferRef.current?.update(transferId, { status: "error", error: getErrorMessage(error, "Upload interrupted"), retry: () => void uploadFiles(files, parentId) });
      // Retry checks collisions again, so a lost response cannot duplicate a committed file.
      toast.error(`Upload interrupted: ${getErrorMessage(error, "Please retry")}`, {
        duration: Infinity, action: { label: "Retry", onClick: () => void uploadFiles(files, parentId) },
      });
    } finally {
      if (progress !== undefined) toast.dismiss(progress);
    }
    return createdNodes;
  }, [canEdit, projectId, runUniqueMutation, upsertNodes, setChildren, toggleExpanded, loadFolderContent, showToast, recordOperation, onOpenFile, chooseUploadCollision]);

  const openUpload = useCallback((parentId: string | null) => {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const rawFiles = Array.from(input.files || []);
      const validation = validateUploadSelection(rawFiles, { isFolder: false });
      if (!validation.valid) {
        showToast(validation.error || "Invalid file selection", "error");
        return;
      }
      void uploadFiles(validation.files, parentId);
    };
    input.click();
  }, [canEdit, showToast, uploadFiles]);


  const openRename = useCallback(
    (node: ProjectNode) => {
      if (!canEdit) return;
      setRenameState({ nodeId: node.id, value: node.name, original: node.name });
    },
    [canEdit]
  );

  const confirmRename = useCallback(async () => {
    if (!renameState.nodeId) return;
    if (!canEdit) return;
    const node = nodesById[renameState.nodeId];
    if (!node) {
      setRenameState({ nodeId: null, value: "", original: "" });
      return;
    }

    const nextName = renameState.value.trim();
    if (!nextName) {
      showToast("Name is required", "error");
      return;
    }
    if (nextName === renameState.original) {
      setRenameState({ nodeId: null, value: "", original: "" });
      return;
    }

    const siblingIds = childrenByParentId[filesParentKey(node.parentId ?? null)] || [];
    const duplicateSibling = siblingIds
      .map((id) => nodesById[id])
      .filter(Boolean)
      .some((s) => s?.id !== node.id && s?.name.toLowerCase() === nextName.toLowerCase());
    if (duplicateSibling) {
      showToast("A file/folder with that name already exists here.", "error");
      return;
    }

    const mutationKey = `rename:${projectId}:${node.id}:${nextName.toLowerCase()}`;
    try {
      const updated = await runUniqueMutation(mutationKey, async () => {
        return (await renameNode(node.id, nextName, projectId)) as ProjectNode;
      });
      if (!updated) return;
      upsertNodes(projectId, [updated]);
      setRenameState({ nodeId: null, value: "", original: "" });
      recordOperation({
        label: `Renamed ${renameState.original} -> ${nextName}`,
        status: "success",
        undo: {
          label: "Undo",
          run: async () => {
            const reverted = (await renameNode(node.id, renameState.original, projectId, new Date(updated.updatedAt).toISOString())) as ProjectNode;
            upsertNodes(projectId, [reverted]);
          },
        },
      });
    } catch (e: unknown) {
      showToast(`Rename failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({
        label: `Rename failed (${renameState.original})`,
        status: "error",
      });
    }
  }, [
    canEdit,
    childrenByParentId,
    nodesById,
    projectId,
    recordOperation,
    renameState,
    runUniqueMutation,
    showToast,
    upsertNodes,
  ]);

  const resolveActionNodes = useCallback(
    (node: ProjectNode) => {
      const currentSelected = useFilesWorkspaceStore.getState().byProjectId[projectId]?.selectedNodeIds || [];
      if (currentSelected.length > 1 && currentSelected.includes(node.id)) {
        return currentSelected.map((id) => nodesById[id]).filter(Boolean) as ProjectNode[];
      }
      return [node];
    },
    [nodesById, projectId]
  );

  const openDelete = useCallback(
    (nodeOrNodes: ProjectNode | ProjectNode[]) => {
      if (!canEdit) return;
      const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
      setDeleteDialog({ open: true, nodes });
    },
    [canEdit]
  );

  const openMove = useCallback(
    (nodeOrNodes: ProjectNode | ProjectNode[]) => {
      if (!canManageFiles) return;
      const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
      setMoveDialog({ open: true, nodes, targetFolderId: null });
    },
    [canManageFiles]
  );

  const confirmMove = useCallback(async () => {
    const nodes = moveDialog.nodes;
    if (!nodes.length || !canManageFiles) return;

    const target = moveDialog.targetFolderId;

    const nodeIds = nodes.map((n) => n.id).sort();
    const originalParentByNode = new Map<string, string | null>(
      nodes.map((node) => [node.id, node.parentId ?? null])
    );
    const mutationKey = `move:${projectId}:${target ?? "root"}:${nodeIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const node of nodes) {
          const oldParentId = node.parentId ?? null;
          if (oldParentId !== target) staleParents.add(oldParentId);
        }

        const moveResult = await moveProjectNodes(nodeIds, target, projectId);
        const updatedNodes = moveResult.nodes;
        if (updatedNodes.length > 0) upsertNodes(projectId, updatedNodes);

        await Promise.all(Array.from(staleParents).map((pid) => refreshAfterMutation(pid, "refresh")));
        await refreshAfterMutation(target ?? null, "refresh");
        if (target) toggleExpanded(projectId, target, true);
        return updatedNodes;
      });

      if (result === null) return;
      const movedCount = result.length;
      recordOperation({
        label: `Moved ${movedCount} item${movedCount === 1 ? "" : "s"}`,
        status: "success",
        undo: movedCount
          ? {
            label: "Undo",
            run: async () => {
              const groupedByParent: Record<string, string[]> = {};
              for (const [id, parentId] of originalParentByNode.entries()) {
                const key = parentId ?? "__root__";
                if (!groupedByParent[key]) groupedByParent[key] = [];
                groupedByParent[key].push(id);
              }
              for (const [parentKey, ids] of Object.entries(groupedByParent)) {
                const parentId = parentKey === "__root__" ? null : parentKey;
                if (ids.length > 0) {
                  await moveProjectNodes(ids, parentId, projectId, {
                    expectedParentByNode: Object.fromEntries(ids.map((id) => [id, target])),
                  });
                  await refreshAfterMutation(parentId, "refresh");
                }
              }
              if (target !== null) await refreshAfterMutation(target, "refresh");
              else await refreshAfterMutation(null, "refresh");
            },
          }
          : undefined,
      });
      setMoveDialog({ open: false, nodes: [], targetFolderId: null });
    } catch (e: unknown) {
      showToast(`Move failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({ label: "Move failed", status: "error" });
      throw e;
    }
  }, [canManageFiles, refreshAfterMutation, moveDialog, projectId, recordOperation, runUniqueMutation, showToast, toggleExpanded, upsertNodes]);

  const confirmDelete = useCallback(async () => {
    const nodes = deleteDialog.nodes;
    if (!nodes.length || !canEdit) return;

    const nodeIds = nodes.map((n) => n.id).sort();
    const mutationKey = `trash:${projectId}:${nodeIds.join(",")}`;

    try {
      const result = await runUniqueMutation(mutationKey, async () => {
        const staleParents = new Set<string | null>();
        for (const node of nodes) staleParents.add(node.parentId ?? null);

        const response = await bulkTrashNodes(nodeIds, projectId);
        const trashedIds: string[] = response.trashedIds || [];

        for (const nodeId of trashedIds) {
          useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, nodeId, { keepFavorite: true });
          onNodeDeleted?.(nodeId);
        }

        await Promise.all(Array.from(staleParents).map((pid) => refreshAfterMutation(pid, "refresh")));
        return response;
      });

      if (result === null) return;
      recordOperation({
        label: `Moved ${result.trashedIds.length} item${result.trashedIds.length === 1 ? "" : "s"} to trash`,
        status: "success",
        undo: result.selectedTrashedIds.length
          ? {
            label: "Undo",
            run: async () => {
              await bulkRestoreNodes(result.selectedTrashedIds, projectId, result.deletedAt);
              const staleParents = new Set<string | null>();
              for (const node of nodes) staleParents.add(node.parentId ?? null);
              await Promise.all(
                Array.from(staleParents).map((pid) => refreshAfterMutation(pid, "refresh"))
              );
            },
          }
          : undefined,
      });
      setDeleteDialog({ open: false, nodes: [] });
    } catch (e: unknown) {
      showToast(`Delete failed: ${getErrorMessage(e, "Unknown error")}`, "error");
      recordOperation({ label: "Move to trash failed", status: "error" });
    }
  }, [canEdit, deleteDialog.nodes, refreshAfterMutation, onNodeDeleted, projectId, recordOperation, runUniqueMutation, showToast]);

  const handleMoveFromMenu = useCallback(
    (node: ProjectNode) => {
      openMove(resolveActionNodes(node));
    },
    [openMove, resolveActionNodes]
  );

  const handleDeleteFromMenu = useCallback(
    (node: ProjectNode) => {
      openDelete(resolveActionNodes(node));
    },
    [openDelete, resolveActionNodes]
  );

  const handleUploadToFolder = useCallback(
    (folderId: string | null) => {
      if (!canEdit) return;
      openUpload(folderId);
    },
    [canEdit, openUpload]
  );

  const handleDownloadFolder = useCallback(
    async (folderId: string | null) => {
      const folderName = folderId ? nodesById[folderId]?.name : "Project Files";
      const params = new URLSearchParams({ name: folderName || "Project Files" });
      if (folderId) params.set("folderId", folderId);
      const anchor = document.createElement("a");
      anchor.href = `/api/v1/projects/${projectId}/files/export?${params.toString()}`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showToast("Secure folder export started", "success");
    },
    [nodesById, projectId, showToast]
  );

  // Direct file upload (for desktop drag-and-drop — no picker dialog)
  const uploadFilesDirectly = useCallback(
    async (files: File[], parentId: string | null): Promise<ProjectNode[]> => {
      if (!canEdit || files.length === 0) return [];
      const validation = validateUploadSelection(files, { isFolder: true });
      if (!validation.valid) {
        showToast(validation.error || "Invalid folder selection", "error");
        return [];
      }
      const validatedFiles = validation.files;
      if (!validatedFiles.some(file => file.webkitRelativePath?.includes("/"))) return (await uploadFiles(validatedFiles, parentId)) || [];

      const mutationKey = `upload-direct:${projectId}:${parentId ?? "root"}:${validatedFiles
        .map((f) => f.name)
        .sort()
        .join(",")}`;
      let transferId: string | undefined;
      const mappedFiles: { path: string; parentId: string | null; requestKey: string; name: string }[] = [];
      try {
        await runUniqueMutation(mutationKey, async () => {
          const payloadNodes = validatedFiles
            .map((f) => ({
              path: f.webkitRelativePath || f.name,
              name: f.name,
              size: f.size,
              mimeType: resolveFileMimeType(f),
            }))
            .filter((node) => {
              if (node.name === ".DS_Store" || node.path.includes("__MACOSX") || node.path.includes("/.git/")) return false;
              return true;
            });

          if (payloadNodes.length === 0) return;

          const collisions = await getUploadCollisionSummary(
            projectId,
            parentId,
            payloadNodes.map((node) => node.path),
          );
          if (await chooseUploadCollision(collisions) === "cancel") {
            showToast("Upload cancelled", "info");
            return;
          }
          const existingFiles = new Set(collisions.existingFiles);
          const uploadPayloadNodes = payloadNodes.filter(
            (node) => !existingFiles.has(node.path),
          );
          if (uploadPayloadNodes.length === 0) {
            showToast("All selected files already exist and were skipped", "info");
            return;
          }

          transferId = transferRef.current?.start(`Folder upload · ${uploadPayloadNodes.length} files`, uploadPayloadNodes.length);
          const CHUNK_SIZE = 2000;
          for (let i = 0; i < uploadPayloadNodes.length; i += CHUNK_SIZE) {
            const chunk = uploadPayloadNodes.slice(i, i + CHUNK_SIZE);
            const mappedChunk = await bulkCreateFolderTree(projectId, parentId, chunk);
            if (mappedChunk) {
              mappedFiles.push(...mappedChunk);
            }
          }
          if (mappedFiles.length === 0) {
            if (transferId) transferRef.current?.update(transferId, { status: "done", total: 0, completed: 0 });
            showToast("No new files to upload; existing files were kept", "info");
            return;
          }

          const mappingByPath = new Map(mappedFiles.map((entry) => [entry.path, entry]));
          const uploadNodes = validatedFiles
            .map((file) => {
              const mapping = mappingByPath.get(file.webkitRelativePath || file.name);
              if (!mapping) return null;
              return { file, ...mapping };
            })
            .filter((item): item is {
              file: File;
              path: string;
              parentId: string | null;
              requestKey: string;
              name: string;
            } => item !== null);

          if (uploadNodes.length === 0) throw new Error("Could not match the selected files to their upload destinations");
          if (transferId) transferRef.current?.update(transferId, { total: uploadNodes.length });
          const uploaded: Array<{
            file: File;
            parentId: string | null;
            requestKey: string;
            storageKey: string;
            uploadIntentId: string;
          }> = [];
          const failed: File[] = [];
          let completed = 0;

          showToast(`Uploading ${uploadNodes.length} file(s)...`, "info");
          for (let offset = 0; offset < uploadNodes.length; offset += 16) {
            const chunk = uploadNodes.slice(offset, offset + 16);
            const batch = await getBatchUploadUrls(chunk.map((entry) => ({
              key: entry.requestKey,
              contentType: resolveFileMimeType(entry.file),
              sizeBytes: entry.file.size,
            })));
            if ("error" in batch) throw new Error(batch.error || "Failed to prepare upload URLs");

            await runWithConcurrency(chunk, 4, async (entry) => {
              try {
                const url = batch.urls[entry.requestKey];
                const uploadToken = batch.uploadTokens[entry.requestKey];
                const storageKey = batch.storageKeys[entry.requestKey];
                const uploadIntentId = batch.uploadIntentIds[entry.requestKey];
                const contentType = resolveFileMimeType(entry.file);
                if (!url || !uploadToken || !storageKey || !uploadIntentId) throw new Error("Upload allocation is incomplete");
                await uploadToSupabaseSignedUrl({
                  bucket: "project-files",
                  storagePath: storageKey,
                  uploadToken,
                  uploadUrl: url,
                  contentType,
                  operationId: uploadIntentId,
                }, entry.file, { cacheProfile: "immutable" });
                uploaded.push({
                  file: entry.file,
                  parentId: entry.parentId,
                  requestKey: entry.requestKey,
                  storageKey,
                  uploadIntentId,
                });
              } catch {
                failed.push(entry.file);
              } finally {
                completed += 1;
                if (transferId) transferRef.current?.update(transferId, { completed, failed: failed.length });
              }
            });
          }

          const uploadedByParent = new Map<string, typeof uploaded>();
          for (const entry of uploaded) {
            const key = entry.parentId ?? "root";
            const group = uploadedByParent.get(key) ?? [];
            group.push(entry);
            uploadedByParent.set(key, group);
          }
          let publishedCount = 0;
          for (const entries of uploadedByParent.values()) {
            for (let offset = 0; offset < entries.length; offset += 50) {
              const chunk = entries.slice(offset, offset + 50);
              const published = await finalizeBatchUpload(projectId, chunk[0]!.parentId, chunk.map((entry) => ({
                name: entry.file.name,
                s3Key: entry.storageKey,
                size: entry.file.size,
                mimeType: resolveFileMimeType(entry.file),
                uploadIntentId: entry.uploadIntentId,
              })));
              publishedCount += published.length;
            }
          }

          if (failed.length > 0) {
            if (transferId) transferRef.current?.update(transferId, {
              status: "error",
              failed: failed.length,
              completed,
              error: "Some files need retry",
              retry: () => void uploadFilesDirectly(failed, parentId),
            });
            showToast(`Published ${publishedCount}; ${failed.length} need retry.`, "warning");
            recordOperation({ label: `Partial upload: ${failed.length} failed`, status: "error" });
          } else {
            if (transferId) transferRef.current?.update(transferId, { status: "done", completed, failed: 0 });
            showToast(`Successfully uploaded ${publishedCount} file(s).`, "success");
            recordOperation({ label: `Uploaded ${publishedCount} file(s)`, status: "success" });
          }

          await loadFolderContent(parentId, "refresh");
          if (parentId) toggleExpanded(projectId, parentId, true);
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
        });
      } catch (e: unknown) {
        if (transferId) transferRef.current?.update(transferId, { status: "error", error: getErrorMessage(e, "Upload failed"), retry: () => void uploadFilesDirectly(validatedFiles, parentId) });
        showToast(`Upload failed: ${getErrorMessage(e, "Unknown error")}`, "error");
        recordOperation({ label: "Upload failed", status: "error" });
      }
      return [];
    },
    [
      canEdit,
      projectId,
      runUniqueMutation,
      showToast,
      recordOperation,
      loadFolderContent,
      toggleExpanded,
      uploadFiles,
      chooseUploadCollision,
    ]
  );

  const openFolderUpload = useCallback((parentId: string | null) => {
    if (!canEdit) return;
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = () => {
      const rawFiles = Array.from(input.files || []);
      const validation = validateUploadSelection(rawFiles, { isFolder: true });
      if (!validation.valid) {
        showToast(validation.error || "Invalid folder selection", "error");
        return;
      }
      void uploadFilesDirectly(validation.files, parentId);
    };
    input.click();
  }, [canEdit, showToast, uploadFilesDirectly]);

  return {
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
    openUpload,
    openFolderUpload,
    openRename,
    confirmRename,
    resolveActionNodes,
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
  };
}
