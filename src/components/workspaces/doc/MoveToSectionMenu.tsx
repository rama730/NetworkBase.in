"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, X } from "@/components/ui/icons";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { toast } from "@/lib/feedback";
import { WORKSPACE_DOC_LIST_QUERY_KEY, WORKSPACE_DOCS_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";
import { availableSections, sectionHasDate, sectionLabel, type DocSection } from "@/lib/workspaces/doc-sections";

/**
 * Report 38.3 W2, S2: a workspace document's ⋯ with Move to section. Shown only once a section other than Pages exists;
 * the current section is ticked, Meetings and Launches ask for a date. Moving writes settings, not a version.
 */
export function MoveToSectionMenu({ projectId, docSlug, current, date }: { projectId: string; docSlug: string; current: DocSection; date?: string }) {
  const queryClient = useQueryClient();
  const sections = availableSections(useAddedWorkflows());
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<DocSection>(current);
  const [day, setDay] = useState(date ?? "");
  const [busy, setBusy] = useState(false);
  if (sections.length < 2) return null;

  async function move() {
    setBusy(true);
    const { moveDocToSectionAction } = await import("@/app/actions/workspace/doc");
    const result = await moveDocToSectionAction(projectId, { docSlug, section, ...(sectionHasDate(section) && day ? { date: day } : {}) });
    setBusy(false);
    if (!result.success) return void toast.error(result.error);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
      queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
    ]);
    toast(`Moved to ${sectionLabel(section)}`);
    setOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Document actions" className="nb-touch-target inline-flex size-[var(--ui-control-height-sm)] items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { setSection(current); setDay(date ?? ""); setOpen(true); }}>Move to section…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="move-to-section-dialog">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <div className="space-y-0.5">
              <DialogTitle className="text-base font-semibold text-foreground">Move to section</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">Where this document shows in the Documents list. Nothing in it changes.</DialogDescription>
            </div>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} disabled={busy} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="space-y-4 px-6 py-5">
            <fieldset className="space-y-1">
              <legend className="sr-only">Section</legend>
              {sections.map((id) => (
                <label key={id} className="flex min-h-11 items-center gap-3 rounded-md px-2 text-[13px] hover:bg-muted/50">
                  <input type="radio" className="nb-radio" name="doc-section" checked={section === id} onChange={() => setSection(id)} />
                  <span className="flex-1">{sectionLabel(id)}</span>
                  {id === current ? <span className="text-xs text-muted-foreground">Current</span> : null}
                </label>
              ))}
            </fieldset>
            {sectionHasDate(section) ? (
              <label className="block text-[13px]">
                <span className="mb-1 block font-medium text-foreground">Date</span>
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClassName(false)} />
                <span className="mt-1 block text-xs text-muted-foreground">Left empty, it’s the day the document was made.</span>
              </label>
            ) : null}
          </div>
          <div className={FORM_FOOTER_CLASS}>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void move()} disabled={busy || (section === current && (!sectionHasDate(section) || day === (date ?? "")))}>Move</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
