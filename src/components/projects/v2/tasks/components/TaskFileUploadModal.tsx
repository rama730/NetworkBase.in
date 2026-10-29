"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BookOpen, FolderDown, FolderUp, RefreshCcw } from "lucide-react";

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

const FolderPicker = dynamic(() => import("@/components/projects/v2/explorer/ExplorerDialogsHost").then((mod) => mod.FolderPicker), { ssr: false });

export type UploadIntent = "reference" | "working" | "deliverable" | "version";

export interface TaskFileUploadModalProps {
  projectId: string;
  isOpen: boolean;
  files: File[];
  folderCount?: number;
  existingFiles: ProjectNode[];
  onConfirm: (
    intent: UploadIntent,
    targetNodeId?: string,
    label?: string,
  ) => void;
  onCancel: () => void;
}

export function TaskFileUploadModal({
  projectId,
  isOpen,
  files,
  folderCount = 0,
  existingFiles,
  onConfirm,
  onCancel,
}: TaskFileUploadModalProps) {
  const [intent, setIntent] = useState<UploadIntent>("working");
  const [destinationFolderId, setDestinationFolderId] = useState<string | null>(null);
  const [versionNodeId, setVersionNodeId] = useState("");
  const [label, setLabel] = useState<string>("");

  const fileCount = files.length;
  const displayName = folderCount > 0
    ? `${folderCount} folder${folderCount === 1 ? "" : "s"}`
    : fileCount === 1 && files[0] ? files[0].name : `${fileCount} files`;
  const versionCandidates = useMemo(
    () => existingFiles.filter((node) => node.type === "file"),
    [existingFiles],
  );

  const handleConfirm = () => {
    if (intent === "version") {
      onConfirm(intent, versionNodeId);
    } else if (intent === "deliverable") {
      onConfirm(intent, destinationFolderId ?? undefined);
    } else {
      onConfirm(intent, undefined, label.trim() || undefined);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="z-[300] sm:max-w-md" overlayClassName="z-[299]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-foreground">Upload {displayName}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            What are these files for?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-4">
          <div
            className={cn(
              "flex flex-col rounded-[5px] border p-3 transition-colors",
              intent === "reference"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-foreground/30",
            )}
          >
            <button
              type="button"
              onClick={() => setIntent("reference")}
              aria-pressed={intent === "reference"}
              className="flex w-full items-start gap-3 text-left"
            >
              <BookOpen
                className={cn(
                  "mt-0.5 h-5 w-5",
                  intent === "reference"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-foreground">
                  Task reference
                </div>
                <div className="text-xs text-muted-foreground">
                  A brief, specification, example, or source file supplied as task input.
                </div>
              </div>
            </button>
            {intent === "reference" && (
              <div className="mt-3 pl-8">
                <input
                  type="text"
                  placeholder="Optional description or tag…"
                  aria-label="Task reference description or tag"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-[4px] border border-border bg-card px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  maxLength={100}
                />
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex flex-col rounded-[5px] border p-3 transition-colors",
              intent === "working"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-foreground/30",
            )}
          >
            <button
              type="button"
              onClick={() => setIntent("working")}
              aria-pressed={intent === "working"}
              className="flex w-full items-start gap-3 text-left"
            >
              <FolderDown
                className={cn(
                  "mt-0.5 h-5 w-5",
                  intent === "working"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-foreground">
                  Working file
                </div>
                <div className="text-xs text-muted-foreground">
                  Active drafts and intermediate work produced while completing the task.
                </div>
              </div>
            </button>
            {intent === "working" && (
              <div className="mt-3 pl-8">
                <input
                  type="text"
                  placeholder="Optional description or tag…"
                  aria-label="File description or tag"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-[4px] border border-border bg-card px-3 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
                  maxLength={100}
                />
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex flex-col rounded-[5px] border p-3 transition-colors",
              intent === "deliverable"
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-border hover:border-foreground/30",
            )}
          >
            <button
              type="button"
              onClick={() => setIntent("deliverable")}
              aria-pressed={intent === "deliverable"}
              className="flex w-full items-start gap-3 text-left"
            >
              <FolderUp
                className={cn(
                  "mt-0.5 h-5 w-5",
                  intent === "deliverable"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground",
                )}
              />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-foreground">
                  Final deliverable
                </div>
                <div className="text-xs text-muted-foreground">
                  The completed output of this task. Optionally choose its
                  folder.
                </div>
              </div>
            </button>
            {intent === "deliverable" && (
              <div className="mt-3 pl-8 max-h-[200px] overflow-y-auto rounded-[4px] border border-border bg-card">
                <FolderPicker
                  projectId={projectId}
                  selectedFolderId={destinationFolderId}
                  onSelectFolder={setDestinationFolderId}
                />
              </div>
            )}
          </div>

          {folderCount === 0 && fileCount === 1 && versionCandidates.length > 0 && (
            <div
              className={cn(
                "flex flex-col rounded-[5px] border p-3 transition-colors",
                intent === "version"
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-border hover:border-foreground/30",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setIntent("version");
                  if (!versionNodeId) {
                    const first = versionCandidates[0];
                    if (first) setVersionNodeId(first.id);
                  }
                }}
                aria-pressed={intent === "version"}
                className="flex w-full items-start gap-3 text-left"
              >
                <RefreshCcw
                  className={cn(
                    "mt-0.5 h-5 w-5",
                    intent === "version"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
                  )}
                />
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-foreground">
                    New version of a file
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Add this upload to an attached file’s version history.
                  </div>
                </div>
              </button>

              {intent === "version" && (
                <div className="mt-3 pl-8">
                  <label htmlFor="task-file-version-target" className="sr-only">
                    Existing file
                  </label>
                  <select
                    id="task-file-version-target"
                    className="w-full rounded-[4px] border border-border bg-card px-3 py-1.5 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                    value={versionNodeId}
                    onChange={(e) => setVersionNodeId(e.target.value)}
                  >
                    <option value="" disabled>
                      Select an existing file…
                    </option>
                    {versionCandidates.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[5px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={files.length === 0 || (intent === "version" && !versionNodeId)}
            className="rounded-[5px] bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
