"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Presentation } from "lucide-react";

import { addSessionToLabNotesAction, answerSwapAction, askSwapAction, finishReadingAction, pickReadingAction, readReadingGroupAction, saveReadingGroupAction } from "@/app/actions/lab-reading-group";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { SESSION_WORDS } from "@/lib/organizations/lab-reading-group";

// Report 35.4 (plan B6.4b, R3 calls 6–7): the Library's Reading group view — the next sessions with presenter and paper,
// pick and swap for the presenter, finish with notes, past sessions, suggestions; the PI and Researchers set it up.
type Data = Extract<Awaited<ReturnType<typeof readReadingGroupAction>>, { success: true }>;
type Session = Data["upcoming"][number];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const when = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
const day = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date(iso));

export function LabReadingGroup({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["lab-reading-group", orgId], queryFn: () => readReadingGroupAction(orgId), staleTime: 30_000 });
  const [setup, setSetup] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (q.isPending) return <p role="status" className="nb-waiting text-muted-foreground"><PixelBeat />Loading the reading group…</p>;
  if (!d) return null;
  const refresh = () => void q.refetch();
  if (setup) return <Setup orgId={orgId} d={d} onDone={() => { setSetup(false); refresh(); }} />;
  if (!d.settings.on) return (
    <div className="rounded-md border border-dashed border-border p-6 text-center text-muted-foreground" data-testid="lab-reading-group">
      <p>{d.admin ? "Start a reading group: a weekly slot, a presenter in turn, and one paper to read before." : "No reading group yet. The PI or a Researcher starts one."}</p>
      {d.admin ? <button type="button" className={`${FORM_PRIMARY_CLASS} mt-3`} onClick={() => setSetup(true)}>Start a reading group</button> : null}
    </div>
  );
  return (
    <div className="space-y-3" data-testid="lab-reading-group">
      <p className="flex flex-wrap items-center gap-2"><Presentation className="size-4" aria-hidden="true" /><span className="font-medium">Every {WEEKDAYS[d.settings.weekday]} at {d.settings.time}</span>
        <span className="text-muted-foreground">· the presenter picks the paper {d.settings.pickDays} {d.settings.pickDays === 1 ? "day" : "days"} before</span>
        {d.admin ? <button type="button" className="nb-link" onClick={() => setSetup(true)}>Change</button> : null}</p>
      <ul className="divide-y divide-border rounded-md border border-border">{d.upcoming.map((s) => <Upcoming key={s.id} orgId={orgId} s={s} d={d} onDone={refresh} />)}</ul>
      {d.suggestions.length ? <section aria-label="Suggestions"><h3 className="font-medium">Suggestions</h3>
        <ul className="mt-1 space-y-0.5">{d.suggestions.map((x) => <li key={x.id}>{x.title}{x.by ? <span className="text-muted-foreground"> · suggested by {x.by}</span> : null}</li>)}</ul></section> : null}
      {d.past.length ? <section aria-label="Past sessions" className="space-y-1"><h3 className="font-medium">Past sessions</h3>
        <ul className="divide-y divide-border rounded-md border border-border">{d.past.map((s) => (
          <li key={s.id} className="space-y-1 px-3 py-2" data-testid="lab-reading-past"><p><span className="font-medium">{day(s.startsAt, d.tz)}</span> · {s.presenter?.name ?? "No presenter"} · {s.source?.title ?? "No paper"}</p>
            {s.notes ? <p className="whitespace-pre-wrap text-muted-foreground">{s.notes}</p> : null}
            {s.notes && s.source ? <button type="button" className="nb-link" onClick={() => void safe(addSessionToLabNotesAction(orgId, s.id)).then((r) => r.success ? toast.success("Added to the source’s lab notes") : toast.error(r.error))}>Add to lab notes</button> : null}
          </li>))}</ul></section> : null}
    </div>
  );
}

