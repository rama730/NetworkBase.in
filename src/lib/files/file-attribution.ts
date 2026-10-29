import { db } from "@/lib/db";
import { profiles, type WorkspaceNode } from "@/lib/db/schema";
import { inArray, sql } from "drizzle-orm";

export type FileAttribution = {
  updatedById?: string | null;
  updatedByName?: string | null;
  updatedByUsername?: string | null;
  updatedByAvatarUrl?: string | null;
  versionUpdatedAt?: Date | string | null;
};

type LatestVersionAttributionRow = {
  node_id: string;
  created_by: string | null;
  uploaded_by: string | null;
  uploaded_at: Date | string | null;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  external_name: string | null;
};

const BATCH_SIZE = 1_000;

/** Canonical updater projection shared by Files and task attachments. */
export async function getFileAttributionByNodeId(
  nodes: readonly WorkspaceNode[],
): Promise<Map<string, FileAttribution>> {
  const files = nodes.filter((node) => node.type === "file");
  // ponytail: short-circuit for directory-only trees saves 1 database query per folder view. ceiling: empty files array. upgrade: run query when file nodes exist.
  if (files.length === 0) return new Map();
  const latestByNodeId = new Map<string, LatestVersionAttributionRow>();

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const chunk = files.slice(i, i + BATCH_SIZE).map((node) => node.id);
    const rows = await db.execute<LatestVersionAttributionRow>(sql`
      SELECT
        pn.id AS node_id,
        pn.created_by,
        fv.uploaded_by,
        fv.uploaded_at,
        p.full_name,
        p.username,
        p.avatar_url,
        CASE WHEN fv.attribution->>'source' = 'github' THEN fv.attribution->'contributors'->0->>'name' END AS external_name
      FROM workspace_nodes pn
      LEFT JOIN file_versions fv
        ON pn.id = fv.node_id
       AND pn.current_version = fv.version
      LEFT JOIN profiles p ON p.id = COALESCE(fv.uploaded_by, pn.created_by)
      WHERE pn.id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
    `);
    for (const row of Array.from(rows)) latestByNodeId.set(row.node_id, row);
  }

  return new Map(files.flatMap((node) => {
    const latest = latestByNodeId.get(node.id);
    if (!latest) return [];
    const effectiveUserId = latest.uploaded_by ?? latest.created_by;
    if (!effectiveUserId && !latest.external_name) return [];
    return [[node.id, {
      updatedById: effectiveUserId,
      updatedByName: latest.full_name || (latest.external_name ? `${latest.external_name} (GitHub)` : null),
      updatedByUsername: latest.username,
      updatedByAvatarUrl: latest.avatar_url,
      versionUpdatedAt: latest.uploaded_at ?? node.updatedAt,
    } satisfies FileAttribution] as const];
  }));
}
