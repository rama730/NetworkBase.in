import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * 0.8 #14: a push that failed after making a new file entry takes the entry back, so the Files tab never shows an
 * empty file nobody saved. Only entries made at or after `madeSince` (the failed push or upload) that are still
 * empty: no saved version, no content, size 0. An empty file someone made in the app is never touched.
 */
export async function discardUnsavedFileNodes(nodeIds: Array<string | null | undefined>, madeSince: Date) {
  const ids = [...new Set(nodeIds)].filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return 0;
  const rows = await db.execute<{ id: string }>(sql`
    DELETE FROM workspace_nodes n
    WHERE n.id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND n.type = 'file' AND coalesce(n.size, 0) = 0 AND n.asset_id IS NULL
      AND n.created_at >= ${madeSince.toISOString()}::timestamptz - interval '5 seconds'
      AND NOT EXISTS (SELECT 1 FROM file_versions v WHERE v.node_id = n.id)
    RETURNING n.id
  `).catch(() => []);
  return rows.length;
}

/** The node an extension upload intent was for, when that upload failed or expired (0.8 #14). */
export async function discardIntentNode(intentId: string) {
  const [row] = await db.execute<{ node_id: string | null; created_at: string }>(sql`
    SELECT metadata ->> 'nodeId' AS node_id, created_at FROM upload_intents WHERE id = ${intentId}::uuid
  `).catch(() => []);
  return row?.node_id ? discardUnsavedFileNodes([row.node_id], new Date(row.created_at)) : 0;
}
