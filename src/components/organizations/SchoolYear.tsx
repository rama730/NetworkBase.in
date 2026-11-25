"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readSchoolYearAction, saveSchoolYearAction } from "@/app/actions/school-year";
import { OrgCard } from "@/components/organizations/org-ui";
import { StartNextYear } from "@/components/organizations/SchoolCalendarTools";
import { EventsView } from "@/components/organizations/SchoolEvents";
import { YearMap } from "@/components/organizations/YearMap";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { DAY_WORDS, type DayKind, type SchoolYear } from "@/lib/organizations/school-year";
import { cn } from "@/lib/utils";

// Report 32.2 S1 (plan B3.1a): the school year — Year view, Settings → School year, This week at school.
const key = (orgId: string) => ["school-year", orgId] as const;
const useYear = (orgId: string) => useQuery({ queryKey: key(orgId), queryFn: () => readSchoolYearAction(orgId), staleTime: 60_000 });
const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const DAYF = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (d: string) => DAYF.format(new Date(`${d}T00:00:00Z`));
// Day kinds as fills from the design tokens; the word is always beside it (legend, and each cell's label).
const FILL: Record<DayKind, string> = { school: "border border-border bg-card", weekend: "bg-muted", holiday: "bg-foreground", staff: "bg-muted-foreground", half: "bg-border", exam: "bg-primary", outside: "" };

/** School Sprints: Year (default) or today's Sprint view. */
export function SchoolSprints({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [view, setView] = useState<"year" | "map" | "events" | "sprint">("year");
  return (
    <div>
      <div role="group" aria-label="Sprints view" className="mb-3 inline-flex rounded-md border border-border p-0.5 text-[12px]" data-testid="school-sprints-switch">
        {(["year", "map", "events", "sprint"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{v === "year" ? "Year" : v === "map" ? "Year map" : v === "events" ? "Events" : "Sprint"}</button>
        ))}
      </div>
      {view === "year" ? <YearView orgId={orgId} /> : view === "map" ? <YearMap schoolId={orgId} /> : view === "events" ? <EventsView orgId={orgId} /> : children}
    </div>
  );
}

export function YearView({ orgId }: { orgId: string }) {
  const q = useYear(orgId);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the school year…</p>;
  if (!q.data?.success) return <ErrorNotice what="School year" onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.year) return <p className="text-[13px] text-muted-foreground">{d.canEdit ? "Set up the school year in Settings, under School year: its terms, holidays and staff days." : "The school year shows here once it’s set up."}</p>;
  return (
    <section aria-label="School year" className="space-y-3 text-[13px]" data-testid="year-view">
      <p><span className="font-medium">{d.year.name}</span> · {d.year.terms.map((t) => `${t.name} ${fmt(t.start)} – ${fmt(t.end)}`).join(" · ")}</p>
      <p className="text-muted-foreground">{d.week ? `${d.week.term} · Week ${d.week.week} of ${d.week.weeks}` : "Between terms"}{d.holiday ? ` · ${d.holiday.name} in ${d.holiday.days} days` : ""}</p>
      <ul className="flex flex-wrap gap-3 text-[12px]" aria-label="Legend">
        {(["school", "weekend", "holiday", "staff", "half", "exam"] as DayKind[]).map((k) => <li key={k} className="flex items-center gap-1.5"><span className={cn("inline-block size-3 rounded-sm", FILL[k])} aria-hidden="true" />{DAY_WORDS[k]}</li>)}
      </ul>
      <div className="space-y-1 overflow-x-auto" role="table" aria-label="Days of the year">
        {d.months.map((m) => (
          <div key={m.month} role="row" className="flex items-center gap-1">
            <span role="rowheader" className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">{MONTH.format(new Date(`${m.month}-01T00:00:00Z`))}</span>
            {m.days.map((day) => <span key={day.day} role="cell" aria-label={`${fmt(day.day)}: ${DAY_WORDS[day.kind]}`} title={`${fmt(day.day)}: ${DAY_WORDS[day.kind]}`} className={cn("inline-block h-4 w-3 shrink-0 rounded-sm", FILL[day.kind] || "opacity-0")} />)}
          </div>
        ))}
      </div>
    </section>
  );
}

