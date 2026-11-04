"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { remindCopiesAction } from "@/app/actions/assignments";
import { toast } from "@/lib/feedback";
import { ASSIGNMENT_STATE_LABELS } from "@/lib/copy/terms";
import type { AssignmentStages, CopyStage } from "@/lib/organizations/assignments";
import type { CopyState } from "@/lib/organizations/assignment-rules";
import { cn } from "@/lib/utils";

// Sprint cleanup §4: where everyone is on an assignment, stage by stage — the Assignment tab's own stages and words,
// so the two never disagree. Approved when the assignment needs review, Done when it doesn't (D2).

const ORDER: CopyState[] = ["done", "submitted", "returned", "in_progress", "not_started", "missing", "excused"];
const TONE: Record<CopyState, string> = {
  done: "bg-[var(--status-success)]", submitted: "bg-primary", returned: "bg-[var(--status-warning)]", in_progress: "bg-[var(--status-info)]",
  not_started: "bg-muted-foreground/30", missing: "bg-[var(--status-danger)]", excused: "bg-muted-foreground/15",
};

export function stageLabel(state: CopyState, reviewRequired: boolean) {
  return state === "done" && reviewRequired ? "Approved" : ASSIGNMENT_STATE_LABELS[state];
}

/** The closed row: "1 of 40 done · 12 in review · 3 missing", or why there's nothing to count. */
export function stageSummary(stages: AssignmentStages | null | undefined) {
  if (!stages || stages.total + stages.counts.excused === 0) return "Nobody has it yet";
  const c = stages.counts;
  return [`${c.done} of ${stages.total} ${stages.reviewRequired ? "approved" : "done"}`,
    c.submitted ? `${c.submitted} in review` : null, c.returned ? `${c.returned} returned` : null, c.missing ? `${c.missing} missing` : null]
    .filter(Boolean).join(" · ");
}

/** A thin bar split by stage (excused left out). */
export function StageBar({ stages, className }: { stages: AssignmentStages; className?: string }) {
  if (!stages.total) return null;
  return (
    <span role="img" aria-label={ORDER.filter((s) => s !== "excused" && stages.counts[s]).map((s) => `${stages.counts[s]} ${stageLabel(s, stages.reviewRequired).toLowerCase()}`).join(", ")}
      className={cn("flex h-1 w-full overflow-hidden rounded-[2px] bg-muted", className)}>
      {ORDER.filter((s) => s !== "excused" && stages.counts[s]).map((s) => <span key={s} className={TONE[s]} style={{ width: `${(stages.counts[s] / stages.total) * 100}%` }} />)}
    </span>
  );
}

/** The open row for admins and reviewers: each stage with its count and names, and what to do about it. */
export function AssignmentStagesPanel({ masterId, stages, reviewHref, assignmentHref, canManage }: {
  masterId: string; stages: AssignmentStages; reviewHref: string; assignmentHref: string; canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [reminded, setReminded] = useState<Partial<Record<CopyState, true>>>({});
  const remind = (state: "not_started" | "missing") => start(async () => {
    const r = await remindCopiesAction(masterId, stages.remind[state]);
    if (r.success) { setReminded((x) => ({ ...x, [state]: true })); toast.success(`Reminded ${r.reminded}.`); } else toast.error(r.error);
  });
  const shown = ORDER.filter((s) => stages.counts[s]);
  return (
    <div className="space-y-3">
      <StageBar stages={stages} />
      <p className="font-mono text-[12px] text-foreground">
        {shown.map((s, i) => <span key={s}>{i ? " · " : ""}{stageLabel(s, stages.reviewRequired)} {stages.counts[s]}</span>)}
      </p>
      <ul aria-label="Where everyone is" className="space-y-1.5">
        {shown.filter((s) => s !== "done" && s !== "excused").map((s) => {
          const more = stages.counts[s] - stages.names[s].length;
          return (
            <li key={s} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <Link href={rosterHref(assignmentHref, s)} className="inline-flex w-32 shrink-0 items-center gap-1.5 font-medium text-foreground hover:underline"><span aria-hidden="true" className={cn("size-2 rounded-[1px]", TONE[s])} />{stageLabel(s, stages.reviewRequired)} {stages.counts[s]}</Link>
              <span className="min-w-0 flex-1 truncate text-muted-foreground max-sm:order-last max-sm:basis-full max-sm:pl-3.5">{stages.names[s].join(", ")}{more > 0 ? `, +${more}` : ""}</span>
              {s === "submitted" && canManage ? <Link href={reviewHref} className="font-medium text-primary hover:underline">Review {stages.counts[s]}</Link> : null}
              {(s === "not_started" || s === "missing") && canManage ? (
                <button type="button" disabled={pending || reminded[s]} onClick={() => remind(s)} className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                  {reminded[s] ? "Reminded" : `Remind ${stages.counts[s]}`}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Link href={assignmentHref} className="inline-block text-[13px] font-medium text-foreground underline underline-offset-4 hover:text-primary">Open the assignment</Link>
    </div>
  );
}

/** The roster's filter tile for a stage (Done, In review, Not handed in, Excused). */
const TILE: Record<CopyState, string> = { done: "done", submitted: "submitted", returned: "notIn", in_progress: "notIn", not_started: "notIn", missing: "notIn", excused: "excused" };
export const rosterHref = (assignmentHref: string, state: CopyState) => `${assignmentHref}&rosterTile=${TILE[state]}`;

const shortDate = (iso: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso));

/** A person's own copy: where they are, in one line. */
export function copyStageLine(stage: CopyStage) {
  const late = stage.late ? " · Late" : "";
  switch (stage.state) {
    case "submitted": return `In review${stage.since ? ` since ${shortDate(stage.since)}` : ""}${stage.version ? ` · version ${stage.version}` : ""}${late}`;
    case "returned": return `Returned${stage.reason ? `: ${stage.reason}` : ""}${stage.fixBy ? ` · fix by ${shortDate(stage.fixBy)}` : ""}`;
    case "done": return `${stageLabel("done", stage.reviewRequired)}${stage.since ? ` ${shortDate(stage.since)}` : ""}${late}`;
    case "missing": return "Missing — past due, not handed in";
    case "excused": return "Excused";
    default: return ASSIGNMENT_STATE_LABELS[stage.state];
  }
}

/** Instructions in two lines, with More (sprint cleanup §4). */
export function Instructions({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 text-foreground">
      <p className={cn("whitespace-pre-wrap", !open && "line-clamp-2")}><span className="text-muted-foreground">Instructions: </span>{text}</p>
      {text.length > 140 || text.includes("\n") ? <button type="button" onClick={() => setOpen(!open)} className="text-[13px] font-medium text-primary hover:underline">{open ? "Less" : "More"}</button> : null}
    </div>
  );
}

/** What this person handed in (a link or their text), on their own row. */
export function HandIn({ stage }: { stage: CopyStage }) {
  if (!stage.handIn) return null;
  return (
    <p className="mb-2 text-[13px] text-foreground">
      <span className="text-muted-foreground">Handed in{stage.version ? ` (version ${stage.version})` : ""}: </span>
      {stage.handIn.link ? <a href={stage.handIn.link} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{stage.handIn.link}</a> : <span className="line-clamp-2">{stage.handIn.text}</span>}
    </p>
  );
}
