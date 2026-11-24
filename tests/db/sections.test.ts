import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.3a (report 30.9 W8): sections — make, split, move, pick, and who sees whose names.
// Plan B0.1 (report 29.2, with its correction): an Education organization becomes an institution; classes join it
// by institution_id (at once for its admins, by request otherwise), leave or are removed; the institution sees counts
// and states only and never gains read of a class or its students' work.
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

let sec: typeof import("../../src/app/actions/sections");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  sec = await loadAppModule(() => import("../../src/app/actions/sections"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup(students = 5) {
  const [teacher, ta, outsiderTa] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const kids = await Promise.all(Array.from({ length: students }, () => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin')`;
  for (const k of kids) await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${k!}, 'member')`;
  return { teacher: teacher!, ta: ta!, outsiderTa: outsiderTa!, kids: kids as string[], klass };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const section = (name: string, extra: Record<string, unknown> = {}) => ({ name, kind: "lab", meets: [{ day: 3, start: "14:00", end: "16:00" }], room: "Lab 3", officeHours: null, seatLimit: null, taIds: [], ...extra });

test("the teacher makes sections with class TAs only; Split previews then applies evenly; one lab per student", async () => {
  const t = await setup(5);
  viewerId = t.ta;
  assert.equal((await sec.saveSectionAction(t.klass, section("A"))).success, false, "TAs don't make sections");
  viewerId = t.teacher;
  assert.match(errorOf(await sec.saveSectionAction(t.klass, section("A", { taIds: [t.outsiderTa] }))), /class’s TAs/);
  const a = await sec.saveSectionAction(t.klass, section("A", { taIds: [t.ta] }));
  const b = await sec.saveSectionAction(t.klass, section("B"));
  assert.ok(a.success && b.success);
  const preview = await sec.splitStudentsAction(t.klass, { kind: "lab", method: "even", everyone: false, apply: false });
  assert.ok(preview.success);
  assert.deepEqual(preview.preview.map((p) => p.students.length), [3, 2]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM class_section_members WHERE workspace_id = ${t.klass} AND role = 'student'`)[0]!.n, 0, "a preview changes nothing");
  await sec.splitStudentsAction(t.klass, { kind: "lab", method: "even", everyone: false, apply: true });
  const read = await sec.readSectionsAction(t.klass);
  assert.ok(read.success);
  assert.deepEqual([read.sections.map((s) => s.students.length), read.unplaced.length], [[3, 2], 0]);
  await assert.rejects(sql`INSERT INTO class_section_members (section_id, workspace_id, user_id, role, kind) VALUES (${b.id}, ${t.klass}, ${read.sections[0]!.students[0]!.id}, 'student', 'lab')`, /one_per_kind/);
  const mover = read.sections[0]!.students[0]!.id;
  assert.equal((await sec.moveStudentAction(t.klass, mover, b.id)).success, true);
  const after = await sec.readSectionsAction(t.klass);
  assert.ok(after.success);
  assert.deepEqual(after.sections.map((s) => s.students.length), [2, 3], "moving replaces their lab");
  assert.match(errorOf(await sec.deleteSectionAction(t.klass, a.id, null)), /Move its 2 students/);
  assert.equal((await sec.deleteSectionAction(t.klass, a.id, b.id)).success, true);
});

test("layer 16: a student sees only their own section's names; self-pick respects seats and is off by default", async () => {
  const t = await setup(3);
  viewerId = t.teacher;
  const a = await sec.saveSectionAction(t.klass, section("A", { seatLimit: 1 }));
  const b = await sec.saveSectionAction(t.klass, section("B"));
  assert.ok(a.success && b.success);
  viewerId = t.kids[0]!;
  assert.match(errorOf(await sec.pickSectionAction(t.klass, a.id)), /places you/);
  viewerId = t.teacher;
  await sec.saveSectionSettingsAction(t.klass, { word: "Batch", taOnlyOwn: true, selfPick: true });
  viewerId = t.kids[0]!;
  assert.equal((await sec.pickSectionAction(t.klass, a.id)).success, true);
  viewerId = t.kids[1]!;
  assert.match(errorOf(await sec.pickSectionAction(t.klass, a.id)), /No seats left/);
  assert.equal((await sec.pickSectionAction(t.klass, b.id)).success, true);
  const mine = await sec.readSectionsAction(t.klass);
  assert.ok(mine.success);
  assert.equal(mine.settings.word, "Batch");
  assert.deepEqual(mine.sections.map((s) => [s.name, s.mine, s.students.length]), [["A", false, 0], ["B", true, 1]], "other sections show times and seats, never names");
  assert.deepEqual(mine.unplaced, []);
});

