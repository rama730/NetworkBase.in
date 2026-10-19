import "server-only";

import { randomUUID, createHash } from "crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
import { db } from "@/lib/db";
import { storageAssets, projectMembers, projectFollows, projectOpenRoles, roleApplications, tasks, profiles, projects, projectNodeEvents } from "@/lib/db/schema";
import { and, eq, sql, isNull, desc } from "drizzle-orm";
import { type ProjectVisibility, isProjectVisibility, normalizeProjectVisibility } from "@/lib/projects/project-visibility";
import { buildProjectAccessTransitionPolicy, type ProjectPublicTabVisibility, normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import { markProjectCollaboratorsSummaryStale } from "@/lib/profile/collaboration";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { requireProjectCapability } from "@/lib/projects/collaborator-lifecycle";
import { PROJECT_COVER_UPLOAD_BUCKET, buildProjectImageRoute, PROJECT_COVER_UPLOAD_MAX_FILE_BYTES, type ProjectSettingsErrorCode, loadOwnedProjectForSettings, type ProjectSettingsMutationResult, revalidateProjectPaths, invalidateProjectPublicCaches, actorNotificationSnapshot } from "./common";

const LEGACY_PROJECT_COVER_UPLOAD_BUCKET = "avatars";

const PROJECT_IMAGE_STORAGE_FOLDERS = [
  "project-images",
  "project-covers",
] as const;


type AccessTransitionPreview = {
  followers: Array<{
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  }>;
  openRoles: Array<{ id: string; title: string | null; role: string | null }>;
  pendingApplications: Array<{
    id: string;
    applicantId: string;
    applicantName: string | null;
    roleTitle: string | null;
    roleName: string | null;
  }>;
};


function projectCoverStorageKeyFromPublicUrl(
  value: string | null | undefined,
  userId: string,
  projectId: string,
  bucket = PROJECT_COVER_UPLOAD_BUCKET,
) {
  if (!value) return null;

  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }

  const markers = [
    `/object/public/${bucket}/`,
    `/render/image/public/${bucket}/`,
  ];
  const marker = markers.find((candidate) => pathname.includes(candidate));
  if (!marker) return null;

  const storageKey = pathname
    .slice(pathname.indexOf(marker) + marker.length)
    .replace(/^\/+/, "");
  const expectedPrefixes = PROJECT_IMAGE_STORAGE_FOLDERS.map(
    (folder) => `${userId}/${folder}/${projectId}/`,
  );
  expectedPrefixes.push(`projects/${projectId}/project-images/`);
  return expectedPrefixes.some((prefix) => storageKey.startsWith(prefix))
    ? storageKey
    : null;
}


