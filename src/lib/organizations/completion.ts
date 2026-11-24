/**
 * Report 31.2 C1 call 5 (plan B2.1b): a cohort's completion rule, pure. Required = every published assignment whose
 * copy for the learner isn't Excused (optional assignments arrive with M4 and won't count). Approved = the copy is
 * Done (classes review by default, so Done is the approval). Attendance counts only when it's on with a minimum.
 */
export type CompletionInput = { required: number; approved: number; attendance: number | null; minimum: number | null };

export function completionRule(input: CompletionInput) {
  const reasons: string[] = [];
  const left = input.required - input.approved;
  if (left > 0) reasons.push(`${left} ${left === 1 ? "assignment" : "assignments"} not approved`);
  if (input.minimum != null && (input.attendance ?? 0) < input.minimum) reasons.push(`Attendance ${input.attendance ?? 0}%, needs ${input.minimum}%`);
  return { meets: reasons.length === 0, reasons };
}

/** Overriding the rule needs a reason the learner's record keeps (call 5); agreeing with it needs none. */
export function completionDecision(meets: boolean, completed: boolean, reason: string | null | undefined) {
  const clean = String(reason ?? "").trim().slice(0, 500);
  if (completed !== meets && !clean) return { ok: false as const, error: completed ? "Say why they completed without meeting the rule." : "Say why they didn’t complete." };
  return { ok: true as const, byRule: completed === meets, reason: completed === meets ? null : clean };
}

/** Completion opens on the cohort's end date (layer 5); a class without an end date can record it any time. */
export const completionOpen = (termEnd: string | null, today: string) => !termEnd || today >= termEnd;

/** "Completion 24 of 28" (layer 6), once anything is recorded. */
export const completionLine = (completed: number, recorded: number) => (recorded ? `Completion ${completed} of ${recorded}` : null);
