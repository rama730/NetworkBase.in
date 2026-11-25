import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.5a–b (report 32.6 calls 3–5, 8): Reports to, goals (up to 3), the year review in words (no ratings) and the
// development log — read by the person and their line manager only; leaders see counts.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.204" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let tt: typeof import("../../src/app/actions/school-timetable");
let cover: typeof import("../../src/app/actions/school-cover");
let growth: typeof import("../../src/app/actions/staff-growth");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tt = await loadAppModule(() => import("../../src/app/actions/school-timetable"));
  cover = await loadAppModule(() => import("../../src/app/actions/school-cover"));
  growth = await loadAppModule(() => import("../../src/app/actions/staff-growth"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("Reports to; goals up to 3; the review's parts by who writes them; only the person and their line manager read it", async () => {
  const [head, asha, ravi] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  void assignments; void cover;
  const school = await sql.begin((tx) => createProject(tx, head!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${head!}, 'owner'), (${school}, ${asha!}, 'member'), (${school}, ${ravi!}, 'member')`;
  viewerId = asha!;
  assert.equal((await growth.saveStaffGrowthSettingsAction(school, { reportsTo: { [asha!]: head! }, headings: ["Teaching"] })).success, false, "leaders set Reports to");
  viewerId = head!;
  assert.match((await growth.saveStaffGrowthSettingsAction(school, { reportsTo: { [asha!]: asha! }, headings: ["Teaching"] }) as { error: string }).error, /someone else/);
  assert.equal((await growth.saveStaffGrowthSettingsAction(school, { reportsTo: { [asha!]: head! }, headings: ["Teaching", "Colleagues"] })).success, true);
  const year = "2026";
  viewerId = asha!;
  for (const t of ["Questioning", "Feedback", "Reading"]) assert.equal((await growth.saveGrowthAction(school, null, { kind: "goal", year, title: t })).success, true);
  assert.match((await growth.saveGrowthAction(school, null, { kind: "goal", year, title: "Fourth" }) as { error: string }).error, /Up to 3/);
  assert.equal((await growth.saveGrowthAction(school, null, { kind: "review", year, title: "Year review", body: { reflection: "Better questions this term" } })).success, true);
  assert.equal((await growth.saveGrowthAction(school, null, { kind: "review", year, title: "Year review", body: { manager: "x" } })).success, false, "the manager's part is the manager's");
  await growth.saveGrowthAction(school, null, { kind: "log", year, title: "Assessment course" });
  viewerId = head!;
  assert.equal((await growth.saveGrowthAction(school, asha!, { kind: "review", year, title: "Year review", body: { manager: "Strong progress" } })).success, true);
  assert.equal((await growth.saveGrowthAction(school, asha!, { kind: "goal", year, title: "x" })).success, false, "goals are the person's own");
  const asManager = await growth.readGrowthAction(school, asha!, year);
  assert.ok(asManager.success);
  assert.deepEqual([asManager.goals.length, asManager.review?.body, asManager.log.length], [3, { reflection: "Better questions this term", manager: "Strong progress" }, 1]);
  viewerId = ravi!;
  assert.equal((await growth.readGrowthAction(school, asha!, year)).success, false, "a colleague can't read it");
  assert.equal((await growth.readGrowthCountsAction(school, year)).success, false, "counts are for leaders");
  viewerId = head!;
  const counts = await growth.readGrowthCountsAction(school, year);
  assert.ok(counts.success);
  assert.deepEqual([counts.withGoals, counts.reviews, counts.logs], [1, 1, 1]);
  assert.equal(JSON.stringify(counts).includes("Questioning"), false, "counts only");
});
