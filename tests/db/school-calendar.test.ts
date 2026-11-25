import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B3.1c–d (report 32.2 calls 6, 7, 10): the personal and public .ics feeds, Friday's Next week at school,
// a cancellation within 48 hours, Start next year and Import….
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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.196" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/school-events");
let cal: typeof import("../../src/app/actions/school-calendar");
let inst: typeof import("../../src/app/actions/institutions");
let year: typeof import("../../src/app/actions/school-year");
let server: typeof import("../../src/lib/organizations/school-events-server");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", { ...shared, requireAuthenticatedUser: async () => (viewerId ? { user: { id: viewerId }, tokenKind: token } : Promise.reject(new Error("401"))) });
  act = await loadAppModule(() => import("../../src/app/actions/school-events"));
  cal = await loadAppModule(() => import("../../src/app/actions/school-calendar"));
  inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
  year = await loadAppModule(() => import("../../src/app/actions/school-year"));
  server = await loadAppModule(() => import("../../src/lib/organizations/school-events-server"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("feeds, Friday summary, cancellations, Start next year and Import", async () => {
  const [principal, teacher] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = async (owner: string, visibility = "private") => {
    const id = await sql.begin((tx) => createProject(tx, owner, { visibility }));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'UTC' WHERE id = ${id}`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    return id;
  };
  const school = await org(principal!, "public");
  const klass = await org(teacher!);
  viewerId = principal!;
  await inst.makeInstitutionAction(school);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${school}, ${teacher!}, 'member')`;
  viewerId = teacher!;
  await inst.joinInstitutionAction(klass, school);
  await sql`UPDATE workspaces SET institution_id = ${school} WHERE id = ${klass}`;

  // A fixed Friday: 2027-01-15. Next week (Jan 18–22) has a staff day on Monday; the Tuesday briefing still runs.
  const fri = "2027-01-15";
  viewerId = principal!;
  assert.equal((await year.saveSchoolYearAction(school, { name: "2026–27", terms: [{ name: "Term 1", start: "2026-09-01", end: "2026-12-18" }, { name: "Term 2", start: "2027-01-05", end: "2027-03-26" }],
    days: [{ name: "INSET", kind: "staff", start: "2027-01-18", end: "2027-01-18" }] })).success, true);
  const brief = await act.createEventAction(school, "Staff briefing", { type: "meeting", date: "2026-09-08", time: "08:15", repeat: { every: 1, until: "2027-03-23" } });
  assert.ok(brief.success);
  assert.equal((await act.createEventAction(school, "Leaders", { date: "2027-01-19", audience: { mode: "roles", classIds: [], roles: ["admin"] } })).success, true);
  assert.equal((await act.createEventAction(school, "Open evening", { date: "2027-01-20", time: "18:00", public: true })).success, true);
  assert.equal((await act.createEventAction(school, "Parents' evening", { type: "parents", date: "2026-10-13" })).success, true);

  // The personal feed: For me only — the teacher sees the briefing and Open evening, never Leaders.
  const mine = await server.personalSchoolEvents(teacher!, "2027-01-18", "2027-01-24");
  assert.deepEqual(mine.map((e) => e.title).sort(), ["Open evening", "Staff briefing"]);

  // Friday 4 PM: Next week at school, once per person; the teacher's says 2 events and the staff day.
  const at = new Date(`${fri}T16:00:00Z`);
  await server.notifySchoolWeek(at);
  await server.notifySchoolWeek(at);
  const sent = await sql`SELECT user_id, title FROM user_notifications WHERE dedupe_key LIKE ${`school-week:${school}:%`} ORDER BY title`;
  assert.equal(sent.length, 2, "once each for the principal and the teacher");
  assert.ok(sent.some((n) => n.user_id === teacher && n.title === "Next week at school: 2 events · Staff day"), JSON.stringify(sent));
  await server.notifySchoolWeek(new Date(`${fri}T10:00:00Z`));
  assert.equal((await sql`SELECT 1 FROM user_notifications WHERE dedupe_key LIKE ${`school-week:${school}:%`}`).length, 2, "not before 3 PM");

  // Cancelled within 48 hours: Important to the people it was for, not the one who cancelled.
  const [open] = await sql`SELECT id FROM tasks WHERE workspace_id = ${school} AND title = 'Open evening'`;
  await server.notifyEventCancelled(school, open!.id, principal!, new Date("2027-01-19T09:00:00Z"));
  const cancelled = await sql`SELECT user_id, importance FROM user_notifications WHERE dedupe_key LIKE ${`event-cancelled:${open!.id}:%`}`;
  assert.deepEqual(cancelled.map((n) => [n.user_id, n.importance]), [[teacher, "important"]]);

  // The public feed: public events and holidays only, for a school anyone may see.
  const { GET } = await loadAppModule(() => import("../../src/app/api/feeds/school/[id]/route"));
  const body = await (await GET(new Request("http://x"), { params: Promise.resolve({ id: `${school}.ics` }) })).text();
  assert.ok(body.includes("BEGIN:VCALENDAR") && body.includes("Open evening"), body);
  assert.equal(body.includes("Leaders") || body.includes("Staff briefing"), false, "nothing that isn't public");
  await sql`UPDATE workspaces SET visibility = 'private' WHERE id = ${school}`;
  assert.equal((await GET(new Request("http://x"), { params: Promise.resolve({ id: school }) })).status, 404, "a private school has no public feed");
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${school}`;

  // Import: rows are checked again on the server; holidays join the year, the rest become events.
  token = "agent";
  assert.equal((await cal.importSchoolCalendarAction(school, [{ name: "x", kind: "event", start: "2027-02-01", end: "2027-02-01", time: null, place: "", error: null }])).success, false, "never a token");
  token = null;
  const imported = await cal.importSchoolCalendarAction(school, [
    { name: "February break", kind: "holiday", start: "2027-02-15", end: "2027-02-19", time: null, place: "", error: null },
    { name: "Science fair", kind: "event", start: "2027-03-04", end: "2027-03-04", time: "13:00", place: "Hall", error: null },
    { name: "Bad", kind: "event", start: "2027-02-30", end: "2027-01-01", time: null, place: "", error: null },
  ]);
  assert.deepEqual(imported, { success: true, days: 1, events: 1 });
  viewerId = teacher!;
  assert.equal((await cal.importSchoolCalendarAction(school, [{ name: "x", kind: "event", start: "2027-02-01", end: "2027-02-01", time: null, place: "", error: null }])).success, false, "school admins only");

  // Start next year: the briefing moves to the same week of term; Parents' evening is offered; only ticked ones come.
  viewerId = principal!;
  const next = { name: "2027–28", terms: [{ name: "Term 1", start: "2027-08-31", end: "2027-12-17" }, { name: "Term 2", start: "2028-01-04", end: "2028-03-24" }], days: [] };
  assert.equal((await cal.previewNextYearAction(school, { ...next, terms: [{ name: "T", start: "2027-03-01", end: "2027-04-01" }] })).success, false, "starts after this year ends");
  const preview = await cal.previewNextYearAction(school, next);
  assert.ok(preview.success);
  assert.deepEqual(preview.copy.map((e) => [e.title, e.date]), [["Staff briefing", "2027-09-07"]]);
  assert.ok(preview.offer.some((e) => e.title === "Parents' evening" && e.date === "2027-10-12"));
  const started = await cal.startNextYearAction(school, next, preview.offer.filter((e) => e.title === "Parents' evening").map((e) => e.id));
  assert.deepEqual(started, { success: true, added: 2, classes: 1 });
  const [k] = await sql`SELECT term_start, org_settings->'schoolYear'->>'name' AS name FROM workspaces WHERE id = ${klass}`;
  assert.equal(k!.name, "2027–28", "classes follow the new year");
  const [copies] = await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${school} AND item_type = 'event' AND type_fields->>'date' >= '2027-08-31'`;
  assert.equal(copies!.n, 2);
});
