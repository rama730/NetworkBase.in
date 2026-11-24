"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, X } from "@/components/ui/icons";
import { useState } from "react";

import { assignTaskAction, readProjectsAction, readProjectWorkAction, setPartOfAction, setTaskDatesAction, updateTaskFieldAction } from "@/app/actions/task";
import TaskStatusBadge from "@/components/workspaces/v2/tasks/badges/TaskStatusBadge";
import { selectClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { TaskStageControl } from "@/components/workspaces/v2/tasks/TaskStageControl";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { daysBetween, dueOn, localDayKey } from "@/lib/workflows/planner";
import { formatTaskDueDate, taskDueDateKey, type TaskSurfaceRecord } from "@/lib/workspaces/task-presentation";

const workKey = (projectId: string, id: string) => [...queryKeys.project.detail.tasksRoot(projectId), "project-work", id];
const stageLabel = (stage: string | null) => WORKFLOW_TYPES.project!.stages.find((s) => s.key === stage)?.label ?? "Not started";

/** A thin completion bar with its number (report 38.5 S5); the words say where the number comes from. */
function Completion({ percent, source }: { percent: number; source: string }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Completion ${percent}%`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-[2px] bg-muted"><div className="h-full bg-primary transition-[width] duration-[180ms]" style={{ width: `${percent}%` }} /></div>
      <span className="font-mono text-[11px] text-muted-foreground">{percent}%{source === "hand" ? " · set by hand" : source === "subtasks" ? " · from subtasks" : ""}</span>
    </div>
  );
}

/**
 * Report 38.5 W3 (plan A1.3): a project's Work tab. Its tasks, completion, + New task with Part of filled, Add existing
 * (tasks not already in another project), and Remove from project.
 */
export function ProjectWork({ projectId, project, canEdit, candidates, onNewTask, onOpenTask, noun = "project" }: {
  projectId: string; project: { id: string; title: string }; canEdit: boolean; candidates: TaskSurfaceRecord[];
  /** A2.10: a roadmap item's work uses the same tab ("item" in its words). */
  noun?: "project" | "item";
  onNewTask: () => void; onOpenTask: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const key = workKey(projectId, project.id);
  const query = useQuery({ queryKey: key, queryFn: () => readProjectWorkAction(projectId, project.id) });
  const data = query.data?.success ? query.data : null;
  const [adding, setAdding] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  const inProject = new Set((data?.work ?? []).map((w) => w.id));
  const choices = candidates.filter((t) => !inProject.has(t.id) && t.itemType !== "project" && t.itemType !== "roadmap_item" && !t.partOfId && t.id !== project.id);

  async function setPart(taskIds: string[], partOfId: string | null, words: string) {
    const r = await setPartOfAction({ projectId, taskIds, partOfId });
    if (!r.success) return void toast.error(r.error);
    await refresh();
    toast(words, { duration: 10_000, action: { label: "Undo", onClick: () => void setPartOfAction({ projectId, taskIds, partOfId: partOfId ? null : project.id }).then(refresh) } });
  }

  return (
    <div className="space-y-4 px-6 py-5 max-md:px-4" data-testid="project-work">
      {data ? <Completion {...data.completion} /> : <div aria-hidden="true" className="nb-skeleton h-2 rounded" />}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load the work · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}
      <ul className="space-y-1">
        {(data?.work ?? []).map((w) => (
          <li key={w.id} className="group flex min-h-11 items-center gap-2 rounded-[5px] border border-border bg-card px-2">
            <button type="button" onClick={() => onOpenTask(w.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              {w.taskNumber && data?.projectKey ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatTaskId(data.projectKey, w.taskNumber)}</span> : null}
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", w.status === "done" && "text-muted-foreground line-through")}>{w.title}</span>
            </button>
            {w.dueDate ? <span className="font-mono text-[11px] text-muted-foreground">{formatTaskDueDate(w.dueDate)}</span> : null}
            <TaskStatusBadge status={w.status as never} />
            {canEdit ? (
              <button type="button" aria-label={`Remove ${w.title} from the ${noun}`} onClick={() => void setPart([w.id], null, `Removed from the ${noun}`)}
                className="nb-touch-target inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"><X className="size-3.5" /></button>
            ) : null}
          </li>
        ))}
        {data && !data.work.length ? <li className="py-2 text-[13px] text-muted-foreground">No work in this {noun} yet</li> : null}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onNewTask} className="inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-xs font-medium hover:bg-muted"><Plus className="size-3.5" aria-hidden="true" />New task</button>
          {choices.length ? (
            <select aria-label="Add an existing task" value={adding} className={cn(selectClassName(), "h-[34px] w-auto max-w-xs text-xs")}
              onChange={(e) => { setAdding(""); if (e.target.value) void setPart([e.target.value], project.id, `Added to the ${noun}`); }}>
              <option value="">Add existing…</option>
              {choices.map((t) => <option key={t.id} value={t.id}>{t.taskNumber && t.projectKey ? `${formatTaskId(t.projectKey, t.taskNumber)} · ` : ""}{t.title}</option>)}
            </select>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const GROUPS = [
  { id: "todo", name: "To do", stages: ["not_started"] },
  { id: "doing", name: "In progress", stages: ["planning", "in_progress", "paused"] },
  { id: "done", name: "Complete", stages: ["completed", "cancelled"] },
];
const day = (iso: string | null) => (iso ? formatTaskDueDate(iso) : "—");
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Row = { id: string; taskNumber: number | null; title: string; stage: string | null; status: string; priority: string; assigneeId: string | null;
  startDate: string | null; dueDate: string | null; completion: { percent: number; source: string } };

/**
 * Report 38.5 W6 and S4 (plan A1.5): Projects' Active and All tables. Active is the In progress group (Planning, In
 * progress) with cells edited in place; All is every project grouped by stage or Assigned to with a totals row.
 * Viewers see plain text.
 */
export function ProjectsTable({ projectId, mode, canEdit, canPlanSprints, members, onOpen, onNew }: {
  projectId: string; mode: "active" | "all"; canEdit: boolean; canPlanSprints: boolean; members: Array<{ id: string; label: string }>;
  onOpen: (id: string) => void; onNew: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "projects"], queryFn: () => readProjectsAction(projectId) });
  const data = query.data?.success ? query.data : null;
  const [groupBy, setGroupBy] = useState<"stage" | "assignee">("stage");
  const today = localDayKey();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  const all = (data?.projects ?? []) as Row[];
  const rows = mode === "active" ? all.filter((p) => p.stage === "planning" || p.stage === "in_progress") : all;
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.label ?? "Someone" : "Unassigned");
  const blockers = (id: string) => (data?.deps ?? []).filter((d) => d.taskId === id).map((d) => all.find((p) => p.id === d.blockedById)?.title).filter(Boolean).join(", ");
  const groups = mode === "active" ? [{ id: "active", name: "", list: rows }]
    : groupBy === "stage" ? GROUPS.map((g) => ({ id: g.id, name: g.name, list: rows.filter((p) => g.stages.includes(p.stage ?? "not_started")) }))
    : [...new Set(rows.map((p) => p.assigneeId))].map((a) => ({ id: a ?? "none", name: nameOf(a), list: rows.filter((p) => p.assigneeId === a) }));
  const average = rows.length ? Math.round(rows.reduce((n, p) => n + p.completion.percent, 0) / rows.length) : 0;

  async function run(r: Promise<{ success: boolean; error?: string }>) {
    const result = await r;
    await refresh();
    if (!result.success) toast.error(result.error ?? "Couldn’t change the dates");
  }
  const cell = "px-2 py-1.5 align-middle";
  const input = "h-7 rounded-[4px] border border-border bg-background px-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section aria-label={mode === "active" ? "Active projects" : "All projects"} className="space-y-3" data-testid={`projects-${mode}`}>
      {mode === "all" ? (
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">Group by
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "stage" | "assignee")} className={cn(input, "w-auto")}>
            <option value="stage">Stage</option><option value="assignee">Assigned to</option>
          </select>
        </label>
      ) : null}
      {query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-24 rounded-[8px]" /> : null}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load projects · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}
      {data && !rows.length ? (
        <div className="nb-empty-state rounded-[8px] py-12" role="status">
          <h3 className="nb-empty-state-title">{mode === "active" ? "Nothing in progress" : "No projects yet"}</h3>
          <p className="nb-empty-state-desc">{mode === "active" ? "Projects in Planning or In progress show here." : "A project groups tasks with a start and an end."}</p>
          {canEdit && mode === "all" ? <button type="button" onClick={onNew} className="nb-ui-label mt-3 inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 hover:bg-muted"><Plus className="size-3.5" aria-hidden="true" />New project</button> : null}
        </div>
      ) : null}
      {data && rows.length ? (
        <div className="overflow-x-auto rounded-[8px] border border-border bg-card">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr><th className={cell}>Project</th><th className={cell}>Stage</th><th className={cell}>Assigned to</th><th className={cell}>Dates</th><th className={cell}>Priority</th><th className={cell}>Completion</th><th className={cell}>Blocked by</th></tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.id} role={mode === "all" ? "group" : undefined} aria-label={mode === "all" ? `${g.name}, ${g.list.length}` : undefined}>
                {mode === "all" ? <tr className="border-t border-border bg-muted/40"><th colSpan={7} className="px-2 py-1 text-left text-[12px] font-semibold">{g.name} <span className="font-mono font-normal text-muted-foreground">{g.list.length}</span></th></tr> : null}
                {g.list.map((p) => {
                  const due = taskDueDateKey(p.dueDate);
                  const ended = due && due < today && p.stage !== "completed" && p.stage !== "cancelled" ? daysBetween(due, today) : 0;
                  return (
                    <tr key={p.id} className="border-t border-border/60">
                      <td className={cell}>
                        <button type="button" onClick={() => onOpen(p.id)} className="flex min-w-0 items-center gap-1.5 text-left hover:underline">
                          <FolderKanban aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                          {p.taskNumber && data.projectKey ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatTaskId(data.projectKey, p.taskNumber)}</span> : null}
                          <span className="truncate font-medium">{p.title}</span>
                        </button>
                      </td>
                      <td className={cell}>
                        {canEdit ? <TaskStageControl projectId={projectId} task={{ id: p.id, itemType: "project", stage: p.stage, status: p.status }} canEdit canPlanSprints={canPlanSprints} sprints={[]} compact onMoved={() => void refresh()} />
                          : <span className="text-[12px] text-muted-foreground">{stageLabel(p.stage)}</span>}
                      </td>
                      <td className={cell}>
                        {canEdit ? (
                          <select aria-label={`Assigned to for ${p.title}`} value={p.assigneeId ?? ""} className={input} onChange={(e) => void run(assignTaskAction(p.id, e.target.value || null, projectId))}>
                            <option value="">Unassigned</option>
                            {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        ) : <span className="text-[12px]">{nameOf(p.assigneeId)}</span>}
                      </td>
                      <td className={cell}>
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          {canEdit ? <>
                            <input type="date" aria-label={`Start of ${p.title}`} value={taskDueDateKey(p.startDate) ?? ""} className={input} onChange={(e) => void run(setTaskDatesAction({ projectId, taskId: p.id, startDate: e.target.value ? dueOn(e.target.value) : null }))} />
                            <span aria-hidden="true">→</span>
                            <input type="date" aria-label={`End of ${p.title}`} value={due ?? ""} className={input} onChange={(e) => void run(setTaskDatesAction({ projectId, taskId: p.id, dueDate: e.target.value ? dueOn(e.target.value) : null }))} />
                          </> : <span>{day(p.startDate)} → {day(p.dueDate)}</span>}
                          {ended ? <span className="ml-1 whitespace-nowrap rounded-[3px] border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">Ended {ended} {ended === 1 ? "day" : "days"} ago</span> : null}
                          {p.stage === "paused" ? <span className="ml-1 rounded-[3px] border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Paused</span> : null}
                        </div>
                      </td>
                      <td className={cell}>
                        {canEdit ? (
                          <select aria-label={`Priority for ${p.title}`} value={p.priority} className={input} onChange={(e) => void run(updateTaskFieldAction(p.id, "priority", e.target.value, projectId))}>
                            {PRIORITIES.map((v) => <option key={v} value={v}>{v[0]!.toUpperCase() + v.slice(1)}</option>)}
                          </select>
                        ) : <span className="text-[12px] capitalize">{p.priority}</span>}
                      </td>
                      <td className={cn(cell, "w-36")}><Completion {...p.completion} /></td>
                      <td className={cn(cell, "text-[12px] text-muted-foreground")}>{blockers(p.id) || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            {mode === "all" ? (
              <tfoot className="border-t border-border bg-muted/40 font-mono text-[11px] text-muted-foreground">
                <tr><td className={cell} colSpan={5}>{rows.length} {rows.length === 1 ? "project" : "projects"}</td><td className={cell} colSpan={2}>Average {average}%</td></tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}
    </section>
  );
}
