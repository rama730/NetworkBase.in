"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { attendanceRecords, profiles, workspaceMembers, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { attendancePercent, canMissMore, editableByStaff, readAttendanceSettings, registerCsv, type AttendanceStatus } from "@/lib/organizations/attendance";
import { readClassDetails, readSessionChanges, termSessions, type Session } from "@/lib/organizations/class-sessions";
import type { OrgType } from "@/lib/organizations/config";
import { typeProfile } from "@/lib/organizations/type-profile";
import { todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.7 W6 (plan B1.4a): attendance per class session. Teachers and TAs take and see it; a student sees only
 * their own records and % (layer 16). Records older than 7 days change only by the Teacher, and every change is kept.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function classAccess(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const [c] = await db.select({ id: workspaces.id, kind: workspaces.kind, orgType: workspaces.orgType, orgLevel: workspaces.orgLevel, orgSettings: workspaces.orgSettings,
    termStart: workspaces.termStart, termEnd: workspaces.termEnd, zone: workspaces.timeZone })
    .from(workspaces).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt))).limit(1);
  if (c?.kind !== "organization" || c.orgLevel || !typeProfile(c.orgType as OrgType | null).schools) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(a.isOwner || a.isMember) || !a.canRead) return null;
  const details = readClassDetails(c.orgSettings);
  const sessions = details ? termSessions(details, { start: c.termStart, end: c.termEnd }, readSessionChanges(c.orgSettings)) : [];
  return { c, userId, teacher: a.isOwner, staff: a.isOwner || a.memberRole === "admin", student: !a.isOwner && a.memberRole === "member", canWrite: a.canWrite,
    settings: readAttendanceSettings(c.orgSettings), sessions };
}

/** Sessions that have started (cancelled ones never count), oldest first; and the one to take today. */
function heldSessions(sessions: Session[], zone: string | null, now = new Date()) {
  const held = sessions.filter((s) => s.status !== "cancelled" && Date.parse(zonedInputToIso(s.start, zone)) <= now.getTime());
  const today = todayInZone(zone, now);
  const todays = sessions.find((s) => s.status !== "cancelled" && s.start.slice(0, 10) === today) ?? null;
  return { held, today: todays, remaining: sessions.filter((s) => s.status !== "cancelled" && Date.parse(zonedInputToIso(s.start, zone)) > now.getTime()).length };
}

const name = (p: { fullName: string | null; username: string | null }) => p.fullName || p.username || "Someone";

export async function readAttendanceAction(orgId: string) {
  try {
    const ctx = await classAccess(orgId);
    if (!ctx || !(ctx.staff || ctx.student)) return DENIED;
    const { held, today, remaining } = heldSessions(ctx.sessions, ctx.c.zone);
    const keys = held.map((s) => s.key);
    const people = ctx.staff
      ? await db.select({ id: workspaceMembers.userId, joinedAt: workspaceMembers.joinedAt, fullName: profiles.fullName, username: profiles.username }).from(workspaceMembers)
        .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "member")))
      : await db.select({ id: workspaceMembers.userId, joinedAt: workspaceMembers.joinedAt, fullName: profiles.fullName, username: profiles.username }).from(workspaceMembers)
        .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, ctx.userId)));
    const rows = people.length ? await db.select({ userId: attendanceRecords.userId, key: attendanceRecords.sessionKey, status: attendanceRecords.status, note: attendanceRecords.note })
      .from(attendanceRecords).where(and(eq(attendanceRecords.projectId, orgId), inArray(attendanceRecords.userId, people.map((p) => p.id)))) : [];
    const students = people.map((p) => {
      const records = new Map(rows.filter((r) => r.userId === p.id).map((r) => [r.key, r.status as AttendanceStatus]));
      const joinedDay = p.joinedAt ? todayInZone(ctx.c.zone, p.joinedAt) : null;
      const pct = attendancePercent({ held: keys, records, joinedDay, lateCountsPresent: ctx.settings.lateCountsPresent });
      return { id: p.id, name: name(p), records: Object.fromEntries(records), notes: Object.fromEntries(rows.filter((r) => r.userId === p.id && r.note).map((r) => [r.key, r.note!])),
        percent: pct.percent, below: ctx.settings.minimum != null && pct.percent != null && pct.percent < ctx.settings.minimum,
        canMiss: ctx.settings.minimum != null ? canMissMore({ present: pct.present, total: pct.total, remaining, minimum: ctx.settings.minimum }) : null };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { success: true as const, role: ctx.teacher ? "teacher" as const : ctx.staff ? "ta" as const : "student" as const, canWrite: ctx.canWrite, settings: ctx.settings,
      sessions: held.map((s) => ({ key: s.key, start: s.start, status: s.status })), today: today ? { key: today.key, start: today.start } : null, students };
  } catch (error) {
    logger.warn("attendance.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load attendance." };
  }
}

