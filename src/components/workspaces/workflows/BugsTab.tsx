"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { confirmBugAction, readBugsAction, setBugFieldsAction, type BugRow } from "@/app/actions/bugs";
import { createTaskAction } from "@/app/actions/workspace";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import CreateTaskModal from "@/components/workspaces/v2/tasks/CreateTaskModal";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { TaskStageControl } from "@/components/workspaces/v2/tasks/TaskStageControl";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatTaskId } from "@/lib/workspace-key";
import { fixedGroups, openSeverityCounts, SEVERITIES, severityGroups, severityLabel, triageOrder, whereLabel, type Severity, type Where } from "@/lib/workflows/bugs";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { buildTaskSubmitPayload } from "@/lib/workspaces/task-draft";
import { normalizeAssignableMembers, normalizeSprintOptions } from "@/lib/workspaces/task-presentation";

/**
 * Report 38.6 T3 (plan A2.1): the Bugs tab. Title row, the Open by severity strip, and Triage · Board · Mine · Fixed.
 * A bug opens in the task panel (Tasks tab, Back returns here). Closing, duplicates and reopening arrive with A2.2.
 */
type View = "triage" | "board" | "mine" | "fixed";
const BOARD = ["new", "confirmed", "fixing", "fixed", "verified"];
const stageLabel = (s: string | null) => WORKFLOW_TYPES.bug!.stages.find((x) => x.key === s)?.label ?? "New";
const SEVERITY_CLASS: Record<string, string> = {
  urgent: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  major: "border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  minor: "border-border bg-muted text-muted-foreground",
};
const ago = (iso: string) => { const d = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)); return d === 0 ? "today" : `${d}d`; };
const seen = (b: BugRow) => (Array.isArray(b.typeFields.alsoSeen) ? b.typeFields.alsoSeen.length : 0);

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  return severity ? <span className={cn("inline-flex h-5 items-center rounded-[3px] border px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide", SEVERITY_CLASS[severity])}>{severityLabel(severity)}</span> : null;
}

