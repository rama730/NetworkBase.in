"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder as FolderIcon,
  History,
  Link2Off,
  MoreHorizontal,
  RefreshCcw,
  FolderUp,
  FolderDown,
  Pencil,
  X,
  FolderInput,
  UploadCloud,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileIcon } from "@/components/projects/v2/explorer/FileIcons";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import { extractLabel } from "@/lib/projects/task-file-label";
import type { TaskFileRole } from "@/lib/projects/task-file-intelligence";
import { formatBytes, formatRelativeTime as formatRelative, formatFileActor, formatFileTimestamp } from "../../files-tab/folder/format";

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

type TaskFileAttributionFields = {
  updatedByName?: string | null;
  updatedByUsername?: string | null;
  createdByName?: string | null;
  createdByUsername?: string | null;
  versionUpdatedAt?: Date | string | null;
};

export function getTaskFileAttributionLabel(node: TaskFileAttributionFields): string {
  return formatFileActor(node);
}

export interface TaskFileRowProps {
  node: ProjectNode & TaskFileAttributionFields & { annotation?: string | null };
  canEdit: boolean;
  canManageFiles?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: (node: ProjectNode) => void;
  onOpen?: (node: ProjectNode) => void;
  onShowHistory?: (node: ProjectNode) => void;
  onUnlink?: (node: ProjectNode) => void;
  onReplaceWithNewVersion?: (
    node: ProjectNode,
    file: File,
  ) => Promise<{ success: boolean; error?: string }> | void;
  onContextMenu?: (event: React.MouseEvent) => void;

  // Redesign props
  isDeliverable?: boolean;
  fileRole?: TaskFileRole;
  onMoveToDeliverables?: (node: ProjectNode) => void;
  onMoveToWorkingFiles?: (node: ProjectNode) => void;
  onMoveToReferences?: (node: ProjectNode) => void;
  onLabelChange?: (
    node: ProjectNode & { annotation?: string | null },
    newLabel: string | null,
  ) => void;
  onMoveInProjectFiles?: (node: ProjectNode) => void;
  onPublishToProjectFiles?: (node: ProjectNode) => void;
  isHighlighted?: boolean;
}

