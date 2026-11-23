"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Inbox, MoreHorizontal, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { answerSolvedAction, readRequestsAction, type RequestRow } from "@/app/actions/requests";
import { changeTaskTypeAction } from "@/app/actions/task";
import { createTaskAction } from "@/app/actions/workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import CreateTaskModal from "@/components/workspaces/v2/tasks/CreateTaskModal";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { AcceptRequestDialog, DeclineRequestDialog, RequestTypesDialog, TextDialog, typesKey, WorkingHoursDialog } from "@/components/workspaces/v2/tasks/RequestParts";
import { TaskStageControl } from "@/components/workspaces/v2/tasks/TaskStageControl";
import { useAddedWorkflows } from "@/components/workspaces/workflows/added-workflows";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { clockText, hoursLine } from "@/lib/workflows/request-clock";
import { inboxOrder } from "@/lib/workflows/requests";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { buildTaskSubmitPayload } from "@/lib/workspaces/task-draft";
import { normalizeAssignableMembers, normalizeSprintOptions } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.7 T4 (plan A2.4): the Requests tab. Title row and Inbox · Board · Mine · My asks. Accept and Decline from
 * the Inbox (A, D on a focused row); a request opens in the task panel. A2.5: the clock on rows and cards, Breaching
 * soon, and Working hours.
 */
type View = "inbox" | "board" | "mine" | "asks" | "breaching";
const BOARD = ["new", "accepted", "in_progress", "in_review", "delivered"];
const OPEN = ["accepted", "in_progress", "in_review"];
const stageLabel = (s: string | null) => WORKFLOW_TYPES.request!.stages.find((x) => x.key === s)?.label ?? "New";
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

