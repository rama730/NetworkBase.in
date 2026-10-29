import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P17 §15 pass: Notify on start per sprint (with the org default), Move due dates too, cancel tells linked leads,
// the sprint's assignment rows by viewer, and Plan your first sprints in the org wizard.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.41" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let schedule: typeof import("../../src/lib/workspaces/sprint-schedule");
let rows: typeof import("../../src/app/actions/sprint-assignments");
let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  });
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  schedule = await loadAppModule(() => import("../../src/lib/workspaces/sprint-schedule"));
  rows = await loadAppModule(() => import("../../src/app/actions/sprint-assignments"));
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const titles = async (userId: string) => (await sql<{ title: string }[]>`SELECT title FROM user_notifications WHERE user_id = ${userId}`).map((r) => r.title);

async function org(settings: Record<string, unknown> = {}) {
  const [owner, a, b, guest] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${guest!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE-3A', join_code = ${generateJoinCode()}, org_settings = ${sql.json({ version: 1, ...settings })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, a: a!, b: b!, guest: guest! };
}

async function newSprint(projectId: string, as: string, extra: Record<string, unknown> = {}) {
  viewerId = as;
  const result = await sprints.createSprintAction({ projectId, name: `S${Math.random().toString(36).slice(2, 5)}`, startDate: day(1), endDate: day(8), ...extra } as never);
  viewerId = "";
  assert.equal((result as { success: boolean }).success, true, JSON.stringify(result));
  const [row] = await sql`SELECT id, name, notify_on_start FROM workspace_sprints WHERE workspace_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  return row!;
}

test("Notify on start: the org's Work default, overridable per sprint; off means members hear nothing", async () => {
  const o = await org({ sprintNotifyOnStart: false });
  const quiet = await newSprint(o.id, o.owner);
  assert.equal(quiet.notify_on_start, false, "the org default");
  await schedule.startSprint(quiet.id, o.id, new Date(), o.owner, "manual");
  assert.ok(!(await titles(o.a)).some((t) => t.startsWith(`${quiet.name} started`)));
  await sql`UPDATE workspace_sprints SET status = 'completed', completed_at = now() WHERE id = ${quiet.id}`;
  const loud = await newSprint(o.id, o.owner, { notifyOnStart: true, startDate: day(10), endDate: day(17) });
  assert.equal(loud.notify_on_start, true);
  await schedule.startSprint(loud.id, o.id, new Date(), o.owner, "manual");
  assert.ok((await titles(o.a)).includes(`${loud.name} started`));
});

test("Move due dates too shifts the sprint's assignments and their copies; cancel tells linked leads", async () => {
  const o = await org();
  const s = await newSprint(o.id, o.owner);
  const due = new Date(Date.now() + 5 * DAY);
  const [m] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, sprint_id, due_date, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, ${s.id}, ${due},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES (${o.id}, 'Lab 1', 'task', ${m!.id}, ${o.a}, ${o.owner}, ${due})`;
  viewerId = o.owner;
  const moved = await sprints.updateSprintAction({ projectId: o.id, sprintId: s.id, name: s.name, startDate: day(3), endDate: day(10), moveDueDates: true } as never);
  viewerId = "";
  assert.equal((moved as { success: boolean }).success, true, JSON.stringify(moved));
  const after = await sql`SELECT due_date FROM tasks WHERE id = ${m!.id} OR assignment_id = ${m!.id}`;
  for (const r of after) assert.equal(Math.round(((r.due_date as Date).getTime() - due.getTime()) / DAY), 2, "two days later, like the sprint");
  assert.ok((await titles(o.a)).some((t) => t.startsWith("Lab 1 is now due")));

  const lab = await sql.begin((tx) => createProject(tx, o.b));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Compiler Lab' WHERE id = ${lab}`;
  await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, status, start_date, end_date, parent_sprint_id) VALUES (${lab}, 1, 'Week 1', 'planning', ${new Date(Date.now() + 3 * DAY)}, ${new Date(Date.now() + 6 * DAY)}, ${s.id})`;
  viewerId = o.owner;
  const cancelled = await sprints.cancelSprintAction(s.id, o.id);
  viewerId = "";
  assert.equal(cancelled.success, true, JSON.stringify(cancelled));
  assert.ok((await titles(o.b)).includes(`${s.name} was canceled. Week 1 is no longer linked to it`));
  assert.equal((await sql`SELECT parent_sprint_id FROM workspace_sprints WHERE workspace_id = ${lab}`)[0]!.parent_sprint_id, null);
});

test("sprint assignment rows: admin counts and the completed line, guest counts, member their own, child the group copy", async () => {
  const o = await org();
  const s = await newSprint(o.id, o.owner);
  const settings = (mode: string) => sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode }, publishedAt: new Date().toISOString(), closedAt: null });
  const [m] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, sprint_id, due_date, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, ${s.id}, ${new Date(Date.now() - DAY)}, ${settings("everyone")}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, status, due_date) VALUES
    (${o.id}, 'Lab 1', 'task', ${m!.id}, ${o.a}, ${o.owner}, 'done', ${new Date(Date.now() - DAY)}), (${o.id}, 'Lab 1', 'task', ${m!.id}, ${o.b}, ${o.owner}, 'todo', ${new Date(Date.now() - DAY)})`;
  await sql`INSERT INTO workspace_sprint_events (workspace_id, sprint_id, actor_id, event_type, payload) VALUES (${o.id}, ${s.id}, ${o.owner}, 'completed', '{}')`;

  viewerId = o.owner;
  const admin = await rows.readSprintAssignmentsAction(o.id, s.id);
  assert.ok(admin && admin.view === "admin");
  assert.deepEqual([admin.rows[0]!.counts.done, admin.rows[0]!.counts.total, admin.rows[0]!.counts.missing], [1, 2, 1]);
  assert.deepEqual(admin.completed && [admin.completed.assignments, admin.completed.missingPeople], [1, 1]);
  viewerId = o.guest;
  const guest = await rows.readSprintAssignmentsAction(o.id, s.id);
  assert.equal(guest?.view, "guest");
  viewerId = o.b;
  const member = await rows.readSprintAssignmentsAction(o.id, s.id);
  assert.ok(member && member.view === "member");
  assert.equal(member.rows[0]!.state, "missing");

  // The child project's own view of a group copy in its linked sprint.
  const lab = await sql.begin((tx) => createProject(tx, o.a));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${lab}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${lab}, ${o.a}, 'owner')`;
  const [cs] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, status, start_date, end_date) VALUES (${lab}, 1, 'Week 1', 'active', now(), now() + interval '5 days') RETURNING id`;
  const [g] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings) VALUES (${o.id}, 'Proposal', 'assignment', ${o.owner}, ${settings("each_child")}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, sprint_id) VALUES (${lab}, 'Proposal', 'task', ${g!.id}, ${o.a}, ${o.owner}, ${cs!.id})`;
  viewerId = o.a;
  const child = await rows.readSprintAssignmentsAction(lab, cs!.id);
  viewerId = "";
  assert.ok(child && child.view === "child");
  assert.deepEqual([child.orgTitle, child.rows[0]!.title, child.rows[0]!.state], ["CSE-3A", "Proposal", "not_started"]);
});

test("Plan your first sprints in the org wizard creates the planned series", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  viewerId = owner;
  const result = await lifecycle.createWorkspaceAction({
    title: `CSE-3A ${Math.random().toString(36).slice(2, 6)}`, description: "Software engineering, third year, section A.", project_type: "education",
    organization: { org_type: "education", handle: `cse-${Math.random().toString(36).slice(2, 8)}`, join_mode: "instant", child_creation: "members", outside_people: false,
      plan_sprints: { prefix: "CO", count: 3, length_days: 7, start_date: day(2) } },
  } as never);
  viewerId = "";
  assert.equal(result.success, true, JSON.stringify(result));
  created.push(result.project!.id);
  const planned = await sql`SELECT name, status FROM workspace_sprints WHERE workspace_id = ${result.project!.id} ORDER BY start_date`;
  assert.deepEqual(planned.map((r) => `${r.name}:${r.status}`), ["CO1:planning", "CO2:planning", "CO3:planning"]);
});
