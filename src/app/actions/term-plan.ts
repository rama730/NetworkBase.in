"use server";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { lessonStaffNotes, tasks, workspaceSprints, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { readClassDetails, readExamWeeks, readSessionChanges, termSessions, type Session } from "@/lib/organizations/class-sessions";
import { readExam } from "@/lib/organizations/exams";
import type { OrgType } from "@/lib/organizations/config";
import { allTaught, behind, draftSoon, LESSON_TYPES, lessonTypeOf, plannedPercent, readClassNotes, readGroups, readTicks, type LessonType, type Ticks } from "@/lib/organizations/curriculum";
import { lessonOrder, matchSessions, outcomeCoverage, readTermPlanSettings, sessionsInWeek, unitProgress, visibleLessons, weekNumber, type PlanLesson, type PlanWeek } from "@/lib/organizations/term-plan";
import { typeProfile } from "@/lib/organizations/type-profile";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 30.3 W2 (plan B1.2a): the Term plan in a class's Sprints tab. Teachers (owner) plan lessons and outcomes; TAs
 * (admins) mark taught and keep teacher notes (call 6); students see Ready and Taught lessons; teacher notes never
 * leave staff (layer 16); visitors see nothing (Sprints isn't public by default).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function classAccess(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const [c] = await db.select({ id: workspaces.id, kind: workspaces.kind, orgType: workspaces.orgType, orgLevel: workspaces.orgLevel, orgSettings: workspaces.orgSettings,
    termStart: workspaces.termStart, termEnd: workspaces.termEnd, timeZone: workspaces.timeZone })
    .from(workspaces).where(and(eq(workspaces.id, orgId), isNull(workspaces.deletedAt))).limit(1);
  if (c?.kind !== "organization" || c.orgLevel || !typeProfile(c.orgType as OrgType | null).schools) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(a.isOwner || a.isMember) || !a.canRead) return null;
  const teacher = a.isOwner;
  const staff = teacher || a.memberRole === "admin";
  return { c, userId, teacher, staff, canWrite: a.canWrite };
}

export type TermPlanLesson = PlanLesson & { session: Session | null; needsNewSession: boolean; before: string | null; during: string | null; after: string | null; notes?: string | null;
  /** B3.2a (report 32.3 calls 3–4): its type, per-class Taught ticks, class notes (staff), and Draft ⚠ within 3 school days. */
  lessonType: LessonType; ticks: Ticks; classNotes?: Record<string, string>; draftSoon: boolean };
export type TermPlanWeek = PlanWeek & { lessons: TermPlanLesson[]; sessions: number; assessments: Array<{ id: string; title: string; due: string; exam?: boolean }>;
  /** B1.6 (report 30.5 layer 4): the school's exam week this week falls in, by name. */
  examWeek?: string | null };

