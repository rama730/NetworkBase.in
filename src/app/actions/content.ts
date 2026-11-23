"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { assignTaskAction, setTaskStageAction, updateTaskFieldAction } from "@/app/actions/task";
import { createTaskAction } from "@/app/actions/workspace";
import { db } from "@/lib/db";
import { taskSubtasks, tasks, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { checklistFor, contentSettingsSchema, starterSettings, type Setup } from "@/lib/workflows/content";
import { readContentSettings, writeContentSettings } from "@/lib/workflows/content-store";
import { readWorkingHours } from "@/lib/workflows/request-clock-server";
import { zonedInstant } from "@/lib/workflows/request-clock";
import { canChangeWorkflows } from "@/lib/workflows/rules";

/**
 * Report 38.8 parts 5–6 (plan A2.7): Content's read, settings, ideas, and planning a piece onto a day. Members create,
 * write and plan; owners and admins set channels and types (call 6). Never public (B11).
 */
const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });

async function insider(projectId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || access.isMember)) throw new Error("Not found");
  return { user, canEdit: access.isOwner || (access.isMember && access.memberRole !== "viewer"), canManage: canChangeWorkflows(access) };
}

export type ContentRow = {
  id: string; taskNumber: number | null; title: string; stage: string | null; status: string; sprintId: string | null; dueDate: string | null;
  assigneeId: string | null; assigneeName: string | null; createdAt: string; typeFields: Record<string, unknown>;
};

/** The tab's read: settings, the time zone, and every live piece (ideas, planned, and the last 60 days published). */
export async function readContentAction(projectId: string) {
  try {
    id.parse(projectId);
    const { user, canEdit, canManage } = await insider(projectId);
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const rows = Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; status: string; sprint_id: string | null; due_date: string | null;
      assignee_id: string | null; assignee_name: string | null; created_at: Date; type_fields: Record<string, unknown> | null }>(sql`
      SELECT t.id, t.task_number, t.title, t.stage, t.status, t.sprint_id, t.due_date::text AS due_date, t.assignee_id, a.full_name AS assignee_name, t.created_at, t.type_fields
      FROM tasks t LEFT JOIN profiles a ON a.id = t.assignee_id
      WHERE t.workspace_id = ${projectId}::uuid AND t.item_type = 'content' AND t.deleted_at IS NULL
        AND (t.stage <> 'published' OR t.updated_at > now() - interval '60 days')
      ORDER BY t.created_at DESC LIMIT 1000`));
    const items: ContentRow[] = rows.map((r) => ({
      id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, status: r.status, sprintId: r.sprint_id, dueDate: r.due_date ? r.due_date.slice(0, 10) : null,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name, createdAt: new Date(r.created_at).toISOString(), typeFields: r.type_fields ?? {},
    }));
    const { tz } = await readWorkingHours(projectId);
    return { success: true as const, projectKey: ws?.key ?? null, settings: await readContentSettings(projectId), timeZone: tz, items, canEdit, canManage, viewerId: user.id };
  } catch (error) {
    return fail(error, "Couldn’t load content");
  }
}

const settingsInput = z.object({ projectId: id, settings: contentSettingsSchema });

/** W1 and S10: the first setup (Blog, Social, channels) and later changes; archiving a channel keeps its pieces. */
export async function saveContentSettingsAction(input: z.infer<typeof settingsInput>) {
  try {
    const parsed = settingsInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Check the channels, types and default time" };
    const { projectId, settings } = parsed.data;
    const { canManage } = await insider(projectId);
    if (!canManage) throw new Error("Only owners and admins set channels and types");
    const ids = (list: Array<{ id: string }>) => new Set(list.map((x) => x.id)).size === list.length;
    if (!ids(settings.channels) || !ids(settings.types)) throw new Error("Each channel and type needs its own name");
    if (!settings.channels.some((c) => !c.archived)) throw new Error("Keep at least one channel");
    await writeContentSettings(projectId, settings);
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t save the channels");
  }
}

/** The starter settings for a setup choice, for the first-time sheet to show before saving. */
export async function starterContentSettingsAction(setups: Setup[]) {
  const picked = (Array.isArray(setups) ? setups : []).filter((s): s is Setup => s === "blog" || s === "social");
  return picked.length ? { success: true as const, settings: starterSettings(picked) } : { success: false as const, error: "Pick Blog, Social or both" };
}

/** W2: + Add idea in the rail: an Idea (off the board) with just its title. */
export async function addIdeaAction(input: { projectId: string; title: string }) {
  const title = String(input?.title ?? "").trim().slice(0, 200);
  if (!title) return { success: false as const, error: "Name the idea" };
  const r = await createTaskAction({ projectId: input.projectId, title, status: "todo", priority: "medium", itemType: "content", stage: "idea", typeFields: {} } as Parameters<typeof createTaskAction>[0]);
  return r.success && "task" in r && r.task ? { success: true as const, id: r.task.id } : { success: false as const, error: r.error ?? "Couldn’t add the idea" };
}

const planInput = z.object({ projectId: id, taskId: id, day, time: time.optional(), sprintId: id.nullable().optional() });

/**
 * W3 and W9: put a piece on a day. Its publish time is that day at the time given (the default time otherwise) and the
 * due date follows (call 7). An Idea becomes Drafting and joins the board (the sprint for owners and admins, else the
 * Backlog), takes the planner as writer when it has none, and gets its type's checklist (call 5).
 */
export async function planContentAction(input: z.infer<typeof planInput>) {
  try {
    const parsed = planInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Pick a day" };
    const { projectId, taskId, sprintId } = parsed.data;
    const { user, canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t plan content");
    const [piece] = await db.select({ stage: tasks.stage, typeFields: tasks.typeFields, assigneeId: tasks.assigneeId }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "content"), isNull(tasks.deletedAt))).limit(1);
    if (!piece) throw new Error("Not found");
    const settings = await readContentSettings(projectId);
    if (!settings) throw new Error("Set up Content’s channels first");
    const { tz } = await readWorkingHours(projectId);
    const publishAt = zonedInstant(parsed.data.day, parsed.data.time ?? settings.defaultTime, tz).toISOString();
    const dated = await updateTaskFieldAction(taskId, "dueDate", `${parsed.data.day}T00:00:00.000Z`, projectId);
    if (!dated.success) return { success: false as const, error: dated.error ?? "Couldn’t set the day" };
    await db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || ${JSON.stringify({ publishAt })}::jsonb WHERE id = ${taskId}::uuid`);
    if (piece.stage === "idea") {
      if (!piece.assigneeId) {
        const assigned = await assignTaskAction(taskId, user.id, projectId);
        if (!assigned.success) return { success: false as const, error: assigned.error ?? "Couldn’t make you the writer" };
      }
      const moved = await setTaskStageAction({ taskId, projectId, stage: "drafting", ...(sprintId ? { sprintId } : { toBacklog: true }) });
      if (!moved.success) return moved;
      const type = settings.types.find((t) => t.id === (piece.typeFields as Record<string, unknown> | null)?.contentType);
      const steps = checklistFor(type);
      const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(taskSubtasks).where(eq(taskSubtasks.taskId, taskId));
      if (steps.length && !has?.n) await db.insert(taskSubtasks).values(steps.map((title, position) => ({ taskId, title, position, createdBy: user.id })));
    }
    return { success: true as const, publishAt };
  } catch (error) {
    return fail(error, "Couldn’t plan the piece");
  }
}
