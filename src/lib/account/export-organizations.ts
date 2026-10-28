import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

// Account export, organization part (report §30.7): your memberships, your own assignment copies (yours or your
// team's) with their review result, your submission file details, and your own org posts and comments.
// Never other people's data. ponytail: one bounded query per part (2,000 rows); page them if anyone exceeds it.

const rows = <T>(query: ReturnType<typeof sql>) => db.execute(query) as unknown as Promise<T[]>;

export async function exportOrganizationData(userId: string) {
  const [memberships, assignmentCopies, submissionFiles, posts, comments] = await Promise.all([
    rows(sql`
      SELECT o.title AS organization, o.slug AS handle, CASE WHEN o.owner_id = ${userId}::uuid THEN 'owner' ELSE pm.role END AS role,
        pm.title, pm.joined_at AS "joinedAt", pm.show_on_profile AS "showOnProfile"
      FROM project_members pm JOIN projects o ON o.id = pm.project_id AND o.kind = 'organization' AND o.deleted_at IS NULL
      WHERE pm.user_id = ${userId}::uuid ORDER BY pm.joined_at LIMIT 2000`),
    rows(sql`
      SELECT c.id, c.title, coalesce(o.title, p.title) AS organization, c.status, c.due_date AS "dueDate",
        c.review_submitted_at AS "submittedAt", c.review_status AS "reviewStatus", c.team_name AS "teamName",
        (SELECT e.payload->>'reason' FROM task_activity_events e WHERE e.task_id = c.id AND e.event_type = 'changes_requested'
          ORDER BY e.created_at DESC LIMIT 1) AS feedback
      FROM tasks c JOIN projects p ON p.id = c.project_id LEFT JOIN projects o ON o.id = p.parent_id
      WHERE c.assignment_id IS NOT NULL AND c.deleted_at IS NULL
        AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid))
      ORDER BY c.due_date NULLS LAST LIMIT 2000`),
    rows(sql`
      SELECT n.name, n.task_id AS "copyId", v.version, v.size, v.uploaded_at AS "uploadedAt"
      FROM project_nodes n JOIN file_versions v ON v.node_id = n.id
      JOIN tasks c ON c.id = n.task_id AND c.assignment_id IS NOT NULL
      WHERE n.deleted_at IS NULL AND n.type = 'file'
        AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid))
      ORDER BY v.uploaded_at LIMIT 2000`),
    rows(sql`
      SELECT u.id, o.title AS organization, u.update_type AS "type", u.content, u.created_at AS "createdAt"
      FROM project_updates u JOIN projects o ON o.id = u.project_id AND o.kind = 'organization'
      WHERE u.author_id = ${userId}::uuid AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 2000`),
    rows(sql`
      SELECT c.id, o.title AS organization, c.content, c.created_at AS "createdAt"
      FROM project_update_comments c JOIN project_updates u ON u.id = c.update_id JOIN projects o ON o.id = u.project_id AND o.kind = 'organization'
      WHERE c.user_id = ${userId}::uuid AND c.deleted_at IS NULL ORDER BY c.created_at LIMIT 2000`),
  ]);
  return { memberships, assignmentCopies, submissionFiles, posts, comments };
}
