"use server";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { lessonProgress, tasks, workspaceMembers, workspaceSprints, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { lessonFieldsSchema, readPathSettings, sprintDatesValid, stepProgress, upNext, isLocked, type PathSettings } from "@/lib/workflows/learning-path";
import { dropOff, paceState, pathPercent, stuckDays } from "@/lib/workflows/path-pace";
import { countedModules, learnerSteps, moduleAssignments, openModuleFor } from "@/lib/workflows/path-server";
import { typeProfile } from "@/lib/organizations/type-profile";

/**
 * Report 38.18 O3 (plan A7.6–A7.7): a learning path in Sprints. Steps are sprints with a path position (dates
 * optional), lessons are `class_lesson` items in a step, and each person ticks their own lessons (lesson_progress).
 * Owners and admins build it and see Progress; members and viewers tick their own; a self-paced path can be public
 * without anyone's progress (call 5). Agents can't mark lessons done (call 6).
 */
const uuid = z.string().uuid();
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error && error.message.length < 200 ? error.message : fallback });

async function pathAccess(projectId: string, opts: { allowPublic?: boolean } = {}) {
  if (!uuid.safeParse(projectId).success) throw new Error("Not found");
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  const userId = auth.user?.id ?? null;
  const access = await getWorkspaceAccessById(projectId, userId);
  if (!access.project || (access.project.kind !== "workspace" && access.project.kind !== "organization")) throw new Error("Not found");
  const [ws] = await db.select({ settings: workspaces.workflowSettings, visibility: workspaces.visibility, orgType: workspaces.orgType, orgLevel: workspaces.orgLevel })
    .from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  // B2.2a (report 31.3): a class (never a school) has one path; it's Scheduled (the Term plan) until set Self-paced.
  const isClass = access.project.kind === "organization";
  if (isClass && (ws?.orgLevel || !typeProfile(ws?.orgType).schools)) throw new Error("Not found");
  const settings = readPathSettings(ws?.settings);
  if (isClass && !((ws?.settings as { path?: { pacing?: unknown } } | null)?.path?.pacing)) settings.pacing = "scheduled";
  const insider = access.isOwner || access.isMember;
  if (!insider && !(opts.allowPublic && settings.public && settings.pacing === "self" && ws?.visibility === "public" && access.canRead)) throw new Error("The learning path is for workspace members.");
  const { canChangeWorkflows } = await import("@/lib/workflows/rules");
  // In a class the Teacher builds the path; TAs (Mentors) see Progress but never edit it (call).
  const canManage = isClass ? access.isOwner && !access.writeBlocked : insider && canChangeWorkflows(access) && !access.writeBlocked;
  const seesProgress = isClass ? access.isOwner || access.memberRole === "admin" : canManage;
  return { userId, access, insider, settings, canManage, seesProgress, isClass, isAgent: auth.tokenKind === "agent" };
}

async function readSteps(projectId: string) {
  const steps = await db.select({ id: workspaceSprints.id, name: workspaceSprints.name, position: workspaceSprints.pathPosition, startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate })
    .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, projectId), isNotNull(workspaceSprints.pathPosition), isNull(workspaceSprints.archivedAt)))
    .orderBy(asc(workspaceSprints.pathPosition), asc(workspaceSprints.createdAt));
  const lessons = steps.length ? await db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, sprintId: tasks.sprintId, stage: tasks.stage, fields: tasks.typeFields })
    .from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.itemType, "class_lesson"), isNull(tasks.deletedAt), inArray(tasks.sprintId, steps.map((s) => s.id))))
    .orderBy(asc(tasks.createdAt)) : [];
  return steps.map((s) => ({ ...s, startDate: s.startDate?.toISOString() ?? null, endDate: s.endDate?.toISOString() ?? null,
    lessons: lessons.filter((l) => l.sprintId === s.id && l.stage !== "archived").map((l) => ({ id: l.id, number: l.number, title: l.title, minutes: (l.fields as { minutes?: number } | null)?.minutes ?? null })) }));
}

