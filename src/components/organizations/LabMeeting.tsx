"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { readLabMeetingAction, saveLabMeetingAction, saveMyUpdateAction, saveTalkAction } from "@/app/actions/lab-meeting";
import { answerSwapAction, askSwapAction, finishReadingAction } from "@/app/actions/lab-reading-group";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 35.6 (plan B6.5a, R5 calls 1–2): the lab Overview's Lab meeting — Coming up, the updates round (optional; Away
// as a word; no attendance), the talk with its presenter in turn, Swap with, Finish with decisions and action items.
type Data = Extract<Awaited<ReturnType<typeof readLabMeetingAction>>, { success: true }>;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const fmt = (iso: string, tz: string, time = false) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: tz }).format(new Date(iso));
const ROUND_WORDS = { filled: "Filled", not_filled: "Not filled", away: "Away" } as const;

export function LabMeetingCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-meeting", orgId], queryFn: () => readLabMeetingAction(orgId), staleTime: 30_000 });
  const [setup, setSetup] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => void q.refetch();
  if (setup) return <OrgCard title="Lab meeting" testId="lab-meeting"><Setup orgId={orgId} d={d} onDone={() => { setSetup(false); refresh(); }} /></OrgCard>;
  if (!d.settings.on) return d.admin ? (
    <OrgCard title="Lab meeting" testId="lab-meeting"><p className="text-[13px] text-muted-foreground">Set up the lab meeting: a weekly slot, a talk in turn, and an updates round people fill before it.</p>
      <button type="button" className={`${FORM_PRIMARY_CLASS} mt-2`} onClick={() => setSetup(true)}>Set up the lab meeting</button></OrgCard>) : null;
  const n = d.next;
  return (
    <OrgCard title={`Lab meeting · every ${WEEKDAYS[d.settings.weekday]} at ${d.settings.time}`} testId="lab-meeting" action={d.admin ? <button type="button" className="nb-link text-[13px]" onClick={() => setSetup(true)}>Change</button> : null}>
      <div className="space-y-3 text-[13px]">
        {n ? <>
          <p className="font-medium">{fmt(n.startsAt, d.tz, true)}</p>
          {d.comingUp ? <section aria-label="Coming up"><h3 className="nb-micro">Coming up</h3>
            <p className="mt-1 flex flex-wrap gap-1.5" data-testid="lab-meeting-coming-up">
              {d.comingUp.papers.map((p) => <StatusBadge key={p.title} state="at_risk">{p.title} due {fmt(`${p.deadline}T12:00:00Z`, "UTC")}</StatusBadge>)}
              {d.comingUp.running ? <StatusBadge state="active">{d.comingUp.running} {d.comingUp.running === 1 ? "experiment" : "experiments"} running</StatusBadge> : null}
              {d.comingUp.readingGroup ? <StatusBadge state="neutral">Reading group {fmt(d.comingUp.readingGroup.at, d.tz)}{d.comingUp.readingGroup.title ? `: ${d.comingUp.readingGroup.title}` : ""}</StatusBadge> : null}
              {!d.comingUp.papers.length && !d.comingUp.running && !d.comingUp.readingGroup ? <span className="text-muted-foreground">Nothing due in the next two weeks.</span> : null}
            </p></section> : null}
          {n.announcements ? <p className="whitespace-pre-wrap">{n.announcements}</p> : null}
          <Talk orgId={orgId} d={d} onDone={refresh} />
          <section aria-label="Updates round" className="space-y-1.5" data-testid="lab-meeting-round"><h3 className="nb-micro">Updates round</h3>
            {d.updatesOpen ? <MyUpdate orgId={orgId} sessionId={n.id} mine={d.round.find((r) => r.id === d.me) ?? null} onDone={refresh} />
              : <p className="text-muted-foreground">The updates box opens 2 days before the meeting.</p>}
            <ul className="divide-y divide-border rounded-md border border-border">{d.round.filter((r) => r.id !== d.me).map((r) => (
              <li key={r.id} className="px-3 py-1.5"><h4 className="flex items-center gap-2 font-medium">{r.name}{r.state !== "filled" ? <span className="font-normal text-muted-foreground">{ROUND_WORDS[r.state]}</span> : null}</h4>
                {r.state === "filled" ? <dl className="grid grid-cols-[auto_1fr] gap-x-3"><dt className="text-muted-foreground">Since last time</dt><dd>{r.sinceLast || "—"}</dd><dt className="text-muted-foreground">Next</dt><dd>{r.next || "—"}</dd>
                  <dt className="text-muted-foreground">Stuck on</dt><dd>{r.stuckOn || "—"}</dd></dl> : null}</li>))}</ul>
          </section>
          {n.canRun && Date.parse(n.startsAt) <= Date.now() ? <Finish orgId={orgId} sessionId={n.id} onDone={refresh} /> : null}
          {d.upcoming.length > 1 ? <p className="text-muted-foreground">Then: {d.upcoming.slice(1).map((s) => `${s.presenter?.name ?? "no presenter"} (${fmt(s.startsAt, d.tz)})`).join(", ")}</p> : null}
        </> : <p className="text-muted-foreground">No meeting coming up.</p>}
        {d.past.length ? <details><summary className="cursor-pointer text-muted-foreground">Past meetings</summary>
          <ul className="mt-1 space-y-1">{d.past.map((s) => <li key={s.id}><span className="font-medium">{fmt(s.startsAt, d.tz)}</span>{s.talk ? ` · ${s.presenter?.name ?? ""}: ${s.talk}` : ""}
            {s.notes ? <span className="block whitespace-pre-wrap text-muted-foreground">{s.notes}</span> : null}</li>)}</ul></details> : null}
      </div>
    </OrgCard>
  );
}

