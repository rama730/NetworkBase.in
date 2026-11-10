import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Live-fix phase 2 (problems 6 and 9): the Assignments and Mine filters, and only a person's copy is ever reviewed.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.159" }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let taskActions: typeof import("../../src/app/actions/task");
let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let orgWorkspace: typeof import("../../src/app/actions/org-workspace");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  orgWorkspace = await loadAppModule(() => import("../../src/app/actions/org-workspace"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function classWithLab() {
  const [owner, asha] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.ok(made.success);
  return { owner: owner!, asha: asha!, org, masterId: made.success ? made.masterId : "" };
}

test("live-fix 6: Assignments lists only assignment work and Mine only your own", async () => {
  const { owner, asha, org, masterId } = await classWithLab();
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${org} AND status = 'todo' LIMIT 1`;
  await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, assignee_id) VALUES (${org}, ${owner}, 'Plan the rubric', 'todo', ${col!.id}, ${owner})`;
  const titles = async (as: string, scope: "assignments" | "mine") => {
    viewerId = as;
    const r = await tasks.fetchWorkspaceTasksAction(org, 50, undefined, scope);
    assert.ok(r.success);
    return r.success ? r.tasks.map((t) => [t.title, t.id === masterId]) : [];
  };
  assert.deepEqual(await titles(owner, "assignments"), [["Lab 1", true]]);
  assert.deepEqual(await titles(owner, "mine"), [["Plan the rubric", false]]);
  assert.deepEqual(await titles(asha, "assignments"), [["Lab 1", false]], "her copy");
  assert.deepEqual(await titles(asha, "mine"), [["Lab 1", false]]);
});

test("live-fix 9: a main assignment is never reviewed, and admins' In review leaves it out", async () => {
  const { owner, org, masterId } = await classWithLab();
  // The live bad state: the main Lab 1 went through ordinary review before this fix.
  await sql`UPDATE tasks SET status = 'done', review_status = 'pending', review_submitted_at = NOW() WHERE id = ${masterId}`;
  viewerId = owner;
  const [row] = await sql`SELECT updated_at FROM tasks WHERE id = ${masterId}`;
  const at = new Date(row!.updated_at).toISOString();

  const changes = await taskActions.requestTaskChangesAction(masterId, org, "Work is not finished", at);
  assert.deepEqual([changes.success, !changes.success && changes.error], [false, "A main assignment isn’t reviewed. Review each person’s copy from In review."]);
  const approve = await taskActions.approveTaskReviewAction(masterId, org, at);
  assert.deepEqual([approve.success, !approve.success && approve.error], [false, "A main assignment isn’t reviewed. Review each person’s copy from In review."]);

  const review = await tasks.fetchWorkspaceTasksAction(org, 50, undefined, "review");
  assert.ok(review.success);
  assert.equal(review.success && review.tasks.some((t) => t.id === masterId), false);
});

test("live-fix 9, migration 0059: a main assignment's old review state is cleared, its copies keep theirs", async () => {
  const { asha, masterId } = await classWithLab();
  await sql`UPDATE tasks SET review_status = 'rejected', review_submitted_at = NOW(), completed_at = NOW() WHERE id = ${masterId}`;
  await sql`UPDATE tasks SET review_status = 'pending', review_submitted_at = NOW() WHERE assignment_id = ${masterId} AND assignee_id = ${asha}`;
  const { readFileSync } = await import("node:fs");
  await sql.unsafe(readFileSync("drizzle/0059_master_review_cleanup.sql", "utf8"));
  const [master] = await sql`SELECT review_status, review_submitted_at, completed_at FROM tasks WHERE id = ${masterId}`;
  assert.deepEqual([master!.review_status, master!.review_submitted_at, master!.completed_at], ["none", null, null]);
  const [copy] = await sql`SELECT review_status FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${asha}`;
  assert.equal(copy!.review_status, "pending");
});

test("review fix: an admin's Mine includes their own copy of an assignment given to admins", async () => {
  const { owner, org } = await classWithLab();
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Staff survey", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "text", reviewRequired: false, lateRule: "none", target: { mode: "role", role: "admin" }, steps: [] });
  assert.ok(made.success);
  viewerId = owner;
  const r = await tasks.fetchWorkspaceTasksAction(org, 50, undefined, "mine");
  assert.ok(r.success);
  assert.ok(r.success && r.tasks.some((t) => t.title === "Staff survey" && t.assignmentId), "own copy in Mine");
});

test("live-fix 31: in a sprint's work list a main assignment shows class progress, not Unassigned", async () => {
  const { owner, org, masterId } = await classWithLab();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${org}, ${owner}, 'CO1', now() - interval '1 day', now() + interval '13 days', 'active') RETURNING id`;
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id = ${masterId}`;
  await sql`INSERT INTO sprint_task_memberships (workspace_id, sprint_id, task_id, added_at) VALUES (${org}, ${sprint!.id}, ${masterId}, now())`;
  viewerId = owner;
  const r = await sprints.fetchWorkspaceSprintDetailAction({ projectId: org, sprintId: sprint!.id });
  assert.ok(r.success, JSON.stringify(r));
  const row = r.success ? r.data.rows.find((x) => x.kind === "task" && x.task.id === masterId) : undefined;
  assert.ok(row && row.kind === "task");
  assert.deepEqual(row && row.kind === "task" ? row.task.assignmentProgress : null, { done: 0, total: 1, draft: false, scheduled: false, closed: false });
});

test("live-fix 31: a main assignment nobody has yet still shows 0/0 in the sprint list, with the board's column, not Unassigned", async () => {
  const [owner] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${org}, ${owner!}, 'CO1', now() - interval '1 day', now() + interval '13 days', 'active') RETURNING id`;
  // The live state: the main one carried an old "in progress" of its own.
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id}, status = 'in_progress' WHERE id = ${masterId}`;
  await sql`INSERT INTO sprint_task_memberships (workspace_id, sprint_id, task_id, added_at) VALUES (${org}, ${sprint!.id}, ${masterId}, now())`;
  const r = await sprints.fetchWorkspaceSprintDetailAction({ projectId: org, sprintId: sprint!.id });
  const row = r.success ? r.data.rows.find((x) => x.kind === "task" && x.task.id === masterId) : undefined;
  assert.ok(row && row.kind === "task");
  assert.deepEqual(row && row.kind === "task" ? [row.task.assignmentProgress, row.task.status] : null, [{ done: 0, total: 0, draft: false, scheduled: false, closed: false }, "todo"]);
});

