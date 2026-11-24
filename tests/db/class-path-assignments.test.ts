import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.2b (report 31.3 calls 4, 6, 8): in a self-paced class an assignment placed in a module gets no copies when
// published; a learner's copy is made when they open the module, due N days from then; the path's steps (lessons and
// assignments, Excused left out) make the %, and completion follows the path.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.187" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let path: typeof import("../../src/app/actions/learning-path");
let publish: typeof import("../../src/lib/organizations/assignment-publish");
let completion: typeof import("../../src/app/actions/cohort-completion");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  path = await loadAppModule(() => import("../../src/app/actions/learning-path"));
  publish = await loadAppModule(() => import("../../src/lib/organizations/assignment-publish"));
  completion = await loadAppModule(() => import("../../src/app/actions/cohort-completion"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("copies wait for the module to open, are due from then, and the path decides % and completion", async () => {
  const [teacher, learner] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner')`;
  viewerId = teacher!;
  assert.equal((await path.setPathSettingsAction(klass, { pacing: "self" })).success, true);
  const m1 = await path.createStepAction(klass, { name: "Module 1" });
  const m2 = await path.createStepAction(klass, { name: "Module 2" });
  assert.ok(m1.success && m2.success);
  const lesson = await path.addLessonAction(klass, { stepId: m1.id, title: "Variables" });
  assert.ok(lesson.success);
  const settings = { version: 1, submissionType: "text", reviewRequired: false, lateRule: "none", lateUntil: null, target: { mode: "everyone" }, publishedAt: null, closedAt: null };
  const [hw] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, sprint_id, assignment_settings) VALUES (${klass}, 'Exercise 1', 'todo', 'medium', ${teacher!}, 'assignment', ${m2.id}, ${sql.json(settings as never)}) RETURNING id`;
  assert.equal((await path.placeAssignmentAction(klass, { assignmentId: hw!.id, stepId: m2.id, dueAfterDays: 7 })).success, true);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${learner!}, 'member')`;

  await publish.publishMaster(hw!.id, teacher!);
  const copiesOf = async () => sql`SELECT id, due_date, status FROM tasks WHERE assignment_id = ${hw!.id} AND assignee_id = ${learner!} AND deleted_at IS NULL`;
  assert.equal((await copiesOf()).length, 0, "no copy before the module is opened");

  viewerId = learner!;
  const before = await path.readPathAction(klass);
  assert.ok(before.success && before.mine);
  assert.deepEqual([before.mine.done, before.mine.total], [0, 2], "a lesson and an assignment are the path's steps");
  assert.equal((await path.openModuleAction(klass, m2.id)).success, true);
  assert.equal((await path.openModuleAction(klass, m2.id)).success, true, "opening twice makes one copy");
  const [copy] = await copiesOf();
  assert.equal((await copiesOf()).length, 1);
  const days = (new Date(copy!.due_date as string).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.9 && days < 7.1, "due 7 days after opening");

  assert.equal((await path.markLessonAction(klass, { taskId: lesson.id, done: true })).success, true);
  await sql`UPDATE tasks SET status = 'done', completed_at = now() WHERE id = ${copy!.id}`;
  const after = await path.readPathAction(klass);
  assert.ok(after.success && after.mine);
  assert.deepEqual([after.mine.done, after.mine.total, after.mine.percent], [2, 2, 100]);

  // Completion follows the path in a self-paced class (no attendance).
  viewerId = teacher!;
  const c = await completion.readCompletionAction(klass);
  assert.ok(c.success);
  assert.deepEqual(c.learners.map((l) => [l.required, l.approved, l.meets]), [[2, 2, true]]);

  // An excused copy leaves the count.
  await sql`UPDATE tasks SET status = 'todo', excused_at = now() WHERE id = ${copy!.id}`;
  viewerId = learner!;
  const excused = await path.readPathAction(klass);
  assert.ok(excused.success && excused.mine);
  assert.deepEqual([excused.mine.done, excused.mine.total], [1, 1]);
});
