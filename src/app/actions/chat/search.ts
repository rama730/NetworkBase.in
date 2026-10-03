"use server";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatFailure, invalidInput, isUuid, requireChatUser, unauthorized } from "@/lib/messaging/server";
import type { ChatPerson } from "@/lib/messaging/types";

export type SearchHit = {
  channel_id: string;
  channel_name: string | null;
  channel_kind: string;
  seq: number;
  thread_root_seq: number | null;
  body: string;
  created_at: string;
  has_file: boolean;
  author: ChatPerson | null;
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
};

const date = (value: unknown) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null);

// ponytail: Postgres full-text ('simple' config, every language alike) over the
// viewer's conversations, newest first, 50 hits, capped at 3 s so a very common
// word can't hold a pool connection (LOAD-06). ceiling: no ranking or stemming.
// upgrade: a search service when result quality or volume needs it.
const SEARCH_TIMEOUT = "3s";
/** Message search across every conversation you're in (in:, from:, has:file, date range). */
export async function searchMessages(input: SearchInput) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  const query = typeof input?.query === "string" ? input.query.trim().slice(0, 200) : "";
  if (query.length < 2 && !input.authorId && !input.hasFile) return { success: false as const, error: "chat_search_too_short" };
  if ((input.channelId && !isUuid(input.channelId)) || (input.authorId && !isUuid(input.authorId))) return invalidInput;
  const after = date(input.after);
  const before = date(input.before);
  try {
    const query_ = sql`
      SELECT m.channel_id, c.name AS channel_name, c.kind AS channel_kind, m.channel_seq::int AS seq,
             m.thread_root_seq::int AS thread_root_seq, m.body, m.created_at,
             EXISTS (SELECT 1 FROM chat_attachments a WHERE a.channel_id = m.channel_id AND a.message_seq = m.channel_seq) AS has_file,
             CASE WHEN pr.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', pr.id, 'username', pr.username, 'full_name', pr.full_name, 'avatar_url', pr.avatar_url
             ) END AS author
      FROM chat_channel_members mem
      JOIN chat_channels c ON c.id = mem.channel_id
      JOIN chat_messages m ON m.channel_id = mem.channel_id
      LEFT JOIN profiles pr ON pr.id = m.author_id
      WHERE mem.user_id = ${user.id}::uuid
        AND m.kind = 'user' AND m.deleted_at IS NULL
        AND (${query.length >= 2} = false OR to_tsvector('simple', m.body) @@ websearch_to_tsquery('simple', ${query}))
        AND (${input.channelId ?? null}::uuid IS NULL OR m.channel_id = ${input.channelId ?? null}::uuid)
        AND (${input.authorId ?? null}::uuid IS NULL OR m.author_id = ${input.authorId ?? null}::uuid)
        AND (${Boolean(input.hasFile)} = false OR EXISTS (
          SELECT 1 FROM chat_attachments a WHERE a.channel_id = m.channel_id AND a.message_seq = m.channel_seq
        ))
        AND (${after}::timestamptz IS NULL OR m.created_at >= ${after}::timestamptz)
        AND (${before}::timestamptz IS NULL OR m.created_at < ${before}::timestamptz)
      ORDER BY m.created_at DESC
      LIMIT 50
    `;
    const hits = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${SEARCH_TIMEOUT}'`));
      return (await tx.execute(query_)) as unknown as SearchHit[];
    });
    return { success: true as const, hits };
  } catch (error) {
    const code = ((error as { cause?: { code?: string } })?.cause ?? (error as { code?: string }))?.code;
    if (code === "57014") return { success: false as const, error: "chat_search_too_broad" };
    return chatFailure(error, "search");
  }
}
