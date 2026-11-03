import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 12 (report §16.2, §18.2, §28.2, §33.4, §37.2, §42.5, §42.6): sprints.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.120" }) });

let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let schedule: typeof import("../../src/lib/workspaces/sprint-schedule");
let orgSprints: typeof import("../../src/lib/organizations/sprints");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  schedule = await loadAppModule(() => import("../../src/lib/workspaces/sprint-schedule"));
  orgSprints = await loadAppModule(() => import("../../src/lib/organizations/sprints"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function org() {
  const [owner, admin, lead, member] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${lead!}, 'member'), (${id}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  const child = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${child}, ${lead!}, 'owner'), (${child}, ${member!}, 'member')`;
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Team Falcon' WHERE id = ${child}`;
  created.push(id);
  return { id, child, owner: owner!, admin: admin!, lead: lead!, member: member! };
}

const rows = async (projectId: string) =>
  sql`SELECT id, name, status, start_date::date::text AS start, end_date::date::text AS "end", parent_sprint_id FROM workspace_sprints WHERE workspace_id = ${projectId} ORDER BY start_date, name`;

test("problem 3, decisions 122 and 123: an ended organization sprint hands over to the next by itself, nothing moved", async () => {
  const o = await org();
  viewerId = o.owner;
  assert.equal((await sprints.planSprintSeriesAction({ projectId: o.id, prefix: "CO", count: 2, lengthDays: 7, startDate: day(-8) })).success, true);
  const [co1] = await rows(o.id);
  assert.equal(co1!.end, day(-2), "CO1 ends the day before CO2 starts");
  await sql`UPDATE workspace_sprints SET status = 'active', started_at = now() WHERE id = ${co1!.id}`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, sprint_id, status) VALUES (${o.id}, 'Read chapter 2', ${o.owner}, ${co1!.id}, 'todo') RETURNING id`;
  await schedule.startDueSprints(new Date(), 100, o.id);
  const after = await rows(o.id);
  assert.deepEqual(after.map((s) => s.status), ["completed", "active"]);
  const [kept] = await sql`SELECT sprint_id FROM tasks WHERE id = ${task!.id}`;
  assert.equal(kept!.sprint_id, co1!.id, "unfinished work stays where it is");
  const [event] = await sql`SELECT payload FROM workspace_sprint_events WHERE sprint_id = ${co1!.id} AND event_type = 'completed'`;
  assert.equal(event!.payload.source, "handover");
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${o.admin} AND title LIKE 'CO1 completed%'`).length, "admins get the summary");
});

