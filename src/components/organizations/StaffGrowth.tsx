"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readGrowthAction, readGrowthCountsAction, readStaffGrowthSettingsAction, saveGrowthAction, saveStaffGrowthSettingsAction } from "@/app/actions/staff-growth";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 32.6 S5 (plan B3.5a–b): Settings → Staff growth, and Growth — goals, the year review (no ratings), the log.
const thisYear = () => String(new Date().getUTCFullYear());

export function StaffGrowthSettings({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["staff-growth-settings", schoolId], queryFn: () => readStaffGrowthSettingsAction(schoolId), staleTime: 60_000 });
  const [reports, setReports] = useState<Record<string, string> | null>(null);
  const [headings, setHeadings] = useState<string | null>(null);
  if (!q.data?.success) return null;
  const d = q.data;
  const r = reports ?? d.reportsTo;
  const save = async () => {
    const res = await saveStaffGrowthSettingsAction(schoolId, { reportsTo: Object.fromEntries(Object.entries(r).filter(([, m]) => m)), headings: (headings ?? d.headings.join(", ")).split(",").map((h) => h.trim()).filter(Boolean) });
    if (!res.success) return void toast.error(res.error);
    toast.success("Staff growth saved");
    setReports(null); setHeadings(null);
    void client.invalidateQueries({ queryKey: ["staff-growth-settings", schoolId] });
  };
  return (
    <SettingsCard title="Staff growth" headingLevel={2} description="Who each person reports to (their line manager reads their growth record), and the headings of the year review. There are no ratings or scores.">
      <div className="space-y-3 text-[13px]" data-testid="staff-growth-settings">
        <ul className="space-y-1.5">
          {d.staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2"><span className="w-[180px]">{s.name}</span><span className="text-muted-foreground">reports to</span>
              <select className="nb-select" data-size="sm" aria-label={`${s.name} reports to`} value={r[s.id] ?? ""} onChange={(e) => setReports({ ...r, [s.id]: e.target.value })}>
                <option value="">Nobody yet</option>{d.staff.filter((m) => m.id !== s.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></li>
          ))}
        </ul>
        <label className="flex flex-col gap-1"><span className="font-medium">Year review headings</span>
          <Input value={headings ?? d.headings.join(", ")} maxLength={400} aria-label="Year review headings" onChange={(e) => setHeadings(e.target.value)} className="max-w-xl" /></label>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save staff growth</button>
      </div>
    </SettingsCard>
  );
}

/** Growth (anyone on the staff): my record, or a person who reports to me; leaders also see counts. */
export function GrowthView({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const [year] = useState(thisYear());
  const [person, setPerson] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["growth", schoolId, person, year], queryFn: () => readGrowthAction(schoolId, person, year), staleTime: 15_000 });
  const counts = useQuery({ queryKey: ["growth-counts", schoolId, year], queryFn: () => readGrowthCountsAction(schoolId, year), staleTime: 60_000 });
  const [goal, setGoal] = useState("");
  const [log, setLog] = useState("");
  const [review, setReview] = useState<Record<string, string>>({});
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading growth…</p>;
  if (!q.data?.success) return <ErrorNotice what="Growth" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["growth", schoolId] });
  const save = async (input: Record<string, unknown>, ok: string) => { const r = await saveGrowthAction(schoolId, person, { year, ...input }); if (!r.success) return void toast.error(r.error); toast.success(ok); void refresh(); };
  const body = d.review?.body ?? {};
  const field = (k: string, label: string, mayWrite: boolean) => (
    <label key={k} className="flex flex-col gap-1"><span className="font-medium">{label}</span>
      {mayWrite ? <textarea className="nb-textarea" rows={3} maxLength={5000} value={review[k] ?? body[k] ?? ""} onChange={(e) => setReview({ ...review, [k]: e.target.value })} />
        : <span className="whitespace-pre-wrap text-muted-foreground">{body[k] || "Not written yet."}</span>}
    </label>
  );
  return (
    <section aria-label="Growth" className="space-y-4 text-[13px]" data-testid="growth-view">
      <span className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{d.mine ? "My growth" : d.personName} · <span className="font-mono">{year}</span></span>
        {d.manager ? <span className="text-muted-foreground">Line manager: {d.manager}</span> : null}
        {d.myReports.length ? <select className="nb-select" data-size="sm" aria-label="Whose growth" value={person ?? ""} onChange={(e) => setPerson(e.target.value || null)}>
          <option value="">Me</option>{d.myReports.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : null}
        {counts.data?.success ? <span className="text-muted-foreground" data-testid="growth-counts">School: {counts.data.withGoals} of {counts.data.staff} with goals · {counts.data.reviews} reviews · {counts.data.logs} log entries</span> : null}
      </span>
      <div className="space-y-1.5"><p className="font-medium">Goals <span className="font-normal text-muted-foreground">(up to 3 a year)</span></p>
        {d.goals.length ? <ol className="list-decimal space-y-0.5 pl-5">{d.goals.map((g) => <li key={g.id}>{g.title}</li>)}</ol> : <p className="text-muted-foreground">No goals yet.</p>}
        {d.mine && d.goals.length < 3 ? <span className="flex gap-2"><Input value={goal} maxLength={200} placeholder="A goal for this year" aria-label="New goal" onChange={(e) => setGoal(e.target.value)} className="max-w-md" />
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!goal.trim()} onClick={() => void save({ kind: "goal", title: goal }, "Goal added").then(() => setGoal(""))}>Add goal</button></span> : null}
      </div>
      <div className="space-y-2" data-testid="year-review"><p className="font-medium">Year review <span className="font-normal text-muted-foreground">· words only, no ratings · headings: {d.headings.join(", ")}</span></p>
        {field("reflection", "Self-reflection", d.mine)}
        {field("manager", "Line manager", !d.mine)}
        {field("plan", "Development plan", d.mine)}
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={!Object.keys(review).length}
          onClick={() => void save({ kind: "review", title: `Year review ${year}`, body: review }, "Year review saved").then(() => setReview({}))}>Save the review</button>
      </div>
      <div className="space-y-1.5"><p className="font-medium">Development log <span className="font-normal text-muted-foreground">(training, reading, observations)</span></p>
        {d.log.length ? <ul className="space-y-0.5">{d.log.map((l) => <li key={l.id}><span className="font-mono">{l.created_at.slice(0, 10)}</span> · {l.title}{l.by ? <span className="text-muted-foreground"> · {l.by}</span> : null}</li>)}</ul> : <p className="text-muted-foreground">Nothing logged yet.</p>}
        <span className="flex gap-2"><Input value={log} maxLength={200} placeholder="A training day, a book, an observation" aria-label="New log entry" onChange={(e) => setLog(e.target.value)} className="max-w-md" />
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={!log.trim()} onClick={() => void save({ kind: "log", title: log }, "Logged").then(() => setLog(""))}>Add to the log</button></span>
      </div>
    </section>
  );
}
