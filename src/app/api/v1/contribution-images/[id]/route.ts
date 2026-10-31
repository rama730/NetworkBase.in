import { enforceFileReadLimit, jsonError } from "@/app/api/v1/_shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { storageAssets } from "@/lib/db/schema";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { contributionReferenceOptions } from "@/lib/profile/contribution-story-server";
import { parseContributionStory } from "@/lib/profile/contribution-story";
import { isUuid } from "@/lib/validations/uuid";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unavailable = () => jsonError("Image unavailable", 404, "NOT_FOUND");
  try {
    const { id } = await params;
    if (!isUuid(id)) return unavailable();
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    const limited = await enforceFileReadLimit(request, "files:public-read", 300, 60, user?.id);
    if (limited) return limited;
    const [asset] = await db
      .select()
      .from(storageAssets)
      .where(
        and(
          eq(storageAssets.id, id),
          eq(storageAssets.bucket, "contribution-images"),
          inArray(storageAssets.state, ["verified", "delete_pending"]),
        ),
      )
      .limit(1);
    if (!asset) return unavailable();
    const rows = await db.execute<{
      profile_id: string;
      project_id: string | null;
      visibility: string;
      project_visibility: string | null;
      project_status: string | null;
      presentation: unknown;
      deleted_at: Date | null;
      project_deleted_at: Date | null;
    }>(sql`
      SELECT c.profile_id,c.workspace_id AS project_id,c.visibility,c.presentation,c.deleted_at,p.visibility AS project_visibility,p.status AS project_status,p.deleted_at AS project_deleted_at
      FROM profile_contribution_media_assets ref JOIN profile_contributions c ON c.id=ref.contribution_id LEFT JOIN workspaces p ON p.id=c.workspace_id WHERE ref.asset_id=${id}::uuid LIMIT 50
    `);
    let allowed = Boolean(user?.id && asset.ownerUserId === user.id);
    for (const row of rows) {
      if (user?.id === row.profile_id && !row.deleted_at) {
        allowed = true;
        break;
      }
      const story = parseContributionStory(row.presentation),
        image = story?.images.find((i) => i.assetId === id);
      if (
        row.deleted_at ||
        row.visibility !== "public" ||
        !story?.visible ||
        !image
      )
        continue;
      if (
        row.project_id &&
        (row.project_deleted_at ||
          !["public", "unlisted"].includes(row.project_visibility ?? "") ||
          row.project_status === "draft" ||
          (row.project_visibility === "unlisted" && !story.allowUnlisted))
      )
        continue;
      const relation = await resolvePrivacyRelationship(
        user?.id ?? null,
        row.profile_id,
      );
      if (!relation?.canViewProfile) continue;
      if (
        image.projectFileId &&
        (!image.permission ||
          !(
            await contributionReferenceOptions(row.project_id, "file", "", [
              image.projectFileId,
            ])
          ).length)
      )
        continue;
      allowed = true;
      break;
    }
    if (!allowed) return unavailable();
    const admin = await createAdminClient();
    const { data, error } = await admin.storage
      .from(asset.bucket)
      .createSignedUrl(asset.storageKey, 60);
    if (error || !data) return unavailable();
    return streamPrivateObject({
      request,
      signedUrl: data.signedUrl,
      totalSize: asset.verifiedSize,
      mimeType: asset.verifiedMimeType,
      filename: "contribution-image",
      disposition: "inline",
      etag: `"${asset.contentHash}"`,
    });
  } catch {
    return unavailable();
  }
}
