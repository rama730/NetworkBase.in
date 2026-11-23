"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lightbulb, MoreHorizontal, PenLine, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { addIdeaAction, planContentAction, type ContentRow } from "@/app/actions/content";
import { createTaskAction } from "@/app/actions/workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import CreateTaskModal from "@/components/workspaces/v2/tasks/CreateTaskModal";
import { ChannelMark, contentKey, ContentPerformance, ContentSettingsEditor, PlanContentDialog, useContent } from "@/components/workspaces/v2/tasks/ContentParts";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { TaskStageControl } from "@/components/workspaces/v2/tasks/TaskStageControl";
import { TasksCalendar } from "@/components/workspaces/v2/tasks/TasksCalendar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { weekDays, type ContentChannel } from "@/lib/workflows/content";
import { addDayKeys as addDays, localDayKey, mondayOf } from "@/lib/workflows/planner";
import { zonedParts } from "@/lib/workflows/request-clock";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { buildTaskSubmitPayload } from "@/lib/workspaces/task-draft";
import { EMPTY_FILTERS } from "@/lib/workspaces/task-filters";
import { normalizeSprintOptions } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.8 T5 (plan A2.7): the Content tab. Title row with channel quick-adds; Calendar with the Ideas rail (T1's
 * Calendar part), This week, Board and To schedule. Planning an idea onto a day makes it Drafting (it joins the board).
 * A2.8 writing, editing and publishing; A2.9 results, Performance and the Overview card.
 */
type View = "calendar" | "week" | "board" | "schedule" | "performance";
const BOARD = ["idea", "drafting", "editing", "scheduled", "published"];
const stageLabel = (s: string | null) => WORKFLOW_TYPES.content!.stages.find((x) => x.key === s)?.label ?? "Idea";

