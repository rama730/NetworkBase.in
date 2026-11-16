import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * 0.8 #14: a push that failed after making a new file entry takes the entry back, so the Files tab never shows an
 * empty file nobody saved. Only entries the same person made since `madeSince` (the failed push or upload, give or
 * take 10 minutes for long batches and clock drift) that are still empty (no saved version, no content, size 0) and that no other upload is still writing; under the
 * lock that making an entry takes, so a push finding the entry at that moment can't lose it (security review).
 * An empty file someone made in the app is never touched.
 */
export async function discardUnsavedFileNodes(nodeIds: Array<string | null | undefined>, madeSince: Date, by: { userId: string; exceptIntentId?: string | null }) {
  const ids = [...new Set(nodeIds)].filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return 0;
  const list = `{${ids.join(",")}}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtext('ext-create-node:' || w.workspace_id::text))
      FROM (SELECT DISTINCT workspace_id FROM workspace_nodes WHERE id = ANY(${list}::uuid[]) ORDER BY workspace_id) w
    `);
    const rows = await tx.execute<{ id: string }>(sql`
      DELETE FROM workspace_nodes n
      WHERE n.id = ANY(${list}::uuid[]) AND n.type = 'file' AND coalesce(n.size, 0) = 0 AND n.asset_id IS NULL
        AND n.created_by = ${by.userId}::uuid
        AND n.created_at >= ${madeSince.toISOString()}::timestamptz - interval '10 minutes'
        AND NOT EXISTS (SELECT 1 FROM file_versions v WHERE v.node_id = n.id)
        AND NOT EXISTS (
          SELECT 1 FROM upload_intents i
          WHERE i.metadata ->> 'nodeId' = n.id::text AND i.status = 'pending' AND i.expires_at > now()
            ${by.exceptIntentId ? sql`AND i.id <> ${by.exceptIntentId}::uuid` : sql``}
        )
      RETURNING n.id
    `);
    return rows.length;
  }).catch((error: unknown) => {
    // Best effort (the push already failed), but never silent.
    logger.warn("files.discard_unsaved_failed", { module: "files", count: ids.length, error: error instanceof Error ? error.message : String(error) });
    return 0;
  });
}

/** The node an extension upload intent was for, when that upload failed or expired (0.8 #14). */
export async function discardIntentNode(intentId: string) {
  const [row] = await db.execute<{ node_id: string | null; user_id: string; created_at: string }>(sql`
    SELECT metadata ->> 'nodeId' AS node_id, user_id, created_at FROM upload_intents WHERE id = ${intentId}::uuid
  `).catch(() => []);
  return row?.node_id ? discardUnsavedFileNodes([row.node_id], new Date(row.created_at), { userId: row.user_id, exceptIntentId: intentId }) : 0;
}
