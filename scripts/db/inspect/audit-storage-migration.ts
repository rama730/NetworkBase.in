/** Read-only post-migration audit for canonical storage references. */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const reportedUpdateMediaKey = "projects/0adb0049-a58e-44d3-bcb3-db2ee4abdfc6/update-media/2b4030a1-b030-4a50-811a-0da96b88c224/1782022030421-15b172e2-d652-43fc-b6a3-7e60f0798768.webp";
const reportedProjectImageKeys = [
  "projects/c5a7fa11-bacb-4a58-bc3a-280ad9668b44/project-images/2b4030a1-b030-4a50-811a-0da96b88c224/1790444693394-680bd836-5858-4c62-8b31-d4c7ac3a70fe.gif",
  "projects/0adb0049-a58e-44d3-bcb3-db2ee4abdfc6/project-images/2b4030a1-b030-4a50-811a-0da96b88c224/1788736772672-53c1af2a-9a0e-46c2-8845-ae1e4d8d1bfc.jpg",
] as const;

async function main() {
  const hostname = new URL(databaseUrl!).hostname;
  const sql = postgres(databaseUrl!, {
    prepare: false,
    ssl: ["localhost", "127.0.0.1", "::1"].includes(hostname) ? false : "require",
    max: 1,
  });
  try {
    const [summary] = await sql<{
      missingCurrentVersions: number;
      incompleteCurrentVersions: number;
      quarantinedCurrentVersions: number;
      quarantinedHistoricalVersions: number;
      coversWithoutAsset: number;
      updateMediaWithoutAsset: number;
      quarantinedChatReferences: number;
      managedAvatarsWithoutPublicAsset: number;
      quarantinedSyncSnapshots: number;
      verifiedAssets: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM public.project_nodes node
          WHERE node.type = 'file' AND node.deleted_at IS NULL AND node.s3_key IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.file_versions version
              WHERE version.node_id = node.id AND version.version = node.current_version
            )) AS "missingCurrentVersions",
        (SELECT count(*)::int FROM public.project_nodes node
          JOIN public.file_versions version
            ON version.node_id = node.id AND version.version = node.current_version
          LEFT JOIN public.storage_assets asset ON asset.id = version.asset_id
          WHERE node.type = 'file' AND node.deleted_at IS NULL AND node.s3_key IS NOT NULL
            AND (
              node.asset_id IS NULL
              OR version.asset_id IS NULL
              OR (version.content_hash IS NULL AND COALESCE(asset.state, '') <> 'missing')
            )
        ) AS "incompleteCurrentVersions",
        (SELECT count(*)::int FROM public.project_nodes node
          JOIN public.file_versions version
            ON version.node_id = node.id AND version.version = node.current_version
          JOIN public.storage_assets asset ON asset.id = version.asset_id
          WHERE node.type = 'file' AND node.deleted_at IS NULL AND node.s3_key IS NOT NULL
            AND node.asset_id = asset.id AND asset.state = 'missing'
        ) AS "quarantinedCurrentVersions",
        (SELECT count(*)::int FROM public.storage_repair_failures failure
          WHERE failure.repair_kind = 'file_hash_backfill'
            AND failure.error_code = 'HISTORICAL_BYTES_UNAVAILABLE'
            AND failure.resolved_at IS NULL
        ) AS "quarantinedHistoricalVersions",
        (SELECT count(*)::int FROM public.projects
          WHERE cover_image_key IS NOT NULL AND cover_image_asset_id IS NULL
        ) AS "coversWithoutAsset",
        (SELECT count(*)::int FROM public.project_updates update_row
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(update_row.media, '[]'::jsonb)) media(item)
          WHERE media.item->>'storageKey' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.project_update_media_assets reference
              JOIN public.storage_assets asset ON asset.id = reference.asset_id
              WHERE reference.update_id = update_row.id
                AND asset.storage_key = media.item->>'storageKey'
            )
        ) AS "updateMediaWithoutAsset",
        (SELECT count(*)::int
          FROM public.chat_attachments attachment
          JOIN public.storage_assets asset ON asset.id = attachment.asset_id
          WHERE asset.state = 'missing'
        ) AS "quarantinedChatReferences",
        (SELECT count(*)::int FROM public.profiles profile
          LEFT JOIN public.storage_assets asset ON asset.id = profile.avatar_asset_id
          WHERE profile.avatar_url LIKE '%/avatars/%'
            AND COALESCE(asset.purpose, '') <> 'profile_image_public:avatar'
        ) AS "managedAvatarsWithoutPublicAsset",
        (SELECT count(*)::int FROM public.github_sync_runs run
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(run.manifest->'files', '[]'::jsonb))
            WITH ORDINALITY AS file(item, ordinality)
          WHERE file.item->>'snapshotKey' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.github_sync_snapshot_assets reference
              JOIN public.storage_assets asset ON asset.id = reference.asset_id
              WHERE reference.run_id = run.id
                AND reference.path = file.item->>'path'
                AND asset.storage_key = file.item->>'snapshotKey'
            )
        ) AS "quarantinedSyncSnapshots",
        (SELECT count(*)::int FROM public.storage_assets WHERE state = 'verified') AS "verifiedAssets"
    `;
    const failures = await sql<{
      repairKind: string;
      errorCode: string;
      count: number;
    }[]>`
      SELECT repair_kind AS "repairKind", error_code AS "errorCode", count(*)::int AS count
      FROM public.storage_repair_failures
      WHERE resolved_at IS NULL
      GROUP BY repair_kind, error_code
      ORDER BY repair_kind, error_code
    `;
    const incompleteCurrentVersions = await sql<{
      nodeId: string;
      versionId: string;
      projectId: string;
      version: number;
      storageKey: string;
      currentStorageKey: string | null;
      versionAssetState: string | null;
      nodeAssetId: string | null;
      versionAssetId: string | null;
      contentHash: string | null;
      declaredSize: number;
      failureDetail: string | null;
    }[]>`
      SELECT
        node.id AS "nodeId",
        version.id AS "versionId",
        node.project_id AS "projectId",
        version.version,
        version.s3_key AS "storageKey",
        node.s3_key AS "currentStorageKey",
        asset.state AS "versionAssetState",
        node.asset_id AS "nodeAssetId",
        version.asset_id AS "versionAssetId",
        version.content_hash AS "contentHash",
        version.size AS "declaredSize",
        failure.detail AS "failureDetail"
      FROM public.project_nodes node
      JOIN public.file_versions version
        ON version.node_id = node.id AND version.version = node.current_version
      LEFT JOIN public.storage_assets asset ON asset.id = version.asset_id
      LEFT JOIN public.storage_repair_failures failure
        ON failure.repair_kind = 'file_hash_backfill'
       AND failure.subject_id = version.id::text
       AND failure.resolved_at IS NULL
      WHERE node.type = 'file'
        AND node.deleted_at IS NULL
        AND node.s3_key IS NOT NULL
        AND (
          node.asset_id IS NULL
          OR version.asset_id IS NULL
          OR (version.content_hash IS NULL AND COALESCE(asset.state, '') <> 'missing')
        )
      ORDER BY node.id
    `;
    const [reported] = await sql<{
      storageAssets: string | null;
      updateMediaAssets: string | null;
      projectNodesAssetId: boolean;
      reportedUpdateMediaAttached: boolean;
      reportedProjectImagesAttached: number;
    }[]>`
      SELECT
        to_regclass('public.storage_assets')::text AS "storageAssets",
        to_regclass('public.project_update_media_assets')::text AS "updateMediaAssets",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'project_nodes' AND column_name = 'asset_id'
        ) AS "projectNodesAssetId",
        EXISTS (
          SELECT 1 FROM public.project_update_media_assets reference
          JOIN public.storage_assets asset ON asset.id = reference.asset_id
          WHERE asset.storage_key = ${reportedUpdateMediaKey}
        ) AS "reportedUpdateMediaAttached",
        (
          SELECT count(*)::int
          FROM public.projects project
          JOIN public.storage_assets asset ON asset.id = project.cover_image_asset_id
          WHERE asset.state = 'verified'
            AND asset.storage_key IN (${reportedProjectImageKeys[0]}, ${reportedProjectImageKeys[1]})
        ) AS "reportedProjectImagesAttached"
    `;
    console.log(JSON.stringify({ summary, failures, incompleteCurrentVersions, reported }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("[storage-migration-audit] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
