"use client";

import React from "react";
import { typeProfile } from "@/lib/organizations/type-profile";
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
  } | null;
  initialOrgFields?: SprintOrgFields;
}

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
}: SprintEditorModalProps) {
  const [orgFields, setOrgFields] = React.useState<SprintOrgFields>(() => ({
    autoStart: initialOrgFields?.autoStart ?? org?.defaults?.autoStart ?? true,
    showInChildren: initialOrgFields?.showInChildren ?? org?.defaults?.showInChildren ?? true,
    createMatching: mode === "create" ? org?.defaults?.createMatching ?? false : false,
    parentSprintId: initialOrgFields?.parentSprintId ?? null,
    notifyOnStart: initialOrgFields?.notifyOnStart ?? org?.defaults?.notifyOnStart ?? true,
    moveDueDates: false,
  }));
  const [draft, setDraft] = React.useState<SprintEditorDraft>(() =>
    buildSprintEditorDraft({ sprint, sprintCount }),
  );
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
    setDraft(buildSprintEditorDraft({ sprint, sprintCount }));
    setFieldErrors({});
    setErrorMessage("");
    setPendingAction(null);
    setConfirmDelete(false);
  }, [editorKey, isOpen, sprint, sprintCount]);

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

      setPendingAction("save");
      try {
        const result = await onSubmit({
          ...parsed.data,
          autoStart: orgFields.autoStart,
          ...(org?.kind === "org" ? { showInChildren: orgFields.showInChildren, createMatching: mode === "create" && orgFields.createMatching, notifyOnStart: orgFields.notifyOnStart, ...(mode === "edit" ? { moveDueDates: orgFields.moveDueDates } : {}) } : {}),
          ...(org?.kind === "child" ? { parentSprintId: orgFields.parentSprintId ?? null } : {}),
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
    [draft, mode, onClose, onSubmit, org?.kind, orgFields, projectId, sprint?.id],
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
                  placeholder={org?.kind === "org" ? `e.g., ${typeProfile(org.orgType).sprintPrefix}1` : "e.g., Sprint 4"}
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
                    className="inline-flex h-6 items-center rounded-[3px] border border-border bg-card px-2 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    1 week
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration(14)}
                    className="inline-flex h-6 items-center rounded-[3px] border border-border bg-card px-2 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    2 weeks
                  </button>
                  <button
                    type="button"
                    onClick={() => setDuration(28)}
                    className="inline-flex h-6 items-center rounded-[3px] border border-border bg-card px-2 font-mono text-[10px] max-md:text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                <Field label={`Part of the ${org.orgTitle ?? "organization"} sprint`} htmlFor="sprint-parent">
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
                    <option value="">Not part of an organization sprint</option>
                    {org.orgSprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status === "active" ? "running" : "planned"})</option>)}
                  </select>
                </Field>
              ) : null}
            </div>

            {/* Delete sprint (Edit mode only) */}
            {mode === "edit" ? (
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
              disabled={!!pendingAction}
              className="nb-touch-target inline-flex h-[34px] items-center justify-center rounded-[5px] bg-primary px-4 font-mono text-xs font-medium uppercase tracking-[0.09em] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : mode === "create" ? "Create sprint" : "Save changes"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
