"use client";

import { readPathAction, setPathSettingsAction } from "@/app/actions/learning-path";
import { PathView } from "@/components/workspaces/tabs/sprint/LearningPath";
import { EventsView } from "@/components/organizations/SchoolEvents";
import { Fragment, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { addTermLessonAction, duplicateLessonAction, markClassTaughtAction, moveLessonAction, readTermPlanAction, saveClassNoteAction, saveLessonNotesAction, saveTermPlanSettingsAction, setLessonStageAction, setWeekTopicsAction, updateLessonAction, type TermPlanLesson, type TermPlanWeek } from "@/app/actions/term-plan";
import { StatusBadge } from "@/components/organizations/org-ui";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { LESSON_TYPES, type LessonType } from "@/lib/organizations/curriculum";
import { describeLocal, timeLabel } from "@/lib/organizations/zoned-time";
import { calendarCells, shiftMonth } from "@/lib/workflows/planner";
import { cn } from "@/lib/utils";

// Report 30.3 W2 (plan B1.2a): the Term plan — units → weeks → lessons, Assessments, breaks and outcome coverage.
const LINK = "nb-touch-target text-[12px] font-medium text-primary underline-offset-2 hover:underline";
const STAGE_WORDS: Record<string, string> = { draft: "Planned", ready: "Ready", taught: "Taught", cancelled: "Cancelled" };
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso)) : "…");
const planKey = (orgId: string) => ["term-plan", orgId] as const;

