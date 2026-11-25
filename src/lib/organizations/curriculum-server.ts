import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { behind, lessonTypeOf, readGroups, readTicks } from "@/lib/organizations/curriculum";

/**
 * Report 32.3 S2 (plan B3.2b, d): a school's courses (its classes) with their departments, units and Term plan lessons —
 * read once for the Year map and for the heads' weekly Summary (Behind the map). Counts and stages only.
 */
export async function schoolCourses(schoolId: string) {
  const classes = Array.from(await db.execute<{ id: string; title: string; slug: string | null; settings: unknown; term_start: string | null; term_end: string | null }>(sql`
    SELECT id, title, slug, org_settings AS settings, term_start::text, term_end::text FROM workspaces
    WHERE institution_id = ${schoolId}::uuid AND kind = 'organization' AND deleted_at IS NULL ORDER BY title LIMIT 200`));
  const ids = classes.map((c) => c.id);
  const sprints = ids.length ? Array.from(await db.execute<{ id: string; workspace_id: string; name: string; parent: string | null; start: string | null; end: string | null }>(sql`
    SELECT id, workspace_id, name, parent_sprint_id AS parent, start_date::text AS start, end_date::text AS end FROM workspace_sprints
    WHERE workspace_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid) AND path_position IS NULL`)) : [];
  const lessons = ids.length ? Array.from(await db.execute<{ workspace_id: string; sprint_id: string | null; stage: string | null; fields: unknown }>(sql`
    SELECT workspace_id, sprint_id, stage, type_fields AS fields FROM tasks
    WHERE workspace_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid) AND item_type = 'class_lesson' AND deleted_at IS NULL`)) : [];
  return classes.map((c) => {
    const department = (c.settings as { department?: unknown } | null)?.department;
    const mine = sprints.filter((s) => s.workspace_id === c.id);
    const weekOf = new Map(mine.filter((s) => s.parent).map((s) => [s.id, s]));
    // Found live (B3.2b): only the Term plan's lessons (in a week of a unit) count, never a self-paced Path's.
    const ls = lessons.filter((l) => l.workspace_id === c.id && l.sprint_id && weekOf.has(l.sprint_id)).map((l) => {
      const week = weekOf.get(l.sprint_id!);
      return { unit: week?.parent ?? null, stage: l.stage ?? "draft", day: week?.start?.slice(0, 10) ?? null, ticks: readTicks(l.fields), type: lessonTypeOf(l.fields) };
    });
    const units = mine.filter((s) => !s.parent).map((u) => {
      const inUnit = ls.filter((l) => l.unit === u.id && l.stage !== "cancelled");
      return { name: u.name, start: u.start?.slice(0, 10) ?? null, end: u.end?.slice(0, 10) ?? null,
        draft: !inUnit.length || inUnit.some((l) => l.stage === "draft"), assessment: inUnit.some((l) => l.type === "assessment") };
    });
    return { id: c.id, title: c.title, slug: c.slug, department: typeof department === "string" ? department : null, termStart: c.term_start, termEnd: c.term_end,
      groups: readGroups(c.settings), lessons: ls, units };
  });
}

/** Layer 15: classes three or more lessons Behind the map, for the school's leaders and each department's heads. */
export function behindBy(courses: Awaited<ReturnType<typeof schoolCourses>>, today: string, min = 3) {
  return courses.filter((c) => c.groups.some((g) => behind(c.lessons, g, today).behind >= min));
}
