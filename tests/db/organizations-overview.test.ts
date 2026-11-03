import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 4 (report §7.2, §26.7, §33.5): Overview's Get started, Today, the class picture, This week and the welcome panel.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let dash: typeof import("../../src/app/actions/org-dashboard");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, welcome_dismissed_at) VALUES (${id}, ${owner}, 'owner', now())`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE 3B', time_zone = 'UTC' WHERE id = ${id}`;
  created.push(id);
  return { id, owner };
}

async function member(orgId: string, joinedDaysAgo = 1) {
  const id = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${orgId}, ${id}, 'member', now() - make_interval(days => ${joinedDaysAgo}))`;
  return id;
}

async function board(orgId: string, as: string) {
  viewerId = as;
  const result = await dash.readOrgDashboardAction(orgId);
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result : null!;
}

test("7.2, decision 7: Get started shows only while the organization is empty", async () => {
  const o = await org();
  assert.deepEqual((await board(o.id, o.owner)).getStarted, ["invite", "sprint", "workspace"]);
  await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.id}, 'CO1', now(), now() + interval '7 days', 'planning')`;
  assert.deepEqual((await board(o.id, o.owner)).getStarted, [], "any real thing ends it");
});

test("33.5, decisions 80 and 81: Today leads with today's deadline and the ending sprint; the class picture counts people", async () => {
  const o = await org();
  const [onTrack, behind, quiet] = [await member(o.id), await member(o.id), await member(o.id, 40)];
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.id}, 'CO3', now() - interval '6 days', now() + interval '20 hours', 'active') RETURNING id`;
  const [due] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, sprint_id, assignment_settings) VALUES (${o.id}, 'Lab 3', 'assignment', ${o.owner}, now() + interval '1 minute', ${sprint!.id}, '{"publishedAt":"2026-11-01T00:00:00Z"}'::jsonb) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id, submission, review_status, review_submitted_at) VALUES (${o.id}, 'Lab 3', ${o.owner}, ${onTrack}, ${due!.id}, '{"version":1}'::jsonb, 'pending', now())`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id) VALUES (${o.id}, 'Lab 3', ${o.owner}, ${behind}, ${due!.id})`;
  const [old] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, sprint_id, assignment_settings) VALUES (${o.id}, 'Lab 2', 'assignment', ${o.owner}, now() - interval '2 days', ${sprint!.id}, '{"publishedAt":"2026-11-01T00:00:00Z"}'::jsonb) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id, due_date) VALUES (${o.id}, 'Lab 2', ${o.owner}, ${behind}, ${old!.id}, now() - interval '2 days')`;
  await sql`UPDATE workspace_members SET last_active_here_at = now() WHERE user_id IN (${onTrack}, ${behind})`;
  const data = await board(o.id, o.owner);
  const labels = data.today.map((r) => r.label);
  assert.equal(labels[0], "Lab 3 due today · 1 of 2 in");
  assert.match(labels[1]!, /^CO3 ends (today|\w{3}) · 1 behind$/);
  // Report §41.4: nobody counts as inactive until 14 days after Last active here shipped (LAST_ACTIVE_HERE_SINCE),
  // so the quiet member is still on track today; the counting itself is unit-tested in organization-overview-rules.
  assert.deepEqual(data.standing, { onTrack: 2, behind: 1, inactive: 0 });
  assert.equal(data.standingWord, "class");
  void quiet;
});

test("parity bug 7: This week keeps something due on the seventh calendar day", async () => {
  const o = await org();
  const day7 = new Date();
  day7.setUTCDate(day7.getUTCDate() + 7);
  day7.setUTCHours(23, 0, 0, 0);
  await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date, assignment_settings) VALUES (${o.id}, 'Quiz 2', 'assignment', ${o.owner}, ${day7}, '{"publishedAt":"2026-11-01T00:00:00Z"}'::jsonb)`;
  const data = await board(o.id, o.owner);
  assert.deepEqual(data.thisWeek.map((c) => [c.label, c.group]), [["Quiz 2 due", "This week"]]);
});

test("26.7, decision 49: the welcome panel shows once after joining and goes for good when closed", async () => {
  const o = await org();
  await sql`UPDATE workspaces SET welcome_note = 'Read the syllabus first.' WHERE id = ${o.id}`;
  const asha = await member(o.id);
  const first = await board(o.id, asha);
  assert.equal(first.welcome?.note, "Read the syllabus first.");
  assert.equal(first.welcome?.addToProfile, true);
  assert.equal((await board(o.id, o.owner)).welcome, null, "the owner made it; they don't get a welcome");
  viewerId = asha;
  assert.equal((await dash.dismissWelcomeAction(o.id)).success, true);
  assert.equal((await board(o.id, asha)).welcome, null);
});

test("mockup task 5: the Overview greets the viewer by first name", async () => {
  const o = await org();
  await sql`UPDATE profiles SET full_name = 'Ramanayudu CH' WHERE id = ${o.owner}`;
  const d = await board(o.id, o.owner);
  assert.match(d.greeting, /^Good (morning|afternoon|evening), Ramanayudu$/);
});

test("student check 8: Welcome's workspace row names open seats or their own workspace, never a dead end", async () => {
  const o = await org();
  const asha = await member(o.id);
  const kinds = async () => (await board(o.id, asha)).welcome?.start.map((s) => `${s.kind}:${s.label}`) ?? [];
  assert.ok(!(await kinds()).some((k) => k.startsWith("workspace")), "no teams with seats: no row to follow");

  const team = await sql.begin((tx) => createProject(tx, o.owner, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon' WHERE id = ${team}`;
  await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled) VALUES (${team}, 'member', 'Falcon', 3, 1)`;
  assert.ok((await kinds()).includes("workspace:Join a workspace · 2 open seats"));

  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${team}, ${asha}, 'member')`;
  assert.ok((await kinds()).includes("own_workspace:Open Team Falcon"), "once in a team, the row opens it");
});

test("33.5: an ended organization shows the term summary: completion for admins, each member's own record", async () => {
  const o = await org();
  const [asha, ravi] = [await member(o.id), await member(o.id)];
  const [lab] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, due_date) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, now() - interval '3 days') RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id, status, completed_at) VALUES (${o.id}, 'Lab 1', ${o.owner}, ${asha}, ${lab!.id}, 'done', now() - interval '4 days')`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, assignment_id) VALUES (${o.id}, 'Lab 1', ${o.owner}, ${ravi}, ${lab!.id})`;
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${o.id}`;
  assert.deepEqual((await board(o.id, o.owner)).termSummary, { completedPercent: 50, mine: null });
  assert.deepEqual((await board(o.id, asha)).termSummary, { completedPercent: null, mine: { done: 1, total: 1 } });
});
