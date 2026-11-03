import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { notifyAssignmentPublished } from "@/lib/organizations/assignment-notify";
import { createCopies, resolveRecipients } from "@/lib/organizations/assignments";

// Publishing an assignment (report §16.2, §42.5): now, or later by the hourly sprint job (decision 125).

/** Makes the copies and marks it published; returns how many. Throws PeopleLeftError unless dropMissing. */
export async function publishMaster(masterId: string, actorId: string, options: { dropMissing?: boolean } = {}) {
  const copies = await db.transaction(async (tx) => {
    const [master] = await tx.select({ projectId: tasks.projectId, settings: tasks.assignmentSettings }).from(tasks)
      .where(and(eq(tasks.id, masterId), isNull(tasks.deletedAt))).for("update").limit(1);
    if (!master?.settings) throw new Error("Assignment not found");
    if (master.settings.publishedAt) return null;
    const recipients = await resolveRecipients(tx, master.projectId, master.settings.target, options);
    const settings = { ...master.settings, publishedAt: new Date().toISOString(), publishAt: null, publishOnSprintStart: false, note: null };
    await tx.update(tasks).set({ assignmentSettings: settings, updatedAt: new Date() }).where(eq(tasks.id, masterId));
    await createCopies(tx, masterId, recipients, actorId);
    return recipients.length;
  });
  if (copies === null) return null;
  await notifyAssignmentPublished(masterId, actorId).catch((error) => logger.warn("assignments.after_save_failed", { module: "assignments", step: "notify", masterId, error: error instanceof Error ? error.message : String(error) }));
  return copies;
}

/**
 * Scheduled assignments whose time has come: On a date once it passes, When the sprint starts once it's running.
 * The creator publishes while still an admin; otherwise the organization's owner does (decision 98). People who
 * left since are dropped, as a teacher would choose.
 */
export async function publishDueAssignments(now = new Date(), where: { sprintId?: string } = {}) {
  const due = await db.execute<{ id: string; actor: string }>(sql`
    SELECT m.id, CASE WHEN m.creator_id = o.owner_id OR EXISTS (SELECT 1 FROM workspace_members a WHERE a.workspace_id = o.id AND a.user_id = m.creator_id AND a.role = 'admin')
      THEN m.creator_id ELSE o.owner_id END AS actor
    FROM tasks m JOIN workspaces o ON o.id = m.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL AND m.assignment_settings->>'publishedAt' IS NULL
      AND NOT app_private.nb_workspace_read_only(o.id)
      AND ((m.assignment_settings->>'publishAt')::timestamptz <= ${now.toISOString()}::timestamptz
        OR ((m.assignment_settings->>'publishOnSprintStart')::boolean AND EXISTS (SELECT 1 FROM workspace_sprints s WHERE s.id = m.sprint_id AND s.status = 'active')))
      ${where.sprintId ? sql`AND m.sprint_id = ${where.sprintId}` : sql``}
    ORDER BY m.created_at LIMIT 50`);
  let published = 0;
  for (const row of due) {
    try {
      if ((await publishMaster(row.id, row.actor, { dropMissing: true })) !== null) published += 1;
    } catch (error) {
      logger.warn("assignments.scheduled_publish_failed", { module: "assignments", masterId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { published };
}
