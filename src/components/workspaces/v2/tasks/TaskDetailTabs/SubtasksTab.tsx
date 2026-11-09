"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "@/lib/feedback";
import {
  Check,
  CheckSquare,
  Copy,
  Edit2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TaskPanelSubtask } from "@/hooks/useTaskPanelResource";
import { copyOrSay } from "@/lib/clipboard";

type MutationResult = { success: boolean; error?: string };

interface SubtasksTabProps {
  subtasks: TaskPanelSubtask[];
  /** Authoritative totals; the list may hold only the first page. */
  totalCount?: number;
  completedTotal?: number;
  hasMore?: boolean;
  onLoadMore?: () => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  canEdit: boolean;
  onAddSubtask: (title: string) => Promise<MutationResult>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<MutationResult>;
  onDeleteSubtask: (subtaskId: string) => Promise<MutationResult>;
  onUpdateSubtask: (subtaskId: string, title: string) => Promise<MutationResult>;
  onRetry: () => Promise<unknown>;
  /** Names for "✓ Write tests · Kiran" on shared (team) copies. */
  nameOf?: (userId: string) => string | null;
}

export default function SubtasksTab({
  subtasks,
  totalCount,
  completedTotal,
  hasMore = false,
  onLoadMore,
  isLoading,
  error,
  canEdit,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onUpdateSubtask,
  onRetry,
  nameOf,
}: SubtasksTabProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "completed">("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const { openSubtasks, completedSubtasks, completedCount } = useMemo(() => {
    const completed = subtasks.filter((subtask) => subtask.completed);
    return {
      openSubtasks: subtasks.filter((subtask) => !subtask.completed),
      completedSubtasks: completed,
      completedCount: completed.length,
    };
  }, [subtasks]);

  const filteredSubtasks = useMemo(() => {
    if (filter === "open") return openSubtasks;
    if (filter === "completed") return completedSubtasks;
    return subtasks;
  }, [filter, openSubtasks, completedSubtasks, subtasks]);

  const displayError = localError || error;

  const setPending = (id: string, pending: boolean) => {
    setPendingIds((current) => {
      if (pending) return { ...current, [id]: true };
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const submitNewSubtask = async () => {
    const title = draft.trim();
    if (!title || isSubmitting) return;
    setIsSubmitting(true);
    setLocalError(null);
    try {
      const result = await onAddSubtask(title);
      if (result.success) {
        setDraft("");
        setAnnouncement("Subtask added.");
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      } else {
        setLocalError(result.error || "Couldn’t add subtask.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSubtask = async (subtask: TaskPanelSubtask) => {
    if (pendingIds[subtask.id]) return;
    setPending(subtask.id, true);
    setLocalError(null);
    try {
      const result = await onToggleSubtask(subtask.id, subtask.completed);
      if (result.success) {
        setAnnouncement(
          `Subtask marked ${subtask.completed ? "incomplete" : "complete"}.`,
        );
      } else {
        setLocalError(result.error || "Couldn’t update subtask.");
      }
    } finally {
      setPending(subtask.id, false);
    }
  };

  const saveTitle = async (subtask: TaskPanelSubtask) => {
    const title = editingDraft.trim();
    if (!title) {
      setLocalError("Subtask title is required.");
      return;
    }
    if (title === subtask.title || pendingIds[subtask.id]) {
      if (title === subtask.title) setEditingId(null);
      return;
    }
    setPending(subtask.id, true);
    setLocalError(null);
    try {
      const result = await onUpdateSubtask(subtask.id, title);
      if (result.success) {
        setEditingId(null);
        setAnnouncement("Subtask title updated.");
      } else {
        setLocalError(result.error || "Couldn’t rename subtask.");
      }
    } finally {
      setPending(subtask.id, false);
    }
  };

  const deleteSubtask = async (subtask: TaskPanelSubtask) => {
    if (pendingIds[subtask.id]) return;
    setPending(subtask.id, true);
    setLocalError(null);
    try {
      const result = await onDeleteSubtask(subtask.id);
      if (!result.success) {
        setLocalError(result.error || "Couldn’t delete subtask.");
      } else {
        setAnnouncement("Subtask deleted.");
      }
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "Couldn’t delete subtask.",
      );
    } finally {
      setPending(subtask.id, false);
    }
  };

  const copySubtaskTitle = (subtask: TaskPanelSubtask) => {
    copyOrSay(subtask.title, () => {
      setCopiedId(subtask.id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  };

  const startEditing = (subtask: TaskPanelSubtask) => {
    setEditingId(subtask.id);
    setEditingDraft(subtask.title);
  };

  const renderSubtask = (subtask: TaskPanelSubtask, index: number) => {
    const pending = pendingIds[subtask.id] === true;
    const editing = editingId === subtask.id;
    const isCopied = copiedId === subtask.id;

    return (
      <li
        key={subtask.id}
        className={cn(
          "group relative flex min-h-[42px] items-center gap-2.5 rounded-[5px] border border-border/80 bg-background px-3 py-2 transition-colors hover:border-foreground/30 shadow-2xs",
          subtask.completed && "border-border/50 bg-muted/10 opacity-85",
        )}
      >
        {/* Checkpoint Index */}
        <span className="shrink-0 font-mono text-[10px] max-md:text-[11px] font-medium text-muted-foreground/60 w-5 text-center select-none">
          #{index + 1}
        </span>

        {/* Checkbox Trigger */}
        <button
          type="button"
          onClick={() => void toggleSubtask(subtask)}
          disabled={!canEdit || pending}
          role="checkbox"
          aria-checked={subtask.completed}
          aria-label={`${subtask.completed ? "Mark incomplete" : "Mark complete"}: ${subtask.title}`}
          className={cn(
            "flex size-4.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
            subtask.completed
              ? "border-emerald-600 bg-emerald-500 text-white shadow-2xs"
              : "border-border bg-card hover:border-foreground/50",
          )}
        >
          {pending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : subtask.completed ? (
            <Check className="size-3 stroke-[2.5]" />
          ) : null}
        </button>

        {/* Title / Inline Editor */}
        {editing ? (
          <input
            autoFocus
            value={editingDraft}
            onChange={(event) => setEditingDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveTitle(subtask);
              }
              if (event.key === "Escape") setEditingId(null);
            }}
            onBlur={() => void saveTitle(subtask)}
            disabled={pending}
            aria-label="Subtask title"
            className="nb-touch-target h-[28px] min-w-0 flex-1 rounded-[3px] border border-primary bg-background px-2 text-[13px] font-medium text-foreground outline-none"
          />
        ) : (
          <span
            onClick={() => canEdit && !pending && startEditing(subtask)}
            className={cn(
              "min-w-0 flex-1 break-words text-[13px] leading-snug select-text",
              canEdit && "cursor-pointer",
              subtask.completed
                ? "text-muted-foreground line-through decoration-muted-foreground/60"
                : "font-medium text-foreground hover:text-primary transition-colors",
            )}
            title={canEdit ? "Click to edit title" : undefined}
          >
            {subtask.title}
          </span>
        )}
        {subtask.completed && subtask.completedBy && nameOf?.(subtask.completedBy) ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">· {nameOf(subtask.completedBy)}</span>
        ) : null}

        {pending ? (
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            Saving…
          </span>
        ) : null}

        {/* Action Buttons on Hover */}
        {canEdit && !editing && !pending ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            <button
              type="button"
              onClick={() => copySubtaskTitle(subtask)}
              aria-label={`Copy title of ${subtask.title}`}
              className="nb-touch-target size-7 flex items-center justify-center rounded-[3px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="Copy title"
            >
              {isCopied ? (
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400 stroke-[2.5]" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => startEditing(subtask)}
              aria-label={`Edit ${subtask.title}`}
              className="nb-touch-target size-7 flex items-center justify-center rounded-[3px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="Edit title"
            >
              <Edit2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void deleteSubtask(subtask)}
              aria-label={`Delete ${subtask.title}`}
              className="nb-touch-target size-7 flex items-center justify-center rounded-[3px] text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
              title="Delete subtask"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : null}
      </li>
    );
  };

  const [bulkPending, setBulkPending] = useState(false);
  // One at a time, so a failure is counted and reported rather than lost among parallel calls.
  const runBulk = async (targets: typeof subtasks, markDone: boolean) => {
    setBulkPending(true);
    let failed = 0;
    for (const subtask of targets) {
      const result = await onToggleSubtask(subtask.id, !markDone);
      if (!result.success) failed += 1;
    }
    setBulkPending(false);
    if (failed > 0) toast.warning(`${failed} of ${targets.length} subtasks could not be updated.`);
  };

  return (
    <section
      className="flex min-h-full flex-col p-6 space-y-4 max-md:p-4"
      aria-labelledby="subtasks-heading"
    >
      {/* Unboxed Architectural Header */}
      <div className="space-y-3 border-b border-border/60 pb-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3
              id="subtasks-heading"
              className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground"
            >
              Subtasks
            </h3>
            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-1.5 font-mono text-[11px] font-medium text-foreground">
              {hasMore ? (completedTotal ?? completedCount) : completedCount}/{hasMore ? (totalCount ?? subtasks.length) : subtasks.length}
            </span>
            {!hasMore && completedCount === subtasks.length && subtasks.length > 0 ? (
              <span className="inline-flex h-4 items-center rounded-[3px] border border-emerald-500/20 bg-emerald-500/10 px-1.5 font-mono text-[10px] max-md:text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
                Complete
              </span>
            ) : null}
          </div>

          {/* Bulk action: only when the whole list is loaded (it would otherwise miss later pages). */}
          {subtasks.length > 0 && canEdit && !hasMore ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={bulkPending}
                onClick={() => void runBulk(openSubtasks.length > 0 ? openSubtasks : completedSubtasks, openSubtasks.length > 0)}
                className="font-mono text-[11px] text-muted-foreground hover:text-foreground transition underline underline-offset-2 disabled:opacity-50"
              >
                {openSubtasks.length > 0 ? "Mark as completed" : "Reopen all"}
              </button>
            </div>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          Break this task into smaller steps.
        </p>

        {/* Filter Segmented Control */}
        {subtasks.length > 0 ? (
          <div className="flex items-center justify-between pt-0.5">
            <div className="inline-flex h-[32px] items-center rounded-[5px] border border-border bg-muted/30 p-0.5 gap-0.5">
              <button
                type="button"
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
                className={cn(
                  "nb-touch-target h-6 min-h-6 rounded-[3px] px-2 text-xs font-medium transition-colors",
                  filter === "all"
                    ? "bg-card text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                All ({subtasks.length})
              </button>
              <button
                type="button"
                aria-pressed={filter === "open"}
                onClick={() => setFilter("open")}
                className={cn(
                  "nb-touch-target h-6 min-h-6 rounded-[3px] px-2 text-xs font-medium transition-colors",
                  filter === "open"
                    ? "bg-card text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Open ({openSubtasks.length})
              </button>
              <button
                type="button"
                aria-pressed={filter === "completed"}
                onClick={() => setFilter("completed")}
                className={cn(
                  "nb-touch-target h-6 min-h-6 rounded-[3px] px-2 text-xs font-medium transition-colors",
                  filter === "completed"
                    ? "bg-card text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Done ({completedSubtasks.length})
              </button>
            </div>
            {completedCount > 0 && openSubtasks.length === 0 ? (
              <span className="font-mono text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                All checkpoints complete
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {displayError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-[5px] border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
        >
          <span>{displayError}</span>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              void onRetry();
            }}
            className="shrink-0 font-medium underline hover:opacity-80"
          >
            Retry
          </button>
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* Subtasks Content */}
      {isLoading ? (
        <div
          className="space-y-2 py-1"
          role="status"
          aria-label="Loading subtasks"
        >
          <span className="sr-only">Loading subtasks…</span>
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="flex min-h-[36px] items-center gap-2.5 rounded-[4px] border border-border/80 bg-card px-2.5 py-1.5"
              aria-hidden="true"
            >
              <Skeleton className="h-3.5 w-5 rounded-[2px]" />
              <Skeleton className="size-4.5 shrink-0 rounded-[3px]" />
              <Skeleton className="h-4 flex-1 rounded-[3px]" />
            </div>
          ))}
        </div>
      ) : subtasks.length === 0 ? (
        <div
          role="status"
          onClick={() => canEdit && inputRef.current?.focus()}
          className={cn(
            "my-auto flex flex-1 flex-col items-center justify-center nb-empty-state nb-grid-ground p-8 text-center transition",
            canEdit && "cursor-pointer hover:border-foreground/30 hover:bg-muted/10",
          )}
        >
          <div className="nb-empty-state-icon-box mb-3">
            <CheckSquare className="nb-empty-state-icon" />
          </div>
          <p className="nb-empty-state-title">
            No subtasks added yet
          </p>
          <p className="nb-empty-state-desc max-w-[280px]">
            {canEdit
              ? "Break this task into smaller steps."
              : "No subtasks have been created for this task."}
          </p>
        </div>
      ) : (
        <div className="flex-1 py-1">
          {filteredSubtasks.length === 0 ? (
            <div className="nb-empty-state nb-grid-ground my-4 py-8 text-center" role="status">
              <p className="nb-compact text-muted-foreground">
                No subtasks match the selected filter.
              </p>
            </div>
          ) : (
            <ul aria-label="Subtasks list" className="space-y-2">
              {filteredSubtasks.map((subtask, index) =>
                renderSubtask(subtask, index),
              )}
            </ul>
          )}
          {hasMore && onLoadMore ? (
            <div className="flex justify-center pt-3">
              <button
                type="button"
                className="nb-compact rounded-md border border-border bg-background px-3 py-1.5 text-foreground hover:bg-muted"
                onClick={() => void onLoadMore()}
              >
                Load more subtasks ({Math.max((totalCount ?? subtasks.length) - subtasks.length, 0)} remaining)
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* High-Velocity Continuous Add Subtask Form */}
      {canEdit ? (
        <form
          className="sticky bottom-0 mt-auto border-t border-border bg-card/95 backdrop-blur-xs pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitNewSubtask();
          }}
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={isSubmitting}
                placeholder="Add a subtask…"
                aria-label="Add a subtask"
                className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px] text-foreground outline-none transition focus:border-primary placeholder:text-muted-foreground disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={!draft.trim() || isSubmitting}
              className="nb-touch-target inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[5px] bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow-2xs transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add subtask
            </button>
          </div>
          <div className="flex items-center justify-between pt-1.5 px-0.5">
            <span className="font-mono text-[10px] max-md:text-[11px] text-muted-foreground/60">
              Press Enter to add
            </span>
          </div>
        </form>
      ) : null}
    </section>
  );
}
