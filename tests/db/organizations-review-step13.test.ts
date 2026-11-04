import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 13f (report §23.2, §23.5; decision 16): the review queue and class questions.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.135" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let comments: typeof import("../../src/app/actions/task-comment");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  comments = await loadAppModule(() => import("../../src/app/actions/task-comment"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [owner, asha, ravi, guest] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'member'), (${org}, ${guest!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  created.push(org);
  viewerId = owner!;
  const made = await assignments.createAssignmentAction({ projectId: org, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: ["Read", "Write"] });
  const masterId = made.success ? made.masterId : "";
  const copies = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${masterId}`;
  const copyOf = (u: string) => copies.find((c) => c.assignee_id === u)!.id as string;
  return { org, owner: owner!, asha: asha!, ravi: ravi!, guest: guest!, masterId, copyOf };
}

test("23.2: the queue shows what was handed in, its version, note, steps and conversation, oldest first", async () => {
  const t = await setup();
  viewerId = t.asha;
  await assignments.submitAssignmentAction(t.copyOf(t.asha), { link: "https://example.com/a", note: "Used Raft" });
  viewerId = t.owner;
  const queue = await assignments.readReviewQueueAction(t.org);
  assert.ok(queue.success);
  const row = queue.success ? queue.rows.find((r) => r.copyId === t.copyOf(t.asha))! : null!;
  assert.deepEqual([row.version, row.link, row.note, row.steps, row.left], [1, "https://example.com/a", "Used Raft", [{ title: "Read", done: false }, { title: "Write", done: false }], false]);
  assert.equal(queue.success && queue.total, 1);
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${t.org} AND user_id = ${t.asha}`;
  const after = await assignments.readReviewQueueAction(t.org);
  assert.equal(after.success && after.rows.find((r) => r.copyId === t.copyOf(t.asha))?.left, true, "Left the organization");
});

test("mockup task 2: the queue row carries its files with ids and sizes, and the earlier versions", async () => {
  const t = await setup();
  await sql`UPDATE tasks SET assignment_settings = jsonb_set(assignment_settings, '{submissionType}', '"file"') WHERE id = ${t.masterId}`;
  const copy = t.copyOf(t.asha);
  const file = async (name: string, size: number) => (await sql`INSERT INTO workspace_nodes (workspace_id, task_id, path, type, name, size, metadata, current_version)
    VALUES (${t.org}, ${copy}, ${`/.system/tasks/${copy}/${name}`}, 'file', ${name}, ${size}, '{}'::jsonb, 1) RETURNING id`)[0]!.id as string;
  const v1 = await file("lab1-v1.zip", 188);
  viewerId = t.asha;
  assert.equal((await assignments.submitAssignmentAction(copy, {})).success, true);
  viewerId = t.owner;
  await assignments.reviewAssignmentCopyAction(copy, "return", "Add tests");
  await sql`UPDATE workspace_nodes SET metadata = jsonb_build_object('taskFileDetachedFrom', ${copy}::text) WHERE id = ${v1}`;
  const v2 = await file("lab1-v2.zip", 360);
  viewerId = t.asha;
  assert.equal((await assignments.submitAssignmentAction(copy, {})).success, true);
  viewerId = t.owner;
  const queue = await assignments.readReviewQueueAction(t.org);
  const row = queue.success ? queue.rows.find((r) => r.copyId === copy)! : null!;
  assert.deepEqual(row.files, [{ nodeId: v2, name: "lab1-v2.zip", size: 360 }]);
  assert.deepEqual(row.versions.map((v) => [v.version, v.files.map((f) => f.name)]), [[1, ["lab1-v1.zip"]]]);
  assert.ok(!Number.isNaN(Date.parse(row.versions[0]!.at)));
});

test("decision 16, 23.5: students ask class questions from their own copy; viewers read; an admin's reply marks it Answered", async () => {
  const t = await setup();
  viewerId = t.asha;
  const empty = await comments.readClassQuestionsAction(t.copyOf(t.asha));
  assert.ok(empty.success, JSON.stringify(empty));
  assert.deepEqual(empty.success && [empty.masterId, empty.canPost, empty.questions.length], [t.masterId, true, 0]);
  const asked = await comments.createTaskCommentAction(t.masterId, t.org, "Can we use Python?");
  assert.equal(asked.success, true, JSON.stringify(asked));
  viewerId = t.ravi;
  const seen = await comments.readClassQuestionsAction(t.copyOf(t.ravi));
  assert.deepEqual(seen.success && seen.questions.map((q) => [q.content, q.answered]), [["Can we use Python?", false]]);
  viewerId = t.owner;
  const question = seen.success ? seen.questions[0]!.id : "";
  assert.equal((await comments.createTaskCommentAction(t.masterId, t.org, "Yes", question)).success, true);
  viewerId = t.ravi;
  const answered = await comments.readClassQuestionsAction(t.copyOf(t.ravi));
  assert.equal(answered.success && answered.questions[0]!.answered, true);
  viewerId = t.asha;
  assert.equal((await comments.readClassQuestionsAction(t.copyOf(t.ravi))).success, true, "the class thread is shared");
});
