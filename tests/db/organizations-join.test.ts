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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) });

let orgs: typeof import("../../src/app/actions/organizations");
let join: typeof import("../../src/lib/organizations/join");
let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
before(async () => {
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  join = await loadAppModule(() => import("../../src/lib/organizations/join"));
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

async function org(settings: Record<string, unknown> = {}, extra: { maxMembers?: string; status?: string; visibility?: string } = {}) {
  const owner = await sql.begin((tx) => createUser(tx));
  const id = await sql.begin((tx) => createProject(tx, owner, { visibility: extra.visibility ?? "public", status: extra.status ?? "active" }));
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', join_code = ${code},
            org_settings = ${sql.json({ version: 1, ...settings })}, max_collaborators = ${extra.maxMembers ?? null} WHERE id = ${id}`;
  created.push(id);
  return { owner, id, code };
}

const role = async (projectId: string, userId: string) =>
  (await sql`SELECT role FROM workspace_members WHERE workspace_id = ${projectId} AND user_id = ${userId}`)[0]?.role ?? null;

test("instant mode: a code joins as Member; again says already a member", async () => {
  const { id, code } = await org();
  viewerId = await sql.begin((tx) => createUser(tx));
  const first = await orgs.joinOrganizationAction(code.toLowerCase());
  assert.equal(first.success && first.outcome, "joined", JSON.stringify(first));
  assert.equal(await role(id, viewerId), "member");
  const again = await orgs.joinOrganizationAction(code);
  assert.equal(again.success && again.outcome, "already_member");
});

test("approval mode: a code sends one request without a role; nobody is added", async () => {
  const { id, code } = await org({ joinMode: "approval" });
  viewerId = await sql.begin((tx) => createUser(tx));
  const first = await orgs.joinOrganizationAction(code, "Section B");
  assert.equal(first.success && first.outcome, "requested", JSON.stringify(first));
  const [request] = await sql`SELECT status, role_id, message FROM role_applications WHERE workspace_id = ${id} AND applicant_id = ${viewerId}`;
  assert.deepEqual({ ...request }, { status: "pending", role_id: null, message: "Section B" });
  assert.equal(await role(id, viewerId), null);
  const again = await orgs.joinOrganizationAction(code);
  assert.equal(again.success && again.outcome, "already_requested");
});

test("blocked, full, archived, disabled and unknown codes are refused with plain messages", async () => {
  const blocked = await org();
  viewerId = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO org_join_blocks (org_id, user_id) VALUES (${blocked.id}, ${viewerId})`;
  assert.equal((await orgs.joinOrganizationAction(blocked.code)).success, false);

  const full = await org({}, { maxMembers: "1" });
  const fullResult = await orgs.joinOrganizationAction(full.code);
  assert.equal(!fullResult.success && fullResult.error, "This organization is full.");

  const archived = await org({}, { status: "archived" });
  assert.equal((await orgs.joinOrganizationAction(archived.code)).success, false);
  assert.equal(await role(archived.id, viewerId), null);

  const disabled = await org();
  await sql`UPDATE workspaces SET join_code_enabled = false WHERE id = ${disabled.id}`;
  const disabledResult = await orgs.joinOrganizationAction(disabled.code);
  assert.equal(!disabledResult.success && disabledResult.error, "That code doesn’t work. Ask your organization for the current one.");

  const unknown = await orgs.joinOrganizationAction("ZZZZZZ");
  assert.equal(!unknown.success && unknown.error, "That code doesn’t work. Ask your organization for the current one.");
});

test("the preview shows a private org's name and type only", async () => {
  const priv = await org({}, { visibility: "private" });
  viewerId = "";
  const preview = await orgs.getJoinPreviewAction(priv.code);
  assert.equal(preview.success, true, JSON.stringify(preview));
  assert.equal(preview.success && preview.preview.memberCount, null);
  const pub = await org();
  const publicPreview = await orgs.getJoinPreviewAction(pub.code);
  assert.equal(publicPreview.success && publicPreview.preview.memberCount, 1);
});

test("email invites are accepted at sign-up with their role and title", async () => {
  const { id } = await org();
  const userId = await sql.begin((tx) => createUser(tx));
  const [{ email }] = (await sql`SELECT email FROM profiles WHERE id = ${userId}`) as unknown as [{ email: string }];
  await sql`INSERT INTO org_email_invites (org_id, email, role, title, expires_at) VALUES (${id}, ${email.toLowerCase()}, 'viewer', 'Examiner', now() + interval '7 days')`;
  const accepted = await join.acceptOrgEmailInvites(userId, email.toUpperCase());
  assert.equal(accepted, 1);
  const [member] = await sql`SELECT role, title FROM workspace_members WHERE workspace_id = ${id} AND user_id = ${userId}`;
  assert.deepEqual({ ...member }, { role: "viewer", title: "Examiner" });
  assert.equal((await sql`SELECT count(*)::int AS n FROM org_email_invites WHERE org_id = ${id} AND accepted_at IS NOT NULL`)[0]!.n, 1);
  assert.equal(await join.acceptOrgEmailInvites(userId, email), 0, "accepted once");
});

test("handles are free only when no project, hold or reserved name has them", async () => {
  const { id } = await org();
  const [{ slug }] = (await sql`SELECT slug FROM workspaces WHERE id = ${id}`) as unknown as [{ slug: string }];
  assert.equal(await join.isOrgHandleAvailable(slug), false);
  await sql`INSERT INTO org_handle_holds (handle, org_id, held_until) VALUES ('held-handle-p2', ${id}, now() + interval '1 day') ON CONFLICT (handle) DO UPDATE SET org_id = EXCLUDED.org_id, held_until = EXCLUDED.held_until`;
  assert.equal(await join.isOrgHandleAvailable("held-handle-p2"), false);
  await sql`INSERT INTO reserved_usernames (username) VALUES ('reserved-p2') ON CONFLICT DO NOTHING`;
  assert.equal(await join.isOrgHandleAvailable("reserved-p2"), false);
  assert.equal(await join.isOrgHandleAvailable("free-handle-p2"), true);
});

test("creating an organization keeps the exact handle, makes a join code and applies type defaults", async () => {
  viewerId = await sql.begin((tx) => createUser(tx));
  const handle = `cse-3a-${viewerId.slice(0, 6)}`;
  const input = {
    title: "CSE-3A 2026",
    description: "Compiler design class for the 2026 autumn term.",
    project_type: "education",
    organization: { org_type: "education" as const, handle: handle.toUpperCase(), term_start: "2026-08-01", term_end: "2026-12-15", creator_title: "Teacher", join_mode: "approval" as const },
  } as unknown as Parameters<typeof lifecycle.createWorkspaceAction>[0];
  const result = await lifecycle.createWorkspaceAction(input);
  assert.equal(result.success, true, JSON.stringify(result));
  created.push(result.project!.id);
  assert.equal(result.project!.slug, handle);
  assert.match(result.project!.joinCode ?? "", /^[A-HJ-NP-Z2-9]{6}$/);
  const [row] = await sql`SELECT kind, org_type, task_review_required, term_end::text AS term_end, org_settings->>'joinMode' AS join_mode,
                                 org_settings->'roleNames'->>'member' AS member_name, org_settings->>'generalNotify' AS general_notify FROM workspaces WHERE id = ${result.project!.id}`;
  assert.deepEqual({ ...row }, { kind: "organization", org_type: "education", task_review_required: true, term_end: "2026-12-15", join_mode: "approval", member_name: null, general_notify: "mentions" });
  // Step T (report §21.2): "Student" comes from the type and isn't stored as custom; the type's values are saved.
  const [owner] = await sql`SELECT role, title FROM workspace_members WHERE workspace_id = ${result.project!.id} AND user_id = ${viewerId}`;
  assert.deepEqual({ ...owner }, { role: "owner", title: "Teacher" });

  const taken = await lifecycle.createWorkspaceAction(input);
  assert.equal(taken.success, false);
  assert.equal(taken.error, `@${handle} is taken.`);
});

test("plain project creation parses its input (zod 4 refused the old .extend over a refined schema)", async () => {
  viewerId = await sql.begin((tx) => createUser(tx));
  const result = await lifecycle.createWorkspaceAction({
    title: "Parser playground",
    description: "A small project to check that creation parses its input.",
    project_type: "web",
  } as unknown as Parameters<typeof lifecycle.createWorkspaceAction>[0]);
  assert.equal(result.success, true, JSON.stringify(result));
  created.push(result.project!.id);
  assert.equal(result.project!.joinCode, null);
});
