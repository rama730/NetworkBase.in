import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Org workflow audit 2026-11-09, phase 5: workflow fixes and decision D-A.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.61" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let members: typeof import("../../src/app/actions/org-members");
let dashboard: typeof import("../../src/app/actions/org-dashboard");
let orgs: typeof import("../../src/app/actions/organizations");
let units: typeof import("../../src/app/actions/child-units");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  dashboard = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  units = await loadAppModule(() => import("../../src/app/actions/child-units"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const user = () => sql.begin((tx) => createUser(tx));
async function org() {
  const owner = await user();
  const id = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  created.push(id);
  return { id, owner };
}
async function child(orgId: string, lead: string) {
  const id = await sql.begin((tx) => createProject(tx, lead));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${lead}, 'owner') ON CONFLICT DO NOTHING`;
  await sql`UPDATE workspaces SET parent_id = ${orgId} WHERE id = ${id}`;
  return id;
}

test("D-A: members see the organization's people, read-only; viewers don't", async () => {
  const o = await org();
  const [member, viewer] = [await user(), await user()];
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, title) VALUES (${o.id}, ${member}, 'member', 'Section B'), (${o.id}, ${viewer}, 'viewer', NULL)`;
  viewerId = member;
  const people = await dashboard.readOrgPeopleAction(o.id);
  assert.equal(people.success, true);
  const rows = people.success ? people.people : [];
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.id, o.owner, "the owner first");
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["avatarUrl", "id", "name", "role", "title"], "no email, work or activity");
  assert.ok(rows.some((r) => r.role === "Student" && r.title === "Section B"), "the organization's own role names");
  viewerId = viewer;
  assert.equal((await dashboard.readOrgPeopleAction(o.id)).success, false);
});

test("6.4: renaming a team carries its open team tasks", async () => {
  const o = await org();
  const lead = await user();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${lead}, 'member')`;
  const ws = await child(o.id, lead);
  const [team] = await sql<{ id: string }[]>`INSERT INTO workspace_open_roles (workspace_id, role, title, count) VALUES (${ws}, 'Frontend', 'Frontend', 3) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, status, task_number, team_name) VALUES (${ws}, 'Build nav', 'todo', 1, 'Frontend')`;
  viewerId = lead;
  assert.equal((await units.updateUnitAction(ws, team!.id, { title: "Web" })).success, true);
  const [task] = await sql<{ team_name: string }[]>`SELECT team_name FROM tasks WHERE workspace_id = ${ws}`;
  assert.equal(task!.team_name, "Web");
});

test("6.6, 6.1: an archived workspace can't move in; a lead who left can be replaced", async () => {
  const o = await org();
  const lead = await user();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${lead}, 'admin')`;
  const personal = await sql.begin((tx) => createProject(tx, lead));
  created.push(personal);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${personal}, ${lead}, 'owner')`;
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${personal}`;
  viewerId = lead;
  assert.deepEqual(await orgs.moveWorkspaceToOrgAction(personal, o.id), { success: false, error: "Unarchive this workspace before moving it." });

  const gone = await user();
  const next = await user();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${next}, 'member')`;
  const ws = await child(o.id, gone);
  viewerId = o.owner;
  const assigned = await orgs.assignChildLeadAction(ws, next);
  assert.equal(assigned.success, true, JSON.stringify(assigned));
  const [row] = await sql<{ owner_id: string }[]>`SELECT owner_id FROM workspaces WHERE id = ${ws}`;
  assert.equal(row!.owner_id, next);
});
