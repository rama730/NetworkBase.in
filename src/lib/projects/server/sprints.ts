import { assertOrgSprintRules, createMatchingChildSprints, readSprintMaterials, readSprintOrgContext, unlinkSprints } from "@/lib/organizations/sprints";
import { buildSprintSeries } from "@/lib/organizations/sprint-rules";
import { readViewerOrgRole } from "@/lib/organizations/detail";
import { startSprint } from "@/lib/projects/sprint-schedule";
import "server-only";

import { isMissingRelationError } from "@/lib/db/errors";
import { db } from "@/lib/db";
import { sql, and, eq, inArray, desc, ilike, isNull, or } from "drizzle-orm";
import { getProjectAccessById, assertProjectTabReadAccess, type ProjectAccess, canReadProjectTab, ProjectTabForbiddenError } from "@/lib/data/project-access";
import { createClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { type SprintTaskTimelineEntity, type SprintListItem, buildSprintHealthSummary, type SprintDetailPayload, buildSprintPermissionSet, isSprintReadyToClose } from "@/lib/projects/sprint-detail";
import { projectSprintEvents, projectSprints, profiles, projectMembers, sprintTaskMemberships, tasks, taskNodeLinks, projectNodes, taskSubtasks, projects, projectDocs, sprintMaterials } from "@/lib/db/schema";
import { toDateValue, toIsoString } from "@/lib/utils/date";
import { z } from "zod";
import { inferTaskFileRole } from "@/lib/projects/task-file-intelligence";
import { type SprintTimelineTaskInput, buildSprintTimeline } from "@/lib/projects/sprint-timeline";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isProjectTabVisibleToViewer } from "@/lib/projects/settings-policies";
import { type CreateSprintInput, createSprintSchema, parseSprintDateInput, type UpdateSprintInput, updateSprintSchema, type DeleteSprintResult, deleteSprintSchema } from "@/lib/projects/sprints";
import { isMissingColumn, resolveProjectDetailTarget, resolveProjectDetailViewerState, actorNotificationSnapshot, revalidateProjectPaths, enqueueProjectNotificationBestEffort } from "./common";

const isMissingTable = isMissingRelationError;


let sprintDescriptionColumnSupport: boolean | null = null;


async function hasProjectSprintDescriptionColumn() {
  if (sprintDescriptionColumnSupport !== null) {
    return sprintDescriptionColumnSupport;
  }

  try {
    const rows = await db.execute<{ exists: boolean }>(sql`
            select exists (
                select 1
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'project_sprints'
                  and column_name = 'description'
            ) as exists
        `);

    sprintDescriptionColumnSupport = Boolean(Array.from(rows)[0]?.exists);
  } catch {
    sprintDescriptionColumnSupport = false;
  }

  return sprintDescriptionColumnSupport;
}


async function assertProjectReadAccess(
  projectId: string,
  userId: string | null,
) {
  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) throw new Error("Project not found");
  if (!access.canRead) throw new Error("Forbidden");
  return access;
}


type SprintDetailPaginationCursor = {
  activityAt: Date;
  taskId: string;
};


function parseSprintDetailPaginationCursor(
  cursor?: string,
): SprintDetailPaginationCursor | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(cursor) as {
      activityAt?: unknown;
      taskId?: unknown;
    };
    if (
      typeof parsed.activityAt === "string" &&
      typeof parsed.taskId === "string" &&
      parsed.taskId.length > 0
    ) {
      const parsedDate = new Date(parsed.activityAt);
      if (!Number.isNaN(parsedDate.getTime())) {
        return { activityAt: parsedDate, taskId: parsed.taskId };
      }
    }
  } catch {
    // ignore invalid cursor payloads
  }

  return null;
}


function encodeSprintDetailPaginationCursor(
  cursor: SprintDetailPaginationCursor,
): string {
  return JSON.stringify({
    activityAt: cursor.activityAt.toISOString(),
    taskId: cursor.taskId,
  });
}


export async function fetchProjectSprintsAction(
  projectId: string,
  limit: number = 120,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    return await runInFlightDeduped(
      `project:sprints:${projectId}:${actorId ?? "anon"}:${safeLimit}`,
      async () => {
        await assertProjectTabReadAccess(projectId, actorId, "sprints");

        const projectSprintsList = await readProjectSprintsList(
          projectId,
          safeLimit,
        );

        return { success: true as const, sprints: projectSprintsList };
      },
    );
  } catch (error) {
    console.error("Failed to fetch sprints:", error);
    return { success: false as const, error: "Failed to fetch sprints" };
  }
}


type SprintTaskActivityQueryRow = {
  id: string;
  project_id: string;
  sprint_id: string;
  title: string;
  description: string | null;
  status: SprintTaskTimelineEntity["status"];
  review_status: "none" | "pending" | "rejected";
  completed_at: Date | string | null;
  priority: SprintTaskTimelineEntity["priority"];
  task_number: number | null;
  story_points: number | null;
  due_date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  activity_at: Date | string | null;
  membership_removed_at: Date | string | null;
  deleted_at: Date | string | null;
  linked_file_count: number;
  assignee_id: string | null;
  creator_id: string | null;
};


type SprintSummaryQueryRow = {
  total_tasks: number;
  completed_tasks: number;
  blocked_tasks: number;
  linked_file_count: number;
  total_story_points: number;
  completed_story_points: number;
};


const acceptedRoleTitleSql = (projectId: string, userId: unknown) => sql<
  string | null
>`(
    SELECT COALESCE(NULLIF(ra.accepted_role_title, ''), NULLIF(por.title, ''), NULLIF(por.role, ''))
    FROM role_applications ra
    LEFT JOIN project_open_roles por ON por.id = ra.role_id
    WHERE ra.project_id = ${projectId}
      AND ra.applicant_id = ${userId}
      AND ra.status = 'accepted'
    ORDER BY ra.updated_at DESC
    LIMIT 1
)`;


function formatSprintMemberRole(
  role: string | null | undefined,
  isOwner: boolean = false,
) {
  if (isOwner) return "Owner";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  if (role === "viewer") return "Viewer";
  return null;
}


function serializeSprintListItem(sprint: {
  id: string;
  projectId: string;
  sprintNumber: number;
  creatorId?: string | null;
  name: string;
  goal: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: SprintListItem["status"];
  startedAt?: Date | null;
  completedAt?: Date | null;
  archivedAt?: Date | null;
  cancelledAt?: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  creatorName?: string | null;
  creatorAvatarUrl?: string | null;
  creatorRole?: string | null;
  creatorRoleTitle?: string | null;
}): SprintListItem {
  const membershipRoleLabel = formatSprintMemberRole(
    sprint.creatorRole,
    sprint.creatorRole === "owner",
  );
  const roleLabel = sprint.creatorRoleTitle || membershipRoleLabel || null;

  return {
    id: sprint.id,
    projectId: sprint.projectId,
    sprintNumber: sprint.sprintNumber,
    code: `SPR-${sprint.sprintNumber}`,
    name: sprint.name,
    goal: sprint.goal ?? null,
    description: sprint.description ?? null,
    startDate: sprint.startDate?.toISOString() ?? null,
    endDate: sprint.endDate?.toISOString() ?? null,
    status: sprint.status,
    startedAt: sprint.startedAt?.toISOString() ?? null,
    completedAt: sprint.completedAt?.toISOString() ?? null,
    archivedAt: sprint.archivedAt?.toISOString() ?? null,
    cancelledAt: sprint.cancelledAt?.toISOString() ?? null,
    createdAt: sprint.createdAt?.toISOString() ?? null,
    updatedAt: sprint.updatedAt?.toISOString() ?? null,
    creator: sprint.creatorId
      ? {
          id: sprint.creatorId,
          fullName: sprint.creatorName ?? null,
          avatarUrl: sprint.creatorAvatarUrl ?? null,
          roleLabel,
        }
      : null,
  };
}


