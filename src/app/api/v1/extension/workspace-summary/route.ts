import {
  requireAuthenticatedUser,
  jsonError,
} from "@/app/api/v1/_shared";
import { jsonSuccessConditional } from "@/app/api/v1/_conditional";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { canReadProjectTab, getProjectAccessById } from "@/lib/data/workspace-access";
import { and, eq, isNull } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { getProjectTaskSummary, getTaskFileCountMap } from "@/app/api/v1/extension/_workspace-counts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  projectId: z.string().uuid(),
});

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthenticatedUser();
    if (authResult.response) return authResult.response;
    const user = authResult.user;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const parsed = querySchema.safeParse({
      projectId: new URL(request.url).searchParams.get("projectId")?.trim(),
    });
    if (!parsed.success)
      return jsonError("Invalid workspace id", 400, "BAD_REQUEST");

    const { projectId } = parsed.data;
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project)
      return jsonError("Workspace not found", 404, "NOT_FOUND");
    // Task data follows the project's Tasks visibility (AUTH-002).
    if (!canReadProjectTab(access, "tasks")) return jsonError("You don’t have access to this", 403, "FORBIDDEN");

    const summary = await getProjectTaskSummary(projectId);
    const taskCount = summary.taskCount;

    let associatedTaskPreview: {
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      taskNumber: number | null;
      filesCount: number;
    } | null = null;

    if (taskCount === 1) {
      const [task] = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          taskNumber: tasks.taskNumber,
        })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .limit(1);

      if (task) {
        const fileCounts = await getTaskFileCountMap(projectId, [task.id]);
        associatedTaskPreview = {
          ...task,
          filesCount: fileCounts.get(task.id) || 0,
        };
      }
    }

    const lastUpdated = summary.lastTaskUpdatedAt
      ? new Date(summary.lastTaskUpdatedAt).toISOString()
      : "none";
    const summaryVersion = `${taskCount}:${lastUpdated}`;

    return jsonSuccessConditional(request, { projectId, taskCount, associatedTaskPreview, summaryVersion });
  } catch (error) {
    logger.error(
      "[api/v1/extension/project-summary] Failed to get project summary",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return jsonError("Couldn’t get workspace summary", 500, "INTERNAL_ERROR");
  }
}
