"use client";

import {
  Archive,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  XCircle,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatSprintDateRange,
  formatSprintTimelineStamp,
  SPRINT_STATUS_PRESENTATION,
  isSprintReadyToClose,
  type SprintListItem,
  type SprintPermissionSet,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

interface SprintHeaderProps {
  sprint: SprintListItem;
  permissions: SprintPermissionSet;
  isMutatingLifecycle: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onArchive: () => void;
  onCancel: () => void;
}

export function SprintHeader({
  sprint,
  permissions,
  isMutatingLifecycle,
  onEdit,
  onComplete,
  onArchive,
  onCancel,
}: SprintHeaderProps) {
  const goal = sprint.goal?.trim();
  const description = sprint.description?.trim();
  const computedStatus = sprint.status;
  const status = SPRINT_STATUS_PRESENTATION[computedStatus];
  const readyToClose = isSprintReadyToClose(sprint);
  const completedAt = sprint.completedAt ?? sprint.updatedAt ?? null;
  const canOpenMenu =
    (permissions.canComplete && readyToClose) ||
    (permissions.canWrite && sprint.status !== "archived");

  return (
    <header className="mb-8 flex items-start justify-between gap-4 border-b border-border pb-5 max-md:mb-5 max-md:pb-4">
      <div className="min-w-0 flex-1">
        {/* Phones stack title, meta, then actions so the title keeps the full width (spec §21). */}
        <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="nb-section-title text-foreground">
                {sprint.name}
              </h2>
              {goal ? <span className="text-muted-foreground">—</span> : null}
              {goal ? (
                <p className="nb-body text-muted-foreground">
                  {goal}
                </p>
              ) : null}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "nb-status rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em]",
                  status.toneClassName,
                )}
              >
                {status.label}
              </span>
              {sprint.startDate || sprint.endDate ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {formatSprintDateRange(sprint.startDate, sprint.endDate)}
                </span>
              ) : null}
              {computedStatus === "planning" ? (
                <span className="font-mono text-xs text-muted-foreground">
                  Starts automatically on schedule
                </span>
              ) : computedStatus === "completed" && completedAt ? (
                <span className="font-mono text-xs text-muted-foreground">
                  Completed {formatSprintTimelineStamp(completedAt)}
                </span>
              ) : readyToClose ? (
                <span className="nb-status nb-sprint-tone-warning">
                  Close-out required
                </span>
              ) : null}
            </div>

            {description ? (
              <p className="nb-compact mt-2 line-clamp-2 max-w-3xl text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-3 max-md:w-full max-md:justify-between">
            <span className="nb-micro font-mono text-xs font-medium uppercase tracking-[0.09em] text-muted-foreground">
              {sprint.code}
            </span>

            {permissions.canWrite || canOpenMenu ? (
              <div className="flex shrink-0 items-center gap-2">
                {permissions.canComplete && readyToClose ? (
                  <button
                    type="button"
                    onClick={onComplete}
                    disabled={isMutatingLifecycle}
                    className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-primary bg-primary px-3 text-primary-foreground transition-[background-color,border-color,transform] duration-150 hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:translate-y-px active:border-[var(--primary-active)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                    Close sprint
                  </button>
                ) : null}

                {/* Only a Planning sprint can be edited; the server rejects the rest. */}
                {permissions.canWrite && sprint.status === "planning" ? (
                  <button
                    type="button"
                    onClick={onEdit}
                    disabled={isMutatingLifecycle}
                    className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center gap-1.5 rounded-[5px] border border-border bg-card px-3 text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-input hover:bg-muted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    Edit
                  </button>
                ) : null}

                {canOpenMenu ? (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Sprint lifecycle options"
                        disabled={isMutatingLifecycle}
                        className="nb-touch-target inline-flex h-[34px] w-[34px] items-center justify-center rounded-[5px] border border-border bg-card text-muted-foreground transition-[background-color,border-color,transform] duration-150 hover:border-input hover:bg-muted hover:text-foreground active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MoreHorizontal
                          aria-hidden="true"
                          className="h-4 w-4"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {permissions.canComplete && readyToClose ? (
                        <DropdownMenuItem onSelect={onComplete}>
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-4 w-4"
                          />
                          Close sprint
                        </DropdownMenuItem>
                      ) : null}
                      {permissions.canComplete &&
                      readyToClose &&
                      permissions.canWrite ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      {permissions.canWrite &&
                      (computedStatus === "planning" ||
                        computedStatus === "active") ? (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={onCancel}
                        >
                          <XCircle aria-hidden="true" className="h-4 w-4" />
                          Cancel sprint
                        </DropdownMenuItem>
                      ) : null}
                      {permissions.canWrite &&
                      (computedStatus === "completed" ||
                        computedStatus === "cancelled") ? (
                        <DropdownMenuItem onSelect={onArchive}>
                          <Archive aria-hidden="true" className="h-4 w-4" />
                          Archive sprint
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
