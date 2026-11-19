import { orgTaskReadFilter } from "@/lib/organizations/assignments";
import {
  requireAuthenticatedUser,
  jsonError,
} from "@/app/api/v1/_shared";
import { jsonSuccessConditional } from "@/app/api/v1/_conditional";
import { db } from "@/lib/db";
import {
  tasks,
  profiles,
  taskSubtasks,
  taskNodeLinks,
  workspaceNodes,
  workspaceSprints,
  fileVersions,
} from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { getWorkspaceTaskSummary, getTaskFileCountMap } from "@/app/api/v1/extension/_workspace-counts";
import { inferTaskFileRole } from "@/lib/workspaces/task-file-intelligence";
import { orgFileAccessSql, projectContentNodeSql } from "@/lib/files/internal-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().uuid(),
});

const querySchema = z.object({
  projectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  scope: z.enum(["mine","all"]).default("all"),
  q: z.string().max(200).default(""),
  cursor: z.string().max(2048).optional(),
  // nb task list filters (report C2). Due ranges come as instants so "today" is the person's own day.
  open: z.enum(["1"]).optional(),
  status: z.array(z.enum(["todo", "in_progress", "done", "blocked"])).max(4).optional(),
  priority: z.array(z.enum(["low", "medium", "high", "urgent"])).max(4).optional(),
  assignee: z.union([z.string().uuid(), z.literal("none")]).optional(),
  sprint: z.string().uuid().optional(),
  dueAfter: z.string().datetime().optional(),
  dueBefore: z.string().datetime().optional(),
  sort: z.enum(["updated", "due", "priority"]).default("updated"),
  label: z.string().trim().toLowerCase().max(32).optional(),
  starred: z.enum(["1"]).optional(),
  // Report 38.2 F1: list one type, or one stage of it (nb task list --type bug --stage confirmed).
  type: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  stage: z.string().regex(/^[a-z_]{1,40}$/).optional(),
});
const csv = (value: string | null) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

