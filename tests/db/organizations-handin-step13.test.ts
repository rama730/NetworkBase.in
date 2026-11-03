import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 13a (report §34.4, §42.5, §42.13, §45.3; decisions 40, 85, 88, 126, 127, 171): handing in.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.130" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let taskActions: typeof import("../../src/app/actions/task");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  taskActions = await loadAppModule(() => import("../../src/app/actions/task"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

async function org() {
  const [owner, admin, asha, ravi, late] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${asha!}, 'member'), (${id}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, asha: asha!, ravi: ravi!, late: late! };
}

/** A published assignment; returns the master and each person's copy. */
async function assign(o: Awaited<ReturnType<typeof org>>, input: { submissionType?: "none" | "file" | "link" | "text"; review?: boolean; due?: Date; lateRule?: "none" | "until" | "always"; lateAfterMinutes?: number } = {}) {
  viewerId = o.owner;
  const made = await assignments.createAssignmentAction({
    projectId: o.id, title: "Lab 1", dueDate: (input.due ?? minutes(60 * 24)).toISOString(), publish: true, submissionType: input.submissionType ?? "link",
    reviewRequired: input.review ?? true, lateRule: input.lateRule ?? "none", target: { mode: "everyone" }, steps: [], ...(input.lateAfterMinutes !== undefined ? { lateAfterMinutes: input.lateAfterMinutes } : {}),
  });
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  const copies = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${masterId}`;
  const copyOf = (user: string) => copies.find((c) => c.assignee_id === user)!.id as string;
  return { masterId, copyOf };
}

const records = (copyId: string) => sql`SELECT version, link, note, late, submitted_by FROM assignment_submissions WHERE copy_id = ${copyId} ORDER BY version`;

test("decisions 85, 127: each hand-in is saved as a version with its note; replace until reviewed; approved stays locked", async () => {
  const o = await org();
  const { copyOf } = await assign(o);
  viewerId = o.asha;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/v1", note: "I used the second dataset" })).success, true);
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/v2" })).success, true, "Replace submission while waiting");
  assert.deepEqual((await records(copyOf(o.asha))).map((r) => [r.version, r.link, r.note, r.submitted_by]), [[1, "https://example.com/v1", "I used the second dataset", o.asha], [2, "https://example.com/v2", null, o.asha]]);
  viewerId = o.admin;
  assert.equal((await assignments.reviewAssignmentCopyAction(copyOf(o.asha), "approve")).success, true);
  viewerId = o.asha;
  assert.deepEqual(await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/v3" }), { success: false, error: "Approved work is locked." });
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/v1", note: "x".repeat(501) })).success, false, "notes up to 500");
});

test("34.4: with no review, done work can be replaced until the due date", async () => {
  const o = await org();
  const { copyOf } = await assign(o, { review: false, due: minutes(30) });
  viewerId = o.asha;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/a" })).success, true);
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/b" })).success, true);
  await sql`UPDATE tasks SET due_date = now() - interval '1 hour' WHERE id = ${copyOf(o.asha)}`;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/c" })).success, false);
});

test("decision 126, problem 8: Return sets a Fix by date, 3 days by default; they resubmit until then, even past due and after Close", async () => {
  const o = await org();
  const { masterId, copyOf } = await assign(o, { due: minutes(5) });
  viewerId = o.asha;
  await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/v1" });
  viewerId = o.admin;
  assert.equal((await assignments.reviewAssignmentCopyAction(copyOf(o.asha), "return", "Add the graphs")).success, true);
  const [copy] = await sql`SELECT due_date, submit_until FROM tasks WHERE id = ${copyOf(o.asha)}`;
  const days = (new Date(copy!.submit_until).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 2.9 && days < 3.1, `Fix by is 3 days out (${days})`);
  assert.equal(new Date(copy!.due_date).getTime(), new Date(copy!.submit_until).getTime(), "the copy's own due date moves to Fix by");
  await sql`UPDATE tasks SET due_date = now() - interval '1 hour' WHERE id = ${masterId}`;
  assert.equal((await assignments.closeAssignmentAction(masterId)).success, true);
  viewerId = o.asha;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/v2" })).success, true);
  const [second] = (await records(copyOf(o.asha))).slice(-1);
  assert.equal(second!.late, false, "Late only after Fix by");
  viewerId = o.ravi;
  assert.deepEqual(await assignments.submitAssignmentAction(copyOf(o.ravi), { link: "https://example.com/r" }), { success: false, error: "This assignment is closed." });
});

test("decision 171: Late after gives 15 minutes by default before Late, and accepts hand-ins in it", async () => {
  const o = await org();
  const { copyOf } = await assign(o, { due: minutes(-10), lateRule: "none" });
  viewerId = o.asha;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/a" })).success, true, "10 minutes after is inside the default 15");
  assert.equal((await records(copyOf(o.asha)))[0]!.late, false);
  const strict = await assign(o, { due: minutes(-10), lateRule: "always", lateAfterMinutes: 0 });
  viewerId = o.asha;
  await assignments.submitAssignmentAction(strict.copyOf(o.asha), { link: "https://example.com/b" });
  assert.equal((await records(strict.copyOf(o.asha)))[0]!.late, true);
  viewerId = o.owner;
  assert.equal((await assignments.createAssignmentAction({ projectId: o.id, title: "Lab 2", dueDate: minutes(60).toISOString(), publish: false, submissionType: "link", lateRule: "none", target: { mode: "everyone" }, steps: [], lateAfterMinutes: 61 })).success, false, "0 to 60");
});

test("decision 40, bug 18: an approved copy can be returned while open; Reopen, and reopen for one person", async () => {
  const o = await org();
  const { masterId, copyOf } = await assign(o);
  viewerId = o.asha;
  await assignments.submitAssignmentAction(copyOf(o.asha), { link: "https://example.com/a" });
  viewerId = o.admin;
  await assignments.reviewAssignmentCopyAction(copyOf(o.asha), "approve");
  assert.match((await assignments.reviewAssignmentCopyAction(copyOf(o.asha), "return", "Wrong file after all") as { error: string }).error, /^Already reviewed/, "a same-moment second review is told");
  assert.equal((await assignments.reviewAssignmentCopyAction(copyOf(o.asha), "return", "Wrong file after all", undefined, { change: true })).success, true, "Change decision");
  const [back] = await sql`SELECT review_status FROM tasks WHERE id = ${copyOf(o.asha)}`;
  assert.equal(back!.review_status, "rejected");
  await assignments.closeAssignmentAction(masterId);
  viewerId = o.ravi;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.ravi), { link: "https://example.com/r" })).success, false);
  viewerId = o.admin;
  assert.equal((await assignments.extendCopyAction(copyOf(o.ravi), minutes(60 * 48).toISOString(), { reopen: true })).success, true);
  viewerId = o.ravi;
  assert.equal((await assignments.submitAssignmentAction(copyOf(o.ravi), { link: "https://example.com/r" })).success, true, "reopened for Ravi only");
  viewerId = o.admin;
  assert.equal((await assignments.reopenAssignmentAction(masterId)).success, true);
  const [master] = await sql`SELECT assignment_settings->>'closedAt' AS closed FROM tasks WHERE id = ${masterId}`;
  assert.equal(master!.closed, null);
});

test("decision 88: Give to makes a copy for someone without one, with a due date, and tells them", async () => {
  const o = await org();
  const { masterId } = await assign(o);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${o.late}, 'member')`;
  viewerId = o.asha;
  assert.equal((await assignments.giveCopyAction(masterId, o.late, minutes(60 * 72).toISOString())).success, false, "admins only");
  viewerId = o.admin;
  assert.equal((await assignments.giveCopyAction(masterId, o.late, minutes(60 * 72).toISOString())).success, true);
  assert.equal((await assignments.giveCopyAction(masterId, o.late, minutes(60 * 72).toISOString())).success, false, "one copy each");
  assert.equal((await sql`SELECT 1 FROM tasks WHERE assignment_id = ${masterId} AND assignee_id = ${o.late} AND deleted_at IS NULL`).length, 1);
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${o.late} AND title LIKE '%Lab 1%'`).length);
});

test("42.18 #5: a normal workspace's review is unchanged: Done waits for review, changes requested, resubmit, approve", async () => {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET task_review_required = true WHERE id = ${ws}`;
  created.push(ws);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, status) VALUES (${ws}, 'Write tests', ${owner!}, ${member!}, 'in_progress') RETURNING id`;
  const id = task!.id as string;
  const state = async () => (await sql`SELECT status, review_status, updated_at FROM tasks WHERE id = ${id}`)[0]!;
  viewerId = member!;
  assert.equal((await taskActions.updateTaskStatusAction(id, "done", ws)).success, true);
  assert.deepEqual([(await state()).status, (await state()).review_status], ["done", "pending"]);
  viewerId = owner!;
  assert.equal((await taskActions.requestTaskChangesAction(id, ws, "Cover the edge cases", new Date((await state()).updated_at).toISOString())).success, true);
  assert.equal((await state()).review_status, "rejected");
  viewerId = member!;
  assert.equal((await taskActions.updateTaskStatusAction(id, "done", ws)).success, true);
  assert.equal((await state()).review_status, "pending");
  viewerId = owner!;
  assert.equal((await taskActions.approveTaskReviewAction(id, ws, new Date((await state()).updated_at).toISOString())).success, true);
  assert.deepEqual([(await state()).status, (await state()).review_status], ["done", "none"]);
});
