import "server-only";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectNodes, fileVersions, storageAssets } from "@/lib/db/schema";
import {
  assertProjectFileReadAccess,
  assertFileNodeVisible,
} from "@/lib/files/internal-helpers";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
export async function readVersionBytes(input: {
  projectId: string;
  nodeId: string;
  version: number;
  userId: string;
  maxBytes: number;
}) {
  const access = await assertProjectFileReadAccess(
    input.projectId,
    input.userId,
  );
  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.projectId, input.projectId),
      eq(projectNodes.id, input.nodeId),
    ),
  });
  if (!node) throw new Error("File not found");
  await assertFileNodeVisible(access, node);
  const [version] = await db
    .select({
      storageKey: storageAssets.storageKey,
      size: fileVersions.size,
      hash: fileVersions.contentHash,
      mimeType: fileVersions.mimeType,
    })
    .from(fileVersions)
    .innerJoin(
      storageAssets,
      and(
        eq(storageAssets.id, fileVersions.assetId),
        eq(storageAssets.state, "verified"),
        eq(storageAssets.bucket, "project-files"),
        eq(storageAssets.projectId, input.projectId),
        eq(storageAssets.storageKey, fileVersions.s3Key),
      ),
    )
    .where(
      and(
        eq(fileVersions.nodeId, input.nodeId),
        eq(fileVersions.version, input.version),
      ),
    )
    .limit(1);
  if (!version || version.size > input.maxBytes)
    throw new Error(
      "Historical file bytes exceed the native comparison limit or are unavailable",
    );
  const bytes = await readBoundedStorageBytes({
    bucket: "project-files",
    storageKey: version.storageKey,
    maxBytes: input.maxBytes,
  });
  if (
    bytes.byteLength !== version.size ||
    createHash("sha256").update(bytes).digest("hex") !== version.hash
  )
    throw new Error("Historical bytes failed checksum verification");
  return { ...version, bytes };
}
