"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { behind, mapRow, mapWeeks, plannedPercent } from "@/lib/organizations/curriculum";
import { schoolCourses } from "@/lib/organizations/curriculum-server";
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
    const classes = await schoolCourses(schoolId);
    const year = readSchoolYear(school.settings);
    const span = year ? yearSpan(year) : (() => {
      const starts = classes.map((c) => c.termStart?.slice(0, 10)).filter(Boolean) as string[];
      const ends = classes.map((c) => c.termEnd?.slice(0, 10)).filter(Boolean) as string[];
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
    const today = todayInZone(school.zone);
    const known = new Set(depts.map((d) => d.id));
    const rows = classes.map((c) => {
      const dept = c.department && known.has(c.department) ? c.department : null;
      const counted = leader || Boolean(dept && depts.find((d) => d.id === dept)?.head);
      return { id: c.id, title: c.title, slug: c.slug, department: dept, segments: mapRow(c.units, weekStarts), planned: plannedPercent(c.lessons),
        taught: counted ? c.groups.map((g) => ({ group: g, ...behind(c.lessons, g, today) })) : [] };
    });
    return { success: true as const, weeks, rows, departments: depts.map((d) => ({ id: d.id, name: d.name })), leader };
  } catch (error) {
    logger.warn("curriculum_map.read_failed", { schoolId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the year map." };
  }
}
