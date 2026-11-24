import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.4a (report 30.7 W6): attendance — take, %, the 7-day rule, a student sees only their own.
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

let att: typeof import("../../src/app/actions/attendance");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  att = await loadAppModule(() => import("../../src/app/actions/attendance"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

/** A class meeting Tue and Thu 10:30 (UTC) for a term that started three weeks ago, so sessions have been held. */
async function setup() {
  const [teacher, ta, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  const start = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'UTC', term_start = ${start}, term_end = ${end},
    org_settings = coalesce(org_settings, '{}'::jsonb) || '{"classDetails":{"meets":[{"day":2,"start":"10:30","end":"12:00"},{"day":4,"start":"10:30","end":"12:00"}]}}'::jsonb WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (${klass}, ${teacher!}, 'owner', now() - interval '30 days'), (${klass}, ${ta!}, 'admin', now() - interval '30 days'),
    (${klass}, ${a!}, 'member', now() - interval '30 days'), (${klass}, ${b!}, 'member', now() - interval '30 days')`;
  return { teacher: teacher!, ta: ta!, a: a!, b: b!, klass };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("off until the teacher turns it on; staff take it; % counts late as present; a student sees only their own line", async () => {
  const t = await setup();
  viewerId = t.teacher;
  const first = await att.readAttendanceAction(t.klass);
  assert.ok(first.success && first.sessions.length >= 4);
  const [s1, s2] = [first.sessions[0]!.key, first.sessions[1]!.key];
  assert.match(errorOf(await att.saveAttendanceAction(t.klass, s1, [])), /Turn attendance on/);
  assert.equal((await att.saveAttendanceSettingsAction(t.klass, { on: true, lateCountsPresent: true, lateAfterMinutes: 10, absenceNotes: true, minimum: 75 })).success, true);
  viewerId = t.ta;
  assert.equal((await att.saveAttendanceAction(t.klass, s1, [{ userId: t.a, status: "present" }, { userId: t.b, status: "absent" }, { userId: t.ta, status: "present" }])).success, true);
  assert.equal((await att.saveAttendanceAction(t.klass, s2, [{ userId: t.a, status: "late" }, { userId: t.b, status: "excused" }])).success, true);
  const staff = await att.readAttendanceAction(t.klass);
  assert.ok(staff.success);
  assert.deepEqual(staff.students.map((s) => [s.id === t.a ? "a" : "b", s.percent, s.below]).sort(), [["a", 100, false], ["b", 0, true]]);
  assert.equal(staff.students.some((s) => s.id === t.ta), false, "only students are on the register");
  viewerId = t.b;
  const mine = await att.readAttendanceAction(t.klass);
  assert.ok(mine.success);
  assert.deepEqual([mine.role, mine.students.length, mine.students[0]!.id], ["student", 1, t.b], "a student never receives another's records");
  assert.equal((await att.saveAttendanceAction(t.klass, s1, [{ userId: t.b, status: "present" }])).success, false, "students don't mark");
  viewerId = t.teacher;
  const csv = await att.exportRegisterAction(t.klass);
  assert.ok(csv.success && csv.csv.split("\n").length === 3);
});

test("the 7-day rule: after a week only the Teacher changes records, and each change is kept", async () => {
  const t = await setup();
  viewerId = t.teacher;
  await att.saveAttendanceSettingsAction(t.klass, { on: true, lateCountsPresent: true, lateAfterMinutes: 10, absenceNotes: true, minimum: null });
  const r = await att.readAttendanceAction(t.klass);
  assert.ok(r.success);
  const old = r.sessions[0]!.key;
  await att.saveAttendanceAction(t.klass, old, [{ userId: t.a, status: "absent" }]);
  viewerId = t.ta;
  assert.match(errorOf(await att.saveAttendanceAction(t.klass, old, [{ userId: t.a, status: "present" }])), /only the Teacher/);
  viewerId = t.teacher;
  assert.equal((await att.saveAttendanceAction(t.klass, old, [{ userId: t.a, status: "excused" }])).success, true);
  const [row] = await sql`SELECT status, jsonb_array_length(history) AS changes FROM attendance_records WHERE workspace_id = ${t.klass} AND user_id = ${t.a}`;
  assert.deepEqual([row!.status, row!.changes], ["excused", 1]);
  assert.match(errorOf(await att.saveAttendanceAction(t.klass, "2099-01-01T10:30", [])), /isn’t a session/);
});
