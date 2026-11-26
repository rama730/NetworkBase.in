import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { ChatPerson } from "@/lib/messaging/types";

export type SearchHit = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  project_title: string | null;
  seq: number;
  thread_root_seq: number | null;
  body: string;
  created_at: string;
  has_file: boolean;
  author: ChatPerson | null;
  /** The other people's names, for a conversation without a name. */
  people_name?: string | null;
};

export type SearchInput = {
  query: string;
  /** in: one conversation */
  channelId?: string | null;
  /** from: one person */
  authorId?: string | null;
  hasFile?: boolean;
  after?: string | null;
  before?: string | null;
  /** "Load more": hits older than this created_at (separate from the user's Before filter). */
  cursor?: string | null;
  /** Page size, at most CHAT_LIST_PAGE (tests use a small one). */
  limit?: number;
};

// ponytail: Postgres full-text ('simple' config, every language alike) over the
// viewer's conversations, newest first, 50 hits a page ("Load more"), capped at 3 s so a very common
// word can't hold a pool connection (LOAD-06). ceiling: no ranking or stemming.
// upgrade: a search service when result quality or volume needs it.
const SEARCH_TIMEOUT = "3s";
/**
 * The query behind `searchMessages`, for a viewer already known (the action, global search). Only conversations the
 * viewer is in. Inputs are already checked: query trimmed, ids are uuids, dates ISO, limit in range.
 */
export async function searchMessagesAs(userId: string, input: SearchInput & { limit: number }): Promise<SearchHit[]> {
  const query = input.query;
  const after = input.after ?? null;
  const before = input.before ?? null;
  const cursor = input.cursor ?? null;
  const limit = input.limit;
  const query_ = sql`
      SELECT m.channel_id, c.name AS channel_name, c.kind AS channel_kind, p.title AS project_title, m.channel_seq::int AS seq,
             m.thread_root_seq::int AS thread_root_seq, m.body, m.created_at,
             EXISTS (SELECT 1 FROM chat_attachments a WHERE a.channel_id = m.channel_id AND a.message_seq = m.channel_seq) AS has_file,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author,
             -- A conversation without a name (a direct or group message) is named by the other people in it.
             CASE WHEN c.name IS NULL THEN (
               SELECT string_agg(coalesce(op.full_name, op.username), ', ') FROM (
                 SELECT o.user_id FROM chat_channel_members o WHERE o.channel_id = c.id AND o.user_id <> ${userId}::uuid LIMIT 3
               ) others JOIN profiles op ON op.id = others.user_id
             ) END AS people_name
      FROM chat_channel_members mem
      JOIN chat_channels c ON c.id = mem.channel_id
      LEFT JOIN workspaces p ON p.id = c.workspace_id
      JOIN chat_messages m ON m.channel_id = mem.channel_id
      LEFT JOIN profiles pr ON pr.id = m.author_id
      WHERE mem.user_id = ${userId}::uuid
        -- Decision lines (and their notes) in an application thread are findable too.
        AND (m.kind = 'user' OR (m.kind = 'system' AND c.application_id IS NOT NULL)) AND m.deleted_at IS NULL
        AND (${query.length >= 2} = false OR to_tsvector('simple', m.body) @@ websearch_to_tsquery('simple', ${query}))
        AND (${input.channelId ?? null}::uuid IS NULL OR m.channel_id = ${input.channelId ?? null}::uuid)
        AND (${input.authorId ?? null}::uuid IS NULL OR m.author_id = ${input.authorId ?? null}::uuid)
        AND (${Boolean(input.hasFile)} = false OR EXISTS (
          SELECT 1 FROM chat_attachments a WHERE a.channel_id = m.channel_id AND a.message_seq = m.channel_seq
        ))
        AND (${after}::timestamptz IS NULL OR m.created_at >= ${after}::timestamptz)
        AND (${before}::timestamptz IS NULL OR m.created_at < ${before}::timestamptz)
        AND (${cursor}::timestamptz IS NULL OR m.created_at < ${cursor}::timestamptz)
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `;
  return await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${SEARCH_TIMEOUT}'`));
    return (await tx.execute(query_)) as unknown as SearchHit[];
  });
}