function Talk({ orgId, d, onDone }: { orgId: string; d: Data; onDone: () => void }) {
  const n = d.next!;
  const [talk, setTalk] = useState(n.talk);
  const [notes, setNotes] = useState(n.announcements);
  const [swapTo, setSwapTo] = useState("");
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); onDone(); };
  return (
    <section aria-label="Talk" className="space-y-1.5" data-testid="lab-meeting-talk"><h3 className="nb-micro">Talk</h3>
      <p>{n.presenter ? n.presenter.name : "No presenter (everyone in turn is away)"}{n.talk ? ` · ${n.talk}` : n.presenter ? " · title to come" : ""}</p>
      {n.swap && n.swap.to === d.me ? <span className="flex flex-wrap items-center gap-2"><span>{n.presenter?.name} asks you to give this talk.</span>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(answerSwapAction(orgId, n.swap!.id, true), "You give this talk")}>Accept</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(answerSwapAction(orgId, n.swap!.id, false), "Swap declined")}>Decline</button></span> : null}
      {n.swap && n.swap.from === d.me ? <p className="text-muted-foreground">Waiting for {n.swap.toName ?? "them"} to answer your swap.</p> : null}
      {n.canRun ? <span className="flex flex-wrap items-center gap-2">
        <Input value={talk} maxLength={200} onChange={(e) => setTalk(e.target.value)} aria-label="Talk title" placeholder="Talk title (slides in Files)" className="min-w-[240px] flex-1" />
        {d.admin ? <Input value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} aria-label="Announcements" placeholder="Announcements" className="min-w-[200px] flex-1" /> : null}
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(saveTalkAction(orgId, n.id, { talk, announcements: notes }), "Saved")}>Save</button>
        {n.mine && !n.swap ? <>
          <select className="nb-select" aria-label="Swap with" value={swapTo} onChange={(e) => setSwapTo(e.target.value)}><option value="">Swap with…</option>
            {d.people.filter((p) => p.id !== d.me).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!swapTo} onClick={() => void run(askSwapAction(orgId, n.id, swapTo), "Swap asked")}>Ask</button></> : null}
      </span> : null}
    </section>
  );
}