/** W4/W5/W7: the path, with my ticks, Up next and locks (visitors of a public path see steps and lessons only). */
export async function readPathAction(projectId: string) {
  try {
    const { userId, insider, settings, canManage, isClass, access, seesProgress } = await pathAccess(projectId, { allowPublic: true });
    const read = await readSteps(projectId);
    // B2.2b (calls 4, 6): a class's modules hold assignments too; staff see drafts, learners published ones and their copy.
    const assignments = isClass ? await moduleAssignments(projectId, read.map((s) => s.id), !canManage) : [];
    const me1 = isClass && insider && userId ? (await learnerSteps(read.flatMap((s) => s.lessons.map((l) => l.id)), assignments.map((a) => a.id), [userId])).get(userId)! : null;
    const done = me1 ? me1.done : new Set(insider && userId ? (await db.select({ taskId: lessonProgress.taskId }).from(lessonProgress)
      .where(and(eq(lessonProgress.userId, userId), inArray(lessonProgress.taskId, read.flatMap((s) => s.lessons.map((l) => l.id)).concat("00000000-0000-0000-0000-000000000000"))))).map((r) => r.taskId) : []);
    // Security review: staff see everything placed; a learner, work for every learner and work they hold a copy of; a
    // visitor to a public path, only work for every learner.
    const withAssignments = read.map((s) => ({ ...s, assignments: assignments.filter((a) => a.sprintId === s.id && (canManage || seesProgress || a.forEveryLearner || me1?.copies.has(a.id)))
      .map((a) => ({ id: a.id, title: a.title, dueAfterDays: a.dueAfterDays, published: a.published, forEveryLearner: a.forEveryLearner, copy: me1?.copies.get(a.id) ?? null })) }));
    const counted = countedModules(withAssignments, me1);
    const steps = withAssignments;
    // The Teacher's Place an assignment list: the class's assignments not yet in a module.
    const unplaced = isClass && canManage ? await db.select({ id: tasks.id, title: tasks.title }).from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt),
        sql`(${tasks.sprintId} IS NULL OR ${tasks.sprintId} NOT IN (SELECT id FROM workspace_sprints WHERE workspace_id = ${projectId}::uuid AND path_position IS NOT NULL))`))
      .orderBy(asc(tasks.createdAt)).limit(100) : [];
    // B2.2a: a learner's header — "58%, 14 of 24 steps", started, and pace when Suggested pace is on.
    const [me] = isClass && insider && userId && access.memberRole === "member" ? await db.select({ joinedAt: workspaceMembers.joinedAt }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId))).limit(1) : [];
    const mine = me ? { ...pathPercent(counted, done), started: me.joinedAt.toISOString(), pace: paceState(counted, done, me.joinedAt, settings.paceWeeks) } : null;
    return { success: true as const, settings, canManage, seesProgress, insider, isClass, mine, unplaced,
      steps: steps.map((s, i) => ({ ...s, progress: insider ? stepProgress(counted[i]!, done) : null, locked: insider ? isLocked(counted, i, done, settings.lockInOrder) : false })),
      done: [...done], upNext: insider ? upNext(counted, done) : null };
  } catch (error) {
    return fail(error, "Couldn’t load the learning path.");
  }
}

const stepInput = z.object({ name: z.string().trim().min(1).max(120), startDate: z.string().date().optional(), endDate: z.string().date().optional() });

/** W2: + Step (dates only when the path is Scheduled; both or neither). Owners and admins. */
export async function createStepAction(projectId: string, input: z.input<typeof stepInput>) {
  try {
    const data = stepInput.parse(input);
    const { userId, canManage, settings } = await pathAccess(projectId);
    if (!canManage || !userId) throw new Error("Only owners and admins build the path.");
    const start = settings.pacing === "scheduled" ? data.startDate ?? null : null, end = settings.pacing === "scheduled" ? data.endDate ?? null : null;
    if (!sprintDatesValid(start, end)) throw new Error("Give a step both dates, or none.");
    const [row] = Array.from(await db.execute<{ id: string }>(sql`
      INSERT INTO workspace_sprints (workspace_id, creator_id, sprint_number, name, start_date, end_date, status, auto_start, path_position)
      SELECT ${projectId}::uuid, ${userId}::uuid,
             (SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM workspace_sprints WHERE workspace_id = ${projectId}::uuid),
             ${data.name}, ${start}::timestamptz, ${end}::timestamptz, 'planning', false,
             (SELECT COALESCE(MAX(path_position), 0) + 1 FROM workspace_sprints WHERE workspace_id = ${projectId}::uuid)
      RETURNING id`));
    return { success: true as const, id: row!.id };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "Name the step." };
    return fail(error, "Couldn’t add the step.");
  }
}

