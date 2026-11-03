import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 13b (report §36.6, §42.5; decisions 98, 125, 128): publish timing, materials and the "From" line.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.131" }) });
stubNextAfter();

let assignments: typeof import("../../src/app/actions/assignments");
let publishing: typeof import("../../src/lib/organizations/assignment-publish");
let schedule: typeof import("../../src/lib/workspaces/sprint-schedule");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  publishing = await loadAppModule(() => import("../../src/lib/organizations/assignment-publish"));
  schedule = await loadAppModule(() => import("../../src/lib/workspaces/sprint-schedule"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function org() {
  const [owner, admin, asha] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${asha!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, asha: asha! };
}

const base = (projectId: string) => ({ projectId, title: "Lab 1", dueDate: hours(72), submissionType: "link" as const, lateRule: "none" as const, target: { mode: "everyone" as const }, steps: [] });
const copies = async (masterId: string) => (await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${masterId} AND deleted_at IS NULL`)[0]!.n as number;
const status = async (orgId: string, masterId: string) => { const r = await assignments.listAssignmentsAction(orgId); return r.success ? r.rows.find((x) => x.masterId === masterId)?.status : null; };

test("decision 125: On a date waits as Scheduled, hidden from members, and the hourly job publishes it", async () => {
  const o = await org();
  viewerId = o.admin;
  const made = await assignments.createAssignmentAction({ ...base(o.id), publish: false, schedule: { at: hours(2) } });
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  assert.equal((await publishing.publishDueAssignments(new Date())).published, 0, "not yet");
  await sql`UPDATE tasks SET assignment_settings = jsonb_set(assignment_settings, '{publishAt}', to_jsonb((now() - interval '1 minute')::text)) WHERE id = ${masterId}`;
  assert.equal(await status(o.id, masterId), "scheduled");
  assert.equal(await copies(masterId), 0);
  viewerId = o.asha;
  assert.equal(await status(o.id, masterId), undefined, "hidden from members");
  assert.equal((await publishing.publishDueAssignments(new Date())).published, 1);
  assert.equal(await copies(masterId), 1);
  viewerId = o.admin;
  assert.equal(await status(o.id, masterId), "open");
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${o.asha} AND title LIKE '%Lab 1%'`).length, "Asha is told");
});

test("decision 125: When the sprint starts publishes as the sprint starts; Back to draft clears the schedule", async () => {
  const o = await org();
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status, sprint_number, auto_start) VALUES (${o.id}, 'CO1', now() - interval '1 hour', now() + interval '7 days', 'planning', 1, true) RETURNING id`;
  viewerId = o.admin;
  const made = await assignments.createAssignmentAction({ ...base(o.id), sprintId: sprint!.id, publish: false, schedule: { sprintStart: true } });
  const masterId = made.success ? made.masterId : "";
  const later = await assignments.createAssignmentAction({ ...base(o.id), title: "Lab 2", publish: false, schedule: { at: hours(48) } });
  const laterId = later.success ? later.masterId : "";
  assert.equal(await status(o.id, masterId), "scheduled");
  await schedule.startDueSprints(new Date(), 100, o.id);
  assert.equal(await copies(masterId), 1, "published when CO1 started");
  assert.equal((await assignments.scheduleAssignmentAction(laterId, null)).success, true);
  assert.equal(await status(o.id, laterId), "draft");
  assert.equal((await assignments.scheduleAssignmentAction(laterId, { at: hours(-5) })).success, false, "a date in the past publishes now instead");
});

test("decision 128, problem 10: materials sit on the main assignment and show on each copy, except Admins-only files", async () => {
  const o = await org();
  await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, metadata, created_by) VALUES (${o.id}, 'folder', 'Keys', '/Keys', ${sql.json({ access: "admins" })}, ${o.owner})`;
  const [open, key] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${o.id}, 'file', 'rubric.pdf', '/rubric.pdf', ${o.owner}), (${o.id}, 'file', 'answers.pdf', '/Keys/answers.pdf', ${o.owner}) RETURNING id`;
  viewerId = o.admin;
  const made = await assignments.createAssignmentAction({ ...base(o.id), publish: true, materials: [open!.id, key!.id] });
  assert.ok(made.success, JSON.stringify(made));
  const masterId = made.success ? made.masterId : "";
  const [copy] = await sql`SELECT id FROM tasks WHERE assignment_id = ${masterId}`;
  viewerId = o.asha;
  const seen = await assignments.readAssignmentMaterialsAction(copy!.id);
  assert.deepEqual(seen.success && seen.materials.map((m) => m.name), ["rubric.pdf"]);
  viewerId = o.admin;
  const all = await assignments.readAssignmentMaterialsAction(copy!.id);
  assert.deepEqual(all.success && all.materials.map((m) => m.name).sort(), ["answers.pdf", "rubric.pdf"]);
});

test("decision 98: From names the creator while they're an admin, then the organization; drafts say Draft by", async () => {
  const o = await org();
  viewerId = o.admin;
  const draft = await assignments.createAssignmentAction({ ...base(o.id), publish: false });
  const pub = await assignments.createAssignmentAction({ ...base(o.id), title: "Lab 2", publish: true });
  const row = async (id: string) => { const r = await assignments.listAssignmentsAction(o.id); return r.success ? r.rows.find((x) => x.masterId === id) : null; };
  const adminName = (await sql`SELECT coalesce(full_name, username) AS n FROM profiles WHERE id = ${o.admin}`)[0]!.n as string;
  assert.equal((await row(draft.success ? draft.masterId : ""))?.from, `Draft by ${adminName}`);
  assert.equal((await row(pub.success ? pub.masterId : ""))?.from, `From ${adminName}`);
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${o.id} AND user_id = ${o.admin}`;
  viewerId = o.owner;
  assert.equal((await row(pub.success ? pub.masterId : ""))?.from, "From CSE 3B");
});
