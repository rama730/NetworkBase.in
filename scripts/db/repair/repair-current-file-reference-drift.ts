/**
 * Reconcile active file nodes whose current version points at a different
 * legacy object key. Storage is verified before the short compare-and-swap
 * transaction. Dry-run is the default; pass --apply to mutate.
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

import { createAdminClient } from "../../../src/lib/supabase/server";

config({ path: ".env.local" });
config();

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 30_000;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

type Candidate = {
  nodeId: string;
  versionId: string;
  projectId: string;
  version: number;
  nodeKey: string;
  versionKey: string;
  ownerUserId: string | null;
  declaredSize: number;
  declaredMimeType: string;
};

type Verification =
  | { state: "verified"; size: number; mimeType: string; contentHash: string }
  | { state: "missing" };

function requiresTls(connectionString: string) {
  const hostname = new URL(connectionString).hostname;
  return !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

async function verifyCurrentObject(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  candidate: Candidate,
): Promise<Verification> {
  const { data, error } = await admin.storage.from("project-files").createSignedUrl(candidate.nodeKey, 60);
  if (error || !data?.signedUrl) {
    if (error?.message === "Object not found") return { state: "missing" };
    throw new Error(`OBJECT_SIGN_FAILED:${error?.message ?? "missing URL"}`);
  }
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  try {
    const response = await fetch(data.signedUrl, { cache: "no-store", signal: controller.signal });
    if (response.status === 404) return { state: "missing" };
    if (!response.ok || !response.body) throw new Error(`OBJECT_READ_HTTP_${response.status}`);
    const digest = createHash("sha256");
    const reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
        size += value.byteLength;
        if (size > MAX_FILE_BYTES) {
          await reader.cancel("object exceeds maintained limit");
          throw new Error("OBJECT_EXCEEDS_PURPOSE_LIMIT");
        }
        digest.update(value);
      }
    } finally {
      reader.releaseLock();
    }
    return {
      state: "verified",
      size,
      mimeType: response.headers.get("content-type")?.split(";", 1)[0]?.trim()
        || candidate.declaredMimeType
        || "application/octet-stream",
      contentHash: digest.digest("hex"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const sql = postgres(DATABASE_URL!, {
    prepare: false,
    ssl: requiresTls(DATABASE_URL!) ? "require" : false,
    max: 4,
  });
  try {
    const candidates = await sql<Candidate[]>`
      SELECT
        node.id AS "nodeId",
        version.id AS "versionId",
        node.workspace_id AS "projectId",
        version.version,
        node.s3_key AS "nodeKey",
        version.s3_key AS "versionKey",
        node.created_by AS "ownerUserId",
        GREATEST(COALESCE(node.size, version.size, 0), 0)::bigint AS "declaredSize",
        COALESCE(NULLIF(node.mime_type, ''), NULLIF(version.mime_type, ''), 'application/octet-stream') AS "declaredMimeType"
      FROM public.workspace_nodes node
      JOIN public.file_versions version
        ON version.node_id = node.id AND version.version = node.current_version
      LEFT JOIN public.storage_assets version_asset ON version_asset.id = version.asset_id
      WHERE node.type = 'file'
        AND node.deleted_at IS NULL
        AND node.s3_key IS NOT NULL
        AND version.s3_key <> node.s3_key
        AND (version.asset_id IS NULL OR version_asset.state = 'missing')
      ORDER BY node.id
    `;
    console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", candidates: candidates.length }));
    if (!APPLY || candidates.length === 0) return;

    const admin = await createAdminClient();
    let repaired = 0;
    let missing = 0;
    for (const candidate of candidates) {
      const verified = await verifyCurrentObject(admin, candidate);
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as postgres.Sql;
        await tx`SELECT set_config('app.maintenance_operation', 'version_repair', true)`;
        const rows = await tx<{ id: string }[]>`
          SELECT node.id
          FROM public.workspace_nodes node
          JOIN public.file_versions version
            ON version.node_id = node.id AND version.version = node.current_version
          WHERE node.id = ${candidate.nodeId}
            AND node.workspace_id = ${candidate.projectId}
            AND node.current_version = ${candidate.version}
            AND node.s3_key = ${candidate.nodeKey}
            AND version.id = ${candidate.versionId}
            AND version.s3_key = ${candidate.versionKey}
          FOR UPDATE OF node, version
        `;
        if (rows.length !== 1) throw new Error("CURRENT_REFERENCE_CHANGED_DURING_REPAIR");

        const values = verified.state === "verified"
          ? {
              state: "verified",
              size: verified.size,
              mimeType: verified.mimeType,
              contentHash: verified.contentHash,
              verifiedAt: new Date(),
              backupState: "pending",
              lastErrorCode: null,
            }
          : {
              state: "missing",
              size: Math.max(0, Number(candidate.declaredSize)),
              mimeType: candidate.declaredMimeType,
              contentHash: null,
              verifiedAt: null,
              backupState: "not_required",
              lastErrorCode: "OBJECT_MISSING_QUARANTINED",
            };
        const inserted = await tx<{ id: string; state: string; contentHash: string | null }[]>`
          INSERT INTO public.storage_assets(
            owner_user_id, workspace_id, bucket, storage_key, purpose, state,
            declared_mime_type, declared_size, verified_mime_type, verified_size,
            content_hash, metadata, expires_at, verified_at, backup_state, last_error_code
          ) VALUES (
            ${candidate.ownerUserId}, ${candidate.projectId}, 'project-files', ${candidate.nodeKey},
            'workspace_file:file', ${values.state}, ${values.mimeType}, ${values.size},
            ${verified.state === "verified" ? values.mimeType : null},
            ${verified.state === "verified" ? values.size : null},
            ${values.contentHash},
            ${JSON.stringify({
              source: "current_file_reference_drift_repair",
              provenance: verified.state === "verified" ? "verified_legacy_bytes" : "legacy_object_confirmed_missing",
            })}::jsonb,
            now(), ${values.verifiedAt}, ${values.backupState}, ${values.lastErrorCode}
          )
          ON CONFLICT (bucket, storage_key) DO NOTHING
          RETURNING id, state, content_hash AS "contentHash"
        `;
        const [asset] = inserted.length ? inserted : await tx<{
          id: string; state: string; contentHash: string | null;
        }[]>`
          SELECT id, state, content_hash AS "contentHash"
          FROM public.storage_assets
          WHERE bucket = 'project-files' AND storage_key = ${candidate.nodeKey}
          LIMIT 1
        `;
        if (!asset || asset.state !== values.state || asset.contentHash !== values.contentHash) {
          throw new Error("CURRENT_ASSET_IDENTITY_CONFLICT");
        }

        await tx`
          UPDATE public.file_versions
          SET s3_key = ${candidate.nodeKey}, asset_id = ${asset.id},
            size = ${values.size}, mime_type = ${values.mimeType}, content_hash = ${values.contentHash},
            attribution = COALESCE(attribution, '{}'::jsonb) || ${JSON.stringify({
              source: "current_file_reference_drift_repair",
              provenance: verified.state === "verified" ? "verified_legacy_bytes" : "legacy_object_confirmed_missing",
              repairedAt: new Date().toISOString(),
            })}::jsonb
          WHERE id = ${candidate.versionId} AND s3_key = ${candidate.versionKey}
        `;
        await tx`
          UPDATE public.workspace_nodes
          SET asset_id = ${asset.id}, size = ${values.size}, mime_type = ${values.mimeType}, updated_at = now()
          WHERE id = ${candidate.nodeId} AND s3_key = ${candidate.nodeKey}
            AND current_version = ${candidate.version}
        `;
        if (verified.state === "verified") {
          await tx`
            UPDATE public.storage_repair_failures
            SET resolved_at = now(), updated_at = now()
            WHERE repair_kind = 'file_hash_backfill' AND subject_id = ${candidate.versionId}
          `;
        } else {
          await tx`
            UPDATE public.storage_repair_failures
            SET error_code = 'OBJECT_MISSING_QUARANTINED', next_retry_at = NULL,
              detail = 'authoritative current object key is unavailable', resolved_at = NULL, updated_at = now()
            WHERE repair_kind = 'file_hash_backfill' AND subject_id = ${candidate.versionId}
          `;
        }
      });
      if (verified.state === "verified") repaired += 1;
      else missing += 1;
    }
    console.log(JSON.stringify({ mode: "apply", candidates: candidates.length, repaired, missing }));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[current-file-reference-repair] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