async function applySprintCreatorSnapshots(
  projectId: string,
  sprints: SprintListItem[],
) {
  if (sprints.length === 0) return sprints;
  const missingSprintIds = sprints
    .filter((s) => !s.creator?.fullName)
    .map((s) => s.id);
  if (missingSprintIds.length === 0) return sprints;

  try {
    const events = await db
      .select({
        sprintId: projectSprintEvents.sprintId,
        actorId: projectSprintEvents.actorId,
        payload: projectSprintEvents.payload,
      })
      .from(projectSprintEvents)
      .where(
        and(
          eq(projectSprintEvents.projectId, projectId),
          eq(projectSprintEvents.eventType, "created"),
          inArray(projectSprintEvents.sprintId, missingSprintIds),
        ),
      )
      .orderBy(desc(projectSprintEvents.createdAt));
    const snapshots = new Map<
      string,
      { actorId: string | null; name: string | null; avatarUrl: string | null }
    >();
    for (const event of events) {
      if (snapshots.has(event.sprintId)) continue;
      const payload = event.payload ?? {};
      snapshots.set(event.sprintId, {
        actorId: event.actorId ?? null,
        name:
          typeof payload.creatorName === "string" && payload.creatorName.trim()
            ? payload.creatorName.trim()
            : null,
        avatarUrl:
          typeof payload.creatorAvatarUrl === "string" &&
          payload.creatorAvatarUrl.trim()
            ? payload.creatorAvatarUrl
            : null,
      });
    }
    return sprints.map((sprint) => {
      if (sprint.creator?.fullName) return sprint;
      const snapshot = snapshots.get(sprint.id);
      if (!snapshot?.name) return sprint;
      return {
        ...sprint,
        creator: {
          id: sprint.creator?.id ?? snapshot.actorId ?? `sprint:${sprint.id}`,
          fullName: snapshot.name,
          avatarUrl: sprint.creator?.avatarUrl ?? snapshot.avatarUrl,
          roleLabel: sprint.creator?.roleLabel ?? null,
        },
      };
    });
  } catch (error) {
    if (isMissingTable(error, "project_sprint_events")) return sprints;
    throw error;
  }
}


async function readProjectSprintsList(projectId: string, limit: number) {
  const readSprints = async (supportsDescription: boolean) => {
    if (supportsDescription) {
      return db
        .select({
          id: projectSprints.id,
          projectId: projectSprints.projectId,
          creatorId: projectSprints.creatorId,
          sprintNumber: projectSprints.sprintNumber,
          name: projectSprints.name,
          goal: projectSprints.goal,
          description: projectSprints.description,
          startDate: projectSprints.startDate,
          endDate: projectSprints.endDate,
          status: projectSprints.status,
          startedAt: projectSprints.startedAt,
          completedAt: projectSprints.completedAt,
          archivedAt: projectSprints.archivedAt,
          cancelledAt: projectSprints.cancelledAt,
          createdAt: projectSprints.createdAt,
          updatedAt: projectSprints.updatedAt,
          creatorName: profiles.fullName,
          creatorAvatarUrl: profiles.avatarUrl,
          creatorRole: projectMembers.role,
          creatorRoleTitle: acceptedRoleTitleSql(
            projectId,
            projectSprints.creatorId,
          ),
        })
        .from(projectSprints)
        .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
        .leftJoin(
          projectMembers,
          and(
            eq(projectMembers.userId, projectSprints.creatorId),
            eq(projectMembers.projectId, projectId),
          ),
        )
        .where(eq(projectSprints.projectId, projectId))
        .orderBy(
          sql`CASE WHEN ${projectSprints.status} = 'active' THEN 0 WHEN ${projectSprints.status} = 'planning' THEN 1 ELSE 2 END`,
          desc(projectSprints.createdAt),
        )
        .limit(limit);
    }

    return db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        creatorId: projectSprints.creatorId,
        sprintNumber: projectSprints.sprintNumber,
        name: projectSprints.name,
        goal: projectSprints.goal,
        startDate: projectSprints.startDate,
        endDate: projectSprints.endDate,
        status: projectSprints.status,
        startedAt: projectSprints.startedAt,
        completedAt: projectSprints.completedAt,
        archivedAt: projectSprints.archivedAt,
        cancelledAt: projectSprints.cancelledAt,
        createdAt: projectSprints.createdAt,
        updatedAt: projectSprints.updatedAt,
        creatorName: profiles.fullName,
        creatorAvatarUrl: profiles.avatarUrl,
        creatorRole: projectMembers.role,
        creatorRoleTitle: acceptedRoleTitleSql(
          projectId,
          projectSprints.creatorId,
        ),
      })
      .from(projectSprints)
      .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.userId, projectSprints.creatorId),
          eq(projectMembers.projectId, projectId),
        ),
      )
      .where(eq(projectSprints.projectId, projectId))
      .orderBy(
        sql`CASE WHEN ${projectSprints.status} = 'active' THEN 0 WHEN ${projectSprints.status} = 'planning' THEN 1 ELSE 2 END`,
        desc(projectSprints.createdAt),
      )
      .limit(limit)
      .then((rows) => rows.map((row) => ({ ...row, description: null })));
  };

  const supportsDescription = await hasProjectSprintDescriptionColumn();

  try {
    const rows = await readSprints(supportsDescription);
    return applySprintCreatorSnapshots(
      projectId,
      rows.map(serializeSprintListItem),
    );
  } catch (error) {
    if (supportsDescription && isMissingColumn(error, "description")) {
      sprintDescriptionColumnSupport = false;
      const rows = await readSprints(false);
      return applySprintCreatorSnapshots(
        projectId,
        rows.map(serializeSprintListItem),
      );
    }
    throw error;
  }
}


async function readProjectSprintListItem(projectId: string, sprintId: string) {
  const readSprint = async (supportsDescription: boolean) => {
    if (supportsDescription) {
      return db
        .select({
          id: projectSprints.id,
          projectId: projectSprints.projectId,
          creatorId: projectSprints.creatorId,
          sprintNumber: projectSprints.sprintNumber,
          name: projectSprints.name,
          goal: projectSprints.goal,
          description: projectSprints.description,
          startDate: projectSprints.startDate,
          endDate: projectSprints.endDate,
          status: projectSprints.status,
          startedAt: projectSprints.startedAt,
          completedAt: projectSprints.completedAt,
          archivedAt: projectSprints.archivedAt,
          cancelledAt: projectSprints.cancelledAt,
          createdAt: projectSprints.createdAt,
          updatedAt: projectSprints.updatedAt,
          creatorName: profiles.fullName,
          creatorAvatarUrl: profiles.avatarUrl,
          creatorRole: projectMembers.role,
          creatorRoleTitle: acceptedRoleTitleSql(
            projectId,
            projectSprints.creatorId,
          ),
        })
        .from(projectSprints)
        .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
        .leftJoin(
          projectMembers,
          and(
            eq(projectMembers.userId, projectSprints.creatorId),
            eq(projectMembers.projectId, projectId),
          ),
        )
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
          ),
        )
        .limit(1);
    }

    return db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        creatorId: projectSprints.creatorId,
        sprintNumber: projectSprints.sprintNumber,
        name: projectSprints.name,
        goal: projectSprints.goal,
        startDate: projectSprints.startDate,
        endDate: projectSprints.endDate,
        status: projectSprints.status,
        startedAt: projectSprints.startedAt,
        completedAt: projectSprints.completedAt,
        archivedAt: projectSprints.archivedAt,
        cancelledAt: projectSprints.cancelledAt,
        createdAt: projectSprints.createdAt,
        updatedAt: projectSprints.updatedAt,
        creatorName: profiles.fullName,
        creatorAvatarUrl: profiles.avatarUrl,
        creatorRole: projectMembers.role,
        creatorRoleTitle: acceptedRoleTitleSql(
          projectId,
          projectSprints.creatorId,
        ),
      })
      .from(projectSprints)
      .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.userId, projectSprints.creatorId),
          eq(projectMembers.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(projectSprints.id, sprintId),
          eq(projectSprints.projectId, projectId),
        ),
      )
      .limit(1)
      .then((rows) => rows.map((row) => ({ ...row, description: null })));
  };

  const supportsDescription = await hasProjectSprintDescriptionColumn();

  try {
    const rows = await readSprint(supportsDescription);
    const [sprint] = await applySprintCreatorSnapshots(
      projectId,
      rows.map(serializeSprintListItem),
    );
    return sprint ?? null;
  } catch (error) {
    if (supportsDescription && isMissingColumn(error, "description")) {
      sprintDescriptionColumnSupport = false;
      const rows = await readSprint(false);
      const [sprint] = await applySprintCreatorSnapshots(
        projectId,
        rows.map(serializeSprintListItem),
      );
      return sprint ?? null;
    }
    throw error;
  }
}


