/**
 * Convert managed legacy public avatars into sanitized immutable public WebP
 * derivatives. Private/profile-scoped banners require a separate visibility-
 * aware migration and are deliberately excluded. Dry-run is the default;
 * pass --apply to upload and attach.
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BUCKET = "avatars";
const MAX_LEGACY_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;

if (!DATABASE_URL || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("DATABASE_URL and Supabase service credentials are required");
}

type Candidate = {
  userId: string;
  kind: "avatar";
  currentUrl: string;
  storageKey: string;
};

function requiresTls(connectionString: string) {
  const hostname = new URL(connectionString).hostname;
  return !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function managedStorageKey(value: string | null, userId: string) {
  if (!value) return null;
  try {
    const pathname = decodeURIComponent(new URL(value).pathname);
    const marker = ["/object/public/avatars/", "/render/image/public/avatars/"]
      .find((candidate) => pathname.includes(candidate));
    if (!marker) return null;
    const key = pathname.slice(pathname.indexOf(marker) + marker.length);
    return key.startsWith(`${userId}/`) && !key.includes("..") ? key : null;
  } catch {
    return null;
  }
}

async function readObject(
  admin: ReturnType<typeof createClient<any>>,
  storageKey: string,
  maxBytes: number,
) {
  const { data, error } = await admin.storage.from(PUBLIC_BUCKET).createSignedUrl(storageKey, 60);
  if (error || !data?.signedUrl) throw new Error(`OBJECT_SIGN_FAILED:${error?.message ?? "missing URL"}`);
  const response = await fetch(data.signedUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) throw new Error(`OBJECT_READ_HTTP_${response.status}`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("legacy profile image exceeds migration limit");
        throw new Error("OBJECT_EXCEEDS_MIGRATION_LIMIT");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (received === 0) throw new Error("EMPTY_OBJECT_NOT_ALLOWED");
  return {
    bytes: Buffer.concat(chunks),
    mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream",
  };
}

async function renderPublicImage(source: Buffer) {
  const { default: sharp } = await import("sharp");
  const pipeline = sharp(source, { limitInputPixels: 16_000_000, animated: false }).rotate();
  const output = await pipeline.resize(400, 400, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  if (output.length <= 0 || output.length > MAX_OUTPUT_BYTES) {
    throw new Error("SANITIZED_IMAGE_EXCEEDS_LIMIT");
  }
  return output;
}

async function main() {
  const sql = postgres(DATABASE_URL!, {
    prepare: false,
    ssl: requiresTls(DATABASE_URL!) ? "require" : false,
    max: 4,
  });
  const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const profiles = await sql<{
      userId: string;
      avatarUrl: string | null;
      avatarPurpose: string | null;
    }[]>`
      SELECT profile.id AS "userId", profile.avatar_url AS "avatarUrl",
        avatar_asset.purpose AS "avatarPurpose"
      FROM public.profiles profile
      LEFT JOIN public.storage_assets avatar_asset ON avatar_asset.id = profile.avatar_asset_id
      WHERE profile.avatar_url IS NOT NULL
    `;
    const candidates: Candidate[] = [];
    for (const profile of profiles) {
      const avatarKey = profile.avatarPurpose === "profile_image_public:avatar"
        ? null
        : managedStorageKey(profile.avatarUrl, profile.userId);
      if (avatarKey && profile.avatarUrl) {
        candidates.push({
          userId: profile.userId,
          kind: "avatar",
          currentUrl: profile.avatarUrl,
          storageKey: avatarKey,
        });
      }
    }
    console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", candidates: candidates.length }));
    if (!APPLY) return;

    let migrated = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const source = await readObject(admin, candidate.storageKey, MAX_LEGACY_SOURCE_BYTES);
        const sourceHash = createHash("sha256").update(source.bytes).digest("hex");
        const sourceRows = await sql<{ id: string; contentHash: string | null; ownerUserId: string | null }[]>`
          INSERT INTO public.storage_assets(
            owner_user_id, bucket, storage_key, purpose, state,
            declared_mime_type, declared_size, verified_mime_type, verified_size,
            content_hash, metadata, quota_tracked, expires_at, verified_at, backup_state
          ) VALUES (
            ${candidate.userId}, ${PUBLIC_BUCKET}, ${candidate.storageKey},
            ${`legacy_profile_image:${candidate.kind}`}, 'verified',
            ${source.mimeType}, ${source.bytes.length}, ${source.mimeType}, ${source.bytes.length},
            ${sourceHash}, ${JSON.stringify({ source: "legacy_profile_image_migration" })}::jsonb,
            false, now(), now(), 'pending'
          )
          ON CONFLICT (bucket, storage_key) DO NOTHING
          RETURNING id, content_hash AS "contentHash", owner_user_id AS "ownerUserId"
        `;
        const [sourceAsset] = sourceRows.length ? sourceRows : await sql<{
          id: string; contentHash: string | null; ownerUserId: string | null;
        }[]>`
          SELECT id, content_hash AS "contentHash", owner_user_id AS "ownerUserId"
          FROM public.storage_assets
          WHERE bucket = ${PUBLIC_BUCKET} AND storage_key = ${candidate.storageKey}
          LIMIT 1
        `;
        if (
          !sourceAsset
          || sourceAsset.ownerUserId !== candidate.userId
          || sourceAsset.contentHash !== sourceHash
        ) {
          throw new Error("SOURCE_ASSET_IDENTITY_CONFLICT");
        }

        const rendered = await renderPublicImage(source.bytes);
        const outputHash = createHash("sha256").update(rendered).digest("hex");
        const outputKey = `${candidate.userId}/${sourceAsset.id}/${candidate.kind}.webp`;
        const derivativeRows = await sql<{ id: string; state: string; contentHash: string | null }[]>`
          INSERT INTO public.storage_assets(
            owner_user_id, bucket, storage_key, purpose, state, source_asset_id,
            declared_mime_type, declared_size, request_fingerprint, metadata,
            quota_tracked, expires_at, backup_state
          ) VALUES (
            ${candidate.userId}, ${PUBLIC_BUCKET}, ${outputKey},
            ${`profile_image_public:${candidate.kind}`}, 'pending', ${sourceAsset.id},
            'image/webp', ${rendered.length}, ${outputHash},
            ${JSON.stringify({ source: "legacy_profile_image_migration", derivative: "sanitized_public" })}::jsonb,
            false, now() + interval '1 hour', 'pending'
          )
          ON CONFLICT (bucket, storage_key) DO NOTHING
          RETURNING id, state, content_hash AS "contentHash"
        `;
        const [derivative] = derivativeRows.length ? derivativeRows : await sql<{
          id: string; state: string; contentHash: string | null;
        }[]>`
          SELECT id, state, content_hash AS "contentHash"
          FROM public.storage_assets
          WHERE bucket = ${PUBLIC_BUCKET} AND storage_key = ${outputKey}
          LIMIT 1
        `;
        if (!derivative || !["pending", "verified"].includes(derivative.state)) {
          throw new Error("DERIVATIVE_ASSET_IDENTITY_CONFLICT");
        }
        if (derivative.state === "verified" && derivative.contentHash !== outputHash) {
          throw new Error("DERIVATIVE_ASSET_IDENTITY_CONFLICT");
        }

        if (derivative.state !== "verified") {
          const { error } = await admin.storage.from(PUBLIC_BUCKET).upload(outputKey, rendered, {
            cacheControl: "86400",
            contentType: "image/webp",
            upsert: false,
          });
          if (error) {
            const existing = await readObject(admin, outputKey, MAX_OUTPUT_BYTES);
            const existingHash = createHash("sha256").update(existing.bytes).digest("hex");
            if (existingHash !== outputHash) throw new Error("DERIVATIVE_OBJECT_IDENTITY_CONFLICT");
          }
        }
        const publicUrl = admin.storage.from(PUBLIC_BUCKET).getPublicUrl(outputKey).data.publicUrl;
        await sql.begin(async (transaction) => {
          const tx = transaction as unknown as postgres.Sql;
          const updatedAssets = await tx<{ id: string }[]>`
            UPDATE public.storage_assets
            SET state = 'verified', verified_mime_type = 'image/webp',
              verified_size = ${rendered.length}, content_hash = ${outputHash},
              verified_at = now(), last_error_code = NULL, updated_at = now()
            WHERE id = ${derivative.id}
              AND state IN ('pending', 'verified')
              AND request_fingerprint = ${outputHash}
            RETURNING id
          `;
          if (updatedAssets.length !== 1) throw new Error("DERIVATIVE_ASSET_CHANGED");
          const updatedProfiles = await tx<{ id: string }[]>`
            UPDATE public.profiles
            SET avatar_asset_id = ${derivative.id}, avatar_url = ${publicUrl}, updated_at = now()
            WHERE id = ${candidate.userId} AND avatar_url = ${candidate.currentUrl}
            RETURNING id
          `;
          if (updatedProfiles.length !== 1) throw new Error("PROFILE_IMAGE_CHANGED_DURING_MIGRATION");
          await tx`
            UPDATE public.storage_repair_failures
            SET resolved_at = now(), updated_at = now()
            WHERE repair_kind = 'legacy_asset_registration'
              AND subject_id = ${`profile_avatar:${candidate.userId}:0`}
          `;
        });
        migrated += 1;
      } catch (error) {
        failed += 1;
        console.warn("[legacy-profile-image-migration] failed", {
          userId: candidate.userId,
          kind: candidate.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log(JSON.stringify({ mode: "apply", candidates: candidates.length, migrated, failed }));
    if (failed > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[legacy-profile-image-migration] fatal", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
