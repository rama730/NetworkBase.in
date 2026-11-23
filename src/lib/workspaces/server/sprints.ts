import { assertOrgSprintRules, createMatchingChildSprints, readSprintMaterials, readSprintOrgContext, saveSprintSharing, unlinkSprints } from "@/lib/organizations/sprints";
import { notifyOrg, remindedRecently } from "@/lib/organizations/notify";
import { buildSprintSeries, nextSeriesNumber } from "@/lib/organizations/sprint-rules";
import { readOrgWork } from "@/lib/organizations/settings";
import { readViewerOrgRole } from "@/lib/organizations/detail";
import { orgCan, orgRoleOf } from "@/lib/organizations/permissions";
import { startSprint } from "@/lib/workspaces/sprint-schedule";
import { postOrgAnnouncement } from "@/lib/organizations/org-updates";
import { notifyChildSprintsUnlinked, notifyLinkedSprintsOutside, notifyOrgSprintCompleted, orgSprintNotifyDefault, readLinkedChildSprints, shiftOrgSprintDueDates, type LinkedChildSprint } from "@/lib/organizations/sprint-notify";
import "server-only";
import { assignmentColumn, readAssignmentStages, readMasterProgress } from "@/lib/organizations/assignments";

import { isMissingRelationError } from "@/lib/db/errors";
import { db } from "@/lib/db";
import { sql, and, eq, inArray, desc, ilike, isNotNull, isNull, ne, or } from "drizzle-orm";
import { getWorkspaceAccessById, assertWorkspaceTabReadAccess, type WorkspaceAccess, canReadWorkspaceTab, WorkspaceTabForbiddenError } from "@/lib/data/workspace-access";
/** The signed-in person, from the app's session or a CLI token on the sprint routes (report F2, A2.1). */
async function sprintUser() {
  return (await getViewerAuthContext()).user;
}
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { type SprintTaskTimelineEntity, type SprintListItem, buildSprintHealthSummary, type SprintDetailPayload, buildSprintPermissionSet } from "@/lib/workspaces/sprint-detail";
import { workspaceSprintEvents, workspaceSprints, profiles, workspaceMembers, sprintTaskMemberships, tasks, taskNodeLinks, workspaceNodes, taskSubtasks, workspaces, workspaceDocuments, sprintMaterials } from "@/lib/db/schema";
import { toDateValue, toIsoString } from "@/lib/utils/date";
import { z } from "zod";
import { inferTaskFileRole } from "@/lib/workspaces/task-file-intelligence";
import { type SprintTimelineTaskInput, buildSprintTimeline } from "@/lib/workspaces/sprint-timeline";
import { recordSprintMetric } from "@/lib/workspaces/sprint-observability";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isWorkspaceTabVisibleToViewer } from "@/lib/workspaces/settings-policies";
import { type CreateSprintInput, createSprintSchema, parseSprintDateInput, type UpdateSprintInput, updateSprintSchema, type DeleteSprintResult, deleteSprintSchema } from "@/lib/workspaces/sprints";
import { isMissingColumn, resolveWorkspaceDetailTarget, resolveWorkspaceDetailViewerState, actorNotificationSnapshot, revalidateWorkspacePaths, enqueueWorkspaceNotificationBestEffort } from "./common";

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


async function assertWorkspaceReadAccess(
  projectId: string,
  userId: string | null,
) {
  const access = await getWorkspaceAccessById(projectId, userId);
  if (!access.project) throw new Error("Workspace not found");
  if (!access.canRead) throw new Error("You don’t have access to this");
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


export async function fetchWorkspaceSprintsAction(
  projectId: string,
  limit: number = 120,
) {
  try {
    const user = await sprintUser();
    const actorId = user?.id ?? null;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    return await runInFlightDeduped(
      `project:sprints:${projectId}:${actorId ?? "anon"}:${safeLimit}`,
      async () => {
        await assertWorkspaceTabReadAccess(projectId, actorId, "sprints");

        const projectSprintsList = await readProjectSprintsList(
          projectId,
          safeLimit,
        );

        return { success: true as const, sprints: projectSprintsList };
      },
    );
  } catch (error) {
    console.error("Failed to fetch sprints:", error);
    return { success: false as const, error: "Couldn’t fetch sprints" };
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
  kind: string | null;
  assignment_id: string | null;
  assignment_settings: { publishedAt?: string | null; closedAt?: string | null; publishAt?: string | null } | null;
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
    LEFT JOIN workspace_open_roles por ON por.id = ra.role_id
    WHERE ra.workspace_id = ${projectId}
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
  parentSprintId?: string | null;
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
    parentSprintId: sprint.parentSprintId ?? null,
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
        sprintId: workspaceSprintEvents.sprintId,
        actorId: workspaceSprintEvents.actorId,
        payload: workspaceSprintEvents.payload,
      })
      .from(workspaceSprintEvents)
      .where(
        and(
          eq(workspaceSprintEvents.projectId, projectId),
          eq(workspaceSprintEvents.eventType, "created"),
          inArray(workspaceSprintEvents.sprintId, missingSprintIds),
        ),
      )
      .orderBy(desc(workspaceSprintEvents.createdAt));
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
    if (isMissingTable(error, "workspace_sprint_events")) return sprints;
    throw error;
  }
}


