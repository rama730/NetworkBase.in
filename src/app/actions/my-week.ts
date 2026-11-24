"use server";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { copyState, canStillSubmit, lateAfterMs, type AssignmentSettings } from "@/lib/organizations/assignment-rules";
import { readClassDetails, readSessionChanges, termSessions } from "@/lib/organizations/class-sessions";
import { sessionLessons } from "@/lib/organizations/term-plan-server";
import { readExam } from "@/lib/organizations/exams";
import { PIN_LIMIT, type WeekItem } from "@/lib/organizations/my-week";
import { typeProfile } from "@/lib/organizations/type-profile";
import { addDaysToDay, todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";
import { ASSIGNMENT_STATE_LABELS } from "@/lib/copy/terms";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.4 W3 (plan B1.7a): the viewer's own week, gathered from rows they can already read — class sessions and
 * office hours (W1), their assignment copies and tasks due in the next seven days, Missing work that still takes late
 * hand-ins, the nearest exam, and today's pins. Nobody reads another person's week.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

const zoneOk = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

type ClassRow = { id: string; title: string; slug: string | null; time_zone: string | null; term_start: string | null; term_end: string | null; org_settings: unknown; org_type: string | null; staff: boolean };
type CopyRow = { id: string; master_id: string; title: string; org_id: string; org_slug: string | null; org_title: string; status: string; review_status: string; due_date: string | null;
  submitted_at: string | null; completed_at: string | null; excused_at: string | null; submit_until: string | null; settings: AssignmentSettings };

export async function readMyWeekAction(timeZone: string) {
  try {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const tz = zoneOk(timeZone) ? timeZone : "UTC";
    const now = new Date();
    const today = todayInZone(tz, now);
    const until = new Date(now.getTime() + 8 * 86_400_000);
    const items: WeekItem[] = [];

    // Classes you belong to (Education organizations, not a school itself).
    const classes = Array.from(await db.execute<ClassRow>(sql`
      SELECT w.id, w.title, w.slug, w.time_zone, w.term_start::text, w.term_end::text, w.org_settings, w.org_type, false AS staff
      FROM workspaces w
      WHERE w.kind = 'organization' AND w.deleted_at IS NULL AND w.org_level IS DISTINCT FROM 'institution'
        AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid))`))
      .filter((c) => typeProfile(c.org_type).schools);
    // Security review: the same read and staff rule as the Term plan (a finished membership or a class being deleted
    // reads nothing; staff are the Teacher and admins).
    let readable = 0;
    for (const c of classes) {
      const access = await getWorkspaceAccessById(c.id, userId);
      if (!(access.isOwner || access.isMember) || !access.canRead) { c.org_settings = null; continue; }
      c.staff = access.isOwner || access.memberRole === "admin";
      readable += 1;
    }
    for (const c of classes) {
      const details = readClassDetails(c.org_settings);
      if (!details) continue;
      const base = `/org/${encodeURIComponent(c.slug ?? c.id)}`;
      const label = details.courseCode ?? c.title;
      const zone = c.time_zone ?? tz;
      const all = termSessions(details, { start: c.term_start, end: c.term_end }, readSessionChanges(c.org_settings));
      const soon = all.filter((s) => { const at = zonedInputToIso(s.start, zone); return Boolean(at) && Date.parse(at!) >= now.getTime() - 86_400_000 && Date.parse(at!) <= until.getTime(); });
      // B1.7b: the session's lesson title, its Before class, and for staff a lesson still Planned (report 30.4 layers 3, 10).
      const lessons = soon.length ? await sessionLessons(c.id, c.org_settings, all, c.staff) : new Map();
      for (const s of soon) {
        const at = zonedInputToIso(s.start, zone)!;
        const lesson = lessons.get(s.key);
        items.push({ id: `session:${c.id}:${s.key}`, kind: "session", at, title: lesson ? `${label} · ${lesson.title}` : label,
          context: [details.room, s.status === "moved" ? "Moved" : null].filter(Boolean).join(" · ") || null,
          href: `${base}?tab=sprints`, status: s.status === "cancelled" ? "Cancelled" : null });
        if (!lesson || s.status === "cancelled") continue;
        if (lesson.before && !c.staff) items.push({ id: `prep:${lesson.id}`, kind: "prep", at, title: lesson.before.split("\n")[0]!.slice(0, 120), context: label, href: `${base}?tab=sprints`, status: "Before class" });
        if (c.staff && (lesson.stage === "planned" || lesson.stage === "draft")) items.push({ id: `teaching:${lesson.id}`, kind: "teaching", at, title: `${lesson.title} is still Planned`, context: label, href: `${base}?tab=sprints`, status: "Mark it Ready" });
      }
      if (c.staff) {
        const [waiting] = Array.from(await db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM tasks t JOIN tasks m ON m.id = t.assignment_id WHERE m.workspace_id = ${c.id}::uuid AND t.deleted_at IS NULL AND m.deleted_at IS NULL AND t.review_status = 'pending'`));
        if (waiting?.n) items.push({ id: `review:${c.id}`, kind: "review", at: now.toISOString(), title: `${waiting.n} ${waiting.n === 1 ? "hand-in" : "hand-ins"} to review`, context: label,
          href: `${base}?tab=tasks&taskScope=review`, status: null });
      }
      if (details.officeHours) {
        for (let i = 0; i < 7; i++) {
          const day = addDaysToDay(today, i);
          if (!details.officeHours.days.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
          const at = zonedInputToIso(`${day}T${details.officeHours.start}`, zone);
          if (at) items.push({ id: `office:${c.id}:${day}`, kind: "office", at, title: "Office hours", context: [label, details.officeHours.place].filter(Boolean).join(" · "), href: `${base}?tab=about`, status: null });
        }
      }
    }

    // Your assignment copies (your own or your team's): due this week, Missing that still takes late work, and exams.
    const copies = Array.from(await db.execute<CopyRow>(sql`
      SELECT c.id, m.id AS master_id, c.title, o.id AS org_id, o.slug AS org_slug, o.title AS org_title, c.status, c.review_status, c.due_date::text, c.review_submitted_at::text AS submitted_at,
        c.completed_at::text, c.excused_at::text, c.submit_until::text, m.assignment_settings AS settings
      FROM tasks c JOIN tasks m ON m.id = c.assignment_id JOIN workspaces o ON o.id = m.workspace_id
      WHERE c.deleted_at IS NULL AND m.deleted_at IS NULL AND o.deleted_at IS NULL AND c.excused_at IS NULL
        AND (c.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}::uuid))
        AND (c.due_date IS NULL OR c.due_date > now() - interval '60 days') AND c.due_date < ${until.toISOString()}::timestamptz
      ORDER BY c.due_date LIMIT 300`));
    const missing: WeekItem[] = [];
    const exams: Array<{ id: string; title: string; context: string; opensAt: string; href: string }> = [];
    for (const c of copies) {
      const href = `/org/${encodeURIComponent(c.org_slug ?? c.org_id)}?tab=tasks&drawerType=task&drawerId=${c.id}`;
      const exam = readExam(c.settings);
      if (exam) exams.push({ id: c.id, title: c.title, context: c.org_title, opensAt: exam.opensAt, href });
      if (!c.due_date) continue;
      const due = new Date(c.due_date);
      const { state } = copyState({ status: c.status, reviewStatus: c.review_status, dueDate: due, submittedAt: c.submitted_at ? new Date(c.submitted_at) : null,
        completedAt: c.completed_at ? new Date(c.completed_at) : null, excusedAt: null }, now, lateAfterMs(c.settings));
      if (state === "done" || state === "submitted" || state === "excused") continue;
      const row: WeekItem = { id: `copy:${c.id}`, kind: "copy", at: due.toISOString(), title: c.title, context: c.org_title, href, status: ASSIGNMENT_STATE_LABELS[state], taskId: c.id };
      if (state === "missing") {
        if (canStillSubmit(c.settings, due, now, c.submit_until ? new Date(c.submit_until) : null)) missing.push({ ...row, status: c.settings.lateUntil ? `Late work until ${c.settings.lateUntil.slice(0, 10)}` : "Late work accepted" });
      } else if (due.getTime() >= now.getTime() - 86_400_000) items.push(row);
    }

    // Your own tasks (personal and team workspaces) due this week; class lessons and assignment copies are elsewhere.
    const tasks = Array.from(await db.execute<{ id: string; title: string; due_date: string; ws_id: string; ws_slug: string | null; ws_title: string; ws_kind: string | null; status: string }>(sql`
      SELECT t.id, t.title, t.due_date::text, w.id AS ws_id, w.slug AS ws_slug, w.title AS ws_title, w.kind AS ws_kind, t.status
      FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.assignee_id = ${userId}::uuid AND t.deleted_at IS NULL AND w.deleted_at IS NULL AND t.assignment_id IS NULL AND t.kind = 'task'
        AND t.item_type IS DISTINCT FROM 'class_lesson' AND t.status <> 'done' AND t.due_date >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz AND t.due_date < ${until.toISOString()}::timestamptz
      ORDER BY t.due_date LIMIT 200`));
    for (const t of tasks) {
      const path = t.ws_kind === "organization" ? `/org/${encodeURIComponent(t.ws_slug ?? t.ws_id)}` : `/workspaces/${encodeURIComponent(t.ws_slug ?? t.ws_id)}`;
      items.push({ id: `task:${t.id}`, kind: "task", at: new Date(t.due_date).toISOString(), title: t.title, context: t.ws_title, href: `${path}?tab=tasks&drawerType=task&drawerId=${t.id}`, status: null, taskId: t.id });
    }

    const pins = Array.from(await db.execute<{ task_id: string }>(sql`SELECT task_id FROM day_pins WHERE user_id = ${userId}::uuid AND day = ${today}::date ORDER BY created_at LIMIT ${PIN_LIMIT}`)).map((p) => p.task_id);
    return { success: true as const, timeZone: tz, today, inClass: readable > 0, items, missing, exams, pins };
  } catch (error) {
    logger.warn("my_week.read_failed", { error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load your week." };
  }
}

/**
 * Pin or unpin one of your own tasks or copies for today (call 4): at most 3, only what you hold, private. The day is
 * yours (your time zone), so the pins clear themselves at your midnight.
 */
export async function setDayPinAction(taskId: string, pinned: boolean, timeZone: string): Promise<{ success: true } | Failure> {
  const { userId } = await getViewerAuthContext();
  if (!userId || !isLooseUuid(taskId)) return DENIED;
  const day = todayInZone(zoneOk(timeZone) ? timeZone : "UTC");
  if (!pinned) {
    await db.execute(sql`DELETE FROM day_pins WHERE user_id = ${userId}::uuid AND day = ${day}::date AND task_id = ${taskId}::uuid`);
    return { success: true };
  }
  const [mine] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok FROM tasks t WHERE t.id = ${taskId}::uuid AND t.deleted_at IS NULL
      AND (t.assignee_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id = ${userId}::uuid))`));
  if (!mine) return DENIED;
  const added = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pins:${userId}:${day}`}))`);
    const [count] = Array.from(await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM day_pins WHERE user_id = ${userId}::uuid AND day = ${day}::date AND task_id <> ${taskId}::uuid`));
    if ((count?.n ?? 0) >= PIN_LIMIT) return false;
    await tx.execute(sql`INSERT INTO day_pins (user_id, task_id, day) VALUES (${userId}::uuid, ${taskId}::uuid, ${day}::date) ON CONFLICT DO NOTHING`);
    return true;
  });
  return added ? { success: true } : { success: false, error: `Pin up to ${PIN_LIMIT} for today. Unpin one first.` };
}
