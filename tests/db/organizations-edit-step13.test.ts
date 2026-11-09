import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 13c (report §23.3, §33.5, §34.6; decisions 39, 82, 83): Edit for everyone, roster actions, Use again, export.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.132" }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function setup() {
  const [owner, admin, asha, ravi] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${asha!}, 'member'), (${id}, ${ravi!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status, sprint_number) VALUES (${id}, 'CO2', now(), now() + interval '7 days', 'planning', 1) RETURNING id`;
  created.push(id);
  viewerId = admin!;
  const made = await assignments.createAssignmentAction({ projectId: id, title: "Lab 1", description: "Arrays", dueDate: hours(48), publish: true, submissionType: "link",
    reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: ["Read"], materials: [] });
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  const copies = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${masterId}`;
  const copyOf = (user: string) => copies.find((c) => c.assignee_id === user)!.id as string;
  return { id, sprint: sprint!.id as string, owner: owner!, admin: admin!, asha: asha!, ravi: ravi!, masterId, copyOf };
}

test("23.3, decision 39: Edit for everyone reaches every copy; hand-in type locks at the first submission; instructions can tell everyone", async () => {
  const t = await setup();
  viewerId = t.admin;
  const edit = await assignments.updateAssignmentAction(t.masterId, { title: "Lab 1: Arrays", priority: "high", storyPoints: 3, sprintId: t.sprint, submissionType: "text", lateRule: "always" });
  assert.equal(edit.success, true, JSON.stringify(edit));
  const rows = await sql`SELECT title, priority, story_points, sprint_id FROM tasks WHERE id = ${t.copyOf(t.asha)} OR id = ${t.masterId}`;
  assert.ok(rows.every((r) => r.title === "Lab 1: Arrays" && r.priority === "high" && r.story_points === 3 && r.sprint_id === t.sprint), JSON.stringify(rows));
  viewerId = t.asha;
  await assignments.submitAssignmentAction(t.copyOf(t.asha), { text: "My answer" });
  viewerId = t.admin;
  assert.deepEqual(await assignments.updateAssignmentAction(t.masterId, { submissionType: "file" }), { success: false, error: "Someone has handed this in, so the hand-in type is locked." });
  assert.equal((await assignments.updateAssignmentAction(t.masterId, { description: "Arrays and lists", tellEveryone: true })).success, true);
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${t.ravi} AND title LIKE 'Instructions updated%'`).length, "told when asked");
  const [master] = await sql`SELECT assignment_settings->>'instructionsUpdatedAt' AS at FROM tasks WHERE id = ${t.masterId}`;
  assert.ok(master!.at, "copies show Instructions updated");
  await assignments.closeAssignmentAction(t.masterId);
  assert.deepEqual(await assignments.updateAssignmentAction(t.masterId, { dueDate: hours(96) }), { success: false, error: "Reopen it to change the instructions or due date." });
  viewerId = t.asha;
  assert.equal((await assignments.updateAssignmentAction(t.masterId, { title: "Mine now" })).success, false, "admins only");
});

test("34.6: Remove only a copy nobody has started; bulk Extend and Return; export has statuses and dates only", async () => {
  const t = await setup();
  viewerId = t.asha;
  await assignments.submitAssignmentAction(t.copyOf(t.asha), { link: "https://example.com/a", note: "secret note" });
  viewerId = t.admin;
  assert.equal((await assignments.removeCopyAction(t.copyOf(t.asha))).success, false, "handed in");
  const extended = await assignments.extendCopiesAction([t.copyOf(t.asha), t.copyOf(t.ravi)], hours(120));
  assert.deepEqual(extended, { success: true, extended: 2, failed: 0 });
  const returned = await assignments.returnCopiesAction([t.copyOf(t.asha), t.copyOf(t.ravi)], "Add your name", hours(72));
  assert.deepEqual(returned, { success: true, returned: 1, skipped: 1 }, "only waiting work is returned");
  const csv = await assignments.readAssignmentExportAction(t.masterId);
  assert.ok(csv.success);
  assert.deepEqual(csv.success && csv.rows[0], ["Person", "Status", "Due", "Handed in", "Late", "Version", "AI used"], "CLI report A8.3: the AI-use column");
  assert.ok(!JSON.stringify(csv).includes("secret") && !JSON.stringify(csv).includes("example.com"), "no submission content");
  assert.equal((await assignments.removeCopyAction(t.copyOf(t.ravi))).success, true, "Ravi hadn't started");
  assert.equal((await sql`SELECT deleted_at FROM tasks WHERE id = ${t.copyOf(t.ravi)}`)[0]!.deleted_at !== null, true);
});

test("33.5: Use again fills the form from an earlier assignment, without its dates", async () => {
  const t = await setup();
  viewerId = t.admin;
  const again = await assignments.readAssignmentForReuseAction(t.masterId);
  assert.ok(again.success, JSON.stringify(again));
  assert.deepEqual(again.success && [again.form.title, again.form.description, again.form.submissionType, again.form.reviewRequired, again.form.steps, again.form.dueDate], ["Lab 1", "Arrays", "link", true, ["Read"], null]);
  viewerId = t.asha;
  assert.equal((await assignments.readAssignmentForReuseAction(t.masterId)).success, false);
});
