import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 13d (report §25.7, §29.3; decisions 47, 64): groups.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.133" }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let notify: typeof import("../../src/lib/organizations/notify");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  notify = await loadAppModule(() => import("../../src/lib/organizations/notify"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("decision 64: auto-made groups never put a blocked pair together, and nobody is told", async () => {
  const people = await Promise.all([1, 2, 3, 4, 5, 6, 7].map(() => sql.begin((tx) => createUser(tx))));
  const [owner, ...members] = people;
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) SELECT ${org}, unnest(${members}::uuid[]), 'member'`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${members[0]!}, ${members[1]!})`;
  const before = (await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id IN ${sql(members)}`)[0]!.n;
  viewerId = members[2]!;
  assert.equal((await assignments.autoMakeGroupsAction(org, members, 2)).success, false, "admins only");
  viewerId = owner!;
  for (let i = 0; i < 15; i += 1) {
    const made = await assignments.autoMakeGroupsAction(org, members, 2);
    assert.ok(made.success);
    const groups = made.success ? made.groups : [];
    assert.deepEqual(groups.flat().sort(), [...members].sort(), "everyone placed once");
    assert.ok(!groups.some((g) => g.includes(members[0]!) && g.includes(members[1]!)), "kept apart");
  }
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id IN ${sql(members)}`)[0]!.n, before, "quietly");
  // Security review: people outside the organization are dropped, so their blocks are never read.
  const [stranger1, stranger2] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const outside = await assignments.autoMakeGroupsAction(org, [stranger1!, stranger2!], 1);
  assert.deepEqual(outside.success && outside.groups, []);
  assert.equal((await assignments.autoMakeGroupsAction(org, ["not-a-uuid"], 2)).success, false);
});

test("decision 47: a late joiner on group work is listed for the roster and admins are told where to place them", async () => {
  const [owner, asha, ravi, late] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 2", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true, submissionType: "link",
    lateRule: "none", target: { mode: "teams", teams: [{ name: "Group A", userIds: [asha!, ravi!], leadId: asha! }], individuals: [] }, steps: [] });
  assert.ok(made.success, JSON.stringify(made));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${late!}, 'member')`;
  await notify.notifyJoined(org, late!, `joined:${late}`);
  const [notice] = await sql`SELECT title FROM user_notifications WHERE user_id = ${owner!} AND title LIKE '%isn’t in a group for Lab 2'`;
  assert.ok(notice, "the owner is told");
  const roster = await assignments.readAssignmentRosterAction(made.success ? made.masterId : "");
  assert.deepEqual(roster.success && roster.withoutCopy.map((p) => p.userId), [late]);
  const group = roster.success ? roster.rows.find((r) => r.label === "Group A")! : null!;
  assert.equal((await assignments.moveTeamMemberAction(made.success ? made.masterId : "", late!, group.copyId)).success, true, "Add to group");
  assert.equal((await sql`SELECT 1 FROM task_team_members WHERE task_id = ${group.copyId} AND user_id = ${late!}`).length, 1);
});
