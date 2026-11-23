"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Plus, Target, X } from "lucide-react";
import { useState } from "react";

import { addKeyResultAction, addObjectiveAction, checkInAction, createGoalsDocAction, readGoalsAction, setGoalStatusAction } from "@/app/actions/workspace/doc";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOpenDocAfter } from "@/components/workspaces/doc/DocMeeting";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { goalsMarkdown, MEASURED_BY, nextPeriod, periodLabel, periodOf, STATUS_WORD, type GoalStatus, type MeasuredKind } from "@/lib/workflows/goals";

const goalsKey = (projectId: string, docSlug: string) => [...queryKeys.project.detail.tasksRoot(projectId), "goals", docSlug];
type Data = Extract<Awaited<ReturnType<typeof readGoalsAction>>, { success: true }>;
type Kr = Data["objectives"][number]["keyResults"][number];
const fmt = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const ago = (iso: string | null) => {
  if (!iso) return "no check-in yet";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "checked in today" : `${d} d ago`;
};

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full bg-foreground/70" style={{ width: `${value}%` }} />
      </span>
      <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">{value}%</span>
    </span>
  );
}

/**
 * Report 38.12 S1 (A5.1a): the goals block. Header "Q1 2027 · week 7 of 13"; objectives (Target, name, owner, progress,
 * status in words) fold open; under each, key results with current / target, progress, confidence, last check-in and
 * Check in. Members only; a closed period is read-only.
 */
export function GoalsBlock({ projectId, docSlug }: { projectId: string; docSlug: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: goalsKey(projectId, docSlug), queryFn: () => readGoalsAction(projectId, docSlug), staleTime: 30_000 });
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState("");
  const [dialog, setDialog] = useState<{ kind: "kr"; objectiveId: string; count: number } | { kind: "checkin"; kr: Kr } | { kind: "status"; id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <div aria-hidden="true" className="nb-skeleton my-4 h-32 rounded-[8px]" />;
  const data = query.data?.success ? query.data : null;
  if (!data) return <div className="my-4 rounded-[8px] border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">Goals · for workspace members</div>;
  const refresh = () => queryClient.invalidateQueries({ queryKey: goalsKey(projectId, docSlug) });
  async function run(work: () => Promise<{ success: boolean; error?: string }>, done?: string) {
    setBusy(true);
    try {
      const r = await work();
      if (!r.success) throw new Error(r.error);
      if (done) toast(done);
      setDialog(null);
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const canTouch = (assigneeId: string | null) => !data.closedAt && (data.canEdit || assigneeId === data.viewerId);
  const objectives = mine ? data.objectives.filter((o) => o.assigneeId === data.viewerId || o.keyResults.some((k) => k.assigneeId === data.viewerId)) : data.objectives;
  const badge = (status: GoalStatus, override: { reason: string } | null) => (
    <span title={override ? `Set by hand: ${override.reason}` : undefined}><StatusBadge state={status}>{STATUS_WORD[status]}{override ? " · set by hand" : ""}</StatusBadge></span>
  );

  return (
    <section className="my-4 rounded-[8px] border border-border bg-card" aria-label={`Goals ${data.label}`} data-testid="goals-block">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <Target aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="nb-ui-label text-foreground">Goals</h3>
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="goals-period">{data.label} · {data.closedAt ? "closed" : data.week}</span>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Mine</label>
      </header>
      <div className="divide-y divide-border">
        {objectives.length === 0 ? <p className="px-4 py-3 text-[13px] text-muted-foreground">{mine ? "Nothing of yours here" : "No objectives yet"}</p> : null}
        {objectives.map((o) => (
          <details key={o.id} open className="group px-4 py-2" data-testid="objective">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2">
              <Target aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-[14px] font-medium text-foreground">{o.title}</span>
              {o.assigneeName ? <span className="text-[12px] text-muted-foreground">{o.assigneeName}</span> : null}
              <Bar value={o.progress} label={`${o.title} progress`} />
              {badge(o.status, o.override)}
            </summary>
            {canTouch(o.assigneeId) ? <button type="button" className="ml-6 text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => setDialog({ kind: "status", id: o.id, title: o.title })}>Status…</button> : null}
            <ul className="mt-1 space-y-1 pl-6" aria-label={`Key results of ${o.title}`}>
              {o.keyResults.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 rounded-[5px] py-1" data-testid="key-result">
                  <Gauge aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-[13px] text-foreground">{k.title}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{fmt(k.current)} / {fmt(k.target)}{k.unit ? ` ${k.unit}` : ""}{k.direction === "decrease" ? " · lower is better" : ""}</span>
                  {k.measuredBy ? <span className="text-[11px] text-muted-foreground" data-testid="kr-measured">{k.measuredBy.kind === "bugs" ? "open urgent bugs" : k.measuredBy.kind === "label" ? `done with “${k.measuredBy.from}”` : `from ${k.measuredBy.from}`}</span> : null}
                  <Bar value={k.progress} label={`${k.title} progress`} />
                  {k.confidence ? <span className="font-mono text-[11px] text-muted-foreground" title="Confidence">{k.confidence}/10</span> : null}
                  {k.result ? <StatusBadge state={k.result}>{STATUS_WORD[k.result]}</StatusBadge> : badge(k.status, k.override)}
                  <span className="text-[11px] text-muted-foreground">{ago(k.checkedInAt)}</span>
                  {canTouch(k.assigneeId) ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDialog({ kind: "checkin", kr: k })}>Check in</button> : null}
                </li>
              ))}
              {data.canEdit ? (
                <li><button type="button" className="nb-touch-target flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setDialog({ kind: "kr", objectiveId: o.id, count: o.keyResults.length })}><Plus aria-hidden="true" className="size-3.5" />Key result</button></li>
              ) : null}
            </ul>
          </details>
        ))}
      </div>
      {data.canEdit ? (
        <form className="flex items-center gap-2 border-t border-border px-4 py-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) void run(() => addObjectiveAction(projectId, { docSlug, title: adding.trim() })).then((ok) => ok && setAdding("")); }}>
          <Plus aria-hidden="true" className="size-3.5 text-muted-foreground" />
          <input aria-label="New objective" value={adding} maxLength={200} disabled={busy} onChange={(e) => setAdding(e.target.value)} placeholder="Objective (Enter to add)" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
        </form>
      ) : null}
      {dialog?.kind === "kr" ? <KeyResultDialog people={data.people} sources={data.sources} count={dialog.count} busy={busy} onClose={() => setDialog(null)}
        onSave={(v) => void run(() => addKeyResultAction(projectId, { docSlug, objectiveId: dialog.objectiveId, ...v }), "Key result added")} /> : null}
      {dialog?.kind === "checkin" ? <CheckInDialog kr={dialog.kr} busy={busy} onClose={() => setDialog(null)}
        onSave={(v) => void run(() => checkInAction(projectId, { taskId: dialog.kr.id, ...v }), "Checked in")} /> : null}
      {dialog?.kind === "status" ? <StatusDialog title={dialog.title} busy={busy} onClose={() => setDialog(null)}
        onSave={(v) => void run(() => setGoalStatusAction(projectId, { taskId: dialog.id, ...v }), v.status ? "Status set by hand" : "Status worked out again")} /> : null}
    </section>
  );
}

