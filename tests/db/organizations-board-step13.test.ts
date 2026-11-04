import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 13e (report §16.1; decisions 14, 15, gap 24): one board holding both.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.134" }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let taskActions: typeof import("../../src/app/actions/task");
let subtasks: typeof import("../../src/app/actions/subtask");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  subtasks = await loadAppModule(() => import("../../src/app/actions/subtask"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("decisions 14 and 15: students see only their copy; the assignment card moves by itself and shows class progress", async () => {
  const [owner, asha, ravi, guest] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member'), (${org}, ${guest!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  const board = async (as: string) => { viewerId = as; const r = await tasks.fetchWorkspaceTasksAction(org); assert.ok(r.success); return r.success ? r.tasks : []; };
  const card = async () => (await board(owner!)).find((t) => t.id === masterId)!;

  const asha1 = await board(asha!);
  assert.deepEqual(asha1.map((t) => [t.title, t.assignmentId === masterId]), [["Lab 1", true]], "her copy, not the main one too");
  assert.deepEqual((await board(guest!)).map((t) => t.id), [masterId], "viewers see the main one");
  assert.deepEqual([(await card()).status, (await card()).assignmentProgress], ["todo", { draft: false, closed: false, done: 0, total: 2, toReview: 0, excused: 0, teams: false }]);

  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${asha!}`;
  viewerId = asha!;
  await assignments.submitAssignmentAction(copy!.id, { link: "https://example.com/a" });
  assert.deepEqual([(await card()).status, (await card()).assignmentProgress?.toReview], ["in_progress", 1]);
  viewerId = owner!;
  await assignments.closeAssignmentAction(masterId);
  assert.equal((await card()).status, "done", "closed sits in Completed");
});

test("decision 85: the panel's Hand in shows what's asked, the latest version and whether Submit is open, to its people and admins", async () => {
  const [owner, asha, ravi] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "text", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND assignee_id = ${asha!}`;
  viewerId = asha!;
  const before = await assignments.readHandInAction(copy!.id);
  assert.ok(before.success);
  assert.deepEqual(before.success && [before.handIn.holder, before.handIn.canSubmit, before.handIn.submissionType, before.handIn.from, before.handIn.latest], [true, true, "text", "CSE 3B", null]);
  await assignments.submitAssignmentAction(copy!.id, { text: "My answer", note: "Short one" });
  const after = await assignments.readHandInAction(copy!.id);
  assert.deepEqual(after.success && [after.handIn.state, after.handIn.latest?.version, after.handIn.latest?.text, after.handIn.latest?.note], ["submitted", 1, "My answer", "Short one"]);
  viewerId = ravi!;
  assert.equal((await assignments.readHandInAction(copy!.id)).success, false, "not someone else's");
  viewerId = owner!;
  const admin = await assignments.readHandInAction(copy!.id);
  assert.deepEqual(admin.success && [admin.handIn.holder, admin.handIn.canSubmit], [false, false], "admins read it");
});

test("review ux 1.8, 1.9, 1.13: a main assignment's date edits go through Edit for everyone, its steps reach every copy, and one assignment reads alone", async () => {
  const [owner, asha] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const make = (title: string) => assignments.createAssignmentAction({ projectId: org, title, dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "text", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const one = await make("Lab 1");
  await make("Lab 2");
  const masterId = one.success ? one.masterId : "";
  const field = await taskActions.updateTaskFieldAction(masterId, "dueDate", "2026-12-01", org);
  assert.equal(field.success, false);
  assert.match(String((field as { error?: string }).error), /Edit for everyone/);
  await subtasks.createSubtaskAction(masterId, "Write tests", org);
  const steps = await sql`SELECT t.assignment_id IS NOT NULL AS copy, s.title FROM task_subtasks s JOIN tasks t ON t.id = s.task_id WHERE t.id = ${masterId} OR t.assignment_id = ${masterId}`;
  assert.deepEqual(steps.map((r) => [r.copy, r.title]).sort(), [[false, "Write tests"], [true, "Write tests"]]);
  const list = await assignments.listAssignmentsAction(org, { masterId });
  assert.deepEqual(list.success && list.rows.map((r) => r.title), ["Lab 1"]);
  viewerId = "";
});

test("mockup task 3: the hand-in says who returned it, each file's size, and whether handing in now is late", async () => {
  const [owner, asha] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  await sql`UPDATE profiles SET full_name = 'Ms. Rao' WHERE id = ${owner!}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 2", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "file", reviewRequired: true, lateRule: "always", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${asha!}`;
  await sql`INSERT INTO workspace_nodes (workspace_id, task_id, path, type, name, size, metadata, current_version)
    VALUES (${org}, ${copy!.id}, ${`/.system/tasks/${copy!.id}/lab2.pdf`}, 'file', 'lab2.pdf', 2100000, '{}'::jsonb, 1)`;
  viewerId = asha!;
  assert.equal((await assignments.submitAssignmentAction(copy!.id, {})).success, true);
  viewerId = owner!;
  await assignments.reviewAssignmentCopyAction(copy!.id, "return", "Add the test cases for empty lists.");
  await sql`UPDATE tasks SET due_date = now() - interval '2 days' WHERE id = ${copy!.id}`;
  viewerId = asha!;
  const read = await assignments.readHandInAction(copy!.id);
  assert.ok(read.success);
  const h = read.success ? read.handIn : null!;
  assert.equal(h.returned?.by, "Ms. Rao");
  assert.deepEqual(h.files.map((f) => [f.name, f.size]), [["lab2.pdf", 2100000]]);
  assert.equal(h.latest?.files[0]?.size, 2100000);
  assert.equal(h.wouldBeLate, true, "late work allowed, past due: it will be marked late");
  await sql`UPDATE tasks SET assignment_settings = jsonb_set(assignment_settings, '{lateRule}', '"none"'), submit_until = NULL WHERE id = ${masterId}`;
  await sql`UPDATE tasks SET submit_until = NULL WHERE id = ${copy!.id}`;
  const closed = await assignments.readHandInAction(copy!.id);
  assert.deepEqual(closed.success && [closed.handIn.canSubmit, closed.handIn.wouldBeLate], [false, false], "late work closed: no Submit, nothing to warn");
  viewerId = "";
});

test("mockup task 1: roster rows carry when and which version was handed in, and when the person was last reminded", async () => {
  const [owner, asha, ravi] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 3", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "text", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  const copyOf = async (user: string) => (await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${user}`)[0]!.id as string;
  const [ashaCopy, raviCopy] = [await copyOf(asha!), await copyOf(ravi!)];
  viewerId = asha!;
  await assignments.submitAssignmentAction(ashaCopy, { text: "v1" });
  viewerId = owner!;
  await assignments.reviewAssignmentCopyAction(ashaCopy, "return", "Again");
  viewerId = asha!;
  await assignments.submitAssignmentAction(ashaCopy, { text: "v2" });
  viewerId = owner!;
  await assignments.remindCopiesAction(masterId, [raviCopy]);
  const roster = await assignments.readAssignmentRosterAction(masterId);
  assert.ok(roster.success);
  const byCopy = new Map(roster.success ? roster.rows.map((r) => [r.copyId, r]) : []);
  assert.equal(byCopy.get(ashaCopy)!.version, 2);
  assert.ok(byCopy.get(ashaCopy)!.submittedAt && !Number.isNaN(Date.parse(byCopy.get(ashaCopy)!.submittedAt!)));
  assert.equal(byCopy.get(ashaCopy)!.remindedAt, null);
  assert.ok(byCopy.get(raviCopy)!.remindedAt, "the reminded copy says when");
  // Review UX 1.5: each row carries its person (for the photo) and when the copy last changed.
  assert.equal(byCopy.get(ashaCopy)!.userId, asha!);
  assert.ok("avatarUrl" in byCopy.get(ashaCopy)!);
  assert.ok(!Number.isNaN(Date.parse(byCopy.get(ashaCopy)!.updatedAt)));
  assert.equal(byCopy.get(raviCopy)!.version, null);
  viewerId = "";
});

test("live loop 34: a file removed from returned work leaves the hand-in and the next version", async () => {
  const [owner, asha] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "file", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND assignee_id = ${asha!}`;
  const file = (name: string, metadata: Record<string, string>) => sql`INSERT INTO workspace_nodes (workspace_id, task_id, path, type, name, metadata, current_version)
    VALUES (${org}, ${copy!.id}, ${`/.system/tasks/${copy!.id}/${name}`}, 'file', ${name}, ${sql.json(metadata)}, 1)`;
  await file("lab1-v1.zip", { taskFileDetachedFrom: copy!.id });
  await file("lab1-v2.zip", {});
  viewerId = asha!;
  const read = await assignments.readHandInAction(copy!.id);
  assert.deepEqual(read.success && read.handIn.files.map((f) => f.name), ["lab1-v2.zip"], "a removed file isn't part of the hand-in");
  assert.equal((await assignments.submitAssignmentAction(copy!.id, {})).success, true);
  const after = await assignments.readHandInAction(copy!.id);
  assert.deepEqual(after.success && after.handIn.latest?.files.map((f) => f.name), ["lab1-v2.zip"], "nor of the version handed in");
  viewerId = "";
});

test("problem 19, decision 139: an organization admin not on the team creates, assigns and moves tasks in a workspace", async () => {
  const [owner, admin, lead, member] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${admin!}, 'admin'), (${org}, ${lead!}, 'member'), (${org}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  const child = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${lead!}, 'owner'), (${child}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET parent_id = ${org} WHERE id = ${child}`;
  created.push(org, child);
  const taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  viewerId = admin!;
  const made = await tasks.createTaskAction({ projectId: child, title: "Fix the parser", assigneeId: member!, status: "todo", priority: "medium" } as never);
  assert.equal(made.success, true, JSON.stringify(made));
  const [task] = await sql`SELECT id, assignee_id FROM tasks WHERE workspace_id = ${child} AND title = 'Fix the parser'`;
  assert.equal(task!.assignee_id, member!);
  assert.equal((await taskActions.updateTaskStatusAction(task!.id, "in_progress", child)).success, true, "moves it");
  const [moved] = await sql`SELECT status FROM tasks WHERE id = ${task!.id}`;
  assert.equal(moved!.status, "in_progress");
  const stranger = await sql.begin((tx) => createUser(tx));
  viewerId = stranger;
  assert.equal((await tasks.createTaskAction({ projectId: child, title: "Nope", status: "todo", priority: "medium" } as never)).success, false);
});

test("decisions 68, 113: My work lists handed-in work with its files; the temporary switch gives members the main card back", async () => {
  const [owner, asha] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 9", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "file", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId}`;
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, task_id, created_by) VALUES (${org}, 'file', 'report.pdf', ${`/.system/tasks/${copy!.id}/report.pdf`}, ${copy!.id}, ${asha!})`;
  viewerId = asha!;
  assert.equal((await assignments.submitAssignmentAction(copy!.id, {})).success, true);
  const mine = await assignments.readMySubmissionsAction();
  assert.deepEqual(mine.success && mine.rows.filter((r) => r.title === "Lab 9").map((r) => [r.org, r.version, r.state, r.files.map((f) => f.name)]), [["CSE 3B", 1, "done", ["report.pdf"]]]);
  const ids = async () => { const r = await tasks.fetchWorkspaceTasksAction(org); return r.success ? r.tasks.map((t) => t.id) : []; };
  assert.equal((await ids()).includes(masterId), false);
  process.env.NB_ORG_BOARD_CLASSIC = "true";
  try {
    assert.equal((await ids()).includes(masterId), true, "the switch brings the main card back");
  } finally {
    delete process.env.NB_ORG_BOARD_CLASSIC;
  }
});
