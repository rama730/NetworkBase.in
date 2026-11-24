"use client";

import { StatusBadge } from "@/components/organizations/org-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Lock, Route } from "lucide-react";
import { useState } from "react";

import { addLessonAction, createStepAction, markLessonAction, moveStepAction, readPathAction, readProgressAction, setPathSettingsAction } from "@/app/actions/learning-path";
import { EmptyState } from "@/components/ui/EmptyState";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { useAddedWorkflows } from "@/components/workspaces/workflows/added-workflows";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

const pathKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "learning-path"];
const small = cn(FORM_SECONDARY_CLASS, "h-7 px-2 text-[12px]");

/** Report 38.18 W1 (A7.6): Sprints · Path · Progress where Learning path is added; otherwise the Sprints tab as it is. */
export function SprintsWithPath({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const added = useAddedWorkflows();
  const [view, setView] = useState<"sprints" | "path" | "progress">("path");
  if (!added.includes("learning_path")) return <>{children}</>;
  return (
    <div>
      <div role="group" aria-label="Sprints view" className="mb-3 inline-flex rounded-[6px] border border-border p-0.5 text-[12px]" data-testid="sprints-view-switch">
        {(["path", "progress", "sprints"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-[4px] px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>
            {v === "path" ? "Path" : v === "progress" ? "Progress" : "Sprints"}
          </button>
        ))}
      </div>
      {view === "path" ? <PathView projectId={projectId} /> : view === "progress" ? <ProgressTable projectId={projectId} /> : children}
    </div>
  );
}

/** W2–W5, W8: steps down the page with lessons; my ticks, Up next, locks; owners and admins add steps and lessons. */
export function PathView({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: pathKey(projectId), queryFn: () => readPathAction(projectId), staleTime: 15_000 });
  const [newStep, setNewStep] = useState<string | null>(null);
  const [newLesson, setNewLesson] = useState<{ stepId: string; title: string; minutes: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (query.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading the path…</p>;
  if (!query.data?.success) return <div className="nb-empty-state py-10" role="alert"><p className="nb-card-title">{query.data?.success === false ? query.data.error : "Couldn’t load the path"}</p></div>;
  const { steps, canManage, insider, settings, upNext, done, isClass, mine } = query.data;
  // B2.2a (report 31.3): in a class a step is a Module.
  const word = isClass ? "Module" : "Step";
  const doneSet = new Set(done);
  const refresh = () => queryClient.invalidateQueries({ queryKey: pathKey(projectId) });
  async function run(key: string, fn: () => Promise<{ success: boolean; error?: string }>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.success) throw new Error(r.error);
      await refresh();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t do that");
      return false;
    } finally {
      setBusy(null);
    }
  }
  return (
    <section aria-label="Learning path" className="space-y-4" data-testid="learning-path">
      {mine ? (
        <div className="space-y-1.5 rounded-[8px] border border-border px-3 py-2.5" data-testid="path-mine">
          <p className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
            <span className="font-semibold">Your progress</span>
            <span className="font-mono">{mine.percent}% · {mine.done} of {mine.total} steps</span>
            {mine.pace ? <StatusBadge state={mine.pace === "on" ? "done" : "late"}>{mine.pace === "on" ? "On pace" : "Behind pace"}</StatusBadge> : null}
            <span className="text-muted-foreground">started {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(mine.started))}</span>
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${mine.percent}%, ${mine.done} of ${mine.total} steps`}><div className="h-full bg-primary" style={{ width: `${mine.percent}%` }} /></div>
        </div>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <label className="flex items-center gap-1.5"><input type="radio" name="pacing" checked={settings.pacing === "self"} onChange={() => void run("pacing", () => setPathSettingsAction(projectId, { pacing: "self" }))} />Self-paced</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="pacing" checked={settings.pacing === "scheduled"} onChange={() => void run("pacing", () => setPathSettingsAction(projectId, { pacing: "scheduled", public: false }))} />Scheduled</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={settings.lockInOrder} onChange={(e) => void run("lock", () => setPathSettingsAction(projectId, { lockInOrder: e.target.checked }))} />Lock in order</label>
          {settings.pacing === "self" ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={settings.public} onChange={(e) => void run("public", () => setPathSettingsAction(projectId, { public: e.target.checked }))} />Public path (no one’s progress)</label> : null}
          {isClass && settings.pacing === "self" ? (
            <label className="flex items-center gap-1.5">Suggested pace
              <select className="nb-select" data-size="sm" aria-label="Suggested pace" value={settings.paceWeeks ?? ""} onChange={(e) => void run("pace", () => setPathSettingsAction(projectId, { paceWeeks: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">Off</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? "week" : "weeks"} a module</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {!steps.length ? <EmptyState icon={Route} title={`No ${word.toLowerCase()}s yet`} description={canManage ? `Add the first ${word.toLowerCase()}, then its lessons.` : `The path appears here once it has ${word.toLowerCase()}s.`} compact /> : null}
      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li key={step.id} className="rounded-[8px] border border-border" data-testid="path-step">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              <span className="font-mono text-[12px] text-muted-foreground">{i + 1}</span>
              <h3 className="text-[14px] font-semibold">{step.name}</h3>
              {step.startDate ? <span className="font-mono text-[11px] text-muted-foreground">{step.startDate.slice(0, 10)} → {step.endDate?.slice(0, 10)}</span> : null}
              {step.progress ? <span className="ml-auto font-mono text-[12px] text-muted-foreground" data-testid="step-progress">{step.progress.done} of {step.progress.total} done</span> : null}
              {step.locked ? <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Lock aria-hidden="true" className="size-3" />Finish {steps[i - 1]?.name} first</span> : null}
              {canManage ? (
                <span className="flex gap-1">
                  <button type="button" aria-label={`Move ${step.name} up`} disabled={i === 0 || busy != null} className="text-muted-foreground disabled:opacity-30" onClick={() => void run(`move-${step.id}`, () => moveStepAction(projectId, step.id, "up"))}><ArrowUp aria-hidden="true" className="size-3.5" /></button>
                  <button type="button" aria-label={`Move ${step.name} down`} disabled={i === steps.length - 1 || busy != null} className="text-muted-foreground disabled:opacity-30" onClick={() => void run(`move-${step.id}`, () => moveStepAction(projectId, step.id, "down"))}><ArrowDown aria-hidden="true" className="size-3.5" /></button>
                </span>
              ) : null}
            </div>
            <ul className="divide-y divide-border">
              {step.lessons.map((l) => {
                const isDone = doneSet.has(l.id), next = upNext?.lessonId === l.id;
                return (
                  <li key={l.id} className="flex min-h-11 items-center gap-2 px-3 py-1.5 text-[13px]" data-testid="path-lesson">
                    {insider ? <input type="checkbox" aria-label={`Mark ${l.title} done`} checked={isDone} disabled={step.locked || busy === l.id} className="size-4"
                      onChange={(e) => void run(l.id, () => markLessonAction(projectId, { taskId: l.id, done: e.target.checked }))} /> : null}
                    <span className={cn("min-w-0 flex-1", isDone && "text-muted-foreground line-through")}>{l.title}</span>
                    {next ? <span className="rounded-[3px] border border-foreground px-1 text-[11px] font-medium">Up next</span> : null}
                    {l.minutes ? <span className="font-mono text-[11px] text-muted-foreground">{l.minutes} min</span> : null}
                    {l.number ? <span className="font-mono text-[11px] text-muted-foreground">NB-{l.number}</span> : null}
                  </li>
                );
              })}
              {!step.lessons.length ? <li className="px-3 py-2 text-[12px] text-muted-foreground">No lessons yet.</li> : null}
            </ul>
            {canManage ? (newLesson?.stepId === step.id ? (
              <form className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2" onSubmit={(e) => { e.preventDefault(); void run("lesson", () => addLessonAction(projectId, { stepId: step.id, title: newLesson.title, ...(Number(newLesson.minutes) > 0 ? { fields: { minutes: Math.round(Number(newLesson.minutes)) } } : {}) }), "Lesson added").then((ok) => { if (ok) setNewLesson(null); }); }}>
                <input aria-label="Lesson title" autoFocus required maxLength={200} value={newLesson.title} onChange={(e) => setNewLesson({ ...newLesson, title: e.target.value })} placeholder="Lesson title" className={cn(inputClassName(false), "h-8 min-w-[200px] flex-1")} />
                <input aria-label="Minutes" type="number" min={1} max={600} value={newLesson.minutes} onChange={(e) => setNewLesson({ ...newLesson, minutes: e.target.value })} placeholder="min" className={cn(inputClassName(false), "h-8 w-20 font-mono")} />
                <button type="submit" className={cn(FORM_PRIMARY_CLASS, "h-8")} disabled={busy === "lesson" || !newLesson.title.trim()}>Add lesson</button>
                <button type="button" className={cn(FORM_SECONDARY_CLASS, "h-8")} onClick={() => setNewLesson(null)}>Cancel</button>
              </form>
            ) : <div className="border-t border-border px-3 py-1.5"><button type="button" className={small} onClick={() => setNewLesson({ stepId: step.id, title: "", minutes: "" })}>+ Lesson</button></div>) : null}
          </li>
        ))}
      </ol>
      {canManage ? (newStep != null ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void run("step", () => createStepAction(projectId, { name: newStep }), `${word} added`).then((ok) => { if (ok) setNewStep(null); }); }}>
          <input aria-label={`${word} name`} autoFocus required maxLength={120} value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder={`${word} name`} className={cn(inputClassName(false), "h-8 min-w-[220px] flex-1")} />
          <button type="submit" className={cn(FORM_PRIMARY_CLASS, "h-8")} disabled={busy === "step" || !newStep.trim()}>Add {word.toLowerCase()}</button>
          <button type="button" className={cn(FORM_SECONDARY_CLASS, "h-8")} onClick={() => setNewStep(null)}>Cancel</button>
        </form>
      ) : <button type="button" className={cn(FORM_SECONDARY_CLASS)} onClick={() => setNewStep("")}>+ {word}</button>) : null}
    </section>
  );
}

/** W6 (call 4): people × steps, "3/7", last activity; sorted by name only. Owners and admins. */
export function ProgressTable({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: [...pathKey(projectId), "progress"], queryFn: () => readProgressAction(projectId), staleTime: 15_000 });
  if (query.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading progress…</p>;
  if (!query.data?.success) return <p className="py-6 text-[13px] text-muted-foreground">{query.data?.success === false ? query.data.error : "Couldn’t load progress"}</p>;
  const { steps, people, isClass, dropOff } = query.data;
  if (!steps.length) return <EmptyState icon={Route} title="No steps yet" description="Progress shows once the path has steps." compact />;
  const short = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso)) : "—");
  return (
    <div className="space-y-2">
      {dropOff && people.length ? (
        // B2.2a (report 31.3 layer 6): how many learners reached each module, with ⚠ on the biggest fall.
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground" data-testid="path-dropoff">
          <span className="font-medium text-foreground">Reached</span>
          {steps.map((s, i) => (
            <span key={s.id} className="font-mono">{i ? "· " : ""}{s.name} {dropOff.reached[i]}{dropOff.worst === i ? <StatusBadge state="at_risk" className="ml-1">−{dropOff.dropPercent}%</StatusBadge> : null}</span>
          ))}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-[8px] border border-border" role="region" aria-label="Progress" tabIndex={0} data-testid="path-progress">
        <table className="w-full text-[12px]">
          <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="px-3 py-2 font-medium">{isClass ? "Learner" : "Person"}</th>{isClass ? <th className="px-3 py-2 font-medium">Started</th> : null}
            {steps.map((s) => <th key={s.id} className="px-3 py-2 font-medium">{s.name}</th>)}{isClass ? <><th className="px-3 py-2 font-medium">Progress</th><th className="px-3 py-2 font-medium">Pace</th></> : null}<th className="px-3 py-2 font-medium">Last activity</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{p.name}</td>
                {isClass ? <td className="px-3 py-2 font-mono">{short(p.started)}</td> : null}
                {p.cells.map((c, i) => <td key={i} className="px-3 py-2 font-mono">{c.done}/{c.total}</td>)}
                {isClass ? <>
                  <td className="px-3 py-2 font-mono">{p.percent}%</td>
                  <td className="px-3 py-2"><span className="inline-flex flex-wrap gap-1">{p.pace ? <StatusBadge state={p.pace === "on" ? "done" : "late"}>{p.pace === "on" ? "On pace" : "Behind"}</StatusBadge> : null}
                    {p.stuck != null ? <StatusBadge state="at_risk">Stuck {p.stuck} days</StatusBadge> : null}{!p.pace && p.stuck == null ? "—" : null}</span></td>
                </> : null}
                <td className="px-3 py-2 font-mono text-muted-foreground">{p.lastActivity ? p.lastActivity.slice(0, 10) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
