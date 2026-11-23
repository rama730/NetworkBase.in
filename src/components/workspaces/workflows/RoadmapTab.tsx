"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { moveRoadmapColumnAction, type RoadmapRow } from "@/app/actions/roadmap";
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
import { COLUMN_LABEL, COLUMNS, ITEM_TYPE_LABEL, onColumnBoard, type Column } from "@/lib/workflows/roadmap";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { buildTaskSubmitPayload } from "@/lib/workspaces/task-draft";
import { normalizeSprintOptions } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.9 T2 (plan A2.10): the Roadmap tab. Now · Next · Later (a column field) and By stage. Items never sit on the
 * Tasks board; their work tasks do. Timeline and Backlog arrive with A2.11; Ships in waits for launches (A3.1).
 */
type View = "columns" | "stages";
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
    try { const v = localStorage.getItem(`nb:roadmap-view:${projectId}`); if (v === "columns" || v === "stages") setView(v); } catch { /* private window */ }
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
        <span className="font-mono text-[12px] text-muted-foreground" data-testid="roadmap-counts">{inColumn("now").length} now · {inColumn("next").length} next</span>
        <div className="ml-auto flex items-center gap-2">
          {data?.canEdit ? <button type="button" onClick={() => setCreating("next")} className={FORM_PRIMARY_CLASS}>New item</button> : null}
        </div>
      </div>

      {query.isLoading ? <div aria-hidden="true" className="grid gap-3 md:grid-cols-3">{COLUMNS.map((c) => <div key={c} className="nb-skeleton h-48 rounded-[8px]" />)}</div> : null}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load the roadmap · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}

      {data ? (
        <>
          <UnderlineTabs label="Roadmap view" idPrefix="roadmap-view" value={view} onChange={pickView} className="min-h-10"
            tabs={[{ key: "columns" as const, label: "Now · Next · Later" }, { key: "stages" as const, label: "By stage" }]} />
          <div id={`roadmap-view-panel-${view}`} role="tabpanel" aria-labelledby={`roadmap-view-tab-${view}`} className="space-y-3">
            {!live.length ? <p className="text-[13px] text-muted-foreground" data-testid="roadmap-empty">Put what you’re building now in Now. Work tasks go on the Tasks board.</p> : null}
            {view === "columns" ? <div className="grid gap-3 md:grid-cols-3">{COLUMNS.map(column)}</div> : (
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
