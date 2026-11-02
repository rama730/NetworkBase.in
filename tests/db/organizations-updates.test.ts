import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.14" }) });

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
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function orgWithChild(memberUpdates = false) {
  const [owner, admin, member, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${admin!}, 'admin'), (${org}, ${member!}, 'member'), (${org}, ${other!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, member_updates_enabled = ${memberUpdates} WHERE id = ${org}`;
  const child = await sql.begin((tx) => createProject(tx, member!, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${member!}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${child}`;
  created.push(org, child);
  return { org, child, owner: owner!, admin: admin!, member: member!, other: other! };
}

async function post(projectId: string, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  return updates.createWorkspaceUpdateAction(projectId, { content: `Post ${Math.random().toString(36).slice(2, 7)}`, visibility: "members", ...extra } as Parameters<typeof updates.createWorkspaceUpdateAction>[1]);
}
async function feed(projectId: string, as: string, filter = "all") {
  viewerId = as;
  const result = await updates.readWorkspaceUpdatesAction(projectId, { filter });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.data : null;
}

test("announcements are for admins; discussion needs member posts on; neither exists outside orgs", async () => {
  const o = await orgWithChild(false);
  assert.equal((await post(o.org, o.admin, { updateType: "announcement" })).success, true);
  assert.equal((await post(o.org, o.member, { updateType: "discussion" })).success, false, "member posts are off");
  await sql`UPDATE workspaces SET member_updates_enabled = true WHERE id = ${o.org}`;
  assert.equal((await post(o.org, o.member, { updateType: "discussion" })).success, true);
  assert.equal((await post(o.org, o.member, { updateType: "announcement" })).success, false);
  assert.equal((await post(o.child, o.member, { updateType: "announcement" })).success, false, "not in a normal or child project");
});

test("audience: a role or child projects narrow who sees an announcement", async () => {
  const o = await orgWithChild();
  await post(o.org, o.admin, { updateType: "announcement", content: "For admins", audience: { roles: ["admin"] } });
  await post(o.org, o.admin, { updateType: "announcement", content: "For Compiler Lab", audience: { projectIds: [o.child] } });
  const memberFeed = await feed(o.org, o.member);
  assert.deepEqual(memberFeed!.updates.map((u) => u.content), ["For Compiler Lab"]);
  const otherFeed = await feed(o.org, o.other);
  assert.deepEqual(otherFeed!.updates.map((u) => u.content), []);
  const adminFeed = await feed(o.org, o.owner);
  assert.equal(adminFeed!.updates.length, 2);
});

test("up to 3 pins in an org; an unpin date ends a pin; a normal project still swaps its one pin", async () => {
  const o = await orgWithChild();
  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const r = await post(o.org, o.admin, { updateType: "announcement" });
    ids.push(r.success ? r.data!.id : "");
  }
  viewerId = o.admin;
  for (const id of ids.slice(0, 3)) assert.equal((await updates.toggleWorkspaceUpdatePinAction(o.org, id, true)).success, true);
  assert.equal((await updates.toggleWorkspaceUpdatePinAction(o.org, ids[3]!, true)).success, false, "a fourth pin is refused");
  await sql`UPDATE workspace_updates SET pinned_until = now() - interval '1 minute' WHERE id = ${ids[0]!}`;
  assert.equal((await updates.toggleWorkspaceUpdatePinAction(o.org, ids[3]!, true)).success, true, "an expired pin no longer counts");
  const top = await feed(o.org, o.member);
  assert.equal(top!.updates.find((u) => u.id === ids[0])!.isPinned, false, "quietly unpinned");

  const a = await post(o.child, o.member);
  const b = await post(o.child, o.member);
  viewerId = o.member;
  await updates.toggleWorkspaceUpdatePinAction(o.child, a.success ? a.data!.id : "", true);
  assert.equal((await updates.toggleWorkspaceUpdatePinAction(o.child, b.success ? b.data!.id : "", true)).success, true);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_updates WHERE workspace_id = ${o.child} AND is_pinned`)[0]!.n, 1);
});

test("comments off refuses replies", async () => {
  const o = await orgWithChild();
  const r = await post(o.org, o.admin, { updateType: "announcement", commentsOff: true });
  viewerId = o.member;
  const reply = await updates.createWorkspaceUpdateCommentAction(o.org, r.success ? r.data!.id : "", "Question?");
  assert.equal(reply.success, false);
});

test("share up: a child post appears under From workspaces; Private workspaces and an org switch-off block it", async () => {
  const o = await orgWithChild();
  const shared = await post(o.child, o.member, { content: "Parser passes all tests", shareToOrg: true });
  assert.equal(shared.success, true, JSON.stringify(shared));
  const fromProjects = await feed(o.org, o.other, "from_projects");
  assert.deepEqual(fromProjects!.updates.map((u) => [u.content, u.fromProject?.title ?? null]), [["Parser passes all tests", (await sql`SELECT title FROM workspaces WHERE id = ${o.child}`)[0]!.title]]);
  await sql`UPDATE workspaces SET visibility = 'private' WHERE id = ${o.child}`;
  assert.equal((await feed(o.org, o.other, "from_projects"))!.updates.length, 0, "a Private workspace's posts leave the org feed");
  assert.equal((await post(o.child, o.member, { shareToOrg: true })).success, false);
  await sql`UPDATE workspaces SET visibility = 'org' WHERE id = ${o.child}`;
  await sql`UPDATE workspaces SET org_settings = org_settings || '{"childShare": false}'::jsonb WHERE id = ${o.org}`;
  assert.equal((await post(o.child, o.member, { shareToOrg: true })).success, false);
});

test("the pinned org line in a child project, and New markers", async () => {
  const o = await orgWithChild();
  const pinned = await post(o.org, o.admin, { updateType: "announcement", content: "Midterm moved to Nov 10" });
  viewerId = o.admin;
  await updates.toggleWorkspaceUpdatePinAction(o.org, pinned.success ? pinned.data!.id : "", true);
  viewerId = o.member;
  const line = await orgUpdates.readOrgPinnedLineAction(o.child);
  assert.equal(line?.content, "Midterm moved to Nov 10");
  const before = await feed(o.org, o.member);
  assert.equal(before!.lastSeenAt, null);
  assert.equal((await orgUpdates.markOrgUpdatesSeenAction(o.org)).success, true);
  assert.ok((await feed(o.org, o.member))!.lastSeenAt);
});

test("inherited org admins moderate child workspace updates", async () => {
  const o = await orgWithChild();
  const r = await post(o.child, o.member);
  viewerId = o.admin;
  assert.equal((await updates.deleteWorkspaceUpdateAction(o.child, r.success ? r.data!.id : "", "Off topic")).success, true);
});

test("problem 40 (decisions 5, 27, 152): organization posts are Members unless an admin picks Public on purpose", async () => {
  const o = await orgWithChild(true);
  const stored = async (result: Awaited<ReturnType<typeof post>>) => {
    assert.equal(result.success, true, JSON.stringify(result));
    const [row] = await sql`SELECT visibility FROM workspace_updates WHERE id = ${result.success ? result.data!.id : ""}`;
    return row!.visibility;
  };
  assert.equal(await stored(await post(o.org, o.member, { visibility: "public", updateType: "discussion" })), "members", "members can't make a discussion public");
  assert.equal(await stored(await post(o.org, o.admin, { visibility: undefined, updateType: "announcement" })), "members", "no choice means Members");
  assert.equal(await stored(await post(o.org, o.admin, { visibility: "public", updateType: "announcement" })), "public", "admins choose Public on purpose");
});

test("problem 49: likes follow the post's audience", async () => {
  const o = await orgWithChild();
  const result = await post(o.org, o.admin, { updateType: "announcement", audience: { roles: ["admin"] } });
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.success ? result.data!.id : "";
  viewerId = o.member;
  assert.equal((await updates.toggleWorkspaceUpdateLikeAction(o.org, id)).success, false, "outside the audience: no like");
  viewerId = o.owner;
  const liked = await updates.toggleWorkspaceUpdateLikeAction(o.org, id);
  assert.equal(liked.success, true, JSON.stringify(liked));
});

test("problems 43, 45 and 48, smaller bug 22: Viewers only read; the server sets the post type by role; read-only means read only; a removed author can't edit", async () => {
  const o = await orgWithChild(true);
  const [viewer] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.org}, ${viewer!}, 'viewer')`;
  const posted = await post(o.org, o.admin, { updateType: "announcement" });
  const id = posted.success ? posted.data!.id : "";
  viewerId = viewer!;
  assert.equal((await updates.toggleWorkspaceUpdateLikeAction(o.org, id)).success, false, "Viewers can't like (problem 43)");
  assert.equal((await updates.createWorkspaceUpdateCommentAction(o.org, id, "Hi")).success, false, "or comment");

  const mine = await post(o.org, o.member, { updateType: "announcement" });
  assert.equal(mine.success, false, "members can't announce");
  const discussion = await post(o.org, o.member, {});
  assert.equal(discussion.success, true, JSON.stringify(discussion));
  const discussionId = discussion.success ? discussion.data!.id : "";
  const [type] = await sql`SELECT update_type FROM workspace_updates WHERE id = ${discussionId}`;
  assert.equal(type!.update_type, "discussion", "the server makes it a discussion (problem 45)");
  viewerId = o.member;
  await updates.editWorkspaceUpdateAction(o.org, discussionId, { content: "Edited", updateType: "announcement" });
  const [still] = await sql`SELECT update_type FROM workspace_updates WHERE id = ${discussionId}`;
  assert.equal(still!.update_type, "discussion", "and keeps it one on edit");

  await sql`DELETE FROM workspace_members WHERE workspace_id = ${o.org} AND user_id = ${o.other}`;
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${o.org}`;
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content, update_type, visibility) VALUES (${o.org}, ${o.other}, 'Old post', 'discussion', 'public')`;
  const [old] = await sql`SELECT id FROM workspace_updates WHERE workspace_id = ${o.org} AND author_id = ${o.other}`;
  viewerId = o.other;
  assert.equal((await updates.editWorkspaceUpdateAction(o.org, old!.id, { content: "Rewritten after removal" })).success, false, "smaller bug 22");

  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${o.org}`;
  viewerId = o.admin;
  const blocked = await updates.toggleWorkspaceUpdatePinAction(o.org, id, true);
  assert.deepEqual([blocked.success, (blocked as { error?: string }).error], [false, "This organization has ended. Everything is read-only."], "problem 48");
  assert.equal((await updates.editWorkspaceUpdateAction(o.org, id, { content: "Changed after the end" })).success, false);
  assert.equal((await updates.setWorkspaceUpdateReplyPolicyAction(o.org, id, "closed")).success, false);
  await assert.rejects(sql`UPDATE workspace_updates SET content = 'Direct write' WHERE id = ${id}`, /project_read_only/, "the database refuses edits too (DB11)");
  await sql`UPDATE workspaces SET status = 'active' WHERE id = ${o.org}`;
});

test("problem 47 (decision 154): Overview's pinned line, activity and the sidebar dot follow the post's audience; your own posts don't light the dot", async () => {
  const o = await orgWithChild();
  const dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  const side = await loadAppModule(() => import("../../src/app/actions/org-workspace"));
  const forMembers = await post(o.org, o.admin, { updateType: "announcement", audience: { roles: ["member"] }, pin: true });
  assert.equal(forMembers.success, true, JSON.stringify(forMembers));
  viewerId = o.member;
  const overview = await dash.readOrgDashboardAction(o.org);
  assert.equal(overview.success && overview.pinned?.id, forMembers.success ? forMembers.data!.id : "", "a pinned notice for Members shows to members");
  assert.equal(overview.success && overview.activity.some((a) => a.kind === "announcement"), true);
  const dot = async (as: string) => {
    viewerId = as;
    const s = await side.readSidebarWorkspacesAction();
    return s?.orgs.find((x) => x.id === o.org)?.unseenAnnouncement;
  };
  await sql`UPDATE workspace_members SET last_seen_updates_at = now() - interval '1 day' WHERE workspace_id = ${o.org}`;
  assert.equal(await dot(o.member), true);
  await sql`UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = ${o.org} AND user_id = ${o.other}`;
  assert.equal(await dot(o.other), false, "not lit for a post you can't open");
  assert.equal(await dot(o.admin), false, "not lit by your own post");
});

test("problem 42: the organization's people can like and comment on a post shared up from a workspace", async () => {
  const o = await orgWithChild(true);
  const shared = await post(o.child, o.member, { shareToOrg: true });
  assert.equal(shared.success, true, JSON.stringify(shared));
  const id = shared.success ? shared.data!.id : "";
  viewerId = o.other;
  const liked = await updates.toggleWorkspaceUpdateLikeAction(o.child, id);
  assert.equal(liked.success, true, JSON.stringify(liked));
  const replied = await updates.createWorkspaceUpdateCommentAction(o.child, id, "Nice work");
  assert.equal(replied.success, true, JSON.stringify(replied));
});

test("problem 46: a deleted shared post frees its pin slot", async () => {
  const o = await orgWithChild(true);
  const sharedIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const s = await post(o.child, o.member, { shareToOrg: true });
    assert.equal(s.success, true, JSON.stringify(s));
    sharedIds.push(s.success ? s.data!.id : "");
  }
  viewerId = o.admin;
  for (const id of sharedIds) assert.equal((await updates.toggleWorkspaceUpdatePinAction(o.org, id, true)).success, true);
  await sql`UPDATE workspace_updates SET deleted_at = now() WHERE id = ${sharedIds[0]!}`;
  const own = await post(o.org, o.admin, { updateType: "announcement" });
  viewerId = o.admin;
  const pinned = await updates.toggleWorkspaceUpdatePinAction(o.org, own.success ? own.data!.id : "", true);
  assert.equal(pinned.success, true, JSON.stringify(pinned));
});
