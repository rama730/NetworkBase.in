import { orgTaskReadFilter } from "@/lib/organizations/assignments";
import { lockTaskForWrite, transitionTaskTx, afterTaskTransition } from "@/lib/projects/task-transition-service";
import "server-only";

import { type ProjectAccess, getProjectAccessById, canReadProjectTab, ProjectTabForbiddenError, getProjectAccessByIdentifier, assertProjectTabReadAccess } from "@/lib/data/project-access";
import { normalizeSearchQuery, containsLikePattern, escapeLikePattern, tokenizeSearchQuery } from "@/lib/search/query";
import { sql, eq, and, or, isNull, isNotNull, ilike, desc, inArray } from "drizzle-orm";
import { tasks, taskReadReceipts, projects, projectMembers, roleApplications, projectOpenRoles, projectSprints, projectWorkflowColumns, sprintTaskMemberships, taskActivityEvents, projectNodes, taskNodeLinks, taskSubtasks } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { db } from "@/lib/db";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";
import { createClient } from "@/lib/supabase/server";
import { isLooseUuid } from "@/lib/validations/uuid";
import { z } from "zod";
import { resolveProjectSocialLinks, PROJECT_LINK_PURPOSE_LABELS } from "@/lib/projects/social-links";
import { getCachedData, cacheData } from "@/lib/redis";
import { recordGlobalSearchMetric } from "@/lib/search/observability";
import { getViewerIdentityContext } from "@/lib/server/viewer-context";
import { createTaskSchema as baseCreateTaskSchema, taskSubtaskTitleSchema } from "@/lib/validations/task";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { requireProjectCapability, isProjectMemberEligibleFor } from "@/lib/projects/collaborator-lifecycle";
import { queueEmail, wakeEmailWorker } from "@/lib/email/outbox";
import { replaceTaskFileRoleTag } from "@/lib/projects/task-file-intelligence";
import { queueCounterRefreshBestEffort } from "@/lib/my-work/counter-buffer";
import { revalidatePath } from "next/cache";
import { actorNotificationSnapshot, enqueueProjectNotificationBestEffort } from "./common";


type TaskPaginationCursor = {
  createdAt: Date;
  id: string;
  rank?: number;
  position?: number;
};


function parseTaskPaginationCursor(
  cursor?: string,
): TaskPaginationCursor | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(cursor) as {
      createdAt?: unknown;
      id?: unknown;
      rank?: unknown;
      position?: unknown;
    };
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      const parsedDate = new Date(parsed.createdAt);
      if (!Number.isNaN(parsedDate.getTime())) {
        return {
          createdAt: parsedDate,
          id: parsed.id,
          rank: typeof parsed.rank === "number" ? parsed.rank : undefined,
          position:
            typeof parsed.position === "number" &&
            Number.isFinite(parsed.position)
              ? parsed.position
              : undefined,
        };
      }
    }
  } catch {
    // Backward compatibility: legacy cursor was a plain ISO timestamp string.
  }

  const legacyDate = new Date(cursor);
  if (Number.isNaN(legacyDate.getTime())) return null;
  return { createdAt: legacyDate, id: "" };
}


function encodeTaskPaginationCursor(cursor: TaskPaginationCursor): string {
  return JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
    rank: cursor.rank,
    position: cursor.position,
  });
}


// ============================================================================
// TASK & SPRINT ACTIONS (PHASE 8 OPTIMIZATION)
// ============================================================================

// --- Fetch Actions (Optimization) ---

