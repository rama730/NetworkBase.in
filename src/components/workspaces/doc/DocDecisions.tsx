"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Scale, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createDocFile } from "@/components/organizations/OrgDocParts";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, Field, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { WORKSPACE_DOC_LIST_QUERY_KEY, WORKSPACE_DOCS_QUERY_KEY, useWorkspaceDocList } from "@/hooks/workspaces/useWorkspaceDocData";
import type { WorkspaceDocListItem } from "@/lib/workspaces/doc";
import { toast } from "@/lib/feedback";
import { docFileName, docTitle } from "@/lib/organizations/doc-rules";
import { decisionChain, decisionLabel, decisionMarkdown } from "@/lib/workspaces/doc-sections";

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
export function RecordDecisionDialog({ projectId, fromDocSlug, supersedes, open, onOpenChange }: { projectId: string; fromDocSlug?: string; supersedes?: { slug: string; label: string }; open: boolean; onOpenChange: (open: boolean) => void }) {
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
      // Report 38.11 call 2 (A4.2): the ADR shape, Context · Decision · Consequences.
      const created = await createDocFile(projectId, docFileName(decision), decisionMarkdown(decision, context));
      const { recordDecisionAction, unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
      const result = await recordDecisionAction(projectId, { docSlug: created.slug, ...(fromDocSlug ? { fromDocSlug } : {}), ...(supersedes ? { supersedesSlug: supersedes.slug } : {}) });
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
            <DialogTitle className="text-base font-semibold text-foreground">{supersedes ? `Supersede ${supersedes.label}` : "Record a decision"}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{supersedes ? `It replaces ${supersedes.label}, which shows “Superseded by” this one.` : "It gets the workspace’s next D-number, which never changes."}</DialogDescription>
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

/**
 * Report 38.11 S5 (A4.2): a decision's header: Scale · D-number · status (a Proposed/Decided select for editors while it
 * stands) · date · From · Supersedes / Superseded by (and the decision that stands now, when the chain is longer) ·
 * the reason it was reversed · Supersede and Reverse.
 */
export function DecisionMetaLine({ projectId, doc, canEdit = false }: { projectId: string; doc: WorkspaceDocListItem; canEdit?: boolean }) {
  const { data: docs = [] } = useWorkspaceDocList(projectId);
  const queryClient = useQueryClient();
  const openDoc = useOpenDoc();
  const [dialog, setDialog] = useState<"supersede" | "reverse" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!doc.decisionNumber) return null;
  const from = doc.fromDocId ? docs.find((d) => d.id === doc.fromDocId) : null;
  const older = doc.supersedes ? docs.find((d) => d.id === doc.supersedes) : null;
  const newer = doc.supersededBy ? docs.find((d) => d.id === doc.supersededBy) : null;
  const current = newer ? decisionChain(docs, doc.id) : null;
  const status = doc.decisionStatus ?? "decided";
  const standing = status === "proposed" || status === "decided";
  const link = (d: WorkspaceDocListItem) => (
    <button type="button" onClick={() => openDoc(d.slug)} className="font-mono text-[11px] font-medium text-foreground underline-offset-2 hover:underline">{decisionLabel(d.decisionNumber!)}</button>
  );
  async function setStatus(next: "proposed" | "decided") {
    setBusy(true);
    try {
      const { setDecisionStatusAction } = await import("@/app/actions/workspace/doc");
      const r = await setDecisionStatusAction(projectId, { docSlug: doc.slug, status: next });
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t change the status.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-3 space-y-1.5" data-testid="decision-meta">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Scale aria-hidden="true" className="size-3.5" />
        <span className="font-mono text-[11px] text-foreground">{decisionLabel(doc.decisionNumber)}</span>
        {canEdit && standing ? (
          <select aria-label="Status" className="nb-select" data-size="sm" value={status} disabled={busy} onChange={(e) => void setStatus(e.target.value as "proposed" | "decided")} data-testid="decision-status">
              <option value="proposed">Proposed</option>
              <option value="decided">Decided</option>
            </select>
        ) : <StatusBadge state={status}>{STATUS_WORD[status]}</StatusBadge>}
        {doc.date ? <span className="font-mono text-[11px]">{shortDate(doc.date)}</span> : null}
        {from ? <span>From: <button type="button" onClick={() => openDoc(from.slug)} className="font-medium text-foreground underline-offset-2 hover:underline">{from.title ?? docTitle(from.filename)}</button></span> : null}
        {older?.decisionNumber ? <span>Supersedes {link(older)}</span> : null}
        {newer?.decisionNumber ? <span data-testid="decision-superseded-by">Superseded by {link(newer)}{current && current.id !== newer.id && current.decisionNumber ? <> · stands now: {link(current)}</> : null}</span> : null}
        {canEdit && standing ? (
          <span className="ml-auto flex gap-1">
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDialog("supersede")}>Supersede</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDialog("reverse")}>Reverse</button>
          </span>
        ) : null}
      </div>
      {status === "reversed" && doc.reverseReason ? <p className="text-[12px] text-muted-foreground" data-testid="decision-reverse-reason">Reversed: {doc.reverseReason}</p> : null}
      <RecordDecisionDialog projectId={projectId} supersedes={{ slug: doc.slug, label: decisionLabel(doc.decisionNumber) }} open={dialog === "supersede"} onOpenChange={(o) => setDialog(o ? "supersede" : null)} />
      <ReverseDecisionDialog projectId={projectId} doc={doc} open={dialog === "reverse"} onOpenChange={(o) => setDialog(o ? "reverse" : null)} />
    </div>
  );
}

/** W7: Reverse asks a reason (required, up to 500). */
function ReverseDecisionDialog({ projectId, doc, open, onOpenChange }: { projectId: string; doc: WorkspaceDocListItem; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { if (!busy) { onOpenChange(false); setError(null); } };
  async function reverse() {
    if (!reason.trim()) return setError("Say why it's reversed");
    setBusy(true);
    try {
      const { reverseDecisionAction } = await import("@/app/actions/workspace/doc");
      const r = await reverseDecisionAction(projectId, { docSlug: doc.slug, reason });
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) });
      toast.success(`${decisionLabel(doc.decisionNumber!)} reversed`);
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t reverse the decision.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="reverse-decision-dialog">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold text-foreground">Reverse {decisionLabel(doc.decisionNumber!)}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">It stays in Decisions with its number and shows Reversed with your reason.</DialogDescription>
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={busy} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
        <form className="space-y-4 px-6 py-5" onSubmit={(e) => { e.preventDefault(); void reverse(); }}>
          <Field label="Reason" htmlFor="reverse-reason" required error={error ?? undefined}>
            <textarea id="reverse-reason" autoFocus value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} className={`${inputClassName(Boolean(error))} h-auto py-2`} />
          </Field>
        </form>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={close} disabled={busy}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void reverse()} disabled={busy}>{busy ? "Reversing…" : "Reverse"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
