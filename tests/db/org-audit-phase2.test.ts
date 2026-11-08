import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Org workflow audit 2026-11-09, phase 2: locks, scheduled jobs, batched writes.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.41" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let assignments: typeof import("../../src/app/actions/assignments");
let publish: typeof import("../../src/lib/organizations/assignment-publish");
let schedule: typeof import("../../src/lib/workspaces/sprint-schedule");
let sprints: typeof import("../../src/lib/organizations/sprints");
let join: typeof import("../../src/lib/organizations/join");
let appDb: typeof import("../../src/lib/db");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  publish = await loadAppModule(() => import("../../src/lib/organizations/assignment-publish"));
  schedule = await loadAppModule(() => import("../../src/lib/workspaces/sprint-schedule"));
  sprints = await loadAppModule(() => import("../../src/lib/organizations/sprints"));
  join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const user = () => sql.begin((tx) => createUser(tx));
async function org() {
  const owner = await user();
  const id = await sql.begin((tx) => createProject(tx, owner));
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${code}, join_code_enabled = true,
    org_settings = ${sql.json({ joinMode: "instant" })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner, code };
}

test("N67: joining by code commits the membership first, then the late joiner's copies", async () => {
  const o = await org();
  viewerId = o.owner;
  const made = await assignments.createAssignmentAction({ projectId: o.id, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  assert.equal(made.success, true, JSON.stringify(made));
  const late = await user();
  const joined = await join.joinOrgByCode(late, o.code);
  assert.equal(joined?.outcome, "joined");
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND assignee_id = ${late}`;
  assert.equal(n, 1, "they get their copy, once");
  await join.joinOrgByCode(late, o.code);
  const [{ again }] = await sql<{ again: number }[]>`SELECT count(*)::int AS again FROM tasks WHERE assignment_id = ${made.success ? made.masterId : ""} AND assignee_id = ${late}`;
  assert.equal(again, 1);
});

test("N72: a scheduled assignment that can't publish goes back to a draft and its admin is told", async () => {
  const o = await org();
  const gone = await user();
  viewerId = o.owner;
  const made = await assignments.createAssignmentAction({ projectId: o.id, title: "Lab 2", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: false,
    submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  await sql`UPDATE tasks SET assignment_settings = assignment_settings || ${sql.json({ publishAt: new Date(Date.now() - 60_000).toISOString(), target: { mode: "people", userIds: [gone] } })} WHERE id = ${masterId}`;
  await publish.publishDueAssignments();
  const [row] = await sql<{ at: string | null; published: string | null }[]>`SELECT assignment_settings->>'publishAt' AS at, assignment_settings->>'publishedAt' AS published FROM tasks WHERE id = ${masterId}`;
  assert.deepEqual(row, { at: null, published: null }, "a draft again, not retried every hour");
  const [told] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${o.owner} AND title LIKE 'Lab 2 wasn’t published:%'`;
  assert.equal(told!.n, 1);
});

test("N71: a sprint blocked by a running one outside an organization isn't due", async () => {
  const owner = await user();
  const ws = await sql.begin((tx) => createProject(tx, owner));
  created.push(ws);
  const past = new Date(Date.now() - 864e5);
  await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, sprint_number, name, start_date, end_date, status, auto_start)
    VALUES (${ws}, ${owner}, 1, 'S1', ${past}, ${new Date(Date.now() + 864e5)}, 'active', true),
           (${ws}, ${owner}, 2, 'S2', ${past}, ${new Date(Date.now() + 9 * 864e5)}, 'planning', true)`;
  const run = await schedule.startDueSprints(new Date(), 100, ws);
  assert.equal(run.scanned, 0);
});

test("N83: matching sprints for every workspace are made in one statement", async () => {
  const o = await org();
  const kids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const child = await sql.begin((tx) => createProject(tx, o.owner));
    await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
    kids.push(child);
  }
  await sql`INSERT INTO workspace_sprints (workspace_id, creator_id, sprint_number, name, start_date, end_date, status) VALUES (${kids[0]!}, ${o.owner}, 4, 'Old', now(), now() + interval '1 day', 'completed')`;
  const [orgSprint] = await sql<{ id: string }[]>`INSERT INTO workspace_sprints (workspace_id, creator_id, sprint_number, name, start_date, end_date, status)
    VALUES (${o.id}, ${o.owner}, 1, 'CO1', now(), now() + interval '7 days', 'planning') RETURNING id`;
  const made = await appDb.db.transaction((tx) => sprints.createMatchingChildSprints(tx, { orgId: o.id, orgSprint: { id: orgSprint!.id, name: "CO1", goal: null, startDate: new Date(), endDate: new Date(Date.now() + 7 * 864e5) }, actorId: o.owner }));
  assert.equal(made, 3);
  const rows = await sql<{ workspace_id: string; sprint_number: number }[]>`SELECT workspace_id, sprint_number FROM workspace_sprints WHERE parent_sprint_id = ${orgSprint!.id} ORDER BY sprint_number DESC`;
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.workspace_id === kids[0])!.sprint_number, 5, "numbering continues per workspace");
  const [{ events }] = await sql<{ events: number }[]>`SELECT count(*)::int AS events FROM workspace_sprint_events WHERE sprint_id IN (SELECT id FROM workspace_sprints WHERE parent_sprint_id = ${orgSprint!.id})`;
  assert.equal(events, 3);
});

test("N65: two people writing files to one organization don't wait for each other", async () => {
  const o = await org();
  const helpers = await loadAppModule(() => import("../../src/lib/files/internal-helpers"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  // The owner's write holds its locks open...
  const first = appDb.db.transaction(async (tx) => { await helpers.assertWorkspaceWriteAccessTx(tx, o.id, o.owner); await held; });
  await new Promise((r) => setTimeout(r, 100));
  // ...while a second write to the same organization goes through.
  const second = appDb.db.transaction((tx) => helpers.assertWorkspaceWriteAccessTx(tx, o.id, o.owner));
  const finished = await Promise.race([second.then(() => "second done"), new Promise((r) => setTimeout(() => r("blocked"), 2_000))]);
  release();
  await first;
  assert.equal(finished, "second done");
});
