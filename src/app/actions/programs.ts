"use server";

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import { programs, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { ORG_LIMITS } from "@/lib/organizations/config";
import { validateOrgHandle } from "@/lib/organizations/handle";
import { isOrgHandleAvailable } from "@/lib/organizations/join";
import { cohortEnd, cohortState, weeksBetween, type CohortState } from "@/lib/organizations/programs";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.2 C1 (plan B2.1a): a school's programs and their cohorts. A program points to the cohort it was saved from
 * (call); Start a cohort is the existing duplicate from it, with a new start, seats and join method. School admins
 * make, start and retire programs; nothing here reads a class's work.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function schoolAdmin(schoolId: string) {
  const { userId } = await getViewerAuthContext();
  if (!userId || !isLooseUuid(schoolId)) return null;
  const [s] = await db.select({ level: workspaces.orgLevel }).from(workspaces).where(and(eq(workspaces.id, schoolId), isNull(workspaces.deletedAt))).limit(1);
  if (s?.level !== "institution") return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  return a.canWrite && (a.isOwner || a.memberRole === "admin") ? { userId } : null;
}

/**
 * Security review: a school sees only counts of a class, so making a program from it, or a cohort from that program,
 * also needs owner or admin access to the class itself — never the school role alone.
 */
async function classStaff(classId: string, userId: string, schoolId: string) {
  const [c] = await db.select({ institutionId: workspaces.institutionId, kind: workspaces.kind }).from(workspaces).where(and(eq(workspaces.id, classId), isNull(workspaces.deletedAt))).limit(1);
  if (c?.kind !== "organization" || c.institutionId !== schoolId) return false;
  const a = await getWorkspaceAccessById(classId, userId);
  return a.canRead && (a.isOwner || a.memberRole === "admin");
}

/** Save as program: from one of the school's classes; its length comes from the class's term. */
export async function saveAsProgramAction(classId: string, name: string): Promise<{ success: true; id: string } | Failure> {
  if (!isLooseUuid(classId)) return DENIED;
  const [c] = await db.select({ institutionId: workspaces.institutionId, title: workspaces.title, termStart: workspaces.termStart, termEnd: workspaces.termEnd, seats: workspaces.maxCollaborators })
    .from(workspaces).where(and(eq(workspaces.id, classId), isNull(workspaces.deletedAt))).limit(1);
  if (!c?.institutionId) return { success: false, error: "Only a class in a school can become a program." };
  const who = await schoolAdmin(c.institutionId);
  if (!who) return DENIED;
  if (!(await classStaff(classId, who.userId, c.institutionId))) return { success: false, error: "Only the class's teacher or admins can save it as a program." };
  const title = String(name ?? "").trim().slice(0, 120) || c.title;
  const [row] = await db.insert(programs).values({ institutionId: c.institutionId, name: title, weeks: weeksBetween(c.termStart, c.termEnd), sourceClassId: classId,
    seats: c.seats ? Number(c.seats) || null : null, createdBy: who.userId }).returning({ id: programs.id });
  return { success: true, id: row!.id };
}

export type ProgramRow = { id: string; name: string; weeks: number | null; status: string; sourceClass: string | null; seats: number | null; cohorts: number; nextStart: string | null;
  list: Array<{ id: string; title: string; slug: string | null; start: string | null; end: string | null; state: CohortState; members: number; completed: number; recorded: number }> };

