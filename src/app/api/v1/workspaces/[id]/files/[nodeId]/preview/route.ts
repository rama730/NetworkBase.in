import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { fileVersions, workspaceNodes, storageAssets } from "@/lib/db/schema";
import { assertWorkspaceFileReadAccess, assertFileNodeVisible } from "@/lib/files/internal-helpers";
import { parseWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { signedDownloadRedirect } from "@/lib/storage/download-link";
import { signedUrlSeconds } from "@/lib/messaging/attachment-ttl";
import { versionedFilename } from "@/lib/files/versioned-filename";
import { recordDownload } from "@/lib/files/download-history";
import { UUID_RE } from "@/app/actions/files/_constants";
import { enforceDownloadLimit, enforceFileReadLimit } from "@/app/api/v1/_shared";
import { publicRequestUrl } from "@/lib/auth/redirects";

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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isDownload = request.nextUrl.searchParams.get("download") === "1";
  const limited = isDownload
    ? await enforceDownloadLimit(request, user?.id)
    : await enforceFileReadLimit(request, "files:preview", 600, 60, user?.id);
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
  const target = revisionNumber == null ? node : (historical ?? (revisionNumber === node.currentVersion ? node : null));
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

  if (isDownload) {
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "Cache-Control": "private, no-store" } });
    const filename = historical && revisionNumber !== node.currentVersion ? versionedFilename(node.name, revisionNumber!) : node.name;
    const saved = await signedDownloadRedirect(await createAdminClient(), { bucket: "project-files", storageKey: target.s3Key, filename });
    if (!saved) return noStore("Couldn’t prepare the download", 502);
    recordDownload({ workspaceId: projectId, nodeId, actorId: user?.id ?? null, fileName: filename, kind: historical && revisionNumber !== node.currentVersion ? "version" : "file" });
    return saved;
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
    const canonicalUrl = publicRequestUrl(request);
    canonicalUrl.searchParams.set("v", revisionIdentity);
    return new Response(null, {
      status: 307,
      headers: { Location: canonicalUrl.toString(), "Cache-Control": "private, no-store" },
    });
  }

  const etag = `"${nodeId}-${revisionIdentity}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Cookie, Authorization" },
    });
  }

  const fileExt = (node.name.split(".").pop() || "").toLowerCase();
  const isPdf = asset.mimeType === "application/pdf" || fileExt === "pdf";
  const isMediaStream = (asset.mimeType?.startsWith("video/") || asset.mimeType?.startsWith("audio/") || MEDIA_EXTS.has(fileExt)) && request.nextUrl.searchParams.get("download") !== "1";

  const admin = await createAdminClient();
  const ttlSeconds = isMediaStream ? signedUrlSeconds("video/mp4") : isPdf ? 1800 : signedUrlSeconds(asset.mimeType);
  const directSignedUrl = await getOrGenerateSignedUrl(admin, "project-files", target.s3Key, ttlSeconds);
  if (!directSignedUrl) {
    return noStore("Couldn’t prepare file preview", 502);
  }

  // ponytail: redirect non-PDF GET previews to short-lived signed storage URLs so presentations, images, and media do not proxy through Railway. ceiling: signed URL stays valid for 5m (30m media) after access is revoked. upgrade: Cloudflare Worker edge proxy if sub-minute revocation is required.
  if (!isPdf && request.method !== "HEAD") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: directSignedUrl,
        "Cache-Control": "private, no-store",
        ETag: etag,
        Vary: "Cookie, Authorization",
      },
    });
  }

  return streamPrivateObject({
    request,
    signedUrl: directSignedUrl,
    totalSize: asset.size,
    mimeType: asset.mimeType,
    filename: node.name,
    disposition: "inline",
    etag,
    cacheControl: "private, no-cache",
  });
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return GET(request, context);
}
