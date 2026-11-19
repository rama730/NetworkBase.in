"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, X } from "lucide-react";
import { useState } from "react";

import { readProjectsAction, readProjectWorkAction, setPartOfAction } from "@/app/actions/task";
import TaskStatusBadge from "@/components/workspaces/v2/tasks/badges/TaskStatusBadge";
import { selectClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { formatTaskDueDate, type TaskSurfaceRecord } from "@/lib/workspaces/task-presentation";

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
export function ProjectWork({ projectId, project, canEdit, candidates, onNewTask, onOpenTask }: {
  projectId: string; project: { id: string; title: string }; canEdit: boolean; candidates: TaskSurfaceRecord[];
  onNewTask: () => void; onOpenTask: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const key = workKey(projectId, project.id);
  const query = useQuery({ queryKey: key, queryFn: () => readProjectWorkAction(projectId, project.id) });
  const data = query.data?.success ? query.data : null;
  const [adding, setAdding] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  const inProject = new Set((data?.work ?? []).map((w) => w.id));
  const choices = candidates.filter((t) => !inProject.has(t.id) && t.itemType !== "project" && !t.partOfId && t.id !== project.id);

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
              <button type="button" aria-label={`Remove ${w.title} from the project`} onClick={() => void setPart([w.id], null, "Removed from the project")}
                className="nb-touch-target inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"><X className="size-3.5" /></button>
            ) : null}
          </li>
        ))}
        {data && !data.work.length ? <li className="py-2 text-[13px] text-muted-foreground">No work in this project yet</li> : null}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onNewTask} className="inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-xs font-medium hover:bg-muted"><Plus className="size-3.5" aria-hidden="true" />New task</button>
          {choices.length ? (
            <select aria-label="Add an existing task" value={adding} className={cn(selectClassName(), "h-[34px] w-auto max-w-xs text-xs")}
              onChange={(e) => { setAdding(""); if (e.target.value) void setPart([e.target.value], project.id, "Added to the project"); }}>
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

/**
 * Report 38.5 W1 (plan A1.3): the Projects view, grouped To do · In progress · Complete, with dates and completion.
 * The Timeline, Active and All views follow in A1.4–A1.5.
 */
export function ProjectsList({ projectId, canCreate, onOpen, onNew }: { projectId: string; canCreate: boolean; onOpen: (id: string) => void; onNew: () => void }) {
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "projects"], queryFn: () => readProjectsAction(projectId) });
  const data = query.data?.success ? query.data : null;
  return (
    <section aria-label="Projects" className="space-y-4" data-testid="projects-list">
      {query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-24 rounded-[8px]" /> : null}
      {data && !data.projects.length ? (
        <div className="nb-empty-state rounded-[8px] py-12" role="status">
          <h3 className="nb-empty-state-title">No projects yet</h3>
          <p className="nb-empty-state-desc">A project groups tasks with a start and an end.</p>
          {canCreate ? <button type="button" onClick={onNew} className="nb-ui-label mt-3 inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 hover:bg-muted"><Plus className="size-3.5" aria-hidden="true" />New project</button> : null}
        </div>
      ) : null}
      {data && data.projects.length ? GROUPS.map((g) => {
        const list = data.projects.filter((p) => g.stages.includes(p.stage ?? "not_started"));
        return (
          <div key={g.id} role="group" aria-label={`${g.name}, ${list.length}`}>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-foreground">{g.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{list.length}</span></h3>
            <ul className="space-y-1.5">
              {list.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onOpen(p.id)} className="grid w-full grid-cols-[minmax(0,1fr)_7rem_9rem_8rem] items-center gap-3 rounded-[5px] border border-border bg-card px-3 py-2 text-left hover:border-foreground/30 max-sm:grid-cols-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <FolderKanban aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      {p.taskNumber && data.projectKey ? <span className="font-mono text-[11px] text-muted-foreground">{formatTaskId(data.projectKey, p.taskNumber)}</span> : null}
                      <span className="truncate text-[13px] font-medium text-foreground">{p.title}</span>
                    </span>
                    <span className="text-[12px] text-muted-foreground">{stageLabel(p.stage)}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{day(p.startDate)} → {day(p.dueDate)}</span>
                    <Completion {...p.completion} />
                  </button>
                </li>
              ))}
              {!list.length ? <li className="text-[12px] text-muted-foreground">Nothing here.</li> : null}
            </ul>
          </div>
        );
      }) : null}
    </section>
  );
}
