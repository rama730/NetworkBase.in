"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readMockMarksAction, readMyPrepAction, readScoresAction, saveMockMarksAction, saveMyPrepAction, saveScoreLayoutAction } from "@/app/actions/mocks";
import { logMistakeAction, readMistakesAction, readSyllabusAction, saveTopicsAction, setTopicStageAction, shareMistakeAction } from "@/app/actions/prep";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { LAYOUT_PRESETS, sectionScore } from "@/lib/organizations/mocks";
import { MISTAKE_REASONS, TOPIC_STAGES, type MistakeReason, type TopicStage } from "@/lib/organizations/prep";
import { cn } from "@/lib/utils";

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
  const [editing, setEditing] = useState(false);
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
        {d.layout ? <button type="button" className={LINK} onClick={() => setEditing(true)}>Edit layout</button> : null}
      </div>
      {d.mocks.length === 0 ? <p className="text-muted-foreground">No mocks yet. Set up one of the class’s exams as a mock below.</p> : d.learners.length === 0 ? <p className="text-muted-foreground">No learners yet. Their scores show here once they join.</p> : (
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
      {/* Found live: the spread shows once there are marks. */}
      {d.bands.some((b) => b.count > 0) && d.mocks.length ? (
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
      <StaffSyllabus orgId={orgId} />
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent size="wide">
          <DialogHeader><DialogTitle>Edit layout</DialogTitle><DialogDescription>Sections, maxima and each section’s raw-to-band table, for every mock in {d.picked}. Marks already entered stay as raw marks.</DialogDescription></DialogHeader>
          {editing && d.layout ? <LayoutEditor layout={d.layout} onSave={async (layout) => {
            for (const m of d.mocks) { const r = await saveScoreLayoutAction(orgId, m.id, layout); if (!r.success) return void toast.error(r.error); }
            toast.success("Layout saved"); setEditing(false); void refresh();
          }} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={entering != null} onOpenChange={(o) => { if (!o) setEntering(null); }}>
        <DialogContent size="wide">
          <DialogHeader><DialogTitle>Enter marks</DialogTitle><DialogDescription>Each learner sees only their own, once results are released.</DialogDescription></DialogHeader>
          {entering ? <EnterMarks orgId={orgId} masterId={entering} onDone={() => { setEntering(null); void refresh(); }} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

type Layout = NonNullable<Extract<Awaited<ReturnType<typeof readScoresAction>>, { success: true }>["layout"]>;
const tableText = (c: Array<[number, number]> | undefined) => (c ?? []).map(([raw, band]) => `${raw}:${band}`).join(", ");
const parseTable = (t: string): Array<[number, number]> | null => {
  const pairs = t.split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split(":").map((n) => Number(n.trim())));
  return pairs.every((p) => p.length === 2 && p.every((n) => Number.isFinite(n) && n >= 0)) ? (pairs as Array<[number, number]>) : null;
};

/** Found live: the raw-to-band tables institutions enter themselves (call 3), with each section's maximum. */
function LayoutEditor({ layout, onSave }: { layout: Layout; onSave: (layout: Layout) => Promise<void> }) {
  const [rows, setRows] = useState(layout.sections.map((s) => ({ ...s, table: tableText(s.conversion as Array<[number, number]> | undefined) })));
  const [overall, setOverall] = useState(layout.overall);
  const save = () => {
    const sections = [];
    for (const r of rows) {
      const table = r.table.trim() ? parseTable(r.table) : [];
      if (table === null) return void toast.error(`${r.name}: write the table as raw:band pairs, like 39:9, 30:7.`);
      sections.push({ key: r.key, name: r.name.trim() || r.key, max: Number(r.max) || 1, ...(table.length ? { conversion: table } : {}) });
    }
    void onSave({ series: layout.series, overall, sections });
  };
  return (
    <div className="space-y-3 text-[13px]" data-testid="layout-editor">
      {rows.map((r, i) => (
        <div key={r.key} className="grid gap-2 sm:grid-cols-[1fr_90px_2fr]">
          <Input value={r.name} aria-label={`Name of section ${i + 1}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input type="number" min={1} value={r.max} aria-label={`Maximum for ${r.name}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, max: Number(e.target.value) } : x)))} className="font-mono" />
          <Input value={r.table} placeholder="Raw to band, e.g. 39:9, 30:7, 23:6 (blank keeps raw marks)" aria-label={`Raw to band table for ${r.name}`} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, table: e.target.value } : x)))} className="font-mono" />
        </div>
      ))}
      <label className="flex items-center gap-2">Overall
        <select className="nb-select" data-size="sm" value={overall} onChange={(e) => setOverall(e.target.value as Layout["overall"])}>
          <option value="average_half">Average, to the nearest 0.5</option><option value="sum">Sum</option><option value="none">None</option>
        </select></label>
      <button type="button" className={FORM_PRIMARY_CLASS} onClick={save}>Save layout</button>
    </div>
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
  const [tab, setTab] = useState<"scores" | "syllabus" | "mistakes">("scores");
  const syllabus = useQuery({ queryKey: ["prep-syllabus", orgId], queryFn: () => readSyllabusAction(orgId), staleTime: 30_000 });
  const d = q.data?.success ? q.data : null;
  const hasTopics = syllabus.data?.success && syllabus.data.topics.length > 0;
  if (!d || (!d.series.length && !d.exam.name && !hasTopics)) return null;
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
        <div role="group" aria-label="My prep view" className="inline-flex rounded-md border border-border p-0.5 text-[12px]">
          {(["scores", "syllabus", "mistakes"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={tab === v} onClick={() => setTab(v)} className={cn("rounded-sm px-2.5 py-1", tab === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>
              {v === "scores" ? "Scores" : v === "syllabus" ? "Syllabus" : "Mistakes"}
            </button>
          ))}
        </div>
        {tab === "syllabus" ? <MySyllabus orgId={orgId} /> : tab === "mistakes" ? <MyMistakes orgId={orgId} /> : d.series.map((s) => (
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

/** B2.4b (call 9): my own stage on each topic. */
function MySyllabus({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["prep-syllabus", orgId], queryFn: () => readSyllabusAction(orgId), staleTime: 30_000 });
  if (!q.data?.success || q.data.staff) return null;
  if (!q.data.topics.length) return <p className="text-muted-foreground">Your teacher hasn’t listed the topics yet.</p>;
  return (
    <ul className="divide-y divide-border" data-testid="my-syllabus">
      {q.data.topics.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
          <span>{t.name}</span>
          <select className="nb-select" data-size="sm" aria-label={`Stage for ${t.name}`} value={t.stage}
            onChange={(e) => void setTopicStageAction(orgId, t.id, e.target.value as TopicStage).then((r) => { if (!r.success) return void toast.error(r.error); void client.invalidateQueries({ queryKey: ["prep-syllabus", orgId] }); })}>
            {(Object.keys(TOPIC_STAGES) as TopicStage[]).map((s) => <option key={s} value={s}>{TOPIC_STAGES[s]}</option>)}
          </select>
        </li>
      ))}
    </ul>
  );
}

/** B2.4b (call 8): my private mistakes, weak topics, and Share with my mentor. */
function MyMistakes({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["prep-mistakes", orgId], queryFn: () => readMistakesAction(orgId, null), staleTime: 15_000 });
  const [form, setForm] = useState<{ topicId: string; reason: MistakeReason; note: string }>({ topicId: "", reason: "concept", note: "" });
  if (!q.data?.success) return null;
  const d = q.data;
  const refresh = () => client.invalidateQueries({ queryKey: ["prep-mistakes", orgId] });
  const log = async () => {
    const r = await logMistakeAction(orgId, { topicId: form.topicId || null, reason: form.reason, note: form.note || undefined });
    if (!r.success) return void toast.error(r.error);
    setForm({ ...form, note: "" });
    void refresh();
  };
  return (
    <div className="space-y-2" data-testid="my-mistakes">
      {d.weak.length ? <p>Weak topics: {d.weak.map((w) => `${w.name} (${w.mistakes})`).join(" · ")}</p> : null}
      <span className="flex flex-wrap items-center gap-2">
        <select className="nb-select" data-size="sm" aria-label="Topic" value={form.topicId} onChange={(e) => setForm({ ...form, topicId: e.target.value })}>
          <option value="">No topic</option>{d.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="nb-select" data-size="sm" aria-label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as MistakeReason })}>
          {(Object.keys(MISTAKE_REASONS) as MistakeReason[]).map((r) => <option key={r} value={r}>{MISTAKE_REASONS[r]}</option>)}
        </select>
        <Input value={form.note} maxLength={1000} placeholder="What happened (only you see it)" aria-label="Mistake note" onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-[260px]" />
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void log()}>Log</button>
      </span>
      <ul className="divide-y divide-border">
        {d.mistakes.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="nb-meta font-mono">{m.at.slice(0, 10)}</span><span>{m.topic ?? "No topic"} · {MISTAKE_REASONS[m.reason]}</span>{m.note ? <span className="text-muted-foreground">{m.note}</span> : null}
            <button type="button" className={LINK} onClick={() => void shareMistakeAction(orgId, m.id, !m.shared).then((r) => { if (!r.success) return void toast.error(r.error); void refresh(); })}>{m.shared ? "Shared with my mentor · Stop" : "Share with my mentor"}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** B2.4b: staff list the topics (one per line) and see each topic's stages as counts. */
function StaffSyllabus({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["prep-syllabus", orgId], queryFn: () => readSyllabusAction(orgId), staleTime: 30_000 });
  const [draft, setDraft] = useState<string | null>(null);
  if (!q.data?.success || !q.data.staff) return null;
  const d = q.data;
  const text = draft ?? d.topics.map((t) => t.name).join("\n");
  const save = async () => {
    const r = await saveTopicsAction(orgId, text.split("\n"));
    if (!r.success) return void toast.error(r.error);
    toast.success("Topics saved");
    setDraft(null);
    void client.invalidateQueries({ queryKey: ["prep-syllabus", orgId] });
  };
  return (
    <section aria-label="Syllabus" className="space-y-2 rounded-md border border-border p-3" data-testid="staff-syllabus">
      <p className="font-medium">Syllabus <span className="nb-meta font-mono">{d.topics.length}</span></p>
      {d.topics.length ? (
        <ul className="space-y-0.5 text-[12px]">{d.topics.map((t) => <li key={t.id}>{t.name}: {(Object.keys(TOPIC_STAGES) as TopicStage[]).map((s) => `${TOPIC_STAGES[s]} ${t.counts[s]}`).join(" · ")}</li>)}</ul>
      ) : null}
      <textarea className="nb-textarea" rows={3} value={text} aria-label="Topics, one per line" onChange={(e) => setDraft(e.target.value)} placeholder="One topic per line" />
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save()}>Save topics</button>
    </section>
  );
}