async function readProjectSprintsList(projectId: string, limit: number) {
  const readSprints = async (supportsDescription: boolean) => {
    if (supportsDescription) {
      return db
        .select({
          id: workspaceSprints.id,
          projectId: workspaceSprints.projectId,
          creatorId: workspaceSprints.creatorId,
          sprintNumber: workspaceSprints.sprintNumber,
          name: workspaceSprints.name,
          goal: workspaceSprints.goal,
          description: workspaceSprints.description,
          startDate: workspaceSprints.startDate,
          endDate: workspaceSprints.endDate,
          status: workspaceSprints.status,
          startedAt: workspaceSprints.startedAt,
          completedAt: workspaceSprints.completedAt,
          archivedAt: workspaceSprints.archivedAt,
          cancelledAt: workspaceSprints.cancelledAt,
          parentSprintId: workspaceSprints.parentSprintId,
          createdAt: workspaceSprints.createdAt,
          updatedAt: workspaceSprints.updatedAt,
          creatorName: profiles.fullName,
          creatorAvatarUrl: profiles.avatarUrl,
          creatorRole: workspaceMembers.role,
          creatorRoleTitle: acceptedRoleTitleSql(
            projectId,
            workspaceSprints.creatorId,
          ),
        })
        .from(workspaceSprints)
        .leftJoin(profiles, eq(profiles.id, workspaceSprints.creatorId))
        .leftJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.userId, workspaceSprints.creatorId),
            eq(workspaceMembers.projectId, projectId),
          ),
        )
        .where(eq(workspaceSprints.projectId, projectId))
        .orderBy(
          sql`CASE WHEN ${workspaceSprints.status} = 'active' THEN 0 WHEN ${workspaceSprints.status} = 'planning' THEN 1 ELSE 2 END`,
          desc(workspaceSprints.createdAt),
        )
        .limit(limit);
    }

    return db
      .select({
        id: workspaceSprints.id,
        projectId: workspaceSprints.projectId,
        creatorId: workspaceSprints.creatorId,
        sprintNumber: workspaceSprints.sprintNumber,
        name: workspaceSprints.name,
        goal: workspaceSprints.goal,
        startDate: workspaceSprints.startDate,
        endDate: workspaceSprints.endDate,
        status: workspaceSprints.status,
        startedAt: workspaceSprints.startedAt,
        completedAt: workspaceSprints.completedAt,
        archivedAt: workspaceSprints.archivedAt,
        cancelledAt: workspaceSprints.cancelledAt,
        parentSprintId: workspaceSprints.parentSprintId,
        createdAt: workspaceSprints.createdAt,
        updatedAt: workspaceSprints.updatedAt,
        creatorName: profiles.fullName,
        creatorAvatarUrl: profiles.avatarUrl,
        creatorRole: workspaceMembers.role,
        creatorRoleTitle: acceptedRoleTitleSql(
          projectId,
          workspaceSprints.creatorId,
        ),
      })
      .from(workspaceSprints)
      .leftJoin(profiles, eq(profiles.id, workspaceSprints.creatorId))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, workspaceSprints.creatorId),
          eq(workspaceMembers.projectId, projectId),
        ),
      )
      .where(eq(workspaceSprints.projectId, projectId))
      .orderBy(
        sql`CASE WHEN ${workspaceSprints.status} = 'active' THEN 0 WHEN ${workspaceSprints.status} = 'planning' THEN 1 ELSE 2 END`,
        desc(workspaceSprints.createdAt),
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
          id: workspaceSprints.id,
          projectId: workspaceSprints.projectId,
          creatorId: workspaceSprints.creatorId,
          sprintNumber: workspaceSprints.sprintNumber,
          name: workspaceSprints.name,
          goal: workspaceSprints.goal,
          description: workspaceSprints.description,
          startDate: workspaceSprints.startDate,
          endDate: workspaceSprints.endDate,
          status: workspaceSprints.status,
          startedAt: workspaceSprints.startedAt,
          completedAt: workspaceSprints.completedAt,
          archivedAt: workspaceSprints.archivedAt,
          cancelledAt: workspaceSprints.cancelledAt,
          parentSprintId: workspaceSprints.parentSprintId,
          createdAt: workspaceSprints.createdAt,
          updatedAt: workspaceSprints.updatedAt,
          creatorName: profiles.fullName,
          creatorAvatarUrl: profiles.avatarUrl,
          creatorRole: workspaceMembers.role,
          creatorRoleTitle: acceptedRoleTitleSql(
            projectId,
            workspaceSprints.creatorId,
          ),
        })
        .from(workspaceSprints)
        .leftJoin(profiles, eq(profiles.id, workspaceSprints.creatorId))
        .leftJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.userId, workspaceSprints.creatorId),
            eq(workspaceMembers.projectId, projectId),
          ),
        )
        .where(
          and(
            eq(workspaceSprints.id, sprintId),
            eq(workspaceSprints.projectId, projectId),
          ),
        )
        .limit(1);
    }

    return db
      .select({
        id: workspaceSprints.id,
        projectId: workspaceSprints.projectId,
        creatorId: workspaceSprints.creatorId,
        sprintNumber: workspaceSprints.sprintNumber,
        name: workspaceSprints.name,
        goal: workspaceSprints.goal,
        startDate: workspaceSprints.startDate,
        endDate: workspaceSprints.endDate,
        status: workspaceSprints.status,
        startedAt: workspaceSprints.startedAt,
        completedAt: workspaceSprints.completedAt,
        archivedAt: workspaceSprints.archivedAt,
        cancelledAt: workspaceSprints.cancelledAt,
        parentSprintId: workspaceSprints.parentSprintId,
        createdAt: workspaceSprints.createdAt,
        updatedAt: workspaceSprints.updatedAt,
        creatorName: profiles.fullName,
        creatorAvatarUrl: profiles.avatarUrl,
        creatorRole: workspaceMembers.role,
        creatorRoleTitle: acceptedRoleTitleSql(
          projectId,
          workspaceSprints.creatorId,
        ),
      })
      .from(workspaceSprints)
      .leftJoin(profiles, eq(profiles.id, workspaceSprints.creatorId))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, workspaceSprints.creatorId),
          eq(workspaceMembers.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(workspaceSprints.id, sprintId),
          eq(workspaceSprints.projectId, projectId),
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


/** A sprint's counts; a main sprint's include the sprints inside it (board/review report §6). */
async function readSprintSummary(sprintId: string, insideIds: string[] = []) {
  const ids = [sprintId, ...insideIds];
  const rows = await db.execute<SprintSummaryQueryRow>(sql`
        WITH in_sprint AS (
            SELECT DISTINCT t.id, t.kind, t.assignment_id, t.status, t.review_status, t.story_points
            FROM ${sprintTaskMemberships} m
            JOIN ${tasks} t ON t.id = m.task_id AND t.deleted_at IS NULL
            WHERE m.sprint_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) AND m.removed_at IS NULL
        ), sprint_tasks AS (
            -- An assignment counts by its copies, never its main task, which never finishes (report §42.12 problem 25).
            SELECT DISTINCT ON (id) id, status, review_status, story_points FROM (
                SELECT id, status, review_status, story_points FROM in_sprint
                WHERE NOT (kind = 'assignment' AND assignment_id IS NULL)
                UNION ALL
                SELECT c.id, c.status, c.review_status, c.story_points FROM ${tasks} c
                WHERE c.assignment_id IN (SELECT id FROM in_sprint WHERE kind = 'assignment' AND assignment_id IS NULL)
                  AND c.deleted_at IS NULL AND c.excused_at IS NULL
            ) counted
        )
        SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE st.status = 'done' AND st.review_status <> 'pending')::int AS completed_tasks,
            COUNT(*) FILTER (WHERE st.status = 'blocked')::int AS blocked_tasks,
            (
                SELECT COUNT(*)::int
                FROM ${taskNodeLinks} lnk
                JOIN ${workspaceNodes} node ON node.id = lnk.node_id AND node.deleted_at IS NULL
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


/** Sprint redesign §8.2: open work per assignee (assignments are the class's, not one person's). */
async function readSprintPeople(sprintId: string) {
  const rows = await db.execute<{ id: string | null; name: string | null; avatar_url: string | null; open_tasks: number; open_points: number }>(sql`
        SELECT t.assignee_id AS id, coalesce(p.full_name, p.username) AS name, p.avatar_url,
               count(*)::int AS open_tasks, coalesce(sum(t.story_points), 0)::int AS open_points
        FROM ${sprintTaskMemberships} m
        JOIN ${tasks} t ON t.id = m.task_id AND t.deleted_at IS NULL
        LEFT JOIN ${profiles} p ON p.id = t.assignee_id
        WHERE m.sprint_id = ${sprintId} AND m.removed_at IS NULL AND t.kind <> 'assignment' AND t.assignment_id IS NULL
          AND NOT (t.status = 'done' AND t.review_status <> 'pending')
        GROUP BY t.assignee_id, p.full_name, p.username, p.avatar_url
        ORDER BY open_points DESC, open_tasks DESC, name`);
  const people = rows.filter((r) => r.id).map((r) => ({ id: r.id!, name: r.name ?? "Someone", avatarUrl: r.avatar_url, openTasks: Number(r.open_tasks), openPoints: Number(r.open_points) }));
  const none = rows.find((r) => !r.id);
  return { people, unassigned: { tasks: Number(none?.open_tasks ?? 0), points: Number(none?.open_points ?? 0) } };
}

/** Sprint redesign §8.4: points the last three closed sprints finished, newest first. */
async function readSprintVelocity(projectId: string) {
  const rows = await db.execute<{ points: number }>(sql`
        SELECT coalesce((SELECT sum(t.story_points) FROM ${sprintTaskMemberships} m JOIN ${tasks} t ON t.id = m.task_id AND t.deleted_at IS NULL
                         WHERE m.sprint_id = s.id AND m.removed_at IS NULL AND t.status = 'done' AND t.review_status <> 'pending'), 0)::int AS points
        FROM ${workspaceSprints} s
        WHERE s.workspace_id = ${projectId} AND s.status = 'completed'
        ORDER BY s.completed_at DESC NULLS LAST LIMIT 3`);
  const points = rows.map((r) => Number(r.points));
  return { last: points[0] ?? null, average: points.length ? Math.round(points.reduce((a, b) => a + b, 0) / points.length) : null };
}

/** Sprint redesign §8.3: open work with no sprint (tasks, and main assignments on an organization's board), newest first. */
export async function readSprintBacklogAction(input: { projectId: string; query: string }): Promise<{ success: true; rows: import("@/lib/workspaces/sprint-detail").SprintBacklogRow[] } | { success: false; error: string }> {
  const { userId } = await getViewerAuthContext();
  if (!userId) return { success: false, error: "Sign in to continue" };
  const access = await getWorkspaceAccessById(input.projectId, userId);
  if (!access.project || !canReadWorkspaceTab(access, "tasks") || !(access.isOwner || access.isMember || access.isInheritedAdmin)) return { success: false, error: "You can’t see this workspace’s tasks." };
  const query = input.query.trim().slice(0, 100);
  const rows = await db.execute<{ id: string; title: string; story_points: number | null; assignee: string | null; status: string; kind: string }>(sql`
        SELECT t.id, t.title, t.story_points, coalesce(p.full_name, p.username) AS assignee, t.status, t.kind
        FROM ${tasks} t LEFT JOIN ${profiles} p ON p.id = t.assignee_id
        WHERE t.workspace_id = ${input.projectId} AND t.deleted_at IS NULL AND t.sprint_id IS NULL AND t.assignment_id IS NULL
          AND t.status <> 'done' ${query ? sql`AND t.title ILIKE ${`%${query.replace(/[%_\\]/g, "\\$&")}%`}` : sql``}
        ORDER BY t.updated_at DESC LIMIT 100`);
  return { success: true, rows: rows.map((r) => ({ id: r.id, title: r.title, storyPoints: r.story_points == null ? null : Number(r.story_points), assignee: r.assignee, status: r.status as import("@/lib/workspaces/sprint-detail").SprintTaskStatus, kind: r.kind === "assignment" ? "assignment" : "task" })) };
}

async function readSprintTaskActivityPage(input: {
  projectId: string;
  sprintId: string;
  limit: number;
  cursor: SprintDetailPaginationCursor | null;
  taskReference?: string | null;
  access: WorkspaceAccess;
}) {
  const { sprintId, limit, cursor } = input;
  // The board's rule (report §42.12 problem 24): in an organization, members see published masters and their own
  // copies; admins see every master, with copies left to the roster.
  const orgRule = input.access.project?.kind !== "organization"
    ? sql``
    : input.access.isOwner || input.access.memberRole === "admin"
      ? sql`AND t.assignment_id IS NULL`
      : sql`AND app_private.nb_org_task_visible_to(t.id, ${input.access.viewerId ?? null}::uuid)`;

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
                t.workspace_id AS project_id,
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
                t.kind,
                t.assignment_id,
                t.assignment_settings,
                COALESCE(m.added_at, t.created_at) AS activity_at,
                m.removed_at AS membership_removed_at,
                0::int AS linked_file_count
            FROM ${tasks} t
            INNER JOIN memberships m ON m.task_id = t.id
            WHERE t.workspace_id = ${input.projectId} ${orgRule}
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
                t.workspace_id AS project_id,
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
                t.kind,
                t.assignment_id,
                t.assignment_settings,
                COALESCE(m.added_at, t.created_at) AS activity_at,
                m.removed_at AS membership_removed_at,
                0::int AS linked_file_count
            FROM ${tasks} t
            INNER JOIN memberships m ON m.task_id = t.id
            WHERE t.workspace_id = ${input.projectId} AND ${targetCondition} ${orgRule}
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
            tnl.linked_at AS "linkedAt",
            tnl.annotation,
            tnl.tags,
            fv.version AS "latestVersion",
            p.id AS "uploaderId",
            p.full_name AS "uploaderName",
            p.avatar_url AS "uploaderAvatarUrl"
          FROM task_node_links tnl
          INNER JOIN workspace_nodes pn ON pn.id = tnl.node_id AND pn.workspace_id = ${input.projectId}::uuid AND pn.deleted_at IS NULL
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
  // Live-fix 31: a main assignment shows its class progress ("12/40"), not "Unassigned".
  const isMaster = (row: (typeof pageRows)[number]) => row.kind === "assignment" && !row.assignment_id;
  const progressByMaster = await readMasterProgress(pageRows.filter(isMaster).map((row) => row.id));
  // Sprint cleanup §4: every stage for main assignments, and each copy's own stage.
  const { stages: stagesByMaster, copies: stageByCopy } = await readAssignmentStages(pageRows.filter(isMaster).map((row) => row.id), pageRows.filter((row) => row.assignment_id).map((row) => row.id));
  // A main assignment's column comes from its copies, as on the board; its own stored status means nothing.
  const masterStatus = (row: (typeof pageRows)[number]) => {
    const p = progressByMaster.get(row.id);
    return assignmentColumn({ draft: !row.assignment_settings?.publishedAt, closed: Boolean(row.assignment_settings?.closedAt), started: p?.started ?? 0, done: p?.done ?? 0, total: p?.total ?? 0 });
  };

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
    status: isMaster(row) ? masterStatus(row) : row.status,
    reviewStatus: isMaster(row) ? "none" : row.review_status,
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
    // Nobody has it yet reads 0/0 ("Nobody has joined yet"), never "Unassigned".
    // Sprint work list redesign (2026-11-09): plus draft, scheduled and closed, for the same chip as the board's.
    assignmentProgress: isMaster(row) ? { done: progressByMaster.get(row.id)?.done ?? 0, total: progressByMaster.get(row.id)?.total ?? 0,
      draft: !row.assignment_settings?.publishedAt, scheduled: Boolean(!row.assignment_settings?.publishedAt && row.assignment_settings?.publishAt), closed: Boolean(row.assignment_settings?.closedAt) } : null,
    assignmentStages: isMaster(row) ? stagesByMaster.get(row.id) ?? null : null,
    copyStage: row.assignment_id ? stageByCopy.get(row.id) ?? null : null,
    assignmentId: row.assignment_id ?? null,
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
  access: WorkspaceAccess;
  sprintId?: string | null;
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
}): Promise<SprintDetailPayload | null> {
  const safeLimit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);

  const access = input.access;
  if (!access.project) throw new Error("Workspace not found");
  if (!canReadWorkspaceTab(access, "sprints")) throw new WorkspaceTabForbiddenError("sprints");
  // Sprints visibility exposes sprint list and health; task rows also need Tasks visibility (COR-043).
  const showTasks = canReadWorkspaceTab(access, "tasks");
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

  const mainSprint = selectedSprint.parentSprintId ? sprints.find((sprint) => sprint.id === selectedSprint.parentSprintId) ?? null : null;
  // Board/review report §6: a main sprint lists the sprints inside it, each with its own count, and counts them all.
  const inside = sprints.filter((sprint) => sprint.parentSprintId === selectedSprint.id && sprint.status !== "cancelled" && sprint.status !== "archived")
    .sort((a, b) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime());
  const children = await Promise.all(inside.map(async (sprint) => {
    const own = await readSprintSummary(sprint.id);
    return { id: sprint.id, name: sprint.name, code: sprint.code, status: sprint.status, startDate: sprint.startDate, endDate: sprint.endDate, done: own.completedTasks, total: own.totalTasks };
  }));
  const [summary, taskPage, org, materials, load, velocity] = await Promise.all([
    readSprintSummary(selectedSprint.id, inside.map((sprint) => sprint.id)),
    showTasks ? readSprintTaskActivityPage({
      projectId: input.projectId,
      sprintId: selectedSprint.id,
      limit: safeLimit,
      cursor: parsedCursor,
      taskReference: input.taskReference,
      access,
    }) : Promise.resolve(NO_SPRINT_TASK_PAGE),
    readSprintOrgContext(input.projectId, selectedSprint.id),
    // Visitors get sprint names, goals and dates only: no materials or linked projects (report §15.4).
    // Board/review report §6: a sprint inside a CO shows the CO's materials beside its own.
    isSprintInsider ? Promise.all([readSprintMaterials(selectedSprint.id, access), mainSprint ? readSprintMaterials(mainSprint.id, access) : Promise.resolve([])])
      .then(([own, fromMain]) => [...own, ...fromMain.map((m) => ({ ...m, fromMain: mainSprint!.name }))]) : Promise.resolve([]),
    // Who carries what is for the team, not visitors (report §15.4).
    isSprintInsider && showTasks ? readSprintPeople(selectedSprint.id) : Promise.resolve(null),
    isSprintInsider ? readSprintVelocity(input.projectId) : Promise.resolve(null),
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
    ...(load ? { people: load.people, unassigned: load.unassigned } : {}),
    ...(velocity ? { velocity } : {}),
    ...(children.length ? { children, openAssignments: await countOpenAssignments([selectedSprint.id, ...inside.map((sprint) => sprint.id)]) } : {}),
  };
}


async function buildSprintTimelinePagePayload(input: {
  projectId: string;
  access: WorkspaceAccess;
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
  if (!access.project) throw new Error("Workspace not found");
  if (!canReadWorkspaceTab(access, "sprints")) throw new WorkspaceTabForbiddenError("sprints");
  // Sprints visibility exposes sprint list and health; task rows also need Tasks visibility (COR-043).
  const showTasks = canReadWorkspaceTab(access, "tasks");

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
      access,
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


export async function fetchWorkspaceSprintDetailAction(input: {
  projectId: string;
  sprintId?: string | null;
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const user = await sprintUser();
    const actorId = user?.id ?? null;
    const cursorKey = input.cursor ?? "head";
    const sprintKey = input.sprintId ?? "default";

    const startedAt = Date.now();
    const taskKey = input.taskReference?.trim() || "none";
    const data = await runInFlightDeduped(
      `project:sprint-detail:${input.projectId}:${sprintKey}:${taskKey}:${actorId ?? "anon"}:${cursorKey}:${input.limit ?? 30}`,
      async () => {
        const access = await getWorkspaceAccessById(input.projectId, actorId);
        if (!access.project) {
          throw new Error("Workspace not found");
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
    return { success: false as const, error: "Couldn’t fetch sprint detail" };
  }
}


export async function fetchWorkspaceSprintTimelinePageAction(input: {
  projectId: string;
  sprintId: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const user = await sprintUser();
    const actorId = user?.id ?? null;
    const cursorKey = input.cursor ?? "head";
    const sprintKey = input.sprintId ?? "default";
    const startedAt = Date.now();

    const data = await runInFlightDeduped(
      `project:sprint-timeline-page:${input.projectId}:${sprintKey}:${actorId ?? "anon"}:${cursorKey}:${input.limit ?? 30}`,
      async () => {
        const access = await getWorkspaceAccessById(input.projectId, actorId);
        if (!access.project) {
          throw new Error("Workspace not found");
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
      error: "Couldn’t fetch sprint timeline page",
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
export async function readWorkspaceSprintDetail(input: ProjectSprintDetailInput) {
  const { userId } = await getViewerAuthContext();
  return readProjectSprintDetailForActor({ ...input, actorUserId: userId });
}


async function readProjectSprintDetailForActor(input: ProjectSprintDetailInput & { actorUserId: string | null }) {
  try {
    const project = await resolveWorkspaceDetailTarget(
      input.slugOrId,
      input.actorUserId ?? null,
    );
    if (!project) {
      return {
        success: false as const,
        errorCode: "NOT_FOUND" as const,
        message: "Workspace not found.",
      };
    }

    const parentOrgRole = project.parentId ? await readViewerOrgRole(project.parentId, input.actorUserId ?? null) : null;
    const viewerState = resolveWorkspaceDetailViewerState({
      projectId: project.id,
      ownerId: project.ownerId,
      visibility: project.visibility,
      status: project.status,
      actorUserId: input.actorUserId ?? null,
      memberRoleRaw: project.memberRole,
      memberCompletedAt: (project as { memberCompletedAt?: Date | string | null }).memberCompletedAt ?? null,
      isFollowed: project.isFollowed,
      parentOrgRole,
    });

    if (!viewerState.canRead) {
      return {
        success: false as const,
        errorCode: "FORBIDDEN" as const,
        message: "You don’t have access to this",
      };
    }
    if (
      !isWorkspaceTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: viewerState.isOwner || viewerState.isMember || parentOrgRole === "owner" || parentOrgRole === "admin",
        publicTabVisibility: project.publicTabVisibility,
        isOrganization: project.kind === "organization",
      })
    ) {
      return {
        success: false as const,
        errorCode: "FORBIDDEN" as const,
        message: "Sprint details are members-only for this workspace.",
      };
    }

    const access = await assertWorkspaceReadAccess(
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
    console.error("[readWorkspaceSprintDetail] failed", error);
    return {
      success: false as const,
      errorCode: "INTERNAL_ERROR" as const,
      message: "Couldn’t load sprint detail.",
    };
  }
}


export async function createSprintAction(data: CreateSprintInput) {
  let actorIdForMetric: string | null = null;
  try {
    const user = await sprintUser();
    if (!user) throw new Error("Sign in to continue");
    actorIdForMetric = user.id;

    const validated = createSprintSchema.parse(data);
    const startDate = parseSprintDateInput(validated.startDate);
    const endDate = parseSprintDateInput(validated.endDate);

    await requireSprintOwner(validated.projectId, user.id);

    const creator = actorNotificationSnapshot(user);
    const newSprint = await db.transaction(async (tx) => {
      // One project lock makes the human Sprint code stable under concurrent creates.
      await tx.execute(
        sql`SELECT id FROM ${workspaces} WHERE id = ${validated.projectId} FOR UPDATE`,
      );
      const numberRows = await tx.execute<{ next_number: number }>(sql`
                SELECT COALESCE(MAX(sprint_number), 0)::int + 1 AS next_number
                FROM ${workspaceSprints}
                WHERE workspace_id = ${validated.projectId}
            `);
      const sprintNumber = Number(Array.from(numberRows)[0]?.next_number ?? 1);
      const parentSprintId = await assertOrgSprintRules(tx, { projectId: validated.projectId, startDate, endDate, parentSprintId: validated.parentSprintId ?? null });
      const [created] = await tx
        .insert(workspaceSprints)
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
          showInChildren: validated.sharedWith ? validated.sharedWith !== "none" : validated.showInChildren ?? true,
          notifyOnStart: validated.notifyOnStart ?? (await orgSprintNotifyDefault(tx, validated.projectId)),
          parentSprintId,
        })
        .returning({ id: workspaceSprints.id });
      // Plan your sprint brings the group work (report §42.5, decision 131): the workspace's open group copies in
      // its backlog join a sprint inside an organization sprint.
      if (created && parentSprintId && validated.includeGroupWork) {
        const moved = await tx.update(tasks).set({ sprintId: created.id, updatedAt: new Date() })
          .where(and(eq(tasks.projectId, validated.projectId), isNotNull(tasks.assignmentId), isNull(tasks.sprintId), isNull(tasks.deletedAt), ne(tasks.status, "done")))
          .returning({ id: tasks.id });
        if (moved.length) await tx.insert(sprintTaskMemberships).values(moved.map((t) => ({ projectId: validated.projectId, sprintId: created.id, taskId: t.id, addedBy: user.id, addedAt: new Date() })));
      }
      if (created && validated.sharedWith) {
        await saveSprintSharing(tx, { orgId: validated.projectId, sprintId: created.id, sharedWith: validated.sharedWith, workspaceIds: validated.sharedWorkspaceIds ?? [] });
      }
      // Teams plan their own sprint inside it, in the workspaces it's shared with.
      if (created && validated.createMatching && validated.sharedWith !== "none") {
        await createMatchingChildSprints(tx, {
          orgId: validated.projectId,
          orgSprint: { id: created.id, name: validated.name, goal: validated.goal ?? null, startDate, endDate },
          actorId: user.id,
          ...(validated.sharedWith === "selected" ? { onlyWorkspaceIds: validated.sharedWorkspaceIds ?? [] } : {}),
        });
      }
      if (created) {
        await tx.insert(workspaceSprintEvents).values({
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
      throw new Error("Couldn’t create sprint");
    }

    const sprintListItem = await readProjectSprintListItem(
      validated.projectId,
      newSprint.id,
    );
    if (!sprintListItem) {
      throw new Error("Couldn’t load created sprint");
    }

    // Post an announcement (report §37.2), off by default; organizations only, after the sprint is saved.
    if (validated.announcement?.trim()) {
      const [project] = await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, validated.projectId)).limit(1);
      if (project?.kind === "organization") await postOrgAnnouncement(validated.projectId, user.id, validated.announcement);
    }
    await revalidateWorkspacePaths(validated.projectId);

    await enqueueWorkspaceNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.created",
        title: `Sprint created: ${sprintListItem.name}`,
        body: sprintListItem.goal ?? "A new sprint was added to the workspace.",
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
        error instanceof Error ? error.message : "Couldn’t create sprint",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Couldn’t create sprint",
    };
  }
}


export async function updateSprintAction(data: UpdateSprintInput) {
  let actorIdForMetric: string | null = null;
  const startedAt = Date.now();
  try {
    const user = await sprintUser();
    if (!user) throw new Error("Sign in to continue");
    actorIdForMetric = user.id;

    const validated = updateSprintSchema.parse(data);
    const startDate = parseSprintDateInput(validated.startDate);
    const endDate = parseSprintDateInput(validated.endDate);

    await requireSprintOwner(validated.projectId, user.id);

    const [existingSprint] = await db
      .select({
        id: workspaceSprints.id,
        projectId: workspaceSprints.projectId,
        status: workspaceSprints.status,
        parentSprintId: workspaceSprints.parentSprintId,
        startDate: workspaceSprints.startDate,
      })
      .from(workspaceSprints)
      .where(
        and(
          eq(workspaceSprints.id, validated.sprintId),
          eq(workspaceSprints.projectId, validated.projectId),
        ),
      )
      .limit(1);

    if (!existingSprint) {
      throw new Error("Sprint not found");
    }
    // A running sprint can still be renamed or extended (report §37.2); its start stays.
    if (existingSprint.status !== "planning" && existingSprint.status !== "active") {
      throw new Error("Completed, canceled, and archived Sprints are read-only");
    }
    if (existingSprint.status === "active" && startDate.toISOString().slice(0, 10) !== existingSprint.startDate.toISOString().slice(0, 10)) {
      throw new Error("A running sprint keeps its start date.");
    }

    const changedAt = new Date();
    const shiftMs = startDate.getTime() - existingSprint.startDate.getTime();
    let movedLater: string[] = [];
    const updatedSprintId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${workspaces} WHERE id = ${validated.projectId} FOR UPDATE`);
      // Move later sprints too (report §28.2, decision 59): later Planning sprints shift by the same days. They're
      // checked after every move, so a clash names the sprint and nothing is saved.
      // Board/review report §6: later sprints at the same level move; a moved main sprint takes its sprints along.
      const shift = sql`start_date = start_date + make_interval(secs => ${shiftMs / 1000}::double precision), end_date = end_date + make_interval(secs => ${shiftMs / 1000}::double precision), updated_at = now()`;
      if (validated.moveLaterSprints && shiftMs !== 0 && existingSprint.status === "planning") {
        const moved = await tx.execute<{ id: string }>(sql`
          UPDATE ${workspaceSprints} SET ${shift}
          WHERE workspace_id = ${validated.projectId} AND status = 'planning' AND id <> ${validated.sprintId} AND start_date > ${existingSprint.startDate.toISOString()}::timestamptz
            AND parent_sprint_id IS NOT DISTINCT FROM ${existingSprint.parentSprintId}::uuid
          RETURNING id`);
        movedLater = moved.map((row) => row.id);
        if (movedLater.length && !existingSprint.parentSprintId) {
          const moveBy = sql`make_interval(secs => ${shiftMs / 1000}::double precision)`;
          await tx.update(workspaceSprints).set({ startDate: sql`${workspaceSprints.startDate} + ${moveBy}`, endDate: sql`${workspaceSprints.endDate} + ${moveBy}`, updatedAt: new Date() })
            .where(and(eq(workspaceSprints.projectId, validated.projectId), eq(workspaceSprints.status, "planning"), inArray(workspaceSprints.parentSprintId, movedLater)));
        }
      }
      if (validated.moveInsideSprints && shiftMs !== 0 && !existingSprint.parentSprintId) {
        await tx.execute(sql`UPDATE ${workspaceSprints} SET ${shift} WHERE workspace_id = ${validated.projectId} AND status = 'planning' AND parent_sprint_id = ${validated.sprintId}`);
      }
      const parentSprintId = validated.parentSprintId === undefined ? existingSprint.parentSprintId : validated.parentSprintId;
      await assertOrgSprintRules(tx, { projectId: validated.projectId, startDate, endDate, parentSprintId, excludeSprintId: validated.sprintId });
      const [updated] = await tx
        .update(workspaceSprints)
        .set({
          name: validated.name,
          goal: validated.goal ?? null,
          description: validated.description ?? null,
          startDate,
          endDate,
          parentSprintId,
          ...(validated.autoStart === undefined ? {} : { autoStart: validated.autoStart }),
          ...(validated.sharedWith ? { showInChildren: validated.sharedWith !== "none" } : validated.showInChildren === undefined ? {} : { showInChildren: validated.showInChildren }),
          ...(validated.notifyOnStart === undefined ? {} : { notifyOnStart: validated.notifyOnStart }),
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(workspaceSprints.id, validated.sprintId),
            eq(workspaceSprints.projectId, validated.projectId),
            eq(workspaceSprints.status, existingSprint.status),
          ),
        )
        .returning({ id: workspaceSprints.id });
      if (!updated)
        throw new Error("The Sprint changed before it could be saved");
      if (validated.sharedWith) await saveSprintSharing(tx, { orgId: validated.projectId, sprintId: validated.sprintId, sharedWith: validated.sharedWith, workspaceIds: validated.sharedWorkspaceIds ?? [] });
      for (const id of movedLater) {
        const [later] = await tx.select({ startDate: workspaceSprints.startDate, endDate: workspaceSprints.endDate, parentSprintId: workspaceSprints.parentSprintId }).from(workspaceSprints).where(eq(workspaceSprints.id, id)).limit(1);
        if (later) await assertOrgSprintRules(tx, { projectId: validated.projectId, ...later, excludeSprintId: id });
      }

      await tx.insert(workspaceSprintEvents).values({
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
    if (!sprintListItem) throw new Error("Couldn’t reload updated sprint");

    // Post an announcement on a change too (report §37.2), organizations only.
    if (validated.announcement?.trim()) {
      const [project] = await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, validated.projectId)).limit(1);
      if (project?.kind === "organization") await postOrgAnnouncement(validated.projectId, user.id, validated.announcement);
    }
    await revalidateWorkspacePaths(validated.projectId);

    await enqueueWorkspaceNotificationBestEffort(
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
    // "Move due dates too" (report §15.3): each moved sprint's assignments and their copies shift by the same days.
    for (const id of [sprintListItem.id, ...movedLater]) {
      await notifyLinkedSprintsOutside(id, validated.projectId, user.id);
      if (validated.moveDueDates && shiftMs !== 0) await shiftOrgSprintDueDates(validated.projectId, id, shiftMs, user.id);
    }

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
        error instanceof Error ? error.message : "Couldn’t update sprint",
    });

    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Couldn’t update sprint",
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
    const user = await sprintUser();
    if (!user) throw new Error("Sign in to continue");
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
            FROM ${workspaceSprints} s
            WHERE s.id = ${validated.sprintId}
              AND s.workspace_id = ${validated.projectId}
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
            : "You can delete a sprint only before it has tasks. Otherwise, archive it.",
      };
    }

    // The preflight above is advisory. Lock the sprint (task assignment's FK
    // check and scheduler activation both wait on it), recheck, then delete
    // only the still-empty Planning sprint (COR-048).
    const deleted = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: workspaceSprints.status })
        .from(workspaceSprints)
        .where(and(eq(workspaceSprints.id, validated.sprintId), eq(workspaceSprints.projectId, validated.projectId)))
        .for("update");
      if (!locked || locked.status !== "planning") return false;
      const [history] = await tx.execute<{ has_history: boolean }>(sql`
        SELECT EXISTS (SELECT 1 FROM ${sprintTaskMemberships} m WHERE m.sprint_id = ${validated.sprintId}) AS has_history
      `);
      if (history?.has_history) return false;
      const removed = await tx
        .delete(workspaceSprints)
        .where(and(
          eq(workspaceSprints.id, validated.sprintId),
          eq(workspaceSprints.projectId, validated.projectId),
          eq(workspaceSprints.status, "planning"),
        ))
        .returning({ id: workspaceSprints.id });
      return removed.length === 1;
    });
    if (!deleted) {
      return {
        success: false,
        error: "You can delete a sprint only before it has tasks. Otherwise, archive it.",
      };
    }

    await revalidateWorkspacePaths(validated.projectId);

    await enqueueWorkspaceNotificationBestEffort(
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
        error instanceof Error ? error.message : "Couldn’t delete sprint",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Couldn’t delete sprint",
    };
  }
}


