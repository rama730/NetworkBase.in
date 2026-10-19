import { sql, type SQL } from "drizzle-orm";

/**
 * SQL predicate: `userId` can decide applications on the live project whose id is `projectId`
 * (its owner or an admin). Reviewers come from project membership, so an ownership transfer or an
 * admin change moves the queue; `role_applications.creator_id` is history only.
 */
export function canReviewProjectSql(userId: string, projectId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM projects rp
    WHERE rp.id = ${projectId} AND rp.deleted_at IS NULL
      AND (rp.owner_id = ${userId}::uuid OR EXISTS (
        SELECT 1 FROM project_members rpm
        WHERE rpm.project_id = rp.id AND rpm.user_id = ${userId}::uuid AND rpm.role IN ('owner', 'admin')))
  )`;
}
