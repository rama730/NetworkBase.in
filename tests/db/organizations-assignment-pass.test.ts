import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P17 §16 pass: Remind, steps after publish, teams after publish (move, lock, excuse one), Copy teams from,
// the review queue, the due-date move notice, the returned reason, child team tasks, who ticked a step, the From chip.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.51" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let assignments: typeof import("../../src/app/actions/assignments");
let units: typeof import("../../src/app/actions/child-units");
let subtasks: typeof import("../../src/app/actions/subtask");
let tasksServer: typeof import("../../src/lib/workspaces/server/tasks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  units = await loadAppModule(() => import("../../src/app/actions/child-units"));
  subtasks = await loadAppModule(() => import("../../src/app/actions/subtask"));
  tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const titles = async (userId: string) => (await sql<{ title: string }[]>`SELECT title FROM user_notifications WHERE user_id = ${userId}`).map((r) => r.title);
const future = (days = 7) => new Date(Date.now() + days * 86_400_000).toISOString();

async function org() {
  const [owner, a, b, c, d] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member'), (${id}, ${c!}, 'member'), (${id}, ${d!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', title = 'CSE-3A', join_code = ${generateJoinCode()}, task_review_required = true WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, a: a!, b: b!, c: c!, d: d! };
}

async function publish(o: { id: string; owner: string }, extra: Record<string, unknown>) {
  viewerId = o.owner;
  const r = await assignments.createAssignmentAction({ projectId: o.id, title: "Lab 2", dueDate: future(), publish: true, submissionType: "link", lateRule: "always", steps: ["Write tests"], ...extra } as never);
  viewerId = "";
  assert.ok(r.success, JSON.stringify(r));
  return r.success ? r.masterId : "";
}

const copyOf = async (masterId: string, userId: string) =>
  (await sql`SELECT c.id FROM tasks c LEFT JOIN task_team_members tm ON tm.task_id = c.id WHERE c.assignment_id = ${masterId} AND c.deleted_at IS NULL AND (c.assignee_id = ${userId} OR tm.user_id = ${userId}) LIMIT 1`)[0]?.id as string | undefined;

test("Remind once per 12 hours; a step after publish reaches every copy; a due move tells people", async () => {
  const o = await org();
  const m = await publish(o, { target: { mode: "everyone" } });
  viewerId = o.owner;
  assert.equal((await assignments.remindCopiesAction(m)).success, true);
  await assignments.remindCopiesAction(m);
  assert.equal((await titles(o.a)).filter((t) => t.startsWith("Reminder: Lab 2")).length, 1, "deduped within the window");
  assert.ok((await assignments.addAssignmentStepAction(m, "Push the code")).success);
  const steps = await sql`SELECT count(*)::int AS n FROM task_subtasks s JOIN tasks t ON t.id = s.task_id WHERE (t.id = ${m} OR t.assignment_id = ${m}) AND s.title = 'Push the code'`;
  assert.equal(steps[0]!.n, 5, "the master and four copies");
  assert.ok((await assignments.updateAssignmentAction(m, { dueDate: future(9) })).success);
  viewerId = "";
  assert.ok((await titles(o.b)).some((t) => t.startsWith("Lab 2: due date moved to")));
});

