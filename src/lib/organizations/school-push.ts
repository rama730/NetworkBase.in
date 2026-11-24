import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { workspaces } from "@/lib/db/schema";
import { applyChildVisibilityCap } from "@/lib/organizations/children";
import { kindStartingValues, readSchoolKind } from "@/lib/organizations/school-kind";

/**
 * Report 29.2, B0.2 call "Settings pushed down": a school's term dates, AI policy, late rule, review default and
 * workspace-visibility cap are written into every class in it; the class can't change them while it's in the school.
 */
export const SCHOOL_SETTING_KEYS = ["assignmentAiPolicy", "assignmentLateRule", "assignmentReview", "visibilityCap", "attendanceMinimum", "examWeeks"] as const;
/** The patch fields (updateOrgSettingsAction) that carry those settings, with the stored key or column they write. */
export const SCHOOL_LOCKED_FIELDS: Record<string, string> = {
  ai_policy: "assignmentAiPolicy", late_rule: "assignmentLateRule", review_required: "assignmentReview", visibility_cap: "visibilityCap",
  term_start: "termStart", term_end: "termEnd",
};

/** The patch fields a school locks in its classes: the settings it has saved (term dates only as a pair). */
export function schoolLockedFields(school: { orgSettings: unknown; termStart: string | null; termEnd: string | null }): string[] {
  const settings = (school.orgSettings ?? {}) as Record<string, unknown>;
  return Object.entries(SCHOOL_LOCKED_FIELDS)
    .filter(([, key]) => (key === "termStart" || key === "termEnd" ? Boolean(school.termStart && school.termEnd) : settings[key] !== undefined))
    .map(([field]) => field);
}

/** Copies the school's settings into its classes (one class, or all of them); returns the classes changed. */
export async function pushSchoolSettings(schoolId: string, classId?: string): Promise<string[]> {
  // B2.1d (report 31.2 calls 1–2): a class arriving in the school starts with its kind's values; its own win. Saving
  // the school's settings later never renames the classes already there.
  const [school] = classId ? await db.select({ settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, schoolId)).limit(1) : [];
  const starting = JSON.stringify(kindStartingValues(readSchoolKind(school?.settings)));
  const rows = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE workspaces c SET
      workflow_settings = CASE WHEN ${readSchoolKind(school?.settings) === "coaching"} AND coalesce(c.workflow_settings->'path'->>'pacing', '') = ''
        AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = c.id AND m.role = 'member')
        THEN coalesce(c.workflow_settings, '{}'::jsonb) || jsonb_build_object('path', coalesce(c.workflow_settings->'path', '{}'::jsonb) || '{"pacing": "self"}'::jsonb)
        ELSE c.workflow_settings END,
      org_settings = ${starting}::jsonb || coalesce(c.org_settings, '{}'::jsonb) || coalesce((SELECT jsonb_object_agg(k, v) FROM jsonb_each(coalesce(s.org_settings, '{}'::jsonb)) AS e(k, v)
        WHERE k IN ('assignmentAiPolicy', 'assignmentLateRule', 'assignmentReview', 'visibilityCap', 'attendanceMinimum', 'examWeeks')), '{}'::jsonb),
      -- Both dates or neither, so a class's own term can never end before it starts.
      term_start = CASE WHEN s.term_start IS NOT NULL AND s.term_end IS NOT NULL THEN s.term_start ELSE c.term_start END,
      term_end = CASE WHEN s.term_start IS NOT NULL AND s.term_end IS NOT NULL THEN s.term_end ELSE c.term_end END, updated_at = now()
    FROM workspaces s
    WHERE s.id = ${schoolId}::uuid AND s.org_level = 'institution' AND c.institution_id = s.id AND c.deleted_at IS NULL
      ${classId ? sql`AND c.id = ${classId}::uuid` : sql``}
    RETURNING c.id`));
  // A lower cap lowers the classes' own workspaces too, as it does when a class sets it itself.
  for (const r of rows) await applyChildVisibilityCap(r.id);
  return rows.map((r) => r.id);
}

/**
 * A copied class (Start next term) rejoins its school under the same rule as Join a school: the school's admins (who
 * can write there) link it at once and its settings arrive; other members of an active school leave a request.
 */
export async function joinSchoolAs(classId: string, schoolId: string, actorId: string): Promise<"joined" | "requested" | null> {
  const a = await getWorkspaceAccessById(schoolId, actorId);
  if (!(a.isOwner || a.isMember) || !a.canWrite) return null;
  const role = a.isOwner ? "owner" : a.memberRole;
  if (role === "owner" || role === "admin") {
    await db.update(workspaces).set({ institutionId: schoolId }).where(and(eq(workspaces.id, classId), isNull(workspaces.institutionId)));
    await pushSchoolSettings(schoolId, classId);
    return "joined";
  }
  if (role === "viewer") return null;
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ institutionRequest: { institutionId: schoolId, by: actorId, at: new Date().toISOString() } })}::jsonb` })
    .where(eq(workspaces.id, classId));
  return "requested";
}
