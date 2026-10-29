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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.11" }) });

let orgs: typeof import("../../src/app/actions/organizations");
let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
let detail: typeof import("../../src/lib/workspaces/server/detail");
before(async () => {
  // The workspace page reads the session, not just the user: stand the viewer in directly.
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
  detail = await loadAppModule(() => import("../../src/lib/workspaces/server/detail"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM project_invitations WHERE project_id = ${id}`;
    await sql`DELETE FROM role_applications WHERE project_id = ${id}`;
    await sql`DELETE FROM projects WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

type Org = { id: string; owner: string; admin: string; member: string; member2: string; guest: string };

async function org(settings: Record<string, unknown> = {}, visibility = "public"): Promise<Org> {
  const [owner, admin, member, member2, guest] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member'), (${id}, ${member2!}, 'member'), (${id}, ${guest!}, 'viewer')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()},
            org_settings = ${sql.json({ version: 1, childCreation: "members", ...settings })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, member: member!, member2: member2!, guest: guest! };
}

function childInput(o: Org, extra: Record<string, unknown> = {}) {
  return {
    title: `Compiler Lab ${Math.random().toString(36).slice(2, 6)}`,
    description: "A tiny compiler for a C subset, built in weekly sprints.",
    project_type: "education",
    parent_org_id: o.id,
    ...extra,
  } as unknown as Parameters<typeof lifecycle.createWorkspaceAction>[0];
}

async function create(o: Org, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  const result = await lifecycle.createWorkspaceAction(childInput(o, extra));
  if (result.success) created.push(result.project!.id);
  return result;
}

const row = async (id: string) => (await sql`SELECT owner_id, parent_id, visibility, status, org_settings FROM projects WHERE id = ${id}`)[0]!;
const membership = async (projectId: string, userId: string) =>
  (await sql`SELECT role, unit_id FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}`)[0] ?? null;

test("a member creates a child: they lead it, it is Organization, and unit people are invited", async () => {
  const o = await org();
  const result = await create(o, o.member, { roles: [{ role: "Frontend", count: 2, people: [{ user_id: o.member2 }] }] });
  assert.equal(result.success, true, JSON.stringify(result));
  const child = await row(result.project!.id);
  assert.equal(child.owner_id, o.member);
  assert.equal(child.parent_id, o.id);
  assert.equal(child.visibility, "org");
  assert.equal(await membership(result.project!.id, o.member2), null, "invited, not added");
  const [invite] = await sql`SELECT status, role_id FROM project_invitations WHERE project_id = ${result.project!.id} AND candidate_id = ${o.member2}`;
  assert.equal(invite!.status, "pending");
  assert.ok(invite!.role_id, "the invitation carries the unit");
});

test("an admin creates a child with a lead: the lead owns it, people are added into their unit", async () => {
  const o = await org();
  const result = await create(o, o.admin, { lead_user_id: o.member, roles: [{ role: "Testing", count: 1, people: [{ user_id: o.member2 }] }] });
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.project!.id;
  assert.equal((await row(id)).owner_id, o.member);
  const added = await membership(id, o.member2);
  assert.equal(added?.role, "member");
  assert.ok(added?.unit_id, "placed in the unit");
  assert.equal(await membership(id, o.admin), null, "the admin stays an inherited admin, not a member");
});

test("creation rules: Admins only, guests, outsiders and the visibility cap", async () => {
  const o = await org({ childCreation: "admins", visibilityCap: "org" });
  assert.equal((await create(o, o.member)).success, false);
  assert.equal((await create(o, o.guest)).success, false);
  const outsider = await sql.begin((tx) => createUser(tx));
  assert.equal((await create(o, outsider)).success, false);
  const capped = await create(o, o.admin, { visibility: "public" });
  assert.equal(capped.success, true, JSON.stringify(capped));
  assert.equal((await row(capped.project!.id)).visibility, "org", "lowered to the cap");
});

test("Organization children open for org people and inherited admins, not outsiders", async () => {
  const o = await org();
  const result = await create(o, o.member);
  const slug = result.project!.slug!;
  viewerId = o.member2;
  const memberView = await detail.readWorkspaceDetailShell({ slugOrId: slug });
  assert.equal(memberView.success, true, `org member not in the workspace: ${JSON.stringify(memberView).slice(0, 300)}`);
  const outsider = await sql.begin((tx) => createUser(tx));
  viewerId = outsider;
  assert.equal((await detail.readWorkspaceDetailShell({ slugOrId: slug })).success, false);
  await sql`UPDATE projects SET visibility = 'private', status = 'draft' WHERE id = ${result.project!.id}`;
  viewerId = o.admin;
  const shell = await detail.readWorkspaceDetailShell({ slugOrId: slug });
  assert.equal(shell.success, true, `inherited admins read private drafts: ${JSON.stringify(shell)}`);
  assert.equal(shell.success && shell.data.project.parentOrg?.viewerIsInheritedAdmin, true);
  viewerId = o.member2;
  assert.equal((await detail.readWorkspaceDetailShell({ slugOrId: slug })).success, false);
});

test("detach: the lead asks, an inherited admin approves; the workspace becomes Private and personal", async () => {
  const o = await org();
  const result = await create(o, o.member);
  const id = result.project!.id;
  viewerId = o.member;
  assert.equal((await orgs.requestDetachAction(id)).success, true);
  assert.ok((await row(id)).org_settings.detachRequest);
  viewerId = o.member2;
  assert.equal((await orgs.detachChildAction(id)).success, false);
  viewerId = o.admin;
  assert.equal((await orgs.detachChildAction(id)).success, true);
  const after = await row(id);
  assert.equal(after.parent_id, null);
  assert.equal(after.visibility, "private");
  assert.equal(after.org_settings.detachRequest, undefined);
});

test("moving a project in: admins move directly, members ask and an admin approves; outside people block it", async () => {
  const o = await org();
  const own = await sql.begin((tx) => createProject(tx, o.admin));
  created.push(own);
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${own}, ${o.admin}, 'owner')`;
  viewerId = o.admin;
  const moved = await orgs.moveWorkspaceToOrgAction(own, o.id);
  assert.equal(moved.success && moved.outcome, "moved", JSON.stringify(moved));
  assert.equal((await row(own)).parent_id, o.id);
  assert.equal((await row(own)).visibility, "public", "public stays public under a public cap");

  const theirs = await sql.begin((tx) => createProject(tx, o.member));
  created.push(theirs);
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${theirs}, ${o.member}, 'owner')`;
  const stranger = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${theirs}, ${stranger}, 'member')`;
  viewerId = o.member;
  const blocked = await orgs.moveWorkspaceToOrgAction(theirs, o.id);
  assert.equal(blocked.success, false, "outside people are not allowed in this org");
  await sql`DELETE FROM project_members WHERE project_id = ${theirs} AND user_id = ${stranger}`;
  const asked = await orgs.moveWorkspaceToOrgAction(theirs, o.id);
  assert.equal(asked.success && asked.outcome, "requested");
  assert.equal((await row(theirs)).parent_id, null);
  viewerId = o.admin;
  assert.equal((await orgs.approveMoveInAction(theirs)).success, true);
  assert.equal((await row(theirs)).parent_id, o.id);
});

test("tightening the cap lowers existing children, after a preview count", async () => {
  const o = await org();
  const result = await create(o, o.admin, { visibility: "public", lead_user_id: o.member });
  const id = result.project!.id;
  assert.equal((await row(id)).visibility, "public");
  viewerId = o.owner;
  const preview = await orgs.previewVisibilityCapAction(o.id, "org");
  assert.equal(preview.success && preview.affected, 1);
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "projects", { visibility_cap: "org" })).success, true);
  assert.equal((await row(id)).visibility, "org");
  viewerId = o.member;
  assert.equal((await orgs.setChildVisibilityAction(id, "public")).success, false, "the lead cannot go above the cap");
  assert.equal((await orgs.setChildVisibilityAction(id, "private")).success, true);
});

test("leaving the org removes you from its projects; leads hand theirs over first", async () => {
  const o = await org();
  const result = await create(o, o.admin, { lead_user_id: o.member, roles: [{ role: "Docs", count: 1, people: [{ user_id: o.member2 }] }] });
  const id = result.project!.id;
  viewerId = o.member2;
  assert.equal((await orgs.leaveOrgAction(o.id)).success, true);
  assert.equal(await membership(id, o.member2), null);
  viewerId = o.member;
  const lead = await orgs.leaveOrgAction(o.id);
  assert.equal(lead.success, false, "the lead of a child project transfers or detaches it first");
});