type CompleteSprintOptions = {
  unfinished?: "keep" | "backlog" | "next_sprint";
  nextSprintId?: string | null;
  /** Report §37.2: an organization's open assignments in the sprint close with it, or stay open (the default). */
  closeAssignments?: boolean;
};

/** Complete's question (report §37.2): how many open assignments the sprint holds, for whoever can complete it. */
export async function countOpenSprintAssignmentsAction(sprintId: string, projectId: string): Promise<number> {
  const user = await sprintUser();
  if (!user) return 0;
  try { await requireSprintOwner(projectId, user.id); } catch { return 0; }
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM tasks m JOIN workspaces o ON o.id = m.workspace_id AND o.kind = 'organization'
    WHERE m.workspace_id = ${projectId} AND m.sprint_id = ${sprintId} AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
      AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL`);
  return row?.n ?? 0;
}



async function requireSprintOwner(projectId: string, userId: string) {
  const access = await getWorkspaceAccessById(projectId, userId);
  if (!access.project) throw new Error("Workspace not found");
  // Inherited org admins plan and run a child project's sprints too (report §15.5).
  if (!access.isOwner && access.memberRole !== "admin" && !access.isInheritedAdmin)
    throw new Error("Only the owner and admins can manage sprints");
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
    const user = await sprintUser();
    if (!user) throw new Error("Sign in to continue");
    await requireSprintOwner(projectId, user.id);
    const unfinished = options.unfinished ?? "keep";
    // Board/review report §6, D9: closing a main sprint closes its running sprint (same choice for open work) and
    // cancels the upcoming ones inside it; open work can't move into a sprint that's closing with it.
    const inside = await sprintsInside(projectId, sprintId);
    if (options.nextSprintId && inside.some((child) => child.id === options.nextSprintId)) throw new Error("That sprint sits inside this one and closes with it. Pick a sprint after it.");
    // Audit N82: the checks below run before any inner sprint closes, so a refused completion closes nothing.
    if (inside.length) {
      const main = await db.query.workspaceSprints.findFirst({ where: and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "active")), columns: { id: true } });
      if (!main) throw new Error("Only an active sprint can be completed");
      if (unfinished === "next_sprint") {
        if (!options.nextSprintId || options.nextSprintId === sprintId) throw new Error("Choose a different planning sprint");
        const target = await db.query.workspaceSprints.findFirst({ where: and(eq(workspaceSprints.id, options.nextSprintId), eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.status, "planning")), columns: { id: true } });
        if (!target) throw new Error("The destination must be a planning sprint");
      }
    }
    for (const child of inside) {
      const result: { success: boolean; error?: string } = child.status === "active" ? await completeSprintAction(child.id, projectId, options) : await cancelSprintAction(child.id, projectId);
      if (!result.success) throw new Error(`${child.name}: ${result.error ?? "couldn’t close"}`);
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      // A close-out can move or detach work, so the UI restriction must be
      // enforced here as well. This also prevents a stale tab from closing a
      // sprint before its scheduled end date.
      const activeSprint = await tx.query.workspaceSprints.findFirst({
        where: and(
          eq(workspaceSprints.id, sprintId),
          eq(workspaceSprints.projectId, projectId),
          eq(workspaceSprints.status, "active"),
        ),
        columns: { endDate: true },
      });
      // Live-fix 30 (report §37.2): a running sprint can be completed early, not only after its end date.
      if (!activeSprint) throw new Error("Only an active sprint can be completed");
      // Claim the transition first. The status predicate serializes
      // duplicate completion requests before memberships are moved or
      // a second lifecycle event can be written.
      const [completed] = await tx
        .update(workspaceSprints)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(workspaceSprints.id, sprintId),
            eq(workspaceSprints.projectId, projectId),
            eq(workspaceSprints.status, "active"),
          ),
        )
        .returning({ id: workspaceSprints.id });
      if (!completed) throw new Error("Only an active sprint can be completed");
      if (unfinished === "next_sprint") {
        if (!options.nextSprintId || options.nextSprintId === sprintId)
          throw new Error("Choose a different planning sprint");
        const target = await tx.query.workspaceSprints.findFirst({
          where: and(
            eq(workspaceSprints.id, options.nextSprintId),
            eq(workspaceSprints.projectId, projectId),
            eq(workspaceSprints.status, "planning"),
          ),
          columns: { id: true },
        });
        if (!target)
          throw new Error("The destination must be a planning sprint");
      }
      if (unfinished !== "keep") {
        const unfinishedTasks = await tx.query.tasks.findMany({
          where: and(
            eq(tasks.projectId, projectId),
            eq(tasks.sprintId, sprintId),
            isNull(tasks.deletedAt),
            sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
            // Assignments and their copies stay in their sprint; only tasks are unfinished work (decision 124).
            ne(tasks.kind, "assignment"),
            isNull(tasks.assignmentId),
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
      await tx.insert(workspaceSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "completed",
        payload: { unfinished, nextSprintId: options.nextSprintId ?? null },
        createdAt: now,
      });
    });
    // Close its open assignments too, when asked and the table allows it (close_assignment).
    if (options.closeAssignments && orgCan(orgRoleOf(await readViewerOrgRole(projectId, user.id)), "close_assignment")) {
      await db.execute(sql`
        UPDATE tasks SET assignment_settings = assignment_settings || jsonb_build_object('closedAt', ${new Date().toISOString()}::text), updated_at = now()
        WHERE workspace_id = ${projectId} AND sprint_id = ${sprintId} AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL
          AND assignment_settings->>'publishedAt' IS NOT NULL AND assignment_settings->>'closedAt' IS NULL`);
    }
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateWorkspacePaths(projectId);
    // Orgs tell each member how much of the sprint they finished instead (report §26 C).
    if (!(await notifyOrgSprintCompleted(sprintId, projectId, user.id))) await enqueueWorkspaceNotificationBestEffort(
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
        error instanceof Error ? error.message : "Couldn’t complete sprint",
    });
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Couldn’t complete sprint",
    };
  }
}


export async function archiveSprintAction(sprintId: string, projectId: string) {
  try {
    const user = await sprintUser();
    if (!user) throw new Error("Sign in to continue");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(workspaceSprints)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(workspaceSprints.id, sprintId),
            eq(workspaceSprints.projectId, projectId),
            or(
              eq(workspaceSprints.status, "completed"),
              eq(workspaceSprints.status, "cancelled"),
            ),
          ),
        )
        .returning({ id: workspaceSprints.id });
      if (!updated)
        throw new Error("Complete or cancel the Sprint before archiving it");
      await tx.insert(workspaceSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "archived",
        payload: {},
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateWorkspacePaths(projectId);
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
        error instanceof Error ? error.message : "Couldn’t archive sprint",
    });
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Couldn’t archive sprint",
    };
  }
}


/** Board/review report §6: a CO's roll-up — assignments in it or its sprints that are still open. */
async function countOpenAssignments(sprintIds: string[]) {
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM ${tasks} m WHERE m.sprint_id IN (${sql.join(sprintIds.map((id) => sql`${id}::uuid`), sql`, `)})
      AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL AND m.assignment_settings->>'closedAt' IS NULL`);
  return Number(row?.n ?? 0);
}

