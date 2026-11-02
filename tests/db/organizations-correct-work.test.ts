import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §41.3 deploy 1b (correct work): one test per problem, each failing before its fix.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.15" }) });

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let dash: typeof import("../../src/app/actions/org-dashboard");
let cards: typeof import("../../src/lib/messaging/cards");
let access: typeof import("../../src/lib/data/workspace-access");
let files: typeof import("../../src/lib/files/internal-helpers");
let appDb: typeof import("../../src/lib/db");
let schema: typeof import("../../src/lib/db/schema");
let orm: typeof import("drizzle-orm");
let comments: typeof import("../../src/app/actions/task-comment");
let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let subtasks: typeof import("../../src/app/actions/subtask");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null }),
  });
  comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  subtasks = await loadAppModule(() => import("../../src/app/actions/subtask"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  cards = await loadAppModule(() => import("../../src/lib/messaging/cards"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  files = await loadAppModule(() => import("../../src/lib/files/internal-helpers"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
  schema = await loadAppModule(() => import("../../src/lib/db/schema"));
  orm = await import("drizzle-orm");
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Org = { org: string; owner: string; admin: string; a: string; b: string };

async function org(): Promise<Org> {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, task_review_required = true WHERE id = ${id}`;
  created.push(id);
  return { org: id, owner: owner!, admin: admin!, a: a!, b: b! };
}

const future = () => new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

async function draft(o: Org, title: string) {
  viewerId = o.owner;
  const result = await assignments.createAssignmentAction({ projectId: o.org, title, dueDate: future(), publish: false, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.masterId : "";
}

async function boardTitles(o: Org, as: string) {
  viewerId = as;
  const board = await tasks.fetchWorkspaceTasksAction(o.org);
  assert.equal(board.success, true, JSON.stringify(board));
  return board.success ? board.tasks.map((t) => t.title).sort() : [];
}

async function databaseRule(as: string, taskId: string, orgId: string, path: string) {
  // Browsers can't call nb_org_node_access_ok directly, so only the identity is set: auth.uid() is `as`.
  return inRollback(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: as, role: "authenticated" })}, true)`;
    const [row] = await tx`SELECT app_private.nb_task_visible(${taskId}) AS task, app_private.nb_org_node_access_ok(${orgId}, ${taskId}, ${path}) AS node`;
    return row;
  });
}

async function nodeVisibleTo(o: Org, as: string, nodeId: string) {
  const viewerAccess = await access.getWorkspaceAccessById(o.org, as);
  const { workspaceNodes } = schema;
  const rows = await appDb.db.select({ id: workspaceNodes.id }).from(workspaceNodes)
    .where(orm.and(orm.eq(workspaceNodes.id, nodeId), files.orgFileAccessSql(viewerAccess)));
  return rows.length === 1;
}

async function published(o: Org, title: string) {
  const master = await draft(o, title);
  viewerId = o.owner;
  assert.equal((await assignments.publishAssignmentAction(master)).success, true);
  const rows = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${master}`;
  const copyOf = (user: string) => rows.find((r) => r.assignee_id === user)!.id as string;
  return { master, copyOf };
}

const past = () => new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

test("smaller bugs 1, 4 and 5: excused people leave sprint totals and the review queue; work waiting for review isn't counted as finished", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO1', now() - interval '1 day', now() + interval '6 days', 'active') RETURNING id`;
  viewerId = o.owner;
  const made = await assignments.createAssignmentAction({ projectId: o.org, title: "Lab 6", dueDate: future(), publish: true, submissionType: "none", lateRule: "none", reviewRequired: true,
    target: { mode: "everyone" }, steps: [], sprintId: sprint!.id } as Parameters<typeof assignments.createAssignmentAction>[0]);
  assert.equal(made.success, true, JSON.stringify(made));
  const master = made.success ? made.masterId : "";
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id = ${master}`;
  const copyOf = async (user: string) => (await sql`SELECT id FROM tasks WHERE assignment_id = ${master} AND assignee_id = ${user}`)[0]!.id as string;
  for (const user of [o.a, o.b]) {
    viewerId = user;
    assert.equal((await assignments.submitAssignmentAction(await copyOf(user), {})).success, true);
  }
  viewerId = o.owner;
  assert.equal((await assignments.excuseCopyAction(await copyOf(o.b), "Medical leave")).success, true);

  const { readSprintAssignmentsAction: readSprintAssignmentRowsAction } = await loadAppModule(() => import("../../src/app/actions/sprint-assignments"));
  const rows = await readSprintAssignmentRowsAction(o.org, sprint!.id);
  const row = rows && "rows" in rows ? rows.rows.find((r) => r.masterId === master) : null;
  assert.equal(row?.counts.total, 1, "the excused person leaves the total (smaller bug 1)");

  const queue = await tasks.fetchWorkspaceTasksAction(o.org, 100, undefined, "review");
  assert.deepEqual(queue.success ? queue.tasks.map((t) => t.assigneeId) : null, [o.a], "excused work leaves the review queue (smaller bug 4)");

  const { sprintCompletionLines } = await loadAppModule(() => import("../../src/lib/organizations/sprint-notify"));
  const lines = await sprintCompletionLines(sprint!.id, o.org, "CO1");
  assert.ok(lines.get("CO1 closed · you completed 0 of 1")?.includes(o.a), "waiting for review isn't finished yet (smaller bug 5)");
});

test("problem 4 (decision 124): closing a sprint and moving unfinished work leaves assignments in their sprint", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO1', now() - interval '7 day', now() - interval '1 day', 'active') RETURNING id`;
  const { master, copyOf } = await published(o, "Lab 7");
  await sql`UPDATE tasks SET sprint_id = ${sprint!.id} WHERE id IN (${master}, ${copyOf(o.a)})`;
  const [chore] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id) VALUES (${o.org}, 'Grade quizzes', ${o.owner}, ${sprint!.id}) RETURNING id`;
  viewerId = o.owner;
  const done = await sprints.completeSprintAction(sprint!.id, o.org, { unfinished: "backlog" });
  assert.equal(done.success, true, JSON.stringify(done));
  const where = Object.fromEntries((await sql`SELECT id, sprint_id FROM tasks WHERE id IN (${master}, ${copyOf(o.a)}, ${chore!.id})`).map((r) => [r.id, r.sprint_id]));
  assert.equal(where[master], sprint!.id, "the assignment stays");
  assert.equal(where[copyOf(o.a)], sprint!.id, "and so does its copy");
  assert.equal(where[chore!.id], null, "an unfinished task moves to the backlog");
});

async function groupWork(o: Org) {
  const child = await sql.begin((tx) => createProject(tx, o.a, { visibility: "org" }));
  created.push(child);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${o.a}, 'owner'), (${child}, ${o.b}, 'member')`;
  await sql`UPDATE workspaces SET parent_id = ${o.org} WHERE id = ${child}`;
  viewerId = o.owner;
  const make = async (title: string) => {
    const made = await assignments.createAssignmentAction({ projectId: o.org, title, dueDate: future(), publish: true, submissionType: "none", lateRule: "always", reviewRequired: true,
      target: { mode: "each_child" }, steps: [] } as Parameters<typeof assignments.createAssignmentAction>[0]);
    assert.equal(made.success, true, JSON.stringify(made));
    const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND workspace_id = ${child}`;
    return copy!.id as string;
  };
  return { child, make };
}

test("problem 5 (decision 129): group work follows whoever leads the workspace", async () => {
  const o = await org();
  const { child, make } = await groupWork(o);
  const copy = await make("Proposal");
  const { moveGroupWorkToLead } = await loadAppModule(() => import("../../src/lib/organizations/assignments"));
  const { db } = appDb;
  await moveGroupWorkToLead(db, child, o.b);
  const [row] = await sql`SELECT assignee_id FROM tasks WHERE id = ${copy}`;
  assert.equal(row!.assignee_id, o.b);
  // The organization's own copies belong to people and never move with its owner.
  const { copyOf } = await published(o, "Lab 8");
  await moveGroupWorkToLead(db, o.org, o.admin);
  const [own] = await sql`SELECT assignee_id FROM tasks WHERE id = ${copyOf(o.a)}`;
  assert.equal(own!.assignee_id, o.a);
});

test("problem 5: a lead handed over at account deletion passes group work on, and falls back to the organization's owner", async () => {
  const o = await org();
  const { child, make } = await groupWork(o);
  const copy = await make("Report");
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${child} AND user_id = ${o.b}`;
  const { handOverLedChildWorkspaces } = await loadAppModule(() => import("../../src/lib/organizations/succession"));
  await sql.begin(async () => undefined);
  await handOverLedChildWorkspaces(appDb.db, o.a);
  const [ws] = await sql`SELECT owner_id FROM workspaces WHERE id = ${child}`;
  assert.equal(ws!.owner_id, o.owner, "nobody else on the team: the organization's owner");
  const [row] = await sql`SELECT assignee_id FROM tasks WHERE id = ${copy}`;
  assert.equal(row!.assignee_id, o.owner, "and the group work goes with it");
});

test("problems 6 and 7 (decision 130): detaching keeps handed-in group work on the roster; moving back in brings open group work", async () => {
  const o = await org();
  const { child, make } = await groupWork(o);
  const submitted = await make("Draft 1");
  const open = await make("Draft 2");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(submitted, {})).success, true);
  const { detachFromOrg, moveIntoOrg } = await loadAppModule(() => import("../../src/lib/organizations/children"));
  await detachFromOrg(child);
  const after = Object.fromEntries((await sql`SELECT id, assignment_id FROM tasks WHERE id IN (${submitted}, ${open})`).map((r) => [r.id, r.assignment_id]));
  assert.ok(after[submitted], "handed-in work stays linked, so the roster shows it as Detached");
  assert.equal(after[open], null, "unsubmitted work is released");

  await moveIntoOrg(child, o.org, "private");
  const [count] = await sql`SELECT count(*)::int AS n FROM tasks t JOIN tasks m ON m.id = t.assignment_id WHERE t.workspace_id = ${child} AND m.title = 'Draft 2'`;
  assert.equal(count!.n, 1, "a workspace that moves in gets the open group work (problem 7)");
});

test("problem 26 (decision 143): leaving keeps any copy that was handed in, including Returned work", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 9");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  viewerId = o.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(copyOf(o.a), "return", "Add tests")).success, true);
  const { releaseCopiesOnLeave } = await loadAppModule(() => import("../../src/lib/organizations/assignments"));
  await releaseCopiesOnLeave(appDb.db, o.org, o.a);
  await releaseCopiesOnLeave(appDb.db, o.org, o.b);
  const rows = Object.fromEntries((await sql`SELECT assignee_id, deleted_at FROM tasks WHERE assignment_id = (SELECT assignment_id FROM tasks WHERE id = ${copyOf(o.a)})`).map((r) => [r.assignee_id, r.deleted_at]));
  assert.equal(rows[o.a], null, "Returned work stays");
  assert.ok(rows[o.b], "never-submitted work goes");
});
