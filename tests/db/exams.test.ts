import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.6a (report 30.5 W4): exams — the window, the paper locked until it opens, held results and Release.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.182" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let marks: typeof import("../../src/app/actions/marks");
let exams: typeof import("../../src/app/actions/exams");
let assignments: typeof import("../../src/app/actions/assignments");
let token: string | null = null;
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  marks = await loadAppModule(() => import("../../src/app/actions/marks"));
  exams = await loadAppModule(() => import("../../src/app/actions/exams"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [teacher, ta, a] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin'), (${klass}, ${a!}, 'member')`;
  return { teacher: teacher!, ta: ta!, a: a!, klass };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

test("a timed exam: due at the close, no late work, the paper locked until it opens, no hand-in before", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const made = await assignments.createAssignmentAction({ projectId: t.klass, title: "Midterm", dueDate: inHours(100), publish: true, submissionType: "text", reviewRequired: true, lateRule: "always", target: { mode: "everyone" } as never, steps: [],
    marking: { mode: "outof", outOf: 50 }, exam: { format: "timed", opensAt: inHours(24), closesAt: inHours(26), room: "LH-2 · 204", hold: true } });
  assert.ok(made.success, errorOf(made as never));
  const [master] = await sql`SELECT due_date, assignment_settings AS s FROM tasks WHERE id = ${made.masterId}`;
  assert.deepEqual([master!.s.lateRule, master!.s.lateAfterMinutes, master!.s.exam.format, new Date(master!.due_date).toISOString()], ["none", 0, "timed", master!.s.exam.closesAt]);
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.masterId} AND assignee_id = ${t.a}`;
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, task_id) VALUES (${t.klass}, 'file', 'paper.pdf', '/paper.pdf', ${t.teacher}, ${made.masterId})`;
  // Security review: a class file picked as material is locked with the paper.
  const [sheet] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${t.klass}, 'file', 'formula-sheet.pdf', '/formula-sheet.pdf', ${t.teacher}) RETURNING id`;
  await sql`INSERT INTO task_node_links (task_id, node_id) VALUES (${made.masterId}, ${sheet!.id})`;
  viewerId = t.a;
  const before = await assignments.readAssignmentMaterialsAction(copy!.id);
  assert.ok(before.success && before.materials.length === 0, "the paper is never sent before opening");
  assert.match(errorOf(await assignments.submitAssignmentAction(copy!.id, { text: "answer" })), /isn’t open yet/);
  const hand = await assignments.readHandInAction(copy!.id);
  assert.ok(hand.success && hand.handIn.exam?.settings.room === "LH-2 · 204" && !hand.handIn.canSubmit);
  await sql`UPDATE tasks SET assignment_settings = jsonb_set(assignment_settings, '{exam,opensAt}', to_jsonb(${inHours(-1)}::text)) WHERE id = ${made.masterId}`;
  const open = await assignments.readAssignmentMaterialsAction(copy!.id);
  assert.ok(open.success && open.materials.map((m) => m.name).sort().join() === "formula-sheet.pdf,paper.pdf", "both open on time");
  assert.equal((await assignments.submitAssignmentAction(copy!.id, { text: "answer" })).success, true);
});

test("held results: Approve keeps the mark hidden and quiet; only the Teacher releases, then one notice each", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const made = await assignments.createAssignmentAction({ projectId: t.klass, title: "Final", dueDate: inHours(100), publish: true, submissionType: "text", reviewRequired: true, lateRule: "always", target: { mode: "everyone" } as never, steps: [],
    marking: { mode: "outof", outOf: 50 }, exam: { format: "take_home", opensAt: inHours(-2), closesAt: inHours(48), hold: true } });
  assert.ok(made.success);
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.masterId} AND assignee_id = ${t.a}`;
  viewerId = t.a;
  assert.equal((await assignments.submitAssignmentAction(copy!.id, { text: "essay" })).success, true);
  viewerId = t.teacher;
  await marks.saveMarkAction(copy!.id, { total: 41 });
  const approved = await assignments.reviewAssignmentCopyAction(copy!.id, "approve");
  assert.equal(approved.success, true, JSON.stringify(approved));
  await marks.saveMarkAction(copy!.id, { total: 42 });
  viewerId = t.a;
  const held = await marks.readMyMarkAction(copy!.id);
  assert.ok(held.success && held.mark === null, "held marks stay hidden until release ");
  assert.equal((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${t.a} AND title LIKE 'Final%'`).length, 0, "no notice before release");
  viewerId = t.ta;
  assert.equal((await exams.releaseResultsAction(made.masterId)).success, false, "a TA can't release");
  viewerId = t.teacher;
  assert.deepEqual(await exams.releaseResultsAction(made.masterId), { success: true, released: 1 });
  assert.match(errorOf(await exams.releaseResultsAction(made.masterId)), /already released/);
  viewerId = t.a;
  const shown = await marks.readMyMarkAction(copy!.id);
  assert.ok(shown.success && shown.mark?.total === 42);
  assert.deepEqual((await sql`SELECT title FROM user_notifications WHERE user_id = ${t.a} AND title LIKE 'Final%'`).map((n) => n.title), ["Final was marked"]);
});
