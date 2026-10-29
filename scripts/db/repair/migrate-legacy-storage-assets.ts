/**
 * Register every retained legacy object in the canonical storage lifecycle and
 * attach its domain reference. Dry-run is the default; pass --apply to mutate.
 * File nodes and file_versions are handled by the dedicated version/hash
 * repair scripts because they require revision compare-and-swap semantics.
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

import { databaseSsl } from "../../lib/disposable-db";

import { createAdminClient } from "../../../src/lib/supabase/server";

config({ path: ".env.local" });
config();

const APPLY = process.argv.includes("--apply");
const kindArgument = process.argv.find((argument) => argument.startsWith("--kind="));
const requestedKinds = kindArgument
  ? new Set(kindArgument.slice("--kind=".length).split(",").filter(Boolean) as ReferenceKind[])
  : null;
const requestedConcurrency = Number(process.env.STORAGE_REPAIR_CONCURRENCY ?? 8);
const VERIFY_CONCURRENCY = Number.isFinite(requestedConcurrency)
  ? Math.max(1, Math.min(16, Math.floor(requestedConcurrency)))
  : 8;
const IDLE_TIMEOUT_MS = 30_000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const resolvedDatabaseUrl = DATABASE_URL;

type ReferenceKind =
  | "project_cover"
  | "update_media"
  | "update_draft_media"
  | "chat_upload"
  | "message_attachment"
  | "profile_avatar"
  | "profile_banner"
  | "sync_snapshot"
  | "recovery_draft"
  | "import_manifest";

type LegacyReference = {
  kind: ReferenceKind;
  subjectId: string;
  ordinal?: number;
  ownerUserId: string | null;
  projectId: string | null;
  bucket: string;
  storageKey: string;
  purpose: string;
  expectedSize: number | null;
  expectedMimeType: string | null;
  expectedHash: string | null;
  maxBytes: number;
  allowEmpty: boolean;
};

type VerifiedObject = {
  size: number;
  mimeType: string;
  contentHash: string;
};


function profileStorageKey(value: string | null, userId: string) {
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

async function verifyObject(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  reference: LegacyReference,
): Promise<VerifiedObject> {
  const { data, error } = await admin.storage.from(reference.bucket).createSignedUrl(reference.storageKey, 60);
  if (error || !data?.signedUrl) throw new Error(`OBJECT_SIGN_FAILED:${error?.message ?? "missing URL"}`);

  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  try {
    const response = await fetch(data.signedUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`OBJECT_READ_HTTP_${response.status}`);
    const reportedLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(reportedLength) && reportedLength > reference.maxBytes) {
      throw new Error("OBJECT_EXCEEDS_PURPOSE_LIMIT");
    }
    const digest = createHash("sha256");
    const reader = response.body.getReader();
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
        received += value.byteLength;
        if (received > reference.maxBytes) {
          await reader.cancel("legacy object exceeds purpose limit");
          throw new Error("OBJECT_EXCEEDS_PURPOSE_LIMIT");
        }
        digest.update(value);
      }
    } finally {
      reader.releaseLock();
    }
    if (!reference.allowEmpty && received === 0) throw new Error("EMPTY_OBJECT_NOT_ALLOWED");
    const contentHash = digest.digest("hex");
    return {
      size: received,
      mimeType: reference.expectedMimeType
        || response.headers.get("content-type")?.split(";", 1)[0]?.trim()
        || "application/octet-stream",
      contentHash,
    };
  } finally {
    clearTimeout(timer);
  }
}

function assertReferenceIntegrity(reference: LegacyReference, verified: VerifiedObject) {
  const immutableHistoricalReference = reference.kind === "sync_snapshot"
    || reference.kind === "recovery_draft"
    || reference.kind === "import_manifest";
  if (!immutableHistoricalReference) return;
  if (
    reference.expectedSize != null
    && reference.expectedSize >= 0
    && verified.size !== reference.expectedSize
  ) {
    throw new Error("HISTORICAL_OBJECT_SIZE_MISMATCH");
  }
  if (reference.expectedHash && reference.expectedHash !== verified.contentHash) {
    throw new Error("HISTORICAL_OBJECT_HASH_MISMATCH");
  }
}

const wants = (kind: ReferenceKind) => !requestedKinds || requestedKinds.has(kind);

// The messaging cutover (0181) dropped these tables; a database that still has them can be repaired, one that does not is skipped.
async function tableExists(sql: postgres.Sql, name: string) {
  const [row] = await sql<{ found: string | null }[]>`SELECT to_regclass(${`public.${name}`})::text AS found`;
  return Boolean(row?.found);
}

/** Discovery reads only the requested kinds (--kind=...) and only tables that exist. */
async function loadReferences(sql: postgres.Sql): Promise<LegacyReference[]> {
  const references: LegacyReference[] = [];
  const hasChatUploads = await tableExists(sql, "attachment_uploads");
  const hasMessageAttachments = (await tableExists(sql, "message_attachments")) && (await tableExists(sql, "messages"));
  const covers = !(wants("project_cover")) ? [] : await sql<{
    subjectId: string; ownerUserId: string; bucket: string; storageKey: string;
  }[]>`
    SELECT id AS "subjectId", owner_id AS "ownerUserId", cover_image_bucket AS bucket, cover_image_key AS "storageKey"
    FROM public.workspaces
    WHERE cover_image_asset_id IS NULL
      AND cover_image_bucket IS NOT NULL
      AND cover_image_key IS NOT NULL
  `;
  for (const row of covers) references.push({
    kind: "project_cover", subjectId: row.subjectId, ownerUserId: row.ownerUserId,
    projectId: row.subjectId, bucket: row.bucket, storageKey: row.storageKey,
    purpose: "project_cover:cover", expectedSize: null, expectedMimeType: null,
    expectedHash: null, maxBytes: 2 * 1024 * 1024, allowEmpty: false,
  });

  const updates = !(wants("update_media")) ? [] : await sql<{
    subjectId: string; ownerUserId: string | null; projectId: string; ordinal: number;
    bucket: string; storageKey: string; expectedSize: number | null; expectedMimeType: string | null;
  }[]>`
    SELECT update_row.id AS "subjectId", update_row.author_id AS "ownerUserId",
      update_row.workspace_id AS "projectId", media.ordinality::int - 1 AS ordinal,
      media.item->>'bucket' AS bucket, media.item->>'storageKey' AS "storageKey",
      CASE WHEN media.item->>'size' ~ '^[0-9]+$' THEN (media.item->>'size')::bigint END AS "expectedSize",
      NULLIF(media.item->>'mimeType', '') AS "expectedMimeType"
    FROM public.workspace_updates update_row
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(update_row.media, '[]'::jsonb)) WITH ORDINALITY AS media(item, ordinality)
    WHERE media.item->>'storageKey' IS NOT NULL
      AND media.item->>'bucket' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_update_media_assets ref
        JOIN public.storage_assets asset ON asset.id = ref.asset_id
        WHERE ref.update_id = update_row.id AND asset.storage_key = media.item->>'storageKey'
      )
  `;
  for (const row of updates) references.push({
    kind: "update_media", ...row, purpose: "project_update_media:image",
    expectedHash: null, maxBytes: 8 * 1024 * 1024, allowEmpty: false,
  });

  const draftMedia = !(wants("update_draft_media")) ? [] : await sql<{
    subjectId: string; ownerUserId: string; projectId: string; ordinal: number;
    bucket: string; storageKey: string; expectedSize: number | null; expectedMimeType: string | null;
  }[]>`
    SELECT draft.workspace_id || ':' || draft.user_id AS "subjectId", draft.user_id AS "ownerUserId",
      draft.workspace_id AS "projectId", media.ordinality::int - 1 AS ordinal,
      media.item->>'bucket' AS bucket, media.item->>'storageKey' AS "storageKey",
      CASE WHEN media.item->>'size' ~ '^[0-9]+$' THEN (media.item->>'size')::bigint END AS "expectedSize",
      NULLIF(media.item->>'mimeType', '') AS "expectedMimeType"
    FROM public.workspace_update_drafts draft
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(draft.media, '[]'::jsonb)) WITH ORDINALITY AS media(item, ordinality)
    WHERE media.item->>'storageKey' IS NOT NULL
      AND media.item->>'bucket' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.workspace_update_draft_media_assets ref
        JOIN public.storage_assets asset ON asset.id = ref.asset_id
        WHERE ref.workspace_id = draft.workspace_id AND ref.user_id = draft.user_id
          AND asset.storage_key = media.item->>'storageKey'
      )
  `;
  for (const row of draftMedia) references.push({
    kind: "update_draft_media", ...row, purpose: "project_update_media:image",
    expectedHash: null, maxBytes: 8 * 1024 * 1024, allowEmpty: false,
  });

  const uploads = !(wants("chat_upload") && hasChatUploads) ? [] : await sql<{
    subjectId: string; ownerUserId: string; storageKey: string;
    expectedSize: number | null; expectedMimeType: string | null;
  }[]>`
    SELECT id AS "subjectId", user_id AS "ownerUserId", storage_path AS "storageKey",
      size_bytes AS "expectedSize", mime_type AS "expectedMimeType"
    FROM public.attachment_uploads
    WHERE asset_id IS NULL AND storage_path IS NOT NULL AND status = 'committed'
  `;
  for (const row of uploads) references.push({
    kind: "chat_upload", ...row, projectId: null, bucket: "chat-attachments",
    purpose: "chat_attachment:attachment", expectedHash: null,
    maxBytes: 50 * 1024 * 1024, allowEmpty: false,
  });

  const attachments = !(wants("message_attachment") && hasMessageAttachments) ? [] : await sql<{
    subjectId: string; ownerUserId: string | null; storageKey: string;
    expectedSize: number | null; expectedMimeType: string | null;
  }[]>`
    SELECT attachment.id AS "subjectId", message.sender_id AS "ownerUserId",
      attachment.storage_path AS "storageKey", attachment.size_bytes AS "expectedSize",
      attachment.mime_type AS "expectedMimeType"
    FROM public.message_attachments attachment
    JOIN public.messages message ON message.id = attachment.message_id
    WHERE attachment.asset_id IS NULL AND attachment.storage_path IS NOT NULL
  `;
  for (const row of attachments) references.push({
    kind: "message_attachment", ...row, projectId: null, bucket: "chat-attachments",
    purpose: "chat_attachment:attachment", expectedHash: null,
    maxBytes: 50 * 1024 * 1024, allowEmpty: false,
  });

  const profiles = !((wants("profile_avatar") || wants("profile_banner"))) ? [] : await sql<{
    subjectId: string; avatarUrl: string | null; bannerUrl: string | null;
    avatarAssetId: string | null; bannerAssetId: string | null;
  }[]>`
    SELECT id AS "subjectId", avatar_url AS "avatarUrl", banner_url AS "bannerUrl",
      avatar_asset_id AS "avatarAssetId", banner_asset_id AS "bannerAssetId"
    FROM public.profiles
    WHERE (avatar_asset_id IS NULL AND avatar_url IS NOT NULL)
       OR (banner_asset_id IS NULL AND banner_url IS NOT NULL)
  `;
  for (const row of profiles) {
    const avatarKey = row.avatarAssetId ? null : profileStorageKey(row.avatarUrl, row.subjectId);
    if (avatarKey) references.push({
      kind: "profile_avatar", subjectId: row.subjectId, ownerUserId: row.subjectId,
      projectId: null, bucket: "avatars", storageKey: avatarKey,
      purpose: "legacy_profile_image:avatar", expectedSize: null,
      expectedMimeType: null, expectedHash: null, maxBytes: 2 * 1024 * 1024, allowEmpty: false,
    });
    const bannerKey = row.bannerAssetId ? null : profileStorageKey(row.bannerUrl, row.subjectId);
    if (bannerKey) references.push({
      kind: "profile_banner", subjectId: row.subjectId, ownerUserId: row.subjectId,
      projectId: null, bucket: "avatars", storageKey: bannerKey,
      purpose: "legacy_profile_image:banner", expectedSize: null,
      expectedMimeType: null, expectedHash: null, maxBytes: 2 * 1024 * 1024, allowEmpty: false,
    });
  }

  const snapshots = !(wants("sync_snapshot")) ? [] : await sql<{
    subjectId: string; ownerUserId: string; projectId: string; ordinal: number;
    storageKey: string; expectedSize: number | null; expectedMimeType: string; expectedHash: string | null;
  }[]>`
    SELECT run.id AS "subjectId", run.actor_id AS "ownerUserId", run.workspace_id AS "projectId",
      file.ordinality::int - 1 AS ordinal, file.item->>'snapshotKey' AS "storageKey",
      CASE WHEN file.item->>'size' ~ '^[0-9]+$' THEN (file.item->>'size')::bigint END AS "expectedSize",
      COALESCE(NULLIF(file.item->>'mimeType', ''), 'application/octet-stream') AS "expectedMimeType",
      NULLIF(file.item->>'resultHash', '') AS "expectedHash"
    FROM public.github_sync_runs run
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(run.manifest->'files', '[]'::jsonb)) WITH ORDINALITY AS file(item, ordinality)
    WHERE file.item->>'snapshotKey' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.github_sync_snapshot_assets ref
        JOIN public.storage_assets asset ON asset.id = ref.asset_id
        WHERE ref.run_id = run.id AND asset.storage_key = file.item->>'snapshotKey'
      )
  `;
  for (const row of snapshots) references.push({
    kind: "sync_snapshot", ...row, bucket: "project-files", purpose: "sync_snapshot:snapshot",
    maxBytes: 10 * 1024 * 1024, allowEmpty: true,
  });

  const recoveryDrafts = !(wants("recovery_draft")) ? [] : await sql<{
    subjectId: string; ownerUserId: string; projectId: string; storageKey: string;
    expectedSize: number; expectedMimeType: string; expectedHash: string;
  }[]>`
    SELECT id AS "subjectId", user_id AS "ownerUserId", workspace_id AS "projectId",
      storage_key AS "storageKey", size AS "expectedSize", mime_type AS "expectedMimeType",
      content_hash AS "expectedHash"
    FROM public.extension_recovery_drafts WHERE asset_id IS NULL
  `;
  for (const row of recoveryDrafts) references.push({
    kind: "recovery_draft", ...row, bucket: "extension-recovery-drafts",
    purpose: "recovery_draft:draft", maxBytes: 10 * 1024 * 1024, allowEmpty: true,
  });

  const manifests = !(wants("import_manifest")) ? [] : await sql<{
    subjectId: string; ownerUserId: string; projectId: string; storageKey: string;
    expectedHash: string | null;
  }[]>`
    SELECT job.id AS "subjectId", project.owner_id AS "ownerUserId", job.workspace_id AS "projectId",
      job.manifest_s3_key AS "storageKey", job.manifest_hash AS "expectedHash"
    FROM public.import_jobs job
    JOIN public.workspaces project ON project.id = job.workspace_id
    WHERE job.manifest_asset_id IS NULL AND job.manifest_s3_key IS NOT NULL
  `;
  for (const row of manifests) references.push({
    kind: "import_manifest", ...row, bucket: "project-files", purpose: "import_manifest:manifest",
    expectedSize: null, expectedMimeType: "application/json", maxBytes: 64 * 1024 * 1024, allowEmpty: false,
  });

  return references;
}

