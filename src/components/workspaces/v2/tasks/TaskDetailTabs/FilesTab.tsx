"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { toast, feedbackError } from "@/lib/feedback";
import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceNode } from "@/lib/db/schema";
import { TaskFilesExplorer } from "@/components/workspaces/v2/tasks/components/TaskFilesExplorer";
import { TaskFilesActionMenu } from "@/components/workspaces/v2/tasks/components/TaskFilesActionMenu";
import { SingleAttachmentPicker } from "@/components/workspaces/v2/files-tab/picker/SingleAttachmentPicker";
import { TaskFilesEmptyState } from "@/components/workspaces/v2/tasks/components/TaskFilesEmptyState";
import { FileVersionHistoryDrawer } from "@/components/workspaces/v2/tasks/components/FileVersionHistoryDrawer";
import { cn } from "@/lib/utils";
import type { TaskFileRole } from "@/lib/workspaces/task-file-intelligence";
import {
  extractFoldersFromDataTransfer,
  type DroppedFolder,
} from "@/lib/files/folder-drop";
import { validateUploadSelection } from "@/lib/files/upload-validator";
import { ROLE_WORDS, isOsJunk, pastedFiles, type DropRole } from "@/lib/files/drop-target";

interface FilesTabProps {
  projectId: string;
  projectSlug?: string;
  taskId: string;
  canEdit: boolean;
  canManageFiles?: boolean;
  attachments: (WorkspaceNode & { annotation?: string | null; tags?: string[] | null })[];
  isLoading: boolean;
  error: string | null;
  isUploading: boolean;
  onUploadFiles: (
    files: File[],
    options?: { annotation?: string; parentId?: string; role?: TaskFileRole },
  ) => Promise<{ success: boolean; error?: string }>;
  onUploadFolders?: (
    folders: DroppedFolder[],
    options?: { role?: TaskFileRole; parentId?: string | null },
  ) => Promise<{ success: boolean; error?: string }>;
  onUnlink: (nodeId: string) => Promise<{ success: boolean; error?: string }>;
  onSaveAsNewVersion?: (
    nodeId: string,
    file: File,
    options?: { comment?: string | null },
  ) => Promise<{ success: boolean; error?: string }>;
  initialFileId?: string | null;
  onFilesChanged?: () => Promise<unknown> | void;
}

