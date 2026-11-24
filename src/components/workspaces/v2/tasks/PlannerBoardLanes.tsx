"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderKanban, FolderPlus } from "@/components/ui/icons";
import { useState } from "react";

import { groupIntoProjectAction, moveTaskToWorkflowColumnAction, readProjectsAction, setPartOfAction } from "@/app/actions/task";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { TaskCard } from "@/components/workspaces/v2/tasks/TaskCard";
import { feedbackError, toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { getTaskWorkflowColumnId } from "@/lib/workspaces/task-drag-preview";
import type { TaskSurfaceRecord } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.5 W7 and W3.4 (plan A1.6): the board grouped by project. One swimlane per open project plus No project;
 * dropping a card in another lane changes its Part of, in another column its status. Every move also has a menu
 * (Move to project, Move to column). No project offers Group into a project.
 */
type Column = { id: string; title?: string; name?: string; status: string };
type Lane = { id: string | null; title: string };

export function PlannerBoardLanes({ projectId, workflow, tasks, canEdit, onOpenTask }: {
  projectId: string; workflow: Column[]; tasks: TaskSurfaceRecord[]; canEdit: boolean; onOpenTask: (task: TaskSurfaceRecord) => void;
}) {
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "projects"], queryFn: () => readProjectsAction(projectId) });
  const open = (projects.data?.success ? projects.data.projects : []).filter((p) => p.stage !== "completed" && p.stage !== "cancelled");
  const [over, setOver] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [grouping, setGrouping] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });

  const lanes: Lane[] = [
    ...open.map((p) => ({ id: p.id, title: p.title })),
    // Work Part of a completed project still shows under it until it moves.
    ...[...new Map(tasks.filter((t) => t.partOf && !open.some((p) => p.id === t.partOf!.id)).map((t) => [t.partOf!.id, t.partOf!.title])).entries()].map(([id, title]) => ({ id, title })),
    { id: null, title: "No project" },
  ];
  const laneOf = (t: TaskSurfaceRecord) => t.partOf?.id ?? null;
  const columnOf = (t: TaskSurfaceRecord) => getTaskWorkflowColumnId(t as never, workflow as never);
  const colName = (c: Column) => c.title ?? c.name ?? "Column";

  async function move(task: TaskSurfaceRecord, lane: string | null, columnId: string | null) {
    // The column first: it checks the card hasn't changed since it was read, and Part of would change it (live check).
    if (columnId && columnId !== columnOf(task)) {
      const r = await moveTaskToWorkflowColumnAction(task.id, projectId, columnId, undefined, task.updatedAt ?? null);
      if (!r.success) { await refresh(); return void toast.error(feedbackError(`Couldn’t move task: ${r.error}`, "Couldn’t move task")); }
    }
    if (lane !== laneOf(task)) {
      const before = laneOf(task);
      const r = await setPartOfAction({ projectId, taskIds: [task.id], partOfId: lane });
      if (!r.success) return void toast.error(r.error);
      toast(lane ? `Part of ${lanes.find((l) => l.id === lane)?.title}` : "Out of its project", { duration: 10_000,
        action: { label: "Undo", onClick: () => void setPartOfAction({ projectId, taskIds: [task.id], partOfId: before }).then(refresh) } });
    }
    await refresh();
  }

  const noProject = tasks.filter((t) => !laneOf(t));
  const select = "h-7 w-full rounded-[5px] border border-border bg-background px-1.5 text-[12px] text-muted-foreground md:sr-only md:focus:not-sr-only";
  return (
    <section aria-label="Board by project" className="space-y-3" data-testid="board-lanes">
      {lanes.map((lane) => {
        const key = lane.id ?? "none";
        const list = tasks.filter((t) => laneOf(t) === lane.id);
        const isFolded = folded.has(key);
        return (
          <div key={key} role="group" aria-label={`${lane.title}, ${list.length}`} className="rounded-[8px] border border-border bg-card/50" data-testid="board-lane">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button type="button" aria-expanded={!isFolded} aria-label={`${isFolded ? "Show" : "Hide"} ${lane.title}`} onClick={() => setFolded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                className="nb-touch-target inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><ChevronDown className={cn("size-3.5 transition-transform duration-[180ms]", isFolded && "-rotate-90")} /></button>
              {lane.id ? <FolderKanban aria-hidden="true" className="size-3.5 text-muted-foreground" /> : null}
              <h3 className="min-w-0 truncate text-[13px] font-semibold text-foreground">{lane.title}</h3>
              <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
              {!lane.id && canEdit && noProject.length ? (
                <button type="button" onClick={() => setGrouping(true)} className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-border bg-card px-2 text-xs hover:bg-muted">
                  <FolderPlus className="size-3.5" aria-hidden="true" />Group into a project
                </button>
              ) : null}
            </div>
            {isFolded ? null : (
              <div tabIndex={0} aria-label={`${lane.title} columns`} className="grid gap-2 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:grid-flow-col max-md:auto-cols-[minmax(240px,1fr)] max-md:overflow-x-auto md:[grid-template-columns:var(--cols)]" style={{ "--cols": `repeat(${workflow.length}, minmax(0, 1fr))` } as React.CSSProperties}>
                {workflow.map((col) => {
                  const cell = `${key}:${col.id}`;
                  const cards = list.filter((t) => columnOf(t) === col.id);
                  return (
                    <div key={col.id} aria-label={`${lane.title}, ${colName(col)}`} data-testid="board-lane-cell"
                      onDragOver={(e) => { if (!canEdit) return; e.preventDefault(); setOver(cell); }} onDragLeave={() => setOver((o) => (o === cell ? null : o))}
                      onDrop={(e) => { e.preventDefault(); setOver(null); const t = tasks.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (t) void move(t, lane.id, col.id); }}
                      data-drop-target={canEdit || undefined} className={cn("min-h-16 space-y-2 rounded-[6px] p-1 transition-colors duration-[180ms]", over === cell && "nb-drop-over")}>
                      <span className="block px-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{colName(col)}</span>
                      {cards.map((t) => (
                        <div key={t.id} draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData("text/plain", t.id); e.dataTransfer.effectAllowed = "move"; }} className={cn(canEdit && "cursor-grab")}>
                          <TaskCard task={t} onClick={() => onOpenTask(t)} />
                          {canEdit ? (
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <select aria-label={`Move ${t.title} to project…`} value="" className={select}
                                onChange={(e) => { const v = e.target.value; if (v) void move(t, v === "none" ? null : v, col.id); }}>
                                <option value="">Project…</option>
                                {lanes.filter((l) => l.id !== lane.id).map((l) => <option key={l.id ?? "none"} value={l.id ?? "none"}>{l.title}</option>)}
                              </select>
                              <select aria-label={`Move ${t.title} to column…`} value="" className={select}
                                onChange={(e) => { const v = e.target.value; if (v) void move(t, lane.id, v); }}>
                                <option value="">Column…</option>
                                {workflow.filter((c) => c.id !== col.id).map((c) => <option key={c.id} value={c.id}>{colName(c)}</option>)}
                              </select>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {grouping ? <GroupIntoProject projectId={projectId} tasks={noProject} onClose={() => setGrouping(false)} onDone={() => { setGrouping(false); void refresh(); }} /> : null}
    </section>
  );
}

/** W3.4: pick tasks with no project, name a new project; it's made Not started and the tasks become Part of it. */
function GroupIntoProject({ projectId, tasks, onClose, onDone }: { projectId: string; tasks: TaskSurfaceRecord[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    const r = await groupIntoProjectAction({ projectId, taskIds: [...picked], name });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(`Grouped ${picked.size} into ${name.trim()}`);
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="group-into-project-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold text-foreground">Group into a project</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">A new project, Not started, with the tasks you pick as its work.</DialogDescription>
        </div>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto px-6 py-4">
          <label className="block space-y-1 text-[13px] font-medium">Project name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClassName(false)} placeholder="e.g., Website relaunch" />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-[13px] font-medium">Tasks</legend>
            {tasks.map((t) => (
              <label key={t.id} className="flex min-h-9 items-center gap-2 text-[13px]">
                <input type="checkbox" checked={picked.has(t.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} className="size-4 accent-[var(--primary)]" />
                <span className="truncate">{t.title}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !name.trim() || !picked.size} onClick={() => void create()}>Group {picked.size || ""}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
