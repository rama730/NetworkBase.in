import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Plan B1.7a (report 30.4 W3): the student's week — sessions, due work, Missing that still takes late work, pins; only your own.
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

let week: typeof import("../../src/app/actions/my-week");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  week = await loadAppModule(() => import("../../src/app/actions/my-week"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("a student's week: every-day sessions, office hours, due work, Missing that still takes late work, own tasks; pins up to 3, own only", async () => {
  const [teacher, a, b] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const klass = await sql.begin((tx) => createProject(tx, teacher!, { visibility: "private" }));
  created.push(klass);
  const every = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day: d, start: "12:00", end: "13:00" }));
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, time_zone = 'UTC', term_start = ${day(-10)}, term_end = ${day(30)},
    org_settings = ${sql.json({ classDetails: { courseCode: "CS 301", meets: every, room: "LH-2", officeHours: { days: [0, 1, 2, 3, 4, 5, 6], start: "15:00", end: "16:00", place: "Room 12" } } } as never)} WHERE id = ${klass}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${klass}, ${teacher!}, 'owner'), (${klass}, ${a!}, 'member'), (${klass}, ${b!}, 'member')`;
  const settings = (late: string) => sql.json({ version: 1, submissionType: "text", reviewRequired: false, lateRule: late, lateUntil: null, target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null } as never);
  const [m1] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Lab 3', 'todo', 'medium', ${teacher!}, 'assignment', ${settings("always")}) RETURNING id`;
  const [m0] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Lab 1', 'todo', 'medium', ${teacher!}, 'assignment', ${settings("always")}) RETURNING id`;
  const [mx] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_settings) VALUES (${klass}, 'Lab 0', 'todo', 'medium', ${teacher!}, 'assignment', ${settings("none")}) RETURNING id`;
  const copy = async (master: string, due: string, who: string) => (await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignment_id, assignee_id, due_date)
    SELECT ${klass}, title, 'todo', 'medium', ${who}, 'task', id, ${who}, ${due} FROM tasks WHERE id = ${master} RETURNING id`)[0]!.id as string;
  const lab3 = await copy(m1!.id, inHours(30), a!);
  await copy(m0!.id, inHours(-72), a!);
  await copy(mx!.id, inHours(-72), a!);
  const personal = await sql.begin((tx) => createProject(tx, a!, { visibility: "private" }));
  created.push(personal);
  const [own] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignee_id, due_date) VALUES (${personal}, 'Read ch. 7', 'todo', 'medium', ${a!}, 'task', ${a!}, ${inHours(5)}) RETURNING id`;
  const [theirs] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignee_id, due_date) VALUES (${personal}, 'Not mine', 'todo', 'medium', ${a!}, 'task', ${b!}, ${inHours(5)}) RETURNING id`;
  viewerId = a!;
  const w = await week.readMyWeekAction("UTC");
  assert.ok(w.success && w.inClass);
  const kinds = (k: string) => w.items.filter((i) => i.kind === k);
  assert.ok(kinds("session").length >= 7 && kinds("office").length === 7, "a session and office hours every day");
  assert.deepEqual(kinds("copy").map((i) => i.title), ["Lab 3"]);
  assert.deepEqual(kinds("task").map((i) => i.title), ["Read ch. 7"]);
  assert.deepEqual(w.missing.map((i) => [i.title, i.status]), [["Lab 1", "Late work accepted"]], "Lab 0 takes no late work, so it isn't listed");
  for (const t of [lab3, own!.id]) assert.equal((await week.setDayPinAction(t, true, "UTC")).success, true);
  assert.equal((await week.setDayPinAction(theirs!.id, true, "UTC")).success, false, "only your own");
  const [extra] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignee_id) VALUES (${personal}, 'Third', 'todo', 'medium', ${a!}, 'task', ${a!}) RETURNING id`;
  const [fourth] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id, kind, assignee_id) VALUES (${personal}, 'Fourth', 'todo', 'medium', ${a!}, 'task', ${a!}) RETURNING id`;
  assert.equal((await week.setDayPinAction(extra!.id, true, "UTC")).success, true);
  assert.match((await week.setDayPinAction(fourth!.id, true, "UTC") as { error?: string }).error ?? "", /up to 3/);
  await sql`UPDATE day_pins SET day = day - 1 WHERE user_id = ${a!} AND task_id = ${lab3}`;
  const after = await week.readMyWeekAction("UTC");
  assert.ok(after.success && !after.pins.includes(lab3) && after.pins.length === 2, "yesterday's pin no longer counts");
  viewerId = teacher!;
  const t = await week.readMyWeekAction("UTC");
  assert.ok(t.success && !t.items.some((i) => i.title === "Read ch. 7") && t.missing.length === 0, "a teacher never sees a student's tasks");
});