export default function FilesTab({
  projectId,
  projectSlug,
  taskId,
  canEdit,
  canManageFiles = false,
  attachments,
  isLoading,
  error,
  isUploading,
  onUploadFiles,
  onUploadFolders,
  onUnlink,
  onSaveAsNewVersion,
  initialFileId = null,
  onFilesChanged,
}: FilesTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [historyNode, setHistoryNode] = useState<WorkspaceNode | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isProcessingDrop, setIsProcessingDrop] = useState(false);
  const [v3PickerOpen, setV3PickerOpen] = useState(false);
  const [hoverRole, setHoverRole] = useState<DropRole | null>(null);
  const dragCounterRef = useRef(0);

  // URL state routing for Universal Task File Preview (Ponytail Phase 4)
  const handleOpenFile = useCallback(
    async (node: WorkspaceNode) => {
      const routeProject =
        projectSlug || pathname?.match(/^\/(?:workspaces|projects)\/([^/]+)/)?.[1] || projectId;
      router.push(
        `/workspaces/${encodeURIComponent(routeProject)}?tab=files&fileId=${encodeURIComponent(node.id)}`,
      );
    },
    [pathname, projectId, projectSlug, router],
  );

  /**
   * Where you drop is what it means (CLI report §19.2): a band gives the role, anywhere else is a draft file. No
   * pop-up; a wrong role is one click on the file's role chip.
   */
  const uploadAs = useCallback(
    async (role: DropRole, files: File[], folders: DroppedFolder[] = []) => {
      if (!canEdit || (files.length === 0 && folders.length === 0)) return;
      setIsProcessingDrop(true);
      try {
        const annotation = role === "deliverable" ? "#deliverable" : undefined;
        const results: Array<{ success: boolean; error?: string }> = [];
        if (folders.length) {
          results.push(onUploadFolders
            ? await onUploadFolders(folders, { role })
            : await onUploadFiles(folders.flatMap((folder) => folder.files.map((entry) => entry.file)), { annotation, role }));
        }
        if (files.length) results.push(await onUploadFiles(files, { annotation, role }));
        const failed = results.find((result) => !result.success);
        if (failed) {
          toast.error(feedbackError(failed.error || "Couldn’t upload files", "Couldn’t upload files"));
          return;
        }
        const count = files.length + folders.reduce((n, f) => n + f.files.length, 0);
        toast.success(`Added ${count} file${count === 1 ? "" : "s"} to this task as ${ROLE_WORDS[role]}${count === 1 ? "" : "s"}`, {
          description: "Change a file’s role from its role chip.",
        });
      } catch {
        toast.error("Couldn’t upload files");
      } finally {
        setIsProcessingDrop(false);
      }
    },
    [canEdit, onUploadFiles, onUploadFolders],
  );

  // ⌘V / Ctrl+V with files or a screenshot while this panel is open: added as drafts (A10.4).
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (event: ClipboardEvent) => {
      // Only while this Files tab is the one showing.
      if (!document.querySelector<HTMLElement>('[data-testid="task-files-tab-body"]')?.checkVisibility?.()) return;
      const files = pastedFiles(event);
      if (!files) return;
      event.preventDefault();
      void uploadAs("working", files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [canEdit, uploadAs]);

  const handleDropZoneDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragCounterRef.current += 1;
      setIsDragActive(true);
    },
    [canEdit],
  );

  const handleDropZoneDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const band = (event.target as Element).closest?.("[data-drop-role]")?.getAttribute("data-drop-role") as DropRole | null;
      if (band !== hoverRole) setHoverRole(band);
    },
    [canEdit, hoverRole],
  );

  const handleDropZoneDragLeave = useCallback(() => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) { setIsDragActive(false); setHoverRole(null); }
  }, []);

  const handleDropZoneDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragActive(false);
      setHoverRole(null);
      const target = event.target as Element;
      const role = (target.closest?.("[data-drop-role]")?.getAttribute("data-drop-role") as DropRole | null) ?? "working";
      const versionOf = target.closest?.("[data-task-file-row][data-node-id]")?.getAttribute("data-node-id") ?? null;

      const dataTransfer = event.dataTransfer;
      void (async () => {
        setIsProcessingDrop(true);
        try {
          const extracted = await extractFoldersFromDataTransfer(dataTransfer);
          const loose = extracted.looseFiles.filter((f) => !isOsJunk(f.name));
          const files = loose.length || extracted.folders.length ? loose : Array.from(dataTransfer.files || []);
          // One file on a linked file's row: a new version of it.
          if (versionOf && onSaveAsNewVersion && files.length === 1 && extracted.folders.length === 0) {
            const res = await onSaveAsNewVersion(versionOf, files[0]!);
            if (res.success) toast.success(`Saved ${files[0]!.name} as a new version`);
            else toast.error(feedbackError(res.error || "Couldn’t save new version", "Couldn’t save new version"));
            return;
          }
          // Unreadable items are skipped and named, the rest upload (A10.5 item 3).
          if (extracted.unreadable.length > 0) {
            toast.warning(`${extracted.unreadable.length} item${extracted.unreadable.length === 1 ? "" : "s"} couldn’t be read and ${extracted.unreadable.length === 1 ? "was" : "were"} skipped`, {
              description: extracted.unreadable.slice(0, 5).join(", ") + (extracted.unreadable.length > 5 ? ` and ${extracted.unreadable.length - 5} more` : ""),
            });
          }
          await uploadAs(role, files, extracted.folders);
        } catch (error) {
          toast.error(
            feedbackError(error instanceof Error ? error.message : "Couldn’t read the dropped files", "Couldn’t read the dropped files"),
          );
        } finally {
          setIsProcessingDrop(false);
        }
      })();
    },
    [canEdit, onSaveAsNewVersion, uploadAs],
  );

  const hasAttachments = attachments.length > 0;

  useEffect(() => {
    if (!initialFileId || isLoading) return;
    document
      .querySelector<HTMLElement>(
        `[data-task-file-row][data-node-id="${CSS.escape(initialFileId)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }, [attachments, initialFileId, isLoading]);

  return (
    <div className="flex h-full w-full flex-col min-h-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Files
        </h2>
        <div className="shrink-0">
          <TaskFilesActionMenu
            canEdit={canEdit}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickExisting={() => setV3PickerOpen(true)}
            disabled={isUploading || isProcessingDrop}
            variant="primary"
          />
        </div>
      </div>

      <div
        data-testid="task-files-tab-body"
        data-loading={isLoading ? "true" : "false"}
        className={cn(
          "relative flex-1 overflow-y-auto px-4 py-4 min-h-0 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[180ms]",
          isDragActive && "nb-drop-over",
        )}
        data-drop-target=""
        onDragEnter={handleDropZoneDragEnter}
        onDragOver={handleDropZoneDragOver}
        onDragLeave={handleDropZoneDragLeave}
        onDrop={handleDropZoneDrop}
      >
        {isDragActive ? (
          <div className="pointer-events-none sticky top-0 z-20 -mx-1 mb-3 grid grid-cols-3 gap-2" aria-live="polite">
            {(["reference", "working", "deliverable"] as const).map((role) => (
              <div
                key={role}
                data-drop-role={role}
                className={cn(
                  "pointer-events-auto flex min-h-16 flex-col items-center justify-center rounded-[5px] border-2 border-dashed px-2 text-center text-[12px] font-medium transition-colors",
                  hoverRole === role || (!hoverRole && role === "working") ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground",
                )}
              >
                {role === "reference" ? "References" : role === "working" ? "Draft files" : "Final files"}
                <span className="nb-meta mt-0.5">{hoverRole === role || (!hoverRole && role === "working") ? `Add as ${ROLE_WORDS[role]}` : ""}</span>
              </div>
            ))}
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-2 py-1" role="status" aria-label="Loading files">
            <span className="sr-only">Loading files…</span>
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-[6px] border border-border/70 bg-card p-2.5"
                aria-hidden="true"
              >
                <Skeleton kind="tile" className="size-8 shrink-0 rounded-[4px]" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-1/3 rounded-xs" />
                  <Skeleton className="h-2.5 w-1/5 rounded-xs" />
                </div>
                <Skeleton className="size-6 shrink-0 rounded-[4px]" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            {error}
          </div>
        ) : !hasAttachments ? (
          <TaskFilesEmptyState
            isDragActive={isDragActive}
            canEdit={canEdit}
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickExisting={() => setV3PickerOpen(true)}
          />
        ) : (
          <div className="space-y-6">
            <TaskFilesExplorer
              taskId={taskId}
              projectId={projectId}
              linkedNodes={attachments}
              canEdit={canEdit}
              canManageFiles={canManageFiles}
              onUnlink={onUnlink}
              onOpenFile={handleOpenFile}
              onShowHistory={(node) => setHistoryNode(node)}
              onReplaceWithNewVersion={
                onSaveAsNewVersion
                  ? (node, file) => onSaveAsNewVersion(node.id, file)
                  : undefined
              }
              highlightedNodeId={initialFileId}
              onFilesChanged={onFilesChanged}
            />
          </div>
        )}

        {(isUploading || isProcessingDrop) ? (
          <div role="status" aria-live="polite" className="pointer-events-none sticky bottom-3 mx-auto flex w-fit items-center gap-2 rounded-[5px] border border-border bg-card px-3 py-1.5 font-mono text-xs font-medium text-foreground shadow-2xs">
            <PixelBeat className="text-primary" />
            {isUploading ? "Uploading task files…" : "Preparing files…"}
          </div>
        ) : null}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            const validation = validateUploadSelection(files, { isFolder: false });
            if (!validation.valid) {
              if (validation.error) toast.error(feedbackError(validation.error, "Action couldn’t finish"));
              e.target.value = "";
              return;
            }
            if (validation.files.length > 0) void uploadAs("working", validation.files);
            e.target.value = "";
          }}
        />
        <input
          type="file"
          ref={folderInputRef}
          className="hidden"
          multiple
          /* @ts-expect-error webkitdirectory is non-standard but widely supported */
          webkitdirectory=""
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            const validation = validateUploadSelection(files, { isFolder: true });
            if (!validation.valid) {
              if (validation.error) toast.error(feedbackError(validation.error, "Action couldn’t finish"));
              e.target.value = "";
              return;
            }
            const validFiles = validation.files;
            if (validFiles.length > 0) {
              const syntheticFolder: DroppedFolder = {
                name: validation.folderName || validFiles[0]?.webkitRelativePath.split("/")[0] || "Folder",
                files: validFiles.map((f) => ({
                  file: f,
                  relativePath: f.webkitRelativePath
                    .split("/")
                    .slice(1)
                    .join("/"),
                })),
              };
              void uploadAs("working", [], [syntheticFolder]);
            }
            e.target.value = "";
          }}
        />
      </div>

      <SingleAttachmentPicker
        projectId={projectId}
        taskId={taskId}
        isOpen={v3PickerOpen}
        onClose={() => setV3PickerOpen(false)}
        existingAttachments={attachments}
        onLinked={onFilesChanged}
      />

      {historyNode && (
        <FileVersionHistoryDrawer
          open={!!historyNode}
          onOpenChange={(open) => !open && setHistoryNode(null)}
          node={historyNode}
          projectId={projectId}
          canEdit={canEdit}
        />
      )}

    </div>
  );
}
