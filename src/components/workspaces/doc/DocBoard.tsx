"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Gavel, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { addMotionAction, approveMinutesAction, markPresentAction, recordDecisionAction, recordVoteAction, unlinkWorkspaceDocAction } from "@/app/actions/workspace/doc";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { WORKSPACE_DOC_LIST_QUERY_KEY, WORKSPACE_DOCS_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";
import { toast } from "@/lib/feedback";
import { docFileName } from "@/lib/organizations/doc-rules";
import { queryKeys } from "@/lib/query-keys";
import { decisionMarkdown } from "@/lib/workspaces/doc-sections";

type Person = { id: string; name: string };
type Motion = { id: string; text: string; proposedBy: string | null; secondedBy: string | null; votes: { for: number; against: number; abstain: number } | null; result: "passed" | "failed" | null; decision: { slug: string; label: string } | null };
export type BoardData = { needed: number; motionsOn: boolean; size: number | null; present: string[]; presentCount: number; approvedAt: string | null; motions: Motion[]; toApprove: { slug: string; title: string } | null };

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/**
 * Report 38.11 W6 and S3 (A4.9): a board meeting's panel: the quorum line, who is present, the motions (text, proposed
 * and seconded by, counts, Passed or Failed, the decision it made), + Motion, Record vote and Approve last minutes.
 */
