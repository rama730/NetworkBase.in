"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { createNotification } from "@/lib/notifications/service";
import { isoDay } from "@/lib/organizations/school-timetable";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.5 S4 calls 3, 9 (plan B3.4c): duties and swaps. Everyone on the staff reads the duty grid; the school's
 * leaders set duties; a person asks a colleague to take one date, the colleague's yes makes it so (no manager
 * approval) and the leaders are told. A swap asked of you is Normal; accepted is Normal to the asker.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function school(schoolId: string, write = false) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || (write && auth.tokenKind != null)) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; slug: string | null }>(sql`SELECT org_level AS level, slug FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !(a.isOwner || a.isMember) || (write && !a.canWrite)) return null;
  return { userId, leader: a.isOwner || a.memberRole === "admin", slug: w.slug };
}

async function onStaff(schoolId: string, userId: string) {
  const [r] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM workspaces WHERE id = ${schoolId}::uuid AND owner_id = ${userId}::uuid)
      OR EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer') AS ok`));
  return Boolean(r?.ok);
}
const notify = (to: string, actor: string, schoolId: string, slug: string | null, title: string, key: string) => createNotification({
  recipientUserId: to, actorUserId: actor, kind: "project_task_activity", category: "tasks", importance: "more", title,
  href: `/org/${encodeURIComponent(slug ?? schoolId)}?tab=sprints`, entityRefs: { projectId: schoolId, projectSlug: slug }, dedupeKey: key }).catch(() => undefined);

