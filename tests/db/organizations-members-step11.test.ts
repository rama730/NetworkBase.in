import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step 11c (report §36.2–36.5, §31.4, §26.5, §26.8): role changes, outside people, former members, removal, verifying.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
stubNextAfter();
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.113" }) });

let members: typeof import("../../src/app/actions/org-members");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const open = sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null });

async function setup() {
  const [owner, admin, lead, asha, ravi, sam] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${admin!}, 'admin'), (${org}, ${lead!}, 'member'), (${org}, ${asha!}, 'member'), (${org}, ${ravi!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${generateJoinCode()} WHERE id = ${org}`;
  const falcon = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${org}, title = 'Team Falcon' WHERE id = ${falcon}`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${falcon}, ${lead!}, 'owner'), (${falcon}, ${asha!}, 'member'), (${falcon}, ${sam!}, 'member')`;
  await sql`INSERT INTO profile_contributions (profile_id, workspace_id, role_kind) VALUES (${asha!}, ${org}, 'member'), (${lead!}, ${org}, 'member')`;
  const [lab] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings, due_date) VALUES (${org}, 'Lab 2', 'assignment', ${owner!}, ${open}, now() + interval '3 days') RETURNING id`;
  const [done] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings) VALUES (${org}, 'Lab 1', 'assignment', ${owner!}, ${open}) RETURNING id`;
  const [openCopy] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id) VALUES (${org}, 'Lab 2', 'task', ${lab!.id}, ${asha!}, ${owner!}) RETURNING id`;
  const [handedIn] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, status) VALUES (${org}, 'Lab 1', 'task', ${done!.id}, ${asha!}, ${owner!}, 'done') RETURNING id`;
  created.push(org);
  return { org, falcon, lab: lab!.id as string, openCopy: openCopy!.id as string, handedIn: handedIn!.id as string, owner: owner!, admin: admin!, lead: lead!, asha: asha!, ravi: ravi!, sam: sam! };
}

const alive = async (id: string) => (await sql`SELECT 1 FROM tasks WHERE id = ${id} AND deleted_at IS NULL`).length === 1;

test("36.2: the role dialog previews what changes; Admin and Viewer lose unsubmitted copies, handed-in work stays", async () => {
  const t = await setup();
  viewerId = t.owner;
  const preview = await members.readRoleChangePreviewAction(t.org, [t.asha], "admin");
  assert.ok(preview.success, JSON.stringify(preview));
  assert.deepEqual(preview.success && [preview.openRemoved, preview.submittedKept, preview.leads], [1, 1, []]);
  assert.equal((await members.changeMemberRoleAction(t.org, [t.asha], "admin")).success, true);
  assert.deepEqual([await alive(t.openCopy), await alive(t.handedIn)], [false, true]);
  const [notice] = await sql`SELECT title, body FROM user_notifications WHERE user_id = ${t.asha} AND title LIKE 'Your role in CSE 3B is now%'`;
  assert.match(notice!.body as string, /review work/);
});

test("36.2, 26.8: a Viewer made Member gets open assignments; a Member made Viewer leaves the workspaces", async () => {
  const t = await setup();
  viewerId = t.admin;
  assert.equal((await members.changeMemberRoleAction(t.org, [t.ravi], "member")).success, true);
  assert.equal((await sql`SELECT 1 FROM tasks WHERE assignment_id = ${t.lab} AND assignee_id = ${t.ravi} AND deleted_at IS NULL`).length, 1, "the open one");
  assert.equal((await members.changeMemberRoleAction(t.org, [t.asha], "viewer")).success, true);
  assert.equal((await sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${t.falcon} AND user_id = ${t.asha}`).length, 0, "off the team");
  assert.equal(await alive(t.openCopy), false);
});

