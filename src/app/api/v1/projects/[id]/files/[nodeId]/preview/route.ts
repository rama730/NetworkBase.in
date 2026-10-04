import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { fileVersions, projectNodes, storageAssets } from "@/lib/db/schema";
import { assertProjectFileReadAccess, assertTaskFileNodeVisible } from "@/lib/files/internal-helpers";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { streamPrivateObject } from "@/lib/storage/private-object-response";
import { UUID_RE } from "@/app/actions/files/_constants";

export const dynamic = "force-dynamic";

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
    return new Response("Not found", { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = await assertProjectFileReadAccess(projectId, user?.id ?? null).catch(() => null);
  if (!access) {
    return new Response("Forbidden", { status: 403 });
  }

  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.id, nodeId),
      eq(projectNodes.projectId, projectId),
      eq(projectNodes.type, "file"),
      isNull(projectNodes.deletedAt),
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
    return new Response("File content is unavailable", { status: 404 });
  }
  try {
    assertTaskFileNodeVisible(access, node);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const requestedRevision = request.nextUrl.searchParams.get("revision");
  const revisionNumber = requestedRevision == null ? null : Number(requestedRevision);
  if (requestedRevision != null && (!Number.isSafeInteger(revisionNumber) || revisionNumber! < 1)) {
    return new Response("Invalid revision", { status: 400 });
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
  if (!target?.s3Key || !target.assetId || parseProjectFileKey(target.s3Key)?.projectId !== projectId) {
    return new Response("File content is unavailable", { status: 404 });
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
    return new Response("File content is unavailable", { status: 404 });
  }

  const revisionIdentity = createHash("sha256")
    .update(`${revisionNumber ?? node.currentVersion}:${target.s3Key}:${asset.contentHash ?? ""}`)
    .digest("base64url")
    .slice(0, 20);
  if (request.nextUrl.searchParams.get("v") !== revisionIdentity) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.searchParams.set("v", revisionIdentity);
    return new Response(null, {
      status: 307,
      headers: { Location: canonicalUrl.toString(), "Cache-Control": "private, no-store" },
    });
  }

  const etag = `"${nodeId}-${revisionIdentity}"`;
  const admin = await createAdminClient();
  const { data, error } = await admin.storage
    .from("project-files")
    .createSignedUrl(target.s3Key, 60);
  if (error || !data?.signedUrl) {
    return new Response("Failed to prepare file preview", { status: 502 });
  }

  return streamPrivateObject({
    request,
    signedUrl: data.signedUrl,
    totalSize: asset.size,
    mimeType: asset.mimeType,
    filename: node.name,
    disposition: request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline",
    etag,
  });
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return GET(request, context);
}