async function readSprintSummary(sprintId: string) {
  const rows = await db.execute<SprintSummaryQueryRow>(sql`
        WITH sprint_tasks AS (
            SELECT DISTINCT ON (m.task_id)
                t.id,
                t.status,
                t.review_status,
                t.story_points
            FROM ${sprintTaskMemberships} m
            JOIN ${tasks} t ON t.id = m.task_id AND t.deleted_at IS NULL
            WHERE m.sprint_id = ${sprintId} AND m.removed_at IS NULL
        )
        SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE st.status = 'done' AND st.review_status <> 'pending')::int AS completed_tasks,
            COUNT(*) FILTER (WHERE st.status = 'blocked')::int AS blocked_tasks,
            (
                SELECT COUNT(*)::int
                FROM ${taskNodeLinks} lnk
                JOIN ${projectNodes} node ON node.id = lnk.node_id AND node.deleted_at IS NULL
                WHERE lnk.task_id IN (SELECT id FROM sprint_tasks)
            ) AS linked_file_count,
            COALESCE(SUM(COALESCE(st.story_points, 0)), 0)::int AS total_story_points,
            COALESCE(SUM(COALESCE(st.story_points, 0)) FILTER (WHERE st.status = 'done' AND st.review_status <> 'pending'), 0)::int AS completed_story_points
        FROM sprint_tasks st
    `);

  const row = Array.from(rows)[0] ?? {
    total_tasks: 0,
    completed_tasks: 0,
    blocked_tasks: 0,
    linked_file_count: 0,
    total_story_points: 0,
    completed_story_points: 0,
  };

  return buildSprintHealthSummary({
    totalTasks: Number(row.total_tasks || 0),
    completedTasks: Number(row.completed_tasks || 0),
    blockedTasks: Number(row.blocked_tasks || 0),
    linkedFileCount: Number(row.linked_file_count || 0),
    totalStoryPoints: Number(row.total_story_points || 0),
    completedStoryPoints: Number(row.completed_story_points || 0),
  });
}


