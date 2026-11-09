"use client";

import { useEffect, useState, useTransition } from "react";

import { addTasksToSprintAction } from "@/app/actions/task";
import { readSprintBacklogAction } from "@/app/actions/workspace";
import { Notice } from "@/components/ui/notice";
import { Field, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import type { SprintBacklogRow } from "@/lib/workspaces/sprint-detail";
import { cn } from "@/lib/utils";

// Sprint redesign §8.6: plan from the backlog — pick the sprint, tick tasks, add. (The points card went 2026-11-09.)
// 2026-11-09: it lives in New sprint as its third tab (Unit · Week · Add work), not as a header button; it renders its
// own scrolling body and footer, so the dialog around it is a flex column.

export type AddWorkTargets = {
  /** Sprints work can go into (upcoming or running), named in full ("Unit 1 · Week 3–4"). */
  sprints: Array<{ id: string; name: string }>;
  /** The sprint being looked at, picked first. */
  defaultSprintId: string | null;
  onAdded: () => void;
};

export function SprintAddWorkPanel({ projectId, targets, onDone }: { projectId: string; targets: AddWorkTargets; onDone: () => void }) {
  const [sprintId, setSprintId] = useState(() => (targets.sprints.some((s) => s.id === targets.defaultSprintId) ? targets.defaultSprintId! : targets.sprints[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SprintBacklogRow[] | null>(null);
  // Ticked tasks stay ticked while a search hides them.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => void readSprintBacklogAction({ projectId, query }).then((r) => {
      if (!live) return;
      setRows(r.success ? r.rows : []);
      setError(r.success ? null : r.error);
    }), 200);
    return () => { live = false; clearTimeout(timer); };
  }, [projectId, query]);
  const target = targets.sprints.find((s) => s.id === sprintId) ?? null;
  const add = () => startTransition(async () => {
    if (!target) return;
    const result = await addTasksToSprintAction({ projectId, sprintId: target.id, taskIds: [...picked] });
    if (result.added) toast.success(`Added ${result.added} to ${target.name}.`);
    targets.onAdded();
    if (result.failed.length) return setError(result.failed[0]!.error);
    onDone();
  });
  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {!targets.sprints.length ? <Notice>Plan a sprint first. Work goes into an upcoming or running one.</Notice> : (<>
          <Field label="Add to" htmlFor="add-work-sprint">
            <SelectWrap>
              <select id="add-work-sprint" value={sprintId} onChange={(e) => setSprintId(e.target.value)} className={cn("nb-select nb-touch-target", selectClassName())}>
                {targets.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </SelectWrap>
          </Field>
          <div className="space-y-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the backlog" aria-label="Search the backlog" className={cn("nb-touch-target", inputClassName(false))} />
              <ul aria-label="Backlog" className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {rows === null ? <li className="px-3 py-4 text-sm text-muted-foreground">Reading the backlog…</li> : null}
                {rows?.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">{query ? "Nothing matches." : "The backlog is empty."}</li> : null}
                {rows?.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] hover:bg-muted">
                      <input type="checkbox" className="nb-check" checked={picked.has(r.id)} onChange={(e) => setPicked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{r.title}</span>
                        <span className="block text-[12px] text-muted-foreground">{r.kind === "assignment" ? "Assignment" : r.assignee ?? "Nobody yet"}</span>
                      </span>
                      <span className="rounded-sm border border-border px-1.5 font-mono text-[11px] text-muted-foreground">{r.storyPoints ?? "—"}</span>
                    </label>
                  </li>
                ))}
              </ul>
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </>)}
      </div>
      <div className={FORM_FOOTER_CLASS}>
        <button type="button" onClick={onDone} className={FORM_SECONDARY_CLASS}>Cancel</button>
        <button type="button" disabled={pending || picked.size === 0 || !target} onClick={add} className={FORM_PRIMARY_CLASS}>
          {picked.size ? `Add ${picked.size} ${picked.size === 1 ? "task" : "tasks"}` : "Add tasks"}
        </button>
      </div>
    </>
  );
}