export async function readTermPlanAction(orgId: string) {
  try {
    const ctx = await classAccess(orgId);
    if (!ctx) return DENIED;
    const { c, staff, teacher } = ctx;
    const settings = readTermPlanSettings(c.orgSettings);
    const groups = readGroups(c.orgSettings);
    const sprints = await db.select({ id: workspaceSprints.id, name: workspaceSprints.name, goal: workspaceSprints.goal, parent: workspaceSprints.parentSprintId,
      start: workspaceSprints.startDate, end: workspaceSprints.endDate, status: workspaceSprints.status })
      .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, orgId), isNull(workspaceSprints.pathPosition))).orderBy(asc(workspaceSprints.startDate));
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    const units = sprints.filter((s) => !s.parent).map((s) => ({ id: s.id, name: s.name, start: iso(s.start), end: iso(s.end), status: s.status }));
    const weeks: PlanWeek[] = sprints.filter((s) => s.parent).map((s) => ({ id: s.id, unitId: s.parent!, name: s.name, goal: s.goal, start: iso(s.start), end: iso(s.end), status: s.status }));
    const rows = await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, stage: tasks.stage, weekId: tasks.sprintId, fields: tasks.typeFields, createdAt: tasks.createdAt })
      .from(tasks).where(and(eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt)));
    const all: Array<PlanLesson & { fields: Record<string, unknown> }> = rows.map((r) => {
      const f = (r.fields ?? {}) as Record<string, unknown>;
      return { id: r.id, number: r.number, title: r.title, stage: r.stage ?? "draft", weekId: r.weekId, order: typeof f.order === "number" ? f.order : 0,
        outcomes: Array.isArray(f.outcomes) ? (f.outcomes as string[]) : [], createdAt: r.createdAt.toISOString(), fields: f };
    });
    const lessons = visibleLessons(all, staff, settings.studentsSee) as typeof all;
    const notes = staff && lessons.length ? await db.select({ id: lessonStaffNotes.taskId, notes: lessonStaffNotes.notes }).from(lessonStaffNotes)
      .where(inArray(lessonStaffNotes.taskId, lessons.map((l) => l.id))) : [];
    const details = readClassDetails(c.orgSettings);
    const sessions = details ? termSessions(details, { start: c.termStart, end: c.termEnd }, readSessionChanges(c.orgSettings)) : [];
    // Assessments: assignments due that week, never typed by hand (agreed change 3); students see published ones only.
    const masters = await db.select({ id: tasks.id, title: tasks.title, due: tasks.dueDate, settings: tasks.assignmentSettings }).from(tasks)
      .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt)));
    const due = masters.filter((m) => m.due && (staff || (m.settings as { publishedAt?: string | null } | null)?.publishedAt))
      .map((m) => ({ id: m.id, title: m.title, due: m.due!.toISOString(), ...(readExam(m.settings) ? { exam: true } : {}) }));
    const examWeeks = readExamWeeks(c.orgSettings);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: c.timeZone || "UTC" }).format(new Date());
    const lessonDay = (session: Session | null, w: PlanWeek) => session?.key.slice(0, 10) ?? w.start?.slice(0, 10) ?? null;
    const shaped: TermPlanWeek[] = weeks.map((w) => {
      const inWeek = lessons.filter((l) => l.weekId === w.id).sort(lessonOrder);
      const weekSessions = sessionsInWeek(sessions, w);
      const slots = new Map(matchSessions(inWeek, weekSessions).map((s) => [s.lessonId, s]));
      const examWeek = w.start && w.end ? examWeeks.find((e) => e.start <= w.end!.slice(0, 10) && e.end >= w.start!.slice(0, 10))?.name ?? null : null;
      return { ...w, examWeek, sessions: weekSessions.filter((s) => s.status !== "cancelled").length,
        assessments: due.filter((a) => w.start && w.end && a.due >= w.start && a.due.slice(0, 10) <= w.end.slice(0, 10)),
        lessons: inWeek.map((l) => ({ id: l.id, number: l.number, title: l.title, stage: l.stage, weekId: l.weekId, order: l.order, outcomes: l.outcomes, createdAt: l.createdAt,
          session: slots.get(l.id)?.session ?? null, needsNewSession: staff && Boolean(slots.get(l.id)?.needsNewSession),
          before: typeof l.fields.before === "string" ? l.fields.before : null, during: typeof l.fields.during === "string" ? l.fields.during : null,
          after: typeof l.fields.after === "string" ? l.fields.after : null, ...(staff ? { notes: notes.find((n) => n.id === l.id)?.notes ?? null, classNotes: readClassNotes(l.fields) } : {}),
          lessonType: lessonTypeOf(l.fields), ticks: staff ? readTicks(l.fields) : {}, draftSoon: staff && draftSoon(l.stage, lessonDay(slots.get(l.id)?.session ?? null, w), today) })) };
    });
    return {
      success: true as const, role: teacher ? "teacher" as const : staff ? "ta" as const : "student" as const, canWrite: ctx.canWrite, settings,
      term: { start: c.termStart, end: c.termEnd }, week: weekNumber(weeks, today), breaks: details?.breaks ?? [],
      coverage: outcomeCoverage(settings.outcomes, all),
      units: units.map((u) => ({ ...u, progress: unitProgress(all.filter((l) => weeks.some((w) => w.unitId === u.id && w.id === l.weekId))),
        outcomes: [...new Set(all.filter((l) => l.stage !== "cancelled" && weeks.some((w) => w.unitId === u.id && w.id === l.weekId)).flatMap((l) => l.outcomes))],
        weeks: shaped.filter((w) => w.unitId === u.id) })),
      // B3.2a: the classes this course teaches; Planned; Behind the map per class (staff only, never a ranking of teachers).
      groups: staff ? groups : [], planned: plannedPercent(all),
      behind: staff ? groups.map((g) => ({ group: g, ...behind(shaped.flatMap((w) => w.lessons.map((l) => ({ stage: l.stage, day: lessonDay(l.session, w), ticks: l.ticks }))), g, today) })) : [],
      unplaced: staff ? lessons.filter((l) => !l.weekId || !weeks.some((w) => w.id === l.weekId)).map((l) => ({ id: l.id, title: l.title, stage: l.stage })) : [],
    };
  } catch (error) {
    logger.warn("term_plan.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the term plan." };
  }
}

const lessonTypeSchema = z.enum(Object.keys(LESSON_TYPES) as [LessonType, ...LessonType[]]);
const outcomeCodes = z.array(z.string().trim().min(1).max(12)).max(20);

