"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readMockMarksAction, readMyPrepAction, readScoresAction, saveMockMarksAction, saveMyPrepAction, saveScoreLayoutAction } from "@/app/actions/mocks";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { LAYOUT_PRESETS, sectionScore } from "@/lib/organizations/mocks";

// Report 31.4 C3 (plan B2.4a): Members → Scores (staff), Enter marks, and My prep (learners). No averages, no ranks.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const fmt = (v: number | null | undefined) => (v == null ? "—" : String(v));
const PRESET_WORDS: Record<string, string> = { ielts: "IELTS (4 sections)", sat: "SAT (2 sections)", blank: "One section" };

/** Members → Scores: one series, learners × mocks, below target, the spread in bands; set up a mock; enter marks. */
export function ScoresView({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const [series, setSeries] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [setup, setSetup] = useState({ examId: "", preset: "ielts", name: "" });
  const q = useQuery({ queryKey: ["mock-scores", orgId, series], queryFn: () => readScoresAction(orgId, series), staleTime: 15_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading scores…</p>;
  if (!q.data?.success) return <ErrorNotice what="Scores" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["mock-scores", orgId] });
  const setUp = async () => {
    const preset = LAYOUT_PRESETS[setup.preset]!;
    const r = await saveScoreLayoutAction(orgId, setup.examId, { series: setup.name.trim() || "Mocks", ...preset });
    if (!r.success) return void toast.error(r.error);
    toast.success("Mock set up");
    setSetup({ examId: "", preset: "ielts", name: "" });
    void refresh();
  };
  return (
    <section aria-label="Scores" className="space-y-3 text-[13px]" data-testid="scores-view">
      <div className="flex flex-wrap items-center gap-2">
        {d.series.length ? <label className="flex items-center gap-2">Series
          <select className="nb-select" data-size="sm" value={d.picked ?? ""} onChange={(e) => setSeries(e.target.value)}>{d.series.map((s) => <option key={s} value={s}>{s}</option>)}</select></label> : null}
        {d.mocks.map((m) => <button key={m.id} type="button" className={LINK} onClick={() => setEntering(m.id)}>Enter marks: {m.title}{m.held ? " (held)" : ""}</button>)}
      </div>
      {d.mocks.length === 0 ? <p className="text-muted-foreground">No mocks yet. Set up one of the class’s exams as a mock below.</p> : (
        <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Scores by learner" tabIndex={0}>
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Learner</th><th className="px-3 py-2 font-medium">Exam</th><th className="px-3 py-2 font-medium">Target</th>
              {d.mocks.map((m) => <th key={m.id} className="px-3 py-2 font-medium">{m.title}</th>)}<th className="px-3 py-2 font-medium">Below target in</th></tr></thead>
            <tbody>
              {d.learners.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{l.name}</td><td className="px-3 py-2 font-mono">{l.examDate ?? "—"}</td><td className="px-3 py-2 font-mono">{fmt(l.target)}</td>
                  {l.overall.map((v, i) => <td key={i} className="px-3 py-2 font-mono">{fmt(v)}</td>)}
                  <td className="px-3 py-2">{l.below.join(", ") || "—"}{l.missing >= 3 ? <StatusBadge state="at_risk" className="ml-2">{l.missing} mocks missing</StatusBadge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.bands.length && d.mocks.length ? (
        <p className="text-muted-foreground" data-testid="score-bands">{d.mocks[d.mocks.length - 1]!.title}: {d.bands.map((b) => `${Number.isFinite(b.from) ? `${b.from}${b.to == null ? "+" : `–${b.to}`}` : `below ${b.to}`} · ${b.count}`).join("  ")}</p>
      ) : null}
      {d.exams.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" data-testid="mock-setup">
          <span className="font-medium">Set up a mock</span>
          <select className="nb-select" data-size="sm" aria-label="Exam" value={setup.examId} onChange={(e) => setSetup({ ...setup, examId: e.target.value })}>
            <option value="">Pick an exam…</option>{d.exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <select className="nb-select" data-size="sm" aria-label="Layout" value={setup.preset} onChange={(e) => setSetup({ ...setup, preset: e.target.value })}>
            {Object.keys(LAYOUT_PRESETS).map((k) => <option key={k} value={k}>{PRESET_WORDS[k]}</option>)}
          </select>
          <Input value={setup.name} maxLength={60} placeholder="Series, e.g. IELTS mocks" aria-label="Series name" onChange={(e) => setSetup({ ...setup, name: e.target.value })} className="w-[200px]" />
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!setup.examId} onClick={() => void setUp()}>Set up</button>
        </div>
      ) : null}
      <Dialog open={entering != null} onOpenChange={(o) => { if (!o) setEntering(null); }}>
        <DialogContent size="wide">
          <DialogHeader><DialogTitle>Enter marks</DialogTitle><DialogDescription>Each learner sees only their own, once results are released.</DialogDescription></DialogHeader>
          {entering ? <EnterMarks orgId={orgId} masterId={entering} onDone={() => { setEntering(null); void refresh(); }} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EnterMarks({ orgId, masterId, onDone }: { orgId: string; masterId: string; onDone: () => void }) {
  const q = useQuery({ queryKey: ["mock-marks", orgId, masterId], queryFn: () => readMockMarksAction(orgId, masterId) });
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  if (!q.data?.success) return q.isPending ? <p role="status" className="nb-waiting text-[13px] text-muted-foreground"><PixelBeat />Loading marks…</p> : <ErrorNotice what="Marks" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const value = (u: string, k: string, saved: number | null | undefined) => draft[u]?.[k] ?? (saved == null ? "" : String(saved));
  const save = async () => {
    const rows = Object.entries(draft).map(([userId, raws]) => ({ userId, raws: Object.fromEntries(Object.entries(raws).map(([k, v]) => [k, v === "" ? null : Number(v)])) }));
    if (!rows.length) return onDone();
    const r = await saveMockMarksAction(orgId, masterId, rows);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Saved ${r.saved}${d.held ? ". Held until you release results." : ""}`);
    onDone();
  };
  return (
    <div className="space-y-3 text-[13px]" data-testid="enter-marks">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-muted-foreground"><th className="px-2 py-1 font-medium">Learner</th>{d.layout.sections.map((s) => <th key={s.key} className="px-2 py-1 font-medium">{s.name} /{s.max}</th>)}</tr></thead>
          <tbody>
            {d.learners.map((l) => (
              <tr key={l.id}>
                <td className="px-2 py-1">{l.name}</td>
                {d.layout.sections.map((s) => {
                  const v = value(l.id, s.key, l.raws[s.key]);
                  const band = v !== "" && s.conversion?.length ? sectionScore(Number(v), s) : null;
                  return (
                    <td key={s.key} className="px-2 py-1"><span className="flex items-center gap-1">
                      <Input type="number" min={0} max={s.max} step="0.5" value={v} aria-label={`${s.name} for ${l.name}`} className="w-[72px] font-mono"
                        onChange={(e) => setDraft({ ...draft, [l.id]: { ...draft[l.id], [s.key]: e.target.value } })} />
                      {band != null ? <span className="font-mono text-muted-foreground">{band}</span> : null}</span></td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save marks</button><button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
    </div>
  );
}

/** Overview for learners: My prep — my exam and days to go, my targets, and Latest, Best and the gap per section. */
export function MyPrepCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["my-prep", orgId], queryFn: () => readMyPrepAction(orgId), staleTime: 30_000 });
  const [edit, setEdit] = useState<{ name: string; date: string; overall: string } | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.series.length && !d.exam.name)) return null;
  const save = async () => {
    const r = await saveMyPrepAction(orgId, { examName: edit!.name || null, examDate: edit!.date || null, targets: { ...d.targets, ...(edit!.overall ? { overall: Number(edit!.overall) } : {}) } });
    if (!r.success) return void toast.error(r.error);
    setEdit(null);
    void client.invalidateQueries({ queryKey: ["my-prep", orgId] });
  };
  return (
    <OrgCard title="My prep" testId="my-prep" action={<button type="button" className={LINK} onClick={() => setEdit({ name: d.exam.name ?? "", date: d.exam.date ?? "", overall: d.targets.overall != null ? String(d.targets.overall) : "" })}>Edit</button>}>
      <div className="space-y-2 text-[13px]">
        <p>{d.exam.name ? <span className="font-medium">{d.exam.name}</span> : "Add your exam"}{d.exam.date ? <span className="nb-meta ml-2 font-mono">{d.exam.date} · {d.exam.daysToGo} days to go</span> : null}
          {d.targets.overall != null ? <span className="nb-meta ml-2 font-mono">target {d.targets.overall}</span> : null}
          {d.suggested?.overall != null && d.suggested.overall !== d.targets.overall ? <span className="ml-2 text-muted-foreground">Suggested: {d.suggested.overall}</span> : null}</p>
        {edit ? (
          <span className="flex flex-wrap items-center gap-2">
            <Input value={edit.name} maxLength={80} placeholder="Exam" aria-label="My exam" onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-[200px]" />
            <Input type="date" value={edit.date} aria-label="Exam date" onChange={(e) => setEdit({ ...edit, date: e.target.value })} className="w-[160px] font-mono" />
            <Input type="number" step="0.5" min={0} value={edit.overall} placeholder="Target" aria-label="Overall target" onChange={(e) => setEdit({ ...edit, overall: e.target.value })} className="w-[90px] font-mono" />
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save</button>
          </span>
        ) : null}
        {d.series.map((s) => (
          <div key={s.name} className="overflow-x-auto" role="region" aria-label={`${s.name} scores`} tabIndex={0}>
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">{s.name}</th><th className="py-1 pr-3 font-medium">Target</th>
                {s.mocks.map((m) => <th key={m} className="py-1 pr-3 font-medium">{m}</th>)}<th className="py-1 pr-3 font-medium">Latest</th><th className="py-1 pr-3 font-medium">Best</th><th className="py-1 font-medium">Gap</th></tr></thead>
              <tbody>
                {[...s.sections, ...(s.overall ? [{ key: "overall", name: "Overall", ...s.overall }] : [])].map((row) => (
                  <tr key={row.key}>
                    <td className="py-1 pr-3">{row.name}</td><td className="py-1 pr-3 font-mono">{fmt(row.target)}</td>
                    {row.values.map((v, i) => <td key={i} className="py-1 pr-3 font-mono">{fmt(v)}</td>)}
                    <td className="py-1 pr-3 font-mono">{fmt(row.latest)}</td><td className="py-1 pr-3 font-mono">{fmt(row.best)}</td>
                    <td className="py-1">{row.gap == null ? "—" : row.onTarget ? <StatusBadge state="done">On target</StatusBadge> : `${row.gap} below`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </OrgCard>
  );
}
