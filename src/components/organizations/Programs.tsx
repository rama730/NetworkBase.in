"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readProgramsAction, saveAsProgramAction, startCohortAction, updateProgramAction, type ProgramRow } from "@/app/actions/programs";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { COHORT_WORDS, cohortEnd } from "@/lib/organizations/programs";

// Report 31.2 C1 (plan B2.1a): the school's Programs — cohorts by program, Start a cohort, Retire, Save as program.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmt = (d: string | null) => (d ? DAY.format(new Date(`${d}T00:00:00Z`)) : "—");
const COPY = [["sprints", "Plan and lessons"], ["assignments", "Assignments (as drafts)"], ["docs", "Documents"], ["files", "Materials"], ["about", "About and settings"], ["channels", "Channels"], ["admins", "Staff"]] as const;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function ProgramsSection({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["programs", schoolId], queryFn: () => readProgramsAction(schoolId), staleTime: 30_000 });
  const [starting, setStarting] = useState<string | null>(null);
  if (!q.data?.success) return null;
  const refresh = () => client.invalidateQueries({ queryKey: ["programs", schoolId] });
  const list = q.data.programs;
  return (
    <section aria-label="Programs" className="space-y-2" data-testid="programs">
      <h2 className="nb-section-title">Programs <span className="nb-meta font-mono">{list.length}</span></h2>
      {list.length === 0 ? <p className="text-[13px] text-muted-foreground">Make your first program from a cohort you’ve run: Save as program on one of the classes below.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-[13px]">
          {list.map((p) => (
            <li key={p.id} className="space-y-2 px-4 py-3" data-testid="program-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0"><span className="font-medium">{p.name}</span>{p.status === "retired" ? <StatusBadge state="archived" className="ml-2">Retired</StatusBadge> : null}
                  <span className="nb-meta ml-2 font-mono">{p.weeks ? `${p.weeks} weeks · ` : ""}{p.cohorts} {p.cohorts === 1 ? "cohort" : "cohorts"} · next start {fmt(p.nextStart)}{p.seats ? ` · ${p.seats} seats` : ""}</span></span>
                <span className="flex gap-3">
                  {p.status !== "retired" ? <button type="button" className={LINK} onClick={() => setStarting(starting === p.id ? null : p.id)}>Start a cohort<span className="sr-only"> of {p.name}</span></button> : null}
                  <button type="button" className={LINK} onClick={() => void updateProgramAction(p.id, { status: p.status === "retired" ? "active" : "retired" }).then((r) => { if (!r.success) return void toast.error(r.error); void refresh(); })}>
                    {p.status === "retired" ? "Restore" : "Retire"}<span className="sr-only"> {p.name}</span></button>
                </span>
              </div>
              {p.sourceClass ? <p className="text-[12px] text-muted-foreground">From {p.sourceClass}</p> : null}
              {p.list.length ? (
                <ul className="flex flex-wrap gap-2" aria-label={`${p.name} cohorts`}>
                  {p.list.map((c) => (
                    <li key={c.id}><Link href={`/org/${encodeURIComponent(c.slug ?? c.id)}`} className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1 hover:bg-muted">
                      {c.title} <StatusBadge state={c.state === "running" ? "active" : c.state === "upcoming" ? "new" : "done"}>{COHORT_WORDS[c.state]}</StatusBadge>
                      <span className="font-mono text-[12px] text-muted-foreground">{c.members}{p.seats ? ` / ${p.seats}` : ""}</span></Link></li>
                  ))}
                </ul>
              ) : null}
              {starting === p.id ? <StartCohort program={p} onDone={() => { setStarting(null); void refresh(); }} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StartCohort({ program, onDone }: { program: ProgramRow; onDone: () => void }) {
  const next = program.cohorts + 1;
  const [name, setName] = useState(`${program.name} · Cohort ${next}`);
  const [start, setStart] = useState("");
  const [seats, setSeats] = useState(program.seats ? String(program.seats) : "");
  const [approval, setApproval] = useState(true);
  const [copy, setCopy] = useState({ sprints: true, assignments: true, docs: true, files: true, about: true, channels: true, admins: false });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await startCohortAction(program.id, { name, handle: `${slugify(name)}`.slice(0, 40) || `cohort-${next}`, start, seats: seats ? Number(seats) : null, joinMode: approval ? "approval" : "instant", copy });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Starting ${name}. You’ll be told when it’s ready.`);
    onDone();
  };
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="start-cohort">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-3"><span className="font-medium">Name</span><Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="font-medium">Starts</span><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" /></label>
        <label className="flex flex-col gap-1"><span className="font-medium">Seats</span><Input type="number" min={1} max={5000} value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="No limit" /></label>
        <p className="self-end text-[12px] text-muted-foreground">{start && program.weeks ? `Ends ${fmt(cohortEnd(start, program.weeks))} (${program.weeks} weeks)` : ""}</p>
      </div>
      <label className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />Joining needs approval</label>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="mb-1 font-medium">Copy</legend>
        {COPY.map(([k, label]) => <label key={k} className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={copy[k]} onChange={(e) => setCopy({ ...copy, [k]: e.target.checked })} />{label}</label>)}
      </fieldset>
      <p className="text-[12px] text-muted-foreground">Never copied: learners, hand-ins, marks or attendance.</p>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !start || name.trim().length < 3} onClick={() => void submit()}>Start cohort</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </div>
  );
}

/** Save as program, on a class row of the school (admins). */
export function SaveAsProgram({ classId, title, schoolId }: { classId: string; title: string; schoolId: string }) {
  const client = useQueryClient();
  return (
    <button type="button" className={LINK} onClick={() => void saveAsProgramAction(classId, title).then((r) => {
      if (!r.success) return void toast.error(r.error);
      toast.success(`${title} saved as a program`);
      void client.invalidateQueries({ queryKey: ["programs", schoolId] });
    })}>Save as program<span className="sr-only"> from {title}</span></button>
  );
}
