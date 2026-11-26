import "server-only";

import { sql } from "drizzle-orm";

import { isDirectLike } from "@/lib/messaging/channel-view";
import { chatRows, jsonParam, uuidArray } from "@/lib/messaging/server";
import { previewIds, previewText } from "@/lib/messaging/tokens";
import type { ChatChannelSummary } from "@/lib/messaging/types";

/** Names for the people and channels some bodies mention, looked up in one round trip. */
export async function previewNames(bodies: string[]) {
  const users = new Set<string>();
  const channels = new Set<string>();
  for (const body of bodies) {
    const ids = previewIds(body);
    ids.users.forEach((id) => users.add(id));
    ids.channels.forEach((id) => channels.add(id));
  }
  const [people, rooms] = await Promise.all([
    users.size ? chatRows<{ id: string; name: string | null }>(sql`
      SELECT id, coalesce(nullif(full_name, ''), username) AS name FROM profiles WHERE id = ANY(${uuidArray([...users])}) AND deleted_at IS NULL
    `) : [],
    channels.size ? chatRows<{ id: string; name: string | null }>(sql`SELECT id, name FROM chat_channels WHERE id = ANY(${uuidArray([...channels])})`) : [],
  ]);
  const names = new Map(people.map((p) => [p.id, p.name ?? undefined]));
  const roomNames = new Map(rooms.map((r) => [r.id, r.name ?? undefined]));
  return { nameOf: (id: string) => names.get(id), channelNameOf: (id: string) => roomNames.get(id) };
}

/** Row previews say "@Ann" and "#design", never their stored codes (`<@id>`, `<#id>`, `<!here>`). */
export async function withReadablePreviews<T extends Pick<ChatChannelSummary, "last_preview">>(channels: T[]): Promise<T[]> {
  const raw = channels.map((c) => c.last_preview).filter((p): p is string => Boolean(p));
  if (!raw.length) return channels;
  const { nameOf, channelNameOf } = await previewNames(raw);
  return channels.map((c) => (c.last_preview ? { ...c, last_preview: previewText(c.last_preview, nameOf, channelNameOf) } : c));
}

/**
 * DMs, groups and applications show how many messages wait after your read point: top-level messages that still
 * exist, not a seq difference (deleted ones and thread replies don't count; application status lines do). Sending
 * moves your read point, so your own messages only count after "Mark unread" from an earlier one, as marked.
 */
export async function withUnreadCounts(channels: ChatChannelSummary[]): Promise<ChatChannelSummary[]> {
  const unread = channels.filter((c) => (isDirectLike(c) || c.application_id) && c.last_top_seq > c.last_read_seq);
  if (!unread.length) return channels;
  const rows = await chatRows<{ channel_id: string; n: number }>(sql`
    SELECT m.channel_id, count(*)::int AS n
    FROM jsonb_to_recordset(${jsonParam(unread.map((c) => ({ channel_id: c.id, read_seq: c.last_read_seq, app: Boolean(c.application_id) })))})
      AS r(channel_id uuid, read_seq bigint, app boolean)
    JOIN chat_messages m ON m.channel_id = r.channel_id AND m.channel_seq > r.read_seq
    WHERE m.thread_root_seq IS NULL AND m.deleted_at IS NULL
      AND (m.kind = 'user' OR (r.app AND m.kind = 'system'))
    GROUP BY m.channel_id
  `);
  const counts = new Map(rows.map((r) => [r.channel_id, Number(r.n)]));
  const ids = new Set(unread.map((c) => c.id));
  return channels.map((c) => (ids.has(c.id) ? { ...c, unread_count: counts.get(c.id) ?? 0 } : c));
}
