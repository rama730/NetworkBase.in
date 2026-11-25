"use client";

import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";

import { readYearMapAction } from "@/app/actions/curriculum-map";
import { StatusBadge } from "@/components/organizations/org-ui";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { cn } from "@/lib/utils";

// Report 32.3 S2 (plan B3.2b): the Year map — courses × school weeks, units as spans, holidays, Planned, Taught per class.
const DAYF = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const fmt = (d: string) => DAYF.format(new Date(`${d}T00:00:00Z`));

export function YearMap({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: ["year-map", schoolId], queryFn: () => readYearMapAction(schoolId), staleTime: 60_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the year map…</p>;
  if (!q.data?.success) return <ErrorNotice what="Year map" onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.rows.length) return <EmptyState figure="organization" title="No courses yet" description="Add your courses: each class in the school is a course with its own Term plan." />;
  if (!d.weeks.length) return <p className="text-[13px] text-muted-foreground">Set up the school year to see the map.</p>;
  const groups = [...d.departments.map((x) => ({ id: x.id as string | null, name: x.name })), { id: null, name: "No department" }]
    .map((g) => ({ ...g, rows: d.rows.filter((r) => r.department === g.id) })).filter((g) => g.rows.length);
  const cols = d.weeks.length + 2;
  const summary = (r: (typeof d.rows)[number]) => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono">Planned {r.planned.percent}%</span>
      {r.taught.map((t) => <span key={t.group} className="font-mono">{t.group} {t.taught}/{t.due}</span>)}
      {r.taught.some((t) => t.warn) ? <StatusBadge state="at_risk">Behind the map</StatusBadge> : null}
    </span>
  );
  return (
    <section aria-label="Year map" className="space-y-3 text-[13px]" data-testid="year-map">
      <ul className="flex flex-wrap gap-3 text-[12px]" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-primary" aria-hidden="true" />Ready</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm border border-primary" aria-hidden="true" />Draft</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-muted" aria-hidden="true" />Holiday</li>
        <li>A · has an assessment</li>
      </ul>
      <div className="hidden overflow-x-auto rounded-md border border-border md:block" role="region" aria-label="Year map by week" tabIndex={0}>
        <table className="text-[11px]">
          <caption className="sr-only">Courses by school week: each unit spans its weeks</caption>
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="sticky left-0 bg-card px-3 py-1.5 text-left font-medium">Course</th>
              {d.weeks.map((w, i) => (
                <th key={w.start} scope="col" className={cn("w-7 min-w-7 px-0 py-1.5 text-center font-mono font-normal", w.off && "bg-muted")}>
                  <span aria-hidden="true">{i === 0 || w.start.slice(5, 7) !== d.weeks[i - 1]!.start.slice(5, 7) ? MONTH.format(new Date(`${w.start}T00:00:00Z`)) : ""}</span>
                  <span className="sr-only">Week of {fmt(w.start)}{w.label ? `, ${w.label}` : ""}{w.holiday ? `, ${w.holiday}` : w.off ? ", no school" : ""}</span>
                </th>
              ))}
              <th scope="col" className="px-3 py-1.5 text-left font-medium">Progress</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.id ?? "none"}>
                <tr className="border-b border-border bg-muted"><th scope="rowgroup" colSpan={cols} className="px-3 py-1 text-left font-semibold">{g.name}</th></tr>
                {g.rows.map((r) => {
                  let at = 0;
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0" data-testid="map-row">
                      <th scope="row" className="sticky left-0 max-w-[180px] truncate bg-card px-3 py-1.5 text-left font-medium">
                        <a className="hover:underline" href={`/org/${encodeURIComponent(r.slug || r.id)}?tab=sprints`}>{r.title}</a></th>
                      {r.segments.flatMap((s) => {
                        const from = at;
                        at += s.span;
                        if (s.kind === "gap") return d.weeks.slice(from, from + s.span).map((w) => <td key={w.start} className={cn("h-7", w.off && "bg-muted")} />);
                        const label = `${s.name}, ${s.draft ? "Draft" : "Ready"}, ${fmt(s.from)} to the week of ${fmt(s.to)}${s.assessment ? ", has an assessment" : ""}`;
                        return [<td key={s.from} colSpan={s.span} className="px-0.5 py-1" title={label}>
                          <span className={cn("flex h-5 items-center gap-1 truncate rounded-sm px-1.5", s.draft ? "border border-primary text-foreground" : "bg-primary text-primary-foreground")}>
                            <span aria-hidden="true" className="truncate">{s.name}{s.assessment ? " · A" : ""}</span><span className="sr-only">{label}</span></span></td>];
                      })}
                      <td className="whitespace-nowrap px-3 py-1.5 text-[12px]">{summary(r)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phone (layer 13): a list per course with its units in order. */}
      <div className="space-y-3 md:hidden" data-testid="year-map-list">
        {groups.map((g) => (
          <section key={g.id ?? "none"} aria-label={g.name} className="space-y-2">
            <h3 className="text-[12px] font-semibold text-muted-foreground">{g.name}</h3>
            {g.rows.map((r) => (
              <div key={r.id} className="rounded-md border border-border p-3">
                <p className="font-medium">{r.title}</p>
                <ul className="mt-1 space-y-0.5">
                  {r.segments.flatMap((s) => (s.kind === "unit" ? [<li key={s.from}>{s.name} · {s.draft ? "Draft" : "Ready"}{s.assessment ? " · Assessment" : ""} · <span className="font-mono">{fmt(s.from)}</span></li>] : []))}
                </ul>
                <div className="mt-1 text-[12px]">{summary(r)}</div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