function Shell({ title, description, testId, busy, onClose, onSave, saveLabel, children }: { title: string; description?: string; testId: string; busy: boolean; onClose: () => void; onSave: () => void; saveLabel: string; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid={testId}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="space-y-0.5"><DialogTitle className="text-base font-semibold">{title}</DialogTitle>{description ? <DialogDescription className="text-xs text-muted-foreground">{description}</DialogDescription> : null}</div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
        </div>
        <form className="space-y-3.5 px-6 py-4" onSubmit={(e) => { e.preventDefault(); onSave(); }}>{children}</form>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={onSave}>{saveLabel}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** W3: name, Increase / Decrease, unit, start, target, assigned to; a soft note outside 2–4 key results. */
function KeyResultDialog({ people, sources, count, busy, onClose, onSave }: { people: Array<{ id: string; name: string }>; sources: Array<{ id: string; title: string; kind: "project" | "roadmap" }>; count: number; busy: boolean; onClose: () => void;
  onSave: (v: { title: string; direction: "increase" | "decrease"; unit: string; start: number; target: number; assigneeId: string | null; measuredBy?: { kind: MeasuredKind; ref?: string } }) => void }) {
  const [v, setV] = useState({ title: "", direction: "increase" as "increase" | "decrease", unit: "", start: "0", target: "", assigneeId: "", kind: "checkins" as MeasuredKind, ref: "" });
  const refs = sources.filter((x) => x.kind === v.kind);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!v.title.trim()) return setError("Name the key result");
    const start = Number(v.start), target = Number(v.target);
    if (v.target === "" || !Number.isFinite(start) || !Number.isFinite(target)) return setError("Give a start and a target");
    if (v.kind !== "checkins" && v.kind !== "bugs" && !v.ref.trim()) return setError(v.kind === "label" ? "Name the label" : "Pick what it's measured by");
    onSave({ title: v.title.trim(), direction: v.direction, unit: v.unit.trim(), start, target, assigneeId: v.assigneeId || null,
      ...(v.kind !== "checkins" ? { measuredBy: { kind: v.kind, ...(v.ref.trim() ? { ref: v.ref.trim() } : {}) } } : {}) });
  };
  return (
    <Shell title="New key result" description={count >= 5 ? "This objective has 5 key results; most need 2–4." : count === 0 ? "Aim for 2–4 numbers that prove the objective." : undefined} testId="kr-dialog" busy={busy} onClose={onClose} onSave={save} saveLabel="Add key result">
      <Field label="Key result" htmlFor="kr-title" required error={error ?? undefined}><input id="kr-title" autoFocus maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Weekly active teams" className={inputClassName(Boolean(error))} /></Field>
      <div className="grid grid-cols-2 gap-3.5">
        <Field label="Direction" htmlFor="kr-direction"><SelectWrap><select id="kr-direction" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value as "increase" | "decrease" })} className={selectClassName()}><option value="increase">Increase</option><option value="decrease">Decrease (lower is better)</option></select></SelectWrap></Field>
        <Field label="Unit" htmlFor="kr-unit"><input id="kr-unit" maxLength={20} value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} placeholder="%, people, ₹" className={inputClassName(false)} /></Field>
        <Field label="Start" htmlFor="kr-start"><input id="kr-start" inputMode="decimal" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} className={`${inputClassName(false)} font-mono`} /></Field>
        <Field label="Target" htmlFor="kr-target"><input id="kr-target" inputMode="decimal" value={v.target} onChange={(e) => setV({ ...v, target: e.target.value })} className={`${inputClassName(false)} font-mono`} /></Field>
      </div>
      <Field label="Measured by" htmlFor="kr-measured"><SelectWrap><select id="kr-measured" value={v.kind} onChange={(e) => {
        const kind = e.target.value as MeasuredKind;
        // Open urgent bugs: lower is better, as a count (W7).
        setV({ ...v, kind, ref: "", ...(kind === "bugs" ? { direction: "decrease" as const, unit: "bugs" } : kind === "project" || kind === "roadmap" ? { unit: "%", start: "0", target: "100" } : {}) });
      }} className={selectClassName()}>{MEASURED_BY.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}</select></SelectWrap></Field>
      {v.kind === "project" || v.kind === "roadmap" ? (
        <Field label={v.kind === "project" ? "Project" : "Roadmap item"} htmlFor="kr-ref"><SelectWrap><select id="kr-ref" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} className={selectClassName()}>
          <option value="">{refs.length ? "Pick one" : "None in this workspace yet"}</option>{refs.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select></SelectWrap></Field>
      ) : v.kind === "label" ? (
        <Field label="Label" htmlFor="kr-ref"><input id="kr-ref" maxLength={40} value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} placeholder="onboarding" className={inputClassName(false)} /></Field>
      ) : null}
      <Field label="Assigned to" htmlFor="kr-assignee"><SelectWrap><select id="kr-assignee" value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} className={selectClassName()}><option value="">Nobody yet</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></SelectWrap></Field>
    </Shell>
  );
}

