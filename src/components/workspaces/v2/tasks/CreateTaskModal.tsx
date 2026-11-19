"use client";

import { useTaskCompletionPolicy } from "@/hooks/useTaskCompletionPolicy";
import { completionActionLabel } from "@/lib/workspaces/task-completion-policy";
import React from "react";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/workspaces/sprint-detail";
import { CheckSquare, ChevronDown, Paperclip, Trash2, User, X, Zap } from "lucide-react";
import { usePlainContentHeadings } from "@/components/workspaces/PlainContentHeadings";

import { cn } from "@/lib/utils";
import type { WorkspaceNode } from "@/lib/db/schema";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { footerLine, moduleTabs, sectionsFor, sprintApplies, startingStages } from "@/lib/workflows/create-rules";
import { defaultStageFor } from "@/lib/workflows/rules";
import { workflowType } from "@/lib/workflows/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MultiAttachmentPicker } from "../files-tab/picker/MultiAttachmentPicker";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, SectionDivider } from "./form-parts";
import {
  taskEditorDraftSchema,
  type TaskEditorDraft,
  type TaskEditorSubtaskDraft,
} from "@/lib/workspaces/task-draft";
import {
  isAssignableSprintOption,
  normalizeAssignableMembers,
  normalizeSprintOptions,
} from "@/lib/workspaces/task-presentation";
import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/workspaces/task-workflow";
import {
  addDaysToSprintDateInput,
  formatSprintDateInput,
  parseSprintDateInput,
} from "@/lib/workspaces/sprints";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    draft: TaskEditorDraft;
    subtasks: TaskEditorSubtaskDraft[];
    attachments: WorkspaceNode[];
  }) => Promise<{ success: boolean; error?: string; code?: string }>;
  members?: any[];
  sprints?: any[];
  projectId: string;
  projectName?: string;
  /** Only the owner may put a new task in a sprint (the server enforces the same). */
  canAssignSprint?: boolean;
  /**
   * One form (report §16.1, §34.7; decisions 10, 25, 89): many people in Assign to carries the title and
   * description on to the assignment form (an organization) or the team form (a workspace in one).
   */
  manyOptions?: Array<{ value: string; label: string }>;
  onAssignMany?: (choice: string, carry: { title: string; description: string }) => void;
  /**
   * An organization (board/review report §4): the Assignment tab's form. Title, description and sprint carry across
   * the tabs; `onDraft` reports the assignment form's own changes back so switching to Task keeps them.
   */
  renderMany?: (many: { choice: string; title: string; description: string; sprintId: string; dueDate: string; onDraft: (carry: { title: string; description: string; sprintId: string; dueDate: string }) => void; onDone: () => void }) => React.ReactNode;
  /** Opens on this tab (+ New → Assignment). */
  initialKind?: "task" | "assignment";
  /** Report 38.4 S2: item types the workspace's workflows add (bug, request, content); each becomes a tab. */
  types?: string[];
  /** Opened from Tasks (types start where they join the board) or a type's own tab (its first stage). */
  openedFrom?: "tasks" | "own";
  initialType?: string;
  /** Report 38.4 W5: opened from a quick-add line, the typed title carries in and where it came from shows read-only. */
  initialTitle?: string;
  fromLine?: string;
  /** Report 38.5 W8: + on a Calendar day opens New with that due date (YYYY-MM-DD). */
  initialDueDate?: string;
  /** Report 38.5 W3: + New task in a project's Work tab; shown read-only under Basics. */
  partOf?: { id: string; title: string } | null;
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
  manyOptions = [],
  onAssignMany,
  renderMany,
  initialKind = "task",
  types = [],
  openedFrom = "tasks",
  initialType,
  initialTitle = "",
  fromLine,
  initialDueDate = "",
  partOf = null,
}: CreateTaskModalProps) {
  // Board/review report §4: an organization's New has two tabs, Task and Assignment; what's typed carries across.
  const startKind = initialType && types.includes(initialType) ? initialType : renderMany ? initialKind : "task";
  const [kind, setKind] = React.useState<string>(startKind);
  // A typed item (bug, request, content) starts at a stage; the stage sets where it shows (report 38.4 S2).
  const typed = kind !== "task" && kind !== "assignment";
  const [stage, setStage] = React.useState<string | null>(typed ? defaultStageFor(kind, openedFrom) : null);
  const typeLabel = kind === "task" ? "Task" : kind === "assignment" ? "Assignment" : workflowType(kind).label;
  const [carry, setCarry] = React.useState({ title: initialTitle, description: "", sprintId: "", dueDate: "" });
  const formRef = React.useRef<HTMLFormElement>(null);
  const switchKind = (next: string) => {
    if (next === kind) return;
    // Title, description, assignee, due, sprint and files stay (W3): the same form keeps them; only the stage resets.
    setStage(next !== "task" && next !== "assignment" ? defaultStageFor(next, openedFrom) : null);
    setTypeRemoved(false);
    if (next === "assignment" && formRef.current) {
      const read = (name: string) => String((formRef.current?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "");
      setCarry({ title: read("title"), description: read("description"), sprintId: read("sprintId"), dueDate });
    }
    // Assignment form redesign: the due day comes back too.
    if (kind === "assignment") setDueDate(carry.dueDate);
    setKind(next);
  };
  React.useEffect(() => {
    if (!isOpen) return;
    setKind(startKind);
    setStage(startKind !== "task" && startKind !== "assignment" ? defaultStageFor(startKind, openedFrom) : null);
  }, [isOpen]);
  const [typeRemoved, setTypeRemoved] = React.useState(false);
  const many = renderMany && kind === "assignment";
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
  const [attachments, setAttachments] = React.useState<WorkspaceNode[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [isFilePickerOpen, setIsFilePickerOpen] = React.useState(false);
  const [storyPoints, setStoryPoints] = React.useState<string>("");
  // No due date unless one is chosen.
  const [dueDate, setDueDate] = React.useState<string>(initialDueDate);

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
        ...(typed ? { itemType: kind, stage } : {}),
        ...(sectionsFor(kind).startDate && formData.get("startDate") ? { startDate: String(formData.get("startDate")) } : {}),
        ...(partOf && kind !== "project" ? { partOfId: partOf.id } : {}),
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
        // W8: the type was hidden while the module was open; offer to make it a task instead.
        setTypeRemoved(result.code === "type_removed");
        return;
      }

      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Modal Header
  const header = (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
      <DialogHeader className="space-y-0.5 text-left">
        <DialogTitle className="text-base font-semibold text-foreground">
          {renderMany && !typed ? "New" : `Create ${typeLabel.toLowerCase()}`}
        </DialogTitle>
        {/* Student check 19: screen readers hear what an assignment does (the header stays caption-free). */}
        <DialogDescription className="sr-only">
          {many ? "Everyone it goes to gets their own copy." : "Create a new task"}
        </DialogDescription>
      </DialogHeader>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close the ${typeLabel.toLowerCase()} dialog`}
        className="nb-touch-target size-7 flex items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );

  const tabKeys = moduleTabs(types, { assignment: Boolean(renderMany) });
  const kindTabs = tabKeys.length > 1 ? (
    <div className="shrink-0 px-6">
      <UnderlineTabs label="What are you creating?" idPrefix="new-kind" controls={false} value={kind} onChange={switchKind}
        tabs={tabKeys.map((key) => ({ key, label: key === "task" ? "Task" : key === "assignment" ? "Assignment" : workflowType(key).label }))} />
      {renderMany && !typed ? <p className="pt-2 text-[13px] text-muted-foreground">{kind === "task" ? "One piece of work for one person." : "Everyone it goes to gets their own copy to hand in."}</p> : null}
    </div>
  ) : null;
  const footer = typed ? footerLine(kind, stage, canAssignSprint) : null;

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
          className={cn("z-[201]", FORM_DIALOG_CLASS)}
        >
          {many ? (
            <div className="flex min-h-0 w-full flex-col">
              {header}
              {kindTabs}
              {/* The assignment form draws its own scrolling body and footer, like this form's. */}
              {renderMany({ choice: "everyone", title: carry.title, description: carry.description, sprintId: carry.sprintId, dueDate: carry.dueDate, onDraft: setCarry, onDone: onClose })}
            </div>
          ) : (
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            // Report 38.4 W10: ⌘/Ctrl + Enter creates from any field.
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); formRef.current?.requestSubmit(); } }}
            className="flex min-h-0 w-full flex-col"
          >
            {header}
            {kindTabs}

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
                  label={`${typeLabel} title`}
                  htmlFor="task-title"
                  required
                  error={fieldErrors.title}
                >
                  <input
                    id="task-title"
                    name="title"
                    required
                    defaultValue={carry.title}
                    placeholder={kind === "project" ? "e.g., Website relaunch" : "e.g., Conduct end-to-end testing on core flows"}
                    className={inputClassName(!!fieldErrors.title)}
                    autoFocus
                  />
                </Field>
                {fromLine ? <p className="text-xs text-muted-foreground" data-testid="create-from-line">From: <span className="font-medium text-foreground">{fromLine}</span></p> : null}
                {partOf ? <p className="text-xs text-muted-foreground" data-testid="create-partof-line">Part of: <span className="font-medium text-foreground">{partOf.title}</span></p> : null}

                <Field
                  label="Description"
                  htmlFor="task-description"
                  error={fieldErrors.description}
                >
                  <textarea
                    id="task-description"
                    name="description"
                    defaultValue={carry.description}
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
                <SectionDivider title={sprintApplies(kind, stage) ? "Sprint and assignee" : "Assignee"} />

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  {sprintApplies(kind, stage) ? (
                  <Field
                    label="Sprint"
                    htmlFor="task-sprint"
                    error={fieldErrors.sprintId}
                  >
                    {canAssignSprint ? (
                    <div className="relative">
                      <select
                        id="task-sprint"
                        name="sprintId"
                        defaultValue={carry.sprintId}
                        className={cn(
                          inputClassName(!!fieldErrors.sprintId),
                          "appearance-none pl-9 pr-9 cursor-pointer",
                        )}
                      >
                        <option value="">Backlog</option>
                        {availableSprints.map((sprint) => {
                          const isAssignable = isAssignableSprintOption(sprint);
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
                    ) : (
                      // Report 38.4 W4: members' new items go to the Backlog; no picker to pick from and be refused.
                      <p id="task-sprint" data-testid="sprint-backlog-note" className="flex min-h-[var(--ui-control-height)] items-center gap-2 rounded-md border border-dashed border-border px-3 text-[13px] text-muted-foreground">
                        <Zap aria-hidden="true" className="size-4 shrink-0" />Goes to the Backlog · owners and admins plan sprints
                      </p>
                    )}
                  </Field>
                  ) : null}

                  <Field
                    label="Assigned to"
                    htmlFor="task-assignee"
                    error={fieldErrors.assigneeId}
                  >
                    <div className="relative">
                      <select
                        id="task-assignee"
                        name="assigneeId"
                        defaultValue=""
                        onChange={(event) => {
                          // §4: in an organization, Assigned to is people only; the Assignment tab is where many people go.
                          const choice = renderMany ? undefined : manyOptions.find((o) => o.value === event.target.value);
                          if (!choice || !onAssignMany) return;
                          const form = event.currentTarget.form;
                          const read = (name: string) => String((form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "");
                          onAssignMany(choice.value, { title: read("title"), description: read("description") });
                        }}
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
                        {manyOptions.length && !renderMany ? (
                          <optgroup label="Many people">
                            {manyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </optgroup>
                        ) : null}
                      </select>
                      <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    </div>
                  </Field>

                  {typed ? (
                    <Field label="Starts at" htmlFor="task-stage">
                      <div className="relative">
                        <select id="task-stage" name="stage" value={stage ?? ""} onChange={(e) => setStage(e.target.value)}
                          className={cn(inputClassName(false), "appearance-none pl-3 pr-9 cursor-pointer font-medium")}>
                          {startingStages(kind).map((option) => (
                            <option key={option.key} value={option.key}>{option.label}{option.onBoard ? " · on the board" : ""}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </Field>
                  ) : (
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
                  )}

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
                <SectionDivider title={sectionsFor(kind).startDate ? "Start and end" : "Schedule"} />

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  {sectionsFor(kind).startDate ? (
                    <Field label="Start date" htmlFor="task-start-date">
                      <input id="task-start-date" name="startDate" type="date" className={inputClassName(false)} />
                    </Field>
                  ) : null}
                  <Field
                    label={sectionsFor(kind).dueLabel}
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
                      No files attached yet.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className={FORM_FOOTER_CLASS}>
              {footer ? <p className="mr-auto min-w-0 truncate text-xs text-muted-foreground" data-testid="create-footer-line">{footer}</p> : null}
              {typeRemoved ? (
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => { switchKind("task"); requestAnimationFrame(() => formRef.current?.requestSubmit()); }}>
                  Create as task
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className={FORM_SECONDARY_CLASS}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={FORM_PRIMARY_CLASS}
              >
                {isSubmitting ? "Creating…" : `Create ${typeLabel.toLowerCase()}`}
              </button>
            </div>
          </form>
          )}
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