function decodeCursor(value: string | undefined) {
  if (!value) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

function encodeCursor(value: { updatedAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify({ updatedAt: value.updatedAt.toISOString(), id: value.id }),
  ).toString("base64url");
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const searchParams = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({
      projectId: searchParams.get("projectId")?.trim(),
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor")?.trim() || undefined,
      scope: searchParams.get("scope") || "all",
      q: searchParams.get("q") || "",
      open: searchParams.get("open") || undefined,
      status: csv(searchParams.get("status")),
      priority: csv(searchParams.get("priority")),
      assignee: searchParams.get("assignee") || undefined,
      sprint: searchParams.get("sprint") || undefined,
      dueAfter: searchParams.get("dueAfter") || undefined,
      dueBefore: searchParams.get("dueBefore") || undefined,
      sort: searchParams.get("sort") || undefined,
      label: searchParams.get("label") || undefined,
      starred: searchParams.get("starred") || undefined,
      type: searchParams.get("type") || undefined,
      stage: searchParams.get("stage") || undefined,
    });
    if (!parsed.success)
      return jsonError("Invalid workspace task query", 400, "BAD_REQUEST");

    const f = parsed.data;
    // Pages follow updatedAt; another sort answers one page (limit up to 100) with no cursor.
    const cursor = f.sort === "updated" ? decodeCursor(f.cursor) : null;
    if (f.sort === "updated" && f.cursor && !cursor)
      return jsonError("Invalid task cursor", 400, "BAD_REQUEST");
    const { projectId, limit } = parsed.data;
    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project)
      return jsonError("Workspace not found", 404, "NOT_FOUND");
    // Task data follows the project's Tasks visibility (AUTH-002).
    if (!canReadWorkspaceTab(access, "tasks")) return jsonError("You don’t have access to this", 403, "FORBIDDEN");

    const canReadFiles = canReadWorkspaceTab(access, "files");
    const cursorDate = cursor ? new Date(cursor.updatedAt) : null;
    const [taskRows, summary] = await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          storyPoints: tasks.storyPoints,
          kind: tasks.kind,
          itemType: tasks.itemType,
          stage: tasks.stage,
          onBoard: tasks.onBoard,
          sprintId: tasks.sprintId,
          sprintName: workspaceSprints.name,
          reviewStatus: tasks.reviewStatus,
          assigneeId: tasks.assigneeId,
          assigneeName: profiles.fullName,
          assigneeUsername: profiles.username,
          assigneeAvatarUrl: profiles.avatarUrl,
          dueDate: tasks.dueDate,
          labels: tasks.labels,
          taskNumber: tasks.taskNumber,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .leftJoin(profiles, eq(profiles.id, tasks.assigneeId))
        .leftJoin(workspaceSprints, eq(workspaceSprints.id, tasks.sprintId))
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            // Organizations: the same read rule as the Tasks tab (decision 19).
            orgTaskReadFilter(access, user.id),
            parsed.data.scope === "mine" ? eq(tasks.assigneeId, user.id) : undefined,
            f.open ? sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')` : undefined,
            f.status ? inArray(tasks.status, f.status) : undefined,
            f.priority ? inArray(tasks.priority, f.priority) : undefined,
            f.assignee === "none" ? isNull(tasks.assigneeId) : f.assignee ? eq(tasks.assigneeId, f.assignee) : undefined,
            f.sprint ? eq(tasks.sprintId, f.sprint) : undefined,
            f.dueAfter ? sql`${tasks.dueDate} >= ${f.dueAfter}::timestamptz` : undefined,
            f.dueBefore ? sql`${tasks.dueDate} < ${f.dueBefore}::timestamptz` : undefined,
            f.label ? sql`${tasks.labels} @> ARRAY[${f.label}]::text[]` : undefined,
            f.type ? eq(tasks.itemType, f.type) : undefined,
            f.stage ? eq(tasks.stage, f.stage) : undefined,
            f.starred ? sql`EXISTS (SELECT 1 FROM task_stars s WHERE s.task_id = ${tasks.id} AND s.user_id = ${user.id})` : undefined,
            // Every word in the title, in any order ("bug login" finds "Fix the login bug"), or the number (C2).
            parsed.data.q.trim()
              ? or(
                  and(...parsed.data.q.trim().split(/\s+/).slice(0, 8).map((word) => sql`${tasks.title} ILIKE ${"%" + word.replace(/[\%_]/g, (c) => "\\" + c) + "%"}`)),
                  sql`${tasks.taskNumber}::text = ${parsed.data.q.trim().replace(/^.*[#-]/, "")}`,
                )
              : undefined,
            cursor && cursorDate
              ? or(
                  lt(tasks.updatedAt, cursorDate),
                  and(eq(tasks.updatedAt, cursorDate), lt(tasks.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(
          ...(f.sort === "due" ? [sql`${tasks.dueDate} ASC NULLS LAST`] : f.sort === "priority" ? [sql`array_position(ARRAY['urgent','high','medium','low']::text[], ${tasks.priority}::text)`] : []),
          desc(tasks.updatedAt),
          desc(tasks.id),
        )
        .limit(limit + 1),
      getWorkspaceTaskSummary(projectId),
    ]);

    const hasMore = taskRows.length > limit;
    const page = hasMore ? taskRows.slice(0, limit) : taskRows;
    const taskIds = page.map((task) => task.id);

    const [fileCountMap, subtaskRows, attachedFileRows] = await Promise.all([
      getTaskFileCountMap(projectId, taskIds),
      taskIds.length > 0
        ? db
            .select({
              id: taskSubtasks.id,
              taskId: taskSubtasks.taskId,
              title: taskSubtasks.title,
              completed: taskSubtasks.completed,
              position: taskSubtasks.position,
              updatedAt: taskSubtasks.updatedAt,
            })
            .from(taskSubtasks)
            .where(inArray(taskSubtasks.taskId, taskIds))
            .orderBy(asc(taskSubtasks.position), asc(taskSubtasks.createdAt))
        : Promise.resolve([]),
      taskIds.length > 0
        ? db
            .select({
              taskId: taskNodeLinks.taskId,
              order: taskNodeLinks.order,
              annotation: taskNodeLinks.annotation,
              tags: taskNodeLinks.tags,
              nodeId: workspaceNodes.id,
              name: workspaceNodes.name,
              path: workspaceNodes.path,
              type: workspaceNodes.type,
              size: workspaceNodes.size,
              mimeType: workspaceNodes.mimeType,
              currentVersion: workspaceNodes.currentVersion,
              contentHash: fileVersions.contentHash,
              updatedAt: workspaceNodes.updatedAt,
            })
            .from(taskNodeLinks)
            .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
            .leftJoin(
              fileVersions,
              and(
                eq(fileVersions.nodeId, workspaceNodes.id),
                eq(fileVersions.version, workspaceNodes.currentVersion),
              ),
            )
            .where(
              and(
                inArray(taskNodeLinks.taskId, taskIds),
                eq(workspaceNodes.projectId, projectId),
                isNull(workspaceNodes.deletedAt),
                canReadFiles ? undefined : sql`NOT (${projectContentNodeSql})`,
                orgFileAccessSql(access),
              ),
            )
            .orderBy(asc(taskNodeLinks.order), asc(workspaceNodes.name))
        : Promise.resolve([]),
    ]);

    const subtasksByTask = new Map<
      string,
      Array<{
        id: string;
        index: number;
        title: string;
        completed: boolean;
        position: number;
        updatedAt: string;
      }>
    >();
    for (const st of subtaskRows) {
      const list = subtasksByTask.get(st.taskId) || [];
      list.push({
        id: st.id,
        index: list.length + 1,
        title: st.title,
        completed: st.completed,
        position: st.position,
        updatedAt: st.updatedAt.toISOString(),
      });
      subtasksByTask.set(st.taskId, list);
    }

    const filesByTask = new Map<
      string,
      Array<{
        id: string;
        nodeId: string;
        name: string;
        path: string;
        type: "file" | "folder";
        size: number | null;
        mimeType: string | null;
        currentVersion: number;
        contentHash?: string | null;
        role: "reference" | "working" | "deliverable";
        tags: string[];
        annotation: string | null;
        updatedAt: string;
      }>
    >();
    for (const f of attachedFileRows) {
      const list = filesByTask.get(f.taskId) || [];
      const role = inferTaskFileRole({
        id: f.nodeId,
        name: f.name,
        type: f.type,
        path: f.path,
        annotation: f.annotation,
        tags: f.tags,
      });
      list.push({
        id: f.nodeId,
        nodeId: f.nodeId,
        name: f.name,
        path: f.path,
        type: f.type,
        size: f.size,
        mimeType: f.mimeType,
        currentVersion: f.currentVersion,
        contentHash: f.contentHash || null,
        role,
        tags: f.tags || [],
        annotation: f.annotation,
        updatedAt: f.updatedAt?.toISOString?.() ?? String(f.updatedAt),
      });
      filesByTask.set(f.taskId, list);
    }

    const lastTask = page.at(-1);

    return jsonSuccessConditional(request, {
      projectId,
      tasks: page.map((task) => {
        const taskSubtaskList = subtasksByTask.get(task.id) || [];
        const completedSubtasks = taskSubtaskList.filter((s) => s.completed).length;
        const attachedFiles = filesByTask.get(task.id) || [];
        const fullDesc = task.description || null;
        return {
          id: task.id,
          title: task.title,
          description: fullDesc,
          descriptionPreview: fullDesc ? fullDesc.slice(0, 140) : null,
          status: task.status,
          priority: task.priority,
          storyPoints: task.storyPoints,
          kind: task.kind,
          ...(task.itemType !== "task" ? { type: task.itemType, stage: task.stage, onBoard: task.onBoard } : {}),
          sprintId: task.sprintId,
          sprintName: task.sprintName || null,
          reviewStatus: task.reviewStatus,
          assigneeId: task.assigneeId,
          assigneeName: task.assigneeName,
          assigneeUsername: task.assigneeUsername,
          assigneeAvatarUrl: task.assigneeAvatarUrl,
          dueDate: task.dueDate ? task.dueDate.toISOString() : null,
          taskNumber: task.taskNumber,
          subtasks: taskSubtaskList,
          subtaskSummary: {
            completed: completedSubtasks,
            total: taskSubtaskList.length,
          },
          files: attachedFiles,
          filesCount: fileCountMap.get(task.id) || attachedFiles.length,
          updatedAt: task.updatedAt.toISOString(),
        };
      }),
      totalCount: summary.taskCount,
      scope: parsed.data.scope,
      query: parsed.data.q,
      totalScope: "project",
      hasMore,
      nextCursor: hasMore && lastTask && f.sort === "updated" ? encodeCursor(lastTask) : null,
    });
  } catch (error) {
    logger.error(
      "[api/v1/extension/project-tasks] Failed to get project tasks",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError("Couldn’t get workspace tasks", 500, "INTERNAL_ERROR");
  }
}
