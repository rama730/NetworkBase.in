import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const DOC_REMINDER_LIMIT = 200;

/**
 * Report 38.11 W3 and call 4 (A4.1): meeting reminders, a small document-reminders table fired by the existing hourly
 * due job (with its exact-time wake events). "Weekly starts at 10:00 · Open notes", to attendees still in the workspace,
 * unless the meeting finished or moved meanwhile (moving rewrites the rows).
 */
export async function fireDueDocumentReminders(limit = DOC_REMINDER_LIMIT) {
  const due = Array.from(await db.execute<{ id: string; user_id: string; doc_id: string; slug: string; filename: string; workspace_id: string; ws_slug: string | null;
    starts_at: string | null; finished: boolean; tz: string | null; eligible: boolean }>(sql`
    UPDATE workspace_document_reminders r SET claim_expires_at = now() + interval '5 minutes'
    FROM workspace_documents d JOIN workspaces w ON w.id = d.workspace_id
    WHERE r.id IN (SELECT id FROM workspace_document_reminders WHERE sent_at IS NULL AND remind_at <= now() AND (claim_expires_at IS NULL OR claim_expires_at < now())
      ORDER BY remind_at LIMIT ${limit} FOR UPDATE SKIP LOCKED) AND d.id = r.doc_id
    RETURNING r.id, r.user_id, r.doc_id, d.slug, coalesce(d.settings->>'meetingTitle', d.filename) AS filename, d.workspace_id, w.slug AS ws_slug, d.settings->>'startsAt' AS starts_at,
      (d.settings ? 'finishedAt') AS finished, w.time_zone AS tz,
      (w.deleted_at IS NULL AND (w.owner_id = r.user_id OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = r.user_id))) AS eligible`));
  let sent = 0;
  for (const row of due) {
    const done = () => db.execute(sql`UPDATE workspace_document_reminders SET sent_at = now(), claim_expires_at = NULL WHERE id = ${row.id}::uuid`);
    try {
      if (!row.eligible || row.finished || !row.starts_at) { await done(); continue; }
      const { zonedParts } = await import("@/lib/workflows/request-clock");
      const time = zonedParts(new Date(row.starts_at), row.tz || "UTC").time;
      const { createNotification } = await import("@/lib/notifications/service");
      await createNotification({
        recipientUserId: row.user_id, kind: "project_task_activity", category: "tasks", importance: "important",
        title: `${row.filename.replace(/\.md$/i, "")} starts at ${time} · Open notes`,
        href: `/workspaces/${encodeURIComponent(row.ws_slug || row.workspace_id)}?tab=docs&doc=${encodeURIComponent(row.slug)}`,
        entityRefs: { projectId: row.workspace_id, projectSlug: row.ws_slug }, dedupeKey: `doc-reminder:${row.id}`,
      });
      await done();
      sent += 1;
    } catch (error) {
      logger.error("meetings.reminder_failed", { module: "tasks", reminderId: row.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { docDue: due.length, docSent: sent };
}
