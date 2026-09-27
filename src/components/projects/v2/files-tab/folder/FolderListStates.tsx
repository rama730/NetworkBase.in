// Task 5.1 — loading / empty / error states for `FolderListView`.
//
// Each state renders below a `FolderListHeader` (owned by the parent view)
// so the four column headers stay visible regardless of state (Req 4.9).
// The states are intentionally separate components so tests and Storybook
// can mount them in isolation.
//
// Requirements: Req 4.9 (loading + empty keep headers visible),
// Req 4.10 (error shows inline indicator + Retry affordance).

"use client";

import * as React from "react";
import { AlertTriangle, Folder, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Loading ─────────────────────────────────────────────────────────

export interface FolderListLoadingProps {
  className?: string;
}

/**
 * Loading state: a centered spinner row rendered below the column
 * headers. `aria-busy="true"` so assistive tech announces the pending
 * state without repeatedly focusing individual skeleton rows.
 */
export function FolderListLoading({
  className,
}: FolderListLoadingProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      data-testid="files-tab-folder-list-loading"
      className={cn(
        "flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2
        className="h-4 w-4 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <span>Loading folder…</span>
    </div>
  );
}

// ─── Empty ───────────────────────────────────────────────────────────

export interface FolderListEmptyProps {
  className?: string;
  message?: string;
}

/**
 * Empty state: the folder has zero entries. Renders below the column
 * headers (Req 1.4, Req 4.9).
 */
export function FolderListEmpty({
  className,
  message = "This folder is empty",
}: FolderListEmptyProps): React.JSX.Element {
  return (
    <div
      role="status"
      data-testid="files-tab-folder-list-empty"
      className={cn(
        "nb-empty-state nb-grid-ground my-6 py-10",
        className,
      )}
    >
      <Folder className="nb-empty-state-icon mb-2" />
      <p className="nb-card-title text-foreground">{message}</p>
      <p className="nb-compact mt-1 text-muted-foreground">
        Upload or drag files into this folder to get started.
      </p>
    </div>
  );
}

// ─── Error ───────────────────────────────────────────────────────────

export interface FolderListErrorProps {
  onRetry: () => void;
  className?: string;
}

/**
 * Error state: rendered when the folder contents could not be loaded
 * (Req 4.10). Exposes a Retry button that re-invokes the caller's
 * `loadFolderContent` via `onRetry`.
 */
export function FolderListError({
  onRetry,
  className,
}: FolderListErrorProps): React.JSX.Element {
  return (
    <div
      role="alert"
      data-testid="files-tab-folder-list-error"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-4 py-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle
          className="h-4 w-4 text-amber-500"
          aria-hidden="true"
        />
        <span>Couldn&apos;t load this folder.</span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRetry}
        data-testid="files-tab-folder-list-retry"
      >
        Retry
      </Button>
    </div>
  );
}
