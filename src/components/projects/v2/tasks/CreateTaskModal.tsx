"use client";

import { useTaskCompletionPolicy } from "@/hooks/useTaskCompletionPolicy";
import { completionActionLabel } from "@/lib/projects/task-completion-policy";
import React from "react";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/projects/sprint-detail";
import { CheckSquare, ChevronDown, Paperclip, Trash2, User, X, Zap } from "lucide-react";
import { usePlainContentHeadings } from "@/components/projects/PlainContentHeadings";

import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiAttachmentPicker } from "../files-tab/picker/MultiAttachmentPicker";
import {
  taskEditorDraftSchema,
  type TaskEditorDraft,
  type TaskEditorSubtaskDraft,
} from "@/lib/projects/task-draft";
import {
  isAssignableSprintOption,
  normalizeAssignableMembers,
  normalizeSprintOptions,
} from "@/lib/projects/task-presentation";
import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/projects/task-workflow";
import {
  addDaysToSprintDateInput,
  formatSprintDateInput,
  parseSprintDateInput,
} from "@/lib/projects/sprints";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    draft: TaskEditorDraft;
    subtasks: TaskEditorSubtaskDraft[];
    attachments: ProjectNode[];
  }) => Promise<{ success: boolean; error?: string }>;
  members?: any[];
  sprints?: any[];
  projectId: string;
  projectName?: string;
  /** Only the owner may put a new task in a sprint (the server enforces the same). */
  canAssignSprint?: boolean;
}

