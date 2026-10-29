import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * SQL predicate: `userId` can decide applications on the live project whose id is `projectId`
 * (its owner or an admin). Reviewers come from project membership, so an ownership transfer or an
 * admin change moves the queue; `role_applications.creator_id` is history only.
 */
export function canReviewWorkspaceSql(userId: string, projectId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM projects rp
    WHERE rp.id = ${projectId} AND rp.deleted_at IS NULL
      AND (rp.owner_id = ${userId}::uuid OR EXISTS (
        SELECT 1 FROM project_members rpm
        WHERE rpm.project_id = rp.id AND rpm.user_id = ${userId}::uuid AND rpm.role IN ('owner', 'admin')))
  )`;
}

/**
 * How many pending applications `userId` can review: the number the Network badge, the Workspace drawer and the list agree on.
 * People who can't appear in the list (deleted accounts, either side blocked) are left out here too, so a badge never exceeds its list.
 */
export async function countReviewableApplications(userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM role_applications a
    JOIN profiles ap ON ap.id = a.applicant_id AND ap.deleted_at IS NULL
    WHERE a.status = 'pending' AND a.applicant_id <> ${userId}::uuid
      AND ${canReviewWorkspaceSql(userId, sql`a.project_id`)}
      AND NOT EXISTS (
        SELECT 1 FROM connections b
        WHERE b.status = 'blocked'
          AND ((b.requester_id = ${userId}::uuid AND b.addressee_id = a.applicant_id) OR (b.addressee_id = ${userId}::uuid AND b.requester_id = a.applicant_id))
      )
  `);
  return Array.from(rows)[0]?.n ?? 0;
}