/** A class's Sprints tab: Term plan (default) or today's Sprint view. */
export function ClassSprints({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [view, setView] = useState<"plan" | "calendar" | "events" | "sprint">("plan");
  // B2.2a (report 31.3 call 1): a self-paced class plans a Path instead; one or the other, never both.
  const path = useQuery({ queryKey: ["learning-path", orgId], queryFn: () => readPathAction(orgId), staleTime: 15_000 });
  if (path.data?.success && path.data.settings.pacing === "self") return <SelfPacedSprints orgId={orgId}>{children}</SelfPacedSprints>;
  return (
    <div>
      <div role="group" aria-label="Sprints view" className="mb-3 inline-flex rounded-md border border-border p-0.5 text-[12px]" data-testid="class-sprints-switch">
        {(["plan", "calendar", "events", "sprint"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>
            {v === "plan" ? "Term plan" : v === "calendar" ? "Calendar" : v === "events" ? "Events" : "Sprint"}
          </button>
        ))}
      </div>
      {view === "plan" ? <TermPlanView orgId={orgId} /> : view === "calendar" ? <TermCalendar orgId={orgId} /> : view === "events" ? <EventsView orgId={orgId} /> : children}
    </div>
  );
}

function SelfPacedSprints({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [view, setView] = useState<"path" | "sprint">("path");
  return (
    <div>
      <div role="group" aria-label="Sprints view" className="mb-3 inline-flex rounded-md border border-border p-0.5 text-[12px]" data-testid="class-sprints-switch">
        {(["path", "sprint"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>
            {v === "path" ? "Path" : "Sprint"}
          </button>
        ))}
      </div>
      {view === "path" ? <PathView projectId={orgId} /> : children}
    </div>
  );
}

export function TermPlanView({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: planKey(orgId), queryFn: () => readTermPlanAction(orgId), staleTime: 15_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ weekId: string; title: string } | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the term plan…</p>;
  const data = q.data;
  if (!data?.success) return <ErrorNotice what="Term plan" onRetry={() => void q.refetch()} />;
  const teacher = data.role === "teacher" && data.canWrite;
  const staff = data.role !== "student";
  const refresh = () => client.invalidateQueries({ queryKey: planKey(orgId) });
  const run = async (p: Promise<{ success: boolean; error?: string }>, ok?: string) => {
    const r = await p;
    if (!r.success) return void toast.error(r.error ?? "Couldn’t save.");
    if (ok) toast(ok);
    await refresh();
  };
  if (!data.term.start || !data.term.end) {
    return <EmptyState figure="organization" title="No term dates yet" description={teacher ? "Set the term dates in Settings to plan your term." : "The term plan appears once the term is set."} />;
  }
  if (data.units.length === 0) {
    return <EmptyState figure="organization" title="No units yet" description={teacher ? "Plan your term in the Sprint view, then add lessons to each week." : "Units and weeks appear here once they’re planned."} />;
  }
  const label = data.settings.topicsLabel;
  const allWeeks = data.units.flatMap((u) => u.weeks.map((w) => ({ id: w.id, name: `${u.name} · ${w.name}` })));
  return (
    <div className="space-y-4" data-testid="term-plan">
      <p className="nb-meta font-mono" data-testid="term-plan-header">
        {day(data.term.start)} – {day(data.term.end)}
        {data.week.current ? ` · Week ${data.week.current} of ${data.week.total}` : ""}
        {data.coverage.total ? ` · Outcomes covered ${data.coverage.covered} of ${data.coverage.total}` : ""}
        {staff && data.planned.total ? ` · Planned ${data.planned.percent}%` : ""}
      </p>
      {data.behind.length ? (
        <p className="text-[13px]" data-testid="behind-the-map">Taught {data.behind.map((b) => `${b.group} ${b.taught} of ${b.due}${b.behind > 0 ? ` (${b.behind} behind)` : ""}`).join(" · ")}
          {data.behind.some((b) => b.warn) ? <StatusBadge state="at_risk" className="ml-2">Behind the map</StatusBadge> : null}</p>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[720px] text-[13px]">
          <caption className="sr-only">Term plan: units, weeks, lessons and assessments</caption>
          <thead className="border-b border-border text-left text-[12px] text-muted-foreground">
            <tr><th scope="col" className="px-3 py-2 font-medium">Week</th><th scope="col" className="px-3 py-2 font-medium">Dates</th><th scope="col" className="px-3 py-2 font-medium">{label}</th><th scope="col" className="px-3 py-2 font-medium">Lessons</th><th scope="col" className="px-3 py-2 font-medium">Assessments</th></tr>
          </thead>
          <tbody>
            {data.units.map((u) => (
              <Fragment key={u.id}>
                <tr className="border-b border-border bg-muted" data-testid="term-unit">
                  <th scope="rowgroup" colSpan={5} className="px-3 py-2 text-left">
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-foreground">{u.name}</span>
                      {u.status === "active" ? <StatusBadge state="new">Now</StatusBadge> : null}
                      <span className="flex items-center gap-2 font-normal text-muted-foreground">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-border" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${u.progress.percent}%` }} /></span>
                        <span className="font-mono text-[12px]">{u.progress.percent}%, {u.progress.taught} of {u.progress.planned} taught</span>
                      </span>
                      {u.outcomes.map((o) => <span key={o} className="nb-tag font-mono text-[11px]">{o}</span>)}
                    </span>
                  </th>
                </tr>
                {u.weeks.map((w) => (
                  <WeekRows key={w.id} week={w} staff={staff} teacher={teacher} label={label} current={data.week.weekId === w.id}
                    breaks={data.breaks.filter((b) => w.end && w.start && b.start > w.end.slice(0, 10) && !u.weeks.some((x) => x.start && x.start.slice(0, 10) > w.end!.slice(0, 10) && x.start.slice(0, 10) <= b.start))}
                    open={open} setOpen={setOpen} adding={adding?.weekId === w.id ? adding.title : null} setAdding={(title) => setAdding(title === null ? null : { weekId: w.id, title })}
                    onAdd={(title, lessonType) => void run(addTermLessonAction(orgId, { weekId: w.id, title, lessonType }), `${LESSON_TYPES[lessonType]} added`).then(() => setAdding(null))}
                    groups={data.groups} onTick={(id, g, on) => void run(markClassTaughtAction(orgId, id, g, on), on ? `Marked taught for ${g}` : `Taught taken back for ${g}`)}
                    onClassNote={(id, g, note) => void run(saveClassNoteAction(orgId, id, g, note), "Class note saved")}
                    onTopics={(t) => void run(setWeekTopicsAction(orgId, w.id, t))} onStage={(id, stage) => void run(setLessonStageAction(orgId, id, stage), stage === "taught" ? "Marked taught" : undefined)}
                    onUpdate={(id, patch) => void run(updateLessonAction(orgId, id, patch), "Saved")} onNotes={(id, notes) => void run(saveLessonNotesAction(orgId, id, notes), "Notes saved")}
                    weeks={allWeeks} onMove={(id, weekId, shiftRest) => void run(moveLessonAction(orgId, { taskId: id, weekId, shiftRest }), shiftRest ? "Moved, with the lessons after it" : "Lesson moved")}
                    onDuplicate={(id) => void run(duplicateLessonAction(orgId, id), "Lesson duplicated")} />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {staff && data.coverage.missing.length ? (
        <p className="text-[13px] text-muted-foreground" data-testid="term-plan-missing">{data.coverage.missing.map((o) => o.code).join(", ")} · not covered by any lesson yet</p>
      ) : null}
    </div>
  );
}

type Moves = { weeks: Array<{ id: string; name: string }>; onMove: (id: string, weekId: string, shiftRest: boolean) => void; onDuplicate: (id: string) => void;
  /** B3.2a: the classes this course teaches, per-class Taught and class notes. */
  groups: string[]; onTick: (id: string, group: string, taught: boolean) => void; onClassNote: (id: string, group: string, note: string) => void };

function WeekRows({ week, staff, teacher, label, current, breaks, open, setOpen, adding, setAdding, onAdd, onTopics, onStage, onUpdate, onNotes, weeks, onMove, onDuplicate, groups, onTick, onClassNote }: Moves & {
  week: TermPlanWeek; staff: boolean; teacher: boolean; label: string; current: boolean; breaks: Array<{ name: string; start: string; end: string }>;
  open: string | null; setOpen: (id: string | null) => void; adding: string | null; setAdding: (title: string | null) => void; onAdd: (title: string, lessonType: LessonType) => void;
  onTopics: (t: string) => void; onStage: (id: string, stage: "draft" | "ready" | "taught" | "cancelled") => void;
  onUpdate: (id: string, patch: { before?: string; during?: string; after?: string }) => void; onNotes: (id: string, notes: string) => void;
}) {
  const live = week.lessons.filter((l) => l.stage !== "cancelled");
  const [newType, setNewType] = useState<LessonType>("lesson");
  return (
    <>
      <tr className={cn("border-b border-border align-top", current && "bg-muted")} data-testid="term-week">
        <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-medium">{week.name}{current ? <StatusBadge state="new" className="ml-2">Now</StatusBadge> : null}
          {week.examWeek ? <StatusBadge state="at_risk" className="ml-2">{week.examWeek}</StatusBadge> : null}</th>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-muted-foreground">{day(week.start)}–{day(week.end)}</td>
        <td className="px-3 py-2">
          {teacher ? <Input aria-label={`${label} for ${week.name}`} defaultValue={week.goal ?? ""} maxLength={500} placeholder="—" onBlur={(e) => { if (e.target.value !== (week.goal ?? "")) onTopics(e.target.value); }} className="h-8" />
            : week.goal ?? <span className="text-muted-foreground">—</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span className="font-mono text-[12px]">
            {live.length ? `${live.filter((l) => l.stage === "taught").length} of ${live.length} taught` : "—"}
          </span>
          {live.length > week.sessions && week.sessions > 0 ? <span className="ml-2 text-[12px] text-[var(--status-warning)]">{live.length} lessons, {week.sessions} sessions</span> : null}
        </td>
        <td className="px-3 py-2">
          {week.assessments.length ? week.assessments.map((a) => <span key={a.id} className="mr-2 inline-flex items-center gap-1 text-[12px]">{a.exam ? <StatusBadge state="at_risk">Exam</StatusBadge> : null}{a.title} · {a.exam ? "" : "due "}{day(a.due)}</span>) : <span className="text-muted-foreground">—</span>}
        </td>
      </tr>
      {week.lessons.map((l) => (
        <LessonRow key={l.id} lesson={l} staff={staff} teacher={teacher} expanded={open === l.id} toggle={() => setOpen(open === l.id ? null : l.id)} onStage={onStage} onUpdate={onUpdate} onNotes={onNotes}
          weeks={weeks} onMove={onMove} onDuplicate={onDuplicate} groups={groups} onTick={onTick} onClassNote={onClassNote} />
      ))}
      {teacher ? (
        <tr className="border-b border-border">
          <td colSpan={5} className="px-3 py-1.5 pl-10">
            {adding === null ? <button type="button" className={LINK} onClick={() => setAdding("")}>+ Lesson<span className="sr-only"> in {week.name}</span></button> : (
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) onAdd(adding.trim(), newType); }}>
                <Input autoFocus aria-label={`New lesson in ${week.name}`} value={adding} maxLength={200} onChange={(e) => setAdding(e.target.value)} placeholder="Lesson title" className="h-8 max-w-sm" />
                <select className="nb-select" data-size="sm" aria-label={`Lesson type for ${week.name}`} value={newType} onChange={(e) => setNewType(e.target.value as LessonType)}>
                  {(Object.keys(LESSON_TYPES) as LessonType[]).map((t) => <option key={t} value={t}>{LESSON_TYPES[t]}</option>)}</select>
                <button type="submit" className={FORM_SECONDARY_CLASS}>Add</button>
                <button type="button" className={LINK} onClick={() => setAdding(null)}>Cancel</button>
              </form>
            )}
          </td>
        </tr>
      ) : null}
      {breaks.map((b) => (
        <tr key={b.start} className="border-b border-border bg-muted text-muted-foreground" data-testid="term-break">
          <th scope="row" className="px-3 py-1.5 text-left font-normal">—</th>
          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px]">{day(b.start)}–{day(b.end)}</td>
          <td colSpan={3} className="px-3 py-1.5">{b.name}</td>
        </tr>
      ))}
    </>
  );
}

function LessonRow({ lesson: l, staff, teacher, expanded, toggle, onStage, onUpdate, onNotes, weeks, onMove, onDuplicate, groups, onTick, onClassNote }: Moves & {
  lesson: TermPlanLesson; staff: boolean; teacher: boolean; expanded: boolean; toggle: () => void;
  onStage: (id: string, stage: "draft" | "ready" | "taught" | "cancelled") => void; onUpdate: (id: string, patch: { before?: string; during?: string; after?: string }) => void; onNotes: (id: string, notes: string) => void;
}) {
  const when = l.session ? describeLocal(l.session.start, null, null).text : null;
  const [draft, setDraft] = useState({ before: l.before ?? "", during: l.during ?? "", after: l.after ?? "", notes: l.notes ?? "" });
  const [moveTo, setMoveTo] = useState("");
  const [classNotes, setClassNotes] = useState<Record<string, string>>(l.classNotes ?? {});
  const perClass = staff && groups.length > 0;
  return (
    <>
      <tr className="border-b border-border text-[13px]" data-testid="term-lesson">
        <td colSpan={5} className="px-3 py-1.5 pl-10">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[12px] text-muted-foreground">{l.needsNewSession ? <span className="text-[var(--status-warning)]">Needs a new session</span> : when ?? "No session"}</span>
            <button type="button" className="font-medium text-foreground hover:underline" aria-expanded={expanded} onClick={toggle}>{l.title}</button>
            <StatusBadge state={l.stage === "taught" ? "done" : l.stage === "ready" ? "new" : l.stage === "cancelled" ? "archived" : "draft"}>{STAGE_WORDS[l.stage] ?? l.stage}</StatusBadge>
            {l.lessonType !== "lesson" ? <span className="nb-tag text-[11px]">{LESSON_TYPES[l.lessonType]}</span> : null}
            {l.draftSoon ? <span className="text-[12px] text-[var(--status-warning)]">Still Draft, soon</span> : null}
            {l.outcomes.map((o) => <span key={o} className="nb-tag font-mono text-[11px]">{o}</span>)}
            {perClass && l.stage !== "cancelled" ? (
              <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`Taught per class: ${l.title}`} data-testid="class-ticks">
                {groups.map((g) => <label key={g} className="flex items-center gap-1 text-[12px]"><input className="nb-check" type="checkbox" checked={Boolean(l.ticks[g])}
                  aria-label={`Taught ${g}: ${l.title}`} disabled={!teacher && Boolean(l.ticks[g])} onChange={(e) => onTick(l.id, g, e.target.checked)} />{g}{l.ticks[g] ? <span className="font-mono text-muted-foreground"> {day(l.ticks[g]!.on)}</span> : null}</label>)}
              </span>
            ) : null}
            {staff ? (
              <span className="flex gap-2">
                {teacher && l.stage === "draft" ? <button type="button" className={LINK} onClick={() => onStage(l.id, "ready")}>Ready<span className="sr-only"> {l.title}</span></button> : null}
                {!perClass && (l.stage === "ready" || (teacher && l.stage === "draft")) ? <button type="button" className={LINK} onClick={() => onStage(l.id, "taught")}>Mark taught<span className="sr-only"> {l.title}</span></button> : null}
                {teacher && (l.stage === "taught" || l.stage === "cancelled" || l.stage === "ready") ? <button type="button" className={LINK} onClick={() => onStage(l.id, "draft")}>Back to Planned<span className="sr-only"> {l.title}</span></button> : null}
                {teacher && l.stage !== "cancelled" && l.stage !== "taught" ? <button type="button" className={LINK} onClick={() => onStage(l.id, "cancelled")}>Cancel<span className="sr-only"> {l.title}</span></button> : null}
                {teacher ? <button type="button" className={LINK} onClick={() => onDuplicate(l.id)}>Duplicate<span className="sr-only"> {l.title}</span></button> : null}
                {teacher ? (
                  <select aria-label={`Move ${l.title} to week`} className="nb-select h-7 w-[180px] text-[12px]" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                    <option value="">Move to week…</option>
                    {weeks.filter((w) => w.id !== l.weekId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                ) : null}
                {moveTo ? (
                  <span className="flex gap-2" data-testid="shift-the-rest">
                    <button type="button" className={LINK} onClick={() => { onMove(l.id, moveTo, false); setMoveTo(""); }}>Move only this</button>
                    <button type="button" className={LINK} onClick={() => { onMove(l.id, moveTo, true); setMoveTo(""); }}>Shift the rest</button>
                    <button type="button" className={LINK} onClick={() => setMoveTo("")}>Keep it here</button>
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border">
          <td colSpan={5} className="px-3 py-3 pl-10">
            <div className="grid gap-3 md:grid-cols-3" data-testid="lesson-details">
              {(["before", "during", "after"] as const).map((k) => {
                const title = k === "before" ? "Before class" : k === "during" ? "In class" : "After class";
                const can = teacher || (staff && k === "during");
                return (
                  <label key={k} className="flex flex-col gap-1 text-[12px]"><span className="font-medium text-foreground">{title}</span>
                    {can ? <textarea className="nb-textarea" rows={3} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} onBlur={() => { if (draft[k] !== (l[k] ?? "")) onUpdate(l.id, { [k]: draft[k] }); }} />
                      : <span className="whitespace-pre-wrap text-[13px] text-muted-foreground">{l[k] || "—"}</span>}
                  </label>
                );
              })}
            </div>
            {staff ? (
              <label className="mt-3 flex flex-col gap-1 text-[12px]"><span className="font-medium text-foreground">Teacher notes</span><span className="text-muted-foreground">Only Teachers and TAs see this.</span>
                <textarea className="nb-textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} onBlur={() => { if (draft.notes !== (l.notes ?? "")) onNotes(l.id, draft.notes); }} />
              </label>
            ) : null}
            {perClass ? (
              <fieldset className="mt-3 space-y-1.5 text-[12px]" data-testid="class-notes"><legend className="font-medium text-foreground">Class notes</legend>
                <span className="block text-muted-foreground">One line per class for staff, such as “run the lab in two parts”. No student names.</span>
                {groups.map((g) => <label key={g} className="flex items-center gap-2"><span className="w-10 font-mono">{g}</span>
                  <Input value={classNotes[g] ?? ""} maxLength={200} aria-label={`Class note for ${g}: ${l.title}`} onChange={(e) => setClassNotes({ ...classNotes, [g]: e.target.value })}
                    onBlur={() => { if ((classNotes[g] ?? "") !== (l.classNotes?.[g] ?? "")) onClassNote(l.id, g, classNotes[g] ?? ""); }} className="h-8 max-w-md" /></label>)}
              </fieldset>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Settings → Term plan (the teacher): outcomes, when students see lessons, the Topics label. */
/** B2.2a (report 31.3 layer 1): Scheduled (the Term plan) or Self-paced (the Path); switches only before learners join. */
function PacingRow({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const path = useQuery({ queryKey: ["learning-path", orgId], queryFn: () => readPathAction(orgId), staleTime: 15_000 });
  if (!path.data?.success || !path.data.canManage) return null;
  const pacing = path.data.settings.pacing;
  const set = async (next: "self" | "scheduled") => {
    const r = await setPathSettingsAction(orgId, { pacing: next, ...(next === "scheduled" ? { public: false } : {}) });
    if (!r.success) return void toast.error(r.error);
    toast.success(next === "self" ? "Self-paced: the Sprints tab shows the Path" : "Scheduled: the Sprints tab shows the Term plan");
    void client.invalidateQueries({ queryKey: ["learning-path", orgId] });
  };
  return (
    <SettingsCard title="Pacing" headingLevel={2} description="Scheduled follows the Term plan; Self-paced gives each learner a Path at their own speed. It switches only before the first learner joins.">
      <fieldset className="flex flex-wrap items-center gap-4 text-[13px]" data-testid="class-pacing">
        <legend className="sr-only">Pacing</legend>
        <label className="flex items-center gap-1.5"><input className="nb-radio" type="radio" name="class-pacing" checked={pacing === "scheduled"} onChange={() => void set("scheduled")} />Scheduled (Term plan)</label>
        <label className="flex items-center gap-1.5"><input className="nb-radio" type="radio" name="class-pacing" checked={pacing === "self"} onChange={() => void set("self")} />Self-paced (Path)</label>
      </fieldset>
    </SettingsCard>
  );
}

export function TermPlanSettings({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: planKey(orgId), queryFn: () => readTermPlanAction(orgId), staleTime: 15_000 });
  const data = q.data?.success ? q.data : null;
  const [draft, setDraft] = useState<typeof data extends null ? never : NonNullable<typeof data>["settings"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupsText, setGroupsText] = useState<string | null>(null);
  if (!data || data.role !== "teacher") return null;
  const s = draft ?? data.settings;
  const save = async () => {
    setBusy(true);
    const groups = groupsText === null ? undefined : groupsText.split(",").map((g) => g.trim()).filter(Boolean);
    const r = await saveTermPlanSettingsAction(orgId, { ...s, ...(groups ? { groups } : {}) }).finally(() => setBusy(false));
    if (!r.success) return void toast.error(r.error);
    toast.success("Term plan settings saved");
    setDraft(null);
    setGroupsText(null);
    await client.invalidateQueries({ queryKey: planKey(orgId) });
  };
  return (
    <section id="project-settings-term-plan" data-project-settings-section className="space-y-6">
      <PacingRow orgId={orgId} />
      <SettingsCard title="Term plan" headingLevel={2} description="Outcomes the course teaches, when students see lessons, and what the week's column is called.">
        <div className="space-y-5" data-testid="term-plan-settings">
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Outcomes</legend>
            {s.outcomes.map((o, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input aria-label={`Outcome ${i + 1} code`} value={o.code} maxLength={12} onChange={(e) => setDraft({ ...s, outcomes: s.outcomes.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) })} className="w-[90px] font-mono" />
                <Input aria-label={`Outcome ${i + 1}`} value={o.text} maxLength={300} onChange={(e) => setDraft({ ...s, outcomes: s.outcomes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} className="min-w-[220px] flex-1" />
                <button type="button" className={LINK} onClick={() => setDraft({ ...s, outcomes: s.outcomes.filter((_, j) => j !== i) })}>Remove<span className="sr-only"> outcome {i + 1}</span></button>
              </div>
            ))}
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft({ ...s, outcomes: [...s.outcomes, { code: `CO${s.outcomes.length + 1}`, text: "" }] })}>Add an outcome</button>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-[13px]"><span className="font-medium">Classes this course teaches</span>
            <span className="text-[12px] text-muted-foreground">Names, separated by commas, such as 6A, 6B, 6C. Each lesson is then ticked Taught per class.</span>
            <Input aria-label="Classes this course teaches" value={groupsText ?? data.groups.join(", ")} maxLength={300} onChange={(e) => setGroupsText(e.target.value)} className="max-w-md font-mono" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]"><span className="font-medium">Students see lessons</span>
            <select className="nb-select w-[240px]" value={s.studentsSee} onChange={(e) => setDraft({ ...s, studentsSee: e.target.value as "ready" | "always" })}>
              <option value="ready">Once they’re Ready</option><option value="always">Always, even while planned</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px]"><span className="font-medium">The week’s column is called</span>
            <select className="nb-select w-[240px]" value={s.topicsLabel} onChange={(e) => setDraft({ ...s, topicsLabel: e.target.value as "Topics" | "Chapters" | "Themes" })}>
              <option>Topics</option><option>Chapters</option><option>Themes</option>
            </select>
          </label>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void save()}>Save term plan settings</button>
        </div>
      </SettingsCard>
    </section>
  );
}

type CalItem = { id: string; dueDate: string; label: string; kind: "lesson" | "assessment"; time?: string; stage?: string };

/** Report 30.3 views: the Calendar — each session's lesson on its day, and assessments on their due days. */
export function TermCalendar({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: planKey(orgId), queryFn: () => readTermPlanAction(orgId), staleTime: 15_000 });
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState<string | null>(null);
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the calendar…</p>;
  const data = q.data;
  if (!data?.success) return <ErrorNotice what="Calendar" onRetry={() => void q.refetch()} />;
  const items: CalItem[] = data.units.flatMap((u) => u.weeks.flatMap((w) => [
    ...w.lessons.filter((l) => l.session && l.stage !== "cancelled").map((l) => ({ id: l.id, dueDate: `${l.session!.start.slice(0, 10)}T00:00:00.000Z`, label: l.title, kind: "lesson" as const, time: timeLabel(l.session!.start.slice(11, 16)), stage: l.stage })),
    ...w.assessments.map((a) => ({ id: `${w.id}:${a.id}`, dueDate: `${a.due.slice(0, 10)}T00:00:00.000Z`, label: a.title, kind: "assessment" as const })),
  ]));
  const shown = month ?? (data.term.start && today < data.term.start ? data.term.start.slice(0, 7) : today.slice(0, 7));
  const weeks = calendarCells(shown, items, today, 4);
  const title = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${shown}-01T00:00:00Z`));
  return (
    <div className="space-y-3" data-testid="term-calendar">
      <div className="flex items-center gap-3">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMonth(shiftMonth(shown, -1))}>Previous month</button>
        <h3 className="nb-card-title" aria-live="polite">{title}</h3>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setMonth(shiftMonth(shown, 1))}>Next month</button>
      </div>
      <table className="w-full table-fixed border-collapse text-[12px]">
        <caption className="sr-only">{title}: lessons and assessments by day</caption>
        <thead><tr>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <th key={d} scope="col" className="py-1 text-left font-medium text-muted-foreground">{d}</th>)}</tr></thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key}>
              {week.map((d) => (
                <td key={d.key} className={cn("h-24 border border-border p-1 align-top", !d.inMonth && "bg-muted text-muted-foreground")}>
                  <span className={cn("font-mono", d.isToday && "font-semibold text-primary")}>{d.day}</span>
                  <ul className="mt-1 space-y-0.5">
                    {d.items.map((it) => (
                      <li key={it.id} className="truncate" title={it.label}>
                        {it.kind === "lesson" ? <><span className="font-mono text-muted-foreground">{it.time}</span> {it.label}</> : <span className="font-medium">Due · {it.label}</span>}
                      </li>
                    ))}
                    {d.more ? <li className="text-muted-foreground">{d.more} more</li> : null}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Syllabus's live Term plan block: units, then weeks with their dates and topics (members; nothing for others). */
export function TermPlanBlock({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: planKey(orgId), queryFn: () => readTermPlanAction(orgId), staleTime: 30_000 });
  const data = q.data?.success ? q.data : null;
  if (!data || data.units.length === 0) return null;
  return (
    <div className="my-4 space-y-3 rounded-md border border-border px-4 py-3 text-[13px]" data-testid="term-plan-block">
      {data.units.map((u) => (
        <section key={u.id} aria-label={u.name}>
          <p className="font-semibold text-foreground">{u.name} <span className="nb-meta font-mono font-normal">{day(u.start)}–{day(u.end)}</span></p>
          <ul className="mt-1 space-y-0.5">
            {u.weeks.map((w) => <li key={w.id} className="flex gap-3"><span className="w-28 shrink-0 font-mono text-[12px] text-muted-foreground">{w.name} · {day(w.start)}</span><span>{w.goal ?? "—"}</span></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
