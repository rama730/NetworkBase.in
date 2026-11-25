"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { MAX_STANDARDS, readCurriculumSettings, standardsCoverage, type Standard } from "@/lib/organizations/curriculum";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.3 S2 calls 5, 6, 9 (plan B3.2c): Settings → Teaching at the school — standards (imported from a CSV),
 * the lesson template's sections, the opt-in public curriculum overview — and the Standards view (each standard →
 * the courses and lessons that cover it; Not covered yet). School leaders edit; everyone in the school reads.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function school(schoolId: string, write: boolean) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id ?? null;
  if (!userId || (write && auth.tokenKind != null)) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown }>(sql`SELECT org_level AS level, org_settings AS settings FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !(a.isOwner || a.isMember)) return null;
  const leader = a.canWrite && (a.isOwner || a.memberRole === "admin");
  if (write && !leader) return null;
  return { settings: w.settings, leader };
}

/** Lessons in the school's classes with their standards (Term plan lessons only). */
async function schoolLessons(schoolId: string) {
  return Array.from(await db.execute<{ stage: string | null; standards: unknown; course: string }>(sql`
    SELECT t.stage, coalesce(t.type_fields->'standards', '[]'::jsonb) AS standards, c.title AS course
    FROM tasks t JOIN workspaces c ON c.id = t.workspace_id
    WHERE c.institution_id = ${schoolId}::uuid AND c.deleted_at IS NULL AND t.item_type = 'class_lesson' AND t.deleted_at IS NULL LIMIT 20000`))
    .map((r) => ({ stage: r.stage ?? "draft", standards: Array.isArray(r.standards) ? r.standards.filter((x): x is string => typeof x === "string") : [], course: r.course }));
}

export async function readCurriculumAction(schoolId: string) {
  const ctx = await school(schoolId, false);
  if (!ctx) return DENIED;
  return { success: true as const, canEdit: ctx.leader, ...readCurriculumSettings(ctx.settings) };
}

const input = z.object({
  standards: z.array(z.object({ code: z.string().trim().min(1, "Give each standard a code.").max(20), text: z.string().max(300).default(""), grade: z.string().max(20).default(""), subject: z.string().max(60).default("") }))
    .max(MAX_STANDARDS, `At most ${MAX_STANDARDS} standards.`).refine((l) => new Set(l.map((s) => s.code.toLowerCase())).size === l.length, "Two standards have the same code.").optional(),
  template: z.array(z.string().trim().min(1).max(40)).min(1, "Keep at least one section.").max(10).optional(),
  publicOverview: z.boolean().optional(),
}).strict();

/** Save Settings → Teaching. A standard taken off the list that lessons still use stays, marked retired (layer 12). */
export async function saveCurriculumAction(schoolId: string, raw: unknown): Promise<{ success: true; retired: number } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx) return DENIED;
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the teaching settings." };
  const now = readCurriculumSettings(ctx.settings);
  let standards: Standard[] = now.standards;
  let retired = 0;
  if (parsed.data.standards) {
    const next = new Set(parsed.data.standards.map((s) => s.code.toLowerCase()));
    const used = new Set((await schoolLessons(schoolId)).flatMap((l) => l.standards.map((c) => c.toLowerCase())));
    const kept = now.standards.filter((s) => !next.has(s.code.toLowerCase()) && used.has(s.code.toLowerCase())).map((s) => ({ ...s, retired: true }));
    retired = kept.length;
    standards = [...parsed.data.standards, ...kept].slice(0, MAX_STANDARDS + 100);
  }
  const curriculum = { standards, template: parsed.data.template ?? now.template, publicOverview: parsed.data.publicOverview ?? now.publicOverview };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('curriculum', ${JSON.stringify(curriculum)}::jsonb) WHERE id = ${schoolId}::uuid`);
  return { success: true, retired };
}

/** The Standards view: covered of total, each standard with the courses and number of lessons covering it. */
export async function readStandardsCoverageAction(schoolId: string) {
  try {
    const ctx = await school(schoolId, false);
    if (!ctx) return DENIED;
    return { success: true as const, ...standardsCoverage(readCurriculumSettings(ctx.settings).standards, await schoolLessons(schoolId)) };
  } catch (error) {
    logger.warn("curriculum.coverage_failed", { schoolId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the standards." };
  }
}

/** The public curriculum overview (call 9): when the school turns it on, unit titles per course and term — nothing else. */
export async function readCurriculumOverviewAction(schoolId: string) {
  if (!isLooseUuid(schoolId)) return DENIED;
  const auth: { user: { id: string } | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const a = await getWorkspaceAccessById(schoolId, auth.user?.id ?? null);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown }>(sql`SELECT org_level AS level, org_settings AS settings FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !readCurriculumSettings(w.settings).publicOverview) return DENIED;
  const units = Array.from(await db.execute<{ course: string; name: string; start: string | null }>(sql`
    SELECT c.title AS course, s.name, s.start_date::text AS start FROM workspace_sprints s JOIN workspaces c ON c.id = s.workspace_id
    WHERE c.institution_id = ${schoolId}::uuid AND c.deleted_at IS NULL AND s.parent_sprint_id IS NULL AND s.path_position IS NULL
    ORDER BY c.title, s.start_date NULLS LAST LIMIT 600`));
  const courses = [...new Set(units.map((u) => u.course))].map((course) => ({ course, units: units.filter((u) => u.course === course).map((u) => ({ name: u.name, start: u.start?.slice(0, 10) ?? null })) }));
  return { success: true as const, courses };
}