/** W2: Move up / Move down. */
export async function moveStepAction(projectId: string, stepId: string, direction: "up" | "down") {
  try {
    const { canManage } = await pathAccess(projectId);
    if (!canManage) throw new Error("Only owners and admins build the path.");
    const steps = await readSteps(projectId);
    const i = steps.findIndex((s) => s.id === stepId), j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= steps.length) return { success: true as const };
    const order = steps.map((s) => s.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    await db.transaction(async (tx) => {
      for (const [n, id] of order.entries()) await tx.update(workspaceSprints).set({ pathPosition: n + 1 }).where(and(eq(workspaceSprints.id, id), eq(workspaceSprints.projectId, projectId)));
    });
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t move the step.");
  }
}

const lessonInput = z.object({ stepId: uuid, title: z.string().trim().min(1).max(200), fields: lessonFieldsSchema.optional() });

/** W3: + Lesson in a step (a `class_lesson` item, Ready, never on the board). */
export async function addLessonAction(projectId: string, input: z.input<typeof lessonInput>) {
  try {
    const data = lessonInput.parse(input);
    const { canManage } = await pathAccess(projectId);
    if (!canManage) throw new Error("Only owners and admins add lessons.");
    const [step] = await db.select({ id: workspaceSprints.id }).from(workspaceSprints)
      .where(and(eq(workspaceSprints.id, data.stepId), eq(workspaceSprints.projectId, projectId), isNotNull(workspaceSprints.pathPosition))).limit(1);
    if (!step) throw new Error("Pick a step of this path.");
    const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
    const r = await createTaskAction({ projectId, title: data.title, status: "todo", priority: "medium", itemType: "class_lesson", stage: "ready", typeFields: data.fields ?? {}, sprintId: data.stepId } as Parameters<typeof createTaskAction>[0]);
    if (!r.success || !("task" in r) || !r.task) throw new Error((r.success ? null : r.error) ?? "Couldn’t add the lesson.");
    // Off-board items don't take a sprint when made; a lesson belongs to its step.
    await db.update(tasks).set({ sprintId: data.stepId }).where(eq(tasks.id, r.task.id));
    return { success: true as const, id: r.task.id, number: r.task.taskNumber ?? null };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: error.issues[0]?.message ?? "Check the lesson." };
    return fail(error, "Couldn’t add the lesson.");
  }
}

/** W4: Mark done / undo, for yourself only; agents are refused (call 6); a locked step's lessons wait (W5). */
export async function markLessonAction(projectId: string, input: { taskId: string; done: boolean }) {
  try {
    if (!uuid.safeParse(input.taskId).success) throw new Error("Not found");
    const { userId, insider, settings, isAgent, access, isClass } = await pathAccess(projectId);
    if (isAgent) throw new Error("Agents can’t mark lessons done; the person does.");
    if (!insider || !userId || access.writeBlocked) throw new Error("Only people in this workspace tick lessons.");
    const steps = await readSteps(projectId);
    const index = steps.findIndex((s) => s.lessons.some((l) => l.id === input.taskId));
    if (index < 0) throw new Error("That isn’t a lesson on this path.");
    if (input.done) {
      const mine = new Set((await db.select({ taskId: lessonProgress.taskId }).from(lessonProgress).where(eq(lessonProgress.userId, userId))).map((r) => r.taskId));
      if (isLocked(steps, index, mine, settings.lockInOrder)) throw new Error(`Finish ${steps[index - 1]?.name ?? "the step before"} first.`);
      // Security review: in a class the lock counts assignments too, the same rule the Path and Start use.
      if (isClass) {
        const path = await readPathAction(projectId);
        if (path.success && path.steps[index]?.locked) throw new Error(`Finish ${steps[index - 1]?.name ?? "the module before"} first.`);
      }
      await db.insert(lessonProgress).values({ taskId: input.taskId, userId }).onConflictDoNothing();
      if (isClass && settings.pacing === "self" && access.memberRole === "member") await db.transaction((tx) => openModuleFor(tx, projectId, steps[index]!.id, userId));
    } else {
      await db.delete(lessonProgress).where(and(eq(lessonProgress.taskId, input.taskId), eq(lessonProgress.userId, userId)));
    }
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t save that.");
  }
}

