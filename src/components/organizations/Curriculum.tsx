"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readCurriculumAction, readCurriculumOverviewAction, readStandardsCoverageAction, saveCurriculumAction } from "@/app/actions/curriculum";
import { StatusBadge } from "@/components/organizations/org-ui";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { parseStandardsCsv, type Standard } from "@/lib/organizations/curriculum";

// Report 32.3 S2 (plan B3.2c): Settings → Teaching, the Standards view, and the public curriculum overview.
const key = (id: string) => ["curriculum", id] as const;

export function TeachingSettings({ schoolId }: { schoolId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: key(schoolId), queryFn: () => readCurriculumAction(schoolId), staleTime: 60_000 });
  const [imported, setImported] = useState<{ standards: Standard[]; skipped: number } | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!q.data?.success || !q.data.canEdit) return null;
  const d = q.data;
  const save = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await saveCurriculumAction(schoolId, patch).finally(() => setBusy(false));
    if (!r.success) return void toast.error(r.error);
    toast.success(r.retired ? `${ok} · ${r.retired} still on lessons kept as retired` : ok);
    setImported(null);
    setTemplate(null);
    void client.invalidateQueries({ queryKey: key(schoolId) });
    void client.invalidateQueries({ queryKey: ["standards", schoolId] });
  };
  const current = d.standards.filter((s) => !s.retired);
  return (
    <SettingsCard title="Teaching" headingLevel={2} description="Standards the courses cover, the sections every lesson plan starts with, and whether visitors see the curriculum overview.">
      <div className="space-y-5 text-[13px]" data-testid="teaching-settings">
        <fieldset className="space-y-2">
          <legend className="font-medium">Standards</legend>
          <p className="text-muted-foreground">{current.length ? `${current.length} standards` : "No standards yet."} Import a CSV with code, description, grade and subject; it replaces the list. Nothing is fetched from a link.</p>
          <input type="file" accept=".csv,text/csv" aria-label="Standards CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((t) => setImported(parseStandardsCsv(t))); }} />
          {imported ? (
            <div className="space-y-2" data-testid="standards-preview">
              <p>{imported.standards.length} standards ready{imported.skipped ? ` · ${imported.skipped} rows skipped (no code or a repeat)` : ""}{imported.standards[0] ? ` · first: ${imported.standards[0].code} ${imported.standards[0].text}` : ""}</p>
              <span className="flex gap-2">
                <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !imported.standards.length} onClick={() => void save({ standards: imported.standards }, "Standards saved")}>Save {imported.standards.length} standards</button>
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setImported(null)}>Cancel</button>
              </span>
            </div>
          ) : null}
        </fieldset>
        <label className="flex flex-col gap-1.5"><span className="font-medium">Lesson template</span>
          <span className="text-muted-foreground">The sections a new lesson plan starts with, separated by commas.</span>
          <Input aria-label="Lesson template sections" value={template ?? d.template.join(", ")} maxLength={400} onChange={(e) => setTemplate(e.target.value)} className="max-w-xl" />
        </label>
        {template !== null ? <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void save({ template: template.split(",").map((s) => s.trim()).filter(Boolean) }, "Lesson template saved")}>Save lesson template</button> : null}
        <label className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={d.publicOverview} disabled={busy} onChange={(e) => void save({ publicOverview: e.target.checked }, e.target.checked ? "Visitors see the curriculum overview" : "The curriculum overview is hidden")} />
          Show the curriculum overview on About (unit titles only)</label>
      </div>
    </SettingsCard>
  );
}

/** Sprints → Standards: covered of total; each standard with its courses and lessons; Not covered yet. */
export function StandardsView({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: ["standards", schoolId], queryFn: () => readStandardsCoverageAction(schoolId), staleTime: 60_000 });
  const [missing, setMissing] = useState(false);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the standards…</p>;
  if (!q.data?.success) return <ErrorNotice what="Standards" onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d.total) return <p className="text-[13px] text-muted-foreground">No standards yet. School leaders import them in Settings, under Teaching.</p>;
  const rows = d.rows.filter((r) => !missing || r.lessons === 0);
  return (
    <section aria-label="Standards" className="space-y-3 text-[13px]" data-testid="standards-view">
      <p className="flex flex-wrap items-center gap-3"><span className="font-mono">Standards covered {d.covered} of {d.total}</span>
        <label className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />Not covered yet only</label></p>
      <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Standards and their lessons" tabIndex={0}>
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Code</th><th className="px-3 py-2 font-medium">Standard</th><th className="px-3 py-2 font-medium">Grade</th><th className="px-3 py-2 font-medium">Covered by</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-border last:border-0" data-testid="standard-row">
                <td className="px-3 py-2 font-mono">{r.code}</td><td className="px-3 py-2">{r.text}</td><td className="px-3 py-2">{r.grade || "—"}</td>
                <td className="px-3 py-2">{r.lessons ? `${r.courses.join(", ")} · ${r.lessons} ${r.lessons === 1 ? "lesson" : "lessons"}` : <StatusBadge state="at_risk">Not covered yet</StatusBadge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** School About (call 9): the opt-in curriculum overview — courses and their unit titles only. */
export function CurriculumOverview({ schoolId }: { schoolId: string }) {
  const q = useQuery({ queryKey: ["curriculum-overview", schoolId], queryFn: () => readCurriculumOverviewAction(schoolId), staleTime: 300_000 });
  const d = q.data?.success ? q.data : null;
  if (!d?.courses.length) return null;
  return (
    <section aria-label="Curriculum" className="space-y-2" data-testid="curriculum-overview">
      <h2 className="nb-section-title">Curriculum</h2>
      <ul className="space-y-1.5 text-[13px]">
        {d.courses.map((c) => <li key={c.course}><span className="font-medium">{c.course}</span>: {c.units.map((u) => u.name).join(" · ") || "Units to come"}</li>)}
      </ul>
    </section>
  );
}
