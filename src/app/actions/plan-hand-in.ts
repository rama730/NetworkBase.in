"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { submitAssignmentAction } from "@/app/actions/assignments";
import { db } from "@/lib/db";
import { LESSON_TYPES, lessonTypeOf } from "@/lib/organizations/curriculum";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.4 S3 call 2 (plan B3.3b): hand in something that lives in NB — a unit or a lesson from your own course.
 * The hand-in is a text version written from the item as it is now (frozen; later edits don't change it), with a
 * link back to the item, so every existing hand-in path (versions, Return, Fix by, the queue) applies.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function copyOf(copyId: string, userId: string) {
  const [c] = Array.from(await db.execute<{ id: string; school: string; type: string | null; assignee: string | null }>(sql`
    SELECT c.id, m.workspace_id AS school, m.assignment_settings->>'submissionType' AS type, c.assignee_id AS assignee FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE c.id = ${copyId}::uuid AND c.deleted_at IS NULL AND m.deleted_at IS NULL`));
  return c && c.assignee === userId && c.type === "text" ? c : null;
}

/** My courses in the hand-in's school, with their units and lessons, to pick from. */
export async function readMyPlanItemsAction(copyId: string) {
  if (!isLooseUuid(copyId)) return DENIED;
  const auth: { user: { id: string } | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  if (!auth.user) return DENIED;
  const c = await copyOf(copyId, auth.user.id);
  if (!c) return { success: true as const, courses: [] };
  const rows = Array.from(await db.execute<{ course_id: string; course: string; unit_id: string; unit: string; lesson_id: string | null; lesson: string | null }>(sql`
    SELECT w.id AS course_id, w.title AS course, u.id AS unit_id, u.name AS unit, t.id AS lesson_id, t.title AS lesson
    FROM workspaces w JOIN workspace_sprints u ON u.workspace_id = w.id AND u.parent_sprint_id IS NULL AND u.path_position IS NULL
    LEFT JOIN workspace_sprints wk ON wk.parent_sprint_id = u.id
    LEFT JOIN tasks t ON t.sprint_id = wk.id AND t.item_type = 'class_lesson' AND t.deleted_at IS NULL
    WHERE w.institution_id = ${c.school}::uuid AND w.owner_id = ${auth.user.id}::uuid AND w.deleted_at IS NULL
    ORDER BY w.title, u.start_date NULLS LAST, wk.start_date NULLS LAST, t.created_at LIMIT 800`));
  const courses = [...new Map(rows.map((r) => [r.course_id, r.course])).entries()].map(([id, course]) => ({
    id, course, units: [...new Map(rows.filter((r) => r.course_id === id).map((r) => [r.unit_id, r.unit])).entries()].map(([uid, unit]) => ({
      id: uid, name: unit, lessons: rows.filter((r) => r.unit_id === uid && r.lesson_id).map((r) => ({ id: r.lesson_id!, title: r.lesson! })) })) }));
  return { success: true as const, courses };
}

const line = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);

/** Hand in a unit (with its weeks and lessons) or one lesson, frozen as this version. */
export async function submitPlanItemAction(copyId: string, item: { kind: "unit" | "lesson"; id: string }, note?: string): Promise<{ success: true } | Failure> {
  if (!isLooseUuid(copyId) || !item || !isLooseUuid(item.id) || (item.kind !== "unit" && item.kind !== "lesson")) return DENIED;
  const auth: { user: { id: string } | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  if (!auth.user) return DENIED;
  const c = await copyOf(copyId, auth.user.id);
  if (!c) return DENIED;
  // The item must be in one of my courses in this school.
  const lessons = Array.from(await db.execute<{ course_id: string; course: string; unit_id: string; unit: string; week: string | null; week_start: string | null; title: string | null; stage: string | null; fields: unknown }>(sql`
    SELECT w.id AS course_id, w.title AS course, u.id AS unit_id, u.name AS unit, wk.name AS week, wk.start_date::text AS week_start, t.title, t.stage, t.type_fields AS fields
    FROM workspaces w JOIN workspace_sprints u ON u.workspace_id = w.id AND u.parent_sprint_id IS NULL
    LEFT JOIN workspace_sprints wk ON wk.parent_sprint_id = u.id
    LEFT JOIN tasks t ON t.sprint_id = wk.id AND t.item_type = 'class_lesson' AND t.deleted_at IS NULL
    WHERE w.institution_id = ${c.school}::uuid AND w.owner_id = ${auth.user.id}::uuid AND w.deleted_at IS NULL
      AND ${item.kind === "unit" ? sql`u.id = ${item.id}::uuid` : sql`t.id = ${item.id}::uuid`}
    ORDER BY wk.start_date NULLS LAST, t.created_at LIMIT 300`));
  if (!lessons.length) return { success: false, error: "Pick a unit or lesson from one of your courses." };
  const first = lessons[0]!;
  const out: string[] = [item.kind === "unit" ? `# Unit: ${first.unit}` : `# Lesson: ${first.title}`, `${first.course}${item.kind === "lesson" ? ` · ${first.unit}` : ""}`, ""];
  let week: string | null = null;
  for (const l of lessons) {
    if (!l.title) continue;
    if (item.kind === "unit" && l.week !== week) { week = l.week; out.push(`## ${l.week ?? "Week"}`); }
    const f = (l.fields ?? {}) as Record<string, unknown>;
    const standards = Array.isArray(f.standards) ? (f.standards as string[]).join(", ") : "";
    out.push(`- ${l.title} · ${LESSON_TYPES[lessonTypeOf(f)]} · ${l.stage === "ready" ? "Ready" : l.stage === "taught" ? "Taught" : l.stage === "cancelled" ? "Cancelled" : "Draft"}${standards ? ` · ${standards}` : ""}`);
    for (const [k, label] of [["before", "Before class"], ["during", "In class"], ["after", "After class"]] as const) {
      const v = line(f[k]);
      if (v) out.push(`  ${label}: ${v.replace(/\n+/g, " ").slice(0, 600)}`);
    }
  }
  const text = out.join("\n").slice(0, 10_000);
  const r = await submitAssignmentAction(copyId, { text, ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}) });
  if (!r.success) return r;
  // The link back to the item, for "Changed since handed in" and "Mark its lessons Ready" (call 4).
  await db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || jsonb_build_object('handedInItem',
    jsonb_build_object('kind', ${item.kind}::text, 'id', ${item.id}::text, 'courseId', ${first.course_id}::text, 'unitId', ${first.unit_id}::text, 'label', ${item.kind === "unit" ? first.unit : first.title}::text, 'at', now()))
    WHERE id = ${copyId}::uuid`);
  return { success: true };
}