/** W6 (call 4): owners and admins see people × steps as "3/7" with the last activity; no ranking. */
export async function readProgressAction(projectId: string) {
  try {
    const { seesProgress, access, isClass, settings } = await pathAccess(projectId);
    if (!seesProgress || !access.project) throw new Error("Progress is for owners and admins.");
    const steps = await readSteps(projectId);
    // In a class, Progress lists learners with the day they started; elsewhere everyone in the workspace.
    const people = Array.from(await db.execute<{ id: string; name: string; started: string | null }>(isClass ? sql`
      SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name, m.joined_at::text AS started FROM ${workspaceMembers} m JOIN profiles p ON p.id = m.user_id
      WHERE m.workspace_id = ${projectId}::uuid AND m.role = 'member' ORDER BY 2` : sql`
      SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name, NULL::text AS started FROM profiles p
      WHERE p.id = ${access.project.ownerId}::uuid OR p.id IN (SELECT user_id FROM ${workspaceMembers} WHERE workspace_id = ${projectId}::uuid)
      ORDER BY 2`));
    const lessonIds = steps.flatMap((s) => s.lessons.map((l) => l.id));
    const marks = lessonIds.length ? await db.select({ taskId: lessonProgress.taskId, userId: lessonProgress.userId, doneAt: lessonProgress.doneAt }).from(lessonProgress).where(inArray(lessonProgress.taskId, lessonIds)) : [];
    // B2.2b: in a class, published assignments in a module count as steps too (Excused left out).
    const assignments = isClass ? await moduleAssignments(projectId, steps.map((s) => s.id), true) : [];
    const perLearner = isClass ? await learnerSteps(lessonIds, assignments.map((a) => a.id), people.map((p) => p.id)) : null;
    const modulesWith = steps.map((s) => ({ ...s, assignments: assignments.filter((a) => a.sprintId === s.id) }));
    const sets: Array<Set<string>> = [];
    const rows = people.map((p) => {
      const mine = marks.filter((m) => m.userId === p.id);
      const own = perLearner?.get(p.id);
      const done = own ? own.done : new Set(mine.map((m) => m.taskId));
      sets.push(done);
      const last = own ? own.lastDone : mine.reduce<Date | null>((a, m) => (!a || m.doneAt > a ? m.doneAt : a), null);
      const started = p.started ? new Date(p.started) : null;
      const mods = own ? countedModules(modulesWith, own) : steps;
      const pct = pathPercent(mods, done);
      return { id: p.id, name: p.name, cells: mods.map((s) => stepProgress(s, done)), lastActivity: last?.toISOString() ?? null, started: started?.toISOString() ?? null,
        percent: pct.percent, pace: paceState(mods, done, started, settings.paceWeeks), stuck: isClass ? stuckDays(last, started, pct.total > 0 && pct.done === pct.total, settings.stuckDays) : null };
    });
    return { success: true as const, isClass, steps: modulesWith.map((s) => ({ id: s.id, name: s.name, total: s.lessons.length + s.assignments.length })), people: rows,
      dropOff: isClass ? dropOff(countedModules(modulesWith, null), sets) : null };
  } catch (error) {
    return fail(error, "Couldn’t load progress.");
  }
}

const placeInput = z.object({ assignmentId: uuid, stepId: uuid, dueAfterDays: z.number().int().min(1).max(365).nullable() });

/** B2.2b (call 4): the Teacher puts one of the class's assignments in a module, due N days after a learner opens it. */
export async function placeAssignmentAction(projectId: string, input: z.input<typeof placeInput>) {
  try {
    const data = placeInput.parse(input);
    const { canManage, isClass } = await pathAccess(projectId);
    if (!canManage || !isClass) throw new Error("Only the teacher builds the path.");
    const [step] = await db.select({ id: workspaceSprints.id }).from(workspaceSprints)
      .where(and(eq(workspaceSprints.id, data.stepId), eq(workspaceSprints.projectId, projectId), isNotNull(workspaceSprints.pathPosition))).limit(1);
    if (!step) throw new Error("Pick a module of this path.");
    const placed = await db.update(tasks).set({ sprintId: data.stepId, updatedAt: new Date(),
      assignmentSettings: sql`jsonb_set(${tasks.assignmentSettings}, '{dueAfterDays}', ${JSON.stringify(data.dueAfterDays)}::jsonb)` })
      .where(and(eq(tasks.id, data.assignmentId), eq(tasks.projectId, projectId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id });
    if (!placed.length) throw new Error("Pick one of this class’s assignments.");
    return { success: true as const };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "Due is 1 to 365 days, or none." };
    return fail(error, "Couldn’t place the assignment.");
  }
}