async function attachReference(
  sql: postgres.Sql,
  reference: LegacyReference,
  assetId: string,
  verified: VerifiedObject,
) {
  switch (reference.kind) {
    case "project_cover":
      await sql`UPDATE public.workspaces SET cover_image_asset_id = ${assetId}
        WHERE id = ${reference.subjectId} AND cover_image_asset_id IS NULL
          AND cover_image_bucket = ${reference.bucket} AND cover_image_key = ${reference.storageKey}`;
      break;
    case "update_media":
      await sql`UPDATE public.workspace_updates update_row
        SET media = (
          SELECT jsonb_agg(
            CASE WHEN media.ordinality::int - 1 = ${reference.ordinal ?? 0}
              THEN media.item || jsonb_build_object(
                'size', ${verified.size}::bigint,
                'mimeType', ${verified.mimeType}::text
              )
              ELSE media.item END
            ORDER BY media.ordinality
          )
          FROM jsonb_array_elements(COALESCE(update_row.media, '[]'::jsonb))
            WITH ORDINALITY AS media(item, ordinality)
        )
        WHERE update_row.id = ${reference.subjectId}`;
      await sql`INSERT INTO public.workspace_update_media_assets(update_id, asset_id, ordinal)
        VALUES (${reference.subjectId}, ${assetId}, ${reference.ordinal ?? 0}) ON CONFLICT DO NOTHING`;
      break;
    case "update_draft_media": {
      const [projectId, userId] = reference.subjectId.split(":", 2);
      if (!projectId || !userId) throw new Error("INVALID_UPDATE_DRAFT_IDENTITY");
      await sql`INSERT INTO public.workspace_update_draft_media_assets(workspace_id, user_id, asset_id, ordinal)
        VALUES (${projectId}, ${userId}, ${assetId}, ${reference.ordinal ?? 0}) ON CONFLICT DO NOTHING`;
      break;
    }
    case "chat_upload":
      await sql`UPDATE public.attachment_uploads
        SET asset_id = ${assetId}, size_bytes = ${verified.size}, mime_type = ${verified.mimeType}, updated_at = now()
        WHERE id = ${reference.subjectId} AND asset_id IS NULL AND storage_path = ${reference.storageKey}`;
      break;
    case "message_attachment":
      await sql`UPDATE public.message_attachments
        SET asset_id = ${assetId}, size_bytes = ${verified.size}, mime_type = ${verified.mimeType}
        WHERE id = ${reference.subjectId} AND asset_id IS NULL AND storage_path = ${reference.storageKey}`;
      break;
    case "profile_avatar":
      await sql`UPDATE public.profiles SET avatar_asset_id = ${assetId}, updated_at = now()
        WHERE id = ${reference.subjectId} AND avatar_asset_id IS NULL`;
      break;
    case "profile_banner":
      await sql`UPDATE public.profiles SET banner_asset_id = ${assetId}, updated_at = now()
        WHERE id = ${reference.subjectId} AND banner_asset_id IS NULL`;
      break;
    case "sync_snapshot":
      await sql`INSERT INTO public.github_sync_snapshot_assets(run_id, asset_id, path)
        SELECT ${reference.subjectId}, ${assetId}, file.item->>'path'
        FROM public.github_sync_runs run
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(run.manifest->'files', '[]'::jsonb)) WITH ORDINALITY AS file(item, ordinality)
        WHERE run.id = ${reference.subjectId} AND file.ordinality::int - 1 = ${reference.ordinal ?? 0}
        ON CONFLICT DO NOTHING`;
      break;
    case "recovery_draft":
      await sql`UPDATE public.extension_recovery_drafts SET asset_id = ${assetId}, updated_at = now()
        WHERE id = ${reference.subjectId} AND asset_id IS NULL AND storage_key = ${reference.storageKey}`;
      break;
    case "import_manifest":
      await sql`UPDATE public.import_jobs SET manifest_asset_id = ${assetId}, updated_at = now()
        WHERE id = ${reference.subjectId} AND manifest_asset_id IS NULL AND manifest_s3_key = ${reference.storageKey}`;
      break;
  }
}