test("B1.3b: routing — a hand-in goes to its student's section TA; another TA can't review it; Rebalance overrides; the Sections target", async () => {
  const t = await setup(4);
  const [ta2] = [await sql.begin((tx) => createUser(tx))];
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${t.klass}, ${ta2!}, 'admin')`;
  viewerId = t.teacher;
  const a = await sec.saveSectionAction(t.klass, section("A", { taIds: [t.ta] }));
  const b = await sec.saveSectionAction(t.klass, section("B", { taIds: [ta2!] }));
  assert.ok(a.success && b.success);
  for (const k of t.kids.slice(0, 3)) await sec.moveStudentAction(t.klass, k, a.id);
  await sec.moveStudentAction(t.klass, t.kids[3]!, b.id);
  const recipients = await loadAppModule(() => import("../../src/lib/organizations/assignments"));
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  const got = await recipients.resolveRecipients(db, t.klass, { mode: "sections", sectionIds: [b.id] });
  assert.deepEqual(got.map((r) => r.assigneeId), [t.kids[3]], "the Sections target reaches that section's students");
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${t.klass}, 'Lab 1', 'todo', 'medium', ${t.teacher}, 'assignment', '{"version":1,"reviewRequired":true}'::jsonb) RETURNING id`;
  const copies: string[] = [];
  for (const k of t.kids) {
    const [c] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, review_status) VALUES (${t.klass}, 'Lab 1', 'done', 'medium', ${k}, 'task', ${master!.id}, ${k}, 'pending') RETURNING id`;
    copies.push(c!.id);
  }
  const { reviewsCopySql } = await loadAppModule(() => import("../../src/lib/organizations/sections-server"));
  const { sql: dsql } = await import("drizzle-orm");
  const routed = async (viewer: string) => Array.from(await db.execute<{ id: string; ok: boolean }>(dsql`SELECT c.id, ${reviewsCopySql(viewer)} AS ok FROM tasks c JOIN tasks m ON m.id = c.assignment_id WHERE m.id = ${master!.id}::uuid ORDER BY c.created_at`)).map((r) => r.ok);
  assert.deepEqual(await routed(t.ta), [true, true, true, false]);
  assert.deepEqual(await routed(ta2!), [false, false, false, true]);
  const load = await sec.readReviewLoadAction(t.klass);
  assert.deepEqual(load.success && load.load.map((l) => [l.userId === t.ta ? "ta" : "ta2", l.toReview]).sort(), [["ta", 3], ["ta2", 1]]);
  const preview = await sec.rebalanceReviewsAction(t.klass, false);
  assert.ok(preview.success && preview.moves === 1);
  assert.deepEqual(await routed(t.ta), [true, true, true, false], "a preview changes nothing");
  await sec.rebalanceReviewsAction(t.klass, true);
  assert.deepEqual((await routed(ta2!)).filter(Boolean).length, 2, "one hand-in moved to the lighter TA");
  await sql`UPDATE tasks SET type_fields = '{}'::jsonb WHERE assignment_id = ${master!.id}`;
  const assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  viewerId = ta2!;
  const r = await assignments.reviewAssignmentCopyAction(copies[0]!, "approve");
  assert.equal(r.success, false);
  assert.match(r.success ? "" : r.error, /another section’s TA/);
  const all = await assignments.approveAllSubmittedAction(master!.id);
  assert.ok(all.success);
  assert.equal(all.approved, 1, "security review: Approve all approves only ta2's own section's hand-in");
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${master!.id} AND review_status = 'pending'`)[0]!.n, 3);
});
