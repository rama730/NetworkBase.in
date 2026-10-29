import "server-only";
import { encodeFilePermissionCursor, normalizeFilePermissionOptions, type FilePermissionOptions } from "@/lib/projects/file-permission-pagination";

import { type ProjectVisibility, normalizeProjectVisibility } from "@/lib/projects/project-visibility";
import { type ProjectNotificationPolicy, summarizeProjectNotificationPolicy, type ProjectMemberNotificationOverrides, normalizeProjectNotificationPolicy, type ProjectNotificationPreset, buildDefaultProjectNotificationPolicy, normalizeProjectMemberNotificationOverrides } from "@/lib/notifications/project-policy";
import { db } from "@/lib/db";
import { tasks, taskNodeLinks, projectNodes, roleApplications, chatChannelMembers, chatChannels, projectOpenRoles, projectMembers, profiles, projects, projectNodeEvents } from "@/lib/db/schema";
import { sql, and, eq, isNull, inArray, desc, or, ilike } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { capabilityFromAccess, requireProjectCapability, changeProjectMemberRoleInternal, canProjectRoleManageTarget, readProjectMemberRemovalImpact, removeProjectMemberInternal } from "@/lib/projects/collaborator-lifecycle";
import { canProjectMemberUploadFiles } from "@/lib/projects/settings-policies";
import { logger } from "@/lib/logger";
import { enqueueProjectNotificationEvent, enqueueProjectNotificationEvents } from "@/lib/notifications/project-events";
import { z } from "zod";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";
import { wakeEmailWorker } from "@/lib/email/outbox";
import { getProjectAccessById, type ProjectAccess } from "@/lib/data/project-access";
import { readProjectDocSettingsAction } from "@/app/actions/project/doc";
import { type ProjectSettingsErrorCode, type ProjectSettingsMutationResult, revalidateProjectPaths, actorNotificationSnapshot, enqueueProjectNotificationBestEffort, loadOwnedProjectForSettings } from "./common";