async function referenceIsAttached(
  sql: postgres.Sql,
  reference: LegacyReference,
  assetId: string,
) {
  switch (reference.kind) {
    case "project_cover":
      return (await sql`SELECT 1 FROM public.workspaces
        WHERE id = ${reference.subjectId} AND cover_image_asset_id = ${assetId}`)[0] != null;
    case "update_media":
      return (await sql`SELECT 1 FROM public.workspace_update_media_assets
        WHERE update_id = ${reference.subjectId} AND asset_id = ${assetId}
          AND ordinal = ${reference.ordinal ?? 0}`)[0] != null;
    case "update_draft_media": {
      const [projectId, userId] = reference.subjectId.split(":", 2);
      if (!projectId || !userId) return false;
      return (await sql`SELECT 1 FROM public.workspace_update_draft_media_assets
        WHERE workspace_id = ${projectId} AND user_id = ${userId} AND asset_id = ${assetId}
          AND ordinal = ${reference.ordinal ?? 0}`)[0] != null;
    }
    case "chat_upload":
      return (await sql`SELECT 1 FROM public.attachment_uploads
        WHERE id = ${reference.subjectId} AND asset_id = ${assetId}`)[0] != null;
    case "message_attachment":
      return (await sql`SELECT 1 FROM public.message_attachments
        WHERE id = ${reference.subjectId} AND asset_id = ${assetId}`)[0] != null;
    case "profile_avatar":
      return (await sql`SELECT 1 FROM public.profiles
        WHERE id = ${reference.subjectId} AND avatar_asset_id = ${assetId}`)[0] != null;
    case "profile_banner":
      return (await sql`SELECT 1 FROM public.profiles
        WHERE id = ${reference.subjectId} AND banner_asset_id = ${assetId}`)[0] != null;
    case "sync_snapshot":
      return (await sql`SELECT 1
        FROM public.github_sync_snapshot_assets ref
        JOIN public.github_sync_runs run ON run.id = ref.run_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(run.manifest->'files', '[]'::jsonb))
          WITH ORDINALITY AS file(item, ordinality)
        WHERE ref.run_id = ${reference.subjectId} AND ref.asset_id = ${assetId}
          AND file.ordinality::int - 1 = ${reference.ordinal ?? 0}
          AND ref.path = file.item->>'path'`)[0] != null;
    case "recovery_draft":
      return (await sql`SELECT 1 FROM public.extension_recovery_drafts
        WHERE id = ${reference.subjectId} AND asset_id = ${assetId}`)[0] != null;
    case "import_manifest":
      return (await sql`SELECT 1 FROM public.import_jobs
        WHERE id = ${reference.subjectId} AND manifest_asset_id = ${assetId}`)[0] != null;
  }
}

