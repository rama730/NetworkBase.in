"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarClock, ChevronDown, Flame, MoreHorizontal, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";

import { assignTaskAction, updateTaskFieldAction } from "@/app/actions/task";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName } from "@/components/workspaces/v2/tasks/form-parts";
import TaskPriorityBadge from "@/components/workspaces/v2/tasks/badges/TaskPriorityBadge";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { dueOn, localDayKey, MATRIX_BOXES, matrixBox, matrixMove, matrixOrder, pushedPast, urgentChoices, type MatrixBox } from "@/lib/workflows/planner";
import { formatTaskDueDate, isTaskOverdue, taskDueDateKey, type TaskSurfaceRecord } from "@/lib/workspaces/task-presentation";

const ICON = { do: Flame, schedule: CalendarClock, delegate: UserPlus, drop: Archive };
const EMPTY = { do: "Nothing urgent and important. Good.", schedule: "Nothing here.", delegate: "Nothing here.", drop: "Nothing here." };
const RULE = { do: "important and urgent", schedule: "important, not urgent", delegate: "urgent, not important", drop: "neither" };
const SHOW = 50;
type Pending = { task: TaskSurfaceRecord; to: MatrixBox; kind: "pick" | "clear-or-push"; priority: string | null };

/**
 * Report 11.7 and 38.5 W9 (plan A1.2): the personal 2×2. Rows change priority (High / Medium); the urgent column only
 * ever comes from the due date (a picker on the way in, clear or push on the way out). Every move has Undo and a menu
 * path; Delegate assigns and Drop moves to the Backlog for selected cards. Phones get four folding sections.
 */
