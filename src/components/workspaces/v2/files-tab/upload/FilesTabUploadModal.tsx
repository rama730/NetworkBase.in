"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  FolderDown,
  FolderUp,
  Loader2,
  Pencil,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { toast } from "@/lib/feedback";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import type { TaskFileRole } from "@/lib/workspaces/task-file-intelligence";
import { useFilesStore } from "@/stores/filesStore";
import { formatBytes } from "../folder/format";
import { DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES } from "@/lib/files/upload-validator";

const FolderPicker = dynamic(() => import("@/components/workspaces/v2/explorer/ExplorerDialogsHost").then((mod) => mod.FolderPicker), { ssr: false });

export type FilesUploadIntent =
  | "project"
  | "reference"
  | "working"
  | "deliverable"
  | "version";

export interface FilesTabUploadConfirmResult {
  intent: FilesUploadIntent;
  targetFolderId: string | null;
  versionNodeId?: string;
  taskId?: string;
  label?: string;
  role?: TaskFileRole;
  files?: File[];
}

export interface FilesTabUploadModalProps {
  projectId: string;
  isOpen: boolean;
  files: File[];
  currentFolderId: string | null;
  currentFolderName?: string;
  existingFiles: ProjectNode[];
  activeTaskId?: string | null;
  activeTaskTitle?: string | null;
  isProcessing?: boolean;
  onConfirm: (result: FilesTabUploadConfirmResult) => void;
  onCancel: () => void;
}

interface SearchableTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  taskNumber: number | null;
  projectKey: string | null;
  assigneeName: string | null;
}

function renameFileObject(originalFile: File, nextName: string): File {
  const trimmed = nextName.trim();
  if (!trimmed) return originalFile;

  const dotIndex = originalFile.name.lastIndexOf(".");
  const originalExt = dotIndex > 0 ? originalFile.name.slice(dotIndex) : "";
  const finalName = originalExt && !trimmed.includes(".") ? `${trimmed}${originalExt}` : trimmed;

  try {
    const renamed = new File([originalFile], finalName, {
      type: originalFile.type,
      lastModified: originalFile.lastModified || Date.now(),
    });
    if (originalFile.webkitRelativePath) {
      const parts = originalFile.webkitRelativePath.split("/");
      parts[parts.length - 1] = finalName;
      try {
        Object.defineProperty(renamed, "webkitRelativePath", {
          value: parts.join("/"),
          configurable: true,
        });
      } catch {}
    }
    return renamed;
  } catch {
    return originalFile;
  }
}

