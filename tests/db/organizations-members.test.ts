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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.17" }) });

let members: typeof import("../../src/app/actions/org-members");
let orgs: typeof import("../../src/app/actions/organizations");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) {
    await sql`DELETE FROM role_applications WHERE project_id = ${id}`;
    await sql`DELETE FROM projects WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org() {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const orgId = await sql.begin((tx) => createProject(tx, owner!));
  const code = generateJoinCode();
  await sql`INSERT INTO project_members (project_id, user_id, role, title) VALUES (${orgId}, ${owner!}, 'owner', null), (${orgId}, ${admin!}, 'admin', 'TA'), (${orgId}, ${a!}, 'member', 'Section B'), (${orgId}, ${b!}, 'member', null)`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${code}, title = 'CSE-3A', org_settings = ${sql.json({ version: 1, joinMode: "approval" })} WHERE id = ${orgId}`;
  const child = await sql.begin((tx) => createProject(tx, a!, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${a!}, 'owner')`;
  await sql`UPDATE projects SET parent_id = ${orgId}, title = 'Compiler Lab' WHERE id = ${child}`;
  const [unit] = await sql`INSERT INTO project_open_roles (project_id, role, count) VALUES (${child}, 'Frontend', 5) RETURNING id`;
  created.push(orgId, child);
  return { orgId, child, unit: unit!.id as string, code, owner: owner!, admin: admin!, a: a!, b: b! };
}

async function request(orgId: string, code: string) {
  const user = await sql.begin((tx) => createUser(tx));
  viewerId = user;
  const r = await orgs.joinOrganizationAction(code, "Section B student");
  assert.equal(r.success && r.outcome, "requested", JSON.stringify(r));
  const [app] = await sql`SELECT id FROM role_applications WHERE project_id = ${orgId} AND applicant_id = ${user}`;
  return { user, applicationId: app!.id as string };
}

async function roster(orgId: string, as: string) {
  viewerId = as;
  const r = await members.readOrgMembersAction(orgId);
  assert.equal(r.success, true, JSON.stringify(r));
  return r.success ? r : null;
}

test("the roster: roles, titles, projects and units, work counts, requests and invites, for owners and admins only", async () => {
  const o = await org();
  await sql`UPDATE project_members SET unit_id = ${o.unit} WHERE project_id = ${o.child} AND user_id = ${o.a}`;
  const [master] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id) VALUES (${o.orgId}, 'Lab 2', 'assignment', ${o.owner}) RETURNING id`;
  await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, due_date, status)
    VALUES (${o.orgId}, 'Lab 2', 'task', ${master!.id}, ${o.a}, ${o.owner}, now() - interval '1 day', 'todo'),
           (${o.orgId}, 'Lab 1', 'task', ${master!.id}, ${o.a}, ${o.owner}, now() - interval '9 days', 'done')`;
  await request(o.orgId, o.code);
  viewerId = o.admin;
  await members.inviteByEmailAction(o.orgId, { emails: "meena@x.edu", role: "member" });

  viewerId = o.a;
  assert.equal((await members.readOrgMembersAction(o.orgId)).success, false, "members don't see the Members tab");
  const data = await roster(o.orgId, o.admin);
  const asha = data!.rows.find((r) => r.userId === o.a)!;
  assert.deepEqual([asha.role, asha.title, asha.projects.map((p) => `${p.title} · ${p.unit}`), asha.work, asha.behind], ["member", "Section B", ["Compiler Lab · Frontend"], { done: 1, total: 2, missing: 1 }, true]);
  assert.equal(data!.rows.find((r) => r.userId === o.owner)!.role, "owner");
  assert.deepEqual(data!.requests.map((r) => r.note), ["Section B student"]);
  assert.deepEqual(data!.invites.map((i) => i.email), ["meena@x.edu"]);
  assert.equal(data!.summary.members, 4);
});

test("requests: approve, approve all, decline with a reason; Max members blocks approvals", async () => {
  const o = await org();
  const r1 = await request(o.orgId, o.code);
  const r2 = await request(o.orgId, o.code);
  const r3 = await request(o.orgId, o.code);
  viewerId = o.a;
  assert.equal((await members.approveJoinRequestsAction(o.orgId, [r1.applicationId])).success, false);
  viewerId = o.admin;
  await sql`UPDATE projects SET max_collaborators = '4' WHERE id = ${o.orgId}`;
  assert.match(JSON.stringify(await members.approveJoinRequestsAction(o.orgId, [r1.applicationId])), /full/i);
  await sql`UPDATE projects SET max_collaborators = NULL WHERE id = ${o.orgId}`;
  assert.deepEqual(await members.approveJoinRequestsAction(o.orgId, [r1.applicationId, r2.applicationId]), { success: true, approved: 2 });
  assert.equal((await members.declineJoinRequestAction(o.orgId, r3.applicationId, "Not in this section")).success, true);
  const rows = await sql`SELECT user_id FROM project_members WHERE project_id = ${o.orgId} AND user_id IN (${r1.user}, ${r2.user}, ${r3.user})`;
  assert.equal(rows.length, 2);
  const [declined] = await sql`SELECT status, decision_reason_text FROM role_applications WHERE id = ${r3.applicationId}`;
  assert.deepEqual([declined!.status, declined!.decision_reason_text], ["rejected", "Not in this section"]);
});

test("invite by email: admins invite members and guests, the owner also admins; existing users accept in-app into the workspace and unit", async () => {
  const o = await org();
  const invitee = await sql.begin((tx) => createUser(tx));
  const [{ email }] = await sql`SELECT email FROM profiles WHERE id = ${invitee}`;
  viewerId = o.admin;
  assert.equal((await members.inviteByEmailAction(o.orgId, { emails: email, role: "admin" })).success, false, "only the owner invites admins");
  const sent = await members.inviteByEmailAction(o.orgId, { emails: `${email}, bad-address, new@x.edu`, role: "member", title: "North region", childProjectId: o.child, unitId: o.unit });
  assert.deepEqual(sent, { success: true, invited: 2, existing: 1, invalid: ["bad-address"] });

  viewerId = invitee;
  const mine = await members.listMyOrgInvitesAction();
  assert.deepEqual(mine.map((i) => i.orgTitle), ["CSE-3A"]);
  assert.equal((await members.acceptOrgInviteAction(mine[0]!.id)).success, true);
  const [m] = await sql`SELECT role, title FROM project_members WHERE project_id = ${o.orgId} AND user_id = ${invitee}`;
  assert.deepEqual([m!.role, m!.title], ["member", "North region"]);
  const [c] = await sql`SELECT unit_id FROM project_members WHERE project_id = ${o.child} AND user_id = ${invitee}`;
  assert.equal(c?.unit_id, o.unit);

  viewerId = o.admin;
  const data = await roster(o.orgId, o.admin);
  const pending = data!.invites.find((i) => i.email === "new@x.edu")!;
  assert.equal((await members.resendOrgInviteAction(o.orgId, pending.id)).success, true);
  assert.equal((await members.cancelOrgInviteAction(o.orgId, pending.id)).success, true);
  assert.equal((await roster(o.orgId, o.admin))!.invites.length, 0);
});

test("joining by code while invited accepts the invite instead", async () => {
  const o = await org();
  const invitee = await sql.begin((tx) => createUser(tx));
  const [{ email }] = await sql`SELECT email FROM profiles WHERE id = ${invitee}`;
  viewerId = o.owner;
  await members.inviteByEmailAction(o.orgId, { emails: email, role: "viewer" });
  viewerId = invitee;
  const r = await orgs.joinOrganizationAction(o.code);
  assert.equal(r.success && r.outcome, "joined", JSON.stringify(r));
  const [m] = await sql`SELECT role FROM project_members WHERE project_id = ${o.orgId} AND user_id = ${invitee}`;
  assert.equal(m?.role, "viewer", "the invited role wins over the code's Member");
});

test("roles and titles: admins manage members and guests; only the owner manages admins", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.deepEqual(await members.changeMemberRoleAction(o.orgId, [o.a, o.b], "viewer"), { success: true, changed: 2 });
  assert.equal((await members.changeMemberRoleAction(o.orgId, [o.a], "admin")).success, false);
  assert.equal((await members.changeMemberRoleAction(o.orgId, [o.owner], "member")).success, false);
  assert.equal((await members.setMemberTitleAction(o.orgId, o.b, "Section C")).success, true);
  viewerId = o.owner;
  assert.equal((await members.changeMemberRoleAction(o.orgId, [o.a], "admin")).success, true);
  const rows = await sql`SELECT user_id, role, title FROM project_members WHERE project_id = ${o.orgId} AND user_id IN (${o.a}, ${o.b}) ORDER BY role`;
  assert.deepEqual(rows.map((r) => [r.role, r.title]), [["admin", "Section B"], ["viewer", "Section C"]]);
});

test("remove: out of the org and its projects; Block from rejoining stops the code; admins can't remove admins", async () => {
  const o = await org();
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${o.child}, ${o.b}, 'member')`;
  viewerId = o.admin;
  assert.equal((await members.removeMembersAction(o.orgId, [o.admin], { block: false })).success, false);
  assert.deepEqual(await members.removeMembersAction(o.orgId, [o.b], { block: true, reason: "Left the course" }), { success: true, removed: 1 });
  assert.equal((await sql`SELECT 1 FROM project_members WHERE user_id = ${o.b} AND project_id IN (${o.orgId}, ${o.child})`).length, 0);
  viewerId = o.b;
  const again = await orgs.joinOrganizationAction(o.code);
  assert.equal(again.success, false);
  assert.equal((await members.removeMembersAction(o.orgId, [o.a], { block: false })).success, false, "members can't remove");
  viewerId = o.admin;
  assert.match(JSON.stringify(await members.removeMembersAction(o.orgId, [o.a], { block: false })), /lead/i, "project leads transfer first");
});