const marksInput = z.array(z.object({ userId: z.string().uuid(), status: z.enum(["present", "late", "absent", "excused"]), note: z.string().trim().max(300).nullable().optional() })).max(2000);

/**
 * Take attendance: saves the sheet for one session. Each student's last save wins; staff change a record within 7
 * days of its session, after that only the Teacher; every change is kept in the record's history.
 */
export async function saveAttendanceAction(orgId: string, sessionKey: string, marks: unknown): Promise<{ success: true; saved: number } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite) return DENIED;
  if (!ctx.settings.on) return { success: false, error: "Turn attendance on in Settings first." };
  const session = ctx.sessions.find((s) => s.key === sessionKey);
  if (!session || session.status === "cancelled") return { success: false, error: "That isn’t a session of this class." };
  if (Date.parse(zonedInputToIso(session.start, ctx.c.zone)) - Date.now() > 12 * 3_600_000) return { success: false, error: "That session hasn’t happened yet." };
  const parsed = marksInput.safeParse(marks);
  if (!parsed.success) return { success: false, error: "Check the marks." };
  const students = new Set((await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, "member")))).map((r) => r.id));
  const list = parsed.data.filter((m) => students.has(m.userId));
  const late = !editableByStaff(sessionKey);
  if (late && !ctx.teacher) {
    const existing = await db.select({ userId: attendanceRecords.userId }).from(attendanceRecords)
      .where(and(eq(attendanceRecords.projectId, orgId), eq(attendanceRecords.sessionKey, sessionKey)));
    if (existing.length) return { success: false, error: "After 7 days only the Teacher changes these records." };
  }
  const now = new Date();
  const before = ctx.settings.minimum != null ? await belowSet(orgId, ctx, list.map((m) => m.userId)) : new Set<string>();
  await db.transaction(async (tx) => {
    for (const m of list) {
      await tx.insert(attendanceRecords).values({ projectId: orgId, sessionKey, userId: m.userId, status: m.status, note: m.note ?? null, markedBy: ctx.userId, markedAt: now })
        .onConflictDoUpdate({ target: [attendanceRecords.projectId, attendanceRecords.sessionKey, attendanceRecords.userId],
          set: { status: m.status, note: m.note ?? null, markedBy: ctx.userId, markedAt: now,
            history: sql`${attendanceRecords.history} || jsonb_build_array(jsonb_build_object('status', ${attendanceRecords.status}, 'by', ${attendanceRecords.markedBy}, 'at', ${attendanceRecords.markedAt}))` } });
    }
  });
  if (late) logger.info("attendance.changed_after_7_days", { orgId, sessionKey, by: ctx.userId, count: list.length });
  if (ctx.settings.minimum != null) await tellBelowMinimum(orgId, ctx, list.map((m) => m.userId), sessionKey, before);
  return { success: true, saved: list.length };
}

/** Export register: the term's held sessions as a CSV (Teachers and TAs). */
export async function exportRegisterAction(orgId: string): Promise<{ success: true; csv: string } | Failure> {
  const r = await readAttendanceAction(orgId);
  if (!r.success || r.role === "student") return DENIED;
  return { success: true, csv: registerCsv(r.sessions.map((s) => s.key), r.students.map((s) => ({ name: s.name, records: new Map(Object.entries(s.records) as Array<[string, AttendanceStatus]>), percent: s.percent }))) };
}

