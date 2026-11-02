import "server-only";

import { createHash } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { storageAssets, storageQuotaScopes } from "@/lib/db/schema";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
import { createAdminClient } from "@/lib/supabase/server";

// The largest place a cover is drawn is 96 px, so 256 stays sharp on high-density screens.
const COVER_PIXELS = 256;
const COVER_MAX_BYTES = 300 * 1024;
const COVER_SOURCE_MAX_BYTES = 2 * 1024 * 1024;
const COVER_MIME_TYPE = "image/webp";

export class CoverTooLargeError extends Error {}

/** Every cover ends up the same shape: small square WebP. Animated sources keep every frame. */
export async function renderWorkspaceCover(source: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const rendered = await sharp(source, { animated: true, limitInputPixels: 16_000_000 })
    .resize(COVER_PIXELS, COVER_PIXELS, { fit: "cover" })
    .webp({ quality: 70, effort: 4 })
    .toBuffer();
  if (rendered.length > COVER_MAX_BYTES) {
    throw new CoverTooLargeError("That picture is still too large after shrinking. Try a shorter animation.");
  }
  return rendered;
}

/**
 * Replaces a verified cover's bytes with the small version, in place. The saved size changes, and deleting an asset
 * releases quota by its saved size, so the difference comes off the quota here or it would never be released.
 */
export async function shrinkStoredWorkspaceCover(assetId: string) {
  const [asset] = await db
    .select({ bucket: storageAssets.bucket, storageKey: storageAssets.storageKey })
    .from(storageAssets)
    .where(and(eq(storageAssets.id, assetId), eq(storageAssets.state, "verified")))
    .limit(1);
  if (!asset) throw new Error("Workspace image is no longer publishable");

  const rendered = await renderWorkspaceCover(Buffer.from(await readBoundedStorageBytes({
    bucket: asset.bucket,
    storageKey: asset.storageKey,
    maxBytes: COVER_SOURCE_MAX_BYTES,
  })));
  const admin = await createAdminClient();
  const { error } = await admin.storage.from(asset.bucket).update(asset.storageKey, rendered, {
    contentType: COVER_MIME_TYPE,
    upsert: true,
  });
  if (error) throw error;

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        verifiedSize: storageAssets.verifiedSize,
        quotaTracked: storageAssets.quotaTracked,
        ownerUserId: storageAssets.ownerUserId,
        projectId: storageAssets.projectId,
      })
      .from(storageAssets)
      .where(eq(storageAssets.id, assetId))
      .for("update");
    await tx
      .update(storageAssets)
      .set({
        verifiedSize: rendered.length,
        verifiedMimeType: COVER_MIME_TYPE,
        contentHash: createHash("sha256").update(rendered).digest("hex"),
        updatedAt: new Date(),
      })
      .where(eq(storageAssets.id, assetId));

    const saved = (before?.verifiedSize ?? rendered.length) - rendered.length;
    const scopes = [
      before?.ownerUserId && and(eq(storageQuotaScopes.scopeType, "user"), eq(storageQuotaScopes.scopeId, before.ownerUserId)),
      before?.projectId && and(eq(storageQuotaScopes.scopeType, "project"), eq(storageQuotaScopes.scopeId, before.projectId)),
    ].filter((scope) => !!scope);
    if (before?.quotaTracked && saved !== 0 && scopes.length) {
      await tx
        .update(storageQuotaScopes)
        .set({ retainedBytes: sql`GREATEST(0, ${storageQuotaScopes.retainedBytes} - ${saved})` })
        .where(or(...scopes));
    }
  });
}
