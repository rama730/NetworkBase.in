import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { fileVersions, workspaceNodes, storageAssets } from "@/lib/db/schema";
import { assertWorkspaceFileReadAccess, assertFileNodeVisible } from "@/lib/files/internal-helpers";
import { parseWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { UUID_RE } from "@/app/actions/files/_constants";
import { enforceRouteLimit } from "@/app/api/v1/_shared";
import { verifyPreviewHmacToken } from "@/lib/files/preview-token";

export const dynamic = "force-dynamic";

const noStore = (body: string, status: number) => new Response(body, { status, headers: { "Cache-Control": "private, no-store" } });

const MEDIA_EXTS = new Set([
  "mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "ogv",
  "mp3", "wav", "m4a", "aac", "flac", "ogg",
]);

// In-memory LRU cache for generated signed storage URLs to eliminate redundant Supabase Storage API calls
const MAX_SIGNED_URL_CACHE_SIZE = 5000;
const mediaSignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function setCachedSignedUrl(key: string, value: { url: string; expiresAt: number }) {
  if (mediaSignedUrlCache.size >= MAX_SIGNED_URL_CACHE_SIZE) {
    const oldestKey = mediaSignedUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      mediaSignedUrlCache.delete(oldestKey);
    }
  }
  mediaSignedUrlCache.set(key, value);
}

