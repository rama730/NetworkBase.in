// Task 5.3 — `LinkedTasksPanel` component.
//
// A collapsible right-side drawer on FileView that lists all tasks linked
// to the currently viewed file. Shows title, status, assignee, and annotation
// for each linked task.
//
// Requirements covered:
//   - Req 8.1: Toggle button opens/closes the panel as a collapsible drawer
//   - Req 8.2: Lists all linked tasks with title, status, assignee, annotation
//   - Req 8.3: Click task row → open task panel with initialTab="files"
//   - Req 8.4: Role_Owner/Role_Member: inline annotation editor via updateAnnotation
//   - Req 8.5: Role_Viewer: read-only, no annotation editor or mutation affordances
//   - Req 8.6: Toggle button visible to all roles
//   - Req 17.1: performance.mark on first interactive state
//   - Req 24.3: No annotation editor or link/unlink affordances for Role_Viewer

"use client";

import * as React from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { getTaskTitlePresentation } from "@/lib/projects/task-presentation";
import { useTaskLinks, type LinkedTask } from "@/hooks/useTaskLinks";
import { FileInspectorPanelHeader } from "./FileInspectorPanelHeader";

// ─── Props ───────────────────────────────────────────────────────────

export interface LinkedTasksPanelProps {
  projectId: string;
  nodeId: string;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────

export function LinkedTasksPanel({
  projectId,
  nodeId,
  canEdit,
  onOpenTask,
  onClose,
}: LinkedTasksPanelProps): React.JSX.Element {
  const { tasks, isLoading, error, updateAnnotation, refresh } = useTaskLinks(
    projectId,
    nodeId,
  );

  // ── Performance mark (Req 17.1) ────────────────────────────────────
  const perfMarkedRef = React.useRef(false);
  React.useEffect(() => {
    if (isLoading) return;
    if (perfMarkedRef.current) return;
    if (typeof performance === "undefined") return;
    performance.mark("files-tab:linked-tasks-panel-interactive");
    perfMarkedRef.current = true;
  }, [isLoading]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div
      data-testid="linked-tasks-panel"
      className={cn(
        "flex h-full min-w-0 w-full flex-col bg-card",
        "border-border",
      )}
    >
      <FileInspectorPanelHeader
        title="Linked Tasks"
        onClose={onClose}
        closeLabel="Close linked tasks"
        closeTestId="files-tab-linked-tasks-close"
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div role="alert" className="px-3 py-6 text-center text-xs text-red-500">
            {error} <button type="button" className="min-h-10 px-2 underline" onClick={() => void refresh()}>Retry</button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No tasks linked to this file.
          </div>
        ) : (
          <ul role="list" className="divide-y divide-border">
            {tasks.map((task) => (
              <LinkedTaskRow
                key={task.taskId}
                task={task}
                canEdit={canEdit}
                onOpenTask={onOpenTask}
                onUpdateAnnotation={updateAnnotation}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── LinkedTaskRow ───────────────────────────────────────────────────

interface LinkedTaskRowProps {
  task: LinkedTask;
  canEdit: boolean;
  onOpenTask: (taskId: string) => void;
  onUpdateAnnotation: (
    taskId: string,
    annotation: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

function LinkedTaskRow({
  task,
  canEdit,
  onOpenTask,
  onUpdateAnnotation,
}: LinkedTaskRowProps): React.JSX.Element {
  const titlePresentation = getTaskTitlePresentation(task);
  const [isEditing, setIsEditing] = React.useState(false);
  const [annotationDraft, setAnnotationDraft] = React.useState(
    task.annotation ?? "",
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (!isEditing) setAnnotationDraft(task.annotation ?? "");
  }, [task.annotation, isEditing]);

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  const handleSaveAnnotation = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await onUpdateAnnotation(task.taskId, annotationDraft.trim());
      if (!result.success) {
        setSaveError(result.error || "Couldn’t save this note. Your draft is still here.");
        return;
      }
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn’t save this note. Retry.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setSaveError(null);
    setAnnotationDraft(task.annotation ?? "");
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSaveAnnotation();
    } else if (e.key === "Escape" && !isSaving) {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  return (
    <li
      data-testid={`linked-task-row-${task.taskId}`}
      className="group"
    >
      {/* Clickable task row */}
      <button
        type="button"
        onClick={() => onOpenTask(task.taskId)}
        className={cn(
          "w-full text-left px-3 py-2.5 transition-colors",
          "hover:bg-muted/50",
        )}
        data-testid={`linked-task-row-open-${task.taskId}`}
      >
        <div className="flex items-start gap-2">
          <StatusDot status={task.reviewStatus === "pending" ? "in_review" : task.status} />
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "truncate text-sm font-medium text-foreground",
                titlePresentation.className,
              )}
              aria-label={titlePresentation.ariaLabel}
            >
              {task.title}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="capitalize">
                {task.reviewStatus === "pending" ? "In review" : task.status.replace(/_/g, " ")}
              </span>
              {task.assigneeName && (
                <>
                  <span className="text-muted-foreground/40">•</span>
                  <span className="truncate">{task.assigneeName}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Annotation section */}
      <div className="px-3 pb-2">
        {saveError && <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">{saveError}</p>}
        {isEditing && canEdit ? (
          /* Inline annotation editor (Req 8.4) */
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={annotationDraft}
              onChange={(e) => setAnnotationDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add annotation…"
              aria-label="Edit annotation"
              data-testid={`linked-task-annotation-input-${task.taskId}`}
              className={cn(
                "h-6 flex-1 rounded-[4px] border border-border bg-muted/40 px-1.5 text-xs text-foreground outline-none",
                "focus:border-[#D14E24]",
              )}
              disabled={isSaving}
            />
            <button
              type="button"
              onClick={handleSaveAnnotation}
              disabled={isSaving}
              aria-label="Save annotation"
              data-testid={`linked-task-annotation-save-${task.taskId}`}
              className="rounded-[4px] p-0.5 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={isSaving}
              aria-label="Cancel editing"
              data-testid={`linked-task-annotation-cancel-${task.taskId}`}
              className="min-h-10 min-w-10 rounded-[4px] p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : task.annotation ? (
          /* Display annotation (read-only for Role_Viewer, editable for others) */
          <div className="flex items-center gap-1">
            <span
              className="flex-1 truncate text-xs italic text-muted-foreground"
              data-testid={`linked-task-annotation-${task.taskId}`}
            >
              {task.annotation}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setAnnotationDraft(task.annotation ?? "");
                  setIsEditing(true);
                }}
                aria-label="Edit annotation"
                data-testid={`linked-task-annotation-edit-${task.taskId}`}
                className="min-h-10 min-w-10 rounded-[4px] p-0.5 text-muted-foreground hover:bg-muted"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : canEdit ? (
          /* No annotation yet — show "Add annotation" button for editors */
          <button
            type="button"
            onClick={() => {
              setAnnotationDraft("");
              setIsEditing(true);
            }}
            data-testid={`linked-task-annotation-add-${task.taskId}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add annotation
          </button>
        ) : null}
      </div>
    </li>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }): React.JSX.Element {
  const colorClass = React.useMemo(() => {
    switch (status) {
      case "in_review": return "bg-amber-500";
      case "done":
        return "bg-emerald-500";
      case "in_progress":
        return "bg-[#2563C9]";
      case "blocked":
        return "bg-red-500";
      default:
        return "bg-muted-foreground/60";
    }
  }, [status]);

  return (
    <span
      className={cn(
        "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-[2px]",
        colorClass,
      )}
      aria-hidden="true"
    />
  );
}

export default LinkedTasksPanel;
