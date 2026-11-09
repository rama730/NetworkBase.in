import type { AssignmentStages } from "@/lib/organizations/assignments";

// Sprint work list redesign (2026-11-09): a main assignment's one chip, the same on the board and in a sprint.
// The board (`quiet`) leaves out Open, All approved and Nobody yet, because its line under the bar already says them.

export type AssignmentChipTone = "muted" | "accent" | "warning" | "success" | "info";

export function assignmentChip(
  master: { draft?: boolean; scheduled?: boolean; closed?: boolean; toReview?: number },
  stages: AssignmentStages | null | undefined,
  options: { quiet?: boolean } = {},
): { label: string; tone: AssignmentChipTone } | null {
  if (master.draft) return master.scheduled ? { label: "Scheduled", tone: "accent" } : { label: "Draft", tone: "muted" };
  const toReview = master.toReview ?? stages?.counts.submitted ?? 0;
  if (toReview) return { label: `${toReview} to review`, tone: "warning" };
  if (master.closed) return { label: "Closed", tone: "muted" };
  if (options.quiet) return null;
  if (!stages || stages.total === 0) return { label: "Nobody yet", tone: "muted" };
  if (stages.counts.done >= stages.total) return { label: stages.reviewRequired ? "All approved" : "All done", tone: "success" };
  return { label: "Open", tone: "info" };
}
