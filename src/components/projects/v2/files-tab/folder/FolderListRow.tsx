// Folder list row: four columns plus favorite, task badge, git badge, and folder drop.

"use client";

import * as React from "react";
import { MoreHorizontal, Star, X } from "lucide-react";

import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { getTaskWorkingFilesDisplayName } from "@/lib/files/task-working-files";
import { extractFoldersFromDataTransfer } from "@/lib/files/folder-drop";

import { FileTypeChip } from "../FileTypeChip";
import { TaskLinkPopover } from "../TaskLinkPopover";
import { VersionPill } from "../VersionPill";
import { FolderAccessChip } from "@/components/organizations/FolderAccessChip";
import { formatBytes, formatRelativeTime, formatFileActor } from "./format";
import { FOLDER_LIST_GRID_TEMPLATE, FOLDER_LIST_ROW_HEIGHT_PX } from "./layout";

// ─── Types ───────────────────────────────────────────────────────────

export type GitChangeStatus = "modified" | "added" | "deleted";

/** Optional enrichment on `ProjectNode` supplied by the parent view. */
export type FolderListRowNode = ProjectNode & {
  /** Latest version uploader id when this row is a file. */
  updatedById?: string | null;
  /** Upstream-resolved display label for the "By" column. */
  updatedByName?: string | null;
  /** Upstream-resolved username fallback for the "By" column. */
  updatedByUsername?: string | null;
  /** Latest version uploader avatar when this row is a file. */
  updatedByAvatarUrl?: string | null;
  /** Latest version upload timestamp when this row is a file. */
  versionUpdatedAt?: Date | string | null;
};

export interface FolderListRowProps {
  projectId: string;
  node: FolderListRowNode;
  /** Toggles drag source + hides the favorite affordance when false. */
  canEdit: boolean;
  canMove?: boolean;
  /** Renders the favorite star as filled. */
  isFavorite: boolean;
  /** Optional git change status for this node. */
  gitChange?: GitChangeStatus | null;
  /** Feature-flag gate for git change badges (Req 12.1). */
  /** Number of tasks linked to this node (from store taskLinkCounts). Req 7.1. */
  taskLinkCount?: number;
  /** Row click handler. Receives the node id. */
  onNavigate: (nodeId: string) => void;
  /** Favorite star click handler. Receives the node id. */
  onToggleFavorite: (nodeId: string) => void;
  /** Context-menu handler (preserves `ExplorerContextMenu` integration). */
  onContextMenu: (node: FolderListRowNode, event: React.MouseEvent) => void;
  /** Drop handler — only folder rows are valid drop targets. */
  onDropOnFolder?: (targetFolderId: string, draggedNodeId: string) => void;
  /** Desktop file drop upload target. Only firing when `canEdit` is true. */
  onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;
  className?: string;
  selected?: boolean;
  onSelectionChange?: (nodeId: string, selected: boolean) => void;
  showActions?: boolean;
  actions?: React.ReactNode;
  subtitle?: string;
  taskLabel?: string | null;
  onTaskLabelChange?: (node: FolderListRowNode, newLabel: string | null) => void;
  isEditingTaskLabel?: boolean;
  onStartEditTaskLabel?: () => void;
  onCancelEditTaskLabel?: () => void;
}

// ─── Drag-source MIME (matches the tree drag-source in `FileTreeRow`) ─

const NODE_DRAG_MIME = "application/x-nb-node";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractDraggedNodeId(dt: DataTransfer): string | null {
  const raw = dt.getData(NODE_DRAG_MIME).trim();
  if (!raw) return null;
  return UUID_PATTERN.test(raw) ? raw : null;
}

// ─── Field helpers ───────────────────────────────────────────────────

const MISSING = "—" as const;

/** "By" column label with the same fallback order as `MetadataStrip`. */
function updatedByLabel(node: FolderListRowNode): string {
  return node.type === "folder" ? MISSING : formatFileActor(node);
}

/** Relative-time label for the "Last updated" column. */
function updatedAtLabel(node: FolderListRowNode): string {
  const value = node.versionUpdatedAt ?? node.updatedAt;
  if (value == null) return MISSING;
  const label = formatRelativeTime(value);
  return label === MISSING ? MISSING : label;
}

/** Size label per Req 4.5 — empty for folders, formatBytes for files. */
function sizeLabel(node: FolderListRowNode): string {
  if (node.type === "folder") return "";
  if (node.size == null) return MISSING;
  const label = formatBytes(node.size, "file");
  return label === "" ? MISSING : label;
}

// ─── Git change badge ────────────────────────────────────────────────

const GIT_BADGE_LETTER: Record<GitChangeStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
};

