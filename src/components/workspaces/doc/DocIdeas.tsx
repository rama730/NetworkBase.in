"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";

import { addIdeaAction, createIdeasDocAction, dropIdeaAction, readIdeasAction, scoreIdeaAction, startBuildingAction, validateIdeaAction } from "@/app/actions/workspace/doc";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useOpenDocAfter } from "@/components/workspaces/doc/DocMeeting";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { IDEA_STAGE_WORD, ideasMarkdown } from "@/lib/workflows/ideas";

const ideasKey = (projectId: string, docSlug: string) => [...queryKeys.project.detail.tasksRoot(projectId), "ideas", docSlug];
type Data = Extract<Awaited<ReturnType<typeof readIdeasAction>>, { success: true }>;
type Idea = Data["ranked"][number];
const STAGE_STATE: Record<string, string> = { idea: "new", validating: "in_progress", building: "active", launched: "done", dropped: "cancelled" };
const BUILD = [
  { as: "project" as const, label: "Make a project", line: "A project with its own work tasks and a timeline." },
  { as: "roadmap_item" as const, label: "Make a roadmap item", line: "On the Roadmap, with its outcome and work." },
  { as: "task" as const, label: "Make a task", line: "One task on the board." },
];

/**
 * Report 38.13 S1 (A5.3): the ranked block: Rank · Idea (name + pitch) · Impact · Ease · Confidence · Score (mono) ·
 * Stage · Validation (n of m) · ⋯. Unscored ideas sit at the bottom, Dropped fold apart. Members act; viewers read.
 */
