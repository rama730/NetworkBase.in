import "server-only";

import { and, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tasks, workspaceSprints, workspaces } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { createNotification } from "@/lib/notifications/service";
import { readClassDetails, readSessionChanges, termSessions } from "@/lib/organizations/class-sessions";
import { matchSessions, readTermPlanSettings, sessionsInWeek, visibleLessons, type PlanLesson } from "@/lib/organizations/term-plan";
import type { Session } from "@/lib/organizations/class-sessions";
import { todayInZone, zonedInputToIso } from "@/lib/organizations/zoned-time";

/**
 * Report 30.3 (plan B1.2b): per class, the lessons whose session has ended (`due`), how many of those are taught, and
 * the ones still waiting to be marked (`unmarked`). Behind plan and the Mark taught reminder both read it.
 */
export type ClassPlanState = { due: number; taught: number; unmarked: Array<{ id: string; title: string }> };

export async function classPlanStates(orgIds: string[], now = new Date()): Promise<Map<string, ClassPlanState>> {
  const out = new Map<string, ClassPlanState>();
  if (!orgIds.length) return out;
  const [classes, weeks, lessons] = await Promise.all([
    db.select({ id: workspaces.id, settings: workspaces.orgSettings, termStart: workspaces.termStart, termEnd: workspaces.termEnd, zone: workspaces.timeZone })
      .from(workspaces).where(inArray(workspaces.id, orgIds)),
    db.select({ id: workspaceSprints.id, org: workspaceSprints.projectId, start: workspaceSprints.startDate, end: workspaceSprints.endDate })
      .from(workspaceSprints).where(and(inArray(workspaceSprints.projectId, orgIds), isNotNull(workspaceSprints.parentSprintId), isNull(workspaceSprints.pathPosition))),
    db.select({ id: tasks.id, org: tasks.projectId, title: tasks.title, stage: tasks.stage, weekId: tasks.sprintId, fields: tasks.typeFields, createdAt: tasks.createdAt })
      .from(tasks).where(and(inArray(tasks.projectId, orgIds), sql`${tasks.itemType} = 'class_lesson'`, isNull(tasks.deletedAt))),
  ]);
  for (const c of classes) {
    const details = readClassDetails(c.settings);
    const sessions = details ? termSessions(details, { start: c.termStart, end: c.termEnd }, readSessionChanges(c.settings)) : [];
    const state: ClassPlanState = { due: 0, taught: 0, unmarked: [] };
    for (const w of weeks.filter((x) => x.org === c.id)) {
      const inWeek: PlanLesson[] = lessons.filter((l) => l.weekId === w.id).map((l) => {
        const f = (l.fields ?? {}) as { order?: number };
        return { id: l.id, number: null, title: l.title, stage: l.stage ?? "draft", weekId: l.weekId, order: f.order ?? 0, outcomes: [], createdAt: l.createdAt.toISOString() };
      });
      const slots = matchSessions(inWeek, sessionsInWeek(sessions, { start: w.start?.toISOString() ?? null, end: w.end?.toISOString() ?? null }));
      for (const slot of slots) {
        const s = slot.session;
        if (!s || s.status === "cancelled" || Date.parse(zonedInputToIso(s.end, c.zone)) > now.getTime()) continue;
        const lesson = inWeek.find((l) => l.id === slot.lessonId)!;
        state.due += 1;
        if (lesson.stage === "taught") state.taught += 1;
        else state.unmarked.push({ id: lesson.id, title: lesson.title });
      }
    }
    out.set(c.id, state);
  }
  return out;
}

/**
 * Report 30.3 layer 15: "Mark yesterday's lesson taught" — Summary, at most once a day, to the class's teacher, from
 * 09:00 the class's time. Runs in the hourly job (no new function).
 */