async function readSprintTaskActivityPage(input: {
  projectId: string;
  sprintId: string;
  limit: number;
  cursor: SprintDetailPaginationCursor | null;
  taskReference?: string | null;
}) {
  const { sprintId, limit, cursor } = input;

  const activityRowsResult = await db.execute<SprintTaskActivityQueryRow>(sql`
        WITH memberships AS (
            SELECT task_id,
                   MIN(added_at) AS added_at,
                   CASE WHEN BOOL_OR(removed_at IS NULL) THEN NULL ELSE MAX(removed_at) END AS removed_at
            FROM ${sprintTaskMemberships}
            WHERE sprint_id = ${sprintId}
            GROUP BY task_id
        ), task_activity AS (
            SELECT
                t.id,
                t.project_id,
                ${sprintId}::uuid AS sprint_id,
                t.title,
                t.description,
                t.status,
                t.review_status,
                t.completed_at,
                t.priority,
                t.task_number,
                t.story_points,
                t.due_date,
                t.created_at,
                t.updated_at,
                t.deleted_at,
                t.assignee_id,
                t.creator_id,
                COALESCE(m.added_at, t.created_at) AS activity_at,
                m.removed_at AS membership_removed_at,
                0::int AS linked_file_count
            FROM ${tasks} t
            INNER JOIN memberships m ON m.task_id = t.id
            WHERE t.project_id = ${input.projectId}
        )
        SELECT *
        FROM task_activity
        ${
          cursor
            ? sql`WHERE (
                activity_at > ${cursor.activityAt}
                OR (activity_at = ${cursor.activityAt} AND id > ${cursor.taskId})
            )`
            : sql``
        }
        ORDER BY activity_at ASC, id ASC
        LIMIT ${limit + 1}
    `);

  const activityRows = Array.from(activityRowsResult);
  const hasMore = activityRows.length > limit;
  const pageRows = hasMore ? activityRows.slice(0, limit) : activityRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursorActivityAt = toDateValue(lastRow?.activity_at);
  const nextCursor =
    hasMore && nextCursorActivityAt
      ? encodeSprintDetailPaginationCursor({
          activityAt: nextCursorActivityAt,
          taskId: lastRow!.id,
        })
      : null;

  // A canonical project-key task link must work even when the referenced task is
  // outside the first cursor page. Add that one membership-backed row to
  // the initial payload without changing pagination boundaries.
  const requestedTaskNumber = Number.parseInt(
    input.taskReference?.trim().match(/^[A-Za-z][A-Za-z0-9_-]*-(\d+)$/)?.[1] ?? "",
    10,
  );
  const requestedTaskId = z
    .string()
    .uuid()
    .safeParse(input.taskReference ?? "");
  if (
    !cursor &&
    input.taskReference &&
    !pageRows.some(
      (row) =>
        (requestedTaskId.success && row.id === requestedTaskId.data) ||
        (Number.isInteger(requestedTaskNumber) &&
          row.task_number === requestedTaskNumber),
    )
  ) {
    const targetCondition = requestedTaskId.success
      ? sql`t.id = ${requestedTaskId.data}::uuid`
      : Number.isInteger(requestedTaskNumber)
        ? sql`t.task_number = ${requestedTaskNumber}`
        : sql`FALSE`;
    const targetRowsResult = await db.execute<SprintTaskActivityQueryRow>(sql`
            WITH memberships AS (
                SELECT task_id,
                       MIN(added_at) AS added_at,
                       CASE WHEN BOOL_OR(removed_at IS NULL) THEN NULL ELSE MAX(removed_at) END AS removed_at
                FROM ${sprintTaskMemberships}
                WHERE sprint_id = ${sprintId}
                GROUP BY task_id
            )
            SELECT
                t.id,
                t.project_id,
                ${sprintId}::uuid AS sprint_id,
                t.title,
                t.description,
                t.status,
                t.review_status,
                t.completed_at,
                t.priority,
                t.task_number,
                t.story_points,
                t.due_date,
                t.created_at,
                t.updated_at,
                t.deleted_at,
                t.assignee_id,
                t.creator_id,
                COALESCE(m.added_at, t.created_at) AS activity_at,
                m.removed_at AS membership_removed_at,
                0::int AS linked_file_count
            FROM ${tasks} t
            INNER JOIN memberships m ON m.task_id = t.id
            WHERE t.project_id = ${input.projectId} AND ${targetCondition}
            LIMIT 1
        `);
    const targetRow = Array.from(targetRowsResult)[0];
    if (targetRow) pageRows.push(targetRow);
  }

  const taskIds = pageRows.map((row) => row.id);
  const actorIds = Array.from(
    new Set(
      pageRows
        .flatMap((row) => [row.assignee_id, row.creator_id])
        .filter((value): value is string => !!value),
    ),
  );

  const [actorRows, fileLinkRows, subtasks] = await Promise.all([
    actorIds.length > 0
      ? db
          .select({
            id: profiles.id,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
          })
          .from(profiles)
          .where(inArray(profiles.id, actorIds))
      : Promise.resolve([]),
    taskIds.length > 0
      ? ((db.execute(sql`
          SELECT
            tnl.task_id AS "taskId",
            pn.id AS "nodeId",
            pn.name AS "nodeName",
            pn.type AS "nodeType",
            pn.path AS "nodePath",
            pn.canonical_node_id AS "canonicalNodeId",
            tnl.linked_at AS "linkedAt",
            tnl.annotation,
            tnl.tags,
            fv.version AS "latestVersion",
            p.id AS "uploaderId",
            p.full_name AS "uploaderName",
            p.avatar_url AS "uploaderAvatarUrl"
          FROM task_node_links tnl
          INNER JOIN project_nodes pn ON pn.id = tnl.node_id AND pn.project_id = ${input.projectId}::uuid AND pn.deleted_at IS NULL
          LEFT JOIN file_versions fv ON fv.node_id = pn.id AND fv.version = pn.current_version
          LEFT JOIN profiles p ON p.id = fv.uploaded_by
          WHERE tnl.task_id IN (${sql.join(taskIds.map((taskId) => sql`${taskId}::uuid`), sql`, `)})
          ORDER BY tnl.linked_at DESC
        `)) as unknown as Promise<Array<{
          taskId: string;
          nodeId: string;
          nodeName: string;
          nodeType: "folder" | "file";
          nodePath: string;
          canonicalNodeId: string | null;
          linkedAt: Date;
          annotation: string | null;
          tags: string[] | null;
          latestVersion: number | null;
          uploaderId: string | null;
          uploaderName: string | null;
          uploaderAvatarUrl: string | null;
        }>>)
      : Promise.resolve([]),
    taskIds.length > 0
      ? db
          .select({
            id: taskSubtasks.id,
            taskId: taskSubtasks.taskId,
            title: taskSubtasks.title,
            completed: taskSubtasks.completed,
            position: taskSubtasks.position,
          })
          .from(taskSubtasks)
          .where(inArray(taskSubtasks.taskId, taskIds))
          .orderBy(taskSubtasks.position, taskSubtasks.createdAt)
      : Promise.resolve([]),
  ]);

  const actorById = new Map(actorRows.map((row) => [row.id, row]));

  const filesByTaskId = new Map<
    string,
    SprintTaskTimelineEntity["linkedFiles"]
  >();
  for (const link of fileLinkRows) {
    const files = filesByTaskId.get(link.taskId) ?? [];
    if (files.some((file) => file.nodeId === link.nodeId)) continue;
    const role = inferTaskFileRole({
      id: link.nodeId,
      name: link.nodeName,
      type: link.nodeType,
      path: link.nodePath,
      annotation: link.annotation,
      tags: link.tags,
      canonicalNodeId: link.canonicalNodeId,
    });

    files.push({
      nodeId: link.nodeId,
      name: link.nodeName,
      latestVersion: link.latestVersion ?? null,
      latestUploader: link.uploaderId
        ? {
            id: link.uploaderId,
            fullName: link.uploaderName ?? null,
            avatarUrl: link.uploaderAvatarUrl ?? null,
          }
        : null,
      annotation: link.annotation ?? null,
      tags: link.tags ?? [],
      role,
    });
    filesByTaskId.set(link.taskId, files);
  }

  const subtasksByTaskId = new Map<
    string,
    SprintTaskTimelineEntity["subtasks"]
  >();
  for (const st of subtasks) {
    const list = subtasksByTaskId.get(st.taskId) ?? [];
    list.push({
      id: st.id,
      title: st.title,
      completed: st.completed ?? false,
      position: st.position ?? 0,
    });
    subtasksByTaskId.set(st.taskId, list);
  }

  const tasksPage: SprintTimelineTaskInput[] = pageRows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    sprintId: row.sprint_id,
    taskNumber: row.task_number ?? null,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    reviewStatus: row.review_status,
    priority: row.priority,
    storyPoints: row.story_points ?? null,
    dueDate: toIsoString(row.due_date),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    completedAt: toIsoString(row.completed_at),
    activityAt:
      toIsoString(row.activity_at) ??
      toIsoString(row.updated_at) ??
      toIsoString(row.created_at) ??
      null,
    linkedFileCount: filesByTaskId.get(row.id)?.length ?? 0,
    isDeleted: Boolean(row.deleted_at),
    membershipState: row.membership_removed_at ? "historical" : "committed",
    addedAt: toIsoString(row.activity_at),
    removedAt: toIsoString(row.membership_removed_at),
    linkedFiles: filesByTaskId.get(row.id) ?? [],
    subtasks: subtasksByTaskId.get(row.id) ?? [],
    assignee: row.assignee_id
      ? actorById.get(row.assignee_id)
        ? {
            id: row.assignee_id,
            fullName: actorById.get(row.assignee_id)?.fullName ?? null,
            avatarUrl: actorById.get(row.assignee_id)?.avatarUrl ?? null,
          }
        : null
      : null,
    creator: row.creator_id
      ? actorById.get(row.creator_id)
        ? {
            id: row.creator_id,
            fullName: actorById.get(row.creator_id)?.fullName ?? null,
            avatarUrl: actorById.get(row.creator_id)?.avatarUrl ?? null,
          }
        : null
      : null,
  }));

  return {
    tasks: tasksPage,
    hasMore,
    nextCursor,
  };
}


const NO_SPRINT_TASK_PAGE: Awaited<ReturnType<typeof readSprintTaskActivityPage>> = { tasks: [], nextCursor: null, hasMore: false };


async function buildSprintDetailPayload(input: {
  projectId: string;
  access: ProjectAccess;
  sprintId?: string | null;
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
}): Promise<SprintDetailPayload | null> {
  const safeLimit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);

  const access = input.access;
  if (!access.project) throw new Error("Project not found");
  if (!canReadProjectTab(access, "sprints")) throw new ProjectTabForbiddenError("sprints");
  // Sprints visibility exposes sprint list and health; task rows also need Tasks visibility (COR-043).
  const showTasks = canReadProjectTab(access, "tasks");
  // A read must not mutate Sprint lifecycle state. The scheduler
  // remains the sole owner of time-based transitions.
  const permissions = buildSprintPermissionSet({
    canRead: access.canRead,
    canWrite: access.canWrite,
    isOwner: access.isOwner,
    isMember: access.isMember || access.isInheritedAdmin,
    // Inherited org admins act as project admins on a child project's sprints (report §15.5).
    memberRole: access.isInheritedAdmin && !access.memberRole ? "admin" : access.memberRole,
  });

  const sprints = await readProjectSprintsList(input.projectId, 120);
  const isSprintInsider = access.isOwner || access.isMember || access.isInheritedAdmin;
  const requestedSprint = input.sprintId?.trim() ?? null;
  const legacyNameMatches = requestedSprint
    ? sprints.filter((sprint) => sprint.name === requestedSprint)
    : [];
  const selectedSprint =
    (requestedSprint
      ? (sprints.find(
          (sprint) =>
            sprint.id === requestedSprint ||
            sprint.code.toLowerCase() === requestedSprint.toLowerCase(),
        ) ?? (legacyNameMatches.length === 1 ? legacyNameMatches[0] : null))
      : null) ??
    sprints.find((sprint) => sprint.status === "active") ??
    sprints.find((sprint) => sprint.status === "planning") ??
    sprints[0] ??
    null;

  if (input.sprintId && !selectedSprint) {
    return null;
  }

  if (!selectedSprint) {
    return {
      projectId: input.projectId,
      projectSlug: access.project.slug ?? null,
      sprints,
      selectedSprintId: null,
      permissions,
      summary: null,
      rows: [],
      nextCursor: null,
      hasMore: false,
      org: await readSprintOrgContext(input.projectId, null),
      materials: [],
    };
  }

  if (
    requestedSprint &&
    selectedSprint.id !== requestedSprint &&
    selectedSprint.code.toLowerCase() !== requestedSprint.toLowerCase() &&
    selectedSprint.name !== requestedSprint
  ) {
    return null;
  }

  const [summary, taskPage, org, materials] = await Promise.all([
    readSprintSummary(selectedSprint.id),
    showTasks ? readSprintTaskActivityPage({
      projectId: input.projectId,
      sprintId: selectedSprint.id,
      limit: safeLimit,
      cursor: parsedCursor,
      taskReference: input.taskReference,
    }) : Promise.resolve(NO_SPRINT_TASK_PAGE),
    readSprintOrgContext(input.projectId, selectedSprint.id),
    // Visitors get sprint names, goals and dates only: no materials or linked projects (report §15.4).
    isSprintInsider ? readSprintMaterials(selectedSprint.id) : Promise.resolve([]),
  ]);

  const rows = buildSprintTimeline({
    sprint: selectedSprint,
    tasks: taskPage.tasks,
    summary,
    includeKickoff: !parsedCursor,
    includeCloseout: !taskPage.hasMore,
  });

  return {
    projectId: input.projectId,
    projectSlug: access.project.slug ?? null,
    sprints,
    selectedSprintId: selectedSprint.id,
    permissions,
    summary,
    rows,
    nextCursor: taskPage.nextCursor,
    hasMore: taskPage.hasMore,
    org: org && !isSprintInsider ? { ...org, linkedProjects: [], notLinkedCount: 0 } : org,
    materials,
  };
}


