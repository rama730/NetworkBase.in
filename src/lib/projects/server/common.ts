import "server-only";

import { createHash } from "crypto";
import { invalidatePublicProjectsFeedCache } from "@/lib/projects/public-feed-service";
import { revalidatePath, revalidateTag } from "next/cache";
import { DISCOVER_ANON_CACHE_TAG } from "@/constants/discover";
import { db } from "@/lib/db";
import { projects, projectMembers, profiles, githubSyncConnections, projectFollows } from "@/lib/db/schema";
import { eq, and, isNull, or, sql } from "drizzle-orm";
import { publishUsers } from "@/lib/messaging/publish";
import { markProfileCollaborationSummaryStale } from "@/lib/profile/collaboration";
import { logger } from "@/lib/logger";
import { isLooseUuid } from "@/lib/validations/uuid";
import { alias } from "drizzle-orm/pg-core";
import { computeProjectReadAccess, computeProjectWriteAccess } from "@/lib/data/project-access";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";



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


export const PROJECT_COVER_UPLOAD_BUCKET = "project-files";

export const PROJECT_COVER_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const PROJECT_IMAGE_PROXY_ROUTE_PREFIX = "/api/v1/projects";

export const PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";

export const PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG =
  "public-project-detail-metadata";


export function buildProjectImageRoute(projectId: string, storageKey: string) {
  const version = createHash("sha256").update(storageKey).digest("base64url").slice(0, 16);
  return `${PROJECT_IMAGE_PROXY_ROUTE_PREFIX}/${projectId}/image?v=${version}`;
}


export const revalidateProjectPaths = async (projectId: string) => {
  try {
    await invalidatePublicProjectsFeedCache(projectId);
  } catch (err) {
    console.error("Failed to invalidate public feed cache:", err);
  }
  revalidatePath("/discover");
  revalidatePath("/my-profile");
  // The anonymous Discover page cache (actions/discover.ts) drops a hidden project at once.
  // Expire now: "max" would keep serving the stale page (with a project gone private) while it refreshes.
  revalidateTag(DISCOVER_ANON_CACHE_TAG, { expire: 0 });
  revalidatePath(`/projects/${projectId}`);
  // Expire now, as above: a project gone private must not keep its public shell or preview metadata.
  revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, { expire: 0 });
  revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, { expire: 0 });
  try {
    const [project] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (project?.slug) {
      revalidatePath(`/projects/${project.slug}`);
    }
  } catch {
    // Ignore slug revalidation errors on legacy schemas.
  }
};


export async function invalidateProjectPublicCaches(projectId: string) {
  const feed = await invalidatePublicProjectsFeedCache(projectId);
  revalidatePath("/discover");
  revalidatePath("/my-profile");
  // Expire now: "max" would keep serving the stale page (with a project gone private) while it refreshes.
  revalidateTag(DISCOVER_ANON_CACHE_TAG, { expire: 0 });
  revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, { expire: 0 });
  revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, { expire: 0 });

  try {
    const [members, project] = await Promise.all([
      db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId)),
      db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId)).limit(1).then((r) => r[0]),
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


export function isProjectDetailMemberRole(
  value: unknown,
): value is "owner" | "admin" | "member" | "viewer" {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
  );
}


export const PROJECT_DETAIL_TRANSIENT_DB_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export const PROJECT_DETAIL_READ_RETRY_DELAYS_MS = [150, 450] as const;


export function readErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}


export function isTransientProjectDetailReadError(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false;

  const code = readErrorCode(error);
  if (code && PROJECT_DETAIL_TRANSIENT_DB_ERROR_CODES.has(code)) return true;

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
    return isTransientProjectDetailReadError(
      (error as { cause?: unknown }).cause,
      depth + 1,
    );
  }

  return false;
}