export function RequestsTab({ projectId, projectSlug, projectName, currentUserId, members, sprints, canPlanSprints }: {
  projectId: string; projectSlug: string; projectName: string; currentUserId: string | null; members: unknown[]; sprints: unknown[]; canPlanSprints: boolean;
}) {
  const queryClient = useQueryClient();
  const key = [...queryKeys.project.detail.tasksRoot(projectId), "requests"];
  const query = useQuery({ queryKey: key, queryFn: () => readRequestsAction(projectId), refetchInterval: 30_000 });
  const data = query.data?.success ? query.data : null;
  const assignable = useMemo(() => normalizeAssignableMembers(members as never[]), [members]);
  const sprintOptions = useMemo(() => normalizeSprintOptions(sprints as never[]), [sprints]);
  const bugsAdded = useAddedWorkflows().includes("bugs");
  const [view, setView] = useState<View>("inbox");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(`nb:requests-view:${projectId}`); } catch { /* private window */ }
    if (saved === "inbox" || saved === "board" || saved === "mine" || saved === "asks" || saved === "breaching") setView(saved);
  }, [projectId]);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(`nb:requests-view:${projectId}`, v); } catch { /* private window */ } };
  const [asking, setAsking] = useState(false);
  const [editingTypes, setEditingTypes] = useState(false);
  const [editingHours, setEditingHours] = useState(false);
  const [notSolved, setNotSolved] = useState<RequestRow | null>(null);
  const [answering, setAnswering] = useState(false);
  const [accepting, setAccepting] = useState<RequestRow | null>(null);
  const [declining, setDeclining] = useState<RequestRow | null>(null);
  const [requested, setRequested] = useState<{ id: string; stage: string; nonce: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });

  const all = data?.requests ?? [];
  const canTriage = Boolean(data?.canTriage);
  const typeName = (r: RequestRow) => data?.types.find((t) => t.id === r.typeFields.requestTypeId)?.name ?? "Request";
  const name = (r: RequestRow) => (r.taskNumber && data?.projectKey ? formatTaskId(data.projectKey, r.taskNumber) : "the request");
  const href = (r: RequestRow) => `/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({ tab: "tasks", drawerType: "task", drawerId: r.id }).toString()}`;
  const inbox = inboxOrder(all);
  // W7.1: accepted requests under 20 % left, and New ones near their first-reply time, by time left.
  const breaching = all.filter((r) => r.clock && (r.clock.state === "soon" || r.clock.state === "breached")).sort((a, b) => a.clock!.leftMinutes - b.clock!.leftMinutes);
  const clockLine = (r: RequestRow) => {
    if (!r.clock || r.clock.state === "off") return null;
    // W5.2: "Waiting on Mei · paused".
    const waitingOn = (r.typeFields.waiting as { onUserId?: string } | null)?.onUserId;
    const who = waitingOn ? (waitingOn === r.creatorId ? r.creatorName : assignable.find((m) => m.id === waitingOn)?.label) ?? "someone" : null;
    const words = `${who ? `Waiting on ${who} · ` : ""}${clockText(r.clock, r.clock.kind === "first" ? "Replied" : "Delivered")}`;
    const label = r.clock.kind === "first" ? "First reply" : "Deliver";
    return <span className={cn("inline-flex items-center gap-1 font-mono text-[11px]", r.clock.state === "breached" ? "text-destructive" : r.clock.state === "soon" ? "text-[var(--primary-active)] dark:text-primary" : "text-muted-foreground")} data-testid="request-clock">
      <Timer aria-hidden="true" className="size-3" /><span className="sr-only">{label}: </span>{words}</span>;
  };
  const memberOptions = assignable.map((m) => ({ id: m.id, label: m.label }));

  async function solved(r: RequestRow, note?: string) {
    setAnswering(true);
    const result = await answerSolvedAction({ projectId, taskId: r.id, solved: note ? "no" : "yes", ...(note ? { note } : {}) });
    setAnswering(false);
    if (!result.success) return void toast.error(result.error);
    toast(note ? `${name(r)} reopened · the handler is told` : `${name(r)} marked solved`);
    setNotSolved(null);
    await refresh();
  }

  async function toBug(r: RequestRow) {
    const result = await changeTaskTypeAction({ projectId, taskIds: [r.id], toType: "bug" });
    if (!result.success) return void toast.error(result.error);
    toast(`${name(r)} is a bug now · in Bugs at Confirmed`);
    await refresh();
  }

  const chip = (r: RequestRow) => <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{typeName(r)}</span>;
  const card = (r: RequestRow) => (
    <div key={r.id} draggable={canTriage} onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; }} data-testid="request-card"
      className={cn("space-y-1.5 rounded-[6px] border border-border bg-card p-2.5", canTriage && "cursor-grab")}>
      <Link href={href(r)} aria-label={`Request ${name(r)}, ${r.title}, ${typeName(r)}, ${stageLabel(r.stage)}`} className="flex items-start gap-1.5 text-[13px] font-medium text-foreground hover:underline">
        <Inbox aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0">{r.title}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{name(r)}</span>{chip(r)}
        {r.dueDate ? <span className="inline-flex items-center gap-0.5 font-mono"><CalendarDays aria-hidden="true" className="size-3" />{day(r.dueDate)}</span> : null}
        {clockLine(r)}
        <span className="ml-auto truncate">{r.assigneeName ? r.assigneeName : `from ${r.creatorName ?? "someone"}`}</span>
      </div>
      {canTriage && r.stage === "new" ? (
        <div className="flex gap-1.5">
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAccepting(r)}>Accept</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDeclining(r)}>Decline</button>
        </div>
      ) : canTriage && r.stage !== "declined" ? (
        <TaskStageControl projectId={projectId} task={{ id: r.id, itemType: "request", stage: r.stage, status: r.status, sprintId: r.sprintId, title: r.title }} canEdit canPlanSprints={canPlanSprints}
          sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name, status: s.status ?? "" }))} compact requested={requested?.id === r.id ? requested : null} onMoved={() => void refresh()} />
      ) : null}
    </div>
  );

  return (
    <section aria-label="Requests" className="space-y-4" data-testid="requests-tab">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <h2 className="inline-flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Inbox aria-hidden="true" className="size-5" />Requests</h2>
        <span className="font-mono text-[12px] text-muted-foreground" data-testid="requests-counts">{inbox.length} new · {breaching.length} breaching soon</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setAsking(true)} className={FORM_PRIMARY_CLASS}>New request</button>
          {data?.canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Requests actions" className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditingTypes(true)}>Request types</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditingHours(true)}>Working hours</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <UnderlineTabs label="Requests view" idPrefix="requests-view" value={view} onChange={pickView} className="min-h-10"
        tabs={[{ key: "inbox" as const, label: "Inbox" }, { key: "board" as const, label: "Board" }, { key: "mine" as const, label: "Mine" }, { key: "asks" as const, label: "My asks" }, { key: "breaching" as const, label: "Breaching soon" }]} />

      <div id={`requests-view-panel-${view}`} role="tabpanel" aria-labelledby={`requests-view-tab-${view}`} className="space-y-4">
        {query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-40 rounded-[8px]" /> : null}
        {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load requests · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}

        {/* W1.2: owners and admins see what the clock follows. */}
        {data?.canManage && view === "inbox" ? (
          <p className="text-xs text-muted-foreground" data-testid="hours-note">Response times follow working hours: {hoursLine(data.hours, data.timeZone)}. <button type="button" className="text-primary hover:underline" onClick={() => setEditingHours(true)}>Change</button></p>
        ) : null}
        {data && view === "inbox" ? (
          !all.length ? (
            <div className="nb-empty-state rounded-[8px] border border-border bg-card px-4 py-8 text-center" data-testid="requests-empty">
              <p className="text-[13px] text-muted-foreground">No requests yet. People in the workspace ask here; you choose what to take on.</p>
              <button type="button" className={cn(FORM_PRIMARY_CLASS, "mt-3")} onClick={() => setAsking(true)}>New request</button>
            </div>
          ) : (
            <div className="divide-y divide-border rounded-[8px] border border-border bg-card" data-testid="requests-inbox">
              {inbox.map((r, i) => (
                <div key={r.id} tabIndex={0} aria-label={`${name(r)} ${r.title}`} data-testid="inbox-row"
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const rows = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-testid=inbox-row]") ?? [])];
                    if (e.key === "j" || e.key === "k") { e.preventDefault(); rows[Math.max(0, Math.min(inbox.length - 1, i + (e.key === "j" ? 1 : -1)))]?.focus(); }
                    if (e.key === "Enter") e.currentTarget.querySelector<HTMLAnchorElement>("a")?.click();
                    if (canTriage && e.key === "a") { e.preventDefault(); setAccepting(r); }
                    if (canTriage && e.key === "d") { e.preventDefault(); setDeclining(r); }
                  }}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  {chip(r)}
                  <Link href={href(r)} className="min-w-0 flex-1 truncate font-medium hover:underline"><span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{name(r)}</span>{r.title}</Link>
                  <span className="text-[12px] text-muted-foreground">{r.creatorName ?? "Someone"}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.dueDate ? `Need by ${day(r.dueDate)}` : "No need-by"}</span>
                  {clockLine(r)}
                  {canTriage ? <button type="button" onClick={() => setAccepting(r)} className={FORM_SECONDARY_CLASS}>Accept</button> : null}
                  {canTriage ? <button type="button" onClick={() => setDeclining(r)} className={FORM_SECONDARY_CLASS}>Decline</button> : null}
                  {canTriage && bugsAdded ? <button type="button" onClick={() => void toBug(r)} className={FORM_SECONDARY_CLASS}>This is a bug</button> : null}
                </div>
              ))}
              {!inbox.length ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing new.</p> : null}
            </div>
          )
        ) : null}

        {data && view === "board" ? (
          <div className="grid gap-3 max-md:grid-flow-col max-md:auto-cols-[minmax(250px,1fr)] max-md:overflow-x-auto md:grid-cols-5" tabIndex={0} aria-label="Request stages">
            {BOARD.map((stage) => {
              const list = all.filter((r) => r.stage === stage);
              return (
                <div key={stage} aria-label={`${stageLabel(stage)}, ${list.length}`} data-testid="request-column"
                  onDragOver={(e) => { if (!canTriage) return; e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault(); setOver(null);
                    const r = all.find((x) => x.id === e.dataTransfer.getData("text/plain"));
                    if (!r || r.stage === stage) return;
                    // S3: New → Accepted opens the Accept form; leaving New any other way is Accept or Decline.
                    if (r.stage === "new") { if (stage === "accepted") setAccepting(r); else toast("Accept or decline a new request first"); return; }
                    setRequested({ id: r.id, stage, nonce: Date.now() });
                  }}
                  className={cn("min-h-40 space-y-2 rounded-[8px] border border-border bg-muted/30 p-2", over === stage && "bg-primary/10 outline outline-1 outline-primary/40")}>
                  <h3 className="flex items-center gap-2 px-1 text-[12px] font-semibold">{stageLabel(stage)} <span className="font-mono font-normal text-muted-foreground">{list.length}</span></h3>
                  {list.map(card)}
                </div>
              );
            })}
          </div>
        ) : null}

        {data && view === "breaching" ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="requests-breaching">
            {breaching.map(card)}
            {!breaching.length ? <p className="text-[13px] text-muted-foreground">Nothing is close to its response time.</p> : null}
          </div>
        ) : null}

        {data && (view === "mine" || view === "asks") ? (() => {
          const list = view === "mine"
            ? all.filter((r) => r.assigneeId === currentUserId && OPEN.includes(r.stage ?? ""))
            : all.filter((r) => r.creatorId === currentUserId);
          return (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid={`requests-${view}`}>
              {list.map((r) => (
                <div key={r.id} className="space-y-1">
                  {card(r)}
                  {view === "asks" ? <p className="px-1 text-[11px] text-muted-foreground">{stageLabel(r.stage)}{r.stage === "declined" && r.typeFields.declineReason ? ` · ${String(r.typeFields.declineReason)}` : ""}{r.typeFields.solved === "yes" ? " · Solved" : ""}</p> : null}
                  {/* W8: Yes / No on delivered asks. */}
                  {view === "asks" && r.stage === "delivered" && !r.typeFields.solved ? (
                    <div className="flex items-center gap-1.5 px-1" data-testid="asks-solved">
                      <span className="mr-auto text-[12px] font-medium">Did this solve it?</span>
                      <button type="button" className={FORM_SECONDARY_CLASS} disabled={answering} onClick={() => void solved(r)}>Yes</button>
                      <button type="button" className={FORM_SECONDARY_CLASS} disabled={answering} onClick={() => setNotSolved(r)}>No</button>
                    </div>
                  ) : null}
                </div>
              ))}
              {!list.length ? <p className="text-[13px] text-muted-foreground">{view === "mine" ? "No requests assigned to you." : "You haven’t asked for anything yet."}</p> : null}
            </div>
          );
        })() : null}
      </div>

      {asking ? (
        <CreateTaskModal isOpen onClose={() => setAsking(false)} projectId={projectId} projectName={projectName} projectKey={data?.projectKey ?? null}
          members={members as never} sprints={sprintOptions} types={["request"]} initialType="request" openedFrom="own" canAssignSprint={canPlanSprints}
          onCreate={async (value) => {
            const r = await createTaskAction({ ...buildTaskSubmitPayload({ draft: value.draft, projectId, subtasks: value.subtasks, attachments: value.attachments }) } as never);
            if (!r.success) return { success: false, error: r.error ?? "Couldn’t send the request" };
            await refresh();
            return { success: true };
          }} />
      ) : null}
      {accepting ? <AcceptRequestDialog projectId={projectId} request={accepting} label={name(accepting)} members={memberOptions}
        sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name, status: s.status ?? null }))} canPlanSprints={canPlanSprints} onDone={(done) => { setAccepting(null); if (done) void refresh(); }} /> : null}
      {declining ? <DeclineRequestDialog projectId={projectId} request={declining} label={name(declining)} onDone={(done) => { setDeclining(null); if (done) void refresh(); }} /> : null}
      {notSolved ? <TextDialog title="Not solved yet" label="What’s still missing?" placeholder="The dark version too" busy={answering} action="Reopen" onClose={() => setNotSolved(null)} onSave={(note) => void solved(notSolved, note)} /> : null}
      {editingHours && data ? <WorkingHoursDialog projectId={projectId} hours={data.hours} timeZone={data.hoursSet || data.timeZone !== "UTC" ? data.timeZone : null} onClose={(saved) => { setEditingHours(false); if (saved) void refresh(); }} /> : null}
      {editingTypes ? <RequestTypesDialog projectId={projectId} members={memberOptions} onClose={() => { setEditingTypes(false); void queryClient.invalidateQueries({ queryKey: typesKey(projectId) }); void refresh(); }} /> : null}
    </section>
  );
}
