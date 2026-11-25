"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { dayView, readTimetableSettings, timetableSettingsSchema, type ImportSlot, type Slot } from "@/lib/organizations/school-timetable";
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
  const mine = await slotsOf(schoolId, ctx.userId);
  return { success: true as const, leader: ctx.leader, settings, today, mine, yourDay: settings ? dayView(today, mine, settings) : [],
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
  // Security review: a username matches exactly; a full name only when exactly one person on the staff has it. An
  // ambiguous name is left unmatched and reported, so nobody can take a colleague's slots by copying their name.
  const byUser = new Map(staff.filter((x) => x.username).map((x) => [x.username!.trim().toLowerCase(), x.id]));
  const nameCount = new Map<string, string[]>();
  for (const x of staff) if (x.name) nameCount.set(x.name.trim().toLowerCase(), [...(nameCount.get(x.name.trim().toLowerCase()) ?? []), x.id]);
  const byName = { get: (n: string) => byUser.get(n) ?? (nameCount.get(n)?.length === 1 ? nameCount.get(n)![0] : undefined) };
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