type Row = { name: string; start: string; end: string };
/** Settings → School year (school admins): name, terms, holidays, staff days and half days. */
export function SchoolYearSettings({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useYear(orgId);
  const [draft, setDraft] = useState<{ name: string; terms: Row[]; days: Array<Row & { kind: "holiday" | "staff" | "half" }> } | null>(null);
  if (!q.data?.success || !q.data.canEdit) return null;
  const y: SchoolYear | null = q.data.year;
  const s = draft ?? { name: y?.name ?? "", terms: y?.terms ?? [{ name: "Term 1", start: "", end: "" }], days: y?.days ?? [] };
  const save = async () => {
    const r = await saveSchoolYearAction(orgId, { name: s.name, terms: s.terms, days: s.days });
    if (!r.success) return void toast.error(r.error);
    toast.success(`School year saved. ${r.classes} ${r.classes === 1 ? "class follows" : "classes follow"} it.`);
    setDraft(null);
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  const rowEditor = <T extends Row>(list: T[], set: (next: T[]) => void, label: string, extra?: (r: T, i: number) => ReactNode) => list.map((r, i) => (
    <div key={i} className="flex flex-wrap items-center gap-2">
      <Input value={r.name} maxLength={60} aria-label={`${label} ${i + 1} name`} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="w-[160px]" />
      {extra?.(r, i)}
      <Input type="date" value={r.start} aria-label={`${label} ${i + 1} start`} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="w-[160px] font-mono" />
      <Input type="date" value={r.end} aria-label={`${label} ${i + 1} end`} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} className="w-[160px] font-mono" />
      <button type="button" className="nb-touch-target text-[13px] text-primary hover:underline" onClick={() => set(list.filter((_, j) => j !== i))}>Remove<span className="sr-only"> {label.toLowerCase()} {i + 1}</span></button>
    </div>
  ));
  return (
    <SettingsCard title="School year" headingLevel={2} description="Terms, holidays, staff days and half days. Every class follows the year: holidays and staff days have no classes.">
      <div className="space-y-3 text-[13px]" data-testid="school-year-settings">
        <label className="flex items-center gap-2">Year <Input value={s.name} maxLength={40} placeholder="2026–27" aria-label="School year name" onChange={(e) => setDraft({ ...s, name: e.target.value })} className="w-[140px]" /></label>
        <div className="space-y-1.5"><p className="font-medium">Terms</p>
          {rowEditor(s.terms, (terms) => setDraft({ ...s, terms }), "Term")}
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft({ ...s, terms: [...s.terms, { name: `Term ${s.terms.length + 1}`, start: "", end: "" }] })}>Add a term</button>
        </div>
        <div className="space-y-1.5"><p className="font-medium">Holidays, staff days and half days</p>
          {rowEditor(s.days, (days) => setDraft({ ...s, days }), "Day", (r, i) => (
            <select className="nb-select" data-size="sm" aria-label={`Day ${i + 1} kind`} value={r.kind} onChange={(e) => setDraft({ ...s, days: s.days.map((x, j) => (j === i ? { ...x, kind: e.target.value as "holiday" | "staff" | "half" } : x)) })}>
              <option value="holiday">Holiday</option><option value="staff">Staff day</option><option value="half">Half day</option>
            </select>
          ))}
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft({ ...s, days: [...s.days, { name: "Holiday", kind: "holiday", start: "", end: "" }] })}>Add a day</button>
        </div>
        <span className="flex flex-wrap gap-2">
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save school year</button>
          {y && !draft ? <StartNextYear schoolId={orgId} current={y} /> : null}
        </span>
      </div>
    </SettingsCard>
  );
}

/** Class Overview: This week at school — the term week, days that aren't ordinary, the next holiday. */
export function ThisWeekAtSchool({ orgId }: { orgId: string }) {
  const q = useYear(orgId);
  const d = q.data?.success ? q.data : null;
  if (!d?.year || d.isSchool) return null;
  return (
    <OrgCard title="This week at school" testId="this-week-at-school">
      <div className="space-y-1 text-[13px]">
        <p>{d.week ? `${d.week.term} · Week ${d.week.week} of ${d.week.weeks}` : "Between terms"}</p>
        {d.thisWeek.map((w) => <p key={w.day}><span className="font-mono">{fmt(w.day)}</span> · {DAY_WORDS[w.kind]}{w.kind === "staff" || w.kind === "holiday" || w.kind === "exam" ? ", no classes" : ""}</p>)}
        {d.holiday ? <p className="text-muted-foreground">{d.holiday.name} in {d.holiday.days} days</p> : null}
      </div>
    </OrgCard>
  );
}
