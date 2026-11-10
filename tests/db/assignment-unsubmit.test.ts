import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Taking back a hand-in (`nb assignment unsubmit`, the app's Take back): the holder's copy goes back to In progress
// before anyone reviews it; the submission history stays, and approved work stays locked.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.136" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function lab(reviewRequired: boolean) {
  const [owner, asha, ravi] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired, lateRule: "none", target: { mode: "everyone" }, steps: ["Write"] });
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  const copies = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${masterId}`;
  return { owner: owner!, asha: asha!, ravi: ravi!, copy: copies.find((c) => c.assignee_id === asha)!.id as string };
}

const state = async (copyId: string) => (await sql`SELECT status, review_status, submission, completed_at FROM tasks WHERE id = ${copyId}`)[0]!;

test("the holder takes back a hand-in waiting for review: In progress, out of the queue, history kept, next hand-in is v2", async () => {
  const t = await lab(true);
  viewerId = t.asha;
  assert.equal((await assignments.submitAssignmentAction(t.copy, { link: "https://example.com/a" })).success, true);
  assert.equal((await state(t.copy)).review_status, "pending");

  viewerId = t.ravi;
  assert.equal((await assignments.unsubmitAssignmentAction(t.copy)).success, false, "only the copy's holder or team");

  viewerId = t.asha;
  const back = await assignments.unsubmitAssignmentAction(t.copy);
  assert.equal(back.success, true, JSON.stringify(back));
  const after1 = await state(t.copy);
  assert.deepEqual([after1.status, after1.review_status, after1.submission, after1.completed_at], ["in_progress", "none", null, null]);
  const [history] = await sql`SELECT count(*)::int AS n FROM assignment_submissions WHERE copy_id = ${t.copy}`;
  assert.equal(history!.n, 1, "the handed-in version is kept");
  assert.equal((await assignments.unsubmitAssignmentAction(t.copy)).success, false, "nothing handed in to take back");

  assert.equal((await assignments.submitAssignmentAction(t.copy, { link: "https://example.com/b" })).success, true);
  const [again] = await sql`SELECT submission->>'version' AS v FROM tasks WHERE id = ${t.copy}`;
  assert.equal(again!.v, "2");
});

test("approved work can't be taken back; done work without review can, until it's due", async () => {
  const reviewed = await lab(true);
  viewerId = reviewed.asha;
  await assignments.submitAssignmentAction(reviewed.copy, { link: "https://example.com/a" });
  viewerId = reviewed.owner;
  assert.equal((await assignments.reviewAssignmentCopyAction(reviewed.copy, "approve")).success, true);
  viewerId = reviewed.asha;
  const locked = await assignments.unsubmitAssignmentAction(reviewed.copy);
  assert.equal(locked.success, false);
  assert.match(locked.success ? "" : locked.error, /approved/i);

  const direct = await lab(false);
  viewerId = direct.asha;
  await assignments.submitAssignmentAction(direct.copy, { link: "https://example.com/a" });
  assert.equal((await state(direct.copy)).status, "done");
  assert.equal((await assignments.unsubmitAssignmentAction(direct.copy)).success, true);
  assert.equal((await state(direct.copy)).status, "in_progress");
});
