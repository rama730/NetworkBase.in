"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { OrgType } from "@/lib/organizations/config";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { pushSchoolSettings } from "@/lib/organizations/school-push";
import { typeProfile } from "@/lib/organizations/type-profile";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 29.2 (plan B0.1): institutions and their classes. A class links with `institution_id` (correction recorded
 * in 29.2), so an institution never inherits read of a class: it sees counts and states only.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const admin = (role: string | null) => role === "owner" || role === "admin";
const schools = (type: string | null) => typeProfile(type as OrgType | null).schools;

/** The viewer's role there, only when they're in it and may read (or write): suspended, archived, deleting and completed parts can't change anything. */
async function roleIn(orgId: string, userId: string, need: "read" | "write") {
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(a.isOwner || a.isMember) || (need === "write" ? !a.canWrite : !a.canRead)) return null;
  return a.isOwner ? "owner" : a.memberRole;
}

async function me() {
  const { userId } = await getViewerAuthContext();
  return userId;
}

async function org(id: string) {
  if (!isLooseUuid(id)) return null;
  const [row] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, ownerId: workspaces.ownerId, kind: workspaces.kind, orgType: workspaces.orgType,
    orgLevel: workspaces.orgLevel, institutionId: workspaces.institutionId, orgSettings: workspaces.orgSettings })
    .from(workspaces).where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt))).limit(1);
  return row?.kind === "organization" ? row : null;
}

/** Settings → Organization level: an Education organization with no workspaces or classes yet becomes an institution. */
export async function makeInstitutionAction(orgId: string): Promise<{ success: true } | Failure> {
  const userId = await me();
  const o = await org(orgId);
  if (!userId || !o || o.ownerId !== userId) return DENIED;
  if (!schools(o.orgType)) return { success: false, error: "Only an Education organization can be an institution." };
  if (o.institutionId) return { success: false, error: "This is a class in a school; it can’t be a school too." };
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaces).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
  if (n > 0) return { success: false, error: "An institution holds classes, not workspaces: this organization has workspaces already." };
  await db.update(workspaces).set({ orgLevel: "institution" }).where(eq(workspaces.id, orgId));
  return { success: true };
}

