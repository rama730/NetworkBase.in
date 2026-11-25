import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B2.4a (report 31.4 C3): a mock is an Exam with a Score layout; staff enter marks (never a token); a learner sees
// only their own, only once released when held, as Latest, Best and the gap; staff see bands, never ranks.
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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.190" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/mocks");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/mocks"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const err = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const layout = { series: "IELTS mocks", overall: "average_half", sections: [
  { key: "listening", name: "Listening", max: 40, conversion: [[39, 9], [30, 7], [23, 6], [0, 4]] },
  { key: "reading", name: "Reading", max: 40, conversion: [[39, 9], [30, 7], [23, 6], [0, 4]] },
  { key: "writing", name: "Writing", max: 9 }, { key: "speaking", name: "Speaking", max: 9 }] };

test("mock series: layout, marks, my prep (own, released only) and staff bands", async () => {
  const [teacher, learner, other] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'UTC' WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${learner!}, 'member'), (${klass}, ${other!}, 'member')`;
  const exam = (opens: string, hold: boolean) => ({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", lateUntil: null, target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null,
    exam: { format: "in_person", opensAt: opens, closesAt: new Date(Date.parse(opens) + 7_200_000).toISOString(), room: null, seats: null, covers: { units: [], outcomes: [] }, hold } });
  const [m1] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Mock 1', 'todo', 'medium', ${teacher!}, 'assignment', ${sql.json(exam("2027-01-10T09:00:00Z", false) as never)}) RETURNING id`;
  const [m2] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Mock 2', 'todo', 'medium', ${teacher!}, 'assignment', ${sql.json(exam("2027-02-10T09:00:00Z", true) as never)}) RETURNING id`;

  viewerId = learner!;
  assert.equal((await act.saveScoreLayoutAction(klass, m1!.id, layout)).success, false, "staff set layouts");
  viewerId = teacher!;
  for (const m of [m1!, m2!]) assert.equal((await act.saveScoreLayoutAction(klass, m.id, layout)).success, true);
  token = "agent";
  assert.equal((await act.saveMockMarksAction(klass, m1!.id, [{ userId: learner!, raws: { listening: 32 } }])).success, false, "agents never set marks");
  token = null;
  assert.match(err(await act.saveMockMarksAction(klass, m1!.id, [{ userId: learner!, raws: { writing: 12 } }])), /out of 9/);
  assert.equal((await act.saveMockMarksAction(klass, m1!.id, [{ userId: learner!, raws: { listening: 32, reading: 24, writing: 6, speaking: 7 } }, { userId: other!, raws: { listening: 39, reading: 39, writing: 8, speaking: 8 } }])).success, true);
  assert.equal((await act.saveMockMarksAction(klass, m2!.id, [{ userId: learner!, raws: { listening: 39, reading: 31, writing: 7, speaking: 7 } }])).success, true);

  viewerId = learner!;
  assert.equal((await act.saveMyPrepAction(klass, { examName: "IELTS Academic", examDate: "2027-03-14", targets: { overall: 7, reading: 7 } })).success, true);
  const mine = await act.readMyPrepAction(klass);
  assert.ok(mine.success);
  assert.equal(mine.exam.name, "IELTS Academic");
  const s = mine.series[0]!;
  assert.deepEqual(s.mocks, ["Mock 1"], "Mock 2 is held until released");
  const reading = s.sections.find((x) => x.key === "reading")!;
  assert.deepEqual([reading.latest, reading.best, reading.gap], [6, 6, 1]);
  assert.deepEqual([s.overall?.latest, s.overall?.gap], [6.5, 0.5]);
  assert.equal((await act.readScoresAction(klass)).success, false, "learners never see the class's scores");

  viewerId = teacher!;
  const staff = await act.readScoresAction(klass);
  assert.ok(staff.success);
  assert.deepEqual(staff.mocks.map((m) => [m.title, m.held]), [["Mock 1", false], ["Mock 2", true]]);
  const row = staff.learners.find((l) => l.id === learner!)!;
  assert.deepEqual([row.overall, row.target, row.below], [[6.5, 7.5], 7, []]);
  assert.equal(staff.bands.reduce((n, b) => n + b.count, 0), 1, "the latest mock's spread, counts only");
  assert.equal((await act.suggestTargetsAction(klass, learner!, { overall: 7.5 })).success, true);
  viewerId = learner!;
  const after1 = await act.readMyPrepAction(klass);
  assert.ok(after1.success);
  assert.deepEqual([after1.targets.overall, after1.suggested?.overall], [7, 7.5], "a suggestion never changes the learner's own target");
});
