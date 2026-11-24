import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.2a (report 31.3 C2): a class's path — Scheduled until set Self-paced (only before learners join), the
// Teacher builds it, TAs see Progress without editing, learners tick their own and see %, Progress lists learners.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.186" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
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

const err = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("a self-paced class: the Teacher builds Modules, TAs see Progress, learners tick their own and see their %", async () => {
  const [teacher, ta, learner] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin')`;

  viewerId = teacher!;
  const fresh = await path.readPathAction(klass);
  assert.ok(fresh.success && fresh.isClass && fresh.settings.pacing === "scheduled", "a class starts Scheduled");
  viewerId = ta!;
  assert.match(err(await path.setPathSettingsAction(klass, { pacing: "self" })), /Only/, "TAs never edit the path");
  viewerId = teacher!;
  assert.equal((await path.setPathSettingsAction(klass, { pacing: "self", paceWeeks: 1 })).success, true);
  const step = await path.createStepAction(klass, { name: "Module 1" });
  assert.ok(step.success);
  const a = await path.addLessonAction(klass, { stepId: step.id, title: "Variables" });
  const b = await path.addLessonAction(klass, { stepId: step.id, title: "Loops" });
  assert.ok(a.success && b.success);

  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${klass}, ${learner!}, 'member', now() - interval '10 days')`;
  assert.match(err(await path.setPathSettingsAction(klass, { pacing: "scheduled" })), /before the first learner joins/);

  viewerId = learner!;
  assert.equal((await path.createStepAction(klass, { name: "Mine" })).success, false, "learners don't build the path");
  assert.equal((await path.readProgressAction(klass)).success, false, "Progress is for staff");
  assert.equal((await path.markLessonAction(klass, { taskId: a.id, done: true })).success, true);
  const me = await path.readPathAction(klass);
  assert.ok(me.success && me.mine);
  assert.deepEqual([me.mine.percent, me.mine.done, me.mine.total, me.mine.pace], [50, 1, 2, "behind"], "a week per module, 10 days in, Module 1 unfinished");
  const upNext = await path.readMyUpNextAction();
  assert.ok(upNext.success && upNext.items.some((i) => i.workspaceId === klass && i.lesson === "Loops"), "My work shows the class's Up next");

  viewerId = ta!;
  const progress = await path.readProgressAction(klass);
  assert.ok(progress.success && progress.isClass);
  assert.deepEqual(progress.people.map((p) => [p.id, p.percent, p.pace]), [[learner!, 50, "behind"]], "learners only, never staff");
  assert.deepEqual(progress.dropOff?.reached, [1]);
});

test("a school has no path", async () => {
  const [principal] = await Promise.all([1].map(() => sql.begin((tx) => createUser(tx))));
  const school = await sql.begin((tx) => createProject(tx, principal!, { visibility: "private" }));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner')`;
  viewerId = principal!;
  assert.equal((await path.readPathAction(school)).success, false);
});
