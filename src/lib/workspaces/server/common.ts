import "server-only";

import { createHash } from "crypto";
import { invalidatePublicWorkspacesFeedCache } from "@/lib/workspaces/public-feed-service";
import { revalidatePath, revalidateTag } from "next/cache";
import { DISCOVER_ANON_CACHE_TAG } from "@/constants/discover";
import { db } from "@/lib/db";
import { workspaces, workspaceMembers, profiles, githubSyncConnections, workspaceFollows } from "@/lib/db/schema";
import { eq, and, isNull, or, sql } from "drizzle-orm";
import { publishUsers } from "@/lib/messaging/publish";
import { markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";
import { isLooseUuid } from "@/lib/validations/uuid";
import { alias } from "drizzle-orm/pg-core";
import { computeWorkspaceReadAccess, computeWorkspaceWriteAccess } from "@/lib/data/workspace-access";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";



// Queue Imports

export const isMissingColumn = (error: unknown, column: string) => {
  const msg = error instanceof Error ? error.message : String(error);
  const lowered = msg.toLowerCase();
  return (
    lowered.includes(column.toLowerCase()) &&
    (lowered.includes("column") ||
      lowered.includes("failed query") ||
      lowered.includes("does not exist"))
  );
};


export const WORKSPACE_COVER_UPLOAD_BUCKET = "project-files";

export const WORKSPACE_COVER_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const WORKSPACE_IMAGE_PROXY_ROUTE_PREFIX = "/api/v1/workspaces";

export const PUBLIC_WORKSPACE_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";

export const PUBLIC_WORKSPACE_DETAIL_METADATA_CACHE_TAG =
  "public-project-detail-metadata";


export function buildWorkspaceImageRoute(projectId: string, storageKey: string) {
  const version = createHash("sha256").update(storageKey).digest("base64url").slice(0, 16);
  return `${WORKSPACE_IMAGE_PROXY_ROUTE_PREFIX}/${projectId}/image?v=${version}`;
}


export const revalidateWorkspacePaths = async (projectId: string) => {
  try {
    await invalidatePublicWorkspacesFeedCache(projectId);
  } catch (err) {
    console.error("Failed to invalidate public feed cache:", err);
  }
  revalidatePath("/discover");
  revalidatePath("/my-profile");
  // The anonymous Discover page cache (actions/discover.ts) drops a hidden project at once.
  // Expire now: "max" would keep serving the stale page (with a project gone private) while it refreshes.
  revalidateTag(DISCOVER_ANON_CACHE_TAG, { expire: 0 });
  revalidatePath(`/workspaces/${projectId}`);
  // Expire now, as above: a project gone private must not keep its public shell or preview metadata.
  revalidateTag(PUBLIC_WORKSPACE_DETAIL_SHELL_CACHE_TAG, { expire: 0 });
  revalidateTag(PUBLIC_WORKSPACE_DETAIL_METADATA_CACHE_TAG, { expire: 0 });
  try {
    const [project] = await db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, projectId))
      .limit(1);
    if (project?.slug) {
      revalidatePath(`/workspaces/${project.slug}`);
    }
  } catch {
    // Ignore slug revalidation errors on legacy schemas.
  }
};


export async function invalidateWorkspacePublicCaches(projectId: string) {
  const feed = await invalidatePublicWorkspacesFeedCache(projectId);
  revalidatePath("/discover");
  revalidatePath("/my-profile");
  // Expire now: "max" would keep serving the stale page (with a project gone private) while it refreshes.
  revalidateTag(DISCOVER_ANON_CACHE_TAG, { expire: 0 });
  revalidateTag(PUBLIC_WORKSPACE_DETAIL_SHELL_CACHE_TAG, { expire: 0 });
  revalidateTag(PUBLIC_WORKSPACE_DETAIL_METADATA_CACHE_TAG, { expire: 0 });

  try {
    const [members, project] = await Promise.all([
      db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.projectId, projectId)),
      db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1).then((r) => r[0]),
    ]);
    const userIds = Array.from(new Set([
      ...(project?.ownerId ? [project.ownerId] : []),
      ...members.map((m) => m.userId),
    ]));
    if (userIds.length > 0) {
      publishUsers(userIds, "share.preview_changed", { resource_key: createHash("sha256").update(`project:${projectId}`).digest("hex") });
      await markProfileCollaborationSummaryStale(userIds);
    }
  } catch {
    // Non-fatal if summary stale mark fails
  }

  return feed;
}


export function isWorkspaceDetailMemberRole(
  value: unknown,
): value is "owner" | "admin" | "member" | "viewer" {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
  );
}


export const WORKSPACE_DETAIL_TRANSIENT_DB_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export const WORKSPACE_DETAIL_READ_RETRY_DELAYS_MS = [150, 450] as const;


