import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { accountDeletions, projects, storageAssets } from "@/lib/db/schema";
import { verifySignedJobRequestToken } from "@/lib/security/job-request";

import { inngest } from "../client";

/**
 * Account cleanup preserves lifecycle evidence before project/profile cascades.
 * Physical object deletion is owned by the fenced asset worker after domain
 * references disappear and backup requirements are satisfied.
 */
export const accountCleanup = inngest.createFunction(
  {
    id: "account-cleanup",
    name: "Schedule account storage cleanup",
    retries: 3,
  },
  { event: "account/cleanup" },
  async ({ event, step }) => {
    const { userId, deletionId, jobSignature } = event.data;
    const verification = verifySignedJobRequestToken(jobSignature, {
      kind: "account/cleanup",
      actorId: userId,
      subjectId: deletionId,
    });
    if (!verification.ok) throw new Error("Invalid account cleanup job request");

    // Claim: pending (or a retried registration blocker) -> storage_running.
    // A cancelled or already-advanced deletion is left alone (COR-053).
    const claimed = await step.run("claim-storage-phase", async () => {
      const rows = await db.update(accountDeletions)
        .set({ cleanupStatus: "storage_running" })
        .where(and(
          eq(accountDeletions.id, deletionId),
          eq(accountDeletions.userId, userId),
          isNull(accountDeletions.cancelledAt),
          inArray(accountDeletions.cleanupStatus, ["pending", "failed", "storage_running"]),
        ))
        .returning({ id: accountDeletions.id });
      return rows.length === 1;
    });
    if (!claimed) return { deletionId, userId, skipped: "not_in_storage_phase" };

    const legacy = await step.run("check-unregistered-references", async () => {
      const result = await db.execute<{ legacy_count: number }>(sql`
        SELECT (
          (SELECT count(*) FROM public.profiles profile
            WHERE profile.id = ${userId}
              AND (((profile.avatar_url LIKE '%/storage/v1/object/%') AND profile.avatar_asset_id IS NULL)
                OR ((profile.banner_url LIKE '%/storage/v1/object/%') AND profile.banner_asset_id IS NULL)))
          + (SELECT count(*) FROM public.projects project
            WHERE project.owner_id = ${userId}
              AND (project.cover_image_key IS NOT NULL OR project.cover_image LIKE '%/storage/v1/object/%')
              AND project.cover_image_asset_id IS NULL)
          + (SELECT count(*) FROM public.project_nodes node
              JOIN public.projects project ON project.id = node.project_id
            WHERE project.owner_id = ${userId}
              AND node.s3_key IS NOT NULL
              AND node.asset_id IS NULL)
          + (SELECT count(*) FROM public.file_versions version
              JOIN public.project_nodes node ON node.id = version.node_id
              JOIN public.projects project ON project.id = node.project_id
            WHERE project.owner_id = ${userId}
              AND version.s3_key <> ''
              AND version.asset_id IS NULL)
          + (SELECT count(*) FROM public.project_updates update_row
              JOIN public.projects project ON project.id = update_row.project_id
            WHERE project.owner_id = ${userId}
              AND jsonb_array_length(update_row.media) > (
                SELECT count(*) FROM public.project_update_media_assets media_ref
                WHERE media_ref.update_id = update_row.id
              ))
          + (SELECT count(*) FROM public.project_update_drafts draft
              JOIN public.projects project ON project.id = draft.project_id
            WHERE project.owner_id = ${userId}
              AND jsonb_array_length(draft.media) > (
                SELECT count(*) FROM public.project_update_draft_media_assets media_ref
                WHERE media_ref.project_id = draft.project_id
                  AND media_ref.user_id = draft.user_id
              ))
          + (SELECT count(*) FROM public.import_jobs import_job
              JOIN public.projects project ON project.id = import_job.project_id
            WHERE project.owner_id = ${userId}
              AND import_job.manifest_s3_key IS NOT NULL
              AND import_job.manifest_asset_id IS NULL)
          + (SELECT count(*) FROM public.github_sync_runs sync_run
              JOIN public.projects project ON project.id = sync_run.project_id
              CROSS JOIN LATERAL jsonb_array_elements(
                COALESCE(sync_run.manifest->'files', '[]'::jsonb)
              ) AS sync_file
            WHERE project.owner_id = ${userId}
              AND sync_file->>'snapshotKey' LIKE (project.id::text || '/sync-snapshots/' || sync_run.id::text || '/%')
              AND NOT EXISTS (
                SELECT 1 FROM public.github_sync_snapshot_assets snapshot_ref
                WHERE snapshot_ref.run_id = sync_run.id
                  AND snapshot_ref.path = sync_file->>'path'
              ))
          -- chat_attachments always reference a storage asset (retired messages tables are gone).
          + (SELECT count(*) FROM public.extension_recovery_drafts draft
            WHERE draft.user_id = ${userId}
              AND draft.asset_id IS NULL)
        )::int AS legacy_count
      `);
      return result[0]?.legacy_count ?? 0;
    });

    if (legacy > 0) {
      await step.run("record-registration-blocker", async () => {
        await db.update(accountDeletions)
          .set({
            cleanupStatus: "failed",
            cleanupDetails: {
              unregisteredStorageReferences: legacy,
              blockedAt: new Date().toISOString(),
              reason: "Storage references must be registered before account deletion",
            },
          })
          .where(and(eq(accountDeletions.id, deletionId), eq(accountDeletions.cleanupStatus, "storage_running")));
      });
      throw new Error(`Account cleanup blocked by ${legacy} unregistered storage references`);
    }

    // Asset scheduling and the phase change commit together, and only while the
    // deletion is still ours and not cancelled.
    const scheduled = await step.run("schedule-registered-assets", async () => {
      return db.transaction(async (tx) => {
        const [locked] = await tx.select({ id: accountDeletions.id })
          .from(accountDeletions)
          .where(and(
            eq(accountDeletions.id, deletionId),
            eq(accountDeletions.cleanupStatus, "storage_running"),
            isNull(accountDeletions.cancelledAt),
          ))
          .for("update");
        if (!locked) return null;
        const ownedProjects = tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.ownerId, userId));
        const rows = await tx.update(storageAssets)
          .set({
            state: "delete_pending",
            deleteAfter: sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
            metadata: sql`${storageAssets.metadata} || jsonb_build_object(
              'accountDeletionId', ${deletionId},
              'accountCleanupScheduledAt', now()
            )`,
            updatedAt: new Date(),
          })
          .where(and(
            or(
              eq(storageAssets.ownerUserId, userId),
              inArray(storageAssets.projectId, ownedProjects),
            ),
            inArray(storageAssets.state, ["pending", "verified"]),
          ))
          .returning({ id: storageAssets.id });
        const ids = rows.map((row) => row.id);
        await tx.update(accountDeletions)
          .set({
            cleanupStatus: "storage_scheduled",
            cleanupDetails: {
              scheduledAssetCount: ids.length,
              sampleAssetIds: ids.slice(0, 100),
              physicalDeletionOwner: "storage-asset-deletion",
              scheduledAt: new Date().toISOString(),
            },
          })
          .where(eq(accountDeletions.id, deletionId));
        return ids;
      });
    });
    if (scheduled === null) return { deletionId, userId, skipped: "cancelled_or_advanced" };

    return {
      deletionId,
      userId,
      scheduledAssets: scheduled.length,
      physicalDeletionDeferred: true,
    };
  },
);
