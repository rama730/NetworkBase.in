"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { setTaskStageAction } from "@/app/actions/task";
import { db } from "@/lib/db";
import { tasks, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { COLUMNS, itemProgress, roadmapFieldsSchema, stageAfterColumn } from "@/lib/workflows/roadmap";
import { lockTaskForWrite } from "@/lib/workspaces/task-transition-service";

/**
 * Report 38.9 parts 5–6 (plan A2.10): Roadmap's read, columns, fields and Won't do. Members edit; viewers read; never
 * public (call 6). Work tasks link through Part of (T1), projects as Built by (call 4).
 */
const id = z.string().uuid();
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });

async function insider(projectId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || access.isMember)) throw new Error("Not found");
  return { user, canEdit: access.isOwner || (access.isMember && access.memberRole !== "viewer") };
}

export type RoadmapRow = {
  id: string; taskNumber: number | null; title: string; stage: string | null; status: string; priority: string; dueDate: string | null;
  assigneeId: string | null; assigneeName: string | null; createdAt: string; typeFields: Record<string, unknown>;
  /** Work tasks (Part of) and Built by projects, combined (part 7); null when nothing is linked. */
  progress: number | null; workCount: number; openWork: number;
};

/** The tab's read: every roadmap item with its progress worked out in SQL from its work and Built by projects. */
export async function readRoadmapAction(projectId: string) {
  try {
    id.parse(projectId);
    const { user, canEdit } = await insider(projectId);
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const rows = Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; status: string; priority: string; due_date: string | null;
      assignee_id: string | null; assignee_name: string | null; created_at: Date; type_fields: Record<string, unknown> | null; done: number; total: number; projects: Array<{ percent: number; tasks: number }> | null }>(sql`
      SELECT t.id, t.task_number, t.title, t.stage, t.status, t.priority, t.due_date::text AS due_date, t.assignee_id, a.full_name AS assignee_name, t.created_at, t.type_fields,
        coalesce(w.done, 0)::int AS done, coalesce(w.total, 0)::int AS total, bp.projects
      FROM tasks t LEFT JOIN profiles a ON a.id = t.assignee_id
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE x.status = 'done') AS done, count(*) AS total FROM tasks x
        WHERE x.part_of_id = t.id AND x.deleted_at IS NULL AND x.stage IS DISTINCT FROM 'cancelled') w ON true
      LEFT JOIN LATERAL (SELECT json_agg(json_build_object('tasks', pw.total, 'percent', CASE WHEN pw.total > 0 THEN 100.0 * pw.done / pw.total WHEN p.status = 'done' THEN 100 ELSE 0 END)) AS projects
        FROM tasks p LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE y.status = 'done') AS done, count(*) AS total FROM tasks y WHERE y.part_of_id = p.id AND y.deleted_at IS NULL AND y.stage IS DISTINCT FROM 'cancelled') pw ON true
        WHERE p.workspace_id = t.workspace_id AND p.item_type = 'project' AND p.deleted_at IS NULL
          AND p.id::text IN (SELECT jsonb_array_elements_text(coalesce(t.type_fields->'builtBy', '[]'::jsonb)))) bp ON true
      WHERE t.workspace_id = ${projectId}::uuid AND t.item_type = 'roadmap_item' AND t.deleted_at IS NULL
      ORDER BY t.created_at DESC LIMIT 1000`));
    const items: RoadmapRow[] = rows.map((r) => {
      const work = Array.from({ length: r.total }, (_, i) => ({ status: i < r.done ? "done" : "todo" }));
      return {
        id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, status: r.status, priority: r.priority, dueDate: r.due_date ? r.due_date.slice(0, 10) : null,
        assigneeId: r.assignee_id, assigneeName: r.assignee_name, createdAt: new Date(r.created_at).toISOString(), typeFields: r.type_fields ?? {},
        progress: itemProgress(work, (r.projects ?? []).map((p) => ({ percent: Number(p.percent), tasks: Number(p.tasks) }))), workCount: r.total, openWork: r.total - r.done,
      };
    });
    // Built by: the workspace's projects to pick from.
    const projects = Array.from(await db.execute<{ id: string; title: string; task_number: number | null }>(sql`
      SELECT id, title, task_number FROM tasks WHERE workspace_id = ${projectId}::uuid AND item_type = 'project' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`))
      .map((p) => ({ id: p.id, title: p.title, taskNumber: p.task_number }));
    return { success: true as const, projectKey: ws?.key ?? null, items, projects, canEdit, viewerId: user.id };
  } catch (error) {
    return fail(error, "Couldn’t load the roadmap");
  }
}

async function writeFields(userId: string, projectId: string, taskId: string, fields: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    const locked = await lockTaskForWrite(tx, taskId, userId);
    if (locked.projectId !== projectId || locked.itemType !== "roadmap_item") throw new Error("Not found");
    await tx.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb`, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  });
}

const columnInput = z.object({ projectId: id, taskId: id, column: z.enum(COLUMNS) });

/** W3: a card moved to Now, Next or Later; a Backlog item becomes Planned. */
export async function moveRoadmapColumnAction(input: z.infer<typeof columnInput>) {
  try {
    const { projectId, taskId, column } = columnInput.parse(input);
    const { user, canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t change the roadmap");
    await writeFields(user.id, projectId, taskId, { column });
    const [row] = await db.select({ stage: tasks.stage }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const next = stageAfterColumn(row?.stage ?? null);
    if (next) {
      const moved = await setTaskStageAction({ projectId, taskId, stage: next });
      if (!moved.success) return moved;
    }
    return { success: true as const, stage: next ?? row?.stage ?? null };
  } catch (error) {
    return fail(error, "Couldn’t move the item");
  }
}

const fieldsInput = z.object({ projectId: id, taskId: id, fields: roadmapFieldsSchema.omit({ wontDoReason: true }) });

/** S6: the item's own fields from the panel (outcome, type, milestone, Built by). Built by takes this workspace's projects. */
export async function setRoadmapFieldsAction(input: z.infer<typeof fieldsInput>) {
  try {
    const parsed = fieldsInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Check the item’s details" };
    const { projectId, taskId, fields } = parsed.data;
    const { user, canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t change the roadmap");
    if (fields.builtBy?.length) {
      const found = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${projectId}::uuid AND item_type = 'project' AND deleted_at IS NULL
        AND id IN (${sql.join(fields.builtBy.map((p) => sql`${p}::uuid`), sql`, `)})`))[0]?.n ?? 0;
      if (found !== new Set(fields.builtBy).size) throw new Error("Built by takes projects from this workspace");
    }
    await writeFields(user.id, projectId, taskId, fields);
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t change the item");
  }
}

const wontDoInput = z.object({ projectId: id, taskId: id, reason: z.string().trim().min(1).max(1000) });

/** W7: Won't do asks a reason; open work stays as it is (the panel lists it). */
export async function wontDoAction(input: z.infer<typeof wontDoInput>) {
  try {
    const parsed = wontDoInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Say why it won’t be done" };
    const { projectId, taskId, reason } = parsed.data;
    const { user, canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t change the roadmap");
    await writeFields(user.id, projectId, taskId, { wontDoReason: reason });
    const moved = await setTaskStageAction({ projectId, taskId, stage: "wont_do" });
    if (!moved.success) return moved;
    const [open] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM tasks WHERE part_of_id = ${taskId}::uuid AND deleted_at IS NULL AND status <> 'done'`));
    return { success: true as const, openWork: open?.n ?? 0 };
  } catch (error) {
    return fail(error, "Couldn’t close the item");
  }
}