test("teams after publish: move a person, add a late joiner, lock once submitted, excuse one; Copy teams from; the review queue", async () => {
  const o = await org();
  const m = await publish(o, { target: { mode: "teams", teams: [{ name: "Team A", userIds: [o.a, o.b], leadId: o.a }, { name: "Team B", userIds: [o.c], leadId: o.c }], individuals: [] } });
  const teamA = (await copyOf(m, o.a))!;
  const teamB = (await copyOf(m, o.c))!;
  viewerId = o.owner;
  assert.ok((await assignments.moveTeamMemberAction(m, o.b, teamB)).success);
  assert.equal(await copyOf(m, o.b), teamB);
  assert.ok((await titles(o.b)).some((t) => t === "You moved to Team B for Lab 2"));
  // d joined late, outside any team: add them to Team A.
  assert.ok((await assignments.moveTeamMemberAction(m, o.d, teamA)).success);
  assert.equal(await copyOf(m, o.d), teamA);

  viewerId = o.c;
  assert.ok((await assignments.submitAssignmentAction(teamB, { link: "https://example.com/team-b" })).success);
  viewerId = o.owner;
  const locked = await assignments.moveTeamMemberAction(m, o.b, teamA);
  assert.equal(locked.success, false, "Team B submitted, so it is locked");

  assert.ok((await assignments.excuseTeamMemberAction(teamA, o.d, "Medical leave")).success);
  const [excused] = await sql`SELECT excused_reason FROM tasks WHERE assignment_id = ${m} AND assignee_id = ${o.d} AND team_name IS NULL AND deleted_at IS NULL`;
  assert.equal(excused?.excused_reason, "Medical leave");

  const teams = await assignments.readAssignmentTeamsAction(m);
  assert.ok(teams.success);
  assert.deepEqual(teams.success && teams.teams.map((t) => [t.name, t.userIds.length]), [["Team A", 1], ["Team B", 2]]);

  const queue = await assignments.readReviewQueueAction(o.id);
  assert.ok(queue.success && queue.rows.some((r) => r.copyId === teamB && r.who === "Team B" && r.submittedBy));
  const roster = await assignments.readAssignmentRosterAction(m);
  const b = roster.success ? roster.rows.find((r) => r.copyId === teamB) : undefined;
  assert.ok(b?.people?.some((p) => p.lead) && b.submittedBy, JSON.stringify(b));

  assert.ok((await assignments.reviewAssignmentCopyAction(teamB, "return", "add the test cases")).success);
  viewerId = o.c;
  const mine = await assignments.listAssignmentsAction(o.id);
  viewerId = "";
  assert.equal(mine.success && mine.rows.find((r) => r.masterId === m)?.mine?.returnedReason, "add the test cases");
});

test("child team tasks by unit; any teammate ticks a step and it records who; copies carry a From chip on the board", async () => {
  const o = await org();
  const lab = await sql.begin((tx) => createProject(tx, o.a));
  await sql`UPDATE projects SET parent_id = ${o.id}, title = 'Compiler Lab' WHERE id = ${lab}`;
  const [unit] = await sql`INSERT INTO project_open_roles (project_id, role, count, filled, lead_user_id) VALUES (${lab}, 'Frontend', 3, 2, ${o.c}) RETURNING id`;
  await sql`INSERT INTO project_members (project_id, user_id, role, unit_id) VALUES (${lab}, ${o.a}, 'owner', NULL), (${lab}, ${o.b}, 'member', ${unit!.id}), (${lab}, ${o.c}, 'member', ${unit!.id})`;
  viewerId = o.a;
  const made = await units.createTeamTasksAction(lab, { title: "Build the parser", mode: "units" });
  assert.ok(made.success && made.created === 1, JSON.stringify(made));
  const [task] = await sql`SELECT id, assignee_id, team_name FROM tasks WHERE project_id = ${lab} AND team_name = 'Frontend'`;
  assert.equal(task!.assignee_id, o.c, "the unit lead leads the team task");
  assert.ok((await titles(o.b)).includes("You’re in Frontend for Build the parser"));

  const [step] = await sql`INSERT INTO task_subtasks (task_id, title, position) VALUES (${task!.id}, 'Write tests', 0) RETURNING id`;
  viewerId = o.b;
  const ticked = await subtasks.toggleSubtaskAction(step!.id, true, lab);
  assert.equal(ticked.success, true, JSON.stringify(ticked));
  assert.equal((await sql`SELECT completed_by FROM task_subtasks WHERE id = ${step!.id}`)[0]!.completed_by, o.b);

  // The org's group copy shows "From CSE-3A" on the child board.
  const [g] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES (${o.id}, 'Proposal', 'assignment', ${o.owner},
    ${sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "each_child" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id) VALUES (${lab}, 'Proposal', 'task', ${g!.id}, ${o.a}, ${o.owner})`;
  viewerId = o.a;
  const board = await tasksServer.fetchWorkspaceTasksAction(lab, 50);
  viewerId = "";
  assert.ok(board.success);
  const copy = board.success ? board.tasks.find((t) => t.title === "Proposal") : undefined;
  assert.equal(copy?.fromLabel, "CSE-3A");
});
