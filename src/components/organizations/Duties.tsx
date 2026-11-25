"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { answerDutySwapAction, askDutySwapAction, readDutiesAction, removeDutyAction, saveDutyAction } from "@/app/actions/school-duties";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { DAY_NAMES } from "@/lib/organizations/school-timetable";

// Report 32.5 S4 (plan B3.4c): Duties — the places × days grid, swaps asked of me, and asking a colleague to swap.
const key = (id: string) => ["school-duties", id] as const;
/** The next date (from today) that falls on `day` (1 = Monday). */
const nextOn = (day: number) => { const d = new Date(); for (let i = 0; i < 7; i++) { const x = new Date(d.getTime() + i * 86_400_000); if (((x.getUTCDay() + 6) % 7) + 1 === day) return x.toISOString().slice(0, 10); } return d.toISOString().slice(0, 10); };

export function DutiesView({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: key(schoolId), queryFn: () => readDutiesAction(schoolId), staleTime: 30_000 });
  const [f, setF] = useState({ place: "", day: 1, slot: "", userId: "" });
  const [asking, setAsking] = useState<{ dutyId: string; day: string; to: string } | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the duties…</p>;
  if (!q.data?.success) return <ErrorNotice what="Duties" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const refresh = () => client.invalidateQueries({ queryKey: key(schoolId) });
  const run = async (p: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await p; if (!r.success) return void toast.error(r.error ?? "Couldn’t save."); toast.success(ok); void refresh(); };
  const places = [...new Set(d.duties.map((x) => x.place))];
  const days = [1, 2, 3, 4, 5];
  const mine = d.duties.filter((x) => x.user_id === d.me);
  return (
    <section aria-label="Duties" className="space-y-4 text-[13px]" data-testid="duties-view">
      {d.askedOfMe.length ? (
        <ul className="space-y-1 rounded-md bg-muted px-3 py-2" aria-label="Swaps asked of me">
          {d.askedOfMe.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">{s.from} asks you to take {s.place}, {s.slot}, <span className="font-mono">{s.day}</span>
              <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(answerDutySwapAction(schoolId, s.id, true), "Swap accepted")}>Accept</button>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(answerDutySwapAction(schoolId, s.id, false), "Swap declined")}>Decline</button></li>
          ))}
        </ul>
      ) : null}
      {places.length ? (
        <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Duty grid" tabIndex={0}>
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Place</th>{days.map((x) => <th key={x} className="px-3 py-2 font-medium">{DAY_NAMES[x]}</th>)}</tr></thead>
            <tbody>{places.map((p) => (
              <tr key={p} className="border-b border-border last:border-0 align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">{p}</th>
                {days.map((x) => <td key={x} className="px-3 py-2">{d.duties.filter((y) => y.place === p && y.day === x).map((y) => (
                  <span key={y.id} className="block">{y.slot}: {y.name}{y.week ? ` (Week ${y.week})` : ""}
                    {d.leader ? <button type="button" className="ml-1 text-primary hover:underline" onClick={() => void run(removeDutyAction(schoolId, y.id), "Duty removed")}>Remove<span className="sr-only"> {y.name}’s {p} duty</span></button> : null}</span>
                ))}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="text-muted-foreground">No duties yet.</p>}
      {mine.length ? (
        <div className="space-y-1.5"><p className="font-medium">My duties</p>
          {mine.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-2">
              <span>{x.place}, {DAY_NAMES[x.day]} {x.slot}</span>
              {asking?.dutyId === x.id ? (
                <>
                  <Input type="date" value={asking.day} aria-label="Date to swap" onChange={(e) => setAsking({ ...asking, day: e.target.value })} className="w-[160px] font-mono" />
                  <select className="nb-select" data-size="sm" aria-label="Ask who" value={asking.to} onChange={(e) => setAsking({ ...asking, to: e.target.value })}>
                    <option value="">Ask who…</option>{d.staff.filter((s) => s.id !== d.me).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <button type="button" className={FORM_PRIMARY_CLASS} disabled={!asking.to} onClick={() => void run(askDutySwapAction(schoolId, x.id, asking.day, asking.to), "Swap asked").then(() => setAsking(null))}>Ask</button>
                </>
              ) : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAsking({ dutyId: x.id, day: nextOn(x.day), to: "" })}>Ask to swap</button>}
            </div>
          ))}
          {d.myAsks.length ? <p className="text-muted-foreground">Asked: {d.myAsks.map((a) => `${a.place} ${a.day} (${a.state === "asked" ? "waiting" : a.state})`).join("; ")}</p> : null}
        </div>
      ) : null}
      {d.leader ? (
        <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" data-testid="new-duty">
          <legend className="px-1 font-medium">Add a duty</legend>
          <Input value={f.place} maxLength={60} placeholder="Place (Playground, Gate…)" aria-label="Duty place" onChange={(e) => setF({ ...f, place: e.target.value })} className="w-[200px]" />
          <select className="nb-select" data-size="sm" aria-label="Duty day" value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>{days.map((x) => <option key={x} value={x}>{DAY_NAMES[x]}</option>)}</select>
          <Input value={f.slot} maxLength={30} placeholder="When (Break, Lunch…)" aria-label="Duty time" onChange={(e) => setF({ ...f, slot: e.target.value })} className="w-[160px]" />
          <select className="nb-select" data-size="sm" aria-label="Duty person" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            <option value="">Who…</option>{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.place.trim() || !f.slot.trim() || !f.userId}
            onClick={() => void run(saveDutyAction(schoolId, { place: f.place, day: f.day, slot: f.slot, userId: f.userId }), "Duty added").then(() => setF({ ...f, place: "", slot: "" }))}>Add duty</button>
        </fieldset>
      ) : null}
    </section>
  );
}
