import type { InstitutionClass } from "@/app/actions/institutions";
import { formatInZone } from "@/lib/organizations/zoned-time";

/** "31 members · 2 open assignments · 5 to review · active Nov 22": the only things a school sees of a class (29.2). */
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const classCounts = (c: InstitutionClass) =>
  `${n(c.members, "member", "members")} · ${n(c.openAssignments, "open assignment", "open assignments")} · ${c.toReview} to review${c.lastActivity ? ` · active ${formatInZone(c.lastActivity, { month: "short", day: "numeric" }, null)}` : ""}`;

/** B0.2 call: a class needs attention with 10+ hand-ins waiting for review, or no activity for 14 days. */
export function attentionReasons(c: InstitutionClass, now = Date.now()): string[] {
  if (!c.counted) return [];
  const reasons: string[] = [];
  if (c.toReview >= 10) reasons.push(`${c.toReview} hand-ins waiting for review`);
  if (!c.lastActivity || now - Date.parse(c.lastActivity) > 14 * 86_400_000) reasons.push("No activity for 14 days");
  return reasons;
}