test("42.18 #1: a normal workspace's ended sprint still waits for Complete", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner}, 'owner')`;
  created.push(ws);
  viewerId = owner;
  assert.equal((await sprints.planSprintSeriesAction({ projectId: ws, prefix: "Sprint ", count: 2, lengthDays: 7, startDate: day(-8) })).success, true, "Repeat works in any workspace");
  const [first] = await rows(ws);
  await sql`UPDATE workspace_sprints SET status = 'active', started_at = now() WHERE id = ${first!.id}`;
  await schedule.startDueSprints(new Date(), 100, ws);
  assert.deepEqual((await rows(ws)).map((s) => [s.name, s.status]), [["Sprint 1", "active"], ["Sprint 2", "planning"]]);
  assert.equal((await sprints.planSprintSeriesAction({ projectId: ws, prefix: "Sprint ", count: 1, lengthDays: 7, startDate: day(30) })).success, true);
  assert.equal((await rows(ws)).at(-1)!.name, "Sprint 3", "numbering continues");
});

test("37.2: a running sprint can be edited, except its start", async () => {
  const o = await org();
  viewerId = o.owner;
  const made = await sprints.createSprintAction({ projectId: o.id, name: "CO1", startDate: day(-2), endDate: day(5) });
  assert.ok(made.success);
  const id = made.success ? made.sprint.id : "";
  await sql`UPDATE workspace_sprints SET status = 'active', started_at = now() WHERE id = ${id}`;
  const longer = await sprints.updateSprintAction({ projectId: o.id, sprintId: id, name: "CO1 · Parsing", startDate: day(-2), endDate: day(9) });
  assert.equal(longer.success, true, JSON.stringify(longer));
  const moved = await sprints.updateSprintAction({ projectId: o.id, sprintId: id, name: "CO1", startDate: day(-1), endDate: day(9) });
  assert.deepEqual(moved, { success: false, error: "A running sprint keeps its start date." });
});

test("decision 59: Move later sprints too shifts later planned ones together, or nothing when it would clash", async () => {
  const o = await org();
  viewerId = o.owner;
  await sprints.planSprintSeriesAction({ projectId: o.id, prefix: "CO", count: 3, lengthDays: 7, startDate: day(10) });
  const [co1] = await rows(o.id);
  const shifted = await sprints.updateSprintAction({ projectId: o.id, sprintId: co1!.id, name: "CO1", startDate: day(17), endDate: day(23), moveLaterSprints: true });
  assert.equal(shifted.success, true, JSON.stringify(shifted));
  assert.deepEqual((await rows(o.id)).map((s) => [s.name, s.start]), [["CO1", day(17)], ["CO2", day(24)], ["CO3", day(31)]]);
  // Finished sprints never move, so moving into one is a clash that saves nothing.
  const week0 = await sprints.createSprintAction({ projectId: o.id, name: "Week 0", startDate: day(1), endDate: day(5) });
  await sql`UPDATE workspace_sprints SET status = 'completed' WHERE id = ${week0.success ? week0.sprint.id : null}`;
  const clash = await sprints.updateSprintAction({ projectId: o.id, sprintId: co1!.id, name: "CO1", startDate: day(3), endDate: day(9), moveLaterSprints: true });
  assert.equal(clash.success, false);
  assert.match(clash.success ? "" : clash.error, /Week 0/);
  assert.deepEqual((await rows(o.id)).filter((r) => r.name.startsWith("CO")).map((r) => r.start), [day(17), day(24), day(31)], "all or nothing");
});

test("18.2, decision 131: Plan your sprint stays inside CO1, names its limit, and brings the group work", async () => {
  const o = await org();
  viewerId = o.owner;
  const co1 = await sprints.createSprintAction({ projectId: o.id, name: "CO1", startDate: day(0), endDate: day(14) });
  const co1Id = co1.success ? co1.sprint.id : "";
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id) VALUES (${o.id}, 'Milestone 1', 'assignment', ${o.owner}) RETURNING id`;
  const [group] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_id, assignee_id) VALUES (${o.child}, 'Milestone 1', 'task', ${o.owner}, ${master!.id}, ${o.lead}) RETURNING id`;
  viewerId = o.lead;
  const context = await orgSprints.readSprintOrgContext(o.child, null);
  assert.equal(context?.groupBacklog, 1);
  const late = await sprints.createSprintAction({ projectId: o.child, name: "Parser week", startDate: day(1), endDate: day(20), parentSprintId: co1Id });
  assert.equal(late.success, false);
  assert.match(late.success ? "" : late.error, /^CO1 ends .+\. Pick an earlier date\.$/);
  const made = await sprints.createSprintAction({ projectId: o.child, name: "Parser week", startDate: day(1), endDate: day(10), parentSprintId: co1Id, includeGroupWork: true });
  assert.equal(made.success, true, JSON.stringify(made));
  const [task] = await sql`SELECT sprint_id FROM tasks WHERE id = ${group!.id}`;
  assert.equal(task!.sprint_id, made.success ? made.sprint.id : null);
});

test("18.2: Fix dates pulls a team sprint back inside CO1 after CO1 moves", async () => {
  const o = await org();
  viewerId = o.owner;
  const co1 = await sprints.createSprintAction({ projectId: o.id, name: "CO1", startDate: day(5), endDate: day(19) });
  const co1Id = co1.success ? co1.sprint.id : "";
  viewerId = o.lead;
  const team = await sprints.createSprintAction({ projectId: o.child, name: "Parser week", startDate: day(5), endDate: day(19), parentSprintId: co1Id });
  const teamId = team.success ? team.sprint.id : "";
  await sql`UPDATE workspace_sprints SET end_date = ${day(12)}::date WHERE id = ${co1Id}`;
  assert.equal((await sprints.fitSprintToParentAction({ projectId: o.child, sprintId: teamId })).success, true);
  const [fixed] = await sql`SELECT start_date::date::text AS start, end_date::date::text AS "end" FROM workspace_sprints WHERE id = ${teamId}`;
  assert.deepEqual([fixed!.start, fixed!.end], [day(5), day(12)]);
});

test("37.2, decision 137: material search marks Admins-only files; the Workspaces panel lists the unlinked; Remind is honest", async () => {
  const o = await org();
  viewerId = o.owner;
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, metadata, created_by) VALUES (${o.id}, 'folder', 'Answer keys', '/Answer keys', ${sql.json({ access: "admins" })}, ${o.owner})`;
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${o.id}, 'file', 'key-week1.pdf', '/Answer keys/key-week1.pdf', ${o.owner}), (${o.id}, 'file', 'key-notes.pdf', '/key-notes.pdf', ${o.owner})`;
  const found = await sprints.searchSprintMaterialCandidatesAction({ projectId: o.id, query: "key" });
  assert.deepEqual(found.files.map((f) => [f.title, f.adminsOnly]).sort(), [["key-notes.pdf", false], ["key-week1.pdf", true]]);
  const co1 = await sprints.createSprintAction({ projectId: o.id, name: "CO1", startDate: day(0), endDate: day(14) });
  const co1Id = co1.success ? co1.sprint.id : "";
  const context = await orgSprints.readSprintOrgContext(o.id, co1Id);
  assert.deepEqual(context?.notLinked.map((w) => w.title), ["Team Falcon"]);
  const first = await sprints.remindSprintLeadsAction({ projectId: o.id, sprintId: co1Id, workspaceIds: [o.child] });
  assert.deepEqual(first, { success: true, reminded: 1, skipped: 0 });
  assert.deepEqual(await sprints.remindSprintLeadsAction({ projectId: o.id, sprintId: co1Id, workspaceIds: [o.child] }), { success: true, reminded: 0, skipped: 1 });
  viewerId = o.member;
  assert.equal((await sprints.remindSprintLeadsAction({ projectId: o.id, sprintId: co1Id, workspaceIds: [o.child] })).success, false);
});

test("37.2: Complete can close the sprint's open assignments; left unticked they stay open", async () => {
  const o = await org();
  const [s1] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status) VALUES (${o.id}, 'CO1', now() - interval '7 days', now() - interval '1 day', 'active') RETURNING id`;
  const settings = { publishedAt: new Date().toISOString(), submissionType: "none", target: { mode: "everyone" } };
  await sql`INSERT INTO tasks (workspace_id, title, kind, sprint_id, assignment_settings, creator_id) VALUES (${o.id}, 'Lab 1', 'assignment', ${s1!.id}, ${sql.json(settings)}, ${o.owner})`;
  viewerId = o.owner;
  assert.equal(await sprints.countOpenSprintAssignmentsAction(s1!.id, o.id), 1);
  const done = await sprints.completeSprintAction(s1!.id, o.id, { closeAssignments: true });
  assert.equal(done.success, true, JSON.stringify(done));
  const [lab] = await sql`SELECT assignment_settings->>'closedAt' AS closed FROM tasks WHERE sprint_id = ${s1!.id} AND kind = 'assignment'`;
  assert.ok(lab!.closed, "closed with the sprint");
  viewerId = o.member;
  assert.equal(await sprints.countOpenSprintAssignmentsAction(s1!.id, o.id), 0, "members don't get the count");
});

