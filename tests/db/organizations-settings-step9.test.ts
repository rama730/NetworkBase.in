import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 9a (report §22, smaller bug 24): the organization's Settings rules.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.91" }) });

let orgs: typeof import("../../src/app/actions/organizations");
let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, member] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()}, member_updates_enabled = true WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, member: member! };
}

test("smaller bug 24 and 22.4: Max members can't go below today's count, and a term ends after it starts", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.deepEqual(await orgs.updateOrgSettingsAction(o.id, "access", { max_members: 2 }), { success: false, error: "There are 3 members now. Max members can’t be lower." });
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "access", { max_members: 3 })).success, true);
  assert.deepEqual(await orgs.updateOrgSettingsAction(o.id, "profile", { term_start: "2026-12-01", term_end: "2026-08-01" }), { success: false, error: "The term has to end after it starts." });
});

test("22.4 Updates: admins choose member discussions, who can reply and how announcements notify", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "updates", { member_posts: false, reply_rule: "logged_in", announcement_notify: "email" })).success, true);
  const [row] = await sql`SELECT member_updates_enabled, org_settings FROM workspaces WHERE id = ${o.id}`;
  assert.deepEqual([row!.member_updates_enabled, row!.org_settings.replyRule, row!.org_settings.announcementNotify, Boolean(row!.org_settings.changes.updates)], [false, "logged_in", "email", true]);
  viewerId = o.member;
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "updates", { member_posts: true })).success, false);
});

test("22.3, 22.4 Details: admins edit the tagline, description and tags; the name stays the owner's", async () => {
  const o = await org();
  viewerId = o.admin;
  await lifecycle.updateWorkspace(o.id, { shortDescription: "Compiler design, autumn term", description: "Labs and the project.", tags: ["compilers"] });
  const [row] = await sql`SELECT short_description, description, tags FROM workspaces WHERE id = ${o.id}`;
  assert.deepEqual([row!.short_description, row!.description, row!.tags], ["Compiler design, autumn term", "Labs and the project.", ["compilers"]]);
  await assert.rejects(lifecycle.updateWorkspace(o.id, { title: "Renamed" }), /Only the owner can change this/);
  viewerId = o.member;
  await assert.rejects(lifecycle.updateWorkspace(o.id, { shortDescription: "x" }));
});

test("22.4: the facts Settings shows beside its fields: members, admins, workspaces, outside people, channels, requests", async () => {
  const o = await org();
  const outsider = await sql.begin((tx) => createUser(tx));
  const child = await sql.begin((tx) => createProject(tx, o.member, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${o.member}, 'owner'), (${child}, ${outsider}, 'member')`;
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${o.id}, ${outsider}, ${o.owner}, 'pending')`;
  viewerId = o.admin;
  const r = await orgs.readOrgSettingsFactsAction(o.id);
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual(r.success && { ...r.facts, channels: undefined }, { members: 3, admins: 1, workspaces: 1, outsidePeople: 1, waitingRequests: 1, channels: undefined });
  viewerId = o.member;
  assert.equal((await orgs.readOrgSettingsFactsAction(o.id)).success, false);
});

test("18.7, gap 41: a workspace's lead can turn following the organization's sprints on or off after creation", async () => {
  const o = await org();
  const child = await sql.begin((tx) => createProject(tx, o.member, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${o.member}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
  viewerId = o.member;
  assert.equal((await orgs.setChildFollowSprintsAction(child, true)).success, true);
  assert.equal((await sql`SELECT org_settings->>'followOrgSprints' AS f FROM workspaces WHERE id = ${child}`)[0]!.f, "true");
  viewerId = o.admin;
  assert.equal((await orgs.setChildFollowSprintsAction(child, false)).success, true, "an organization admin can too");
});

test("29.3, 22.4 Moderation: blocked people are listed with who blocked them, and Unblock lets them join again; standing reads good", async () => {
  const o = await org();
  const moderation = await loadAppModule(() => import("../../src/app/actions/moderation-org"));
  const blocked = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO org_join_blocks (org_id, user_id, blocked_by) VALUES (${o.id}, ${blocked}, ${o.admin})`;
  viewerId = o.member;
  assert.equal((await moderation.readOrgJoinBlocksAction(o.id)).success, false);
  viewerId = o.owner;
  const list = await moderation.readOrgJoinBlocksAction(o.id);
  assert.deepEqual(list.success && list.people.map((p) => p.userId), [blocked]);
  assert.deepEqual(await moderation.readOrgStandingAction(o.id), { success: true, standing: null });
  assert.equal((await moderation.unblockFromOrgAction(o.id, blocked)).success, true);
  assert.equal((await sql`SELECT 1 FROM org_join_blocks WHERE org_id = ${o.id}`).length, 0);
});