async function buildSprintTimelinePagePayload(input: {
  projectId: string;
  access: ProjectAccess;
  sprintId: string | null;
  cursor?: string;
  limit?: number;
}): Promise<SprintDetailPayload | null> {
  if (!input.sprintId) {
    return buildSprintDetailPayload(input);
  }

  const safeLimit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);
  const access = input.access;
  if (!access.project) throw new Error("Project not found");
  if (!canReadProjectTab(access, "sprints")) throw new ProjectTabForbiddenError("sprints");
  // Sprints visibility exposes sprint list and health; task rows also need Tasks visibility (COR-043).
  const showTasks = canReadProjectTab(access, "tasks");

  const selectedSprint = await readProjectSprintListItem(
    input.projectId,
    input.sprintId,
  );
  if (!selectedSprint) return null;

  const permissions = buildSprintPermissionSet({
    canRead: access.canRead,
    canWrite: access.canWrite,
    isOwner: access.isOwner,
    isMember: access.isMember,
    memberRole: access.memberRole,
  });

  const [summary, taskPage] = await Promise.all([
    readSprintSummary(selectedSprint.id),
    showTasks ? readSprintTaskActivityPage({
      projectId: input.projectId,
      sprintId: selectedSprint.id,
      limit: safeLimit,
      cursor: parsedCursor,
    }) : Promise.resolve(NO_SPRINT_TASK_PAGE),
  ]);

  const rows = buildSprintTimeline({
    sprint: selectedSprint,
    tasks: taskPage.tasks,
    summary,
    includeKickoff: false,
    includeCloseout: !taskPage.hasMore,
  });

  return {
    projectId: input.projectId,
    projectSlug: access.project.slug ?? null,
    sprints: [selectedSprint],
    selectedSprintId: selectedSprint.id,
    permissions,
    summary,
    rows,
    nextCursor: taskPage.nextCursor,
    hasMore: taskPage.hasMore,
  };
}


export async function fetchProjectSprintDetailAction(input: {
  projectId: string;
  sprintId?: string | null;
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const cursorKey = input.cursor ?? "head";
    const sprintKey = input.sprintId ?? "default";

    const startedAt = Date.now();
    const taskKey = input.taskReference?.trim() || "none";
    const data = await runInFlightDeduped(
      `project:sprint-detail:${input.projectId}:${sprintKey}:${taskKey}:${actorId ?? "anon"}:${cursorKey}:${input.limit ?? 30}`,
      async () => {
        const access = await getProjectAccessById(input.projectId, actorId);
        if (!access.project) {
          throw new Error("Project not found");
        }

        return buildSprintDetailPayload({
          projectId: input.projectId,
          access,
          sprintId: input.sprintId ?? null,
          taskReference: input.taskReference ?? null,
          cursor: input.cursor,
          limit: input.limit,
        });
      },
    );

    if (!data) {
      return { success: false as const, error: "Sprint not found" };
    }

    recordSprintMetric("project.sprint.detail.load_ms", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      durationMs: Date.now() - startedAt,
      rowCount: data.rows.length,
      hasMore: data.hasMore,
    });

    recordSprintMetric("project.sprint.timeline.rows", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      kickoffRows: data.rows.filter((row) => row.kind === "kickoff").length,
      taskRows: data.rows.filter((row) => row.kind === "task").length,
      closeoutRows: data.rows.filter((row) => row.kind === "closeout").length,
    });

    return { success: true as const, data };
  } catch (error) {
    console.error("Failed to fetch sprint detail:", error);
    return { success: false as const, error: "Failed to fetch sprint detail" };
  }
}


export async function fetchProjectSprintTimelinePageAction(input: {
  projectId: string;
  sprintId: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const cursorKey = input.cursor ?? "head";
    const sprintKey = input.sprintId ?? "default";
    const startedAt = Date.now();

    const data = await runInFlightDeduped(
      `project:sprint-timeline-page:${input.projectId}:${sprintKey}:${actorId ?? "anon"}:${cursorKey}:${input.limit ?? 30}`,
      async () => {
        const access = await getProjectAccessById(input.projectId, actorId);
        if (!access.project) {
          throw new Error("Project not found");
        }
        return buildSprintTimelinePagePayload({
          projectId: input.projectId,
          access,
          sprintId: input.sprintId,
          cursor: input.cursor,
          limit: input.limit,
        });
      },
    );

    if (!data) {
      return { success: false as const, error: "Sprint not found" };
    }

    recordSprintMetric("project.sprint.timeline.page_load_ms", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      durationMs: Date.now() - startedAt,
      rowCount: data.rows.length,
      hasMore: data.hasMore,
    });

    recordSprintMetric("project.sprint.timeline.page_rows", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      taskRows: data.rows.filter((row) => row.kind === "task").length,
    });

    return { success: true as const, data };
  } catch (error) {
    console.error("Failed to fetch sprint timeline page:", error);
    return {
      success: false as const,
      error: "Failed to fetch sprint timeline page",
    };
  }
}


type ProjectSprintDetailInput = {
  slugOrId: string;
  sprintId?: string | null;
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
};


/** Session-scoped sprint detail (COR-042). */
export async function readProjectSprintDetail(input: ProjectSprintDetailInput) {
  const { userId } = await getViewerAuthContext();
  return readProjectSprintDetailForActor({ ...input, actorUserId: userId });
}


