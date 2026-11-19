"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";

import { completeProjectAction, readProjectWorkAction, setTaskStageAction } from "@/app/actions/task";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { rememberedTick, showsIn, stageMenu } from "@/lib/workflows/display";
import { isOnBoard, stageMove } from "@/lib/workflows/rules";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";

type Moved = { stage: string; status: string; onBoard: boolean; sprintId: string | null };
const tickKey = (projectId: string) => `nb:join-board-tick:${projectId}`;
const readTick = (projectId: string) => { try { return rememberedTick(window.localStorage.getItem(tickKey(projectId))); } catch { return true; } };
const saveTick = (projectId: string, tick: boolean) => { try { window.localStorage.setItem(tickKey(projectId), JSON.stringify({ tick, at: Date.now() })); } catch { /* storage off: ticked next time */ } };

/**
 * Report 38.2 F1 S7 and S4: a typed item's page says where it shows and moves between stages. A move onto the board asks
 * which sprint (ticked: the running one, remembered 24 hours); members' items go to the Backlog (decision 146).
 */
export function TaskStageControl({ projectId, task, canEdit, canPlanSprints, sprints, onMoved }: {
  projectId: string;
  task: { id: string; itemType?: string; stage?: string | null; status: string; sprintId?: string | null };
  canEdit: boolean;
  canPlanSprints: boolean;
  sprints: Array<{ id: string; name: string; status: string }>;
  onMoved: (moved: Moved) => void;
}) {
  const queryClient = useQueryClient();
  const [joining, setJoining] = useState<string | null>(null);
  const [tick, setTick] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openWork, setOpenWork] = useState<number | null>(null);
  const type = task.itemType ? WORKFLOW_TYPES[task.itemType] : null;
  if (!type || !type.stages.length) return null;
  const running = sprints.find((s) => s.status === "active") ?? null;
  const where = showsIn(task.itemType, task.stage, task.status);
  const current = type.stages.find((s) => s.key === task.stage);

  async function move(stage: string, sprintId: string | null) {
    setBusy(true);
    const result = await setTaskStageAction({ taskId: task.id, projectId, stage, ...(sprintId ? { sprintId } : { toBacklog: true }) });
    setBusy(false);
    if (!result.success) return void toast.error(result.error);
    const onBoard = isOnBoard(task.itemType!, stage);
    const joins = stageMove(task.itemType!, task.stage ?? null, stage).joins;
    onMoved({ stage, status: result.status, onBoard, sprintId: !onBoard ? null : joins ? sprintId : task.sprintId ?? null });
    setJoining(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.sprintDetailRoot(projectId) }),
    ]);
    toast(`Moved to ${type!.stages.find((s) => s.key === stage)?.label ?? stage}`);
  }

  async function completeProject(openTasks: "leave" | "backlog") {
    setBusy(true);
    const result = await completeProjectAction({ projectId, projectTaskId: task.id, openTasks });
    setBusy(false);
    setOpenWork(null);
    if (!result.success) return void toast.error(result.error);
    onMoved({ stage: "completed", status: "done", onBoard: false, sprintId: null });
    await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
    toast(openTasks === "backlog" ? "Completed · open work moved to the Backlog" : "Completed");
  }

  async function pick(stage: string) {
    if (stage === task.stage) return;
    // Report 38.5 W5.3: completing a project with open work asks what happens to it.
    if (task.itemType === "project" && stage === "completed") {
      const work = await readProjectWorkAction(projectId, task.id);
      const open = work.success ? work.work.filter((w) => w.status !== "done").length : 0;
      if (open) return setOpenWork(open);
      return void completeProject("leave");
    }
    if (stageMove(task.itemType!, task.stage ?? null, stage).joins) {
      setTick(readTick(projectId));
      return setJoining(stage);
    }
    void move(stage, null);
  }

  const joinLabel = joining ? type.stages.find((s) => s.key === joining)?.label : "";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground" data-testid="task-stage-control">
      {where.length ? <span>Shows in: {where.map((w, i) => <span key={w.tab}>{i ? " / " : ""}<span className="font-medium text-foreground">{w.label}</span></span>)}</span> : null}
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={busy} className="nb-touch-target inline-flex h-7 items-center gap-1 rounded-[5px] border border-border bg-card px-2 text-[12px] font-medium text-foreground hover:bg-muted">
              Stage: {current?.label ?? "—"} <ChevronDown aria-hidden="true" className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[200px]">
            {stageMenu(task.itemType!).map((group, gi) => (
              <div key={group.label}>
                {gi ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</DropdownMenuLabel>
                {group.stages.map((s) => (
                  <DropdownMenuItem key={s.key} onSelect={() => void pick(s.key)}>
                    <Check aria-hidden="true" className={s.key === task.stage ? "size-4" : "size-4 opacity-0"} />{s.label}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Dialog open={openWork !== null} onOpenChange={(open) => { if (!open && !busy) setOpenWork(null); }}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="complete-project-dialog">
          <div className="border-b border-border px-6 py-4">
            <DialogTitle className="text-base font-semibold text-foreground">{openWork} {openWork === 1 ? "task is" : "tasks are"} still open</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">The project is completed either way.</DialogDescription>
          </div>
          <div className={FORM_FOOTER_CLASS}>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void completeProject("leave")}>Leave them</button>
            {canPlanSprints ? <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void completeProject("backlog")}>Move them to the Backlog</button> : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={joining !== null} onOpenChange={(open) => { if (!open && !busy) setJoining(null); }}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="join-board-sheet">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <div className="space-y-0.5">
              <DialogTitle className="text-base font-semibold text-foreground">{type.label} joins Tasks at {joinLabel}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">It goes on the board, in the column for its status.</DialogDescription>
            </div>
            <button type="button" aria-label="Close" onClick={() => setJoining(null)} disabled={busy} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
          </div>
          <div className="px-6 py-5 text-[13px]">
            {canPlanSprints && running ? (
              <label className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="nb-check" checked={tick} onChange={(e) => setTick(e.target.checked)} />
                Add to {running.name}
              </label>
            ) : (
              <p className="text-muted-foreground">Goes to the Backlog{canPlanSprints ? "" : " · owners and admins plan sprints"}</p>
            )}
          </div>
          <div className={FORM_FOOTER_CLASS}>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setJoining(null)} disabled={busy}>Cancel</button>
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => {
              const into = canPlanSprints && running && tick ? running.id : null;
              if (canPlanSprints && running) saveTick(projectId, tick);
              void move(joining!, into);
            }}>{busy ? "Moving…" : "Move"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

