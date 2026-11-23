"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { assignTaskAction, setTaskStageAction } from "@/app/actions/task";
import { db } from "@/lib/db";
import { tasks, workspaceMembers, workspaces } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { canChangeWorkflows } from "@/lib/workflows/rules";
import { changeRequestTypes, readRequestTypes } from "@/lib/workflows/request-store";
import { readWorkingHours, requestClock, rescheduleWorkspaceClocks, scheduleRequestClock, validZone } from "@/lib/workflows/request-clock-server";
import { workingHoursSchema } from "@/lib/workflows/request-clock";
import { activeTypes, MAX_TYPES, requestTypeSchema, type RequestType } from "@/lib/workflows/requests";

/**
 * Report 38.7 parts 5–6 (plan A2.4): reading requests, Accept and Decline, and the request types. Members and viewers
 * ask; members accept, decline and handle (call 7); owners and admins edit types. Never public (B11).
 */
const id = z.string().uuid();
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });

async function insider(projectId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || access.isMember)) throw new Error("Not found");
  return { user, access, canTriage: access.isOwner || (access.isMember && access.memberRole !== "viewer"), canManage: canChangeWorkflows(access) };
}

export type RequestRow = {
  id: string; taskNumber: number | null; title: string; stage: string | null; status: string; sprintId: string | null; dueDate: string | null;
  assigneeId: string | null; assigneeName: string | null; creatorId: string | null; creatorName: string | null; createdAt: string;
  typeFields: Record<string, unknown>;
  /** A2.5: the running clock, worked out on the server (first reply while New, then deliver). */
  clock: { kind: "first" | "deliver"; state: "running" | "soon" | "breached" | "paused" | "stopped" | "off"; leftMinutes: number; usedMinutes: number } | null;
};

/** The tab's read: every open and recent request, the types, and what the viewer may do. */
export async function readRequestsAction(projectId: string) {
  try {
    id.parse(projectId);
    const { user, canTriage, canManage } = await insider(projectId);
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const rows = Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; status: string; sprint_id: string | null; due_date: string | null;
      assignee_id: string | null; assignee_name: string | null; creator_id: string | null; creator_name: string | null; created_at: Date; type_fields: Record<string, unknown> | null }>(sql`
      SELECT t.id, t.task_number, t.title, t.stage, t.status, t.sprint_id, t.due_date::text AS due_date, t.assignee_id, a.full_name AS assignee_name,
        t.creator_id, c.full_name AS creator_name, t.created_at, t.type_fields
      FROM tasks t LEFT JOIN profiles a ON a.id = t.assignee_id LEFT JOIN profiles c ON c.id = t.creator_id
      WHERE t.workspace_id = ${projectId}::uuid AND t.item_type = 'request' AND t.deleted_at IS NULL
        AND (t.stage NOT IN ('delivered', 'declined') OR t.updated_at > now() - interval '30 days')
      ORDER BY t.created_at DESC LIMIT 1000`));
    const types = await readRequestTypes(projectId);
    const work = await readWorkingHours(projectId);
    const now = new Date();
    const requests: RequestRow[] = rows.map((r) => ({
      id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, status: r.status, sprintId: r.sprint_id, dueDate: r.due_date ? r.due_date.slice(0, 10) : null,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name, creatorId: r.creator_id, creatorName: r.creator_name, createdAt: new Date(r.created_at).toISOString(), typeFields: r.type_fields ?? {},
      clock: requestClock({ stage: r.stage, created_at: r.created_at, type_fields: r.type_fields }, types.find((t) => t.id === (r.type_fields ?? {}).requestTypeId), work.hours, work.tz, now),
    }));
    return { success: true as const, projectKey: ws?.key ?? null, requests, types, hours: work.hours, timeZone: work.tz, hoursSet: work.set, canTriage, canManage, viewerId: user.id };
  } catch (error) {
    return fail(error, "Couldn’t load requests");
  }
}

/** The ask form's types (active ones), for anyone who can ask. */
export async function readRequestTypesAction(projectId: string) {
  try {
    id.parse(projectId);
    const { canManage } = await insider(projectId);
    const types = await readRequestTypes(projectId);
    return { success: true as const, types, active: activeTypes(types), canManage };
  } catch (error) {
    return fail(error, "Couldn’t load request types");
  }
}

