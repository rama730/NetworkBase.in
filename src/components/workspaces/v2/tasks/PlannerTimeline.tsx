"use client";
import { TabMarker } from "@/components/ui/TabMarker";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FolderKanban, MoreHorizontal } from "@/components/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";

import { readProjectsAction, setBlockedByAction, setTaskDatesAction, shiftDependentsAction } from "@/app/actions/task";
import { createTaskAction } from "@/app/actions/workspace";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GROUPS } from "@/components/workspaces/v2/tasks/PlannerParts";
import { FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { addDayKeys, barGeometry, conflicts, daysBetween, dueOn, localDayKey, timelineRange, ZOOM_DAY_PX, type Zoom } from "@/lib/workflows/planner";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { formatTaskDueDate, taskDueDateKey, type SprintOption } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.5 S3, S6, S7 and W2, W4 (plan A1.4): the Projects Timeline. Stage groups on the left, bars on the right,
 * Today in Clay, arrows for "blocked by". Every drag has a keyboard or menu path: `[` `]` move a bar a day, Shift
 * with them moves its end, the row's ⋯ sets what it waits on.
 */
type Project = { id: string; taskNumber: number | null; title: string; stage: string | null; startDate: string | null; dueDate: string | null; completion: { percent: number } };
type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; delta: number };
const ROW = 36;
const HEAD = 48;
const ZOOMS: Zoom[] = ["week", "month", "quarter"];
const stageLabel = (stage: string | null) => WORKFLOW_TYPES.project!.stages.find((s) => s.key === stage)?.label ?? "Not started";
const short = (key: string) => formatTaskDueDate(dueOn(key));
const remembered = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private window */ } };