test("36.2: refused for a workspace lead becoming Viewer, and for your own role", async () => {
  const t = await setup();
  viewerId = t.admin;
  const preview = await members.readRoleChangePreviewAction(t.org, [t.lead], "viewer");
  assert.deepEqual(preview.success && preview.leads.map((l) => l.workspace), ["Team Falcon"]);
  assert.deepEqual(await members.changeMemberRoleAction(t.org, [t.lead], "viewer"), { success: false, error: "Transfer Team Falcon first." });
  viewerId = t.owner;
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${t.org} AND user_id = ${t.asha}`;
  viewerId = t.asha;
  assert.deepEqual(await members.changeMemberRoleAction(t.org, [t.asha], "member"), { success: false, error: "You can’t change your own role. Use Leave instead." });
});

test("36.3: admins remove an outside person from a workspace, and its lead is told", async () => {
  const t = await setup();
  viewerId = t.admin;
  const roster = await members.readOrgMembersAction(t.org);
  assert.deepEqual(roster.success && roster.outside.map((o) => o.projects.map((p) => p.id)), [[t.falcon]]);
  viewerId = t.asha;
  assert.equal((await members.removeOutsidePersonAction(t.org, t.sam, t.falcon)).success, false);
  viewerId = t.admin;
  assert.equal((await members.removeOutsidePersonAction(t.org, t.asha, t.falcon)).success, false, "members aren't outside people");
  assert.equal((await members.removeOutsidePersonAction(t.org, t.sam, t.falcon)).success, true);
  assert.equal((await sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${t.falcon} AND user_id = ${t.sam}`).length, 0);
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${t.lead} AND title LIKE '%was removed from Team Falcon%'`).length);
});

test("36.4, 36.5: the Remove preview counts what goes; leads are skipped; Former shows how, who and why", async () => {
  const t = await setup();
  viewerId = t.admin;
  const preview = await members.readRemovalPreviewAction(t.org, [t.asha, t.lead]);
  assert.ok(preview.success, JSON.stringify(preview));
  assert.deepEqual(preview.success && [preview.people, preview.openRemoved, preview.submittedKept, preview.skipped.map((s) => s.workspaces)], [1, 1, 1, [["Team Falcon"]]]);
  const removed = await members.removeMembersAction(t.org, [t.asha, t.lead], { block: true, reason: "Repeated no-shows" });
  assert.deepEqual(removed, { success: true, removed: 1, skipped: 1 });
  const former = await members.readFormerMembersAction(t.org);
  assert.ok(former.success, JSON.stringify(former));
  const asha = former.success ? former.rows.find((r) => r.userId === t.asha) : undefined;
  assert.deepEqual(asha && [asha.how, asha.note, asha.blocked, asha.done], ["removed", "Repeated no-shows", true, 1]);
  assert.equal(typeof asha?.by, "string");
  viewerId = t.asha;
  assert.equal((await members.readFormerMembersAction(t.org)).success, false, "admins only");
});

test("31.4: rows carry Verified, for the filter and bulk Verify", async () => {
  const t = await setup();
  await sql`UPDATE profile_contributions SET verified_at = now(), verified_by = ${t.owner} WHERE profile_id = ${t.asha} AND workspace_id = ${t.org}`;
  viewerId = t.admin;
  const roster = await members.readOrgMembersAction(t.org);
  assert.ok(roster.success);
  const verified = roster.success ? roster.rows.filter((r) => r.verified).map((r) => r.userId) : [];
  assert.deepEqual(verified, [t.asha]);
});

test("25.4: an organization admin decides on a workspace's team applications", async () => {
  const t = await setup();
  const kiran = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${t.org}, ${kiran}, 'member')`;
  const [front] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled) VALUES (${t.falcon}, 'Frontend', 'Frontend', 2, 0) RETURNING id`;
  const [app] = await sql`INSERT INTO role_applications (workspace_id, role_id, applicant_id, creator_id, status) VALUES (${t.falcon}, ${front!.id}, ${kiran}, ${t.lead}, 'pending') RETURNING id`;
  const apps = await loadAppModule(() => import("../../src/app/actions/applications"));
  viewerId = t.asha;
  assert.equal((await apps.acceptApplicationAction(app!.id)).success, false, "a member can't");
  viewerId = t.admin;
  const accepted = await apps.acceptApplicationAction(app!.id);
  assert.equal(accepted.success, true, JSON.stringify(accepted));
});

test("26.5: someone waiting adds a note to their join request; admins see it on the row", async () => {
  const t = await setup();
  const asker = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${t.org}, ${asker}, ${t.owner}, 'pending')`;
  const orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  viewerId = asker;
  assert.equal((await orgs.updateJoinRequestNoteAction(t.org, "Roll 21, section B")).success, true);
  viewerId = t.admin;
  const roster = await members.readOrgMembersAction(t.org);
  assert.deepEqual(roster.success && roster.requests.map((r) => r.note), ["Roll 21, section B"]);
  viewerId = t.asha;
  assert.equal((await orgs.updateJoinRequestNoteAction(t.org, "hi")).success, false, "only your own waiting request");
});

test("33.5, decision 83: Export progress has statuses and dates, never what was handed in; admins only", async () => {
  const t = await setup();
  await sql`UPDATE tasks SET description = 'my secret answer', completed_at = now() WHERE id = ${t.handedIn}`;
  viewerId = t.asha;
  assert.equal((await members.readProgressExportAction(t.org)).success, false);
  viewerId = t.admin;
  const r = await members.readProgressExportAction(t.org);
  assert.ok(r.success, JSON.stringify(r));
  const rows = r.success ? r.rows : [];
  assert.deepEqual(rows[0], ["Person", "Assignment", "Due", "Status", "Handed in", "Late"]);
  assert.deepEqual(rows.slice(1).map((x) => [x[1], x[3]]).sort(), [["Lab 1", "done"], ["Lab 2", "not started"]]);
  assert.ok(!JSON.stringify(rows).includes("secret"));
});

test("32.4, 0053: a join request pings the owner and admins on their own topic, never the organization's", async () => {
  const t = await setup();
  const asker = await sql.begin((tx) => createUser(tx));
  const heard = async (user: string) => (await sql`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${`chat:user:${user}`} AND event = 'org.requests.changed'`)[0]!.n as number;
  const [before] = await Promise.all([heard(t.admin)]);
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${t.org}, ${asker}, ${t.owner}, 'pending')`;
  assert.deepEqual([await heard(t.owner) > 0, (await heard(t.admin)) - before, await heard(t.asha)], [true, 1, 0]);
  assert.equal((await sql`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${`live:workspace:${t.org}`} AND event = 'org.requests.changed'`)[0]!.n, 0);
});

test("24.3, permissions table: the GitHub line shows to the team and admins, not every organization member", async () => {
  const t = await setup();
  const kiran = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${t.org}, ${kiran}, 'member')`;
  await sql`UPDATE workspaces SET github_repo_url = 'https://github.com/cse3b/falcon' WHERE id = ${t.falcon}`;
  const dash = await loadAppModule(() => import("../../src/app/actions/org-dashboard"));
  const line = async (who: string) => { viewerId = who; return (await dash.readChildOrgLineAction(t.falcon))?.github?.repo ?? null; };
  assert.deepEqual([await line(t.asha), await line(t.admin), await line(kiran)], ["cse3b/falcon", "cse3b/falcon", null]);
  viewerId = kiran;
  assert.ok(await dash.readChildOrgLineAction(t.falcon), "they still get the rest of the line");
});