async function readProjectSprintDetailForActor(input: ProjectSprintDetailInput & { actorUserId: string | null }) {
  try {
    const project = await resolveProjectDetailTarget(
      input.slugOrId,
      input.actorUserId ?? null,
    );
    if (!project) {
      return {
        success: false as const,
        errorCode: "NOT_FOUND" as const,
        message: "Project not found.",
      };
    }

    const parentOrgRole = project.parentId ? await readViewerOrgRole(project.parentId, input.actorUserId ?? null) : null;
    const viewerState = resolveProjectDetailViewerState({
      projectId: project.id,
      ownerId: project.ownerId,
      visibility: project.visibility,
      status: project.status,
      actorUserId: input.actorUserId ?? null,
      memberRoleRaw: project.memberRole,
      isFollowed: project.isFollowed,
      parentOrgRole,
    });

    if (!viewerState.canRead) {
      return {
        success: false as const,
        errorCode: "FORBIDDEN" as const,
        message: "Forbidden",
      };
    }
    if (
      !isProjectTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: viewerState.isOwner || viewerState.isMember || parentOrgRole === "owner" || parentOrgRole === "admin",
        publicTabVisibility: project.publicTabVisibility,
        isOrganization: project.kind === "organization",
      })
    ) {
      return {
        success: false as const,
        errorCode: "FORBIDDEN" as const,
        message: "Sprint details are members-only for this project.",
      };
    }

    const access = await assertProjectReadAccess(
      project.id,
      input.actorUserId ?? null,
    );
    const data = await buildSprintDetailPayload({
      projectId: project.id,
      access,
      sprintId: input.sprintId ?? null,
      taskReference: input.taskReference ?? null,
      cursor: input.cursor,
      limit: input.limit,
    });

    if (!data) {
      return {
        success: false as const,
        errorCode: "NOT_FOUND" as const,
        message: "Sprint not found.",
      };
    }

    return {
      success: true as const,
      data,
    };
  } catch (error) {
    console.error("[readProjectSprintDetail] failed", error);
    return {
      success: false as const,
      errorCode: "INTERNAL_ERROR" as const,
      message: "Failed to load sprint detail.",
    };
  }
}


export async function createSprintAction(data: CreateSprintInput) {
  let actorIdForMetric: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    actorIdForMetric = user.id;

    const validated = createSprintSchema.parse(data);
    const startDate = parseSprintDateInput(validated.startDate);
    const endDate = parseSprintDateInput(validated.endDate);

    await requireSprintOwner(validated.projectId, user.id);

    const creator = actorNotificationSnapshot(user);
    const newSprint = await db.transaction(async (tx) => {
      // One project lock makes the human Sprint code stable under concurrent creates.
      await tx.execute(
        sql`SELECT id FROM ${projects} WHERE id = ${validated.projectId} FOR UPDATE`,
      );
      const numberRows = await tx.execute<{ next_number: number }>(sql`
                SELECT COALESCE(MAX(sprint_number), 0)::int + 1 AS next_number
                FROM ${projectSprints}
                WHERE project_id = ${validated.projectId}
            `);
      const sprintNumber = Number(Array.from(numberRows)[0]?.next_number ?? 1);
      await assertOrgSprintRules(tx, { projectId: validated.projectId, startDate, endDate, parentSprintId: validated.parentSprintId ?? null });
      const [created] = await tx
        .insert(projectSprints)
        .values({
          projectId: validated.projectId,
          creatorId: user.id,
          sprintNumber,
          name: validated.name,
          goal: validated.goal ?? null,
          description: validated.description ?? null,
          startDate,
          endDate,
          status: "planning",
          autoStart: validated.autoStart ?? true,
          showInChildren: validated.showInChildren ?? true,
          parentSprintId: validated.parentSprintId ?? null,
        })
        .returning({ id: projectSprints.id });
      if (created && validated.createMatching) {
        await createMatchingChildSprints(tx, {
          orgId: validated.projectId,
          orgSprint: { id: created.id, name: validated.name, goal: validated.goal ?? null, startDate, endDate },
          actorId: user.id,
        });
      }
      if (created) {
        await tx.insert(projectSprintEvents).values({
          projectId: validated.projectId,
          sprintId: created.id,
          actorId: user.id,
          eventType: "created",
          payload: {
            name: validated.name,
            status: "planning",
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            creatorName: creator.actorName,
            creatorAvatarUrl: creator.actorAvatarUrl,
          },
        });
      }
      return created;
    });

    if (!newSprint) {
      throw new Error("Failed to create sprint");
    }

    const sprintListItem = await readProjectSprintListItem(
      validated.projectId,
      newSprint.id,
    );
    if (!sprintListItem) {
      throw new Error("Failed to load created sprint");
    }

    await revalidateProjectPaths(validated.projectId);

    await enqueueProjectNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.created",
        title: `Sprint created: ${sprintListItem.name}`,
        body: sprintListItem.goal ?? "A new sprint was added to the project.",
        sourceEventId: sprintListItem.id,
        entityRefs: {
          projectId: validated.projectId,
          sprintId: sprintListItem.id,
        },
      },
      { sprintId: sprintListItem.id },
    );

    recordSprintMetric("project.sprint.create.result", {
      projectId: validated.projectId,
      sprintId: sprintListItem.id,
      actorId: actorIdForMetric,
      success: true,
    });

    return { success: true, sprint: sprintListItem };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message ?? "Sprint details are invalid",
      };
    }
    console.error("Failed to create sprint:", error);
    recordSprintMetric("project.sprint.create.result", {
      projectId: data.projectId,
      actorId: actorIdForMetric ?? "unknown",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to create sprint",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create sprint",
    };
  }
}