/** S5: one request's type and answers for the panel (members and viewers who can read Tasks). */
export async function readRequestAction(projectId: string, taskId: string) {
  try {
    id.parse(projectId); id.parse(taskId);
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
    if (!canReadWorkspaceTab(await getWorkspaceAccessById(projectId, user.id), "tasks")) throw new Error("Not found");
    const [row] = await db.select({ typeFields: tasks.typeFields, creatorId: tasks.creatorId, stage: tasks.stage }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "request"), isNull(tasks.deletedAt))).limit(1);
    if (!row) throw new Error("Not found");
    const fields = (row.typeFields ?? {}) as Record<string, unknown>;
    const type = (await readRequestTypes(projectId)).find((t) => t.id === fields.requestTypeId) ?? null;
    return { success: true as const, type, fields, mine: row.creatorId === user.id, stage: row.stage };
  } catch (error) {
    return fail(error, "Couldn’t load the request");
  }
}

async function mergeFields(taskId: string, patch: Record<string, unknown>) {
  await db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb WHERE id = ${taskId}::uuid`);
}

async function newRequest(projectId: string, taskId: string) {
  const [row] = await db.select({ stage: tasks.stage, typeFields: tasks.typeFields }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "request"), isNull(tasks.deletedAt))).limit(1);
  if (!row) throw new Error("Not found");
  if (row.stage !== "new") throw new Error("This request was already answered");
  return (row.typeFields ?? {}) as Record<string, unknown>;
}

const acceptInput = z.object({ projectId: id, taskId: id, assigneeId: id, sprintId: id.nullable().optional() });

/**
 * W4.2: Accept with a handler (required). New → Accepted joins the board: the sprint picked by an owner or admin,
 * else the Backlog. Accept is the first reply when nothing came before it.
 */
export async function acceptRequestAction(input: z.infer<typeof acceptInput>) {
  try {
    const parsed = acceptInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Pick who handles it" };
    const { projectId, taskId, assigneeId, sprintId } = parsed.data;
    const { user, canTriage } = await insider(projectId);
    if (!canTriage) throw new Error("Viewers can’t accept requests");
    const fields = await newRequest(projectId, taskId);
    const assigned = await assignTaskAction(taskId, assigneeId, projectId);
    if (!assigned.success) return { success: false as const, error: assigned.error ?? "Couldn’t assign it" };
    const moved = await setTaskStageAction({ taskId, projectId, stage: "accepted", ...(sprintId ? { sprintId } : { toBacklog: true }) });
    if (!moved.success) return moved;
    const now = new Date().toISOString();
    await mergeFields(taskId, { acceptedAt: now, firstRepliedAt: fields.firstRepliedAt ?? now });
    await scheduleRequestClock(taskId);
    const { notifyRequestDecided } = await import("@/lib/workflows/request-notify");
    await notifyRequestDecided(taskId, user.id, "Accepted");
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t accept the request");
  }
}

const declineInput = z.object({ projectId: id, taskId: id, reason: z.string().trim().min(1).max(1000) });

/** W4.3: Decline with a reason the asker sees; it closes as Declined, off the board. */
export async function declineRequestAction(input: z.infer<typeof declineInput>) {
  try {
    const parsed = declineInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Say why it’s declined" };
    const { projectId, taskId, reason } = parsed.data;
    const { user, canTriage } = await insider(projectId);
    if (!canTriage) throw new Error("Viewers can’t decline requests");
    const fields = await newRequest(projectId, taskId);
    // The reason goes first: a bare move to Declined is refused without it (setTaskStageAction).
    await mergeFields(taskId, { declineReason: reason, firstRepliedAt: fields.firstRepliedAt ?? new Date().toISOString() });
    const moved = await setTaskStageAction({ taskId, projectId, stage: "declined" });
    if (!moved.success) {
      await mergeFields(taskId, { declineReason: null });
      return moved;
    }
    await scheduleRequestClock(taskId);
    const { notifyRequestDecided } = await import("@/lib/workflows/request-notify");
    await notifyRequestDecided(taskId, user.id, "Declined");
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t decline the request");
  }
}

async function manager(projectId: string) {
  const ctx = await insider(projectId);
  if (!ctx.canManage) throw new Error("Only owners and admins edit request types");
  return ctx;
}

const saveInput = z.object({ projectId: id, type: requestTypeSchema.omit({ id: true, archivedAt: true }).extend({ id: id.optional() }) });

/** W9: add or change a type (up to 12 active, names unique among them). Triage people must be members. */
export async function saveRequestTypeAction(input: z.infer<typeof saveInput>) {
  try {
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message === "A choice needs at least 2 options" ? "A choice needs at least 2 options" : "Check the type’s name, questions and times" };
    const { projectId, type } = parsed.data;
    await manager(projectId);
    if (type.triagerIds.length) {
      const members = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.projectId, projectId));
      const [ws] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
      const ok = new Set([...members.map((m) => m.userId), ws?.ownerId]);
      if (!type.triagerIds.every((p) => ok.has(p))) throw new Error("Triage people must be in the workspace");
    }
    const ids = type.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) throw new Error("Each question needs its own id");
    let savedId = type.id ?? globalThis.crypto.randomUUID();
    await changeRequestTypes(projectId, (types) => {
      const existing = types.find((t) => t.id === type.id);
      if (type.id && !existing) throw new Error("That type is gone");
      const others = activeTypes(types).filter((t) => t.id !== type.id);
      if (others.some((t) => t.name.toLowerCase() === type.name.toLowerCase())) throw new Error(`There’s already a type called ${type.name}`);
      if (!existing && others.length >= MAX_TYPES) throw new Error("Up to 12 request types");
      const next: RequestType = { ...type, id: savedId, archivedAt: existing?.archivedAt ?? null };
      savedId = next.id;
      return existing ? types.map((t) => (t.id === next.id ? next : t)) : [...types, next];
    });
    await rescheduleWorkspaceClocks(projectId);
    return { success: true as const, id: savedId };
  } catch (error) {
    return fail(error, "Couldn’t save the request type");
  }
}

/** W9.3: archiving keeps its requests and takes it off the ask form; at least one type stays. */
export async function archiveRequestTypeAction(input: { projectId: string; typeId: string; archived: boolean }) {
  try {
    const projectId = id.parse(input?.projectId), typeId = id.parse(input?.typeId);
    await manager(projectId);
    await changeRequestTypes(projectId, (types) => {
      if (!types.some((t) => t.id === typeId)) throw new Error("That type is gone");
      if (input.archived && activeTypes(types).filter((t) => t.id !== typeId).length === 0) throw new Error("Keep at least one request type");
      if (!input.archived && activeTypes(types).length >= MAX_TYPES) throw new Error("Up to 12 request types");
      return types.map((t) => (t.id === typeId ? { ...t, archivedAt: input.archived ? new Date().toISOString() : null } : t));
    });
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t change the request type");
  }
}

const hoursInput = z.object({ projectId: id, hours: workingHoursSchema, timeZone: z.string().max(64) });

/** W10: working hours (days, times, holidays) and the workspace's time zone; every open clock is recalculated. */
export async function saveWorkingHoursAction(input: z.infer<typeof hoursInput>) {
  try {
    const parsed = hoursInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Check the days and times: From comes before To" };
    const { projectId, hours, timeZone } = parsed.data;
    if (!validZone(timeZone)) throw new Error("Pick a time zone from the list");
    await manager(projectId);
    const clean = { ...hours, days: [...new Set(hours.days)].sort(), holidays: [...new Set(hours.holidays)].sort() };
    await db.execute(sql`
      UPDATE workspaces SET time_zone = ${timeZone},
        workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{workingHours}', ${JSON.stringify(clean)}::jsonb)
      WHERE id = ${projectId}::uuid`);
    const n = await rescheduleWorkspaceClocks(projectId);
    return { success: true as const, recalculated: n };
  } catch (error) {
    return fail(error, "Couldn’t save the working hours");
  }
}
