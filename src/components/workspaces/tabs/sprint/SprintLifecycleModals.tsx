"use client";

import { Notice } from "@/components/ui/notice";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type SprintHealthSummary,
  type SprintListItem,
} from "@/lib/workspaces/sprint-detail";
import { cn } from "@/lib/utils";

type LifecycleAction = "complete" | "archive" | "cancel" | null;
type UnfinishedWorkChoice = "keep" | "backlog" | "next_sprint";

type SprintLifecycleModalsProps = {
  openModal: LifecycleAction;
  selectedSprint: SprintListItem | null;
  sprints: SprintListItem[];
  summary: SprintHealthSummary | null;
  isMutating: boolean;
  onClose: () => void;
  onConfirmComplete: (
    unfinished: UnfinishedWorkChoice,
    nextSprintId: string | null,
    closeAssignments: boolean,
  ) => Promise<boolean>;
  /** An organization sprint's open assignments (report §37.2): Complete asks whether they close too. */
  openAssignments?: number;
  onConfirmArchive: () => Promise<boolean>;
  onConfirmCancel: () => Promise<boolean>;
  /** Child projects: sprints linked to an org sprint, listed first as "Move to" targets (report §15.5). */
  linkedSprintIds?: ReadonlySet<string>;
};

/** Sprint redesign §8.7: where open work goes, in plain words; the next sprint is named in the dialog. */
const completionOptions: Array<{ value: UnfinishedWorkChoice; title: string }> = [
  { value: "next_sprint", title: "The next sprint" },
  { value: "backlog", title: "The backlog" },
  { value: "keep", title: "Stay here, for the record" },
];
const SHORT_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function SprintLifecycleModals({
  openModal,
  selectedSprint,
  sprints,
  summary,
  isMutating,
  onClose,
  onConfirmComplete,
  onConfirmArchive,
  onConfirmCancel,
  linkedSprintIds,
  openAssignments = 0,
}: SprintLifecycleModalsProps) {
  const [closeAssignments, setCloseAssignments] = useState(false);
  const [unfinishedChoice, setUnfinishedChoice] =
    useState<UnfinishedWorkChoice>("keep");
  const [nextSprintId, setNextSprintId] = useState("");
  const carryOverSprints = useMemo(
    () =>
      // The server accepts only Planning sprints as a destination.
      // Board/review report §6: a sprint inside this Unit (Phase) closes with it, so it's never where open work goes.
      sprints.filter(
        (sprint) => sprint.id !== selectedSprint?.id && sprint.status === "planning" && sprint.parentSprintId !== selectedSprint?.id,
      ).sort((a, b) => Number(Boolean(linkedSprintIds?.has(b.id))) - Number(Boolean(linkedSprintIds?.has(a.id)))),
    [selectedSprint?.id, sprints, linkedSprintIds],
  );

  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openModal) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    // The next upcoming sprint when there is one, otherwise the backlog.
    const next = sprints.filter((sprint) => sprint.id !== selectedSprint?.id && sprint.status === "planning" && sprint.parentSprintId !== selectedSprint?.id).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))[0];
    setUnfinishedChoice(next ? "next_sprint" : "backlog");
    setNextSprintId(next?.id ?? "");
    setCloseAssignments(false);
  }, [openModal, selectedSprint?.id]);

  if (!openModal || !selectedSprint) return null;

  const points = summary?.totalStoryPoints ?? 0;
  // Board/review report §6, D9: closing a Unit (Phase) closes its running sprint and cancels the upcoming ones; cancelling
  // cancels them all.
  const inside = sprints.filter((sprint) => sprint.parentSprintId === selectedSprint.id && (sprint.status === "active" || sprint.status === "planning"));
  const insideNote = !inside.length ? null : openModal === "complete"
    ? [inside.filter((s) => s.status === "active").map((s) => s.name).join(", "), inside.filter((s) => s.status === "planning").map((s) => s.name).join(", ")]
      .map((names, i) => (names ? (i === 0 ? `closes ${names}` : `cancels ${names}`) : null)).filter(Boolean).join(" and ")
    : openModal === "cancel" ? `cancels ${inside.map((s) => s.name).join(", ")}` : null;
  const title =
    openModal === "complete"
      ? `Close ${selectedSprint.name}?`
      : openModal === "archive"
        ? `Archive ${selectedSprint.name}?`
        : `Cancel ${selectedSprint.name}?`;
  const description =
    openModal === "complete"
      ? `${selectedSprint.endDate ? `Ends ${SHORT_DAY.format(new Date(selectedSprint.endDate))} · ` : ""}${points ? `${summary?.completedStoryPoints ?? 0} of ${points} points done · ` : ""}${summary?.completedTasks ?? 0} of ${summary?.totalTasks ?? 0} tasks finished.`
      : openModal === "archive"
        ? `Archive ${selectedSprint.name}. Its history stays available to the team.`
        : `Cancel ${selectedSprint.name}. All of its tasks, finished or not, move back to the backlog.`;
  const remainingTasks = Math.max(
    (summary?.totalTasks ?? 0) - (summary?.completedTasks ?? 0),
    0,
  );
  const requiresTargetSprint = unfinishedChoice === "next_sprint";

  const close = () => {
    if (!isMutating) onClose();
  };

  const submit = async () => {
    const succeeded =
      openModal === "complete"
        ? await onConfirmComplete(
            unfinishedChoice,
            requiresTargetSprint ? nextSprintId : null,
            closeAssignments,
          )
        : openModal === "archive"
          ? await onConfirmArchive()
          : await onConfirmCancel();
    if (succeeded) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        
        showCloseButton={!isMutating}
        onCloseAutoFocus={(event) => {
          if (openerRef.current) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (isMutating) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isMutating) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {insideNote ? <Notice tone="warning">This also {insideNote}.</Notice> : null}

        {openModal === "complete" ? (
          <div className="space-y-3">
            {remainingTasks > 0 ? (
            <>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
              {remainingTasks} {remainingTasks === 1 ? "task" : "tasks"} still open go to
            </p>
            <div aria-label="Unfinished tasks" className="space-y-2" role="radiogroup">
              {completionOptions.filter((option) => option.value !== "next_sprint" || carryOverSprints.length > 0).map((option) => {
                const target = carryOverSprints.find((sprint) => sprint.id === nextSprintId) ?? carryOverSprints[0];
                return (
                  <label key={option.value} className={cn("flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-2.5 text-sm transition-colors", unfinishedChoice === option.value ? "border-primary bg-card" : "border-border hover:bg-muted")}>
                    <input className="nb-radio" checked={unfinishedChoice === option.value} disabled={isMutating} name="unfinished-work" onChange={() => { setUnfinishedChoice(option.value); if (option.value === "next_sprint" && !nextSprintId && target) setNextSprintId(target.id); }} type="radio" value={option.value} />
                    <span className="font-medium text-foreground">
                      {option.value === "next_sprint" && target ? target.name : option.title}
                      {option.value === "next_sprint" && target?.startDate ? <span className="font-normal text-muted-foreground"> · starts {SHORT_DAY.format(new Date(target.startDate))}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            </>
            ) : <p className="text-sm text-muted-foreground">Everything in it is done.</p>}

            {openAssignments > 0 ? (
              <label className="flex items-start gap-3 rounded-md border border-border p-3.5 text-sm">
                <input type="checkbox" className="nb-check mt-1" checked={closeAssignments} disabled={isMutating} onChange={(e) => setCloseAssignments(e.target.checked)} />
                <span>
                  <span className="block font-medium text-foreground">Close {openAssignments === 1 ? "its open assignment" : `its ${openAssignments} open assignments`}</span>
                  <span className="mt-1 block text-muted-foreground">Nobody can hand them in after this. Leave unticked to keep them open.</span>
                </span>
              </label>
            ) : null}

            {requiresTargetSprint && carryOverSprints.length > 1 ? (
              <label className="block space-y-1.5 text-[13px] font-medium text-foreground">
                Which sprint
                <select
                  className="nb-select nb-touch-target w-full"
                  disabled={isMutating || carryOverSprints.length === 0}
                  onChange={(event) => setNextSprintId(event.target.value)}
                  value={nextSprintId}
                >
                  <option value="">
                    {carryOverSprints.length === 0
                      ? "No planning or active sprint available"
                      : "Select a sprint"}
                  </option>
                  {carryOverSprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>
                      {sprint.name} ({sprint.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <button
            className={FORM_SECONDARY_CLASS}
            disabled={isMutating}
            onClick={close}
            type="button"
          >
            {openModal === "cancel" ? "Keep it" : "Cancel"}
          </button>
          <button
            className={cn(
              FORM_PRIMARY_CLASS,
              openModal === "cancel" && "bg-destructive text-destructive-foreground hover:bg-destructive",
            )}
            disabled={
              isMutating ||
              (requiresTargetSprint &&
                (!nextSprintId || carryOverSprints.length === 0))
            }
            onClick={() => void submit()}
            type="button"
          >
            {isMutating
              ? "Saving…"
              : openModal === "complete"
                ? `Close ${selectedSprint.name}`
                : openModal === "archive"
                  ? `Archive ${selectedSprint.name}`
                  : `Cancel ${selectedSprint.name}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
