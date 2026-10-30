import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * SQL predicate: `userId` can decide applications on the live project whose id is `projectId`
 * (its owner or an admin). Reviewers come from project membership, so an ownership transfer or an
 * admin change moves the queue; `role_applications.creator_id` is history only.
 */
export function canReviewWorkspaceSql(userId: string, projectId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM workspaces rp
    WHERE rp.id = ${projectId} AND rp.deleted_at IS NULL
      AND (rp.owner_id = ${userId}::uuid OR EXISTS (
        SELECT 1 FROM workspace_members rpm
        WHERE rpm.workspace_id = rp.id AND rpm.user_id = ${userId}::uuid AND rpm.role IN ('owner', 'admin')))
  )`;
}

/**
 * How many pending applications `userId` can review: the number the Network badge, the Workspace drawer and the list agree on.
 * People who can't appear in the list (deleted accounts; across a block, while another owner or admin can review: B37) are
 * left out here too, so a badge never exceeds its list.
 */
export async function countReviewableApplications(userId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM role_applications a
    JOIN profiles ap ON ap.id = a.applicant_id AND ap.deleted_at IS NULL
    WHERE a.status = 'pending' AND a.applicant_id <> ${userId}::uuid
      AND ${canReviewWorkspaceSql(userId, sql`a.workspace_id`)}
      AND NOT app_private.review_hidden_by_block(${userId}::uuid, a.applicant_id, a.workspace_id)
  `);
  return Array.from(rows)[0]?.n ?? 0;
}
