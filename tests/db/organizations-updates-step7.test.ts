import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 7 (report §7.5, §18.4, §28.3, §30.5, §37.3, §42.15 S21; decisions 58, 67, 100; DB6): the Updates tab's server side.

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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.71" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });

let updates: typeof import("../../src/app/actions/workspace/updates");
let orgUpdates: typeof import("../../src/app/actions/org-updates");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/workspace/updates"));
  orgUpdates = await loadAppModule(() => import("../../src/app/actions/org-updates"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(childVisibility = "org") {
  const [owner, admin, member, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member'), (${id}, ${other!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()}, member_updates_enabled = true,
            time_zone = 'Asia/Kolkata', visibility = 'public' WHERE id = ${id}`;
  const child = await sql.begin((tx) => createProject(tx, member!, { visibility: childVisibility }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${member!}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Team Falcon' WHERE id = ${child}`;
  created.push(id);
  return { id, child, owner: owner!, admin: admin!, member: member!, other: other! };
}

async function post(projectId: string, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  const r = await updates.createWorkspaceUpdateAction(projectId, { content: `Post ${Math.random().toString(36).slice(2, 7)}`, ...extra } as never);
  assert.equal(r.success, true, JSON.stringify(r));
  return r as Extract<typeof r, { success: true }> & { emailStopped?: boolean };
}
async function feed(projectId: string, as: string) {
  viewerId = as;
  const r = await updates.readWorkspaceUpdatesAction(projectId, {});
  assert.equal(r.success, true, JSON.stringify(r));
  return r.success ? r.data : null!;
}

test("smaller bug 21, decision 67: the email limit counts the organization's day, skips deleted posts, and tells the author when it stops one", async () => {
  const o = await org();
  // Midnight in Kolkata: two from yesterday don't count, one deleted today doesn't count, four sent today do.
  const midnight = sql`(date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  for (let i = 0; i < 2; i += 1) await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, notify_level, created_at) VALUES (${o.id}, ${o.admin}, 'old', 'announcement', 'email', ${midnight} - interval '1 minute')`;
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, notify_level, created_at, deleted_at) VALUES (${o.id}, ${o.admin}, 'gone', 'announcement', 'email', ${midnight} + interval '1 second', now())`;
  for (let i = 0; i < 4; i += 1) await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, notify_level, created_at) VALUES (${o.id}, ${o.admin}, 'sent', 'announcement', 'email', ${midnight} + interval '1 second')`;
  assert.equal((await feed(o.id, o.admin)).org?.emailsLeft, 1);
  const fifth = await post(o.id, o.admin, { updateType: "announcement", notifyLevel: "email" });
  assert.equal(fifth.emailStopped, false);
  assert.equal((await feed(o.id, o.admin)).org?.emailsLeft, 0);
  const sixth = await post(o.id, o.admin, { updateType: "announcement", notifyLevel: "email" });
  assert.equal(sixth.emailStopped, true, "posting still works; the author is told the email didn't go");
  const [row] = await sql`SELECT notify_level FROM workspace_updates WHERE id = ${sixth.data!.id}`;
  assert.equal(row!.notify_level, "in_app", "a stopped email isn't counted as sent");
});

test("17.7, 18.4: a workspace its organization only sees never posts Public; a public one can", async () => {
  const o = await org("org");
  const shut = await post(o.child, o.member, { visibility: "public" });
  assert.equal(shut.data!.visibility, "members");
  const open = await org("public");
  const pub = await post(open.child, open.member, { visibility: "public", shareToOrg: true });
  assert.equal(pub.data!.visibility, "public");
  const payload = (await feed(open.child, open.member)).org;
  assert.deepEqual([payload?.kind, payload?.childIsPublic, (await feed(o.child, o.member)).org?.childIsPublic], ["child", true, false]);
});

test("28.3: members set replies on their own posts, Comments off included", async () => {
  const o = await org();
  const own = await post(o.id, o.member, { commentsOff: true });
  assert.equal(own.data!.replyPolicy, "closed");
});

test("the composer's organization facts come with the feed: pins, role names, workspaces, who posts", async () => {
  const o = await org();
  const pinned = await post(o.id, o.admin, { updateType: "announcement", pin: true, content: "Midterm moved to Nov 10" });
  const admin = (await feed(o.id, o.admin)).org!;
  assert.deepEqual(admin.pins, [{ id: pinned.data!.id, excerpt: "Midterm moved to Nov 10" }]);
  assert.equal(admin.roleNames.member, "Student");
  assert.deepEqual(admin.workspaces, [{ id: o.child, title: "Team Falcon" }]);
  assert.equal(admin.memberPostsOn, true);
  assert.deepEqual((await feed(o.id, o.other)).org!.workspaces, [], "members only get the workspaces they're in");
});

test("28.3, decision 58: admins see Seen by N of M on announcements, who hasn't seen it, and Remind with an honest count", async () => {
  const o = await org();
  const a = await post(o.id, o.admin, { updateType: "announcement" });
  await sql`UPDATE workspace_members SET last_seen_updates_at = now() + interval '1 second' WHERE workspace_id = ${o.id} AND user_id = ${o.member}`;
  const card = (await feed(o.id, o.admin)).updates.find((u) => u.id === a.data!.id)!;
  assert.deepEqual(card.seen, { seen: 1, total: 3 }, "owner, member and other, not the author");
  assert.equal((await feed(o.id, o.member)).updates.find((u) => u.id === a.data!.id)!.seen, null, "members don't see counts");
  viewerId = o.admin;
  const unseen = await orgUpdates.readUnseenPeopleAction(o.id, a.data!.id);
  assert.ok(unseen.success);
  assert.deepEqual(unseen.success && unseen.people.map((p) => p.id).sort(), [o.owner, o.other].sort());
  assert.deepEqual(await orgUpdates.remindUnseenAction(o.id, a.data!.id), { success: true, reminded: 2, skipped: 0 });
  assert.deepEqual(await orgUpdates.remindUnseenAction(o.id, a.data!.id), { success: true, reminded: 0, skipped: 2 }, "12-hour rule");
  viewerId = o.member;
  assert.equal((await orgUpdates.readUnseenPeopleAction(o.id, a.data!.id)).success, false);
});

test("37.3, decision 100: an admin hides a shared post from the organization's feed; it stays in the workspace and the lead is told", async () => {
  const o = await org("public");
  const shared = await post(o.child, o.member, { shareToOrg: true, content: "Our demo is live" });
  viewerId = o.admin;
  assert.equal((await updates.toggleWorkspaceUpdatePinAction(o.id, shared.data!.id, true)).success, true);
  viewerId = o.other;
  assert.equal((await orgUpdates.hideSharedFromOrgAction(o.id, shared.data!.id)).success, false, "members can't");
  viewerId = o.admin;
  assert.equal((await orgUpdates.hideSharedFromOrgAction(o.id, shared.data!.id)).success, true);
  assert.equal((await feed(o.id, o.admin)).updates.some((u) => u.id === shared.data!.id), false);
  assert.equal((await feed(o.id, o.admin)).org!.pins.length, 0, "its pin goes too");
  assert.equal((await feed(o.child, o.member)).updates.some((u) => u.id === shared.data!.id), true);
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.member} AND title LIKE 'Hidden from CSE 3B%'`;
  assert.ok(notice, "the lead is told");
});

test("37.3: changing the audience later widens only after a confirmation and narrows at once", async () => {
  const o = await org();
  const a = await post(o.id, o.admin, { updateType: "announcement", audience: { roles: ["member"] } });
  viewerId = o.admin;
  const wider = await orgUpdates.setOrgUpdateAudienceAction(o.id, a.data!.id, { audience: {}, visibility: "members" }, false);
  assert.deepEqual(wider, { success: false, error: "wider" });
  assert.equal((await orgUpdates.setOrgUpdateAudienceAction(o.id, a.data!.id, { audience: {}, visibility: "members" }, true)).success, true);
  assert.equal((await orgUpdates.setOrgUpdateAudienceAction(o.id, a.data!.id, { audience: { roles: ["admin"] }, visibility: "members" }, false)).success, true, "narrowing needs no confirmation");
  const [row] = await sql`SELECT audience FROM workspace_updates WHERE id = ${a.data!.id}`;
  assert.deepEqual(row!.audience, { roles: ["admin"] });
  viewerId = o.member;
  assert.equal((await orgUpdates.setOrgUpdateAudienceAction(o.id, a.data!.id, { audience: {}, visibility: "members" }, true)).success, false);
});
