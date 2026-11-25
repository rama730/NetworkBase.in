"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { readExamWeeks } from "@/lib/organizations/class-sessions";
import { pushSchoolSettings } from "@/lib/organizations/school-push";
import { nextHoliday, readSchoolYear, schoolBreaks, schoolYearSchema, termWeek, thisWeek, yearMonths, yearSpan } from "@/lib/organizations/school-year";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.2 S1 (plan B3.1a): a school's year. School admins set the year (terms, holidays, staff days, half days);
 * its span becomes every class's term and its holidays and staff days reach the classes as breaks, so sessions skip
 * them (Set by the school). Everyone in the school reads the Year view; classes read "This week at school".
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

export async function readSchoolYearAction(orgId: string) {
  if (!isLooseUuid(orgId)) return DENIED;
  const auth: { user: { id: string } | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  if (!auth.user) return DENIED;
  const a = await getWorkspaceAccessById(orgId, auth.user.id);
  if (!a.canRead || !(a.isOwner || a.isMember) || a.project?.kind !== "organization") return DENIED;
  const [w] = Array.from(await db.execute<{ settings: unknown; zone: string | null; level: string | null }>(sql`SELECT org_settings AS settings, time_zone AS zone, org_level AS level FROM workspaces WHERE id = ${orgId}::uuid`));
  const year = readSchoolYear(w?.settings);
  const exams = readExamWeeks(w?.settings);
  const today = todayInZone(w?.zone ?? null);
  return { success: true as const, isSchool: w?.level === "institution", canEdit: w?.level === "institution" && a.canWrite && (a.isOwner || a.memberRole === "admin"), year, today,
    months: year ? yearMonths(year, exams) : [], week: year ? termWeek(today, year) : null, holiday: year ? nextHoliday(today, year) : null, thisWeek: year ? thisWeek(today, year, exams) : [] };
}

/** Set up the school year (school admins); classes follow it. */
export async function saveSchoolYearAction(schoolId: string, input: unknown): Promise<{ success: true; classes: number } | Failure> {
  if (!isLooseUuid(schoolId)) return DENIED;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  if (!auth.user || auth.tokenKind != null) return DENIED;
  const a = await getWorkspaceAccessById(schoolId, auth.user.id);
  const [w] = Array.from(await db.execute<{ level: string | null }>(sql`SELECT org_level AS level FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canWrite || !(a.isOwner || a.memberRole === "admin")) return DENIED;
  const parsed = schoolYearSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the school year." };
  const span = yearSpan(parsed.data);
  await db.execute(sql`UPDATE workspaces SET term_start = ${span.start}::date, term_end = ${span.end}::date,
    org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('schoolYear', ${JSON.stringify(parsed.data)}::jsonb, 'schoolBreaks', ${JSON.stringify(schoolBreaks(parsed.data))}::jsonb)
    WHERE id = ${schoolId}::uuid`);
  const changed = await pushSchoolSettings(schoolId);
  return { success: true, classes: changed.length };
}
