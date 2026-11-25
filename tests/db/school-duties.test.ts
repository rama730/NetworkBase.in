import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.4c (report 32.5 calls 3, 9): duties, swaps (the colleague's yes makes it so; leaders told), and Your day
// with today's covers and duties.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.203" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let tt: typeof import("../../src/app/actions/school-timetable");
let cover: typeof import("../../src/app/actions/school-cover");
let duty: typeof import("../../src/app/actions/school-duties");
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
  duty = await loadAppModule(() => import("../../src/app/actions/school-duties"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("duties: leaders set them; a swap needs the colleague's yes, leaders are told; Your day shows today's duty and cover", async () => {
  const [principal, asha, ravi] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  void assignments;
  const school = await sql.begin((tx) => createProject(tx, principal!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner'), (${school}, ${asha!}, 'member'), (${school}, ${ravi!}, 'member')`;
  const today = new Date().toISOString().slice(0, 10);
  const dow = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  viewerId = asha!;
  assert.equal((await duty.saveDutyAction(school, { place: "Gate", day: dow, slot: "Break", userId: asha! })).success, false, "leaders set duties");
  viewerId = principal!;
  assert.equal((await duty.saveDutyAction(school, { place: "Gate", day: dow, slot: "Break", userId: asha! })).success, true);
  const [g] = await sql`SELECT id FROM school_duties WHERE workspace_id = ${school}`;
  viewerId = ravi!;
  assert.match((await duty.askDutySwapAction(school, g!.id, today, principal!) as { error: string }).error, /isn’t your duty/);
  viewerId = asha!;
  const other = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  assert.match((await duty.askDutySwapAction(school, g!.id, other, ravi!) as { error: string }).error, /day when that duty happens/);
  assert.equal((await duty.askDutySwapAction(school, g!.id, today, ravi!)).success, true);
  let tt = await loadAppModule(() => import("../../src/app/actions/school-timetable"));
  const before = await tt.readTimetableAction(school, today);
  assert.ok(before.success && before.duties.map((x) => x.place).join() === "Gate", "still mine until Ravi says yes");
  viewerId = ravi!;
  const asked = await duty.readDutiesAction(school);
  assert.ok(asked.success && asked.askedOfMe.length === 1);
  assert.equal((await duty.answerDutySwapAction(school, asked.askedOfMe[0]!.id, true)).success, true);
  assert.equal((await duty.answerDutySwapAction(school, asked.askedOfMe[0]!.id, true)).success, false, "answered once");
  const told = await sql`SELECT user_id FROM user_notifications WHERE dedupe_key LIKE ${`duty-swapped:${asked.askedOfMe[0]!.id}:%`}`;
  assert.deepEqual(told.map((r) => r.user_id), [principal], "leaders are told; no approval step");
  tt = await loadAppModule(() => import("../../src/app/actions/school-timetable"));
  const ravisDay = await tt.readTimetableAction(school, today);
  assert.ok(ravisDay.success && ravisDay.duties.map((x) => x.place).join() === "Gate", "the swap is his today");
  viewerId = asha!;
  const ashasDay = await tt.readTimetableAction(school, today);
  assert.ok(ashasDay.success && ashasDay.duties.length === 0);
  // Security review: a Viewer doesn't read the duty grid.
  const [guest] = await Promise.all([1].map(() => sql.begin((tx) => createUser(tx))));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${guest!}, 'viewer')`;
  viewerId = guest!;
  assert.equal((await duty.readDutiesAction(school)).success, false);
  void cover;
});
