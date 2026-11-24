import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.5a (report 30.8 W7): marks — rubrics freeze, drafts stay hidden until Approve, students see only their own, agents never mark.
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
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [teacher, ta, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin'), (${klass}, ${a!}, 'member'), (${klass}, ${b!}, 'member')`;
  return { teacher: teacher!, ta: ta!, a: a!, b: b!, klass };
}
async function assignment(klass: string, teacher: string, marking: unknown, students: string[]) {
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Lab 3', 'todo', 'medium', ${teacher}, 'assignment', ${sql.json({ version: 1, submissionType: "text", reviewRequired: true, lateRule: "none", lateUntil: null, target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null, marking } as never)}) RETURNING id`;
  const copies: string[] = [];
  for (const s of students) copies.push((await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, review_status) VALUES (${klass}, 'Lab 3', 'done', 'medium', ${s}, 'task', ${master!.id}, ${s}, 'pending') RETURNING id`)[0]!.id);
  return { master: master!.id as string, copies };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("a rubric is saved and frozen; staff mark as a hidden draft; the student sees it only after Approve; agents are refused", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const saved = await marks.saveRubricAction(t.klass, { name: "Lab rubric", criteria: [{ name: "Correctness" }, { name: "Report" }] });
  assert.ok(saved.success);
  const server = await loadAppModule(() => import("../../src/lib/organizations/marks-server"));
  const frozen = await server.freezeMarking(t.klass, { mode: "rubric", rubricId: saved.id });
  assert.ok(!("error" in frozen) && frozen.mode === "rubric");
  const { copies } = await assignment(t.klass, t.teacher, frozen, [t.a, t.b]);
  await marks.saveRubricAction(t.klass, { id: saved.id, name: "Lab rubric", criteria: [{ name: "Correctness" }, { name: "Report" }, { name: "Style" }] });
  const panel = await marks.readMarkingAction(copies[0]!);
  assert.ok(panel.success && panel.marking.mode === "rubric" && panel.marking.rubric.criteria.length === 2, "the assignment keeps the rubric it was saved with");
  const [c0, c1] = panel.success && panel.marking.mode === "rubric" ? panel.marking.rubric.criteria : [];
  token = "agent";
  assert.match(errorOf(await marks.saveMarkAction(copies[0]!, { levels: { [c0!.id]: 0, [c1!.id]: 1 } })), /agents can’t/);
  token = "pat";
  assert.equal((await marks.saveMarkAction(copies[0]!, { levels: { [c0!.id]: 0, [c1!.id]: 1 } })).success, false, "security review: no token writes marks");
  assert.equal((await marks.readMarkingAction(copies[0]!)).success, false, "nor reads a staff draft");
  token = null;
  assert.match(errorOf(await marks.saveMarkAction(copies[0]!, { levels: { [c0!.id]: 0 } })), /Pick a level for Report/);
  viewerId = t.ta;
  assert.deepEqual(await marks.saveMarkAction(copies[0]!, { levels: { [c0!.id]: 0, [c1!.id]: 1 }, comment: "Explain the edge case" }), { success: true, total: 17, outOf: 20 });
  viewerId = t.a;
  const hidden = await marks.readMyMarkAction(copies[0]!);
  assert.ok(hidden.success && hidden.mark === null, "a draft stays hidden");
  assert.equal((await marks.saveMarkAction(copies[0]!, { levels: {} })).success, false, "students can't mark");
  viewerId = t.b;
  assert.equal((await marks.readMyMarkAction(copies[0]!)).success, false, "another student never reads it");
  viewerId = t.teacher;
  assert.equal((await assignments.reviewAssignmentCopyAction(copies[0]!, "approve")).success, true);
  viewerId = t.a;
  const shown = await marks.readMyMarkAction(copies[0]!);
  assert.ok(shown.success && shown.mark);
  assert.deepEqual([shown.mark.total, shown.mark.outOf, shown.mark.comment, shown.mark.visible], [17, 20, "Explain the edge case", true]);
  const notice = await sql`SELECT title FROM user_notifications WHERE user_id = ${t.a} AND title LIKE 'Lab 3%'`;
  assert.deepEqual(notice.map((n) => n.title), ["Lab 3 was marked"], "one notice, without the mark");
  viewerId = t.teacher;
  assert.equal((await assignments.reviewAssignmentCopyAction(copies[0]!, "return", "Redo part 2", undefined, { change: true })).success, true);
  viewerId = t.a;
  const back = await marks.readMyMarkAction(copies[0]!);
  assert.ok(back.success && back.mark === null, "Return keeps the mark as a hidden draft");
});

test("Out of: 0..N only; excused work has no mark; each change is kept", async () => {
  const t = await setup();
  const { copies } = await assignment(t.klass, t.teacher, { mode: "outof", outOf: 50 }, [t.a, t.b]);
  viewerId = t.teacher;
  assert.match(errorOf(await marks.saveMarkAction(copies[0]!, { total: 51 })), /from 0 to 50/);
  await marks.saveMarkAction(copies[0]!, { total: 38 });
  await marks.saveMarkAction(copies[0]!, { total: 40 });
  const [row] = await sql`SELECT total::int AS total, jsonb_array_length(history) AS changes FROM assignment_marks WHERE copy_id = ${copies[0]!}`;
  assert.deepEqual([row!.total, row!.changes], [40, 1]);
  await sql`UPDATE tasks SET excused_at = now() WHERE id = ${copies[1]!}`;
  assert.match(errorOf(await marks.saveMarkAction(copies[1]!, { total: 10 })), /Excused/);
});
