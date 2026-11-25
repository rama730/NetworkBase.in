import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B3.1b (report 32.2 calls 3–5, 8): school events — school admins add them; a class sees them (Set by the school)
// next to its own; repeats skip holidays; For me follows the audience; only public ones reach the About page.
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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.195" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let act: typeof import("../../src/app/actions/school-events");
let inst: typeof import("../../src/app/actions/institutions");
let year: typeof import("../../src/app/actions/school-year");
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
  inst = await loadAppModule(() => import("../../src/app/actions/institutions"));
  year = await loadAppModule(() => import("../../src/app/actions/school-year"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("school events reach classes, repeats skip holidays, For me follows the audience, public ones reach About", async () => {
  const [principal, teacher] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = async (owner: string, visibility = "private") => {
    const id = await sql.begin((tx) => createProject(tx, owner, { visibility }));
    created.push(id);
    await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${id}`;
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

  viewerId = principal!;
  // A holiday two weeks from now: the weekly briefing skips it.
  assert.equal((await year.saveSchoolYearAction(school, { name: "Now", terms: [{ name: "Term", start: day(-1), end: day(60) }], days: [{ name: "Break", kind: "holiday", start: day(13), end: day(15) }] })).success, true);
  const brief = await act.createEventAction(school, "Staff briefing", { type: "meeting", date: day(0), time: "08:15", repeat: { every: 1, until: day(28) } });
  assert.ok(brief.success, JSON.stringify(brief));
  assert.equal((await act.createEventAction(school, "Leaders meeting", { date: day(2), audience: { mode: "roles", classIds: [], roles: ["admin"] } })).success, true);
  assert.equal((await act.createEventAction(school, "Open evening", { type: "event", date: day(5), public: true, place: "Hall" })).success, true);
  token = "agent";
  assert.equal((await act.createEventAction(school, "x", { date: day(1) })).success, false, "never a token");
  token = null;

  viewerId = teacher!;
  assert.equal((await act.createEventAction(school, "Mine", { date: day(1) })).success, false, "teachers don't add school events");
  assert.equal((await act.createEventAction(klass, "Science fair prep", { type: "deadline", date: day(3) })).success, true, "a class adds its own");
  const seen = await act.readEventsAction(klass, day(0), day(30));
  assert.ok(seen.success);
  const briefings = seen.items.filter((e) => e.title === "Staff briefing").map((e) => e.day);
  assert.ok(!briefings.includes(day(14)), "no briefing in the holiday");
  assert.equal(briefings.length, 4);
  assert.ok(seen.items.every((e) => (e.title === "Science fair prep") !== e.fromSchool), "school events are Set by the school");
  assert.equal(seen.items.some((e) => e.title === "Leaders meeting"), false, "an admins-only school event doesn't show to a teacher");
  // Review: the general task reads follow the same rule — a school member who isn't an admin sees no school event there.
  const [hidden] = await sql`SELECT app_private.nb_org_task_visible_to(t.id, ${teacher!}::uuid) AS visible FROM tasks t WHERE t.workspace_id = ${school} AND t.title = 'Leaders meeting'`;
  assert.equal(hidden!.visible, false);
  const { orgTaskReadFilter } = await loadAppModule(() => import("../../src/lib/organizations/assignments"));
  const { getWorkspaceAccessById } = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  const { tasks } = await loadAppModule(() => import("../../src/lib/db/schema"));
  const { and, eq } = await import("drizzle-orm");
  const listed = await db.select({ title: tasks.title }).from(tasks).where(and(eq(tasks.projectId, school), orgTaskReadFilter(await getWorkspaceAccessById(school, teacher!), teacher!)));
  assert.equal(listed.some((t: { title: string }) => t.title === "Leaders meeting"), false, "the Tasks list doesn't show it either");
  assert.equal(seen.items.find((e) => e.title === "Open evening")?.forMe, true);
  assert.equal((await act.setEventStatusAction(school, brief.id, "cancelled")).success, false, "a class's staff can't change school events");

  viewerId = principal!;
  const leaders = await act.readEventsAction(school, day(0), day(30));
  assert.ok(leaders.success && leaders.items.some((e) => e.title === "Leaders meeting"), "the school's admins see every school event");
  assert.equal((await act.setEventStatusAction(school, brief.id, "confirmed")).success, true);
  viewerId = "";
  const outsider = (await Promise.all([1].map(() => sql.begin((tx) => createUser(tx)))))[0]!;
  viewerId = outsider;
  const pub = await act.readPublicEventsAction(school);
  assert.ok(pub.success);
  assert.deepEqual(pub.items.map((e) => e.title), ["Open evening"], "only public events");
  assert.deepEqual(pub.holidays.map((h) => h.name), ["Break"]);
  assert.equal((await act.readEventsAction(school, day(0), day(30))).success, false, "outsiders don't read the calendar");
  assert.equal((await act.readEventsAction(klass, day(0), day(3000))).success, false, "a read is at most 400 days");
});
