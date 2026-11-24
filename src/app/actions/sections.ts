"use server";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { classSectionMembers, classSections, profiles, workspaceMembers, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import type { OrgType } from "@/lib/organizations/config";
import { readSectionSettings, seatsLeft, splitStudents, type SplitMethod } from "@/lib/organizations/sections";
import { typeProfile } from "@/lib/organizations/type-profile";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.9 W8 (plan B1.3a): sections in a class. The teacher (owner) makes, splits and moves; TAs (admins) see
 * every section; a student sees only their own sections and their section classmates' names (layer 16).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function classAccess(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const [c] = await db.select({ id: workspaces.id, kind: workspaces.kind, orgType: workspaces.orgType, orgLevel: workspaces.orgLevel, orgSettings: workspaces.orgSettings, slug: workspaces.slug })
    .from(workspaces).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt))).limit(1);
  if (c?.kind !== "organization" || c.orgLevel || !typeProfile(c.orgType as OrgType | null).schools) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(a.isOwner || a.isMember) || !a.canRead) return null;
  return { c, userId, teacher: a.isOwner, staff: a.isOwner || a.memberRole === "admin", canWrite: a.canWrite, settings: readSectionSettings(c.orgSettings) };
}

const name = (p: { fullName: string | null; username: string | null }) => p.fullName || p.username || "Someone";

export type SectionRow = {
  id: string; name: string; kind: "lab" | "tutorial" | "lecture"; meets: Array<{ day: number; start: string; end: string }>; room: string | null;
  officeHours: { days: number[]; start: string; end: string; place: string | null } | null; seatLimit: number | null; seatsLeft: number | null;
  tas: Array<{ id: string; name: string }>; students: Array<{ id: string; name: string }>; mine: boolean;
};

export async function readSectionsAction(orgId: string) {
  try {
    const ctx = await classAccess(orgId);
    if (!ctx) return DENIED;
    const sections = await db.select().from(classSections).where(eq(classSections.projectId, orgId)).orderBy(asc(classSections.position), asc(classSections.createdAt));
    const members = sections.length ? await db.select({ sectionId: classSectionMembers.sectionId, userId: classSectionMembers.userId, role: classSectionMembers.role,
      fullName: profiles.fullName, username: profiles.username })
      .from(classSectionMembers).innerJoin(profiles, eq(profiles.id, classSectionMembers.userId)).where(eq(classSectionMembers.projectId, orgId)) : [];
    const myIds = new Set(members.filter((m) => m.userId === ctx.userId).map((m) => m.sectionId));
    const rows: SectionRow[] = sections.map((s) => {
      const of = members.filter((m) => m.sectionId === s.id);
      const students = of.filter((m) => m.role === "student").map((m) => ({ id: m.userId, name: name(m) })).sort((a, b) => a.name.localeCompare(b.name));
      return { id: s.id, name: s.name, kind: s.kind as SectionRow["kind"], meets: s.meets ?? [], room: s.room, officeHours: s.officeHours ?? null, seatLimit: s.seatLimit,
        seatsLeft: seatsLeft(s.seatLimit, students.length), tas: of.filter((m) => m.role === "ta").map((m) => ({ id: m.userId, name: name(m) })), students, mine: myIds.has(s.id) };
    });
    // Layer 16: a student sees only their own sections' names; with self-pick on, the others' times and seats (no names).
    const visible = ctx.staff ? rows : rows.flatMap((r) => (r.mine ? [r] : ctx.settings.selfPick ? [{ ...r, students: [] }] : []));
    let unplaced: Array<{ id: string; name: string }> = [];
    if (ctx.staff) {
      const roster = await db.select({ id: workspaceMembers.userId, fullName: profiles.fullName, username: profiles.username }).from(workspaceMembers)
        .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "member")));
      const placed = new Set(members.filter((m) => m.role === "student").map((m) => m.userId));
      unplaced = roster.filter((r) => !placed.has(r.id)).map((r) => ({ id: r.id, name: name(r) })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return { success: true as const, role: ctx.teacher ? "teacher" as const : ctx.staff ? "ta" as const : "student" as const, canWrite: ctx.canWrite, settings: ctx.settings, sections: visible, unplaced };
  } catch (error) {
    logger.warn("sections.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the sections." };
  }
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const sectionInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name the section.").max(60),
  kind: z.enum(["lab", "tutorial", "lecture"]),
  meets: z.array(z.object({ day: z.number().int().min(0).max(6), start: time, end: time }).refine((m) => m.end > m.start, "A session ends after it starts.")).max(14),
  room: z.string().trim().max(80).nullable(),
  officeHours: z.object({ days: z.array(z.number().int().min(0).max(6)).max(7), start: time, end: time, place: z.string().trim().max(80).nullable() }).nullable(),
  seatLimit: z.number().int().min(1).max(2000).nullable(),
  taIds: z.array(z.string().uuid()).max(10),
});

