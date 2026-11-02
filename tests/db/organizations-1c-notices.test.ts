import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §41.3 deploy 1c (notices): one test per item, each failing before its fix.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.16" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });

let assignments: typeof import("../../src/app/actions/assignments");
let members: typeof import("../../src/app/actions/org-members");
let dash: typeof import("../../src/app/actions/org-dashboard");
let orgs: typeof import("../../src/app/actions/organizations");
let tasks: typeof import("../../src/lib/workspaces/server/tasks");
let digests: typeof import("../../src/lib/organizations/org-digests");
let notify: typeof import("../../src/lib/organizations/assignment-notify");
let appDb: typeof import("../../src/lib/db");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null }),
  });
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  tasks = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  digests = await loadAppModule(() => import("../../src/lib/organizations/org-digests"));
  notify = await loadAppModule(() => import("../../src/lib/organizations/assignment-notify"));
  appDb = await loadAppModule(() => import("../../src/lib/db"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Org = { org: string; owner: string; admin: string; a: string; b: string };

async function org(): Promise<Org> {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  await sql`UPDATE profiles SET notification_preferences = ${sql.json({ quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: "UTC" } })} WHERE id IN (${owner!}, ${admin!}, ${a!}, ${b!})`;
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A', time_zone = 'UTC', slug = ${`cse-${id.slice(0, 8)}`} WHERE id = ${id}`;
  created.push(id);
  return { org: id, owner: owner!, admin: admin!, a: a!, b: b! };
}

const tray = (userId: string) => sql<{ title: string; dedupe_key: string }[]>`SELECT title, dedupe_key FROM user_notifications WHERE user_id = ${userId} ORDER BY created_at`;
const titles = async (userId: string) => (await tray(userId)).map((r) => r.title);

async function published(o: Org, title: string, extra: Partial<Parameters<typeof assignments.createAssignmentAction>[0]> = {}) {
  viewerId = o.owner;
  const result = await assignments.createAssignmentAction({ projectId: o.org, title, dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(), publish: true, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, steps: [], ...extra } as Parameters<typeof assignments.createAssignmentAction>[0]);
  assert.equal(result.success, true, JSON.stringify(result));
  const master = result.success ? result.masterId : "";
  const rows = await sql`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${master}`;
  return { master, copyOf: (user: string) => rows.find((r) => r.assignee_id === user)!.id as string };
}

async function child(orgId: string | null, lead: string, title = "Team Falcon") {
  const id = await sql.begin((tx) => createProject(tx, lead));
  await sql`UPDATE workspaces SET parent_id = ${orgId}, title = ${title} WHERE id = ${id}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${lead}, 'owner')`;
  if (!orgId) created.push(id);
  return id;
}

test("decision 66: Remind and team moves have their own event types, so turning off due date changes keeps them", async () => {
  const o = await org();
  const { master } = await published(o, "Lab 1");
  viewerId = o.owner;
  assert.equal((await assignments.remindCopiesAction(master)).success, true);
  assert.ok((await tray(o.a)).some((r) => r.dedupe_key.includes(":assignments.reminded:")), "a Remind is its own type");
  assert.ok(!(await tray(o.a)).some((r) => r.dedupe_key.includes(":assignments.due_changed:")));

  const teams = await published(o, "Lab 2", { target: { mode: "teams", teams: [{ name: "Owl", userIds: [o.a], leadId: o.a }, { name: "Backend", userIds: [o.b], leadId: o.b }], individuals: [] } } as never);
  viewerId = o.owner;
  const backend = teams.copyOf(o.b);
  assert.equal((await assignments.moveTeamMemberAction(teams.master, o.a, backend)).success, true);
  const moved = (await tray(o.a)).filter((r) => r.dedupe_key.includes(":org.team_changed:"));
  assert.deepEqual(moved.map((r) => r.title), ["You’re now in Backend for Lab 2"]);
  assert.ok(!(await tray(o.b)).some((r) => r.dedupe_key.includes(":org.team_changed:")), "only the person who moved hears it");
});

test("decision 60: Remind reports who was really sent and who was reminded recently; 12 hours later it sends again", async () => {
  const o = await org();
  const { master } = await published(o, "Lab 1");
  viewerId = o.owner;
  assert.deepEqual(await assignments.remindCopiesAction(master), { success: true, reminded: 2, skipped: 0 });
  assert.deepEqual(await assignments.remindCopiesAction(master), { success: true, reminded: 0, skipped: 2 });
  await sql`UPDATE user_notifications SET created_at = now() - interval '13 hours', dedupe_key = dedupe_key || ':old' WHERE user_id = ${o.a} AND dedupe_key LIKE '%assignments.reminded%'`;
  assert.deepEqual(await assignments.remindCopiesAction(master), { success: true, reminded: 1, skipped: 1 });

  assert.deepEqual(await members.remindMembersAction(o.org, [o.a, o.b]), { success: true, reminded: 2, skipped: 0 });
  assert.deepEqual(await members.remindMembersAction(o.org, [o.a, o.b]), { success: true, reminded: 0, skipped: 2 });
});

test("decision 74: a reminder's date is in each person's own time zone", async () => {
  const o = await org();
  await sql`UPDATE profiles SET notification_preferences = ${sql.json({ quietHours: { enabled: false, startMinute: 0, endMinute: 0, timeZone: "Asia/Kolkata" } })} WHERE id = ${o.b}`;
  const day = new Date(Date.now() + 4 * 86_400_000);
  const due = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 20, 0));
  const { master } = await published(o, "Lab 1", { dueDate: due.toISOString() });
  viewerId = o.owner;
  await assignments.remindCopiesAction(master);
  const inZone = (zone: string) => new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(due);
  assert.notEqual(inZone("UTC"), inZone("Asia/Kolkata"));
  assert.deepEqual((await titles(o.a)).filter((t) => t.startsWith("Reminder")), [`Reminder: Lab 1 is due ${inZone("UTC")}`]);
  assert.deepEqual((await titles(o.b)).filter((t) => t.startsWith("Reminder")), [`Reminder: Lab 1 is due ${inZone("Asia/Kolkata")}`]);
});

