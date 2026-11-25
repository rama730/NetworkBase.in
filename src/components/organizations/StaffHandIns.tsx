"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { checkDeadlineClashAction, readDeadlinesAction, readHandInSettingsAction, saveQuietWeeksAction } from "@/app/actions/staff-hand-ins";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 32.4 S3 (plan B3.3c): Settings → Hand-ins (quiet weeks), the clash check, and Deadlines for leaders.
const DAYF = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (d: string) => DAYF.format(new Date(`${d}T00:00:00Z`));
type Row = { name: string; start: string; end: string };

export function QuietWeeksSettings({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["hand-in-settings", schoolId], queryFn: () => readHandInSettingsAction(schoolId), staleTime: 60_000 });
  const [draft, setDraft] = useState<Row[] | null>(null);
  if (!q.data?.success || !q.data.canEdit) return null;
  const rows = draft ?? q.data.quietWeeks;
  const save = async () => {
    const r = await saveQuietWeeksAction(schoolId, rows);
    if (!r.success) return void toast.error(r.error);
    toast.success("Quiet weeks saved");
    setDraft(null);
    void client.invalidateQueries({ queryKey: ["hand-in-settings", schoolId] });
  };
  return (
    <SettingsCard title="Hand-ins" headingLevel={2} description="Quiet weeks: weeks when no new staff deadline should fall, such as report or exam weeks. Asking for a hand-in then warns; it never blocks.">
      <div className="space-y-2 text-[13px]" data-testid="quiet-weeks">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input value={r.name} maxLength={60} aria-label={`Quiet week ${i + 1} name`} onChange={(e) => setDraft(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="w-[180px]" />
            <Input type="date" value={r.start} aria-label={`Quiet week ${i + 1} start`} onChange={(e) => setDraft(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="w-[160px] font-mono" />
            <Input type="date" value={r.end} aria-label={`Quiet week ${i + 1} end`} onChange={(e) => setDraft(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="w-[160px] font-mono" />
            <button type="button" className="nb-touch-target text-[13px] text-primary hover:underline" onClick={() => setDraft(rows.filter((_, j) => j !== i))}>Remove<span className="sr-only"> quiet week {i + 1}</span></button>
          </div>
        ))}
        <span className="flex gap-2">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft([...rows, { name: "", start: "", end: "" }])}>Add a quiet week</button>
          {draft ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save quiet weeks</button> : null}
        </span>
      </div>
    </SettingsCard>
  );
}

/** The clash check while asking (call 6), read out as a list; it warns and never blocks. */
export function ClashNote({ schoolId, due, target }: { schoolId: string; due: string; target: unknown }) {
  const [r, setR] = useState<{ deadlines: Array<{ id: string; title: string; due: string; people: number }>; quiet: string | null } | null>(null);
  const key = `${due.slice(0, 10)}:${JSON.stringify(target)}`;
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(due)) { setR(null); return; }
    let live = true;
    void checkDeadlineClashAction(schoolId, due.slice(0, 10), target).then((x) => { if (live) setR(x.success ? x : null); });
    return () => { live = false; };
  }, [schoolId, key]);
  if (!r || (!r.deadlines.length && !r.quiet)) return null;
  return (
    <div role="status" className="space-y-1 rounded-md bg-muted px-3 py-2 text-[12px]" data-testid="clash-note">
      {r.quiet ? <p className="font-medium">That’s in a quiet week: {r.quiet}.</p> : null}
      {r.deadlines.length ? (
        <>
          <p className="font-medium">{r.deadlines.length} other staff {r.deadlines.length === 1 ? "deadline" : "deadlines"} that week for the same people:</p>
          <ul className="list-disc pl-5">{r.deadlines.map((d) => <li key={d.id}>{d.title} · {fmt(d.due)} · {d.people} {d.people === 1 ? "person" : "people"}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}

/** Deadlines (school leaders): staff deadlines by week as counts; heavy weeks and quiet weeks in words. */
export function DeadlinesView({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: ["staff-deadlines", schoolId], queryFn: () => readDeadlinesAction(schoolId), staleTime: 60_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the deadlines…</p>;
  if (!q.data?.success) return <p className="text-[13px] text-muted-foreground">Deadlines are for the school’s leaders.</p>;
  if (!q.data.weeks.length) return <p className="text-[13px] text-muted-foreground">No staff deadlines coming up.</p>;
  return (
    <section aria-label="Staff deadlines by week" className="space-y-2 text-[13px]" data-testid="deadlines-view">
      <ul className="divide-y divide-border rounded-md border border-border">
        {q.data.weeks.map((w) => (
          <li key={w.week} className="flex flex-wrap items-center gap-3 px-3 py-2" data-testid="deadline-week">
            <span className="w-[120px] font-mono">Week of {fmt(w.week)}</span>
            <span>{w.count} {w.count === 1 ? "deadline" : "deadlines"} · {w.people} {w.people === 1 ? "person" : "people"}</span>
            {w.heavy ? <StatusBadge state="at_risk">Heavy week</StatusBadge> : null}
            {w.quiet ? <span className="text-muted-foreground">Quiet week: {w.quiet}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
