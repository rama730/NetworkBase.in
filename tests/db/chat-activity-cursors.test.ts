import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishChannel: () => undefined });

let activity: typeof import("../../src/app/actions/chat/activity");
before(async () => {
  activity = await loadAppModule(() => import("../../src/app/actions/chat/activity"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function conversation(count: number) {
  const a = await sql.begin((tx) => createUser(tx));
  const b = await sql.begin((tx) => createUser(tx));
  await sql`UPDATE profiles SET message_privacy = 'everyone' WHERE id = ANY(${[a, b]}::uuid[])`;
  const [{ id: channelId }] = await sql`SELECT app_private.chat_get_or_create_dm(${a}::uuid, ${b}::uuid, 'invite') AS id`;
  const seqs: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const [row] = await sql`SELECT (app_private.chat_send_message(${channelId}::uuid, ${index % 2 ? b : a}::uuid, ${`m${index}`}, ${`c${index}-${a}`})->>'channel_seq')::int AS seq`;
    seqs.push(row!.seq as number);
  }
  const cleanup = async () => {
    await sql`DELETE FROM chat_channels WHERE id = ${channelId}`;
    await sql`DELETE FROM profiles WHERE id = ANY(${[a, b]}::uuid[])`;
  };
  return { a, b, channelId: channelId as string, seqs, cleanup };
}

/** Walks every page with the given page size, returning the ids of all rows seen. */
async function walk<T extends { cursor: string }>(read: (cursor: string | null) => Promise<T[]>, key: (row: T) => string) {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const rows = await read(cursor);
    seen.push(...rows.map(key));
    if (rows.length === 0 || rows.length < 2) break;
    cursor = rows.at(-1)!.cursor;
  }
  return seen;
}

// COR-056: rows that share a timestamp must each appear exactly once across pages.
test("reactions with identical timestamps page without gaps or repeats", async () => {
  const f = await conversation(1);
  try {
    // A's message (seq of the first, authored by a); six people-reactions at one instant by b with distinct emoji.
    for (const emoji of ["👍", "🎉", "❤️", "👀", "🙏", "🔥"]) {
      await sql`INSERT INTO chat_reactions (channel_id, message_seq, user_id, emoji, created_at) VALUES (${f.channelId}, ${f.seqs[0]!}, ${f.b}, ${emoji}, '2026-01-01T00:00:00.123456Z')`;
    }
    viewerId = f.a;
    const seen = await walk(async (cursor) => {
      const result = await activity.listInbox({ filter: "reactions", cursor, limit: 2 });
      assert.equal(result.success, true, JSON.stringify(result));
      return result.success ? result.items : [];
    }, (row) => `${row.seq}:${row.emoji}`);
    assert.equal(seen.length, 6);
    assert.equal(new Set(seen).size, 6, "no repeats");
  } finally { await f.cleanup(); }
});

test("mentions with identical timestamps page without gaps or repeats, and the All feed agrees", async () => {
  const f = await conversation(5);
  try {
    for (const seq of f.seqs) {
      await sql`INSERT INTO chat_mentions (user_id, channel_id, message_seq, kind, created_at) VALUES (${f.a}, ${f.channelId}, ${seq}, 'user', '2026-01-01T00:00:00.5Z')`;
    }
    viewerId = f.a;
    for (const filter of ["mentions", "all"] as const) {
      const seen = await walk(async (cursor) => {
        const result = await activity.listInbox({ filter, cursor, limit: 2 });
        assert.equal(result.success, true, JSON.stringify(result));
        return result.success ? result.items : [];
      }, (row) => `${row.kind}:${row.seq}`);
      assert.equal(new Set(seen).size, seen.length, `${filter}: no repeats`);
      assert.equal(seen.filter((id) => id.startsWith("user:")).length, 5, `${filter}: every mention once`);
    }
  } finally { await f.cleanup(); }
});

test("followed threads page by (last reply, channel, root) and include never-replied threads", async () => {
  const f = await conversation(5);
  try {
    for (const [index, seq] of f.seqs.entries()) {
      await sql`INSERT INTO chat_thread_follows (user_id, channel_id, root_seq) VALUES (${f.a}, ${f.channelId}, ${seq})`;
      if (index < 3) await sql`UPDATE chat_messages SET last_reply_at = '2026-01-01T00:00:00.25Z', last_reply_seq = ${seq + 100}, reply_count = 1 WHERE channel_id = ${f.channelId} AND channel_seq = ${seq}`;
    }
    viewerId = f.a;
    const seen = await walk(async (cursor) => {
      const result = await activity.listThreads({ cursor, limit: 2 });
      assert.equal(result.success, true, JSON.stringify(result));
      return result.success ? result.threads : [];
    }, (row) => String(row.root_seq));
    assert.equal(seen.length, 5, "three replied and two never-replied, each once");
    assert.equal(new Set(seen).size, 5);
    // Never-replied threads come last.
    assert.deepEqual(new Set(seen.slice(3)), new Set(f.seqs.slice(3).map(String)));
  } finally { await f.cleanup(); }
});

test("a cursor from another feed or a malformed one is rejected", async () => {
  const f = await conversation(1);
  try {
    viewerId = f.a;
    const threadCursor = JSON.stringify(["2026-01-01T00:00:00.000000Z", f.channelId, 1, 0, "", "threads"]);
    assert.equal((await activity.listInbox({ filter: "mentions", cursor: threadCursor })).success, false);
    assert.equal((await activity.listInbox({ filter: "all", cursor: "not json" })).success, false);
    assert.equal((await activity.listThreads({ cursor: JSON.stringify([1, 2, 3]) })).success, false);
  } finally { await f.cleanup(); }
});
