// Task 3.4 — `TaskSearchPicker` for the Files tab v3 (task-files-version-control).
//
// A project-scoped task search dialog that lists tasks the user can link to.
// Opened from the "Link to task…" action in `FileActionsBar` (Task 5.5).
//
// Requirements covered:
//   - Req 9.3: Open a project-scoped task picker dialog listing tasks
//   - Req 9.4: User selects a task → `onSelect(taskId)` fires

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X, CheckSquare } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatTaskId } from "@/lib/workspace-key";
import { getTaskTitlePresentation } from "@/lib/workspaces/task-presentation";
import { cn } from "@/lib/utils";
import type { TaskFileRole } from "@/lib/workspaces/task-file-intelligence";
import { searchWorkspaceTasks } from "@/app/actions/files/links";

// ─── Constants ───────────────────────────────────────────────────────

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 30;

interface SearchableTask {
  id: string;
  title: string;
  status: string;
  reviewStatus?: string | null;
  priority: string;
  taskNumber: number | null;
  projectKey: string | null;
  assigneeName: string | null;
}

// ─── Props ───────────────────────────────────────────────────────────

export interface TaskSearchPickerProps {
  projectId: string;
  isOpen: boolean;
  isSaving?: boolean;
  onClose: () => void;
  onSelect: (taskId: string, role: TaskFileRole) => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function TaskSearchPicker({
  projectId,
  isOpen,
  isSaving = false,
  onClose,
  onSelect,
}: TaskSearchPickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchableTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [role, setRole] = useState<TaskFileRole>("reference");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // ── Debounce query ─────────────────────────────────────────────────
  useEffect(() => {
    if (query.length === 0) {
      setDebouncedQuery("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // ── Fetch tasks ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setIsLoading(true);
    setError(false);

    searchWorkspaceTasks(projectId, debouncedQuery, MAX_RESULTS)
      .then((tasks) => {
        if (!cancelled) {
          itemRefs.current = [];
          setResults(tasks);
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          itemRefs.current = [];
          setResults([]);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, debouncedQuery, isOpen, retry]);

  // ── Reset state on open/close ──────────────────────────────────────
  useEffect(() => {
    let timer: number | undefined;
    if (isOpen) {
      itemRefs.current = [];
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setActiveIndex(0);
      setRole("reference");
      // Focus input after dialog animation
      timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isOpen]);

  // ── Scroll active item into view ──────────────────────────────────
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // ── Selection handler ──────────────────────────────────────────────
  const handleSelect = useCallback(
    (taskId: string) => {
      if (isSaving || isLoading || error || query !== debouncedQuery) return;
      onSelect(taskId, role);
    },
    [onSelect, role, isSaving, isLoading, error, query, debouncedQuery],
  );

  // ── Keyboard navigation ────────────────────────────────────────────
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length === 0) return;
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const task = results[activeIndex];
        if (task) handleSelect(task.id);
      }
    },
    [onClose, results, activeIndex, handleSelect],
  );

  const showEmpty = !isLoading && results.length === 0 && debouncedQuery.length > 0;
  const showRecent = !isLoading && results.length > 0 && debouncedQuery.length === 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-lg overflow-hidden rounded-[12px] border border-[#DBD5C8] bg-white p-0 shadow-lg dark:border-border dark:bg-card"
        showCloseButton={false}
        data-testid="task-search-picker"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Select a task</DialogTitle>
          <DialogDescription>Search and select a task to link to this file</DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-[#DBD5C8] px-4 py-3 dark:border-border">
          <Search className="h-4 w-4 flex-shrink-0 text-[#6B7880] dark:text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            disabled={isSaving}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks by title…"
            aria-label="Search tasks"
            className="nb-touch-target h-8 w-full bg-transparent text-sm outline-none placeholder:text-[#8E9AA1] text-[#141A1E] dark:text-foreground"
            role="combobox"
            aria-expanded="true"
            aria-controls="task-search-picker-listbox"
            aria-activedescendant={
              !isLoading && !error && results[activeIndex]
                ? `task-search-picker-item-${results[activeIndex].id}`
                : undefined
            }
          />
          <button
            type="button"
            className="rounded-[4px] p-1 text-[#6B7880] hover:bg-[#F3F0EA] hover:text-[#141A1E] dark:hover:bg-muted"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="flex flex-wrap items-center gap-2 border-b border-[#DBD5C8] bg-[#FAF8F4] px-4 py-2.5 dark:border-border dark:bg-card/50"
          role="radiogroup"
          aria-label="File role in the task"
        >
          <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-[#4C5A61]">Add as</span>
          {([
            ["reference", "Reference"],
            ["working", "Draft file"],
            ["deliverable", "Final file"],
          ] as const).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center rounded-[5px] border px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] transition-colors outline-none focus-within:outline-none focus-within:ring-0",
                role === value
                  ? value === "deliverable"
                    ? "border-[#D8E8DF] bg-[#EDF5F0] text-[#245A41] font-semibold"
                    : value === "reference"
                      ? "border-[#DBD5C8] bg-[#F3F0EA] text-[#374349] font-semibold"
                      : "border-[#DBD5C8] bg-white text-[#141A1E] font-semibold shadow-xs"
                  : "border-[#DBD5C8] bg-white text-[#4C5A61] hover:bg-[#F3F0EA] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted",
              )}
            >
              <input type="radio" name="task-file-role" value={value} checked={role === value} onChange={() => setRole(value)} disabled={isSaving} className="sr-only" />
              {label}
            </label>
          ))}
        </div>

        {/* Results list */}
        <div
          id="task-search-picker-listbox"
          className="max-h-[50vh] overflow-y-auto"
          role="listbox"
        >
          {error ? (
            <div role="alert" className="px-4 py-6 text-sm text-muted-foreground">
              Couldn’t load tasks. <button type="button" onClick={() => setRetry(value => value + 1)} className="underline outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0">Try again</button>
            </div>
          ) : isLoading || query !== debouncedQuery || isSaving ? (
            <div role="status" className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isSaving ? "Attaching file…" : "Searching tasks…"}
            </div>
          ) : showEmpty ? (
            <div className="p-3">
              <div className="nb-empty-state nb-grid-ground py-6 text-center" role="status">
                <div className="nb-empty-state-icon-box mb-2">
                  <CheckSquare className="nb-empty-state-icon" />
                </div>
                <h4 className="nb-empty-state-title">No tasks found</h4>
                <p className="nb-empty-state-desc">No tasks found for &quot;{debouncedQuery}&quot;</p>
              </div>
            </div>
          ) : results.length === 0 && !isLoading ? (
            <div className="p-3">
              <div className="nb-empty-state nb-grid-ground py-6 text-center" role="status">
                <div className="nb-empty-state-icon-box mb-2">
                  <CheckSquare className="nb-empty-state-icon" />
                </div>
                <h4 className="nb-empty-state-title">No tasks</h4>
                <p className="nb-empty-state-desc">No tasks in this workspace yet.</p>
              </div>
            </div>
          ) : (
            <>
              {showRecent && (
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Recent tasks
                </div>
              )}
              {debouncedQuery.length > 0 && results.length > 0 && (
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Search results
                </div>
              )}
              {results.map((task, idx) => {
                const isActive = idx === activeIndex;
                const titlePresentation = getTaskTitlePresentation(task);
                const taskLabel = task.taskNumber && task.projectKey
                  ? formatTaskId(task.projectKey, task.taskNumber)
                  : null;

                return (
                  <button
                    key={task.id}
                    id={`task-search-picker-item-${task.id}`}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    type="button"
                    ref={(el) => { itemRefs.current[idx] = el; }}
                    className={
                      "w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors " +
                      (isActive
                        ? "bg-muted"
                        : "hover:bg-muted/60")
                    }
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(task.id)}
                    data-testid={`task-search-picker-item-${task.id}`}
                  >
                    <CheckSquare className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn("truncate text-sm font-medium text-foreground", titlePresentation.className)}
                        aria-label={titlePresentation.ariaLabel}
                      >
                        {task.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {taskLabel && (
                          <span className="font-mono">{taskLabel}</span>
                        )}
                        <StatusDot status={task.reviewStatus === "pending" ? "in_review" : task.status} />
                        <span className="capitalize">{task.reviewStatus === "pending" ? "In review" : task.status.replace("_", " ")}</span>
                        {task.assigneeName && (
                          <>
                            <span className="text-muted-foreground/50">•</span>
                            <span className="truncate">{task.assigneeName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colorClass = useMemo(() => {
    switch (status) {
      case "in_review": return "bg-amber-500";
      case "done":
        return "bg-[#2F6B4F]";
      case "in_progress":
        return "bg-[#D14E24]";
      case "blocked":
        return "bg-[#B3261E]";
      default:
        return "bg-[#8E9AA1]";
    }
  }, [status]);

  return <span className={`inline-block h-2 w-2 rounded-[2px] ${colorClass}`} />;
}

export default TaskSearchPicker;
