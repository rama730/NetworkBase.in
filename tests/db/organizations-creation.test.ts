import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Organization creation end to end (report §34): Other with its label, identity fields, chosen roles and Work
// defaults, and the co-admins and roster invited after the org exists.

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
stubNextAfter();

let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
before(async () => {
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
});
const created: string[] = [];
after(async () => {
  for (const id of created) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

type Input = Parameters<typeof import("../../src/lib/workspaces/server/lifecycle").createProjectAction>[0];
const base = (handle: string, organization: Record<string, unknown>) => ({
  title: "Civic Hackers Bengaluru",
  description: "A volunteer group building small tools for the city.",
  project_type: "organization",
  organization: { handle, join_mode: "approval", child_creation: "members", outside_people: false, ...organization },
}) as unknown as Input;

test("an Other org saves its label, identity, roles, Work defaults and sends the invites", async () => {
  viewerId = await sql.begin((tx) => createUser(tx));
  const coAdmin = await sql.begin((tx) => createUser(tx));
  const [{ email: coAdminEmail }] = (await sql`SELECT email FROM profiles WHERE id = ${coAdmin}`) as unknown as [{ email: string }];
  const handle = `civic-${viewerId.slice(0, 6)}`;
  const result = await lifecycle.createProjectAction({
    ...base(handle, {
      org_type: "other", type_label: "Nonprofit", part_of: "Bengaluru Civic Trust", location: "Bengaluru", time_zone: "Asia/Kolkata",
      welcome_note: "Say hi in #general.", role_names: { owner: "Lead", admin: "Organizer", member: "Volunteer", viewer: "Guest" },
      work: { late_rule: "none" }, max_members: 50, creator_title: "Lead",
      co_admins: [{ user_id: coAdmin, label: "Co admin" }, { email: "outside.admin@example.com", label: "outside.admin@example.com" }],
      invite_emails: "asha@example.com, not-an-email; ravi@example.com",
    }),
    custom_project_type: "Civic tech",
    problem_statement: "Anyone in Bengaluru who wants to help",
  } as unknown as Input);
  assert.equal(result.success, true, JSON.stringify(result));
  const id = result.project!.id;
  created.push(id);
  assert.deepEqual(result.project!.invites, { coAdmins: 2, members: 2, skipped: 1 });

  const [row] = await sql`SELECT org_type, category, time_zone, welcome_note, max_collaborators, task_review_required, problem_statement,
      org_settings->>'typeLabel' AS type_label, org_settings->>'partOf' AS part_of, org_settings->>'location' AS location,
      org_settings->>'assignmentLateRule' AS late_rule, org_settings->'roleNames'->>'member' AS member_name FROM projects WHERE id = ${id}`;
  assert.deepEqual({ ...row }, {
    org_type: "other", category: "Civic tech", time_zone: "Asia/Kolkata", welcome_note: "Say hi in #general.", max_collaborators: "50",
    task_review_required: false, problem_statement: "Anyone in Bengaluru who wants to help",
    type_label: "Nonprofit", part_of: "Bengaluru Civic Trust", location: "Bengaluru", late_rule: "none", member_name: "Volunteer",
  });
  const invites = await sql`SELECT email, role FROM org_email_invites WHERE org_id = ${id} ORDER BY email`;
  assert.deepEqual(invites.map((r) => `${r.email}:${r.role}`).sort(), [
    "asha@example.com:member", `${coAdminEmail.toLowerCase()}:admin`, "outside.admin@example.com:admin", "ravi@example.com:member",
  ].sort());
});

test("creation refuses an org without a type, and Other without its label", async () => {
  viewerId = await sql.begin((tx) => createUser(tx));
  const noType = await lifecycle.createProjectAction(base(`no-type-${viewerId.slice(0, 6)}`, {}));
  assert.equal(noType.success, false);
  assert.match(noType.error ?? "", /what kind of organization/);
  const noLabel = await lifecycle.createProjectAction(base(`no-label-${viewerId.slice(0, 6)}`, { org_type: "other" }));
  assert.equal(noLabel.success, false);
  assert.match(noLabel.error ?? "", /what you call it/);
});

test("Research gets PI and Researcher, and an empty subject leaves the category blank", async () => {
  viewerId = await sql.begin((tx) => createUser(tx));
  const result = await lifecycle.createProjectAction(base(`lab-${viewerId.slice(0, 6)}`, { org_type: "research" }));
  assert.equal(result.success, true, JSON.stringify(result));
  created.push(result.project!.id);
  const [row] = await sql`SELECT category, org_settings->'roleNames' AS roles FROM projects WHERE id = ${result.project!.id}`;
  assert.equal(row!.category, null);
  assert.deepEqual(row!.roles, { owner: "PI", admin: "Researcher", member: "Member", viewer: "Guest" });
});
