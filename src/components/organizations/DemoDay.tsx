"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { advanceRunAction, announceAwardAction, pickAwardAction, readDemoDayAction, readTeamFeedbackAction, saveDemoDayAction, saveFeedbackAction } from "@/app/actions/demo-day";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { FEEDBACK_KEYS, FEEDBACK_WORDS } from "@/lib/organizations/demo-day";

// Report 31.6 C4 (plan B2.5b): demo day — the card, the run of show, judging, awards, and the team's feedback.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const key = (classId: string) => ["demo-day", classId] as const;
type Result = Promise<{ success: true } | { success: false; error: string }>;

/** Class Overview: the demo day and its run of show (staff run it); judges judge; awards once announced. */
export function DemoDayCard({ classId }: { classId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: key(classId), queryFn: () => readDemoDayAction(classId), staleTime: 15_000 });
  const [judging, setJudging] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.date && !d.staff)) return null;
  const refresh = () => client.invalidateQueries({ queryKey: key(classId) });
  const run = (p: Result, ok: string) => void p.then((r) => { if (!r.success) return void toast.error(r.error); toast.success(ok); void refresh(); });
  return (
    <OrgCard title="Demo day" testId="demo-day">
      <div className="space-y-2 text-[13px]">
        <p>{d.date ? <span className="font-mono">{d.date} · {d.start}</span> : <span className="text-muted-foreground">No date yet.</span>}{d.place ? ` · ${d.place}` : ""}
          {d.link ? <a className={`${LINK} ml-2`} href={d.link} target="_blank" rel="noreferrer noopener">Online link</a> : null}</p>
        {d.show.length ? (
          <ol className="space-y-0.5" aria-label="Run of show">
            {d.show.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2"><span className="font-mono text-muted-foreground">{s.at}</span><span>{s.title}</span>
                {i === d.current ? <StatusBadge state="active">Now</StatusBadge> : null}</li>
            ))}
          </ol>
        ) : <p className="text-muted-foreground">Teams with the Capstone workflow show here in order.</p>}
        {d.staff && d.show.length ? <span className="flex gap-2">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void advanceRunAction(classId).then((r) => { if (!r.success) return void toast.error(r.error); void refresh(); })}>{d.current < 0 ? "Start" : "Next team"}</button>
        </span> : null}
        {d.announced.length ? <p data-testid="awards">Awards: {d.announced.map((a) => `${a.award}: ${a.team}`).join(" · ")}</p> : null}
        {d.isJudge && d.judging ? (
          judging ? <Judging classId={classId} data={d.judging} awards={d.awards} onSaved={() => void refresh()} />
            : <button type="button" className={LINK} onClick={() => setJudging(true)}>Judge the teams</button>
        ) : null}
        {d.staff && d.setup ? <DemoDaySetup classId={classId} d={d} run={run} /> : null}
      </div>
    </OrgCard>
  );
}

type Day = Extract<Awaited<ReturnType<typeof readDemoDayAction>>, { success: true }>;

function Judging({ classId, data, awards, onSaved }: { classId: string; data: NonNullable<Day["judging"]>; awards: string[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, { scores: Record<string, number | null>; note: string }>>({});
  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="judging">
      <p className="text-[12px] text-muted-foreground">Feedback to each team, never a mark. Teams you mentor are left out.</p>
      {data.teams.map((t) => {
        const v = draft[t.id] ?? { scores: t.scores, note: t.note };
        return (
          <div key={t.id} className="space-y-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
            <p className="font-medium">{t.title}{t.own ? <span className="ml-2 text-muted-foreground">Your mentees’ team</span> : null}</p>
            {t.own ? null : <>
              <span className="flex flex-wrap gap-3">{FEEDBACK_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-1.5">{FEEDBACK_WORDS[k]}
                  <select className="nb-select" data-size="sm" aria-label={`${FEEDBACK_WORDS[k]} for ${t.title}`} value={v.scores[k] ?? ""} onChange={(e) => setDraft({ ...draft, [t.id]: { ...v, scores: { ...v.scores, [k]: e.target.value ? Number(e.target.value) : null } } })}>
                    <option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select></label>
              ))}</span>
              <Input value={v.note} maxLength={2000} placeholder="A note to the team" aria-label={`Note to ${t.title}`} onChange={(e) => setDraft({ ...draft, [t.id]: { ...v, note: e.target.value } })} />
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void saveFeedbackAction(classId, t.id, v).then((r) => { if (!r.success) return void toast.error(r.error); toast.success("Feedback saved"); onSaved(); })}>Save feedback</button>
            </>}
          </div>
        );
      })}
      {awards.map((a) => (
        <label key={a} className="flex items-center gap-2">{a}
          <select className="nb-select" data-size="sm" aria-label={`Your pick for ${a}`} value={data.picks[a] ?? ""} onChange={(e) => void pickAwardAction(classId, a, e.target.value || null).then((r) => { if (!r.success) return void toast.error(r.error); onSaved(); })}>
            <option value="">No pick</option>{data.teams.filter((t) => !t.own).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select></label>
      ))}
    </div>
  );
}

