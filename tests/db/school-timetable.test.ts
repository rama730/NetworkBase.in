import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// B3.4a (report 32.5 calls 1–4): the school day, the timetable imported from a CSV (teachers matched by name on
// the staff), My timetable and Your day; staff read their own slots, leaders the whole timetable.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.201" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let tt: typeof import("../../src/app/actions/school-timetable");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  tt = await loadAppModule(() => import("../../src/app/actions/school-timetable"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("the school day, an imported timetable, Your day; leaders see all, staff their own", async () => {
  const [principal, teacher, other, token] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  void token; void assignments;
  const school = await sql.begin((tx) => createProject(tx, principal!));
  created.push(school);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', org_level = 'institution', join_code = ${generateJoinCode()} WHERE id = ${school}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${principal!}, 'owner'), (${school}, ${teacher!}, 'member'), (${school}, ${other!}, 'member')`;
  await sql`UPDATE profiles SET full_name = 'Asha Rao' WHERE id = ${teacher!}`;
  await sql`UPDATE profiles SET full_name = 'Ravi Lee' WHERE id = ${other!}`;
  viewerId = teacher!;
  assert.equal((await tt.saveTimetableSettingsAction(school, { patterns: [{ name: "Day", days: [1, 2, 3, 4, 5], periods: [{ key: "P1", start: "09:00", end: "10:00" }] }] })).success, false, "leaders only");
  viewerId = principal!;
  assert.match((await tt.importTimetableAction(school, [{ day: 1, period: "P1", week: null, className: "6A", teacher: "Asha Rao", room: "S1", error: null }]) as { error: string }).error, /school day first/);
  assert.equal((await tt.saveTimetableSettingsAction(school, { patterns: [{ name: "Day", days: [1, 2, 3, 4, 5], periods: [
    { key: "P1", start: "09:00", end: "10:00" }, { key: "Break", start: "10:00", end: "10:20", kind: "break" }, { key: "P2", start: "10:20", end: "11:20" }] }] })).success, true);
  const imported = await tt.importTimetableAction(school, [
    { day: 2, period: "P1", week: null, className: "6A", teacher: "asha rao", room: "S1", error: null },
    { day: 2, period: "P2", week: null, className: "7B", teacher: "Ravi Lee", room: "S2", error: null },
    { day: 3, period: "P1", week: null, className: "6B", teacher: "Somebody Else", room: "", error: null },
    { day: 2, period: "P9", week: null, className: "8C", teacher: "Asha Rao", room: "", error: null },
  ]);
  assert.deepEqual(imported, { success: true, added: 3, unmatched: ["Somebody Else"] }, "P9 isn't in the school day");
  viewerId = teacher!;
  const mine = await tt.readTimetableAction(school, "2026-09-08");
  assert.ok(mine.success);
  assert.deepEqual(mine.mine.map((s) => s.className), ["6A"], "my slots only");
  assert.deepEqual(mine.all, [], "the whole timetable is for leaders");
  assert.deepEqual(mine.yourDay.map((p) => [p.key, p.slots.map((s) => s.className)]), [["P1", ["6A"]], ["Break", []], ["P2", []]]);
  viewerId = principal!;
  const all = await tt.readTimetableAction(school);
  assert.ok(all.success && all.all.length === 3);
  // Security review: two people with one name are ambiguous — left unmatched, never guessed.
  await sql`UPDATE profiles SET full_name = 'Asha Rao' WHERE id = ${other!}`;
  const twice = await tt.importTimetableAction(school, [{ day: 2, period: "P1", week: null, className: "6A", teacher: "Asha Rao", room: "", error: null }]);
  assert.deepEqual(twice, { success: true, added: 1, unmatched: ["Asha Rao"] });
  await sql`UPDATE profiles SET full_name = 'Ravi Lee' WHERE id = ${other!}`;
  // Importing again replaces the timetable.
  await tt.importTimetableAction(school, [{ day: 4, period: "P2", week: null, className: "9A", teacher: "Ravi Lee", room: "", error: null }]);
  const again = await tt.readTimetableAction(school);
  assert.ok(again.success && again.all.map((s) => s.className).join() === "9A");
});