export function BugsTab({ projectId, projectSlug, projectName, currentUserId, members, sprints, canPlanSprints }: {
  projectId: string; projectSlug: string; projectName: string; currentUserId: string | null; members: unknown[]; sprints: unknown[]; canPlanSprints: boolean;
}) {
  const queryClient = useQueryClient();
  const key = [...queryKeys.project.detail.tasksRoot(projectId), "bugs"];
  const query = useQuery({ queryKey: key, queryFn: () => readBugsAction(projectId), refetchInterval: 30_000 });
  const data = query.data?.success ? query.data : null;
  const assignable = useMemo(() => normalizeAssignableMembers(members as never[]), [members]);
  const sprintOptions = useMemo(() => normalizeSprintOptions(sprints as never[]), [sprints]);
  const [view, setView] = useState<View>("board");
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(`nb:bugs-view:${projectId}`); } catch { /* private window */ }
    if (saved === "triage" || saved === "board" || saved === "mine" || saved === "fixed") setView(saved);
    else if (window.matchMedia("(max-width: 767px)").matches) setView("triage");
  }, [projectId]);
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(`nb:bugs-view:${projectId}`, v); } catch { /* private window */ } };
  const [severity, setSeverity] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [confirming, setConfirming] = useState<BugRow | null>(null);
  const [fixedIn, setFixedIn] = useState<BugRow | null>(null);
  const [requested, setRequested] = useState<{ id: string; stage: string; nonce: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });

  const all = data?.bugs ?? [];
  const bugs = severity ? all.filter((b) => (severity === "notSure" ? !b.typeFields.severity : b.typeFields.severity === severity)) : all;
  const counts = openSeverityCounts(all);
  const toTriage = all.filter((b) => b.stage === "new").length;
  const name = (b: BugRow) => (b.taskNumber && data?.projectKey ? formatTaskId(data.projectKey, b.taskNumber) : "");
  const href = (b: BugRow) => `/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({ tab: "tasks", drawerType: "task", drawerId: b.id }).toString()}`;
  const canTriage = Boolean(data?.canTriage);

  const card = (b: BugRow) => (
    <div key={b.id} draggable={canTriage} onDragStart={(e) => { e.dataTransfer.setData("text/plain", b.id); e.dataTransfer.effectAllowed = "move"; }} data-testid="bug-card"
      className={cn("space-y-1.5 rounded-[6px] border border-border bg-card p-2.5", canTriage && "cursor-grab")}>
      <Link href={href(b)} aria-label={`Bug ${name(b)}, ${b.title}, ${severityLabel(b.typeFields.severity as string | null)}, ${stageLabel(b.stage)}`} className="flex items-start gap-1.5 text-[13px] font-medium text-foreground hover:underline">
        <Bug aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0">{b.title}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">{name(b)}</span>
        <SeverityBadge severity={b.typeFields.severity as string | null} />
        {seen(b) ? <span className="inline-flex items-center gap-0.5"><Users aria-hidden="true" className="size-3" />{seen(b)} see it</span> : null}
        {b.typeFields.fixedIn ? <span className="font-mono">➜ {String(b.typeFields.fixedIn)}</span> : null}
        <span className="ml-auto truncate">{b.assigneeName ?? b.creatorName ?? ""}</span>
      </div>
      {canTriage ? (
        <TaskStageControl projectId={projectId} task={{ id: b.id, itemType: "bug", stage: b.stage, status: b.status, sprintId: b.sprintId }} canEdit canPlanSprints={canPlanSprints}
          sprints={sprintOptions.map((s) => ({ id: s.id, name: s.name, status: s.status ?? "" }))} compact requested={requested?.id === b.id ? requested : null}
          onMoved={(m) => { void refresh(); if (m.stage === "fixed") setFixedIn(b); }} />
      ) : null}
    </div>
  );

  return (
    <section aria-label="Bugs" className="space-y-4" data-testid="bugs-tab">
      <div className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
        <h2 className="inline-flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Bug aria-hidden="true" className="size-5" />Bugs</h2>
        <span className="font-mono text-[12px] text-muted-foreground" data-testid="bugs-counts">{counts.urgent} urgent · {toTriage} to triage</span>
        <button type="button" onClick={() => setReporting(true)} className={cn(FORM_PRIMARY_CLASS, "ml-auto")}>Report a bug</button>
      </div>

      <div role="group" aria-label="Open by severity" className="flex flex-wrap gap-2" data-testid="bugs-strip">
        {[...SEVERITIES.map((s) => ({ key: s.key as string, label: s.label, n: counts[s.key] })), ...(counts.notSure ? [{ key: "notSure", label: "Not sure", n: counts.notSure }] : [])].map((s) => (
          <button key={s.key} type="button" aria-pressed={severity === s.key} onClick={() => setSeverity(severity === s.key ? null : s.key)}
            className={cn("inline-flex h-8 items-center gap-2 rounded-[5px] border px-3 text-xs", severity === s.key ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted")}>
            <span className="font-medium">{s.label}</span><span className="font-mono text-muted-foreground">{s.n}</span>
          </button>
        ))}
      </div>

      <UnderlineTabs label="Bugs view" idPrefix="bugs-view" value={view} onChange={pickView} className="min-h-10"
        tabs={[{ key: "triage" as const, label: "Triage" }, { key: "board" as const, label: "Board" }, { key: "mine" as const, label: "Mine" }, { key: "fixed" as const, label: "Fixed" }]} />

      <div id={`bugs-view-panel-${view}`} role="tabpanel" aria-labelledby={`bugs-view-tab-${view}`} className="space-y-4">
      {query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-40 rounded-[8px]" /> : null}
      {query.data && !query.data.success ? <p className="text-[13px] text-muted-foreground">Couldn’t load bugs · <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Try again</button></p> : null}

      {data && view === "board" ? (
        <>
          {!all.length ? <p className="text-[13px] text-muted-foreground">Bugs come in on the left and leave on the right. Anyone in the workspace can report one.</p> : null}
          <div className="grid gap-3 max-md:grid-flow-col max-md:auto-cols-[minmax(250px,1fr)] max-md:overflow-x-auto md:grid-cols-5" tabIndex={0} aria-label="Bug stages">
            {BOARD.map((stage) => {
              const list = bugs.filter((b) => b.stage === stage);
              return (
                <div key={stage} aria-label={`${stageLabel(stage)}, ${list.length}`} data-testid="bug-column"
                  onDragOver={(e) => { if (!canTriage) return; e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); const b = all.find((x) => x.id === id); if (b && b.stage !== stage) setRequested({ id, stage, nonce: Date.now() }); }}
                  className={cn("min-h-40 space-y-2 rounded-[8px] border border-border bg-muted/30 p-2", over === stage && "bg-primary/10 outline outline-1 outline-primary/40")}>
                  <h3 className="flex items-center gap-2 px-1 text-[12px] font-semibold">{stageLabel(stage)} <span className="font-mono font-normal text-muted-foreground">{list.length}</span></h3>
                  {list.map(card)}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {data && view === "triage" ? (
        <div className="divide-y divide-border rounded-[8px] border border-border bg-card" data-testid="bugs-triage">
          {triageOrder(bugs).map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]" data-testid="triage-row">
              <Link href={href(b)} className="min-w-0 flex-1 truncate font-medium hover:underline"><span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{name(b)}</span>{b.title}</Link>
              <SeverityBadge severity={b.typeFields.severity as string | null} />
              <span className="text-[12px] text-muted-foreground">{whereLabel(b.typeFields.where as Where | null) ?? "—"}</span>
              <span className="text-[12px] text-muted-foreground">{b.creatorName ?? "Someone"}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{ago(b.createdAt)}</span>
              {seen(b) ? <span className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground"><Users aria-hidden="true" className="size-3" />{seen(b)}</span> : null}
              {canTriage ? <button type="button" onClick={() => setConfirming(b)} className={FORM_SECONDARY_CLASS}>Confirm</button> : null}
            </div>
          ))}
          {!triageOrder(bugs).length ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing to triage.</p> : null}
        </div>
      ) : null}

      {data && (view === "mine" || view === "fixed") ? (() => {
        const groups = view === "mine"
          ? severityGroups(bugs.filter((b) => b.assigneeId === currentUserId && BOARD.slice(0, 4).includes(b.stage ?? "")))
          : fixedGroups(bugs);
        return (
          <div className="space-y-4" data-testid={`bugs-${view}`}>
            {groups.map((g) => (
              <div key={g.name} role="group" aria-label={`${g.name}, ${g.bugs.length}`}>
                <h3 className="mb-2 text-[13px] font-semibold">{g.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">{g.bugs.length}</span></h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(g.bugs as BugRow[]).map(card)}</div>
              </div>
            ))}
            {!groups.length ? <p className="text-[13px] text-muted-foreground">{view === "mine" ? "No bugs assigned to you." : "Nothing fixed yet."}</p> : null}
          </div>
        );
      })() : null}
      </div>

      {reporting ? (
        <CreateTaskModal isOpen onClose={() => setReporting(false)} projectId={projectId} projectName={projectName} projectKey={data?.projectKey ?? null}
          members={members as never} sprints={sprintOptions} types={["bug"]} initialType="bug" openedFrom="own" canAssignSprint={canPlanSprints}
          onCreate={async (value) => {
            const r = await createTaskAction({ ...buildTaskSubmitPayload({ draft: value.draft, projectId, subtasks: value.subtasks, attachments: value.attachments }) } as never);
            if (!r.success) return { success: false, error: r.error ?? "Couldn’t report the bug" };
            await refresh();
            return { success: true };
          }} />
      ) : null}
      {confirming ? <ConfirmBug projectId={projectId} bug={confirming} name={name(confirming)} members={assignable} onDone={() => { setConfirming(null); void refresh(); }} /> : null}
      {fixedIn ? <FixedIn projectId={projectId} bug={fixedIn} name={name(fixedIn)} onDone={() => { setFixedIn(null); void refresh(); }} /> : null}
    </section>
  );
}

/** S7 Confirm: Severity (required here, call 4) and Assigned to (optional). */
function ConfirmBug({ projectId, bug, name, members, onDone }: { projectId: string; bug: BugRow; name: string; members: Array<{ id: string; label: string }>; onDone: () => void }) {
  const [severity, setSeverity] = useState<Severity | null>((bug.typeFields.severity as Severity | null) ?? null);
  const [assignee, setAssignee] = useState(bug.assigneeId ?? "");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (!severity) return;
    setBusy(true);
    const r = await confirmBugAction({ projectId, taskId: bug.id, severity, ...(assignee ? { assigneeId: assignee } : {}) });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(`${name || "Bug"} confirmed`);
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onDone(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="confirm-bug-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Confirm {name}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{bug.title}</DialogDescription>
        </div>
        <div className="space-y-3.5 px-6 py-4">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Severity <span className="text-destructive">*</span></legend>
            <div role="radiogroup" aria-label="Severity" className="inline-flex gap-1.5">
              {[...SEVERITIES].reverse().map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={severity === s.key} onClick={() => setSeverity(s.key)}
                  className={cn("h-8 rounded-[5px] border px-3 text-xs font-medium", severity === s.key ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted")}>{s.label}</button>
              ))}
            </div>
          </fieldset>
          <Field label="Assigned to" htmlFor="confirm-assignee">
            <SelectWrap>
              <select id="confirm-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectClassName()}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </SelectWrap>
          </Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onDone}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !severity} onClick={() => void confirm()}>Confirm</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** W8.2: Fixed asks Fixed in (version text, optional, up to 40 characters). */
function FixedIn({ projectId, bug, name, onDone }: { projectId: string; bug: BugRow; name: string; onDone: () => void }) {
  const [value, setValue] = useState(String(bug.typeFields.fixedIn ?? ""));
  async function save() {
    if (value.trim()) {
      const r = await setBugFieldsAction({ projectId, taskId: bug.id, fields: { fixedIn: value.trim() } });
      if (!r.success) return void toast.error(r.error);
    }
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onDone(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="fixed-in-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">{name} is Fixed</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Which version has the fix? You can leave it empty.</DialogDescription>
        </div>
        <div className="px-6 py-4">
          <Field label="Fixed in" htmlFor="fixed-in"><input id="fixed-in" autoFocus maxLength={40} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g., v2.4" className={inputClassName(false)} /></Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Skip</button>
          <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
