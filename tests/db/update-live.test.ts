import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Live update cards (the "Update card real-time" report): the database announces each change once committed, events
// never carry text or people, only those who can read may listen, and likes notify the author quietly.
stubNextAfter();
moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async () => true });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let viewerId = "";
let updates: typeof import("../../src/app/actions/workspace/updates");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/workspace/updates"));
});
const made: string[] = [];
const people: string[] = [];
after(async () => {
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  if (people.length) await sql`DELETE FROM profiles WHERE id IN ${sql(people)}`;
  await sql.end();
  await closeAppDb();
});

async function post() {
  const [owner, fan] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx)]);
  people.push(owner!, fan!);
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public", publicTabVisibility: { updates: true } }));
  made.push(ws);
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ws}, ${owner}, 'secret words') RETURNING id`;
  return { owner: owner!, fan: fan!, ws, id: row!.id as string };
}
const events = (id: string) => sql`SELECT event, payload, topic FROM realtime.messages WHERE topic = ${`updates:post:${id}`} ORDER BY inserted_at, id`;

test("each change announces itself on both topics, with ids and counts only (RT2, RT3)", async () => {
  const { owner, ws, id } = await post();
  await sql`UPDATE workspace_updates SET like_count = 1 WHERE id = ${id}`;
  const [comment] = await sql`INSERT INTO workspace_update_comments (update_id, workspace_id, user_id, content) VALUES (${id}, ${ws}, ${owner}, 'hidden text') RETURNING id`;
  await sql`UPDATE workspace_update_comments SET deleted_at = now() WHERE id = ${comment!.id}`;
  await sql`UPDATE workspace_updates SET content = 'edited words' WHERE id = ${id}`;
  await sql`UPDATE workspace_updates SET deleted_at = now() WHERE id = ${id}`;
  const rows = await events(id);
  assert.deepEqual(rows.map((r) => r.event), ["update.created", "update.counts", "comment.created", "comment.removed", "update.changed", "update.removed"]);
  const counts = rows[1]!.payload as { likes: number; comments: number; seq: number };
  assert.deepEqual([counts.likes, counts.comments], [1, 0]);
  assert.doesNotMatch(JSON.stringify(rows.map((r) => r.payload)), new RegExp(`secret|edited|hidden|${owner}`));
  assert.equal((await sql`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${`updates:workspace:${ws}`}`)[0]!.n, rows.length);
  // Versions rise, so clients can ignore anything older.
  const seqs = rows.map((r) => (r.payload as { seq?: number }).seq).filter((seq) => typeof seq === "number") as number[];
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
});

test("a rolled-back change announces nothing; an unrelated edit doesn't either (design principle 3)", async () => {
  const { id } = await post();
  const before = (await events(id)).length;
  await sql.begin(async (tx) => {
    await tx`UPDATE workspace_updates SET like_count = 9 WHERE id = ${id}`;
    throw new Error("roll back");
  }).catch(() => undefined);
  await sql`UPDATE workspace_updates SET updated_at = now() WHERE id = ${id}`;
  assert.equal((await events(id)).length, before);
});

test("only people who can read may listen, and nobody may publish (RT9)", async () => {
  const { owner, fan, ws, id } = await post();
  const readable = async (user: string, topic: string) => sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
    return (await tx`SELECT app_private.nb_update_topic_readable(${topic}) AS ok`)[0]!.ok as boolean;
  });
  assert.equal(await readable(fan, `updates:post:${id}`), true, "public post");
  await sql`UPDATE workspace_updates SET visibility = 'members' WHERE id = ${id}`;
  assert.equal(await readable(fan, `updates:post:${id}`), false, "members-only post, stranger");
  assert.equal(await readable(owner, `updates:post:${id}`), true, "members-only post, owner");
  assert.equal(await readable(fan, "updates:other:x"), false);
  const send = await sql`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND cmd = 'INSERT' AND coalesce(with_check, '') LIKE '%updates:%'`;
  assert.equal(send[0]!.n, 0);
  assert.ok(ws);
});

test("a like tells the author once, in the tray; unlike takes it out; liking again doesn't bring it back; yours never notify (RT6)", async () => {
  const { owner, fan, ws, id } = await post();
  const rows = () => sql`SELECT importance, dismissed_at, title FROM user_notifications WHERE user_id = ${owner} AND kind = 'project_update_like'`;
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 200)); };
  viewerId = fan;
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await settle();
  let found = await rows();
  assert.equal(found.length, 1);
  assert.equal(found[0]!.importance, "more", "tray only: only important ones push");
  assert.equal(found[0]!.dismissed_at, null);
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await settle();
  found = await rows();
  assert.notEqual(found[0]!.dismissed_at, null, "unlike takes it out");
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await settle();
  found = await rows();
  assert.equal(found.length, 1);
  assert.notEqual(found[0]!.dismissed_at, null, "a like loop never nags");
  viewerId = owner;
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await settle();
  assert.equal((await rows()).length, 1, "your own like tells nobody");
  // A like isn't an edit.
  const [row] = await sql`SELECT created_at = updated_at AS same FROM workspace_updates WHERE id = ${id}`;
  assert.equal(row!.same, true);
  await sql`DELETE FROM user_notifications WHERE user_id = ${owner}`;
});

test("an open thread reads its notifications (RT8)", async () => {
  const { owner, fan, ws, id } = await post();
  viewerId = fan;
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await new Promise((resolve) => setTimeout(resolve, 200));
  viewerId = owner;
  await updates.markUpdateNotificationsReadAction(id);
  const [row] = await sql`SELECT read_at FROM user_notifications WHERE user_id = ${owner} AND kind = 'project_update_like'`;
  assert.notEqual(row!.read_at, null);
  await sql`DELETE FROM user_notifications WHERE user_id = ${owner}`;
});

test("likes from someone you muted don't reach you (B26)", async () => {
  const { owner, fan, ws, id } = await post();
  await sql`INSERT INTO user_mutes (muter_id, muted_id) VALUES (${owner}, ${fan})`;
  viewerId = fan;
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${owner} AND kind = 'project_update_like'`)[0]!.n, 0);
});
