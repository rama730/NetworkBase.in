import { requireAuthenticatedUser, jsonSuccess, jsonError, getRequestId } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { taskPushes, tasks, projectNodes } from "@/lib/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { getProjectAccessById } from "@/lib/data/project-access";
import { withIdempotentRoute } from "@/lib/security/idempotency";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { recordNodeEventsBatch } from "@/lib/files/internal-helpers";
import { validateCsrf } from "@/lib/security/csrf";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) {
      return authResult.response;
    }
    const user = authResult.user;
    if (!user) {
      return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    }

    const body = await request.json();
    const { taskId, projectId, files, message } = body;
    const taskAction = body.taskAction === "upload_to_task" ? "upload_to_task" : "replace_task_version";

    if (!taskId || !projectId || !Array.isArray(files)) {
      return jsonError("Missing taskId, projectId, or files", 400, "BAD_REQUEST");
    }

    // 1. Validate that the task exists
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.id, taskId), isNull(tasks.deletedAt)),
    });

    if (!task) {
      return jsonError("Task not found", 404, "NOT_FOUND");
    }
    if (task.projectId !== projectId) {
      return jsonError("Task does not belong to this project", 400, "BAD_REQUEST");
    }
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.canWrite) {
      return jsonError("Forbidden", 403, "FORBIDDEN");
    }

    return withIdempotentRoute(request, { namespace: "extension.task-push.post", scopeId: `${user.id}:${projectId}:${taskId}` }, async () => {
    const pushedFiles = files.map((file: any) => ({
      nodeId: typeof file?.nodeId === "string" ? file.nodeId : "",
      id: typeof file?.id === "string" ? file.id : "",
      name: typeof file?.name === "string" ? file.name : null,
      path: typeof file?.path === "string" ? file.path : null,
      status: typeof file?.status === "string" ? file.status : null,
      taskAction,
    }));

    const pushRow = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(taskPushes)
        .values({
          taskId,
          projectId,
          message: message || (taskAction === "upload_to_task" ? "Uploaded task files" : "Replaced task file versions"),
          filesCount: pushedFiles.length,
          pushedBy: user.id,
          filesJson: pushedFiles,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to record push entry");
      }

      const nodeIds = Array.from(new Set(pushedFiles.map((file) => file.nodeId).filter(Boolean)));
      if (nodeIds.length > 0) {
        await tx
          .update(projectNodes)
          .set({
            syncStatus: "merged",
            updatedAt: new Date(),
          })
          .where(and(inArray(projectNodes.id, nodeIds), eq(projectNodes.projectId, projectId)));
      }

      await recordNodeEventsBatch(
        projectId,
        user.id,
        nodeIds.length > 0 ? nodeIds : [null],
        "extension_task_push",
        {
          taskId,
          taskAction,
          filesCount: pushedFiles.length,
          nodeIds,
        },
        tx
      );

      return created;
    });

    const successData = {
      success: true,
      data: {
        pushId: pushRow.id,
        timestamp: pushRow.pushedAt.toISOString(),
        filesCount: pushRow.filesCount,
      },
    };
    return jsonSuccess(successData);
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/extension/task-push", fallback: "Failed to record task push" });
  }
}
