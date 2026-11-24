import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.1c (report 31.2 C1 call 7): Move to a later cohort keeps finished work, excuses open copies, and joins the
// learner to a later cohort of the same program. Staff of both cohorts only; tokens never.
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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.184" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/cohort-move");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/cohort-move"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("moving a learner excuses open copies, keeps finished ones, makes them a Viewer here and a learner in the later cohort", async () => {
  const [teacher, other, learner] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const make = async (owner: string, title: string, start: string, end: string, program: string | null, max: number | null = null) => {
    const id = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = ${title}, term_start = ${start}, term_end = ${end},
      max_collaborators = ${max == null ? null : String(max)}, org_settings = ${sql.json((program ? { programId: program } : {}) as never)} WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    return id;
  };
  const program = "6b1d0c2e-1111-4a1a-9a1a-0a1b2c3d4e5f";
  const c12 = await make(teacher!, "Cohort 12", "2026-09-01", "2026-12-20", program);
  const c13 = await make(teacher!, "Cohort 13", "2027-01-11", "2027-04-04", program);
  const otherProgram = await make(teacher!, "Data · Cohort 1", "2027-02-01", "2027-05-01", "6b1d0c2e-2222-4a1a-9a1a-0a1b2c3d4e5f");
  const notMine = await make(other!, "Cohort 14", "2027-05-01", "2027-08-01", program);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${c12}, ${learner!}, 'member')`;
  const settings = { version: 1, submissionType: "text", reviewRequired: true, lateRule: "none", lateUntil: null, target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null };
  const [m1] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${c12}, 'Lab 1', 'todo', 'medium', ${teacher!}, 'assignment', ${sql.json(settings as never)}) RETURNING id`;
  const [m2] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${c12}, 'Lab 2', 'todo', 'medium', ${teacher!}, 'assignment', ${sql.json(settings as never)}) RETURNING id`;
  const [finished] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, review_status) VALUES (${c12}, 'Lab 1', 'done', 'medium', ${learner!}, 'task', ${m1!.id}, ${learner!}, 'none') RETURNING id`;
  const [open] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, review_status) VALUES (${c12}, 'Lab 2', 'todo', 'medium', ${learner!}, 'task', ${m2!.id}, ${learner!}, 'none') RETURNING id`;

  viewerId = teacher!;
  const later = await act.readLaterCohortsAction(c12);
  assert.ok(later.success);
  assert.deepEqual(later.cohorts.map((c) => c.title), ["Cohort 13"], "same program, later, and one I teach");
  assert.match((await act.moveToLaterCohortAction(c12, learner!, otherProgram) as { error?: string }).error ?? "", /same program/);
  assert.equal((await act.moveToLaterCohortAction(c12, learner!, notMine)).success, false, "staff of both cohorts only");
  token = "personal";
  assert.equal((await act.moveToLaterCohortAction(c12, learner!, c13)).success, false, "a token never moves anyone");
  token = null;
  viewerId = learner!;
  assert.equal((await act.moveToLaterCohortAction(c12, learner!, c13)).success, false, "learners can't move themselves");
  viewerId = teacher!;
  await sql`UPDATE workspaces SET max_collaborators = '1' WHERE id = ${c13}`;
  assert.match((await act.moveToLaterCohortAction(c12, learner!, c13) as { error?: string }).error ?? "", /full/);
  await sql`UPDATE workspaces SET max_collaborators = NULL WHERE id = ${c13}`;

  assert.deepEqual(await act.moveToLaterCohortAction(c12, learner!, c13), { success: true, excused: 1 });
  const [o] = await sql`SELECT excused_at IS NOT NULL AS excused, excused_reason, deleted_at FROM tasks WHERE id = ${open!.id}`;
  assert.deepEqual([o!.excused, o!.excused_reason, o!.deleted_at], [true, "Moved to Cohort 13", null]);
  const [f] = await sql`SELECT status, excused_at, deleted_at FROM tasks WHERE id = ${finished!.id}`;
  assert.deepEqual([f!.status, f!.excused_at, f!.deleted_at], ["done", null, null], "finished work stays");
  const roles = await sql`SELECT workspace_id, role FROM workspace_members WHERE user_id = ${learner!} ORDER BY role`;
  assert.deepEqual(roles.map((r) => [r.workspace_id, r.role]), [[c13, "member"], [c12, "viewer"]]);
  assert.match((await act.moveToLaterCohortAction(c12, learner!, c13) as { error?: string }).error ?? "", /Only a learner/);
});
