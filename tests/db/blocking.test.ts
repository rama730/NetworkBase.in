import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Blocking end to end (Trust & Safety report, Blocking tab): one row per direction, one rule, the database refuses
// every interaction across a block, Undo puts back what the block removed, notifications never cross it.

moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async () => true });

let blocks: typeof import("../../src/lib/privacy/blocks");
let resolver: typeof import("../../src/lib/privacy/resolver");
let notifications: typeof import("../../src/lib/notifications/service");
before(async () => {
  blocks = await loadAppModule(() => import("../../src/lib/privacy/blocks"));
  resolver = await loadAppModule(() => import("../../src/lib/privacy/resolver"));
  notifications = await loadAppModule(() => import("../../src/lib/notifications/service"));
});
const made: string[] = [];
const people: string[] = [];
after(async () => {
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  if (people.length) await sql`DELETE FROM profiles WHERE id IN ${sql(people)}`;
  await sql.end();
  await closeAppDb();
});

const request = () => new Request("https://networkbase.in/test");
async function pair() {
  const [a, b] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx)]);
  people.push(a!, b!);
  await sql`UPDATE profiles SET message_privacy = 'everyone' WHERE id IN (${a}, ${b})`;
  return { a: a!, b: b! };
}
const block = (blocker: string, blocked: string) => blocks.setUserBlocked({ blockerId: blocker, targetUserId: blocked, blocked: true, request: request() });
const unblock = (blocker: string, blocked: string) => blocks.setUserBlocked({ blockerId: blocker, targetUserId: blocked, blocked: false, request: request() });
const refused = (promise: Promise<unknown>, code = /not_available|chat_blocked/) => assert.rejects(promise, (error: Error) => code.test(error.message));

test("each person's block is their own: a mutual block survives one side unblocking (B1, K4)", async () => {
  const { a, b } = await pair();
  await block(a, b);
  await block(b, a);
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_blocks WHERE (blocker_id, blocked_id) IN ((${a}, ${b}), (${b}, ${a}))`)[0]!.n, 2);
  await unblock(a, b);
  assert.equal(await blocks.isBlockedBetween(a, b), true, "b's block still stands");
  const rel = await resolver.resolvePrivacyRelationship(a, b);
  assert.equal(rel?.blockedByTarget, true);
  assert.equal(rel?.blockedByViewer, false);
  await unblock(b, a);
  assert.equal(await blocks.isBlockedBetween(a, b), false);
});

test("a block removes the connection and follows; Undo within the window puts them back (B3, B19, B39)", async () => {
  const { a, b } = await pair();
  await sql`INSERT INTO connections (requester_id, addressee_id, status, accepted_at) VALUES (${a}, ${b}, 'accepted', now())`;
  const ws = await sql.begin((tx) => createProject(tx, b));
  made.push(ws);
  await sql`INSERT INTO workspace_follows (workspace_id, user_id) VALUES (${ws}, ${a})`;
  await block(a, b);
  assert.equal((await sql`SELECT count(*)::int AS n FROM connections WHERE (requester_id, addressee_id) IN ((${a}, ${b}), (${b}, ${a}))`)[0]!.n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_follows WHERE workspace_id = ${ws} AND user_id = ${a}`)[0]!.n, 0);
  assert.equal(await blocks.undoUserBlock(a, b), true);
  assert.equal((await sql`SELECT status FROM connections WHERE requester_id = ${a} AND addressee_id = ${b}`)[0]?.status, "accepted");
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_follows WHERE workspace_id = ${ws} AND user_id = ${a}`)[0]!.n, 1);
  assert.equal(await blocks.isBlockedBetween(a, b), false);
});

test("the database refuses likes, comments, follows, connections and joining a personal workspace across a block (B9, B29, B36)", async () => {
  const { a, b } = await pair();
  const ws = await sql.begin((tx) => createProject(tx, b));
  made.push(ws);
  const [post] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ws}, ${b}, 'hello') RETURNING id`;
  await block(b, a);
  await refused(sql`INSERT INTO workspace_update_likes (update_id, user_id) VALUES (${post!.id}, ${a})`);
  await refused(sql`INSERT INTO workspace_update_comments (update_id, workspace_id, user_id, content) VALUES (${post!.id}, ${ws}, ${a}, 'hi')`);
  await refused(sql`INSERT INTO workspace_follows (workspace_id, user_id) VALUES (${ws}, ${a})`);
  await refused(sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${a}, ${b}, 'pending')`);
  await refused(sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${a}, 'member')`);
  // An organization is an institution: a personal block never keeps anyone out (B45, D6).
  const org = await sql.begin((tx) => createProject(tx, b));
  made.push(org);
  await sql`UPDATE workspaces SET kind = 'organization' WHERE id = ${org}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${a}, 'member')`;
});