/** + New section / Edit (the teacher). TAs must be the class's TAs (admins). */
export async function saveSectionAction(orgId: string, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite) return DENIED;
  const parsed = sectionInput.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the section." };
  const d = parsed.data;
  const admins = d.taIds.length ? new Set((await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "admin"), inArray(workspaceMembers.userId, d.taIds)))).map((r) => r.id)) : new Set<string>();
  if (d.taIds.some((id) => !admins.has(id))) return { success: false, error: "A section’s TAs are the class’s TAs." };
  const values = { name: d.name, kind: d.kind, meets: d.meets, room: d.room || null, officeHours: d.officeHours, seatLimit: d.seatLimit };
  const id = await db.transaction(async (tx) => {
    let sectionId = d.id ?? null;
    if (sectionId) {
      const done = await tx.update(classSections).set(values).where(and(eq(classSections.id, sectionId), eq(classSections.projectId, orgId))).returning({ id: classSections.id });
      if (!done.length) return null;
      await tx.update(classSectionMembers).set({ kind: d.kind }).where(eq(classSectionMembers.sectionId, sectionId));
    } else {
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(classSections).where(eq(classSections.projectId, orgId));
      const [made] = await tx.insert(classSections).values({ ...values, projectId: orgId, position: n }).returning({ id: classSections.id });
      sectionId = made!.id;
    }
    await tx.delete(classSectionMembers).where(and(eq(classSectionMembers.sectionId, sectionId!), eq(classSectionMembers.role, "ta")));
    if (d.taIds.length) await tx.insert(classSectionMembers).values(d.taIds.map((userId) => ({ sectionId: sectionId!, projectId: orgId, userId, role: "ta" as const, kind: d.kind })));
    return sectionId;
  }).catch((error: Error) => { logger.warn("sections.save_failed", { orgId, error: error.message }); return null; });
  return id ? { success: true, id } : { success: false, error: "Couldn’t save the section." };
}

/** Remove a section; with students in it the teacher picks where they go first (layer 12). */
export async function deleteSectionAction(orgId: string, sectionId: string, moveTo: string | null): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite || !isLooseUuid(sectionId)) return DENIED;
  const students = await db.select({ userId: classSectionMembers.userId }).from(classSectionMembers)
    .where(and(eq(classSectionMembers.sectionId, sectionId), eq(classSectionMembers.projectId, orgId), eq(classSectionMembers.role, "student")));
  if (students.length && !moveTo) return { success: false, error: `Move its ${students.length} students to another section first.` };
  if (moveTo) for (const s of students) { const r = await placeStudent(orgId, s.userId, moveTo); if (!r.success) return r; }
  await db.delete(classSections).where(and(eq(classSections.id, sectionId), eq(classSections.projectId, orgId)));
  return { success: true };
}

/** One section per student per kind: placing replaces their place in the same kind. */
async function placeStudent(orgId: string, userId: string, sectionId: string): Promise<{ success: true } | Failure> {
  const [s] = await db.select({ kind: classSections.kind }).from(classSections).where(and(eq(classSections.id, sectionId), eq(classSections.projectId, orgId))).limit(1);
  if (!s) return { success: false, error: "That section isn’t in this class." };
  const [member] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId))).limit(1);
  if (member?.role !== "member") return { success: false, error: "Only students go in sections; TAs are set on the section." };
  await db.transaction(async (tx) => {
    await tx.delete(classSectionMembers).where(and(eq(classSectionMembers.projectId, orgId), eq(classSectionMembers.userId, userId), eq(classSectionMembers.kind, s.kind), eq(classSectionMembers.role, "student")));
    await tx.insert(classSectionMembers).values({ sectionId, projectId: orgId, userId, role: "student", kind: s.kind });
  });
  return { success: true };
}

/** Move a student (the menu path for the drag). The student is told (Normal). */
export async function moveStudentAction(orgId: string, userId: string, sectionId: string): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite || !isLooseUuid(userId) || !isLooseUuid(sectionId)) return DENIED;
  const r = await placeStudent(orgId, userId, sectionId);
  if (r.success) await tellPlaced(orgId, ctx.c.slug, ctx.userId, [userId], sectionId, ctx.settings.word);
  return r;
}

