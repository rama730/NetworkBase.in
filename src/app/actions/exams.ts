"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { readExam } from "@/lib/organizations/exams";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.5 W4 (plan B1.6a): Release results. With "Hold results until released" on, approved marks stay hidden
 * until the Teacher releases them; then all show at once, one Important notice per student. A TA can't release
 * (call), and no token can.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

export async function releaseResultsAction(masterId: string): Promise<{ success: true; released: number } | Failure> {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.tokenKind == null ? auth.user?.id ?? null : null;
  if (!userId || !isLooseUuid(masterId)) return DENIED;
  const [master] = Array.from(await db.execute<{ org_id: string; settings: unknown }>(sql`
    SELECT workspace_id AS org_id, assignment_settings AS settings FROM tasks WHERE id = ${masterId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL`));
  if (!master) return DENIED;
  const access = await getWorkspaceAccessById(master.org_id, userId);
  if (!access.isOwner || !access.canWrite) return DENIED;
  const exam = readExam(master.settings);
  if (!exam?.hold) return { success: false, error: "This exam doesn’t hold its results." };
  if (exam.releasedAt) return { success: false, error: "Results are already released." };
  const copies = await db.transaction(async (tx) => {
    const moved = Array.from(await tx.execute<{ id: string }>(sql`
      UPDATE tasks SET assignment_settings = jsonb_set(assignment_settings, '{exam,releasedAt}', to_jsonb(${new Date().toISOString()}::text))
      WHERE id = ${masterId}::uuid AND assignment_settings->'exam'->>'releasedAt' IS NULL RETURNING id`));
    if (!moved.length) return null;
    return Array.from(await tx.execute<{ copy_id: string }>(sql`
      UPDATE assignment_marks a SET visible_at = now() FROM tasks c
      WHERE a.master_id = ${masterId}::uuid AND a.visible_at IS NULL AND c.id = a.copy_id AND c.deleted_at IS NULL
        AND (${exam.format === 'in_person'} OR (c.status = 'done' AND c.review_status = 'none' AND c.completion_source = 'review'))
      RETURNING a.copy_id`)).map((r) => r.copy_id);
  });
  if (copies === null) return { success: false, error: "Results are already released." };
  const { notifyAssignmentReviewed } = await import("@/lib/organizations/assignment-notify");
  for (const copyId of copies) {
    await notifyAssignmentReviewed(copyId, userId, "approve", null, true).catch((error: Error) => logger.warn("exams.release_notice_failed", { copyId, error: error.message }));
  }
  return { success: true, released: copies.length };
}