function repairSubject(reference: LegacyReference) {
  return `${reference.kind}:${reference.subjectId}:${reference.ordinal ?? 0}`;
}

async function recordFailure(sql: postgres.Sql, reference: LegacyReference, error: unknown) {
  const subject = repairSubject(reference);
  const detail = error instanceof Error ? error.message : String(error);
  await sql`
    INSERT INTO public.storage_repair_failures(repair_kind, subject_id, error_code, detail, next_retry_at)
    VALUES ('legacy_asset_registration', ${subject}, ${detail.slice(0, 120)},
      ${JSON.stringify({ bucket: reference.bucket, storageKey: reference.storageKey, error: detail }).slice(0, 2000)},
      now() + interval '1 hour')
    ON CONFLICT (repair_kind, subject_id) DO UPDATE SET
      error_code = EXCLUDED.error_code, detail = EXCLUDED.detail,
      attempts = public.storage_repair_failures.attempts + 1,
      next_retry_at = EXCLUDED.next_retry_at, resolved_at = NULL, updated_at = now()
  `;
}

function isConfirmedMissingObject(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail === "OBJECT_SIGN_FAILED:Object not found" || detail === "OBJECT_READ_HTTP_404";
}

async function quarantineMissingReference(sql: postgres.Sql, reference: LegacyReference) {
  if (reference.kind !== "chat_upload" && reference.kind !== "message_attachment") {
    throw new Error("MISSING_REFERENCE_QUARANTINE_UNSUPPORTED");
  }
  const rows = await sql<{ id: string; state: string; ownerUserId: string | null }[]>`
    INSERT INTO public.storage_assets(
      owner_user_id, workspace_id, bucket, storage_key, purpose, state,
      declared_mime_type, declared_size, metadata, expires_at, backup_state, last_error_code
    ) VALUES (
      ${reference.ownerUserId}, ${reference.projectId}, ${reference.bucket}, ${reference.storageKey},
      ${reference.purpose}, 'missing', ${reference.expectedMimeType || "application/octet-stream"},
      ${Math.max(0, reference.expectedSize ?? 0)},
      ${JSON.stringify({
        source: "legacy_asset_registration",
        referenceKind: reference.kind,
        provenance: "legacy_object_confirmed_missing",
      })}::jsonb,
      now(), 'not_required', 'OBJECT_MISSING_QUARANTINED'
    )
    ON CONFLICT (bucket, storage_key) DO NOTHING
    RETURNING id, state, owner_user_id AS "ownerUserId"
  `;
  const [asset] = rows.length ? rows : await sql<{
    id: string; state: string; ownerUserId: string | null;
  }[]>`
    SELECT id, state, owner_user_id AS "ownerUserId"
    FROM public.storage_assets
    WHERE bucket = ${reference.bucket} AND storage_key = ${reference.storageKey}
    LIMIT 1
  `;
  if (!asset || asset.state !== "missing") throw new Error("MISSING_ASSET_IDENTITY_CONFLICT");
  if (reference.ownerUserId && asset.ownerUserId && asset.ownerUserId !== reference.ownerUserId) {
    throw new Error("MISSING_ASSET_OWNER_CONFLICT");
  }
  if (reference.kind === "chat_upload") {
    await sql`UPDATE public.attachment_uploads
      SET asset_id = ${asset.id}, updated_at = now()
      WHERE id = ${reference.subjectId} AND asset_id IS NULL AND storage_path = ${reference.storageKey}`;
  } else {
    await sql`UPDATE public.message_attachments
      SET asset_id = ${asset.id}
      WHERE id = ${reference.subjectId} AND asset_id IS NULL AND storage_path = ${reference.storageKey}`;
  }
  if (!await referenceIsAttached(sql, reference, asset.id)) {
    throw new Error("MISSING_REFERENCE_ATTACH_CONFLICT");
  }
  await sql`
    UPDATE public.storage_repair_failures
    SET error_code = 'OBJECT_MISSING_QUARANTINED', next_retry_at = NULL,
      detail = ${JSON.stringify({
        bucket: reference.bucket,
        storageKey: reference.storageKey,
        error: "provider object is unavailable",
      })}, resolved_at = NULL, updated_at = now()
    WHERE repair_kind = 'legacy_asset_registration'
      AND subject_id = ${repairSubject(reference)}
  `;
}