export async function updateSprintAction(data: UpdateSprintInput) {
  let actorIdForMetric: string | null = null;
  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    actorIdForMetric = user.id;

    const validated = updateSprintSchema.parse(data);
    const startDate = parseSprintDateInput(validated.startDate);
    const endDate = parseSprintDateInput(validated.endDate);

    await requireSprintOwner(validated.projectId, user.id);

    const [existingSprint] = await db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        status: projectSprints.status,
        parentSprintId: projectSprints.parentSprintId,
      })
      .from(projectSprints)
      .where(
        and(
          eq(projectSprints.id, validated.sprintId),
          eq(projectSprints.projectId, validated.projectId),
        ),
      )
      .limit(1);

    if (!existingSprint) {
      throw new Error("Sprint not found");
    }
    if (
      existingSprint.status !== "planning"
    ) {
      throw new Error(
        "Active, completed, cancelled, and archived Sprints are read-only",
      );
    }

    const changedAt = new Date();
    const updatedSprintId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${projects} WHERE id = ${validated.projectId} FOR UPDATE`);
      const parentSprintId = validated.parentSprintId === undefined ? existingSprint.parentSprintId : validated.parentSprintId;
      await assertOrgSprintRules(tx, { projectId: validated.projectId, startDate, endDate, parentSprintId, excludeSprintId: validated.sprintId });
      const [updated] = await tx
        .update(projectSprints)
        .set({
          name: validated.name,
          goal: validated.goal ?? null,
          description: validated.description ?? null,
          startDate,
          endDate,
          parentSprintId,
          ...(validated.autoStart === undefined ? {} : { autoStart: validated.autoStart }),
          ...(validated.showInChildren === undefined ? {} : { showInChildren: validated.showInChildren }),
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(projectSprints.id, validated.sprintId),
            eq(projectSprints.projectId, validated.projectId),
            eq(projectSprints.status, "planning"),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated)
        throw new Error("The Sprint changed before it could be saved");

      await tx.insert(projectSprintEvents).values({
        projectId: validated.projectId,
        sprintId: updated.id,
        actorId: user.id,
        eventType: "updated",
        payload: {
          name: validated.name,
          status: existingSprint.status,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        createdAt: changedAt,
      });
      return updated.id;
    });

    const sprintListItem = await readProjectSprintListItem(
      validated.projectId,
      updatedSprintId,
    );
    if (!sprintListItem) throw new Error("Failed to reload updated sprint");

    await revalidateProjectPaths(validated.projectId);

    await enqueueProjectNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.updated",
        title: `Sprint updated: ${sprintListItem.name}`,
        body: sprintListItem.goal ?? "Sprint details were updated.",
        sourceEventId: `${sprintListItem.id}:${sprintListItem.updatedAt ?? changedAt.toISOString()}`,
        entityRefs: {
          projectId: validated.projectId,
          sprintId: sprintListItem.id,
        },
      },
      { sprintId: sprintListItem.id },
    );

    recordSprintMetric("project.sprint.update.result", {
      projectId: validated.projectId,
      sprintId: validated.sprintId,
      actorId: actorIdForMetric,
      success: true,
      durationMs: Date.now() - startedAt,
    });

    return { success: true as const, sprint: sprintListItem };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false as const,
        error: error.issues[0]?.message ?? "Sprint details are invalid",
      };
    }

    console.error("Failed to update sprint:", error);
    recordSprintMetric("project.sprint.update.result", {
      projectId: data.projectId,
      sprintId: data.sprintId,
      actorId: actorIdForMetric ?? "unknown",
      success: false,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to update sprint",
    });

    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to update sprint",
    };
  }
}


export async function deleteSprintAction(data: {
  projectId: string;
  sprintId: string;
}): Promise<DeleteSprintResult> {
  let actorIdForMetric: string | null = null;
  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    actorIdForMetric = user.id;

    const validated = deleteSprintSchema.parse(data);
    await requireSprintOwner(validated.projectId, user.id);

    const [sprintWithTaskCount] = await db.execute<{
      id: string;
      status: SprintListItem["status"];
      affected_task_count: number;
    }>(sql`
            SELECT
                s.id,
                s.status,
                (
                    SELECT COUNT(DISTINCT task_id)::int
                    FROM ${sprintTaskMemberships} m
                    WHERE m.sprint_id = s.id
                ) AS affected_task_count
            FROM ${projectSprints} s
            WHERE s.id = ${validated.sprintId}
              AND s.project_id = ${validated.projectId}
            LIMIT 1
        `);

    if (!sprintWithTaskCount) {
      throw new Error("Sprint not found");
    }

    if (
      sprintWithTaskCount.status !== "planning" ||
      sprintWithTaskCount.affected_task_count > 0
    ) {
      recordSprintMetric("project.sprint.delete.blocked", {
        projectId: validated.projectId,
        sprintId: validated.sprintId,
        actorId: actorIdForMetric,
        reason:
          sprintWithTaskCount.status !== "planning"
            ? "not_planning"
            : "has_history",
        affectedTaskCount: sprintWithTaskCount.affected_task_count,
      });
      return {
        success: false,
        error:
          sprintWithTaskCount.affected_task_count > 0
            ? "Sprints with work history are archived instead of deleted."
            : "Only an empty Planning sprint can be deleted.",
      };
    }

    // The preflight above is advisory. Lock the sprint (task assignment's FK
    // check and scheduler activation both wait on it), recheck, then delete
    // only the still-empty Planning sprint (COR-048).
    const deleted = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: projectSprints.status })
        .from(projectSprints)
        .where(and(eq(projectSprints.id, validated.sprintId), eq(projectSprints.projectId, validated.projectId)))
        .for("update");
      if (!locked || locked.status !== "planning") return false;
      const [history] = await tx.execute<{ has_history: boolean }>(sql`
        SELECT EXISTS (SELECT 1 FROM ${sprintTaskMemberships} m WHERE m.sprint_id = ${validated.sprintId}) AS has_history
      `);
      if (history?.has_history) return false;
      const removed = await tx
        .delete(projectSprints)
        .where(and(
          eq(projectSprints.id, validated.sprintId),
          eq(projectSprints.projectId, validated.projectId),
          eq(projectSprints.status, "planning"),
        ))
        .returning({ id: projectSprints.id });
      return removed.length === 1;
    });
    if (!deleted) {
      return {
        success: false,
        error: "Only an empty Planning sprint can be deleted.",
      };
    }

    await revalidateProjectPaths(validated.projectId);

    await enqueueProjectNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.deleted",
        title: "Sprint deleted",
        body: "An empty Planning sprint was deleted.",
        sourceEventId: `${validated.sprintId}:deleted`,
        entityRefs: {
          projectId: validated.projectId,
          sprintId: validated.sprintId,
        },
      },
      { sprintId: validated.sprintId },
    );

    recordSprintMetric("project.sprint.delete.result", {
      projectId: validated.projectId,
      sprintId: validated.sprintId,
      actorId: actorIdForMetric,
      success: true,
      durationMs: Date.now() - startedAt,
      previousStatus: sprintWithTaskCount.status,
      affectedTaskCount: sprintWithTaskCount.affected_task_count,
    });

    return {
      success: true,
      deletedSprintId: validated.sprintId,
      affectedTaskCount: sprintWithTaskCount.affected_task_count,
      previousStatus: sprintWithTaskCount.status,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message ?? "Sprint details are invalid",
      };
    }

    console.error("Failed to delete sprint:", error);
    recordSprintMetric("project.sprint.delete.result", {
      projectId: data.projectId,
      sprintId: data.sprintId,
      actorId: actorIdForMetric ?? "unknown",
      success: false,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to delete sprint",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete sprint",
    };
  }
}


type CompleteSprintOptions = {
  unfinished?: "keep" | "backlog" | "next_sprint";
  nextSprintId?: string | null;
};


async function requireSprintOwner(projectId: string, userId: string) {
  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) throw new Error("Project not found");
  // Inherited org admins plan and run a child project's sprints too (report §15.5).
  if (!access.isOwner && access.memberRole !== "admin" && !access.isInheritedAdmin)
    throw new Error("Only a project owner or admin can manage the Sprint lifecycle");
}


async function readLifecycleSprint(projectId: string, sprintId: string) {
  const sprint = await readProjectSprintListItem(projectId, sprintId);
  if (!sprint) throw new Error("Sprint not found");
  return sprint;
}


export async function completeSprintAction(
  sprintId: string,
  projectId: string,
  options: CompleteSprintOptions = {},
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const unfinished = options.unfinished ?? "keep";
    const now = new Date();
    await db.transaction(async (tx) => {
      // A close-out can move or detach work, so the UI restriction must be
      // enforced here as well. This also prevents a stale tab from closing a
      // sprint before its scheduled end date.
      const activeSprint = await tx.query.projectSprints.findFirst({
        where: and(
          eq(projectSprints.id, sprintId),
          eq(projectSprints.projectId, projectId),
          eq(projectSprints.status, "active"),
        ),
        columns: { endDate: true },
      });
      if (!activeSprint) throw new Error("Only an Active sprint can be completed");
      // The same inclusive end-of-day (UTC) rule the sprint page uses to offer close-out.
      if (!isSprintReadyToClose({ status: "active", endDate: activeSprint.endDate?.toISOString() ?? null }, now)) {
        throw new Error("This sprint can be closed after its scheduled end date");
      }
      // Claim the transition first. The status predicate serializes
      // duplicate completion requests before memberships are moved or
      // a second lifecycle event can be written.
      const [completed] = await tx
        .update(projectSprints)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            eq(projectSprints.status, "active"),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!completed) throw new Error("Only an Active sprint can be completed");
      if (unfinished === "next_sprint") {
        if (!options.nextSprintId || options.nextSprintId === sprintId)
          throw new Error("Choose a different Planning sprint");
        const target = await tx.query.projectSprints.findFirst({
          where: and(
            eq(projectSprints.id, options.nextSprintId),
            eq(projectSprints.projectId, projectId),
            eq(projectSprints.status, "planning"),
          ),
          columns: { id: true },
        });
        if (!target)
          throw new Error("The destination must be a Planning sprint");
      }
      if (unfinished !== "keep") {
        const unfinishedTasks = await tx.query.tasks.findMany({
          where: and(
            eq(tasks.projectId, projectId),
            eq(tasks.sprintId, sprintId),
            isNull(tasks.deletedAt),
            sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
          ),
          columns: { id: true },
        });
        const unfinishedIds = unfinishedTasks.map((task) => task.id);
        if (unfinishedIds.length > 0) {
          await tx
            .update(sprintTaskMemberships)
            .set({ removedAt: now, removedBy: user.id })
            .where(
              and(
                eq(sprintTaskMemberships.sprintId, sprintId),
                inArray(sprintTaskMemberships.taskId, unfinishedIds),
                isNull(sprintTaskMemberships.removedAt),
              ),
            );
          if (unfinished === "next_sprint" && options.nextSprintId) {
            await tx.insert(sprintTaskMemberships).values(
              unfinishedIds.map((taskId) => ({
                projectId,
                sprintId: options.nextSprintId!,
                taskId,
                addedBy: user.id,
                addedAt: now,
              })),
            );
          }
          await tx
            .update(tasks)
            .set({
              sprintId:
                unfinished === "next_sprint" ? options.nextSprintId : null,
              updatedAt: now,
            })
            .where(inArray(tasks.id, unfinishedIds));
        }
      }
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "completed",
        payload: { unfinished, nextSprintId: options.nextSprintId ?? null },
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    await enqueueProjectNotificationBestEffort(
      {
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.completed",
        title: `Sprint completed: ${sprint.name}`,
        body:
          unfinished === "backlog"
            ? "Unfinished work moved to the backlog."
            : unfinished === "next_sprint"
              ? "Unfinished work moved to the next Planning sprint."
              : "The Sprint scope was preserved for review.",
        sourceEventId: `${sprintId}:completed:${sprint.completedAt ?? now.toISOString()}`,
        entityRefs: { projectId, sprintId },
      },
      { sprintId },
    );
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "complete",
      success: true,
      unfinished,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "complete",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to complete sprint",
    });
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Failed to complete sprint",
    };
  }
}


export async function archiveSprintAction(sprintId: string, projectId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(projectSprints)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            or(
              eq(projectSprints.status, "completed"),
              eq(projectSprints.status, "cancelled"),
            ),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated)
        throw new Error("Complete or cancel the Sprint before archiving it");
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "archived",
        payload: {},
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "archive",
      success: true,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "archive",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to archive sprint",
    });
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Failed to archive sprint",
    };
  }
}


export async function cancelSprintAction(sprintId: string, projectId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(projectSprints)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            or(
              eq(projectSprints.status, "planning"),
              eq(projectSprints.status, "active"),
            ),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated)
        throw new Error("Only a Planning or Active sprint can be cancelled");

      const currentTasks = await tx.query.tasks.findMany({
        where: and(
          eq(tasks.projectId, projectId),
          eq(tasks.sprintId, sprintId),
          isNull(tasks.deletedAt),
        ),
        columns: { id: true },
      });
      const taskIds = currentTasks.map((task) => task.id);
      await tx
        .update(sprintTaskMemberships)
        .set({ removedAt: now, removedBy: user.id })
        .where(
          and(
            eq(sprintTaskMemberships.sprintId, sprintId),
            isNull(sprintTaskMemberships.removedAt),
          ),
        );
      if (taskIds.length > 0) {
        await tx
          .update(tasks)
          .set({ sprintId: null, updatedAt: now })
          .where(inArray(tasks.id, taskIds));
      }
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "cancelled",
        payload: { returnedTaskCount: taskIds.length },
        createdAt: now,
      });
      // Linked child sprints become ordinary sprints (report §15.3, Cancel).
      await unlinkSprints(tx, { orgSprintId: sprintId });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "cancel",
      success: true,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "cancel",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to cancel sprint",
    });
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to cancel sprint",
    };
  }
}


// --- Org sprints (report §15) ---

/** "Plan a series" on an organization: CO1–CO5 back to back, as planned sprints that never overlap. */
export async function planSprintSeriesAction(input: { projectId: string; prefix: string; count: number; lengthDays: number; startDate: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const prefix = input.prefix.trim().slice(0, 40);
    if (!prefix) throw new Error("Enter a name prefix, for example CO.");
    const series = buildSprintSeries({ ...input, prefix });
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${projects} WHERE id = ${input.projectId} FOR UPDATE`);
      const [project] = await tx.select({ kind: projects.kind }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
      if (project?.kind !== "organization") throw new Error("Series are planned on an organization.");
      for (const item of series) {
        const startDate = parseSprintDateInput(item.startDate);
        const endDate = parseSprintDateInput(item.endDate);
        await assertOrgSprintRules(tx, { projectId: input.projectId, startDate, endDate });
        const [created] = await tx.insert(projectSprints).values({
          projectId: input.projectId,
          creatorId: user.id,
          sprintNumber: sql<number>`(SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM ${projectSprints} WHERE project_id = ${input.projectId})`,
          name: item.name,
          startDate,
          endDate,
          status: "planning",
        }).returning({ id: projectSprints.id });
        await tx.insert(projectSprintEvents).values({
          projectId: input.projectId,
          sprintId: created!.id,
          actorId: user.id,
          eventType: "created",
          payload: { name: item.name, status: "planning", source: "series", startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        });
      }
    });
    await revalidateProjectPaths(input.projectId);
    return { success: true as const, created: series.length };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Failed to plan the series" };
  }
}

