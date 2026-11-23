import { assignmentColumn, assignmentWriteContext, orgTaskReadFilter, readAssignmentStages, readCopyMoves, readMasterProgress } from "@/lib/organizations/assignments";
import { assignmentWriteBlock, type AssignmentTarget } from "@/lib/organizations/assignment-rules";
import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";
import { startingStages, typeFieldsSchema } from "@/lib/workflows/create-rules";
import { canBeParent, canBePartOf } from "@/lib/workflows/planner";
import { priorityForSeverity } from "@/lib/workflows/bugs";
import { defaultStageFor, isOnBoard, statusForStage } from "@/lib/workflows/rules";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";
import { orgCan, orgRoleOf } from "@/lib/organizations/permissions";
import { assignmentPeopleOf, notifyAssignmentRemoved } from "@/lib/organizations/assignment-notify";
import { logger } from "@/lib/logger";
import { readViewerOrgRole } from "@/lib/organizations/detail";
import { lockTaskForWrite, transitionTaskTx, afterTaskTransition } from "@/lib/workspaces/task-transition-service";
import "server-only";
import { runningSprint } from "@/lib/workspaces/sprint-plan";

type TaskListScope = "all" | "backlog" | "sprint" | "review" | "assignments" | "mine";
const LIST_SCOPES: TaskListScope[] = ["backlog", "sprint", "review", "assignments", "mine"];

import { type WorkspaceAccess, getWorkspaceAccessById, canReadWorkspaceTab, WorkspaceTabForbiddenError, getWorkspaceAccessByIdentifier, assertWorkspaceTabReadAccess } from "@/lib/data/workspace-access";
import { normalizeSearchQuery, containsLikePattern, escapeLikePattern, tokenizeSearchQuery } from "@/lib/search/query";
import { sql, eq, and, or, isNull, isNotNull, ilike, asc, desc, inArray, type SQL } from "drizzle-orm";
import { tasks, taskReadReceipts, workspaceDocuments, workspaceWorkflows, workspaces, workspaceMembers, roleApplications, workspaceOpenRoles, workspaceSprints, workspaceWorkflowColumns, sprintTaskMemberships, taskActivityEvents, workspaceNodes, taskNodeLinks, taskSubtasks } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { db } from "@/lib/db";
import { normalizeTaskSurfaceRecord } from "@/lib/workspaces/task-presentation";
import { createClient } from "@/lib/supabase/server";
import { isLooseUuid } from "@/lib/validations/uuid";
import { z } from "zod";
import { resolveWorkspaceSocialLinks, WORKSPACE_LINK_PURPOSE_LABELS } from "@/lib/workspaces/social-links";
import { getCachedData, cacheData } from "@/lib/redis";
import { recordGlobalSearchMetric } from "@/lib/search/observability";
import { getViewerIdentityContext } from "@/lib/server/viewer-context";
import { createTaskSchema as baseCreateTaskSchema, taskSubtaskTitleSchema } from "@/lib/validations/task";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { requireWorkspaceCapability, isWorkspaceMemberEligibleFor } from "@/lib/workspaces/collaborator-lifecycle";
import { queueEmail, wakeEmailWorker } from "@/lib/email/outbox";
import { replaceTaskFileRoleTag } from "@/lib/workspaces/task-file-intelligence";
import { queueCounterRefreshBestEffort } from "@/lib/my-work/counter-buffer";
import { revalidatePath } from "next/cache";
import { actorNotificationSnapshot, enqueueWorkspaceNotificationBestEffort } from "./common";
import { refusePeerAssignmentAcrossBlock } from "@/lib/workspaces/task-assignment";
import { viaColumns, viaPayload } from "@/lib/server/request-via";


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

/** One view's own rule — the list and the board's counts both use it (board view dropdown §5). */
function scopeWhere(scope: TaskListScope, actorId: string | null, sprintIds?: string[]): SQL | undefined {
  // Excused work leaves the queue (report §42.2 smaller bug 4). Live-fix 9: only a person's copy is reviewed.
  if (scope === "review") return and(eq(tasks.reviewStatus, "pending"), isNull(tasks.excusedAt), or(sql`${tasks.kind} IS DISTINCT FROM 'assignment'`, isNotNull(tasks.assignmentId)));
  // Live-fix 6: Assignments and Mine (yours, or your team's).
  if (scope === "assignments") return or(eq(tasks.kind, "assignment"), isNotNull(tasks.assignmentId));
  if (scope === "mine") return actorId ? or(eq(tasks.assigneeId, actorId), sql`EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${actorId})`) : sql`false`;
  if (scope === "backlog") return isNull(tasks.sprintId);
  if (scope === "sprint") return sprintIds ? (sprintIds.length ? inArray(tasks.sprintId, sprintIds) : sql`false`) : isNotNull(tasks.sprintId);
  return undefined;
}

/** open: not done (the menu's grey number); total: every card the view shows (Board N); needsYou: orange. */
export type BoardViewCount = { open: number; total: number; needsYou: number };
export type BoardCounts = Record<TaskListScope, BoardViewCount>;

/**
 * Open = not done; a main assignment is open until it's closed or everyone is done (its board column, decision 14).
 * Audit B10: which main assignments are finished is read once (one indexed aggregate per assignment) and passed in, so
 * the six counts don't each re-scan every assignment's copies (a correlated EXISTS the planner ran as a table scan).
 */
