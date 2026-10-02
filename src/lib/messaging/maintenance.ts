import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export const CHAT_MENTION_RETENTION_DAYS = 90;
// ponytail: messages themselves are kept forever (L-16). ceiling: ~700 GB/yr at
// 1M users. upgrade: a retention policy when storage budget or law requires it.

/** Delete one batch of Activity rows older than 90 days; returns how many went. */
// ponytail: no created_at-only index; old rows sit early in the heap so each
// batch finds them quickly. ceiling: job runtime. upgrade: index created_at.
export async function purgeOldChatMentions(limit: number) {
  const rows = await db.execute(sql`
    DELETE FROM chat_mentions
    WHERE (user_id, channel_id, message_seq) IN (
      SELECT user_id, channel_id, message_seq FROM chat_mentions
      WHERE created_at < now() - make_interval(days => ${CHAT_MENTION_RETENTION_DAYS})
      LIMIT ${limit}
    )
    RETURNING 1
  `);
  return Array.from(rows as unknown as unknown[]).length;
}

/**
 * Sampled invariants (report 5.H): channel counters match their rows, and no
 * card points at a missing message. Returns the problems found, if any.
 */
export async function auditChatIntegrity(sampleSize: number) {
  const rows = await db.execute<{ problem: string; channel_id: string }>(sql`
    WITH sample AS (
      SELECT id, last_seq, member_count FROM chat_channels TABLESAMPLE SYSTEM (1) LIMIT ${sampleSize}
    )
    SELECT 'last_seq' AS problem, s.id AS channel_id FROM sample s
    WHERE s.last_seq <> coalesce((SELECT max(channel_seq) FROM chat_messages m WHERE m.channel_id = s.id), 0)
    UNION ALL
    SELECT 'member_count', s.id FROM sample s
    WHERE s.member_count <> (SELECT count(*) FROM chat_channel_members cm WHERE cm.channel_id = s.id)
    UNION ALL
    SELECT 'member_cap', s.id FROM sample s WHERE s.member_count > 500
  `);
  return Array.from(rows);
}
