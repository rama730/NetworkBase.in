"use client";
import { TabMarker } from "@/components/ui/TabMarker";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createElement, useMemo, useState, type ReactNode } from "react";

import { readCalendarAction } from "@/app/actions/workspace";
import { setTaskDatesAction, updateTaskFieldAction } from "@/app/actions/task";
import { workflowIcon } from "@/components/workspaces/workflows/workflow-icons";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { agendaDays, calendarCells, daysBetween, dueOn, localDayKey, mondayOf, monthOf, monthRange, shiftMonth, weekCells, type CalendarDay } from "@/lib/workflows/planner";
import { matchesFilters, setCount, type TaskFilters } from "@/lib/workspaces/task-filters";
import { taskDueDateKey } from "@/lib/workspaces/task-presentation";

type Item = { id: string; taskNumber: number | null; title: string; status: string; dueDate: string | null; startDate?: string | null; itemType?: string; stage?: string | null; assigneeId: string | null; priority: string; sprintId: string | null };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthTitle = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const dayTitle = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Report 38.5 T1 W8, S10 (plan A1.1): every workspace's Calendar. Items sit on their due day (a calendar day); dragging
 * one to another day moves its due date with Undo; + on a day opens New with that date; No date holds the rest. Phones
 * get an agenda (W10). Opening an item is the keyboard and menu path for every drag.
 */
