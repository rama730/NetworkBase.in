import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { notifyAssignmentPublished } from "@/lib/organizations/assignment-notify";
import { notifyOrg } from "@/lib/organizations/notify";
import { assertSomeoneReviews, createCopies, resolveRecipients } from "@/lib/organizations/assignments";

// Publishing an assignment (report §16.2, §42.5): now, or later by the hourly sprint job (decision 125).

/**
 * Makes the copies and marks it published; returns how many. Throws PeopleLeftError unless dropMissing, and
 * NoReviewerError when nobody could review it (assignment flow decision 8) unless reviewOff turns review off.
 * Publish now and the scheduled job both come through here, so neither can skip the check.
 */
export async function publishMaster(masterId: string, actorId: string, options: { dropMissing?: boolean; reviewOff?: boolean } = {}) {
  const copies = await db.transaction(async (tx) => {
    const [master] = await tx.select({ projectId: tasks.projectId, settings: tasks.assignmentSettings, sprintId: tasks.sprintId }).from(tasks)
      .where(and(eq(tasks.id, masterId), isNull(tasks.deletedAt))).for("update").limit(1);
    if (!master?.settings) throw new Error("Assignment not found");
    if (master.settings.publishedAt) return null;
    const reviewRequired = options.reviewOff ? false : master.settings.reviewRequired;
    await assertSomeoneReviews(tx, master.projectId, { target: master.settings.target, reviewRequired });
    // B2.2b (report 31.3 call 4): in a self-paced path, copies are made when each learner opens the module.
    const { isPathModuleAssignment } = await import("@/lib/workflows/path-server");
    const recipients = (await isPathModuleAssignment(tx, master.projectId, master.sprintId)) ? [] : await resolveRecipients(tx, master.projectId, master.settings.target, options);
    const settings = { ...master.settings, reviewRequired, publishedAt: new Date().toISOString(), publishAt: null, publishOnSprintStart: false, note: null };
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
  const due = await db.execute<{ id: string; actor: string; org_id: string; title: string }>(sql`
    SELECT m.id, m.workspace_id AS org_id, m.title, CASE WHEN m.creator_id = o.owner_id OR EXISTS (SELECT 1 FROM workspace_members a WHERE a.workspace_id = o.id AND a.user_id = m.creator_id AND a.role = 'admin')
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
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn("assignments.scheduled_publish_failed", { module: "assignments", masterId: row.id, error: reason });
      // Audit N72: it goes back to a draft and the person publishing hears why, instead of failing every hour.
      await db.execute(sql`UPDATE tasks SET assignment_settings = assignment_settings - 'publishAt' - 'publishOnSprintStart' WHERE id = ${row.id}::uuid`);
      await notifyOrg({ orgId: row.org_id, eventKey: "org.lifecycle", to: [row.actor], title: `${row.title} wasn’t published: ${reason}`,
        href: `/org/${encodeURIComponent(row.org_id)}?tab=tasks`, sourceEventId: `publish-failed:${row.id}:${now.getTime()}` }).catch(() => undefined);
    }
  }
  return { published };
}
