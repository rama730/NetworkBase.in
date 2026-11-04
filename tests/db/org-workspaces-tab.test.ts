import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Workspaces report (2026-11-04-org-workspaces-tab-findings.md §6–§7): the read carries what Discover's card draws, the
// summary comes from the rows, a quiet workspace's reminder says so and shows when it went, members see their view.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.19" }) });

let dash: typeof import("../../src/app/actions/org-dashboard");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  const viewer = () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true });
  moduleStubs.set("@/lib/server/viewer-context", { ...viewerContext, getViewerAuthContext: async () => viewer(), getViewerIdentityContext: async () => ({ ...viewer(), profile: null }) });
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, lead, helper, member] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const orgId = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${orgId}, ${owner!}, 'owner'), (${orgId}, ${lead!}, 'member'), (${orgId}, ${helper!}, 'member'), (${orgId}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3B' WHERE id = ${orgId}`;
  const lab = await sql.begin((tx) => createProject(tx, lead!, { visibility: "public" }));
  const quiet = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  const shut = await sql.begin((tx) => createProject(tx, lead!, { visibility: "private" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${lab}, ${helper!}, 'member', now() - interval '3 days'), (${lab}, ${lead!}, 'owner', now()), (${quiet}, ${lead!}, 'owner', now()), (${shut}, ${lead!}, 'owner', now())`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = 'Compiler Lab', short_description = 'A tiny compiler', skills = '["React","TypeScript"]'::jsonb, view_count = 42, followers_count = 3, github_repo_url = 'https://github.com/x/lab' WHERE id = ${lab}`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = 'Quiet Lab', updated_at = now() - interval '10 days', created_at = now() - interval '20 days' WHERE id = ${quiet}`;
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = 'Old Lab', status = 'archived', org_settings = jsonb_build_object('archivedBy', jsonb_build_object('userId', ${owner!}::text, 'admin', true, 'at', '2026-11-02T10:00:00.000Z')) WHERE id = ${shut}`;
  created.push(orgId, lab, quiet, shut);
  return { orgId, lab, quiet, shut, owner: owner!, lead: lead!, helper: helper!, member: member! };
}

test("the read carries Discover's card: description, skills, people with the lead first, links, views and followers", async () => {
  const o = await org();
  viewerId = o.owner;
  const read = await dash.readOrgWorkspacesAction(o.orgId);
  assert.ok(read.success, JSON.stringify(read));
  if (!read.success) return;
  const lab = read.rows.find((r) => r.id === o.lab)!;
  assert.equal(lab.description, "A tiny compiler");
  assert.deepEqual(lab.skills, ["React", "TypeScript"]);
  assert.deepEqual(lab.people.map((p) => p.id), [o.lead, o.helper], "the lead first, then who joined first");
  assert.deepEqual([lab.views, lab.followers, lab.githubRepoUrl], [42, 3, "https://github.com/x/lab"]);
  assert.ok(!Number.isNaN(Date.parse(lab.addedAt)));
  const old = read.rows.find((r) => r.id === o.shut)!;
  assert.deepEqual(old.archivedBy, { name: old.archivedBy!.name, admin: true, at: "2026-11-02T10:00:00.000Z" });
});

test("the summary comes from the rows: archived counted apart, quiet inside Needs attention", async () => {
  const o = await org();
  viewerId = o.owner;
  const read = await dash.readOrgWorkspacesAction(o.orgId);
  assert.ok(read.success);
  if (!read.success) return;
  assert.equal(read.summary.total, 2, "archived isn't in All");
  assert.equal(read.summary.archived, 1);
  assert.equal(read.summary.quiet, 1);
  assert.equal(read.summary.attention, read.rows.filter((r) => r.status !== "archived" && r.reasons.length > 0).length);
  assert.equal(read.orgArchived, false);
  assert.equal(read.canAsk, false, "admins create instead");
});

test("Remind lead on a quiet workspace says so, the row shows when, and a second one inside the window is skipped", async () => {
  const o = await org();
  viewerId = o.owner;
  const first = await dash.remindLeadsAction(o.orgId, [o.quiet], "Please post an update");
  assert.deepEqual(first, { success: true, reminded: 1, skipped: 0, ids: [o.quiet] });
  const [note] = await sql`SELECT title, body FROM user_notifications WHERE user_id = ${o.lead} AND title LIKE 'CSE-3B reminded you:%'`;
  assert.match(String(note?.title), /nothing has moved in Quiet Lab for 7 days/);
  assert.equal(note?.body, "Please post an update");
  const read = await dash.readOrgWorkspacesAction(o.orgId);
  assert.ok(read.success && read.rows.find((r) => r.id === o.quiet)!.remindedAt, "remindedAt is set");
  assert.ok(read.success && !read.rows.find((r) => r.id === o.lab)!.remindedAt);
  assert.deepEqual(await dash.remindLeadsAction(o.orgId, [o.quiet]), { success: true, reminded: 0, skipped: 1, ids: [] });
});

test("members: no Private or archived workspaces, no reasons or reminder times, and Ask to add when they can't create", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"childCreation":"admins"}'::jsonb WHERE id = ${o.orgId}`;
  const own = await sql.begin((tx) => createProject(tx, o.member, { visibility: "public" }));
  await sql`UPDATE workspaces SET title = 'My Side Project' WHERE id = ${own}`;
  created.push(own);
  await dash.remindLeadsAction(o.orgId, [o.quiet]).catch(() => undefined);
  viewerId = o.member;
  const read = await dash.readOrgWorkspacesAction(o.orgId);
  assert.ok(read.success);
  if (!read.success) return;
  assert.ok(!read.rows.some((r) => r.id === o.shut), "the private one stays hidden");
  assert.ok(read.rows.every((r) => r.reasons.length === 0 && r.remindedAt === null));
  assert.deepEqual([read.canCreate, read.canAsk, read.summary.attention, read.summary.archived], [false, true, 0, 0]);
  const movable = await dash.readMyMovableWorkspacesAction(o.orgId);
  assert.deepEqual(movable.success ? movable.rows.map((r) => [r.title, r.asked]) : movable, [["My Side Project", false]]);
  viewerId = "";
  assert.equal((await dash.readMyMovableWorkspacesAction(o.orgId)).success, false, "outside people can't");
});
