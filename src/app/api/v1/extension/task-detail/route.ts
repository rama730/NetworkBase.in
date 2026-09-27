import { requireAuthenticatedUser, jsonSuccess, jsonError } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { profiles, projectNodes, taskNodeLinks, taskPushes, } from "@/lib/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

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
      SELECT 
        t.id,
        t.project_id AS "projectId",
        t.title,
        t.task_number AS "taskNumber",
        p.owner_id AS "ownerId",
        p.visibility,
        p.status AS "projectStatus",
        pm.id AS "memberId"
      FROM tasks t
      JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
      LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ${user.id}::uuid
      WHERE t.id = ${taskId}::uuid AND t.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{
      id: string;
      projectId: string;
      title: string;
      taskNumber: number | null;
      ownerId: string;
      visibility: string;
      projectStatus: string;
      memberId: string | null;
    }>;

    const row = rows[0];
    if (!row) return jsonError("Task not found", 404, "NOT_FOUND");

    const isOwner = row.ownerId === user.id;
    const isMember = Boolean(row.memberId);
    const canRead = isOwner || isMember || row.visibility === "public";
    if (!canRead) return jsonError("Forbidden", 403, "FORBIDDEN");

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
    logger.error("[api/v1/extension/task-detail] Failed to get task detail", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(
      error instanceof Error ? error.message : "Failed to get task detail",
      500,
      "INTERNAL_ERROR",
    );
  }
}