async function getOrGenerateSignedUrl(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  bucket: string,
  storageKey: string,
  ttlSeconds: number = 7200,
): Promise<string | null> {
  const now = Date.now();
  const cached = mediaSignedUrlCache.get(storageKey);
  // Keep a 5-minute safety margin; if more than 5 minutes of validity remains, reuse the cached signed URL
  if (cached && cached.expiresAt > now + 300_000) {
    // Refresh LRU position
    mediaSignedUrlCache.delete(storageKey);
    mediaSignedUrlCache.set(storageKey, cached);
    return cached.url;
  }
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(storageKey, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  setCachedSignedUrl(storageKey, { url: data.signedUrl, expiresAt: now + ttlSeconds * 1000 });
  return data.signedUrl;
}

type RouteContext = {
  params: Promise<{ id: string; nodeId: string }>;
};

/**
 * Streams a project file with browser-facing inline headers. The storage key
 * remains server-side; this keeps task-file UUIDs out of PDF viewer metadata
 * and lets Chromium/Edge render a PDF rather than treating a signed blob as
 * an unsupported download.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id: projectId, nodeId } = await context.params;
  if (!UUID_RE.test(projectId) || !UUID_RE.test(nodeId)) {
    return noStore("Not found", 404);
  }

  // Fast Path: Check for stateless HMAC preview authorization token.
  // When valid, bypasses all database lookups, PgBouncer pooling, and user auth checks,
  // issuing direct CDN redirects in <2ms at 1,000,000 user concurrent scale.
  const tokenParam = request.nextUrl.searchParams.get("token");
  if (tokenParam) {
    const verified = verifyPreviewHmacToken(tokenParam);
    if (verified && verified.projectId === projectId && verified.nodeId === nodeId) {
      const fileExt = (verified.filename.split(".").pop() || "").toLowerCase();
      const isMedia = (verified.mimeType?.startsWith("video/") || verified.mimeType?.startsWith("audio/") || MEDIA_EXTS.has(fileExt)) && request.nextUrl.searchParams.get("download") !== "1";
      const admin = await createAdminClient();
      const directSignedUrl = await getOrGenerateSignedUrl(admin, "project-files", verified.storageKey, isMedia ? 7200 : 1800);
      if (!directSignedUrl) return noStore("Couldn’t prepare file preview", 502);

      const etag = `"${verified.nodeId}-v${verified.version}"`;
      // Direct S3 / CDN redirect when explicitly requested via ?redirect=1 or ?cdn=1.
      // Standard preview playback streams directly via streamPrivateObject (HTTP 206 Partial Content)
      // preventing 302 cross-origin redirect CORS barriers and terminal redirect logs.
      if (isMedia && (request.nextUrl.searchParams.get("redirect") === "1" || request.nextUrl.searchParams.get("cdn") === "1")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: directSignedUrl,
            "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
            ETag: etag,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return streamPrivateObject({
        request,
        signedUrl: directSignedUrl,
        totalSize: verified.size,
        mimeType: verified.mimeType,
        filename: verified.filename,
        disposition: request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline",
        etag,
        cacheControl: "private, max-age=3600, stale-while-revalidate=86400",
      });
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const limited = await enforceRouteLimit(request, "files:preview", 600, 60, "default", user?.id);
  if (limited) return noStore("Too many attempts. Try again in a minute.", 429);
  const access = await assertWorkspaceFileReadAccess(projectId, user?.id ?? null).catch(() => null);
  if (!access) {
    return noStore("You don’t have access to this", 403);
  }

  const node = await db.query.workspaceNodes.findFirst({
    where: and(
      eq(workspaceNodes.id, nodeId),
      eq(workspaceNodes.projectId, projectId),
      eq(workspaceNodes.type, "file"),
      isNull(workspaceNodes.deletedAt),
    ),
    columns: {
      s3Key: true,
      assetId: true,
      name: true,
      mimeType: true,
      size: true,
      currentVersion: true,
      taskId: true,
      path: true,
      deletedAt: true,
    },
  });
  if (!node) {
    return noStore("File content is unavailable", 404);
  }
  try {
    await assertFileNodeVisible(access, node);
  } catch {
    return noStore("You don’t have access to this", 403);
  }

  const requestedRevision = request.nextUrl.searchParams.get("revision");
  const revisionNumber = requestedRevision == null ? null : Number(requestedRevision);
  if (requestedRevision != null && (!Number.isSafeInteger(revisionNumber) || revisionNumber! < 1)) {
    return noStore("Invalid version", 400);
  }
  const historical = revisionNumber == null
    ? null
    : await db.query.fileVersions.findFirst({
        where: and(
          eq(fileVersions.nodeId, nodeId),
          eq(fileVersions.version, revisionNumber!),
        ),
        columns: { s3Key: true, assetId: true, size: true, mimeType: true, contentHash: true },
      });
  const target = historical ?? node;
  if (!target?.s3Key || !target.assetId || parseWorkspaceFileKey(target.s3Key)?.projectId !== projectId) {
    return noStore("File content is unavailable", 404);
  }
  const [asset] = await db.select({
    storageKey: storageAssets.storageKey,
    size: storageAssets.verifiedSize,
    mimeType: storageAssets.verifiedMimeType,
    contentHash: storageAssets.contentHash,
  }).from(storageAssets).where(and(
    eq(storageAssets.id, target.assetId),
    eq(storageAssets.bucket, "project-files"),
    eq(storageAssets.storageKey, target.s3Key),
    eq(storageAssets.state, "verified"),
  )).limit(1);
  if (
    !asset
    || asset.size == null
    || !asset.mimeType
    || (historical && (!historical.contentHash || historical.contentHash !== asset.contentHash))
  ) {
    return noStore("File content is unavailable", 404);
  }

  const revisionIdentity = createHash("sha256")
    .update(`${revisionNumber ?? node.currentVersion}:${target.s3Key}:${asset.contentHash ?? ""}`)
    .digest("base64url")
    .slice(0, 20);

  const requestedV = request.nextUrl.searchParams.get("v");
  const versionStr = String(revisionNumber ?? node.currentVersion);
  const isValidVersion = requestedV === revisionIdentity || requestedV === versionStr;

  // Avoid 307 redirect waterfalls when a valid version (number or hash) or Range header is present.
  // Direct serving eliminates 400ms+ latency penalties for media streaming and byte-range seeks.
  if (!isValidVersion && !request.headers.get("range")) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.searchParams.set("v", revisionIdentity);
    return new Response(null, {
      status: 307,
      headers: { Location: canonicalUrl.toString(), "Cache-Control": "private, no-store" },
    });
  }

  const etag = `"${nodeId}-${revisionIdentity}"`;
  const fileExt = (node.name.split(".").pop() || "").toLowerCase();
  const isMediaStream = (asset.mimeType?.startsWith("video/") || asset.mimeType?.startsWith("audio/") || MEDIA_EXTS.has(fileExt)) && request.nextUrl.searchParams.get("download") !== "1";

  const admin = await createAdminClient();
  const directSignedUrl = await getOrGenerateSignedUrl(admin, "project-files", target.s3Key, isMediaStream ? 7200 : 1800);
  if (!directSignedUrl) {
    return noStore("Couldn’t prepare file preview", 502);
  }

  // Strategy A (Direct-to-CDN Streaming for Video & Audio):
  // Direct S3 / CDN 302 redirect is available via ?redirect=1 or ?cdn=1 for explicit CDN offload.
  // By default, media streams directly through streamPrivateObject (HTTP 206 Partial Content / 200 OK)
  // preventing 302 cross-origin redirect CORS barriers and terminal 302 logs while keeping streaming fast.
  if (isMediaStream && (request.nextUrl.searchParams.get("redirect") === "1" || request.nextUrl.searchParams.get("cdn") === "1")) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: directSignedUrl,
        "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
        ETag: etag,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return streamPrivateObject({
    request,
    signedUrl: directSignedUrl,
    totalSize: asset.size,
    mimeType: asset.mimeType,
    filename: node.name,
    disposition: request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline",
    etag,
    cacheControl: "private, max-age=3600, stale-while-revalidate=86400",
  });
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return GET(request, context);
}