async function fetchProjectTasksForActor(
  projectId: string,
  actorId: string | null,
  limit: number = 100,
  cursor?: string,
  scope: "all" | "backlog" | "sprint" | "review" = "all",
  search: string = "",
  authorizedAccess?: ProjectAccess,
  surface: "full" | "preview" = "full",
) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const normalizedScope =
    scope === "backlog" || scope === "sprint" || scope === "review" ? scope : "all";
  const normalizedSearch = normalizeSearchQuery(search);
  const searchPattern = normalizedSearch
    ? containsLikePattern(normalizedSearch)
    : null;
  const taskNumberMatch = normalizedSearch.match(/^(?:#|[a-z0-9]+-)?(\d+)$/i);
  const taskNumberSearch = taskNumberMatch ? Number(taskNumberMatch[1]) : null;
  const escapedSearch = escapeLikePattern(normalizedSearch);
  const titlePrefixPattern = `${escapedSearch}%`;
  const searchRankExpr = searchPattern
    ? sql<number>`CASE
            WHEN ${taskNumberSearch !== null ? sql`${tasks.taskNumber} = ${taskNumberSearch}` : sql`FALSE`} THEN 500
            WHEN lower(${tasks.title}) = ${normalizedSearch.toLowerCase()} THEN 400
            WHEN ${tasks.title} ILIKE ${titlePrefixPattern} THEN 300
            WHEN ${tasks.title} ILIKE ${searchPattern} THEN 200
            WHEN ${tasks.description} ILIKE ${searchPattern} THEN 100
            ELSE 0
        END`
    : null;
  const parsedCursor = parseTaskPaginationCursor(cursor);
  const cursorCreatedAtKey = parsedCursor?.createdAt.toISOString() ?? "head";
  const cursorIdKey = parsedCursor?.id || "none";

  if (normalizedSearch) {
    const searchRate = await consumeRateLimit(
      `project-task-search:${actorId ?? `anon:${projectId}`}`,
      90,
      60,
    );
    if (!searchRate.allowed) {
      return {
        success: false as const,
        code: "RATE_LIMITED" as const,
        retryAfterMs: 1_000,
        error: "Too many task searches. Wait and try again.",
      };
    }
  }

  return await runInFlightDeduped(
    `project:tasks:${projectId}:${actorId ?? "anon"}:${safeLimit}:${cursorCreatedAtKey}:${cursorIdKey}:${normalizedScope}:${normalizedSearch}:${surface}`,
    async () => {
      // Enforce read access server-side through the canonical project access policy.
      const access =
        authorizedAccess?.project?.id === projectId
          ? authorizedAccess
          : await getProjectAccessById(projectId, actorId);
      if (!access.project) throw new Error("Project not found");
      if (!canReadProjectTab(access, "tasks")) throw new ProjectTabForbiddenError("tasks");

      const projectTasks = await db.query.tasks.findMany({
        where: (t, { eq, and, or, lt, isNull, isNotNull, ilike }) => {
          const positionExpr = sql<number>`COALESCE(${t.position}, 0)`;
          let pageCursor;
          if (parsedCursor) {
            const createdAtCursor = or(
              lt(t.createdAt, parsedCursor.createdAt),
              and(
                eq(t.createdAt, parsedCursor.createdAt),
                lt(t.id, parsedCursor.id),
              ),
            );
            const positionCursor =
              parsedCursor.position === undefined
                ? createdAtCursor
                : or(
                    sql`${positionExpr} < ${parsedCursor.position}`,
                    and(
                      sql`${positionExpr} = ${parsedCursor.position}`,
                      createdAtCursor,
                    ),
                  );
            pageCursor =
              searchRankExpr && parsedCursor.rank !== undefined
                ? or(
                    sql`${searchRankExpr} < ${parsedCursor.rank}`,
                    and(
                      sql`${searchRankExpr} = ${parsedCursor.rank}`,
                      positionCursor,
                    ),
                  )
                : positionCursor;
          }
          return and(
            eq(t.projectId, projectId),
            isNull(t.deletedAt),
            searchPattern
              ? or(
                  ilike(t.title, searchPattern),
                  ilike(t.description, searchPattern),
                  taskNumberSearch !== null
                    ? eq(t.taskNumber, taskNumberSearch)
                    : undefined,
                )
              : undefined,
            pageCursor,
            // Organizations: members see the masters and their own (or team) copies (decision 19).
            orgTaskReadFilter(access, actorId, normalizedScope),
            normalizedScope === "review" ? eq(t.reviewStatus, "pending") : undefined,
            normalizedScope === "backlog"
              ? isNull(t.sprintId)
              : normalizedScope === "sprint"
                ? isNotNull(t.sprintId)
                : undefined,
          );
        },
        orderBy: (t, { desc }) =>
          searchRankExpr
            ? [
                desc(searchRankExpr),
                sql`COALESCE(${t.position}, 0) DESC`,
                desc(t.createdAt),
                desc(t.id),
              ]
            : [
                sql`COALESCE(${t.position}, 0) DESC`,
                desc(t.createdAt),
                desc(t.id),
              ],
        limit: safeLimit + 1,
        extras: {
          ...(searchRankExpr
            ? { searchRank: searchRankExpr.as("search_rank") }
            : {}),
        },
        columns: {
          id: true,
          projectId: true,
          sprintId: true,
          assigneeId: true,
          creatorId: true,
          workflowColumnId: true,
          title: true,
          assignmentId: true,
          teamName: true,
          description: surface === "full",
          status: true,
          reviewStatus: true,
        reviewSubmittedAt: true,
        completedAt: true,
          position: true,
          priority: true,
          taskNumber: true,
          storyPoints: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
        },
        with: {
          project: {
            columns: { key: true },
          },
          sprint: {
            columns: {
              id: true,
              name: true,
              status: true,
            },
          },
          assignee: {
            columns: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
          ...(surface === "preview"
            ? {}
            : {
                creator: {
                  columns: {
                    id: true,
                    fullName: true,
                    avatarUrl: true,
                  },
                },
              }),
        },
      });

      const hasMore = projectTasks.length > safeLimit;
      const limitedTasks = projectTasks.slice(0, safeLimit);
      const taskIds = limitedTasks.map((task) => task.id);
      const countRows = taskIds.length === 0 || surface === "preview"
        ? []
        : Array.from(await db.execute<{
            task_id: string;
            subtask_count: number;
            completed_subtask_count: number;
            new_subtask_count: number;
            file_count: number;
            new_file_count: number;
            comment_count: number;
            new_comment_count: number;
          }>(sql`
            WITH selected_tasks AS (
              SELECT task.id, task.created_at, ${actorId ? sql`receipt.last_read_at` : sql`NULL::timestamptz`} AS last_read_at
              FROM tasks task
              ${actorId ? sql`LEFT JOIN task_read_receipts receipt ON receipt.task_id = task.id AND receipt.user_id = ${actorId}::uuid` : sql``}
              WHERE task.id IN (${sql.join(taskIds.map((id) => sql`${id}::uuid`), sql`, `)})
            ), subtask_counts AS (
              SELECT subtask.task_id,
                     count(*)::int AS total,
                     count(*) FILTER (WHERE subtask.completed)::int AS completed,
                     count(*) FILTER (
                       WHERE ${actorId}::uuid IS NOT NULL
                         AND subtask.created_at > COALESCE(selected.last_read_at, selected.created_at)
                     )::int AS new_count
              FROM task_subtasks subtask
              JOIN selected_tasks selected ON selected.id = subtask.task_id
              GROUP BY subtask.task_id
            ), file_counts AS (
              SELECT link.task_id,
                     count(*)::int AS total,
                     count(*) FILTER (
                       WHERE ${actorId}::uuid IS NOT NULL
                         AND link.linked_at > COALESCE(selected.last_read_at, selected.created_at)
                     )::int AS new_count
              FROM task_node_links link
              JOIN selected_tasks selected ON selected.id = link.task_id
              JOIN project_nodes node ON node.id = link.node_id AND node.deleted_at IS NULL
              GROUP BY link.task_id
            ), comment_counts AS (
              SELECT comment.task_id,
                     count(*)::int AS total,
                     count(*) FILTER (
                       WHERE ${actorId}::uuid IS NOT NULL
                         AND comment.created_at > COALESCE(selected.last_read_at, selected.created_at)
                     )::int AS new_count
              FROM task_comments comment
              JOIN selected_tasks selected ON selected.id = comment.task_id
              WHERE comment.deleted_at IS NULL
              GROUP BY comment.task_id
            )
            SELECT selected.id AS task_id,
                   COALESCE(subtask.total, 0)::int AS subtask_count,
                   COALESCE(subtask.completed, 0)::int AS completed_subtask_count,
                   COALESCE(subtask.new_count, 0)::int AS new_subtask_count,
                   COALESCE(file.total, 0)::int AS file_count,
                   COALESCE(file.new_count, 0)::int AS new_file_count,
                   COALESCE(comment.total, 0)::int AS comment_count,
                   COALESCE(comment.new_count, 0)::int AS new_comment_count
            FROM selected_tasks selected
            LEFT JOIN subtask_counts subtask ON subtask.task_id = selected.id
            LEFT JOIN file_counts file ON file.task_id = selected.id
            LEFT JOIN comment_counts comment ON comment.task_id = selected.id
          `));
      const countsByTaskId = new Map(countRows.map((row) => [row.task_id, row]));
      // Assignment copies carry a "From" chip (report §16.5–16.6): the org for a group copy in a child project,
      // otherwise whoever assigned it.
      const parentOrgTitle = limitedTasks.some((task) => task.assignmentId)
        ? (await db.execute<{ title: string | null }>(sql`SELECT o.title FROM projects p JOIN projects o ON o.id = p.parent_id WHERE p.id = ${projectId}`))[0]?.title ?? null
        : null;
      const normalizedTasks = limitedTasks.map((task) => {
        const counts = countsByTaskId.get(task.id);
        return normalizeTaskSurfaceRecord({
          ...task,
          fromLabel: task.assignmentId ? parentOrgTitle ?? (task as { creator?: { fullName?: string | null } }).creator?.fullName ?? null : null,
          subtaskCount: Number(counts?.subtask_count ?? 0),
          completedSubtaskCount: Number(counts?.completed_subtask_count ?? 0),
          newSubtaskCount: Number(counts?.new_subtask_count ?? 0),
          fileCount: Number(counts?.file_count ?? 0),
          newFileCount: Number(counts?.new_file_count ?? 0),
          commentCount: Number(counts?.comment_count ?? 0),
          newCommentCount: Number(counts?.new_comment_count ?? 0),
        });
      });
      const nextCursor = hasMore
        ? encodeTaskPaginationCursor({
            createdAt: new Date(
              normalizedTasks[normalizedTasks.length - 1]!.createdAt ??
                new Date().toISOString(),
            ),
            id: normalizedTasks[normalizedTasks.length - 1]!.id,
            rank: searchRankExpr
              ? Number(
                  (
                    projectTasks[safeLimit - 1] as
                      | { searchRank?: number }
                      | undefined
                  )?.searchRank ?? 0,
                )
              : undefined,
            position: Number(
              normalizedTasks[normalizedTasks.length - 1]!.position ?? 0,
            ),
          })
        : undefined;

      return {
        success: true as const,
        tasks: normalizedTasks,
        nextCursor,
        hasMore,
      };
    },
  );
}


export async function markTaskAsReadAction(taskId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Sign in to continue" };
    if (!isLooseUuid(taskId)) return { success: false, error: "Task not found" };
    const [task] = await db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) return { success: false, error: "Task not found" };
    const access = await getProjectAccessById(task.projectId, user.id);
    if (!access.project || !canReadProjectTab(access, "tasks"))
      return { success: false, error: "Task not found" };

    await db
      .insert(taskReadReceipts)
      .values({ taskId, userId: user.id })
      .onConflictDoUpdate({
        target: [taskReadReceipts.taskId, taskReadReceipts.userId],
        set: { lastReadAt: sql`NOW()` },
      });

    return { success: true };
  } catch (error) {
    console.error("Failed to mark task as read:", error);
    return { success: false, error: "Couldn’t mark task as read" };
  }
}


