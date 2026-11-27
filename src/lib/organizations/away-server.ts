import "server-only";

import { sql } from "drizzle-orm";

import type { db } from "@/lib/db";
import { orgMemberAway } from "@/lib/db/schema";
import type { TimeOffType } from "@/lib/organizations/directory";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Record an Away (report §33.5; B4.2c time off): the person's own work due in those dates is excused now (group work
 * stays with the group). Shared by an admin's Mark away and a member's own Book time off.
 */
export async function recordAway(tx: Tx, a: { orgId: string; userId: string; from: Date; to: Date; reason: string | null; type: TimeOffType | null; createdBy: string }) {
  await tx.insert(orgMemberAway).values({ orgId: a.orgId, userId: a.userId, startsAt: a.from, endsAt: a.to, reason: a.reason, type: a.type, createdBy: a.createdBy });
  const rows = await tx.execute<{ id: string }>(sql`
    UPDATE tasks c SET excused_at = now(), excused_reason = ${a.reason ? `Away: ${a.reason}` : "Away"}, updated_at = now()
    FROM tasks m WHERE m.id = c.assignment_id AND m.workspace_id = ${a.orgId} AND c.workspace_id = ${a.orgId} AND c.assignee_id = ${a.userId}
      AND c.team_name IS NULL AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.status <> 'done' AND c.review_status IS DISTINCT FROM 'pending'
      AND c.due_date >= ${a.from.toISOString()}::timestamptz AND c.due_date <= ${a.to.toISOString()}::timestamptz
    RETURNING c.id`);
  return rows.length;
}
