"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { importTimetableAction, readTimetableAction, saveTimetableSettingsAction } from "@/app/actions/school-timetable";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { DAY_NAMES, parseTimetableCsv, type ImportSlot, type Slot, type TimetableSettings } from "@/lib/organizations/school-timetable";
import { cn } from "@/lib/utils";

// Report 32.5 S4 (plan B3.4a): Settings → Timetable, and the Timetable view (Your day, My week, the whole school for leaders).
const key = (id: string) => ["school-timetable", id] as const;
type Pattern = TimetableSettings["patterns"][number];
const periodsText = (p: Pattern) => p.periods.map((x) => `${x.key} ${x.start}-${x.end}${x.kind !== "lesson" ? ` ${x.kind}` : ""}`).join("\n");
const parsePeriods = (text: string) => text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = /^(\S+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(?:\s+(break|lunch))?$/i.exec(l);
  return m ? { key: m[1]!, start: m[2]!, end: m[3]!, kind: (m[4]?.toLowerCase() ?? "lesson") as "lesson" | "break" | "lunch" } : null;
});
const STARTER: TimetableSettings = { patterns: [{ name: "School day", days: [1, 2, 3, 4, 5], periods: [
  { key: "P1", start: "08:50", end: "09:50", kind: "lesson" }, { key: "P2", start: "09:50", end: "10:50", kind: "lesson" }, { key: "Break", start: "10:50", end: "11:10", kind: "break" },
  { key: "P3", start: "11:10", end: "12:10", kind: "lesson" }, { key: "Lunch", start: "12:10", end: "13:00", kind: "lunch" }, { key: "P4", start: "13:00", end: "14:00", kind: "lesson" }] }], weekAB: false, weekAStart: null };

