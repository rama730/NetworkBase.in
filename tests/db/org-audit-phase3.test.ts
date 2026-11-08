import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Org workflow audit 2026-11-09, phase 3: one join path's rules everywhere, honest results, real actors.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.53" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let members: typeof import("../../src/app/actions/org-members");
let assignments: typeof import("../../src/app/actions/assignments");
let join: typeof import("../../src/lib/organizations/join");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: null }),
  });
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  join = await loadAppModule(() => import("../../src/lib/organizations/join"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

const user = () => sql.begin((tx) => createUser(tx));
const emailOf = async (id: string) => (await sql<{ email: string }[]>`SELECT email FROM profiles WHERE id = ${id}`)[0]!.email;
async function org(joinMode: "instant" | "approval" = "instant") {
  const owner = await user();
  const id = await sql.begin((tx) => createProject(tx, owner));
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'CSE 3B', join_code = ${code}, join_code_enabled = true,
    org_settings = ${sql.json({ joinMode })} WHERE id = ${id}`;
  created.push(id);
  return { id, owner, code };
}
const invite = async (orgId: string, owner: string, email: string, extra: { role?: string; child?: string; unit?: string } = {}) =>
  (await sql<{ id: string }[]>`INSERT INTO org_email_invites (org_id, email, role, invited_by, expires_at, child_workspace_id, unit_id)
    VALUES (${orgId}, ${email}, ${extra.role ?? "member"}, ${owner}, now() + interval '7 days', ${extra.child ?? null}, ${extra.unit ?? null}) RETURNING id`)[0]!.id;

test("2.1, N6: a blocked person can't use an old invite; nobody joins a closed organization by invite", async () => {
  const o = await org();
  const [blocked, later] = [await user(), await user()];
  const blockedInvite = await invite(o.id, o.owner, await emailOf(blocked));
  await sql`INSERT INTO org_join_blocks (org_id, user_id, blocked_by) VALUES (${o.id}, ${blocked}, ${o.owner})`;
  viewerId = blocked;
  assert.deepEqual(await members.acceptOrgInviteAction(blockedInvite), { success: false, error: "You can’t join this organization." });
  const laterInvite = await invite(o.id, o.owner, await emailOf(later));
  await sql`UPDATE workspaces SET status = 'archived' WHERE id = ${o.id}`;
  viewerId = later;
  assert.equal((await members.listMyOrgInvitesAction()).length, 0, "an archived organization's invite isn't listed");
  assert.equal((await members.acceptOrgInviteAction(laterInvite)).success, false);
});

test("2.4: a full team never undoes the organization join", async () => {
  const o = await org();
  const child = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
  const [team] = await sql<{ id: string }[]>`INSERT INTO workspace_open_roles (workspace_id, role, title, count, filled) VALUES (${child}, 'Frontend', 'Frontend', 1, 1) RETURNING id`;
  const person = await user();
  const id = await invite(o.id, o.owner, await emailOf(person), { child, unit: team!.id });
  viewerId = person;
  const accepted = await members.acceptOrgInviteAction(id);
  assert.equal(accepted.success, true, JSON.stringify(accepted));
  const roles = await sql<{ workspace_id: string; unit_id: string | null }[]>`SELECT workspace_id, unit_id FROM workspace_members WHERE user_id = ${person}`;
  assert.ok(roles.some((r) => r.workspace_id === o.id), "in the organization");
  assert.deepEqual(roles.find((r) => r.workspace_id === child), { workspace_id: child, unit_id: null }, "in the workspace, without the full team");
});

test("N13, 2.6: joining by code uses up the open invite and never rewrites a role application", async () => {
  const o = await org("approval");
  const person = await user();
  await invite(o.id, o.owner, await emailOf(person));
  const [role] = await sql<{ id: string }[]>`INSERT INTO workspace_open_roles (workspace_id, role, title, count) VALUES (${o.id}, 'Mentor', 'Mentor', 2) RETURNING id`;
  await sql`INSERT INTO role_applications (workspace_id, role_id, applicant_id, creator_id, status) VALUES (${o.id}, ${role!.id}, ${person}, ${o.owner}, 'pending')`;
  await join.joinOrgByCode(person, o.code, "Hi");
  const [application] = await sql<{ role_id: string | null }[]>`SELECT role_id FROM role_applications WHERE applicant_id = ${person} AND role_id IS NOT NULL`;
  assert.equal(application!.role_id, role!.id, "the role application is untouched");
  await sql`UPDATE workspaces SET org_settings = ${sql.json({ joinMode: "instant" })} WHERE id = ${o.id}`;
  const second = await user();
  await invite(o.id, o.owner, await emailOf(second));
  assert.equal((await join.joinOrgByCode(second, o.code))?.outcome, "joined");
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM org_email_invites WHERE org_id = ${o.id} AND email = ${await emailOf(second)}`;
  assert.equal(n, 0, "their invite is gone, not left under Invited");
});

test("2.2, N15, 3.1: blocked applicants aren't approved; adds report what happened and who did it", async () => {
  const o = await org("approval");
  const [admin, asker, blocked] = [await user(), await user(), await user()];
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${admin}, 'admin')`;
  const ids = [];
  for (const who of [asker, blocked]) ids.push((await sql<{ id: string }[]>`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status) VALUES (${o.id}, ${who}, ${o.owner}, 'pending') RETURNING id`)[0]!.id);
  await sql`INSERT INTO org_join_blocks (org_id, user_id, blocked_by) VALUES (${o.id}, ${blocked}, ${o.owner})`;
  viewerId = admin;
  const approved = await members.approveJoinRequestsAction(o.id, ids);
  assert.deepEqual(approved, { success: true, approved: 1, atLimit: 0 });

  const child = await sql.begin((tx) => createProject(tx, o.owner));
  await sql`UPDATE workspaces SET parent_id = ${o.id} WHERE id = ${child}`;
  const added = await members.addMembersToChildAction(o.id, child, [asker, asker], null);
  assert.deepEqual(added, { success: true, added: 1, skipped: 1 });
  assert.deepEqual(await members.addMembersToChildAction(o.id, child, [asker], null), { success: true, added: 0, skipped: 1 });
  const [event] = await sql<{ actor_id: string }[]>`SELECT actor_id FROM workspace_node_events WHERE workspace_id = ${child} AND type = 'workspace_member.added' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(event!.actor_id, admin, "the admin who did it, not the workspace's lead");

  // N16: the result counts the people whose role really changed; a viewer leaves their workspaces.
  viewerId = o.owner;
  assert.deepEqual(await members.changeMemberRoleAction(o.id, [asker], "viewer"), { success: true, changed: 1 });
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${child} AND user_id = ${asker}`;
  assert.equal(n, 0);
});

test("9.5: approve-all keeps going past a changed hand-in", async () => {
  const o = await org();
  const [asha, ravi] = [await user(), await user()];
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${asha}, 'member'), (${o.id}, ${ravi}, 'member')`;
  viewerId = o.owner;
  const made = await assignments.createAssignmentAction({ projectId: o.id, title: "Lab 1", dueDate: new Date(Date.now() + 864e5).toISOString(), publish: true,
    submissionType: "link", reviewRequired: true, lateRule: "none", target: { mode: "everyone" }, steps: [] });
  const masterId = made.success ? made.masterId : "";
  const copies = await sql<{ id: string; assignee_id: string }[]>`SELECT id, assignee_id FROM tasks WHERE assignment_id = ${masterId}`;
  for (const c of copies) { viewerId = c.assignee_id; assert.equal((await assignments.submitAssignmentAction(c.id, { link: "https://example.com/w" })).success, true); }
  viewerId = o.owner;
  const changed = copies.find((c) => c.assignee_id === asha)!.id;
  await sql`UPDATE tasks SET review_content_hash = 'stale' WHERE id = ${changed}`;
  const result = await assignments.approveAllSubmittedAction(masterId);
  assert.equal(result.success && result.approved, 1);
  assert.deepEqual(result.success && result.failed.map((f) => f.copyId), [changed]);
});