export async function retryProjectDetailRead<T>(
  operation: string,
  read: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= PROJECT_DETAIL_READ_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      const retryDelayMs = PROJECT_DETAIL_READ_RETRY_DELAYS_MS[attempt];
      if (
        retryDelayMs === undefined ||
        !isTransientProjectDetailReadError(error)
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


export async function resolveProjectDetailTarget(
  slugOrId: string,
  actorUserId: string | null = null,
) {
  const trimmed = slugOrId.trim();
  const isUuid = isLooseUuid(trimmed);
  const where = isUuid
    ? and(
        isNull(projects.deletedAt),
        or(eq(projects.slug, trimmed), eq(projects.id, trimmed)),
      )
    : and(isNull(projects.deletedAt), eq(projects.slug, trimmed));

  const project = await retryProjectDetailRead(
    "resolve_project_detail_target",
    async () => {
      const ownerProfiles = alias(profiles, "project_detail_owner_profiles");
      const q = db
        .select({
          id: projects.id,
          ownerId: projects.ownerId,
          ownerUsername: ownerProfiles.username,
          ownerFullName: ownerProfiles.fullName,
          ownerAvatarUrl: ownerProfiles.avatarUrl,
          title: projects.title,
          slug: projects.slug,
          kind: projects.kind,
          parentId: projects.parentId,
          orgSettings: projects.orgSettings,
          description: projects.description,
          shortDescription: projects.shortDescription,
          problemStatement: projects.problemStatement,
          solutionStatement: projects.solutionStatement,
          coverImage: projects.coverImage,
          category: projects.category,
          tags: projects.tags,
          skills: projects.skills,
          externalLinks: projects.externalLinks,
          externalLinkMetadata: projects.externalLinkMetadata,
          visibility: projects.visibility,
          publicTabVisibility: projects.publicTabVisibility,
          lookingForCollaborators: projects.lookingForCollaborators,
          memberUpdatesEnabled: projects.memberUpdatesEnabled,
          memberFileUploadDefault: projects.memberFileUploadDefault,
          maxCollaborators: projects.maxCollaborators,
          status: projects.status,
          lifecycleStages: projects.lifecycleStages,
          currentStageIndex: projects.currentStageIndex,
          stageCompletionDates: projects.stageCompletionDates,
          importSource: projects.importSource,
          githubRepoUrl: projects.githubRepoUrl,
          githubDefaultBranch: projects.githubDefaultBranch,
          githubSyncRepository: githubSyncConnections.repository,
          githubSyncBranch: githubSyncConnections.branch,
          syncStatus: projects.syncStatus,
          updatedAt: projects.updatedAt,
          viewCount: projects.viewCount,
          followersCount: projects.followersCount,
          key: projects.key,
          memberRole: actorUserId
            ? projectMembers.role
            : sql<string | null>`NULL`,
          isFollowed: actorUserId
            ? sql<boolean>`${projectFollows.id} IS NOT NULL`
            : sql<boolean>`false`,
        })
        .from(projects)
        .leftJoin(ownerProfiles, eq(projects.ownerId, ownerProfiles.id))
        .leftJoin(
          githubSyncConnections,
          eq(projects.id, githubSyncConnections.projectId),
        );

      if (actorUserId) {
        q.leftJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, projects.id),
            eq(projectMembers.userId, actorUserId),
          ),
        ).leftJoin(
          projectFollows,
          and(
            eq(projectFollows.projectId, projects.id),
            eq(projectFollows.userId, actorUserId),
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


// resolveProjectDetailMetadataTarget was deleted in favor of resolveProjectDetailTarget to eliminate code duplication under Ponytail standards.

export function resolveProjectDetailViewerState(input: {
  projectId: string;
  ownerId: string;
  visibility: string | null;
  status: string | null;
  actorUserId: string | null;
  memberRoleRaw: string | null;
  isFollowed: boolean;
  /** The viewer's role in the parent org, for Org only child projects and inherited admins. */
  parentOrgRole?: "owner" | "admin" | "member" | "viewer" | null;
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
  const memberRole = isProjectDetailMemberRole(memberRoleRaw)
    ? memberRoleRaw
    : null;
  const isMember = !isOwner && !!memberRole;
  const canRead = computeProjectReadAccess(
    visibility,
    status,
    isOwner,
    isMember,
    input.parentOrgRole ?? null,
  );
  const canWrite = computeProjectWriteAccess(isOwner, memberRole);

  return {
    canRead,
    canWrite,
    isOwner,
    isMember,
    memberRole,
    isFollowed,
  };
}


export type ProjectSettingsErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "STORAGE_MIGRATION_PENDING"
  | "INTERNAL_ERROR";


export type ProjectSettingsMutationResult =
  | { success: true; message: string }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


export type ProjectSettingsAuditResult =
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
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };



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


export async function enqueueProjectNotificationBestEffort(
  input: Parameters<typeof enqueueProjectNotificationEvent>[0],
  logContext: Record<string, unknown>,
) {
  try {
    await enqueueProjectNotificationEvent(input);
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


export async function loadOwnedProjectForSettings(projectId: string, userId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      ownerId: projects.ownerId,
      title: projects.title,
      slug: projects.slug,
      status: projects.status,
      visibility: projects.visibility,
      coverImage: projects.coverImage,
      coverImageBucket: projects.coverImageBucket,
      coverImageKey: projects.coverImageKey,
      coverImageAssetId: projects.coverImageAssetId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    return {
      ok: false as const,
      errorCode: "NOT_FOUND" as const,
      message: "Project not found.",
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
