import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { storageAssets } from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";

const STAGING_BUCKET = "profile-image-staging";
const PUBLIC_BUCKET = "avatars";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const READ_DEADLINE_MS = 10_000;

type ProfileImageKind = "avatar" | "banner";

async function downloadPrivateSource(storageKey: string): Promise<Buffer> {
  return Buffer.from(await readBoundedStorageBytes({
    bucket: STAGING_BUCKET,
    storageKey,
    maxBytes: MAX_SOURCE_BYTES,
    timeoutMs: READ_DEADLINE_MS,
  }));
}

async function renderPublicImage(source: Buffer, kind: ProfileImageKind): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  // ponytail: disable libvips 50 MB native operation cache and limit worker threads to 1 per container to prevent glibc native arena retention. ceiling: 1 concurrent avatar/banner decode per replica. upgrade: dedicated image worker pool if concurrent profile uploads queue.
  sharp.cache(false);
  sharp.concurrency(1);
  const pipeline = sharp(source, { limitInputPixels: 16_000_000, animated: false }).rotate();
  const rendered = kind === "avatar"
    ? await pipeline.resize(400, 400, { fit: "cover" }).webp({ quality: 82 }).toBuffer()
    : await pipeline.resize(1600, 900, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  if (rendered.length <= 0 || rendered.length > MAX_OUTPUT_BYTES) {
    throw new Error("Sanitized profile image exceeds the public image limit");
  }
  return rendered;
}

async function assertExistingPublicObject(storageKey: string, expectedHash: string) {
  const data = await readBoundedStorageBytes({
    bucket: PUBLIC_BUCKET,
    storageKey,
    maxBytes: MAX_OUTPUT_BYTES,
    timeoutMs: READ_DEADLINE_MS,
  });
  const actualHash = createHash("sha256").update(data).digest("hex");
  if (actualHash !== expectedHash) throw new Error("Public profile image identity conflict");
}

export async function prepareVerifiedPublicProfileImage(input: {
  sourceAssetId: string;
  ownerUserId: string;
  kind: ProfileImageKind;
}) {
  const [source] = await db.select().from(storageAssets).where(and(
    eq(storageAssets.id, input.sourceAssetId),
    eq(storageAssets.ownerUserId, input.ownerUserId),
    eq(storageAssets.bucket, STAGING_BUCKET),
    eq(storageAssets.purpose, `profile_image:${input.kind}`),
  )).limit(1);
  if (!source) throw new Error("Staged profile image is unavailable");

  const storageKey = `${input.ownerUserId}/${source.id}/${input.kind}.webp`;
  const [published] = await db.select().from(storageAssets).where(and(
    eq(storageAssets.bucket, PUBLIC_BUCKET),
    eq(storageAssets.storageKey, storageKey),
  )).limit(1);
  if (published?.state === "verified") {
    if (
      published.sourceAssetId !== source.id
      || published.ownerUserId !== input.ownerUserId
      || published.verifiedSize == null
      || !published.verifiedMimeType
      || !published.contentHash
    ) {
      throw new Error("Public profile image identity conflict");
    }
    const admin = await createAdminClient();
    return {
      assetId: published.id,
      sourceAssetId: source.id,
      storageKey,
      publicUrl: admin.storage.from(PUBLIC_BUCKET).getPublicUrl(storageKey).data.publicUrl,
      contentHash: published.contentHash,
      size: published.verifiedSize,
      mimeType: published.verifiedMimeType,
      sourceSize: source.verifiedSize ?? published.verifiedSize,
    };
  }

  if (
    !["verified", "delete_pending"].includes(source.state)
    || source.verifiedSize == null
    || !source.contentHash
  ) {
    throw new Error("Verified staged profile image is unavailable");
  }

  const rendered = await renderPublicImage(await downloadPrivateSource(source.storageKey), input.kind);
  const contentHash = createHash("sha256").update(rendered).digest("hex");
  const now = new Date();
  const [inserted] = await db.insert(storageAssets).values({
    ownerUserId: input.ownerUserId,
    bucket: PUBLIC_BUCKET,
    storageKey,
    purpose: `profile_image_public:${input.kind}`,
    state: "pending",
    declaredMimeType: "image/webp",
    declaredSize: rendered.length,
    sourceAssetId: source.id,
    idempotencyKey: `public:${source.id}`,
    requestFingerprint: contentHash,
    metadata: { kind: input.kind, derivative: "sanitized_public" },
    quotaTracked: false,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  }).onConflictDoNothing().returning();
  const publicAsset = inserted ?? published ?? (await db.select().from(storageAssets).where(and(
    eq(storageAssets.bucket, PUBLIC_BUCKET),
    eq(storageAssets.storageKey, storageKey),
  )).limit(1))[0];
  if (
    !publicAsset
    || publicAsset.ownerUserId !== input.ownerUserId
    || publicAsset.sourceAssetId !== source.id
    || publicAsset.purpose !== `profile_image_public:${input.kind}`
    || publicAsset.declaredSize !== rendered.length
    || publicAsset.requestFingerprint !== contentHash
    || !["pending", "verified"].includes(publicAsset.state)
  ) {
    throw new Error("Public profile image reservation conflict");
  }

  const admin = await createAdminClient();
  const { error } = await admin.storage.from(PUBLIC_BUCKET).upload(storageKey, rendered, {
    cacheControl: "86400",
    contentType: "image/webp",
    upsert: false,
  });
  if (error) await assertExistingPublicObject(storageKey, contentHash);
  const publicUrl = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(storageKey).data.publicUrl;
  return {
    assetId: publicAsset.id,
    sourceAssetId: source.id,
    storageKey,
    publicUrl,
    contentHash,
    size: rendered.length,
    mimeType: "image/webp",
    sourceSize: source.verifiedSize,
  };
}

export const PROFILE_IMAGE_STAGING_BUCKET = STAGING_BUCKET;