/** The upcoming and running sprints inside a main sprint (board/review report §6). */
async function sprintsInside(projectId: string, sprintId: string) {
  return db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status }).from(workspaceSprints)
    .where(and(eq(workspaceSprints.projectId, projectId), eq(workspaceSprints.parentSprintId, sprintId), inArray(workspaceSprints.status, ["planning", "active"])));
}

export async function cancelSprintAction(sprintId: string, projectId: string) {
  try {
    const user = await sprintUser();
    if (!user) throw new Error("Sign in to continue");
    await requireSprintOwner(projectId, user.id);
    // Board/review report §6: cancelling a main sprint cancels the sprints inside it.
    for (const child of await sprintsInside(projectId, sprintId)) {
      const result: { success: boolean; error?: string } = await cancelSprintAction(child.id, projectId);
      if (!result.success) throw new Error(`${child.name}: ${result.error ?? "couldn’t cancel"}`);
    }
    const now = new Date();
    let unlinked: LinkedChildSprint[] = [];
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(workspaceSprints)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(
          and(
            eq(workspaceSprints.id, sprintId),
            eq(workspaceSprints.projectId, projectId),
            or(
              eq(workspaceSprints.status, "planning"),
              eq(workspaceSprints.status, "active"),
            ),
          ),
        )
        .returning({ id: workspaceSprints.id });
      if (!updated)
        throw new Error("Only a Planning or Active sprint can be canceled");

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
      await tx.insert(workspaceSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "cancelled",
        payload: { returnedTaskCount: taskIds.length },
        createdAt: now,
      });
      // Linked child sprints become ordinary sprints (report §15.3, Cancel); their leads are told after the commit.
      unlinked = await readLinkedChildSprints(tx, sprintId);
      await unlinkSprints(tx, { orgSprintId: sprintId });
    });
    await notifyChildSprintsUnlinked(projectId, sprintId, unlinked, user.id);
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateWorkspacePaths(projectId);
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
        error instanceof Error ? error.message : "Couldn’t cancel sprint",
    });
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Couldn’t cancel sprint",
    };
  }
}