/** B2.2b (call 4): a learner opens a module (Start); its assignments get their copy, due counted from now. */
export async function openModuleAction(projectId: string, stepId: string) {
  try {
    if (!uuid.safeParse(stepId).success) throw new Error("Not found");
    const { userId, isClass, access, isAgent, settings } = await pathAccess(projectId);
    if (isAgent) throw new Error("Agents can’t open modules; the person does.");
    if (!isClass || !userId || access.memberRole !== "member" || access.writeBlocked) throw new Error("Only learners in this class open modules.");
    // Review: copies on opening belong to a self-paced class only; a scheduled class's copies come when published.
    if (settings.pacing !== "self") throw new Error("This class isn’t self-paced.");
    const path = await readPathAction(projectId);
    if (!path.success) throw new Error(path.error);
    const step = path.steps.find((s) => s.id === stepId);
    if (!step) throw new Error("That isn’t a module of this path.");
    if (step.locked) throw new Error("Finish the module before it first.");
    const made = await db.transaction((tx) => openModuleFor(tx, projectId, stepId, userId));
    return { success: true as const, made };
  } catch (error) {
    return fail(error, "Couldn’t open the module.");
  }
}

const settingsInput = z.object({ pacing: z.enum(["self", "scheduled"]).optional(), lockInOrder: z.boolean().optional(), public: z.boolean().optional(),
  paceWeeks: z.number().int().min(1).max(52).nullable().optional(), stuckDays: z.number().int().min(3).max(90).optional() });

/** W1/W5/W7: Self-paced or Scheduled, Lock in order, public path (owners and admins). */
export async function setPathSettingsAction(projectId: string, input: z.input<typeof settingsInput>) {
  try {
    const data = settingsInput.parse(input);
    const { canManage, settings, isClass } = await pathAccess(projectId);
    if (!canManage) throw new Error("Only owners and admins change the path.");
    const next: PathSettings = { ...settings, ...data };
    if (isClass && data.pacing && data.pacing !== settings.pacing) {
      const [learner] = await db.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.role, "member"))).limit(1);
      if (learner) throw new Error("Pacing can switch only before the first learner joins.");
    }
    if (next.public && next.pacing !== "self") throw new Error("Only a self-paced path can be public.");
    await db.execute(sql`UPDATE workspaces SET workflow_settings = coalesce(workflow_settings, '{}'::jsonb) || jsonb_build_object('path', ${JSON.stringify(next)}::jsonb) WHERE id = ${projectId}::uuid`);
    return { success: true as const, settings: next };
  } catch (error) {
    return fail(error, "Couldn’t save.");
  }
}

/** My work's "Up next: Lesson 4 · Step 2" (A7.7): one line per workspace with a path I'm part of. */
export async function readMyUpNextAction() {
  try {
    const { user } = await requireAuthenticatedUser();
    if (!user) return { success: true as const, items: [] };
    const rows = Array.from(await db.execute<{ workspace_id: string; title: string; slug: string | null }>(sql`
      SELECT DISTINCT w.id AS workspace_id, w.title, w.slug FROM workspaces w
      WHERE w.deleted_at IS NULL AND (EXISTS (SELECT 1 FROM workspace_workflows wf WHERE wf.workspace_id = w.id AND wf.workflow = 'learning_path' AND wf.hidden_at IS NULL)
        OR (w.kind = 'organization' AND w.workflow_settings->'path'->>'pacing' = 'self')) AND (w.owner_id = ${user.id}::uuid OR w.id IN (SELECT workspace_id FROM ${workspaceMembers} WHERE user_id = ${user.id}::uuid))
      LIMIT 10`));
    const items: Array<{ workspaceId: string; workspaceTitle: string; slug: string | null; lesson: string; step: string }> = [];
    for (const r of rows) {
      const path = await readPathAction(r.workspace_id);
      if (!path.success || !path.upNext) continue;
      const step = path.steps.find((s) => s.id === path.upNext!.stepId);
      const lesson = step?.lessons.find((l) => l.id === path.upNext!.lessonId);
      if (step && lesson && !step.locked) items.push({ workspaceId: r.workspace_id, workspaceTitle: r.title, slug: r.slug, lesson: lesson.title, step: step.name });
    }
    return { success: true as const, items };
  } catch (error) {
    logger.warn("learning_path.up_next_failed", { error: error instanceof Error ? error.message : String(error) });
    return { success: true as const, items: [] };
  }
}
