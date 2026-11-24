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

test("B1.6b: extra time moves only that student's close and stays private; Make-up for… and the clash warning", async () => {
  const t = await setup();
  const b = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${t.klass}, ${b}, 'member')`;
  viewerId = t.teacher;
  const made = await assignments.createAssignmentAction({ projectId: t.klass, title: "Quiz", dueDate: inHours(100), publish: true, submissionType: "text", lateRule: "always", target: { mode: "everyone" } as never, steps: [],
    exam: { format: "timed", opensAt: inHours(-2), closesAt: inHours(-1), hold: false } });
  assert.ok(made.success);
  viewerId = t.ta;
  assert.equal((await exams.setExtraTimeAction(t.klass, t.a, 90)).success, false, "only the Teacher sets extra time");
  viewerId = t.teacher;
  assert.equal((await exams.setExtraTimeAction(t.klass, t.a, 90)).success, true);
  const copyOf = async (u: string) => (await sql`SELECT id FROM tasks WHERE assignment_id = ${made.masterId} AND assignee_id = ${u}`)[0]!.id as string;
  viewerId = t.a;
  assert.equal((await assignments.submitAssignmentAction(await copyOf(t.a), { text: "answer" })).success, true, "a's close is an hour and a half later");
  viewerId = b;
  assert.match(errorOf(await assignments.submitAssignmentAction(await copyOf(b), { text: "answer" })), /not accepted/, "b's close didn't move");
  // Security review: on a team copy a teammate's extra time never moves the team's close.
  const [team] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, team_name, assignee_id, due_date) SELECT ${t.klass}, 'Quiz', 'todo', 'medium', ${t.teacher}, 'task', id, 'Team 1', ${t.a}, due_date FROM tasks WHERE id = ${made.masterId} RETURNING id`;
  await sql`INSERT INTO task_team_members (task_id, user_id, is_lead) VALUES (${team!.id}, ${t.a}, true), (${team!.id}, ${b}, false)`;
  viewerId = t.a;
  assert.match(errorOf(await assignments.submitAssignmentAction(team!.id, { text: "team answer" })), /not accepted/);
  viewerId = b;
  const mine = await exams.readExtraTimeAction(t.klass);
  assert.ok(mine.success && mine.rows.length === 0 && mine.students.length === 0, "b never sees a's extra time");
  viewerId = t.teacher;
  const later = await assignments.createAssignmentAction({ projectId: t.klass, title: "Other exam", dueDate: inHours(100), publish: true, submissionType: "none", lateRule: "none", target: { mode: "everyone" } as never, steps: [],
    exam: { format: "in_person", opensAt: inHours(-1.5), closesAt: inHours(1) } });
  assert.ok(later.success && later.clashes === 2, "both students have Quiz at that time: a warning, not a block");
  const makeUp = await exams.makeUpExamAction(made.masterId, [b], inHours(48));
  assert.ok(makeUp.success);
  const [m] = await sql`SELECT title, assignment_settings AS s FROM tasks WHERE id = ${makeUp.masterId}`;
  const copies = await sql`SELECT assignee_id FROM tasks WHERE assignment_id = ${makeUp.masterId}`;
  assert.deepEqual([m!.title, m!.s.exam.format, copies.map((c) => c.assignee_id)], ["Quiz · make-up", "timed", [b]]);
});