// --- Org sprints (report §15) ---

/**
 * Repeat in the sprint form ("Plan more like this", report §16.2, §28.2, decision 9), in any workspace: back-to-back
 * planned sprints, numbered on from the last one with the prefix. Organization sprints never overlap.
 */
export async function planSprintSeriesAction(input: { projectId: string; prefix: string; count: number; lengthDays: number; startDate: string; goal?: string | null; description?: string | null; autoStart?: boolean
  /** Board/review report §6: split a main sprint into sprints inside it. */
  parentSprintId?: string | null }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const prefix = input.prefix.slice(0, 40);
    if (!prefix.trim()) throw new Error("Enter a name prefix, for example CO.");
    let count = 0;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${workspaces} WHERE id = ${input.projectId} FOR UPDATE`);
      const [project] = await tx.select({ kind: workspaces.kind, orgSettings: workspaces.orgSettings, orgType: workspaces.orgType }).from(workspaces).where(eq(workspaces.id, input.projectId)).limit(1);
      if (!project) throw new Error("Workspace not found");
      const names = await tx.select({ name: workspaceSprints.name }).from(workspaceSprints).where(eq(workspaceSprints.projectId, input.projectId));
      const series = buildSprintSeries({ ...input, prefix, firstNumber: nextSeriesNumber(prefix, names.map((n) => n.name)) });
      count = series.length;
      // The org's Work defaults apply to every planned sprint (report §21).
      const work = project.kind === "organization" ? readOrgWork(project.orgSettings, project.orgType) : null;
      for (const item of series) {
        const startDate = parseSprintDateInput(item.startDate);
        const endDate = parseSprintDateInput(item.endDate);
        const parentSprintId = await assertOrgSprintRules(tx, { projectId: input.projectId, startDate, endDate, parentSprintId: input.parentSprintId ?? null });
        const [created] = await tx.insert(workspaceSprints).values({
          projectId: input.projectId,
          creatorId: user.id,
          sprintNumber: sql<number>`(SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM ${workspaceSprints} WHERE workspace_id = ${input.projectId})`,
          name: item.name,
          goal: input.goal?.trim() || null,
          description: input.description?.trim() || null,
          startDate,
          endDate,
          status: "planning",
          autoStart: input.autoStart ?? work?.sprintAutoStart ?? true,
          showInChildren: work?.sprintShowInChildren ?? true,
          notifyOnStart: work?.sprintNotifyOnStart ?? true,
          parentSprintId,
        }).returning({ id: workspaceSprints.id });
        await tx.insert(workspaceSprintEvents).values({
          projectId: input.projectId,
          sprintId: created!.id,
          actorId: user.id,
          eventType: "created",
          payload: { name: item.name, status: "planning", source: "series", startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        });
      }
    });
    await revalidateWorkspacePaths(input.projectId);
    return { success: true as const, created: count };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t plan the series" };
  }
}

/** Starts a planned sprint now, for sprints with "Start automatically" off or started early (report §15.8). */
export async function startSprintNowAction(sprintId: string, projectId: string, announcement?: string | null) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(projectId, user.id);
    const started = await startSprint(sprintId, projectId, new Date(), user.id, "manual");
    if (!started) throw new Error("Only a planned sprint can start, and only when no other sprint is active.");
    // "Also post an announcement" (report §17.2), off by default; orgs only.
    if (announcement?.trim()) {
      const [project] = await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
      if (project?.kind === "organization") await postOrgAnnouncement(projectId, user.id, announcement);
    }
    await revalidateWorkspacePaths(projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t start the sprint" };
  }
}

/** Attach one of the project's files or docs to a sprint as a material (owners and admins). */
export async function addSprintMaterialAction(input: { projectId: string; sprintId: string; nodeId?: string; docId?: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    if (Boolean(input.nodeId) === Boolean(input.docId)) throw new Error("Pick one file or doc.");
    const [sprint] = await db.select({ id: workspaceSprints.id }).from(workspaceSprints)
      .where(and(eq(workspaceSprints.id, input.sprintId), eq(workspaceSprints.projectId, input.projectId))).limit(1);
    if (!sprint) throw new Error("Sprint not found");
    const target = input.nodeId
      ? await db.select({ id: workspaceNodes.id }).from(workspaceNodes).where(and(eq(workspaceNodes.id, input.nodeId), eq(workspaceNodes.projectId, input.projectId), isNull(workspaceNodes.deletedAt))).limit(1)
      : await db.select({ id: workspaceDocuments.id }).from(workspaceDocuments).where(and(eq(workspaceDocuments.id, input.docId!), eq(workspaceDocuments.projectId, input.projectId))).limit(1);
    if (target.length === 0) throw new Error("That file or doc isn’t in this workspace.");
    await db.insert(sprintMaterials).values({ sprintId: input.sprintId, nodeId: input.nodeId ?? null, docId: input.docId ?? null, addedBy: user.id }).onConflictDoNothing();
    await revalidateWorkspacePaths(input.projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t add the material" };
  }
}

export async function removeSprintMaterialAction(input: { projectId: string; materialId: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    await db.delete(sprintMaterials).where(and(
      eq(sprintMaterials.id, input.materialId),
      sql`${sprintMaterials.sprintId} IN (SELECT id FROM ${workspaceSprints} WHERE workspace_id = ${input.projectId})`,
    ));
    await revalidateWorkspacePaths(input.projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t remove the material" };
  }
}

/** Files and docs to pick from when adding a material, by name. */
export async function searchSprintMaterialCandidatesAction(input: { projectId: string; query: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const pattern = `%${input.query.trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [files, docs] = await Promise.all([
      // Decision 137: an Admins-only file is marked, so adding it warns that members can't open it.
      db.select({ id: workspaceNodes.id, title: workspaceNodes.name, adminsOnly: sql<boolean>`EXISTS (SELECT 1 FROM workspace_nodes f WHERE f.workspace_id = workspace_nodes.workspace_id AND f.type = 'folder' AND f.deleted_at IS NULL AND f.metadata->>'access' = 'admins' AND starts_with(workspace_nodes.path, f.path || '/'))` }).from(workspaceNodes)
        .where(and(eq(workspaceNodes.projectId, input.projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId), ilike(workspaceNodes.name, pattern)))
        .limit(20),
      db.select({ id: workspaceDocuments.id, title: workspaceDocuments.filename }).from(workspaceDocuments)
        .where(and(eq(workspaceDocuments.projectId, input.projectId), ilike(workspaceDocuments.filename, pattern)))
        .limit(10),
    ]);
    return { success: true as const, files, docs };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Search failed", files: [], docs: [] };
  }
}

