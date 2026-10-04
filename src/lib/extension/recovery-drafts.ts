import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  extensionRecoveryDrafts,
  extensionRecoverySessions,
  storageAssets,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";

export const EXTENSION_RECOVERY_BUCKET = "extension-recovery-drafts";
export const MAX_RECOVERY_DRAFT_BYTES = 10 * 1024 * 1024;
export const RECOVERY_DRAFT_RETENTION_DAYS = 30;
export const RECOVERY_GENERATIONS_TO_KEEP = 3;

type DraftStorageRow = {
  id: string;
  storageKey: string;
  assetId?: string | null;
};

async function removeStorageObjects(rows: DraftStorageRow[]) {
  if (rows.length === 0) return;
  const admin = await createAdminClient();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const keys = rows.slice(offset, offset + 100).map((row) => row.storageKey);
    const { error } = await admin.storage.from(EXTENSION_RECOVERY_BUCKET).remove(keys);
    if (error) throw new Error(`Recovery draft storage cleanup failed: ${error.message}`);
  }
}

export async function deleteExtensionRecoveryDraftRows(rows: DraftStorageRow[]) {
  if (rows.length === 0) return 0;
  const canonical = rows.filter((row): row is DraftStorageRow & { assetId: string } => Boolean(row.assetId));
  const legacy = rows.filter((row) => !row.assetId);

  let deletedCount = 0;
  if (canonical.length > 0) {
    deletedCount += await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(extensionRecoveryDrafts)
        .where(inArray(extensionRecoveryDrafts.id, canonical.map((row) => row.id)))
        .returning({ assetId: extensionRecoveryDrafts.assetId });
      const assetIds = deleted.flatMap((row) => row.assetId ? [row.assetId] : []);
      if (assetIds.length > 0) {
        await tx.update(storageAssets)
          .set({
            state: "delete_pending",
            deleteAfter: new Date(),
            backupState: "not_required",
            lastErrorCode: "RECOVERY_DRAFT_DETACHED",
            updatedAt: new Date(),
          })
          .where(and(
            inArray(storageAssets.id, assetIds),
            inArray(storageAssets.state, ["pending", "verified"]),
          ));
      }
      return deleted.length;
    });
  }

  if (legacy.length > 0) {
    await removeStorageObjects(legacy);
    const deleted = await db
      .delete(extensionRecoveryDrafts)
      .where(inArray(extensionRecoveryDrafts.id, legacy.map((row) => row.id)))
      .returning({ id: extensionRecoveryDrafts.id });
    deletedCount += deleted.length;
  }
  return deletedCount;
}

export async function deleteExtensionRecoveryDraftsForUser(userId: string) {
  const rows = await db
    .select({
      id: extensionRecoveryDrafts.id,
      storageKey: extensionRecoveryDrafts.storageKey,
      assetId: extensionRecoveryDrafts.assetId,
    })
    .from(extensionRecoveryDrafts)
    .where(eq(extensionRecoveryDrafts.userId, userId));
  return deleteExtensionRecoveryDraftRows(rows);
}

export async function purgeExpiredExtensionRecoveryDrafts(limit = 500) {
  const now = new Date();
  const rows = await db
    .select({
      id: extensionRecoveryDrafts.id,
      storageKey: extensionRecoveryDrafts.storageKey,
      assetId: extensionRecoveryDrafts.assetId,
    })
    .from(extensionRecoveryDrafts)
    .where(lt(extensionRecoveryDrafts.expiresAt, now))
    .orderBy(asc(extensionRecoveryDrafts.expiresAt))
    .limit(Math.max(1, Math.min(2_000, limit)));
  return deleteExtensionRecoveryDraftRows(rows);
}

export async function purgeCleanSessionRecoveryDrafts(limit = 500) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: extensionRecoveryDrafts.id,
      storageKey: extensionRecoveryDrafts.storageKey,
      assetId: extensionRecoveryDrafts.assetId,
    })
    .from(extensionRecoveryDrafts)
    .innerJoin(
      extensionRecoverySessions,
      and(
        eq(extensionRecoverySessions.userId, extensionRecoveryDrafts.userId),
        eq(extensionRecoverySessions.sessionId, extensionRecoveryDrafts.sessionId),
      ),
    )
    .where(and(
      eq(extensionRecoverySessions.status, "clean"),
      lt(extensionRecoverySessions.updatedAt, cutoff),
    ))
    .orderBy(asc(extensionRecoverySessions.updatedAt))
    .limit(Math.max(1, Math.min(2_000, limit)));
  return deleteExtensionRecoveryDraftRows(rows);
}

export async function pruneExtensionRecoveryGenerations(input: {
  userId: string;
  deviceId: string;
  projectId: string;
  filePath: string;
}) {
  const rows = await db.query.extensionRecoveryDrafts.findMany({
    where: and(
      eq(extensionRecoveryDrafts.userId, input.userId),
      eq(extensionRecoveryDrafts.deviceId, input.deviceId),
      eq(extensionRecoveryDrafts.projectId, input.projectId),
      eq(extensionRecoveryDrafts.filePath, input.filePath),
      eq(extensionRecoveryDrafts.status, "finalized"),
    ),
    columns: { id: true, storageKey: true, assetId: true },
    orderBy: (draft, { desc }) => [desc(draft.capturedAt), desc(draft.createdAt)],
  });
  return deleteExtensionRecoveryDraftRows(rows.slice(RECOVERY_GENERATIONS_TO_KEEP));
}
