"use client";

import { Archive, CheckCircle2, MoreHorizontal, Pencil, Plus, XCircle } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatSprintDateRange, formatSprintTimelineStamp, type SprintListItem, type SprintPermissionSet } from "@/lib/workspaces/sprint-detail";
import { PHASE_WORDS, sprintPhase, sprintTime, startsIn, weekOf } from "@/lib/workspaces/sprint-plan";
import { cn } from "@/lib/utils";

// Sprint redesign §5.2, §4: the phase in one word, the dates and what's left, the name and the goal as a sentence, and
// one main button for the phase — Add work while it's upcoming or running, Close sprint once it has ended.

interface SprintHeaderProps {
  sprint: SprintListItem;
  permissions: SprintPermissionSet;
  isMutatingLifecycle: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onArchive: () => void;
  onCancel: () => void;
  /** Opens the Add work picker (owners and admins). */
  onAddWork?: () => void;
  /** Start now, beside Add work on an upcoming sprint. */
  startNow?: React.ReactNode;
  /** "Starts by itself" is the sprint's own setting; without it the sprint waits for Start now. */
  autoStart?: boolean;
  /** Board/review report §6: the CO this sprint sits inside (its dates give "week 3 of 6"). */
  main?: SprintListItem | null;
  /** An organization's main sprint: its main button adds a sprint inside it. */
  onAddInside?: () => void;
}

const button = "nb-touch-target nb-ui-label inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border px-3 transition-[background-color,border-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
const primary = cn(button, "border-primary bg-primary text-primary-foreground hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)]");
const secondary = cn(button, "border-border bg-card text-foreground hover:border-input hover:bg-muted");

export function SprintHeader({ sprint, permissions, isMutatingLifecycle, onEdit, onComplete, onArchive, onCancel, onAddWork, startNow, autoStart = true, main = null, onAddInside }: SprintHeaderProps) {
  const phase = sprintPhase(sprint);
  const words = PHASE_WORDS[phase];
  const time = sprintTime(sprint);
  const wait = startsIn(sprint);
  const goal = sprint.goal?.trim();
  const description = sprint.description?.trim();
  const live = phase === "upcoming" || phase === "running" || phase === "ended";
  const canClose = permissions.canComplete && sprint.status === "active";
  const canPlan = Boolean(onAddWork) && permissions.canCreate && (phase === "upcoming" || phase === "running");
  const canAddInside = Boolean(onAddInside) && permissions.canCreate && (phase === "upcoming" || phase === "running");
  const when = phase === "upcoming"
    ? (autoStart ? `Starts by itself ${wait === 0 ? "today" : `in ${wait} ${wait === 1 ? "day" : "days"}`}` : "Waits for Start now")
    : phase === "running" && time ? `${time.daysLeft} ${time.daysLeft === 1 ? "day" : "days"} left`
      : phase === "ended" ? "Needs closing"
        : phase === "closed" && sprint.completedAt ? `Closed ${formatSprintTimelineStamp(sprint.completedAt)}` : null;

  return (
    <header className="mb-5 flex items-start justify-between gap-4 max-md:flex-col max-md:gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("nb-status rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em]")} data-status={words.status}>{words.label}</span>
          {sprint.startDate || sprint.endDate ? <span className="font-mono text-xs text-muted-foreground">{formatSprintDateRange(sprint.startDate, sprint.endDate)}</span> : null}
          {when ? <span className={cn("font-mono text-xs", phase === "ended" ? "text-[var(--status-warning)]" : "text-muted-foreground")}>· {when}</span> : null}
        </div>
        {main ? <p className="font-mono text-[12px] text-muted-foreground">Inside {main.name}{weekOf(main) ? ` · ${weekOf(main)}` : ""}</p> : null}
        {!main && onAddInside && weekOf(sprint) ? <p className="font-mono text-[12px] text-muted-foreground">{weekOf(sprint)}</p> : null}
        <h2 className="nb-section-title text-foreground">{sprint.name}</h2>
        {goal ? <p className="nb-body text-foreground"><span className="text-muted-foreground">Goal: </span>{goal}</p> : null}
        {description ? <p className="nb-compact line-clamp-2 max-w-3xl whitespace-pre-line text-muted-foreground">{description}</p> : null}
      </div>
      {permissions.canWrite || canClose || canPlan || canAddInside ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {phase === "ended" && canClose ? (
            <button type="button" onClick={onComplete} disabled={isMutatingLifecycle} className={primary}>
              <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />Close sprint
            </button>
          ) : null}
          {canAddInside ? (
            <button type="button" onClick={onAddInside} disabled={isMutatingLifecycle} className={primary}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />Add a sprint inside {sprint.name}
            </button>
          ) : null}
          {canPlan ? (
            <button type="button" onClick={onAddWork} disabled={isMutatingLifecycle} className={canAddInside ? secondary : primary}>
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />Add work
            </button>
          ) : null}
          {phase === "upcoming" ? startNow : null}
          {/* Report §37.2: Edit while upcoming or running; a running sprint keeps its start. */}
          {permissions.canWrite && (sprint.status === "planning" || sprint.status === "active") ? (
            <button type="button" onClick={onEdit} disabled={isMutatingLifecycle} className={secondary}>
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />Edit
            </button>
          ) : null}
          {permissions.canWrite || canClose ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Sprint actions" disabled={isMutatingLifecycle}
                  className="nb-touch-target inline-flex h-[34px] w-[34px] items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition-colors hover:border-input hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                  <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">{sprint.code}</DropdownMenuLabel>
                {phase === "running" && canClose ? (
                  <DropdownMenuItem onSelect={onComplete}><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Complete early</DropdownMenuItem>
                ) : null}
                {permissions.canWrite && live ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onCancel}><XCircle aria-hidden="true" className="h-4 w-4" />Cancel sprint</DropdownMenuItem>
                  </>
                ) : null}
                {permissions.canWrite && (phase === "closed" || phase === "canceled") ? (
                  <DropdownMenuItem onSelect={onArchive}><Archive aria-hidden="true" className="h-4 w-4" />Archive sprint</DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
