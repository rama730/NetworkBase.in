import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { extensionRecoveryDrafts, extensionRecoverySessions } from "@/lib/db/schema";

export async function resolveRecoverySessionsWithoutDrafts(userId: string, sessionIds: string[]) {
  const uniqueSessionIds = Array.from(new Set(sessionIds.filter(Boolean))).slice(0, 200);
  if (uniqueSessionIds.length === 0) return 0;
  const now = new Date();
  const updated = await db.update(extensionRecoverySessions).set({
    status: "resolved",
    resolvedAt: now,
    updatedAt: now,
  }).where(and(
    eq(extensionRecoverySessions.userId, userId),
    inArray(extensionRecoverySessions.sessionId, uniqueSessionIds),
    eq(extensionRecoverySessions.status, "interrupted"),
    sql`NOT EXISTS (
      SELECT 1 FROM ${extensionRecoveryDrafts}
      WHERE ${extensionRecoveryDrafts.userId} = ${userId}
        AND ${extensionRecoveryDrafts.sessionId} = ${extensionRecoverySessions.sessionId}
        AND ${extensionRecoveryDrafts.status} = 'finalized'
    )`,
  )).returning({ sessionId: extensionRecoverySessions.sessionId });
  return updated.length;
}

export async function purgeOrphanedExtensionRecoverySessions(limit = 500): Promise<number> {
  const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
  const result = await db.execute<{ sessionId: string }>(sql`
    WITH candidates AS (
      SELECT sessions.session_id
      FROM extension_recovery_sessions sessions
      WHERE sessions.updated_at < NOW() - INTERVAL '90 days'
        AND NOT EXISTS (
          SELECT 1
          FROM extension_recovery_drafts drafts
          WHERE drafts.user_id = sessions.user_id
            AND drafts.session_id = sessions.session_id
        )
      ORDER BY sessions.updated_at ASC
      LIMIT ${safeLimit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM extension_recovery_sessions sessions
    USING candidates
    WHERE sessions.session_id = candidates.session_id
    RETURNING sessions.session_id AS "sessionId"
  `);
  return Array.from(result).length;
}