type ProjectDangerZonePreflightResult =
  | {
      success: true;
      data: {
        status: "draft" | "active" | "completed" | "archived";
        openRolesCount: number;
        pendingApplicationsCount: number;
        activeTasksCount: number;
        canArchive: boolean;
        canDelete: boolean;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectFileWorkspaceSettingsResult =
  | {
      success: true;
      data: {
        members: Array<{
          id: string;
          username: string | null;
          fullName: string | null;
          avatarUrl: string | null;
          membershipRole: ProjectCollaboratorRole;
          projectRoleTitle: string | null;
          joinedAt: string | null;
          fileUploadEnabled: boolean;
          uploadPermissionLocked: boolean;
          uploadPermissionLabel: string;
        }>;
        summary: {
          alwaysAllowedCount: number;
          enabledMemberCount: number;
          disabledMemberCount: number;
        };
        /** True when more members exist than `members` holds; the summary always covers everyone. */
        hasMore: boolean;
        nextCursor: string | null;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectCollaboratorRole = "owner" | "admin" | "member" | "viewer";


type ProjectCollaboratorSettingsResult =
  | {
      success: true;
      data: {
        members: Array<{
          id: string;
          username: string | null;
          fullName: string | null;
          avatarUrl: string | null;
          membershipRole: ProjectCollaboratorRole;
          projectRoleTitle: string | null;
          joinedAt: string | null;
          fileUploadEnabled: boolean;
          responsibilityCounts: {
            activeAssignedTasks: number;
            activeCreatedTasks: number;
            fileReviews: number;
            acceptedApplications: number;
            projectGroupParticipant: boolean;
          };
        }>;
        roleCounts: Record<ProjectCollaboratorRole, number>;
        hasMore: boolean;
        nextCursor: string | null;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectCollaboratorSettingsOptions = {
  limit?: number;
  cursor?: string | null;
  query?: string | null;
  roleFilter?: ProjectCollaboratorRole | "all" | null;
};


type ProjectMemberRemovalPreflightResult =
  | {
      success: true;
      data: {
        member: {
          id: string;
          username: string | null;
          fullName: string | null;
          avatarUrl: string | null;
          membershipRole: ProjectCollaboratorRole;
          projectRoleTitle: string | null;
        };
        activeAssignedTasks: number;
        activeCreatedTasks: number;
        fileReviews: number;
        acceptedApplications: number;
        projectGroupParticipant: boolean;
        visibility: ProjectVisibility;
        activeAssignedTaskItems: Array<{
          id: string;
          title: string;
          taskNumber: number | null;
          status: string | null;
        }>;
        activeCreatedTaskItems: Array<{
          id: string;
          title: string;
          taskNumber: number | null;
          status: string | null;
        }>;
        fileReviewItems: Array<{
          id: string;
          taskId: string;
          taskTitle: string | null;
          nodeName: string | null;
          annotation: string | null;
        }>;
        acceptedApplicationItems: Array<{
          id: string;
          roleId: string;
          roleTitle: string | null;
          roleName: string | null;
        }>;
        reassignmentCandidates: Array<{
          id: string;
          username: string | null;
          fullName: string | null;
          avatarUrl: string | null;
          membershipRole: ProjectCollaboratorRole;
        }>;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectMemberMutationResult =
  | { success: true; message: string }
  | {
      success: false;
      message: string;
      errorCode:
        | ProjectSettingsErrorCode
        | "INVALID_ROLE"
        | "OWNER_TARGET"
        | "NOT_A_MEMBER";
    };


type ProjectNotificationSettingsResult =
  | {
      success: true;
      data: {
        policy: ProjectNotificationPolicy;
        summary: ReturnType<typeof summarizeProjectNotificationPolicy>;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectMemberNotificationSettingsResult =
  | {
      success: true;
      data: {
        member: {
          id: string;
          username: string | null;
          fullName: string | null;
          avatarUrl: string | null;
          membershipRole: ProjectCollaboratorRole;
        };
        canEdit: boolean;
        overrides: ProjectMemberNotificationOverrides;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


function normalizeCollaboratorRole(
  value: unknown,
  fallback: ProjectCollaboratorRole = "member",
): ProjectCollaboratorRole {
  return value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
    ? value
    : fallback;
}


function collaboratorRoleLabel(role: ProjectCollaboratorRole) {
  if (role === "admin") return "Co-leader";
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}


async function readProjectCollaboratorResponsibilityCounts(
  projectId: string,
  memberIds: string[],
) {
  const initial = new Map<
    string,
    {
      activeAssignedTasks: number;
      activeCreatedTasks: number;
      fileReviews: number;
      acceptedApplications: number;
      projectGroupParticipant: boolean;
    }
  >();
  for (const memberId of memberIds) {
    initial.set(memberId, {
      activeAssignedTasks: 0,
      activeCreatedTasks: 0,
      fileReviews: 0,
      acceptedApplications: 0,
      projectGroupParticipant: false,
    });
  }
  if (memberIds.length === 0) return initial;

  const [
    assignedRows,
    createdRows,
    fileReviewRows,
    acceptedRows,
    participantRows,
  ] = await Promise.all([
    db
      .select({ userId: tasks.assigneeId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
          inArray(tasks.assigneeId, memberIds),
        ),
      )
      .groupBy(tasks.assigneeId),
    db
      .select({ userId: tasks.creatorId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
          inArray(tasks.creatorId, memberIds),
        ),
      )
      .groupBy(tasks.creatorId),
    db
      .select({
        userId: taskNodeLinks.createdBy,
        count: sql<number>`count(*)::int`,
      })
      .from(taskNodeLinks)
      .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
      .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          isNull(projectNodes.deletedAt),
          inArray(taskNodeLinks.createdBy, memberIds),
          sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
        ),
      )
      .groupBy(taskNodeLinks.createdBy),
    db
      .select({
        userId: roleApplications.applicantId,
        count: sql<number>`count(*)::int`,
      })
      .from(roleApplications)
      .where(
        and(
          eq(roleApplications.projectId, projectId),
          eq(roleApplications.status, "accepted"),
          inArray(roleApplications.applicantId, memberIds),
        ),
      )
      .groupBy(roleApplications.applicantId),
    // Members of the project's #general (report 7.1).
    db
      .select({ userId: chatChannelMembers.userId })
      .from(chatChannelMembers)
      .innerJoin(chatChannels, eq(chatChannels.id, chatChannelMembers.channelId))
      .where(
        and(
          eq(chatChannels.projectId, projectId),
          eq(chatChannels.isDefault, true),
          inArray(chatChannelMembers.userId, memberIds),
        ),
      ),
  ]);

  const patchCount = (
    userId: string | null,
    key:
      | "activeAssignedTasks"
      | "activeCreatedTasks"
      | "fileReviews"
      | "acceptedApplications",
    count: number,
  ) => {
    if (!userId) return;
    const current = initial.get(userId);
    if (current) current[key] = Number(count ?? 0);
  };
  for (const row of assignedRows)
    patchCount(row.userId, "activeAssignedTasks", row.count);
  for (const row of createdRows)
    patchCount(row.userId, "activeCreatedTasks", row.count);
  for (const row of fileReviewRows)
    patchCount(row.userId, "fileReviews", row.count);
  for (const row of acceptedRows)
    patchCount(row.userId, "acceptedApplications", row.count);
  for (const row of participantRows) {
    const current = initial.get(row.userId);
    if (current) current.projectGroupParticipant = true;
  }
  return initial;
}


async function readAcceptedRoleTitles(projectId: string, memberIds: string[]) {
  if (memberIds.length === 0) return new Map<string, string>();
  const rows = await db
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
    .orderBy(desc(roleApplications.updatedAt));

  const roleByUser = new Map<string, string>();
  for (const row of rows) {
    if (roleByUser.has(row.applicantId)) continue;
    const label = row.roleTitle || row.roleName || "";
    if (label) roleByUser.set(row.applicantId, label);
  }
  return roleByUser;
}


/**
 * Effective role per member row, in SQL, with the same fallback as normalizeCollaboratorRole:
 * a stored role of owner/admin/member/viewer stands, anything else is owner for the owner and member otherwise.
 */
function effectiveCollaboratorRoleSql(ownerId: string) {
  return sql`CASE WHEN ${projectMembers.role} IN ('owner', 'admin', 'member', 'viewer') THEN ${projectMembers.role} WHEN ${projectMembers.userId} = ${ownerId}::uuid THEN 'owner' ELSE 'member' END`;
}


/** Role totals for a project from one aggregate, not by loading every member. */
async function readProjectRoleCounts(projectId: string, ownerId: string) {
  // The role is computed in a subquery so GROUP BY sees a plain column, not a re-parameterized expression.
  const rows = await db.execute<{ role: ProjectCollaboratorRole; count: number; has_owner: boolean }>(sql`
    SELECT effective_role AS role, count(*)::int AS count, bool_or(user_id = ${ownerId}::uuid OR effective_role = 'owner') AS has_owner
    FROM (
      SELECT user_id, ${effectiveCollaboratorRoleSql(ownerId)} AS effective_role
      FROM project_members
      WHERE project_id = ${projectId}::uuid
    ) AS member_roles
    GROUP BY effective_role
  `);
  const roleCounts: Record<ProjectCollaboratorRole, number> = { owner: 0, admin: 0, member: 0, viewer: 0 };
  let ownerCounted = false;
  for (const row of rows) {
    roleCounts[row.role] = Number(row.count);
    ownerCounted ||= row.has_owner;
  }
  // The owner is a collaborator even when no membership row exists for them.
  if (!ownerCounted) roleCounts.owner = 1;
  return roleCounts;
}


/**
 * The signed-in person and a memoized read of their access to one project. Sections of the settings
 * page that are loaded together share it, so authorization and the project lookup happen once.
 */
export type SettingsViewer = { userId: string; access: (projectId: string) => Promise<ProjectAccess> };

export async function signedInSettingsViewer(): Promise<SettingsViewer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const reads = new Map<string, Promise<ProjectAccess>>();
  return {
    userId: user.id,
    access: (projectId) => {
      const cached = reads.get(projectId);
      if (cached) return cached;
      const read = getProjectAccessById(projectId, user.id);
      reads.set(projectId, read);
      return read;
    },
  };
}

const UNAUTHORIZED_SETTINGS = {
  success: false as const,
  errorCode: "UNAUTHORIZED" as const,
  message: "You must be signed in.",
};

export async function getProjectCollaboratorSettingsAction(
  projectId: string,
  optionsOrLimit: ProjectCollaboratorSettingsOptions | number = 40,
  legacyCursor?: string,
): Promise<ProjectCollaboratorSettingsResult> {
  const viewer = await signedInSettingsViewer();
  if (!viewer) return UNAUTHORIZED_SETTINGS;
  return readCollaboratorSettings(viewer, projectId, optionsOrLimit, legacyCursor);
}

export async function readCollaboratorSettings(
  viewer: SettingsViewer,
  projectId: string,
  optionsOrLimit: ProjectCollaboratorSettingsOptions | number = 40,
  legacyCursor?: string,
): Promise<ProjectCollaboratorSettingsResult> {
  try {
    const capability = capabilityFromAccess(await viewer.access(projectId), "manage_collaborators");
    const owned = {
      ok: true as const,
      project: {
        id: capability.project.id,
        ownerId: capability.project.ownerId,
      },
    };

    const options =
      typeof optionsOrLimit === "number"
        ? { limit: optionsOrLimit, cursor: legacyCursor }
        : optionsOrLimit;
    const roleFilter =
      options.roleFilter && options.roleFilter !== "all"
        ? options.roleFilter
        : null;
    const query = options.query?.trim() ?? "";
    const safeLimit = Math.min(Math.max(options.limit ?? 40, 1), 80);
    const whereConditions: any[] = [eq(projectMembers.projectId, projectId)];
    if (roleFilter) {
      if (roleFilter === "owner") {
        whereConditions.push(eq(projectMembers.userId, owned.project.ownerId));
      } else {
        whereConditions.push(eq(projectMembers.role, roleFilter));
        whereConditions.push(
          sql`${projectMembers.userId} <> ${owned.project.ownerId}`,
        );
      }
    }
    if (query) {
      const likePattern = `%${query.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      whereConditions.push(
        or(
          ilike(profiles.fullName, likePattern),
          ilike(profiles.username, likePattern),
        ),
      );
    }
    if (options.cursor) {
      try {
        const decoded = Buffer.from(options.cursor, "base64").toString("utf-8");
        const [joinedAt, memberId] = decoded.split(":::");
        if (joinedAt && memberId) {
          whereConditions.push(
            sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`,
          );
        }
      } catch {
        // Ignore invalid cursors and return the first page.
      }
    }

    const [projectRow] = await db
      .select({
        importSource: projects.importSource,
        ownerId: projects.ownerId,
        parentId: projects.parentId,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const rows = await db
      .select({
        memberId: projectMembers.id,
        userId: projectMembers.userId,
        role: projectMembers.role,
        fileUploadEnabled: projectMembers.fileUploadEnabled,
        joinedAt: projectMembers.joinedAt,
        username: profiles.username,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        unitTitle: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM project_open_roles r WHERE r.id = ${projectMembers.unitId})`,
      })
      .from(projectMembers)
      .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
      .where(and(...whereConditions))
      .orderBy(desc(projectMembers.joinedAt), desc(projectMembers.id))
      .limit(safeLimit + 1);
    const hasMore = rows.length > safeLimit;
    let slice = rows.slice(0, safeLimit);
    if (
      !options.cursor &&
      (!roleFilter || roleFilter === "owner") &&
      !slice.some((row) => row.userId === owned.project.ownerId)
    ) {
      const [ownerProfile] = await db
        .select({
          id: profiles.id,
          username: profiles.username,
          fullName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(eq(profiles.id, owned.project.ownerId))
        .limit(1);
      const matchesQuery =
        !query ||
        [ownerProfile?.fullName, ownerProfile?.username]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(query.toLowerCase()),
          );
      if (ownerProfile?.id && matchesQuery) {
        slice = [
          {
            memberId: `owner:${ownerProfile.id}`,
            userId: ownerProfile.id,
            role: "owner" as ProjectCollaboratorRole,
            fileUploadEnabled: true,
            joinedAt: new Date(0),
            username: ownerProfile.username,
            fullName: ownerProfile.fullName,
            avatarUrl: ownerProfile.avatarUrl,
            unitTitle: null,
          },
          ...slice,
        ].slice(0, safeLimit);
      }
    }
    const last = slice[slice.length - 1];
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            `${last.joinedAt.toISOString()}:::${last.memberId}`,
          ).toString("base64")
        : null;

    const memberIds = slice.map((row) => row.userId);
    // Outside people in an org's child project are labelled "Outside <org>" (report §20.8, §21.6 #5).
    const outside = projectRow?.parentId && memberIds.length > 0
      ? await db.execute<{ user_id: string; org: string }>(sql`
          SELECT c.user_id, o.title AS org FROM project_members c JOIN projects o ON o.id = ${projectRow.parentId}
          WHERE c.project_id = ${projectId} AND c.user_id IN ${memberIds} AND o.owner_id <> c.user_id
            AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = o.id AND m.user_id = c.user_id)`)
      : [];
    const outsideOf = new Map(outside.map((r) => [r.user_id, r.org]));
    const [roleTitleByUser, responsibilityByUser, roleCounts] =
      await Promise.all([
        readAcceptedRoleTitles(projectId, memberIds),
        readProjectCollaboratorResponsibilityCounts(
          projectId,
          memberIds,
        ),
        readProjectRoleCounts(projectId, owned.project.ownerId),
      ]);

    const rawLeadFocus = (projectRow?.importSource as any)?.metadata?.leadFocus;
    const leadFocus =
      typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";

    return {
      success: true,
      data: {
        members: slice
          .filter((row) => row.userId)
          .map((row) => ({
            id: row.userId,
            username: row.username ?? null,
            fullName: row.fullName ?? null,
            avatarUrl: row.avatarUrl ?? null,
            membershipRole: normalizeCollaboratorRole(
              row.role,
              row.userId === owned.project.ownerId ? "owner" : "member",
            ),
            projectRoleTitle:
              row.userId === projectRow?.ownerId
                ? leadFocus || "Lead"
                : (roleTitleByUser.get(row.userId) ?? null),
            joinedAt: row.joinedAt?.toISOString?.() ?? null,
            unitTitle: row.unitTitle ?? null,
            outsideOf: outsideOf.get(row.userId) ?? null,
            fileUploadEnabled: row.fileUploadEnabled !== false,
            responsibilityCounts: responsibilityByUser.get(row.userId) ?? {
              activeAssignedTasks: 0,
              activeCreatedTasks: 0,
              fileReviews: 0,
              acceptedApplications: 0,
              projectGroupParticipant: false,
            },
          })),
        roleCounts,
        hasMore,
        nextCursor,
      },
    };
  } catch (error) {
    console.error("Failed to load project collaborator settings:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage collaborators.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t load members",
    };
  }
}


function formatFileUploadPermission(
  role: ProjectCollaboratorRole,
  enabled: boolean,
) {
  if (role === "owner") return { locked: true, label: "Owner · always on" };
  if (role === "admin") return { locked: true, label: "Co-leader · always on" };
  if (role === "viewer") return { locked: true, label: "Viewer · upload off" };
  return {
    locked: false,
    label: enabled ? "Member upload on" : "Member upload off",
  };
}






export async function getProjectFileWorkspaceSettingsAction(
  projectId: string,
  options: FilePermissionOptions = {},
): Promise<ProjectFileWorkspaceSettingsResult> {
  const viewer = await signedInSettingsViewer();
  if (!viewer) return UNAUTHORIZED_SETTINGS;
  return readFileWorkspaceSettings(viewer, projectId, options);
}

export async function readFileWorkspaceSettings(
  viewer: SettingsViewer,
  projectId: string,
  options: FilePermissionOptions = {},
): Promise<ProjectFileWorkspaceSettingsResult> {
  try {
    const capability = capabilityFromAccess(await viewer.access(projectId), "manage_files");

    const page = normalizeFilePermissionOptions(options);
    const rank = sql<number>`CASE WHEN ${projectMembers.userId} = ${capability.project.ownerId} THEN 0 WHEN ${projectMembers.role} = 'admin' THEN 1 WHEN ${projectMembers.role} = 'member' THEN 2 ELSE 3 END`;
    const name = sql<string>`COALESCE(${profiles.fullName}, ${profiles.username}, '')`;
    const effectiveRole = effectiveCollaboratorRoleSql(capability.project.ownerId);
    const conditions = [eq(projectMembers.projectId, projectId)];
    if (page.query) {
      const pattern = `%${page.query.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(or(ilike(profiles.fullName, pattern), ilike(profiles.username, pattern))!);
    }
    if (page.permissionFilter !== "all") {
      conditions.push(and(sql`${effectiveRole} = 'member'`, page.permissionFilter === "enabled" ? sql`${projectMembers.fileUploadEnabled} IS NOT FALSE` : eq(projectMembers.fileUploadEnabled, false))!);
    }
    if (page.cursor) conditions.push(sql`(${rank}, ${name}, ${projectMembers.userId}) > (${page.cursor.rank}, ${page.cursor.name}, ${page.cursor.id}::uuid)`);
    const [rowsPlusOne, [counts]] = await Promise.all([
      db
        .select({
          userId: projectMembers.userId,
          cursorRank: rank,
          cursorName: name,
          role: projectMembers.role,
          fileUploadEnabled: projectMembers.fileUploadEnabled,
          joinedAt: projectMembers.joinedAt,
          username: profiles.username,
          fullName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(projectMembers)
        .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
        .where(and(...conditions))
        .orderBy(rank, name, projectMembers.userId)
        .limit(page.limit + 1),
      db
        .select({
          alwaysAllowed: sql<number>`count(*) filter (where ${effectiveRole} in ('owner', 'admin'))::int`,
          enabled: sql<number>`count(*) filter (where ${effectiveRole} = 'member' and ${projectMembers.fileUploadEnabled} is not false)::int`,
          disabled: sql<number>`count(*) filter (where ${effectiveRole} = 'member' and ${projectMembers.fileUploadEnabled} = false)::int`,
        })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId)),
    ]);
    const hasMore = rowsPlusOne.length > page.limit;
    const rows = rowsPlusOne.slice(0, page.limit);

    const memberIds = rows.map((row) => row.userId);
    const roleTitleByUser = await readAcceptedRoleTitles(projectId, memberIds);
    const members = rows.map((row) => {
      const role = normalizeCollaboratorRole(
        row.role,
        row.userId === capability.project.ownerId ? "owner" : "member",
      );
      const uploadEnabled = canProjectMemberUploadFiles({
        role,
        fileUploadEnabled: row.fileUploadEnabled,
      });
      const permission = formatFileUploadPermission(role, uploadEnabled);
      return {
        id: row.userId,
        username: row.username ?? null,
        fullName: row.fullName ?? null,
        avatarUrl: row.avatarUrl ?? null,
        membershipRole: role,
        projectRoleTitle: roleTitleByUser.get(row.userId) ?? null,
        joinedAt: row.joinedAt?.toISOString?.() ?? null,
        fileUploadEnabled: uploadEnabled,
        uploadPermissionLocked: permission.locked,
        uploadPermissionLabel: permission.label,
      };
    });

    const lastRow = rows.at(-1);
    return {
      success: true,
      data: {
        members,
        summary: {
          alwaysAllowedCount: Number(counts?.alwaysAllowed ?? 0),
          enabledMemberCount: Number(counts?.enabled ?? 0),
          disabledMemberCount: Number(counts?.disabled ?? 0),
        },
        hasMore,
        nextCursor: hasMore && lastRow ? encodeFilePermissionCursor({ rank: lastRow.cursorRank, name: lastRow.cursorName, id: lastRow.userId }) : null,
      },
    };
  } catch (error) {
    logger.error("project.file_workspace_settings_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message:
          "You do not have permission to manage file workspace settings.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load file workspace settings.",
    };
  }
}


export async function updateProjectMemberFileUploadAction(
  projectId: string,
  memberUserId: string,
  enabled: boolean,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_files",
    );

    const [target] = await db
      .select({
        role: projectMembers.role,
        fileUploadEnabled: projectMembers.fileUploadEnabled,
        username: profiles.username,
        fullName: profiles.fullName,
      })
      .from(projectMembers)
      .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
        ),
      )
      .limit(1);
    if (!target)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project member not found.",
      };
    const targetRole = normalizeCollaboratorRole(
      target.role,
      memberUserId === capability.project.ownerId ? "owner" : "member",
    );
    if (targetRole === "owner" || targetRole === "admin") {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Owner and Co-leader upload access is always on.",
      };
    }
    if (targetRole === "viewer") {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Viewers cannot upload files.",
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(projectMembers)
        .set({ fileUploadEnabled: enabled })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, memberUserId),
          ),
        );
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: enabled
          ? "project_file_policy.member_upload_enabled"
          : "project_file_policy.member_upload_disabled",
        metadata: {
          targetUserId: memberUserId,
          targetDisplayName:
            target.fullName || target.username || "Project member",
          previous: target.fileUploadEnabled !== false,
          next: enabled,
          actorRole: capability.role,
        },
        createdAt: new Date(),
      });
    });

    await revalidateProjectPaths(projectId);
    try {
      await enqueueProjectNotificationEvent({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "access.file_upload_permission_changed",
        affectedMemberId: memberUserId,
        title: enabled
          ? "File uploads enabled for you"
          : "File uploads disabled for you",
        body: enabled
          ? "You can upload files to this project workspace."
          : "You can no longer upload files to this project workspace.",
        sourceEventId: `${projectId}:file-upload:${memberUserId}:${enabled}`,
        entityRefs: { projectId, targetUserId: memberUserId },
      });
    } catch (notificationError) {
      logger.warn("project.member_file_upload_notification_failed", {
        module: "projects",
        projectId,
        targetUserId: memberUserId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }
    return {
      success: true,
      message: enabled
        ? "Member file uploads enabled."
        : "Member file uploads disabled.",
    };
  } catch (error) {
    logger.error("project.member_file_upload_update_failed", {
      module: "projects",
      projectId,
      targetUserId: memberUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage file uploads.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update member upload permission.",
    };
  }
}


export async function updateProjectFileUploadDefaultsAction(
  projectId: string,
  enabled: boolean,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_files",
    );

    const updated = await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ memberFileUploadDefault: enabled, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      const rows = await tx
        .update(projectMembers)
        .set({ fileUploadEnabled: enabled })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.role, "member"),
          ),
        )
        .returning({ userId: projectMembers.userId });
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: "project_file_policy.member_upload_bulk_changed",
        metadata: {
          next: enabled,
          affectedCount: rows.length,
          actorRole: capability.role,
        },
        createdAt: new Date(),
      });
      return rows.length;
    });

    await revalidateProjectPaths(projectId);
    try {
      const affectedUserIds = await db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.role, "member"),
          ),
        );
      await enqueueProjectNotificationEvent({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "access.file_upload_permission_changed",
        directRecipientIds: affectedUserIds.map((row) => row.userId),
        title: enabled
          ? "Project file uploads enabled"
          : "Project file uploads disabled",
        body: enabled
          ? "Members can upload files to this project workspace."
          : "Members can no longer upload files to this project workspace.",
        sourceEventId: `${projectId}:file-upload-defaults:${enabled}`,
        entityRefs: { projectId },
      });
    } catch (notificationError) {
      logger.warn("project.file_upload_defaults_notification_failed", {
        module: "projects",
        projectId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }
    return {
      success: true,
      message: enabled
        ? `Enabled uploads for ${updated} member${updated === 1 ? "" : "s"}.`
        : `Disabled uploads for ${updated} member${updated === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    logger.error("project.file_upload_defaults_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage file uploads.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t update file upload defaults",
    };
  }
}


export async function readProjectNotificationSettingsAction(
  projectId: string,
): Promise<ProjectNotificationSettingsResult> {
  const viewer = await signedInSettingsViewer();
  if (!viewer) return UNAUTHORIZED_SETTINGS;
  return readNotificationSettings(viewer, projectId);
}

export async function readNotificationSettings(
  viewer: SettingsViewer,
  projectId: string,
): Promise<ProjectNotificationSettingsResult> {
  try {
    capabilityFromAccess(await viewer.access(projectId), "manage_notifications");

    const [project] = await db
      .select({ notificationPreferences: projects.notificationPreferences })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };

    const policy = normalizeProjectNotificationPolicy(
      project.notificationPreferences,
    );
    return {
      success: true,
      data: {
        policy,
        summary: summarizeProjectNotificationPolicy(policy),
      },
    };
  } catch (error) {
    logger.error("project.notification_settings_read_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage project notifications.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t load workspace notification settings",
    };
  }
}


export async function updateProjectNotificationSettingsAction(
  projectId: string,
  input: unknown,
): Promise<ProjectNotificationSettingsResult & { message?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_notifications",
    );
    const policy = normalizeProjectNotificationPolicy(input);

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ notificationPreferences: policy, updatedAt: new Date() })
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: "project_notification_settings.updated",
        metadata: {
          preset: policy.preset,
          summary: summarizeProjectNotificationPolicy(policy),
          actorRole: capability.role,
        },
        createdAt: new Date(),
      });
    });

    await revalidateProjectPaths(projectId);
    return {
      success: true,
      message: "Workspace notification settings updated",
      data: {
        policy,
        summary: summarizeProjectNotificationPolicy(policy),
      },
    };
  } catch (error) {
    logger.error("project.notification_settings_update_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage project notifications.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update project notification settings.",
    };
  }
}


export async function resetProjectNotificationSettingsAction(
  projectId: string,
  preset: ProjectNotificationPreset = "balanced",
): Promise<ProjectNotificationSettingsResult & { message?: string }> {
  return updateProjectNotificationSettingsAction(
    projectId,
    buildDefaultProjectNotificationPolicy(preset),
  );
}


async function canViewProjectMemberNotificationSettings(
  projectId: string,
  actorUserId: string,
  memberUserId: string,
) {
  if (actorUserId === memberUserId) return true;
  try {
    await requireProjectCapability(
      projectId,
      actorUserId,
      "manage_notifications",
    );
    return true;
  } catch {
    return false;
  }
}


export async function readProjectMemberNotificationSettingsAction(
  projectId: string,
  memberUserId: string,
): Promise<ProjectMemberNotificationSettingsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    if (
      !(await canViewProjectMemberNotificationSettings(
        projectId,
        user.id,
        memberUserId,
      ))
    ) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message:
          "You do not have permission to view these notification settings.",
      };
    }

    const [member] = await db
      .select({
        id: profiles.id,
        username: profiles.username,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        role: projectMembers.role,
        notificationPreferences: projectMembers.notificationPreferences,
        ownerId: projects.ownerId,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!member?.id) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project member not found.",
      };
    }

    return {
      success: true,
      data: {
        member: {
          id: member.id,
          username: member.username,
          fullName: member.fullName,
          avatarUrl: member.avatarUrl,
          membershipRole: normalizeCollaboratorRole(
            member.role,
            memberUserId === member.ownerId ? "owner" : "member",
          ),
        },
        canEdit: user.id === memberUserId,
        overrides: normalizeProjectMemberNotificationOverrides(
          member.notificationPreferences,
        ),
      },
    };
  } catch (error) {
    logger.error("project.member_notification_settings_read_failed", {
      module: "projects",
      projectId,
      targetUserId: memberUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Couldn’t load member notification settings",
    };
  }
}


export async function updateProjectMemberNotificationSettingsAction(
  projectId: string,
  memberUserId: string,
  input: unknown,
): Promise<ProjectMemberNotificationSettingsResult & { message?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    if (user.id !== memberUserId) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message:
          "Members can only update their own project notification settings.",
      };
    }
    const overrides = normalizeProjectMemberNotificationOverrides(input);

    const [updated] = await db
      .update(projectMembers)
      .set({ notificationPreferences: overrides })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
        ),
      )
      .returning({ userId: projectMembers.userId, role: projectMembers.role });
    if (!updated)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project member not found.",
      };

    await db.insert(projectNodeEvents).values({
      projectId,
      actorId: user.id,
      nodeId: null,
      type: "project_notification_settings.member_updated",
      metadata: {
        targetUserId: memberUserId,
        mode: overrides.mode,
        customRules: Object.keys(overrides.rules).length,
      },
      createdAt: new Date(),
    });
    await revalidateProjectPaths(projectId);
    const read = await readProjectMemberNotificationSettingsAction(
      projectId,
      memberUserId,
    );
    if (!read.success) return read;
    return { ...read, message: "Project notification preferences updated." };
  } catch (error) {
    logger.error("project.member_notification_settings_update_failed", {
      module: "projects",
      projectId,
      targetUserId: memberUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update member notification settings.",
    };
  }
}


export async function resetProjectMemberNotificationSettingsAction(
  projectId: string,
  memberUserId: string,
): Promise<ProjectMemberNotificationSettingsResult & { message?: string }> {
  return updateProjectMemberNotificationSettingsAction(
    projectId,
    memberUserId,
    {
      version: 1,
      mode: "inherit",
      rules: {},
    },
  );
}


export async function updateProjectMemberRoleAction(
  projectId: string,
  memberUserId: string,
  nextRole: "admin" | "member" | "viewer",
): Promise<ProjectMemberMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    if (!["admin", "member", "viewer"].includes(nextRole)) {
      return {
        success: false,
        errorCode: "INVALID_ROLE",
        message: "Invalid collaborator role.",
      };
    }

    const result = await db.transaction(async (tx) => {
      try {
        const lifecycle = await changeProjectMemberRoleInternal(tx, {
          projectId,
          actorId: user.id,
          targetUserId: memberUserId,
          nextRole,
        });
        return { ok: true as const, lifecycle };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Project not found")) {
          return {
            ok: false as const,
            errorCode: "NOT_FOUND" as const,
            message: "Project not found.",
          };
        }
        if (message.includes("permission")) {
          return {
            ok: false as const,
            errorCode: "FORBIDDEN" as const,
            message,
          };
        }
        return {
          ok: false as const,
          errorCode: "INTERNAL_ERROR" as const,
          message: "Failed to update collaborator role.",
        };
      }
    });

    if (!result.ok) {
      return {
        success: false,
        errorCode: result.errorCode,
        message: result.message,
      };
    }
    await revalidateProjectPaths(projectId);
    if (result.lifecycle.changed) {
      const actor = actorNotificationSnapshot(user);
      const nextRoleLabel = collaboratorRoleLabel(
        result.lifecycle.nextRole ?? nextRole,
      );
      await enqueueProjectNotificationBestEffort(
        {
          projectId,
          actorUserId: user.id,
          ...actor,
          eventKey: "members.role_changed",
          affectedMemberId: memberUserId,
          title: `${actor.actorName || "Someone"} updated your project role`,
          body: result.lifecycle.project.title
            ? `${result.lifecycle.project.title}: ${nextRoleLabel}`
            : `New role: ${nextRoleLabel}`,
          href: `/projects/${encodeURIComponent(result.lifecycle.project.slug || projectId)}?tab=settings`,
          entityRefs: {
            projectId,
            projectSlug: result.lifecycle.project.slug ?? null,
            targetUserId: memberUserId,
            previousRole: result.lifecycle.previousRole
              ? collaboratorRoleLabel(result.lifecycle.previousRole)
              : null,
            nextRole: nextRoleLabel,
          },
          preview: {
            actorName: actor.actorName,
            actorAvatarUrl: actor.actorAvatarUrl,
            contextLabel: result.lifecycle.project.title ?? "Project",
            contextKind: "project",
            secondaryText: `Role changed to ${nextRoleLabel}`,
          },
          sourceEventId:
            result.lifecycle.eventId ??
            `${result.lifecycle.previousRole}:${result.lifecycle.nextRole}`,
        },
        {
          action: "member_role_changed",
          targetUserId: memberUserId,
        },
      );
    }

    return {
      success: true,
      message: result.lifecycle.changed
        ? `Updated collaborator role to ${collaboratorRoleLabel(result.lifecycle.nextRole ?? nextRole)}.`
        : "Collaborator already has that role.",
    };
  } catch (error) {
    console.error("Failed to update project member role:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update collaborator role.",
    };
  }
}


export async function getProjectMemberRemovalPreflightAction(
  projectId: string,
  memberUserId: string,
): Promise<ProjectMemberRemovalPreflightResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_collaborators",
    );
    if (memberUserId === capability.project.ownerId) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "Use transfer ownership before removing the owner.",
      };
    }

    const [memberRow] = await db
      .select({
        id: profiles.id,
        username: profiles.username,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
        ),
      )
      .limit(1);
    if (!memberRow?.id) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "This user is no longer a project member.",
      };
    }
    const actorRole = capability.role;
    const targetRole = normalizeCollaboratorRole(
      memberRow.role,
      memberUserId === capability.project.ownerId ? "owner" : "member",
    );
    if (!canProjectRoleManageTarget({ actorRole, targetRole })) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to remove this collaborator.",
      };
    }
    const roleTitleByUser = await readAcceptedRoleTitles(projectId, [
      memberUserId,
    ]);
    const [projectRow] = await db
      .select({
        visibility: projects.visibility,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const counts = (
      await readProjectCollaboratorResponsibilityCounts(
        projectId,
        [memberUserId],
      )
    ).get(memberUserId);
    const impact = await readProjectMemberRemovalImpact(
      db,
      projectId,
      memberUserId,
    );

    return {
      success: true,
      data: {
        member: {
          id: memberRow.id,
          username: memberRow.username,
          fullName: memberRow.fullName,
          avatarUrl: memberRow.avatarUrl,
          membershipRole: normalizeCollaboratorRole(memberRow.role),
          projectRoleTitle: roleTitleByUser.get(memberUserId) ?? null,
        },
        activeAssignedTasks: counts?.activeAssignedTasks ?? 0,
        activeCreatedTasks: counts?.activeCreatedTasks ?? 0,
        fileReviews: counts?.fileReviews ?? 0,
        acceptedApplications: counts?.acceptedApplications ?? 0,
        projectGroupParticipant: counts?.projectGroupParticipant ?? false,
        visibility: normalizeProjectVisibility(projectRow?.visibility),
        activeAssignedTaskItems: impact.assignedTasks,
        activeCreatedTaskItems: impact.createdTasks,
        fileReviewItems: impact.fileReviews,
        acceptedApplicationItems: impact.acceptedApplications.map(
          (application) => ({
            ...application,
            roleId: application.roleId || "",
            roleTitle: application.roleTitle ?? null,
            roleName: application.roleName ?? null,
          }),
        ),
        reassignmentCandidates: impact.reassignmentCandidates.map(
          (candidate) => ({
            id: candidate.id,
            username: candidate.username,
            fullName: candidate.fullName,
            avatarUrl: candidate.avatarUrl,
            membershipRole: normalizeCollaboratorRole(
              candidate.role,
              candidate.id === capability.project.ownerId ? "owner" : "member",
            ),
          }),
        ),
      },
    };
  } catch (error) {
    console.error("Failed to load member removal preflight:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to remove this collaborator.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load removal preflight.",
    };
  }
}


const removeProjectMemberSchema = z.object({
  mode: z
    .enum([
      "preserve_history",
      "unassign_active_tasks",
      "reassign_active_tasks",
    ])
    .default("preserve_history"),
  reassignToUserId: z.string().uuid().nullable().optional(),
});


export async function removeProjectMemberAction(
  projectId: string,
  memberUserId: string,
  options?: {
    mode?:
      | "preserve_history"
      | "unassign_active_tasks"
      | "reassign_active_tasks";
    reassignToUserId?: string | null;
  },
): Promise<ProjectMemberMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const parsed = removeProjectMemberSchema.safeParse(options ?? {});
    if (!parsed.success)
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Invalid removal options.",
      };

    const txResult = await db.transaction(async (tx) => {
        const lifecycle = await removeProjectMemberInternal(tx, {
          projectId,
          actorId: user.id,
          targetUserId: memberUserId,
          mode: parsed.data.mode,
          reassignToUserId: parsed.data.reassignToUserId ?? null,
        });
        return { ok: true as const, lifecycle };
    }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Project not found")) {
          return {
            ok: false as const,
            errorCode: "NOT_FOUND" as const,
            message: "Project not found.",
          };
        }
        if (message.includes("permission") || message.includes("owner")) {
          return {
            ok: false as const,
            errorCode: "FORBIDDEN" as const,
            message,
          };
        }
        if (
          message.includes("Replacement") ||
          message.includes("valid replacement")
        ) {
          return {
            ok: false as const,
            errorCode: "INVALID_INPUT" as const,
            message,
          };
        }
        return {
          ok: false as const,
          errorCode: "INTERNAL_ERROR" as const,
          message: "Failed to remove collaborator.",
        };
    });

    if (!txResult.ok) {
      return {
        success: false,
        errorCode: txResult.errorCode,
        message: txResult.message,
      };
    }
    await revalidateProjectPaths(projectId);
    await queueCounterRefreshBestEffort([memberUserId, parsed.data.reassignToUserId ?? null]);
    if (txResult.lifecycle.assignmentNotifications.length) {
      await wakeEmailWorker();
      try {
        await enqueueProjectNotificationEvents(txResult.lifecycle.assignmentNotifications);
      } catch (error) {
        logger.warn("project.notification_policy_enqueue_failed", {
          module: "projects", projectId, action: "member_removal_task_reassignment",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const actor = actorNotificationSnapshot(user);
    await enqueueProjectNotificationBestEffort(
      {
        projectId,
        actorUserId: user.id,
        ...actor,
        eventKey: "members.removed",
        affectedMemberId: memberUserId,
        title: `${actor.actorName || "Someone"} removed you from a project`,
        body: txResult.lifecycle.project.title ?? "Project access removed",
        href: `/projects/${encodeURIComponent(txResult.lifecycle.project.slug || projectId)}`,
        entityRefs: {
          projectId,
          projectSlug: txResult.lifecycle.project.slug ?? null,
          targetUserId: memberUserId,
        },
        preview: {
          actorName: actor.actorName,
          actorAvatarUrl: actor.actorAvatarUrl,
          contextLabel: txResult.lifecycle.project.title ?? "Project",
          contextKind: "project",
          secondaryText: "Removed from project",
        },
        sourceEventId:
          txResult.lifecycle.eventId ??
          `${txResult.lifecycle.previousRole}:removed`,
      },
      {
        action: "member_removed",
        targetUserId: memberUserId,
      },
    );
    return {
      success: true,
      message: "Collaborator removed. Historical references were preserved.",
    };
  } catch (error) {
    console.error("Failed to remove project member:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to remove collaborator.",
    };
  }
}


export async function getProjectDangerZonePreflightAction(
  projectId: string,
): Promise<ProjectDangerZonePreflightResult> {
  const viewer = await signedInSettingsViewer();
  if (!viewer) return UNAUTHORIZED_SETTINGS;
  return readDangerZonePreflight(viewer, projectId);
}

export async function readDangerZonePreflight(
  viewer: SettingsViewer,
  projectId: string,
): Promise<ProjectDangerZonePreflightResult> {
  try {
    const owned = await loadOwnedProjectForSettings(projectId, viewer.userId);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };

    const [openRolesRow, pendingAppsRow, activeTasksRow] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectOpenRoles)
        .where(eq(projectOpenRoles.projectId, projectId))
        .limit(1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(roleApplications)
        .where(
          and(
            eq(roleApplications.projectId, projectId),
            eq(roleApplications.status, "pending"),
          ),
        )
        .limit(1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`,
          ),
        )
        .limit(1),
    ]);

    const status =
      owned.project.status === "draft" ||
      owned.project.status === "active" ||
      owned.project.status === "completed" ||
      owned.project.status === "archived"
        ? owned.project.status
        : "draft";
    const activeTasksCount = Number(activeTasksRow[0]?.count ?? 0);
    const openRolesCount = Number(openRolesRow[0]?.count ?? 0);
    const pendingApplicationsCount = Number(pendingAppsRow[0]?.count ?? 0);

    return {
      success: true,
      data: {
        status,
        openRolesCount,
        pendingApplicationsCount,
        activeTasksCount,
        canArchive: status !== "archived",
        canDelete: true,
      },
    };
  } catch (error) {
    console.error("Failed to run danger-zone preflight:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to prepare danger-zone checks.",
    };
  }
}