export function TasksMatrix({ projectId, tasks, members, canEdit, canPlanSprints, hasMore, onOpenTask }: {
  projectId: string; tasks: TaskSurfaceRecord[]; members: Array<{ id: string; label: string }>; canEdit: boolean; canPlanSprints: boolean; hasMore: boolean;
  onOpenTask: (task: TaskSurfaceRecord) => void;
}) {
  const queryClient = useQueryClient();
  const phone = useMediaQuery("(max-width: 639px)");
  const today = localDayKey();
  const [pending, setPending] = useState<Pending | null>(null);
  const [pickDay, setPickDay] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [showAll, setShowAll] = useState<MatrixBox[]>([]);
  const [over, setOver] = useState<MatrixBox | null>(null);
  const boxes = useMemo(() => {
    const by: Record<MatrixBox, TaskSurfaceRecord[]> = { do: [], schedule: [], delegate: [], drop: [] };
    for (const task of tasks) { const box = matrixBox(task, today); if (box) by[box].push(task); }
    return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, matrixOrder(v)])) as Record<MatrixBox, TaskSurfaceRecord[]>;
  }, [tasks, today]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });

  async function apply(task: TaskSurfaceRecord, change: { priority?: string | null; due?: string | null }, words: string) {
    const before = { priority: task.priority, due: task.dueDate ?? null };
    const run = async (c: { priority?: string | null; due?: string | null }) => {
      if (c.priority) { const r = await updateTaskFieldAction(task.id, "priority", c.priority, projectId); if (!r.success) throw new Error(r.error ?? "Couldn’t change it."); }
      if (c.due !== undefined) { const r = await updateTaskFieldAction(task.id, "dueDate", c.due, projectId); if (!r.success) throw new Error(r.error ?? "Couldn’t change it."); }
      await refresh();
    };
    try {
      await run(change);
      toast(words, { duration: 10_000, action: { label: "Undo", onClick: () => void run({ ...(change.priority ? { priority: before.priority } : {}), ...(change.due !== undefined ? { due: before.due } : {}) }) } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn’t change it."); }
  }

  function moveTo(task: TaskSurfaceRecord, to: MatrixBox) {
    const from = matrixBox(task, today);
    if (!from || from === to) return;
    const m = matrixMove(from, to);
    if (m.due) { setPickDay(""); return setPending({ task, to, kind: m.due, priority: m.priority }); }
    void apply(task, { priority: m.priority }, `Moved to ${MATRIX_BOXES.find((b) => b.id === to)!.name}`);
  }
  const finish = (due: string | null) => {
    if (!pending) return;
    const name = MATRIX_BOXES.find((b) => b.id === pending.to)!.name;
    void apply(pending.task, { ...(pending.priority ? { priority: pending.priority } : {}), due }, `Moved to ${name}`);
    setPending(null);
  };

  async function bulk(kind: "assign" | "backlog") {
    const ids = selected;
    for (const id of ids) {
      const r = kind === "assign" ? await assignTaskAction(id, assignee || null, projectId) : await updateTaskFieldAction(id, "sprintId", null, projectId);
      if (!r.success) { toast.error(r.error ?? "Couldn’t change them."); break; }
    }
    setSelected([]); setAssigning(false); await refresh();
    toast(kind === "assign" ? `Assigned ${ids.length}` : `Moved ${ids.length} to the Backlog`);
  }

  const card = (task: TaskSurfaceRecord, box: MatrixBox) => {
    const overdue = isTaskOverdue(task);
    const selectable = canEdit && (box === "delegate" || (box === "drop" && canPlanSprints));
    return (
      <li key={task.id} draggable={canEdit && !phone} onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
        className={cn("group flex min-h-11 items-center gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 transition-colors duration-[180ms] hover:border-foreground/30", canEdit && !phone && "cursor-grab")}>
        {selectable ? <input type="checkbox" className="nb-check" aria-label={`Select ${task.title}`} checked={selected.includes(task.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, task.id] : s.filter((x) => x !== task.id)))} /> : null}
        <button type="button" onClick={() => onOpenTask(task)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {task.taskNumber && task.projectKey ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatTaskId(task.projectKey, task.taskNumber)}</span> : null}
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{task.title}</span>
        </button>
        {taskDueDateKey(task.dueDate)
          ? <span className={cn("shrink-0 font-mono text-[11px]", overdue ? "text-destructive" : "text-muted-foreground")}>{overdue ? "Overdue · " : ""}{formatTaskDueDate(task.dueDate)}</span>
          : task.priority === "urgent" ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">No date</span> : null}
        {task.assignee ? <UserAvatar identity={{ fullName: task.assignee.fullName, avatarUrl: task.assignee.avatarUrl }} size={20} className="size-5" roundedClassName="rounded-[3px]" /> : null}
        <TaskPriorityBadge priority={task.priority} />
        {canEdit ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Move ${task.title}`} aria-keyshortcuts="M" className="nb-touch-target inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Move to box…</DropdownMenuLabel>
              {MATRIX_BOXES.filter((b) => b.id !== box).map((b) => <DropdownMenuItem key={b.id} onSelect={() => moveTo(task, b.id)}>{b.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>
    );
  };

  const boxView = (b: (typeof MATRIX_BOXES)[number]) => {
    const list = boxes[b.id];
    const shown = showAll.includes(b.id) ? list : list.slice(0, SHOW);
    const Icon = ICON[b.id];
    const mine = selected.filter((id) => list.some((t) => t.id === id));
    const header = (
      <>
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold text-foreground">{b.name}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{list.length}{hasMore ? "+" : ""}</span>
      </>
    );
    const action = b.id === "delegate" && canEdit
      ? <button type="button" disabled={!mine.length} onClick={() => setAssigning(true)} className="ml-auto h-[28px] rounded-[5px] border border-border bg-card px-2 text-xs font-medium disabled:opacity-50">Assign…</button>
      : b.id === "drop" && canEdit && canPlanSprints
        ? <button type="button" disabled={!mine.length} onClick={() => void bulk("backlog")} className="ml-auto h-[28px] rounded-[5px] border border-border bg-card px-2 text-xs font-medium disabled:opacity-50">Move to Backlog</button>
        : null;
    const body = (
      <>
        {list.length ? <ul className="space-y-1.5">{shown.map((t) => card(t, b.id))}</ul> : <p className="py-2 text-[13px] text-muted-foreground">{EMPTY[b.id]}</p>}
        {list.length > SHOW && !showAll.includes(b.id) ? <button type="button" onClick={() => setShowAll((s) => [...s, b.id])} className="mt-1 text-xs font-medium text-primary hover:underline">Show all</button> : null}
      </>
    );
    const label = `${b.name}, ${RULE[b.id]}, ${list.length} tasks`;
    if (phone) {
      return (
        <details key={b.id} open={b.id === "do"} className="group rounded-[8px] border border-border bg-card" aria-label={label}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3">{header}<ChevronDown aria-hidden="true" className="ml-auto size-4 text-muted-foreground transition-transform duration-[180ms] group-open:rotate-180" /></summary>
          <div className="space-y-2 px-3 pb-3">{action ? <div className="flex">{action}</div> : null}{body}</div>
        </details>
      );
    }
    return (
      <section key={b.id} role="region" aria-label={label} data-box={b.id}
        onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOver(b.id); } }} onDragLeave={() => setOver((o) => (o === b.id ? null : o))}
        onDrop={(e) => { e.preventDefault(); setOver(null); const t = tasks.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (t) moveTo(t, b.id); }}
        className={cn("min-h-48 rounded-[8px] border border-border bg-card p-3 transition-colors duration-[180ms]", over === b.id && "border-primary bg-primary/5")}>
        <header className="mb-2 flex items-center gap-2">{header}{action}</header>
        {body}
      </section>
    );
  };

  return (
    <div data-testid="tasks-matrix">
      {phone ? (
        <div className="space-y-2">{MATRIX_BOXES.map(boxView)}</div>
      ) : (
        <div className="grid grid-cols-[auto_1fr_1fr] gap-3">
          <div />
          {["URGENT", "NOT URGENT"].map((a, i) => <div key={a}><p className="font-mono text-[11px] tracking-wide text-foreground">{a}</p><p className="text-[11px] text-muted-foreground">{i ? "later or no date" : "due in 3 days or overdue"}</p></div>)}
          {[["IMPORTANT", "High, Urgent", 0], ["NOT IMPORTANT", "Low, Medium", 2]].map(([a, rule, at]) => (
            <div key={a as string} className="contents">
              <div className="w-24 pt-3"><p className="font-mono text-[11px] tracking-wide text-foreground">{a}</p><p className="text-[11px] text-muted-foreground">{rule}</p></div>
              {boxView(MATRIX_BOXES[at as number]!)}{boxView(MATRIX_BOXES[(at as number) + 1]!)}
            </div>
          ))}
        </div>
      )}
      <Dialog open={pending !== null} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="matrix-date-dialog">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <div className="space-y-0.5">
              <DialogTitle className="text-base font-semibold text-foreground">{pending?.kind === "pick" ? "When is it due?" : "Not urgent any more"}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">{pending?.kind === "pick" ? "Urgent comes only from the due date." : "Clear the due date, or push it past the next few days."}</DialogDescription>
            </div>
            <button type="button" aria-label="Close" onClick={() => setPending(null)} className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-6 py-5">
            {pending?.kind === "pick" ? (
              <>
                {urgentChoices(today).map((c) => <button key={c.key} type="button" onClick={() => finish(dueOn(c.key))} className={FORM_SECONDARY_CLASS}>{c.label}</button>)}
                <input type="date" aria-label="Pick a date" value={pickDay} onChange={(e) => setPickDay(e.target.value)} className={cn(inputClassName(false), "h-9 w-auto")} />
              </>
            ) : (
              <>
                <button type="button" onClick={() => finish(null)} className={FORM_SECONDARY_CLASS}>Clear the date</button>
                <button type="button" onClick={() => finish(dueOn(pushedPast(today)))} className={FORM_SECONDARY_CLASS}>Push to {formatTaskDueDate(dueOn(pushedPast(today)))}</button>
              </>
            )}
          </div>
          {pending?.kind === "pick" ? (
            <div className={FORM_FOOTER_CLASS}>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className={FORM_PRIMARY_CLASS} disabled={!pickDay} onClick={() => finish(dueOn(pickDay))}>Set date</button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={assigning} onOpenChange={setAssigning}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS}>
          <div className="border-b border-border px-6 py-4">
            <DialogTitle className="text-base font-semibold text-foreground">Assign {selected.length} {selected.length === 1 ? "task" : "tasks"}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">Delegate: someone else does these.</DialogDescription>
          </div>
          <div className="px-6 py-5">
            <select aria-label="Assigned to" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectClassName()}>
              <option value="">Not assigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className={FORM_FOOTER_CLASS}>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAssigning(false)}>Cancel</button>
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void bulk("assign")}>Assign</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
