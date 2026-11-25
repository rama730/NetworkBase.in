"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { bookObservationAction, readObservationAction, readObservationsAction, writeObservationAction } from "@/app/actions/staff-observations";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 32.6 S5 (plan B3.5c): observations — feedback only (Strengths and One next step), booked with notice.
export function Observations({ schoolId, staff }: { schoolId: string; staff: Array<{ id: string; name: string }> }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["observations", schoolId], queryFn: () => readObservationsAction(schoolId), staleTime: 15_000 });
  const [book, setBook] = useState({ observedId: "", day: "", focus: "", justBetweenUs: false });
  const [writing, setWriting] = useState<Record<string, { strengths: string; nextStep: string }>>({});
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => client.invalidateQueries({ queryKey: ["observations", schoolId] });
  const run = async (p: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await p; if (!r.success) return void toast.error(r.error ?? "Couldn’t save."); toast.success(ok); void refresh(); };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-label="Observations" className="space-y-3 text-[13px]" data-testid="observations">
      <p className="font-medium">Observations <span className="font-normal text-muted-foreground">· feedback only: Strengths and One next step</span>
        {d.counts ? <span className="font-normal text-muted-foreground"> · school: {d.counts.booked} booked, {d.counts.written} written, {d.counts.read} read</span> : null}</p>
      {d.ofMe.length ? (
        <ul className="space-y-2" aria-label="Observations of me">
          {d.ofMe.map((o) => (
            <li key={o.id} className="rounded-md border border-border p-2">
              <span className="flex flex-wrap items-center gap-2"><span className="font-mono">{o.day}</span> · {o.focus} · by {o.observer}
                {o.state === "written" ? (o.read ? <StatusBadge state="done">Read</StatusBadge> : <StatusBadge state="new">Feedback ready</StatusBadge>) : <StatusBadge state="draft">Booked</StatusBadge>}</span>
              {o.state === "written" ? (o.read ? <p className="mt-1"><span className="font-medium">Strengths:</span> {o.strengths} · <span className="font-medium">Next step:</span> {o.nextStep}</p>
                : <button type="button" className={`${FORM_SECONDARY_CLASS} mt-1`} onClick={() => void run(readObservationAction(schoolId, o.id), "Added to your development log")}>Read the feedback</button>) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {d.giving.length ? (
        <ul className="space-y-2" aria-label="Observations I give">
          {d.giving.map((o) => (
            <li key={o.id} className="rounded-md border border-border p-2">
              <span className="flex flex-wrap items-center gap-2"><span className="font-mono">{o.day}</span> · {o.observed} · {o.focus}{o.justBetweenUs ? <span className="text-muted-foreground">· just between us</span> : null}</span>
              {o.state === "booked" && o.day <= today ? (
                <span className="mt-1 flex flex-col gap-1">
                  <textarea className="nb-textarea" rows={2} maxLength={3000} aria-label={`Strengths for ${o.observed}`} placeholder="Strengths" value={writing[o.id]?.strengths ?? ""} onChange={(e) => setWriting({ ...writing, [o.id]: { strengths: e.target.value, nextStep: writing[o.id]?.nextStep ?? "" } })} />
                  <Input maxLength={1000} aria-label={`One next step for ${o.observed}`} placeholder="One next step" value={writing[o.id]?.nextStep ?? ""} onChange={(e) => setWriting({ ...writing, [o.id]: { strengths: writing[o.id]?.strengths ?? "", nextStep: e.target.value } })} />
                  <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(writeObservationAction(schoolId, o.id, writing[o.id] ?? {}), "Feedback sent")}>Send the feedback</button>
                </span>
              ) : <span className="text-muted-foreground"> {o.state === "written" ? (o.read ? "Read" : "Sent, not read yet") : "Booked"}</span>}
            </li>
          ))}
        </ul>
      ) : null}
      {d.myReports.length ? <ul className="space-y-1" aria-label="Observations of people who report to me">{d.myReports.map((o) => <li key={o.id}><span className="font-mono">{o.day}</span> · {o.observed} · {o.focus}: {o.strengths} · Next step: {o.nextStep}</li>)}</ul> : null}
      <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" data-testid="book-observation">
        <legend className="px-1 font-medium">Book an observation</legend>
        <select className="nb-select" data-size="sm" aria-label="Who to observe" value={book.observedId} onChange={(e) => setBook({ ...book, observedId: e.target.value })}>
          <option value="">Who…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <Input type="date" value={book.day} aria-label="Observation day (2 school days’ notice)" onChange={(e) => setBook({ ...book, day: e.target.value })} className="w-[160px] font-mono" />
        <Input value={book.focus} maxLength={300} placeholder="Focus (what it looks at)" aria-label="Observation focus" onChange={(e) => setBook({ ...book, focus: e.target.value })} className="w-[260px]" />
        <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={book.justBetweenUs} onChange={(e) => setBook({ ...book, justBetweenUs: e.target.checked })} />Just between us (a peer observation)</label>
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={!book.observedId || !book.day || !book.focus.trim()}
          onClick={() => void run(bookObservationAction(schoolId, book), "Observation booked").then(() => setBook({ observedId: "", day: "", focus: "", justBetweenUs: false }))}>Book</button>
      </fieldset>
    </section>
  );
}
