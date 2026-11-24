import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { closeFor, readExam } from "@/lib/organizations/exams";

// Report 30.5 W4 (plan B1.6b): server-only exam steps, never callable from the browser.

/** A student's extra time in a class, in minutes (0 when none). */
export async function extraMinutes(orgId: string, userId: string | null) {
  if (!userId) return 0;
  const [row] = Array.from(await db.execute<{ minutes: number }>(sql`SELECT minutes FROM exam_extra_time WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`));
  return row?.minutes ?? 0;
}

/**
 * Call 3: extra time moves only that student's close. Returns the later of the copy's own submit-until and the exam's
 * close plus their minutes, for `canStillSubmit`.
 */
export async function examSubmitUntil(settings: unknown, orgId: string, holderId: string | null, submitUntil: Date | null) {
  const exam = readExam(settings);
  if (!exam || exam.format === "in_person") return submitUntil;
  const extra = await extraMinutes(orgId, holderId);
  if (!extra) return submitUntil;
  const close = closeFor(exam, extra);
  return submitUntil && submitUntil > close ? submitUntil : close;
}

/**
 * Call 5: the clash check. How many of this exam's students have another exam (any class) whose window overlaps.
 * It warns; it never blocks. ISO UTC strings compare in time order.
 */
export async function examClashes(masterId: string) {
  const [row] = Array.from(await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT c.assignee_id)::int AS n
    FROM tasks m JOIN tasks c ON c.assignment_id = m.id AND c.deleted_at IS NULL AND c.assignee_id IS NOT NULL
    JOIN tasks c2 ON c2.assignee_id = c.assignee_id AND c2.deleted_at IS NULL AND c2.assignment_id IS NOT NULL AND c2.assignment_id <> m.id
    JOIN tasks m2 ON m2.id = c2.assignment_id AND m2.deleted_at IS NULL AND m2.assignment_settings ? 'exam'
    WHERE m.id = ${masterId}::uuid AND m.assignment_settings ? 'exam'
      AND m2.assignment_settings->'exam'->>'opensAt' < m.assignment_settings->'exam'->>'closesAt'
      AND m.assignment_settings->'exam'->>'opensAt' < m2.assignment_settings->'exam'->>'closesAt'`));
  return row?.n ?? 0;
}
