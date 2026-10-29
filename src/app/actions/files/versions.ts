"use server";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";

import { getFileAttributionByNodeId } from "@/lib/files/file-attribution";
import { db } from "@/lib/db";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import {
  fileVersions,
  profiles,
  projectNodes,
  storageAssets,
  type FileVersion,
} from "@/lib/db/schema";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { readBoundedStorageText } from "@/lib/storage/bounded-object-read";
import { after } from "next/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import {
  buildWorkspaceFileKey,
  isCanonicalWorkspaceFileKey,
  parseWorkspaceFileKey,
} from "@/lib/storage/workspace-file-key";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
  normalizeAndValidateUploadRelativePath,
  WORKSPACE_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/upload/security";
import { finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { notifyForFileVersionCreated } from "@/lib/notifications/task-file";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import {
  assertWorkspaceFileReadAccess,
  assertFileNodeVisible,
  assertWorkspaceManageFilesAccess,
  assertWorkspaceManageFilesAccessTx,
  assertWorkspaceUploadAccess,
  assertWorkspaceWriteAccess,
  assertWorkspaceWriteAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import type { FileRevisionMode } from "@/lib/files/revision-policy";
import {
  assertOwnedFileLease,
  type FileLeaseCredentials,
  withTransientFileLease,
} from "@/lib/files/file-lock-service";

/**
 * Server actions for the task-file version history.
 *
 * The lifecycle mirrors `createFileNode` in `mutations.ts` but appends to the
 * existing node instead of creating a sibling. New revisions bump
 * `project_nodes.current_version`; active-revision saves preserve the version
 * number. Both paths update the node and sidecar row in one transaction.
 *
 * Upload-like actions re-verify upload access inside the transaction
 * (`assertWorkspaceUploadAccessTx`) so per-member file-intake toggles cannot be
 * bypassed between signed upload creation and version replacement.
 */

const LIST_VERSIONS_MAX = 200;

async function assertVersionNodeReadable(projectId: string, nodeId: string, actorId: string | null) {
  const access = await assertWorkspaceFileReadAccess(projectId, actorId);
  const node = await db.query.projectNodes.findFirst({
    where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
    columns: { id: true, path: true, taskId: true, deletedAt: true },
  });
  if (!node) throw new Error("File not found");
  await assertFileNodeVisible(access, node);
}

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
  return {
    actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
    actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
}

async function enqueueProjectFileVersionNotification(input: Parameters<typeof enqueueWorkspaceNotificationEvent>[0]) {
  try {
    await enqueueWorkspaceNotificationEvent(input);
  } catch (error) {
    logger.warn("files.project_policy_notification_failed", {
      module: "files",
      projectId: input.projectId,
      eventKey: input.eventKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listFileVersionsPage(
  projectId: string,
  nodeId: string,
  options?: { limit?: number; beforeVersion?: number | null },
): Promise<{
  versions: (FileVersion & { uploadedByName?: string | null; uploadedByUsername?: string | null })[];
  nextCursor: number | null;
}> {
  const requestedLimit = Math.max(1, Math.min(Math.trunc(options?.limit ?? 50), LIST_VERSIONS_MAX));
  const beforeVersion = options?.beforeVersion == null
    ? null
    : Math.max(1, Math.trunc(options.beforeVersion));
  const { user } = await requireAuthenticatedUser();
  const actorId = user?.id ?? null;
  const access = await assertWorkspaceFileReadAccess(projectId, actorId);

  // Confirm the node belongs to the project (defense-in-depth on top of RLS).
  const node = await db.query.projectNodes.findFirst({
    where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
    columns: { id: true, type: true, path: true, taskId: true, deletedAt: true },
  });
  if (!node) throw new Error("File not found");
  await assertFileNodeVisible(access, node);
  if (node.type !== "file") throw new Error("Versions are tracked only on files");

  const rows = await db
      .select({
        id: fileVersions.id,
        nodeId: fileVersions.nodeId,
        version: fileVersions.version,
        s3Key: fileVersions.s3Key,
        assetId: fileVersions.assetId,
        size: fileVersions.size,
        mimeType: fileVersions.mimeType,
        contentHash: fileVersions.contentHash,
        uploadedBy: fileVersions.uploadedBy,
        uploadedAt: fileVersions.uploadedAt,
        comment: fileVersions.comment,
        attribution: fileVersions.attribution,
        uploadedByName: profiles.fullName,
        uploadedByUsername: profiles.username,
      })
      .from(fileVersions)
      .leftJoin(profiles, eq(fileVersions.uploadedBy, profiles.id))
      .where(and(
        eq(fileVersions.nodeId, nodeId),
        beforeVersion == null ? undefined : lt(fileVersions.version, beforeVersion),
      ))
      .orderBy(desc(fileVersions.version))
      .limit(requestedLimit + 1);
  const versions = rows.slice(0, requestedLimit);
  return {
    versions,
    nextCursor: rows.length > requestedLimit ? versions.at(-1)?.version ?? null : null,
  };
}

export async function listFileVersions(
  projectId: string,
  nodeId: string,
  limit: number = LIST_VERSIONS_MAX,
) {
  const page = await listFileVersionsPage(projectId, nodeId, { limit });
  return page.versions;
}

/**
 * The preview route URL for one historical version of a file. It is an ordinary authorized endpoint
 * (access is checked when it is requested, not when this URL is built), so it carries no expiry.
 * Used by the version-history drawer's "Download" button.
 */
export async function getVersionPreviewUrl(
  projectId: string,
  nodeId: string,
  version: number,
  download: boolean = false,
): Promise<{ url: string }> {
  const { user } = await requireAuthenticatedUser();
  const actorId = user?.id ?? null;
  await assertVersionNodeReadable(projectId, nodeId, actorId);

  const version_row = await db.query.fileVersions.findFirst({
    where: and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, version)),
    columns: { s3Key: true },
  });
  if (!version_row?.s3Key) throw new Error("Version not found");

  // Sanity: the key must belong to this project.
  const parsed = parseWorkspaceFileKey(version_row.s3Key);
  if (!parsed || parsed.projectId !== projectId) {
    throw new Error("Version key does not belong to this workspace");
  }

  const params = new URLSearchParams({ revision: String(version) });
  if (download) params.set("download", "1");
  return { url: `/api/v1/workspaces/${projectId}/files/${nodeId}/preview?${params.toString()}` };
}

/**
 * Structured error returned when a lock conflict prevents a version write.
 */
export interface LockConflictError {
  error: "lock_conflict";
  lockedBy: { userId: string; displayName: string; lockedAt: string };
}

export type ReplaceNodeResult =
  | { node: typeof projectNodes.$inferSelect; version: FileVersion }
  | LockConflictError;

/**
 * Append a new version to an existing file node.
 *
 * Flow
 *   1. Finalize the upload intent (same guard as createFileNode).
 *   2. Inside a tx, lock the project row, assert write access, verify no one
 *      else holds a collaborator lock on the node, read the current
 *      projectNodes row, compute the next version number.
 *   3. Insert `file_versions` row with (version, s3_key, size, mime, hash).
 *   4. Update `project_nodes.{s3Key,size,mimeType,current_version,updatedAt}`
 *      so readers that don't know about `file_versions` still see the latest
 *      blob.
 *
 * Note on content_hash: the client sends it (computed via
 * `@/lib/files/content-hash`). We accept it as-is; hash correctness isn't
 * security-sensitive (it's only used for dedup), and the server recomputes
 * if/when this file is picked up by the lazy backfill job.
 */
export async function applyUploadedFileRevision(input: {
  projectId: string;
  nodeId: string;
  s3Key: string;
  size: number;
  mimeType: string;
  contentHash: string | null;
  uploadIntentId?: string;
  comment?: string | null;
  mode: FileRevisionMode;
  baseVersion?: number | null;
  baseHash?: string | null;
  lease: FileLeaseCredentials;
}): Promise<ReplaceNodeResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  const { allowed } = await consumeRateLimit(`files-versions:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
  await assertWorkspaceUploadAccess(input.projectId, user.id);

  const finalizedIntent = await finalizeUploadIntent({
    intentId: input.uploadIntentId,
    storageKey: input.s3Key,
    bucket: "project-files",
    userId: user.id,
    projectId: input.projectId,
    expectedScope: "project_file",
    expectedKind: "file",
  });

  const parsedKey = parseWorkspaceFileKey(finalizedIntent.storageKey);
  if (
    !parsedKey ||
    !isCanonicalWorkspaceFileKey(finalizedIntent.storageKey) ||
    parsedKey.projectId !== input.projectId
  ) {
    throw new Error("Invalid file storage key");
  }
  const normalizedRelativePath = normalizeAndValidateUploadRelativePath(parsedKey.relativePath);
  const canonicalS3Key = buildWorkspaceFileKey(input.projectId, normalizedRelativePath);
  // The node must point at the object that was actually uploaded and verified.
  if (canonicalS3Key !== finalizedIntent.storageKey) throw new Error("Invalid file storage key");
  const normalizedSize = normalizeAndValidateFileSize(
    finalizedIntent.finalizedSize ?? input.size,
    WORKSPACE_UPLOAD_MAX_FILE_BYTES,
  );
  const normalizedMimeType = normalizeAndValidateMimeType(
    finalizedIntent.finalizedMimeType ?? input.mimeType,
  );

  const normalizedHash = sanitizeHash(input.contentHash);
  if (!finalizedIntent.assetId) throw new Error("Verified file asset is unavailable");
  const result = await applyFileRevision({
    projectId: input.projectId,
    nodeId: input.nodeId,
    actorUserId: user.id,
    storageKey: canonicalS3Key,
    assetId: finalizedIntent.assetId,
    size: normalizedSize,
    mimeType: normalizedMimeType,
    contentHash: normalizedHash,
    mode: input.mode,
    comment: input.comment,
    baseVersion: input.baseVersion,
    baseHash: input.baseHash,
    lease: input.lease,
    eventType:
      input.mode === "new_revision"
        ? "replace_file_version"
        : "update_active_file_revision",
    eventMetadata: { source: "files_tab" },
  });

  if (input.mode === "new_revision") {
    // ponytail: decouple version notifications via after() to keep upload response under 50ms. ceiling: background task execution. upgrade: Inngest queue if notification delivery volume spikes.
    const actorSnapshot = actorNotificationSnapshot(user);
    after(async () => {
      try {
        await notifyForFileVersionCreated({
          actorUserId: user.id,
          projectId: input.projectId,
          nodeId: input.nodeId,
          version: result.version.version,
        });
      } catch (error) {
        logger.warn("files.version.notification_failed", {
          module: "files",
          projectId: input.projectId,
          nodeId: input.nodeId,
          version: result.version.version,
          actorUserId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        await enqueueProjectFileVersionNotification({
          projectId: input.projectId,
          actorUserId: user.id,
          ...actorSnapshot,
          eventKey: "files.version_added",
          title: `New file version added`,
          body: `Version ${result.version.version} was added to a workspace file.`,
          sourceEventId: `${input.nodeId}:version:${result.version.version}`,
          entityRefs: {
            projectId: input.projectId,
            fileId: input.nodeId,
          },
        });
      } catch (error) {
        logger.warn("files.version.notification_enqueue_failed", {
          module: "files",
          projectId: input.projectId,
          nodeId: input.nodeId,
          version: result.version.version,
          actorUserId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  if (result.node) {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { fullName: true, username: true, avatarUrl: true },
    });
    Object.assign(result.node, {
      updatedById: user.id,
      updatedByName: profile?.fullName ?? null,
      updatedByUsername: profile?.username ?? null,
      updatedByAvatarUrl: profile?.avatarUrl ?? null,
      versionUpdatedAt: result.node.updatedAt,
    });
  }

  // ponytail: client handles revision updates via Zustand upsertNodes; skip route revalidation. ceiling: single-tab explorer view. upgrade: Realtime broadcast if multi-tab explorer sync is required.
  return { node: result.node, version: result.version };
}


/**
 * Restore an earlier version by copying its metadata forward as a new
 * current version (never rewrites history). We intentionally re-use the
 * old `s3Key` — blobs are write-once, so pointing the latest row back at
 * the old key is safe and cheap.
 */
export async function restoreFileVersion(
  projectId: string,
  nodeId: string,
  targetVersion: number,
): Promise<{ node: typeof projectNodes.$inferSelect; version: FileVersion }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  const { allowed } = await consumeRateLimit(`files-versions:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
  await assertWorkspaceWriteAccess(projectId, user.id);

  const result = await withTransientFileLease(
    { projectId, nodeId, userId: user.id },
    async (lease) => {
      const source = await db.query.fileVersions.findFirst({
        where: and(
          eq(fileVersions.nodeId, nodeId),
          eq(fileVersions.version, targetVersion),
        ),
      });
      if (!source) throw new Error("Version not found");

      return applyFileRevision({
        projectId,
        nodeId,
        actorUserId: user.id,
        storageKey: source.s3Key,
        assetId: source.assetId ?? null,
        size: source.size,
        mimeType: source.mimeType,
        contentHash: source.contentHash,
        mode: "new_revision",
        comment: `Restored from version ${targetVersion}`,
        lease,
        accessRequirement: "write",
        eventType: "restore_file_version",
        eventMetadata: { restoredFrom: targetVersion },
      });
    },
  );

  if (result.node) {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { fullName: true, username: true, avatarUrl: true },
    });
    Object.assign(result.node, {
      updatedById: user.id,
      updatedByName: profile?.fullName ?? null,
      updatedByUsername: profile?.username ?? null,
      updatedByAvatarUrl: profile?.avatarUrl ?? null,
      versionUpdatedAt: result.node.updatedAt,
    });
  }

  // ponytail: client handles version restore via query invalidation; skip route revalidation. ceiling: client query invalidation. upgrade: global cache invalidation bus if cross-device state sync required.
  return result;
}

function sanitizeHash(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  // SHA-256 is 64 lowercase hex chars.
  if (!/^[0-9a-f]{64}$/.test(trimmed)) return null;
  return trimmed;
}

export async function getFileVersionContentAction(
  projectId: string,
  nodeId: string,
  versionNumber: number,
): Promise<{ success: true; content: string }> {
  const { user } = await requireAuthenticatedUser();
  const actorId = user?.id ?? null;
  await assertVersionNodeReadable(projectId, nodeId, actorId);

  const versionRow = await db.query.fileVersions.findFirst({
    where: and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, versionNumber)),
    columns: { s3Key: true, size: true }
  });

  if (!versionRow) {
    throw new Error("Version not found");
  }

  const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2MB cap
  if (versionRow.size > MAX_INLINE_BYTES) {
    throw new Error("File version too large for line diff comparison.");
  }

  const text = await readBoundedStorageText({
    bucket: "project-files",
    storageKey: versionRow.s3Key,
    maxBytes: MAX_INLINE_BYTES,
  });
  return { success: true, content: text };
}