const confidenceWord = (n: number) => (n <= 3 ? "Low" : n <= 7 ? "Medium" : "High");

/** S2: the value, a confidence 1–10 with words, a note; past check-ins as a small line and a table for screen readers. */
function CheckInDialog({ kr, busy, onClose, onSave }: { kr: Kr; busy: boolean; onClose: () => void; onSave: (v: { value: number; confidence: number; note?: string }) => void }) {
  const [value, setValue] = useState(kr.current == null ? "" : String(kr.current));
  const linked = Boolean(kr.measuredBy);
  const [confidence, setConfidence] = useState(kr.confidence ?? 5);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => { const n = Number(value); if (value === "" || !Number.isFinite(n)) return setError("Give the new value"); onSave({ value: n, confidence, ...(note.trim() ? { note: note.trim() } : {}) }); };
  const h = kr.history;
  const lo = Math.min(kr.start, kr.target, ...h.map((x) => x.value)), hi = Math.max(kr.start, kr.target, ...h.map((x) => x.value));
  const points = h.map((x, i) => `${h.length > 1 ? (i / (h.length - 1)) * 160 : 80},${hi === lo ? 20 : 36 - ((x.value - lo) / (hi - lo)) * 32}`).join(" ");
  return (
    <Shell title={`Check in: ${kr.title}`} description={`Target ${fmt(kr.target)}${kr.unit ? ` ${kr.unit}` : ""} · now ${fmt(kr.current)}`} testId="checkin-dialog" busy={busy} onClose={onClose} onSave={save} saveLabel="Check in">
      <Field label={linked ? "Value (worked out for you)" : "New value"} htmlFor="checkin-value" required={!linked} error={error ?? undefined}><input id="checkin-value" autoFocus={!linked} readOnly={linked} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClassName(Boolean(error))} font-mono`} /></Field>
      <Field label={`Confidence: ${confidence}/10 · ${confidenceWord(confidence)}`} htmlFor="checkin-confidence"><input id="checkin-confidence" type="range" min={1} max={10} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="w-full" /></Field>
      <Field label="Note" htmlFor="checkin-note"><textarea id="checkin-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputClassName(false)} h-auto py-2`} /></Field>
      {h.length ? (
        <div>
          <svg viewBox="0 0 160 40" className="h-10 w-40 text-foreground/60" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          <table className="sr-only"><caption>Past check-ins</caption><tbody>{h.map((x) => <tr key={x.at}><td>{x.at.slice(0, 10)}</td><td>{fmt(x.value)}</td></tr>)}</tbody></table>
        </div>
      ) : null}
    </Shell>
  );
}