/** A class's owner or admins ask to join an institution they belong to; the institution's admins join at once. */
export async function joinInstitutionAction(classId: string, institutionId: string): Promise<{ success: true; outcome: "joined" | "requested" } | Failure> {
  const userId = await me();
  const [c, inst] = await Promise.all([org(classId), org(institutionId)]);
  if (!userId || !c || !inst) return DENIED;
  if (!admin(await roleIn(classId, userId, "write"))) return DENIED;
  if (inst.orgLevel !== "institution") return { success: false, error: "That organization isn’t a school." };
  if (!schools(c.orgType) || c.orgLevel) return { success: false, error: "Only an Education class joins a school." };
  if (c.institutionId) return { success: false, error: "This class is already part of a school. Leave it first." };
  const role = await roleIn(institutionId, userId, "write");
  if (!role || role === "viewer") return { success: false, error: "Join that school first, then ask to add this class." };
  if (admin(role)) {
    const done = await db.update(workspaces).set({ institutionId, orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'institutionRequest'` })
      .where(and(eq(workspaces.id, classId), isNull(workspaces.institutionId))).returning({ id: workspaces.id });
    if (!done.length) return { success: false, error: "This class is already part of a school. Leave it first." };
    await pushSchoolSettings(institutionId, classId);
    return { success: true, outcome: "joined" };
  }
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ institutionRequest: { institutionId, by: userId, at: new Date().toISOString() } })}::jsonb` })
    .where(eq(workspaces.id, classId));
  const { notifyOrg } = await import("@/lib/organizations/notify");
  await notifyOrg({ orgId: institutionId, eventKey: "org.child_requests", actorId: userId, title: `${c.title} wants to join ${inst.title}`,
    href: `/org/${encodeURIComponent(inst.slug ?? inst.id)}?tab=projects`, sourceEventId: `class-request:${classId}:${Date.now()}` }).catch(() => undefined);
  return { success: true, outcome: "requested" };
}

const requestOf = (o: { orgSettings: unknown }) => (o.orgSettings as { institutionRequest?: { institutionId: string } } | null)?.institutionRequest ?? null;

/** The institution's admins approve or decline a class's request. */
export async function decideClassRequestAction(institutionId: string, classId: string, approve: boolean): Promise<{ success: true } | Failure> {
  const userId = await me();
  const [c, inst] = await Promise.all([org(classId), org(institutionId)]);
  if (!userId || !c || !inst || inst.orgLevel !== "institution" || !admin(await roleIn(institutionId, userId, "write"))) return DENIED;
  if (requestOf(c)?.institutionId !== institutionId) return { success: false, error: "That class has no request here." };
  if (approve && c.institutionId) return { success: false, error: "That class joined another school meanwhile." };
  // The checks above repeat in the WHERE, so two admins deciding at once (or a class joining elsewhere) can't race.
  const done = await db.update(workspaces).set({ ...(approve ? { institutionId } : {}), orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'institutionRequest'` })
    .where(and(eq(workspaces.id, classId), sql`${workspaces.orgSettings}->'institutionRequest'->>'institutionId' = ${institutionId}`, approve ? isNull(workspaces.institutionId) : undefined))
    .returning({ id: workspaces.id });
  if (!done.length) return { success: false, error: "That request changed meanwhile. Reload the list." };
  if (approve) await pushSchoolSettings(institutionId, classId);
  return { success: true };
}

/** The class leaves (its owner or admins), or the institution removes it (its admins); nothing else changes. */
export async function unlinkClassAction(classId: string): Promise<{ success: true } | Failure> {
  const userId = await me();
  const c = await org(classId);
  if (!userId || !c) return DENIED;
  const pending = requestOf(c);
  const fromClass = admin(await roleIn(classId, userId, "write"));
  const fromInstitution = c.institutionId ? admin(await roleIn(c.institutionId, userId, "write")) : false;
  if (!fromClass && !fromInstitution) return DENIED;
  if (!c.institutionId && !pending) return { success: true };
  await db.update(workspaces).set({ institutionId: null, orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'institutionRequest' - 'department' - 'attendanceMinimum'` }).where(eq(workspaces.id, classId));
  return { success: true };
}

/** A class's Settings: its school, a pending request, and the schools the viewer could ask to join. */
export async function readClassInstitutionAction(classId: string) {
  const userId = await me();
  const c = await org(classId);
  if (!userId || !c || !admin(await roleIn(classId, userId, "read"))) return DENIED;
  const pending = requestOf(c);
  const ids = [c.institutionId, pending?.institutionId].filter((x): x is string => Boolean(x));
  const linked = ids.length ? await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(inArray(workspaces.id, ids)) : [];
  const mine = Array.from(await db.execute<{ id: string; title: string; slug: string | null }>(sql`
    SELECT w.id, w.title, w.slug FROM workspaces w
    WHERE w.org_level = 'institution' AND w.deleted_at IS NULL AND w.deletion_scheduled_at IS NULL AND w.suspended_at IS NULL AND w.status <> 'archived' AND w.id <> ${classId}::uuid
      AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.role <> 'viewer'))
    ORDER BY w.title LIMIT 50`));
  const [{ n } = { n: 0 }] = c.ownerId === userId && schools(c.orgType) && !c.orgLevel && !c.institutionId
    ? await db.select({ n: sql<number>`count(*)::int` }).from(workspaces).where(and(eq(workspaces.parentId, classId), isNull(workspaces.deletedAt)))
    : [{ n: -1 }];
  return { success: true as const, eligible: schools(c.orgType) && !c.orgLevel, canBecomeSchool: n === 0,
    institution: linked.find((l) => l.id === c.institutionId) ?? null, pending: pending ? linked.find((l) => l.id === pending.institutionId) ?? null : null, schools: mine };
}

export type InstitutionClass = {
  id: string; title: string; slug: string | null; teacher: string | null; department: string | null; termStart: string | null; termEnd: string | null;
  /** Counts reach the school's admins, and a head of department for their department's classes; zeros otherwise. */
  counted: boolean; members: number; openAssignments: number; toReview: number; lastActivity: string | null;
  /** B1.2b Behind plan: lessons whose class has passed but aren't marked taught. */
  behindPlan: number;
  /** B1.4b (report 30.7 call): the class's average attendance and how many are below its minimum — never names. */
  attendanceAvg: number | null;
  belowMinimum: number;
};
export type Department = { id: string; name: string; heads: string[] };
const departmentsOf = (o: { orgSettings: unknown }): Department[] => {
  const list = (o.orgSettings as { departments?: unknown } | null)?.departments;
  return Array.isArray(list) ? list.filter((d): d is Department => Boolean(d && typeof d.id === "string" && typeof d.name === "string")).map((d) => ({ ...d, heads: Array.isArray(d.heads) ? d.heads : [] })) : [];
};

/**
 * The institution's classes (report 29.2 privacy call, B0.2 departments): its admins see every class's counts and
 * states, a head of department their department's; other members see titles. Never assignments' contents,
 * hand-ins, marks, tasks or files.
 */
export async function readInstitutionClassesAction(institutionId: string) {
  try {
    const userId = await me();
    const inst = await org(institutionId);
    if (!userId || !inst || inst.orgLevel !== "institution") return DENIED;
    const role = await roleIn(institutionId, userId, "read");
    if (!role) return DENIED;
    const isAdmin = admin(role);
    const departments = departmentsOf(inst);
    const heads = new Set(departments.filter((d) => d.heads.includes(userId)).map((d) => d.id));
    const rows = Array.from(await db.execute<{ id: string; title: string; slug: string | null; teacher: string | null; department: string | null; term_start: string | null; term_end: string | null;
      members: number; open_assignments: number; to_review: number; last_activity: string | null }>(sql`
      SELECT c.id, c.title, c.slug, coalesce(p.full_name, p.username) AS teacher, c.org_settings->>'department' AS department, c.term_start::text, c.term_end::text,
        (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = c.id) AS members,
        (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = c.id AND t.kind = 'assignment' AND t.assignment_id IS NULL AND t.deleted_at IS NULL AND t.assignment_settings->>'closedAt' IS NULL) AS open_assignments,
        (SELECT count(*)::int FROM tasks t JOIN tasks m ON m.id = t.assignment_id WHERE m.workspace_id = c.id AND t.deleted_at IS NULL AND t.review_status = 'pending') AS to_review,
        (SELECT max(t.updated_at)::text FROM tasks t WHERE t.workspace_id = c.id) AS last_activity
      FROM workspaces c LEFT JOIN profiles p ON p.id = c.owner_id
      WHERE c.institution_id = ${institutionId}::uuid AND c.deleted_at IS NULL ORDER BY c.title`));
    const requests = isAdmin ? Array.from(await db.execute<{ id: string; title: string }>(sql`
      SELECT id, title FROM workspaces WHERE deleted_at IS NULL AND org_settings->'institutionRequest'->>'institutionId' = ${institutionId} ORDER BY title`)) : [];
    const known = new Set(departments.map((d) => d.id));
    const { classPlanStates } = await import("@/lib/organizations/term-plan-server");
    const plans = await classPlanStates(rows.map((r) => r.id));
    const { readAttendanceSettings } = await import("@/lib/organizations/attendance");
    const att = rows.length ? Array.from(await db.execute<{ workspace_id: string; user_id: string; present: number; late: number; absent: number; settings: unknown }>(sql`
      SELECT a.workspace_id, a.user_id, count(*) FILTER (WHERE a.status = 'present')::int AS present, count(*) FILTER (WHERE a.status = 'late')::int AS late,
        count(*) FILTER (WHERE a.status = 'absent')::int AS absent, w.org_settings AS settings
      FROM attendance_records a JOIN workspaces w ON w.id = a.workspace_id
      WHERE a.workspace_id IN (SELECT id FROM workspaces WHERE institution_id = ${institutionId}::uuid AND deleted_at IS NULL) AND a.status IS NOT NULL
      GROUP BY a.workspace_id, a.user_id, w.org_settings`)) : [];
    const attendanceOf = (classId: string) => {
      const people = att.filter((a) => a.workspace_id === classId);
      if (!people.length) return { avg: null as number | null, below: 0 };
      const st = readAttendanceSettings(people[0]!.settings);
      const pcts = people.map((p) => { const total = p.present + p.late + p.absent; return total ? ((p.present + (st.lateCountsPresent ? p.late : 0)) / total) * 100 : null; }).filter((x): x is number => x != null);
      return { avg: pcts.length ? Math.round(pcts.reduce((n, x) => n + x, 0) / pcts.length) : null, below: st.minimum == null ? 0 : pcts.filter((x) => x < st.minimum!).length };
    };
    const minimum = (inst.orgSettings as { attendanceMinimum?: unknown } | null)?.attendanceMinimum;
    return { success: true as const, isAdmin, headOf: [...heads], requests, attendanceMinimum: typeof minimum === "number" ? minimum : null,
      // Heads' names are the admins' business; everyone else sees department names.
      departments: departments.map((d) => ({ id: d.id, name: d.name, heads: isAdmin ? d.heads : [] })),
      classes: rows.map((r): InstitutionClass => {
        const department = r.department && known.has(r.department) ? r.department : null;
        const counted = isAdmin || Boolean(department && heads.has(department));
        return { id: r.id, title: r.title, slug: r.slug, teacher: r.teacher, department, termStart: r.term_start, termEnd: r.term_end, counted,
          members: counted ? r.members : 0, openAssignments: counted ? r.open_assignments : 0, toReview: counted ? r.to_review : 0, lastActivity: counted ? r.last_activity : null,
          behindPlan: counted ? plans.get(r.id)?.unmarked.length ?? 0 : 0,
          attendanceAvg: counted ? attendanceOf(r.id).avg : null, belowMinimum: counted ? attendanceOf(r.id).below : 0 };
      }) };
  } catch (error) {
    logger.warn("institutions.classes_failed", { institutionId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the classes." };
  }
}

/** Settings → Departments (school admins): names, and each one's heads (members of the school). */
export async function saveDepartmentsAction(schoolId: string, input: Array<{ id?: string; name: string; heads?: string[] }>): Promise<{ success: true; departments: Department[] } | Failure> {
  const userId = await me();
  const school = await org(schoolId);
  if (!userId || !school || school.orgLevel !== "institution" || !admin(await roleIn(schoolId, userId, "write"))) return DENIED;
  if (!Array.isArray(input) || input.length > 50) return { success: false, error: "Up to 50 departments." };
  const names = input.map((d) => String(d?.name ?? "").trim());
  if (names.some((n) => !n || n.length > 60)) return { success: false, error: "Each department needs a name of up to 60 characters." };
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return { success: false, error: "Two departments have the same name." };
  const wanted = [...new Set(input.flatMap((d) => (Array.isArray(d.heads) ? d.heads : [])).filter(isLooseUuid))];
  const members = new Set(wanted.length ? (await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, schoolId), inArray(workspaceMembers.userId, wanted)))).map((r) => r.id) : []);
  const old = new Set(departmentsOf(school).map((d) => d.id));
  const departments: Department[] = input.map((d, i) => ({ id: d.id && old.has(d.id) ? d.id : crypto.randomUUID(), name: names[i]!,
    heads: (Array.isArray(d.heads) ? d.heads : []).filter((h) => members.has(h)).slice(0, 10) }));
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ departments })}::jsonb` }).where(eq(workspaces.id, schoolId));
  return { success: true, departments };
}

/** The school's admins put a class in a department (or none). */
export async function setClassDepartmentAction(schoolId: string, classId: string, departmentId: string | null): Promise<{ success: true } | Failure> {
  const userId = await me();
  const [school, c] = await Promise.all([org(schoolId), org(classId)]);
  if (!userId || !school || !c || c.institutionId !== schoolId || !admin(await roleIn(schoolId, userId, "write"))) return DENIED;
  if (departmentId && !departmentsOf(school).some((d) => d.id === departmentId)) return { success: false, error: "That department isn’t in this school." };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ department: departmentId })}::jsonb` })
    .where(and(eq(workspaces.id, classId), eq(workspaces.institutionId, schoolId)));
  return { success: true };
}