test("live-check follow-up: organization search finds the organization's own tasks, by the board's read rule", async () => {
  const { owner, asha, org } = await classWithLab();
  const [col] = await sql`SELECT id FROM workspace_workflow_columns WHERE workspace_id = ${org} AND status = 'todo' LIMIT 1`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, creator_id, title, status, workflow_column_id, assignee_id) VALUES (${org}, ${owner}, 'Prepare the grading rubric', 'todo', ${col!.id}, ${owner}) RETURNING id`;
  viewerId = owner;
  const found = (await orgWorkspace.searchOrgPreviewsAction("rubric", org)).filter((r) => r.kind === "task");
  assert.deepEqual(found.map((r) => [r.title, r.href.includes(`drawerId=${task!.id}`)]), [["Prepare the grading rubric", true]]);
  viewerId = asha;
  assert.equal((await orgWorkspace.searchOrgPreviewsAction("rubric", org)).some((r) => r.kind === "task"), false, "a member sees only their own tasks, as on the board");
});

test("sprint cleanup §4: a main assignment in a sprint counts every stage with names; a student's own row says where they are", async () => {
  const [owner, ...kids] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) SELECT ${org}, u, 'member' FROM unnest(${kids}::uuid[]) u`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 2", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.ok(made.success);
  const masterId = made.success ? made.masterId : "";
  const copyOf = async (u: string) => (await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${u}`)[0]!.id as string;
  const [a, b, c, d] = kids as string[];
  await sql`UPDATE tasks SET status = 'in_progress' WHERE id = ${await copyOf(a!)}`;
  await sql`UPDATE tasks SET status = 'in_progress', review_status = 'pending', review_submitted_at = now() WHERE id = ${await copyOf(b!)}`;
  await sql`UPDATE tasks SET status = 'done', review_status = 'none', review_submitted_at = now(), completed_at = now() WHERE id = ${await copyOf(c!)}`;
  const returned = await copyOf(d!);
  await sql`UPDATE tasks SET status = 'in_progress', review_status = 'rejected', submit_until = now() + interval '2 days' WHERE id = ${returned}`;
  await sql`INSERT INTO task_activity_events (task_id, workspace_id, actor_id, event_type, payload) VALUES (${returned}, ${org}, ${owner!}, 'changes_requested', ${sql.json({ reason: "Fix the README" })})`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, name, start_date, end_date, status) VALUES (${org}, ${owner!}, 'CO1', now() - interval '1 day', now() + interval '13 days', 'active') RETURNING id`;
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id = ${masterId} OR assignment_id = ${masterId}`;
  await sql`INSERT INTO sprint_task_memberships (workspace_id, sprint_id, task_id, added_at) SELECT ${org}, ${sprint!.id}, id, now() FROM tasks WHERE id = ${masterId} OR assignment_id = ${masterId}`;
  const r = await sprints.fetchWorkspaceSprintDetailAction({ projectId: org, sprintId: sprint!.id });
  assert.ok(r.success, JSON.stringify(r));
  const row = r.success ? r.data.rows.find((x) => x.kind === "task" && x.task.id === masterId) : undefined;
  const stages = row && row.kind === "task" ? row.task.assignmentStages : null;
  assert.ok(stages, "stages for the main assignment");
  assert.deepEqual(stages!.counts, { not_started: 1, in_progress: 1, submitted: 1, returned: 1, done: 1, missing: 0, excused: 0 });
  assert.equal(stages!.total, 5);
  assert.equal(stages!.reviewRequired, true);
  assert.equal(stages!.names.submitted.length, 1);
  // Board view dropdown §6a: the board's card reads the same stages, and says who it's for.
  const board = await tasks.fetchWorkspaceTasksAction(org, 50, undefined, "all");
  const card = board.success ? board.tasks.find((t) => t.id === masterId) : undefined;
  assert.deepEqual(card?.assignmentStages, stages, "the card and the sprint list agree");
  assert.deepEqual(card?.audience, { mode: "everyone", count: 5 });
  // The student's own copy says where they are.
  viewerId = d!;
  const mine = await sprints.fetchWorkspaceSprintDetailAction({ projectId: org, sprintId: sprint!.id });
  const own = mine.success ? mine.data.rows.find((x) => x.kind === "task" && x.task.id === returned) : undefined;
  const stage = own && own.kind === "task" ? own.task.copyStage : null;
  assert.equal(stage?.state, "returned");
  assert.equal(stage?.reason, "Fix the README");
  const myBoard = await tasks.fetchWorkspaceTasksAction(org, 50, undefined, "all");
  assert.equal(myBoard.success ? myBoard.tasks.find((t) => t.id === returned)?.copyStage?.state : null, "returned", "the student's own card says where they are");
  assert.ok(stage?.fixBy);
});