export function readErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}


export function isTransientWorkspaceDetailReadError(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false;

  const code = readErrorCode(error);
  if (code && WORKSPACE_DETAIL_TRANSIENT_DB_ERROR_CODES.has(code)) return true;

  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("getaddrinfo") ||
    normalizedMessage.includes("connection terminated") ||
    normalizedMessage.includes("connection timeout") ||
    normalizedMessage.includes("connect timeout")
  ) {
    return true;
  }

  if (error && typeof error === "object" && "cause" in error) {
    return isTransientWorkspaceDetailReadError(
      (error as { cause?: unknown }).cause,
      depth + 1,
    );
  }

  return false;
}


export async function retryWorkspaceDetailRead<T>(
  operation: string,
  read: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= WORKSPACE_DETAIL_READ_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      const retryDelayMs = WORKSPACE_DETAIL_READ_RETRY_DELAYS_MS[attempt];
      if (
        retryDelayMs === undefined ||
        !isTransientWorkspaceDetailReadError(error)
      ) {
        throw error;
      }

      logger.warn("project_detail.read_retry", {
        operation,
        attempt: attempt + 1,
        retryDelayMs,
        errorCode:
          readErrorCode(error) ??
          readErrorCode((error as { cause?: unknown } | null)?.cause) ??
          null,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
}


export async function resolveWorkspaceDetailTarget(
  slugOrId: string,
  actorUserId: string | null = null,
) {
  const trimmed = slugOrId.trim();
  const isUuid = isLooseUuid(trimmed);
  const where = isUuid
    ? and(
        isNull(workspaces.deletedAt),
        or(eq(workspaces.slug, trimmed), eq(workspaces.id, trimmed)),
      )
    : and(isNull(workspaces.deletedAt), eq(workspaces.slug, trimmed));

  const project = await retryWorkspaceDetailRead(
    "resolve_project_detail_target",
    async () => {
      const ownerProfiles = alias(profiles, "project_detail_owner_profiles");
      const q = db
        .select({
          id: workspaces.id,
          ownerId: workspaces.ownerId,
          ownerUsername: ownerProfiles.username,
          ownerFullName: ownerProfiles.fullName,
          ownerAvatarUrl: ownerProfiles.avatarUrl,
          title: workspaces.title,
          slug: workspaces.slug,
          kind: workspaces.kind,
          parentId: workspaces.parentId,
          orgSettings: workspaces.orgSettings,
          description: workspaces.description,
          shortDescription: workspaces.shortDescription,
          problemStatement: workspaces.problemStatement,
          solutionStatement: workspaces.solutionStatement,
          coverImage: workspaces.coverImage,
          category: workspaces.category,
          tags: workspaces.tags,
          skills: workspaces.skills,
          externalLinks: workspaces.externalLinks,
          externalLinkMetadata: workspaces.externalLinkMetadata,
          visibility: workspaces.visibility,
          publicTabVisibility: workspaces.publicTabVisibility,
          lookingForCollaborators: workspaces.lookingForCollaborators,
          memberUpdatesEnabled: workspaces.memberUpdatesEnabled,
          memberFileUploadDefault: workspaces.memberFileUploadDefault,
          maxCollaborators: workspaces.maxCollaborators,
          status: workspaces.status,
          lifecycleStages: workspaces.lifecycleStages,
          currentStageIndex: workspaces.currentStageIndex,
          stageCompletionDates: workspaces.stageCompletionDates,
          importSource: workspaces.importSource,
          githubRepoUrl: workspaces.githubRepoUrl,
          githubDefaultBranch: workspaces.githubDefaultBranch,
          githubSyncRepository: githubSyncConnections.repository,
          githubSyncBranch: githubSyncConnections.branch,
          syncStatus: workspaces.syncStatus,
          createdAt: workspaces.createdAt,
          updatedAt: workspaces.updatedAt,
          viewCount: workspaces.viewCount,
          followersCount: workspaces.followersCount,
          key: workspaces.key,
          memberRole: actorUserId
            ? workspaceMembers.role
            : sql<string | null>`NULL`,
          memberCompletedAt: actorUserId
            ? workspaceMembers.completedAt
            : sql<Date | null>`NULL`,
          isFollowed: actorUserId
            ? sql<boolean>`${workspaceFollows.id} IS NOT NULL`
            : sql<boolean>`false`,
        })
        .from(workspaces)
        .leftJoin(ownerProfiles, eq(workspaces.ownerId, ownerProfiles.id))
        .leftJoin(
          githubSyncConnections,
          eq(workspaces.id, githubSyncConnections.projectId),
        );

      if (actorUserId) {
        q.leftJoin(
          workspaceMembers,
          and(
            eq(workspaceMembers.projectId, workspaces.id),
            eq(workspaceMembers.userId, actorUserId),
          ),
        ).leftJoin(
          workspaceFollows,
          and(
            eq(workspaceFollows.projectId, workspaces.id),
            eq(workspaceFollows.userId, actorUserId),
          ),
        );
      }

      const [row] = await q.where(where).limit(1);
      if (!row) return null;
      return {
        ...row,
        owner: row.ownerId
          ? {
              id: row.ownerId,
              username: row.ownerUsername ?? null,
              fullName: row.ownerFullName ?? null,
              avatarUrl: row.ownerAvatarUrl ?? null,
            }
          : null,
      };
    },
  );

  return project ?? null;
}


// resolveProjectDetailMetadataTarget was deleted in favor of resolveWorkspaceDetailTarget to eliminate code duplication under Ponytail standards.

export function resolveWorkspaceDetailViewerState(input: {
  projectId: string;
  ownerId: string;
  visibility: string | null;
  status: string | null;
  actorUserId: string | null;
  memberRoleRaw: string | null;
  isFollowed: boolean;
  /** The viewer's role in the parent org, for Org only child projects and inherited admins. */
  parentOrgRole?: "owner" | "admin" | "member" | "viewer" | null;
  /** Member settings §3: a completed part is read-only (mirrors getWorkspaceAccess). */
  memberCompletedAt?: Date | string | null;
}) {
  const {
    ownerId,
    visibility,
    status,
    actorUserId,
    memberRoleRaw,
    isFollowed,
  } = input;
  const isOwner = !!actorUserId && actorUserId === ownerId;
  const memberRole = isWorkspaceDetailMemberRole(memberRoleRaw)
    ? memberRoleRaw
    : null;
  const isMember = !isOwner && !!memberRole;
  const canRead = computeWorkspaceReadAccess(
    visibility,
    status,
    isOwner,
    isMember,
    input.parentOrgRole ?? null,
  );
  const completed = isMember && Boolean(input.memberCompletedAt);
  const canWrite = !completed && computeWorkspaceWriteAccess(isOwner, memberRole);

  return {
    completed,
    canRead,
    canWrite,
    isOwner,
    isMember,
    // A completed member acts as a viewer until they reopen (member settings §3), like getWorkspaceAccess.
    memberRole: completed ? ("viewer" as const) : memberRole,
    isFollowed,
  };
}


export type WorkspaceSettingsErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "STORAGE_MIGRATION_PENDING"
  | "INTERNAL_ERROR";


export type WorkspaceSettingsMutationResult =
  | { success: true; message: string }
  | { success: false; message: string; errorCode: WorkspaceSettingsErrorCode };


export type WorkspaceSettingsAuditResult =
  | {
      success: true;
      data: Array<{
        id: string;
        type: string;
        createdAt: string;
        actorName: string | null;
        metadata: Record<string, unknown>;
      }>;
    }
  | { success: false; message: string; errorCode: WorkspaceSettingsErrorCode };



export function actorNotificationSnapshot(user: {
  user_metadata?: Record<string, unknown> | null;
}) {
  return {
    actorName:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.username as string | undefined) ??
      null,
    actorAvatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
}


export async function enqueueWorkspaceNotificationBestEffort(
  input: Parameters<typeof enqueueWorkspaceNotificationEvent>[0],
  logContext: Record<string, unknown>,
) {
  try {
    await enqueueWorkspaceNotificationEvent(input);
  } catch (notificationError) {
    logger.warn("project.notification_policy_enqueue_failed", {
      module: "projects",
      eventKey: input.eventKey,
      projectId: input.projectId,
      ...logContext,
      error:
        notificationError instanceof Error
          ? notificationError.message
          : String(notificationError),
    });
  }
}


export async function loadOwnedWorkspaceForSettings(projectId: string, userId: string) {
  const [project] = await db
    .select({
      id: workspaces.id,
      ownerId: workspaces.ownerId,
      title: workspaces.title,
      slug: workspaces.slug,
      status: workspaces.status,
      visibility: workspaces.visibility,
      coverImage: workspaces.coverImage,
      coverImageBucket: workspaces.coverImageBucket,
      coverImageKey: workspaces.coverImageKey,
      coverImageAssetId: workspaces.coverImageAssetId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, projectId))
    .limit(1);

  if (!project) {
    return {
      ok: false as const,
      errorCode: "NOT_FOUND" as const,
      message: "Workspace not found.",
    };
  }
  if (project.ownerId !== userId) {
    return {
      ok: false as const,
      errorCode: "FORBIDDEN" as const,
      message: "Only the owner can change these settings.",
    };
  }
  return { ok: true as const, project };
}
