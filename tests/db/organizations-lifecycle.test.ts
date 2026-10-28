import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// P15 (report §30.3, §30.5, §30.7): archive and read-only, delete grace and restore, purge, duplicate contents,
// account deletion with orgs, and what reports and suspension do.
let viewerId = "";
let adminId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, email: `${viewerId}@example.com`, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => ({ auth: { admin: { deleteUser: async () => ({ error: null }) } } }),
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.40" }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
process.env.JOB_REQUEST_SECRET = "test-job-request-secret-for-hard-delete-0123456789";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let lifecycle: typeof import("../../src/lib/organizations/lifecycle");
let access: typeof import("../../src/lib/data/project-access");
let deletion: typeof import("../../src/lib/account/deletion");
let hardDelete: typeof import("../../src/lib/account/hard-delete");
let jobRequest: typeof import("../../src/lib/security/job-request");
let trust: typeof import("../../src/app/actions/trust");
let join: typeof import("../../src/lib/organizations/join");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  lifecycle = await loadAppModule(() => import("../../src/lib/organizations/lifecycle"));
  access = await loadAppModule(() => import("../../src/lib/data/project-access"));
  deletion = await loadAppModule(() => import("../../src/lib/account/deletion"));
  hardDelete = await loadAppModule(() => import("../../src/lib/account/hard-delete"));
  jobRequest = await loadAppModule(() => import("../../src/lib/security/job-request"));
  trust = await loadAppModule(() => import("../../src/app/actions/trust"));
  join = await loadAppModule(() => import("../../src/lib/organizations/join"));
  adminId = await sql.begin((tx) => createUser(tx));
  process.env.ADMIN_USER_IDS = adminId;
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, a, lead] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${lead!}, 'member')`;
  const handle = `org-${id.slice(0, 8)}`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A', slug = ${handle}, status = 'active', visibility = 'public' WHERE id = ${id}`;
  const child = await sql.begin((tx) => createProject(tx, lead!, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${lead!}, 'owner'), (${child}, ${a!}, 'member')`;
  await sql`UPDATE projects SET parent_id = ${id}, status = 'active', title = 'Compiler Lab' WHERE id = ${child}`;
  created.push(id, child);
  return { id, child, owner: owner!, admin: admin!, a: a!, lead: lead!, handle };
}
const post = (projectId: string, author: string) => sql`INSERT INTO project_updates (project_id, author_id, content, update_type, visibility) VALUES (${projectId}, ${author}, 'Hi', 'announcement', 'members')`;

test("archive: read-only everywhere, join code off, child projects archived with it; unarchive brings a new code, off", async () => {
  const o = await org();
  const [{ join_code: oldCode }] = await sql`SELECT join_code FROM projects WHERE id = ${o.id}`;
  await lifecycle.archiveOrg(o.id, o.owner);
  const owner = await access.getProjectAccessById(o.id, o.owner);
  assert.deepEqual([owner.writeBlocked, owner.canWrite, owner.canRead], ["archived", false, true]);
  assert.equal((await access.getProjectAccessById(o.child, o.lead)).writeBlocked, "archived", "archived with the org");
  await assert.rejects(post(o.id, o.owner), /project_read_only/, "even the database refuses new posts");
  const [row] = await sql`SELECT join_code_enabled, (SELECT status FROM projects WHERE id = ${o.child}) AS child_status FROM projects WHERE id = ${o.id}`;
  assert.deepEqual([row!.join_code_enabled, row!.child_status], [false, "archived"]);

  await lifecycle.unarchiveOrg(o.id, o.owner);
  const [back] = await sql`SELECT status, join_code, join_code_enabled, (SELECT status FROM projects WHERE id = ${o.child}) AS child_status FROM projects WHERE id = ${o.id}`;
  assert.deepEqual([back!.status, back!.join_code_enabled, back!.child_status], ["active", false, "active"]);
  assert.notEqual(back!.join_code, oldCode);
  await post(o.id, o.owner);
});

test("delete: 30-day grace (owner only, members lose access), children detached; restore; purge keeps contribution names", async () => {
  const o = await org();
  await sql`INSERT INTO profile_project_contributions (profile_id, project_id, project_title, role_title) VALUES (${o.a}, ${o.id}, 'CSE-3A', 'Student')`.catch(() => undefined);
  await lifecycle.scheduleOrgDeletion(o.id, o.owner, "detach");
  const [child] = await sql`SELECT parent_id FROM projects WHERE id = ${o.child}`;
  assert.equal(child!.parent_id, null, "detached to its lead at once");
  assert.equal((await access.getProjectAccessById(o.id, o.a)).canRead, false);
  assert.equal((await access.getProjectAccessById(o.id, o.owner)).canRead, true, "the owner can open it to restore");
  assert.equal((await join.findOrgByJoinCode((await sql`SELECT join_code FROM projects WHERE id = ${o.id}`)[0]!.join_code))?.available ?? false, false);

  assert.equal(await lifecycle.restoreOrg(o.id, o.owner), true);
  assert.equal((await access.getProjectAccessById(o.id, o.a)).canRead, true);

  await lifecycle.scheduleOrgDeletion(o.id, o.owner, "delete");
  assert.equal((await lifecycle.purgeDueOrgs(new Date())).purged, 0, "not before 30 days");
  const { purged } = await lifecycle.purgeDueOrgs(new Date(Date.now() + 31 * 86_400_000));
  assert.ok(purged >= 1);
  assert.equal((await sql`SELECT 1 FROM projects WHERE id = ${o.id}`).length, 0);
  const kept = await sql`SELECT project_id, project_title FROM profile_project_contributions WHERE profile_id = ${o.a} AND external_key LIKE 'deleted-project:%'`;
  if (kept.length) assert.deepEqual([kept[0]!.project_id, kept[0]!.project_title], [null, "CSE-3A"]);
});

test("duplicate copies the plan and never people, copies or the join code", async () => {
  const o = await org();
  await sql`UPDATE projects SET term_start = '2026-07-01', term_end = '2026-11-30' WHERE id = ${o.id}`;
  const [sprint] = await sql`INSERT INTO project_sprints (project_id, sprint_number, name, start_date, end_date, status) VALUES (${o.id}, 1, 'CO1', '2026-07-01', '2026-07-31', 'completed') RETURNING id`;
  const [master] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, due_date, sprint_id, assignment_settings) VALUES (${o.id}, 'Lab 1', 'assignment', ${o.owner}, '2026-07-15', ${sprint!.id},
    ${sql.json({ version: 1, submissionType: "file", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  await sql`INSERT INTO task_subtasks (task_id, title, position) VALUES (${master!.id}, 'Read notes', 0)`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id) VALUES (${o.id}, 'Lab 1', 'task', ${master!.id}, ${o.a}, ${o.owner})`;
  await sql`INSERT INTO project_nodes (project_id, path, type, name, metadata) VALUES (${o.id}, '/Lectures', 'folder', 'Lectures', '{}')`;

  const newId = await lifecycle.duplicateOrg(o.id, o.owner, { title: "CSE-3A 2027", handle: `dup-${o.id.slice(0, 8)}`, termStart: "2027-07-01",
    copy: { about: true, docs: true, files: true, sprints: true, assignments: true, channels: false, admins: true } });
  created.push(newId);
  const [n] = await sql`SELECT kind, join_code, owner_id, term_start::text, (SELECT count(*)::int FROM project_members WHERE project_id = ${newId}) AS members FROM projects WHERE id = ${newId}`;
  const [old] = await sql`SELECT join_code FROM projects WHERE id = ${o.id}`;
  assert.deepEqual([n!.kind, n!.owner_id, n!.term_start, n!.members], ["organization", o.owner, "2027-07-01", 1]);
  assert.notEqual(n!.join_code, old!.join_code);
  const [s] = await sql`SELECT name, start_date::date::text AS start, status FROM project_sprints WHERE project_id = ${newId}`;
  assert.deepEqual([s!.name, s!.start, s!.status], ["CO1", "2027-07-01", "planning"]);
  const tasks = await sql`SELECT kind, assignment_settings->>'publishedAt' AS published, (SELECT count(*)::int FROM task_subtasks st WHERE st.task_id = t.id) AS steps FROM tasks t WHERE project_id = ${newId}`;
  assert.deepEqual(tasks.map((t) => [t.kind, t.published, t.steps]), [["assignment", null, 1]], "a draft master, no copies");
  assert.equal((await sql`SELECT 1 FROM project_nodes WHERE project_id = ${newId} AND path = '/Lectures'`).length, 1);
  assert.equal((await sql`SELECT role FROM org_email_invites WHERE org_id = ${newId}`)[0]?.role, "admin", "current admins invited");
});

