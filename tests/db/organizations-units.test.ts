import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P17 §14 pass: unit leads, outside people, org blocks, the cap notice, group copies for a new child,
// Follow org sprints, units after creation, @unit mentions, seats reopening and the Needs your attentionr attention rows.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.31" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
let units: typeof import("../../src/app/actions/child-units");
let orgs: typeof import("../../src/app/actions/organizations");
let comments: typeof import("../../src/app/actions/task-comment");
let sprintsServer: typeof import("../../src/lib/workspaces/server/sprints");
let needsYou: typeof import("../../src/lib/organizations/needs-you");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  });
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
  units = await loadAppModule(() => import("../../src/app/actions/child-units"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
  sprintsServer = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  needsYou = await loadAppModule(() => import("../../src/lib/organizations/needs-you"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM workspace_invitations WHERE workspace_id = ${id}`;
    await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

type Org = { id: string; owner: string; admin: string; a: string; b: string; c: string };
async function org(settings: Record<string, unknown> = {}): Promise<Org> {
  const [owner, admin, a, b, c] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${c!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE-3A', slug = ${`cse-${id.slice(0, 8)}`}, join_code = ${generateJoinCode()},
            org_settings = ${sql.json({ version: 1, childCreation: "members", ...settings })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, a: a!, b: b!, c: c! };
}

async function create(o: Org, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  const result = await lifecycle.createWorkspaceAction({
    title: `Compiler Lab ${Math.random().toString(36).slice(2, 6)}`, description: "A tiny compiler for a C subset, built in weekly sprints.",
    project_type: "education", parent_org_id: o.id, ...extra,
  } as unknown as Parameters<typeof lifecycle.createWorkspaceAction>[0]);
  viewerId = "";
  return result;
}

const titles = async (userId: string) => (await sql<{ title: string }[]>`SELECT title FROM user_notifications WHERE user_id = ${userId}`).map((r) => r.title);

test("an admin's units: the unit lead is stored and told, added people hear it, admins hear the workspace was made", async () => {
  const o = await org();
  const result = await create(o, o.admin, { roles: [{ role: "Frontend developers", count: 3, people: [{ user_id: o.a, label: "A" }, { user_id: o.b, label: "B" }], lead_user_id: o.b }] });
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.project!.id;
  const [unit] = await sql`SELECT team_lead_user_id AS lead_user_id, filled FROM workspace_open_roles WHERE workspace_id = ${id}`;
  assert.equal(unit!.lead_user_id, o.b);
  assert.ok((await titles(o.a)).some((t) => t.startsWith("You were added to Compiler Lab") && t.endsWith("· Frontend developers")));
  assert.ok((await titles(o.b)).includes("You’re team lead of Frontend developers"));
  assert.ok((await titles(o.owner)).some((t) => t.includes("created Compiler Lab")));
  // A lead must sit in the unit.
  const bad = await create(o, o.admin, { roles: [{ role: "Testing", count: 1, people: [{ user_id: o.a }], lead_user_id: o.c }] });
  assert.equal(bad.success, false);
});

test("outside people are invited even by an admin; with the setting off they are left out with a reason; org blocks carry a code", async () => {
  const o = await org({ outsidePeople: true });
  const outsider = await sql.begin((tx) => createUser(tx));
  const result = await create(o, o.admin, { roles: [{ role: "Clients", count: 2, people: [{ user_id: outsider }, { user_id: o.a }] }] });
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.project!.id;
  assert.equal((await sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${outsider}`).length, 0, "not added");
  assert.equal((await sql`SELECT status FROM workspace_invitations WHERE workspace_id = ${id} AND candidate_id = ${outsider}`)[0]?.status, "pending", "invited");
  assert.equal((await sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${o.a}`).length, 1, "org people are added");

  await sql`UPDATE workspaces SET org_settings = org_settings || '{"outsidePeople": false, "visibilityCap": "private"}'::jsonb WHERE id = ${o.id}`;
  const later = await create(o, o.admin, { visibility: "public", roles: [{ role: "Clients", count: 1, people: [{ user_id: outsider }] }] });
  assert.equal(later.success, true, JSON.stringify(later));
  assert.ok(later.notices?.some((n) => n.includes("left out")), JSON.stringify(later.notices));
  assert.ok(later.notices?.some((n) => n.startsWith("Visibility changed by CSE-3A rules")), JSON.stringify(later.notices));

  await sql`UPDATE workspaces SET org_settings = org_settings || '{"childCreation": "admins"}'::jsonb WHERE id = ${o.id}`;
  const blocked = await create(o, o.a);
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, "ORG_BLOCKED");
});

test("a new child gets open 'each project' assignments; it follows org sprints when asked", async () => {
  const o = await org();
  const now = Date.now();
  await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, assignment_settings) VALUES (${o.id}, 'Proposal', 'assignment', ${o.owner}, ${new Date(now + 5 * 86_400_000)},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "each_child" }, publishedAt: new Date().toISOString(), closedAt: null })})`;
  const [co1] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, status, start_date, end_date) VALUES (${o.id}, 1, 'CO1', 'active', ${new Date(now - 86_400_000)}, ${new Date(now + 20 * 86_400_000)}) RETURNING id`;
  const result = await create(o, o.a, { follow_org_sprints: true });
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.project!.id;
  const [copy] = await sql`SELECT assignee_id FROM tasks WHERE workspace_id = ${id} AND assignment_id IS NOT NULL`;
  assert.equal(copy?.assignee_id, o.a, "the lead holds the group copy");
  assert.ok((await titles(o.a)).some((t) => t.includes("Proposal")), "and hears about it");

  viewerId = o.a;
  const sprint = await sprintsServer.createSprintAction({ projectId: id, name: "Lab sprint", startDate: new Date(now).toISOString().slice(0, 10), endDate: new Date(now + 7 * 86_400_000).toISOString().slice(0, 10) } as never);
  viewerId = "";
  assert.equal((sprint as { success: boolean }).success, true, JSON.stringify(sprint));
  const [linked] = await sql`SELECT parent_sprint_id FROM workspace_sprints WHERE workspace_id = ${id}`;
  assert.equal(linked?.parent_sprint_id, co1!.id, "linked to the org sprint holding its dates");
});

test("units after creation: rename, seats, lead, move; @unit reaches the unit; leaving reopens the seat for the lead", async () => {
  const o = await org();
  const result = await create(o, o.admin, { lead_user_id: o.c, roles: [
    { role: "Frontend", count: 2, people: [{ user_id: o.a }] },
    { role: "Testing", count: 1, people: [{ user_id: o.b }] },
  ] });
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.project!.id;
  viewerId = o.c;
  const read = await units.readChildUnitsAction(id);
  assert.ok(read.success);
  // Both teams are made in one statement, so their created times tie: pick them by name.
  const byTitle = (title: string) => (read.success ? read.units : []).find((u) => u.title === title);
  const [frontend, testing] = [byTitle("Frontend"), byTitle("Testing")];
  assert.equal((await units.updateUnitAction(id, frontend!.id, { title: "testing" })).success, false, "names are unique");
  assert.equal((await units.updateUnitAction(id, testing!.id, { count: 0 })).success, false, "never below the people in it");
  assert.equal((await units.moveMemberToUnitAction(id, o.a, testing!.id)).success, false, "Testing is full");
  assert.ok((await units.updateUnitAction(id, testing!.id, { count: 2 })).success);
  assert.ok((await units.moveMemberToUnitAction(id, o.a, testing!.id)).success);
  assert.ok((await units.updateUnitAction(id, testing!.id, { leadUserId: o.a })).success);
  assert.ok((await titles(o.a)).some((t) => t === "You’re team lead of Testing"));
  const after = await sql`SELECT role, filled, team_lead_user_id AS lead_user_id FROM workspace_open_roles WHERE workspace_id = ${id} ORDER BY created_at`;
  assert.deepEqual(after.map((r) => [r.role, r.filled]), [["Frontend", 0], ["Testing", 2]]);

  // @Testing reaches both people in it.
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, creator_id) VALUES (${id}, 'Write tests', ${o.c}) RETURNING id`;
  const posted = await comments.createTaskCommentAction(task!.id, id, `@{${testing!.id}|Testing} please review`);
  viewerId = "";
  assert.equal((posted as { success: boolean }).success, true, JSON.stringify(posted));
  const mentioned = await sql`SELECT mentioned_user_id FROM comment_mentions WHERE comment_id IN (SELECT id FROM task_comments WHERE task_id = ${task!.id})`;
  assert.deepEqual(mentioned.map((r) => r.mentioned_user_id).sort(), [o.a, o.b].sort());

  // b leaves the org: the lead hears a Testing seat opened.
  viewerId = o.b;
  assert.ok((await orgs.leaveOrgAction(o.id)).success);
  viewerId = "";
  assert.ok((await titles(o.c)).includes("1 seat open in Testing"));
});

test("Needs your attentionr attention: a group assignment with no projects to go to", async () => {
  const o = await org();
  await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings) VALUES (${o.id}, 'Mini-project', 'assignment', ${o.owner},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "each_child" }, publishedAt: new Date().toISOString(), closedAt: null })})`;
  const viewer = { userId: o.owner, isAdmin: true, isInside: true, isGuest: false, access: null, org: { id: o.id, title: "CSE-3A", slug: `cse-${o.id.slice(0, 8)}`, status: "active" } } as never;
  const rows = await needsYou.readNeedsYou(viewer, new Date());
  const row = rows.find((r) => r.kind === "needs_projects");
  assert.equal(row?.label, "Mini-project needs workspaces · Create one");
  assert.equal(row?.href, `/workspaces/new?org=cse-${o.id.slice(0, 8)}`);
});
