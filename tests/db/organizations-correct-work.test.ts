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

test("problems 23, 34 and 18: only admins edit a main assignment; it has no status of its own; its copies change sprint with it", async () => {
  const o = await org();
  const { master, copyOf } = await published(o, "Lab 10");
  viewerId = o.a;
  assert.equal((await taskActions.updateTaskFieldAction(master, "title", "Renamed by a student", o.org)).success, false, "members can't rename it (problem 23)");
  viewerId = o.admin;
  assert.equal((await taskActions.updateTaskFieldAction(master, "description", "Clearer brief", o.org)).success, true);
  assert.equal((await taskActions.updateTaskStatusAction(master, "done", o.org)).success, false, "no Completed on the main assignment (problem 34)");
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO2', now(), now() + interval '7 days', 'planning') RETURNING id`;
  const moved = await taskActions.updateTaskFieldAction(master, "sprintId", sprint!.id, o.org);
  assert.equal(moved.success, true, "admins put tasks in sprints (problem 31) " + JSON.stringify(moved));
  const [copy] = await sql`SELECT sprint_id FROM tasks WHERE id = ${copyOf(o.a)}`;
  assert.equal(copy!.sprint_id, sprint!.id, "the copies follow (problem 18)");
});

test("problems 20, 23 and decision 85: on a copy the brief and date are set by the organization, hand-in is only through Submit, and approved work is locked", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 11");
  viewerId = o.a;
  assert.equal((await taskActions.updateTaskFieldAction(copyOf(o.a), "title", "My title", o.org)).success, false);
  assert.equal((await taskActions.updateTaskFieldAction(copyOf(o.a), "dueDate", future(), o.org)).success, false);
  assert.equal((await taskActions.updateTaskFieldAction(copyOf(o.a), "priority", "high", o.org)).success, true, "their own priority is fine");
  const dragged = await taskActions.updateTaskStatusAction(copyOf(o.a), "done", o.org);
  assert.deepEqual([dragged.success, (dragged as { error?: string }).error], [false, "Use Submit to hand this in."], "the board can't hand in (problem 20)");
  assert.equal((await taskActions.updateTaskStatusAction(copyOf(o.a), "in_progress", o.org)).success, true);
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  viewerId = o.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(copyOf(o.a), "approve")).success, true);
  viewerId = o.a;
  assert.equal((await taskActions.updateTaskStatusAction(copyOf(o.a), "in_progress", o.org)).success, false, "approved work is locked (85)");
});

test("problems 22 and 32: deleting a main assignment or a copy follows the assignment rule from the task panel", async () => {
  const o = await org();
  const { master, copyOf } = await published(o, "Lab 12");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  viewerId = o.owner;
  const panelDelete = await tasks.deleteTaskAction(master, o.org);
  assert.equal(panelDelete.success, false, "handed-in work blocks deleting the main assignment (problem 22)");
  assert.equal((await tasks.deleteTaskAction(copyOf(o.a), o.org)).success, false, "a handed-in copy can't be deleted (problem 32)");
  const [left] = await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${master} AND deleted_at IS NULL`;
  assert.equal(left!.n, 2, "nothing was removed");
  const fresh = await published(o, "Lab 13");
  assert.equal((await tasks.deleteTaskAction(fresh.master, o.org)).success, true, "with nothing handed in, it goes");
  const [gone] = await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${fresh.master} AND deleted_at IS NULL`;
  assert.equal(gone!.n, 0, "with its copies, not stranding them");
});

