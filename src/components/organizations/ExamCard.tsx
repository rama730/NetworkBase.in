"use client";

import { useEffect, useState } from "react";

import { EXAM_FORMATS, examPhase, examStateText, type ExamSettings } from "@/lib/organizations/exams";

// Report 30.5 W4 (plan B1.6a): the exam on the student's copy — when and where, What's in it, the paper's state, rules.
const LABEL = "font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground";
const DAY = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });

export function ExamCard({ exam, coverNames, rules }: { exam: ExamSettings; coverNames: string[]; rules: string[] }) {
  const [now, setNow] = useState(() => Date.now());
  // Layer 14: the state is re-read every minute and announced only when it changes (at most every 10 minutes).
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const opens = new Date(exam.opensAt);
  const closes = new Date(exam.closesAt);
  const state = examStateText(exam, (d) => `${DAY.format(d)} ${TIME.format(d)}`, now);
  const minutesLeft = Math.ceil((closes.getTime() - now) / 60_000);
  const announced = examPhase(exam, now) === "open" && exam.format !== "in_person" ? `Closes in ${Math.ceil(minutesLeft / 10) * 10} min` : state;
  return (
    <section aria-label="Exam" className="space-y-2 rounded-md border border-border p-3 text-[13px]" data-testid="exam-card">
      <p className="font-medium">{EXAM_FORMATS[exam.format]} · {DAY.format(opens)} · {TIME.format(opens)}–{TIME.format(closes)}{exam.room ? ` · ${exam.room}` : ""}</p>
      {exam.seats ? <p className="text-muted-foreground">Seats: {exam.seats}</p> : null}
      <p className="font-mono text-[12px]" data-testid="exam-state">{state}</p>
      <span className="sr-only" aria-live="polite">{announced}</span>
      {coverNames.length ? <div><h4 className={LABEL}>What’s in it</h4><p>{coverNames.join(" · ")}</p></div> : null}
      {rules.length ? <div><h4 className={LABEL}>Rules</h4><p>{rules.join(" · ")}</p></div> : null}
      {exam.hold && !exam.releasedAt ? <p className="text-muted-foreground">Results show when your teacher releases them.</p> : null}
    </section>
  );
}
