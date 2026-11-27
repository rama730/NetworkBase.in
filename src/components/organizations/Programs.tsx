"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";

import { confirmNumberAction, readProgramsAction, setProgramStateAction, startProgramAction, typeNumberAction } from "@/app/actions/programs";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { measureLine, MEASURE_SOURCES, PROGRAM_STATE_WORDS, PROGRAM_STATES, SOURCE_WORDS, type Measure, type ProgramState } from "@/lib/organizations/programs";

const safe = <T,>(p: Promise<T>) => p.catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const span = (a: string | null, b: string | null) => (!a && !b ? "Ongoing" : !b ? `Ongoing since ${day(a!)}` : `${a ? day(a) : "…"} to ${day(b)}`);
const EMPTY = { title: "", aim: "", place: "", start: "", end: "", goal: "", ownerId: "", public: false, measures: [] as Measure[], brief: { change: "", reality: "", whyNow: "", mission: "", serves: "", howWeKnow: "" } };

/**
 * Programs (B8.3a, report 37.5): each program with its state, dates or Ongoing, owner, goal and measures as text
 * ("46 of 50", "not yet confirmed"); owners type numbers and admins confirm them; admins start programs from a brief.
 */
export function ProgramsCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["programs", orgId], queryFn: () => readProgramsAction(orgId), staleTime: 60_000 });
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.programs.length && !d.admin)) return null;
  const refresh = () => void q.refetch();
  const run = async (x: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await safe(x); if (!r.success) { toast.error(r.error ?? "Couldn’t save that."); return false; } toast.success(ok); refresh(); return true; };
  const brief = (k: keyof typeof EMPTY.brief, label: string) => form && <label className="flex flex-col sm:col-span-2">{label}<textarea className="nb-textarea mt-0.5 text-[13px]" rows={2} maxLength={k === "serves" ? 300 : 2000} value={form.brief[k]} onChange={(e) => setForm({ ...form, brief: { ...form.brief, [k]: e.target.value } })} /></label>;
  return (
    <OrgCard title="Programs" testId="programs" action={d.admin && !form ? <button type="button" className="nb-link text-[13px]" onClick={() => setForm(EMPTY)}>Start a program</button> : null}>
      <div className="space-y-3 text-[13px]">
        {form ? <fieldset className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-2" data-testid="program-form"><legend className="sr-only">Program brief</legend>
          <label className="flex flex-col">Name<Input value={form.title} maxLength={100} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-0.5" /></label>
          <label className="flex flex-col">Owner<select className="nb-select mt-0.5" value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}><option value="">Pick someone</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="flex flex-col sm:col-span-2">Aim (one line)<Input value={form.aim} maxLength={300} onChange={(e) => setForm({ ...form, aim: e.target.value })} className="mt-0.5" /></label>
          <label className="flex flex-col">Place<Input value={form.place} maxLength={120} onChange={(e) => setForm({ ...form, place: e.target.value })} className="mt-0.5" /></label>
          <label className="flex flex-col">Impact goal it supports<Input value={form.goal} maxLength={80} onChange={(e) => setForm({ ...form, goal: e.target.value })} className="mt-0.5" /></label>
          <label className="flex flex-col">Starts<Input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          <label className="flex flex-col">Ends (empty: Ongoing)<Input type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="mt-0.5 w-auto font-mono" /></label>
          {brief("change", "What we want to change")}{brief("reality", "The desired reality")}{brief("whyNow", "Why now")}{brief("mission", "How it fits our mission")}{brief("serves", "Who it’s for (in words; never a list of people)")}{brief("howWeKnow", "How we’ll know")}
          <div className="space-y-1 sm:col-span-2"><span className="font-medium">Measures (up to 5)</span>
            {form.measures.map((m, i) => <span key={i} className="flex flex-wrap items-center gap-2">
              <Input value={m.name} maxLength={80} aria-label={`Measure ${i + 1} name`} onChange={(e) => setForm({ ...form, measures: form.measures.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className="w-[200px]" />
              <select className="nb-select" aria-label={`Measure ${i + 1} source`} value={m.source} onChange={(e) => setForm({ ...form, measures: form.measures.map((x, j) => (j === i ? { ...x, source: e.target.value as Measure["source"] } : x)) })}>
                {MEASURE_SOURCES.map((k) => <option key={k} value={k}>{SOURCE_WORDS[k]}</option>)}</select>
              <Input type="number" min={0} value={m.target ?? ""} aria-label={`Measure ${i + 1} target`} placeholder="Target" onChange={(e) => setForm({ ...form, measures: form.measures.map((x, j) => (j === i ? { ...x, target: e.target.value ? Number(e.target.value) : null } : x)) })} className="w-[100px] font-mono" /></span>)}
            {form.measures.length < 5 ? <button type="button" className="nb-link" onClick={() => setForm({ ...form, measures: [...form.measures, { id: `m${form.measures.length + 1}`, name: "", source: "typed", target: null }] })}>Add a measure</button> : null}</div>
          <label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={form.public} onChange={(e) => setForm({ ...form, public: e.target.checked })} />Show on About</label>
          <span className="flex gap-2 sm:col-span-2">
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!form.title.trim() || !form.aim.trim() || !form.ownerId} onClick={() => void run(startProgramAction(orgId, { ...form, start: form.start || null, end: form.end || null, measures: form.measures.filter((m) => m.name.trim()) }), "Program started").then((ok) => ok && setForm(null))}>Start the program</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setForm(null)}>Cancel</button></span>
        </fieldset> : null}
        <ul className="space-y-2">{d.programs.map((p) => (
          <li key={p.id} className="space-y-1 rounded-md border border-border p-3" data-testid="program">
            <p className="flex flex-wrap items-center gap-2"><HeartHandshake aria-hidden="true" className="size-4 text-muted-foreground" />
              {p.slug ? <a className="nb-link font-medium" href={`/workspaces/${encodeURIComponent(p.slug)}`}>{p.title}</a> : <span className="font-medium">{p.title}</span>}
              <StatusBadge state={p.state === "closed" ? "done" : p.state === "paused" ? "at_risk" : p.state === "planned" ? "draft" : "active"}>{PROGRAM_STATE_WORDS[p.state]}</StatusBadge>
              {p.goal ? <span className="nb-tag">{p.goal}</span> : d.admin ? <span className="text-muted-foreground">Not linked</span> : null}</p>
            <p className="text-muted-foreground">{span(p.start, p.end)}{p.owner ? ` · Owner ${p.owner}` : ""}{p.aim ? ` · ${p.aim}` : ""}</p>
            {p.measures.length ? <ul className="space-y-0.5" aria-label={`Measures of ${p.title}`}>{p.measures.map((m) => <li key={m.id} className="flex flex-wrap items-center gap-2" data-testid="program-measure">
              <span>{m.name}: {measureLine(m.value, m.target)}</span><span className="text-muted-foreground">({SOURCE_WORDS[m.source]}{m.waiting ? " · a number is waiting confirmation" : ""})</span>
              {m.source === "typed" && p.canType ? <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); const v = Number(typed[`${p.id}:${m.id}`]); if (typed[`${p.id}:${m.id}`] && v >= 0) void run(typeNumberAction(orgId, p.id, m.id, v), "Sent for confirmation").then((ok) => ok && setTyped({ ...typed, [`${p.id}:${m.id}`]: "" })); }}>
                <Input type="number" min={0} value={typed[`${p.id}:${m.id}`] ?? ""} aria-label={`New number for ${m.name}`} onChange={(e) => setTyped({ ...typed, [`${p.id}:${m.id}`]: e.target.value })} className="h-8 w-[100px] font-mono" />
                <button type="submit" className={FORM_SECONDARY_CLASS}>Send</button></form> : null}</li>)}</ul> : null}
            {d.admin ? <select className="nb-select" aria-label={`State of ${p.title}`} value={p.state} onChange={(e) => void run(setProgramStateAction(orgId, p.id, e.target.value as ProgramState), "Saved")}>
              {PROGRAM_STATES.map((s) => <option key={s} value={s}>{PROGRAM_STATE_WORDS[s]}</option>)}</select> : null}
          </li>))}</ul>
        {d.admin && d.waiting.length ? <section aria-label="Numbers waiting confirmation"><h4 className="font-medium">Numbers waiting confirmation</h4>
          <ul className="mt-1 space-y-1">{d.waiting.map((w) => <li key={w.id} className="flex flex-wrap items-center gap-2" data-testid="program-waiting">
            <span>{w.program} · {w.measure}: {w.value}{w.by ? ` · typed by ${w.by}` : ""}</span>
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(confirmNumberAction(orgId, w.id, true), "Confirmed")}>Confirm<span className="sr-only"> {w.measure} for {w.program}</span></button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(confirmNumberAction(orgId, w.id, false), "Declined")}>Decline<span className="sr-only"> {w.measure} for {w.program}</span></button></li>)}</ul></section> : null}
      </div>
    </OrgCard>
  );
}
