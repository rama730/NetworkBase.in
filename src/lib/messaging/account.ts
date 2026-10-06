import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

const ANONYMIZE_BATCH = 5_000;

/**
 * Account deletion (report 7.9): the user's messages stay in shared channels
 * without an author, in batches so a heavy author never holds one long lock.
 * DMs are deleted outright by the caller.
 */
// ponytail: runs inline in the account cleanup job. ceiling: ~10⁶ messages per
// user within the job timeout. upgrade: a dedicated chat-account-anonymize job.
export async function anonymizeChatAuthor(userId: string, executor: Pick<typeof db, "execute"> = db) {
  for (;;) {
    const rows = await executor.execute(sql`
      WITH batch AS (
        SELECT channel_id, channel_seq FROM chat_messages WHERE author_id = ${userId}::uuid LIMIT ${ANONYMIZE_BATCH}
      )
      UPDATE chat_messages m SET author_id = NULL
      FROM batch b WHERE m.channel_id = b.channel_id AND m.channel_seq = b.channel_seq
      RETURNING 1
    `);
    if (Array.from(rows as unknown as unknown[]).length < ANONYMIZE_BATCH) return;
  }
}

/** The user's DMs (both sides' copies are one channel) go with the account. */
export function deleteDirectMessagesSql(userId: string) {
  return sql`
    DELETE FROM chat_channels c
    USING chat_channel_members m
    WHERE m.channel_id = c.id AND m.user_id = ${userId}::uuid AND c.kind = 'dm'
  `;
}