async function migrateLegacyProjectImageToManagedStorage(params: {
  projectId: string;
  userId: string;
  coverImage: string | null;
  coverImageBucket?: string | null;
  coverImageKey?: string | null;
  coverImageAssetId?: string | null;
}) {
  if (params.coverImageBucket && params.coverImageKey) {
    return {
      bucket: params.coverImageBucket,
      key: params.coverImageKey,
      url: buildProjectImageRoute(params.projectId, params.coverImageKey),
      migrated: false,
      assetId: params.coverImageAssetId ?? null,
    };
  }

  const legacyKey =
    projectCoverStorageKeyFromPublicUrl(
      params.coverImage,
      params.userId,
      params.projectId,
      LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
    ) ??
    projectCoverStorageKeyFromPublicUrl(
      params.coverImage,
      params.userId,
      params.projectId,
      PROJECT_COVER_UPLOAD_BUCKET,
    );
  const legacyBucket = projectCoverStorageKeyFromPublicUrl(
    params.coverImage,
    params.userId,
    params.projectId,
    LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
  )
    ? LEGACY_PROJECT_COVER_UPLOAD_BUCKET
    : legacyKey
      ? PROJECT_COVER_UPLOAD_BUCKET
      : null;
  if (!legacyKey || !legacyBucket) return null;

  const extension = legacyKey.split(".").pop()?.toLowerCase() || "bin";
  const nextKey = `projects/${params.projectId}/project-images/${params.userId}/${Date.now()}-${randomUUID()}.${extension}`;
  const admin = await createAdminClient();
  const { data: legacyInfo, error: legacyInfoError } = await admin.storage
    .from(legacyBucket)
    .info(legacyKey);
  const legacySize = Number(legacyInfo?.size);
  if (legacyInfoError || !legacyInfo || !Number.isFinite(legacySize) || legacySize <= 0 || legacySize > PROJECT_COVER_UPLOAD_MAX_FILE_BYTES) {
    logger.warn("project.cover_migration_invalid_source", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      size: Number.isFinite(legacySize) ? legacySize : null,
      error: legacyInfoError?.message ?? null,
    });
    return null;
  }
  let sourceBytes: Buffer;
  try {
    sourceBytes = Buffer.from(await readBoundedStorageBytes({
      bucket: legacyBucket,
      storageKey: legacyKey,
      maxBytes: PROJECT_COVER_UPLOAD_MAX_FILE_BYTES,
    }));
  } catch (error) {
    logger.warn("project.cover_migration_download_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      bucket: legacyBucket,
      error: error instanceof Error ? error.message : "Missing file",
    });
    return null;
  }
  if (sourceBytes.byteLength <= 0) {
    logger.warn("project.cover_migration_invalid_size", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      size: sourceBytes.byteLength,
    });
    return null;
  }
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const legacyMimeType = legacyInfo.metadata?.mimetype;
  const mimeType = typeof legacyMimeType === "string" && legacyMimeType.length > 0
    ? legacyMimeType
    : "application/octet-stream";
  const [insertedLegacyAsset] = await db.insert(storageAssets).values({
    ownerUserId: params.userId,
    projectId: params.projectId,
    bucket: legacyBucket,
    storageKey: legacyKey,
    purpose: "legacy_project_cover:source",
    state: "verified",
    declaredMimeType: mimeType,
    declaredSize: sourceBytes.byteLength,
    verifiedMimeType: mimeType,
    verifiedSize: sourceBytes.byteLength,
    contentHash: sourceHash,
    metadata: { source: "legacy_project_cover_registration" },
    expiresAt: new Date(),
    verifiedAt: new Date(),
    backupState: "pending",
  }).onConflictDoNothing().returning({ id: storageAssets.id });
  const legacyAsset = insertedLegacyAsset ?? await db.query.storageAssets.findFirst({
    where: and(
      eq(storageAssets.bucket, legacyBucket),
      eq(storageAssets.storageKey, legacyKey),
      eq(storageAssets.state, "verified"),
    ),
    columns: { id: true },
  });
  if (!legacyAsset) return null;

  const { error: uploadError } = await admin.storage
    .from(PROJECT_COVER_UPLOAD_BUCKET)
    .upload(nextKey, sourceBytes, {
      upsert: false,
      contentType: mimeType === "application/octet-stream" ? undefined : mimeType,
      cacheControl: "31536000",
    });
  if (uploadError) {
    const { data: committedObject } = await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).info(nextKey);
    if (!committedObject) {
      logger.warn("project.cover_migration_upload_failed", {
        module: "projects",
        projectId: params.projectId,
        userId: params.userId,
        error: uploadError.message,
      });
      return null;
    }
  }

  let copiedBytes: Uint8Array;
  try {
    copiedBytes = await readBoundedStorageBytes({
      bucket: PROJECT_COVER_UPLOAD_BUCKET,
      storageKey: nextKey,
      maxBytes: PROJECT_COVER_UPLOAD_MAX_FILE_BYTES,
    });
  } catch (error) {
    await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).remove([nextKey]);
    logger.warn("project.cover_migration_verification_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      error: error instanceof Error ? error.message : "Copied object unavailable",
    });
    return null;
  }
  if (copiedBytes.byteLength !== sourceBytes.byteLength) {
    await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).remove([nextKey]);
    logger.warn("project.cover_migration_verification_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      error: "Copied size mismatch",
    });
    return null;
  }
  const copiedHash = createHash("sha256")
    .update(copiedBytes)
    .digest("hex");
  if (copiedHash !== sourceHash) {
    await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).remove([nextKey]);
    logger.warn("project.cover_migration_verification_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      error: "Copied digest mismatch",
    });
    return null;
  }
  const [asset] = await db.insert(storageAssets).values({
    ownerUserId: params.userId,
    projectId: params.projectId,
    bucket: PROJECT_COVER_UPLOAD_BUCKET,
    storageKey: nextKey,
    purpose: "project_cover:cover",
    state: "verified",
    declaredMimeType: mimeType,
    declaredSize: sourceBytes.byteLength,
    verifiedMimeType: mimeType,
    verifiedSize: sourceBytes.byteLength,
    contentHash: sourceHash,
    metadata: { source: "legacy_project_cover_migration", legacyBucket, legacyKey },
    expiresAt: new Date(),
    verifiedAt: new Date(),
    backupState: "pending",
  }).returning({ id: storageAssets.id });
  if (!asset) {
    await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).remove([nextKey]);
    return null;
  }

  return {
    bucket: PROJECT_COVER_UPLOAD_BUCKET,
    key: nextKey,
    url: buildProjectImageRoute(params.projectId, nextKey),
    migrated: true,
    assetId: asset.id,
    previousBucket: legacyBucket,
    previousKey: legacyKey,
    previousAssetId: legacyAsset.id,
  };
}