export function TasksCalendar({ projectId, scope, filters, viewerId, canEdit, onOpenTask, onNewOnDay, onlyType, rail, onMoveItem }: {
  projectId: string; scope: string; filters: TaskFilters; viewerId: string | null; canEdit: boolean;
  onOpenTask: (item: Item) => void; onNewOnDay: (key: string) => void;
  /** A2.7 (Content's calendar, report 38.8 S3): one type only, its own rail in place of No date, its own move. */
  onlyType?: string; rail?: ReactNode; onMoveItem?: (item: { id: string; stage?: string | null }, day: string | null) => boolean;
}) {
  const queryClient = useQueryClient();
  const phone = useMediaQuery("(max-width: 639px)");
  const today = localDayKey();
  const [mode, setMode] = useState<"month" | "week" | "agenda">("month");
  const [month, setMonth] = useState(monthOf(today));
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [trayOpen, setTrayOpen] = useState(true);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const view = phone && mode === "month" ? "agenda" : mode;
  const range = view === "week" ? { from: weekStart, to: addDays(weekStart, 6) } : monthRange(month);
  const key = [...queryKeys.project.detail.tasksRoot(projectId), "calendar", range.from, range.to, scope];
  const query = useQuery({ queryKey: key, queryFn: () => readCalendarAction(projectId, { ...range, scope }), staleTime: 15_000 });
  const data = query.data?.success ? query.data : null;
  const narrow = (list: Item[]) => (setCount(filters) ? list.filter((i) => matchesFilters(i, filters, viewerId)) : list).filter((i) => !onlyType || i.itemType === onlyType);
  const items = useMemo(() => narrow((data?.items ?? []) as Item[]), [data, filters, viewerId]);
  const noDate = useMemo(() => narrow((data?.noDate ?? []) as Item[]), [data, filters, viewerId]);
  const editable = canEdit && Boolean(data?.canEdit);

  async function moveTo(itemId: string, day: string | null) {
    const item = [...(data?.items ?? []), ...(data?.noDate ?? [])].find((i) => i.id === itemId) as Item | undefined;
    if (onMoveItem && onMoveItem(item ?? { id: itemId }, day)) return;
    if (!item || taskDueDateKey(item.dueDate) === day) return;
    const set = async (value: string | null) => {
      const r = await updateTaskFieldAction(item.id, "dueDate", value, projectId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
      return r;
    };
    // Call 8 (A1.4): a spanning item keeps its length; its start moves with the due day.
    const from = taskDueDateKey(item.startDate);
    const due = taskDueDateKey(item.dueDate);
    if (day && from && due) {
      const dates = async (startDate: string, dueDate: string) => {
        const r = await setTaskDatesAction({ projectId, taskId: item.id, startDate, dueDate });
        await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
        return r;
      };
      const r = await dates(dueOn(addDays(from, daysBetween(due, day))), dueOn(day));
      if (!r.success) return void toast.error(r.error ?? "Couldn’t move it.");
      return void toast(`Due ${dayTitle(day)}`, { duration: 10_000, action: { label: "Undo", onClick: () => void dates(item.startDate!, item.dueDate!) } });
    }
    const result = await set(day ? dueOn(day) : null);
    if (!result.success) return void toast.error(result.error ?? "Couldn’t move it.");
    toast(day ? `Due ${dayTitle(day)}` : "No date", { duration: 10_000, action: { label: "Undo", onClick: () => void set(item.dueDate) } });
  }

  // A spanning item shows on each of its days; days before its due day say it carries on.
  const chip = (item: Item, day?: string) => (
    <button key={item.id} aria-label={day && item.dueDate && taskDueDateKey(item.dueDate) !== day ? `${item.title}, continues until ${dayTitle(taskDueDateKey(item.dueDate)!)}` : undefined} type="button" draggable={editable} onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => onOpenTask(item)} data-testid="calendar-item"
      className={cn("flex w-full min-w-0 items-center gap-1 rounded-[3px] border border-border bg-card px-1.5 py-0.5 text-left text-[11px] hover:border-foreground/30", editable && "cursor-grab", item.status === "done" && "text-muted-foreground line-through")}>
      {item.itemType && WORKFLOW_TYPES[item.itemType] ? createElement(workflowIcon(WORKFLOW_TYPES[item.itemType]!.icon), { "aria-label": WORKFLOW_TYPES[item.itemType]!.label, className: "size-3 shrink-0 text-muted-foreground" }) : null}
      {item.taskNumber && data?.projectKey ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatTaskId(data.projectKey, item.taskNumber)}</span> : null}
      <span className="min-w-0 truncate">{item.title}</span>
    </button>
  );
  const drop = (day: string) => ({
    onDragOver: (e: React.DragEvent) => { if (!editable) return; e.preventDefault(); setDragOver(day); },
    onDragLeave: () => setDragOver((d) => (d === day ? null : d)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) void moveTo(id, day); },
  });
  const cell = (d: CalendarDay<Item>, tall: boolean) => (
    <div key={d.key} {...drop(d.key)} data-day={d.key} aria-label={dayTitle(d.key)} role="group"
      className={cn("group relative flex min-w-0 flex-col gap-1 border-b border-r border-border p-1.5", tall ? "min-h-48" : "min-h-24", d.weekend && "bg-muted/30", !d.inMonth && "bg-muted/50 text-muted-foreground", dragOver === d.key && "bg-primary/10")}>
      <div className="flex items-center justify-between">
        <span className={cn("font-mono text-[11px]", d.isToday && "inline-flex size-5 items-center justify-center rounded-[4px] bg-primary font-semibold text-primary-foreground")} aria-current={d.isToday ? "date" : undefined}>{d.day}</span>
        {editable ? (
          <button type="button" aria-label={`New on ${dayTitle(d.key)}`} onClick={() => onNewOnDay(d.key)} className="nb-touch-target inline-flex size-5 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            <Plus className="size-3" />
          </button>
        ) : null}
      </div>
      {d.items.map((i) => chip(i, d.key))}
      {d.more ? <button type="button" onClick={() => { setWeekStart(mondayOf(d.key)); setMode("week"); }} className="text-left text-[11px] font-medium text-primary hover:underline">+{d.more} more</button> : null}
    </div>
  );

  const step = (n: number) => (view === "week" ? setWeekStart(addDays(weekStart, 7 * n)) : setMonth(shiftMonth(month, n)));
  const title = view === "week" ? `${dayTitle(weekStart)} – ${dayTitle(addDays(weekStart, 6))}` : monthTitle(month);
  const toggle = (m: "month" | "week" | "agenda", label: string) => (
    <button type="button" aria-pressed={view === m} onClick={() => setMode(m === "agenda" ? "month" : m)}>{label}</button>
  );

  return (
    <section aria-label="Calendar" className="flex flex-col gap-3" data-testid="tasks-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Previous" onClick={() => step(-1)} className="nb-touch-target inline-flex size-[30px] items-center justify-center rounded-[5px] border border-border bg-card hover:bg-muted"><ChevronLeft className="size-4" /></button>
        <h3 className="min-w-40 text-center text-[14px] font-semibold text-foreground" aria-live="polite">{title}</h3>
        <button type="button" aria-label="Next" onClick={() => step(1)} className="nb-touch-target inline-flex size-[30px] items-center justify-center rounded-[5px] border border-border bg-card hover:bg-muted"><ChevronRight className="size-4" /></button>
        <button type="button" onClick={() => { setMonth(monthOf(today)); setWeekStart(mondayOf(today)); }} className="nb-touch-target h-[30px] rounded-[5px] border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted">Today</button>
        <div className="nb-seg ml-auto" data-size="sm" role="group" aria-label="Calendar view">
          {phone ? <>{toggle("agenda", "Agenda")}{toggle("week", "Week")}</> : <>{toggle("month", "Month")}{toggle("week", "Week")}</>}
          <TabMarker />
        </div>
      </div>
      {query.isError || (query.data && !query.data.success) ? (
        <p className="text-[13px] text-muted-foreground">Couldn’t load the calendar · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p>
      ) : (
        <div className="flex min-w-0 gap-3 max-lg:flex-col">
          <div className="min-w-0 flex-1">
            {view === "agenda" ? (
              <ol className="space-y-3" aria-label="Agenda">
                {agendaDays(range.from, range.to, items).filter((d) => monthOf(d.key) === month).map((d) => (
                  <li key={d.key} {...drop(d.key)}>
                    <h4 className={cn("mb-1 font-mono text-[11px] uppercase tracking-wide", d.key === today ? "text-primary" : "text-muted-foreground")}>{dayTitle(d.key)}</h4>
                    <div className="space-y-1">{d.items.map((i) => chip(i, d.key))}</div>
                  </li>
                ))}
                {!query.isLoading && !agendaDays(range.from, range.to, items).some((d) => monthOf(d.key) === month) ? <li className="text-[13px] text-muted-foreground">Nothing due in {monthTitle(month)}</li> : null}
              </ol>
            ) : (
              <div className="overflow-x-auto rounded-[8px] border-l border-t border-border bg-card">
                <div className="grid min-w-[640px] grid-cols-7">
                  {WEEKDAYS.map((w) => <div key={w} className="border-b border-r border-border px-1.5 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{w}</div>)}
                  {query.isLoading ? Array.from({ length: 35 }, (_, i) => <div key={i} aria-hidden="true" className="min-h-24 border-b border-r border-border p-1.5"><div className="nb-skeleton h-3 w-6 rounded" /></div>)
                    : view === "week" ? weekCells(weekStart, items, today).map((d) => cell(d, true))
                    : calendarCells(month, items, today).flat().map((d) => cell(d, false))}
                </div>
              </div>
            )}
          </div>
          {rail ?? <aside aria-label="No date" className="w-full shrink-0 lg:w-56" {...drop("")}
            onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) void moveTo(id, null); }}>
            <button type="button" aria-expanded={trayOpen} onClick={() => setTrayOpen(!trayOpen)} className="flex w-full items-center gap-1 py-1 text-left text-[12px] font-medium text-foreground">
              <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform duration-[180ms]", !trayOpen && "-rotate-90")} />
              No date <span className="font-mono text-[11px] text-muted-foreground">{data?.noDateCount ?? 0}</span>
            </button>
            {trayOpen ? <div className="mt-1 space-y-1">{noDate.map((i) => chip(i))}{!noDate.length && !query.isLoading ? <p className="text-[12px] text-muted-foreground">Everything here has a date</p> : null}</div> : null}
          </aside>}
        </div>
      )}
    </section>
  );
}