async function main() {
  const sql = postgres(resolvedDatabaseUrl, {
    prepare: false,
    ssl: databaseSsl(resolvedDatabaseUrl),
    max: 6,
  });
  try {
    const discoveredReferences = await loadReferences(sql);
    const references = requestedKinds
      ? discoveredReferences.filter((reference) => requestedKinds.has(reference.kind))
      : discoveredReferences;
    const byKind = Object.fromEntries([...new Set(references.map((reference) => reference.kind))]
      .map((kind) => [kind, references.filter((reference) => reference.kind === kind).length]));
    console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", references: references.length, byKind }));
    if (!APPLY || references.length === 0) return;

    const admin = await createAdminClient();
    const verifiedObjectPromises = new Map<string, Promise<VerifiedObject>>();
    const loadVerifiedObject = (reference: LegacyReference) => {
      const identity = `${reference.bucket}:${reference.storageKey}`;
      const existing = verifiedObjectPromises.get(identity);
      if (existing) return existing;
      const pending = verifyObject(admin, reference);
      verifiedObjectPromises.set(identity, pending);
      return pending;
    };
    const ensureAsset = async (reference: LegacyReference, verified: VerifiedObject) => {
        const rows = await sql<{ id: string; projectId: string | null; state: string; contentHash: string | null }[]>`
          INSERT INTO public.storage_assets(
            owner_user_id, workspace_id, bucket, storage_key, purpose, state,
            declared_mime_type, declared_size, verified_mime_type, verified_size,
            content_hash, metadata, expires_at, verified_at, backup_state
          ) VALUES (
            ${reference.ownerUserId}, ${reference.projectId}, ${reference.bucket}, ${reference.storageKey},
            ${reference.purpose}, 'verified', ${verified.mimeType}, ${verified.size}, ${verified.mimeType},
            ${verified.size}, ${verified.contentHash},
            ${JSON.stringify({ source: "legacy_asset_registration", referenceKind: reference.kind })}::jsonb,
            now(), now(), 'pending'
          )
          ON CONFLICT (bucket, storage_key) DO NOTHING
          RETURNING id, workspace_id AS "projectId", state, content_hash AS "contentHash"
        `;
        const [asset] = rows.length ? rows : await sql<{
          id: string; projectId: string | null; state: string; contentHash: string | null;
        }[]>`
          SELECT id, workspace_id AS "projectId", state, content_hash AS "contentHash"
          FROM public.storage_assets WHERE bucket = ${reference.bucket} AND storage_key = ${reference.storageKey} LIMIT 1
        `;
        if (!asset || asset.state !== "verified" || asset.contentHash !== verified.contentHash) {
          throw new Error("ASSET_IDENTITY_CONFLICT");
        }
        if (reference.projectId && asset.projectId && asset.projectId !== reference.projectId) {
          throw new Error("ASSET_PROJECT_CONFLICT");
        }
        return asset.id;
    };

    let nextIndex = 0;
    let attached = 0;
    let quarantined = 0;
    let failed = 0;
    await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, references.length) }, async () => {
      while (nextIndex < references.length) {
        const reference = references[nextIndex++]!;
        try {
          const verified = await loadVerifiedObject(reference);
          assertReferenceIntegrity(reference, verified);
          const assetId = await ensureAsset(reference, verified);
          await attachReference(sql, reference, assetId, verified);
          if (!await referenceIsAttached(sql, reference, assetId)) {
            throw new Error("REFERENCE_ATTACH_CONFLICT");
          }
          await sql`UPDATE public.storage_repair_failures
            SET resolved_at = now(), updated_at = now()
            WHERE repair_kind = 'legacy_asset_registration'
              AND subject_id = ${repairSubject(reference)}`;
          attached += 1;
        } catch (error) {
          if (isConfirmedMissingObject(error)) {
            try {
              await quarantineMissingReference(sql, reference);
              quarantined += 1;
              console.warn("[legacy-storage-migration] quarantined missing object", {
                kind: reference.kind,
                subjectId: reference.subjectId,
              });
              continue;
            } catch (quarantineError) {
              error = quarantineError;
            }
          }
          failed += 1;
          await recordFailure(sql, reference, error);
          if (failed <= 20 || failed % 100 === 0) {
            console.warn("[legacy-storage-migration] failed", {
              kind: reference.kind,
              subjectId: reference.subjectId,
              ordinal: reference.ordinal ?? 0,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if ((attached + failed) % 100 === 0) {
          console.log(`[legacy-storage-migration] processed=${attached + failed} attached=${attached} failed=${failed}`);
        }
      }
    }));
    console.log(JSON.stringify({ mode: "apply", references: references.length, attached, quarantined, failed }));
    if (failed > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[legacy-storage-migration] fatal", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