const GIT_BADGE_CLASS: Record<GitChangeStatus, string> = {
  modified:
    "bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
  added:
    "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
  deleted:
    "bg-red-100 text-red-800 ring-1 ring-red-300 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/30",
};

function GitChangeBadge({
  status,
}: {
  status: GitChangeStatus;
}): React.JSX.Element {
  return (
    <span
      data-testid="files-tab-folder-list-git-badge"
      data-status={status}
      title={`Git: ${status}`}
      className={cn(
        "inline-flex h-[18px] w-[18px] items-center justify-center rounded-sm text-[11px] font-semibold tabular-nums",
        GIT_BADGE_CLASS[status],
      )}
    >
      {GIT_BADGE_LETTER[status]}
    </span>
  );
}

// ─── Row component ───────────────────────────────────────────────────

export const FolderListRow = React.memo(function FolderListRow({
  projectId,
  node,
  canEdit,
  canMove = canEdit,
  isFavorite,
  gitChange,
  taskLinkCount,
  onNavigate,
  onContextMenu,
  onDropOnFolder,
  onDesktopFileDrop,
  className,
  selected = false,
  onSelectionChange,
  showActions = true,
  actions,
  subtitle,
  taskLabel,
  onTaskLabelChange,
  isEditingTaskLabel,
  onStartEditTaskLabel,
  onCancelEditTaskLabel,
}: FolderListRowProps): React.JSX.Element {
  const isFolder = node.type === "folder";
  const [dropHighlight, setDropHighlight] = React.useState(false);

  const showGitBadge = !!gitChange && !isFolder;

  const handleClick = React.useCallback(() => {
    if (onSelectionChange) onSelectionChange(node.id, !selected);
    else onNavigate(node.id);
  }, [node.id, onNavigate, onSelectionChange, selected]);

  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(node, e);
    },
    [node, onContextMenu],
  );

  const handleDragStart = React.useCallback(
    (e: React.DragEvent) => {
      if (!canMove) return;
      e.dataTransfer.setData(NODE_DRAG_MIME, node.id);
      e.dataTransfer.effectAllowed = "move";
    },
    [canMove, node.id],
  );

  const handleDragOver = React.useCallback(
    (e: React.DragEvent) => {
      if (!isFolder) return;
      const hasFiles =
        canEdit &&
        Boolean(onDesktopFileDrop) &&
        e.dataTransfer.types.includes("Files");
      const hasNodeDrag =
        canMove &&
        Boolean(onDropOnFolder) &&
        e.dataTransfer.types.includes(NODE_DRAG_MIME);
      if (!hasFiles && !hasNodeDrag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
      if (!dropHighlight) setDropHighlight(true);
    },
    [
      canEdit,
      canMove,
      dropHighlight,
      isFolder,
      onDesktopFileDrop,
      onDropOnFolder,
    ],
  );

  const handleDragLeave = React.useCallback(() => {
    if (dropHighlight) setDropHighlight(false);
  }, [dropHighlight]);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      if (!isFolder) return;
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight(false);

      // Desktop file drop → upload into this folder (viewers excluded).
      if (canEdit && onDesktopFileDrop && (e.dataTransfer.files.length > 0 || (e.dataTransfer.items && e.dataTransfer.items.length > 0))) {
        void extractFoldersFromDataTransfer(e.dataTransfer).then((extracted) => {
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
          const files = allFiles.length > 0 ? allFiles : Array.from(e.dataTransfer.files || []);
          if (files.length > 0) onDesktopFileDrop(files, node.id);
        }).catch(() => {
          const files = Array.from(e.dataTransfer.files || []);
          if (files.length > 0) onDesktopFileDrop(files, node.id);
        });
        return;
      }
      if (!canMove || !onDropOnFolder) return;

      if (!e.dataTransfer.types.includes(NODE_DRAG_MIME)) return;
      const draggedId = extractDraggedNodeId(e.dataTransfer);
      if (!draggedId || draggedId === node.id) return;
      onDropOnFolder(node.id, draggedId);
    },
    [
      canEdit,
      canMove,
      isFolder,
      node.id,
      onDesktopFileDrop,
      onDropOnFolder,
    ],
  );

  const byLabel = updatedByLabel(node);
  const updatedLabel = updatedAtLabel(node);
  const displayName = getTaskWorkingFilesDisplayName(node);

  const [localEditingLabel, setLocalEditingLabel] = React.useState(false);
  const isEditingLabel = isEditingTaskLabel || localEditingLabel;
  const [editLabelValue, setEditLabelValue] = React.useState(taskLabel || "");
  const labelInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isEditingLabel) return undefined;
    setEditLabelValue(taskLabel || "");
    const timer = setTimeout(() => {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    }, 10);
    return () => clearTimeout(timer);
  }, [isEditingLabel, taskLabel]);

  const commitLabelEdit = React.useCallback(() => {
    setLocalEditingLabel(false);
    onCancelEditTaskLabel?.();
    const trimmed = editLabelValue.trim();
    if (trimmed !== (taskLabel || "")) {
      onTaskLabelChange?.(node, trimmed || null);
    }
  }, [editLabelValue, taskLabel, onTaskLabelChange, node, onCancelEditTaskLabel]);

  const cancelLabelEdit = React.useCallback(() => {
    setLocalEditingLabel(false);
    onCancelEditTaskLabel?.();
    setEditLabelValue(taskLabel || "");
  }, [taskLabel, onCancelEditTaskLabel]);

  const handleLabelKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        commitLabelEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelLabelEdit();
      }
    },
    [commitLabelEdit, cancelLabelEdit],
  );

  return (
    <div
      role="row"
      aria-selected={onSelectionChange ? selected : undefined}
      data-testid="files-tab-folder-list-row"
      data-node-id={node.id}
      data-node-type={node.type}
      style={{
        gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE,
        minHeight: FOLDER_LIST_ROW_HEIGHT_PX,
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      onContextMenu={handleContextMenu}
      draggable={canMove}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      tabIndex={0}
      className={cn(
        "group grid cursor-pointer items-center gap-x-3 border-b border-[#E8E3D9] px-4 text-sm outline-none transition-colors",
        "hover:bg-[#F3F0EA]/70 focus-visible:bg-[#F3F0EA]/70",
        "dark:border-white/10 dark:hover:bg-white/5 dark:focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D14E24] focus-visible:border-l-[3px] focus-visible:border-l-[#D14E24] focus-visible:pl-[13px]",
        dropHighlight &&
          "bg-[#FCF0EA]/75 ring-1 ring-inset ring-[#D14E24] dark:bg-[#D14E24]/20",
        className,
        selected && onSelectionChange && "bg-[#F3F0EA] dark:bg-white/10",
      )}
    >
      {/* Name column */}
      <div
        role="cell"
        data-column="name"
        className="flex min-w-0 items-center gap-2.5"
      >
        {canEdit && onSelectionChange && (
          <label
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              aria-label={`Select ${displayName}`}
              checked={selected}
              onChange={(event) => onSelectionChange(node.id, event.target.checked)}
              className="size-4 rounded-[3px] accent-[#D14E24]"
            />
          </label>
        )}
        <FileTypeChip
          name={displayName}
          mimeType={node.mimeType}
          isFolder={isFolder}
          isOpen={false}
        />
        <div className="min-w-0 flex-1">
          <span
            data-testid="files-tab-folder-list-name"
            className={cn(
              "block truncate text-[#141A1E] dark:text-foreground",
              isFolder ? "font-semibold" : "font-medium",
            )}
            title={displayName}
          >
            {displayName}
          </span>
          {(subtitle || taskLabel || isEditingLabel || (canEdit && onTaskLabelChange)) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              {subtitle && (
                <span title={subtitle} className="inline-flex items-center truncate text-xs">
                  {subtitle.startsWith("Deliverable") ? (
                    <span
                      data-testid="file-role-badge-deliverable"
                      className={cn(
                        "inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-medium tracking-wide",
                        subtitle.includes("Approved")
                          ? "bg-[#EDF5F0] text-[#245A41] dark:bg-[#245A41]/20 dark:text-[#EDF5F0]"
                          : "bg-[#FCF0EA] text-[#B23F1C] dark:bg-[#B23F1C]/20 dark:text-[#FCF0EA]",
                      )}
                    >
                      {subtitle}
                    </span>
                  ) : subtitle === "Working file" ? (
                    <span
                      data-testid="file-role-badge-working"
                      className="inline-flex items-center rounded-[3px] bg-[#EEF4FD] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-medium tracking-wide text-[#2563C9] dark:bg-[#2563C9]/20 dark:text-[#EEF4FD]"
                    >
                      Working file
                    </span>
                  ) : subtitle === "Reference" ? (
                    <span
                      data-testid="file-role-badge-reference"
                      className="inline-flex items-center rounded-[3px] bg-[#F3F0EA] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-medium tracking-wide text-[#6B7880] dark:bg-muted dark:text-muted-foreground"
                    >
                      Reference
                    </span>
                  ) : (
                    <span className="text-[#6B7880] dark:text-muted-foreground">{subtitle}</span>
                  )}
                </span>
              )}

              {/* Task label pill / inline editor */}
              {isEditingLabel ? (
                <span
                  className="inline-flex items-center gap-1 rounded-[3px] border border-[#D14E24] bg-white px-1.5 py-0.5 shadow-xs dark:border-[#D14E24] dark:bg-card"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    ref={labelInputRef}
                    data-testid="folder-list-row-label-editor"
                    type="text"
                    value={editLabelValue}
                    onChange={(e) => setEditLabelValue(e.target.value)}
                    onBlur={commitLabelEdit}
                    onKeyDown={handleLabelKeyDown}
                    placeholder="Label..."
                    className="w-32 bg-transparent font-mono text-[10px] max-md:text-[11px] font-medium text-[#141A1E] dark:text-foreground outline-none placeholder:text-[#6B7880] dark:placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    aria-label={`Clear label for ${displayName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditLabelValue("");
                      setLocalEditingLabel(false);
                      onCancelEditTaskLabel?.();
                      onTaskLabelChange?.(node, null);
                    }}
                    className="rounded-[2px] p-0.5 text-[#6B7880] hover:bg-[#F3F0EA] hover:text-[#141A1E] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : taskLabel ? (
                <button
                  type="button"
                  data-testid="folder-list-row-task-label"
                  aria-label={`Edit label: ${taskLabel}`}
                  title={canEdit && onTaskLabelChange ? "Click to edit label" : taskLabel}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canEdit && onTaskLabelChange) {
                      if (onStartEditTaskLabel) onStartEditTaskLabel();
                      else setLocalEditingLabel(true);
                    }
                  }}
                  className={cn(
                    "inline-flex max-w-[320px] truncate shrink-0 items-center rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] font-semibold text-[#374349] dark:border-border dark:bg-muted dark:text-muted-foreground",
                    canEdit && onTaskLabelChange &&
                      "cursor-text hover:border-[#B8AF9E] hover:bg-[#E8E3D9] hover:text-[#141A1E] dark:hover:bg-muted/80 dark:hover:text-foreground transition-colors",
                  )}
                >
                  {taskLabel}
                </button>
              ) : canEdit && onTaskLabelChange ? (
                <button
                  type="button"
                  data-testid="folder-list-row-add-label-btn"
                  aria-label={`Add label to ${displayName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onStartEditTaskLabel) onStartEditTaskLabel();
                    else setLocalEditingLabel(true);
                  }}
                  className="hidden group-hover:inline-flex items-center rounded-[3px] border border-dashed border-[#DBD5C8] px-1.5 py-0.5 font-mono text-[10px] max-md:text-[11px] text-[#6B7880] hover:border-[#141A1E] hover:text-[#141A1E] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground transition-colors"
                >
                  + label
                </button>
              ) : null}
            </div>
          )}
          <span data-file-mobile-meta className="truncate text-xs text-[#6B7880] dark:text-muted-foreground">
            {[updatedLabel, sizeLabel(node), byLabel].filter((label) => label && label !== MISSING).join(" · ")}
          </span>
        </div>
        <VersionPill v={node.currentVersion} />
        {node.type === "folder" ? <FolderAccessChip metadata={node.metadata} /> : null}
        {isFavorite && <Star aria-label="Starred" className="size-3.5 shrink-0 text-[#9A6B00]" fill="currentColor" />}
        {showGitBadge ? <GitChangeBadge status={gitChange!} /> : null}
        {(taskLinkCount ?? 0) > 0 ? (
          <TaskLinkPopover
            projectId={projectId}
            nodeId={node.id}
            count={taskLinkCount!}
          />
        ) : null}
      </div>

      {/* Last updated */}
      <div
        role="cell"
        data-column="updated"
        suppressHydrationWarning
        className="min-w-0 truncate font-mono text-xs text-[#6B7880] dark:text-muted-foreground"
        title={node.versionUpdatedAt ? String(node.versionUpdatedAt) : node.updatedAt ? String(node.updatedAt) : undefined}
      >
        {updatedLabel}
      </div>

      {/* Size */}
      <div
        role="cell"
        data-column="size"
        className="min-w-0 text-right font-mono text-xs tabular-nums text-[#6B7880] dark:text-muted-foreground"
      >
        {sizeLabel(node)}
      </div>

      {/* By */}
      <div
        role="cell"
        data-column="by"
        className="min-w-0 truncate text-xs text-[#6B7880] dark:text-muted-foreground"
        title={byLabel}
      >
        {byLabel}
      </div>
      <div role="cell" data-column="actions" onClick={(event) => event.stopPropagation()} className="flex justify-end">
        {showActions && (actions ?? (
          <button
            type="button"
            aria-label={`Actions for ${displayName}`}
            className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-[#6B7880] hover:text-[#141A1E] hover:bg-[#F3F0EA] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
            onClick={handleContextMenu}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
});

export default FolderListRow;
