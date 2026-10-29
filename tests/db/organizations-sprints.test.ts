import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.12" }) });

let sprints: typeof import("../../src/lib/workspaces/server/sprints");
let schedule: typeof import("../../src/lib/workspaces/sprint-schedule");
let orgs: typeof import("../../src/app/actions/organizations");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  sprints = await loadAppModule(() => import("../../src/lib/workspaces/server/sprints"));
  schedule = await loadAppModule(() => import("../../src/lib/workspaces/sprint-schedule"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function orgWithChild() {
  const [owner, lead] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${lead!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  const child = await sql.begin((tx) => createProject(tx, lead!, { visibility: "public" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${lead!}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${org} WHERE id = ${child}`;
  created.push(org, child);
  return { org, child, owner: owner!, lead: lead! };
}

const sprintRows = async (projectId: string) =>
  sql`SELECT id, name, status, parent_sprint_id, auto_start, start_date::date::text AS start, end_date::date::text AS "end" FROM project_sprints WHERE project_id = ${projectId} ORDER BY start_date`;

test("org sprints never overlap; a series builds the term plan", async () => {
  const { org, owner } = await orgWithChild();
  viewerId = owner;
  const series = await sprints.planSprintSeriesAction({ projectId: org, prefix: "CO", count: 3, lengthDays: 7, startDate: "2026-12-01" });
  assert.equal(series.success, true, JSON.stringify(series));
  assert.deepEqual((await sprintRows(org)).map((s) => s.name), ["CO1", "CO2", "CO3"]);
  const clash = await sprints.createSprintAction({ projectId: org, name: "Extra", startDate: "2026-12-05", endDate: "2026-12-10" });
  assert.equal(clash.success, false, "overlaps CO1/CO2");
  const again = await sprints.planSprintSeriesAction({ projectId: org, prefix: "CO", count: 2, lengthDays: 7, startDate: "2026-12-10" });
  assert.equal(again.success, false, "a series cannot overlap either");
});

test("matching sprints land in every child; a linked child sprint must fit inside", async () => {
  const { org, child, owner, lead } = await orgWithChild();
  viewerId = owner;
  const push = await sprints.createSprintAction({ projectId: org, name: "October push", startDate: "2027-01-01", endDate: "2027-01-31", createMatching: true });
  assert.equal(push.success, true, JSON.stringify(push));
  const [matching] = await sprintRows(child);
  assert.equal(matching!.name, "October push");
  assert.equal(matching!.parent_sprint_id, push.sprint!.id);

  viewerId = lead;
  const outside = await sprints.createSprintAction({ projectId: child, name: "Week 5", startDate: "2027-01-28", endDate: "2027-02-04", parentSprintId: push.sprint!.id });
  assert.equal(outside.success, false);
  const inside = await sprints.createSprintAction({ projectId: child, name: "Week 2", startDate: "2027-01-08", endDate: "2027-01-14", parentSprintId: push.sprint!.id });
  assert.equal(inside.success, true, JSON.stringify(inside));
  const stretch = await sprints.updateSprintAction({ projectId: child, sprintId: inside.sprint!.id, name: "Week 2", startDate: "2027-01-08", endDate: "2027-02-14" });
  assert.equal(stretch.success, false, "editing keeps it inside");
});

test("auto-start can be turned off; Start now starts it; cancelling an org sprint unlinks its children", async () => {
  const { org, child, owner } = await orgWithChild();
  viewerId = owner;
  const manual = await sprints.createSprintAction({ projectId: org, name: "CO9", startDate: "2020-01-01", endDate: "2020-01-08", autoStart: false, createMatching: true });
  assert.equal(manual.success, true, JSON.stringify(manual));
  await schedule.startDueSprints(new Date(), 500, org);
  assert.equal((await sprintRows(org))[0]!.status, "planning", "the scheduler skips it");
  assert.equal((await sprints.startSprintNowAction(manual.sprint!.id, org)).success, true);
  assert.equal((await sprintRows(org))[0]!.status, "active");
  assert.equal((await sprints.cancelSprintAction(manual.sprint!.id, org)).success, true);
  assert.equal((await sprintRows(child))[0]!.parent_sprint_id, null);
});

test("detaching a child unlinks its sprints", async () => {
  const { org, child, owner } = await orgWithChild();
  viewerId = owner;
  const co = await sprints.createSprintAction({ projectId: org, name: "CO1", startDate: "2027-03-01", endDate: "2027-03-08", createMatching: true });
  assert.equal(co.success, true);
  assert.equal((await orgs.detachChildAction(child)).success, true);
  assert.equal((await sprintRows(child))[0]!.parent_sprint_id, null);
});

test("sprint detail carries the org context: linked projects for the org, the org sprint for the child", async () => {
  const { org, child, owner, lead } = await orgWithChild();
  viewerId = owner;
  const co = await sprints.createSprintAction({ projectId: org, name: "CO1", startDate: "2027-04-01", endDate: "2027-04-08", createMatching: true });
  const orgDetail = await sprints.readWorkspaceSprintDetail({ slugOrId: org, sprintId: co.sprint!.id });
  assert.equal(orgDetail.success, true, JSON.stringify(orgDetail));
  const linked = orgDetail.success ? orgDetail.data.org?.linkedProjects : undefined;
  assert.equal(linked?.length, 1);
  assert.equal(orgDetail.success && orgDetail.data.org?.notLinkedCount, 0);

  viewerId = lead;
  const childDetail = await sprints.readWorkspaceSprintDetail({ slugOrId: child });
  assert.equal(childDetail.success, true, JSON.stringify(childDetail));
  const context = childDetail.success ? childDetail.data.org : null;
  assert.equal(context?.parentSprint?.name, "CO1");
  assert.equal(context?.parentSprint?.fits, true);
  assert.equal(context?.orgSprints.some((s) => s.name === "CO1"), true, "the Inside org sprint picker lists it");
});

test("materials: admins attach org docs and files to an org sprint", async () => {
  const { org, owner, lead } = await orgWithChild();
  viewerId = owner;
  const co = await sprints.createSprintAction({ projectId: org, name: "CO1", startDate: "2027-05-01", endDate: "2027-05-08" });
  const [node] = await sql`INSERT INTO project_nodes (project_id, type, name, path) VALUES (${org}, 'file', 'Syllabus.pdf', '/Syllabus.pdf') RETURNING id`;
  const added = await sprints.addSprintMaterialAction({ projectId: org, sprintId: co.sprint!.id, nodeId: node!.id as string });
  assert.equal(added.success, true, JSON.stringify(added));
  const detail = await sprints.readWorkspaceSprintDetail({ slugOrId: org, sprintId: co.sprint!.id });
  assert.deepEqual(detail.success && detail.data.materials?.map((m) => m.title), ["Syllabus.pdf"]);
  viewerId = lead;
  assert.equal((await sprints.addSprintMaterialAction({ projectId: org, sprintId: co.sprint!.id, nodeId: node!.id as string })).success, false, "members don't attach");
  // Visitors on a public Sprints tab get names and dates only (report §15.4).
  await sql`UPDATE projects SET public_tab_visibility = public_tab_visibility || '{"sprints": true}'::jsonb WHERE id = ${org}`;
  viewerId = "";
  const visitor = await sprints.readWorkspaceSprintDetail({ slugOrId: org, sprintId: co.sprint!.id });
  assert.equal(visitor.success, true, JSON.stringify(visitor));
  assert.deepEqual(visitor.success && visitor.data.materials, []);
});