/** + Lesson on a week (the teacher; call 6: TAs don't add lessons). */
export async function addTermLessonAction(orgId: string, input: { weekId: string; title: string; outcomes?: string[]; lessonType?: LessonType }): Promise<{ success: true; id: string } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite) return DENIED;
  const data = z.object({ weekId: z.string().uuid(), title: z.string().trim().min(1, "Name the lesson.").max(200), outcomes: outcomeCodes.optional(), lessonType: lessonTypeSchema.optional() }).safeParse(input);
  if (!data.success) return { success: false, error: data.error.issues[0]?.message ?? "Check the lesson." };
  const [week] = await db.select({ id: workspaceSprints.id }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.id, data.data.weekId), eq(workspaceSprints.projectId, orgId), sql`${workspaceSprints.parentSprintId} IS NOT NULL`)).limit(1);
  if (!week) return { success: false, error: "Pick a week of this term." };
  const known = new Set(readTermPlanSettings(ctx.c.orgSettings).outcomes.map((o) => o.code));
  const outcomes = (data.data.outcomes ?? []).filter((o) => known.has(o));
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(tasks)
    .where(and(eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), eq(tasks.sprintId, week.id), isNull(tasks.deletedAt)));
  const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
  const r = await createTaskAction({ projectId: orgId, title: data.data.title, status: "todo", priority: "medium", itemType: "class_lesson", stage: "draft",
    typeFields: { outcomes, order: n, ...(data.data.lessonType && data.data.lessonType !== "lesson" ? { lessonType: data.data.lessonType } : {}) } } as Parameters<typeof createTaskAction>[0]);
  if (!r.success || !("task" in r) || !r.task) return { success: false, error: (r.success ? null : r.error) ?? "Couldn’t add the lesson." };
  // Off-board items don't take a sprint when made; a lesson belongs to its week.
  await db.update(tasks).set({ sprintId: week.id }).where(eq(tasks.id, r.task.id));
  return { success: true, id: r.task.id };
}

/** Planned → Ready → Taught, or Cancelled / back to Planned. TAs only mark taught (call 6). */
export async function setLessonStageAction(orgId: string, taskId: string, stage: "draft" | "ready" | "taught" | "cancelled"): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite || !isLooseUuid(taskId)) return DENIED;
  if (!["draft", "ready", "taught", "cancelled"].includes(stage)) return { success: false, error: "Pick Planned, Ready, Taught or Cancelled." };
  if (!ctx.teacher && stage !== "taught") return { success: false, error: "A TA marks lessons taught; the teacher plans them." };
  const status = stage === "taught" || stage === "cancelled" ? "done" : "todo";
  const done = await db.update(tasks).set({ stage, status, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt))).returning({ id: tasks.id });
  return done.length ? { success: true } : { success: false, error: "That lesson isn’t in this class." };
}

/** A lesson's outcomes, Before / In / After class (the teacher; a TA edits In class only, call 6). */
export async function updateLessonAction(orgId: string, taskId: string, input: { title?: string; outcomes?: string[]; before?: string; during?: string; after?: string; lessonType?: LessonType }): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite || !isLooseUuid(taskId)) return DENIED;
  const data = z.object({ title: z.string().trim().min(1).max(200).optional(), outcomes: outcomeCodes.optional(), before: z.string().max(20_000).optional(),
    during: z.string().max(20_000).optional(), after: z.string().max(20_000).optional(), lessonType: lessonTypeSchema.optional() }).strict().safeParse(input);
  if (!data.success) return { success: false, error: data.error.issues[0]?.message ?? "Check the lesson." };
  const patch = data.data;
  if (!ctx.teacher && Object.keys(patch).some((k) => k !== "during")) return { success: false, error: "A TA edits In class; the teacher plans the rest." };
  const known = new Set(readTermPlanSettings(ctx.c.orgSettings).outcomes.map((o) => o.code));
  const fields = { ...(patch.outcomes ? { outcomes: patch.outcomes.filter((o) => known.has(o)) } : {}), ...(patch.before !== undefined ? { before: patch.before } : {}),
    ...(patch.during !== undefined ? { during: patch.during } : {}), ...(patch.after !== undefined ? { after: patch.after } : {}), ...(patch.lessonType ? { lessonType: patch.lessonType } : {}) };
  const done = await db.update(tasks).set({ ...(patch.title ? { title: patch.title } : {}), typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt))).returning({ id: tasks.id });
  return done.length ? { success: true } : { success: false, error: "That lesson isn’t in this class." };
}

