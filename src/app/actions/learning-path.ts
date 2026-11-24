"use server";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { lessonProgress, tasks, workspaceMembers, workspaceSprints, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { lessonFieldsSchema, readPathSettings, sprintDatesValid, stepProgress, upNext, isLocked, type PathSettings } from "@/lib/workflows/learning-path";

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
  if (!access.project || access.project.kind !== "workspace") throw new Error("Not found");
  const [ws] = await db.select({ settings: workspaces.workflowSettings, visibility: workspaces.visibility }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  const settings = readPathSettings(ws?.settings);
  const insider = access.isOwner || access.isMember;
  if (!insider && !(opts.allowPublic && settings.public && settings.pacing === "self" && ws?.visibility === "public" && access.canRead)) throw new Error("The learning path is for workspace members.");
  const { canChangeWorkflows } = await import("@/lib/workflows/rules");
  return { userId, access, insider, settings, canManage: insider && canChangeWorkflows(access) && !access.writeBlocked, isAgent: auth.tokenKind === "agent" };
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
    const { userId, insider, settings, canManage } = await pathAccess(projectId, { allowPublic: true });
    const steps = await readSteps(projectId);
    const done = new Set(insider && userId ? (await db.select({ taskId: lessonProgress.taskId }).from(lessonProgress)
      .where(and(eq(lessonProgress.userId, userId), inArray(lessonProgress.taskId, steps.flatMap((s) => s.lessons.map((l) => l.id)).concat("00000000-0000-0000-0000-000000000000"))))).map((r) => r.taskId) : []);
    return { success: true as const, settings, canManage, insider,
      steps: steps.map((s, i) => ({ ...s, progress: insider ? stepProgress(s, done) : null, locked: insider ? isLocked(steps, i, done, settings.lockInOrder) : false })),
      done: [...done], upNext: insider ? upNext(steps, done) : null };
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
    const { userId, insider, settings, isAgent, access } = await pathAccess(projectId);
    if (isAgent) throw new Error("Agents can’t mark lessons done; the person does.");
    if (!insider || !userId || access.writeBlocked) throw new Error("Only people in this workspace tick lessons.");
    const steps = await readSteps(projectId);
    const index = steps.findIndex((s) => s.lessons.some((l) => l.id === input.taskId));
    if (index < 0) throw new Error("That isn’t a lesson on this path.");
    if (input.done) {
      const mine = new Set((await db.select({ taskId: lessonProgress.taskId }).from(lessonProgress).where(eq(lessonProgress.userId, userId))).map((r) => r.taskId));
      if (isLocked(steps, index, mine, settings.lockInOrder)) throw new Error(`Finish ${steps[index - 1]?.name ?? "the step before"} first.`);
      await db.insert(lessonProgress).values({ taskId: input.taskId, userId }).onConflictDoNothing();
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
    const { canManage, access } = await pathAccess(projectId);
    if (!canManage || !access.project) throw new Error("Progress is for owners and admins.");
    const steps = await readSteps(projectId);
    const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
      SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM profiles p
      WHERE p.id = ${access.project.ownerId}::uuid OR p.id IN (SELECT user_id FROM ${workspaceMembers} WHERE workspace_id = ${projectId}::uuid)
      ORDER BY 2`));
    const lessonIds = steps.flatMap((s) => s.lessons.map((l) => l.id));
    const marks = lessonIds.length ? await db.select({ taskId: lessonProgress.taskId, userId: lessonProgress.userId, doneAt: lessonProgress.doneAt }).from(lessonProgress).where(inArray(lessonProgress.taskId, lessonIds)) : [];
    return { success: true as const, steps: steps.map((s) => ({ id: s.id, name: s.name, total: s.lessons.length })),
      people: people.map((p) => {
        const mine = marks.filter((m) => m.userId === p.id);
        const done = new Set(mine.map((m) => m.taskId));
        const last = mine.reduce<Date | null>((a, m) => (!a || m.doneAt > a ? m.doneAt : a), null);
        return { id: p.id, name: p.name, cells: steps.map((s) => stepProgress(s, done)), lastActivity: last?.toISOString() ?? null };
      }) };
  } catch (error) {
    return fail(error, "Couldn’t load progress.");
  }
}

const settingsInput = z.object({ pacing: z.enum(["self", "scheduled"]).optional(), lockInOrder: z.boolean().optional(), public: z.boolean().optional() });

/** W1/W5/W7: Self-paced or Scheduled, Lock in order, public path (owners and admins). */
export async function setPathSettingsAction(projectId: string, input: z.input<typeof settingsInput>) {
  try {
    const data = settingsInput.parse(input);
    const { canManage, settings } = await pathAccess(projectId);
    if (!canManage) throw new Error("Only owners and admins change the path.");
    const next: PathSettings = { ...settings, ...data };
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
      JOIN workspace_workflows wf ON wf.workspace_id = w.id AND wf.workflow = 'learning_path' AND wf.hidden_at IS NULL
      WHERE w.deleted_at IS NULL AND (w.owner_id = ${user.id}::uuid OR w.id IN (SELECT workspace_id FROM ${workspaceMembers} WHERE user_id = ${user.id}::uuid))
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