function buildAccessConfirmationToken(input: {
  projectId: string;
  previousVisibility: ProjectVisibility;
  nextVisibility: ProjectVisibility;
  membersCount: number;
  followersCount: number;
  openRolesCount: number;
  pendingApplicationsCount: number;
  activeTasksCount: number;
  hasManagedProjectImage: boolean;
}) {
  return createHash("sha256")
    .update(
      [
        input.projectId,
        input.previousVisibility,
        input.nextVisibility,
        input.membersCount,
        input.followersCount,
        input.openRolesCount,
        input.pendingApplicationsCount,
        input.activeTasksCount,
        input.hasManagedProjectImage ? "image:managed" : "image:none-or-legacy",
      ].join(":"),
    )
    .digest("hex");
}


type ProjectAccessImpactResult =
  | {
      success: true;
      data: {
        membersCount: number;
        followersCount: number;
        openRolesCount: number;
        pendingApplicationsCount: number;
        activeTasksCount: number;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectAccessTransitionPreflightResult =
  | {
      success: true;
      data: {
        previousVisibility: ProjectVisibility;
        nextVisibility: ProjectVisibility;
        confirmationToken: string;
        policy: ReturnType<typeof buildProjectAccessTransitionPolicy>;
        counts: {
          membersCount: number;
          followersCount: number;
          openRolesCount: number;
          pendingApplicationsCount: number;
          activeTasksCount: number;
        };
        previews: AccessTransitionPreview;
      };
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


type ProjectPublicTabVisibilityResult =
  | {
      success: true;
      message: string;
      data: ProjectPublicTabVisibility;
    }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };


async function readProjectAccessImpactCounts(projectId: string) {
  const [
    membersRow,
    followersRow,
    openRolesRow,
    pendingAppsRow,
    activeTasksRow,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectFollows)
      .where(eq(projectFollows.projectId, projectId))
      .limit(1),
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
          sql`${tasks.status} <> 'done'`,
        ),
      )
      .limit(1),
  ]);

  return {
    membersCount: Number(membersRow[0]?.count ?? 0),
    followersCount: Number(followersRow[0]?.count ?? 0),
    openRolesCount: Number(openRolesRow[0]?.count ?? 0),
    pendingApplicationsCount: Number(pendingAppsRow[0]?.count ?? 0),
    activeTasksCount: Number(activeTasksRow[0]?.count ?? 0),
  };
}


