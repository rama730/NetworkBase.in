"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { addSupervisionNoteAction, decideMilestoneAction, handInMilestoneAction, readLabProgressAction, readProgressAction, setProgressAction } from "@/app/actions/lab-progress";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { MILESTONE_WORDS } from "@/lib/organizations/lab-progress";

// Report 35.6 (plan B6.5b, R5 calls 3–4): My progress (each person) and Supervision and milestones (PI and Researchers).
// Supervision notes are for the person and their supervisors only; dates in full; states as words; no ratings.
type Progress = Extract<Awaited<ReturnType<typeof readProgressAction>>, { success: true; set: true }>;
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const todayIso = () => new Date().toISOString().slice(0, 10);

/** The lab Overview's My progress (shown once the PI or a Researcher set up your progress). */
export function MyProgressCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-progress", orgId, "me"], queryFn: () => readProgressAction(orgId, null), staleTime: 30_000 });
  const d = q.data?.success && q.data.set ? q.data : null;
  if (!d) return null;
  return <OrgCard title="My progress" testId="lab-my-progress"><ProgressPanel orgId={orgId} d={d} onDone={() => void q.refetch()} /></OrgCard>;
}

function ProgressPanel({ orgId, d, onDone }: { orgId: string; d: Progress; onDone: () => void }) {
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); onDone(); };
  const p = d.person;
  return (
    <div className="space-y-3 text-[13px]">
      <p>Supervisor {p.supervisor.name}{p.co ? ` · Co-supervisor ${p.co.name}` : ""} · started {day(p.startDate)}{p.partTime ? " · part-time" : ""}</p>
      <p data-testid="lab-supervision-rhythm">Supervision every {p.weeks === 1 ? "week" : `${p.weeks} weeks`} · {d.rhythm.lastMet ? `last ${day(d.rhythm.lastMet)}` : "none yet"} · next {day(d.rhythm.next)}
        {d.rhythm.overdue ? <span className="font-medium"> · Supervision due</span> : null}</p>
      <section aria-label="Milestones" className="space-y-1"><h3 className="nb-micro">Milestones</h3>
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="lab-milestones">{d.milestones.map((m) => (
          <li key={m.key} className="flex flex-wrap items-center gap-2 px-3 py-1.5"><span className="font-medium">{m.name}</span><span>{day(m.dueOn)}</span>
            <StatusBadge state={m.state === "done" ? "done" : m.state === "handed_in" ? "active" : "draft"}>{MILESTONE_WORDS[m.state]}</StatusBadge>
            {m.movedReason ? <span className="text-muted-foreground">Moved: {m.movedReason}</span> : null}
            {d.self && m.state === "upcoming" ? <button type="button" className="nb-link" onClick={() => void run(handInMilestoneAction(orgId, m.key), "Handed in; your supervisor is told")}>Hand in<span className="sr-only"> {m.name}</span></button> : null}
            {d.canDecide && !d.self && m.state !== "done" ? <MilestoneDecision name={m.name} onDone={(v) => run(decideMilestoneAction(orgId, p.id, m.key, v), "done" in v ? "Marked done" : "Milestone moved")} /> : null}
          </li>))}</ul>
        {!d.milestones.length ? <p className="text-muted-foreground">No milestones for this position.</p> : null}
      </section>
      {d.pair ? <SupervisionLog orgId={orgId} d={d} onDone={onDone} /> : <p className="text-muted-foreground">Supervision notes stay with {p.name} and their supervisors.</p>}
    </div>
  );
}

function MilestoneDecision({ name, onDone }: { name: string; onDone: (v: { done: true } | { moveTo: string; reason: string }) => Promise<void> }) {
  const [moving, setMoving] = useState(false);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  if (!moving) return <span className="flex gap-2"><button type="button" className="nb-link" onClick={() => void onDone({ done: true })}>Mark done<span className="sr-only"> {name}</span></button>
    <button type="button" className="nb-link" onClick={() => setMoving(true)}>Move<span className="sr-only"> {name}</span></button></span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={`New date for ${name}`} className="h-8 w-auto font-mono" />
      <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label={`Why ${name} moves`} placeholder="Why (e.g. time away)" className="h-8 w-[220px]" />
      <button type="button" className={FORM_SECONDARY_CLASS} disabled={!to || !reason.trim()} onClick={() => void onDone({ moveTo: to, reason }).then(() => setMoving(false))}>Move</button>
    </span>
  );
}

