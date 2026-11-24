import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.1b (report 31.2 C1 calls 5–6): a cohort's completion — the rule, overrides with a reason, the verified
// profile entry, and who may read or record it.
let viewerId = "";
let token: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.183" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/cohort-completion");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/cohort-completion"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("completion follows the rule, overrides need a reason, Completed verifies the profile entry, and only staff record it", async () => {
  const [principal, teacher, done, behind] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const school = await sql.begin((tx) => createProject(tx, principal!, { visibility: "private" }));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, institution_id = ${school}, title = 'Cohort 1', term_start = '2026-01-05', term_end = '2026-03-29' WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${done!}, 'member'), (${klass}, ${behind!}, 'member')`;
  for (const u of [done!, behind!]) await sql`INSERT INTO profile_contributions (profile_id, workspace_id, source, visibility) VALUES (${u}, ${klass}, 'membership', 'public')`;
  const settings = { version: 1, submissionType: "text", reviewRequired: true, lateRule: "none", lateUntil: null, target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null };
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Capstone', 'todo', 'medium', ${teacher!}, 'assignment', ${sql.json(settings as never)}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, review_status) VALUES
    (${klass}, 'Capstone', 'done', 'medium', ${done!}, 'task', ${master!.id}, ${done!}, 'none'),
    (${klass}, 'Capstone', 'todo', 'medium', ${behind!}, 'task', ${master!.id}, ${behind!}, 'none')`;

  viewerId = behind!;
  const mine = await act.readCompletionAction(klass);
  assert.ok(mine.success);
  assert.deepEqual(mine.learners.map((l) => l.id), [behind!], "a learner sees only their own");
  assert.equal(mine.line, null);
  assert.equal((await act.recordCompletionAction(klass, [{ userId: behind!, completed: true, reason: "me" }])).success, false, "learners never record");
  assert.equal(await act.readCompletionLineAction(klass), null);

  viewerId = principal!;
  assert.equal((await act.readCompletionAction(klass)).success, false, "the school sees counts, never the cohort's list");

  viewerId = teacher!;
  const all = await act.readCompletionAction(klass);
  assert.ok(all.success && all.open);
  const by = new Map(all.learners.map((l) => [l.id, l]));
  assert.deepEqual([by.get(done!)!.meets, by.get(behind!)!.meets, by.get(behind!)!.reasons], [true, false, ["1 assignment not approved"]]);
  token = "agent";
  assert.equal((await act.recordCompletionAction(klass, [{ userId: done!, completed: true }])).success, false, "a token never records completion");
  token = null;
  assert.match((await act.recordCompletionAction(klass, [{ userId: behind!, completed: true }]) as { error?: string }).error ?? "", /Say why/);
  assert.equal((await act.recordCompletionAction(klass, [{ userId: school, completed: true, reason: "x" }])).success, false, "only learners");
  const r = await act.recordCompletionAction(klass, [{ userId: done!, completed: true }, { userId: behind!, completed: false }]);
  assert.deepEqual(r, { success: true, completed: 1, notCompleted: 1 });
  const [entry] = await sql`SELECT end_reason, ended_by, verified_by, verified_at IS NOT NULL AS verified FROM profile_contributions WHERE profile_id = ${done!} AND workspace_id = ${klass}`;
  assert.deepEqual([entry!.end_reason, entry!.ended_by, entry!.verified_by, entry!.verified], ["completed", teacher!, teacher!, true]);
  const [other] = await sql`SELECT end_reason, verified_at FROM profile_contributions WHERE profile_id = ${behind!} AND workspace_id = ${klass}`;
  assert.deepEqual([other!.end_reason, other!.verified_at], [null, null], "Not completed leaves the entry alone");
  assert.equal(await act.readCompletionLineAction(klass), "Completion 1 of 2");

  // Changing a Completed back to Not completed (with a reason, against the rule) takes the verification away.
  assert.equal((await act.recordCompletionAction(klass, [{ userId: done!, completed: false, reason: "Plagiarism found later" }])).success, true);
  const [undone] = await sql`SELECT end_reason, verified_at FROM profile_contributions WHERE profile_id = ${done!} AND workspace_id = ${klass}`;
  assert.deepEqual([undone!.end_reason, undone!.verified_at], [null, null]);
  const [row] = await sql`SELECT completed, by_rule, override_reason FROM cohort_completions WHERE workspace_id = ${klass} AND user_id = ${done!}`;
  assert.deepEqual([row!.completed, row!.by_rule, row!.override_reason], [false, false, "Plagiarism found later"]);

  // Before the end date, recording waits.
  await sql`UPDATE workspaces SET term_end = (current_date + 30) WHERE id = ${klass}`;
  assert.match((await act.recordCompletionAction(klass, [{ userId: done!, completed: true }]) as { error?: string }).error ?? "", /end date/);
});