test("B1.6c: the second marker gives their own mark; more than 10% apart needs agreement and blocks Release until agreed", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const made = await assignments.createAssignmentAction({ projectId: t.klass, title: "Finals", dueDate: inHours(100), publish: true, submissionType: "text", reviewRequired: true, lateRule: "always", target: { mode: "everyone" } as never, steps: [],
    marking: { mode: "outof", outOf: 50 }, exam: { format: "take_home", opensAt: inHours(-2), closesAt: inHours(48), hold: true, secondMarker: t.ta, secondSample: "all" } });
  assert.ok(made.success);
  const bad = await assignments.createAssignmentAction({ projectId: t.klass, title: "Bad", dueDate: inHours(100), publish: false, submissionType: "text", lateRule: "always", target: { mode: "everyone" } as never, steps: [],
    exam: { format: "take_home", opensAt: inHours(-2), closesAt: inHours(48), secondMarker: t.a } });
  assert.match(errorOf(bad as never), /second marker from this class’s staff/);
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.masterId} AND assignee_id = ${t.a}`;
  viewerId = t.a;
  await assignments.submitAssignmentAction(copy!.id, { text: "essay" });
  viewerId = t.ta;
  assert.match(errorOf(await marks.saveSecondMarkAction(copy!.id, 40)), /first mark comes first/);
  assert.match(errorOf(await marks.saveMarkAction(copy!.id, { total: 30 })), /second marker on this one/);
  viewerId = t.teacher;
  await marks.saveMarkAction(copy!.id, { total: 30 });
  assert.equal((await assignments.reviewAssignmentCopyAction(copy!.id, "approve")).success, true);
  assert.equal((await marks.saveSecondMarkAction(copy!.id, 40)).success, false, "only the named second marker");
  viewerId = t.ta;
  assert.deepEqual(await marks.saveSecondMarkAction(copy!.id, 40), { success: true, needsAgreement: true });
  assert.equal((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${t.teacher} AND title = 'Finals: marks need agreement'`).length, 1, "both markers are told");
  viewerId = t.teacher;
  assert.match(errorOf(await exams.releaseResultsAction(made.masterId)), /1 mark needs agreement/);
  assert.match(errorOf(await marks.agreeMarkAction(copy!.id, 45)), /from 30 to 40/, "security review: between the two marks");
  assert.equal((await marks.agreeMarkAction(copy!.id, 36)).success, true);
  assert.match(errorOf(await marks.agreeMarkAction(copy!.id, 31)), /don’t need agreement/, "security review: once agreed, never again");
  assert.deepEqual(await exams.releaseResultsAction(made.masterId), { success: true, released: 1 });
  viewerId = t.a;
  const mine = await marks.readMyMarkAction(copy!.id);
  assert.ok(mine.success && mine.mark?.total === 36 && mine.mark.second === null, "the student sees the agreed mark only");
});

test("B1.6d: the school's exam weeks reach its classes; its Exams view lists exams by day with clashes, never marks; members can't read it", async () => {
  const t = await setup();
  const principal = await sql.begin((tx) => createUser(tx));
  const school = await sql.begin((tx) => createProject(tx, principal, { visibility: "private" }));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal}, 'owner'), (${school}, ${t.a}, 'member')`;
  await sql`UPDATE workspaces SET institution_id = ${school} WHERE id = ${t.klass}`;
  const inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
  viewerId = principal;
  assert.match(errorOf(await inst.saveSchoolExamWeeksAction(school, [{ name: "Midterms", start: "2027-03-08", end: "2027-03-01" }])), /end on or after/);
  assert.equal((await inst.saveSchoolExamWeeksAction(school, [{ name: "Midterms", start: "2027-03-01", end: "2027-03-05" }])).success, true);
  const [klass] = await sql`SELECT org_settings->'examWeeks' AS weeks FROM workspaces WHERE id = ${t.klass}`;
  assert.deepEqual(klass!.weeks, [{ name: "Midterms", start: "2027-03-01", end: "2027-03-05" }], "pushed to the class");
  viewerId = t.teacher;
  const made = await assignments.createAssignmentAction({ projectId: t.klass, title: "Midterm", dueDate: inHours(100), publish: true, submissionType: "none", lateRule: "none", target: { mode: "everyone" } as never, steps: [],
    marking: { mode: "outof", outOf: 50 }, exam: { format: "in_person", opensAt: inHours(30), closesAt: inHours(32), room: "LH-2" } });
  assert.ok(made.success);
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${made.masterId}`;
  await marks.saveMarkAction(copy!.id, { total: 44 });
  viewerId = principal;
  const view = await inst.readSchoolExamsAction(school);
  assert.ok(view.success);
  assert.deepEqual(view.exams.map((e) => [e.title, e.room, e.students, e.clashes]), [["Midterm", "LH-2", 1, 0]]);
  assert.equal(/"(total|outOf|mark|marks|levels)"/.test(JSON.stringify(view)), false, "no marks reach the school");
  viewerId = t.a;
  assert.equal((await inst.readSchoolExamsAction(school)).success, false, "a member of the school doesn't see the Exams view");
  viewerId = t.teacher;
  assert.equal((await exams.saveExamNoClassesAction(t.klass, false)).success, true);
  const settings = await exams.readExtraTimeAction(t.klass);
  assert.ok(settings.success && settings.noClasses === false && settings.examWeeks === 1);
});
