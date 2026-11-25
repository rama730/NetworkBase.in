import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.3a (report 32.4 calls 1, 3, 9): staff hand-ins at a School — Each course goes to the courses' teachers,
// "Then approved by" is a second step after the first Approve, and "Overdue" replaces Missing and Late.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.198" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
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
test("a School's hand-in: Each course → its teachers; two approval steps in order; staff words", async () => {
  const [principal, head, deputy, teacher, other] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const mk = async (owner: string) => {
    const id = await sql.begin((tx) => createProject(tx, owner));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    return id;
  };
  const school = await mk(principal!);
  await sql`UPDATE workspaces SET org_level = 'institution', org_settings = coalesce(org_settings, '{}'::jsonb) || ${sql.json({ schoolKind: "school" })} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${head!}, 'admin'), (${school}, ${deputy!}, 'admin'), (${school}, ${teacher!}, 'member'), (${school}, ${other!}, 'member')`;
  for (const owner of [teacher!, teacher!, other!]) {
    const c = await mk(owner);
    await sql`UPDATE workspaces SET institution_id = ${school} WHERE id = ${c}`;
  }
  viewerId = principal!;
  const made = await assignments.createAssignmentAction({ projectId: school, title: "Unit 3 plan", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "each_child" }, thenApprovedBy: deputy!, steps: [] });
  assert.ok(made.success, JSON.stringify(made));
  const copies = await sql`SELECT id, assignee_id, workspace_id FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""}`;
  assert.deepEqual(copies.map((c) => c.assignee_id).sort(), [teacher, other].sort(), "one per course teacher, in the school");
  assert.ok(copies.every((c) => c.workspace_id === school));
  const copy = copies.find((c) => c.assignee_id === teacher)!.id as string;
  assert.match((await assignments.createAssignmentAction({ projectId: school, title: "x", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: false,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, thenApprovedBy: teacher!, steps: [] }) as { error: string }).error, /admins/);

  viewerId = teacher!;
  assert.equal((await assignments.submitAssignmentAction(copy, { link: "https://example.com/unit3" })).success, true);
  viewerId = deputy!;
  assert.match((await assignments.reviewAssignmentCopyAction(copy, "approve") as { error: string }).error, /first approval/, "the second step waits for the first");
  viewerId = head!;
  assert.equal((await assignments.reviewAssignmentCopyAction(copy, "approve")).success, true);
  const step1 = (await sql`SELECT review_status, status, type_fields FROM tasks WHERE id = ${copy}`)[0]!;
  assert.deepEqual([step1.review_status, step1.type_fields.firstApproval.by], ["pending", head], "step 1 of 2: still waiting");
  assert.match((await assignments.reviewAssignmentCopyAction(copy, "approve") as { error: string }).error, /second approver/);
  const queue = await assignments.readReviewQueueAction(school);
  assert.ok(queue.success && /approved step 1 · .+ decides, step 2 of 2/.test(queue.rows.find((r) => r.copyId === copy)?.twoStep ?? ""));
  viewerId = principal!;
  assert.match((await assignments.approveAllSubmittedAction(made.success ? made.masterId : "") as { error: string }).error, /one at a time/);
  viewerId = deputy!;
  assert.equal((await assignments.reviewAssignmentCopyAction(copy, "approve")).success, true);
  assert.deepEqual(Object.values((await sql`SELECT status, completion_source FROM tasks WHERE id = ${copy}`)[0]!), ["done", "review"], "approved at step 2");

  // A Return at step 2 goes back to the person and clears step 1.
  const second = copies.find((c) => c.assignee_id === other)!.id as string;
  viewerId = other!;
  await assignments.submitAssignmentAction(second, { link: "https://example.com/o" });
  viewerId = head!;
  await assignments.reviewAssignmentCopyAction(second, "approve");
  viewerId = deputy!;
  assert.equal((await assignments.reviewAssignmentCopyAction(second, "return", "Add a practical")).success, true);
  const back = (await sql`SELECT review_status, type_fields FROM tasks WHERE id = ${second}`)[0]!;
  assert.deepEqual([back.review_status, back.type_fields?.firstApproval], ["rejected", undefined]);

  viewerId = principal!;
  const list = await assignments.listAssignmentsAction(school);
  assert.ok(list.success && list.staffWords === true, "a staff-only School uses Overdue");
});
