"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Map as MapIcon, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { moveBacklogAction, moveRoadmapColumnAction, type RoadmapRow } from "@/app/actions/roadmap";
import { createTaskAction } from "@/app/actions/workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import CreateTaskModal from "@/components/workspaces/v2/tasks/CreateTaskModal";
import { FORM_PRIMARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { useRoadmap } from "@/components/workspaces/v2/tasks/RoadmapParts";
import { TaskStageControl } from "@/components/workspaces/v2/tasks/TaskStageControl";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { addDayKeys, barGeometry, daysBetween, localDayKey, timelineRange, ZOOM_DAY_PX } from "@/lib/workflows/planner";
import { backlogOrder, COLUMN_LABEL, COLUMNS, ITEM_TYPE_LABEL, nextLaunch, onColumnBoard, timelineSpan, type Column } from "@/lib/workflows/roadmap";
import { countdown } from "@/lib/workflows/launches";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { buildTaskSubmitPayload } from "@/lib/workspaces/task-draft";
import { normalizeSprintOptions } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.9 T2 (plan A2.10): the Roadmap tab. Now · Next · Later (a column field) and By stage. Items never sit on the
 * Tasks board; their work tasks do. A2.11 adds Timeline (bars from the first work start to the target date, milestones
 * as diamonds) and Backlog (hand order). Ships in and launch diamonds wait for launches (A3.1).
 */
type View = "columns" | "stages" | "timeline" | "backlog";
const STAGES = ["backlog", "planned", "in_progress", "testing", "launched"];
const stageLabel = (s: string | null) => WORKFLOW_TYPES.roadmap_item!.stages.find((x) => x.key === s)?.label ?? "Backlog";
const BADGE = "inline-flex h-5 items-center rounded-[3px] border border-border px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";

export function RoadmapTab({ projectId, projectSlug, projectName, members, sprints, canPlanSprints }: {
  projectId: string; projectSlug: string; projectName: string; currentUserId: string | null; members: unknown[]; sprints: unknown[]; canPlanSprints: boolean;
}) {
  const queryClient = useQueryClient();
  const phone = useMediaQuery("(max-width: 639px)");
  const { query, data } = useRoadmap(projectId);
  const sprintOptions = useMemo(() => normalizeSprintOptions(sprints as never[]), [sprints]);
  const [view, setView] = useState<View>("columns");
  useEffect(() => {
    try { const v = localStorage.getItem(`nb:roadmap-view:${projectId}`); if (v === "columns" || v === "stages" || v === "timeline" || v === "backlog") setView(v); } catch { /* private window */ }
  }, [projectId]);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(`nb:roadmap-view:${projectId}`, v); } catch { /* private window */ } };
  const [creating, setCreating] = useState<Column | null>(null);
  const [over, setOver] = useState<Column | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });

  const items = data?.items ?? [];
  const live = items.filter((i) => onColumnBoard(i.stage));
  const inColumn = (c: Column) => live.filter((i) => i.typeFields.column === c);
  const href = (id: string) => `/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({ tab: "tasks", drawerType: "task", drawerId: id }).toString()}`;
  const name = (r: RoadmapRow) => (r.taskNumber && data?.projectKey ? formatTaskId(data.projectKey, r.taskNumber) : "");

  async function moveTo(r: RoadmapRow, column: Column) {
    if (r.typeFields.column === column) return;
    const res = await moveRoadmapColumnAction({ projectId, taskId: r.id, column });
    if (!res.success) return void toast.error(res.error);
    const back = r.typeFields.column as Column | undefined;
    toast(`${r.title} moved to ${COLUMN_LABEL[column]}`, back ? { action: { label: "Undo", onClick: () => void moveRoadmapColumnAction({ projectId, taskId: r.id, column: back }).then(refresh) } } : undefined);
    await refresh();
  }

  const card = (r: RoadmapRow) => (
    <li key={r.id} draggable={Boolean(data?.canEdit)} onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; }} data-testid="roadmap-card"
      className={cn("space-y-1.5 rounded-[6px] border border-border bg-card p-2.5", data?.canEdit && "cursor-grab")}>
      <div className="flex items-start gap-1.5">
        <Link href={href(r.id)} className="flex min-w-0 flex-1 items-start gap-1.5 text-[13px] font-medium text-foreground hover:underline" aria-label={`Roadmap item ${name(r)}, ${r.title}, ${stageLabel(r.stage)}`}>
          <MapIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0">{r.title}</span>
        </Link>
        {data?.canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" aria-label={`Move ${r.title}`} className="nb-touch-target inline-flex size-6 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-3.5" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Move to</DropdownMenuLabel>
              {COLUMNS.filter((c) => c !== r.typeFields.column).map((c) => <DropdownMenuItem key={c} onSelect={() => void moveTo(r, c)}>Move to {COLUMN_LABEL[c]}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {r.typeFields.outcome ? <p className="line-clamp-1 text-[12px] text-muted-foreground">{String(r.typeFields.outcome)}</p> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={BADGE}>{r.typeFields.itemType === "milestone" && r.typeFields.milestone ? String(r.typeFields.milestone) : ITEM_TYPE_LABEL[r.typeFields.itemType as keyof typeof ITEM_TYPE_LABEL] ?? "Feature"}</span>
        <span className={BADGE}>{stageLabel(r.stage)}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{name(r)}</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">{r.assigneeName ?? ""}</span>
      </div>
      {r.launch ? <p className="truncate text-[11px] text-muted-foreground" data-testid="ships-in">Ships in <span className="font-medium text-foreground">{r.launch.name}</span>{r.launch.date ? <span className="font-mono"> · {r.launch.date}</span> : null}</p> : null}
      {r.progress !== null ? (
        <div className="flex items-center gap-2" aria-label={`${r.progress}% of its work done`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${r.progress}%` }} /></div>
          <span className="font-mono text-[11px] text-muted-foreground">{r.progress}%</span>
        </div>
      ) : null}
      {data?.canEdit && view === "stages" ? <TaskStageControl projectId={projectId} task={{ id: r.id, itemType: "roadmap_item", stage: r.stage, status: r.status, title: r.title }} canEdit canPlanSprints={false} sprints={[]} compact onMoved={() => void refresh()} /> : null}
    </li>
  );

  const column = (c: Column) => {
    const list = inColumn(c);
    const body = <ul className="space-y-2" aria-label={`${COLUMN_LABEL[c]}, ${list.length}`}>{list.map(card)}</ul>;
    if (phone) return (
      <details key={c} open={c === "now"} className="rounded-[8px] border border-border bg-muted/30 p-2" data-testid="roadmap-column">
        <summary className="cursor-pointer px-1 text-[13px] font-semibold">{COLUMN_LABEL[c]} <span className="font-mono font-normal text-muted-foreground">{list.length}</span></summary>
        <div className="mt-2">{body}</div>
      </details>
    );
    return (
      <section key={c} aria-label={COLUMN_LABEL[c]} data-testid="roadmap-column"
        onDragOver={(e) => { if (data?.canEdit) { e.preventDefault(); setOver(c); } }} onDragLeave={() => setOver(null)}
        onDrop={(e) => { e.preventDefault(); setOver(null); const r = items.find((i) => i.id === e.dataTransfer.getData("text/plain")); if (r) void moveTo(r, c); }}
        className={cn("min-h-48 space-y-2 rounded-[8px] border border-border bg-muted/30 p-2", over === c && "ring-1 ring-primary")}>
        <h3 className="flex items-center gap-2 px-1 text-[12px] font-semibold">{COLUMN_LABEL[c]} <span className="font-mono font-normal text-muted-foreground">{list.length}</span></h3>
        {body}
      </section>
    );
  };

  return (
    <section aria-label="Roadmap" className="space-y-4" data-testid="roadmap-tab">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <h2 className="inline-flex items-center gap-2 text-[20px] font-semibold tracking-tight"><MapIcon aria-hidden="true" className="size-5" />Roadmap</h2>
        <span className="font-mono text-[12px] text-muted-foreground" data-testid="roadmap-counts">{inColumn("now").length} now · {inColumn("next").length} next{(() => { const n = nextLaunch(data?.launches ?? [], localDayKey()); return n ? ` · next launch ${countdown(n.date!, localDayKey())}` : ""; })()}</span>
        <div className="ml-auto flex items-center gap-2">
          {data?.canEdit ? <button type="button" onClick={() => setCreating("next")} className={FORM_PRIMARY_CLASS}>New item</button> : null}
        </div>
      </div>

      {query.isLoading ? <div aria-hidden="true" className="grid gap-3 md:grid-cols-3">{COLUMNS.map((c) => <div key={c} className="nb-skeleton h-48 rounded-[8px]" />)}</div> : null}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load the roadmap · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}

      {data ? (
        <>
          <UnderlineTabs label="Roadmap view" idPrefix="roadmap-view" value={view} onChange={pickView} className="min-h-10"
            tabs={[{ key: "columns" as const, label: "Now · Next · Later" }, { key: "stages" as const, label: "By stage" }, { key: "timeline" as const, label: "Timeline" }, { key: "backlog" as const, label: "Backlog" }]} />
          <div id={`roadmap-view-panel-${view}`} role="tabpanel" aria-labelledby={`roadmap-view-tab-${view}`} className="space-y-3">
            {!live.length && (view === "columns" || view === "stages") ? <p className="text-[13px] text-muted-foreground" data-testid="roadmap-empty">Put what you’re building now in Now. Work tasks go on the Tasks board.</p> : null}
            {view === "timeline" ? <RoadmapTimeline items={live} launches={data.launches} projectSlug={projectSlug} href={href} name={name} /> : null}
            {view === "backlog" ? <RoadmapBacklog items={items.filter((i) => (i.stage ?? "backlog") === "backlog")} canEdit={Boolean(data.canEdit)} href={href} name={name}
              onMove={async (taskId, beforeId) => { const r = await moveBacklogAction({ projectId, taskId, beforeId }); if (!r.success) return void toast.error(r.error); await refresh(); }} /> : null}
            {view === "timeline" || view === "backlog" ? null : view === "columns" ? <div className="grid gap-3 md:grid-cols-3">{COLUMNS.map(column)}</div> : (
              <div className="grid gap-3 max-md:grid-flow-col max-md:auto-cols-[minmax(250px,1fr)] max-md:overflow-x-auto md:grid-cols-5" tabIndex={0} aria-label="Roadmap stages">
                {STAGES.map((stage) => {
                  const list = items.filter((r) => (r.stage ?? "backlog") === stage);
                  return (
                    <section key={stage} aria-label={`${stageLabel(stage)}, ${list.length}`} data-testid="roadmap-stage" className="min-h-40 space-y-2 rounded-[8px] border border-border bg-muted/30 p-2">
                      <h3 className="flex items-center gap-2 px-1 text-[12px] font-semibold">{stageLabel(stage)} <span className="font-mono font-normal text-muted-foreground">{list.length}</span></h3>
                      <ul className="space-y-2">{list.map(card)}</ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}

      {creating ? (
        <CreateTaskModal isOpen onClose={() => setCreating(null)} projectId={projectId} projectName={projectName} projectKey={data?.projectKey ?? null}
          members={members as never} sprints={sprintOptions} types={["roadmap_item"]} initialType="roadmap_item" openedFrom="own" canAssignSprint={canPlanSprints}
          onCreate={async (value) => {
            const r = await createTaskAction({ ...buildTaskSubmitPayload({ draft: value.draft, projectId, subtasks: value.subtasks, attachments: value.attachments }) } as never);
            if (!r.success) return { success: false, error: r.error ?? "Couldn’t add the item" };
            await refresh();
            return { success: true };
          }} />
      ) : null}
    </section>
  );
}

/** W8 and S4 (A2.11): T1's month grid; items as bars from their first work start to the target date, milestones as diamonds. */
function RoadmapTimeline({ items, launches, projectSlug, href, name }: {
  items: RoadmapRow[]; launches: Array<{ slug: string; name: string; date: string | null; stage: string }>; projectSlug: string; href: (id: string) => string; name: (r: RoadmapRow) => string;
}) {
  const today = localDayKey();
  const range = timelineRange("month", today);
  const px = ZOOM_DAY_PX.month;
  const placed = items.map((r) => ({ r, span: timelineSpan(r) }));
  const dated = placed.filter((p) => p.span);
  const undated = placed.filter((p) => !p.span).map((p) => p.r);
  const months: Array<{ key: string; left: number }> = [];
  for (let d = range.start; d <= range.end; d = addDayKeys(d, 1)) if (d.endsWith("-01")) months.push({ key: d, left: daysBetween(range.start, d) });
  const todayAt = barGeometry(today, today, range);
  // Opens on today, a week of past showing (as T1's Timeline does).
  const scroller = useRef<HTMLDivElement>(null);
  const todayLeft = todayAt && "left" in todayAt ? todayAt.left : 0;
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, (todayLeft - 7) * px); }, [todayLeft, px]);
  return (
    <div className="space-y-3" data-testid="roadmap-timeline">
      <div ref={scroller} className="overflow-x-auto rounded-[8px] border border-border bg-card" tabIndex={0} aria-label="Roadmap timeline">
        <div className="relative" style={{ width: range.days * px + 220 }}>
          <div className="sticky top-0 flex h-7 border-b border-border text-[11px] text-muted-foreground">
            <div className="sticky left-0 z-10 w-[220px] shrink-0 border-r border-border/60 bg-card px-3 py-1.5 font-medium">Item</div>
            <div className="relative flex-1">{months.map((m) => <span key={m.key} className="absolute top-1.5 font-mono" style={{ left: m.left * px + 4 }}>{new Date(`${m.key}T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>)}</div>
          </div>
          <ul>
            {/* A3.1 (T2 W8): launches as Clay diamonds on their own row. */}
            {launches.some((l) => l.date) ? (
              <li className="flex h-9 items-center border-b border-border/60" data-testid="timeline-launches">
                <div className="sticky left-0 z-10 flex h-full w-[220px] shrink-0 items-center border-r border-border/60 bg-card px-3 text-[12px] font-semibold text-muted-foreground">Launches</div>
                <div className="relative h-full flex-1">
                  {launches.filter((l) => l.date).map((l) => { const g = barGeometry(l.date!, l.date!, range); return g && "left" in g ? (
                    <a key={l.slug} href={`/workspaces/${encodeURIComponent(projectSlug)}?tab=docs&doc=${encodeURIComponent(l.slug)}`} role="img" aria-label={`Launch ${l.name} on ${l.date}`} title={`${l.name} · ${l.date}`}
                      className="absolute top-3 size-3 rotate-45 bg-primary" style={{ left: g.left * px + px / 2 - 6 }} />
                  ) : null; })}
                </div>
              </li>
            ) : null}
            {dated.map(({ r, span }) => {
              const g = span!.kind === "diamond" ? barGeometry(span!.date, span!.date, range) : barGeometry(span!.start, span!.end, range);
              return (
                <li key={r.id} className="flex h-9 items-center border-b border-border/60 last:border-b-0" data-testid="timeline-row">
                  <div className="sticky left-0 z-10 flex h-full w-[220px] shrink-0 items-center border-r border-border/60 bg-card px-3"><a href={href(r.id)} className="truncate text-[13px] font-medium hover:underline">{r.title}</a></div>
                  <div className="relative h-full flex-1">
                    {todayAt && "left" in todayAt ? <span aria-hidden="true" className="absolute inset-y-0 w-px bg-primary/40" style={{ left: todayAt.left * px }} /> : null}
                    {!g ? null : "edge" in g ? <span className="absolute top-2 font-mono text-[11px] text-muted-foreground" style={g.edge === "before" ? { left: 4 } : { right: 4 }}>{g.edge === "before" ? "‹ " : ""}{g.date}{g.edge === "after" ? " ›" : ""}</span>
                      : span!.kind === "diamond"
                        ? <span role="img" title={`${String(r.typeFields.milestone ?? r.title)} · ${span!.date}`} aria-label={`Milestone ${String(r.typeFields.milestone ?? "")} on ${span!.date}`} className="absolute top-3 size-3 rotate-45 border border-foreground bg-card" style={{ left: g.left * px + px / 2 - 6 }} />
                        : <span title={span!.kind === "bar" ? `${r.title} · ${span!.start} → ${span!.end}` : r.title} className="absolute top-2 flex h-5 items-center overflow-hidden rounded-[3px] bg-primary px-1.5 font-mono text-[10px] text-primary-foreground" style={{ left: g.left * px, width: Math.max(g.width * px, 8) }}>{r.progress !== null ? `${r.progress}%` : ""}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {!dated.length ? <p className="text-[13px] text-muted-foreground">Give items a target date, or start their work, to see them here.</p> : null}
      {undated.length ? (
        <div className="space-y-1" data-testid="timeline-no-dates">
          <h3 className="text-[12px] font-semibold">No dates <span className="font-mono font-normal text-muted-foreground">{undated.length}</span></h3>
          <ul className="flex flex-wrap gap-1.5">{undated.map((r) => <li key={r.id}><a href={href(r.id)} className="inline-flex h-7 items-center rounded-[5px] border border-border bg-card px-2 text-[12px] hover:bg-muted"><span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{name(r)}</span>{r.title}</a></li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

/** W9 and S5 (A2.11): Backlog items in hand order (drag the handle, or Move up / Move down), Item · Type · Priority · Requests · Created. */
function RoadmapBacklog({ items, canEdit, href, name, onMove }: {
  items: RoadmapRow[]; canEdit: boolean; href: (id: string) => string; name: (r: RoadmapRow) => string; onMove: (taskId: string, beforeId: string | null) => Promise<void>;
}) {
  const ordered = backlogOrder(items);
  const [dragging, setDragging] = useState<string | null>(null);
  const cell = "px-3 py-2";
  if (!ordered.length) return <p className="py-8 text-center text-[13px] text-muted-foreground" data-testid="roadmap-backlog">New items wait here until they take a column.</p>;
  return (
    <div className="overflow-x-auto rounded-[8px] border border-border bg-card" data-testid="roadmap-backlog">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <caption className="sr-only">Backlog items in order</caption>
        <thead className="border-b border-border text-[12px] text-muted-foreground"><tr>
          {canEdit ? <th scope="col" className={cn(cell, "w-16")}><span className="sr-only">Order</span></th> : null}
          <th scope="col" className={cell}>Item</th><th scope="col" className={cell}>Type</th><th scope="col" className={cell}>Priority</th><th scope="col" className={cn(cell, "text-right")}>Requests</th><th scope="col" className={cell}>Created</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {ordered.map((r, i) => (
            <tr key={r.id} data-testid="backlog-row" draggable={canEdit} onDragStart={(e) => { setDragging(r.id); e.dataTransfer.setData("text/plain", r.id); }} onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { if (canEdit && dragging && dragging !== r.id) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== r.id) void onMove(dragging, r.id); setDragging(null); }}
              className={cn(dragging === r.id && "opacity-50")}>
              {canEdit ? (
                <td className={cn(cell, "whitespace-nowrap text-muted-foreground")}>
                  <GripVertical aria-hidden="true" className="mr-1 inline size-3.5 cursor-grab" />
                  <button type="button" aria-label={`Move ${r.title} up`} disabled={i === 0} onClick={() => void onMove(r.id, ordered[i - 1]!.id)} className="nb-touch-target inline-flex size-6 items-center justify-center rounded-[4px] hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label={`Move ${r.title} down`} disabled={i === ordered.length - 1} onClick={() => void onMove(r.id, ordered[i + 2]?.id ?? null)} className="nb-touch-target inline-flex size-6 items-center justify-center rounded-[4px] hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                </td>
              ) : null}
              <td className={cell}><a href={href(r.id)} className="font-medium hover:underline"><span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{name(r)}</span>{r.title}</a></td>
              <td className={cell}><span className={BADGE}>{r.typeFields.itemType === "milestone" && r.typeFields.milestone ? String(r.typeFields.milestone) : ITEM_TYPE_LABEL[r.typeFields.itemType as keyof typeof ITEM_TYPE_LABEL] ?? "Feature"}</span></td>
              <td className={cn(cell, "capitalize")}>{r.priority}</td>
              <td className={cn(cell, "text-right font-mono text-[12px]")}>{r.requests}</td>
              <td className={cn(cell, "font-mono text-[12px]")}>{new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