/** Settings → Attendance (the Teacher). */
export async function saveAttendanceSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite) return DENIED;
  const parsed = z.object({ on: z.boolean(), lateCountsPresent: z.boolean(), lateAfterMinutes: z.number().int().min(0).max(120), absenceNotes: z.boolean(),
    checkInCode: z.boolean().optional(), minimum: z.number().int().min(1).max(100).nullable() }).safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the attendance settings." };
  if (ctx.settings.minimumLocked && parsed.data.minimum !== ctx.settings.minimum) return { success: false, error: "Your school sets the minimum." };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ attendance: parsed.data })}::jsonb` }).where(eq(workspaces.id, orgId));
  return { success: true };
}

type Ctx = NonNullable<Awaited<ReturnType<typeof classAccess>>>;

/** Students (of `ids`) whose attendance is now below the minimum. */
async function belowSet(orgId: string, ctx: Ctx, ids: string[]) {
  if (!ids.length || ctx.settings.minimum == null) return new Set<string>();
  const { held } = heldSessions(ctx.sessions, ctx.c.zone);
  const keys = held.map((s) => s.key);
  const rows = await db.select({ userId: attendanceRecords.userId, key: attendanceRecords.sessionKey, status: attendanceRecords.status }).from(attendanceRecords)
    .where(and(eq(attendanceRecords.projectId, orgId), inArray(attendanceRecords.userId, ids)));
  const out = new Set<string>();
  for (const id of ids) {
    const records = new Map(rows.filter((r) => r.userId === id && r.status).map((r) => [r.key, r.status as AttendanceStatus]));
    const pct = attendancePercent({ held: keys, records, joinedDay: null, lateCountsPresent: ctx.settings.lateCountsPresent }).percent;
    if (pct != null && pct < ctx.settings.minimum) out.add(id);
  }
  return out;
}

/** Report 30.7 layer 15: crossing below the minimum — Important to the student, once per crossing; Summary to the Teacher. */
async function tellBelowMinimum(orgId: string, ctx: Ctx, ids: string[], sessionKey: string, before: Set<string>) {
  const after = await belowSet(orgId, ctx, ids);
  const crossed = [...after].filter((id) => !before.has(id));
  if (!crossed.length) return;
  const { createNotification } = await import("@/lib/notifications/service");
  const [org] = await db.select({ slug: workspaces.slug, title: workspaces.title, ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const href = `/org/${encodeURIComponent(org?.slug ?? orgId)}`;
  for (const id of crossed) {
    await createNotification({ recipientUserId: id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `Your attendance in ${org?.title ?? "this class"} is below ${ctx.settings.minimum}%`, href, entityRefs: { projectId: orgId, projectSlug: org?.slug ?? null },
      dedupeKey: `attendance-below:${orgId}:${id}:${sessionKey}` }).catch(() => undefined);
  }
  if (org?.ownerId) await createNotification({ recipientUserId: org.ownerId, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
    title: `${crossed.length} ${crossed.length === 1 ? "student is" : "students are"} below the attendance minimum`, href: `${href}?tab=members`,
    entityRefs: { projectId: orgId, projectSlug: org.slug }, dedupeKey: `attendance-below-teacher:${orgId}:${sessionKey}` }).catch(() => undefined);
}

/** Check-in code (call 3, off by default): four digits for today's session, valid 10 minutes. Teachers and TAs. */
export async function startCheckInAction(orgId: string): Promise<{ success: true; code: string; expiresAt: string; session: string } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite) return DENIED;
  if (!ctx.settings.on || !ctx.settings.checkInCode) return { success: false, error: "Turn on check-in codes in Settings, under Attendance." };
  const { today } = heldSessions(ctx.sessions, ctx.c.zone);
  if (!today) return { success: false, error: "There’s no class today." };
  const { randomInt } = await import("node:crypto");
  const code = String(randomInt(0, 10_000)).padStart(4, "0");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ attendanceCheckIn: { session: today.key, code, expiresAt } })}::jsonb` })
    .where(eq(workspaces.id, orgId));
  return { success: true, code, expiresAt, session: today.key };
}

