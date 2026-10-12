import { requireAuthenticatedUser, jsonSuccess, jsonError, getRequestId } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { db } from "@/lib/db";
import { profiles, projectNodes, taskNodeLinks, taskPushes, } from "@/lib/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { canReadProjectTab, getProjectAccessById } from "@/lib/data/project-access";
import { projectContentNodeSql } from "@/lib/files/internal-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId")?.trim();
    if (!taskId) return jsonError("Missing taskId", 400, "BAD_REQUEST");

    const rows = (await db.execute(sql`
      SELECT t.id, t.project_id AS "projectId", t.title, t.task_number AS "taskNumber"
      FROM tasks t
      WHERE t.id = ${taskId}::uuid AND t.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ id: string; projectId: string; title: string; taskNumber: number | null }>;

    const row = rows[0];
    if (!row) return jsonError("Task not found", 404, "NOT_FOUND");

    // Canonical rule: drafts/private for owners+members only, task data needs
    // Tasks visibility, linked project files also need Files (AUTH-002).
    const access = await getProjectAccessById(row.projectId, user.id);
    if (!canReadProjectTab(access, "tasks")) return jsonError("Forbidden", 403, "FORBIDDEN");
    const canReadFiles = canReadProjectTab(access, "files");

    const task = {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      taskNumber: row.taskNumber,
    };

    const [fileRows, pushRows] = await Promise.all([
      db
        .select({
          node: projectNodes,
        })
        .from(taskNodeLinks)
        .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
        .where(
          and(
            eq(taskNodeLinks.taskId, taskId),
            eq(projectNodes.projectId, task.projectId),
            isNull(projectNodes.deletedAt),
            canReadFiles ? undefined : sql`NOT (${projectContentNodeSql})`,
          ),
        )
        .orderBy(taskNodeLinks.order, projectNodes.name),
      db
        .select({
          id: taskPushes.id,
          message: taskPushes.message,
          filesCount: taskPushes.filesCount,
          pushedAt: taskPushes.pushedAt,
          filesJson: taskPushes.filesJson,
          pushedByName: profiles.fullName,
        })
        .from(taskPushes)
        .leftJoin(profiles, eq(taskPushes.pushedBy, profiles.id))
        .where(eq(taskPushes.taskId, taskId))
        .orderBy(desc(taskPushes.pushedAt))
        .limit(25),
    ]);

    return jsonSuccess({
      task: {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        taskNumber: task.taskNumber,
      },
      files: fileRows.map((row) => ({
        id: row.node.id,
        nodeId: row.node.id,
        name: row.node.name,
        type: row.node.type,
        path: row.node.path,
        s3Key: row.node.s3Key,
        size: row.node.size,
        mimeType: row.node.mimeType,
        currentVersion: row.node.currentVersion,
        syncStatus: row.node.syncStatus,
        linkedTasks: [{ id: taskId, title: task.title, taskNumber: task.taskNumber }],
        updatedAt: row.node.updatedAt?.toISOString?.() ?? row.node.updatedAt,
      })),
      pushes: pushRows.map((row) => ({
        id: row.id,
        message: row.message,
        filesCount: row.filesCount,
        pushedAt: row.pushedAt.toISOString(),
        files: row.filesJson,
        pushedByName: row.pushedByName || "Collaborator",
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/task-detail", fallback: "Failed to get task detail" });
  }
}
