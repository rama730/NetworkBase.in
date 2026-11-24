import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A7.6–A7.7 (report 38.18 W2–W7, calls 1–6): undated steps that never auto-start, lessons in steps,
// everyone's own ticks, Lock in order, Progress for admins only, a public self-paced path without progress.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.181" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let path: typeof import("../../src/app/actions/learning-path");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  path = await loadAppModule(() => import("../../src/app/actions/learning-path"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace(visibility = "private") {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow) VALUES (${ws}, 'learning_path')`;
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

async function build(t: Awaited<ReturnType<typeof workspace>>) {
  viewerId = t.owner;
  const s1 = await path.createStepAction(t.ws, { name: "Basics" });
  const s2 = await path.createStepAction(t.ws, { name: "Projects" });
  assert.ok(s1.success && s2.success);
  const a = await path.addLessonAction(t.ws, { stepId: s1.id, title: "Variables", fields: { minutes: 20 } });
  const b = await path.addLessonAction(t.ws, { stepId: s1.id, title: "Loops" });
  const c = await path.addLessonAction(t.ws, { stepId: s2.id, title: "Build a CLI" });
  assert.ok(a.success && b.success && c.success, JSON.stringify([a, b, c]));
  return { s1: s1.id, s2: s2.id, a: a.id, b: b.id, c: c.id };
}

test("W2/W3 call 2: steps are undated sprints that never auto-start; lessons are class_lesson items off the board; only admins build", async () => {
  const t = await workspace();
  const ids = await build(t);
  const [step] = await sql`SELECT start_date, end_date, auto_start, path_position FROM workspace_sprints WHERE id = ${ids.s1}`;
  assert.deepEqual([step!.start_date, step!.end_date, step!.auto_start, step!.path_position], [null, null, false, 1]);
  const [lesson] = await sql`SELECT item_type, stage, on_board, sprint_id, type_fields FROM tasks WHERE id = ${ids.a}`;
  assert.deepEqual([lesson!.item_type, lesson!.stage, lesson!.on_board, lesson!.sprint_id, lesson!.type_fields.minutes], ["class_lesson", "ready", false, ids.s1, 20]);
  await assert.rejects(sql`UPDATE workspace_sprints SET start_date = now() WHERE id = ${ids.s1}`, /dates_both_or_neither/);
  viewerId = t.member;
  assert.match(errorOf(await path.createStepAction(t.ws, { name: "x" })), /owners and admins/);
  viewerId = t.owner;
  assert.equal((await path.moveStepAction(t.ws, ids.s2, "up")).success, true);
  const read = await path.readPathAction(t.ws);
  assert.deepEqual(read.success && read.steps.map((s) => s.name), ["Projects", "Basics"]);
});

test("W4/W5 calls 1, 3: each person's own ticks, Up next, Lock in order", async () => {
  const t = await workspace();
  const ids = await build(t);
  viewerId = t.member;
  assert.equal((await path.markLessonAction(t.ws, { taskId: ids.a, done: true })).success, true);
  let read = await path.readPathAction(t.ws);
  assert.ok(read.success);
  assert.deepEqual([read.steps[0]!.progress, read.upNext], [{ done: 1, total: 2 }, { stepId: ids.s1, lessonId: ids.b }]);
  viewerId = t.viewer;
  read = await path.readPathAction(t.ws);
  assert.deepEqual(read.success && read.done, [], "ticks are per person");
  viewerId = t.owner;
  await path.setPathSettingsAction(t.ws, { lockInOrder: true });
  viewerId = t.member;
  assert.match(errorOf(await path.markLessonAction(t.ws, { taskId: ids.c, done: true })), /Finish Basics first/);
  await path.markLessonAction(t.ws, { taskId: ids.b, done: true });
  assert.equal((await path.markLessonAction(t.ws, { taskId: ids.c, done: true })).success, true);
  assert.equal((await path.markLessonAction(t.ws, { taskId: ids.c, done: false })).success, true, "undo");
});

test("W6/W7 calls 4–5: Progress for admins only; a public self-paced path shows steps without anyone's progress", async () => {
  const t = await workspace("public");
  const ids = await build(t);
  viewerId = t.member;
  await path.markLessonAction(t.ws, { taskId: ids.a, done: true });
  assert.match(errorOf(await path.readProgressAction(t.ws)), /owners and admins/);
  viewerId = t.owner;
  const progress = await path.readProgressAction(t.ws);
  assert.ok(progress.success);
  const member = progress.people.find((p) => p.id === t.member)!;
  assert.deepEqual(member.cells, [{ done: 1, total: 2 }, { done: 0, total: 1 }]);
  viewerId = t.outsider;
  assert.equal((await path.readPathAction(t.ws)).success, false, "not public yet");
  viewerId = t.owner;
  assert.equal((await path.setPathSettingsAction(t.ws, { public: true })).success, true);
  assert.match(errorOf(await path.setPathSettingsAction(t.ws, { pacing: "scheduled" })), /self-paced/);
  viewerId = t.outsider;
  const pub = await path.readPathAction(t.ws);
  assert.ok(pub.success);
  assert.deepEqual([pub.steps.length, pub.steps[0]!.progress, pub.done, pub.upNext], [2, null, [], null]);
  assert.match(errorOf(await path.markLessonAction(t.ws, { taskId: ids.a, done: true })), /for workspace members/);
});
