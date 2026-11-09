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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.10" }) });

let orgs: typeof import("../../src/app/actions/organizations");
let detail: typeof import("../../src/lib/organizations/detail");
before(async () => {
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  detail = await loadAppModule(() => import("../../src/lib/organizations/detail"));
});

const created: string[] = [];
after(async () => {
  for (const id of created) {
    await sql`DELETE FROM role_applications WHERE workspace_id = ${id}`;
    await sql`DELETE FROM workspaces WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org(options: { visibility?: string; joinMode?: string } = {}) {
  const owner = await sql.begin((tx) => createUser(tx));
  const admin = await sql.begin((tx) => createUser(tx));
  const member = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: options.visibility ?? "public" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner'), (${id}, ${admin}, 'admin'), (${id}, ${member}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()},
            org_settings = ${sql.json({ version: 1, joinMode: options.joinMode ?? "instant", roleNames: { owner: "Teacher", admin: "TA", member: "Student", viewer: "Guest" } })}
            WHERE id = ${id}`;
  created.push(id);
  return { id, owner, admin, member };
}

const settingsOf = async (id: string) => (await sql`SELECT org_settings, join_code, max_collaborators, welcome_note, slug FROM workspaces WHERE id = ${id}`)[0]!;

test("admins edit joining and projects rules; only the owner edits role names; members edit nothing", async () => {
  const { id, owner, admin, member } = await org();
  viewerId = admin;
  const access = await orgs.updateOrgSettingsAction(id, "access", { join_mode: "approval", max_members: 60 });
  assert.equal(access.success, true, JSON.stringify(access));
  const after = await settingsOf(id);
  assert.equal(after.org_settings.joinMode, "approval");
  assert.equal(after.max_collaborators, "60");
  assert.equal(after.org_settings.changes.access.by, admin, "last changed by");

  assert.equal((await orgs.updateOrgSettingsAction(id, "people", { role_names: { owner: "Prof", admin: "TA", member: "Student", viewer: "Guest" } })).success, false);
  viewerId = owner;
  assert.equal((await orgs.updateOrgSettingsAction(id, "people", { role_names: { owner: "Prof", admin: "TA", member: "Student", viewer: "Guest" } })).success, true);
  assert.equal((await settingsOf(id)).org_settings.roleNames.owner, "Prof");

  viewerId = member;
  assert.equal((await orgs.updateOrgSettingsAction(id, "projects", { child_creation: "admins", outside_people: true })).success, false);
  viewerId = admin;
  assert.equal((await orgs.updateOrgSettingsAction(id, "profile", { welcome_note: "Read the syllabus first.", time_zone: "Not/AZone" })).success, false, "time zone is checked");
  assert.equal((await orgs.updateOrgSettingsAction(id, "profile", { welcome_note: "Read the syllabus first.", time_zone: "Asia/Kolkata" })).success, true);
  assert.equal((await settingsOf(id)).welcome_note, "Read the syllabus first.");
});

test("regenerating the join code invalidates the old one at once (owners and admins only)", async () => {
  const { id, admin, member } = await org();
  const before = (await settingsOf(id)).join_code;
  viewerId = member;
  assert.equal((await orgs.regenerateJoinCodeAction(id)).success, false);
  viewerId = admin;
  const result = await orgs.regenerateJoinCodeAction(id);
  assert.equal(result.success, true);
  assert.notEqual(result.success && result.joinCode, before);
  const outsider = await sql.begin((tx) => createUser(tx));
  viewerId = outsider;
  assert.equal((await orgs.joinOrganizationAction(before)).success, false);
});

test("renaming the handle: owner only, holds the old handle for redirects, once every 7 days", async () => {
  const { id, owner, admin } = await org();
  const oldHandle = (await settingsOf(id)).slug as string;
  const next = `renamed-${id.slice(0, 8)}`;
  viewerId = admin;
  assert.equal((await orgs.renameOrgHandleAction(id, next)).success, false);
  viewerId = owner;
  const renamed = await orgs.renameOrgHandleAction(id, next.toUpperCase());
  assert.equal(renamed.success, true, JSON.stringify(renamed));
  assert.equal((await settingsOf(id)).slug, next);
  assert.equal(await detail.resolveHeldOrgHandle(oldHandle), next);
  const again = await orgs.renameOrgHandleAction(id, `${next}-2`);
  assert.equal(!again.success && /You can change it again on/.test(again.error), true, JSON.stringify(again));
  const other = await org();
  viewerId = other.owner;
  assert.equal((await orgs.renameOrgHandleAction(other.id, oldHandle)).success, false, "a held handle is taken");
});

test("public orgs: visitors join or request from the page, and can cancel a request; private orgs need the code", async () => {
  const open = await org();
  viewerId = await sql.begin((tx) => createUser(tx));
  const joined = await orgs.joinPublicOrgAction(open.id);
  assert.equal(joined.success && joined.outcome, "joined", JSON.stringify(joined));

  const approval = await org({ joinMode: "approval" });
  const requested = await orgs.joinPublicOrgAction(approval.id, "Section B");
  assert.equal(requested.success && requested.outcome, "requested");
  assert.equal((await orgs.cancelJoinRequestAction(approval.id)).success, true);
  const [request] = await sql`SELECT status FROM role_applications WHERE workspace_id = ${approval.id} AND applicant_id = ${viewerId}`;
  assert.equal(request!.status, "withdrawn");
  assert.equal((await orgs.joinPublicOrgAction(approval.id)).success, true, "withdrawing is not a decline: no cool-down");

  const priv = await org({ visibility: "private" });
  assert.equal((await orgs.joinPublicOrgAction(priv.id)).success, false);
});

test("everyone edits their own title and profile switch; members can leave, the owner cannot", async () => {
  const { id, owner, member } = await org();
  viewerId = member;
  assert.equal((await orgs.updateMyOrgMembershipAction(id, { title: "Section B", show_on_profile: false })).success, true);
  const [row] = await sql`SELECT title, show_on_profile FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${member}`;
  assert.deepEqual({ ...row }, { title: "Section B", show_on_profile: false });
  assert.equal((await orgs.leaveOrgAction(id)).success, true);
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${member}`)[0]!.n, 0);
  viewerId = owner;
  const ownerLeave = await orgs.leaveOrgAction(id);
  assert.equal(!ownerLeave.success && ownerLeave.error, "Transfer ownership before you leave.");
});

test("§21 Work: type defaults, admins save the section, composer and sprint defaults follow it; child Collaborators show unit and Outside <org>", async () => {
  const { id, admin, member } = await org();
  const { readOrgWork } = await loadAppModule(() => import("../../src/lib/organizations/settings"));
  assert.deepEqual([readOrgWork({}, "education").reviewRequired, readOrgWork({}, "education").lateRule, readOrgWork({}, "education").storyPoints], [true, "until", "hidden"]);
  assert.deepEqual([readOrgWork({}, "company").reviewRequired, readOrgWork({}, "company").lateRule, readOrgWork({}, "company").storyPoints], [false, "always", "shown"]);

  viewerId = member;
  assert.equal((await orgs.updateOrgSettingsAction(id, "work", { review_required: false })).success, false);
  viewerId = admin;
  assert.ok((await orgs.updateOrgSettingsAction(id, "work", { review_required: false, late_rule: "none", reminders: "off", story_points: "shown", sprint_auto_start: false, due_time: "17:00" })).success);
  // Assignment form redesign (2026-11-09): only a real time of day is saved.
  assert.equal((await orgs.updateOrgSettingsAction(id, "work", { due_time: "25:00" })).success, false);
  const s = (await settingsOf(id)).org_settings;
  assert.deepEqual([s.assignmentReview, s.assignmentLateRule, s.assignmentReminders, s.storyPoints, s.sprintAutoStart], [false, "none", "off", "shown", false]);
  assert.equal(s.changes.work.by, admin);
  assert.ok((await orgs.updateOrgSettingsAction(id, "projects", { follow_sprints: false })).success);
  const d = await detail.readOrgDetail(id, { userId: admin, isAdmin: true, isInOrg: true });
  assert.equal(d?.followSprintsDefault, false);
  assert.equal(d?.work.lateRule, "none");

  const assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  const options = await assignments.readAssignmentComposerOptionsAction(id);
  assert.ok(options.success);
  assert.deepEqual(options.success && options.defaults, { reviewRequired: false, lateRule: "none", dueTime: "17:00", aiPolicy: "labelled" });

  const child = await sql.begin((tx) => createProject(tx, member, { visibility: "org" }));
  created.push(child);
  const outsider = await sql.begin((tx) => createUser(tx));
  await sql`UPDATE workspaces SET parent_id = ${id}, title = 'Compiler Lab' WHERE id = ${child}`;
  const [unit] = await sql`INSERT INTO workspace_open_roles (workspace_id, role, count) VALUES (${child}, 'Frontend', 3) RETURNING id`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role, unit_id) VALUES (${child}, ${member}, 'owner', NULL), (${child}, ${outsider}, 'member', ${unit!.id})`;
  const settingsServer = await loadAppModule(() => import("../../src/lib/workspaces/server/settings"));
  viewerId = member;
  const collab = await settingsServer.getWorkspaceCollaboratorSettingsAction(child, {});
  assert.ok(collab.success, JSON.stringify(collab).slice(0, 300));
  const row = collab.success ? collab.data.members.find((m) => m.id === outsider) : undefined;
  const [{ title: orgTitle }] = await sql`SELECT title FROM workspaces WHERE id = ${id}`;
  assert.deepEqual([row?.unitTitle, row?.outsideOf], ["Frontend", orgTitle]);
  assert.equal(collab.success && collab.data.members.find((m) => m.id === member)?.outsideOf, null, "org members are not outside");
});
