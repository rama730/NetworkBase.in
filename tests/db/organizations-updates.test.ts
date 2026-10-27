import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.14" }) });
process.env.ORGANIZATIONS_ENABLED = "true";

let updates: typeof import("../../src/app/actions/project/updates");
let orgUpdates: typeof import("../../src/app/actions/org-updates");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  updates = await loadAppModule(() => import("../../src/app/actions/project/updates"));
  orgUpdates = await loadAppModule(() => import("../../src/app/actions/org-updates"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function orgWithChild(memberUpdates = false) {
  const [owner, admin, member, other] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${admin!}, 'admin'), (${org}, ${member!}, 'member'), (${org}, ${other!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, member_updates_enabled = ${memberUpdates} WHERE id = ${org}`;
  const child = await sql.begin((tx) => createProject(tx, member!, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${member!}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${org} WHERE id = ${child}`;
  created.push(org, child);
  return { org, child, owner: owner!, admin: admin!, member: member!, other: other! };
}

async function post(projectId: string, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  return updates.createProjectUpdateAction(projectId, { content: `Post ${Math.random().toString(36).slice(2, 7)}`, visibility: "members", ...extra } as Parameters<typeof updates.createProjectUpdateAction>[1]);
}
async function feed(projectId: string, as: string, filter = "all") {
  viewerId = as;
  const result = await updates.readProjectUpdatesAction(projectId, { filter });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.data : null;
}

test("announcements are for admins; discussion needs member posts on; neither exists outside orgs", async () => {
  const o = await orgWithChild(false);
  assert.equal((await post(o.org, o.admin, { updateType: "announcement" })).success, true);
  assert.equal((await post(o.org, o.member, { updateType: "discussion" })).success, false, "member posts are off");
  await sql`UPDATE projects SET member_updates_enabled = true WHERE id = ${o.org}`;
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
  for (const id of ids.slice(0, 3)) assert.equal((await updates.toggleProjectUpdatePinAction(o.org, id, true)).success, true);
  assert.equal((await updates.toggleProjectUpdatePinAction(o.org, ids[3]!, true)).success, false, "a fourth pin is refused");
  await sql`UPDATE project_updates SET pinned_until = now() - interval '1 minute' WHERE id = ${ids[0]!}`;
  assert.equal((await updates.toggleProjectUpdatePinAction(o.org, ids[3]!, true)).success, true, "an expired pin no longer counts");
  const top = await feed(o.org, o.member);
  assert.equal(top!.updates.find((u) => u.id === ids[0])!.isPinned, false, "quietly unpinned");

  const a = await post(o.child, o.member);
  const b = await post(o.child, o.member);
  viewerId = o.member;
  await updates.toggleProjectUpdatePinAction(o.child, a.success ? a.data!.id : "", true);
  assert.equal((await updates.toggleProjectUpdatePinAction(o.child, b.success ? b.data!.id : "", true)).success, true);
  assert.equal((await sql`SELECT count(*)::int AS n FROM project_updates WHERE project_id = ${o.child} AND is_pinned`)[0]!.n, 1);
});

test("comments off refuses replies", async () => {
  const o = await orgWithChild();
  const r = await post(o.org, o.admin, { updateType: "announcement", commentsOff: true });
  viewerId = o.member;
  const reply = await updates.createProjectUpdateCommentAction(o.org, r.success ? r.data!.id : "", "Question?");
  assert.equal(reply.success, false);
});

test("share up: a child post appears under From projects; Private projects and an org switch-off block it", async () => {
  const o = await orgWithChild();
  const shared = await post(o.child, o.member, { content: "Parser passes all tests", shareToOrg: true });
  assert.equal(shared.success, true, JSON.stringify(shared));
  const fromProjects = await feed(o.org, o.other, "from_projects");
  assert.deepEqual(fromProjects!.updates.map((u) => [u.content, u.fromProject?.title ?? null]), [["Parser passes all tests", (await sql`SELECT title FROM projects WHERE id = ${o.child}`)[0]!.title]]);
  await sql`UPDATE projects SET visibility = 'private' WHERE id = ${o.child}`;
  assert.equal((await feed(o.org, o.other, "from_projects"))!.updates.length, 0, "a Private project's posts leave the org feed");
  assert.equal((await post(o.child, o.member, { shareToOrg: true })).success, false);
  await sql`UPDATE projects SET visibility = 'org' WHERE id = ${o.child}`;
  await sql`UPDATE projects SET org_settings = org_settings || '{"childShare": false}'::jsonb WHERE id = ${o.org}`;
  assert.equal((await post(o.child, o.member, { shareToOrg: true })).success, false);
});

test("the pinned org line in a child project, and New markers", async () => {
  const o = await orgWithChild();
  const pinned = await post(o.org, o.admin, { updateType: "announcement", content: "Midterm moved to Nov 10" });
  viewerId = o.admin;
  await updates.toggleProjectUpdatePinAction(o.org, pinned.success ? pinned.data!.id : "", true);
  viewerId = o.member;
  const line = await orgUpdates.readOrgPinnedLineAction(o.child);
  assert.equal(line?.content, "Midterm moved to Nov 10");
  const before = await feed(o.org, o.member);
  assert.equal(before!.lastSeenAt, null);
  assert.equal((await orgUpdates.markOrgUpdatesSeenAction(o.org)).success, true);
  assert.ok((await feed(o.org, o.member))!.lastSeenAt);
});

test("inherited org admins moderate child project updates", async () => {
  const o = await orgWithChild();
  const r = await post(o.child, o.member);
  viewerId = o.admin;
  assert.equal((await updates.deleteProjectUpdateAction(o.child, r.success ? r.data!.id : "")).success, true);
});
