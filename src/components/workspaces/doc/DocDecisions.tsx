"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createDocFile } from "@/components/organizations/OrgDocParts";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, Field, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { WORKSPACE_DOC_LIST_QUERY_KEY, WORKSPACE_DOCS_QUERY_KEY, useWorkspaceDocList } from "@/hooks/workspaces/useWorkspaceDocData";
import { toast } from "@/lib/feedback";
import { docFileName, docTitle } from "@/lib/organizations/doc-rules";
import { decisionLabel } from "@/lib/workspaces/doc-sections";

const STATUS_WORD = { proposed: "Proposed", decided: "Decided", superseded: "Superseded", reversed: "Reversed" } as const;
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function useOpenDoc() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (slug: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "docs");
    params.set("doc", slug);
    params.delete("from");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };
}

/**
 * Report 38.3 S4: the decisions recorded from this document, newest number first: D-number · title · status · date.
 * People who can edit the document record more here (W6).
 */
export function DocDecisionsBlock({ projectId, docSlug, canEdit }: { projectId: string; docSlug: string; canEdit: boolean }) {
  const { data: docs = [], isLoading } = useWorkspaceDocList(projectId);
  const [recording, setRecording] = useState(false);
  const openDoc = useOpenDoc();
  const self = docs.find((d) => d.slug === docSlug);
  const decisions = docs.filter((d) => self && d.fromDocId === self.id && d.decisionNumber).sort((a, b) => b.decisionNumber! - a.decisionNumber!);
  return (
    <section className="my-4 rounded-[8px] border border-border bg-card" aria-label="Decisions" data-testid="decisions-block">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="nb-ui-label text-foreground">Decisions</h3>
        {decisions.length ? <span className="font-mono text-[11px] text-muted-foreground">{decisions.length}</span> : null}
      </header>
      <div className="px-2 py-1">
        {isLoading ? <div aria-hidden="true" className="nb-skeleton m-2 h-8 rounded-[5px]" /> : null}
        {!isLoading && !decisions.length ? <p className="px-2 py-2 text-[13px] text-muted-foreground">No decisions recorded here yet</p> : null}
        <ul>
          {decisions.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => openDoc(d.slug)} className="flex min-h-11 w-full items-center gap-2.5 rounded-[5px] px-2 text-left hover:bg-muted/40">
                <span className="font-mono text-[11px] text-muted-foreground">{decisionLabel(d.decisionNumber!)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{docTitle(d.filename)}</span>
                <StatusBadge state={d.decisionStatus ?? "decided"}>{STATUS_WORD[d.decisionStatus ?? "decided"]}</StatusBadge>
                {d.date ? <span className="font-mono text-[11px] text-muted-foreground">{shortDate(d.date)}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {canEdit ? (
          <button type="button" onClick={() => setRecording(true)} className="nb-touch-target flex items-center gap-1.5 px-2 py-2 text-[13px] text-muted-foreground hover:text-foreground">
            <Plus aria-hidden="true" className="size-3.5" />Record a decision
          </button>
        ) : null}
      </div>
      <RecordDecisionDialog projectId={projectId} fromDocSlug={docSlug} open={recording} onOpenChange={setRecording} />
    </section>
  );
}

/**
 * W6 sheet: Decision (required, 1–200) and Context (optional, up to 2,000). The document is made like any new one, then
 * filed under Decisions with the next D-number; if numbering fails the new file is taken back out.
 */
export function RecordDecisionDialog({ projectId, fromDocSlug, open, onOpenChange }: { projectId: string; fromDocSlug?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) { onOpenChange(false); setError(null); } };

  async function record() {
    const decision = title.trim();
    if (!decision) return setError("Write the decision in one line");
    setBusy(true);
    try {
      const body = `# ${decision}\n\n## Decision\n\n${decision}\n${context.trim() ? `\n## Context\n\n${context.trim()}\n` : ""}`;
      const created = await createDocFile(projectId, docFileName(decision), body);
      const { recordDecisionAction, unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
      const result = await recordDecisionAction(projectId, { docSlug: created.slug, ...(fromDocSlug ? { fromDocSlug } : {}) });
      if (!result.success) {
        await unlinkWorkspaceDocAction(projectId, created.slug).catch(() => undefined);
        const { bulkTrashNodes } = await import("@/app/actions/files/mutations");
        await bulkTrashNodes([created.node.id], projectId).catch(() => undefined);
        throw new Error(result.error);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
        queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
      ]);
      toast.success(`Recorded ${result.label}`);
      setTitle("");
      setContext("");
      setError(null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t record the decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="record-decision-dialog">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold text-foreground">Record a decision</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">It gets the workspace’s next D-number, which never changes.</DialogDescription>
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={busy} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form className="space-y-4 px-6 py-5" onSubmit={(e) => { e.preventDefault(); void record(); }}>
          <Field label="Decision" htmlFor="decision-title" required error={error ?? undefined}>
            <input id="decision-title" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Use Postgres for search" className={inputClassName(Boolean(error))} />
          </Field>
          <Field label="Context" htmlFor="decision-context" hint="Why, and what else was considered. Optional.">
            <textarea id="decision-context" value={context} maxLength={2000} rows={4} onChange={(e) => setContext(e.target.value)} className={`${inputClassName(false)} h-auto py-2`} />
          </Field>
        </form>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void record()} disabled={busy}>{busy ? "Recording…" : "Record"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