export function TimetableSettingsCard({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: key(schoolId), queryFn: () => readTimetableAction(schoolId), staleTime: 60_000 });
  const [draft, setDraft] = useState<{ name: string; days: number[]; text: string }[] | null>(null);
  const [weekAB, setWeekAB] = useState<{ on: boolean; start: string } | null>(null);
  const [rows, setRows] = useState<ImportSlot[] | null>(null);
  if (!q.data?.success || !q.data.leader) return null;
  const s = q.data.settings ?? STARTER;
  const pats = draft ?? s.patterns.map((p) => ({ name: p.name, days: p.days, text: periodsText(p) }));
  const ab = weekAB ?? { on: s.weekAB, start: s.weekAStart ?? "" };
  const refresh = () => client.invalidateQueries({ queryKey: key(schoolId) });
  const save = async () => {
    const patterns = pats.map((p) => ({ name: p.name, days: p.days, periods: parsePeriods(p.text) }));
    if (patterns.some((p) => p.periods.some((x) => !x))) return void toast.error("Write each period as P1 08:50-09:50 (add break or lunch for those rows).");
    const r = await saveTimetableSettingsAction(schoolId, { patterns, weekAB: ab.on, weekAStart: ab.on && ab.start ? ab.start : null });
    if (!r.success) return void toast.error(r.error);
    toast.success("School day saved");
    setDraft(null); setWeekAB(null);
    void refresh();
  };
  const keys = (q.data.settings ?? s).patterns.flatMap((p) => p.periods.filter((x) => x.kind === "lesson").map((x) => x.key));
  const good = (rows ?? []).filter((r) => !r.error);
  return (
    <SettingsCard title="Timetable" headingLevel={2} description="The school day (periods, break and lunch; another pattern if a day differs) and the timetable itself, imported from a CSV. NB doesn’t build timetables.">
      <div className="space-y-4 text-[13px]" data-testid="timetable-settings">
        {pats.map((p, i) => (
          <fieldset key={i} className="space-y-1.5 rounded-md border border-border p-3">
            <legend className="sr-only">Day pattern {i + 1}</legend>
            <Input value={p.name} maxLength={40} aria-label={`Day pattern ${i + 1} name`} onChange={(e) => setDraft(pats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="w-[200px]" />
            <span className="flex flex-wrap gap-3">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className="flex items-center gap-1"><input className="nb-check" type="checkbox" checked={p.days.includes(d)}
                onChange={(e) => setDraft(pats.map((x, j) => (j === i ? { ...x, days: e.target.checked ? [...x.days, d].sort() : x.days.filter((y) => y !== d) } : x)))} />{DAY_NAMES[d]?.slice(0, 3)}</label>))}</span>
            <textarea className="nb-textarea font-mono" rows={6} aria-label={`Day pattern ${i + 1} periods`} value={p.text} onChange={(e) => setDraft(pats.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          </fieldset>
        ))}
        <span className="flex flex-wrap items-center gap-3">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft([...pats, { name: "Short day", days: [], text: "P1 08:50-09:40" }])}>Add a day pattern</button>
          <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={ab.on} onChange={(e) => setWeekAB({ ...ab, on: e.target.checked })} />Week A / B</label>
          {ab.on ? <Input type="date" value={ab.start} aria-label="Monday of a Week A" onChange={(e) => setWeekAB({ ...ab, start: e.target.value })} className="w-[160px] font-mono" /> : null}
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save the school day</button>
        </span>
        {q.data.settings ? (
          <div className="space-y-2">
            <p className="font-medium">The timetable <span className="font-normal text-muted-foreground">· {q.data.all.length} slots</span></p>
            <p className="text-muted-foreground">A CSV with day, period, class, teacher, room and week (A or B). Importing replaces the timetable; teachers are matched by their name on the staff.</p>
            <input type="file" accept=".csv,text/csv" aria-label="Timetable CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => setRows(parseTimetableCsv(t, keys))); }} />
            {rows ? (
              <div className="space-y-2" data-testid="timetable-preview">
                <p>{good.length} rows ready{rows.length - good.length ? ` · ${rows.length - good.length} with a problem: ${rows.filter((r) => r.error).slice(0, 3).map((r) => r.error).join("; ")}` : ""}</p>
                <span className="flex gap-2">
                  <button type="button" className={FORM_PRIMARY_CLASS} disabled={!good.length} onClick={() => void importTimetableAction(schoolId, good).then((r) => {
                    if (!r.success) return void toast.error(r.error);
                    toast.success(r.unmatched.length ? `${r.added} slots imported · not on the staff: ${r.unmatched.join(", ")}` : `${r.added} slots imported`);
                    setRows(null); void refresh();
                  })}>Import {good.length} slots</button>
                  <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setRows(null)}>Cancel</button>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}

const slotLine = (x: Slot, withTeacher = false) => [x.className, x.room, withTeacher ? x.teacher : null, x.week ? `Week ${x.week}` : null].filter(Boolean).join(" · ");

/** Sprints → Timetable: Your day (today), My week, and for leaders the whole school by teacher. */
export function TimetableView({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: key(schoolId), queryFn: () => readTimetableAction(schoolId), staleTime: 60_000 });
  const [teacher, setTeacher] = useState<string>("");
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the timetable…</p>;
  if (!q.data?.success) return <ErrorNotice what="Timetable" onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.settings) return <p className="text-[13px] text-muted-foreground">{d.leader ? "Set up the school day in Settings, under Timetable." : "The timetable shows here once the school sets it up."}</p>;
  const days = [...new Set(d.settings.patterns.flatMap((p) => p.days))].sort();
  const teachers = [...new Map(d.all.filter((x) => x.teacherId).map((x) => [x.teacherId!, x.teacher ?? "Staff"])).entries()];
  const shown = d.leader && teacher ? d.all.filter((x) => x.teacherId === teacher) : d.mine;
  const lessons = (day: number) => d.settings!.patterns.find((p) => p.days.includes(day))?.periods ?? [];
  return (
    <section aria-label="Timetable" className="space-y-4 text-[13px]" data-testid="timetable-view">
      <div className="space-y-1" data-testid="your-day">
        <h3 className="font-medium">Your day <span className="font-mono font-normal text-muted-foreground">{d.today}</span></h3>
        {d.yourDay.some((p) => p.slots.length) ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {d.yourDay.map((p) => (
              <li key={p.key} className={cn("flex flex-wrap gap-3 px-3 py-1.5", p.kind !== "lesson" && "bg-muted text-muted-foreground")}>
                <span className="w-[110px] font-mono">{p.start}–{p.end}</span><span className="w-[60px]">{p.key}</span>
                <span>{p.kind !== "lesson" ? (p.kind === "break" ? "Break" : "Lunch") : p.slots.map((x) => slotLine(x)).join(" · ") || "Free"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted-foreground">Nothing timetabled for you today.</p>}
      </div>
      {d.leader && teachers.length ? (
        <label className="flex items-center gap-2">Timetable of
          <select className="nb-select" data-size="sm" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">Me</option>{teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select></label>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Week timetable" tabIndex={0}>
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-border text-left text-muted-foreground">{days.map((day) => <th key={day} className="px-3 py-2 font-medium">{DAY_NAMES[day]}</th>)}</tr></thead>
          <tbody><tr className="align-top">
            {days.map((day) => (
              <td key={day} className="px-3 py-2"><ul className="space-y-1">
                {lessons(day).map((p) => {
                  const here = shown.filter((x) => x.day === day && x.period === p.key);
                  return <li key={p.key} className={cn(p.kind !== "lesson" && "text-muted-foreground")}><span className="font-mono">{p.key}</span> {p.kind !== "lesson" ? "" : here.map((x) => slotLine(x)).join(" / ") || "Free"}</li>;
                })}
              </ul></td>
            ))}
          </tr></tbody>
        </table>
      </div>
    </section>
  );
}