/** Teacher notes: Teachers and TAs only, kept apart from the lesson (layer 16). */
export async function saveLessonNotesAction(orgId: string, taskId: string, notes: string): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite || !isLooseUuid(taskId)) return DENIED;
  const text = String(notes ?? "").slice(0, 20_000);
  const [lesson] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"))).limit(1);
  if (!lesson) return { success: false, error: "That lesson isn’t in this class." };
  if (!text.trim()) await db.delete(lessonStaffNotes).where(eq(lessonStaffNotes.taskId, taskId));
  else await db.insert(lessonStaffNotes).values({ taskId, projectId: orgId, notes: text, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: lessonStaffNotes.taskId, set: { notes: text, updatedBy: ctx.userId, updatedAt: new Date() } });
  return { success: true };
}

/** A week's Topics: the sprint goal (agreed change 2). The teacher. */
export async function setWeekTopicsAction(orgId: string, weekId: string, topics: string): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite || !isLooseUuid(weekId)) return DENIED;
  const done = await db.update(workspaceSprints).set({ goal: String(topics ?? "").trim().slice(0, 500) || null })
    .where(and(eq(workspaceSprints.id, weekId), eq(workspaceSprints.projectId, orgId))).returning({ id: workspaceSprints.id });
  return done.length ? { success: true } : { success: false, error: "That week isn’t in this class." };
}

/** Settings → Term plan (the teacher): outcomes, when students see lessons, the Topics label. */
export async function saveTermPlanSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite) return DENIED;
  const data = z.object({
    outcomes: z.array(z.object({ code: z.string().trim().min(1, "Give each outcome a code.").max(12), text: z.string().trim().max(300) })).max(30)
      .refine((list) => new Set(list.map((o) => o.code.toLowerCase())).size === list.length, "Two outcomes have the same code."),
    studentsSee: z.enum(["ready", "always"]), topicsLabel: z.enum(["Topics", "Chapters", "Themes"]),
    // B3.2a: the classes this course teaches (names, e.g. 6A); left out keeps the ones it has.
    groups: z.array(z.string().trim().min(1, "Name each class.").max(20)).max(12).refine((g) => new Set(g.map((x) => x.toLowerCase())).size === g.length, "Two classes have the same name.").optional(),
  }).safeParse(input);
  if (!data.success) return { success: false, error: data.error.issues[0]?.message ?? "Check the term plan settings." };
  const termPlan = { ...data.data, groups: data.data.groups ?? readGroups(ctx.c.orgSettings) };
  await db.update(workspaces).set({ orgSettings: sql`coalesce(${workspaces.orgSettings}, '{}'::jsonb) || ${JSON.stringify({ termPlan })}::jsonb` }).where(eq(workspaces.id, orgId));
  return { success: true };
}

/**
 * Move a lesson to another week (the menu path for the drag, layer 14). With "Shift the rest", every later lesson
 * that isn't taught moves by the same number of weeks, kept inside the term. The teacher.
 */
export async function moveLessonAction(orgId: string, input: { taskId: string; weekId: string; shiftRest: boolean }): Promise<{ success: true; moved: number } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite || !isLooseUuid(input.taskId) || !isLooseUuid(input.weekId)) return DENIED;
  const weeks = await db.select({ id: workspaceSprints.id, start: workspaceSprints.startDate }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.projectId, orgId), sql`${workspaceSprints.parentSprintId} IS NOT NULL`, isNull(workspaceSprints.pathPosition))).orderBy(asc(workspaceSprints.startDate));
  const index = new Map(weeks.map((w, i) => [w.id, i]));
  const [lesson] = await db.select({ id: tasks.id, weekId: tasks.sprintId }).from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt))).limit(1);
  if (!lesson) return { success: false, error: "That lesson isn’t in this class." };
  const from = lesson.weekId ? index.get(lesson.weekId) : undefined;
  const to = index.get(input.weekId);
  if (to === undefined) return { success: false, error: "Pick a week of this term." };
  if (!input.shiftRest || from === undefined) {
    await db.update(tasks).set({ sprintId: input.weekId, updatedAt: new Date() }).where(eq(tasks.id, lesson.id));
    return { success: true, moved: 1 };
  }
  const delta = to - from;
  const later = await db.select({ id: tasks.id, weekId: tasks.sprintId, stage: tasks.stage }).from(tasks)
    .where(and(eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt)));
  const moves = later.filter((l) => l.id === lesson.id || (l.weekId && (index.get(l.weekId) ?? -1) > from && l.stage !== "taught"))
    .map((l) => ({ id: l.id, week: weeks[Math.max(0, Math.min(weeks.length - 1, (l.id === lesson.id ? from : index.get(l.weekId!)!) + delta))]!.id }));
  await db.transaction(async (tx) => {
    for (const m of moves) await tx.update(tasks).set({ sprintId: m.week, updatedAt: new Date() }).where(eq(tasks.id, m.id));
  });
  return { success: true, moved: moves.length };
}