export async function notifyLessonsToMarkTaught(now = new Date()) {
  const rows = Array.from(await db.execute<{ id: string; slug: string | null; owner_id: string; zone: string | null }>(sql`
    SELECT DISTINCT w.id, w.slug, w.owner_id, w.time_zone AS zone FROM workspaces w JOIN tasks t ON t.workspace_id = w.id
    WHERE w.kind = 'organization' AND w.deleted_at IS NULL AND w.status <> 'archived' AND t.item_type = 'class_lesson' AND t.deleted_at IS NULL
      AND t.stage IN ('draft', 'ready') LIMIT 2000`));
  const due = rows.filter((r) => {
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: r.zone || "UTC", hour: "2-digit", hourCycle: "h23" }).format(now);
    return Number(local) >= 9;
  });
  if (!due.length) return { sent: 0 };
  const states = await classPlanStates(due.map((r) => r.id), now);
  let sent = 0;
  for (const r of due) {
    const n = states.get(r.id)?.unmarked.length ?? 0;
    if (!n) continue;
    await createNotification({
      recipientUserId: r.owner_id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `Mark ${n} ${n === 1 ? "lesson" : "lessons"} taught`, href: `/org/${encodeURIComponent(r.slug || r.id)}?tab=sprints`,
      entityRefs: { projectId: r.id, projectSlug: r.slug }, dedupeKey: `mark-taught:${r.id}:${todayInZone(r.zone, now)}`,
    }).then(() => { sent += 1; }).catch((error) => logger.error("term_plan.mark_taught_notice_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
  return { sent };
}

/**
 * B1.7b (report 30.4 layer 3): each session's lesson, matched over the whole plan (a hidden lesson never shifts the
 * others), then shown only when the viewer may see it — staff always, students when the class shows it (Ready or
 * Taught by default). `before` is the lesson's Before class text.
 */
export async function sessionLessons(classId: string, orgSettings: unknown, sessions: Session[], staff: boolean) {
  const out = new Map<string, { id: string; title: string; stage: string; before: string | null }>();
  if (!sessions.length) return out;
  const weeks = await db.select({ id: workspaceSprints.id, start: workspaceSprints.startDate, end: workspaceSprints.endDate }).from(workspaceSprints)
    .where(and(sql`${workspaceSprints.projectId} = ${classId}::uuid`, isNotNull(workspaceSprints.parentSprintId), isNull(workspaceSprints.pathPosition)));
  if (!weeks.length) return out;
  const rows = await db.select({ id: tasks.id, title: tasks.title, stage: tasks.stage, weekId: tasks.sprintId, fields: tasks.typeFields, createdAt: tasks.createdAt }).from(tasks)
    .where(and(sql`${tasks.projectId} = ${classId}::uuid`, sql`${tasks.itemType} = 'class_lesson'`, isNull(tasks.deletedAt), inArray(tasks.sprintId, weeks.map((w) => w.id))));
  const lessons: Array<PlanLesson & { before: string | null }> = rows.map((r) => {
    const f = (r.fields ?? {}) as Record<string, unknown>;
    return { id: r.id, number: null, title: r.title, stage: r.stage ?? "draft", weekId: r.weekId, order: typeof f.order === "number" ? f.order : 0,
      outcomes: [], createdAt: r.createdAt.toISOString(), before: typeof f.before === "string" && f.before.trim() ? f.before.trim() : null };
  });
  const seen = new Set(visibleLessons(lessons, staff, readTermPlanSettings(orgSettings).studentsSee).map((l) => l.id));
  for (const w of weeks) {
    const inWeek = lessons.filter((l) => l.weekId === w.id);
    for (const slot of matchSessions(inWeek, sessionsInWeek(sessions, { start: w.start?.toISOString() ?? null, end: w.end?.toISOString() ?? null }))) {
      const lesson = inWeek.find((l) => l.id === slot.lessonId);
      if (slot.session && lesson && seen.has(lesson.id)) out.set(slot.session.key, { id: lesson.id, title: lesson.title, stage: lesson.stage, before: lesson.before });
    }
  }
  return out;
}

/**
 * B3.2d (report 32.3 layer 15): "Lesson still Draft" to the class's teacher once, when its session is within the
 * next 3 school days (Normal, never to the whole team). One notice per lesson.
 */
export async function notifyDraftLessonsSoon(now = new Date()) {
  const { draftSoon } = await import("@/lib/organizations/curriculum");
  const rows = Array.from(await db.execute<{ id: string; slug: string | null; owner_id: string; zone: string | null; settings: unknown; term_start: string | null; term_end: string | null }>(sql`
    SELECT DISTINCT w.id, w.slug, w.owner_id, w.time_zone AS zone, w.org_settings AS settings, w.term_start::date::text AS term_start, w.term_end::date::text AS term_end FROM workspaces w JOIN tasks t ON t.workspace_id = w.id
    WHERE w.kind = 'organization' AND w.deleted_at IS NULL AND w.status <> 'archived' AND t.item_type = 'class_lesson' AND t.deleted_at IS NULL AND t.stage = 'draft' LIMIT 2000`));
  let sent = 0;
  for (const r of rows) {
    const details = readClassDetails(r.settings);
    if (!details) continue;
    const today = todayInZone(r.zone, now);
    const sessions = termSessions(details, { start: r.term_start, end: r.term_end }, readSessionChanges(r.settings));
    const lessons = await sessionLessons(r.id, r.settings, sessions, true);
    for (const [key, lesson] of lessons) {
      if (!draftSoon(lesson.stage, key.slice(0, 10), today)) continue;
      await createNotification({
        recipientUserId: r.owner_id, actorUserId: null, kind: "project_task_activity", category: "tasks", importance: "more",
        title: `${lesson.title} is still Draft · taught ${key.slice(0, 10)}`, href: `/org/${encodeURIComponent(r.slug || r.id)}?tab=sprints`,
        entityRefs: { projectId: r.id, projectSlug: r.slug }, dedupeKey: `draft-soon:${lesson.id}`,
      }).then(() => { sent += 1; }).catch((error) => logger.error("term_plan.draft_notice_failed", { error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { sent };
}

/**
 * B3.2d (report 32.3 call 10, Duplicate): copy Term plan lessons into other weeks — back to Planned (Cancelled stays
 * Cancelled), without Taught ticks, class notes or teacher notes. `sprintMap` maps old weeks to new ones.
 */
export async function copyPlanLessons(sourceId: string, targetId: string, sprintMap: Map<string, string>, actorId: string) {
  if (!sprintMap.size) return 0;
  const { insertTask } = await import("@/lib/organizations/assignments");
  const { eq } = await import("drizzle-orm");
  const lessons = await db.select({ title: tasks.title, description: tasks.description, sprintId: tasks.sprintId, stage: tasks.stage, fields: tasks.typeFields }).from(tasks)
    .where(and(sql`${tasks.projectId} = ${sourceId}::uuid`, sql`${tasks.itemType} = 'class_lesson'`, isNull(tasks.deletedAt), inArray(tasks.sprintId, [...sprintMap.keys()])));
  for (const l of lessons) {
    const id = await insertTask(db, { projectId: targetId, title: l.title, description: l.description, dueDate: null, sprintId: sprintMap.get(l.sprintId!) ?? null, assigneeId: null,
      creatorId: actorId, kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
    const { taught: _t, classNotes: _n, ...fields } = (l.fields ?? {}) as Record<string, unknown>;
    const cancelled = l.stage === "cancelled";
    await db.update(tasks).set({ itemType: "class_lesson", stage: cancelled ? "cancelled" : "draft", status: cancelled ? "done" : "todo", typeFields: fields, onBoard: false }).where(eq(tasks.id, id));
  }
  return lessons.length;
}
