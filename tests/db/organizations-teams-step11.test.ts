import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 11b (report §25.3–25.6, §42.10 problem 17; decisions 45, 46, 138): teams.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.112" }) });

let units: typeof import("../../src/app/actions/child-units");
let members: typeof import("../../src/app/actions/org-members");
let blocking: typeof import("../../src/app/actions/blocking");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  units = await loadAppModule(() => import("../../src/app/actions/child-units"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  blocking = await loadAppModule(() => import("../../src/app/actions/blocking"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [owner, admin, lead, asha, ravi] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${admin!}, 'admin'), (${org}, ${lead!}, 'member'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  const falcon = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  const owl = await sql.begin((tx) => createProject(tx, ravi!, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${org}, title = 'Team Falcon' WHERE id = ${falcon}`;
  await sql`UPDATE workspaces SET parent_id = ${org}, title = 'Team Owl' WHERE id = ${owl}`;
  const [front] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled) VALUES (${falcon}, 'Frontend', 'Frontend', 2, 1) RETURNING id`;
  const [back] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled) VALUES (${falcon}, 'Backend', 'Backend', 2, 0) RETURNING id`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, unit_id) VALUES (${falcon}, ${lead!}, 'owner', null), (${falcon}, ${asha!}, 'member', ${front!.id})`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${owl}, ${ravi!}, 'owner')`;
  created.push(org);
  return { org, falcon, owl, front: front!.id as string, back: back!.id as string, owner: owner!, admin: admin!, lead: lead!, asha: asha!, ravi: ravi! };
}

test("25.3, decision 45: leads and organization admins add and remove teams; removing one keeps its people in the workspace", async () => {
  const t = await setup();
  viewerId = t.lead;
  const made = await units.createUnitAction(t.falcon, { title: "Testing", count: 3 });
  assert.ok(made.success, JSON.stringify(made));
  assert.deepEqual(await units.createUnitAction(t.falcon, { title: "frontend", count: 2 }), { success: false, error: "Another team already has that name." });
  viewerId = t.asha;
  assert.equal((await units.createUnitAction(t.falcon, { title: "Docs", count: 1 })).success, false, "team members can't");
  viewerId = t.admin;
  assert.equal((await units.removeUnitAction(t.falcon, t.front)).success, true);
  const [asha] = await sql`SELECT unit_id FROM workspace_members WHERE workspace_id = ${t.falcon} AND user_id = ${t.asha}`;
  assert.equal(asha!.unit_id, null, "still in the workspace, not in a team");
});

test("problem 17, decision 138: moving someone between teams moves them on open team tasks; they're told", async () => {
  const t = await setup();
  const task = async (team: string, status = "todo") => {
    const [row] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, team_name, status) VALUES (${t.falcon}, ${`${team} task`}, ${t.lead}, ${team}, ${status}) RETURNING id`;
    return row!.id as string;
  };
  const oldOpen = await task("Frontend");
  const oldDone = await task("Frontend", "done");
  const newOpen = await task("Backend");
  await sql`INSERT INTO task_team_members (task_id, user_id) VALUES (${oldOpen}, ${t.asha}), (${oldDone}, ${t.asha})`;
  viewerId = t.lead;
  assert.deepEqual(await units.readTeamMovePreviewAction(t.falcon, t.asha, t.back), { success: true, openTasks: 1 });
  assert.equal((await units.moveMemberToUnitAction(t.falcon, t.asha, t.back, true)).success, true);
  const on = async (id: string) => (await sql`SELECT 1 FROM task_team_members WHERE task_id = ${id} AND user_id = ${t.asha}`).length === 1;
  assert.deepEqual([await on(oldOpen), await on(oldDone), await on(newOpen)], [false, true, true], "handed-in work stays as it was");
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${t.asha} AND title LIKE 'You were moved to Backend%'`;
  assert.ok(notice);
});

test("25.5: organization admins move someone to another workspace; open tasks there are unassigned; the old lead hears only that a seat opened", async () => {
  const t = await setup();
  const [open] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, status) VALUES (${t.falcon}, 'Fix nav', ${t.lead}, ${t.asha}, 'todo') RETURNING id`;
  viewerId = t.asha;
  assert.equal((await members.moveMemberToWorkspaceAction(t.org, t.asha, t.falcon, t.owl, null)).success, false);
  viewerId = t.admin;
  const r = await members.moveMemberToWorkspaceAction(t.org, t.asha, t.falcon, t.owl, null);
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal((await sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${t.falcon} AND user_id = ${t.asha}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${t.owl} AND user_id = ${t.asha}`).length, 1);
  const [task] = await sql`SELECT assignee_id FROM tasks WHERE id = ${open!.id}`;
  assert.equal(task!.assignee_id, null);
  const leadTitles = (await sql`SELECT title FROM user_notifications WHERE user_id = ${t.lead}`).map((n) => n.title as string);
  assert.ok(leadTitles.some((x) => /seat/.test(x)) && !leadTitles.some((x) => x.includes("Team Owl")), JSON.stringify(leadTitles));
});

test("25.5, decision 46: Ask to change team waits in Members → Requests for admins, with Dismiss", async () => {
  const t = await setup();
  viewerId = t.asha;
  assert.equal((await blocking.askToChangeTeamAction(t.falcon)).success, true);
  viewerId = t.admin;
  const roster = await members.readOrgMembersAction(t.org);
  assert.ok(roster.success);
  assert.deepEqual(roster.success && roster.teamChanges.map((c) => [c.userId, c.workspace]), [[t.asha, "Team Falcon"]]);
  assert.equal((await members.dismissTeamChangeAction(t.org, t.asha, t.falcon)).success, true);
  const again = await members.readOrgMembersAction(t.org);
  assert.deepEqual(again.success && again.teamChanges, []);
});

test("25.6: bulk Add into a team checks its seats first", async () => {
  const t = await setup();
  viewerId = t.admin;
  const r = await members.addMembersToChildAction(t.org, t.falcon, [t.ravi, t.lead], t.front);
  assert.deepEqual(r, { success: false, error: "Frontend has 1 open seat. Add seats first, or choose fewer people." });
});