async function readProjectAccessTransitionPreviews(
  projectId: string,
): Promise<AccessTransitionPreview> {
  const [followers, openRoles, pendingApplications] = await Promise.all([
    db
      .select({
        id: profiles.id,
        username: profiles.username,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(projectFollows)
      .innerJoin(profiles, eq(profiles.id, projectFollows.userId))
      .where(eq(projectFollows.projectId, projectId))
      .orderBy(desc(projectFollows.createdAt))
      .limit(6),
    db
      .select({
        id: projectOpenRoles.id,
        title: projectOpenRoles.title,
        role: projectOpenRoles.role,
      })
      .from(projectOpenRoles)
      .where(eq(projectOpenRoles.projectId, projectId))
      .orderBy(desc(projectOpenRoles.createdAt))
      .limit(6),
    db
      .select({
        id: roleApplications.id,
        applicantId: roleApplications.applicantId,
        applicantName: sql<
          string | null
        >`coalesce(${profiles.fullName}, ${profiles.username})`,
        roleTitle: projectOpenRoles.title,
        roleName: projectOpenRoles.role,
      })
      .from(roleApplications)
      .leftJoin(profiles, eq(profiles.id, roleApplications.applicantId))
      .leftJoin(
        projectOpenRoles,
        eq(projectOpenRoles.id, roleApplications.roleId),
      )
      .where(
        and(
          eq(roleApplications.projectId, projectId),
          eq(roleApplications.status, "pending"),
        ),
      )
      .orderBy(desc(roleApplications.updatedAt))
      .limit(6),
  ]);

  return { followers, openRoles, pendingApplications };
}


function buildAccessPreflightPayload(params: {
  projectId: string;
  previousVisibility: ProjectVisibility;
  nextVisibility: ProjectVisibility;
  hasManagedProjectImage: boolean;
  counts: Awaited<ReturnType<typeof readProjectAccessImpactCounts>>;
  previews: AccessTransitionPreview;
}) {
  const policy = buildProjectAccessTransitionPolicy({
    previousVisibility: params.previousVisibility,
    nextVisibility: params.nextVisibility,
    hasManagedProjectImage: params.hasManagedProjectImage,
    ...params.counts,
  });
  const confirmationToken = buildAccessConfirmationToken({
    projectId: params.projectId,
    previousVisibility: params.previousVisibility,
    nextVisibility: params.nextVisibility,
    hasManagedProjectImage: params.hasManagedProjectImage,
    ...params.counts,
  });

  return {
    previousVisibility: params.previousVisibility,
    nextVisibility: params.nextVisibility,
    confirmationToken,
    policy,
    counts: params.counts,
    previews: params.previews,
  };
}


export async function getProjectAccessTransitionPreflightAction(
  projectId: string,
  nextVisibility: ProjectVisibility,
): Promise<ProjectAccessTransitionPreflightResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }
    if (!isProjectVisibility(nextVisibility)) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Choose Public or Private.",
      };
    }

    const owned = await loadOwnedProjectForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };

    const [counts, previews] = await Promise.all([
      readProjectAccessImpactCounts(projectId),
      readProjectAccessTransitionPreviews(projectId),
    ]);

    return {
      success: true,
      data: buildAccessPreflightPayload({
        projectId,
        previousVisibility: normalizeProjectVisibility(
          owned.project.visibility,
        ),
        nextVisibility,
        hasManagedProjectImage: Boolean(
          owned.project.coverImageBucket && owned.project.coverImageKey,
        ),
        counts,
        previews,
      }),
    };
  } catch (error) {
    logger.error("project.access_preflight_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to prepare access transition.",
    };
  }
}