export function ContentTab({ projectId, projectSlug, projectName, currentUserId, members, sprints, canPlanSprints }: {
  projectId: string; projectSlug: string; projectName: string; currentUserId: string | null; members: unknown[]; sprints: unknown[]; canPlanSprints: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const phone = useMediaQuery("(max-width: 639px)");
  const { query, data } = useContent(projectId);
  const sprintOptions = useMemo(() => normalizeSprintOptions(sprints as never[]), [sprints]);
  const [view, setView] = useState<View>("calendar");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(`nb:content-view:${projectId}`); } catch { /* private window */ }
    if (saved === "calendar" || saved === "week" || saved === "board" || saved === "schedule" || saved === "performance") setView(saved);
    else if (window.matchMedia("(max-width: 639px)").matches) setView("week");
  }, [projectId]);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(`nb:content-view:${projectId}`, v); } catch { /* private window */ } };
  const [creating, setCreating] = useState<{ channels?: string[]; day?: string; stage?: "idea" } | null>(null);
  const [planning, setPlanning] = useState<{ piece: ContentRow; day: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [idea, setIdea] = useState("");
  const [weekStart, setWeekStart] = useState(mondayOf(localDayKey()));
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });

  // W9.2: a Cancelled piece stays in history (its panel and Tasks) but leaves the tab's views.
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.stage !== "cancelled"), [data?.items]);
  const settings = data?.settings ?? null;
  const tz = data?.timeZone ?? "UTC";
  const live = (settings?.channels ?? []).filter((c) => !c.archived);
  const ideas = items.filter((i) => i.stage === "idea");
  const planned = items.map((i) => ({ ...i, publishAt: typeof i.typeFields.publishAt === "string" ? i.typeFields.publishAt : null }));
  const thisWeek = weekDays(mondayOf(localDayKey()), planned, tz).flatMap((d) => d.items).length;
  const toSchedule = planned.filter((i) => i.stage !== "idea" && i.stage !== "published" && !i.publishAt);
  const name = (r: ContentRow) => (r.taskNumber && data?.projectKey ? formatTaskId(data.projectKey, r.taskNumber) : "");
  const href = (id: string) => `/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({ tab: "tasks", drawerType: "task", drawerId: id }).toString()}`;
  const channelsOf = (r: ContentRow) => (Array.isArray(r.typeFields.channels) ? (r.typeFields.channels as string[]) : []).map((c) => settings?.channels.find((x) => x.id === c)).filter(Boolean) as ContentChannel[];
  const marks = (r: ContentRow) => <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">{channelsOf(r).map((c) => <ChannelMark key={c.id} channel={c} withName={false} />)}</span>;

  async function addIdea() {
    const title = idea.trim();
    if (!title) return;
    const r = await addIdeaAction({ projectId, title });
    if (!r.success) return void toast.error(r.error);
    setIdea("");
    await refresh();
  }
  // W3 and W9: an idea dropped on a day is planned (Plan asks the time and sprint); a dated piece keeps its time.
  function moveItem(item: { id: string }, day: string | null) {
    const piece = items.find((i) => i.id === item.id);
    if (!piece || !day) return Boolean(piece);
    if (piece.stage === "idea") { setPlanning({ piece, day }); return true; }
    const at = typeof piece.typeFields.publishAt === "string" ? zonedParts(new Date(piece.typeFields.publishAt), tz).time : undefined;
    void planContentAction({ projectId, taskId: piece.id, day, ...(at ? { time: at } : {}) }).then(async (r) => {
      if (!r.success) return void toast.error(r.error);
      toast(`${piece.title} moved to ${day}`);
      await refresh();
    });
    return true;
  }

  const card = (r: ContentRow) => (
    <div key={r.id} draggable={Boolean(data?.canEdit)} onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; }} data-testid="content-card"
      className={cn("space-y-1.5 rounded-[6px] border border-border bg-card p-2.5", data?.canEdit && "cursor-grab")}>
      <Link href={href(r.id)} aria-label={`Content ${name(r)}, ${r.title}, ${stageLabel(r.stage)}`} className="flex items-start gap-1.5 text-[13px] font-medium text-foreground hover:underline">
        <PenLine aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0">{r.title}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{name(r)}</span>{marks(r)}
        {typeof r.typeFields.publishAt === "string" ? <span className="font-mono">{new Date(r.typeFields.publishAt).toLocaleString(undefined, { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}
        {(() => {
          // W7.4: "Published on 1 of 2" until every channel has its link.
          const chs = Array.isArray(r.typeFields.channels) ? (r.typeFields.channels as string[]).filter((c) => !settings?.channels.find((x) => x.id === c)?.archived) : [];
          const done = chs.filter((c) => (r.typeFields.published as Record<string, unknown> | undefined)?.[c]).length;
          return done > 0 && done < chs.length ? <span className="font-mono" data-testid="content-partial">Published on {done} of {chs.length}</span> : null;
        })()}
        <span className="ml-auto truncate">{r.assigneeName ?? ""}</span>
      </div>
      {data?.canEdit ? (r.stage === "idea"
        ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPlanning({ piece: r, day: null })}>Plan…</button>
        : <TaskStageControl projectId={projectId} task={{ id: r.id, itemType: "content", stage: r.stage, status: r.status, sprintId: r.sprintId, title: r.title }} canEdit canPlanSprints={canPlanSprints}
            sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name, status: s.status ?? "" }))} compact onMoved={() => void refresh()} />) : null}
    </div>
  );

  const ideasRail = (
    <aside aria-label="Ideas" className="w-full shrink-0 space-y-2 lg:order-first lg:w-60" data-testid="content-ideas">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold"><Lightbulb aria-hidden="true" className="size-3.5" />Ideas <span className="font-mono font-normal text-muted-foreground">{ideas.length}</span></h3>
      {data?.canEdit ? (
        <div className="flex gap-1.5">
          <input value={idea} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addIdea(); } }} placeholder="+ Add idea" aria-label="Add idea" maxLength={200}
            className={cn(inputClassName(false), "h-8 text-xs")} />
        </div>
      ) : null}
      <div className="space-y-1.5">
        {ideas.map((r) => (
          <div key={r.id} draggable={Boolean(data?.canEdit)} onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; }} data-testid="idea-card"
            className={cn("rounded-[5px] border border-border bg-card px-2 py-1.5 text-[12px]", data?.canEdit && "cursor-grab")}>
            <Link href={href(r.id)} className="block truncate font-medium hover:underline">{r.title}</Link>
            <div className="mt-0.5 flex items-center gap-1.5">{marks(r)}{data?.canEdit ? <button type="button" className="ml-auto text-[11px] font-medium text-primary hover:underline" onClick={() => setPlanning({ piece: r, day: null })}>Plan…</button> : null}</div>
          </div>
        ))}
        {!ideas.length ? <p className="text-[12px] text-muted-foreground">Ideas wait here until they get a date.</p> : null}
      </div>
      {live.length ? (
        <div className="space-y-1 border-t border-border pt-2">
          <h3 className="text-[12px] font-semibold">Channels</h3>
          {live.map((c) => <p key={c.id} className="flex items-center justify-between text-[12px] text-muted-foreground"><ChannelMark channel={c} />{c.audience != null ? <span className="font-mono">{c.audience.toLocaleString()}</span> : null}</p>)}
        </div>
      ) : null}
    </aside>
  );

  return (
    <section aria-label="Content" className="space-y-4" data-testid="content-tab">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <h2 className="inline-flex items-center gap-2 text-[20px] font-semibold tracking-tight"><PenLine aria-hidden="true" className="size-5" />Content</h2>
        <span className="font-mono text-[12px] text-muted-foreground" data-testid="content-counts">{thisWeek} this week · {ideas.length} {ideas.length === 1 ? "idea" : "ideas"}</span>
        <div className="ml-auto flex items-center gap-2">
          {data?.canEdit && settings ? <button type="button" onClick={() => setCreating({})} className={FORM_PRIMARY_CLASS}>New piece</button> : null}
          {data?.canManage && settings ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Content actions" className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEditing(true)}>Channels and types</DropdownMenuItem></DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-40 rounded-[8px]" /> : null}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load content · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}

      {data && !settings ? (data.canManage ? (
        <div className="space-y-2" data-testid="content-setup">
          <p className="text-[13px] text-muted-foreground">What do you publish? Pick Blog, Social or both, then your channels.</p>
          <ContentSettingsEditor projectId={projectId} current={null} inline onDone={() => void refresh()} />
        </div>
      ) : <p className="text-[13px] text-muted-foreground" data-testid="content-setup">An owner or admin sets up Content’s channels first.</p>) : null}

      {data && settings ? (
        <>
          {/* S2: one quick-add per channel, and Cross-channel (phones use New piece). */}
          {data.canEdit && !phone ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Add to a channel" data-testid="content-quick-adds">
              {live.map((c) => <button key={c.id} type="button" onClick={() => setCreating({ channels: [c.id] })} className={cn(FORM_SECONDARY_CLASS, "inline-flex h-8 items-center gap-1 text-xs")}><Plus aria-hidden="true" className="size-3" /><ChannelMark channel={c} /></button>)}
              <button type="button" onClick={() => setCreating({ channels: live.map((c) => c.id) })} className={cn(FORM_SECONDARY_CLASS, "inline-flex h-8 items-center gap-1 text-xs")}><Plus aria-hidden="true" className="size-3" />Cross-channel</button>
            </div>
          ) : null}

          <UnderlineTabs label="Content view" idPrefix="content-view" value={view} onChange={pickView} className="min-h-10"
            tabs={[{ key: "calendar" as const, label: "Calendar" }, { key: "week" as const, label: "This week" }, { key: "board" as const, label: "Board" }, { key: "schedule" as const, label: "To schedule" }, { key: "performance" as const, label: "Performance" }]} />

          <div id={`content-view-panel-${view}`} role="tabpanel" aria-labelledby={`content-view-tab-${view}`} className="space-y-4">
            {view === "calendar" ? (
              <>
                {!items.length ? <p className="text-[13px] text-muted-foreground">Plan what you’ll publish and when. Ideas wait on the left until they get a date.</p> : null}
                <TasksCalendar projectId={projectId} scope="all" filters={EMPTY_FILTERS} viewerId={currentUserId} canEdit={data.canEdit} onlyType="content" rail={ideasRail}
                  onOpenTask={(item) => router.push(href(item.id))} onNewOnDay={(day) => setCreating({ day })} onMoveItem={moveItem} />
              </>
            ) : null}

            {view === "week" ? (() => {
              const days = weekDays(weekStart, planned, tz);
              return (
                <div className="space-y-3" data-testid="content-week">
                  {phone ? ideasRail : null}
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))} className="nb-touch-target inline-flex size-[30px] items-center justify-center rounded-[5px] border border-border bg-card hover:bg-muted"><ChevronLeft className="size-4" /></button>
                    <h3 className="text-[14px] font-semibold" aria-live="polite">Week of {new Date(`${weekStart}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</h3>
                    <button type="button" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))} className="nb-touch-target inline-flex size-[30px] items-center justify-center rounded-[5px] border border-border bg-card hover:bg-muted"><ChevronRight className="size-4" /></button>
                  </div>
                  {days.map((d) => (
                    <div key={d.key} role="group" aria-label={new Date(`${d.key}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
                      <h4 className={cn("mb-1 font-mono text-[11px] uppercase tracking-wide", d.key === localDayKey() ? "text-primary" : "text-muted-foreground")}>{new Date(`${d.key}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</h4>
                      {d.items.length ? (
                        <div className="divide-y divide-border rounded-[8px] border border-border bg-card">
                          {d.items.map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]" data-testid="week-row">
                              <span className="font-mono text-[12px] text-muted-foreground">{r.time}</span>
                              {marks(r)}
                              <Link href={href(r.id)} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.title}</Link>
                              <span className="text-[12px] text-muted-foreground">{stageLabel(r.stage)}</span>
                              <span className="text-[12px] text-muted-foreground">{r.assigneeName ?? ""}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-[12px] text-muted-foreground">Nothing publishing</p>}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Times in {tz}.</p>
                </div>
              );
            })() : null}

            {view === "board" ? (
              <div className="grid gap-3 max-md:grid-flow-col max-md:auto-cols-[minmax(250px,1fr)] max-md:overflow-x-auto md:grid-cols-5" tabIndex={0} aria-label="Content stages">
                {BOARD.map((stage) => {
                  const list = items.filter((r) => r.stage === stage);
                  return (
                    <div key={stage} aria-label={`${stageLabel(stage)}, ${list.length}`} data-testid="content-column" className="min-h-40 space-y-2 rounded-[8px] border border-border bg-muted/30 p-2">
                      <h3 className="flex items-center gap-2 px-1 text-[12px] font-semibold">{stageLabel(stage)} <span className="font-mono font-normal text-muted-foreground">{list.length}</span></h3>
                      {list.map(card)}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {view === "schedule" ? (
              <div className="divide-y divide-border rounded-[8px] border border-border bg-card" data-testid="content-schedule">
                {toSchedule.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]" data-testid="schedule-row">
                    <Link href={href(r.id)} className="min-w-0 flex-1 truncate font-medium hover:underline"><span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{name(r)}</span>{r.title}</Link>
                    {marks(r)}
                    <span className="text-[12px] text-muted-foreground">{stageLabel(r.stage)}</span>
                    <span className="text-[12px] text-muted-foreground">{r.assigneeName ?? "No writer"}</span>
                    {data.canEdit ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPlanning({ piece: r, day: null })}>Set date</button> : null}
                  </div>
                ))}
                {!toSchedule.length ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Everything planned has a date.</p> : null}
              </div>
            ) : null}
            {view === "performance" ? <ContentPerformance items={items} channels={settings.channels} timeZone={tz} thisMonday={mondayOf(localDayKey())} href={href} /> : null}
          </div>
        </>
      ) : null}

      {creating ? (
        <CreateTaskModal isOpen onClose={() => setCreating(null)} projectId={projectId} projectName={projectName} projectKey={data?.projectKey ?? null}
          members={members as never} sprints={sprintOptions} types={["content"]} initialType="content" openedFrom={creating.stage === "idea" ? "own" : "tasks"} canAssignSprint={canPlanSprints}
          initialChannels={creating.channels} initialDueDate={creating.day}
          onCreate={async (value) => {
            const r = await createTaskAction({ ...buildTaskSubmitPayload({ draft: value.draft, projectId, subtasks: value.subtasks, attachments: value.attachments }) } as never);
            if (!r.success) return { success: false, error: r.error ?? "Couldn’t add the piece" };
            await refresh();
            return { success: true };
          }} />
      ) : null}
      {planning && settings ? <PlanContentDialog projectId={projectId} piece={planning.piece} day={planning.day} defaultTime={settings.defaultTime} timeZone={tz}
        sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name, status: s.status ?? null }))} canPlanSprints={canPlanSprints} onDone={(done) => { setPlanning(null); if (done) void refresh(); }} /> : null}
      {editing && settings ? <ContentSettingsEditor projectId={projectId} current={settings} onDone={(saved) => { setEditing(false); if (saved) void queryClient.invalidateQueries({ queryKey: contentKey(projectId) }); }} /> : null}
    </section>
  );
}