export function FilesTabUploadModal({
  projectId,
  isOpen,
  files,
  currentFolderId,
  currentFolderName = "All files",
  existingFiles,
  activeTaskId = null,
  activeTaskTitle = null,
  isProcessing = false,
  onConfirm,
  onCancel,
}: FilesTabUploadModalProps) {
  const [fileList, setFileList] = useState<File[]>(files);
  const sizeFeedbackId = useRef<string | number | null>(null);
  const [isRenamingSingle, setIsRenamingSingle] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [editingMultiIndex, setEditingMultiIndex] = useState<number | null>(null);

  useEffect(() => {
    setFileList(files);
  }, [files]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, [isOpen]);

  const fileCount = fileList.length;
  const singleFile = fileCount === 1 ? fileList[0] : null;

  // Detect if any existing file matches the dropped file's name (case-insensitive)
  const matchingExistingFile = useMemo(() => {
    if (!singleFile) return null;
    const lowerName = singleFile.name.trim().toLowerCase();
    return (
      existingFiles.find(
        (node) => node.type === "file" && node.name.trim().toLowerCase() === lowerName,
      ) ?? null
    );
  }, [singleFile, existingFiles]);

  const versionCandidates = useMemo(
    () => existingFiles.filter((node) => node.type === "file"),
    [existingFiles],
  );

  const totalBytes = useMemo(
    () => fileList.reduce((acc, f) => acc + (f.size || 0), 0),
    [fileList],
  );

  const zeroByteFiles = useMemo(
    () => fileList.filter((f) => f.size === 0),
    [fileList],
  );

  const oversizedFiles = useMemo(
    () => fileList.filter((f) => (f.size || 0) > DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES),
    [fileList],
  );

  useEffect(() => {
    if (!isOpen || !oversizedFiles.length) {
      if (sizeFeedbackId.current !== null) toast.dismiss(sizeFeedbackId.current);
      sizeFeedbackId.current = null;
      return;
    }
    sizeFeedbackId.current = toast.warning("File too large", {
      id: sizeFeedbackId.current ?? undefined,
      dismissOnAction: false,
      description: `Upload limit: ${formatBytes(DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES)}.`,
      action: { label: "Choose file", onClick: () => {
        const input = document.createElement("input"); input.type = "file"; input.multiple = true;
        input.onchange = () => { if (input.files?.length) setFileList(Array.from(input.files)); };
        input.click();
      } },
    });
  }, [isOpen, oversizedFiles]);
  useEffect(() => () => { if (sizeFeedbackId.current !== null) toast.dismiss(sizeFeedbackId.current); }, []);

  // Categorization always requires an explicit choice for each upload.
  const [intent, setIntent] = useState<FilesUploadIntent | null>(null);

  const [expandedCard, setExpandedCard] = useState<"project" | "deliverable" | null>(null);

  const [destinationFolderId, setDestinationFolderId] = useState<string | null>(
    currentFolderId,
  );
  const [versionNodeId, setVersionNodeId] = useState<string>(
    matchingExistingFile ? matchingExistingFile.id : versionCandidates[0]?.id ?? "",
  );
  const [label, setLabel] = useState<string>("");

  // Task selection state
  const [selectedTaskId, setSelectedTaskId] = useState<string>(activeTaskId ?? "");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskResults, setTaskResults] = useState<SearchableTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  useEffect(() => {
    setIntent(null);
    setExpandedCard(null);
    setIsRenamingSingle(false);
    setEditingMultiIndex(null);
    setRenameValue("");
  }, [isOpen, files, projectId, currentFolderId, activeTaskId]);

  // Synchronize destination context without selecting a category.
  useEffect(() => {
    if (!isOpen) {
      setExpandedCard(null);
      return;
    }
    if (matchingExistingFile) {
      setVersionNodeId(matchingExistingFile.id);
    } else if (versionCandidates[0]) {
      setVersionNodeId(versionCandidates[0].id);
    }
    setDestinationFolderId(currentFolderId);
    if (activeTaskId) {
      setSelectedTaskId(activeTaskId);
    }
  }, [isOpen, matchingExistingFile, currentFolderId, activeTaskId, versionCandidates, fileList]);

  const destinationFolderName = useMemo(() => {
    if (destinationFolderId === null) {
      return "All files";
    }
    if (destinationFolderId === currentFolderId && currentFolderName) {
      return currentFolderName;
    }
    const cachedNode =
      existingFiles.find((f) => f.id === destinationFolderId) ??
      useFilesStore.getState().byProjectId[projectId]?.nodesById[destinationFolderId];
    return cachedNode?.name ?? currentFolderName ?? "Selected folder";
  }, [destinationFolderId, currentFolderId, currentFolderName, existingFiles, projectId]);

  // Query project tasks when task search query changes or when opening task intents
  useEffect(() => {
    if (!isOpen || activeTaskId) return;
    if (intent !== "reference" && intent !== "working" && intent !== "deliverable")
      return;

    let cancelled = false;
    setLoadingTasks(true);

    import("@/app/actions/files/links")
      .then(({ searchWorkspaceTasks }) =>
        searchWorkspaceTasks(projectId, taskQuery, 20),
      )
      .then((tasks) => {
        if (!cancelled) {
          setTaskResults(tasks);
          if (!selectedTaskId && tasks.length > 0 && tasks[0]) {
            setSelectedTaskId(tasks[0].id);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setTaskResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, taskQuery, intent, activeTaskId, selectedTaskId]);

  const displayName =
    fileCount === 1 && singleFile ? singleFile.name : `${fileCount} files`;

  const singleFileNameParts = useMemo(() => {
    if (fileCount !== 1 || !singleFile) return null;
    const name = singleFile.name;
    const dot = name.lastIndexOf(".");
    if (dot > 0 && dot < name.length - 1) {
      return { stem: name.slice(0, dot), ext: name.slice(dot) };
    }
    return { stem: name, ext: "" };
  }, [fileCount, singleFile]);

  const isTaskCategory =
    intent === "reference" || intent === "working" || intent === "deliverable";
  const isConfirmDisabled =
    isProcessing ||
    intent === null ||
    fileList.length === 0 ||
    oversizedFiles.length > 0 ||
    (intent === "version" && !versionNodeId) ||
    (isTaskCategory && !activeTaskId && !selectedTaskId);

  const applyRename = (index: number) => {
    const target = fileList[index];
    if (!target) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    if (trimmed === "." || trimmed === "..") {
      toast.error("Invalid file name");
      return;
    }
    if (trimmed.length > 255) {
      toast.error("File name is too long (maximum 255 characters)");
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      toast.error("File name cannot contain slashes");
      return;
    }
    const renamed = renameFileObject(target, trimmed);
    const next = [...fileList];
    next[index] = renamed;
    setFileList(next);
    setIsRenamingSingle(false);
    setEditingMultiIndex(null);
    toast.success(`Renamed to "${renamed.name}"`);
  };

  const applySingleRename = () => applyRename(0);
  const applyMultiRename = (index: number) => applyRename(index);

  const handleConfirm = () => {
    if (isConfirmDisabled || intent === null) return;

    let currentFiles = fileList;
    const activeIndex = singleFile && isRenamingSingle ? 0 : editingMultiIndex;
    if (activeIndex !== null && fileList[activeIndex] && renameValue.trim()) {
      const trimmed = renameValue.trim();
      if (
        !trimmed.includes("/") &&
        !trimmed.includes("\\") &&
        trimmed !== "." &&
        trimmed !== ".." &&
        trimmed.length <= 255 &&
        trimmed !== fileList[activeIndex].name
      ) {
        const renamed = renameFileObject(fileList[activeIndex], trimmed);
        currentFiles = [...fileList];
        currentFiles[activeIndex] = renamed;
        setFileList(currentFiles);
      }
    }

    if (intent === "version") {
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        versionNodeId: versionNodeId || matchingExistingFile?.id || undefined,
        files: currentFiles,
      });
    } else if (intent === "project") {
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        files: currentFiles,
      });
    } else {
      // Task categories (reference, working, deliverable)
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        taskId: activeTaskId || selectedTaskId || undefined,
        label: label.trim() || undefined,
        role: intent as TaskFileRole,
        files: currentFiles,
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onCancel()}>
      <DialogContent
        className="z-[300] sm:max-w-[460px] max-h-[90vh] overflow-y-auto rounded-[12px] border border-[#DBD5C8] bg-white p-6 shadow-2xl dark:border-border dark:bg-card"
        overlayClassName="z-[299] bg-transparent backdrop-blur-none"
        onEscapeKeyDown={(e) => {
          if (expandedCard !== null) {
            e.preventDefault();
            setExpandedCard(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && expandedCard !== null) {
            e.preventDefault();
            e.stopPropagation();
            setExpandedCard(null);
          }
        }}
      >
        <DialogHeader className="pr-10">
          <div className="flex flex-col gap-1">
            <DialogTitle className="flex items-baseline gap-1.5 min-w-0 text-base font-semibold">
              <span className="shrink-0">Upload</span>
              {singleFileNameParts ? (
                <span
                  className="inline-flex items-baseline min-w-0 font-mono text-sm"
                  title={singleFile?.name}
                >
                  <span className="truncate font-semibold">{singleFileNameParts.stem}</span>
                  {singleFileNameParts.ext && (
                    <span className="shrink-0 font-semibold">{singleFileNameParts.ext}</span>
                  )}
                </span>
              ) : (
                <span className="truncate text-base font-semibold">{displayName}</span>
              )}
              <span className="shrink-0 text-xs font-normal text-muted-foreground ml-0.5">
                ({formatBytes(totalBytes)})
              </span>
            </DialogTitle>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 min-w-0">
                <span>Destination:</span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted text-foreground font-mono truncate max-w-[200px]">
                  {destinationFolderName}
                </span>
              </div>
              {singleFile && !isRenamingSingle && (
                <button
                  type="button"
                  onClick={() => {
                    setRenameValue(singleFile.name);
                    setIsRenamingSingle(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                  aria-label="Rename file before upload"
                >
                  <Pencil className="size-3" />
                  <span>Rename</span>
                </button>
              )}
            </div>

            {/* Single-file Inline Rename Field */}
            {singleFile && isRenamingSingle && (
              <div className="mt-2 rounded-[8px] border border-border bg-muted/30 p-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="single-file-rename-input" className="text-[11px] font-medium text-foreground">
                    Rename file
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    Press Enter to save • Esc to cancel
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    id="single-file-rename-input"
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onFocus={(e) => {
                      const dot = e.currentTarget.value.lastIndexOf(".");
                      if (dot > 0) {
                        e.currentTarget.setSelectionRange(0, dot);
                      } else {
                        e.currentTarget.select();
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applySingleRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsRenamingSingle(false);
                      }
                    }}
                    placeholder="Enter file name…"
                    aria-label="File name"
                    className="h-8 flex-1 rounded-[5px] border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={applySingleRename}
                    disabled={!renameValue.trim() || renameValue.trim() === singleFile.name}
                    className="h-8 rounded-[5px] bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRenamingSingle(false)}
                    className="h-8 rounded-[5px] border border-border bg-background hover:bg-muted px-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <DialogDescription>
            {expandedCard === "project"
              ? "Select the destination folder for these workspace files."
              : expandedCard === "deliverable"
                ? "Select the destination folder for this final file."
                : "What are these files for?"}
          </DialogDescription>
        </DialogHeader>

        {oversizedFiles.length > 0 && <div className="space-y-2 border-t border-border pt-2" aria-label="Files that can’t be uploaded">
          {oversizedFiles.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-start gap-2 text-[12px] leading-4">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
            <div className="min-w-0 flex-1"><strong className="block break-all font-medium">{file.name}</strong><span className="text-muted-foreground">{formatBytes(file.size)} · Limit {formatBytes(DEFAULT_WORKSPACE_UPLOAD_MAX_FILE_BYTES)} · Not uploaded</span></div>
          </div>)}
        </div>}

        {/* Multi-file Removable Chip List */}
        {fileList.length > 1 && expandedCard === null && (
          <div className="flex flex-col gap-1.5 p-1.5 rounded-lg border border-border bg-muted/40 dark:border-border dark:bg-card/40">
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {fileList.map((file, idx) => (
                <span
                  key={`${file.name}-${file.size}-${idx}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-foreground shadow-2xs dark:border-border dark:bg-card dark:text-foreground"
                >
                  <span className="max-w-[130px] truncate font-medium">{file.name}</span>
                  <span className="text-[11px] text-muted-foreground">({formatBytes(file.size)})</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingMultiIndex(idx);
                      setRenameValue(file.name);
                    }}
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                    title={`Rename ${file.name}`}
                    aria-label={`Rename ${file.name}`}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editingMultiIndex === idx) setEditingMultiIndex(null);
                      const next = fileList.filter((_, i) => i !== idx);
                      setFileList(next);
                      if (next.length === 0) {
                        onCancel();
                      }
                    }}
                    className="text-muted-foreground hover:text-foreground cursor-pointer"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>

            {editingMultiIndex !== null && fileList[editingMultiIndex] && (
              <div className="flex items-center gap-1.5 pt-1 border-t border-border/60">
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onFocus={(e) => {
                    const dot = e.currentTarget.value.lastIndexOf(".");
                    if (dot > 0) {
                      e.currentTarget.setSelectionRange(0, dot);
                    } else {
                      e.currentTarget.select();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyMultiRename(editingMultiIndex);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingMultiIndex(null);
                    }
                  }}
                  placeholder="New file name…"
                  aria-label="New file name"
                  className="h-7 flex-1 rounded-[4px] border border-border bg-background px-2 text-xs font-mono text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => applyMultiRename(editingMultiIndex)}
                  disabled={!renameValue.trim() || renameValue.trim() === fileList[editingMultiIndex]?.name}
                  className="h-7 rounded-[4px] bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingMultiIndex(null)}
                  className="h-7 rounded-[4px] border border-border px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* 0-byte file warning */}
        {zeroByteFiles.length > 0 && expandedCard === null && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">0-byte file warning: </span>
              <span>
                {zeroByteFiles.length === 1
                  ? `"${zeroByteFiles[0]?.name ?? "File"}" is 0 bytes and may be empty.`
                  : `${zeroByteFiles.length} files are 0 bytes and may be empty.`}
              </span>
            </div>
          </div>
        )}

        {/* Existing file collision banner */}
        {matchingExistingFile && expandedCard === null && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">Matching file detected: </span>
              <span className="font-mono">{matchingExistingFile.name}</span>
              <p className="mt-0.5 text-amber-700/90 dark:text-amber-300/90">
                You can save this upload directly as a new version or choose to place it as a separate workspace file.
              </p>
            </div>
          </div>
        )}

        {/* ── View 1: Categories Overview (all items visible) ──────────── */}
        {expandedCard === null && (
          <div className="flex flex-col gap-2.5 py-2 animate-in fade-in-50 duration-150">
            {/* Option 1: Project Files */}
            <div
              className={cn(
                "flex flex-col rounded-[8px] border p-3 transition-colors cursor-pointer",
                intent === "project"
                  ? "border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/60 dark:bg-[#D14E24]/10"
                  : "border-[#DBD5C8] hover:border-[#B6C0C5] dark:border-white/10 dark:hover:border-white/20 bg-card",
              )}
              onClick={() => {
                setIntent("project");
                setExpandedCard("project");
              }}
            >
              <div className="flex w-full items-start gap-3 text-left">
                <FolderUp
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    intent === "project"
                      ? "text-[#D14E24]"
                      : "text-muted-foreground",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      All files
                    </div>
                    {intent === "project" && (
                      <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Place among existing files in {destinationFolderName}. Click to browse workspace tree.
                  </div>
                </div>
              </div>
            </div>

            {/* Option 2: Task Reference */}
            <div
              className={cn(
                "flex flex-col rounded-[8px] border p-3 transition-colors cursor-pointer",
                intent === "reference"
                  ? "border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/60 dark:bg-[#D14E24]/10"
                  : "border-[#DBD5C8] hover:border-[#B6C0C5] dark:border-white/10 dark:hover:border-white/20 bg-card",
              )}
              onClick={() => setIntent("reference")}
            >
              <div className="flex w-full items-start gap-3 text-left">
                <BookOpen
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    intent === "reference"
                      ? "text-[#D14E24]"
                      : "text-muted-foreground",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      Task reference
                    </div>
                    {intent === "reference" && (
                      <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    A brief, specification, example, or source file supplied as task input.
                  </div>
                </div>
              </div>
            </div>

            {/* Option 3: Working File */}
            <div
              className={cn(
                "flex flex-col rounded-[8px] border p-3 transition-colors cursor-pointer",
                intent === "working"
                  ? "border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/60 dark:bg-[#D14E24]/10"
                  : "border-[#DBD5C8] hover:border-[#B6C0C5] dark:border-white/10 dark:hover:border-white/20 bg-card",
              )}
              onClick={() => setIntent("working")}
            >
              <div className="flex w-full items-start gap-3 text-left">
                <FolderDown
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    intent === "working"
                      ? "text-[#D14E24]"
                      : "text-muted-foreground",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      Draft file
                    </div>
                    {intent === "working" && (
                      <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Active drafts and intermediate work produced while completing the task.
                  </div>
                </div>
              </div>

              {intent === "working" && (
                <div className="mt-3 pl-8">
                  <input
                    type="text"
                    placeholder="Optional description or tag…"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded-[5px] border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:border-foreground/40"
                  />
                </div>
              )}
            </div>

            {/* Option 4: Final Deliverable */}
            <div
              className={cn(
                "flex flex-col rounded-[8px] border p-3 transition-colors cursor-pointer",
                intent === "deliverable"
                  ? "border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/60 dark:bg-[#D14E24]/10"
                  : "border-[#DBD5C8] hover:border-[#B6C0C5] dark:border-white/10 dark:hover:border-white/20 bg-card",
              )}
              onClick={() => {
                setIntent("deliverable");
                setExpandedCard("deliverable");
              }}
            >
              <div className="flex w-full items-start gap-3 text-left">
                <FolderUp
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    intent === "deliverable"
                      ? "text-[#D14E24]"
                      : "text-muted-foreground",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-foreground">
                      Final file
                    </div>
                    {intent === "deliverable" && (
                      <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    The completed output of this task. Click to choose destination folder.
                  </div>
                </div>
              </div>
            </div>

            {/* Option 5: New Version of Existing File */}
            {singleFile && versionCandidates.length > 0 && (
              <div
                className={cn(
                  "flex flex-col rounded-[8px] border p-3 transition-colors cursor-pointer",
                  intent === "version"
                    ? "border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/60 dark:bg-[#D14E24]/10"
                    : "border-[#DBD5C8] hover:border-[#B6C0C5] dark:border-white/10 dark:hover:border-white/20 bg-card",
                )}
                onClick={() => {
                  setIntent("version");
                  if (!versionNodeId && versionCandidates[0]) {
                    setVersionNodeId(versionCandidates[0].id);
                  }
                }}
              >
                <div className="flex w-full items-start gap-3 text-left">
                  <RefreshCcw
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      intent === "version"
                        ? "text-[#D14E24]"
                        : "text-muted-foreground",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">
                        New version of a file
                      </div>
                      {intent === "version" && (
                        <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                          <Check className="size-2.5 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Add this upload to an existing file’s version history.
                    </div>
                  </div>
                </div>

                {intent === "version" && (
                  <div className="mt-3 pl-8">
                    <select
                      value={versionNodeId}
                      onChange={(e) => setVersionNodeId(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded-[5px] border border-border bg-background px-2.5 py-1 text-xs text-foreground"
                    >
                      {versionCandidates.map((cand) => (
                        <option key={cand.id} value={cand.id}>
                          {cand.name} (v{cand.currentVersion || 1})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Task Selector for reference and working task categories */}
            {(intent === "reference" || intent === "working") && (
              <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 dark:border-border dark:bg-card/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    Linked task
                  </span>
                  {activeTaskTitle && (
                    <span className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                      {activeTaskTitle}
                    </span>
                  )}
                </div>

                {!activeTaskId && (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search workspace tasks to link…"
                        value={taskQuery}
                        onChange={(e) => setTaskQuery(e.target.value)}
                        className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1 text-xs text-foreground"
                      />
                      {loadingTasks && (
                        <Loader2 className="absolute right-2.5 top-2 size-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {taskResults.length > 0 && (
                      <select
                        value={selectedTaskId}
                        onChange={(e) => setSelectedTaskId(e.target.value)}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground"
                      >
                        {taskResults.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.projectKey ? `${t.projectKey}-${t.taskNumber}: ` : ""}
                            {t.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── View 2: Project Files Full-Length Tree Card (bottom items disappear) ─ */}
        {expandedCard === "project" && (
          <div className="flex flex-col gap-2 py-2 animate-in fade-in-50 duration-150">
            {/* Single Back Button to restore all items */}
            <button
              type="button"
              onClick={() => setExpandedCard(null)}
              className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted transition-colors cursor-pointer group"
            >
              <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to categories</span>
            </button>

            {/* Full-length Project-Tree Card */}
            <div className="flex flex-col rounded-[8px] border border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/50 dark:bg-[#D14E24]/10 p-3.5">
              <div className="flex w-full items-center justify-between text-left mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderUp className="size-5 text-[#D14E24] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      All files
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      Destination folder: <span className="font-medium text-[#D14E24]">{destinationFolderName}</span>
                    </div>
                  </div>
                </div>
                <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white shrink-0">
                  <Check className="size-2.5" />
                </span>
              </div>

              {/* Full-length FolderPicker */}
              <div className="mt-1 h-[320px] overflow-y-auto rounded-[8px] border border-border bg-background dark:border-border dark:bg-card p-1.5 shadow-xs">
                <FolderPicker
                  projectId={projectId}
                  selectedFolderId={destinationFolderId}
                  onSelectFolder={(id) => setDestinationFolderId(id)}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── View 3: Final Deliverable Full-Length Tree Card (other items disappear) ─ */}
        {expandedCard === "deliverable" && (
          <div className="flex flex-col gap-2 py-2 animate-in fade-in-50 duration-150">
            {/* Single Back Button to restore all items */}
            <button
              type="button"
              onClick={() => setExpandedCard(null)}
              className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[5px] text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-muted transition-colors cursor-pointer group"
            >
              <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to categories</span>
            </button>

            {/* Full-length Final Deliverable Card */}
            <div className="flex flex-col rounded-[8px] border border-[#D14E24] bg-[#FCF0EA]/50 dark:border-[#D14E24]/50 dark:bg-[#D14E24]/10 p-3.5">
              <div className="flex w-full items-center justify-between text-left mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderUp className="size-5 text-[#D14E24] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      Final file
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      Destination folder: <span className="font-medium text-[#D14E24]">{destinationFolderName}</span>
                    </div>
                  </div>
                </div>
                <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white shrink-0">
                  <Check className="size-2.5" />
                </span>
              </div>

              {/* Task Selector inside Deliverable if needed */}
              {!activeTaskId && (
                <div className="mb-2 space-y-1.5">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search workspace task for this final file…"
                      value={taskQuery}
                      onChange={(e) => setTaskQuery(e.target.value)}
                      className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1 text-xs text-foreground"
                    />
                    {loadingTasks && (
                      <Loader2 className="absolute right-2.5 top-2 size-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {taskResults.length > 0 && (
                    <select
                      value={selectedTaskId}
                      onChange={(e) => setSelectedTaskId(e.target.value)}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground"
                    >
                      {taskResults.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.projectKey ? `${t.projectKey}-${t.taskNumber}: ` : ""}
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Full-length FolderPicker */}
              <div className="mt-1 h-[300px] overflow-y-auto rounded-md border border-border bg-background dark:border-border dark:bg-card p-1.5 shadow-xs">
                <FolderPicker
                  projectId={projectId}
                  selectedFolderId={destinationFolderId}
                  onSelectFolder={(id) => setDestinationFolderId(id)}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="bg-[#F3F0EA] dark:bg-white/5 border-t border-[#DBD5C8] dark:border-white/10 -mx-6 -mb-6 px-6 py-3 rounded-b-[12px] flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onCancel}
            className="nb-touch-target h-[34px] rounded-[5px] border border-border bg-background px-3.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isConfirmDisabled}
            onClick={handleConfirm}
            className="nb-touch-target flex h-[34px] items-center justify-center gap-1.5 rounded-[5px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isProcessing && <Loader2 className="size-3.5 animate-spin" />}
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
