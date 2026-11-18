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

import Link from "next/link";
import * as React from "react";
import { AlertTriangle, Folder } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FOLDER_LIST_GRID_TEMPLATE } from "./layout";

// ─── Loading ─────────────────────────────────────────────────────────

export interface FolderListLoadingProps {
  className?: string;
}

/**
 * Loading state: geometric skeleton rows aligned with FOLDER_LIST_GRID_TEMPLATE.
 * Eliminates cumulative layout shift (CLS) and provides 60fps instant visual feedback.
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
      className={cn("flex flex-col divide-y divide-[#DBD5C8]/40 dark:divide-border/40", className)}
    >
      <span className="sr-only">Loading folder…</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{ gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE }}
          className="grid h-12 items-center gap-x-3 px-4"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Skeleton className="size-4 rounded-[3px] shrink-0" />
            <Skeleton
              className="h-3.5 rounded-[3px]"
              style={{ width: `${60 + ((i * 37) % 80)}px` }}
            />
          </div>
          <Skeleton className="h-3 rounded-[3px] w-24" />
          <Skeleton className="h-3 rounded-[3px] w-12 ml-auto" />
          <Skeleton className="h-3 rounded-[3px] w-20" />
          <Skeleton className="size-4 rounded-[3px] ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty ───────────────────────────────────────────────────────────

export interface FolderListEmptyProps {
  className?: string;
  message?: string;
  /** The line under the title; null hides it. */
  hint?: string | null;
  /** A list, not a folder: no upload hint or terminal line. */
  plain?: boolean;
}

/**
 * Empty state: the folder has zero entries. Renders below the column
 * headers (Req 1.4, Req 4.9).
 */
export function FolderListEmpty({
  className,
  message = "This folder is empty",
  hint = "Upload or drag files into this folder to get started.",
  plain = false,
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
      {hint && !plain ? <p className="nb-compact mt-1 text-muted-foreground">{hint}</p> : null}
      {/* Entry point (CLI report A6.1): the terminal and AI agents reach the same files. Lists that aren't folders
          (History, merge requests, branches) say only what goes there. */}
      {plain ? null : (
        <p className="nb-meta mt-2 text-muted-foreground">
          Or from your terminal: <code>nb push &lt;files&gt;</code> · <Link href="/docs/cli" className="nb-link">CLI</Link> · <Link href="/docs/agents" className="nb-link">AI agents</Link>
        </p>
      )}
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
        <span>Couldn’t load this folder.</span>
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