test("add to a child project: admins add people straight into a unit", async () => {
  const o = await org();
  viewerId = o.admin;
  assert.deepEqual(await members.addMembersToChildAction(o.orgId, o.child, [o.b, o.admin], o.unit), { success: true, added: 2 });
  const rows = await sql`SELECT user_id, unit_id, role FROM project_members WHERE project_id = ${o.child} AND user_id IN (${o.b}, ${o.admin})`;
  assert.deepEqual(rows.map((r) => [r.unit_id, r.role]), [[o.unit, "member"], [o.unit, "member"]]);
  viewerId = o.a;
  assert.equal((await members.addMembersToChildAction(o.orgId, o.child, [o.b], null)).success, false);
});

test("§20 pass: Max members holds for invites; bulk Remind; drawer activity; Outside people; hidden members stay off visitors' avatars", async () => {
  const o = await org();
  const invitee = await sql.begin((tx) => createUser(tx));
  const [{ email }] = await sql`SELECT email FROM profiles WHERE id = ${invitee}`;
  viewerId = o.owner;
  assert.ok((await members.inviteByEmailAction(o.orgId, { emails: email, role: "member" })).success);
  await sql`UPDATE projects SET max_collaborators = '4' WHERE id = ${o.orgId}`;
  viewerId = invitee;
  const [invite] = await members.listMyOrgInvitesAction();
  const full = await members.acceptOrgInviteAction(invite!.id);
  assert.ok(!full.success && full.error.startsWith("This organization is full"), JSON.stringify(full));
  await sql`UPDATE projects SET max_collaborators = '5' WHERE id = ${o.orgId}`;
  assert.ok((await members.acceptOrgInviteAction(invite!.id)).success, "room again: the invite was still open");

  // Remind: only people with open work hear about it.
  const settings = sql.json({ version: 1, submissionType: "none", reviewRequired: false, lateRule: "none", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null });
  const [m] = await sql`INSERT INTO tasks (project_id, title, kind, creator_id, assignment_settings) VALUES (${o.orgId}, 'Lab 1', 'assignment', ${o.owner}, ${settings}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (project_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES (${o.orgId}, 'Lab 1', 'task', ${m!.id}, ${o.a}, ${o.owner}, now() - interval '1 day') RETURNING id`;
  viewerId = o.admin;
  const reminded = await members.remindMembersAction(o.orgId, [o.a, o.b]);
  assert.deepEqual(reminded, { success: true, reminded: 1 });
  await members.remindMembersAction(o.orgId, [o.a]);
  const notes = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.a} AND title LIKE 'Reminder:%'`;
  assert.equal(notes.length, 1, "one per 12 hours");

  await sql`INSERT INTO task_activity_events (task_id, project_id, actor_id, event_type) VALUES (${copy!.id}, ${o.orgId}, ${o.a}, 'status_changed')`;
  const activity = await members.readMemberActivityAction(o.orgId, o.a);
  assert.ok(activity.success && activity.activity[0]?.what === "status changed" && activity.activity[0].task === "Lab 1");
  viewerId = o.b;
  assert.equal((await members.readMemberActivityAction(o.orgId, o.a)).success, false, "admins only");

  const outsider = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${o.child}, ${outsider}, 'member')`;
  assert.deepEqual((await roster(o.orgId, o.admin))!.outside.map((p) => [p.userId, p.projects]), [[outsider, ["Compiler Lab"]]]);

  await sql`UPDATE project_members SET show_on_profile = false WHERE project_id = ${o.orgId} AND user_id = ${o.b}`;
  await sql`UPDATE projects SET visibility = 'public', status = 'active' WHERE id = ${o.orgId}`;
  const tasksServer = await loadAppModule(() => import("../../src/lib/workspaces/server/tasks"));
  viewerId = outsider;
  const seen = await tasksServer.getProjectMembersAction(o.orgId, 50);
  const ids = (seen as { members?: Array<{ id: string }> }).members?.map((x) => x.id) ?? [];
  assert.ok(ids.length > 0 && !ids.includes(o.b), JSON.stringify(seen).slice(0, 300));
  viewerId = o.admin;
  const inside = (await tasksServer.getProjectMembersAction(o.orgId, 50)) as { members?: Array<{ id: string }> };
  assert.ok(inside.members?.some((x) => x.id === o.b), "members still see everyone");
});