/** W5: set the status by hand with a reason, until the next check-in; or let it be worked out again. */
function StatusDialog({ title, busy, onClose, onSave }: { title: string; busy: boolean; onClose: () => void; onSave: (v: { status: GoalStatus | null; reason?: string }) => void }) {
  const [status, setStatus] = useState<GoalStatus | "">("at_risk");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = () => (status && !reason.trim() ? setError("Say why") : onSave(status ? { status, reason: reason.trim() } : { status: null }));
  return (
    <Shell title={`Status: ${title}`} description="It stays until the next check-in." testId="goal-status-dialog" busy={busy} onClose={onClose} onSave={save} saveLabel="Save">
      <Field label="Status" htmlFor="goal-status"><SelectWrap><select id="goal-status" value={status} onChange={(e) => setStatus(e.target.value as GoalStatus | "")} className={selectClassName()}>
        <option value="on_track">On track</option><option value="at_risk">At risk</option><option value="off_track">Off track</option><option value="">Work it out from the numbers</option>
      </select></SelectWrap></Field>
      {status ? <Field label="Why" htmlFor="goal-reason" required error={error ?? undefined}><input id="goal-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClassName(Boolean(error))} /></Field> : null}
    </Shell>
  );
}

/** W1: Goals' + makes "Goals · Q1 2027" for this period or one of the next three. */
export function NewGoalsDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const openDoc = useOpenDocAfter(projectId);
  const first = periodOf(new Date().toISOString().slice(0, 10), {});
  const options = [first, nextPeriod(first, {}), nextPeriod(nextPeriod(first, {}), {}), nextPeriod(nextPeriod(nextPeriod(first, {}), {}), {})];
  const [period, setPeriod] = useState(first);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  async function create() {
    setBusy(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const made = await createDocFile(projectId, `goals-${period.toLowerCase()}.md`, goalsMarkdown(period));
      const r = await createGoalsDocAction(projectId, { docSlug: made.slug, period });
      if (!r.success) {
        const { unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
        await unlinkWorkspaceDocAction(projectId, made.slug).catch(() => undefined);
        throw new Error(r.error);
      }
      onOpenChange(false);
      openDoc(made.slug);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t make the goals document");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Set goals" description="One goals document per period, for workspace members only." testId="new-goals-dialog" busy={busy} onClose={() => onOpenChange(false)} onSave={() => void create()} saveLabel={busy ? "Making…" : `Set ${periodLabel(period)} goals`}>
      <Field label="Period" htmlFor="goals-period"><SelectWrap><select id="goals-period" value={period} onChange={(e) => setPeriod(e.target.value)} className={selectClassName()}>
        {options.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
      </select></SelectWrap></Field>
    </Shell>
  );
}
