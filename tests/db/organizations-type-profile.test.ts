import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, inRollback, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Step T (report §21): saved type settings, the fill for older organizations, changing type, and limits.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.17" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }), createFunction: () => ({}) } });
stubNextAfter();

let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
let orgs: typeof import("../../src/app/actions/organizations");
let members: typeof import("../../src/app/actions/org-members");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(type = "education", settings: Record<string, unknown> = {}) {
  const [owner, admin] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = ${type}, join_code = ${generateJoinCode()}, title = 'CSE 3B', org_settings = ${sql.json(settings as never)} WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin! };
}

const settingsOf = async (id: string) => (await sql`SELECT org_type, org_settings FROM workspaces WHERE id = ${id}`)[0]!;

test("21.2: a new organization saves what its type sets, and only the role names that differ", async () => {
  viewerId = await sql.begin((tx) => createUser(tx));
  const handle = `class-${viewerId.slice(0, 6)}`;
  const result = await lifecycle.createWorkspaceAction({
    title: "Data Structures 3B", description: "Weekly labs and two group workspaces.", project_type: "organization",
    organization: { handle, org_type: "education", join_mode: "instant", child_creation: "members", outside_people: false, role_names: { owner: "Teacher", admin: "Tutor", member: "Student", viewer: "Viewer" } },
  } as never);
  assert.equal(result.success, true, JSON.stringify(result));
  created.push(result.project!.id);
  const { org_settings: s } = await settingsOf(result.project!.id);
  assert.deepEqual([s.assignmentReview, s.assignmentLateRule, s.storyPoints, s.membersCreateChannels, s.generalNotify], [true, "until", "hidden", false, "mentions"]);
  assert.deepEqual(s.roleNames, { admin: "Tutor" }, "Teacher, Student and Viewer are the type's, so they aren't saved as custom");
});

test("DB3: 0048 fills older organizations from their type, and never overwrites what was set", async () => {
  const company = await org("company", { assignmentReview: true });
  const education = await org("education");
  const migration = fs.readFileSync(path.join(process.cwd(), "drizzle/0048_org_saved_type_settings.sql"), "utf8");
  const after = await inRollback(async (tx) => {
    await tx.unsafe(migration);
    return tx`SELECT id, org_settings FROM workspaces WHERE id IN (${company.id}, ${education.id})`;
  });
  const of = (id: string) => after.find((r) => r.id === id)!.org_settings;
  assert.deepEqual([of(company.id).assignmentReview, of(company.id).assignmentLateRule, of(company.id).membersCreateChannels], [true, "always", true], "kept the owner's review choice");
  assert.deepEqual([of(education.id).assignmentReview, of(education.id).generalNotify, of(education.id).storyPoints], [true, "mentions", "hidden"]);
});

test("21.2: only the owner changes type; it renames default roles and leaves custom roles and every rule alone", async () => {
  const o = await org("education", { assignmentReview: true, assignmentLateRule: "until", storyPoints: "hidden", membersCreateChannels: false, generalNotify: "mentions",
    roleNames: { owner: "Teacher", admin: "Tutor", member: "Student", viewer: "Viewer" } });
  viewerId = o.admin;
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "profile", { org_type: "company" })).success, false, "admins can't change type");
  viewerId = o.owner;
  assert.equal((await orgs.updateOrgSettingsAction(o.id, "profile", { org_type: "company" })).success, true);
  const { org_type, org_settings: s } = await settingsOf(o.id);
  assert.equal(org_type, "company");
  assert.deepEqual(s.roleNames, { admin: "Tutor" }, "Teacher and Student follow the new type; Tutor was the owner's own");
  assert.deepEqual([s.assignmentReview, s.assignmentLateRule, s.storyPoints, s.membersCreateChannels, s.generalNotify], [true, "until", "hidden", false, "mentions"], "rules stay");
});

test("21.4: the 21st admin is refused with the limit, before anyone changes", async () => {
  const o = await org();
  const people = await Promise.all(Array.from({ length: 20 }, () => sql.begin((tx) => createUser(tx))));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) SELECT ${o.id}, unnest(${people.slice(0, 19) as string[]}::uuid[]), 'admin'`;
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${people[19]!}, 'member')`;
  viewerId = o.owner;
  const result = await members.changeMemberRoleAction(o.id, [people[19]!], "admin");
  assert.deepEqual(result, { success: false, error: "CSE 3B has reached 20 admins. Contact support to raise this." });
  const [row] = await sql`SELECT role FROM workspace_members WHERE workspace_id = ${o.id} AND user_id = ${people[19]!}`;
  assert.equal(row!.role, "member");
});

test("21.4: 1,000 invites a day, with the count left shown and checked before sending", async () => {
  const o = await org();
  await sql`INSERT INTO org_email_invites (org_id, email, role, invited_by, expires_at)
    SELECT ${o.id}, 'p' || g || '@example.com', 'member', ${o.owner}, now() + interval '7 days' FROM generate_series(1, 998) g`;
  viewerId = o.owner;
  const read = await members.readOrgMembersAction(o.id);
  assert.equal(read.success && read.invitesLeft, 2);
  const result = await members.inviteByEmailAction(o.id, { emails: "a@example.com, b@example.com, c@example.com", role: "member" });
  assert.deepEqual(result, { success: false, error: "2 invites left today. Send fewer at once." });
});

test("21.4: an organization at 200 workspaces says so on the create button and refuses the 201st", async () => {
  const o = await org();
  await sql`INSERT INTO workspaces (owner_id, title, slug, parent_id) SELECT ${o.owner}, 'W' || g, ${`w-${o.id.slice(0, 8)}-`} || g, ${o.id} FROM generate_series(1, 200) g`;
  viewerId = o.owner;
  const locations = await orgs.listCreateLocationsAction();
  assert.equal(locations.find((l) => l.id === o.id)?.block, "CSE 3B has reached 200 workspaces. Contact support to raise this.");
  const result = await lifecycle.createWorkspaceAction({ title: "Team 201", description: "One more team workspace for the class.", project_type: "education", parent_org_id: o.id } as never);
  assert.equal(result.success, false);
  assert.equal(result.error, "CSE 3B has reached 200 workspaces. Contact support to raise this.");
});