/** A school's About (anyone who can see the school): department names and its public classes. */
export async function readSchoolAboutAction(schoolId: string) {
  const school = await org(schoolId);
  if (!school || school.orgLevel !== "institution") return DENIED;
  const userId = await me();
  const a = await getWorkspaceAccessById(schoolId, userId ?? null);
  if (!a.canRead) return DENIED;
  const classes = Array.from(await db.execute<{ id: string; title: string; slug: string | null; department: string | null }>(sql`
    SELECT id, title, slug, org_settings->>'department' AS department FROM workspaces
    WHERE institution_id = ${schoolId}::uuid AND deleted_at IS NULL AND visibility = 'public' AND status <> 'archived' ORDER BY title LIMIT 200`));
  return { success: true as const, departments: departmentsOf(school).map((d) => ({ id: d.id, name: d.name })), classes };
}

/** B1.4b (report 30.7): the school's attendance minimum, pushed into every class and locked there ("Set by"). Admins. */
export async function saveSchoolAttendanceMinimumAction(schoolId: string, minimum: number | null): Promise<{ success: true } | Failure> {
  const userId = await me();
  const school = await org(schoolId);
  if (!userId || !school || school.orgLevel !== "institution" || !admin(await roleIn(schoolId, userId, "write"))) return DENIED;
  if (minimum !== null && !(Number.isInteger(minimum) && minimum >= 1 && minimum <= 100)) return { success: false, error: "A minimum is between 1 and 100%." };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ attendanceMinimum: minimum })}::jsonb` }).where(eq(workspaces.id, schoolId));
  await pushSchoolSettings(schoolId);
  return { success: true };
}
