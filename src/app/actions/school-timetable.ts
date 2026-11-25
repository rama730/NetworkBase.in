"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { dayView, isoDay, meetsFromSlots, readTimetableSettings, timetableSettingsSchema, withChanges, type ImportSlot, type Slot } from "@/lib/organizations/school-timetable";
import { todayInZone } from "@/lib/organizations/zoned-time";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.5 S4 calls 1–4 (plan B3.4a): Settings → Timetable (day patterns, Week A / B, import), My timetable and
 * Your day. Staff read their own slots; the school's leaders read and edit the whole timetable. No student data.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function school(schoolId: string, write = false) {
  if (!isLooseUuid(schoolId)) return null;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || (write && auth.tokenKind != null)) return null;
  const a = await getWorkspaceAccessById(schoolId, userId);
  const [w] = Array.from(await db.execute<{ level: string | null; settings: unknown; zone: string | null }>(sql`
    SELECT org_level AS level, org_settings AS settings, time_zone AS zone FROM workspaces WHERE id = ${schoolId}::uuid AND deleted_at IS NULL`));
  if (w?.level !== "institution" || !a.canRead || !(a.isOwner || a.isMember)) return null;
  const leader = a.isOwner || a.memberRole === "admin";
  if (write && (!leader || !a.canWrite)) return null;
  return { userId, leader, settings: w.settings, zone: w.zone };
}

async function slotsOf(schoolId: string, teacherId: string | null) {
  return Array.from(await db.execute<{ id: string; day: number; period: string; week: string | null; class_name: string; course_id: string | null; teacher_id: string | null; teacher: string | null; room: string | null }>(sql`
    SELECT s.id, s.day, s.period, s.week, s.class_name, s.course_id, s.teacher_id, coalesce(p.full_name, p.username) AS teacher, s.room
    FROM school_timetable_slots s LEFT JOIN profiles p ON p.id = s.teacher_id
    WHERE s.workspace_id = ${schoolId}::uuid ${teacherId ? sql`AND s.teacher_id = ${teacherId}::uuid` : sql``} ORDER BY s.day, s.period LIMIT 5000`))
    .map((r): Slot => ({ id: r.id, day: Number(r.day), period: r.period, week: r.week, className: r.class_name, courseId: r.course_id, teacherId: r.teacher_id, teacher: r.teacher, room: r.room }));
}

/** My timetable and Your day for everyone on the staff; the whole timetable for leaders. */
export async function readTimetableAction(schoolId: string, day?: string) {
  const ctx = await school(schoolId);
  if (!ctx) return DENIED;
  const settings = readTimetableSettings(ctx.settings);
  const today = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayInZone(ctx.zone);
  // B3.4d: today's one-off changes (cancelled, another room) apply to Your day.
  const changes = Array.from(await db.execute<{ slot_id: string; kind: string; room: string | null }>(sql`
    SELECT slot_id, kind, room FROM school_slot_changes WHERE workspace_id = ${schoolId}::uuid AND day = ${today}::date`)).map((c) => ({ slotId: c.slot_id, kind: c.kind, room: c.room }));
  const mine = withChanges(await slotsOf(schoolId, ctx.userId), changes);
  // B3.4b–c (report 32.5 Your day): today's covers given to me, and my duties (a swap I gave away is gone; one I took is mine).
  const covers = Array.from(await db.execute<{ period: string; class_name: string; room: string | null; note: string | null }>(sql`
    SELECT s.period, s.class_name, s.room, c.note FROM school_covers c JOIN school_timetable_slots s ON s.id = c.slot_id
    WHERE c.workspace_id = ${schoolId}::uuid AND c.cover_user_id = ${ctx.userId}::uuid AND c.day = ${today}::date`));
  const duties = Array.from(await db.execute<{ place: string; slot: string }>(sql`
    SELECT d.place, d.slot FROM school_duties d WHERE d.workspace_id = ${schoolId}::uuid AND d.day = ${isoDay(today)}
      AND ((d.user_id = ${ctx.userId}::uuid AND NOT EXISTS (SELECT 1 FROM school_duty_swaps w WHERE w.duty_id = d.id AND w.day = ${today}::date AND w.state = 'accepted'))
        OR EXISTS (SELECT 1 FROM school_duty_swaps w WHERE w.duty_id = d.id AND w.day = ${today}::date AND w.state = 'accepted' AND w.to_user = ${ctx.userId}::uuid))
    ORDER BY d.slot`));
  return { success: true as const, leader: ctx.leader, settings, today, mine, yourDay: settings ? dayView(today, mine, settings) : [], covers, duties,
    all: ctx.leader ? await slotsOf(schoolId, null) : [] };
}

/** Settings → Timetable: day patterns and Week A / B (school leaders). */
export async function saveTimetableSettingsAction(schoolId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx) return DENIED;
  const parsed = timetableSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the school day." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('timetable', ${JSON.stringify(parsed.data)}::jsonb) WHERE id = ${schoolId}::uuid`);
  return { success: true };
}

/**
 * Import… a timetable read in the browser (call 3): it replaces the school's slots. Teachers are matched by name among
 * the school's staff; a row naming nobody on the staff is kept without a teacher and reported.
 */
