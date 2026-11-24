"use client";

import { Check, Lock, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { addWorkflowAction, removeWorkflowAction, undoAddWorkflowAction, workflowRemovalCountsAction } from "@/app/actions/workflows";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, SectionDivider, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { PARKED_WORKFLOWS, WORKFLOW_CATALOG, WORKFLOW_GROUPS, type CatalogEntry } from "@/lib/workflows/catalog";
import type { AddedWorkflow } from "@/lib/workflows/rules";
import { workflowIcon } from "./workflow-icons";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  added: AddedWorkflow[];
  canManage: boolean;
  /** After an add, undo or hide, so the tab row and Settings refresh at once (the live event follows for others). */
  onChanged: () => void;
};

const ROW = "flex min-h-[52px] items-center gap-3 py-2";
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline";

/** Report 38.2 S2: the Add workflow dialog. Each row acts on its own; there's no footer. */
export function AddWorkflowDialog({ open, onOpenChange, workspaceId, added, canManage, onChanged }: Props) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CatalogEntry | null>(null);
  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);

  const groups = useMemo(() => WORKFLOW_GROUPS.map((group) => ({
    ...group,
    rows: group.id === "parked"
      ? [...WORKFLOW_CATALOG.filter((w) => !w.built).map((w) => w.name), ...PARKED_WORKFLOWS].filter((name) => !q || name.toLowerCase().includes(q))
      : WORKFLOW_CATALOG.filter((w) => w.built && w.group === group.id && (matches(w.name) || matches(w.line))),
  })).filter((group) => group.rows.length > 0), [q]);

  const addable = WORKFLOW_CATALOG.filter((w) => w.built);
  const everythingAdded = addable.length > 0 && addable.every((w) => added.some((a) => a.workflow === w.id));

  async function add(entry: CatalogEntry) {
    setBusy(entry.id);
    const result = await addWorkflowAction({ workspaceId, workflow: entry.id });
    setBusy(null);
    if (!result.success) return void toast.error(result.error);
    onChanged();
    if (result.alreadyAdded) return void toast(`${entry.name} is already added`);
    toast(`${entry.name} added`, {
      duration: result.undoSeconds * 1000,
      action: { label: "Undo", onClick: async () => {
        const undone = await undoAddWorkflowAction({ workspaceId, workflow: entry.id });
        onChanged();
        if (undone.success) toast(`${entry.name} removed`);
        else toast.error(undone.error);
      } },
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="add-workflow-dialog">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <div className="space-y-0.5">
              <DialogTitle className="text-base font-semibold text-foreground">Add workflow</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">Workflows add views, stages or tabs. Everyone in the workspace uses them.</DialogDescription>
            </div>
            <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="shrink-0 px-6 pt-4">
            <label className="relative block">
              <span className="sr-only">Search workflows</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search workflows" className={cn(inputClassName(false), "pl-9")} />
            </label>
            {!canManage ? <p className="mt-2 text-xs text-muted-foreground">Only owners and admins can add workflows.</p> : null}
            {everythingAdded ? <p className="mt-2 text-xs text-muted-foreground">Every available workflow is added.</p> : null}
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
            {groups.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No workflow matches ‘{query.trim()}’</p> : null}
            {groups.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <SectionDivider title={group.label} />
                <div className="divide-y divide-border" role="list" aria-label={group.label}>
                  {group.id === "parked"
                    ? (group.rows as string[]).map((name) => (
                        <div key={name} role="listitem" className="flex min-h-11 items-center gap-3 py-1.5 text-muted-foreground" data-testid="workflow-row-parked">
                          <span className="nb-ui-label flex-1">{name}</span>
                          <span className="text-xs">Coming later</span>
                        </div>
                      ))
                    : (group.rows as CatalogEntry[]).map((entry) => {
                        const Icon = workflowIcon(entry.icon);
                        const state = added.find((a) => a.workflow === entry.id);
                        return (
                          <div key={entry.id} role="listitem" className={ROW} data-testid={`workflow-row-${entry.id}`}>
                            <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="nb-ui-label text-foreground">{entry.name}</p>
                              <p className="text-xs text-muted-foreground">{entry.line}</p>
                            </div>
                            {state?.locked ? (
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Only ${state.by ?? "the organization"} can remove it`}>
                                <Lock aria-hidden="true" className="size-3" />Added by {state.by ?? "the organization"}
                              </span>
                            ) : state ? (
                              <span className="flex items-center gap-3">
                                <span className="flex items-center gap-1 text-xs font-medium text-foreground"><Check aria-hidden="true" className="size-3.5" />Added</span>
                                {canManage ? <button type="button" className={LINK} onClick={() => setRemoving(entry)}>Remove<span className="sr-only"> {entry.name}</span></button> : null}
                              </span>
                            ) : canManage ? (
                              <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy === entry.id} onClick={() => void add(entry)}>Add<span className="sr-only"> {entry.name}</span></button>
                            ) : null}
                          </div>
                        );
                      })}
                </div>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <RemoveWorkflowDialog entry={removing} workspaceId={workspaceId} onClose={() => setRemoving(null)} onChanged={onChanged} />
    </>
  );
}

/** Report 38.2 S3: Remove hides (call 4). It says what the workflow holds before anything changes. */
export function RemoveWorkflowDialog({ entry: chosen, workspaceId, onClose, onChanged }: { entry: CatalogEntry | null; workspaceId: string; onClose: () => void; onChanged: () => void }) {
  // Keeps naming the workflow while the dialog fades out after Hide or Cancel.
  const last = useRef<CatalogEntry | null>(null);
  if (chosen) last.current = chosen;
  const entry = chosen ?? last.current;
  const [counts, setCounts] = useState<{ total: number; open: number; onBoard: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!chosen) return;
    let current = true;
    setCounts(null);
    setError(null);
    void workflowRemovalCountsAction({ workspaceId, workflow: chosen.id }).then((r) => {
      if (!current) return;
      if (r.success) setCounts(r);
      else setError(r.error);
    });
    return () => { current = false; };
  }, [chosen, workspaceId]);
  const noun = entry?.types.length ? entry.name.toLowerCase() : "items";

  async function hide() {
    if (!entry) return;
    setBusy(true);
    const result = await removeWorkflowAction({ workspaceId, workflow: entry.id });
    setBusy(false);
    if (!result.success) return void toast.error(result.error);
    onChanged();
    toast(`${entry.name} hidden`);
    onClose();
  }

  return (
    <Dialog open={Boolean(chosen)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="remove-workflow-dialog">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold text-foreground">Remove {entry?.name}?</DialogTitle>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 px-6 py-5 text-sm">
          {entry?.types.length ? (
            <p className="font-mono text-[13px] text-foreground" aria-live="polite">
              {error ? error : counts ? `${counts.total} ${noun} · ${counts.open} open · ${counts.onBoard} on the board` : "Counting…"}
            </p>
          ) : null}
          <DialogDescription className="text-muted-foreground">
            {entry?.tab
              ? `The ${entry.name} tab and its stages are hidden. ${counts?.onBoard === 1 ? "The 1 on the board stays there as a plain task until it’s completed. " : counts?.onBoard ? `The ${counts.onBoard} on the board stay there as plain tasks until they’re completed. ` : ""}Nothing is deleted; add ${entry.name} again to bring everything back.`
              : `What ${entry?.name} adds is hidden. Nothing is deleted; add it again to bring everything back.`}
          </DialogDescription>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void hide()} disabled={busy || Boolean(entry?.types.length && !counts)}>Hide {entry?.name}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