export async function updateProjectVisibilityAction(
  projectId: string,
  nextVisibility: ProjectVisibility,
  confirmationToken: string,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }
    if (!isProjectVisibility(nextVisibility)) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Choose Public or Private.",
      };
    }

    const owned = await loadOwnedProjectForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };

    const previousVisibility = normalizeProjectVisibility(
      owned.project.visibility,
    );
    if (previousVisibility === nextVisibility) {
      return {
        success: true,
        message: `Project is already ${nextVisibility}.`,
      };
    }

    const [counts, previews] = await Promise.all([
      readProjectAccessImpactCounts(projectId),
      readProjectAccessTransitionPreviews(projectId),
    ]);
    const preflight = buildAccessPreflightPayload({
      projectId,
      previousVisibility,
      nextVisibility,
      hasManagedProjectImage: Boolean(
        owned.project.coverImageBucket && owned.project.coverImageKey,
      ),
      counts,
      previews,
    });

    if (
      !confirmationToken ||
      confirmationToken !== preflight.confirmationToken
    ) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message:
          "Access confirmation expired. Review the impact and try again.",
      };
    }

    const imageMigration =
      nextVisibility === "private"
        ? await migrateLegacyProjectImageToManagedStorage({
            projectId,
            userId: user.id,
            coverImage: owned.project.coverImage,
            coverImageBucket: owned.project.coverImageBucket,
            coverImageKey: owned.project.coverImageKey,
            coverImageAssetId: owned.project.coverImageAssetId,
          })
        : null;

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          visibility: nextVisibility,
          ...(imageMigration
            ? {
                coverImage: imageMigration.url,
                coverImageBucket: imageMigration.bucket,
                coverImageKey: imageMigration.key,
                coverImageAssetId: imageMigration.assetId,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)));
      await markProjectCollaboratorsSummaryStale(projectId, tx);

      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: "project_settings.visibility_changed",
        metadata: {
          previousVisibility,
          nextVisibility,
          source: "project_settings_access",
          confirmationSummary: preflight.policy.confirmationSummary,
          affectedCounts: counts,
          previewIds: {
            followers: previews.followers.map((row) => row.id),
            openRoles: previews.openRoles.map((row) => row.id),
            pendingApplications: previews.pendingApplications.map(
              (row) => row.id,
            ),
          },
          imagePrivacyAction: imageMigration?.migrated
            ? "migrated_to_private_route"
            : imageMigration
              ? "managed_private_route_confirmed"
              : "none",
        },
        createdAt: new Date(),
      });
    });

    if (imageMigration?.migrated && imageMigration.previousAssetId) {
      await scheduleAssetDeletionIfUnreferenced(db, [imageMigration.previousAssetId], { lastErrorCode: "LEGACY_COVER_REPLACED" });
    }

    await revalidateProjectPaths(projectId);
    await invalidateProjectPublicCaches(projectId);

    try {
      await enqueueProjectNotificationEvent({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "access.visibility_changed",
        title: `Project visibility changed to ${nextVisibility}`,
        body: `${owned.project.title ?? owned.project.slug ?? "Project"} is now ${nextVisibility}.`,
        sourceEventId: `${projectId}:visibility:${previousVisibility}:${nextVisibility}`,
        entityRefs: { projectId, projectSlug: owned.project.slug ?? null },
      });
    } catch (notificationError) {
      logger.warn("project.access_visibility_notification_failed", {
        module: "projects",
        projectId,
        previousVisibility,
        nextVisibility,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }

    logger.metric("project.access_visibility.update", {
      projectId,
      userId: user.id,
      previousVisibility,
      nextVisibility,
      result: "success",
    });

    return { success: true, message: `Project is now ${nextVisibility}.` };
  } catch (error) {
    logger.error("project.access_visibility_failed", {
      module: "projects",
      projectId,
      nextVisibility,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update project visibility.",
    };
  }
}


export async function getProjectAccessImpactAction(
  projectId: string,
): Promise<ProjectAccessImpactResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const owned = await loadOwnedProjectForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };

    return {
      success: true,
      data: await readProjectAccessImpactCounts(projectId),
    };
  } catch (error) {
    console.error("Failed to load project access impact:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load access impact.",
    };
  }
}


export async function updateProjectPublicTabVisibilityAction(
  projectId: string,
  nextVisibility: ProjectPublicTabVisibility,
): Promise<ProjectPublicTabVisibilityResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_public_tabs",
    );
    const normalized = normalizeProjectPublicTabVisibility(nextVisibility);
    const [current] = await db
      .select({ publicTabVisibility: projects.publicTabVisibility })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const previous = normalizeProjectPublicTabVisibility(
      current?.publicTabVisibility,
    );

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ publicTabVisibility: normalized, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: "project_settings.public_tabs_changed",
        metadata: {
          previous,
          next: normalized,
          source: "project_settings_access",
          actorRole: capability.role,
        },
        createdAt: new Date(),
      });
    });

    await revalidateProjectPaths(projectId);
    await invalidateProjectPublicCaches(projectId);

    try {
      await enqueueProjectNotificationEvent({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "access.public_tabs_changed",
        title: "Public project surfaces changed",
        body: "The visible public tabs for this project were updated.",
        sourceEventId: `${projectId}:public-tabs:${Date.now()}`,
        entityRefs: { projectId },
      });
    } catch (notificationError) {
      logger.warn("project.public_tabs_notification_failed", {
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
      message: "Public tab visibility updated.",
      data: normalized,
    };
  } catch (error) {
    logger.error("project.public_tabs_update_failed", {
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
        message: "You do not have permission to change public tab visibility.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update public tab visibility.",
    };
  }
}
