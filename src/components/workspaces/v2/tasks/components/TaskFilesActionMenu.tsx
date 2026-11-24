"use client";

import { ChevronDown, FolderPlus, Link2, MoreHorizontal, Upload } from "@/components/ui/icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TaskFilesActionMenuProps {
  canEdit: boolean;
  disabled?: boolean;
  onPickFiles: () => void;
  onPickFolder?: () => void;
  onPickExisting: () => void;
  trigger?: React.ReactNode;
  variant?: "overflow" | "primary";
}

export function TaskFilesActionMenu({
  canEdit,
  disabled = false,
  onPickFiles,
  onPickFolder,
  onPickExisting,
  trigger,
  variant = "overflow",
}: TaskFilesActionMenuProps) {
  const isDisabled = disabled || !canEdit;

  const defaultTrigger =
    variant === "primary" ? (
      <button
        type="button"
        data-testid="task-files-action-menu-trigger"
        title="Add files"
        disabled={isDisabled}
        className="nb-touch-target inline-flex h-8 items-center gap-2 rounded-[5px] bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Upload className="h-3.5 w-3.5" />
        <span>Add files</span>
        <ChevronDown className="h-3 w-3 opacity-80" />
      </button>
    ) : (
      <button
        type="button"
        data-testid="task-files-action-menu-trigger"
        aria-label="Add files"
        title="Add files"
        disabled={isDisabled}
        className="nb-touch-target inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isDisabled}>
        {trigger ?? defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[300] w-56">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Add task files
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="task-files-action-upload-file"
          onSelect={(event) => {
            event.preventDefault();
            onPickFiles();
          }}
        >
          <Upload className="mr-2 h-4 w-4" />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-foreground">Upload file</span>
            <span className="text-[11px] text-muted-foreground">Add a new file from your computer</span>
          </div>
        </DropdownMenuItem>
        {onPickFolder ? (
          <DropdownMenuItem
            data-testid="task-files-action-upload-folder"
            onSelect={(event) => {
              event.preventDefault();
              onPickFolder();
            }}
          >
            <FolderPlus className="mr-2 h-4 w-4" />
            <div className="flex flex-col">
              <span className="text-[13px] font-medium text-foreground">Upload folder</span>
              <span className="text-[11px] text-muted-foreground">Keeps your folders as they are</span>
            </div>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          data-testid="task-files-action-attach-existing"
          onSelect={(event) => {
            event.preventDefault();
            onPickExisting();
          }}
        >
          <Link2 className="mr-2 h-4 w-4" />
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-foreground">Add task reference</span>
            <span className="text-[11px] text-muted-foreground">Link a file from Files</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default TaskFilesActionMenu;
