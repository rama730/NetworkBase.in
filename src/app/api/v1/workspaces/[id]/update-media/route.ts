import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import { jsonError } from "@/app/api/v1/_shared";
import { getProjectAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { projectUpdateMediaAssets, projectUpdates, storageAssets } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { isProjectTabVisibleToViewer } from "@/lib/workspaces/settings-policies";
import { PROJECT_UPDATE_MEDIA_BUCKET, type ProjectUpdateMediaItem } from "@/lib/workspaces/updates";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validations/uuid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  if (!isUuid(projectId)) return jsonError("Not found", 404, "NOT_FOUND");

  const storageKey = request.nextUrl.searchParams.get("key")?.trim() ?? "";
  const expectedPrefix = `projects/${projectId}/update-media/`;
  if (!storageKey.startsWith(expectedPrefix) || storageKey.includes("..")) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = await getProjectAccessById(projectId, user?.id ?? null);
  if (!access.project || !access.canRead) return jsonError("Not found", 404, "NOT_FOUND");

  const isOwnerOrMember = access.isOwner || access.isMember;
  if (!isProjectTabVisibleToViewer({
    tabId: "updates",
    isOwnerOrMember,
    canManageSettings: access.isOwner,
    publicTabVisibility: access.project.publicTabVisibility,
  })) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const [normalizedOwner] = await db
    .select({
      id: projectUpdates.id,
      visibility: projectUpdates.visibility,
      media: projectUpdates.media,
      assetId: storageAssets.id,
      size: storageAssets.verifiedSize,
      mimeType: storageAssets.verifiedMimeType,
    })
    .from(projectUpdateMediaAssets)
    .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateMediaAssets.updateId))
    .innerJoin(storageAssets, eq(storageAssets.id, projectUpdateMediaAssets.assetId))
    .where(and(
      eq(projectUpdates.projectId, projectId),
      isNull(projectUpdates.deletedAt),
      eq(storageAssets.bucket, PROJECT_UPDATE_MEDIA_BUCKET),
      eq(storageAssets.storageKey, storageKey),
      eq(storageAssets.state, "verified"),
    ))
    .limit(1);
  const [legacyOwner] = normalizedOwner ? [] : await db
    .select({
      id: projectUpdates.id,
      visibility: projectUpdates.visibility,
      media: projectUpdates.media,
    })
    .from(projectUpdates)
    .where(and(
      eq(projectUpdates.projectId, projectId),
      isNull(projectUpdates.deletedAt),
      sql`EXISTS (
        SELECT 1
        FROM jsonb_array_elements(${projectUpdates.media}) AS media_item
        WHERE media_item->>'storageKey' = ${storageKey}
          AND media_item->>'bucket' = ${PROJECT_UPDATE_MEDIA_BUCKET}
      )`,
    ))
    .limit(1);
  const owningUpdate = normalizedOwner ?? (legacyOwner
    ? { ...legacyOwner, assetId: null, size: null, mimeType: null }
    : null);
  if (!owningUpdate || (owningUpdate.visibility === "members" && !isOwnerOrMember)) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const media = (owningUpdate.media as ProjectUpdateMediaItem[]).find((item) => (
    item.storageKey === storageKey && item.bucket === PROJECT_UPDATE_MEDIA_BUCKET
  ));
  if (!media) return jsonError("Not found", 404, "NOT_FOUND");

  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from(PROJECT_UPDATE_MEDIA_BUCKET)
    .createSignedUrl(storageKey, 60);
  if (error || !data?.signedUrl) {
    logger.warn("project_updates.media_route_presign_failed", {
      module: "projects",
      projectId,
      updateId: owningUpdate.id,
      error: error?.message || "Missing signed URL",
    });
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const identity = createHash("sha256")
    .update(`${owningUpdate.id}:${owningUpdate.assetId ?? storageKey}`)
    .digest("base64url")
    .slice(0, 20);
  const isPublic = owningUpdate.visibility === "public" && !isOwnerOrMember;
  return streamPrivateObject({
    request,
    signedUrl: data.signedUrl,
    totalSize: owningUpdate.size ?? (typeof media.size === "number" ? media.size : null),
    mimeType: owningUpdate.mimeType ?? media.mimeType,
    filename: media.label || storageKey.split("/").pop() || "update-image",
    disposition: "inline",
    etag: `"update-media-${identity}"`,
    cacheControl: isPublic
      ? "public, max-age=300, s-maxage=300, must-revalidate"
      : "private, no-store",
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, context);
}