test("smaller bug 2 and decision 117: Reminders Off also stops overdue notices; old overdue work sends nothing", async () => {
  const o = await org();
  const { master, copyOf } = await published(o, "Lab 1", { lateRule: "always" });
  const now = new Date();
  now.setUTCHours(9, 20, 0, 0);
  await sql`UPDATE tasks SET due_date = ${new Date(now.getTime() - 2 * 3_600_000)} WHERE id = ${master} OR assignment_id = ${master}`;
  await sql`UPDATE tasks SET due_date = ${new Date(now.getTime() - 3 * 86_400_000)} WHERE id = ${copyOf(o.b)}`;
  await sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || '{"assignmentReminders":"off"}'::jsonb WHERE id = ${o.org}`;
  await digests.runOrgDueSoon(now);
  assert.ok(!(await titles(o.a)).some((t) => t.includes("overdue")), "Off stops overdue too");

  await sql`UPDATE workspaces SET org_settings = org_settings || '{"assignmentReminders":"both"}'::jsonb WHERE id = ${o.org}`;
  await digests.runOrgDueSoon(now);
  assert.ok((await titles(o.a)).some((t) => t.startsWith("Lab 1 is overdue")), "with reminders on, overdue still goes");
  assert.ok(!(await titles(o.b)).some((t) => t.includes("overdue")), "work overdue for days gets no catch-up notice");
});

test("decision 93: an admin archiving a workspace tells its team and lead, every time", async () => {
  const o = await org();
  const project = await child(o.org, o.a);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${project}, ${o.b}, 'member')`;
  viewerId = o.admin;
  assert.equal((await orgs.archiveChildAction(project)).success, true);
  await sql`UPDATE workspaces SET status = 'active' WHERE id = ${project}`;
  assert.equal((await orgs.archiveChildAction(project)).success, true);
  for (const person of [o.a, o.b]) {
    assert.equal((await titles(person)).filter((t) => t.includes("archived Team Falcon")).length, 2, "lead and team, each archive");
  }
});