/** The duty grid, my duties and the swaps asked of me; the staff list for leaders and for asking a swap. */
export async function readDutiesAction(schoolId: string) {
  const ctx = await school(schoolId);
  if (!ctx) return DENIED;
  const duties = Array.from(await db.execute<{ id: string; place: string; day: number; slot: string; week: string | null; user_id: string; name: string | null }>(sql`
    SELECT d.id, d.place, d.day, d.slot, d.week, d.user_id, coalesce(p.full_name, p.username) AS name FROM school_duties d JOIN profiles p ON p.id = d.user_id
    WHERE d.workspace_id = ${schoolId}::uuid ORDER BY d.place, d.day, d.slot LIMIT 2000`)).map((d) => ({ ...d, day: Number(d.day), name: d.name ?? "Staff" }));
  const swaps = Array.from(await db.execute<{ id: string; day: string; place: string; slot: string; from_name: string | null; to_user: string; from_user: string; state: string }>(sql`
    SELECT s.id, s.day::text, d.place, d.slot, coalesce(p.full_name, p.username) AS from_name, s.to_user, s.from_user, s.state FROM school_duty_swaps s
    JOIN school_duties d ON d.id = s.duty_id JOIN profiles p ON p.id = s.from_user
    WHERE s.workspace_id = ${schoolId}::uuid AND (s.to_user = ${ctx.userId}::uuid OR s.from_user = ${ctx.userId}::uuid) AND s.day >= current_date ORDER BY s.day LIMIT 100`));
  const staff = Array.from(await db.execute<{ id: string; name: string | null }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username) AS name FROM profiles p
    WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${schoolId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND role <> 'viewer') ORDER BY 2`));
  return { success: true as const, leader: ctx.leader, me: ctx.userId, duties, staff: staff.map((s) => ({ id: s.id, name: s.name ?? "Staff" })),
    askedOfMe: swaps.filter((s) => s.to_user === ctx.userId && s.state === "asked").map((s) => ({ id: s.id, day: s.day, place: s.place, slot: s.slot, from: s.from_name ?? "Staff" })),
    myAsks: swaps.filter((s) => s.from_user === ctx.userId).map((s) => ({ id: s.id, day: s.day, place: s.place, slot: s.slot, state: s.state })) };
}

const dutySchema = z.object({ place: z.string().trim().min(1, "Name the place.").max(60), day: z.number().int().min(1).max(7), slot: z.string().trim().min(1, "Say when (a period, Before school or After school).").max(30),
  week: z.enum(["A", "B"]).nullable().optional(), userId: z.string().uuid() }).strict();

/** A duty (leaders). */
export async function saveDutyAction(schoolId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx?.leader) return DENIED;
  const parsed = dutySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the duty." };
  if (!(await onStaff(schoolId, parsed.data.userId))) return { success: false, error: "Pick someone on the school’s staff." };
  await db.execute(sql`INSERT INTO school_duties (workspace_id, place, day, slot, week, user_id) VALUES (${schoolId}::uuid, ${parsed.data.place}, ${parsed.data.day}, ${parsed.data.slot}, ${parsed.data.week ?? null}, ${parsed.data.userId}::uuid)`);
  return { success: true };
}

export async function removeDutyAction(schoolId: string, dutyId: string): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx?.leader || !isLooseUuid(dutyId)) return DENIED;
  await db.execute(sql`DELETE FROM school_duties WHERE id = ${dutyId}::uuid AND workspace_id = ${schoolId}::uuid`);
  return { success: true };
}

/** Ask a colleague to take my duty on one date (it must be a day that duty happens). */
export async function askDutySwapAction(schoolId: string, dutyId: string, day: string, toUserId: string): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !isLooseUuid(dutyId) || !isLooseUuid(toUserId) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || toUserId === ctx.userId) return DENIED;
  const [d] = Array.from(await db.execute<{ day: number; place: string; slot: string; user_id: string }>(sql`SELECT day, place, slot, user_id FROM school_duties WHERE id = ${dutyId}::uuid AND workspace_id = ${schoolId}::uuid`));
  if (!d || d.user_id !== ctx.userId) return { success: false, error: "That isn’t your duty." };
  if (Number(d.day) !== isoDay(day)) return { success: false, error: "Pick a day when that duty happens." };
  if (!(await onStaff(schoolId, toUserId))) return { success: false, error: "Pick someone on the school’s staff." };
  await db.execute(sql`INSERT INTO school_duty_swaps (workspace_id, duty_id, day, from_user, to_user) VALUES (${schoolId}::uuid, ${dutyId}::uuid, ${day}::date, ${ctx.userId}::uuid, ${toUserId}::uuid)`);
  await notify(toUserId, ctx.userId, schoolId, ctx.slug, `Swap asked: ${d.place} duty, ${d.slot}, ${day}`, `duty-swap:${dutyId}:${day}:${toUserId}`);
  return { success: true };
}

/** The colleague's answer: a yes swaps it for that date; the asker and the school's leaders are told. */
export async function answerDutySwapAction(schoolId: string, swapId: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx || !isLooseUuid(swapId)) return DENIED;
  const [s] = Array.from(await db.execute<{ id: string; from_user: string; day: string; place: string; slot: string }>(sql`
    UPDATE school_duty_swaps w SET state = ${accept ? "accepted" : "declined"}, decided_at = now() FROM school_duties d
    WHERE w.id = ${swapId}::uuid AND w.workspace_id = ${schoolId}::uuid AND w.to_user = ${ctx.userId}::uuid AND w.state = 'asked' AND d.id = w.duty_id
    RETURNING w.id, w.from_user, w.day::text AS day, d.place, d.slot`).catch(() => [] as never[]));
  if (!s) return { success: false, error: "That swap was answered or taken already." };
  await notify(s.from_user, ctx.userId, schoolId, ctx.slug, `Swap ${accept ? "accepted" : "declined"}: ${s.place} duty, ${s.slot}, ${s.day}`, `duty-swap-answer:${swapId}`);
  if (accept) {
    const leaders = Array.from(await db.execute<{ id: string }>(sql`SELECT owner_id AS id FROM workspaces WHERE id = ${schoolId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND role = 'admin'`));
    for (const l of leaders) if (l.id !== ctx.userId && l.id !== s.from_user) await notify(l.id, ctx.userId, schoolId, ctx.slug, `Duty swapped: ${s.place}, ${s.slot}, ${s.day}`, `duty-swapped:${swapId}:${l.id}`);
  }
  return { success: true };
}