export async function readProjectSettingsBootstrapAction(
  projectId: string,
  collaborators: ProjectCollaboratorSettingsOptions,
) {
  // One sign-in check and one project access read serve every section (PERF-011).
  const viewer = await signedInSettingsViewer();

  if (!viewer) {
    return {
      collaboratorSettings: UNAUTHORIZED_SETTINGS,
      fileWorkspace: UNAUTHORIZED_SETTINGS,
      notifications: UNAUTHORIZED_SETTINGS,
      docSettings: { ...UNAUTHORIZED_SETTINGS, error: "You must be signed in." },
      dangerPreflight: UNAUTHORIZED_SETTINGS,
    };
  }

  // Ownership is verified on the server, never supplied by the caller.
  const isOwner = (await viewer.access(projectId)).isOwner;

  const [collaboratorSettings, fileWorkspace, notifications, docSettings, dangerPreflight] = await Promise.all([
    readCollaboratorSettings(viewer, projectId, collaborators),
    readFileWorkspaceSettings(viewer, projectId),
    readNotificationSettings(viewer, projectId),
    readProjectDocSettingsAction(projectId),
    isOwner ? readDangerZonePreflight(viewer, projectId) : Promise.resolve({ success: false as const, errorCode: "FORBIDDEN" as const, message: "Only the project owner can access danger zone settings." }),
  ]);
  return { collaboratorSettings, fileWorkspace, notifications, docSettings, dangerPreflight };
}
