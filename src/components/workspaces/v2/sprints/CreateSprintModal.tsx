"use client";

import React from "react";
import { typeProfile } from "@/lib/organizations/type-profile";
import { buildSprintSeries, insideError, nextSeriesNumber, seriesPreview } from "@/lib/organizations/sprint-rules";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { z } from "zod";

import type { SprintListItem } from "@/lib/workspaces/sprint-detail";
import {
  addDaysToSprintDateInput,
  buildSprintEditorDraft,
  createSprintDraftSchema,
  getSprintDurationSummary,
  type SprintDeleteImpact,
  type SprintEditorSubmission,
  type SprintOrgFields,
  type SprintEditorDraft,
  type SprintEditorMode,
} from "@/lib/workspaces/sprints";
import { recordSprintMetric } from "@/lib/workspaces/sprint-observability";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type SprintEditorSubmitResult = {
  success: boolean;
  error?: string;
};

interface SprintEditorModalProps {
  projectId: string;
  isOpen: boolean;
  mode: SprintEditorMode;
  onClose: () => void;
  onSubmit: (data: SprintEditorSubmission) => Promise<SprintEditorSubmitResult>;
  onDelete?: () => Promise<SprintEditorSubmitResult>;
  sprint?: SprintListItem | null;
  sprintCount?: number;
  deleteImpact?: SprintDeleteImpact | null;
  /** Organizations and child projects (report §15.2, §15.5); plain projects get only "Start automatically". */
  org?: {
    kind: "org" | "child";
    orgTitle: string | null;
    orgSprints: Array<{ id: string; name: string; status: string; startDate: string; endDate: string }>;
    /** Orgs: name suggestions by type and the Work defaults for a new sprint (report §15.2, §21). */
    orgType?: string | null;
    defaults?: { autoStart: boolean; showInChildren: boolean; createMatching: boolean; notifyOnStart: boolean };
    /** Orgs: Repeat warns past it (report §28.2). Workspaces: every sprint sits inside one; group work to bring. */
    termEnd?: string | null;
    followsOrgSprints?: boolean;
    groupBacklog?: number;
  } | null;
  initialOrgFields?: SprintOrgFields;
  /** This workspace's sprints: Repeat numbering and overlaps, and Move later sprints (report §28.2). */
  existingSprints?: Array<{ id: string; name: string; startDate: string | null; endDate: string | null; status: string }>;
  /** Repeat ("Plan more like this", decision 9): creates the series instead of one sprint. */
  onRepeat?: (input: { prefix: string; count: number; lengthDays: number; startDate: string; goal: string; description: string; autoStart: boolean }) => Promise<SprintEditorSubmitResult>;
  /** Workspaces in an organization: Plan one for each planned organization sprint (report §18.2). Off by default. */
  onPlanEach?: (name: string) => Promise<SprintEditorSubmitResult>;
}

const DAY_MS = 86_400_000;
const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const rangeLabel = (start: string, end: string) => `${SHORT.format(utc(start))}–${SHORT.format(utc(end))}`;

type DraftField = keyof SprintEditorDraft;
type FieldErrors = Partial<Record<DraftField, string>>;
type PendingAction = "save" | "delete" | null;

function toFieldErrors(error: z.ZodError<z.infer<typeof createSprintDraftSchema>>) {
  const nextErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path === "string" && !(path in nextErrors)) {
      nextErrors[path as DraftField] = issue.message;
    }
  }
  return nextErrors;
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
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs font-mono text-destructive">{error}</p> : null}
    </div>
  );
}

function inputClassName(hasError: boolean) {
  return cn(
    "w-full rounded-[5px] border bg-background px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60",
    "border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
    hasError && "border-destructive focus-visible:ring-destructive",
  );
}

