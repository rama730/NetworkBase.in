"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { coverSlots, suggestions, type Absence } from "@/lib/organizations/school-cover";
import { DAY_NAMES, isoDay, patternFor, readTimetableSettings, weekLetter, type Slot } from "@/lib/organizations/school-timetable";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.5 S4 calls 5–7, 11–12 (plan B3.4b): Away and cover. Anyone on the staff reports their own absence (by
 * day or periods); the school's leaders report anyone's, see reasons, and arrange cover from suggestions — nothing is
 * assigned on its own. Cover given to you is Important. Cover counts are never a ranking.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function school(schoolId: string, write = false) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || (write && auth.tokenKind != null)) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown; slug: string | null }>(sql`
    SELECT org_level AS level, org_settings AS settings, slug FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !(a.isOwner || a.isMember) || (write && !a.canWrite)) return null;
  // Security: a Viewer who isn't Cover only reads nothing here.
  const viewer = !a.isOwner && a.memberRole === "viewer";
  if (viewer && !coverOnlyOf(w.settings).includes(userId)) return null;
  return { userId, leader: a.isOwner || a.memberRole === "admin", settings: w.settings, slug: w.slug, viewer };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const absenceSchema = z.object({ userId: z.string().uuid().optional(), day: z.string().date(), from: z.string().max(20).nullable().optional(), to: z.string().max(20).nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional() }).strict();

/** Report an absence: your own, or (leaders) anyone's on the staff. */
export async function reportAbsenceAction(schoolId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx) return DENIED;
  const parsed = absenceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Pick the day, and the periods if it isn’t the whole day." };
  const who = parsed.data.userId ?? ctx.userId;
  if (who !== ctx.userId && !ctx.leader) return DENIED;
  const [staff] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = ${schoolId}::uuid AND owner_id = ${who}::uuid)
      OR EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND user_id = ${who}::uuid AND role <> 'viewer') AS ok`));
  if (!staff?.ok) return { success: false, error: "Pick someone on the school’s staff." };
  await db.execute(sql`INSERT INTO school_absences (workspace_id, user_id, day, from_period, to_period, reason, created_by)
    VALUES (${schoolId}::uuid, ${who}::uuid, ${parsed.data.day}::date, ${parsed.data.from || null}, ${parsed.data.to || null}, ${parsed.data.reason || null}, ${ctx.userId}::uuid)`);
  return { success: true };
}