export function IdeasBlock({ projectId, docSlug }: { projectId: string; docSlug: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ideasKey(projectId, docSlug), queryFn: () => readIdeasAction(projectId, docSlug), staleTime: 30_000 });
  const [adding, setAdding] = useState("");
  const [dialog, setDialog] = useState<{ kind: "build" | "drop"; idea: Idea } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <div aria-hidden="true" className="nb-skeleton my-4 h-32 rounded-[8px]" />;
  const data = query.data?.success ? query.data : null;
  if (!data) return <div className="my-4 rounded-[8px] border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">Ideas · for workspace members</div>;
  async function run(work: () => Promise<{ success: boolean; error?: string }>, done?: string) {
    setBusy(true);
    try {
      const r = await work();
      if (!r.success) throw new Error(r.error);
      if (done) toast(done);
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const pick = (idea: Idea, key: "impact" | "ease" | "confidence") => (
    <select aria-label={`${key[0]!.toUpperCase()}${key.slice(1)} of ${idea.title}`} className="nb-select font-mono" data-size="sm" disabled={!data.canAct || busy || idea.stage === "launched"}
      value={idea[key] ?? ""} onChange={(e) => void run(() => scoreIdeaAction(projectId, { taskId: idea.id, [key]: e.target.value ? Number(e.target.value) : null }))}>
      <option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
  const label = (n: number | null) => (n && data.projectKey ? `${data.projectKey}-${n}` : n ? `#${n}` : "");
  return (
    <section className="my-4 rounded-[8px] border border-border bg-card" aria-label="Ideas" data-testid="ideas-block">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Lightbulb aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="nb-ui-label text-foreground">Ideas</h3>
        <span className="font-mono text-[11px] text-muted-foreground">{data.ranked.length}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">Score = Impact × Ease × Confidence</span>
      </header>
      {/* Keyboard users scroll the table sideways on phones too. */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Ranked ideas">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead><tr className="text-left text-[11px] text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">#</th><th className="px-2 py-1.5 font-medium">Idea</th><th className="px-1 py-1.5 font-medium">Impact</th><th className="px-1 py-1.5 font-medium">Ease</th>
            <th className="px-1 py-1.5 font-medium">Confidence</th><th className="px-2 py-1.5 text-right font-medium">Score</th><th className="px-2 py-1.5 font-medium">Stage</th><th className="px-2 py-1.5 font-medium">Validation</th><th className="w-8" />
          </tr></thead>
          <tbody>
            {data.ranked.length === 0 ? <tr><td colSpan={9} className="px-3 py-3 text-muted-foreground">No ideas yet</td></tr> : null}
            {data.ranked.map((idea) => (
              <tr key={idea.id} className="border-t border-border align-top" data-testid="idea-row">
                <td className="px-3 py-2 font-mono text-[12px] text-muted-foreground">{idea.rank ?? "–"}</td>
                <td className="px-2 py-2"><span className="font-medium text-foreground">{idea.title}</span>
                  {idea.pitch ? <span className="block text-[12px] text-muted-foreground">{idea.pitch}</span> : null}
                  {idea.builtAs ? <span className="block text-[12px] text-muted-foreground">Built as <span className="font-mono">{label(idea.builtAs.number)}</span></span> : null}</td>
                <td className="px-1 py-2">{pick(idea, "impact")}</td><td className="px-1 py-2">{pick(idea, "ease")}</td><td className="px-1 py-2">{pick(idea, "confidence")}</td>
                <td className="px-2 py-2 text-right font-mono">{idea.score ?? <span className="text-[11px] text-muted-foreground">Not scored</span>}</td>
                <td className="px-2 py-2"><StatusBadge state={STAGE_STATE[idea.stage] ?? "new"}>{IDEA_STAGE_WORD[idea.stage] ?? idea.stage}</StatusBadge></td>
                <td className="px-2 py-2 font-mono text-[12px] text-muted-foreground">{idea.validation ? `${idea.validation.done} of ${idea.validation.total}` : ""}</td>
                <td className="px-1 py-1.5">
                  {data.canAct && idea.stage !== "launched" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${idea.title}`} className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {idea.stage === "idea" ? <DropdownMenuItem onSelect={() => void run(() => validateIdeaAction(projectId, { taskId: idea.id }), "Validating · steps added")}>Start validating</DropdownMenuItem> : null}
                        {idea.stage === "idea" || idea.stage === "validating" ? <DropdownMenuItem onSelect={() => setDialog({ kind: "build", idea })}>Start building…</DropdownMenuItem> : null}
                        <DropdownMenuItem onSelect={() => setDialog({ kind: "drop", idea })}>Drop…</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.dropped.length ? (
        <details className="border-t border-border px-4 py-2 text-[13px]" data-testid="ideas-dropped">
          <summary className="cursor-pointer text-muted-foreground">Dropped ({data.dropped.length})</summary>
          <ul className="mt-1 space-y-0.5">{data.dropped.map((d) => <li key={d.id}><span className="text-foreground">{d.title}</span>{d.droppedReason ? <span className="text-muted-foreground"> · {d.droppedReason}</span> : null}</li>)}</ul>
        </details>
      ) : null}
      {data.canAct ? (
        <form className="flex items-center gap-2 border-t border-border px-4 py-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) void run(() => addIdeaAction(projectId, { docSlug, title: adding.trim() })).then((ok) => ok && setAdding("")); }}>
          <Plus aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <input aria-label="New idea" value={adding} maxLength={200} disabled={busy} onChange={(e) => setAdding(e.target.value)} placeholder="Idea (Enter to add)" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
        </form>
      ) : null}
      {dialog?.kind === "build" ? <BuildDialog idea={dialog.idea} busy={busy} onClose={() => setDialog(null)} onPick={(as) => void run(() => startBuildingAction(projectId, { taskId: dialog.idea.id, as }), "Building · the new item is linked")} /> : null}
      {dialog?.kind === "drop" ? <DropDialog idea={dialog.idea} busy={busy} onClose={() => setDialog(null)} onDrop={(reason) => void run(() => dropIdeaAction(projectId, { taskId: dialog.idea.id, reason }), "Idea dropped")} /> : null}
    </section>
  );
}

/** S2: three choices with what each makes; footer "Idea moves to Building". */
function BuildDialog({ idea, busy, onClose, onPick }: { idea: Idea; busy: boolean; onClose: () => void; onPick: (as: "project" | "roadmap_item" | "task") => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="build-idea-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Start building: {idea.title}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">It takes the idea’s name and pitch, and links back to it.</DialogDescription></div>
        <div className="space-y-1.5 px-6 py-4">
          {BUILD.map((b) => (
            <button key={b.as} type="button" disabled={busy} onClick={() => onPick(b.as)} className="flex w-full flex-col items-start rounded-[6px] border border-border px-3 py-2 text-left hover:bg-muted/40">
              <span className="text-[13px] font-medium">{b.label}</span><span className="text-[12px] text-muted-foreground">{b.line}</span>
            </button>
          ))}
        </div>
        <div className={FORM_FOOTER_CLASS}><span className="mr-auto text-[12px] text-muted-foreground">Idea moves to Building</span><button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button></div>
      </DialogContent>
    </Dialog>
  );
}

/** S3: Drop asks a reason (required). */
function DropDialog({ idea, busy, onClose, onDrop }: { idea: Idea; busy: boolean; onClose: () => void; onDrop: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => (reason.trim() ? onDrop(reason.trim()) : setError("Say why it's dropped"));
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="drop-idea-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Drop: {idea.title}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">It folds under Dropped with your reason.</DialogDescription></div>
        <form className="px-6 py-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Reason" htmlFor="drop-reason" required error={error ?? undefined}><input id="drop-reason" autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClassName(Boolean(error))} /></Field>
        </form>
        <div className={FORM_FOOTER_CLASS}><button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={save}>Drop</button></div>
      </DialogContent>
    </Dialog>
  );
}

/** W1: Ideas' + makes an "Ideas" document right away (no sheet needed). */
export function useNewIdeasDoc(projectId: string) {
  const openDoc = useOpenDocAfter(projectId);
  return async () => {
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const made = await createDocFile(projectId, "Ideas.md", ideasMarkdown());
      const r = await createIdeasDocAction(projectId, { docSlug: made.slug });
      if (!r.success) {
        const { unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
        await unlinkWorkspaceDocAction(projectId, made.slug).catch(() => undefined);
        throw new Error(r.error);
      }
      openDoc(made.slug);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t make the Ideas document");
    }
  };
}