export async function fetchProjectTasksAction(
  projectId: string,
  limit: number = 100,
  cursor?: string,
  scope: "all" | "backlog" | "sprint" | "review" = "all",
  search: string = "",
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return await fetchProjectTasksForActor(
      projectId,
      user?.id ?? null,
      limit,
      cursor,
      scope,
      search,
    );
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return { success: false as const, error: "Couldn’t fetch tasks" };
  }
}


const projectTaskPreviewInputSchema = z.object({
  slugOrId: z.string().trim().min(1).max(200),
  search: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(12).default(6),
});


export async function fetchProjectLinkPreviewsAction(input: {
  slugOrId: string;
  search: string;
  limit?: number;
}) {
  try {
    const parsed = projectTaskPreviewInputSchema.parse(input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const access = await getProjectAccessByIdentifier(parsed.slugOrId, actorId);
    if (!access.project) return { success: false as const, code: "NOT_FOUND" as const, error: "Project not found" };
    if (!access.canRead) return { success: false as const, code: "FORBIDDEN" as const, error: "You don’t have access to this" };

    const [project] = await db
      .select({ id: projects.id, externalLinks: projects.externalLinks, githubRepoUrl: projects.githubRepoUrl })
      .from(projects)
      .where(and(eq(projects.id, access.project.id), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) return { success: false as const, code: "NOT_FOUND" as const, error: "Project not found" };

    const query = parsed.search.toLocaleLowerCase();
    const canViewMemberLinks = access.isOwner || Boolean(access.memberRole);
    const links = resolveProjectSocialLinks(project.externalLinks, project.githubRepoUrl)
      .filter((link) => link.audience !== "members" || canViewMemberLinks)
      .filter((link) => [
        link.customLabel,
        link.platformLabel,
        link.accountLabel,
        PROJECT_LINK_PURPOSE_LABELS[link.purpose],
        link.serviceKey,
      ].some((value) => value?.toLocaleLowerCase().includes(query)))
      .slice(0, parsed.limit)
      .map((link) => ({
        id: link.id || link.canonicalKey,
        title: link.customLabel || link.platformLabel,
        subtitle: link.accountLabel,
        platform: link.serviceKey || link.platform,
        iconKey: link.iconKey,
        purpose: link.purpose,
        audience: link.audience,
        href: `/go/project/${encodeURIComponent(project.id)}/${encodeURIComponent(link.id || link.canonicalKey)}`,
      }));
    return { success: true as const, links };
  } catch (error) {
    return {
      success: false as const,
      code: error instanceof z.ZodError ? "VALIDATION" as const : "TRANSIENT" as const,
      error: "Couldn’t fetch project link previews",
    };
  }
}


export async function fetchProjectTaskPreviewsAction(input: {
  slugOrId: string;
  search: string;
  limit?: number;
}) {
  const startedAt = performance.now();
  let metricSearch = "";
  try {
    const parsed = projectTaskPreviewInputSchema.parse(input);
    metricSearch = parsed.search;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const access = await getProjectAccessByIdentifier(parsed.slugOrId, actorId);
    if (!access.project)
      return {
        success: false as const,
        code: "NOT_FOUND" as const,
        error: "Project not found",
      };
    if (!canReadProjectTab(access, "tasks"))
      return {
        success: false as const,
        code: "FORBIDDEN" as const,
        error: "You don’t have access to this",
      };
    const cacheKey = `search:preview:tasks:${actorId ?? "anon"}:${parsed.slugOrId}:${parsed.search.toLowerCase()}`;
    const cached = await getCachedData<any>(cacheKey);
    if (cached) {
      recordGlobalSearchMetric({
        domain: "project-tasks",
        scope: "all",
        outcome: cached.tasks.length > 0 ? "success" : "empty",
        durationMs: performance.now() - startedAt,
        resultCount: cached.tasks.length,
        queryLength: parsed.search.length,
        tokenCount: tokenizeSearchQuery(parsed.search).length,
      });
      return cached as Awaited<ReturnType<typeof fetchProjectTasksForActor>>;
    }
    const result = await fetchProjectTasksForActor(
      access.project.id,
      actorId,
      parsed.limit,
      undefined,
      "all",
      parsed.search,
      access,
      "preview",
    );
    recordGlobalSearchMetric({
      domain: "project-tasks",
      scope: "all",
      outcome: result.success
        ? result.tasks.length > 0
          ? "success"
          : "empty"
        : result.code === "RATE_LIMITED"
          ? "rate-limited"
          : "error",
      durationMs: performance.now() - startedAt,
      resultCount: result.success ? result.tasks.length : 0,
      queryLength: parsed.search.length,
      tokenCount: tokenizeSearchQuery(parsed.search).length,
    });
    if (result.success && result.tasks.length > 0) {
      await cacheData(cacheKey, result, 180);
    }
    return result;
  } catch (error) {
    if (metricSearch) {
      recordGlobalSearchMetric({
        domain: "project-tasks",
        scope: "all",
        outcome: "error",
        durationMs: performance.now() - startedAt,
        resultCount: 0,
        queryLength: metricSearch.length,
        tokenCount: tokenizeSearchQuery(metricSearch).length,
      });
    }
    console.error("Failed to fetch task previews:", error);
    const message = error instanceof Error ? error.message : "";
    const code =
      error instanceof z.ZodError
        ? ("VALIDATION" as const)
        : message === "You don’t have access to this"
          ? ("FORBIDDEN" as const)
          : message === "Project not found"
            ? ("NOT_FOUND" as const)
            : ("TRANSIENT" as const);
    return {
      success: false as const,
      code,
      error:
        code === "TRANSIENT"
          ? "Couldn’t fetch task previews"
          : code === "VALIDATION"
            ? "Invalid task preview request"
            : message,
    };
  }
}


export async function getProjectTaskDetailAction(
  projectId: string,
  taskId: string,
) {
  try {
    const viewerIdentity = await getViewerIdentityContext();
    const actorId = viewerIdentity.user?.id ?? null;
    const access = await assertProjectTabReadAccess(projectId, actorId, "tasks");

    const isUuid = isLooseUuid(taskId);
    let taskWhere;
    if (isUuid) {
      taskWhere = and(
        eq(tasks.id, taskId),
        eq(tasks.projectId, projectId),
        isNull(tasks.deletedAt),
      );
    } else {
      const dashIndex = taskId.lastIndexOf("-");
      if (dashIndex !== -1) {
        const taskNum = parseInt(taskId.slice(dashIndex + 1), 10);
        if (!isNaN(taskNum)) {
          taskWhere = and(
            eq(tasks.taskNumber, taskNum),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          );
        } else {
          taskWhere = and(
            eq(tasks.id, taskId),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          );
        }
      } else {
        taskWhere = and(
          eq(tasks.id, taskId),
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
        );
      }
    }

    const task = await db.query.tasks.findFirst({
      // Organizations: another member's copy reads as not found (decision 19).
      where: and(taskWhere, orgTaskReadFilter(access, actorId, "review")),
      extras: {
        subtaskCount:
          sql<number>`(SELECT count(*)::int FROM task_subtasks WHERE task_subtasks.task_id = ${tasks.id})`.as(
            "subtask_count",
          ),
        completedSubtaskCount:
          sql<number>`(SELECT count(*)::int FROM task_subtasks WHERE task_subtasks.task_id = ${tasks.id} AND task_subtasks.completed = true)`.as(
            "completed_subtask_count",
          ),
        fileCount:
          sql<number>`(SELECT count(*)::int FROM task_node_links JOIN project_nodes ON project_nodes.id = task_node_links.node_id WHERE task_node_links.task_id = ${tasks.id} AND project_nodes.deleted_at IS NULL)`.as(
            "file_count",
          ),
        commentCount:
          sql<number>`(SELECT count(*)::int FROM task_comments WHERE task_comments.task_id = ${tasks.id} AND task_comments.deleted_at IS NULL)`.as(
            "comment_count",
          ),
      },
      columns: {
        id: true,
        projectId: true,
        sprintId: true,
        assigneeId: true,
        creatorId: true,
        workflowColumnId: true,
        title: true,
        description: true,
        status: true,
        reviewStatus: true,
        reviewSubmittedAt: true,
        completedAt: true,
        position: true,
        priority: true,
        taskNumber: true,
        storyPoints: true,
        dueDate: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        project: {
          columns: { key: true, slug: true },
        },
        sprint: {
          columns: {
            id: true,
            name: true,
            status: true,
          },
        },
        assignee: {
          columns: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        creator: {
          columns: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!task) {
      return { success: false as const, error: "Task not found" };
    }

    return { success: true as const, task: normalizeTaskSurfaceRecord(task) };
  } catch (error) {
    console.error("Failed to fetch task detail:", error);
    return { success: false as const, error: "Couldn’t fetch task detail" };
  }
}


export async function getProjectMembersAction(
  projectId: string,
  limit: number = 20,
  cursor?: string,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const cursorKey = cursor ?? "head";

    return await runInFlightDeduped(
      `project:members:${projectId}:${actorId ?? "anon"}:${safeLimit}:${cursorKey}`,
      async () => {
        await assertProjectTabReadAccess(projectId, actorId, "dashboard");
        const whereConditions: any[] = [
          eq(projectMembers.projectId, projectId),
        ];
        // Outsiders see only people with "Show on my profile" on (report §20.8).
        const access = actorId ? await getProjectAccessById(projectId, actorId) : null;
        const inside = Boolean(access && (access.isOwner || access.isMember || access.isInheritedAdmin));
        if (!inside) whereConditions.push(eq(projectMembers.showOnProfile, true));

        if (cursor) {
          try {
            const decoded = Buffer.from(cursor, "base64").toString("utf-8");
            const [joinedAt, memberId] = decoded.split(":::");
            if (joinedAt && memberId) {
              whereConditions.push(
                sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`,
              );
            }
          } catch {
            // Ignore invalid cursor
          }
        }

        const membersResult = await db.query.projectMembers.findMany({
          where: and(...whereConditions),
          columns: {
            id: true,
            projectId: true,
            userId: true,
            role: true,
            joinedAt: true,
          },
          with: {
            user: {
              columns: {
                id: true,
                username: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: (members, { desc }) => [
            desc(members.joinedAt),
            desc(members.id),
          ],
          limit: safeLimit + 1,
        });

        const hasMore = membersResult.length > safeLimit;
        const slice = membersResult.slice(0, safeLimit);
        const last = slice[slice.length - 1];
        const nextCursor =
          hasMore && last
            ? Buffer.from(
                `${last.joinedAt.toISOString()}:::${last.id}`,
              ).toString("base64")
            : undefined;

        const members = slice
          .map((m) =>
            m.user
              ? {
                  ...m.user,
                  membershipRole: m.role,
                  joinedAt: m.joinedAt?.toISOString?.() || null,
                }
              : null,
          )
          .filter(Boolean);

        const memberIds = members.map((m: any) => m.id);
        const acceptedRoleRows =
          memberIds.length > 0
            ? await db
                .select({
                  applicantId: roleApplications.applicantId,
                  roleTitle: projectOpenRoles.title,
                  roleName: projectOpenRoles.role,
                })
                .from(roleApplications)
                .leftJoin(
                  projectOpenRoles,
                  eq(projectOpenRoles.id, roleApplications.roleId),
                )
                .where(
                  and(
                    eq(roleApplications.projectId, projectId),
                    eq(roleApplications.status, "accepted"),
                    inArray(roleApplications.applicantId, memberIds),
                  ),
                )
                .orderBy(desc(roleApplications.updatedAt))
            : [];

        const acceptedRoleByUser = new Map<string, string>();
        for (const row of acceptedRoleRows) {
          if (acceptedRoleByUser.has(row.applicantId)) continue;
          const label = row.roleTitle || row.roleName || "";
          if (label) acceptedRoleByUser.set(row.applicantId, label);
        }

        const membersWithRoleTitles = members.map((member: any) => ({
          ...member,
          projectRoleTitle: acceptedRoleByUser.get(member.id) || null,
        }));

        return {
          success: true as const,
          members: membersWithRoleTitles,
          hasMore,
          nextCursor,
        };
      },
    );
  } catch (error) {
    console.error("Failed to fetch project members:", error);
    return {
      success: false as const,
      error: "Couldn’t fetch project members",
    };
  }
}



const createTaskSchema = baseCreateTaskSchema.extend({
  subtasks: z
    .array(
      z.object({
        title: taskSubtaskTitleSchema,
        completed: z.boolean().default(false),
      }),
    )
    .max(100)
    .optional(),
  attachmentNodeIds: z.array(z.string().uuid()).max(100).optional(),
});


export async function createTaskAction(data: z.infer<typeof createTaskSchema>) {
  try {
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");

    const validated = createTaskSchema.parse(data);
    await requireProjectCapability(
      validated.projectId,
      user.id,
      "create_tasks",
    );
    if (validated.sprintId) {
      const sprintAccess = await getProjectAccessById(
        validated.projectId,
        user.id,
      );
      if (!sprintAccess.project) throw new Error("Project not found");
      if (!sprintAccess.isOwner) {
        throw new Error("Only the owner can add tasks to a sprint");
      }
    }

    if (validated.assigneeId) {
      await requireProjectCapability(
        validated.projectId,
        user.id,
        "assign_tasks",
      );
      const assigneeMember = await db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.projectId, validated.projectId),
          eq(projectMembers.userId, validated.assigneeId),
        ),
        columns: { id: true, role: true },
      });
      if (!assigneeMember) {
        throw new Error("Assignee must be a project member");
      }
      if (!isProjectMemberEligibleFor(assigneeMember.role, "assign")) {
        throw new Error("Assignee must be an assignable project member");
      }
    }

    const createdTask = await db.transaction(async (tx) => {
      // Lock row to ensure strictly monotonic task number under concurrent creates.
      const counterRows = await tx.execute<{ current_task_number: number }>(sql`
                SELECT current_task_number
                FROM ${projects}
                WHERE id = ${validated.projectId}
                FOR UPDATE
            `);
      const current = Array.from(counterRows)[0];
      if (!current) throw new Error("Project not found");

      if (validated.sprintId) {
        const sprintRows = await tx.execute<{ id: string; status: string }>(sql`
                    SELECT id, status FROM ${projectSprints}
                    WHERE id = ${validated.sprintId} AND project_id = ${validated.projectId}
                    FOR SHARE
                `);
        const sprint = Array.from(sprintRows)[0];
        if (!sprint) throw new Error("Sprint not found");
        if (sprint.status !== "planning" && sprint.status !== "active") {
          throw new Error(
            "Tasks can only be added to Planning or Active sprints",
          );
        }
      }

      const nextTaskNumber = Number(current.current_task_number || 0) + 1;
      await tx
        .update(projects)
        .set({ currentTaskNumber: nextTaskNumber })
        .where(eq(projects.id, validated.projectId));
      const defaultColumn = await tx.query.projectWorkflowColumns.findFirst({
        where: and(
          eq(projectWorkflowColumns.projectId, validated.projectId),
          eq(projectWorkflowColumns.status, validated.status === "done" ? "todo" : validated.status),
          eq(projectWorkflowColumns.isDefault, true),
        ),
        columns: { id: true },
      });
      if (!defaultColumn)
        throw new Error("Default workflow section is unavailable");

      const [newTask] = await tx
        .insert(tasks)
        .values({
          projectId: validated.projectId,
          title: validated.title.trim(),
          description: validated.description?.trim() || null,
          status: validated.status === "done" ? "todo" : validated.status,
          workflowColumnId: defaultColumn.id,
          // Top of its column (the board sorts position DESC) with room for drops between cards.
          position: sql`(SELECT COALESCE(MAX(position), 0) + 1024 FROM tasks WHERE workflow_column_id = ${defaultColumn.id} AND deleted_at IS NULL)`,
          priority: validated.priority,
          sprintId: validated.sprintId || null,
          timelineOriginSprintId: validated.sprintId || null,
          timelineOriginAt: validated.sprintId ? new Date() : null,
          assigneeId: validated.assigneeId || null,
          creatorId: user.id,
          storyPoints: validated.storyPoints,
          dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
          taskNumber: nextTaskNumber,
        })
        .returning({ id: tasks.id });

      if (!newTask) throw new Error("Couldn’t create task");

      if (validated.assigneeId && validated.assigneeId !== user.id) {
        await queueEmail(tx, {
          kind: "task_assignment", eventId: `${newTask.id}-created`,
          userId: validated.assigneeId, actorId: user.id,
          taskId: newTask.id, projectId: validated.projectId,
        });
      }

      if (validated.sprintId) {
        await tx.insert(sprintTaskMemberships).values({
          projectId: validated.projectId,
          sprintId: validated.sprintId,
          taskId: newTask.id,
          addedBy: user.id,
        });
      }

      // These events are the durable source for the sprint activity trail.
      // Keeping creation and assignment separate makes the thread explain the
      // actual work flow instead of inferring it from the task's current state.
      if (validated.sprintId) {
        await tx.insert(taskActivityEvents).values({
          taskId: newTask.id,
          projectId: validated.projectId,
          sprintId: validated.sprintId,
          actorId: user.id,
          eventType: "created",
          payload: {
            version: 1,
            sprintId: validated.sprintId,
            taskTitle: validated.title.trim(),
            taskNumber: nextTaskNumber,
            taskStatus: validated.status,
          },
        });

        if (validated.assigneeId) {
          await tx.insert(taskActivityEvents).values({
            taskId: newTask.id,
            projectId: validated.projectId,
            sprintId: validated.sprintId,
            actorId: user.id,
            eventType: "assigned",
            payload: {
              version: 1,
              sprintId: validated.sprintId,
              assigneeId: validated.assigneeId,
              taskTitle: validated.title.trim(),
              taskNumber: nextTaskNumber,
              taskStatus: validated.status,
            },
          });
        }
      }

      if (
        validated.attachmentNodeIds &&
        validated.attachmentNodeIds.length > 0
      ) {
        const uniqueAttachmentIds = [...new Set(validated.attachmentNodeIds)];
        const attachmentNodes = await tx.query.projectNodes.findMany({
          where: and(
            eq(projectNodes.projectId, validated.projectId),
            inArray(projectNodes.id, uniqueAttachmentIds),
            isNull(projectNodes.deletedAt),
          ),
          columns: { id: true },
        });
        if (attachmentNodes.length !== uniqueAttachmentIds.length) {
          throw new Error(
            "One or more attachments are invalid for this project",
          );
        }

        await tx
          .insert(taskNodeLinks)
          .values(
            uniqueAttachmentIds.map((nodeId) => ({
              taskId: newTask.id,
              nodeId,
              createdBy: user.id,
              annotation: "#initial_reference",
              tags: replaceTaskFileRoleTag([], "reference"),
            })),
          )
          .onConflictDoNothing({
            target: [taskNodeLinks.taskId, taskNodeLinks.nodeId],
          });
      }

      if (validated.subtasks && validated.subtasks.length > 0) {
        await tx.insert(taskSubtasks).values(
          validated.subtasks
            .filter((st) => st.title.trim().length > 0)
            .map((st, index) => ({
              taskId: newTask.id,
              title: st.title.trim(),
              completed: st.completed,
              position: index,
            })),
        );
      }

      const completion = validated.status === "done" ? await (async () => {
        const locked = await lockTaskForWrite(tx, newTask.id, user.id);
        const result = await transitionTaskTx(tx, locked, { taskId: newTask.id, userId: user.id, status: "done" });
        return { locked, result };
      })() : null;
      return { ...newTask, completion };
    });
    if (createdTask.completion) await afterTaskTransition(user, createdTask.completion.locked, createdTask.id, createdTask.completion.result);

    await wakeEmailWorker();
    await queueCounterRefreshBestEffort([validated.assigneeId ?? null]);

    const hydratedTask = await db.query.tasks.findFirst({
      where: eq(tasks.id, createdTask.id),
      columns: {
        id: true,
        projectId: true,
        sprintId: true,
        assigneeId: true,
        creatorId: true,
        workflowColumnId: true,
        title: true,
        description: true,
        status: true,
        reviewStatus: true,
        reviewSubmittedAt: true,
        completedAt: true,
        priority: true,
        taskNumber: true,
        storyPoints: true,
        dueDate: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        project: {
          columns: { key: true, slug: true },
        },
        sprint: {
          columns: {
            id: true,
            name: true,
            status: true,
          },
        },
        assignee: {
          columns: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        creator: {
          columns: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });
    if (!hydratedTask) {
      throw new Error("Couldn’t load created task");
    }

    // Note: We don't need to manually revalidate if we are using Realtime
    // But for fallback and initial load consistency:
    revalidatePath(`/projects/${validated.projectId}`);

    if (validated.assigneeId && validated.assigneeId !== user.id) {
      const actor = actorNotificationSnapshot(user);
      await enqueueProjectNotificationBestEffort(
        {
          projectId: validated.projectId,
          actorUserId: user.id,
          ...actor,
          eventKey: "tasks.created_assigned",
          assigneeId: validated.assigneeId,
          title: `${actor.actorName || "Someone"} assigned you a task`,
          body: hydratedTask.title,
          href: `/projects/${encodeURIComponent(hydratedTask.project?.slug || validated.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(hydratedTask.id)}`,
          entityRefs: {
            projectId: validated.projectId,
            projectSlug: hydratedTask.project?.slug ?? null,
            taskId: hydratedTask.id,
          },
          preview: {
            actorName: actor.actorName,
            actorAvatarUrl: actor.actorAvatarUrl,
            contextLabel:
              hydratedTask.project?.key && hydratedTask.taskNumber
                ? `${hydratedTask.project.key}-${hydratedTask.taskNumber}`
                : "Task",
            contextKind: "task",
            secondaryText: hydratedTask.title,
          },
          sourceEventId: `${hydratedTask.id}:created-assigned`,
        },
        {
          taskId: hydratedTask.id,
          targetUserId: validated.assigneeId,
        },
      );
    }

    return { success: true, task: normalizeTaskSurfaceRecord(hydratedTask) };
  } catch (error) {
    console.error("Failed to create task:", error);
    const message =
      error instanceof Error ? error.message : "Couldn’t create task";
    return {
      success: false,
      error: message.includes("Failed query:")
        ? "Couldn’t create task"
        : message,
    };
  }
}


export async function deleteTaskAction(taskId: string, projectId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to continue");

    // Access Check - Only project owner can delete tasks
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { ownerId: true, slug: true },
    });
    if (!project) throw new Error("Project not found");

    if (project.ownerId !== user.id) {
      throw new Error("Only the owner can delete tasks");
    }

    const deletedTask = await db.transaction(async (tx) => {
      const existingTask = await tx.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)),
        columns: {
          assigneeId: true,
          sprintId: true,
          title: true,
          taskNumber: true,
          status: true,
        },
      });

      if (!existingTask) {
        throw new Error("Task not found in this project");
      }

      // Soft-deleting a task must not strand its private working files behind
      // the hidden task workspace. Preserve them in one explicit recovery
      // folder, then detach their task ownership and links.
      const taskNodes = await tx.query.projectNodes.findMany({
        where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.taskId, taskId)),
        columns: { id: true, parentId: true, name: true, path: true, type: true },
      });
      if (taskNodes.length > 0) {
        const scopedIds = new Set(taskNodes.map((node) => node.id));
        const rootNodes = taskNodes.filter((node) => !node.parentId || !scopedIds.has(node.parentId));
        const recoveryName = `Recovered task files ${taskId.slice(0, 8)}`;
        let recoveryFolder = await tx.query.projectNodes.findFirst({
          where: and(eq(projectNodes.projectId, projectId), isNull(projectNodes.parentId), eq(projectNodes.name, recoveryName)),
          columns: { id: true, path: true },
        });
        if (!recoveryFolder) {
          const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId: null,
            type: "folder",
            name: recoveryName,
            path: `/${recoveryName}`,
            createdBy: user.id,
          }).returning({ id: projectNodes.id, path: projectNodes.path });
          recoveryFolder = created!;
        }
        if (rootNodes.length > 0) {
          await tx.update(projectNodes)
            .set({
              parentId: recoveryFolder.id,
              path: sql`CASE ${projectNodes.id} ${sql.join(rootNodes.map((node) => sql`WHEN ${node.id}::uuid THEN ${`${recoveryFolder!.path}/${node.name}`}`), sql` `)} END`,
              taskId: null,
              updatedAt: new Date(),
            })
            .where(inArray(projectNodes.id, rootNodes.map((node) => node.id)));
        }
        for (const node of rootNodes) {
          const nextPath = `${recoveryFolder.path}/${node.name}`;
          if (node.type === "folder") {
            await tx.execute(sql`
              UPDATE project_nodes
              SET task_id = NULL,
                  path = ${nextPath} || SUBSTRING(path FROM ${node.path.length + 1}),
                  updated_at = NOW()
              WHERE project_id = ${projectId}
                AND task_id = ${taskId}
                AND starts_with(path, ${`${node.path}/`})
            `);
          }
        }
        await tx.delete(taskNodeLinks).where(eq(taskNodeLinks.taskId, taskId));
      }

      await tx
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          ),
        );
      await tx.insert(taskActivityEvents).values({
        taskId,
        projectId,
        sprintId: existingTask.sprintId,
        actorId: user.id,
        eventType: "deleted",
        payload: {
          version: 1,
          taskTitle: existingTask.title,
          taskNumber: existingTask.taskNumber,
          taskStatus: existingTask.status,
        },
      });
      return existingTask;
    });

    await queueCounterRefreshBestEffort([deletedTask?.assigneeId ?? null]);

    const slugOrId = project.slug || projectId;
    revalidatePath(`/projects/${slugOrId}`);
    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to delete task:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Couldn’t delete task",
    };
  }
}