/** Split students… : a preview (apply = false) or the change (apply = true), over the students not yet in this kind. */
export async function splitStudentsAction(orgId: string, input: { kind: "lab" | "tutorial" | "lecture"; method: SplitMethod; everyone: boolean; apply: boolean; seed?: string }) {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite) return DENIED;
  if (!["lab", "tutorial", "lecture"].includes(input.kind) || !["even", "random", "surname"].includes(input.method)) return { success: false as const, error: "Pick a kind and a way to split." };
  const sections = await db.select({ id: classSections.id, name: classSections.name, seatLimit: classSections.seatLimit }).from(classSections)
    .where(and(eq(classSections.projectId, orgId), eq(classSections.kind, input.kind))).orderBy(asc(classSections.position));
  if (!sections.length) return { success: false as const, error: "Make a section of this kind first." };
  const roster = await db.select({ id: workspaceMembers.userId, fullName: profiles.fullName, username: profiles.username }).from(workspaceMembers)
    .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "member")));
  const placedNow = new Set((await db.select({ userId: classSectionMembers.userId }).from(classSectionMembers)
    .where(and(eq(classSectionMembers.projectId, orgId), eq(classSectionMembers.kind, input.kind), eq(classSectionMembers.role, "student")))).map((r) => r.userId));
  const pool = roster.filter((r) => input.everyone || !placedNow.has(r.id)).map((r) => ({ id: r.id, name: name(r) }));
  const plan = splitStudents(pool, sections, input.method, input.seed ?? orgId);
  const preview = sections.map((s) => ({ id: s.id, name: s.name, students: plan.placed.filter((p) => p.sectionId === s.id).map((p) => pool.find((x) => x.id === p.userId)!.name) }));
  if (!input.apply) return { success: true as const, preview, unplaced: plan.unplaced.length };
  await db.transaction(async (tx) => {
    const ids = plan.placed.map((p) => p.userId);
    if (ids.length) await tx.delete(classSectionMembers).where(and(eq(classSectionMembers.projectId, orgId), eq(classSectionMembers.kind, input.kind), eq(classSectionMembers.role, "student"), inArray(classSectionMembers.userId, ids)));
    if (plan.placed.length) await tx.insert(classSectionMembers).values(plan.placed.map((p) => ({ sectionId: p.sectionId, projectId: orgId, userId: p.userId, role: "student" as const, kind: input.kind })));
  });
  for (const s of sections) await tellPlaced(orgId, ctx.c.slug, ctx.userId, plan.placed.filter((p) => p.sectionId === s.id).map((p) => p.userId), s.id, ctx.settings.word);
  return { success: true as const, preview, unplaced: plan.unplaced.length };
}

/** Students pick their own section, when Settings → Sections allows it, while seats are left (call 3). */
export async function pickSectionAction(orgId: string, sectionId: string): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx || ctx.staff || !ctx.canWrite || !isLooseUuid(sectionId)) return DENIED;
  if (!ctx.settings.selfPick) return { success: false, error: `Your teacher places you in a ${ctx.settings.word.toLowerCase()}.` };
  // The seat check and the place happen together, so two students can't take the last seat at once.
  return db.transaction(async (tx) => {
    const [s] = await tx.execute<{ kind: string; seat_limit: number | null }>(sql`SELECT kind, seat_limit FROM class_sections WHERE id = ${sectionId}::uuid AND workspace_id = ${orgId}::uuid FOR UPDATE`);
    if (!s) return { success: false as const, error: "That section isn’t in this class." };
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(classSectionMembers).where(and(eq(classSectionMembers.sectionId, sectionId), eq(classSectionMembers.role, "student")));
    if (s.seat_limit != null && n >= s.seat_limit) return { success: false as const, error: "No seats left in that one." };
    await tx.delete(classSectionMembers).where(and(eq(classSectionMembers.projectId, orgId), eq(classSectionMembers.userId, ctx.userId), eq(classSectionMembers.kind, s.kind), eq(classSectionMembers.role, "student")));
    await tx.insert(classSectionMembers).values({ sectionId, projectId: orgId, userId: ctx.userId, role: "student", kind: s.kind });
    return { success: true as const };
  });
}

/** Settings → Sections (the teacher): the word, TAs work only with their section, students pick their own. */
export async function saveSectionSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite) return DENIED;
  const parsed = z.object({ word: z.enum(["Section", "Batch", "Lab group", "Tutorial"]), taOnlyOwn: z.boolean(), selfPick: z.boolean() }).safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the section settings." };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ sections: parsed.data })}::jsonb` }).where(eq(workspaces.id, orgId));
  return { success: true };
}

async function tellPlaced(orgId: string, slug: string | null, actorId: string, userIds: string[], sectionId: string, word: string) {
  if (!userIds.length) return;
  const [s] = await db.select({ name: classSections.name }).from(classSections).where(eq(classSections.id, sectionId)).limit(1);
  const { createNotification } = await import("@/lib/notifications/service");
  for (const userId of userIds) {
    await createNotification({ recipientUserId: userId, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `You’re in ${word} ${s?.name ?? ""}`.trim(), href: `/org/${encodeURIComponent(slug ?? orgId)}`, entityRefs: { projectId: orgId, projectSlug: slug },
      dedupeKey: `section-placed:${sectionId}:${userId}:${Date.now()}` }).catch(() => undefined);
  }
}