export function BoardPanel({ projectId, docSlug, title, board, attendees, canEdit, onOpenDoc }: {
  projectId: string; docSlug: string; title: string; board: BoardData; attendees: Person[]; canEdit: boolean; onOpenDoc: (slug: string) => void;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ kind: "motion" } | { kind: "vote"; motion: Motion } | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = canEdit && !board.approvedAt;
  // Ticks show at once; the server's list replaces them when it answers.
  const [present, setPresent] = useState(board.present);
  const presentKey = board.present.join(",");
  useEffect(() => setPresent(presentKey ? presentKey.split(",") : []), [presentKey]);
  const presentCount = editable ? present.length : board.presentCount;
  const q = { needed: board.needed, met: presentCount >= board.needed };
  const name = (id: string | null) => attendees.find((a) => a.id === id)?.name ?? null;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }),
    queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
    queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
  ]);
  async function run<T extends { success: boolean; error?: string }>(work: () => Promise<T>, done?: (r: T) => string | Promise<string>) {
    setBusy(true);
    try {
      const r = await work();
      if (!r.success) throw new Error(r.error ?? "Couldn’t save");
      if (done) toast(await done(r));
      setDialog(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save");
    } finally {
      setBusy(false);
    }
  }
  // A passed motion becomes a Decided decision (D-number) recorded from this meeting.
  async function recordDecision(motion: Motion, votes: { for: number; against: number; abstain: number }) {
    const { createDocFile } = await import("@/components/organizations/OrgDocParts");
    const made = await createDocFile(projectId, docFileName(motion.text.slice(0, 80)), decisionMarkdown(motion.text, `Motion passed at ${title}: For ${votes.for} · Against ${votes.against} · Abstain ${votes.abstain}.`));
    const r = await recordDecisionAction(projectId, { docSlug: made.slug, fromDocSlug: docSlug, motionId: motion.id });
    if (!r.success) {
      await unlinkWorkspaceDocAction(projectId, made.slug).catch(() => undefined);
      throw new Error(r.error);
    }
    return r.label;
  }
  const togglePresent = (id: string, on: boolean) => {
    const next = on ? [...present, id] : present.filter((p) => p !== id);
    setPresent(next);
    void run(() => markPresentAction(projectId, { docSlug, present: next }));
  };

  return (
    <div className="space-y-2 border-t border-border pt-2" data-testid="board-panel">
      <p className="text-[12px] text-muted-foreground" data-testid="board-quorum">
        Quorum: <span className="font-mono">{presentCount}</span> present{board.size ? <> of <span className="font-mono">{board.size}</span></> : null} · <span className="font-mono">{q.needed}</span> needed · <span className="font-medium text-foreground">{q.met ? "Quorate" : "Not quorate"}</span>
        {board.approvedAt ? <> · <span className="font-medium text-foreground" data-testid="board-approved">Approved {shortDay(board.approvedAt)}</span></> : null}
      </p>
      {editable && attendees.length ? (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Present</legend>
          {attendees.map((a) => (
            <label key={a.id} className="flex min-h-8 items-center gap-1.5 text-[12px]"><input type="checkbox" disabled={busy} checked={present.includes(a.id)} onChange={(e) => togglePresent(a.id, e.target.checked)} />{a.name}</label>
          ))}
        </fieldset>
      ) : null}
      {board.motionsOn ? <ul className="space-y-1.5" aria-label="Motions">
        {board.motions.map((m) => (
          <li key={m.id} className="rounded-[6px] border border-border px-3 py-2" data-testid="motion">
            <div className="flex flex-wrap items-start gap-2">
              <Gavel aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 text-[13px] text-foreground">{m.text}</p>
              {m.result ? <StatusBadge state={m.result}>{m.result === "passed" ? "Passed" : "Failed"}</StatusBadge> : null}
              {m.decision ? <button type="button" onClick={() => onOpenDoc(m.decision!.slug)} className="font-mono text-[11px] font-medium text-foreground underline-offset-2 hover:underline">{m.decision.label}</button> : null}
            </div>
            <p className="mt-1 pl-5 text-[12px] text-muted-foreground">
              {[name(m.proposedBy) ? `Proposed by ${name(m.proposedBy)}` : null, name(m.secondedBy) ? `seconded by ${name(m.secondedBy)}` : null].filter(Boolean).join(" · ")}
              {m.votes ? <span className="font-mono">{name(m.proposedBy) ? " · " : ""}For {m.votes.for} · Against {m.votes.against} · Abstain {m.votes.abstain}</span> : null}
            </p>
            {editable && !m.result ? <button type="button" className={`${FORM_SECONDARY_CLASS} mt-1.5`} disabled={busy} onClick={() => setDialog({ kind: "vote", motion: m })}>Record vote</button> : null}
            {editable && m.result === "passed" && !m.decision ? (
              <button type="button" className={`${FORM_SECONDARY_CLASS} mt-1.5`} disabled={busy} onClick={() => void run(async () => ({ success: true as const, label: await recordDecision(m, m.votes!) }), (r) => `Recorded ${r.label}`)}>Record the decision</button>
            ) : null}
          </li>
        ))}
      </ul> : null}
      <div className="flex flex-wrap items-center gap-2">
        {editable && board.motionsOn ? <button type="button" className="nb-touch-target flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setDialog({ kind: "motion" })}><Plus aria-hidden="true" className="size-3.5" />Motion</button> : null}
        {canEdit && board.toApprove ? (
          <button type="button" className={`${FORM_SECONDARY_CLASS} ml-auto`} disabled={busy} onClick={() => void run(() => approveMinutesAction(projectId, { docSlug }), () => `Minutes approved: ${board.toApprove!.title}`)}>Approve last minutes ({board.toApprove.title})</button>
        ) : null}
      </div>
      {dialog?.kind === "motion" ? <MotionDialog attendees={attendees} busy={busy} onClose={() => setDialog(null)}
        onSave={(v) => void run(() => addMotionAction(projectId, { docSlug, ...v }), () => "Motion added")} /> : null}
      {dialog?.kind === "vote" ? <VoteDialog motion={dialog.motion} present={presentCount} quorate={q.met} needed={q.needed} busy={busy} onClose={() => setDialog(null)}
        onSave={(votes) => void run(async () => {
          const r = await recordVoteAction(projectId, { docSlug, motionId: dialog.motion.id, ...votes });
          if (!r.success || r.result !== "passed") return { ...r, label: null as string | null };
          return { ...r, label: await recordDecision(dialog.motion, votes) };
        }, (r) => (r.result === "passed" ? `Passed · recorded ${r.label}` : "Failed"))} /> : null}
    </div>
  );
}

function MotionDialog({ attendees, busy, onClose, onSave }: { attendees: Person[]; busy: boolean; onClose: () => void; onSave: (v: { text: string; proposedBy?: string; secondedBy?: string }) => void }) {
  const [text, setText] = useState("");
  const [proposedBy, setProposedBy] = useState("");
  const [secondedBy, setSecondedBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!text.trim()) return setError("Write the motion");
    if (proposedBy && proposedBy === secondedBy) return setError("Someone else seconds the motion");
    onSave({ text: text.trim(), ...(proposedBy ? { proposedBy } : {}), ...(secondedBy ? { secondedBy } : {}) });
  };
  const pick = (id: string, value: string, set: (v: string) => void, label: string) => (
    <Field label={label} htmlFor={id}><SelectWrap><select id={id} value={value} onChange={(e) => set(e.target.value)} className={selectClassName()}>
      <option value="">Not recorded</option>{attendees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select></SelectWrap></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="motion-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">New motion</DialogTitle><DialogDescription className="text-xs text-muted-foreground">It passes with more For than Against, when the meeting is quorate.</DialogDescription></div>
        <form className="space-y-3.5 px-6 py-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <Field label="Motion" htmlFor="motion-text" required error={error ?? undefined}>
            <textarea id="motion-text" autoFocus rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="Approve the 2027 budget" className={`${inputClassName(Boolean(error))} h-auto py-2`} />
          </Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">{pick("motion-proposed", proposedBy, setProposedBy, "Proposed by")}{pick("motion-seconded", secondedBy, setSecondedBy, "Seconded by")}</div>
        </form>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={save}>Add motion</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VoteDialog({ motion, present, quorate, needed, busy, onClose, onSave }: { motion: Motion; present: number; quorate: boolean; needed: number; busy: boolean; onClose: () => void; onSave: (v: { for: number; against: number; abstain: number }) => void }) {
  const [votes, setVotes] = useState({ for: 0, against: 0, abstain: 0 });
  const total = votes.for + votes.against + votes.abstain;
  const error = !quorate ? `Not quorate: ${present} present, ${needed} needed. Mark who's present first.` : total > present ? `The votes add up to ${total}, more than the ${present} present.` : null;
  const box = (key: "for" | "against" | "abstain", label: string) => (
    <Field label={label} htmlFor={`vote-${key}`}><input id={`vote-${key}`} type="number" min={0} max={present} inputMode="numeric" value={votes[key]} onChange={(e) => setVotes({ ...votes, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className={`${inputClassName(false)} font-mono`} /></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="vote-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Record vote</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{motion.text}</DialogDescription></div>
        <div className="space-y-3 px-6 py-4">
          <div className="grid grid-cols-3 gap-3">{box("for", "For")}{box("against", "Against")}{box("abstain", "Abstain")}</div>
          <p className="text-[12px] text-muted-foreground" role={error ? "alert" : undefined}>{error ?? <>Result: <span className="font-medium text-foreground">{votes.for > votes.against ? "Passed" : "Failed"}</span> · <span className="font-mono">{present}</span> present</>}</p>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || Boolean(error)} onClick={() => onSave(votes)}>{busy ? "Recording…" : "Record vote"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
