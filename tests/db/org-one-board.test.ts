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
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
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
