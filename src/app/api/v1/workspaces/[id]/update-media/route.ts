import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import { enforceFileReadLimit, jsonError } from "@/app/api/v1/_shared";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { workspaceUpdateMediaAssets, workspaceUpdates, storageAssets } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { isWorkspaceTabVisibleToViewer } from "@/lib/workspaces/settings-policies";
import { WORKSPACE_UPDATE_MEDIA_BUCKET, type WorkspaceUpdateMediaItem } from "@/lib/workspaces/updates";
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
  const limited = await enforceFileReadLimit(request, "files:public-read", 300, 60, user?.id);
  if (limited) return limited;
  const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
  if (!access.project || !access.canRead) return jsonError("Not found", 404, "NOT_FOUND");

  const isOwnerOrMember = access.isOwner || access.isMember;
  if (!isWorkspaceTabVisibleToViewer({
    tabId: "updates",
    isOwnerOrMember,
    canManageSettings: access.isOwner,
    publicTabVisibility: access.project.publicTabVisibility,
  })) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const [normalizedOwner] = await db
    .select({
      id: workspaceUpdates.id,
      visibility: workspaceUpdates.visibility,
      media: workspaceUpdates.media,
      assetId: storageAssets.id,
      size: storageAssets.verifiedSize,
      mimeType: storageAssets.verifiedMimeType,
    })
    .from(workspaceUpdateMediaAssets)
    .innerJoin(workspaceUpdates, eq(workspaceUpdates.id, workspaceUpdateMediaAssets.updateId))
    .innerJoin(storageAssets, eq(storageAssets.id, workspaceUpdateMediaAssets.assetId))
    .where(and(
      eq(workspaceUpdates.projectId, projectId),
      isNull(workspaceUpdates.deletedAt),
      eq(storageAssets.bucket, WORKSPACE_UPDATE_MEDIA_BUCKET),
      eq(storageAssets.storageKey, storageKey),
      eq(storageAssets.state, "verified"),
    ))
    .limit(1);
  const owningUpdate = normalizedOwner;
  if (!owningUpdate || (owningUpdate.visibility === "members" && !isOwnerOrMember)) {
    return jsonError("Not found", 404, "NOT_FOUND");
  }

  const media = (owningUpdate.media as WorkspaceUpdateMediaItem[]).find((item) => (
    item.storageKey === storageKey && item.bucket === WORKSPACE_UPDATE_MEDIA_BUCKET
  ));
  if (!media) return jsonError("Not found", 404, "NOT_FOUND");

  const identity = createHash("sha256")
    .update(`${owningUpdate.id}:${owningUpdate.assetId}`)
    .digest("base64url")
    .slice(0, 20);
  const etag = `"update-media-${identity}"`;
  const isPublic = owningUpdate.visibility === "public" && !isOwnerOrMember;
  const cacheControl = isPublic
    ? "public, max-age=300, s-maxage=300, must-revalidate"
    : "private, max-age=300, must-revalidate";

  // The browser already holds these bytes: skip signing and storage reads on 304 revalidation.
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl, Vary: "Cookie, Authorization" },
    });
  }

  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from(WORKSPACE_UPDATE_MEDIA_BUCKET)
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

  return streamPrivateObject({
    request,
    signedUrl: data.signedUrl,
    totalSize: owningUpdate.size,
    mimeType: owningUpdate.mimeType,
    filename: media.label || storageKey.split("/").pop() || "update-image",
    disposition: "inline",
    etag: `"update-media-${identity}"`,
    cacheControl,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, context);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handle(request, context);
}