/**
 * Plan one for each (report §18.2): one planned team sprint inside each planned organization sprint that has none
 * here yet, with its dates, named "<name> 1", "<name> 2"… and never the organization's own name.
 */
export async function planOneForEachAction(input: { projectId: string; name: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error("Give the sprints a name.");
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${workspaces} WHERE id = ${input.projectId} FOR UPDATE`);
      const targets = await tx.execute<{ id: string; start_date: Date; end_date: Date }>(sql`
        SELECT o.id, o.start_date, o.end_date FROM ${workspaceSprints} o JOIN ${workspaces} p ON p.parent_id = o.workspace_id
        WHERE p.id = ${input.projectId} AND o.status = 'planning' AND o.show_in_children
          AND (NOT EXISTS (SELECT 1 FROM sprint_shared_workspaces ss WHERE ss.sprint_id = o.id) OR EXISTS (SELECT 1 FROM sprint_shared_workspaces ss WHERE ss.sprint_id = o.id AND ss.workspace_id = p.id))
          AND NOT EXISTS (SELECT 1 FROM ${workspaceSprints} c WHERE c.workspace_id = p.id AND c.parent_sprint_id = o.id AND c.status <> 'cancelled')
        ORDER BY o.start_date`);
      let n = 0;
      for (const target of targets) {
        n += 1;
        const [row] = await tx.insert(workspaceSprints).values({
          projectId: input.projectId, creatorId: user.id, name: `${name} ${n}`, status: "planning", parentSprintId: target.id,
          startDate: new Date(target.start_date), endDate: new Date(target.end_date),
          sprintNumber: sql<number>`(SELECT COALESCE(MAX(sprint_number), 0) + 1 FROM ${workspaceSprints} WHERE workspace_id = ${input.projectId})`,
        }).returning({ id: workspaceSprints.id });
        if (row) await tx.insert(workspaceSprintEvents).values({ projectId: input.projectId, sprintId: row.id, actorId: user.id, eventType: "created", payload: { name: `${name} ${n}`, status: "planning", source: "plan_one_for_each", orgSprintId: target.id } });
      }
      return n;
    });
    if (created === 0) throw new Error("Every planned organization sprint already has one here.");
    await revalidateWorkspacePaths(input.projectId);
    return { success: true as const, created };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t plan the sprints" };
  }
}

/** Fix dates (report §18.2): a team sprint outside its organization sprint is pulled back inside it. */
export async function fitSprintToParentAction(input: { projectId: string; sprintId: string }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const [row] = await db.execute<{ start: Date; end: Date; status: string; parent_start: Date; parent_end: Date }>(sql`
      SELECT c.start_date AS start, c.end_date AS "end", c.status, o.start_date AS parent_start, o.end_date AS parent_end
      FROM ${workspaceSprints} c JOIN ${workspaceSprints} o ON o.id = c.parent_sprint_id
      WHERE c.id = ${input.sprintId} AND c.workspace_id = ${input.projectId}`);
    if (!row) throw new Error("This sprint isn’t inside an organization sprint.");
    if (row.status !== "planning" && row.status !== "active") throw new Error("Only a planned or running sprint can change dates.");
    const time = (d: Date | string) => new Date(d).getTime();
    // A running sprint keeps its start; only its end comes back inside.
    const start = row.status === "active" ? new Date(row.start) : new Date(Math.min(Math.max(time(row.start), time(row.parent_start)), time(row.parent_end)));
    const end = new Date(Math.max(Math.min(time(row.end), time(row.parent_end)), start.getTime()));
    await db.update(workspaceSprints).set({ startDate: start, endDate: end, updatedAt: new Date() }).where(eq(workspaceSprints.id, input.sprintId));
    await revalidateWorkspacePaths(input.projectId);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t fix the dates" };
  }
}

/**
 * The Workspaces panel's Remind (report §37.2): leads of workspaces with no sprint inside this organization sprint,
 * once per 12 hours each, with an honest count (report §28.8).
 */
export async function remindSprintLeadsAction(input: { projectId: string; sprintId: string; workspaceIds: string[] }) {
  try {
    const user = await getAuthUserOrThrow();
    await requireSprintOwner(input.projectId, user.id);
    const [sprint] = await db.select({ name: workspaceSprints.name }).from(workspaceSprints)
      .innerJoin(workspaces, eq(workspaces.id, workspaceSprints.projectId))
      .where(and(eq(workspaceSprints.id, input.sprintId), eq(workspaceSprints.projectId, input.projectId), eq(workspaces.kind, "organization"))).limit(1);
    if (!sprint) throw new Error("Sprint not found");
    const leads = input.workspaceIds.length ? await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug, leadId: workspaces.ownerId }).from(workspaces)
      .where(and(inArray(workspaces.id, input.workspaceIds), eq(workspaces.parentId, input.projectId), isNull(workspaces.deletedAt),
        sql`NOT EXISTS (SELECT 1 FROM ${workspaceSprints} c WHERE c.workspace_id = ${workspaces.id} AND c.parent_sprint_id = ${input.sprintId})`)) : [];
    const recent = await remindedRecently(input.projectId, `remind-sprint-${input.sprintId.slice(0, 8)}`, leads.map((l) => l.leadId), "org_sprints.notice");
    let reminded = 0;
    let skipped = 0;
    for (const lead of leads) {
      if (recent.has(lead.id)) { skipped += 1; continue; }
      await notifyOrg({ orgId: input.projectId, eventKey: "org_sprints.notice", actorId: user.id, to: [lead.leadId], title: `Plan your sprint in ${lead.title} for ${sprint.name}`,
        href: `/workspaces/${encodeURIComponent(lead.slug ?? lead.id)}?tab=sprints`, sourceEventId: `remind-sprint-${input.sprintId.slice(0, 8)}:${lead.id}:${Date.now()}` });
      reminded += 1;
    }
    return { success: true as const, reminded, skipped };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t remind them" };
  }
}

async function getAuthUserOrThrow() {
  const user = await sprintUser();
  if (!user) throw new Error("Sign in to continue");
  return user;
}
