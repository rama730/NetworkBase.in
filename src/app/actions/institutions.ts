"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { OrgType } from "@/lib/organizations/config";
import { readViewerOrgRole } from "@/lib/organizations/detail";
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
  if (!admin(await readViewerOrgRole(classId, userId))) return DENIED;
  if (inst.orgLevel !== "institution") return { success: false, error: "That organization isn’t a school." };
  if (!schools(c.orgType) || c.orgLevel) return { success: false, error: "Only an Education class joins a school." };
  if (c.institutionId) return { success: false, error: "This class is already part of a school. Leave it first." };
  const role = await readViewerOrgRole(institutionId, userId);
  if (!role || role === "viewer") return { success: false, error: "Join that school first, then ask to add this class." };
  if (admin(role)) {
    await db.update(workspaces).set({ institutionId, orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'institutionRequest'` }).where(eq(workspaces.id, classId));
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
  if (!userId || !c || !inst || inst.orgLevel !== "institution" || !admin(await readViewerOrgRole(institutionId, userId))) return DENIED;
  if (requestOf(c)?.institutionId !== institutionId) return { success: false, error: "That class has no request here." };
  if (approve && c.institutionId) return { success: false, error: "That class joined another school meanwhile." };
  await db.update(workspaces).set({ ...(approve ? { institutionId } : {}), orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'institutionRequest'` }).where(eq(workspaces.id, classId));
  return { success: true };
}

/** The class leaves (its owner or admins), or the institution removes it (its admins); nothing else changes. */
export async function unlinkClassAction(classId: string): Promise<{ success: true } | Failure> {
  const userId = await me();
  const c = await org(classId);
  if (!userId || !c) return DENIED;
  const pending = requestOf(c);
  const fromClass = admin(await readViewerOrgRole(classId, userId));
  const fromInstitution = c.institutionId ? admin(await readViewerOrgRole(c.institutionId, userId)) : false;
  if (!fromClass && !fromInstitution) return DENIED;
  if (!c.institutionId && !pending) return { success: true };
  await db.update(workspaces).set({ institutionId: null, orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) - 'institutionRequest'` }).where(eq(workspaces.id, classId));
  return { success: true };
}

/** A class's Settings: its school, a pending request, and the schools the viewer could ask to join. */
export async function readClassInstitutionAction(classId: string) {
  const userId = await me();
  const c = await org(classId);
  if (!userId || !c || !admin(await readViewerOrgRole(classId, userId))) return DENIED;
  const pending = requestOf(c);
  const ids = [c.institutionId, pending?.institutionId].filter((x): x is string => Boolean(x));
  const linked = ids.length ? await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(inArray(workspaces.id, ids)) : [];
  const mine = Array.from(await db.execute<{ id: string; title: string; slug: string | null }>(sql`
    SELECT w.id, w.title, w.slug FROM workspaces w
    WHERE w.org_level = 'institution' AND w.deleted_at IS NULL AND w.id <> ${classId}::uuid
      AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.role <> 'viewer'))
    ORDER BY w.title LIMIT 50`));
  const [{ n } = { n: 0 }] = c.ownerId === userId && schools(c.orgType) && !c.orgLevel && !c.institutionId
    ? await db.select({ n: sql<number>`count(*)::int` }).from(workspaces).where(and(eq(workspaces.parentId, classId), isNull(workspaces.deletedAt)))
    : [{ n: -1 }];
  return { success: true as const, eligible: schools(c.orgType) && !c.orgLevel, canBecomeSchool: n === 0,
    institution: linked.find((l) => l.id === c.institutionId) ?? null, pending: pending ? linked.find((l) => l.id === pending.institutionId) ?? null : null, schools: mine };
}

export type InstitutionClass = { id: string; title: string; slug: string | null; teacher: string | null; members: number; openAssignments: number; toReview: number; lastActivity: string | null };

/**
 * The institution's classes (report 29.2 privacy call): for its admins, counts and states only; for its members,
 * titles. Never assignments' contents, hand-ins, marks, tasks or files.
 */
export async function readInstitutionClassesAction(institutionId: string) {
  try {
    const userId = await me();
    const inst = await org(institutionId);
    if (!inst || inst.orgLevel !== "institution") return DENIED;
    const role = userId ? await readViewerOrgRole(institutionId, userId) : null;
    if (!role) return DENIED;
    const isAdmin = admin(role);
    const rows = Array.from(await db.execute<{ id: string; title: string; slug: string | null; teacher: string | null; members: number; open_assignments: number; to_review: number; last_activity: string | null }>(sql`
      SELECT c.id, c.title, c.slug, coalesce(p.full_name, p.username) AS teacher,
        (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = c.id) AS members,
        (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = c.id AND t.kind = 'assignment' AND t.assignment_id IS NULL AND t.deleted_at IS NULL AND t.assignment_settings->>'closedAt' IS NULL) AS open_assignments,
        (SELECT count(*)::int FROM tasks t JOIN tasks m ON m.id = t.assignment_id WHERE m.workspace_id = c.id AND t.deleted_at IS NULL AND t.review_status = 'pending') AS to_review,
        (SELECT max(t.updated_at)::text FROM tasks t WHERE t.workspace_id = c.id) AS last_activity
      FROM workspaces c LEFT JOIN profiles p ON p.id = c.owner_id
      WHERE c.institution_id = ${institutionId}::uuid AND c.deleted_at IS NULL ORDER BY c.title`));
    const requests = isAdmin ? Array.from(await db.execute<{ id: string; title: string }>(sql`
      SELECT id, title FROM workspaces WHERE deleted_at IS NULL AND org_settings->'institutionRequest'->>'institutionId' = ${institutionId} ORDER BY title`)) : [];
    return { success: true as const, isAdmin, requests,
      classes: rows.map((r): InstitutionClass => isAdmin
        ? { id: r.id, title: r.title, slug: r.slug, teacher: r.teacher, members: r.members, openAssignments: r.open_assignments, toReview: r.to_review, lastActivity: r.last_activity }
        : { id: r.id, title: r.title, slug: r.slug, teacher: r.teacher, members: 0, openAssignments: 0, toReview: 0, lastActivity: null }) };
  } catch (error) {
    logger.warn("institutions.classes_failed", { institutionId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the classes." };
  }
}
