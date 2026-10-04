import { inngest } from "../client";
import { db } from "@/lib/db";
import { profiles, storageAssets } from "@/lib/db/schema";
import { and, eq, or, sql } from "drizzle-orm";

function urlUsesStorageKey(value: string | null, storageKey: string): boolean {
  if (!value) return false;
  try {
    return decodeURIComponent(new URL(value).pathname).endsWith(`/${storageKey}`);
  } catch {
    return false;
  }
}

export const cleanupSupersededProfileImage = inngest.createFunction(
  { id: "profile-image-cleanup", name: "Delete superseded profile image" },
  { event: "storage/profile-image.cleanup" },
  async ({ event, step }) => step.run("schedule-avatar-deletion", async () => {
    const { userId, storageKey } = event.data;
    if (!storageKey.startsWith(`${userId}/`) || storageKey.includes("..")) {
      throw new Error("Invalid profile image cleanup key");
    }

    return db.transaction(async (tx) => {
      const [profile] = await tx
        .select({
          avatarUrl: profiles.avatarUrl,
          bannerUrl: profiles.bannerUrl,
          avatarAssetId: profiles.avatarAssetId,
          bannerAssetId: profiles.bannerAssetId,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (
        profile &&
        (urlUsesStorageKey(profile.avatarUrl, storageKey) ||
          urlUsesStorageKey(profile.bannerUrl, storageKey))
      ) {
        return { scheduled: false, reason: "still_referenced" };
      }

      const [asset] = await tx
        .select({ id: storageAssets.id })
        .from(storageAssets)
        .where(and(
          eq(storageAssets.ownerUserId, userId),
          eq(storageAssets.bucket, "avatars"),
          eq(storageAssets.storageKey, storageKey),
          eq(storageAssets.state, "verified"),
          profile
            ? and(
                or(
                  sql`${storageAssets.id} <> ${profile.avatarAssetId}`,
                  sql`${profile.avatarAssetId} IS NULL`,
                ),
                or(
                  sql`${storageAssets.id} <> ${profile.bannerAssetId}`,
                  sql`${profile.bannerAssetId} IS NULL`,
                ),
              )
            : sql`true`,
        ))
        .limit(1);
      if (!asset) {
        return { scheduled: false, reason: "legacy_or_missing_asset" };
      }

      await tx.update(storageAssets)
        .set({
          state: "delete_pending",
          deleteAfter: sql`GREATEST(${storageAssets.expiresAt} + interval '5 minutes', now())`,
          updatedAt: new Date(),
        })
        .where(and(eq(storageAssets.id, asset.id), eq(storageAssets.state, "verified")));
      return { scheduled: true, assetId: asset.id };
    });
  }),
);