/** Starts a planned sprint now, for sprints with "Start automatically" off or started early (report §15.8). */
export async function startSprintNowAction(sprintId: string, projectId: string) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(projectId, user.id);
    const started = await startSprint(sprintId, projectId, new Date(), user.id, "manual");
    if (!started) throw new Error("Only a planned sprint can start, and only when no other sprint is active.");
    await revalidateProjectPaths(projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Failed to start the sprint" };
  }
}

/** Attach one of the project's files or docs to a sprint as a material (owners and admins). */
export async function addSprintMaterialAction(input: { projectId: string; sprintId: string; nodeId?: string; docId?: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    if (Boolean(input.nodeId) === Boolean(input.docId)) throw new Error("Pick one file or doc.");
    const [sprint] = await db.select({ id: projectSprints.id }).from(projectSprints)
      .where(and(eq(projectSprints.id, input.sprintId), eq(projectSprints.projectId, input.projectId))).limit(1);
    if (!sprint) throw new Error("Sprint not found");
    const target = input.nodeId
      ? await db.select({ id: projectNodes.id }).from(projectNodes).where(and(eq(projectNodes.id, input.nodeId), eq(projectNodes.projectId, input.projectId), isNull(projectNodes.deletedAt))).limit(1)
      : await db.select({ id: projectDocs.id }).from(projectDocs).where(and(eq(projectDocs.id, input.docId!), eq(projectDocs.projectId, input.projectId))).limit(1);
    if (target.length === 0) throw new Error("That file or doc isn't in this project.");
    await db.insert(sprintMaterials).values({ sprintId: input.sprintId, nodeId: input.nodeId ?? null, docId: input.docId ?? null, addedBy: user.id }).onConflictDoNothing();
    await revalidateProjectPaths(input.projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Failed to add the material" };
  }
}

export async function removeSprintMaterialAction(input: { projectId: string; materialId: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    await db.delete(sprintMaterials).where(and(
      eq(sprintMaterials.id, input.materialId),
      sql`${sprintMaterials.sprintId} IN (SELECT id FROM ${projectSprints} WHERE project_id = ${input.projectId})`,
    ));
    await revalidateProjectPaths(input.projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Failed to remove the material" };
  }
}

/** Files and docs to pick from when adding a material, by name. */
export async function searchSprintMaterialCandidatesAction(input: { projectId: string; query: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const pattern = `%${input.query.trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [files, docs] = await Promise.all([
      db.select({ id: projectNodes.id, title: projectNodes.name }).from(projectNodes)
        .where(and(eq(projectNodes.projectId, input.projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt), isNull(projectNodes.taskId), ilike(projectNodes.name, pattern)))
        .limit(20),
      db.select({ id: projectDocs.id, title: projectDocs.filename }).from(projectDocs)
        .where(and(eq(projectDocs.projectId, input.projectId), ilike(projectDocs.filename, pattern)))
        .limit(10),
    ]);
    return { success: true as const, files, docs };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Search failed", files: [], docs: [] };
  }
}

async function getAuthUserOrThrow() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}
