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
});

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
    });
    if (!parsed.success)
      return jsonError("Invalid workspace task query", 400, "BAD_REQUEST");

    const cursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor)
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
          sprintId: tasks.sprintId,
          sprintName: workspaceSprints.name,
          reviewStatus: tasks.reviewStatus,
          assigneeId: tasks.assigneeId,
          assigneeName: profiles.fullName,
          assigneeUsername: profiles.username,
          assigneeAvatarUrl: profiles.avatarUrl,
          dueDate: tasks.dueDate,
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
            parsed.data.q
              ? sql`(${tasks.title} ILIKE ${"%" + parsed.data.q.replace(/[\%_]/g, (c) => "\\" + c) + "%"} OR ${tasks.taskNumber}::text = ${parsed.data.q.replace(/^.*[#-]/, "")})`
              : undefined,
            cursor && cursorDate
              ? or(
                  lt(tasks.updatedAt, cursorDate),
                  and(eq(tasks.updatedAt, cursorDate), lt(tasks.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(tasks.updatedAt), desc(tasks.id))
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
              updatedAt: workspaceNodes.updatedAt,
            })
            .from(taskNodeLinks)
            .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
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
      nextCursor: hasMore && lastTask ? encodeCursor(lastTask) : null,
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
