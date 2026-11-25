"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { assignCoverAction, readCoverBoardAction, readMyCoverAction, removeAbsenceAction, removeCoverAction, reportAbsenceAction } from "@/app/actions/school-cover";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 32.5 S4 (plan B3.4b): Away and cover — report an absence, the cover board with suggestions, my covers.
const today = () => new Date().toISOString().slice(0, 10);

/** Report an absence (mine, or a leader for anyone): the whole day or from one period to another. */
function ReportAbsence({ schoolId, staff, onDone }: { schoolId: string; staff?: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [f, setF] = useState({ userId: "", day: today(), from: "", to: "", reason: "" });
  const send = async () => {
    const r = await reportAbsenceAction(schoolId, { ...(f.userId ? { userId: f.userId } : {}), day: f.day, from: f.from || null, to: f.to || null, reason: f.reason || null });
    if (!r.success) return void toast.error(r.error);
    toast.success("Absence added");
    setF({ ...f, from: "", to: "", reason: "" });
    onDone();
  };
  return (
    <fieldset className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" data-testid="report-absence">
      <legend className="px-1 font-medium">Report an absence</legend>
      {staff?.length ? <select className="nb-select" data-size="sm" aria-label="Who is away" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
        <option value="">Me</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}
      <Input type="date" value={f.day} aria-label="Day away" onChange={(e) => setF({ ...f, day: e.target.value })} className="w-[160px] font-mono" />
      <Input value={f.from} maxLength={20} placeholder="From period" aria-label="From period (blank for the whole day)" onChange={(e) => setF({ ...f, from: e.target.value })} className="w-[120px]" />
      <Input value={f.to} maxLength={20} placeholder="To period" aria-label="To period" onChange={(e) => setF({ ...f, to: e.target.value })} className="w-[120px]" />
      <Input value={f.reason} maxLength={300} placeholder="Reason (leaders only see it)" aria-label="Reason" onChange={(e) => setF({ ...f, reason: e.target.value })} className="w-[240px]" />
      <button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.day} onClick={() => void send()}>Add absence</button>
    </fieldset>
  );
}

/** The cover board (leaders): "Filled 2 of 3", open slots first, suggestions with reasons; the manager picks. */
export function CoverBoard({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const [day, setDay] = useState(today());
  const q = useQuery({ queryKey: ["cover-board", schoolId, day], queryFn: () => readCoverBoardAction(schoolId, day), staleTime: 15_000 });
  const refresh = () => client.invalidateQueries({ queryKey: ["cover-board", schoolId] });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading cover…</p>;
  if (!q.data?.success) return <MyCover schoolId={schoolId} />;
  const d = q.data;
  const assign = async (slotId: string, userId: string) => {
    const r = await assignCoverAction(schoolId, slotId, day, userId);
    if (!r.success) return void toast.error(r.error);
    toast.success("Cover arranged");
    void refresh();
  };
  return (
    <section aria-label="Away and cover" className="space-y-3 text-[13px]" data-testid="cover-board">
      <span className="flex flex-wrap items-center gap-3">
        <Input type="date" value={day} aria-label="Cover for day" onChange={(e) => setDay(e.target.value)} className="w-[160px] font-mono" />
        {d.slots.length ? <span className="font-mono">Filled {d.filled} of {d.slots.length}</span> : null}
      </span>
      <ReportAbsence schoolId={schoolId} staff={"staff" in d ? d.staff : undefined} onDone={() => void refresh()} />
      {d.absences.length ? (
        <ul className="space-y-1" aria-label="Away">
          {d.absences.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.name}</span><span>{a.from || a.to ? `${a.from ?? "start"}–${a.to ?? "end"}` : "Whole day"}</span>
              {a.reason ? <span className="text-muted-foreground">· {a.reason}</span> : null}
              <button type="button" className="text-primary hover:underline" onClick={() => void removeAbsenceAction(schoolId, a.id).then(() => refresh())}>Remove<span className="sr-only"> {a.name}’s absence</span></button>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted-foreground">Nobody is away that day.</p>}
      {d.needsDay ? <p className="text-muted-foreground">Set up the school day and timetable in Settings to see the lessons to cover.</p> : null}
      {d.slots.length ? (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Lessons to cover">
          {[...d.slots].sort((a, b) => Number(Boolean(a.cover)) - Number(Boolean(b.cover))).map((s) => (
            <li key={s.id} className="space-y-1 px-3 py-2" data-testid="cover-slot">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{s.period}</span><span className="font-medium">{s.className}</span>
                {s.room ? <span className="text-muted-foreground">{s.room}</span> : null}<span className="text-muted-foreground">· {s.teacher} away</span>
                {s.cover ? <StatusBadge state="done">Filled</StatusBadge> : <StatusBadge state="at_risk">Open</StatusBadge>}
              </span>
              {s.cover ? (
                <span className="flex items-center gap-2">Cover: {s.cover.name}
                  <button type="button" className="text-primary hover:underline" onClick={() => void removeCoverAction(schoolId, s.id, day).then(() => refresh())}>Change<span className="sr-only"> cover for {s.className} {s.period}</span></button></span>
              ) : (
                <span className="flex flex-wrap gap-2">{s.suggestions.length ? s.suggestions.map((g) => (
                  <button key={g.userId} type="button" className={FORM_SECONDARY_CLASS} onClick={() => void assign(s.id, g.userId)}>{g.name} <span className="text-muted-foreground">({g.reason})</span></button>
                )) : <span className="text-muted-foreground">Nobody is free that period.</span>}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** For staff who aren't leaders: report my absence; my covers to come. */
export function MyCover({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["my-cover", schoolId], queryFn: () => readMyCoverAction(schoolId, today()), staleTime: 30_000 });
  const d = q.data?.success ? q.data : null;
  return (
    <section aria-label="My cover" className="space-y-3 text-[13px]" data-testid="my-cover">
      <ReportAbsence schoolId={schoolId} onDone={() => void client.invalidateQueries({ queryKey: ["my-cover", schoolId] })} />
      {d?.covers.length ? <ul className="space-y-2" aria-label="Lessons I cover">{d.covers.map((c, i) => (
        <li key={i}><span className="font-mono">{c.day} {c.period}</span> · {c.class_name}{c.room ? ` · ${c.room}` : ""}{c.note ? ` · ${c.note}` : ""}
          {c.info ? <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground sm:grid-cols-[auto_1fr]" data-testid="cover-info">
            {c.info.routines ? <><dt className="font-medium">Routines</dt><dd>{c.info.routines}</dd></> : null}
            {c.info.where ? <><dt className="font-medium">Where things are</dt><dd>{c.info.where}</dd></> : null}
            {c.info.emergencies ? <><dt className="font-medium">Emergencies</dt><dd>{c.info.emergencies}</dd></> : null}</dl> : null}
        </li>))}</ul>
        : <p className="text-muted-foreground">No lessons to cover.</p>}
    </section>
  );
}