export async function removeAbsenceAction(schoolId: string, absenceId: string): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !isLooseUuid(absenceId)) return DENIED;
  const done = Array.from(await db.execute<{ id: string }>(sql`DELETE FROM school_absences WHERE id = ${absenceId}::uuid AND workspace_id = ${schoolId}::uuid
    AND (${ctx.leader} OR user_id = ${ctx.userId}::uuid) RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

type Staff = { id: string; name: string; department: string | null };
/** B3.4d (call 8): outside supply staff join as Viewers and are marked Cover only by the school's leaders. */
const coverOnlyOf = (settings: unknown) => { const raw = (settings as { coverOnly?: unknown } | null)?.coverOnly; return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 100) : []; };
async function staffOf(schoolId: string): Promise<Staff[]> {
  const [w] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${schoolId}::uuid`));
  const coverOnly = coverOnlyOf(w?.settings);
  return Array.from(await db.execute<{ id: string; name: string | null; department: string | null }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username) AS name,
      (SELECT c.org_settings->>'department' FROM workspaces c WHERE c.institution_id = ${schoolId}::uuid AND c.owner_id = p.id AND c.deleted_at IS NULL AND c.org_settings ? 'department' LIMIT 1) AS department
    FROM profiles p WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${schoolId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid
      AND (role <> 'viewer' OR user_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(coverOnly)}::jsonb)::uuid)))`))
    .map((r) => ({ id: r.id, name: r.name ?? "Staff", department: r.department }));
}

/** The cover board for a day (leaders): absences with reasons, open and filled cover slots, suggestions with reasons. */
export async function readCoverBoardAction(schoolId: string, day: string) {
  try {
    const ctx = await school(schoolId);
    if (!ctx || !ctx.leader || !DAY.test(day)) return DENIED;
    const settings = readTimetableSettings(ctx.settings);
    const staff = await staffOf(schoolId);
    const names = new Map(staff.map((s) => [s.id, s.name]));
    const absences = Array.from(await db.execute<{ id: string; user_id: string; from_period: string | null; to_period: string | null; reason: string | null }>(sql`
      SELECT id, user_id, from_period, to_period, reason FROM school_absences WHERE workspace_id = ${schoolId}::uuid AND day = ${day}::date ORDER BY created_at`));
    if (!settings) return { success: true as const, day, absences: absences.map((a) => ({ id: a.id, name: names.get(a.user_id) ?? "Staff", from: a.from_period, to: a.to_period, reason: a.reason })), slots: [], filled: 0, needsDay: true };
    const pattern = patternFor(isoDay(day), settings);
    const order = (pattern?.periods ?? []).filter((p) => p.kind === "lesson").map((p) => p.key);
    const letter = weekLetter(day, settings);
    const daySlots = Array.from(await db.execute<{ id: string; period: string; week: string | null; class_name: string; teacher_id: string | null; room: string | null }>(sql`
      SELECT id, period, week, class_name, teacher_id, room FROM school_timetable_slots WHERE workspace_id = ${schoolId}::uuid AND day = ${isoDay(day)}`))
      .filter((s) => !s.week || !letter || s.week === letter)
      .map((s): Slot => ({ id: s.id, day: isoDay(day), period: s.period, week: s.week, className: s.class_name, courseId: null, teacherId: s.teacher_id, room: s.room }));
    const abs: Absence[] = absences.map((a) => ({ userId: a.user_id, from: a.from_period, to: a.to_period }));
    // B3.4d: a lesson cancelled for the day needs no cover.
    const cancelled = new Set(Array.from(await db.execute<{ slot_id: string }>(sql`SELECT slot_id FROM school_slot_changes WHERE workspace_id = ${schoolId}::uuid AND day = ${day}::date AND kind = 'cancelled'`)).map((r) => r.slot_id));
    const open = coverSlots(daySlots.filter((s) => !cancelled.has(s.id)), order, abs).sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period));
    const covers = Array.from(await db.execute<{ slot_id: string; cover_user_id: string; note: string | null }>(sql`
      SELECT slot_id, cover_user_id, note FROM school_covers WHERE workspace_id = ${schoolId}::uuid AND day = ${day}::date`));
    const counts = new Map(Array.from(await db.execute<{ user_id: string; n: number }>(sql`
      SELECT cover_user_id AS user_id, count(*)::int AS n FROM school_covers WHERE workspace_id = ${schoolId}::uuid AND day >= ${day}::date - 120 GROUP BY 1`)).map((r) => [r.user_id, Number(r.n)]));
    const slots = open.map((s) => {
      const filled = covers.find((c) => c.slot_id === s.id);
      const busy = new Set(daySlots.filter((x) => x.period === s.period && x.teacherId).map((x) => x.teacherId!));
      const away = new Set(abs.filter((a) => (!a.from && !a.to) || order.slice(order.indexOf(a.from ?? order[0]!), order.indexOf(a.to ?? order.at(-1)!) + 1).includes(s.period)).map((a) => a.userId));
      const covering = new Set(covers.filter((c) => daySlots.find((x) => x.id === c.slot_id)?.period === s.period).map((c) => c.cover_user_id));
      const dept = staff.find((x) => x.id === s.teacherId)?.department ?? null;
      return { id: s.id, period: s.period, className: s.className, room: s.room, teacher: names.get(s.teacherId!) ?? "Staff",
        cover: filled ? { name: names.get(filled.cover_user_id) ?? "Staff", userId: filled.cover_user_id, note: filled.note } : null,
        suggestions: filled ? [] : suggestions(s, s.period, staff.map((x) => ({ userId: x.id, name: x.name, department: x.department })), busy, away, covering, counts, dept) };
    });
    return { success: true as const, day, needsDay: false, filled: slots.filter((s) => s.cover).length,
      absences: absences.map((a) => ({ id: a.id, name: names.get(a.user_id) ?? "Staff", from: a.from_period, to: a.to_period, reason: a.reason })), slots,
      staff: staff.map((s) => ({ id: s.id, name: s.name })) };
  } catch (error) {
    logger.warn("school_cover.read_failed", { schoolId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the cover board." };
  }
}

/** Arrange cover (leaders): the manager picks; the cover person is told at once (Important). */
export async function assignCoverAction(schoolId: string, slotId: string, day: string, userId: string, note?: string): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !ctx.leader || !isLooseUuid(slotId) || !isLooseUuid(userId) || !DAY.test(day)) return DENIED;
  const [slot] = Array.from(await db.execute<{ class_name: string; period: string; room: string | null; teacher_id: string | null }>(sql`
    SELECT class_name, period, room, teacher_id FROM school_timetable_slots WHERE id = ${slotId}::uuid AND workspace_id = ${schoolId}::uuid`));
  if (!slot) return { success: false, error: "That lesson isn’t on the school’s timetable." };
  if (slot.teacher_id === userId) return { success: false, error: "Pick someone other than the absent teacher." };
  if (!(await staffOf(schoolId)).some((s) => s.id === userId)) return { success: false, error: "Pick someone on the school’s staff." };
  await db.execute(sql`INSERT INTO school_covers (workspace_id, slot_id, day, cover_user_id, note, assigned_by)
    VALUES (${schoolId}::uuid, ${slotId}::uuid, ${day}::date, ${userId}::uuid, ${note?.trim().slice(0, 1000) || null}, ${ctx.userId}::uuid)
    ON CONFLICT (slot_id, day) DO UPDATE SET cover_user_id = EXCLUDED.cover_user_id, note = EXCLUDED.note, assigned_by = EXCLUDED.assigned_by, created_at = now()`);
  await createNotification({ recipientUserId: userId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "important",
    title: `Cover: ${slot.class_name} ${slot.period}${slot.room ? ` · ${slot.room}` : ""} · ${DAY_NAMES[isoDay(day)]} ${day}`, href: `/org/${encodeURIComponent(ctx.slug ?? schoolId)}?tab=sprints`,
    entityRefs: { projectId: schoolId, projectSlug: ctx.slug }, dedupeKey: `cover:${slotId}:${day}:${userId}` }).catch(() => undefined);
  return { success: true };
}

export async function removeCoverAction(schoolId: string, slotId: string, day: string): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !ctx.leader || !isLooseUuid(slotId) || !DAY.test(day)) return DENIED;
  await db.execute(sql`DELETE FROM school_covers WHERE workspace_id = ${schoolId}::uuid AND slot_id = ${slotId}::uuid AND day = ${day}::date`);
  return { success: true };
}

/** My absences and covers (anyone on the staff): what I reported, and lessons I cover, from today. */
export async function readMyCoverAction(schoolId: string, from: string) {
  const ctx = await school(schoolId);
  if (!ctx || !DAY.test(from)) return DENIED;
  const absences = Array.from(await db.execute<{ id: string; day: string; from_period: string | null; to_period: string | null }>(sql`
    SELECT id, day::text, from_period, to_period FROM school_absences WHERE workspace_id = ${schoolId}::uuid AND user_id = ${ctx.userId}::uuid AND day >= ${from}::date ORDER BY day LIMIT 50`));
  const covers = Array.from(await db.execute<{ day: string; period: string; class_name: string; room: string | null; note: string | null }>(sql`
    SELECT c.day::text, s.period, s.class_name, s.room, c.note FROM school_covers c JOIN school_timetable_slots s ON s.id = c.slot_id
    WHERE c.workspace_id = ${schoolId}::uuid AND c.cover_user_id = ${ctx.userId}::uuid AND c.day >= ${from}::date ORDER BY c.day, s.period LIMIT 50`));
  const info = ((ctx.settings as { coverInfo?: Record<string, unknown> } | null)?.coverInfo ?? {}) as Record<string, CoverInfo>;
  return { success: true as const, absences: absences.map((a) => ({ id: a.id, day: a.day, from: a.from_period, to: a.to_period })),
    covers: covers.map((c) => ({ ...c, info: info[c.class_name] ?? null })) };
}

/** B3.4d (call 10): cover info per class — routines, where things are, emergencies; never student names or medical details. */
export type CoverInfo = { routines: string; where: string; emergencies: string };
const infoSchema = z.object({ routines: z.string().trim().max(2000), where: z.string().trim().max(2000), emergencies: z.string().trim().max(2000) }).strict();

export async function readCoverInfoAction(schoolId: string, className: string) {
  const ctx = await school(schoolId);
  if (!ctx || typeof className !== "string" || !className.trim() || className.length > 40) return DENIED;
  const info = ((ctx.settings as { coverInfo?: Record<string, CoverInfo> } | null)?.coverInfo ?? {})[className] ?? null;
  return { success: true as const, info };
}

/** Write a class's cover info: the school's leaders or a teacher who teaches that class. */
export async function saveCoverInfoAction(schoolId: string, className: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || typeof className !== "string" || !className.trim() || className.length > 40) return DENIED;
  if (!ctx.leader) {
    const [t] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM school_timetable_slots WHERE workspace_id = ${schoolId}::uuid AND class_name = ${className} AND teacher_id = ${ctx.userId}::uuid) AS ok`));
    if (!t?.ok) return DENIED;
  }
  const parsed = infoSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Keep each part of the cover info to 2,000 characters." };
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{coverInfo}',
    coalesce(org_settings->'coverInfo', '{}'::jsonb) || jsonb_build_object(${className}::text, ${JSON.stringify(parsed.data)}::jsonb)) WHERE id = ${schoolId}::uuid`);
  return { success: true };
}

/** Cover only (call 8): the school's leaders mark Viewers as outside cover staff; they see only their covers. */
export async function saveCoverOnlyAction(schoolId: string, userIds: string[]): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx?.leader || !Array.isArray(userIds) || userIds.length > 100 || !userIds.every(isLooseUuid)) return DENIED;
  const viewers = new Set(Array.from(await db.execute<{ user_id: string }>(sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND role = 'viewer'`)).map((r) => r.user_id));
  if (userIds.some((id) => !viewers.has(id))) return { success: false, error: "Cover only is for Viewers (outside supply staff)." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('coverOnly', ${JSON.stringify(userIds)}::jsonb) WHERE id = ${schoolId}::uuid`);
  return { success: true };
}

/** The school's Viewers, and which are Cover only (leaders). */
export async function readCoverOnlyAction(schoolId: string) {
  const ctx = await school(schoolId);
  if (!ctx?.leader) return DENIED;
  const on = new Set(coverOnlyOf(ctx.settings));
  const viewers = Array.from(await db.execute<{ id: string; name: string | null }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username) AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${schoolId}::uuid AND m.role = 'viewer' ORDER BY 2`));
  return { success: true as const, viewers: viewers.map((v) => ({ id: v.id, name: v.name ?? "Viewer", coverOnly: on.has(v.id) })) };
}