export async function importTimetableAction(schoolId: string, rows: ImportSlot[]): Promise<{ success: true; added: number; unmatched: string[] } | Failure> {
  const ctx = await school(schoolId, true);
  if (!ctx) return DENIED;
  if (!Array.isArray(rows) || !rows.length || rows.length > 3000) return { success: false, error: "Import 1–3,000 rows at a time." };
  const settings = readTimetableSettings(ctx.settings);
  if (!settings) return { success: false, error: "Set up the school day first." };
  const keys = new Set(settings.patterns.flatMap((p) => p.periods.filter((x) => x.kind === "lesson").map((x) => x.key)));
  const staff = Array.from(await db.execute<{ id: string; name: string | null; username: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username FROM profiles p
    WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${schoolId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${schoolId}::uuid AND role <> 'viewer')`));
  // Security review: a name or username matches only when it points at exactly one person on the staff (usernames and
  // full names counted together); anything ambiguous stays unmatched and is reported, so nobody takes a colleague's slots.
  const hits = new Map<string, Set<string>>();
  for (const x of staff) for (const n of [x.name, x.username]) if (n) hits.set(n.trim().toLowerCase(), (hits.get(n.trim().toLowerCase()) ?? new Set()).add(x.id));
  const byName = { get: (n: string) => (hits.get(n)?.size === 1 ? [...hits.get(n)!][0] : undefined) };
  const good = rows.filter((r) => r && Number.isInteger(r.day) && r.day! >= 1 && r.day! <= 7 && typeof r.period === "string" && keys.has(r.period)
    && typeof r.className === "string" && r.className.trim() && (r.week === null || r.week === "A" || r.week === "B"));
  if (!good.length) return { success: false, error: "No row matches the school day." };
  const unmatched = new Set<string>();
  const values = good.map((r) => {
    const teacher = r.teacher?.trim() ? byName.get(r.teacher.trim().toLowerCase()) ?? null : null;
    if (r.teacher?.trim() && !teacher) unmatched.add(r.teacher.trim().slice(0, 80));
    return { day: r.day!, period: r.period, week: r.week, className: r.className.trim().slice(0, 40), teacher, room: r.room?.trim().slice(0, 40) || null };
  });
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM school_timetable_slots WHERE workspace_id = ${schoolId}::uuid`);
    await tx.execute(sql`INSERT INTO school_timetable_slots (workspace_id, day, period, week, class_name, teacher_id, room)
      SELECT ${schoolId}::uuid, (v->>'day')::smallint, v->>'period', v->>'week', v->>'className', (v->>'teacher')::uuid, v->>'room'
      FROM jsonb_array_elements(${JSON.stringify(values)}::jsonb) v`);
  });
  return { success: true, added: values.length, unmatched: [...unmatched].slice(0, 50) };
}

/** B3.4d "Today only": cancel a lesson or move its room for one day — the school's leaders or the slot's teacher. */
export async function setSlotChangeAction(schoolId: string, slotId: string, day: string, change: { kind: "cancelled" } | { kind: "room"; room: string } | null): Promise<{ success: true } | Failure> {
  const ctx = await school(schoolId, false);
  if (!ctx || !isLooseUuid(slotId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return DENIED;
  const [slot] = Array.from(await db.execute<{ teacher_id: string | null; day: number }>(sql`SELECT teacher_id, day FROM school_timetable_slots WHERE id = ${slotId}::uuid AND workspace_id = ${schoolId}::uuid`));
  if (!slot || (!ctx.leader && slot.teacher_id !== ctx.userId)) return DENIED;
  if (Number(slot.day) !== isoDay(day)) return { success: false, error: "That lesson isn’t on that day." };
  if (!change) { await db.execute(sql`DELETE FROM school_slot_changes WHERE slot_id = ${slotId}::uuid AND day = ${day}::date`); return { success: true }; }
  const room = change.kind === "room" ? String(change.room ?? "").trim().slice(0, 40) : null;
  if (change.kind === "room" && !room) return { success: false, error: "Name the room." };
  await db.execute(sql`INSERT INTO school_slot_changes (workspace_id, slot_id, day, kind, room, created_by) VALUES (${schoolId}::uuid, ${slotId}::uuid, ${day}::date, ${change.kind}, ${room}, ${ctx.userId}::uuid)
    ON CONFLICT (slot_id, day) DO UPDATE SET kind = EXCLUDED.kind, room = EXCLUDED.room, created_by = EXCLUDED.created_by, created_at = now()`);
  return { success: true };
}

/**
 * B3.4d (report 32.5 call 4): a course's class times come from the timetable — its teacher's slots for the classes it
 * teaches (all of them when it lists none). The course's teacher; its other details stay.
 */
export async function classTimesFromTimetableAction(classId: string): Promise<{ success: true; meets: number } | Failure> {
  if (!isLooseUuid(classId)) return DENIED;
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id;
  if (!userId || auth.tokenKind != null) return DENIED;
  const [c] = Array.from(await db.execute<{ owner_id: string; institution_id: string | null; settings: unknown }>(sql`
    SELECT owner_id, institution_id, org_settings AS settings FROM workspaces WHERE id = ${classId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!c || c.owner_id !== userId || !c.institution_id) return DENIED;
  const [sch] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${c.institution_id}::uuid`));
  const settings = readTimetableSettings(sch?.settings);
  if (!settings) return { success: false, error: "The school hasn’t set up its timetable yet." };
  const { readGroups } = await import("@/lib/organizations/curriculum");
  const meets = meetsFromSlots(await slotsOf(c.institution_id, userId), settings, readGroups(c.settings));
  if (!meets.length) return { success: false, error: "You have no lessons for this course on the school’s timetable." };
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{classDetails}',
    coalesce(org_settings->'classDetails', ${JSON.stringify({ courseCode: null, room: null, onlineLink: null, officeHours: null, credits: null, breaks: [], show: { courseCode: true, meets: true, term: true, room: false, officeHours: false } })}::jsonb)
      || jsonb_build_object('meets', ${JSON.stringify(meets)}::jsonb)), updated_at = now() WHERE id = ${classId}::uuid`);
  return { success: true, meets: meets.length };
}