/** Duplicate a lesson into the same week, back at Planned (teacher notes stay with the original). The teacher. */
export async function duplicateLessonAction(orgId: string, taskId: string): Promise<{ success: true; id: string } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.teacher || !ctx.canWrite || !isLooseUuid(taskId)) return DENIED;
  const [l] = await db.select({ title: tasks.title, weekId: tasks.sprintId, fields: tasks.typeFields }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, orgId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt))).limit(1);
  if (!l?.weekId) return { success: false, error: "That lesson isn’t in a week of this class." };
  const made = await addTermLessonAction(orgId, { weekId: l.weekId, title: `${l.title} (copy)`.slice(0, 200), outcomes: ((l.fields ?? {}) as { outcomes?: string[] }).outcomes });
  if (!made.success) return made;
  const f = (l.fields ?? {}) as Record<string, unknown>;
  const copy = Object.fromEntries(["before", "during", "after", "minutes", "links", "lessonType"].filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
  if (Object.keys(copy).length) await db.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify(copy)}::jsonb` }).where(eq(tasks.id, made.id));
  return made;
}

/**
 * B3.2a (report 32.3 call 4): Mark taught for one class (6A), or take the tick back. Teachers and TAs; either teacher
 * of a class shared by two can tick (layer 12). The lesson is Taught once every class has it, and back to Ready if
 * a tick is taken back. One statement, so two people ticking at once never lose a tick.
 */
export async function markClassTaughtAction(orgId: string, taskId: string, group: string, taught: boolean): Promise<{ success: true; lessonTaught: boolean } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite || !isLooseUuid(taskId)) return DENIED;
  const groups = readGroups(ctx.c.orgSettings);
  if (!groups.includes(String(group))) return { success: false, error: "That class isn’t taught on this course." };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.c.timeZone || "UTC" }).format(new Date());
  const tick = JSON.stringify({ on: today, by: ctx.userId });
  const [row] = Array.from(await db.execute<{ fields: unknown; stage: string | null }>(sql`
    UPDATE tasks SET type_fields = CASE WHEN ${taught}
        THEN jsonb_set(coalesce(type_fields, '{}'::jsonb), '{taught}', coalesce(type_fields->'taught', '{}'::jsonb) || jsonb_build_object(${group}::text, ${tick}::jsonb))
        ELSE jsonb_set(coalesce(type_fields, '{}'::jsonb), '{taught}', coalesce(type_fields->'taught', '{}'::jsonb) - ${group}::text) END,
      updated_at = now()
    WHERE id = ${taskId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'class_lesson' AND deleted_at IS NULL AND coalesce(stage, 'draft') <> 'cancelled'
    RETURNING type_fields AS fields, stage`));
  if (!row) return { success: false, error: "That lesson isn’t in this class." };
  const done = allTaught(groups, readTicks(row.fields));
  const stage = done ? "taught" : row.stage === "taught" ? "ready" : row.stage;
  if (stage !== row.stage) await db.update(tasks).set({ stage, status: done ? "done" : "todo" }).where(eq(tasks.id, taskId));
  return { success: true, lessonTaught: done };
}

/** A class note on a lesson ("6B: run the lab in two parts"), staff only, never student names (layer 16). */
export async function saveClassNoteAction(orgId: string, taskId: string, group: string, note: string): Promise<{ success: true } | Failure> {
  const ctx = await classAccess(orgId);
  if (!ctx?.staff || !ctx.canWrite || !isLooseUuid(taskId)) return DENIED;
  if (!readGroups(ctx.c.orgSettings).includes(String(group))) return { success: false, error: "That class isn’t taught on this course." };
  const text = String(note ?? "").trim().slice(0, 200);
  const done = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE tasks SET type_fields = jsonb_set(coalesce(type_fields, '{}'::jsonb), '{classNotes}',
      CASE WHEN ${text} = '' THEN coalesce(type_fields->'classNotes', '{}'::jsonb) - ${group}::text
      ELSE coalesce(type_fields->'classNotes', '{}'::jsonb) || jsonb_build_object(${group}::text, ${text}::text) END), updated_at = now()
    WHERE id = ${taskId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'class_lesson' AND deleted_at IS NULL RETURNING id`));
  return done.length ? { success: true } : { success: false, error: "That lesson isn’t in this class." };
}