test("account deletion: blocked while owning an org; led child projects pass on; hard delete drops own copies, keeps team ones", async () => {
  const o = await org();
  assert.equal((await deletion.scheduleAccountDeletionForUser({ userId: o.owner, email: "o@example.com", username: null, reason: null })).ok, false);
  await sql`UPDATE project_members SET role = 'admin' WHERE project_id = ${o.child} AND user_id = ${o.a}`;
  const [master] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES (${o.id}, 'Lab 2', 'assignment', ${o.owner}, ${sql.json({ version: 1, submissionType: "none", lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null })}) RETURNING id`;
  const [own] = await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id) VALUES (${o.id}, 'Lab 2', 'task', ${master!.id}, ${o.lead}, ${o.owner}) RETURNING id`;
  const [team] = await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, team_name) VALUES (${o.id}, 'Lab 2', 'task', ${master!.id}, ${o.lead}, ${o.owner}, 'Team A') RETURNING id`;
  await sql`INSERT INTO task_team_members (task_id, user_id, is_lead) VALUES (${team!.id}, ${o.lead}, true), (${team!.id}, ${o.admin}, false)`;

  const scheduled = await deletion.scheduleAccountDeletionForUser({ userId: o.lead, email: "lead@example.com", username: null, reason: null });
  assert.equal(scheduled.ok, true);
  const [child] = await sql`SELECT owner_id, org_settings ? 'leadHandover' AS flagged FROM projects WHERE id = ${o.child}`;
  assert.deepEqual([child!.owner_id, child!.flagged], [o.a, true], "the project admin leads it now");

  const deletionId = scheduled.ok ? scheduled.deletionId : "";
  await sql`UPDATE account_deletions SET cleanup_status = 'storage_scheduled', hard_delete_at = now() - interval '1 minute' WHERE id = ${deletionId}`;
  const token = jobRequest.createSignedJobRequestToken({ kind: hardDelete.ACCOUNT_HARD_DELETE_JOB_KIND, actorId: o.lead, subjectId: deletionId });
  const result = await hardDelete.executeHardDelete(o.lead, deletionId, token);
  assert.equal(result.success, true, result.error);
  assert.equal((await sql`SELECT 1 FROM tasks WHERE id = ${own!.id}`).length, 0, "individual copy removed");
  const [kept] = await sql`SELECT assignee_id FROM tasks WHERE id = ${team!.id}`;
  assert.equal(kept?.assignee_id ?? null, null, "team copy stays, shown as Deleted user");
  assert.equal((await sql`SELECT 1 FROM projects WHERE id = ${o.child}`).length, 1, "the child project survived its lead's account");
});

test("reports and suspension: a report reaches the admin queue; suspend makes the org read-only, hidden and unjoinable; remove deletes a post", async () => {
  const o = await org();
  viewerId = o.a;
  assert.equal((await trust.reportContentAction({ kind: "project", targetId: o.id, reason: "impersonation" })).success, true);
  const [u] = await sql`INSERT INTO project_updates (project_id, author_id, content, update_type, visibility) VALUES (${o.id}, ${o.admin}, 'Spam here', 'discussion', 'members') RETURNING id`;
  assert.equal((await trust.reportContentAction({ kind: "update", targetId: u!.id, reason: "spam" })).success, true);

  viewerId = o.a;
  assert.equal((await trust.suspendOrgAction({ orgId: o.id, reason: "Impersonation" })).success, false, "only platform admins");
  viewerId = adminId;
  const queue = await trust.readAdminReportsAction();
  assert.ok(queue && queue.reports.some((r) => r.target_id === o.id) && queue.reports.some((r) => r.target_id === u!.id));
  const updateReport = queue!.reports.find((r) => r.target_id === u!.id)!;
  assert.equal((await trust.removeReportedContentAction(updateReport.id)).success, true);
  assert.ok((await sql`SELECT deleted_at FROM project_updates WHERE id = ${u!.id}`)[0]!.deleted_at);

  const orgReport = queue!.reports.find((r) => r.target_id === o.id)!;
  assert.equal((await trust.suspendOrgAction({ orgId: o.id, reason: "Impersonation", reportId: orgReport.id })).success, true);
  assert.equal((await access.getProjectAccessById(o.id, o.owner)).writeBlocked, "suspended");
  assert.equal((await access.getProjectAccessById(o.child, o.lead)).writeBlocked, "suspended", "child projects too");
  await assert.rejects(post(o.child, o.lead), /project_read_only/);
  const [{ join_code: code }] = await sql`SELECT join_code FROM projects WHERE id = ${o.id}`;
  assert.equal((await join.findOrgByJoinCode(code))?.available ?? false, false, "join codes stop");
  assert.equal((await sql`SELECT status, action FROM content_reports WHERE id = ${orgReport.id}`)[0]!.action, "suspended");
  viewerId = "";
});