export function PlannerTimeline({ projectId, canEdit, sprints, viewerId, onOpen, onMoreDetails }: {
  projectId: string; canEdit: boolean; sprints: SprintOption[]; viewerId: string | null;
  onOpen: (id: string) => void; onMoreDetails: (draft: { title: string; startDate: string; dueDate: string }) => void;
}) {
  const queryClient = useQueryClient();
  const key = [...queryKeys.project.detail.tasksRoot(projectId), "projects"];
  const query = useQuery({ queryKey: key, queryFn: () => readProjectsAction(projectId) });
  const data = query.data?.success ? query.data : null;
  const today = localDayKey();
  const [zoom, setZoomState] = useState<Zoom>("month");
  const [showSprints, setShowSprints] = useState(false);
  useEffect(() => {
    setZoomState(remembered("nb:timeline-zoom", "month") as Zoom);
    setShowSprints(remembered("nb:timeline-sprints", "0") === "1");
  }, []);
  const [anchor, setAnchor] = useState(today);
  const range = useMemo(() => timelineRange(zoom, anchor), [zoom, anchor]);
  const px = ZOOM_DAY_PX[zoom];
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draw, setDraw] = useState<{ from: number; to: number; done: boolean } | null>(null);
  const [arrow, setArrow] = useState<{ from: string; x: number; y: number } | null>(null);
  const [shift, setShift] = useState<{ taskId: string; days: number; names: string[]; undo: () => Promise<unknown>; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  // Open with the anchor (Today, or the date an edge marker named) a quarter of the way in.
  const loaded = Boolean(query.data);
  useEffect(() => {
    if (grid.current) grid.current.scrollLeft = Math.max(0, daysBetween(range.start, anchor) * px - grid.current.clientWidth / 4);
  }, [anchor, range.start, px, loaded]);

  const projects = (data?.projects ?? []) as Project[];
  const deps = data?.deps ?? [];
  const dates = (p: Project) => {
    const s = taskDueDateKey(p.startDate) ?? taskDueDateKey(p.dueDate);
    const e = taskDueDateKey(p.dueDate) ?? s;
    if (drag?.id !== p.id || !s || !e) return { s, e };
    return { s: drag.mode === "end" ? s : addDayKeys(s, drag.delta), e: drag.mode === "start" ? e : addDayKeys(e, drag.delta) };
  };
  const dated = projects.filter((p) => p.startDate || p.dueDate);
  const late = conflicts(dated.map((p) => ({ id: p.id, start: dates(p).s, end: dates(p).e })), deps);
  const titleOf = (id: string) => projects.find((p) => p.id === id)?.title ?? "";
  type Row = { kind: "group"; name: string; count: number } | { kind: "project"; p: Project } | { kind: "draw" };
  const rows: Row[] = GROUPS.flatMap((g) => {
    const list = dated.filter((p) => g.stages.includes(p.stage ?? "not_started"));
    return [{ kind: "group" as const, name: g.name, count: list.length }, ...list.map((p) => ({ kind: "project" as const, p })), ...(g.id === "todo" && canEdit ? [{ kind: "draw" as const }] : [])];
  });
  const rowTop = (i: number) => rows.slice(0, i).reduce((y, r) => y + (r.kind === "group" ? 28 : ROW), 0);
  const yOf = new Map(rows.flatMap((r, i) => (r.kind === "project" ? [[r.p.id, rowTop(i) + ROW / 2] as const] : [])));
  const xOf = (key: string) => daysBetween(range.start, key) * px;
  const height = rowTop(rows.length);

  async function saveDates(p: Project, start: string | null, end: string | null) {
    const before = { startDate: p.startDate, dueDate: p.dueDate };
    const r = await setTaskDatesAction({ projectId, taskId: p.id, ...(start ? { startDate: dueOn(start) } : {}), ...(end ? { dueDate: dueOn(end) } : {}) });
    await refresh();
    if (!r.success) return void toast.error(r.error);
    const label = `${p.title}: ${start ? short(start) : "—"} → ${end ? short(end) : "—"}`;
    const undo = () => setTaskDatesAction({ projectId, taskId: p.id, ...before }).then(refresh);
    // S7: when others wait on it, the dialog asks first and one toast follows with one Undo for everything.
    if (r.toShift.length && r.days > 0) return setShift({ taskId: p.id, days: r.days, names: r.toShift.map((x) => x.title), undo, label });
    toast(label, { duration: 10_000, action: { label: "Undo", onClick: () => void undo() } });
  }

  function leaveThem() {
    if (!shift) return;
    toast(shift.label, { duration: 10_000, action: { label: "Undo", onClick: () => void shift.undo() } });
    setShift(null);
  }

  async function doShift() {
    if (!shift) return;
    setBusy(true);
    const r = await shiftDependentsAction({ projectId, taskId: shift.taskId, days: shift.days });
    setBusy(false);
    setShift(null);
    await refresh();
    if (!r.success) return void toast.error(r.error);
    toast(`${shift.label} · moved ${r.count} more by ${shift.days} ${shift.days === 1 ? "day" : "days"}`, { duration: 10_000, action: { label: "Undo", onClick: () => void shiftDependentsAction({ projectId, taskId: shift.taskId, days: -shift.days }).then(shift.undo) } });
  }

  async function linkArrow(blockerId: string, blockedId: string, remove = false) {
    const r = await setBlockedByAction({ projectId, taskId: blockedId, blockedById: blockerId, remove });
    await refresh();
    if (!r.success) toast.error(r.error);
  }

  // Pointer moves for bars, arrows and drawing; days snap to whole days.
  useEffect(() => {
    if (!drag && !arrow && !(draw && !draw.done)) return;
    const box = () => grid.current!.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      if (drag) setDrag({ ...drag, delta: Math.round((e.clientX - drag.x0) / px) });
      if (arrow) setArrow({ ...arrow, x: e.clientX - box().left + grid.current!.scrollLeft, y: e.clientY - box().top });
      if (draw && !draw.done) setDraw({ ...draw, to: dayAt(e) });
    };
    // The release carries the final position (a fast drag's last move can arrive with it).
    const dayAt = (e: PointerEvent) => Math.max(0, Math.floor((e.clientX - box().left + grid.current!.scrollLeft) / px));
    const up = (e: PointerEvent) => {
      if (drag) {
        const p = projects.find((x) => x.id === drag.id);
        const delta = Math.round((e.clientX - drag.x0) / px);
        setDrag(null);
        if (!p) return;
        if (delta === 0 && drag.mode === "move") return onOpen(p.id);
        const s0 = taskDueDateKey(p.startDate) ?? taskDueDateKey(p.dueDate);
        const e0 = taskDueDateKey(p.dueDate) ?? s0;
        if (!s0 || !e0) return;
        const d = { s: drag.mode === "end" ? s0 : addDayKeys(s0, delta), e: drag.mode === "start" ? e0 : addDayKeys(e0, delta) };
        if (delta !== 0) {
          if (d.s > d.e) return void toast.error("The start date is after the due date");
          void saveDates(p, p.startDate || drag.mode !== "end" ? d.s : null, d.e);
        }
      }
      if (arrow) {
        const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-bar-id]")?.dataset.barId;
        setArrow(null);
        if (target && target !== arrow.from) void linkArrow(arrow.from, target);
      }
      if (draw && !draw.done) setDraw({ ...draw, to: dayAt(e), done: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  });

  const setZoom = (z: Zoom) => { setZoomState(z); remember("nb:timeline-zoom", z); };
  const months = Array.from({ length: range.days }, (_, i) => addDayKeys(range.start, i)).filter((k, i) => i === 0 || k.endsWith("-01"));
  const ticks = Array.from({ length: range.days }, (_, i) => addDayKeys(range.start, i)).filter((k) => (zoom === "week" ? true : zoom === "month" ? new Date(`${k}T00:00:00Z`).getUTCDay() === 1 : k.endsWith("-01")));
  const weekends = zoom === "quarter" ? [] : Array.from({ length: range.days }, (_, i) => i).filter((i) => new Date(`${addDayKeys(range.start, i)}T00:00:00Z`).getUTCDay() % 6 === 0);
  const todayX = today >= range.start && today <= range.end ? xOf(today) + px / 2 : null;
  const noDates = projects.filter((p) => !p.startDate && !p.dueDate);
  const drawSpan = draw ? { from: Math.min(draw.from, draw.to), to: Math.max(draw.from, draw.to) } : null;

  return (
    <section aria-label="Timeline" className="space-y-3" data-testid="planner-timeline">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Zoom" className="nb-seg" data-size="sm">
          {ZOOMS.map((z) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z[0]!.toUpperCase() + z.slice(1)}</button>
          ))}
          <TabMarker />
        </div>
        <div className="inline-flex items-center">
          <button type="button" aria-label="Earlier" onClick={() => setAnchor(addDayKeys(anchor, zoom === "week" ? -7 : zoom === "month" ? -30 : -91))} className="nb-touch-target inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"><ChevronLeft className="size-4" /></button>
          <button type="button" onClick={() => setAnchor(today)} className="h-7 rounded-[5px] px-2 text-xs font-medium hover:bg-muted">Today</button>
          <button type="button" aria-label="Later" onClick={() => setAnchor(addDayKeys(anchor, zoom === "week" ? 7 : zoom === "month" ? 30 : 91))} className="nb-touch-target inline-flex size-7 items-center justify-center rounded-md hover:bg-muted"><ChevronRight className="size-4" /></button>
        </div>
        {sprints.length ? (
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={showSprints} onChange={(e) => { setShowSprints(e.target.checked); remember("nb:timeline-sprints", e.target.checked ? "1" : "0"); }} className="size-3.5 accent-[var(--primary)]" />
            Show sprints
          </label>
        ) : null}
      </div>

      {query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-48 rounded-[8px]" /> : null}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load projects · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}
      {data && !projects.length ? (
        <p className="rounded-[8px] border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">A project groups tasks with a start and an end. Drag across the timeline to add one, or press New project.</p>
      ) : null}

      {data ? (
        <div className="flex overflow-hidden rounded-[8px] border border-border bg-card">
          <div className="w-56 shrink-0 border-r border-border max-sm:w-36" style={{ paddingTop: HEAD }}>
            {rows.map((r, i) => r.kind === "group" ? (
              <div key={`g${i}`} className="flex h-7 items-center gap-2 border-t border-border bg-muted/40 px-3 text-[12px] font-semibold text-foreground">{r.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{r.count}</span></div>
            ) : r.kind === "draw" ? (
              <div key="draw" className="flex h-9 items-center px-3 text-[12px] text-muted-foreground">Drag on the timeline to add</div>
            ) : (
              <div key={r.p.id} className="group flex h-9 items-center gap-1.5 px-3">
                <FolderKanban aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                {r.p.taskNumber && data.projectKey ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground max-sm:hidden">{formatTaskId(data.projectKey, r.p.taskNumber)}</span> : null}
                <button type="button" onClick={() => onOpen(r.p.id)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:underline">{r.p.title}</button>
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger aria-label={`More for ${r.p.title}`} className="nb-touch-target inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[220px]">
                      <DropdownMenuItem onSelect={() => onOpen(r.p.id)}>Open</DropdownMenuItem>
                      {projects.length > 1 ? <><DropdownMenuSeparator /><DropdownMenuLabel>Blocked by</DropdownMenuLabel></> : null}
                      {projects.filter((o) => o.id !== r.p.id).map((o) => {
                        const on = deps.some((d) => d.taskId === r.p.id && d.blockedById === o.id);
                        return <DropdownMenuCheckboxItem key={o.id} checked={on} onSelect={(e) => e.preventDefault()} onCheckedChange={() => void linkArrow(o.id, r.p.id, on)}>{o.title}</DropdownMenuCheckboxItem>;
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ))}
          </div>

          <div ref={grid} className="relative min-w-0 flex-1 overflow-x-auto" data-testid="timeline-grid">
            <div className="relative" style={{ width: range.days * px, height: HEAD + height + (draw?.done ? 112 : 0) }}>
              {weekends.map((i) => <div key={i} aria-hidden="true" className="absolute bottom-0 bg-muted/50" style={{ left: i * px, width: px, top: HEAD }} />)}
              <div className="sticky top-0 h-12 border-b border-border" aria-hidden="true">
                {months.map((k) => <span key={k} className="absolute top-1 whitespace-nowrap pl-1 text-[11px] font-semibold text-foreground" style={{ left: xOf(k) }}>{new Date(`${k}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })}</span>)}
                {ticks.map((k) => <span key={k} className="absolute top-6 pl-1 font-mono text-[10px] text-muted-foreground" style={{ left: xOf(k) }}>{zoom === "quarter" ? "" : Number(k.slice(8))}</span>)}
                {showSprints ? sprints.filter((s) => s.startDate && s.endDate).map((s) => {
                  const g = barGeometry(taskDueDateKey(s.startDate), taskDueDateKey(s.endDate), range);
                  return g && "left" in g ? <span key={s.id} title={s.name} className="absolute bottom-0.5 h-3 truncate rounded-[2px] bg-primary/15 px-1 text-[9px] leading-3 text-foreground" style={{ left: g.left * px, width: g.width * px }}>{s.name}</span> : null;
                }) : null}
              </div>
              {todayX !== null ? (
                <div aria-hidden="true" className="absolute bottom-0 z-10 w-px bg-primary" style={{ left: todayX, top: HEAD - 6 }}>
                  <span className="absolute -left-[3px] -top-1 size-[7px] rounded-[2px] bg-primary" />
                </div>
              ) : null}

              <svg aria-hidden="true" className="pointer-events-none absolute left-0 z-20 overflow-visible" style={{ top: HEAD }} width={range.days * px} height={height}>
                {deps.map((d) => {
                  const a = projects.find((p) => p.id === d.blockedById);
                  const b = projects.find((p) => p.id === d.taskId);
                  const ya = yOf.get(d.blockedById);
                  const yb = yOf.get(d.taskId);
                  if (!a || !b || ya === undefined || yb === undefined || !dates(a).e || !dates(b).s) return null;
                  const x1 = xOf(dates(a).e!) + px;
                  const x2 = xOf(dates(b).s!);
                  const bad = late.some((c) => c.blocker === d.blockedById && c.blocked === d.taskId);
                  return <path key={`${d.blockedById}-${d.taskId}`} d={`M${x1},${ya} C${x1 + 24},${ya} ${x2 - 24},${yb} ${x2},${yb}`} fill="none" strokeWidth={1.5} className={bad ? "stroke-amber-600" : "stroke-primary"} />;
                })}
                {arrow ? <line x1={xOf(dates(projects.find((p) => p.id === arrow.from)!).e!) + px} y1={yOf.get(arrow.from) ?? 0} x2={arrow.x} y2={arrow.y - HEAD} strokeWidth={1.5} strokeDasharray="4 3" className="stroke-primary" /> : null}
              </svg>

              <div className="absolute left-0 right-0" style={{ top: HEAD }}>
                {rows.map((r, i) => {
                  if (r.kind === "group") return <div key={`g${i}`} className="absolute left-0 right-0 h-7 border-t border-border bg-muted/40" style={{ top: rowTop(i) }} />;
                  if (r.kind === "draw") return (
                    <div key="draw" data-testid="timeline-draw-lane" className="absolute left-0 right-0 h-9 cursor-crosshair" style={{ top: rowTop(i) }}
                      onPointerDown={(e) => { const day = Math.floor((e.clientX - grid.current!.getBoundingClientRect().left + grid.current!.scrollLeft) / px); setDraw({ from: day, to: day, done: false }); }}>
                      {drawSpan ? <div className="absolute top-1.5 h-6 rounded-[4px] border border-dashed border-primary bg-primary/10" style={{ left: drawSpan.from * px, width: (drawSpan.to - drawSpan.from + 1) * px }} /> : null}
                      {draw?.done && drawSpan ? (
                        <QuickCreate left={Math.max(0, Math.min(drawSpan.from * px, (grid.current?.scrollLeft ?? 0) + (grid.current?.clientWidth ?? Infinity) - 296))} start={addDayKeys(range.start, drawSpan.from)} end={addDayKeys(range.start, drawSpan.to)} projectId={projectId} viewerId={viewerId}
                          onDone={() => { setDraw(null); void refresh(); }} onMore={(d) => { setDraw(null); onMoreDetails(d); }} />
                      ) : null}
                    </div>
                  );
                  const p = r.p;
                  const d = dates(p);
                  const g = barGeometry(d.s, d.e, range);
                  if (!g) return null;
                  if ("edge" in g) return (
                    <button key={p.id} type="button" onClick={() => setAnchor(g.date)} className={cn("absolute h-6 whitespace-nowrap rounded-[4px] border border-border bg-card px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground", g.edge === "before" ? "left-1" : "right-1")} style={{ top: rowTop(i) + 6 }}>
                      {g.edge === "before" ? `‹ ${short(g.date)}` : `${short(g.date)} ›`}
                    </button>
                  );
                  const startsEarly = late.find((c) => c.blocked === p.id);
                  const waiting = deps.filter((x) => x.taskId === p.id).map((x) => projects.find((o) => o.id === x.blockedById)).find((o) => o && o.stage !== "completed");
                  return (
                    <div key={p.id} className="absolute h-7" style={{ top: rowTop(i) + 4, left: g.left * px, width: g.width * px }}>
                      <div role="button" tabIndex={0} data-bar-id={p.id} data-testid="timeline-bar"
                        aria-label={`${p.title}, ${d.s ? short(d.s) : ""} to ${d.e ? short(d.e) : ""}, ${stageLabel(p.stage)}, ${p.completion.percent}% complete${startsEarly ? `, starts before ${titleOf(startsEarly.blocker)} ends` : ""}`}
                        onPointerDown={(e) => { if (!canEdit || e.button !== 0) return; e.preventDefault(); setDrag({ id: p.id, mode: "move", x0: e.clientX, delta: 0 }); }}
                        onClick={(e) => { if (!canEdit && e.detail) onOpen(p.id); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") return onOpen(p.id);
                          if (!canEdit || (e.key !== "[" && e.key !== "]" && e.key !== "{" && e.key !== "}") || !d.s || !d.e) return;
                          e.preventDefault();
                          const n = e.key === "[" || e.key === "{" ? -1 : 1;
                          const endOnly = e.key === "{" || e.key === "}";
                          if (endOnly && addDayKeys(d.e, n) < d.s) return;
                          void saveDates(p, p.startDate && !endOnly ? addDayKeys(d.s, n) : null, addDayKeys(d.e, n));
                        }}
                        className={cn("relative flex h-full items-center gap-1.5 overflow-hidden rounded-[4px] border bg-card px-2 text-[12px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring", canEdit && "cursor-grab", startsEarly ? "border-amber-600" : "border-border", drag?.id === p.id && "cursor-grabbing opacity-90")}>
                        <span className="min-w-[40%] truncate font-medium">{p.title}</span>
                        {startsEarly ? <span className="min-w-0 truncate text-[11px] text-amber-700 dark:text-amber-400">Starts before {titleOf(startsEarly.blocker)} ends</span>
                          : waiting && p.stage === "in_progress" ? <span className="min-w-0 truncate text-[11px] text-amber-700 dark:text-amber-400">Blocked by {waiting.title}</span> : null}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{p.completion.percent}%</span>
                        <span aria-hidden="true" className="absolute bottom-0 left-0 h-0.5 bg-primary" style={{ width: `${p.completion.percent}%` }} />
                        {canEdit ? <>
                          <span aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setDrag({ id: p.id, mode: "start", x0: e.clientX, delta: 0 }); }} className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
                          <span aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setDrag({ id: p.id, mode: "end", x0: e.clientX, delta: 0 }); }} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
                        </> : null}
                      </div>
                      {canEdit ? (
                        <span aria-hidden="true" data-testid="timeline-end-dot" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); const b = grid.current!.getBoundingClientRect(); setArrow({ from: p.id, x: e.clientX - b.left + grid.current!.scrollLeft, y: e.clientY - b.top }); }}
                          className="absolute -right-2 top-1/2 size-2.5 -translate-y-1/2 cursor-crosshair rounded-[2px] border border-primary bg-card" />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {noDates.length ? (
        <div className="rounded-[8px] border border-border px-3 py-2" data-testid="timeline-no-dates">
          <h3 className="text-[12px] font-semibold text-foreground">No dates <span className="font-mono font-normal text-muted-foreground">{noDates.length}</span></h3>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {noDates.map((p) => <li key={p.id}><button type="button" onClick={() => onOpen(p.id)} className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-border px-2 text-[12px] hover:bg-muted">{p.title} <span className="text-muted-foreground">· Set dates</span></button></li>)}
          </ul>
        </div>
      ) : null}

      <Dialog open={shift !== null} onOpenChange={(open) => { if (!open && !busy) leaveThem(); }}>
        <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="shift-dependents-dialog">
          <div className="border-b border-border px-6 py-4">
            <DialogTitle className="text-base font-semibold text-foreground">Move {shift?.names.length} {shift?.names.length === 1 ? "project that depends" : "projects that depend"} on this by {shift?.days} {shift?.days === 1 ? "day" : "days"}?</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{shift?.names.join(", ")}</DialogDescription>
          </div>
          <div className={FORM_FOOTER_CLASS}>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={leaveThem}>Leave them</button>
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void doShift()}>Move them</button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** S6: the bubble after drawing: a name, the dates already set; Create or More details; Esc removes the ghost bar. */
function QuickCreate({ left, start, end, projectId, viewerId, onDone, onMore }: {
  left: number; start: string; end: string; projectId: string; viewerId: string | null;
  onDone: () => void; onMore: (draft: { title: string; startDate: string; dueDate: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const r = await createTaskAction({ projectId, title: title.trim(), status: "todo", priority: "medium", itemType: "project", stage: "not_started", startDate: dueOn(start), dueDate: dueOn(end), ...(viewerId ? { assigneeId: viewerId } : {}) } as never);
    setBusy(false);
    if (!r.success) return void toast.error(r.error ?? "Couldn’t create the project");
    onDone();
  }
  return (
    <div role="dialog" aria-label="New project" data-testid="timeline-quick-create" onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-9 z-30 w-72 space-y-2 rounded-[8px] border border-border bg-popover p-3 shadow-md" style={{ left }}>
      <input autoFocus aria-label="Project name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project name"
        onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") onDone(); }}
        className="h-8 w-full rounded-[5px] border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <p className="font-mono text-[11px] text-muted-foreground">{short(start)} → {short(end)}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => onMore({ title, startDate: start, dueDate: end })} className="h-7 rounded-[5px] px-2 text-xs hover:bg-muted">More details</button>
        <button type="button" disabled={!title.trim() || busy} onClick={() => void create()} className="h-7 rounded-[5px] bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50">Create</button>
      </div>
    </div>
  );
}
