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
  await db.transaction(async (tx) => {
    for (const m of list) {
      await tx.insert(attendanceRecords).values({ projectId: orgId, sessionKey, userId: m.userId, status: m.status, note: m.note ?? null, markedBy: ctx.userId, markedAt: now })
        .onConflictDoUpdate({ target: [attendanceRecords.projectId, attendanceRecords.sessionKey, attendanceRecords.userId],
          set: { status: m.status, note: m.note ?? null, markedBy: ctx.userId, markedAt: now,
            history: sql`${attendanceRecords.history} || jsonb_build_array(jsonb_build_object('status', ${attendanceRecords.status}, 'by', ${attendanceRecords.markedBy}, 'at', ${attendanceRecords.markedAt}))` } });
    }
  });
  if (late) logger.info("attendance.changed_after_7_days", { orgId, sessionKey, by: ctx.userId, count: list.length });
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
    minimum: z.number().int().min(1).max(100).nullable() }).safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the attendance settings." };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ attendance: parsed.data })}::jsonb` }).where(eq(workspaces.id, orgId));
  return { success: true };
}
