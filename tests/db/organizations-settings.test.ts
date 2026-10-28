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
    await sql`DELETE FROM role_applications WHERE project_id = ${id}`;
    await sql`DELETE FROM projects WHERE id = ${id}`;
  }
  await sql.end();
  await closeAppDb();
});

async function org(options: { visibility?: string; joinMode?: string } = {}) {
  const owner = await sql.begin((tx) => createUser(tx));
  const admin = await sql.begin((tx) => createUser(tx));
  const member = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: options.visibility ?? "public" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${id}, ${owner}, 'owner'), (${id}, ${admin}, 'admin'), (${id}, ${member}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()},
            org_settings = ${sql.json({ version: 1, joinMode: options.joinMode ?? "instant", roleNames: { owner: "Teacher", admin: "TA", member: "Student", viewer: "Guest" } })}
            WHERE id = ${id}`;
  created.push(id);
  return { id, owner, admin, member };
}

const settingsOf = async (id: string) => (await sql`SELECT org_settings, join_code, max_collaborators, welcome_note, slug FROM projects WHERE id = ${id}`)[0]!;

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
  assert.equal(!again.success && /7 days/.test(again.error), true, JSON.stringify(again));
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
  const [request] = await sql`SELECT status FROM role_applications WHERE project_id = ${approval.id} AND applicant_id = ${viewerId}`;
  assert.equal(request!.status, "withdrawn");
  assert.equal((await orgs.joinPublicOrgAction(approval.id)).success, true, "withdrawing is not a decline: no cool-down");

  const priv = await org({ visibility: "private" });
  assert.equal((await orgs.joinPublicOrgAction(priv.id)).success, false);
});

test("everyone edits their own title and profile switch; members can leave, the owner cannot", async () => {
  const { id, owner, member } = await org();
  viewerId = member;
  assert.equal((await orgs.updateMyOrgMembershipAction(id, { title: "Section B", show_on_profile: false })).success, true);
  const [row] = await sql`SELECT title, show_on_profile FROM project_members WHERE project_id = ${id} AND user_id = ${member}`;
  assert.deepEqual({ ...row }, { title: "Section B", show_on_profile: false });
  assert.equal((await orgs.leaveOrgAction(id)).success, true);
  assert.equal((await sql`SELECT count(*)::int AS n FROM project_members WHERE project_id = ${id} AND user_id = ${member}`)[0]!.n, 0);
  viewerId = owner;
  const ownerLeave = await orgs.leaveOrgAction(id);
  assert.equal(!ownerLeave.success && ownerLeave.error, "Transfer ownership before you leave.");
});
