import { orgTaskReadFilter } from "@/lib/organizations/assignments";
import {
  requireAuthenticatedUser,
  jsonError,
} from "@/app/api/v1/_shared";
import { jsonSuccessConditional } from "@/app/api/v1/_conditional";
import { db } from "@/lib/db";
import { tasks, profiles } from "@/lib/db/schema";
import { canReadProjectTab, getProjectAccessById } from "@/lib/data/project-access";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { getProjectTaskSummary, getTaskFileCountMap } from "@/app/api/v1/extension/_project-counts";

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
      return jsonError("Invalid project task query", 400, "BAD_REQUEST");

    const cursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor && !cursor)
      return jsonError("Invalid task cursor", 400, "BAD_REQUEST");
    const { projectId, limit } = parsed.data;
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project)
      return jsonError("Project not found", 404, "NOT_FOUND");
    // Task data follows the project's Tasks visibility (AUTH-002).
    if (!canReadProjectTab(access, "tasks")) return jsonError("You don’t have access to this", 403, "FORBIDDEN");

    const cursorDate = cursor ? new Date(cursor.updatedAt) : null;
    const [taskRows, summary] = await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: sql<string | null>`SUBSTRING(${tasks.description} FROM 1 FOR 140)`,
          status: tasks.status,
          priority: tasks.priority,
          reviewStatus:tasks.reviewStatus,
          assigneeId:tasks.assigneeId,
          assigneeName:profiles.fullName,
          assigneeAvatarUrl:profiles.avatarUrl,
          dueDate:tasks.dueDate,
          taskNumber: tasks.taskNumber,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .leftJoin(profiles,eq(profiles.id,tasks.assigneeId))
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            // Organizations: the same read rule as the Tasks tab (decision 19).
            orgTaskReadFilter(access, user.id),
            parsed.data.scope === "mine" ? eq(tasks.assigneeId,user.id) : undefined,
            parsed.data.q ? sql`(${tasks.title} ILIKE ${'%' + parsed.data.q.replace(/[\%_]/g, c => '\\'+c) + '%'} OR ${tasks.taskNumber}::text = ${parsed.data.q.replace(/^.*-/, '')})` : undefined,
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
      getProjectTaskSummary(projectId),
    ]);

    const hasMore = taskRows.length > limit;
    const page = hasMore ? taskRows.slice(0, limit) : taskRows;
    const taskIds = page.map((task) => task.id);

    const fileCountMap = await getTaskFileCountMap(projectId, taskIds);
    const lastTask = page.at(-1);

    return jsonSuccessConditional(request, {
      projectId,
      tasks: page.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        reviewStatus:task.reviewStatus,assigneeId:task.assigneeId,assigneeName:task.assigneeName,assigneeAvatarUrl:task.assigneeAvatarUrl,dueDate:task.dueDate,
        taskNumber: task.taskNumber,
        filesCount: fileCountMap.get(task.id) || 0,
        updatedAt: task.updatedAt.toISOString(),
      })),
      totalCount: summary.taskCount,
      scope: parsed.data.scope,
      query:parsed.data.q,
      totalScope:"project",
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
    return jsonError("Couldn’t get project tasks", 500, "INTERNAL_ERROR");
  }
}
