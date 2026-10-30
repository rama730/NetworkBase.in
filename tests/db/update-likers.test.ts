import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// "Liked by": the count stays honest, the list leaves out deleted accounts and anyone in a block with the viewer
// (Blocking B20), and people whose profile the viewer can't see read as "Private member".
moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async () => true });

let viewerId = "";
let updates: typeof import("../../src/app/actions/workspace/updates");
let blocks: typeof import("../../src/lib/privacy/blocks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/workspace/updates"));
  blocks = await loadAppModule(() => import("../../src/lib/privacy/blocks"));
});
const made: string[] = [];
const people: string[] = [];
after(async () => {
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  if (people.length) await sql`DELETE FROM profiles WHERE id IN ${sql(people)}`;
  await sql.end();
  await closeAppDb();
});

test("who liked: private as Private member, blocked and deleted left out, pages without gaps", async () => {
  const [owner, viewer, open, hidden, gone, blocked] = await sql.begin(async (tx) => [
    await createUser(tx), await createUser(tx), await createUser(tx), await createUser(tx, { visibility: "private" }), await createUser(tx), await createUser(tx),
  ]);
  people.push(owner!, viewer!, open!, hidden!, gone!, blocked!);
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public", publicTabVisibility: { updates: true } }));
  made.push(ws);
  const [post] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ws}, ${owner}, 'hello') RETURNING id`;
  for (const [i, who] of [open, hidden, gone, blocked, viewer].entries()) {
    await sql`INSERT INTO workspace_update_likes (update_id, user_id, created_at) VALUES (${post!.id}, ${who}, ${new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()})`;
  }
  await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${gone}`;
  await blocks.setUserBlocked({ blockerId: blocked!, targetUserId: viewer!, blocked: true, request: new Request("https://networkbase.in/t") });

  viewerId = viewer!;
  const seen: Array<{ userId: string | null; fullName: string | null; username: string | null }> = [];
  let cursor: string | null = null;
  do {
    const page = await updates.readProjectUpdateLikersAction(ws, post!.id, { cursor, limit: 1 });
    assert.equal(page.success, true, JSON.stringify(page));
    if (!page.success) return;
    seen.push(...page.likers);
    cursor = page.nextCursor;
  } while (cursor);
  // Newest first: the viewer, (blocked and deleted left out), the private liker masked, then the public one.
  assert.deepEqual(seen.map((l) => l.userId), [viewer, null, open]);
  assert.deepEqual(seen[1], { ...seen[1], fullName: "Private member", username: null });
  assert.doesNotMatch(JSON.stringify(seen), new RegExp(`${hidden}|${blocked}|${gone}`), "no hidden id reaches the browser");

  viewerId = "";
  const anonymous = await updates.readProjectUpdateLikersAction(ws, post!.id);
  assert.equal(anonymous.success, true);
  if (anonymous.success) assert.deepEqual(anonymous.likers.map((l) => l.userId), [viewer, blocked, null, open]);
});
