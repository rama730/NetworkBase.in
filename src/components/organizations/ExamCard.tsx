"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readExtraTimeAction, setExtraTimeAction } from "@/app/actions/exams";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

import { EXAM_FORMATS, examPhase, examStateText, type ExamSettings } from "@/lib/organizations/exams";

// Report 30.5 W4 (plan B1.6a): the exam on the student's copy — when and where, What's in it, the paper's state, rules.
const LABEL = "font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground";
const DAY = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

export function ExamCard({ exam, coverNames, rules, extraMinutes = 0 }: { exam: ExamSettings; coverNames: string[]; rules: string[]; extraMinutes?: number }) {
  const [now, setNow] = useState(() => Date.now());
  // Layer 14: the state is re-read every minute and announced only when it changes (at most every 10 minutes).
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const opens = new Date(exam.opensAt);
  const closes = new Date(exam.closesAt);
  const state = examStateText(exam, (d) => `${DAY.format(d)} ${TIME.format(d)}`, now, extraMinutes);
  const minutesLeft = Math.ceil((closes.getTime() + extraMinutes * 60_000 - now) / 60_000);
  const announced = examPhase(exam, now, extraMinutes) === "open" && exam.format !== "in_person" ? `Closes in ${Math.ceil(minutesLeft / 10) * 10} min` : state;
  return (
    <section aria-label="Exam" className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="exam-card">
      <p className="font-medium">{EXAM_FORMATS[exam.format]} · {DAY.format(opens)} · {TIME.format(opens)}–{TIME.format(closes)}{exam.room ? ` · ${exam.room}` : ""}</p>
      {exam.seats ? <p className="text-muted-foreground">Seats: {exam.seats}</p> : null}
      {extraMinutes > 0 && exam.format !== "in_person" ? <p className="text-muted-foreground">You have {extraMinutes} minutes extra time.</p> : null}
      <p className="font-mono text-[12px]" data-testid="exam-state">{state}</p>
      <span className="sr-only" aria-live="polite">{announced}</span>
      {coverNames.length ? <div><h4 className={LABEL}>What’s in it</h4><p>{coverNames.join(" · ")}</p></div> : null}
      {rules.length ? <div><h4 className={LABEL}>Rules</h4><p>{rules.join(" · ")}</p></div> : null}
      {exam.hold && !exam.releasedAt ? <p className="text-muted-foreground">Results show when your teacher releases them.</p> : null}
    </section>
  );
}

/** Settings → Exams (B1.6b): extra time per student, private to staff and that student (call 3). */
export function ExamSettingsCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["exam-extra-time", orgId], queryFn: () => readExtraTimeAction(orgId), staleTime: 30_000 });
  const data = q.data?.success && q.data.students.length ? q.data : null;
  const [who, setWho] = useState("");
  const [minutes, setMinutes] = useState("30");
  if (!data) return null;
  const save = async (userId: string, value: number | null) => {
    const r = await setExtraTimeAction(orgId, userId, value);
    if (!r.success) return void toast.error(r.error);
    await client.invalidateQueries({ queryKey: ["exam-extra-time", orgId] });
  };
  return (
    <section id="project-settings-exams" data-project-settings-section className="space-y-6">
      <SettingsCard title="Exams" headingLevel={2} description="Extra time moves only that student’s close on timed and take-home exams. Only staff and that student see it.">
        <div className="space-y-3 text-[13px]" data-testid="exam-settings">
          {data.rows.length ? (
            <ul className="space-y-1" aria-label="Extra time">{data.rows.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-2"><span>{r.name} <span className="font-mono">+{r.minutes} min</span></span>
                {data.teacher ? <button type="button" className="nb-touch-target text-[13px] font-medium text-primary hover:underline" onClick={() => void save(r.userId, null)}>Remove<span className="sr-only"> {r.name}’s extra time</span></button> : null}</li>
            ))}</ul>
          ) : <p className="text-muted-foreground">No one has extra time.</p>}
          {data.teacher ? (
            <div className="flex flex-wrap items-center gap-2">
              <select className="nb-select" data-size="sm" aria-label="Student" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Pick a student…</option>{data.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Input type="number" min={1} max={600} aria-label="Extra minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-8 w-[90px] font-mono" />
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!who} onClick={() => void save(who, Number(minutes))}>Give extra time</button>
            </div>
          ) : null}
        </div>
      </SettingsCard>
    </section>
  );
}