function SupervisionLog({ orgId, d, onDone }: { orgId: string; d: Progress; onDone: () => void }) {
  const [f, setF] = useState({ metOn: todayIso(), topics: "", notes: "", nextSteps: "" });
  const save = async () => {
    const r = await safe(addSupervisionNoteAction(orgId, d.person.id, f));
    if (!r.success) return void toast.error(r.error);
    toast.success("Added to the supervision log");
    setF({ metOn: todayIso(), topics: "", notes: "", nextSteps: "" });
    onDone();
  };
  return (
    <section aria-label="Supervision" className="space-y-1.5" data-testid="lab-supervision-log"><h3 className="nb-micro">Supervision <span className="normal-case">(only {d.self ? "you and your supervisors" : `${d.person.name} and their supervisors`} see this)</span></h3>
      <fieldset className="grid gap-1.5 rounded-md border border-border p-2.5 sm:grid-cols-2">
        <label className="flex flex-col">Met on<Input type="date" value={f.metOn} max={todayIso()} onChange={(e) => setF({ ...f, metOn: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
        <label className="flex flex-col">Topics<Input value={f.topics} maxLength={2000} onChange={(e) => setF({ ...f, topics: e.target.value })} className="mt-0.5" /></label>
        <label className="flex flex-col sm:col-span-2">Notes<textarea className="nb-textarea mt-0.5 text-[13px]" rows={2} maxLength={10000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <label className="flex flex-col sm:col-span-2">Next steps<Input value={f.nextSteps} maxLength={2000} onChange={(e) => setF({ ...f, nextSteps: e.target.value })} className="mt-0.5" /></label>
        <span><button type="button" className={FORM_SECONDARY_CLASS} disabled={!f.topics.trim() && !f.notes.trim() && !f.nextSteps.trim()} onClick={() => void save()}>Add to the log</button></span>
      </fieldset>
      <ul className="space-y-1.5">{d.notes.map((n) => (
        <li key={n.id} className="rounded-md border border-border px-3 py-2"><p className="font-medium">{day(n.metOn)}{n.author ? <span className="font-normal text-muted-foreground"> · by {n.author}</span> : null}</p>
          {n.topics ? <p><span className="text-muted-foreground">Topics </span>{n.topics}</p> : null}{n.notes ? <p className="whitespace-pre-wrap">{n.notes}</p> : null}
          {n.nextSteps ? <p><span className="text-muted-foreground">Next steps </span>{n.nextSteps}</p> : null}</li>))}</ul>
    </section>
  );
}

/** PI and Researchers: each person's next milestone and supervision rhythm (dates only), Set up, and a person's page. */
export function LabProgressCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-progress-all", orgId], queryFn: () => readLabProgressAction(orgId), staleTime: 30_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [setup, setSetup] = useState<string>("");
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const unset = d.people.filter((p) => !d.rows.some((r) => r.id === p.id));
  return (
    <OrgCard title="Supervision and milestones" testId="lab-progress-all">
      <div className="space-y-2 text-[13px]">
        {d.rows.length ? <ul className="divide-y divide-border rounded-md border border-border">{d.rows.map((r) => (
          <li key={r.id}><button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span className="font-medium">{r.name}</span>
            <span className="text-muted-foreground">{r.next ? `${r.next.name} ${day(r.next.dueOn)}` : "No milestones left"}</span>
            <span className="text-muted-foreground">· supervision {r.lastMet ? `last ${day(r.lastMet)}` : "none yet"}</span>
            {r.overdue ? <StatusBadge state="at_risk">Supervision due</StatusBadge> : null}</button>
            {open === r.id ? <div className="border-t border-border bg-muted px-3 py-3"><PersonProgress orgId={orgId} id={r.id} /></div> : null}</li>))}</ul>
          : <p className="text-muted-foreground">Set milestones for PhD and Master’s students: pick a person and their start date.</p>}
        {unset.length ? <span className="flex flex-wrap items-center gap-2">
          <select className="nb-select" aria-label="Set up progress for" value={setup} onChange={(e) => setSetup(e.target.value)}><option value="">Set up progress for…</option>
            {unset.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></span> : null}
        {setup ? <Setup orgId={orgId} userId={setup} leads={d.leads} onDone={() => { setSetup(""); void q.refetch(); }} /> : null}
      </div>
    </OrgCard>
  );
}

function PersonProgress({ orgId, id }: { orgId: string; id: string }) {
  const q = useQuery({ queryKey: ["lab-progress", orgId, id], queryFn: () => readProgressAction(orgId, id) });
  const d = q.data?.success && q.data.set ? q.data : null;
  return d ? <ProgressPanel orgId={orgId} d={d} onDone={() => void q.refetch()} /> : null;
}

function Setup({ orgId, userId, leads, onDone }: { orgId: string; userId: string; leads: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [f, setF] = useState({ startDate: "", partTime: false, coSupervisorId: null as string | null, weeks: 2 });
  const save = async () => {
    const r = await safe(setProgressAction(orgId, userId, f));
    if (!r.success) return void toast.error(r.error);
    toast.success(r.milestones ? `Progress set up with ${r.milestones} milestones` : "Progress set up (no milestone template for this position)");
    onDone();
  };
  return (
    <fieldset className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2.5" data-testid="lab-progress-setup">
      <label className="flex flex-col">Start date<Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
      <label className="flex flex-col">Supervision every<select className="nb-select mt-0.5" value={f.weeks} onChange={(e) => setF({ ...f, weeks: Number(e.target.value) })}>
        {[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w === 1 ? "week" : `${w} weeks`}</option>)}</select></label>
      <label className="flex flex-col">Co-supervisor (optional)<select className="nb-select mt-0.5" value={f.coSupervisorId ?? ""} onChange={(e) => setF({ ...f, coSupervisorId: e.target.value || null })}>
        <option value="">None</option>{leads.filter((l) => l.id !== userId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" className="nb-check" checked={f.partTime} onChange={(e) => setF({ ...f, partTime: e.target.checked })} />Part-time (milestone months doubled)</label>
      <button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.startDate} onClick={() => void save()}>Set up</button>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button>
    </fieldset>
  );
}
