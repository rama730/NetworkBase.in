"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { readExam } from "@/lib/organizations/exams";
import { readSectionSettings } from "@/lib/organizations/sections";
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

async function person() {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  return auth.tokenKind == null ? auth.user?.id ?? null : null;
}

/**
 * Extra time (B1.6b, call 3): the Teacher sees and sets every student's; a TA sees only their section's students when
 * "TAs work only with their section" is on (never the others'); a student sees only their own.
 */
export async function readExtraTimeAction(orgId: string) {
  const userId = await person();
  if (!userId || !isLooseUuid(orgId)) return DENIED;
  const access = await getWorkspaceAccessById(orgId, userId);
  if (!access.canRead) return DENIED;
  const staff = access.isOwner || access.memberRole === "admin";
  if (!staff) {
    const [mine] = Array.from(await db.execute<{ minutes: number }>(sql`SELECT minutes FROM exam_extra_time WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`));
    return { success: true as const, teacher: false, rows: mine ? [{ userId, name: "You", minutes: mine.minutes }] : [], students: [] as Array<{ id: string; name: string }> };
  }
  const [org] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid`));
  const limited = !access.isOwner && readSectionSettings(org?.settings).taOnlyOwn;
  const scope = limited ? sql`AND m.user_id IN (SELECT sm.user_id FROM class_section_members sm WHERE sm.role = 'student' AND sm.section_id IN (
      SELECT ta.section_id FROM class_section_members ta WHERE ta.user_id = ${userId}::uuid AND ta.role = 'ta'))` : sql``;
  const students = Array.from(await db.execute<{ id: string; name: string; minutes: number | null }>(sql`
    SELECT m.user_id AS id, coalesce(p.full_name, p.username, 'Student') AS name, x.minutes
    FROM workspace_members m JOIN profiles p ON p.id = m.user_id LEFT JOIN exam_extra_time x ON x.workspace_id = m.workspace_id AND x.user_id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role = 'member' ${scope} ORDER BY 2 LIMIT 2000`));
  return { success: true as const, teacher: access.isOwner, rows: students.filter((s) => s.minutes).map((s) => ({ userId: s.id, name: s.name, minutes: s.minutes! })),
    students: students.map((s) => ({ id: s.id, name: s.name })) };
}

export async function setExtraTimeAction(orgId: string, studentId: string, minutes: number | null): Promise<{ success: true } | Failure> {
  const userId = await person();
  if (!userId || !isLooseUuid(orgId) || !isLooseUuid(studentId)) return DENIED;
  const access = await getWorkspaceAccessById(orgId, userId);
  if (!access.isOwner || !access.canWrite) return DENIED;
  const [member] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${studentId}::uuid AND role = 'member'`));
  if (!member) return { success: false, error: "They aren’t a student here." };
  if (minutes === null) {
    await db.execute(sql`DELETE FROM exam_extra_time WHERE workspace_id = ${orgId}::uuid AND user_id = ${studentId}::uuid`);
    return { success: true };
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return { success: false, error: "Extra time is 1 to 600 minutes." };
  await db.execute(sql`
    INSERT INTO exam_extra_time (workspace_id, user_id, minutes, set_by) VALUES (${orgId}::uuid, ${studentId}::uuid, ${minutes}, ${userId}::uuid)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET minutes = EXCLUDED.minutes, set_by = EXCLUDED.set_by, set_at = now()`);
  return { success: true };
}

/**
 * Make-up for… (B1.6b, call 4): a new exam for chosen students with its own start, the same length, format, room,
 * covers, marking and hold. Published at once to just them.
 */
export async function makeUpExamAction(masterId: string, userIds: string[], opensAt: string): Promise<{ success: true; masterId: string } | Failure> {
  const userId = await person();
  if (!userId || !isLooseUuid(masterId) || !Array.isArray(userIds) || userIds.length === 0 || userIds.length > 500 || !userIds.every(isLooseUuid)) return DENIED;
  const [master] = Array.from(await db.execute<{ org_id: string; title: string; description: string | null; settings: Record<string, unknown> }>(sql`
    SELECT workspace_id AS org_id, title, description, assignment_settings AS settings FROM tasks WHERE id = ${masterId}::uuid AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL`));
  const exam = master ? readExam(master.settings) : null;
  if (!master || !exam) return DENIED;
  const start = Date.parse(opensAt);
  if (!Number.isFinite(start)) return { success: false, error: "Pick when the make-up starts." };
  const length = Date.parse(exam.closesAt) - Date.parse(exam.opensAt);
  const { createAssignmentAction } = await import("@/app/actions/assignments");
  const made = await createAssignmentAction({
    projectId: master.org_id, title: `${master.title} · make-up`.slice(0, 200), ...(master.description ? { description: master.description } : {}),
    dueDate: new Date(start + length).toISOString(), publish: true, submissionType: master.settings.submissionType as "none" | "file" | "link" | "text",
    reviewRequired: master.settings.reviewRequired === true, lateRule: "none", target: { mode: "people", userIds }, steps: [],
    exam: { format: exam.format, opensAt: new Date(start).toISOString(), closesAt: new Date(start + length).toISOString(), room: exam.room, seats: exam.seats, covers: exam.covers, hold: exam.hold },
  });
  if (!made.success) return { success: false, error: "error" in made ? made.error : "Couldn’t make the make-up." };
  // The marking comes along exactly as frozen on the original (a rubric isn't re-read from the class).
  if (master.settings.marking) await db.execute(sql`UPDATE tasks SET assignment_settings = assignment_settings || jsonb_build_object('marking', ${JSON.stringify(master.settings.marking)}::jsonb) WHERE id = ${made.masterId}::uuid`);
  return { success: true, masterId: made.masterId };
}
