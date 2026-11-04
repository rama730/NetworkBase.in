import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Board/review report §6 (decisions as built): an organization's term is main sprints (CO) holding sprints.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.188" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let schedule: typeof import("../../src/lib/workspaces/sprint-schedule");
let orgSprints: typeof import("../../src/lib/organizations/sprints");
let calendar: typeof import("../../src/lib/calendar/feed");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  });
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  schedule = await loadAppModule(() => import("../../src/lib/workspaces/sprint-schedule"));
  orgSprints = await loadAppModule(() => import("../../src/lib/organizations/sprints"));
  calendar = await loadAppModule(() => import("../../src/lib/calendar/feed"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function org() {
  const [owner, a, b] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE-3B', join_code = ${generateJoinCode()}, org_settings = ${sql.json({ version: 1 })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, a: a!, b: b! };
}

async function make(o: { id: string; owner: string }, name: string, start: number, end: number, parentSprintId?: string) {
  viewerId = o.owner;
  const result = await sprints.createSprintAction({ projectId: o.id, name, startDate: day(start), endDate: day(end), autoStart: false, ...(parentSprintId ? { parentSprintId } : {}) } as never);
  return result as { success: boolean; error?: string; sprint?: { id: string } };
}

test("§6 rules: sprints sit inside a main sprint, never outside it, never over a sibling, never two levels deep; main sprints don't overlap", async () => {
  const o = await org();
  const co1 = await make(o, "CO1", 1, 42);
  assert.ok(co1.success, co1.error);
  const w1 = await make(o, "Week 1–2", 1, 14, co1.sprint!.id);
  assert.ok(w1.success, w1.error);
  const outside = await make(o, "Week 7", 40, 50, co1.sprint!.id);
  assert.equal(outside.success, false);
  assert.match(outside.error!, /CO1/);
  const clash = await make(o, "Week 2–3", 10, 20, co1.sprint!.id);
  assert.equal(clash.success, false);
  assert.match(clash.error!, /overlaps Week 1–2/);
  const deep = await make(o, "Day 1", 1, 2, w1.sprint!.id);
  assert.equal(deep.success, false);
  assert.match(deep.error!, /already inside/);
  const co2 = await make(o, "CO2", 30, 60);
  assert.equal(co2.success, false, "main sprints still don't overlap");
  assert.ok((await make(o, "CO2", 43, 80)).success);
  const [row] = await sql`SELECT parent_sprint_id FROM workspace_sprints WHERE id = ${w1.sprint!.id}`;
  assert.equal(row!.parent_sprint_id, co1.sprint!.id);
  viewerId = "";
});

test("§6 editing a main sprint: sprints inside must still fit, or move with it", async () => {
  const o = await org();
  const co1 = (await make(o, "CO1", 5, 46)).sprint!.id;
  const w5 = (await make(o, "Week 5–6", 33, 46, co1)).sprint!.id;
  viewerId = o.owner;
  const shrink = await sprints.updateSprintAction({ projectId: o.id, sprintId: co1, name: "CO1", startDate: day(5), endDate: day(40) } as never);
  assert.equal(shrink.success, false);
  assert.match((shrink as { error: string }).error, /Week 5–6/);
  const moved = await sprints.updateSprintAction({ projectId: o.id, sprintId: co1, name: "CO1", startDate: day(8), endDate: day(49), moveInsideSprints: true } as never);
  assert.ok(moved.success, JSON.stringify(moved));
  const [row] = await sql`SELECT start_date::date::text AS s, end_date::date::text AS e FROM workspace_sprints WHERE id = ${w5}`;
  assert.deepEqual([row!.s, row!.e], [day(36), day(49)]);
  viewerId = "";
});

test("§6 Several inside a main sprint splits it; the detail rolls the sprints up and lists them", async () => {
  const o = await org();
  const co1 = (await make(o, "CO1", 1, 42)).sprint!.id;
  viewerId = o.owner;
  const series = await sprints.planSprintSeriesAction({ projectId: o.id, prefix: "Week ", count: 3, lengthDays: 14, startDate: day(1), parentSprintId: co1 });
  assert.ok(series.success, JSON.stringify(series));
  const kids = await sql`SELECT id, name FROM workspace_sprints WHERE parent_sprint_id = ${co1} ORDER BY start_date`;
  assert.deepEqual(kids.map((k) => k.name), ["Week 1", "Week 2", "Week 3"]);
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id, status) VALUES (${o.id}, 'In CO', ${o.owner}, ${co1}, 'done'), (${o.id}, 'In week 1', ${o.owner}, ${kids[0]!.id}, 'todo')`;
  await sql`INSERT INTO sprint_task_memberships (workspace_id, sprint_id, task_id, added_by) SELECT ${o.id}, sprint_id, id, ${o.owner} FROM tasks WHERE workspace_id = ${o.id}`;
  const detail = await sprints.fetchWorkspaceSprintDetailAction({ projectId: o.id, sprintId: co1 });
  assert.ok(detail.success);
  const d = detail.success ? detail.data : null!;
  assert.deepEqual(d.children?.map((c) => [c.name, c.done, c.total]), [["Week 1", 0, 1], ["Week 2", 0, 0], ["Week 3", 0, 0]]);
  assert.deepEqual([d.summary?.completedTasks, d.summary?.totalTasks], [1, 2], "the main sprint counts its own and its sprints' work");
  assert.equal(d.sprints.find((s) => s.id === kids[0]!.id)?.parentSprintId, co1);
  viewerId = "";
});

test("§6 closing a main sprint closes its running sprint and cancels the upcoming ones; cancelling cancels them all", async () => {
  const o = await org();
  const co1 = (await make(o, "CO1", -10, 30)).sprint!.id;
  const running = (await make(o, "Week 1", -10, 3, co1)).sprint!.id;
  const later = (await make(o, "Week 2", 4, 17, co1)).sprint!.id;
  viewerId = o.owner;
  assert.deepEqual(await sprints.startSprintNowAction(co1, o.id), { success: true });
  assert.deepEqual(await sprints.startSprintNowAction(running, o.id), { success: true }, "a CO and a sprint inside it run together");
  const closed = await sprints.completeSprintAction(co1, o.id, { unfinished: "keep" });
  assert.ok((closed as { success: boolean }).success, JSON.stringify(closed));
  const rows = await sql`SELECT id, status FROM workspace_sprints WHERE id IN (${co1}, ${running}, ${later})`;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.status])), { [co1]: "completed", [running]: "completed", [later]: "cancelled" });
  const co2 = (await make(o, "CO2", 40, 80)).sprint!.id;
  const inside = (await make(o, "Week 1", 40, 50, co2)).sprint!.id;
  viewerId = o.owner;
  assert.ok((await sprints.cancelSprintAction(co2, o.id) as { success: boolean }).success);
  const [kid] = await sql`SELECT status FROM workspace_sprints WHERE id = ${inside}`;
  assert.equal(kid!.status, "cancelled");
  viewerId = "";
});

test("§6 D7: a sprint inside a main sprint tells only the people with work in it when it starts", async () => {
  const o = await org();
  const co1 = (await make(o, "CO1", 0, 40)).sprint!.id;
  const w1 = (await make(o, "Week 1", 0, 13, co1)).sprint!.id;
  await sql`UPDATE workspace_sprints SET notify_on_start = true WHERE id IN (${co1}, ${w1})`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id, status, assignee_id) VALUES (${o.id}, 'Lab', ${o.owner}, ${w1}, 'todo', ${o.a})`;
  await schedule.startSprint(w1, o.id, new Date(), o.owner, "manual");
  const titles = async (u: string) => (await sql<{ title: string }[]>`SELECT title FROM user_notifications WHERE user_id = ${u}`).map((r) => r.title);
  assert.ok((await titles(o.a)).some((t) => t.startsWith("CO1 · Week 1 started")), JSON.stringify(await titles(o.a)));
  assert.ok(!(await titles(o.b)).some((t) => t.includes("Week 1 started")), "nobody without work in it");
  await schedule.startSprint(co1, o.id, new Date(), o.owner, "manual");
  assert.ok((await titles(o.b)).includes("CO1 started"), "the main sprint still tells everyone");
});

test("§6 D3: a team's sprint sits inside the class's main sprint or a sprint inside it", async () => {
  const o = await org();
  const co1 = (await make(o, "CO1", 1, 42)).sprint!.id;
  const w1 = (await make(o, "Week 1", 1, 14, co1)).sprint!.id;
  const team = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${team}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${team}, ${o.owner}, 'owner') ON CONFLICT DO NOTHING`;
  viewerId = o.owner;
  const inWeek = await sprints.createSprintAction({ projectId: team, name: "Parser week", startDate: day(2), endDate: day(10), parentSprintId: w1, autoStart: false } as never);
  assert.ok((inWeek as { success: boolean }).success, JSON.stringify(inWeek));
  const inCo = await sprints.createSprintAction({ projectId: team, name: "Big push", startDate: day(20), endDate: day(30), parentSprintId: co1, autoStart: false } as never);
  assert.ok((inCo as { success: boolean }).success, JSON.stringify(inCo));
  // On the CO's page the team has a sprint (inside one of its weeks), so it isn't asked to plan one.
  const coPage = await orgSprints.readSprintOrgContext(o.id, co1);
  assert.equal(coPage?.notLinkedCount, 0, JSON.stringify(coPage?.notLinked));
  assert.ok(coPage?.linkedProjects.some((l) => l.sprintName === "Parser week"));
  // The team's prompt names the class's running sprint in full.
  await sql`UPDATE workspace_sprints SET status = 'active' WHERE id IN (${co1}, ${w1})`;
  await sql`UPDATE workspace_sprints SET status = 'planning' WHERE workspace_id = ${team}`;
  const teamPage = await orgSprints.readSprintOrgContext(team, null);
  assert.deepEqual([teamPage?.runningOrgSprint?.id, teamPage?.runningOrgSprint?.name], [w1, "CO1 · Week 1"]);
  // The calendar names a sprint inside a CO with it; the CO keeps its own span.
  const names = (await calendar.readCalendarEntries(o.owner, o.id)).filter((e) => e.kind === "sprint").map((e) => e.title);
  assert.ok(names.includes("CO1") && names.includes("CO1 · Week 1"), JSON.stringify(names));
  viewerId = "";
});