function DemoDaySetup({ classId, d, run }: { classId: string; d: Day; run: (p: Result, ok: string) => void }) {
  const s = d.setup!;
  const [form, setForm] = useState({ date: d.date ?? "", start: d.start, place: d.place, link: d.link, pitch: String(s.pitch), questions: String(s.questions), judges: s.judges, awards: d.awards.join(", ") });
  const save = () => run(saveDemoDayAction(classId, { date: form.date || null, start: form.start, place: form.place, link: form.link, pitch: Number(form.pitch) || 5, questions: Number(form.questions) || 0,
    judges: form.judges, awards: form.awards.split(",").map((a) => a.trim()).filter(Boolean) }), "Demo day saved");
  return (
    <details className="rounded-md border border-border p-3" data-testid="demo-day-setup">
      <summary className="cursor-pointer font-medium">Set up demo day</summary>
      <div className="mt-2 space-y-2">
        <span className="flex flex-wrap gap-2">
          <Input type="date" value={form.date} aria-label="Demo day date" onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-[160px] font-mono" />
          <Input type="time" value={form.start} aria-label="Starts at" onChange={(e) => setForm({ ...form, start: e.target.value })} className="w-[120px] font-mono" />
          <Input value={form.place} placeholder="Place" aria-label="Place" onChange={(e) => setForm({ ...form, place: e.target.value })} className="w-[180px]" />
          <Input value={form.link} placeholder="Online link" aria-label="Online link" onChange={(e) => setForm({ ...form, link: e.target.value })} className="w-[220px]" />
        </span>
        <span className="flex flex-wrap items-center gap-2">Pitch <Input type="number" min={1} max={60} value={form.pitch} aria-label="Pitch minutes" onChange={(e) => setForm({ ...form, pitch: e.target.value })} className="w-[70px] font-mono" /> min,
          questions <Input type="number" min={0} max={30} value={form.questions} aria-label="Question minutes" onChange={(e) => setForm({ ...form, questions: e.target.value })} className="w-[70px] font-mono" /> min</span>
        <fieldset className="flex flex-wrap gap-3"><legend className="mb-1 text-[12px] font-medium">Judges (outside judges join the class as Viewers)</legend>
          {s.people.map((p) => <label key={p.id} className="flex items-center gap-1.5"><input className="nb-check" type="checkbox" checked={form.judges.includes(p.id)}
            onChange={(e) => setForm({ ...form, judges: e.target.checked ? [...form.judges, p.id] : form.judges.filter((j) => j !== p.id) })} />{p.name}</label>)}
        </fieldset>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium">Awards (comma between)</span><Input value={form.awards} aria-label="Awards" onChange={(e) => setForm({ ...form, awards: e.target.value })} /></label>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={save}>Save demo day</button>
        {s.picks.some((a) => a.picks.length) ? (
          <div className="space-y-1" data-testid="award-picks">
            <p className="text-[12px] font-medium">Judges’ picks (announce one per award)</p>
            {s.picks.map((a) => (
              <p key={a.award} className="flex flex-wrap items-center gap-2">{a.award}:
                {a.picks.map((p) => <button key={p.teamId} type="button" className={LINK} onClick={() => run(announceAwardAction(classId, a.award, p.teamId), `${a.award}: ${p.team} announced`)}>Announce {p.team} ({p.n} {p.n === 1 ? "pick" : "picks"})</button>)}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** In the team's Capstone card: the judges' feedback on this team's work. */
export function TeamFeedback({ projectId }: { projectId: string }) {
  const q = useQuery({ queryKey: ["team-feedback", projectId], queryFn: () => readTeamFeedbackAction(projectId), staleTime: 60_000 });
  const list = q.data?.success ? q.data.feedback : [];
  if (!list.length) return null;
  return (
    <div className="space-y-1 text-[13px]" data-testid="team-feedback">
      <p className="font-medium">Judges’ feedback</p>
      {list.map((f, i) => <p key={i}>{FEEDBACK_KEYS.filter((k) => f.scores[k] != null).map((k) => `${FEEDBACK_WORDS[k]} ${f.scores[k]}`).join(" · ")}{f.note ? ` — ${f.note}` : ""}</p>)}
    </div>
  );
}