async function openSql(projectId: string, org: boolean) {
  if (!org) return sql`(${tasks.status} <> 'done')`;
  const finished = Array.from(await db.execute<{ id: string }>(sql`
    SELECT m.id FROM tasks m WHERE m.workspace_id = ${projectId}::uuid AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
      AND (m.assignment_settings->>'closedAt' IS NOT NULL OR coalesce((SELECT bool_and(c.status = 'done' AND c.review_status <> 'pending') FROM tasks c
        WHERE c.assignment_id = m.id AND c.deleted_at IS NULL AND c.excused_at IS NULL), false))`)).map((r) => r.id);
  const done = finished.length ? sql`${tasks.id} IN (${sql.join(finished.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`false`;
  return sql`(CASE WHEN ${tasks.kind} = 'assignment' AND ${tasks.assignmentId} IS NULL THEN NOT (${done}) ELSE ${tasks.status} <> 'done' END)`;
}

/**
 * Board view dropdown §3, §5: each view's open count and what needs the viewer now, in one statement, by the list's
 * own rules (`scopeWhere`, `orgTaskReadFilter`, the running sprint), so a number never promises cards a view doesn't show.
 * Orange: hand-ins waiting (people who review); your copies due within 2 days or missing; your own tasks due within
 * 2 days or overdue. The org Tasks tab badge reads the same numbers.
 */
export async function readBoardCounts(access: WorkspaceAccess, actorId: string | null): Promise<BoardCounts> {
  const projectId = access.project!.id;
  const org = access.project?.kind === "organization";
  const reviews = org ? access.isOwner || access.memberRole === "admin" : access.isOwner || access.memberRole === "admin" || access.memberRole === "owner";
  // The org board's Sprint is the running sprint: the sprint inside a CO, or the CO with its sprints (sprint-levels §6).
  let sprintIds: string[] | undefined;
  if (org) {
    const live = await db.select({ id: workspaceSprints.id, parentSprintId: workspaceSprints.parentSprintId, status: workspaceSprints.status, name: workspaceSprints.name })
      .from(workspaceSprints).where(and(eq(workspaceSprints.projectId, projectId), inArray(workspaceSprints.status, ["active", "planning"])));
    const running = runningSprint(live);
    sprintIds = !running ? undefined : running.parentSprintId && live.some((m) => m.id === running.parentSprintId) ? [running.id] : [running.id, ...live.filter((x) => x.parentSprintId === running.id).map((x) => x.id)];
  }
  // Audit B10: the viewer's team tasks are read once (uncorrelated IN), not checked per row across every copy.
  const OPEN = await openSql(projectId, org);
  const own = actorId ? sql`(${tasks.assigneeId} = ${actorId} OR ${tasks.id} IN (SELECT tm.task_id FROM task_team_members tm WHERE tm.user_id = ${actorId}))` : sql`false`;
  const notHandedIn = sql`(${tasks.status} <> 'done' AND ${tasks.reviewStatus} <> 'pending' AND ${tasks.submission} IS NULL AND ${tasks.excusedAt} IS NULL)`;
  const masterOpen = sql`EXISTS (SELECT 1 FROM tasks m WHERE m.id = ${tasks.assignmentId} AND m.deleted_at IS NULL AND m.assignment_settings->>'closedAt' IS NULL)`;
  const copyNeedsYou = sql`(${tasks.assignmentId} IS NOT NULL AND ${own} AND ${notHandedIn} AND ${masterOpen} AND ${tasks.dueDate} < now() + interval '2 days')`;
  const taskNeedsYou = sql`(${tasks.assignmentId} IS NULL AND ${own} AND ${tasks.status} <> 'done' AND ${tasks.reviewStatus} <> 'pending' AND ${tasks.dueDate} < now() + interval '2 days')`;
  const view = (scope: TaskListScope, extra?: SQL) => sql`count(*) FILTER (WHERE ${and(sql`true`, orgTaskReadFilter(access, actorId, scope), scopeWhere(scope, actorId, scope === "sprint" ? sprintIds : undefined), extra)})::int`;
  const [row] = await db.select({
    all: view("all", OPEN), sprint: view("sprint", OPEN), backlog: view("backlog", OPEN), review: view("review", OPEN), assignments: view("assignments", OPEN), mine: view("mine", OPEN),
    allTotal: view("all"), sprintTotal: view("sprint"), backlogTotal: view("backlog"), reviewTotal: view("review"), assignmentsTotal: view("assignments"), mineTotal: view("mine"),
    assignmentsNeed: sql<number>`count(*) FILTER (WHERE ${copyNeedsYou})::int`,
    mineNeed: view("mine", taskNeedsYou),
  // Audit N79: in an organization no count needs other people's copies (an admin's In review is the queue below),
  // so the scan skips them instead of filtering thousands of copy rows in every count.
  // Report 38.2: items at an off-board stage (a bug at New, a request at New) live in their own tab, not on the board.
  }).from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), eq(tasks.onBoard, true), org ? sql`(${tasks.assignmentId} IS NULL OR ${own})` : undefined));
  const n = (v: unknown) => Number(v ?? 0);
  // An organization admin's In review is the review queue (readReviewQueueAction): the hand-ins of this organization's
  // assignments wherever they were handed in (team workspaces' group work too), and its own tasks waiting.
  const queue = org && reviews ? Number((await db.execute<{ n: number }>(sql`
    SELECT (SELECT count(*)::int FROM tasks c JOIN tasks m ON m.id = c.assignment_id
            WHERE m.workspace_id = ${projectId} AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.review_status = 'pending')
         + (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${projectId} AND t.assignment_id IS NULL AND t.kind <> 'assignment' AND t.deleted_at IS NULL AND t.review_status = 'pending' AND t.excused_at IS NULL) AS n`))[0]?.n ?? 0) : null;
  return {
    all: { open: n(row?.all), total: n(row?.allTotal), needsYou: 0 },
    sprint: { open: n(row?.sprint), total: n(row?.sprintTotal), needsYou: 0 },
    backlog: { open: n(row?.backlog), total: n(row?.backlogTotal), needsYou: 0 },
    review: queue !== null ? { open: queue, total: queue, needsYou: queue } : { open: n(row?.review), total: n(row?.reviewTotal), needsYou: reviews ? n(row?.review) : 0 },
    assignments: { open: n(row?.assignments), total: n(row?.assignmentsTotal), needsYou: org ? n(row?.assignmentsNeed) : 0 },
    mine: { open: n(row?.mine), total: n(row?.mineTotal), needsYou: n(row?.mineNeed) },
  };
}

export async function readBoardCountsAction(projectId: string) {
  try {
    if (!isLooseUuid(projectId)) return { success: false as const, error: "Workspace not found" };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (!access.project || !canReadWorkspaceTab(access, "tasks")) return { success: false as const, error: "Workspace not found" };
    return { success: true as const, counts: await readBoardCounts(access, user?.id ?? null) };
  } catch (error) {
    console.error("Failed to count board views:", error);
    return { success: false as const, error: "Couldn’t count the board" };
  }
}

const calendarRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(["all", "backlog", "sprint", "review", "assignments", "mine"]).default("all"),
});

/**
 * Report 38.5 T1 W8 (plan A1.1): the Calendar's items: everything due in the visible days (a due date is a calendar day
 * at UTC midnight), plus open items with no date for the No date tray. Members only (B11: the public never sees
 * Calendar); the scope menu and the organization read rule apply as on the board. Off-board items show too (a bug at
 * New with a due date is still due that day).
 */
export async function readCalendarAction(projectId: string, input: unknown) {
  try {
    if (!isLooseUuid(projectId)) return { success: false as const, error: "Workspace not found" };
    const range = calendarRangeSchema.parse(input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const access = await getWorkspaceAccessById(projectId, actorId);
    if (!access.project || !(access.isOwner || access.isMember)) return { success: false as const, error: "Workspace not found" };
    const base = and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), orgTaskReadFilter(access, actorId, range.scope), scopeWhere(range.scope, actorId));
    const columns = { id: tasks.id, taskNumber: tasks.taskNumber, title: tasks.title, status: tasks.status, reviewStatus: tasks.reviewStatus, priority: tasks.priority,
      dueDate: tasks.dueDate, startDate: tasks.startDate, assigneeId: tasks.assigneeId, sprintId: tasks.sprintId, itemType: tasks.itemType, stage: tasks.stage, onBoard: tasks.onBoard };
    const [items, noDate, [noDateCount], [ws]] = await Promise.all([
      db.select(columns).from(tasks).where(and(base, sql`${tasks.dueDate} >= ${range.from}::date AND coalesce(${tasks.startDate}, ${tasks.dueDate}) < (${range.to}::date + 1)`)).orderBy(asc(tasks.dueDate), asc(tasks.taskNumber)).limit(500),
      db.select(columns).from(tasks).where(and(base, isNull(tasks.dueDate), sql`${tasks.status} <> 'done'`)).orderBy(desc(tasks.updatedAt)).limit(100),
      db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(base, isNull(tasks.dueDate), sql`${tasks.status} <> 'done'`)),
      db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1),
    ]);
    const shape = (r: (typeof items)[number]) => ({ ...r, dueDate: r.dueDate ? r.dueDate.toISOString() : null, startDate: r.startDate ? r.startDate.toISOString() : null, ...(r.itemType === "task" ? { itemType: undefined } : {}) });
    return { success: true as const, projectKey: ws?.key ?? null, items: items.map(shape), noDate: noDate.map(shape), noDateCount: noDateCount?.n ?? 0, canEdit: access.isOwner || (access.isMember && access.memberRole !== "viewer") };
  } catch (error) {
    console.error("Failed to read the calendar:", error);
    return { success: false as const, error: "Couldn’t load the calendar" };
  }
}

async function fetchProjectTasksForActor(
  projectId: string,
  actorId: string | null,
  limit: number = 100,
  cursor?: string,
  scope: TaskListScope = "all",
  search: string = "",
  authorizedAccess?: WorkspaceAccess,
  surface: "full" | "preview" = "full",
) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const normalizedScope: TaskListScope = LIST_SCOPES.includes(scope) ? scope : "all";
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
          : await getWorkspaceAccessById(projectId, actorId);
      if (!access.project) throw new Error("Workspace not found");
      if (!canReadWorkspaceTab(access, "tasks")) throw new WorkspaceTabForbiddenError("tasks");

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
            // Report 38.2: off-board stages live in their own tab.
            eq(t.onBoard, true),
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
            scopeWhere(normalizedScope, actorId),
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
          itemType: true,
          stage: true,
          partOfId: true,
          startDate: true,
          title: true,
          assignmentId: true,
          teamName: true,
          kind: true,
          assignmentSettings: true,
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
              JOIN workspace_nodes node ON node.id = link.node_id AND node.deleted_at IS NULL
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
        ? (await db.execute<{ title: string | null }>(sql`SELECT o.title FROM workspaces p JOIN workspaces o ON o.id = p.parent_id WHERE p.id = ${projectId}`))[0]?.title ?? null
        : null;
      // Assignment cards (decision 14, gap 24): their column and class progress come from the copies, in one query.
      const masters = limitedTasks.filter((task) => task.kind === "assignment" && !task.assignmentId);
      const progressByMaster = await readMasterProgress(masters.map((m) => m.id));
      // Board view dropdown §6a: the card's stages and a copy's own stage — the sprint list's read, so they match.
      const copyIds = limitedTasks.filter((t) => t.assignmentId).map((t) => t.id);
      const [{ stages: stagesByMaster, copies: stageByCopy }, { moves: moveByCopy, stuck: stuckByCopy }] = await Promise.all([
        readAssignmentStages(masters.map((m) => m.id), copyIds),
        // Assignment flow: why a copy moved, and what's in the way while it's Blocked.
        readCopyMoves(copyIds, actorId),
      ]);
      // Who a draft would go to (no copies yet): the organization's members, admins or child workspaces.
      const drafts = masters.filter((m) => !m.assignmentSettings?.publishedAt);
      const [sizes] = drafts.length ? await db.execute<{ members: number; admins: number; children: number }>(sql`
        SELECT (SELECT count(*)::int FROM workspace_members WHERE workspace_id = ${projectId} AND role = 'member') AS members,
               (SELECT count(*)::int FROM workspace_members WHERE workspace_id = ${projectId} AND role IN ('owner', 'admin')) AS admins,
               (SELECT count(*)::int FROM workspaces WHERE parent_id = ${projectId} AND deleted_at IS NULL AND status <> 'archived') AS children`) : [];
      const audienceOf = (task: (typeof masters)[number]) => {
        const target = (task.assignmentSettings as { target?: AssignmentTarget } | null)?.target ?? { mode: "everyone" as const };
        const st = stagesByMaster.get(task.id);
        const copies = st ? st.total + st.counts.excused : null;
        const planned = target.mode === "people" ? target.userIds.length : target.mode === "teams" ? target.teams.length + target.individuals.length
          : target.mode === "children" ? target.projectIds.length : target.mode === "each_child" ? Number(sizes?.children ?? 0)
            : target.mode === "role" ? Number(sizes?.admins ?? 0) : Number(sizes?.members ?? 0);
        return { mode: target.mode, count: copies ?? planned };
      };
      const defaultColumns = masters.length === 0 ? new Map<string, string>() : new Map((await db.execute<{ status: string; id: string }>(sql`
        SELECT DISTINCT ON (status) status, id FROM workspace_workflow_columns WHERE workspace_id = ${projectId} AND is_default ORDER BY status, position`)).map((r) => [r.status, r.id]));
      // Report 38.5 S9 (A1.3): the project each card is Part of, for its chip.
      const parentIds = [...new Set(limitedTasks.map((t) => t.partOfId).filter((id): id is string => Boolean(id)))];
      const parents = new Map(parentIds.length ? (await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(inArray(tasks.id, parentIds), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))).map((r) => [r.id, r.title]) : []);
      const normalizedTasks = limitedTasks.map((task) => {
        const counts = countsByTaskId.get(task.id);
        const isMaster = task.kind === "assignment" && !task.assignmentId;
        const p = isMaster ? progressByMaster.get(task.id) : undefined;
        const progress = isMaster ? { draft: !task.assignmentSettings?.publishedAt, closed: Boolean(task.assignmentSettings?.closedAt), closedAt: task.assignmentSettings?.closedAt ?? null, done: Number(p?.done ?? 0), total: Number(p?.total ?? 0), toReview: Number(p?.to_review ?? 0), excused: Number(p?.excused ?? 0), stuck: Number(p?.stuck ?? 0),
          // Mockup task 4: group work reads Groups on its card.
          teams: ['teams', 'each_child', 'children'].includes(String((task.assignmentSettings as { target?: { mode?: string } } | null)?.target?.mode ?? '')) } : null;
        const column = progress ? assignmentColumn({ ...progress, started: Number(p?.started ?? 0) }) : null;
        const { assignmentSettings: _settings, ...rest } = task;
        return normalizeTaskSurfaceRecord({
          ...rest,
          ...(column ? { status: column, workflowColumnId: defaultColumns.get(column) ?? task.workflowColumnId } : {}),
          assignmentProgress: progress,
          assignmentStages: isMaster ? stagesByMaster.get(task.id) ?? null : null,
          copyStage: task.assignmentId ? stageByCopy.get(task.id) ?? null : null,
          lastMove: task.assignmentId ? moveByCopy.get(task.id) ?? null : null,
          stuckNote: task.assignmentId ? stuckByCopy.get(task.id) ?? null : null,
          audience: isMaster ? audienceOf(task) : null,
          publishAt: isMaster && !task.assignmentSettings?.publishedAt ? task.assignmentSettings?.publishAt ?? null : null,
          fromLabel: task.assignmentId ? parentOrgTitle ?? (task as { creator?: { fullName?: string | null } }).creator?.fullName ?? null : null,
          subtaskCount: Number(counts?.subtask_count ?? 0),
          completedSubtaskCount: Number(counts?.completed_subtask_count ?? 0),
          newSubtaskCount: Number(counts?.new_subtask_count ?? 0),
          partOf: task.partOfId && parents.has(task.partOfId) ? { id: task.partOfId, title: parents.get(task.partOfId)! } : null,
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
    const access = await getWorkspaceAccessById(task.projectId, user.id);
    if (!access.project || !canReadWorkspaceTab(access, "tasks"))
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


export async function fetchWorkspaceTasksAction(
  projectId: string,
  limit: number = 100,
  cursor?: string,
  scope: TaskListScope = "all",
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


export async function fetchWorkspaceLinkPreviewsAction(input: {
  slugOrId: string;
  search: string;
  limit?: number;
}) {
  try {
    const parsed = projectTaskPreviewInputSchema.parse(input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const access = await getWorkspaceAccessByIdentifier(parsed.slugOrId, actorId);
    if (!access.project) return { success: false as const, code: "NOT_FOUND" as const, error: "Workspace not found" };
    if (!access.canRead) return { success: false as const, code: "FORBIDDEN" as const, error: "You don’t have access to this" };

    const [project] = await db
      .select({ id: workspaces.id, externalLinks: workspaces.externalLinks, githubRepoUrl: workspaces.githubRepoUrl })
      .from(workspaces)
      .where(and(eq(workspaces.id, access.project.id), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!project) return { success: false as const, code: "NOT_FOUND" as const, error: "Workspace not found" };

    const query = parsed.search.toLocaleLowerCase();
    const canViewMemberLinks = access.isOwner || Boolean(access.memberRole);
    const links = resolveWorkspaceSocialLinks(project.externalLinks, project.githubRepoUrl)
      .filter((link) => link.audience !== "members" || canViewMemberLinks)
      .filter((link) => [
        link.customLabel,
        link.platformLabel,
        link.accountLabel,
        WORKSPACE_LINK_PURPOSE_LABELS[link.purpose],
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
      error: "Couldn’t fetch workspace link previews",
    };
  }
}


export async function fetchWorkspaceTaskPreviewsAction(input: {
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
    const access = await getWorkspaceAccessByIdentifier(parsed.slugOrId, actorId);
    if (!access.project)
      return {
        success: false as const,
        code: "NOT_FOUND" as const,
        error: "Workspace not found",
      };
    if (!canReadWorkspaceTab(access, "tasks"))
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
          : message === "Workspace not found"
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


export async function getWorkspaceTaskDetailAction(
  projectId: string,
  taskId: string,
) {
  try {
    const viewerIdentity = await getViewerIdentityContext();
    const actorId = viewerIdentity.user?.id ?? null;
    const access = await assertWorkspaceTabReadAccess(projectId, actorId, "tasks");

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
          sql<number>`(SELECT count(*)::int FROM task_node_links JOIN workspace_nodes ON workspace_nodes.id = task_node_links.node_id WHERE task_node_links.task_id = ${tasks.id} AND workspace_nodes.deleted_at IS NULL)`.as(
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
        onBoard: true,
        itemType: true,
        stage: true,
        partOfId: true,
        startDate: true,
        sourceDocId: true,
        sourceBlock: true,
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
        // The panel tells a main assignment from its copies (problem 8).
        kind: true,
        assignmentId: true,
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

    // Report 38.3 S6: the document and list a row came from, for the panel's "From" line.
    const [source] = task.sourceDocId
      ? await db.select({ slug: workspaceDocuments.slug, filename: workspaceDocuments.filename }).from(workspaceDocuments)
          .where(and(eq(workspaceDocuments.id, task.sourceDocId), eq(workspaceDocuments.projectId, projectId))).limit(1)
      : [];
    return { success: true as const, task: normalizeTaskSurfaceRecord({ ...task, source: source ? { docSlug: source.slug, docTitle: source.filename.replace(/\.md$/i, ""), block: task.sourceBlock } : null }) };
  } catch (error) {
    console.error("Failed to fetch task detail:", error);
    return { success: false as const, error: "Couldn’t fetch task detail" };
  }
}


export async function getWorkspaceMembersAction(
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
        await assertWorkspaceTabReadAccess(projectId, actorId, "dashboard");
        const whereConditions: any[] = [
          eq(workspaceMembers.projectId, projectId),
        ];
        // Outsiders see only people with "Show on my profile" on (report §20.8).
        const access = actorId ? await getWorkspaceAccessById(projectId, actorId) : null;
        const inside = Boolean(access && (access.isOwner || access.isMember || access.isInheritedAdmin));
        if (!inside) whereConditions.push(eq(workspaceMembers.showOnProfile, true));

        if (cursor) {
          try {
            const decoded = Buffer.from(cursor, "base64").toString("utf-8");
            const [joinedAt, memberId] = decoded.split(":::");
            if (joinedAt && memberId) {
              whereConditions.push(
                sql`(${workspaceMembers.joinedAt}, ${workspaceMembers.id}) < (${new Date(joinedAt)}, ${memberId})`,
              );
            }
          } catch {
            // Ignore invalid cursor
          }
        }

        const membersResult = await db.query.workspaceMembers.findMany({
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
                  roleTitle: workspaceOpenRoles.title,
                  roleName: workspaceOpenRoles.role,
                })
                .from(roleApplications)
                .leftJoin(
                  workspaceOpenRoles,
                  eq(workspaceOpenRoles.id, roleApplications.roleId),
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
      error: "Couldn’t fetch workspace members",
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
  // Report 38.4 part 6: one create for every type (F1); a plain task leaves these out.
  itemType: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  stage: z.string().regex(/^[a-z_]{1,40}$/).nullable().optional(),
  typeFields: z.record(z.string(), z.unknown()).optional(),
  // Report 38.5 T1 (A1.3): a start date and the project this is Part of.
  startDate: z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)), "Pick a valid start date").nullish(),
  partOfId: z.string().uuid().nullish(),
});

const orList = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : words[0] ?? "");

/**
 * Report 38.4 part 6, in order: the type's workflow is added and not hidden (F1); the stage is one people may start at;
 * the fields are the type's. A hidden type says so, so the module can offer Create as task (W8).
 */
async function checkNewItemType(projectId: string, userId: string, type: string, stage: string | null, fields: Record<string, unknown>) {
  const t = WORKFLOW_TYPES[type];
  if (!t) return { error: `There’s no “${type}” type. Use one of: ${Object.keys(WORKFLOW_TYPES).join(", ")}` } as const;
  const entry = WORKFLOW_CATALOG.find((w) => w.types.includes(type));
  const name = entry?.name ?? t.label;
  const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
  if (!entry || !(await readWorkspaceWorkflows(projectId, userId)).added.some((w) => w.workflow === entry.id)) {
    const [hidden] = entry ? await db.select({ id: workspaceWorkflows.id }).from(workspaceWorkflows)
      .where(and(eq(workspaceWorkflows.workspaceId, projectId), eq(workspaceWorkflows.workflow, entry.id), isNotNull(workspaceWorkflows.hiddenAt))).limit(1) : [];
    return hidden ? { error: `${name} was removed from this workspace`, code: "type_removed" } as const : { error: `${name} isn’t in this workspace` } as const;
  }
  const starts = startingStages(type);
  const chosen = stage ?? defaultStageFor(type, "tasks");
  if (!chosen || !starts.some((s) => s.key === chosen)) return { error: `A new ${t.label.toLowerCase()} starts at ${orList(starts.map((s) => s.label))}` } as const;
  const parsed = typeFieldsSchema(type).safeParse(fields);
  if (!parsed.success) {
    const unknown = parsed.error.issues.flatMap((i) => ("keys" in i ? (i.keys as string[]) : []));
    if (!unknown.length) return { error: `Check the ${t.label.toLowerCase()}’s ${parsed.error.issues[0]?.path.join(" ") || "details"}` } as const;
    return { error: `${t.label} has no field ${unknown.map((k) => `“${k}”`).join(", ")}` } as const;
  }
  return { stage: chosen, fields: parsed.data } as const;
}


/** Report 38.7 (A2.4): the request's type (an active one; the first when left out), its answers, and its files here. */
async function checkRequestAnswers(projectId: string, fields: Record<string, unknown>) {
  const { readRequestTypes } = await import("@/lib/workflows/request-store");
  const { activeTypes, validateAnswers } = await import("@/lib/workflows/requests");
  const active = activeTypes(await readRequestTypes(projectId));
  const type = fields.requestTypeId ? active.find((t) => t.id === fields.requestTypeId) : active[0];
  if (!type) return { error: fields.requestTypeId ? "That request type isn’t available" : "Add a request type first" } as const;
  const answers = (fields.answers ?? {}) as Record<string, unknown>;
  const wrong = validateAnswers(type, answers);
  if (wrong) return { error: wrong } as const;
  const files = type.questions.filter((q) => q.kind === "file").flatMap((q) => (Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : []));
  if (files.length) {
    const [found] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceNodes)
      .where(and(eq(workspaceNodes.projectId, projectId), inArray(workspaceNodes.id, files), isNull(workspaceNodes.deletedAt)));
    if ((found?.n ?? 0) !== new Set(files).size) return { error: "Attach files from this workspace" } as const;
  }
  return { fields: { ...fields, requestTypeId: type.id, answers }, triagerIds: type.triagerIds } as const;
}

export async function createTaskAction(data: z.infer<typeof createTaskSchema>) {
  try {
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");

    const validated = createTaskSchema.parse(data);
    // Report 38.6 layer 10 (A2.1): members and viewers report bugs (at New); viewers do nothing else here, so what
    // only a member could set is dropped. Everything else keeps the create_tasks check.
    // Only an explicit New: with no stage a bug from Tasks starts at Fixing, which needs create rights (security review).
    // Report 38.7 call 7 (A2.4): asking a request at New is the same: members and viewers ask (a viewer keeps Need by).
    const bugReport = (validated.itemType === "bug" || validated.itemType === "request") && validated.stage === "new";
    const reporterAccess = bugReport ? await getWorkspaceAccessById(validated.projectId, user.id) : null;
    if (reporterAccess?.project?.kind === "workspace" && (reporterAccess.isOwner || reporterAccess.isMember)) {
      if (reporterAccess.memberRole === "viewer") Object.assign(validated, { assigneeId: null, sprintId: null, partOfId: null, startDate: null, ...(validated.itemType === "bug" ? { dueDate: null } : {}) });
    } else {
      await requireWorkspaceCapability(
        validated.projectId,
        user.id,
        "create_tasks",
      );
    }
    const access = reporterAccess ?? await getWorkspaceAccessById(validated.projectId, user.id);
    if (!access.project) throw new Error("Workspace not found");
    const ownerOrAdmin = access.isOwner || access.memberRole === "admin";
    // Decision 87: an organization's board takes tasks from the roles create_org_tasks allows (owners and admins).
    if (access.project.kind === "organization" && !orgCan(orgRoleOf(access.memberRole, access.isOwner), "create_org_tasks")) {
      throw new Error("Only owners and admins add tasks here.");
    }
    const itemType = validated.itemType ?? "task";
    let stage: string | null = null;
    let typeFields: Record<string, unknown> = {};
    let requestTriagers: string[] = [];
    if (itemType !== "task") {
      const placed = await checkNewItemType(validated.projectId, user.id, itemType, validated.stage ?? null, validated.typeFields ?? {});
      if ("error" in placed) return { success: false, error: placed.error, ...("code" in placed ? { code: placed.code } : {}) };
      stage = placed.stage;
      typeFields = placed.fields;
      // Report 38.7 (A2.4): a request names an active type (the first one when left out) and answers its questions.
      if (itemType === "request") {
        const asked = await checkRequestAnswers(validated.projectId, typeFields);
        if ("error" in asked) return { success: false, error: asked.error };
        typeFields = asked.fields;
        requestTriagers = asked.triagerIds;
      }
      // Report 38.6 call 3 (A2.1): a bug's severity sets its priority; Not sure leaves it.
      if (itemType === "bug") validated.priority = (priorityForSeverity(typeFields.severity as never) ?? validated.priority) as typeof validated.priority;
      // The stage sets the status; a sprint only means something on the board.
      validated.status = statusForStage(itemType, stage);
      if (!isOnBoard(itemType, stage)) validated.sprintId = null;
    }
    const onBoard = itemType === "task" || isOnBoard(itemType, stage);
    // Report 38.5 part 5: start never after due; Part of only into a project here, and projects don't nest.
    if (validated.startDate && validated.dueDate && Date.parse(validated.startDate) > Date.parse(validated.dueDate)) {
      return { success: false, error: "The start date is after the due date" };
    }
    if (validated.partOfId) {
      if (access.project.kind === "organization") return { success: false, error: "Projects aren’t available in organizations" };
      if (!canBePartOf(itemType)) return { success: false, error: "A project can’t be Part of another project" };
      const [parent] = await db.select({ itemType: tasks.itemType }).from(tasks)
        .where(and(eq(tasks.id, validated.partOfId), eq(tasks.projectId, validated.projectId), isNull(tasks.deletedAt))).limit(1);
      if (!parent || !canBeParent(parent.itemType)) return { success: false, error: "Part of must be a project in this workspace" };
    }
    // Decision 146 and report 38.4 call 3: owners and admins plan sprints; a member's pick goes to the Backlog instead.
    let backlogged = false;
    if (validated.sprintId && !ownerOrAdmin) {
      validated.sprintId = null;
      backlogged = true;
    }

    if (validated.assigneeId) {
      await requireWorkspaceCapability(
        validated.projectId,
        user.id,
        "assign_tasks",
      );
      const assigneeMember = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.projectId, validated.projectId),
          eq(workspaceMembers.userId, validated.assigneeId),
        ),
        columns: { id: true, role: true, completedAt: true },
      });
      if (!assigneeMember) {
        throw new Error("Assignee must be a workspace member");
      }
      // Member settings §3 (the database refuses it too, 0114).
      if (assigneeMember.completedAt) {
        throw new Error("This person has completed their part here, so they can't be given new tasks");
      }
      if (!isWorkspaceMemberEligibleFor(assigneeMember.role, "assign")) {
        throw new Error("Assignee must be an assignable workspace member");
      }
      await refusePeerAssignmentAcrossBlock(db, validated.projectId, user.id, validated.assigneeId);
    }

    const via = await viaColumns();
    const createdTask = await db.transaction(async (tx) => {
      // Lock row to ensure strictly monotonic task number under concurrent creates.
      const counterRows = await tx.execute<{ current_task_number: number }>(sql`
                SELECT current_task_number
                FROM ${workspaces}
                WHERE id = ${validated.projectId}
                FOR NO KEY UPDATE
            `);
      // Audit lock map: NO KEY UPDATE still serializes the counter, but lets other rows that reference this workspace
      // (new tasks, files, members) be written meanwhile.
      const current = Array.from(counterRows)[0];
      if (!current) throw new Error("Workspace not found");

      if (validated.sprintId) {
        const sprintRows = await tx.execute<{ id: string; status: string }>(sql`
                    SELECT id, status FROM ${workspaceSprints}
                    WHERE id = ${validated.sprintId} AND workspace_id = ${validated.projectId}
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
        .update(workspaces)
        .set({ currentTaskNumber: nextTaskNumber })
        .where(eq(workspaces.id, validated.projectId));
      const defaultColumn = await tx.query.workspaceWorkflowColumns.findFirst({
        where: and(
          eq(workspaceWorkflowColumns.projectId, validated.projectId),
          eq(workspaceWorkflowColumns.status, validated.status === "done" ? "todo" : validated.status),
          eq(workspaceWorkflowColumns.isDefault, true),
        ),
        columns: { id: true },
      });
      if (!defaultColumn)
        throw new Error("Default workflow section is unavailable");

      const [newTask] = await tx
        .insert(tasks)
        .values({
          ...via,
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
          ...(validated.startDate ? { startDate: new Date(validated.startDate) } : {}),
          ...(validated.partOfId ? { partOfId: validated.partOfId } : {}),
          taskNumber: nextTaskNumber,
          ...(itemType !== "task" ? { itemType, stage, typeFields, onBoard } : {}),
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
          payload: { ...(await viaPayload()),
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
            payload: { ...(await viaPayload()),
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
        const attachmentNodes = await tx.query.workspaceNodes.findMany({
          where: and(
            eq(workspaceNodes.projectId, validated.projectId),
            inArray(workspaceNodes.id, uniqueAttachmentIds),
            isNull(workspaceNodes.deletedAt),
          ),
          columns: { id: true },
        });
        if (attachmentNodes.length !== uniqueAttachmentIds.length) {
          throw new Error(
            "One or more attachments are invalid for this workspace",
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
              ...via,
              createdBy: user.id,
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
    // Report 38.6 part 8 (A2.1): a new bug tells the workspace's owners and admins.
    if (itemType === "bug") {
      const { notifyBugReported } = await import("@/lib/workflows/bug-notify");
      await notifyBugReported({ id: createdTask.id, title: validated.title.trim(), taskNumber: null, workspaceId: validated.projectId }, user.id);
    }
    // Report 38.7 part 8 (A2.4): a new ask tells the type's triage people (owners and admins when none are set).
    if (itemType === "request" && stage === "new") {
      const { notifyRequestNew } = await import("@/lib/workflows/request-notify");
      await notifyRequestNew(createdTask.id, user.id, requestTriagers);
    }
    if (itemType === "request") {
      const { scheduleRequestClock } = await import("@/lib/workflows/request-clock-server");
      await scheduleRequestClock(createdTask.id);
    }
    if (itemType !== "task") (await import("@/lib/workflows/server")).announceWaiting(validated.projectId);

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
        itemType: true,
        stage: true,
        partOfId: true,
        startDate: true,
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
    revalidatePath(`/workspaces/${validated.projectId}`);

    if (validated.assigneeId && validated.assigneeId !== user.id) {
      const actor = actorNotificationSnapshot(user);
      await enqueueWorkspaceNotificationBestEffort(
        {
          projectId: validated.projectId,
          actorUserId: user.id,
          ...actor,
          eventKey: "tasks.created_assigned",
          assigneeId: validated.assigneeId,
          title: `${actor.actorName || "Someone"} assigned you a task`,
          body: hydratedTask.title,
          href: `/workspaces/${encodeURIComponent(hydratedTask.project?.slug || validated.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(hydratedTask.id)}`,
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

    return { success: true, task: normalizeTaskSurfaceRecord(hydratedTask), ...(backlogged ? { backlogged } : {}) };
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  return deleteTaskAs(user, taskId, projectId);
}

/**
 * Deleting a task as this person. Only the workspace owner may, except `undoOwnCreate`: undoing a task the same
 * person created with a token in the last day (report A2.9).
 */
export async function deleteTaskAs(user: { id: string }, taskId: string, projectId: string, options: { undoOwnCreate?: boolean } = {}) {
  try {
    // Access Check - Only project owner can delete tasks
    const project = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, projectId),
      columns: { ownerId: true, slug: true },
    });
    if (!project) throw new Error("Workspace not found");

    if (project.ownerId !== user.id && !options.undoOwnCreate) {
      throw new Error("Only the owner can delete tasks");
    }

    let removed = null as { orgId: string; people: string[] } | null;
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
        throw new Error("Task not found in this workspace");
      }
      // Assignment work follows the assignment rule (report §42.12 problems 22 and 32, decision 142): the
      // organization's admins only, never once handed in, and a main assignment goes with its copies.
      const assignment = await assignmentWriteContext(tx, taskId);
      if (assignment) {
        const role = assignment.orgId ? await readViewerOrgRole(assignment.orgId, user.id) : null;
        const blocked = assignmentWriteBlock({ ...assignment, actorRole: orgRoleOf(role), actorIsHolder: false }, "delete");
        if (blocked) throw new Error(blocked);
        // Problems 27 and 32: whoever had it hears it was removed, once the delete commits.
        if (assignment.orgId) removed = { orgId: assignment.orgId, people: await assignmentPeopleOf(tx, taskId) };
        if (assignment.isMaster) {
          await tx.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.assignmentId, taskId), isNull(tasks.deletedAt)));
        }
      }

      // Soft-deleting a task must not strand its private working files behind
      // the hidden task workspace. Preserve them in one explicit recovery
      // folder, then detach their task ownership and links.
      const taskNodes = await tx.query.workspaceNodes.findMany({
        where: and(eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.taskId, taskId)),
        columns: { id: true, parentId: true, name: true, path: true, type: true },
      });
      if (taskNodes.length > 0) {
        const scopedIds = new Set(taskNodes.map((node) => node.id));
        const rootNodes = taskNodes.filter((node) => !node.parentId || !scopedIds.has(node.parentId));
        const recoveryName = `Recovered task files ${taskId.slice(0, 8)}`;
        let recoveryFolder = await tx.query.workspaceNodes.findFirst({
          where: and(eq(workspaceNodes.projectId, projectId), isNull(workspaceNodes.parentId), eq(workspaceNodes.name, recoveryName)),
          columns: { id: true, path: true },
        });
        if (!recoveryFolder) {
          const [created] = await tx.insert(workspaceNodes).values({
            projectId,
            parentId: null,
            type: "folder",
            name: recoveryName,
            path: `/${recoveryName}`,
            createdBy: user.id,
          }).returning({ id: workspaceNodes.id, path: workspaceNodes.path });
          recoveryFolder = created!;
        }
        if (rootNodes.length > 0) {
          await tx.update(workspaceNodes)
            .set({
              parentId: recoveryFolder.id,
              path: sql`CASE ${workspaceNodes.id} ${sql.join(rootNodes.map((node) => sql`WHEN ${node.id}::uuid THEN ${`${recoveryFolder!.path}/${node.name}`}`), sql` `)} END`,
              taskId: null,
              updatedAt: new Date(),
            })
            .where(inArray(workspaceNodes.id, rootNodes.map((node) => node.id)));
        }
        for (const node of rootNodes) {
          const nextPath = `${recoveryFolder.path}/${node.name}`;
          if (node.type === "folder") {
            await tx.execute(sql`
              UPDATE workspace_nodes
              SET task_id = NULL,
                  path = ${nextPath} || SUBSTRING(path FROM ${node.path.length + 1}),
                  updated_at = NOW()
              WHERE workspace_id = ${projectId}
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
        payload: { ...(await viaPayload()),
          version: 1,
          taskTitle: existingTask.title,
          taskNumber: existingTask.taskNumber,
          taskStatus: existingTask.status,
        },
      });
      return existingTask;
    });

    await queueCounterRefreshBestEffort([deletedTask?.assigneeId ?? null]);
    if (removed) {
      const { orgId, people } = removed;
      await notifyAssignmentRemoved(orgId, deletedTask.title, people, user.id, `removed:${taskId}`)
        .catch((error) => logger.warn("tasks.removed_notice_failed", { taskId, error: error instanceof Error ? error.message : String(error) }));
    }

    const slugOrId = project.slug || projectId;
    revalidatePath(`/workspaces/${slugOrId}`);
    revalidatePath(`/workspaces/${projectId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to delete task:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Couldn’t delete task",
    };
  }
}
