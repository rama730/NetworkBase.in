import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.3c (report 32.4 calls 5, 6, 8): quiet weeks, the clash check (warns, never blocks) and Deadlines for leaders as
// counts; repeating Week N of every term.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.200" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let staff: typeof import("../../src/app/actions/staff-hand-ins");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  staff = await loadAppModule(() => import("../../src/app/actions/staff-hand-ins"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});
test("quiet weeks, the clash check and Deadlines: leaders see counts; teachers can't", async () => {
  const [principal, teacher, other] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const school = await sql.begin((tx) => createProject(tx, principal!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner'), (${school}, ${teacher!}, 'member'), (${school}, ${other!}, 'member')`;
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  viewerId = principal!;
  assert.equal((await staff.saveQuietWeeksAction(school, [{ name: "Report week", start: day(6), end: day(9) }])).success, true);
  const ask = async (title: string, due: string, userIds: string[]) => {
    const made = await assignments.createAssignmentAction({ projectId: school, title, dueDate: `${due}T16:00:00.000Z`, publish: true,
      submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "people", userIds }, steps: [] });
    assert.ok(made.success, JSON.stringify(made));
  };
  await ask("Reports", day(7), [teacher!]);
  await ask("Trip forms", day(7), [other!]);
  await ask("Policy", day(8), [teacher!, other!]);

  const clash = await staff.checkDeadlineClashAction(school, day(7), { mode: "people", userIds: [teacher!] });
  assert.ok(clash.success);
  assert.deepEqual(clash.deadlines.map((d) => [d.title, d.people]).sort(), [["Policy", 1], ["Reports", 1]], "only deadlines for the same people");
  assert.equal(clash.quiet, "Report week");
  const dl = await staff.readDeadlinesAction(school);
  assert.ok(dl.success);
  const week = dl.weeks.find((w) => w.count >= 3);
  assert.ok(week && week.heavy && week.people === 2, JSON.stringify(dl.weeks));
  assert.equal(JSON.stringify(dl).includes(teacher!), false, "counts, never names");

  viewerId = teacher!;
  assert.equal((await staff.readDeadlinesAction(school)).success, false, "leaders only");
  assert.equal((await staff.saveQuietWeeksAction(school, [])).success, false);
  assert.equal((await staff.checkDeadlineClashAction(school, day(7), { mode: "everyone" })).success, false);
  const set = await staff.readHandInSettingsAction(school);
  assert.ok(set.success && !set.canEdit);
});

test("Week N of every later term makes drafts; a sign-off says I've read this", async () => {
  const [principal, teacher] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const school = await sql.begin((tx) => createProject(tx, principal!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()},
    org_settings = ${sql.json({ schoolYear: { name: "Y", weekStart: "mon", terms: [{ name: "T1", start: "2026-09-02", end: "2026-12-18" }, { name: "T2", start: "2027-01-06", end: "2027-03-26" }, { name: "T3", start: "2027-04-12", end: "2027-07-16" }],
      days: [{ name: "INSET", kind: "staff", start: "2027-02-05", end: "2027-02-05" }] } })} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner'), (${school}, ${teacher!}, 'member')`;
  viewerId = principal!;
  // Friday of Week 5 of Term 1 is 2026-10-02.
  const made = await assignments.createAssignmentAction({ projectId: school, title: "Unit plan", dueDate: "2026-10-02T16:00:00.000Z", publish: false,
    submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, steps: [], repeatTermWeek: { week: 5, weekday: 4 } });
  assert.ok(made.success && made.drafts === 2, JSON.stringify(made));
  const due = await sql`SELECT due_date::date::text AS d FROM tasks WHERE workspace_id = ${school} AND kind = 'assignment' AND assignment_id IS NULL ORDER BY due_date`;
  assert.deepEqual(due.map((r) => r.d), ["2026-10-02", "2027-02-04", "2027-05-14"], "the INSET Friday moves to Thursday");
  const signOff = await assignments.createAssignmentAction({ projectId: school, title: "Policy sign-off", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.ok(signOff.success);
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${signOff.success ? signOff.masterId : ""}`;
  viewerId = teacher!;
  const h = await assignments.readHandInAction(copy!.id);
  assert.ok(h.success && h.handIn.signOff === true);
});