function Upcoming({ orgId, s, d, onDone }: { orgId: string; s: Session; d: Data; onDone: () => void }) {
  const [pick, setPick] = useState("");
  const [swapTo, setSwapTo] = useState("");
  const [notes, setNotes] = useState("");
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) return void toast.error(r.error ?? "Couldn’t save that."); toast.success(ok); onDone(); };
  const started = Date.parse(s.startsAt) <= Date.now();
  return (
    <li className="space-y-1.5 px-3 py-2" data-testid="lab-reading-session">
      <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{when(s.startsAt, d.tz)}</span><span>{s.presenter?.name ?? "No presenter (everyone in turn is away)"}</span>
        <StatusBadge state={s.state === "picked" ? "active" : "draft"}>{SESSION_WORDS[s.state]}</StatusBadge>
        {s.source ? <span>{s.source.title}{s.readBefore ? <span className="text-muted-foreground"> · Read before posted</span> : null}</span> : <span className="text-muted-foreground">Pick by {day(s.pickBy, d.tz)}</span>}</p>
      {s.swap && s.swap.to === d.me ? <span className="flex flex-wrap items-center gap-2"><span>{s.presenter?.name} asks you to swap.</span>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(answerSwapAction(orgId, s.swap!.id, true), "You present this session")}>Accept</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(answerSwapAction(orgId, s.swap!.id, false), "Swap declined")}>Decline</button></span> : null}
      {s.swap && s.swap.from === d.me ? <p className="text-muted-foreground">Waiting for {s.swap.toName ?? "them"} to answer your swap.</p> : null}
      {s.canRun && !started ? <span className="flex flex-wrap items-center gap-2">
        <select className="nb-select max-w-[320px]" aria-label="Paper for this session" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{s.source ? "Change the paper" : "Pick the paper"}</option>{d.sources.map((x) => <option key={x.id} value={x.id}>{x.title}{d.suggestions.some((y) => y.id === x.id) ? " (suggested)" : ""}</option>)}</select>
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={!pick} onClick={() => void run(pickReadingAction(orgId, s.id, pick), "Paper picked; members are told to read it")}>Pick</button>
        {s.mine && !s.swap && d.people.some((p) => p.id !== d.me) ? <>
          <select className="nb-select" aria-label="Swap with" value={swapTo} onChange={(e) => setSwapTo(e.target.value)}>
            <option value="">Swap with…</option>{d.people.filter((p) => p.id !== d.me).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!swapTo} onClick={() => void run(askSwapAction(orgId, s.id, swapTo), "Swap asked")}>Ask</button>
        </> : null}
      </span> : null}
      {s.canRun && started ? <span className="flex flex-col gap-1.5">
        <textarea className="nb-textarea w-full text-[13px]" rows={3} maxLength={20000} aria-label="Discussion notes" placeholder="Discussion notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <span><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(finishReadingAction(orgId, s.id, notes), "Session finished")}>Finish the session</button></span></span> : null}
    </li>
  );
}

function Setup({ orgId, d, onDone }: { orgId: string; d: Data; onDone: () => void }) {
  const [f, setF] = useState({ ...d.settings, on: true });
  const move = (i: number, by: number) => { const j = i + by; const o = [...f.order]; [o[i], o[j]] = [o[j]!, o[i]!]; setF({ ...f, order: o }); };
  const nameOf = (id: string) => d.people.find((p) => p.id === id)?.name ?? "Someone";
  const save = async (on: boolean) => {
    const r = await safe(saveReadingGroupAction(orgId, { ...f, on }));
    if (!r.success) return void toast.error(r.error);
    toast.success(on ? "Reading group saved" : "Reading group stopped");
    onDone();
  };
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3" data-testid="lab-reading-setup">
      <legend className="px-1 font-medium">Reading group</legend>
      <span className="flex flex-wrap gap-3">
        <label className="flex flex-col">Day<select className="nb-select mt-1" value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select></label>
        <label className="flex flex-col">Time<Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} className="mt-1 w-auto font-mono" /></label>
        <label className="flex flex-col">Pick the paper<select className="nb-select mt-1" value={f.pickDays} onChange={(e) => setF({ ...f, pickDays: Number(e.target.value) })}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} {n === 1 ? "day" : "days"} before</option>)}</select></label>
      </span>
      <fieldset className="space-y-1"><legend className="font-medium">Presenters, in turn</legend>
        <ol className="space-y-1">{f.order.map((id, i) => (
          <li key={id} className="flex items-center gap-2"><span className="font-mono">{i + 1}.</span>{nameOf(id)}
            {i > 0 ? <button type="button" className="nb-link" onClick={() => move(i, -1)}>Up<span className="sr-only"> {nameOf(id)}</span></button> : null}
            {i < f.order.length - 1 ? <button type="button" className="nb-link" onClick={() => move(i, 1)}>Down<span className="sr-only"> {nameOf(id)}</span></button> : null}
            <button type="button" className="nb-link" onClick={() => setF({ ...f, order: f.order.filter((x) => x !== id) })}>Remove<span className="sr-only"> {nameOf(id)}</span></button></li>))}</ol>
        <select className="nb-select" aria-label="Add a presenter" value="" onChange={(e) => e.target.value && setF({ ...f, order: [...f.order, e.target.value] })}>
          <option value="">Add a presenter</option>{d.people.filter((p) => !f.order.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <p className="text-muted-foreground">Anyone Away on a session’s day is skipped; the next person in turn presents.</p>
      </fieldset>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.order.length} onClick={() => void save(true)}>Save</button>
        {d.settings.on ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save(false)}>Stop the reading group</button> : null}
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </fieldset>
  );
}