/** The school's Programs (admins): each with its cohorts — Upcoming, Running, Finished — and seats taken. */
export async function readProgramsAction(schoolId: string) {
  try {
    if (!(await schoolAdmin(schoolId))) return DENIED;
    const rows = await db.select({ id: programs.id, name: programs.name, weeks: programs.weeks, status: programs.status, seats: programs.seats, source: programs.sourceClassId,
      sourceTitle: sql<string | null>`(SELECT title FROM workspaces WHERE id = ${programs.sourceClassId})` }).from(programs).where(eq(programs.institutionId, schoolId)).orderBy(programs.name);
    const cohorts = rows.length ? Array.from(await db.execute<{ id: string; title: string; slug: string | null; start: string | null; end: string | null; program: string; members: number; completed: number; recorded: number }>(sql`
      SELECT w.id, w.title, w.slug, w.term_start::text AS start, w.term_end::text AS "end", w.org_settings->>'programId' AS program,
        (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id AND m.role = 'member') AS members,
        -- B2.1b layer 16: the school sees completion counts, never names.
        (SELECT count(*) FILTER (WHERE cc.completed)::int FROM cohort_completions cc WHERE cc.workspace_id = w.id) AS completed,
        (SELECT count(*)::int FROM cohort_completions cc WHERE cc.workspace_id = w.id) AS recorded
      FROM workspaces w WHERE w.institution_id = ${schoolId}::uuid AND w.deleted_at IS NULL AND w.org_settings ? 'programId' ORDER BY w.term_start`)) : [];
    const today = new Date().toISOString().slice(0, 10);
    return { success: true as const, programs: rows.map((p): ProgramRow => {
      const list = cohorts.filter((c) => c.program === p.id).map((c) => ({ id: c.id, title: c.title, slug: c.slug, start: c.start, end: c.end, state: cohortState(c.start, c.end, today), members: c.members, completed: c.completed, recorded: c.recorded }));
      return { id: p.id, name: p.name, weeks: p.weeks, status: p.status, sourceClass: p.sourceTitle, seats: p.seats, cohorts: list.length, nextStart: list.find((c) => c.state === "upcoming")?.start ?? null, list };
    }) };
  } catch (error) {
    logger.warn("programs.read_failed", { schoolId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the programs." };
  }
}

const startInput = z.object({
  name: z.string().trim().min(3, "Name the cohort.").max(100),
  handle: z.string().trim().min(3).max(40),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
  seats: z.number().int().min(1).max(5000).nullable(),
  joinMode: z.enum(["approval", "instant"]),
  copy: z.object({ about: z.boolean(), docs: z.boolean(), files: z.boolean(), sprints: z.boolean(), assignments: z.boolean(), channels: z.boolean(), admins: z.boolean() }).strict(),
}).strict();

/** Start a cohort: the duplicate of the program's source cohort, dated from the new start, built in the background. */
export async function startCohortAction(programId: string, input: z.input<typeof startInput>): Promise<{ success: true; ends: string | null } | Failure> {
  if (!isLooseUuid(programId)) return DENIED;
  const [p] = await db.select().from(programs).where(eq(programs.id, programId)).limit(1);
  if (!p) return DENIED;
  const who = await schoolAdmin(p.institutionId);
  if (!who) return DENIED;
  if (p.status === "retired") return { success: false, error: "This program is retired. Restore it to start cohorts." };
  if (!p.sourceClassId) return { success: false, error: "Its source cohort is gone. Update it from a cohort first." };
  if (!(await classStaff(p.sourceClassId, who.userId, p.institutionId))) return { success: false, error: "Only the source cohort's teacher or admins can start a cohort from it." };
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the cohort." };
  const handle = validateOrgHandle(parsed.data.handle);
  if (!handle.ok) return { success: false, error: handle.reason === "reserved" ? "That web address is reserved." : "Web addresses are 3–40 letters, numbers and dashes." };
  if (!(await isOrgHandleAvailable(handle.handle))) return { success: false, error: "That web address is taken." };
  const [owned] = await db.select({ n: count() }).from(workspaces).where(and(eq(workspaces.ownerId, who.userId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt)));
  if ((owned?.n ?? 0) >= ORG_LIMITS.orgsOwnedPerUser) return { success: false, error: `You can own up to ${ORG_LIMITS.orgsOwnedPerUser} organizations. Ask another admin to start this cohort.` };
  try {
    await inngest.send({ name: "org/duplicate.requested", data: { sourceId: p.sourceClassId, actorId: who.userId, options: {
      title: parsed.data.name, handle: handle.handle, termStart: parsed.data.start, copy: parsed.data.copy,
      cohort: { programId: p.id, seats: parsed.data.seats, joinMode: parsed.data.joinMode } } } });
  } catch {
    return { success: false, error: "Starting cohorts is unavailable right now. Try again in a minute." };
  }
  return { success: true, ends: p.weeks ? cohortEnd(parsed.data.start, p.weeks) : null };
}

/** Rename, Retire or restore, or Update from a cohort (a class of this school); running cohorts never change. */
export async function updateProgramAction(programId: string, patch: { name?: string; status?: "active" | "retired"; sourceClassId?: string }): Promise<{ success: true } | Failure> {
  if (!isLooseUuid(programId)) return DENIED;
  const [p] = await db.select({ institutionId: programs.institutionId }).from(programs).where(eq(programs.id, programId)).limit(1);
  if (!p || !(await schoolAdmin(p.institutionId))) return DENIED;
  const set: Partial<typeof programs.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) { const n = String(patch.name).trim().slice(0, 120); if (!n) return { success: false, error: "Name the program." }; set.name = n; }
  if (patch.status) set.status = patch.status === "retired" ? "retired" : "active";
  if (patch.sourceClassId) {
    if (!isLooseUuid(patch.sourceClassId)) return DENIED;
    const [c] = await db.select({ institutionId: workspaces.institutionId, termStart: workspaces.termStart, termEnd: workspaces.termEnd }).from(workspaces)
      .where(and(eq(workspaces.id, patch.sourceClassId), isNull(workspaces.deletedAt))).limit(1);
    if (c?.institutionId !== p.institutionId) return { success: false, error: "Pick a cohort of this school." };
    const me = await getViewerAuthContext();
    if (!me.userId || !(await classStaff(patch.sourceClassId, me.userId, p.institutionId))) return { success: false, error: "Only that cohort's teacher or admins can make it the program's source." };
    set.sourceClassId = patch.sourceClassId;
    set.weeks = weeksBetween(c.termStart, c.termEnd);
  }
  await db.update(programs).set(set).where(eq(programs.id, programId));
  return { success: true };
}
