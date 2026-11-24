import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A7.4 (report 38.17 W1–W3, calls 1–3): schedule, edit, cancel, Post now; the hourly step posts as the
// author with their rights at the time, once even when it runs twice, and tells the author either way.
let viewerId = "";
stubNextAfter();
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.180" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let updates: typeof import("../../src/app/actions/workspace/updates");
let job: typeof import("../../src/lib/workflows/scheduled-updates-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  const { actingAsUserId } = await loadAppModule(() => import("../../src/lib/server/acting-as"));
  // The job acts as the author (acting-as.ts); outside it, the signed-in test viewer.
  const who = () => actingAsUserId() ?? (viewerId || null);
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: who() ? { id: who() } : null, userId: who(), emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: who() ? { id: who() } : null, userId: who(), emailVerified: true, profile: null }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/workspace/updates"));
  job = await loadAppModule(() => import("../../src/lib/workflows/scheduled-updates-server"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET member_updates_enabled = true WHERE id = ${ws}`;
  return { owner: owner!, member: member!, viewer: viewer!, ws };
}
const soon = () => new Date(Date.now() + 10 * 60_000).toISOString();
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const due = (id: string) => sql`UPDATE workspace_scheduled_updates SET publish_at = now() - interval '1 minute' WHERE id = ${id}`;

test("W1/W3: a member schedules; at the time it posts as them, once, and they're told", async () => {
  const t = await workspace();
  viewerId = t.member;
  assert.match(errorOf(await updates.scheduleWorkspaceUpdateAction(t.ws, { content: "Too soon", publishAt: new Date().toISOString() })), /at least a minute/);
  const s = await updates.scheduleWorkspaceUpdateAction(t.ws, { content: "WT launch notes", visibility: "members", publishAt: soon() });
  assert.ok(s.success, JSON.stringify(s));
  const list = await updates.readScheduledUpdatesAction(t.ws);
  assert.equal(list.success && list.scheduled.length, 1);
  await due(s.id);
  viewerId = "";
  const run = await job.fireDueScheduledUpdates();
  assert.deepEqual(run, { scheduledUpdatesDue: 1, scheduledUpdatesPosted: 1 });
  assert.deepEqual(await job.fireDueScheduledUpdates(), { scheduledUpdatesDue: 0, scheduledUpdatesPosted: 0 }, "never twice");
  const [post] = await sql`SELECT author_id, content, visibility FROM workspace_updates WHERE workspace_id = ${t.ws}`;
  assert.deepEqual([post!.author_id, post!.content, post!.visibility], [t.member, "WT launch notes", "members"]);
  const [row] = await sql`SELECT published_update_id IS NOT NULL AS done FROM workspace_scheduled_updates WHERE id = ${s.id}`;
  assert.equal(row!.done, true);
  const [n] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title = 'Your scheduled update posted'`;
  assert.equal(n!.n, 1);
});

test("call 3: rights are checked at the time; losing them fails it with an Important notice", async () => {
  const t = await workspace();
  viewerId = t.member;
  const s = await updates.scheduleWorkspaceUpdateAction(t.ws, { content: "Will not post", publishAt: soon() });
  assert.ok(s.success);
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${t.ws} AND user_id = ${t.member}`;
  await due(s.id);
  viewerId = "";
  assert.deepEqual(await job.fireDueScheduledUpdates(), { scheduledUpdatesDue: 1, scheduledUpdatesPosted: 0 });
  const [row] = await sql`SELECT failed_reason FROM workspace_scheduled_updates WHERE id = ${s.id}`;
  assert.match(row!.failed_reason, /access/);
  const [n] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${t.member} AND title LIKE 'Your scheduled update didn’t post:%'`;
  assert.equal(n!.n, 1);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_updates WHERE workspace_id = ${t.ws}`)[0]!.n, 0);
});

test("W2: only the author edits or posts now; the owner can cancel; viewers can't schedule", async () => {
  const t = await workspace();
  viewerId = t.viewer;
  assert.equal((await updates.scheduleWorkspaceUpdateAction(t.ws, { content: "x", publishAt: soon() })).success, false);
  viewerId = t.member;
  const a = await updates.scheduleWorkspaceUpdateAction(t.ws, { content: "First", publishAt: soon() });
  const b = await updates.scheduleWorkspaceUpdateAction(t.ws, { content: "Second", publishAt: soon() });
  assert.ok(a.success && b.success);
  viewerId = t.owner;
  assert.match(errorOf(await updates.editScheduledUpdateAction(t.ws, a.id, { content: "Owner edit" })), /Only its author/);
  assert.equal((await updates.cancelScheduledUpdateAction(t.ws, b.id)).success, true, "owners and admins can cancel");
  viewerId = t.member;
  assert.equal((await updates.editScheduledUpdateAction(t.ws, a.id, { content: "First, edited" })).success, true);
  const now = await updates.postScheduledNowAction(t.ws, a.id);
  assert.ok(now.success, JSON.stringify(now));
  const [post] = await sql`SELECT content FROM workspace_updates WHERE workspace_id = ${t.ws}`;
  assert.equal(post!.content, "First, edited");
  const list = await updates.readScheduledUpdatesAction(t.ws);
  assert.deepEqual(list.success && list.scheduled.length, 0, "posted and cancelled ones leave the list");
});
