"use client";

import Link from "next/link";
import { CloudUpload } from "lucide-react";

import { cn } from "@/lib/utils";
import { TaskFilesActionMenu } from "@/components/workspaces/v2/tasks/components/TaskFilesActionMenu";

export interface TaskFilesEmptyStateProps {
  canEdit: boolean;
  isDragActive?: boolean;
  /** Triggered by the "Upload files" card — opens the same hidden input
   *  the header button uses. */
  onPickFiles: () => void;
  /** Optional — only rendered when the parent supports folder uploads. */
  onPickFolder?: () => void;
  /** Opens the "Attach existing project file/folder" picker modal. */
  onPickExisting: () => void;
}

export function TaskFilesEmptyState({
  canEdit,
  isDragActive,
  onPickFiles,
  onPickFolder,
  onPickExisting,
}: TaskFilesEmptyStateProps) {
  return (
    <div
      data-testid="task-files-empty-state"
      className={cn(
        "flex h-full flex-col items-center justify-center gap-6 rounded-[8px] border-2 border-dashed px-6 py-12 text-center transition-colors nb-grid-ground",
        isDragActive
          ? "border-primary bg-primary/5"
          : "border-border/60 bg-card",
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-[8px] border border-border bg-card text-primary shadow-2xs">
          <CloudUpload className="size-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">
          {isDragActive ? "Drop to link" : "No task files yet"}
        </h3>
        <p className="max-w-xs text-xs text-muted-foreground">
          Drop files here: they’re added as drafts, or drop them on References or Final files. You can also
          link a file that’s already in the workspace.
        </p>
      </div>

      <TaskFilesActionMenu
        canEdit={canEdit}
        onPickFiles={onPickFiles}
        onPickFolder={onPickFolder}
        onPickExisting={onPickExisting}
        variant="primary"
      />

      <p className="max-w-sm text-[11px] text-muted-foreground">
        From your terminal or an AI agent: <code>nb push &lt;files&gt; --task &lt;n&gt;</code> ·{" "}
        <Link href="/docs/agents" className="nb-link">Work with an agent</Link>
      </p>

      {!canEdit ? (
        <p className="text-[11px] text-muted-foreground">
          You can view this task but not change it. Ask an owner or admin to attach files.
        </p>
      ) : null}
    </div>
  );
}

export default TaskFilesEmptyState;
