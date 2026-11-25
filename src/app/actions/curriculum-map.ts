"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { behind, lessonTypeOf, mapRow, mapWeeks, plannedPercent, readGroups, readTicks } from "@/lib/organizations/curriculum";
import { dayKind, readSchoolYear, termWeek, yearSpan } from "@/lib/organizations/school-year";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.3 S2 (plan B3.2b): the Year map — the school's courses (its classes, by department) across the school's
 * weeks, units as spans, holidays shaded, assessment weeks marked, Planned for everyone in the school. Taught per
 * class and Behind the map only for the school's leaders and that department's heads (call 8), never a ranking.
 * Unit names and lesson counts only: no lesson text, notes, hand-ins or marks.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

export async function readYearMapAction(schoolId: string) {
  try {
    if (!isLooseUuid(schoolId)) return DENIED;
    const auth: { user: { id: string } | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
    const userId = auth.user?.id;
    if (!userId) return DENIED;
    const a = await getWorkspaceAccessById(schoolId, userId);
    const [school] = Array.from(await db.execute<{ level: string | null; settings: unknown; zone: string | null }>(sql`
      SELECT org_level AS level, org_settings AS settings, time_zone AS zone FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
    if (school?.level !== "institution" || !a.canRead || !(a.isOwner || a.isMember)) return DENIED;
    const leader = a.isOwner || a.memberRole === "admin";
    const departments = ((school.settings as { departments?: unknown } | null)?.departments ?? []) as Array<{ id?: unknown; name?: unknown; heads?: unknown }>;
    const depts = (Array.isArray(departments) ? departments : []).filter((d) => typeof d?.id === "string" && typeof d?.name === "string")
      .map((d) => ({ id: d.id as string, name: d.name as string, head: Array.isArray(d.heads) && d.heads.includes(userId) }));
    const classes = Array.from(await db.execute<{ id: string; title: string; slug: string | null; settings: unknown; term_start: string | null; term_end: string | null }>(sql`
      SELECT id, title, slug, org_settings AS settings, term_start::text, term_end::text FROM workspaces
      WHERE institution_id = ${schoolId}::uuid AND kind = 'organization' AND deleted_at IS NULL ORDER BY title LIMIT 200`));
    const year = readSchoolYear(school.settings);
    const span = year ? yearSpan(year) : (() => {
      const starts = classes.map((c) => c.term_start?.slice(0, 10)).filter(Boolean) as string[];
      const ends = classes.map((c) => c.term_end?.slice(0, 10)).filter(Boolean) as string[];
      return starts.length && ends.length ? { start: starts.sort()[0]!, end: ends.sort().at(-1)! } : null;
    })();
    if (!span) return { success: true as const, weeks: [], rows: [], departments: depts.map((d) => ({ id: d.id, name: d.name })), leader };
    const weekStarts = mapWeeks(span.start, span.end);
    const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const weeks = weekStarts.map((w) => {
      const days = [0, 1, 2, 3, 4].map((i) => add(w, i));
      const kinds = year ? days.map((d) => dayKind(d, year)) : [];
      const off = year ? kinds.every((k) => k === "holiday" || k === "staff" || k === "outside") : false;
      const holiday = year ? year.days.find((h) => h.kind === "holiday" && h.start <= days[4]! && h.end >= days[0]!)?.name ?? null : null;
      const tw = year ? days.map((d) => termWeek(d, year)).find(Boolean) ?? null : null;
      return { start: w, off, holiday: off ? holiday : null, label: tw ? `${tw.term} · W${tw.week}` : null };
    });
    const ids = classes.map((c) => c.id);
    const sprints = ids.length ? Array.from(await db.execute<{ id: string; workspace_id: string; name: string; parent: string | null; start: string | null; end: string | null }>(sql`
      SELECT id, workspace_id, name, parent_sprint_id AS parent, start_date::text AS start, end_date::text AS end FROM workspace_sprints
      WHERE workspace_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid) AND path_position IS NULL`)) : [];
    const lessons = ids.length ? Array.from(await db.execute<{ workspace_id: string; sprint_id: string | null; stage: string | null; fields: unknown }>(sql`
      SELECT workspace_id, sprint_id, stage, type_fields AS fields FROM tasks
      WHERE workspace_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid) AND item_type = 'class_lesson' AND deleted_at IS NULL`)) : [];
    const today = todayInZone(school.zone);
    const known = new Set(depts.map((d) => d.id));
    const rows = classes.map((c) => {
      const department = (c.settings as { department?: unknown } | null)?.department;
      const dept = typeof department === "string" && known.has(department) ? department : null;
      const counted = leader || Boolean(dept && depts.find((d) => d.id === dept)?.head);
      const mine = sprints.filter((s) => s.workspace_id === c.id);
      const weekOf = new Map(mine.filter((s) => s.parent).map((s) => [s.id, s]));
      // Found live (B3.2b): only the Term plan's lessons (in a week of a unit) count, never a self-paced Path's.
      const ls = lessons.filter((l) => l.workspace_id === c.id && l.sprint_id && weekOf.has(l.sprint_id)).map((l) => {
        const week = l.sprint_id ? weekOf.get(l.sprint_id) : undefined;
        return { unit: week?.parent ?? null, stage: l.stage ?? "draft", day: week?.start?.slice(0, 10) ?? null, ticks: readTicks(l.fields), type: lessonTypeOf(l.fields) };
      });
      const units = mine.filter((s) => !s.parent).map((u) => {
        const inUnit = ls.filter((l) => l.unit === u.id && l.stage !== "cancelled");
        return { name: u.name, start: u.start?.slice(0, 10) ?? null, end: u.end?.slice(0, 10) ?? null,
          draft: !inUnit.length || inUnit.some((l) => l.stage === "draft"), assessment: inUnit.some((l) => l.type === "assessment") };
      });
      const groups = readGroups(c.settings);
      return { id: c.id, title: c.title, slug: c.slug, department: dept, segments: mapRow(units, weekStarts), planned: plannedPercent(ls),
        taught: counted ? groups.map((g) => ({ group: g, ...behind(ls, g, today) })) : [] };
    });
    return { success: true as const, weeks, rows, departments: depts.map((d) => ({ id: d.id, name: d.name })), leader };
  } catch (error) {
    logger.warn("curriculum_map.read_failed", { schoolId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the year map." };
  }
}