test("decision 87 and problem 31: only owners and admins add tasks to an organization's board, and admins can put them in sprints", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.org}, 'CO3', now(), now() + interval '7 days', 'planning') RETURNING id`;
  viewerId = o.a;
  assert.equal((await tasks.createTaskAction({ projectId: o.org, title: "My own todo", status: "todo", priority: "medium" })).success, false, "members don't add to the organization's board");
  viewerId = o.admin;
  const made = await tasks.createTaskAction({ projectId: o.org, title: "Set the quiz", status: "todo", priority: "medium", sprintId: sprint!.id });
  assert.equal(made.success, true, JSON.stringify(made));
});

test("decision 146 guard (41.6): in a normal workspace an admin adds a task to a sprint; a member still can't", async () => {
  const [owner, admin, member] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const project = await sql.begin((tx) => createProject(tx, owner!));
  created.push(project);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${project}, ${owner!}, 'owner'), (${project}, ${admin!}, 'admin'), (${project}, ${member!}, 'member')`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${project}, 'Sprint 1', now(), now() + interval '7 days', 'planning') RETURNING id`;
  viewerId = admin!;
  const made = await tasks.createTaskAction({ projectId: project, title: "Ship it", status: "todo", priority: "medium", sprintId: sprint!.id });
  assert.equal(made.success, true, JSON.stringify(made));
  viewerId = member!;
  assert.equal((await tasks.createTaskAction({ projectId: project, title: "Mine", status: "todo", priority: "medium", sprintId: sprint!.id })).success, false);
  assert.equal((await tasks.createTaskAction({ projectId: project, title: "Mine", status: "todo", priority: "medium" })).success, true, "members still add tasks to a normal board");
});

test("problems 21 and 29: right after Submit, the panel shows nothing changed and Approve there works", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 14");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  viewerId = o.owner;
  const state = await taskActions.getTaskReviewStateAction(copyOf(o.a), o.org);
  assert.equal(state.success && state.changed, false, "Submit saved what was handed in (problem 29)");
  const [row] = await sql`SELECT updated_at FROM tasks WHERE id = ${copyOf(o.a)}`;
  const approved = await taskActions.approveTaskReviewAction(copyOf(o.a), o.org, new Date(row!.updated_at).toISOString());
  assert.equal(approved.success, true, JSON.stringify(approved));
});

test("smaller bug 15: when two admins review at once, the second is told and nothing is written twice", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 15");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  viewerId = o.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(copyOf(o.a), "approve")).success, true);
  viewerId = o.admin;
  const second = await assignments.reviewAssignmentCopyAction(copyOf(o.a), "return", "Redo it");
  assert.equal(second.success, false);
  assert.match((second as { error: string }).error, /^Already reviewed/);
  const [events] = await sql`SELECT count(*)::int AS n FROM task_activity_events WHERE task_id = ${copyOf(o.a)} AND event_type IN ('review_approved', 'changes_requested')`;
  assert.equal(events!.n, 1);
});

test("decision 141: the task panel's Approve and Return on a copy are the queue's review, with its notices", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 16");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  viewerId = o.owner;
  const [row] = await sql`SELECT updated_at FROM tasks WHERE id = ${copyOf(o.a)}`;
  const returned = await taskActions.requestTaskChangesAction(copyOf(o.a), o.org, "Add a test", new Date(row!.updated_at).toISOString());
  assert.equal(returned.success, true, JSON.stringify(returned));
  const [event] = await sql`SELECT payload->>'source' AS source FROM task_activity_events WHERE task_id = ${copyOf(o.a)} AND event_type = 'changes_requested'`;
  assert.equal(event!.source, "assignment_review", "the same path as the review queue");
});

test("problem 36: an organization admin can read and write a group copy's private conversation without joining the workspace", async () => {
  const o = await org();
  const { child, make } = await groupWork(o);
  const copy = await make("Pitch");
  const comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
  viewerId = o.a;
  assert.equal((await comments.createTaskCommentAction(copy, child, "Here's our pitch")).success, true);
  viewerId = o.admin;
  const read = await comments.readTaskDiscussionAction(child, copy);
  assert.equal(read.success, true, JSON.stringify(read).slice(0, 200));
  assert.equal((await comments.createTaskCommentAction(copy, child, "Looks good")).success, true);
});

test("problems 11 and 35 (decision 133): assignment links open the exact copy in the workspace it lives in", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 17");
  const { child, make } = await groupWork(o);
  const group = await make("Demo day");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(group, {})).success, true);
  const { copyWorkspacePath } = await loadAppModule(() => import("../../src/lib/organizations/assignments"));
  const [orgRow] = await sql`SELECT slug FROM workspaces WHERE id = ${o.org}`;
  assert.equal(await copyWorkspacePath(copyOf(o.a)), `/org/${orgRow!.slug ?? o.org}`);
  assert.equal(await copyWorkspacePath(group), `/workspaces/${child}`, "group work lives in its workspace, named by id");
  viewerId = o.owner;
  const queue = await assignments.readReviewQueueAction(o.org);
  const row = queue.success ? queue.rows.find((r) => r.copyId === group) : null;
  assert.equal(row?.href, `/workspaces/${child}?tab=tasks&drawerType=task&drawerId=${group}`, "Open from the queue reaches it (problem 35)");
});

test("security review: work that changed after it was handed in can't be approved; a panel review must name the copy's own workspace", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 18");
  viewerId = o.a;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  await sql`INSERT INTO task_subtasks (task_id, title, position) VALUES (${copyOf(o.a)}, 'Snuck in later', 99)`;
  viewerId = o.owner;
  const approved = await assignments.reviewAssignmentCopyAction(copyOf(o.a), "approve");
  assert.deepEqual([approved.success, (approved as { error?: string }).error], [false, "This changed after it was handed in. Ask them to resubmit."]);
  const other = await sql.begin((tx) => createProject(tx, o.owner));
  created.push(other);
  const [row] = await sql`SELECT updated_at FROM tasks WHERE id = ${copyOf(o.a)}`;
  assert.equal((await taskActions.requestTaskChangesAction(copyOf(o.a), other, "Redo", new Date(row!.updated_at).toISOString())).success, false, "wrong workspace");
});

test("problems 38, 39, 51 and decision 173: files on your own copy can be fixed until Submit; then they're locked for everyone", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 19");
  const mutations = await loadAppModule(() => import("../../src/app/actions/files/mutations"));
  const links = await loadAppModule(() => import("../../src/app/actions/files/links"));
  const fileOn = async (taskId: string, name: string) => (await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, task_id) VALUES (${o.org}, 'file', ${name}, ${"/" + name}, ${taskId}) RETURNING id`)[0]!.id as string;
  const mine = await fileOn(copyOf(o.a), "lab19-a.txt");
  const wrong = await fileOn(copyOf(o.a), "wrong.txt");
  const theirs = await fileOn(copyOf(o.b), "lab19-b.txt");
  const [linked] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path) VALUES (${o.org}, 'file', 'notes.txt', '/notes.txt') RETURNING id`;
  await sql`INSERT INTO task_node_links (task_id, node_id) VALUES (${copyOf(o.a)}, ${linked!.id})`;

  viewerId = o.a;
  const ok = async (p: Promise<unknown>) => p.then(() => true, () => false);
  assert.equal(await ok(mutations.renameNode(mine, "lab19-final.txt", o.org)), true, "rename your own copy's file (problem 51)");
  assert.equal(await ok(mutations.bulkTrashNodes([wrong], o.org)), true, "remove a wrong file (problem 39)");
  assert.equal(await ok(links.unlinkNodeFromTask(copyOf(o.a), linked!.id)), true, "unlink one from your copy");
  assert.equal(await ok(mutations.renameNode(theirs, "mine-now.txt", o.org)), false, "never a classmate's");

  assert.equal((await assignments.submitAssignmentAction(copyOf(o.a), {})).success, true);
  assert.equal(await ok(mutations.renameNode(mine, "after.txt", o.org)), false, "locked once handed in (decision 173)");
  viewerId = o.admin;
  assert.equal(await ok(mutations.bulkTrashNodes([mine], o.org)), false, "admins too (problem 38)");
});

test("problem 50 (decision 157): a full organization never blocks a hand-in; hand-ins have 50 MB per person", async () => {
  const o = await org();
  await published(o, "Lab 20");
  const uploads = await loadAppModule(() => import("../../src/lib/upload/upload-intents"));
  const MB = 1024 ** 2;
  await sql`INSERT INTO storage_quota_scopes (scope_type, scope_id, limit_bytes, retained_bytes) VALUES ('project', ${o.org}, ${50 * 1024 ** 3}, ${5 * 1024 ** 3})
    ON CONFLICT (scope_type, scope_id) DO UPDATE SET retained_bytes = EXCLUDED.retained_bytes`;
  const intent = (userId: string, size: number) => uploads.createUploadIntent({ userId, projectId: o.org, bucket: "project-files",
    storageKey: `${o.org}/${crypto.randomUUID()}.txt`, scope: "workspace_file", kind: "file", expectedMimeType: "text/plain", expectedSize: size, metadata: {} })
    .then(() => true, (error: Error) => error.message);
  assert.equal(await intent(o.a, MB), true, "a member's hand-in goes through");
  assert.notEqual(await intent(o.admin, MB), true, "the organization's own files still stop at 5 GB");
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path) VALUES (${o.org}, 'file', 'big.zip', '/big.zip') RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by) VALUES (${node!.id}, 1, 'k', ${50 * MB}, 'application/zip', ${o.b})`;
  assert.match(String(await intent(o.b, MB)), /50 MB/, "the per-person allowance applies");
});
