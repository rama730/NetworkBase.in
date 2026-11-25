import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.2a (report 30.3 W2): the Term plan — lessons, stages by role, teacher notes kept from students, outcomes.
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

let plan: typeof import("../../src/app/actions/term-plan");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  plan = await loadAppModule(() => import("../../src/app/actions/term-plan"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function setup() {
  const [teacher, ta, student] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, term_start = '2027-01-11', term_end = '2027-04-25',
    org_settings = coalesce(org_settings, '{}'::jsonb) || '{"classDetails":{"meets":[{"day":2,"start":"10:30","end":"12:00"},{"day":4,"start":"10:30","end":"12:00"}]}}'::jsonb WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${ta!}, 'admin'), (${klass}, ${student!}, 'member')`;
  const [unit] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status) VALUES (${klass}, 1, 'Unit 1 Arrays', '2027-01-11', '2027-01-24', 'active') RETURNING id`;
  const [week] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${klass}, 2, 'Week 1', '2027-01-11', '2027-01-17', 'active', ${unit!.id}) RETURNING id`;
  return { teacher: teacher!, ta: ta!, student: student!, klass, unit: unit!.id as string, week: week!.id as string };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const lessonsOf = (r: Awaited<ReturnType<typeof plan.readTermPlanAction>>) => (r.success ? r.units.flatMap((u) => u.weeks.flatMap((w) => w.lessons)) : []);

test("the teacher plans; students see a lesson once Ready; a TA only marks taught; sessions match in order", async () => {
  const t = await setup();
  viewerId = t.teacher;
  assert.equal((await plan.saveTermPlanSettingsAction(t.klass, { outcomes: [{ code: "CO1", text: "Arrays" }, { code: "CO2", text: "Lists" }], studentsSee: "ready", topicsLabel: "Topics" })).success, true);
  const a = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Arrays", outcomes: ["CO1", "CO9"] });
  const b = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Complexity" });
  assert.ok(a.success && b.success);
  viewerId = t.ta;
  assert.equal((await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Nope" })).success, false, "TAs don't add lessons");
  assert.match(errorOf(await plan.setLessonStageAction(t.klass, a.id, "ready")), /TA marks lessons taught/);
  viewerId = t.student;
  assert.deepEqual(lessonsOf(await plan.readTermPlanAction(t.klass)), [], "planned lessons wait until Ready");
  viewerId = t.teacher;
  await plan.setLessonStageAction(t.klass, a.id, "ready");
  const staffView = await plan.readTermPlanAction(t.klass);
  assert.ok(staffView.success);
  assert.deepEqual(lessonsOf(staffView).map((l) => [l.title, l.session?.key, l.outcomes]), [["Arrays", "2027-01-12T10:30", ["CO1"]], ["Complexity", "2027-01-14T10:30", []]]);
  assert.deepEqual([staffView.coverage.covered, staffView.coverage.total], [1, 2]);
  viewerId = t.ta;
  assert.equal((await plan.setLessonStageAction(t.klass, a.id, "taught")).success, true);
  viewerId = t.student;
  const studentView = await plan.readTermPlanAction(t.klass);
  assert.deepEqual(lessonsOf(studentView).map((l) => [l.title, l.stage]), [["Arrays", "taught"]]);
  assert.equal(studentView.success && studentView.units[0]!.progress.percent, 50, "class progress counts every planned lesson");
});

test("layer 16: teacher notes never reach students, nor tasks.type_fields; a TA edits In class only", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const a = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Arrays" });
  assert.ok(a.success);
  await plan.setLessonStageAction(t.klass, a.id, "ready");
  viewerId = t.ta;
  assert.equal((await plan.saveLessonNotesAction(t.klass, a.id, "Ravi struggles with indexing")).success, true);
  assert.match(errorOf(await plan.updateLessonAction(t.klass, a.id, { before: "Read ch. 2" })), /TA edits In class/);
  assert.equal((await plan.updateLessonAction(t.klass, a.id, { during: "Whiteboard demo" })).success, true);
  const [row] = await sql`SELECT type_fields FROM tasks WHERE id = ${a.id}`;
  assert.equal(JSON.stringify(row!.type_fields).includes("Ravi"), false);
  viewerId = t.teacher;
  assert.equal(lessonsOf(await plan.readTermPlanAction(t.klass))[0]!.notes, "Ravi struggles with indexing");
  viewerId = t.student;
  const seen = lessonsOf(await plan.readTermPlanAction(t.klass))[0]!;
  assert.equal("notes" in seen, false);
  assert.equal(seen.during, "Whiteboard demo");
  assert.equal((await plan.saveLessonNotesAction(t.klass, a.id, "x")).success, false);
});

test("settings refuse duplicate outcome codes; Topics is the week's goal; a draft assignment stays out of students' Assessments", async () => {
  const t = await setup();
  viewerId = t.teacher;
  assert.match(errorOf(await plan.saveTermPlanSettingsAction(t.klass, { outcomes: [{ code: "CO1", text: "" }, { code: "co1", text: "" }], studentsSee: "ready", topicsLabel: "Topics" })), /same code/);
  assert.equal((await plan.setWeekTopicsAction(t.klass, t.week, "Arrays, complexity")).success, true);
  await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, due_date, assignment_settings) VALUES
    (${t.klass}, 'Lab 1', 'todo', 'medium', ${t.teacher}, 'assignment', '2027-01-15T18:00:00Z', '{"publishedAt":"2027-01-10T00:00:00Z"}'::jsonb),
    (${t.klass}, 'Quiz draft', 'todo', 'medium', ${t.teacher}, 'assignment', '2027-01-16T18:00:00Z', '{}'::jsonb)`;
  const staff = await plan.readTermPlanAction(t.klass);
  assert.deepEqual(staff.success && staff.units[0]!.weeks[0]!.assessments.map((x) => x.title).sort(), ["Lab 1", "Quiz draft"]);
  assert.equal(staff.success && staff.units[0]!.weeks[0]!.goal, "Arrays, complexity");
  viewerId = t.student;
  const student = await plan.readTermPlanAction(t.klass);
  assert.deepEqual(student.success && student.units[0]!.weeks[0]!.assessments.map((x) => x.title), ["Lab 1"]);
});