export function TaskFileRow({
  node,
  canEdit,
  canManageFiles = false,
  isExpanded,
  onToggleExpanded,
  onOpen,
  onShowHistory,
  onUnlink,
  onReplaceWithNewVersion,
  onContextMenu,
  isDeliverable = false,
  fileRole = isDeliverable ? "deliverable" : "working",
  onMoveToDeliverables,
  onMoveToWorkingFiles,
  onMoveToReferences,
  onLabelChange,
  onMoveInProjectFiles,
  onPublishToProjectFiles,
  isHighlighted = false,
}: TaskFileRowProps) {
  const isFolder = node.type === "folder";
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const version =
    (node as { currentVersion?: number | null }).currentVersion ?? 1;
  const currentLabel = extractLabel(node.annotation);
  const rolePresentation = {
    reference: "Reference",
    working: "Working",
    deliverable: "Deliverable",
  } satisfies Record<TaskFileRole, string>;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState(currentLabel || "");

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingLabel && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditingLabel]);

  // Sync state if external label changes while not editing
  useEffect(() => {
    if (!isEditingLabel) {
      setEditLabelValue(currentLabel || "");
    }
  }, [currentLabel, isEditingLabel]);

  const commitLabelEdit = useCallback(() => {
    setIsEditingLabel(false);
    if (editLabelValue.trim() !== (currentLabel || "")) {
      onLabelChange?.(node, editLabelValue.trim());
    }
  }, [editLabelValue, currentLabel, onLabelChange, node]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitLabelEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditingLabel(false);
        setEditLabelValue(currentLabel || "");
      }
    },
    [commitLabelEdit, currentLabel],
  );

  const handleRowActivate = useCallback(() => {
    if (isFolder) {
      onToggleExpanded?.(node);
    } else {
      onOpen?.(node);
    }
  }, [isFolder, node, onToggleExpanded, onOpen]);

  const handleReplacePicked: React.ChangeEventHandler<HTMLInputElement> =
    useCallback(
      async (event) => {
        const file = event.target.files?.[0];
        if (replaceInputRef.current) replaceInputRef.current.value = "";
        if (!file) return;
        if (!onReplaceWithNewVersion) return;
        if (extensionOf(file.name) !== extensionOf(node.name)) {
          toast.error("A new version must use the same file type");
          return;
        }
        await onReplaceWithNewVersion(node, file);
      },
      [node, onReplaceWithNewVersion],
    );

  return (
    <div
      data-task-file-row
      data-node-id={node.id}
      data-node-type={node.type}
      onContextMenu={onContextMenu}
      className={cn(
        "group relative flex items-center gap-3 rounded-[5px] border px-3 py-2.5 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[180ms] shadow-2xs",
        "bg-card border-border hover:border-foreground/30",
        isHighlighted &&
          "border-primary ring-2 ring-primary/20",
      )}
    >
      {/* Name and icon */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={handleRowActivate}
          aria-label={`${isFolder ? (isExpanded ? "Collapse folder" : "Expand folder") : "Open file"} ${node.name}`}
          aria-expanded={isFolder ? isExpanded : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-[3px]"
        >
          {isFolder && (
            <span className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-muted-foreground">
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </span>
          )}
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[3px] text-muted-foreground">
            {isFolder ? (
              <FolderIcon className="h-5 w-5 text-muted-foreground" fill="currentColor" />
            ) : (
              <FileIcon name={node.name} mimeType={node.mimeType} isFolder={false} className="h-5 w-5" />
            )}
          </span>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            {/* First row: File name, role badge, version badge */}
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-medium text-foreground break-all sm:break-normal truncate max-w-[280px] sm:max-w-none">
                {node.name}
              </span>
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-[3px] border px-1.5 font-mono text-[11px] font-semibold tracking-[0.09em] uppercase shrink-0",
                  fileRole === "reference" &&
                    "border-[#DBD5C8] bg-[#F3F0EA] text-[#374349] dark:border-border dark:bg-muted dark:text-muted-foreground",
                  fileRole === "working" &&
                    "border-[#DBD5C8] bg-white text-[#141A1E] dark:border-border dark:bg-card dark:text-foreground",
                  fileRole === "deliverable" &&
                    "border-[#D8E8DF] bg-[#EDF5F0] text-[#245A41] dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
                )}
              >
                {rolePresentation[fileRole]}
              </span>
              {version > 1 && (
                <span className="inline-flex shrink-0 items-center rounded-[3px] border border-[#D14E24]/30 bg-[#FCF0EA] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#D14E24] dark:border-[#D14E24]/50 dark:bg-[#D14E24]/20 dark:text-[#FCF0EA]">
                  v{version}
                </span>
              )}
            </div>

            {/* Second row: Secondary metadata (size, attribution, timestamp) */}
            <div className="flex items-center gap-1.5 min-w-0 text-xs text-muted-foreground">
              <span
                title={formatFileTimestamp(
                  node.versionUpdatedAt || node.updatedAt,
                )}
                className="truncate font-mono text-[11px] text-muted-foreground"
              >
                {isFolder
                  ? "Folder"
                  : `${formatBytes(node.size) || "Size not recorded"} · Updated by ${getTaskFileAttributionLabel(node)} · ${formatRelative(node.versionUpdatedAt || node.updatedAt)}`}
              </span>
            </div>
          </div>
        </button>

        {/* Custom label editor outside activation button */}
        {!isDeliverable &&
          (isEditingLabel ? (
            <span
              className="inline-flex items-center gap-1 rounded-[4px] border border-primary/30 bg-primary/10 pl-1.5 pr-1 py-0.5 shrink-0"
            >
              <input
                ref={inputRef}
                data-testid="task-file-row-label-editor"
                type="text"
                value={editLabelValue}
                onChange={(e) => setEditLabelValue(e.target.value)}
                onBlur={commitLabelEdit}
                onKeyDown={handleKeyDown}
                placeholder="Label..."
                className="w-24 bg-transparent text-[11px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                aria-label={`Clear label for ${node.name}`}
                onClick={() => {
                  setEditLabelValue("");
                  setIsEditingLabel(false);
                  onLabelChange?.(node, null);
                }}
                className="rounded-[2px] p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : currentLabel ? (
            <button
              type="button"
              aria-label={`Edit label for ${node.name}`}
              onClick={() => {
                if (canEdit) setIsEditingLabel(true);
              }}
              className={cn(
                "inline-flex shrink-0 items-center rounded-[3px] border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground",
                canEdit &&
                  "cursor-text hover:bg-muted hover:text-foreground transition-colors",
              )}
            >
              {currentLabel}
            </button>
          ) : null)}
      </div>

      {/* Hover actions */}
      <div className="flex shrink-0 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="task-file-row-overflow"
              aria-label={`Options for ${node.name}`}
              className="nb-touch-target flex size-8 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="z-[300] w-56 [&_[role=menuitem]]:min-h-10"
            data-testid="task-file-row-overflow-menu"
          >
            <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {node.name}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            {canEdit && !isDeliverable ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setIsEditingLabel(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Label
              </DropdownMenuItem>
            ) : null}

            {canEdit && !isDeliverable && onMoveToDeliverables ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveToDeliverables(node);
                }}
              >
                <FolderUp className="mr-2 h-4 w-4" />
                Move to Deliverables
              </DropdownMenuItem>
            ) : null}

            {canEdit && fileRole !== "reference" && onMoveToReferences ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveToReferences(node);
                }}
              >
                <FolderDown className="mr-2 h-4 w-4" />
                Move to Task References
              </DropdownMenuItem>
            ) : null}

            {canEdit && fileRole !== "working" && onMoveToWorkingFiles ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveToWorkingFiles(node);
                }}
              >
                <FolderDown className="mr-2 h-4 w-4" />
                Move to Working Files
              </DropdownMenuItem>
            ) : null}

            {canManageFiles && !node.taskId && onMoveInProjectFiles ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onMoveInProjectFiles(node);
                }}
              >
                <FolderInput className="mr-2 h-4 w-4" />
                Move in Project Files
              </DropdownMenuItem>
            ) : null}

            {canManageFiles && node.taskId && onPublishToProjectFiles ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onPublishToProjectFiles(node);
                }}
              >
                <UploadCloud className="mr-2 h-4 w-4" />
                Publish to Project Files
              </DropdownMenuItem>
            ) : null}

            {!isFolder && canEdit && onReplaceWithNewVersion ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  replaceInputRef.current?.click();
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Upload new version
              </DropdownMenuItem>
            ) : null}

            {!isFolder ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onShowHistory?.(node);
                }}
              >
                <History className="mr-2 h-4 w-4" />
                Version history (v{version})
              </DropdownMenuItem>
            ) : null}

            {canEdit && onUnlink ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    onUnlink(node);
                  }}
                  className="text-rose-600 focus:text-rose-600 dark:text-rose-300 dark:focus:text-rose-300"
                >
                  <Link2Off className="mr-2 h-4 w-4" />
                  Remove from task
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!isFolder && onReplaceWithNewVersion ? (
        <input
          ref={replaceInputRef}
          type="file"
          className="hidden"
          onChange={handleReplacePicked}
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : null}

    </div>
  );
}

export default TaskFileRow;
