import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.4b (report 32.5 calls 5–7, 12): absences by day or period (reasons for leaders only), open cover slots,
// suggestions (free → same department → fewest covers), the manager picks, the cover person is told (Important).

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.202" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let tt: typeof import("../../src/app/actions/school-timetable");
let cover: typeof import("../../src/app/actions/school-cover");
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
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("away by periods opens cover slots; suggestions with reasons; the manager picks; reasons only for leaders", async () => {
  const [principal, asha, ravi, mo] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  void assignments;
  const school = await sql.begin((tx) => createProject(tx, principal!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner'), (${school}, ${asha!}, 'member'), (${school}, ${ravi!}, 'member'), (${school}, ${mo!}, 'member')`;
  await sql`UPDATE profiles SET full_name = CASE id WHEN ${asha!}::uuid THEN 'Asha Rao' WHEN ${ravi!}::uuid THEN 'Ravi Lee' WHEN ${mo!}::uuid THEN 'Mo Khan' ELSE full_name END WHERE id IN (${asha!}, ${ravi!}, ${mo!})`;
  viewerId = principal!;
  await tt.saveTimetableSettingsAction(school, { patterns: [{ name: "Day", days: [1, 2, 3, 4, 5], periods: [{ key: "P1", start: "09:00", end: "10:00" }, { key: "P2", start: "10:00", end: "11:00" }, { key: "P3", start: "11:00", end: "12:00" }] }] });
  // Tuesday: Asha teaches 6A P1 and 6B P3; Ravi teaches 7A P3; Mo is free.
  await tt.importTimetableAction(school, [
    { day: 2, period: "P1", week: null, className: "6A", teacher: "Asha Rao", room: "S1", error: null },
    { day: 2, period: "P3", week: null, className: "6B", teacher: "Asha Rao", room: "S1", error: null },
    { day: 2, period: "P3", week: null, className: "7A", teacher: "Ravi Lee", room: "S2", error: null },
  ]);
  const day = "2026-09-08";
  viewerId = asha!;
  assert.equal((await cover.reportAbsenceAction(school, { userId: ravi!, day })).success, false, "staff report only their own");
  assert.equal((await cover.reportAbsenceAction(school, { day, from: "P2", to: "P3", reason: "Doctor" })).success, true);
  assert.equal((await cover.readCoverBoardAction(school, day)).success, false, "the board is for leaders");
  viewerId = principal!;
  const board = await cover.readCoverBoardAction(school, day);
  assert.ok(board.success && !board.needsDay);
  assert.deepEqual(board.absences.map((a) => [a.name, a.from, a.to, a.reason]), [["Asha Rao", "P2", "P3", "Doctor"]]);
  assert.deepEqual(board.slots.map((s) => [s.className, s.period, Boolean(s.cover)]), [["6B", "P3", false]], "only her P3 lesson (P1 isn't in the absence)");
  const names = board.slots[0]!.suggestions.map((g) => g.name);
  assert.ok(names.includes("Mo Khan") && !names.includes("Ravi Lee") && !names.includes("Asha Rao"), "free that period only");
  assert.equal((await cover.assignCoverAction(school, board.slots[0]!.id, day, asha!)).success, false, "not the absent teacher");
  assert.equal((await cover.assignCoverAction(school, board.slots[0]!.id, day, mo!, "Worksheet on the desk")).success, true);
  const after = await cover.readCoverBoardAction(school, day);
  assert.ok(after.success && after.filled === 1 && after.slots[0]!.cover?.name === "Mo Khan");
  const [n] = await sql`SELECT importance, title FROM user_notifications WHERE user_id = ${mo!} AND dedupe_key LIKE 'cover:%'`;
  assert.deepEqual([n!.importance, n!.title], ["important", "Cover: 6B P3 · S1 · Tuesday 2026-09-08"]);
  viewerId = mo!;
  const mine = await cover.readMyCoverAction(school, day);
  assert.ok(mine.success);
  assert.deepEqual(mine.covers.map((c) => [c.class_name, c.period, c.note]), [["6B", "P3", "Worksheet on the desk"]]);
  assert.equal(JSON.stringify(mine).includes("Doctor"), false, "reasons stay with leaders");
});
