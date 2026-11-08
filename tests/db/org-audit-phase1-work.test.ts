import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Org workflow audit 2026-11-09, phase 1: hand-in and review integrity (9.1–9.6, N69) and moving in (N48).

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.37" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let assignments: typeof import("../../src/app/actions/assignments");
let taskActions: typeof import("../../src/app/actions/task");
let scope: typeof import("../../src/lib/workspaces/subtask-write-scope");
let children: typeof import("../../src/lib/organizations/children");
let appDb: typeof import("../../src/lib/db");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
  scope = await loadAppModule(() => import("../../src/lib/workspaces/subtask-write-scope"));
  children = await loadAppModule(() => import("../../src/lib/organizations/children"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [owner, asha, ravi] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: ["Read"] });
  const masterId = made.success ? made.masterId : "";
  const copies = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${masterId}`;
  const copyOf = (u: string) => copies.find((c) => c.assignee_id === u)!.id as string;
  return { org, owner: owner!, asha: asha!, ravi: ravi!, masterId, copyOf };
}
const handIn = async (as: string, copy: string) => {
  viewerId = as;
  const r = await assignments.submitAssignmentAction(copy, { link: "https://example.com/work" });
  assert.equal(r.success, true, JSON.stringify(r));
};

test("9.1: fixing the instructions for everyone keeps waiting hand-ins approvable", async () => {
  const t = await setup();
  await handIn(t.asha, t.copyOf(t.asha));
  viewerId = t.owner;
  assert.equal((await assignments.updateAssignmentAction(t.masterId, { title: "Lab 1 (fixed)", description: "Now with the right link." })).success, true);
  const approved = await assignments.reviewAssignmentCopyAction(t.copyOf(t.asha), "approve");
  assert.equal(approved.success, true, JSON.stringify(approved));
});

test("9.2: a step added later reaches open copies only", async () => {
  const t = await setup();
  await handIn(t.asha, t.copyOf(t.asha));
  viewerId = t.owner;
  assert.equal((await assignments.addAssignmentStepAction(t.masterId, "Reflect")).success, true);
  const steps = async (id: string) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM task_subtasks WHERE task_id = ${id}`)[0]!.n;
  assert.equal(await steps(t.copyOf(t.asha)), 1, "handed in: keeps its one step");
  assert.equal(await steps(t.copyOf(t.ravi)), 2, "still open: gets the new step");
  assert.equal((await assignments.reviewAssignmentCopyAction(t.copyOf(t.asha), "approve")).success, true);
});

test("9.3: the holder can't change steps on handed-in work", async () => {
  const t = await setup();
  const copy = t.copyOf(t.asha);
  await handIn(t.asha, copy);
  await assert.rejects(appDb.db.transaction((tx) => scope.lockSubtaskWriteScope(tx, { taskId: copy }, t.org, t.asha)), /steps are locked/);
  viewerId = t.owner;
  await assignments.reviewAssignmentCopyAction(copy, "return", "Add more");
  await appDb.db.transaction((tx) => scope.lockSubtaskWriteScope(tx, { taskId: copy }, t.org, t.asha));
});

test("9.4, N69: teammates handing in at once get two versions; approved work can't be handed in again", async () => {
  const t = await setup();
  const copy = t.copyOf(t.asha);
  await sql`INSERT INTO task_team_members (task_id, user_id) VALUES (${copy}, ${t.ravi})`;
  viewerId = t.asha;
  const both = await Promise.all([
    assignments.submitAssignmentAction(copy, { link: "https://example.com/a" }),
    (async () => { await new Promise((r) => setTimeout(r, 5)); return assignments.submitAssignmentAction(copy, { link: "https://example.com/b" }); })(),
  ]);
  assert.deepEqual(both.map((r) => r.success), [true, true], JSON.stringify(both));
  const versions = await sql<{ version: number }[]>`SELECT version FROM assignment_submissions WHERE copy_id = ${copy} ORDER BY version`;
  assert.deepEqual(versions.map((v) => v.version), [1, 2]);
  viewerId = t.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(copy, "approve")).success, true);
  viewerId = t.asha;
  assert.deepEqual(await assignments.submitAssignmentAction(copy, { link: "https://example.com/c" }), { success: false, error: "Approved work is locked." });
});

test("9.6: resubmit on an assignment copy goes back through Hand in", async () => {
  const t = await setup();
  const copy = t.copyOf(t.asha);
  await handIn(t.asha, copy);
  const [row] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM tasks WHERE id = ${copy}`;
  viewerId = t.asha;
  const resubmitted = await taskActions.resubmitTaskReviewAction(copy, t.org, row!.updated_at.toISOString()).catch((e: Error) => ({ success: false, error: e.message }));
  assert.equal((resubmitted as { success: boolean }).success, false);
  assert.match(JSON.stringify(resubmitted), /Use Hand in/);
});

test("N48: moving a workspace into an organization is all or nothing", async () => {
  const t = await setup();
  const lead = await sql.begin((tx) => createUser(tx));
  const personal = await sql.begin((tx) => createProject(tx, lead));
  created.push(personal);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${personal}, ${lead}, 'owner')`;
  await assert.rejects(children.moveIntoOrg(personal, "00000000-0000-4000-8000-000000000000", "private"));
  const [after] = await sql`SELECT parent_id FROM workspaces WHERE id = ${personal}`;
  assert.equal(after!.parent_id, null, "a failed move leaves it where it was");
  await children.moveIntoOrg(personal, t.org, "public");
  const [moved] = await sql`SELECT parent_id FROM workspaces WHERE id = ${personal}`;
  assert.equal(moved!.parent_id, t.org);
});
