import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Messages mix (0148–0150 and the Phase 12 reads), run against a real database: poll voters leave out anyone
// blocked, thread faces keep every replier, "Seen" follows read receipts and blocks, the Message gate and
// deleted-account lookups answer what the screens ask.
let viewerId = "";
const fakeRedis = { get: async () => null, set: async () => "OK", del: async () => 1, eval: async () => 1 };
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishUserEvents: () => undefined, publishChannel: () => undefined, publishSentMessage: () => undefined });
moduleStubs.set("@/lib/messaging/send-bucket", { takeSendToken: () => true, takeReactToken: () => true });
moduleStubs.set("@/lib/redis", { getRedisClient: () => fakeRedis, rateLimit: async () => true, redis: fakeRedis });

let messages: typeof import("../../src/app/actions/chat/messages");
let members: typeof import("../../src/app/actions/chat/members");
let channels: typeof import("../../src/app/actions/chat/channels");
let read: typeof import("../../src/app/actions/chat/read");
before(async () => {
  messages = await loadAppModule(() => import("../../src/app/actions/chat/messages"));
  members = await loadAppModule(() => import("../../src/app/actions/chat/members"));
  channels = await loadAppModule(() => import("../../src/app/actions/chat/channels"));
  read = await loadAppModule(() => import("../../src/app/actions/chat/read"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function people(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await sql.begin((tx) => createUser(tx)));
  await sql`UPDATE profiles SET message_privacy = 'everyone' WHERE id = ANY(${ids}::uuid[])`;
  return ids;
}
const as = (id: string) => { viewerId = id; };
async function send(channelId: string, body: string, threadRootSeq: number | null = null) {
  const result = await messages.sendMessage({ channelId, body, threadRootSeq, clientId: randomUUID() });
  assert.equal(result.success, true, JSON.stringify(result));
  return (result as { message: { seq: number } }).message.seq;
}

test("poll voters leave out anyone blocked either way; thread faces keep every replier", async () => {
  const [a, b, c] = await people(3);
  as(a!);
  const group = await members.createGroup({ userIds: [b!, c!] });
  assert.equal(group.success, true, JSON.stringify(group));
  const channelId = (group as { channelId: string }).channelId;
  const poll = await send(channelId, "📊 **Poll: Where?**\n\n1️⃣ Studio\n2️⃣ Library\n\n*Vote by clicking a number below.*");
  as(b!); assert.equal((await messages.react({ channelId, seq: poll, emoji: "1️⃣", on: true })).success, true);
  as(c!); assert.equal((await messages.react({ channelId, seq: poll, emoji: "1️⃣", on: true })).success, true);
  as(b!); await send(channelId, "first", poll);
  as(c!); await send(channelId, "second", poll);
  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${c!}, ${a!})`;

  as(a!);
  const listed = await messages.listMessages({ channelId });
  assert.equal(listed.success, true, JSON.stringify(listed));
  const root = (listed as { messages: Array<{ seq: number; reactions: Array<{ emoji: string; count: number; user_ids?: string[] }>; last_repliers?: string[] }> }).messages.find((m) => m.seq === poll)!;
  const one = root.reactions.find((r) => r.emoji === "1️⃣")!;
  assert.equal(one.count, 2);
  assert.deepEqual(one.user_ids, [b], "c blocked a: c's vote counts, c's id never comes back");
  assert.deepEqual(root.last_repliers, [c, b], "every replier, newest first: leaving c out would hint at the block");
});

test("Seen: a 1:1 DM only, while the reader keeps receipts on, never across a block, and never late", async () => {
  const [a, b] = await people(2);
  as(a!);
  const dm = await members.getOrCreateDm({ userId: b! });
  assert.equal(dm.success, true, JSON.stringify(dm));
  const channelId = (dm as { channelId: string }).channelId;
  const peerSeen = async () => {
    as(a!);
    const result = await channels.getChannel({ channelId });
    assert.equal(result.success, true, JSON.stringify(result));
    return (result as { channel: { peer_seen?: { seq: number } | null } }).channel.peer_seen ?? null;
  };

  const first = await send(channelId, "one");
  as(b!); assert.equal((await read.markRead({ channelId, seq: first })).success, true);
  assert.equal((await peerSeen())?.seq, first);

  // Receipts off: the read moves, but never becomes "seen" — not even after turning them back on.
  await sql`UPDATE profiles SET read_receipts = false WHERE id = ${b!}`;
  as(a!); const second = await send(channelId, "two");
  as(b!); await read.markRead({ channelId, seq: second });
  assert.equal(await peerSeen(), null, "either side off: nothing to show");
  await sql`UPDATE profiles SET read_receipts = true WHERE id = ${b!}`;
  assert.equal((await peerSeen())?.seq, first, "the read made while off stays unseen");

  // A read during a block never surfaces after the unblock.
  as(a!); const third = await send(channelId, "three");
  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${b!}, ${a!})`;
  as(b!); await read.markRead({ channelId, seq: third });
  assert.equal(await peerSeen(), null, "blocked: nothing to show");
  await sql`DELETE FROM user_blocks WHERE blocker_id = ${b!} AND blocked_id = ${a!}`;
  assert.equal((await peerSeen())?.seq, first);
});

test("Seen never applies to a group", async () => {
  const [a, b, c] = await people(3);
  as(a!);
  const channelId = ((await members.createGroup({ userIds: [b!, c!] })) as { channelId: string }).channelId;
  const seq = await send(channelId, "hi");
  as(b!); await read.markRead({ channelId, seq });
  const [row] = await sql`SELECT seen_seq FROM chat_channel_members WHERE channel_id = ${channelId} AND user_id = ${b!}`;
  assert.equal(row!.seen_seq, null);
});

test("canMessageMany: privacy gives the connections reason; a block, a deleted or missing account give none", async () => {
  const [a, open, closed, blocker, gone] = await people(5);
  await sql`UPDATE profiles SET message_privacy = 'connections' WHERE id = ANY(${[closed!, gone!]}::uuid[])`;
  await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${gone!}`;
  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${blocker!}, ${a!})`;
  const missing = randomUUID();
  as(a!);
  const result = await members.canMessageMany({ userIds: [open!, closed!, blocker!, gone!, missing] });
  assert.equal(result.success, true, JSON.stringify(result));
  const gates = (result as { gates: Record<string, { canMessage: boolean; reason: string | null }> }).gates;
  assert.deepEqual(gates[open!], { canMessage: true, reason: null });
  assert.deepEqual(gates[closed!], { canMessage: false, reason: "connections" });
  assert.deepEqual(gates[blocker!], { canMessage: false, reason: null });
  assert.deepEqual(gates[gone!], { canMessage: false, reason: null });
  assert.deepEqual(gates[missing], { canMessage: false, reason: null });
});

test("findDeletedPeople: members of the conversation learn which mentioned ids are deleted accounts", async () => {
  const [a, b, c] = await people(3);
  as(a!);
  const channelId = ((await members.getOrCreateDm({ userId: b! })) as { channelId: string }).channelId;
  await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${c!}`;
  const missing = randomUUID();
  const result = await channels.findDeletedPeople({ channelId, userIds: [b!, c!, missing] });
  assert.deepEqual(new Set((result as { deleted: string[] }).deleted), new Set([c, missing]));
  as(c!);
  const outsider = await channels.findDeletedPeople({ channelId, userIds: [missing] });
  assert.deepEqual((outsider as { deleted: string[] }).deleted, [], "not a member: nothing");
});

test("listFiles: the Photos filter and the (seq, idx) cursor run", async () => {
  const [a, b] = await people(2);
  as(a!);
  const channelId = ((await members.getOrCreateDm({ userId: b! })) as { channelId: string }).channelId;
  await send(channelId, "no files yet");
  const first = await messages.listFiles({ channelId, kind: "media" });
  assert.equal(first.success, true, JSON.stringify(first));
  const paged = await messages.listFiles({ channelId, kind: "media", before: { seq: 5, idx: 0 } });
  assert.equal(paged.success, true, JSON.stringify(paged));
  assert.deepEqual((paged as { files: unknown[]; next: unknown }).files, []);
});