test("39.5: the role notice says the new role without a or an", async () => {
  const o = await org();
  viewerId = o.owner;
  assert.equal((await members.changeMemberRoleAction(o.org, [o.a], "admin")).success, true);
  assert.ok((await titles(o.a)).includes("Your role in CSE-3A is now TA"), JSON.stringify(await titles(o.a)));
});

test("decision 57: move-in requests show for admins with Approve and Decline; Decline tells the lead", async () => {
  const o = await org();
  const project = await child(null, o.a);
  viewerId = o.a;
  const asked = await orgs.moveWorkspaceToOrgAction(project, o.org);
  assert.deepEqual(asked, { success: true, outcome: "requested" });

  viewerId = o.admin;
  const board = await dash.readOrgDashboardAction(o.org);
  assert.equal(board.success, true);
  assert.ok(board.success && board.needsYou.some((n) => n.label === "Team Falcon asks to join"), JSON.stringify(board.success && board.needsYou));
  const list = await dash.readOrgWorkspacesAction(o.org);
  assert.ok(list.success && list.requests.some((r) => r.id === project && r.kind === "move_in"), JSON.stringify(list.success && list.requests));

  assert.equal((await orgs.cancelMoveInAction(project, "Not this term")).success, true);
  assert.ok((await titles(o.a)).includes("CSE-3A declined Team Falcon: Not this term"), JSON.stringify(await titles(o.a)));
  const after = await dash.readOrgWorkspacesAction(o.org);
  assert.ok(after.success && after.requests.length === 0);

  viewerId = o.a;
  await orgs.moveWorkspaceToOrgAction(project, o.org);
  viewerId = o.admin;
  assert.equal((await orgs.approveMoveInAction(project)).success, true);
  const [row] = await sql`SELECT parent_id FROM workspaces WHERE id = ${project}`;
  assert.equal(row!.parent_id, o.org);
});

test("problems 27 and 32: deleting an assignment or a copy tells the people who had it", async () => {
  const o = await org();
  const lab3 = await published(o, "Lab 3");
  viewerId = o.owner;
  assert.equal((await assignments.deleteAssignmentAction(lab3.master)).success, true);
  for (const person of [o.a, o.b]) assert.ok((await titles(person)).includes("Lab 3 was removed"), person);

  const lab4 = await published(o, "Lab 4");
  viewerId = o.owner;
  const removed = await tasks.deleteTaskAction(lab4.copyOf(o.a), o.org);
  assert.equal(removed.success, true, JSON.stringify(removed));
  assert.ok((await titles(o.a)).includes("Lab 4 was removed"));
  assert.ok(!(await titles(o.b)).includes("Lab 4 was removed"), "only the person whose copy went");
});

test("decision 174: a deleted account tells each organization's admins how many submissions went, without a name", async () => {
  const o = await org();
  const { copyOf } = await published(o, "Lab 1");
  await sql`UPDATE tasks SET submission = '{"version":1}'::jsonb, review_status = 'pending' WHERE id = ${copyOf(o.a)}`;
  const removed = await appDb.db.transaction((tx) => notify.submissionsRemovedOnDelete(tx, o.a));
  assert.deepEqual(removed, [{ orgId: o.org, submissions: 1 }]);
  await notify.notifyAccountDeleted(removed, "deletion-1");
  for (const person of [o.owner, o.admin]) {
    assert.ok((await titles(person)).includes("A member’s account was deleted. Their 1 submission was removed."), person);
  }
  assert.ok(!(await titles(o.b)).some((t) => t.includes("account was deleted")), "members aren't told");
});

test("decision 57: move-in requests have their own index, matching the query's conditions", async () => {
  // The planner's choice depends on table size, so this checks the index itself rather than one plan.
  const [row] = await sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'workspaces_move_in_request_idx'`;
  assert.ok(row, "the index exists");
  assert.match(row!.indexdef, /\(\(org_settings -> 'moveInRequest'::text\) ->> 'orgId'::text\)/);
  assert.match(row!.indexdef, /WHERE \(\(org_settings \? 'moveInRequest'::text\) AND \(deleted_at IS NULL\)\)/);
});