test("B1.2b: Move to week, Shift the rest keeps taught lessons; Duplicate makes a Planned copy without teacher notes", async () => {
  const t = await setup();
  const [w2] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${t.klass}, 3, 'Week 2', '2027-01-18', '2027-01-24', 'planning', ${t.unit}) RETURNING id`;
  const [w3] = await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status, parent_sprint_id) VALUES (${t.klass}, 4, 'Week 3', '2027-01-25', '2027-01-31', 'planning', ${t.unit}) RETURNING id`;
  viewerId = t.teacher;
  const a = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "A" });
  const b = await plan.addTermLessonAction(t.klass, { weekId: w2!.id, title: "B" });
  const c = await plan.addTermLessonAction(t.klass, { weekId: w2!.id, title: "C" });
  assert.ok(a.success && b.success && c.success);
  await plan.setLessonStageAction(t.klass, c.id, "taught");
  viewerId = t.ta;
  assert.equal((await plan.moveLessonAction(t.klass, { taskId: a.id, weekId: w2!.id, shiftRest: true })).success, false, "the teacher moves lessons");
  viewerId = t.teacher;
  const moved = await plan.moveLessonAction(t.klass, { taskId: a.id, weekId: w2!.id, shiftRest: true });
  assert.deepEqual(moved, { success: true, moved: 2 });
  const where = async (id: string) => (await sql`SELECT sprint_id FROM tasks WHERE id = ${id}`)[0]!.sprint_id;
  assert.deepEqual([await where(a.id), await where(b.id), await where(c.id)], [w2!.id, w3!.id, w2!.id], "B shifts a week; taught C stays");
  await plan.saveLessonNotesAction(t.klass, a.id, "secret");
  const copy = await plan.duplicateLessonAction(t.klass, a.id);
  assert.ok(copy.success);
  const [row] = await sql`SELECT title, stage, sprint_id FROM tasks WHERE id = ${copy.id}`;
  assert.deepEqual([row!.title, row!.stage, row!.sprint_id], ["A (copy)", "draft", w2!.id]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM lesson_staff_notes WHERE task_id = ${copy.id}`)[0]!.n, 0);
});

test("B1.2b: Behind plan and the Mark taught reminder count lessons whose class has passed, once a day", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const a = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Arrays" });
  const b = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Complexity" });
  assert.ok(a.success && b.success);
  await plan.setLessonStageAction(t.klass, a.id, "taught");
  const server = await loadAppModule(() => import("../../src/lib/organizations/term-plan-server"));
  const now = new Date("2027-01-20T10:00:00Z");
  const state = (await server.classPlanStates([t.klass], now)).get(t.klass)!;
  assert.deepEqual([state.due, state.taught, state.unmarked.map((l) => l.title)], [2, 1, ["Complexity"]]);
  const early = (await server.classPlanStates([t.klass], new Date("2027-01-12T00:00:00Z"))).get(t.klass)!;
  assert.equal(early.due, 0, "nothing is due before its class");
  await server.notifyLessonsToMarkTaught(now);
  await server.notifyLessonsToMarkTaught(now);
  const notes = await sql`SELECT title FROM user_notifications WHERE user_id = ${t.teacher} AND title LIKE 'Mark %taught'`;
  assert.deepEqual(notes.map((n) => n.title), ["Mark 1 lesson taught"], "once a day");
});

test("B3.2a: one plan, several classes — Taught per class (two at once keep both), class notes for staff only, lesson types, Behind the map", async () => {
  const t = await setup();
  viewerId = t.teacher;
  assert.equal((await plan.saveTermPlanSettingsAction(t.klass, { outcomes: [], studentsSee: "always", topicsLabel: "Topics", groups: ["6A", "6B"] })).success, true);
  assert.equal((await plan.saveTermPlanSettingsAction(t.klass, { outcomes: [], studentsSee: "always", topicsLabel: "Topics" })).success, true, "left out keeps the classes");
  const a = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Arrays", lessonType: "activity" });
  const b = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Arrays test", lessonType: "assessment" });
  assert.ok(a.success && b.success);
  await plan.setLessonStageAction(t.klass, a.id, "ready");
  // Two staff tick different classes at the same moment: both ticks stay, and the lesson is Taught.
  viewerId = t.ta;
  const [x, y] = await Promise.all([plan.markClassTaughtAction(t.klass, a.id, "6A", true), plan.markClassTaughtAction(t.klass, a.id, "6B", true)]);
  assert.ok(x.success && y.success);
  const [row] = await sql`SELECT stage, type_fields->'taught' AS taught FROM tasks WHERE id = ${a.id}`;
  assert.deepEqual([row!.stage, Object.keys(row!.taught).sort()], ["taught", ["6A", "6B"]]);
  assert.equal((await plan.markClassTaughtAction(t.klass, a.id, "6C", true)).success, false, "only the course's classes");
  const before6A = (await sql`SELECT type_fields->'taught'->'6A' AS t FROM tasks WHERE id = ${a.id}`)[0]!.t;
  viewerId = t.teacher;
  assert.equal((await plan.markClassTaughtAction(t.klass, a.id, "6A", true)).success, true);
  assert.deepEqual((await sql`SELECT type_fields->'taught'->'6A' AS t FROM tasks WHERE id = ${a.id}`)[0]!.t, before6A, "security review: ticking again keeps the first tick");
  viewerId = t.ta;
  assert.equal((await plan.markClassTaughtAction(t.klass, a.id, "6B", false)).success, false, "security review: a TA doesn't take a tick back");
  viewerId = t.teacher;
  assert.equal((await plan.markClassTaughtAction(t.klass, a.id, "6B", false)).success, true);
  assert.equal((await sql`SELECT stage FROM tasks WHERE id = ${a.id}`)[0]!.stage, "ready", "a tick taken back returns it to Ready");
  assert.equal((await plan.saveClassNoteAction(t.klass, a.id, "6B", "Run the lab in two parts")).success, true);
  const staff = await plan.readTermPlanAction(t.klass);
  assert.ok(staff.success);
  const lessons = lessonsOf(staff);
  assert.deepEqual(lessons.map((l) => [l.title, l.lessonType]), [["Arrays", "activity"], ["Arrays test", "assessment"]]);
  assert.equal(lessons[0]!.classNotes?.["6B"], "Run the lab in two parts");
  assert.deepEqual(staff.groups, ["6A", "6B"]);
  assert.deepEqual(staff.behind.map((g) => [g.group, g.due, g.behind]), [["6A", 0, 0], ["6B", 0, 0]], "the term hasn't started: nothing is due, nobody is behind");
  viewerId = t.student;
  const pupil = await plan.readTermPlanAction(t.klass);
  assert.ok(pupil.success);
  assert.deepEqual([pupil.groups, pupil.behind, lessonsOf(pupil)[0]!.ticks, lessonsOf(pupil)[0]!.classNotes], [[], [], {}, undefined], "ticks, class notes and pacing stay with staff");
  assert.equal((await plan.markClassTaughtAction(t.klass, a.id, "6A", false)).success, false, "students can't tick");
});

test("B3.2d: Duplicate a unit into another of my courses; Lesson still Draft once, within 3 school days of its class", async () => {
  const t = await setup();
  const other = await setup();
  await sql`UPDATE workspaces SET owner_id = ${t.teacher} WHERE id = ${other.klass}`;
  await sql`UPDATE workspace_members SET user_id = ${t.teacher} WHERE workspace_id = ${other.klass} AND role = 'owner'`;
  viewerId = t.teacher;
  const a = await plan.addTermLessonAction(t.klass, { weekId: t.week, title: "Arrays", lessonType: "activity" });
  assert.ok(a.success);
  await sql`UPDATE tasks SET type_fields = type_fields || ${sql.json({ taught: { "6A": { on: "2027-01-12", by: t.teacher } }, classNotes: { "6A": "x" } })} WHERE id = ${a.id}`;
  const view = await plan.readTermPlanAction(t.klass);
  assert.ok(view.success && view.otherCourses.some((c) => c.id === other.klass));
  const dup = await plan.duplicateUnitAction(t.klass, t.unit, other.klass);
  assert.deepEqual(dup, { success: true, lessons: 1 });
  const copied = await sql`SELECT t.stage, t.type_fields, w.name AS week, u.name AS unit FROM tasks t JOIN workspace_sprints w ON w.id = t.sprint_id JOIN workspace_sprints u ON u.id = w.parent_sprint_id
    WHERE t.workspace_id = ${other.klass} AND t.item_type = 'class_lesson'`;
  assert.deepEqual(copied.map((c) => [c.stage, c.week, c.unit, c.type_fields.lessonType, c.type_fields.taught, c.type_fields.classNotes]), [["draft", "Week 1", "Unit 1 Arrays", "activity", undefined, undefined]]);
  viewerId = t.ta;
  assert.equal((await plan.duplicateUnitAction(t.klass, t.unit, other.klass)).success, false, "the teacher only");

  // Arrays is Draft and taught Tue 2027-01-12: on Fri 2027-01-08 that's within 3 school days (Fri, Mon); on Tue 2027-01-05 it isn't.
  const { notifyDraftLessonsSoon } = await loadAppModule(() => import("../../src/lib/organizations/term-plan-server"));
  await notifyDraftLessonsSoon(new Date("2027-01-05T12:00:00Z"));
  assert.equal((await sql`SELECT 1 FROM user_notifications WHERE dedupe_key = ${`draft-soon:${a.id}`}`).length, 0, "not yet");
  await notifyDraftLessonsSoon(new Date("2027-01-08T12:00:00Z"));
  await notifyDraftLessonsSoon(new Date("2027-01-08T13:00:00Z"));
  const sent = await sql`SELECT user_id, title FROM user_notifications WHERE dedupe_key = ${`draft-soon:${a.id}`}`;
  assert.deepEqual(sent.map((n) => [n.user_id, n.title]), [[t.teacher, "Arrays is still Draft · taught 2027-01-12"]], "once, to the teacher");
});