test("18.2: Plan one for each makes a team sprint inside every planned organization sprint, once", async () => {
  const o = await org();
  await sql`INSERT INTO workspace_sprints (workspace_id, name, sprint_number, start_date, end_date, status, show_in_children) VALUES
    (${o.id}, 'CO2', 2, now() + interval '10 days', now() + interval '16 days', 'planning', true), (${o.id}, 'CO3', 3, now() + interval '17 days', now() + interval '23 days', 'planning', true)`;
  viewerId = o.lead;
  const made = await sprints.planOneForEachAction({ projectId: o.child, name: "Parser week" });
  assert.deepEqual(made, { success: true, created: 2 });
  const rows = await sql`SELECT c.name, o.name AS parent FROM workspace_sprints c JOIN workspace_sprints o ON o.id = c.parent_sprint_id WHERE c.workspace_id = ${o.child} ORDER BY c.name`;
  assert.deepEqual(rows.map((r) => [r.name, r.parent]), [["Parser week 1", "CO2"], ["Parser week 2", "CO3"]]);
  assert.equal((await sprints.planOneForEachAction({ projectId: o.child, name: "Again" })).success, false, "nothing left to plan");
});

test("live-fix 34: Share with workspaces: Selected reaches only the chosen ones, None reaches none", async () => {
  const o = await org();
  const other = await sql.begin((tx) => createProject(tx, o.lead, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Osprey' WHERE id = ${other}`;
  viewerId = o.owner;
  const shared = await sprints.createSprintAction({ projectId: o.id, name: "CO1", startDate: day(0), endDate: day(14), sharedWith: "selected", sharedWorkspaceIds: [o.child], createMatching: true });
  assert.equal(shared.success, true, JSON.stringify(shared));
  viewerId = o.lead;
  const seen = async (child: string) => ((await orgSprints.readSprintOrgContext(child, null))?.orgSprints ?? []).map((s) => s.name);
  assert.deepEqual([await seen(o.child), await seen(other)], [["CO1"], []]);
  assert.deepEqual([(await rows(o.child)).map((r) => r.name), (await rows(other)).map((r) => r.name)], [["CO1"], []], "Teams plan their own sprint inside it: only the chosen ones");

  viewerId = o.owner;
  const hidden = await sprints.createSprintAction({ projectId: o.id, name: "CO2", startDate: day(15), endDate: day(28), sharedWith: "none", announcement: "CO2 is planned · starts soon." });
  assert.equal(hidden.success, true);
  const [post] = await sql`SELECT content FROM workspace_updates WHERE workspace_id = ${o.id} AND content = 'CO2 is planned · starts soon.'`;
  assert.ok(post, "Post an announcement posts it");
  viewerId = o.lead;
  assert.equal((await seen(o.child)).includes("CO2"), false);
  viewerId = o.owner;
  const context = await orgSprints.readSprintOrgContext(o.id, null);
  const flags = context?.sprintFlags[shared.success ? shared.sprint.id : ""];
  assert.deepEqual([flags?.sharedWith, flags?.sharedWorkspaceIds], ["selected", [o.child]]);
  assert.deepEqual(context?.children?.map((c) => c.title).sort(), ["Team Falcon", "Team Osprey"]);
  const selected = await orgSprints.readSprintOrgContext(o.id, shared.success ? shared.sprint.id : null);
  assert.deepEqual(selected?.notLinked.map((n) => n.title), [], "Team Osprey isn't in this sprint, so it isn't 'not linked'");
});
