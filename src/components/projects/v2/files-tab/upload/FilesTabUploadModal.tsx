"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  FolderDown,
  FolderUp,
  Loader2,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";

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
import type { TaskFileRole } from "@/lib/projects/task-file-intelligence";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";

const FolderPicker = dynamic(() => import("@/components/projects/v2/explorer/ExplorerDialogsHost").then((mod) => mod.FolderPicker), { ssr: false });

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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function computeInitialIntent(
  files: File[],
  hasMatch: boolean,
  activeTaskId: string | null,
): FilesUploadIntent {
  if (hasMatch && files.length === 1) return "version";
  if (activeTaskId) return "deliverable";
  const lowerNames = files.map((f) => f.name.toLowerCase()).join(" ");
  if (/\b(spec|brief|reference|req|asset|guide|input)\b/i.test(lowerNames)) {
    return "reference";
  }
  if (/\b(draft|wip|temp|working)\b/i.test(lowerNames)) {
    return "working";
  }
  return "project";
}

export function FilesTabUploadModal({
  projectId,
  isOpen,
  files,
  currentFolderId,
  currentFolderName = "Project Root",
  existingFiles,
  activeTaskId = null,
  activeTaskTitle = null,
  isProcessing = false,
  onConfirm,
  onCancel,
}: FilesTabUploadModalProps) {
  const [fileList, setFileList] = useState<File[]>(files);

  useEffect(() => {
    setFileList(files);
  }, [files]);

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

  // Intent defaults: heuristic-driven smart category selection
  const [intent, setIntent] = useState<FilesUploadIntent>(() =>
    computeInitialIntent(files, Boolean(matchingExistingFile), activeTaskId),
  );

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

  // Synchronize when matchingExistingFile changes or modal toggles
  useEffect(() => {
    if (!isOpen) {
      setExpandedCard(null);
      return;
    }
    const nextIntent = computeInitialIntent(
      fileList,
      Boolean(matchingExistingFile),
      activeTaskId,
    );
    setIntent(nextIntent);
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
      return "Project root";
    }
    if (destinationFolderId === currentFolderId && currentFolderName) {
      return currentFolderName;
    }
    const cachedNode =
      existingFiles.find((f) => f.id === destinationFolderId) ??
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.nodesById[destinationFolderId];
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
      .then(({ searchProjectTasks }) =>
        searchProjectTasks(projectId, taskQuery, 20),
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

  const handleConfirm = () => {
    if (fileList.length === 0) return;
    if (intent === "version") {
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        versionNodeId: versionNodeId || matchingExistingFile?.id || undefined,
        files: fileList,
      });
    } else if (intent === "project") {
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        files: fileList,
      });
    } else {
      // Task categories (reference, working, deliverable)
      onConfirm({
        intent,
        targetFolderId: destinationFolderId,
        taskId: activeTaskId || selectedTaskId || undefined,
        label: label.trim() || undefined,
        role: intent as TaskFileRole,
        files: fileList,
      });
    }
  };

  const isTaskCategory =
    intent === "reference" || intent === "working" || intent === "deliverable";

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
        <DialogHeader>
          <div className="flex flex-col gap-1 pr-4">
            <DialogTitle className="truncate text-base font-semibold">
              Upload {displayName}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({formatBytes(totalBytes)})
              </span>
            </DialogTitle>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Destination:</span>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted text-foreground font-mono">
                {destinationFolderName}
              </span>
            </div>
          </div>
          <DialogDescription>
            {expandedCard === "project"
              ? "Select the destination folder for these project files."
              : expandedCard === "deliverable"
                ? "Select the destination folder for this deliverable."
                : "How would you like to categorize these files?"}
          </DialogDescription>
        </DialogHeader>

        {/* Multi-file Removable Chip List */}
        {fileList.length > 1 && expandedCard === null && (
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1.5 rounded-lg border border-border bg-muted/40 dark:border-border dark:bg-card/40">
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
                You can save this upload directly as a new version or choose to place it as a separate project file.
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
                      Project Files
                    </div>
                    {intent === "project" && (
                      <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                        <Check className="size-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Place among existing files in {destinationFolderName}. Click to browse project tree.
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
                      Task Reference
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
                      Working File
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
                      Final Deliverable
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
                        New Version of Existing File
                      </div>
                      {intent === "version" && (
                        <span className="flex size-4 items-center justify-center rounded-[3px] bg-[#D14E24] text-white">
                          <Check className="size-2.5 stroke-[3]" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Add this upload to an existing file&apos;s version history.
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
                    Associated Task
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
                        placeholder="Search project tasks to link…"
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
                      Project Files
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
                      Final Deliverable
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
                      placeholder="Search project task for this deliverable…"
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
            className="h-[34px] rounded-[5px] border border-border bg-background px-3.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              isProcessing ||
              fileList.length === 0 ||
              (intent === "version" && !versionNodeId) ||
              (isTaskCategory && !activeTaskId && !selectedTaskId)
            }
            onClick={handleConfirm}
            className="flex h-[34px] items-center justify-center gap-1.5 rounded-[5px] bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isProcessing && <Loader2 className="size-3.5 animate-spin" />}
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