/**
 * I'm here: a student enters the code; Present, or Late after the late time. One count per account; a mark staff
 * already made is never overwritten. Attempts are limited, so four digits can't be guessed in ten minutes.
 */
export async function checkInAction(orgId: string, code: string): Promise<{ success: true; status: AttendanceStatus } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.student || !ctx.canWrite) return DENIED;
  const { consumeRateLimit } = await import("@/lib/security/rate-limit");
  const limit = await consumeRateLimit(`attendance-check-in:${orgId}:${ctx.userId}`, 5, 600);
  if (!limit.allowed) return { success: false, error: "Too many tries. Ask your teacher to mark you." };
  const live = (ctx.c.orgSettings as { attendanceCheckIn?: { session: string; code: string; expiresAt: string } } | null)?.attendanceCheckIn;
  if (!live || Date.parse(live.expiresAt) < Date.now() || String(code).trim() !== live.code) return { success: false, error: "That code isn’t right, or it has run out." };
  const session = ctx.sessions.find((s) => s.key === live.session);
  if (!session) return { success: false, error: "That code isn’t right, or it has run out." };
  const lateAt = Date.parse(zonedInputToIso(session.start, ctx.c.zone)) + ctx.settings.lateAfterMinutes * 60_000;
  const status: AttendanceStatus = Date.now() > lateAt ? "late" : "present";
  const [row] = await db.insert(attendanceRecords).values({ projectId: orgId, sessionKey: live.session, userId: ctx.userId, status, markedBy: ctx.userId })
    .onConflictDoUpdate({ target: [attendanceRecords.projectId, attendanceRecords.sessionKey, attendanceRecords.userId], set: { status: sql`coalesce(${attendanceRecords.status}, ${status})` } })
    .returning({ status: attendanceRecords.status });
  return { success: true, status: (row?.status ?? status) as AttendanceStatus };
}

/** Absence note (call 4: text only): a student's line for a session up to 7 days back or 14 ahead. The teacher hears (Normal). */
export async function sendAbsenceNoteAction(orgId: string, sessionKey: string, note: string): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.student || !ctx.canWrite) return DENIED;
  if (!ctx.settings.on || !ctx.settings.absenceNotes) return { success: false, error: "Absence notes are off in this class." };
  const text = String(note ?? "").trim().slice(0, 300);
  if (!text) return { success: false, error: "Say why in a few words." };
  const session = ctx.sessions.find((s) => s.key === sessionKey && s.status !== "cancelled");
  const at = session ? Date.parse(zonedInputToIso(session.start, ctx.c.zone)) : NaN;
  if (!session || at < Date.now() - 7 * 86_400_000 || at > Date.now() + 14 * 86_400_000) return { success: false, error: "Pick a class from the last week or the next two." };
  await db.insert(attendanceRecords).values({ projectId: orgId, sessionKey, userId: ctx.userId, status: null, note: text, markedBy: null })
    .onConflictDoUpdate({ target: [attendanceRecords.projectId, attendanceRecords.sessionKey, attendanceRecords.userId], set: { note: text } });
  const [org] = await db.select({ slug: workspaces.slug, ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const [me] = await db.select({ fullName: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, ctx.userId)).limit(1);
  if (org?.ownerId) {
    const { createNotification } = await import("@/lib/notifications/service");
    await createNotification({ recipientUserId: org.ownerId, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `${me ? name(me) : "A student"} sent an absence note`, href: `/org/${encodeURIComponent(org.slug ?? orgId)}?tab=members`,
      entityRefs: { projectId: orgId, projectSlug: org.slug }, dedupeKey: `absence-note:${orgId}:${ctx.userId}:${sessionKey}` }).catch(() => undefined);
  }
  return { success: true };
}