function SectionDivider({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-1.5">
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required = false,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const describedBy = error
    ? `${htmlFor}-error`
    : hint
      ? `${htmlFor}-hint`
      : undefined;

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-foreground"
      >
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            "aria-invalid": Boolean(error),
            "aria-describedby": describedBy,
          })
        : children}
      {hint ? <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs font-mono text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function inputClassName(hasError: boolean) {
  return cn(
    "h-[34px] w-full rounded-[5px] border bg-card px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60",
    "border-border focus:border-primary focus:ring-1 focus:ring-primary/20",
    hasError && "border-destructive focus:border-destructive focus:ring-destructive/20",
  );
}

function getTodayDateString(): string {
  return formatSprintDateInput(new Date());
}

function addDaysToDateString(dateStr: string, days: number): string {
  try {
    return addDaysToSprintDateInput(dateStr, days);
  } catch {
    return formatSprintDateInput(new Date());
  }
}

function getDaysDifferenceFromToday(dateStr: string): number | null {
  if (!dateStr || !dateStr.trim()) return null;
  try {
    const parsedTarget = parseSprintDateInput(dateStr);
    const today = parseSprintDateInput(getTodayDateString());
    const diffTime = parsedTarget.getTime() - today.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export default function CreateTaskModal({
  isOpen,
  onClose,
  onCreate,
  members = [],
  sprints = [],
  projectId,
  projectName,
  canAssignSprint = false,
}: CreateTaskModalProps) {
  const completionPolicy = useTaskCompletionPolicy(projectId ?? "");
  const plainContentHeadings = usePlainContentHeadings();
  const availableSprints = React.useMemo(
    () => normalizeSprintOptions(sprints),
    [sprints],
  );
  const availableMembers = React.useMemo(
    () => normalizeAssignableMembers(members),
    [members],
  );

  const [subtasks, setSubtasks] = React.useState<TaskEditorSubtaskDraft[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = React.useState("");
  const [attachments, setAttachments] = React.useState<ProjectNode[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [isFilePickerOpen, setIsFilePickerOpen] = React.useState(false);
  const [storyPoints, setStoryPoints] = React.useState<string>("");
  // No due date unless one is chosen.
  const [dueDate, setDueDate] = React.useState<string>("");

  const openerRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    setSubtasks([]);
    setNewSubtaskTitle("");
    setAttachments([]);
    setSubmitError(null);
    setFieldErrors({});
    setIsSubmitting(false);
    setIsFilePickerOpen(false);
    setStoryPoints("");
    setDueDate("");
  }, [isOpen]);

  const handleQuickSetDueDate = React.useCallback((days: number) => {
    const nextDate = addDaysToDateString(getTodayDateString(), days);
    setDueDate(nextDate);
    setFieldErrors((prev) => {
      if (!prev.dueDate) return prev;
      const { dueDate: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const selectedDays = React.useMemo(
    () => getDaysDifferenceFromToday(dueDate),
    [dueDate],
  );

  const handleAddSubtask = React.useCallback(() => {
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    setSubtasks((current) => [
      ...current,
      { id: crypto.randomUUID(), title: trimmed },
    ]);
    setNewSubtaskTitle("");
  }, [newSubtaskTitle]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    setFieldErrors({});
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);

    try {
      const draft: TaskEditorDraft = {
        title: (formData.get("title") as string) || "",
        sprintId: (formData.get("sprintId") as string) || null,
        assigneeId: (formData.get("assigneeId") as string) || null,
        priority:
          (formData.get("priority") as "low" | "medium" | "high" | "urgent") ||
          "medium",
        status: (formData.get("status") as TaskEditorDraft["status"]) || "todo",
        description: (formData.get("description") as string) || "",
        dueDate: dueDate.trim() || null,
        storyPoints: storyPoints.trim() ? Number.parseInt(storyPoints, 10) : null,
      };

      const parsed = taskEditorDraftSchema.safeParse(draft);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const path = issue.path[0];
          if (typeof path === "string" && !errors[path]) {
            errors[path] = issue.message;
          }
        }
        setFieldErrors(errors);
        setSubmitError(
          parsed.error.issues[0]?.message || "Task details are invalid",
        );
        return;
      }

      const result = await onCreate({
        draft: parsed.data,
        subtasks,
        attachments,
      });
      if (!result.success) {
        setSubmitError(result.error || "Couldn’t create task");
        return;
      }

      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Ignore dismissal while saving, so a half-submitted task cannot be closed away. */}
      <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[200] bg-black/60 backdrop-blur-none"
          onCloseAutoFocus={(event) => {
            if (openerRef.current) {
              event.preventDefault();
              openerRef.current.focus();
            }
          }}
          className="z-[201] flex max-h-[88vh] w-full sm:max-w-[640px] flex-col gap-0 overflow-hidden rounded-[12px] border border-[#DBD5C8] bg-card p-0 shadow-2xl dark:border-white/10"
        >
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 w-full flex-col"
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
              <DialogHeader className="space-y-0.5 text-left">
                <DialogTitle className="text-base font-semibold text-foreground">
                  Create task
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Create a new task
                </DialogDescription>
              </DialogHeader>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close create task dialog"
                className="nb-touch-target size-7 flex items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Scrollable Modal Body */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {submitError ? (
                <div
                  role="alert"
                  className="rounded-[5px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-mono text-destructive"
                >
                  {submitError}
                </div>
              ) : null}

              {/* Section 1: Basics */}
              <div className="space-y-3.5">
                <SectionDivider title="Basics" />

                <Field
                  label="Task title"
                  htmlFor="task-title"
                  required
                  error={fieldErrors.title}
                >
                  <input
                    id="task-title"
                    name="title"
                    required
                    defaultValue=""
                    placeholder="e.g., Conduct end-to-end testing on core flows"
                    className={inputClassName(!!fieldErrors.title)}
                    autoFocus
                  />
                </Field>

                <Field
                  label="Description"
                  htmlFor="task-description"
                  error={fieldErrors.description}
                >
                  <textarea
                    id="task-description"
                    name="description"
                    defaultValue=""
                    placeholder="Add context, acceptance criteria, or implementation notes…"
                    rows={3}
                    className={cn(
                      inputClassName(!!fieldErrors.description),
                      "min-h-[72px] resize-none py-2",
                    )}
                  />
                </Field>
              </div>

              {/* Section 2: Planning & Assignment */}
              <div className="space-y-3.5">
                <SectionDivider title="Sprint and assignee" />

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <Field
                    label="Sprint"
                    htmlFor="task-sprint"
                    error={fieldErrors.sprintId}
                    hint={canAssignSprint ? undefined : "Only the owner can add tasks to a sprint."}
                  >
                    <div className="relative">
                      <select
                        id="task-sprint"
                        name="sprintId"
                        defaultValue=""
                        className={cn(
                          inputClassName(!!fieldErrors.sprintId),
                          "appearance-none pl-9 pr-9 cursor-pointer",
                        )}
                      >
                        <option value="">Backlog (no sprint)</option>
                        {availableSprints.map((sprint) => {
                          const isAssignable = canAssignSprint && isAssignableSprintOption(sprint);
                          const status = SPRINT_STATUS_PRESENTATION[sprint.status as keyof typeof SPRINT_STATUS_PRESENTATION]?.label ?? sprint.status;
                          return (
                            <option
                              key={sprint.id}
                              value={sprint.id}
                              disabled={!isAssignable}
                            >
                              {sprint.name}
                              {isAssignableSprintOption(sprint) ? "" : ` (${status})`}
                            </option>
                          );
                        })}
                      </select>
                      <Zap className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </Field>

                  <Field
                    label="Assignee"
                    htmlFor="task-assignee"
                    error={fieldErrors.assigneeId}
                  >
                    <div className="relative">
                      <select
                        id="task-assignee"
                        name="assigneeId"
                        defaultValue=""
                        className={cn(
                          inputClassName(!!fieldErrors.assigneeId),
                          "appearance-none pl-9 pr-9 cursor-pointer",
                        )}
                      >
                        <option value="">Unassigned</option>
                        {availableMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.label}
                          </option>
                        ))}
                      </select>
                      <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </Field>

                  <Field
                    label="Status"
                    htmlFor="task-status"
                    error={fieldErrors.status}
                  >
                    <div className="relative">
                      <select
                        id="task-status"
                        name="status"
                        defaultValue="todo"
                        className={cn(
                          inputClassName(!!fieldErrors.status),
                          "appearance-none pl-3 pr-9 cursor-pointer font-medium",
                        )}
                      >
                        {TASK_WORKFLOW_STATUSES.map((status) => (
                          <option key={status} value={status} disabled={status === "done" && !completionPolicy.data}>
                            {status === "done" ? completionActionLabel(completionPolicy.data?.reviewRequired ?? false) : getTaskStatusPresentation(status).label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </Field>

                  <Field
                    label="Priority"
                    htmlFor="task-priority"
                    error={fieldErrors.priority}
                  >
                    <div className="relative">
                      <select
                        id="task-priority"
                        name="priority"
                        defaultValue="medium"
                        className={cn(
                          inputClassName(!!fieldErrors.priority),
                          "appearance-none pl-3 pr-9 cursor-pointer font-medium",
                        )}
                      >
                        {TASK_PRIORITY_VALUES.map((priority) => (
                          <option key={priority} value={priority}>
                            {getTaskPriorityPresentation(priority).label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </Field>
                </div>
              </div>

              {/* Section 3: Schedule & Estimate */}
              <div className="space-y-3.5">
                <SectionDivider title="Schedule" />

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <Field
                    label="Due date"
                    htmlFor="task-due-date"
                    error={fieldErrors.dueDate}
                  >
                    <div className="space-y-1.5">
                      <input
                        id="task-due-date"
                        type="date"
                        name="dueDate"
                        value={dueDate}
                        onChange={(e) => {
                          setDueDate(e.target.value);
                          setFieldErrors((prev) => {
                            if (!prev.dueDate) return prev;
                            const { dueDate: _, ...rest } = prev;
                            return rest;
                          });
                        }}
                        className={cn(
                          "nb-touch-target h-[34px]",
                          inputClassName(!!fieldErrors.dueDate),
                          "font-mono",
                        )}
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="shrink-0 font-mono text-[10px] max-md:text-[11px] uppercase tracking-[0.06em] text-muted-foreground mr-0.5 whitespace-nowrap">
                          Quick dates:
                        </span>
                        {[
                          { label: "1 week", days: 7 },
                          { label: "2 weeks", days: 14 },
                          { label: "4 weeks", days: 28 },
                        ].map((preset) => {
                          const isActive = selectedDays === preset.days;
                          return (
                            <button
                              key={preset.days}
                              type="button"
                              onClick={() => handleQuickSetDueDate(preset.days)}
                              className={cn(
                                "inline-flex h-6 items-center rounded-[3px] shrink-0 whitespace-nowrap border px-1.5 font-mono text-[10px] max-md:text-[11px] uppercase tracking-[0.06em] transition-colors",
                                isActive
                                  ? "border-primary bg-primary/10 text-primary font-semibold"
                                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground font-medium",
                              )}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </Field>

                  <div data-story-point>
                  <Field
                    label="Estimate"
                    htmlFor="task-story-points"
                    error={fieldErrors.storyPoints}
                  >
                    <div className="space-y-1.5">
                      <input
                        id="task-story-points"
                        name="storyPoints"
                        type="number"
                        min={0}
                        max={100}
                        value={storyPoints}
                        onChange={(e) => setStoryPoints(e.target.value)}
                        placeholder="e.g., 3, 5, 8"
                        className={cn(
                          "nb-touch-target h-[34px]",
                          inputClassName(!!fieldErrors.storyPoints),
                          "font-mono",
                        )}
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="shrink-0 font-mono text-[10px] max-md:text-[11px] uppercase tracking-[0.06em] text-muted-foreground mr-0.5 whitespace-nowrap">
                          Presets:
                        </span>
                        {[1, 2, 3, 5, 8, 13].map((points) => (
                          <button
                            key={points}
                            type="button"
                            onClick={() =>
                              setStoryPoints(
                                storyPoints === String(points)
                                  ? ""
                                  : String(points),
                              )
                            }
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-[3px] shrink-0 whitespace-nowrap border font-mono text-[10px] max-md:text-[11px] font-semibold transition-colors",
                              storyPoints === String(points)
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {points}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Field>
                  </div>
                </div>
              </div>

              {/* Section 4: Subtasks & References */}
              <div className="space-y-3.5">
                <SectionDivider title="Subtasks and files">
                  <div className="flex items-center gap-2">
                    {subtasks.length > 0 && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/40 px-1 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground">
                        {subtasks.length} {subtasks.length === 1 ? "subtask" : "subtasks"}
                      </span>
                    )}
                    {attachments.length > 0 && (
                      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-border bg-muted/40 px-1 font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground">
                        {attachments.length} {attachments.length === 1 ? "file" : "files"}
                      </span>
                    )}
                  </div>
                </SectionDivider>

                {/* Subtasks Block */}
                <div className="space-y-2">
                  <label className="block text-[13px] font-medium text-foreground">
                    Subtasks
                  </label>

                  {subtasks.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {subtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center justify-between gap-2 rounded-[5px] border border-border bg-muted/20 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted/40"
                        >
                          {plainContentHeadings ? <span className="min-w-0 truncate">{subtask.title}</span> : (
                            <div className="flex items-center gap-2 min-w-0">
                              <CheckSquare className="size-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate">{subtask.title}</span>
                            </div>
                          )}
                          <button
                            type="button"
                            aria-label={`Remove subtask ${subtask.title}`}
                            onClick={() =>
                              setSubtasks((current) =>
                                current.filter((item) => item.id !== subtask.id),
                              )
                            }
                            className="text-muted-foreground transition-colors hover:text-destructive shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      aria-label="New subtask title"
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        handleAddSubtask();
                      }}
                      placeholder="Add a subtask…"
                      className={cn(inputClassName(false), "flex-1")}
                    />
                    <button
                      type="button"
                      onClick={handleAddSubtask}
                      disabled={!newSubtaskTitle.trim()}
                      className="nb-touch-target h-[34px] rounded-[5px] border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50 shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {/* Task References / Attachments Block */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-[13px] font-medium text-foreground">
                      Task references
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsFilePickerOpen(true)}
                      className="nb-touch-target inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-dashed border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      <Paperclip className="size-3" />
                      Attach files
                    </button>
                  </div>

                  {attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="flex items-center gap-2 rounded-[5px] border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground font-mono"
                        >
                          <Paperclip className="size-3 text-muted-foreground shrink-0" />
                          <span className="max-w-[180px] truncate">
                            {attachment.name}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${attachment.name}`}
                            onClick={() =>
                              setAttachments((current) =>
                                current.filter(
                                  (item) => item.id !== attachment.id,
                                ),
                              )
                            }
                            className="text-muted-foreground transition-colors hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No files or design assets attached yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#DBD5C8] bg-[#F3F0EA] px-6 py-3.5 dark:border-white/10 dark:bg-white/5">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="nb-touch-target h-[34px] rounded-[5px] border border-border bg-card px-4 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="nb-touch-target h-[34px] rounded-[5px] bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-2xs transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Creating..." : "Create task"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <MultiAttachmentPicker
        isOpen={isFilePickerOpen}
        onClose={() => setIsFilePickerOpen(false)}
        projectId={projectId}
        projectName={projectName}
        initialAttachments={attachments}
        onConfirm={setAttachments}
      />
    </>
  );
}