export default function SprintEditorModal({
  projectId,
  isOpen,
  mode,
  onClose,
  onSubmit,
  onDelete,
  sprint = null,
  sprintCount = 0,
  deleteImpact = null,
  org = null,
  initialOrgFields,
  existingSprints = [],
  onRepeat,
  onPlanEach,
}: SprintEditorModalProps) {
  // Plan your sprint (report §18.2): inside the running organization sprint, or the next planned one, by default.
  const defaultParent = mode === "create" && org?.kind === "child"
    ? org.orgSprints.find((s) => s.id === initialOrgFields?.parentSprintId) ?? org.orgSprints.find((s) => s.status === "active") ?? org.orgSprints[0] ?? null
    : null;
  const [orgFields, setOrgFields] = React.useState<SprintOrgFields>(() => ({
    autoStart: initialOrgFields?.autoStart ?? org?.defaults?.autoStart ?? true,
    showInChildren: initialOrgFields?.showInChildren ?? org?.defaults?.showInChildren ?? true,
    createMatching: mode === "create" ? org?.defaults?.createMatching ?? false : false,
    parentSprintId: initialOrgFields?.parentSprintId ?? defaultParent?.id ?? null,
    notifyOnStart: initialOrgFields?.notifyOnStart ?? org?.defaults?.notifyOnStart ?? true,
    moveDueDates: false,
    moveLaterSprints: false,
    includeGroupWork: true,
  }));
  const [repeat, setRepeat] = React.useState(false);
  const [planEach, setPlanEach] = React.useState(false);
  const plannedOrgSprints = org?.kind === "child" ? org.orgSprints.filter((s) => s.status === "planning").length : 0;
  const [repeatCount, setRepeatCount] = React.useState(4);
  const initialDraft = React.useCallback((): SprintEditorDraft => {
    const base = buildSprintEditorDraft({ sprint, sprintCount });
    if (mode !== "create") return base;
    // Report §7.6, smaller bug 14: an organization's next name follows its type ("CO4" for Education).
    if (org?.kind === "org") {
      const prefix = typeProfile(org.orgType).sprintPrefix;
      return { ...base, name: `${prefix}${nextSeriesNumber(prefix, existingSprints.map((s) => s.name))}` };
    }
    // A team sprint's name is its own (report §18.2); its dates start inside the organization sprint.
    if (org?.kind === "child" && defaultParent) {
      const today = new Date().toISOString().slice(0, 10);
      const start = defaultParent.startDate.slice(0, 10) > today ? defaultParent.startDate.slice(0, 10) : today;
      return { ...base, name: "", startDate: start, endDate: defaultParent.endDate.slice(0, 10) };
    }
    return base;
  }, [defaultParent, existingSprints, mode, org, sprint, sprintCount]);
  const [draft, setDraft] = React.useState<SprintEditorDraft>(initialDraft);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = React.useState("");
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const firstFieldRef = React.useRef<HTMLInputElement>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const pendingActionRef = React.useRef<PendingAction>(null);
  const onCloseRef = React.useRef(onClose);
  const editorKey = `${mode}:${sprint?.id ?? "new"}`;
  const initializedDraftKeyRef = React.useRef<string | null>(isOpen ? editorKey : null);

  React.useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen) {
      initializedDraftKeyRef.current = null;
      return;
    }
    if (initializedDraftKeyRef.current === editorKey) return;
    initializedDraftKeyRef.current = editorKey;
    setDraft(initialDraft());
    setRepeat(false);
    setPlanEach(false);
    setFieldErrors({});
    setErrorMessage("");
    setPendingAction(null);
    setConfirmDelete(false);
  }, [editorKey, initialDraft, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  const scheduleSummary = React.useMemo(
    () => getSprintDurationSummary(draft.startDate, draft.endDate),
    [draft.endDate, draft.startDate],
  );
  const parent = org?.kind === "child" ? org.orgSprints.find((s) => s.id === orgFields.parentSprintId) ?? null : null;
  // Report §18.2: errors appear beside the dates before saving.
  const dateError = parent && draft.startDate && draft.endDate
    ? insideError({ startDate: utc(draft.startDate), endDate: utc(draft.endDate) }, { name: parent.name, startDate: utc(parent.startDate), endDate: utc(parent.endDate) })
    : null;
  const lengthDays = draft.startDate && draft.endDate ? Math.round((utc(draft.endDate).getTime() - utc(draft.startDate).getTime()) / DAY_MS) + 1 : 0;
  const prefix = draft.name.replace(/\d+$/, "") || "Sprint ";
  // Repeat's live preview (report §16.2, §28.2): organization sprints can't overlap; the term end only warns.
  const preview = React.useMemo(() => {
    if (!repeat || lengthDays < 1 || !draft.startDate) return null;
    try {
      const rows = buildSprintSeries({ prefix, count: repeatCount, lengthDays, startDate: draft.startDate, firstNumber: nextSeriesNumber(prefix, existingSprints.map((s) => s.name)) });
      const live = org?.kind === "org"
        ? existingSprints.filter((s) => s.startDate && s.endDate && ["planning", "active", "completed"].includes(s.status)).map((s) => ({ name: s.name, startDate: utc(s.startDate!), endDate: utc(s.endDate!) }))
        : [];
      return seriesPreview(rows, live, org?.kind === "org" ? org.termEnd : null);
    } catch {
      return null;
    }
  }, [draft.startDate, existingSprints, lengthDays, org, prefix, repeat, repeatCount]);
  // Move later sprints too (decision 59): only Planning sprints that start after this one.
  const shiftDays = sprint?.startDate && draft.startDate ? Math.round((utc(draft.startDate).getTime() - utc(sprint.startDate).getTime()) / DAY_MS) : 0;
  const laterSprints = mode === "edit" && sprint?.status === "planning" && sprint.startDate
    ? existingSprints.filter((s) => s.id !== sprint.id && s.status === "planning" && s.startDate && s.startDate > sprint.startDate!)
    : [];
  const isRunning = mode === "edit" && sprint?.status === "active";

  const handleFieldChange = React.useCallback((field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      return {
        ...current,
        [field]: undefined,
      };
    });
  }, []);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage("");

      const parsed = createSprintDraftSchema.safeParse(draft);
      if (!parsed.success) {
        setFieldErrors(toFieldErrors(parsed.error));
        setErrorMessage(parsed.error.issues[0]?.message ?? "Sprint details are invalid");
        recordSprintMetric("project.sprint.editor.validation", {
          projectId,
          sprintId: sprint?.id ?? null,
          mode,
          field: parsed.error.issues[0]?.path[0] ?? "unknown",
          issueCount: parsed.error.issues.length,
        });
        return;
      }

      if (dateError) {
        setErrorMessage(dateError);
        return;
      }
      setPendingAction("save");
      try {
        const result = planEach && onPlanEach
          ? await onPlanEach(parsed.data.name)
          : repeat && onRepeat
          ? await onRepeat({ prefix, count: repeatCount, lengthDays, startDate: parsed.data.startDate, goal: parsed.data.goal ?? "", description: parsed.data.description ?? "", autoStart: orgFields.autoStart ?? true })
          : await onSubmit({
          ...parsed.data,
          autoStart: orgFields.autoStart,
          ...(org?.kind === "org" ? { showInChildren: orgFields.showInChildren, createMatching: mode === "create" && orgFields.createMatching, notifyOnStart: orgFields.notifyOnStart, ...(mode === "edit" ? { moveDueDates: orgFields.moveDueDates } : {}) } : {}),
          ...(org?.kind === "child" ? { parentSprintId: orgFields.parentSprintId ?? null, ...(mode === "create" ? { includeGroupWork: orgFields.includeGroupWork } : {}) } : {}),
          ...(mode === "edit" && laterSprints.length && shiftDays ? { moveLaterSprints: orgFields.moveLaterSprints } : {}),
        });
        if (!result.success) {
          setErrorMessage(result.error ?? "Couldn’t save sprint");
          return;
        }
        onClose();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Couldn’t save sprint");
      } finally {
        setPendingAction(null);
      }
    },
    [dateError, draft, laterSprints.length, lengthDays, mode, onClose, onPlanEach, onRepeat, onSubmit, planEach, org?.kind, orgFields, prefix, projectId, repeat, repeatCount, shiftDays, sprint?.id],
  );

  const handleDelete = React.useCallback(async () => {
    if (!onDelete || !deleteImpact?.canDelete) return;
    setErrorMessage("");
    setPendingAction("delete");
    try {
      const result = await onDelete();
      if (!result.success) {
        setErrorMessage(result.error ?? "Couldn’t delete sprint");
        return;
      }
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Couldn’t delete sprint");
    } finally {
      setPendingAction(null);
    }
  }, [deleteImpact?.canDelete, onClose, onDelete]);

  const setDuration = React.useCallback((days: number) => {
    if (!draft.startDate) return;
    handleFieldChange("endDate", addDaysToSprintDateInput(draft.startDate, days));
  }, [draft.startDate, handleFieldChange]);
  /** A shortcut that would pass the organization sprint's end is off, with the reason (report §18.2). */
  const tooLong = (days: number) => Boolean(parent && draft.startDate && addDaysToSprintDateInput(draft.startDate, days) > parent.endDate.slice(0, 10));

  if (!isOpen) return null;

  const isSubmitting = pendingAction === "save";
  const isDeleting = pendingAction === "delete";

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !pendingAction) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[88vh] w-full sm:max-w-[640px] flex-col overflow-hidden p-0 rounded-[8px] border border-border bg-card shadow-2xl dark:border-white/10"
        onCloseAutoFocus={(e) => {
          if (previousFocusRef.current) {
            e.preventDefault();
            previousFocusRef.current.focus();
          }
        }}
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold text-foreground">
              {mode === "create" ? "Create sprint" : "Edit sprint"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {mode === "create"
                ? "Set the goal and dates."
                : "Edit sprint details."}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Close sprint editor"
            onClick={onClose}
            disabled={!!pendingAction}
            className="rounded-[5px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form
          id="sprint-editor-form"
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col overflow-hidden"
        >
          {/* Scrollable Form Body */}
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {errorMessage ? (
              <div
                role="alert"
                className="rounded-[5px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-mono text-destructive"
              >
                {errorMessage}
              </div>
            ) : null}

            {/* Basics Section */}
            <div className="space-y-3.5">
              <SectionDivider title="Basics" />

              <Field label="Sprint name" htmlFor="sprint-name" required error={fieldErrors.name}>
                <input
                  ref={firstFieldRef}
                  id="sprint-name"
                  required
                  value={draft.name}
                  onChange={(event) => handleFieldChange("name", event.target.value)}
                  placeholder={org?.kind === "org" ? `e.g., ${typeProfile(org.orgType).sprintPrefix}1` : org?.kind === "child" ? "e.g., Parser week" : "e.g., Sprint 4"}
                  className={cn("nb-touch-target h-[34px]", inputClassName(!!fieldErrors.name))}
                />
              </Field>

              <Field label="Sprint goal" htmlFor="sprint-goal" error={fieldErrors.goal}>
                <input
                  id="sprint-goal"
                  value={draft.goal}
                  onChange={(event) => handleFieldChange("goal", event.target.value)}
                  placeholder="What should this sprint accomplish?"
                  className={cn("nb-touch-target h-[34px]", inputClassName(!!fieldErrors.goal))}
                />
              </Field>

              <Field label="Description" htmlFor="sprint-description" error={fieldErrors.description}>
                <textarea
                  id="sprint-description"
                  rows={2}
                  value={draft.description}
                  onChange={(event) => handleFieldChange("description", event.target.value)}
                  placeholder="Additional context, scope, or coordination notes."
                  className={cn(inputClassName(!!fieldErrors.description), "min-h-[64px] resize-none py-2")}
                />
              </Field>
            </div>

            {/* Schedule Section */}
            <div className="space-y-3.5">
              <SectionDivider title="Schedule">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] max-md:text-[11px] uppercase tracking-[0.06em] text-muted-foreground mr-0.5">
                    Quick dates:
                  </span>
                  <button
                    type="button"
                    onClick={() => setDuration(7)}
                    disabled={tooLong(7)}
                    title={tooLong(7) && parent ? `Ends after ${parent.name}` : undefined}
                    className="inline-flex h-6 items-center rounded-[3px] border border-border bg-card px-2 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    1 week
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration(14)}
                    disabled={tooLong(14)}
                    title={tooLong(14) && parent ? `Ends after ${parent.name}` : undefined}
                    className="inline-flex h-6 items-center rounded-[3px] border border-border bg-card px-2 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    2 weeks
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration(28)}
                    disabled={tooLong(28)}
                    title={tooLong(28) && parent ? `Ends after ${parent.name}` : undefined}
                    className="inline-flex h-6 items-center rounded-[3px] border border-border bg-card px-2 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    4 weeks
                  </button>
                </div>
              </SectionDivider>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date" htmlFor="sprint-start-date" required error={fieldErrors.startDate}>
                  <input
                    id="sprint-start-date"
                    type="date"
                    required
                    disabled={isRunning}
                    title={isRunning ? "A running sprint keeps its start date." : undefined}
                    min={parent?.startDate.slice(0, 10)}
                    max={parent?.endDate.slice(0, 10)}
                    value={draft.startDate}
                    onChange={(event) => handleFieldChange("startDate", event.target.value)}
                    className={cn("nb-touch-target h-[34px]", inputClassName(!!fieldErrors.startDate))}
                  />
                </Field>

                <Field label="End date" htmlFor="sprint-end-date" required error={fieldErrors.endDate}>
                  <input
                    id="sprint-end-date"
                    type="date"
                    required
                    min={draft.startDate}
                    max={parent?.endDate.slice(0, 10)}
                    value={draft.endDate}
                    onChange={(event) => handleFieldChange("endDate", event.target.value)}
                    className={cn("nb-touch-target h-[34px]", inputClassName(!!fieldErrors.endDate))}
                  />
                </Field>
              </div>

              <div className="flex items-center gap-2 rounded-[5px] border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {scheduleSummary?.label ?? "Set valid start and end dates to see the sprint duration."}
                </span>
                {sprint?.status === "active" ? (
                  <span className="ml-auto text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Active
                  </span>
                ) : null}
              </div>
              {dateError ? <p role="alert" className="text-xs font-mono text-destructive">{dateError}</p> : null}

              {mode === "create" && onRepeat && org?.kind !== "child" ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[13px] text-foreground">
                    <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                    Plan more sprints like this
                  </label>
                  {repeat ? (
                    <div className="space-y-2 rounded-[5px] border border-border p-3">
                      <label className="flex items-center gap-2 text-[13px] text-foreground">How many
                        <input type="number" min={2} max={52} value={repeatCount} onChange={(e) => setRepeatCount(Math.max(2, Math.min(52, Number(e.target.value) || 2)))}
                          className={cn("h-[30px] w-20", inputClassName(false))} />
                      </label>
                      {preview ? (
                        <ul aria-label="Sprints to create" className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[12px]">
                          {preview.rows.map((row) => (
                            <li key={row.name} className={cn(row.clash ? "text-destructive" : "text-foreground")}>
                              {row.name} · {rangeLabel(row.startDate, row.endDate)}
                              {row.clash ? ` · Overlaps ${row.clash}` : ""}
                              {row.pastTermEnd ? <span className="text-amber-600 dark:text-amber-400"> · Passes the term end</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-xs text-muted-foreground">Set valid dates to see the sprints.</p>}
                      {preview?.blocked && preview.startAfter ? (
                        <button type="button" className="text-xs font-medium text-primary hover:underline"
                          onClick={() => { const start = preview.startAfter!; handleFieldChange("startDate", start); handleFieldChange("endDate", addDaysToSprintDateInput(start, lengthDays - 1)); }}>
                          Start after {preview.rows.find((r) => r.clash)?.clash}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {laterSprints.length && shiftDays ? (
                <label className="flex items-start gap-2 text-[13px] text-foreground">
                  <input type="checkbox" className="mt-0.5" checked={orgFields.moveLaterSprints ?? false} onChange={(e) => setOrgFields((f) => ({ ...f, moveLaterSprints: e.target.checked }))} />
                  <span>Move later sprints too<span className="block text-[12px] text-muted-foreground">
                    {laterSprints.map((s) => s.name).join(", ")} also {laterSprints.length === 1 ? "moves" : "move"} by {Math.abs(shiftDays)} {Math.abs(shiftDays) === 1 ? "day" : "days"}.
                  </span></span>
                </label>
              ) : null}
            </div>

            {/* Organization: start on the date, child projects, or the org sprint this sits inside (report §15) */}
            <div className="space-y-3">
              <SectionDivider title={org ? "Organization" : "Start"} />
              <label className="flex items-center gap-2 text-[13px] text-foreground">
                <input type="checkbox" checked={orgFields.autoStart ?? true} onChange={(e) => setOrgFields((f) => ({ ...f, autoStart: e.target.checked }))} />
                Start automatically on the start date
              </label>
              {org?.kind === "org" ? (
                <>
                  <label className="flex items-center gap-2 text-[13px] text-foreground">
                    <input type="checkbox" checked={orgFields.showInChildren ?? true} onChange={(e) => setOrgFields((f) => ({ ...f, showInChildren: e.target.checked }))} />
                    Add to every workspace in the organization
                  </label>
                  {mode === "create" ? (
                    <label className="flex items-center gap-2 text-[13px] text-foreground">
                      <input type="checkbox" checked={orgFields.createMatching ?? false} onChange={(e) => setOrgFields((f) => ({ ...f, createMatching: e.target.checked }))} />
                      Create a matching sprint in every workspace in the organization
                    </label>
                  ) : null}
                  <label className="flex items-center gap-2 text-[13px] text-foreground">
                    <input type="checkbox" checked={orgFields.notifyOnStart ?? true} onChange={(e) => setOrgFields((f) => ({ ...f, notifyOnStart: e.target.checked }))} />
                    Notify members when it starts
                  </label>
                  {mode === "edit" ? (
                    <label className="flex items-start gap-2 text-[13px] text-foreground">
                      <input type="checkbox" className="mt-0.5" checked={orgFields.moveDueDates ?? false} onChange={(e) => setOrgFields((f) => ({ ...f, moveDueDates: e.target.checked }))} />
                      <span>Move due dates too<span className="block text-[12px] text-muted-foreground">If the dates change, its assignments move by the same number of days.</span></span>
                    </label>
                  ) : null}
                </>
              ) : null}
              {org?.kind === "child" && org.orgSprints.length > 0 ? (
                <Field label={parent ? `Inside ${parent.name} · ${rangeLabel(parent.startDate, parent.endDate)}` : "Inside"} htmlFor="sprint-parent">
                  <select
                    id="sprint-parent"
                    value={orgFields.parentSprintId ?? ""}
                    onChange={(e) => {
                      const parent = org.orgSprints.find((s) => s.id === e.target.value) ?? null;
                      setOrgFields((f) => ({ ...f, parentSprintId: parent?.id ?? null }));
                      // Picking one starts from its dates; the lead may shorten them but not go outside.
                      if (parent && mode === "create") {
                        handleFieldChange("startDate", parent.startDate.slice(0, 10));
                        handleFieldChange("endDate", parent.endDate.slice(0, 10));
                      }
                    }}
                    className={cn("nb-touch-target h-[34px]", inputClassName(false))}
                  >
                    {/* A workspace that follows its organization's sprints always sits inside one. */}
                    {!org.followsOrgSprints ? <option value="">Not inside a sprint</option> : null}
                    {org.orgSprints.map((s) => <option key={s.id} value={s.id}>{s.name} · {rangeLabel(s.startDate, s.endDate)} ({s.status === "active" ? "running" : "planned"})</option>)}
                  </select>
                </Field>
              ) : null}
              {org?.kind === "child" && mode === "create" && onPlanEach && plannedOrgSprints > 1 ? (
                <label className="flex items-center gap-2 text-[13px] text-foreground">
                  <input type="checkbox" checked={planEach} onChange={(e) => setPlanEach(e.target.checked)} />
                  Plan one for each of {org.orgTitle ?? "the organization"}’s {plannedOrgSprints} planned sprints
                </label>
              ) : null}
              {org?.kind === "child" && mode === "create" && parent && (org.groupBacklog ?? 0) > 0 ? (
                <label className="flex items-center gap-2 text-[13px] text-foreground">
                  <input type="checkbox" checked={orgFields.includeGroupWork ?? true} onChange={(e) => setOrgFields((f) => ({ ...f, includeGroupWork: e.target.checked }))} />
                  Also add {org.groupBacklog} group {org.groupBacklog === 1 ? "assignment" : "assignments"} from the backlog
                </label>
              ) : null}
            </div>

            {/* Delete sprint: Planning only; once started, Cancel instead (report §37.2) */}
            {mode === "edit" && sprint?.status === "planning" ? (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between border-b border-destructive/20 pb-1.5">
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-destructive">
                    Delete sprint
                  </span>
                </div>

                <div className="space-y-3 rounded-[6px] border border-destructive/30 bg-destructive/5 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-foreground">
                        {deleteImpact?.affectedTaskCount ?? 0} historical work item{deleteImpact?.affectedTaskCount === 1 ? "" : "s"}
                      </p>
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        You can delete a sprint only before it has tasks. Otherwise, archive it.
                      </p>
                    </div>
                    <span className="rounded-[3px] border border-border px-2 py-0.5 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
                      {sprint?.status ?? "planning"}
                    </span>
                  </div>

                  {!deleteImpact?.canDelete ? (
                    <div className="flex items-start gap-2 rounded-[5px] border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <p>{deleteImpact?.reason ?? "This sprint cannot be deleted right now."}</p>
                    </div>
                  ) : confirmDelete ? (
                    <div className="space-y-2.5 rounded-[5px] border border-destructive/30 bg-card p-3">
                      <p className="text-xs font-medium text-foreground">
                        Delete {deleteImpact.sprintName}?
                      </p>
                      <p className="text-xs leading-5 text-muted-foreground">
                        This cannot be undone. Only this empty Planning record will be removed.
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={!!pendingAction}
                          onClick={() => setConfirmDelete(false)}
                          className="nb-touch-target inline-flex h-[34px] items-center justify-center rounded-[5px] border border-border bg-card px-3 font-mono text-xs font-medium uppercase tracking-[0.09em] text-foreground transition-colors hover:bg-muted"
                        >
                          Keep sprint
                        </button>
                        <button
                          type="button"
                          disabled={!!pendingAction}
                          onClick={() => void handleDelete()}
                          className="nb-touch-target inline-flex h-[34px] items-center gap-1.5 rounded-[5px] bg-destructive px-3 font-mono text-xs font-medium uppercase tracking-[0.09em] text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {isDeleting ? "Deleting..." : "Delete sprint"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!!pendingAction}
                      onClick={() => setConfirmDelete(true)}
                      className="nb-touch-target inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-destructive/30 px-3 font-mono text-xs font-medium uppercase tracking-[0.09em] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete sprint
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* Pinned Modal Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[#DBD5C8] bg-[#F3F0EA] px-6 py-3.5 dark:border-white/10 dark:bg-white/5">
            <button
              type="button"
              disabled={!!pendingAction}
              onClick={onClose}
              className="nb-touch-target inline-flex h-[34px] items-center justify-center rounded-[5px] border border-border bg-card px-4 font-mono text-xs font-medium uppercase tracking-[0.09em] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!!pendingAction || Boolean(repeat && preview?.blocked) || Boolean(dateError)}
              className="nb-touch-target inline-flex h-[34px] items-center justify-center rounded-[5px] bg-primary px-4 font-mono text-xs font-medium uppercase tracking-[0.09em] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : mode === "create" ? (planEach && onPlanEach ? `Create ${plannedOrgSprints} sprints` : repeat && preview ? `Create ${preview.rows.length} sprints` : "Create sprint") : "Save changes"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