function MyUpdate({ orgId, sessionId, mine, onDone }: { orgId: string; sessionId: string; mine: Data["round"][number] | null; onDone: () => void }) {
  const [f, setF] = useState({ sinceLast: mine?.sinceLast ?? "", next: mine?.next ?? "", stuckOn: mine?.stuckOn ?? "" });
  const save = async () => { const r = await safe(saveMyUpdateAction(orgId, sessionId, f)); if (!r.success) return void toast.error(r.error); toast.success("Your update is in"); onDone(); };
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-2.5" data-testid="lab-meeting-my-update"><legend className="px-1 font-medium">Your update (optional)</legend>
      {([["sinceLast", "Since last time"], ["next", "Next"], ["stuckOn", "Stuck on"]] as const).map(([k, label]) => (
        <label key={k} className="flex flex-col">{label}<Input value={f[k]} maxLength={1000} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="mt-0.5" /></label>))}
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save()}>Save my update</button>
    </fieldset>
  );
}

function Finish({ orgId, sessionId, onDone }: { orgId: string; sessionId: string; onDone: () => void }) {
  const [notes, setNotes] = useState("");
  return (
    <span className="flex flex-col gap-1.5">
      <textarea className="nb-textarea w-full text-[13px]" rows={3} maxLength={20000} aria-label="Decisions and action items" placeholder="Decisions and action items" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <span><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void safe(finishReadingAction(orgId, sessionId, notes)).then((r) => { if (!r.success) return void toast.error(r.error); toast.success("Meeting finished"); onDone(); })}>Finish the meeting</button></span>
    </span>
  );
}

function Setup({ orgId, d, onDone }: { orgId: string; d: Data; onDone: () => void }) {
  const [f, setF] = useState({ ...d.settings, on: true });
  const nameOf = (id: string) => d.people.find((p) => p.id === id)?.name ?? "Someone";
  const move = (i: number, by: number) => { const o = [...f.order]; [o[i], o[i + by]] = [o[i + by]!, o[i]!]; setF({ ...f, order: o }); };
  const save = async (on: boolean) => { const r = await safe(saveLabMeetingAction(orgId, { ...f, on })); if (!r.success) return void toast.error(r.error); toast.success(on ? "Lab meeting saved" : "Lab meeting stopped"); onDone(); };
  return (
    <fieldset className="space-y-3 text-[13px]" data-testid="lab-meeting-setup">
      <span className="flex flex-wrap gap-3">
        <label className="flex flex-col">Day<select className="nb-select mt-1" value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select></label>
        <label className="flex flex-col">Time<Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} className="mt-1 w-auto font-mono" /></label>
      </span>
      <fieldset className="space-y-1"><legend className="font-medium">Talk presenters, in turn</legend>
        <ol className="space-y-1">{f.order.map((id, i) => <li key={id} className="flex items-center gap-2"><span className="font-mono">{i + 1}.</span>{nameOf(id)}
          {i > 0 ? <button type="button" className="nb-link" onClick={() => move(i, -1)}>Up<span className="sr-only"> {nameOf(id)}</span></button> : null}
          {i < f.order.length - 1 ? <button type="button" className="nb-link" onClick={() => move(i, 1)}>Down<span className="sr-only"> {nameOf(id)}</span></button> : null}
          <button type="button" className="nb-link" onClick={() => setF({ ...f, order: f.order.filter((x) => x !== id) })}>Remove<span className="sr-only"> {nameOf(id)}</span></button></li>)}</ol>
        <select className="nb-select" aria-label="Add a presenter" value="" onChange={(e) => e.target.value && setF({ ...f, order: [...f.order, e.target.value] })}>
          <option value="">Add a presenter</option>{d.people.filter((p) => !f.order.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <p className="text-muted-foreground">Anyone Away that day is skipped. The updates round is optional and never takes attendance.</p>
      </fieldset>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.order.length} onClick={() => void save(true)}>Save</button>
        {d.settings.on ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save(false)}>Stop the lab meeting</button> : null}
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </fieldset>
  );
}