test("a DM across a block takes no messages, edits, reactions or canvas changes; typing is refused (B15, B32, K12, K13, K29, K38)", async () => {
  const { a, b } = await pair();
  const [{ id: channel }] = await sql`SELECT app_private.chat_get_or_create_dm(${a}::uuid, ${b}::uuid, 'invite') AS id`;
  const [{ seq }] = await sql`SELECT (app_private.chat_send_message(${channel}::uuid, ${a}::uuid, 'hello', ${`c-${a}`})->>'channel_seq')::int AS seq`;
  await block(b, a);
  await refused(sql`SELECT app_private.chat_send_message(${channel}::uuid, ${a}::uuid, 'again', ${`c2-${a}`})`);
  await refused(sql`SELECT app_private.chat_edit_message(${channel}::uuid, ${seq}::bigint, ${a}::uuid, 'rewritten')`);
  await refused(sql`SELECT app_private.chat_react(${channel}::uuid, ${seq}::bigint, ${b}::uuid, 'thumbsup', true)`);
  await refused(sql`SELECT app_private.chat_save_canvas(${channel}::uuid, ${a}::uuid, 'Notes', 'x', '{}'::uuid[], 0)`);
  assert.equal((await sql`SELECT app_private.chat_can_signal(${channel}::uuid, ${a}::uuid) AS ok`)[0]!.ok, false);
  await sql`DELETE FROM chat_channels WHERE id = ${channel}`;
});

test("in a shared channel, mentions across a block are dropped and reactions refused (B33, K31, K44)", async () => {
  const { a, b } = await pair();
  const ws = await sql.begin((tx) => createProject(tx, a));
  made.push(ws);
  const [{ id: channel }] = await sql`INSERT INTO chat_channels (kind, name, workspace_id, created_by) VALUES ('private', 'team', ${ws}, ${a}) RETURNING id`;
  await sql`INSERT INTO chat_channel_members (channel_id, user_id) VALUES (${channel}, ${a}), (${channel}, ${b})`;
  const [{ seq }] = await sql`SELECT (app_private.chat_send_message(${channel}::uuid, ${b}::uuid, 'hi team', ${`c-${b}`})->>'channel_seq')::int AS seq`;
  await block(a, b);
  await refused(sql`SELECT app_private.chat_react(${channel}::uuid, ${seq}::bigint, ${a}::uuid, 'eyes', true)`);
  const [{ seq: next }] = await sql`SELECT (app_private.chat_send_message(${channel}::uuid, ${b}::uuid, 'hey', ${`c2-${b}`}, NULL, ${[a]}::uuid[])->>'channel_seq')::int AS seq`;
  assert.equal((await sql`SELECT count(*)::int AS n FROM chat_mentions WHERE channel_id = ${channel} AND message_seq = ${next} AND user_id = ${a}`)[0]!.n, 0);
  await sql`DELETE FROM chat_channels WHERE id = ${channel}`;
});

test("notifications from a blocked person are dropped; the place's own notice still arrives, without them (B8, B47)", async () => {
  const { a, b } = await pair();
  await block(a, b);
  const personal = await notifications.createNotification({ recipientUserId: a, actorUserId: b, kind: "trust_safety", category: "projects", importance: "important", title: "hi", dedupeKey: `t:${a}:1` });
  assert.equal(personal.skipped, true);
  const place = await notifications.createNotification({ recipientUserId: a, actorUserId: b, kind: "trust_safety", category: "projects", importance: "important", title: "Your role changed", dedupeKey: `t:${a}:2`, placeNotice: true });
  assert.equal(place.skipped, false);
  assert.equal(place.notification?.actorUserId ?? null, null);
  await sql`DELETE FROM user_notifications WHERE user_id = ${a}`;
});