export async function deleteFileVersionAction(
  projectId: string,
  nodeId: string,
  versionNumber: number,
): Promise<{ success: boolean; nextActiveVersion?: number | null; node?: typeof projectNodes.$inferSelect }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  
  const { allowed } = await consumeRateLimit(`delete-version:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Too many attempts. Try again in a minute.");

  // Deleting a version destroys history: the same capability as permanent delete.
  await assertWorkspaceManageFilesAccess(projectId, user.id);

  const mutation = await withTransientFileLease(
    { projectId, nodeId, userId: user.id },
    (lease) => db.transaction(async (tx) => {
      await assertWorkspaceManageFilesAccessTx(tx, projectId, user.id);
      await tx.execute(sql`SELECT id FROM project_nodes WHERE id = ${nodeId} FOR UPDATE`);
      await assertOwnedFileLease(tx, { projectId, nodeId, userId: user.id, credentials: lease });
      const node = await tx.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
      });
      if (!node || node.deletedAt) throw new Error("File not found");
      // COR-013: the target is read directly (any age), and the last-version rule is a count.
      const [target] = await tx.select({ id: fileVersions.id, assetId: fileVersions.assetId })
        .from(fileVersions)
        .where(and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, versionNumber)))
        .limit(1);
      if (!target) throw new Error("Version not found");
      const [versionCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(fileVersions).where(eq(fileVersions.nodeId, nodeId));
      if ((versionCount?.count ?? 0) <= 1) throw new Error("Cannot delete the only remaining version of this file.");
      if (!target.assetId) {
        throw new Error("Storage registration is pending for this file version");
      }
      await tx.delete(fileVersions).where(eq(fileVersions.id, target.id));

      let nextActiveVersion: number | null = null;
      let updatedNode: typeof projectNodes.$inferSelect | undefined;
      if (node.currentVersion === versionNumber) {
        const [remaining] = await tx.select({
          version: fileVersions.version,
          s3Key: fileVersions.s3Key,
          size: fileVersions.size,
          mimeType: fileVersions.mimeType,
          assetId: fileVersions.assetId,
        }).from(fileVersions).where(eq(fileVersions.nodeId, nodeId)).orderBy(desc(fileVersions.version)).limit(1);
        if (!remaining) throw new Error("No replacement version is available");
        nextActiveVersion = remaining.version;
        [updatedNode] = await tx
          .update(projectNodes)
          .set({
            s3Key: remaining.s3Key,
            size: remaining.size,
            mimeType: remaining.mimeType,
            assetId: remaining.assetId,
            currentVersion: remaining.version,
            updatedAt: new Date(),
          })
          .where(eq(projectNodes.id, nodeId))
          .returning();
      }
      await scheduleAssetDeletionIfUnreferenced(tx, [target.assetId], { lastErrorCode: "FILE_VERSION_DETACHED" });
      return { target, nextActiveVersion, updatedNode };
    }),
  );

  await recordNodeEvent(projectId, user.id, nodeId, "delete_file_version", {
    deletedVersion: versionNumber,
    newActiveVersion: mutation.nextActiveVersion,
  });

  // The node keeps "Updated by" for its (possibly new) current version, as every other read does.
  if (mutation.updatedNode) {
    const attribution = await getFileAttributionByNodeId([mutation.updatedNode]);
    Object.assign(mutation.updatedNode, attribution.get(mutation.updatedNode.id) ?? {});
  }

  // ponytail: client handles version deletion via query invalidation; skip route revalidation. ceiling: client query invalidation. upgrade: global cache invalidation bus if cross-device state sync required.
  return { success: true, nextActiveVersion: mutation.nextActiveVersion, node: mutation.updatedNode };
}
