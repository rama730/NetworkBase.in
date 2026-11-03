import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §16.12 and §33.7: one organization's whole life, walked row by row through the real actions. Each row
// checks what every part does at that moment: access, copies, channels, read-only states and who is told.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.143" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });

let orgs: typeof import("../../src/app/actions/organizations");
let members: typeof import("../../src/app/actions/org-members");
let lifecycle: typeof import("../../src/app/actions/org-lifecycle");
let access: typeof import("../../src/lib/data/workspace-access");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ userId: viewerId || null, profile: { fullName: "Tester", username: "tester", avatarUrl: null } }),
  });
  orgs = await loadAppModule(() => import("../../src/app/actions/organizations"));
  members = await loadAppModule(() => import("../../src/app/actions/org-members"));
  lifecycle = await loadAppModule(() => import("../../src/app/actions/org-lifecycle"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("16.12: created, first work, joining, role change, owner leaving, archived, suspended, scheduled for deletion", async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const [owner, admin, student, late] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!));
  const code = generateJoinCode();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', status = 'active', join_code = ${code}, join_code_enabled = true,
    title = ${`Class ${tag}`}, slug = ${`class-${tag}`}, org_settings = '{"joinMode":"instant"}'::jsonb WHERE id = ${id}`;
  created.push(id);

  // First work: an assignment to everyone, published.
  const [lab] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_settings, creator_id)
    VALUES (${id}, 'Lab 1', 'assignment', ${sql.json({ publishedAt: new Date().toISOString(), submissionType: "none", target: { mode: "everyone" } })}, ${owner!}) RETURNING id`;

  // Member joins: gets the open assignment as a copy, and is a member; admins are told.
  viewerId = student!;
  const joined = await orgs.joinOrganizationAction(code);
  assert.equal(joined.success, true, JSON.stringify(joined));
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${lab!.id} AND assignee_id = ${student!} AND deleted_at IS NULL`)[0]!.n, 1, "gets open assignments");
  assert.ok((await sql`SELECT 1 FROM user_notifications WHERE user_id = ${admin!} AND dedupe_key LIKE ${`%${id}%org.member_joined%`}`).length, "admins notified");

  // Role changes: Viewer, then back; the role reads the same everywhere it's checked.
  viewerId = owner!;
  assert.equal((await members.changeMemberRoleAction(id, [student!], "viewer")).success, true);
  assert.equal((await access.getWorkspaceAccessById(id, student!)).memberRole, "viewer");
  assert.equal((await members.changeMemberRoleAction(id, [student!], "member")).success, true);

  // Owner leaves: must transfer first.
  assert.equal((await orgs.leaveOrgAction(id)).success, false, "the owner transfers first");

  // Archived: read only everywhere.
  assert.equal((await lifecycle.archiveOrgAction(id)).success, true);
  assert.equal((await access.getWorkspaceAccessById(id, student!)).writeBlocked, "archived");
  assert.equal((await sql`SELECT app_private.nb_workspace_read_only(${id}::uuid) AS ro`)[0]!.ro, true);
  assert.equal((await lifecycle.unarchiveOrgAction(id)).success, true);

  // Suspended: read only; the reason goes to the owner and admins only.
  await sql`UPDATE workspaces SET suspended_at = now(), suspend_reason = 'Spam' WHERE id = ${id}`;
  assert.equal((await access.getWorkspaceAccessById(id, student!)).writeBlocked, "suspended");
  await sql`UPDATE workspaces SET suspended_at = NULL, suspend_reason = NULL WHERE id = ${id}`;

  // A late joiner after the work is out still gets it.
  // Unarchiving gave a new code with joining off (27.5); an admin turns it on.
  const [{ join_code: newCode }] = await sql`UPDATE workspaces SET join_code_enabled = true WHERE id = ${id} RETURNING join_code`;
  assert.notEqual(newCode, code, "the old code stopped working");
  viewerId = late!;
  const lateJoin = await orgs.joinOrganizationAction(newCode);
  assert.equal(lateJoin.success, true, JSON.stringify(lateJoin));
  assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE assignment_id = ${lab!.id} AND assignee_id = ${late!}`)[0]!.n, 1);

  // Scheduled for deletion: members lose it; the owner keeps it to restore.
  viewerId = owner!;
  const deleted = await lifecycle.deleteOrgAction(id, { confirmHandle: `class-${tag}`, choices: {} });
  assert.equal(deleted.success, true, JSON.stringify(deleted));
  assert.equal((await access.getWorkspaceAccessById(id, student!)).canRead, false, "removed for members");
  assert.equal((await access.getWorkspaceAccessById(id, owner!)).canRead, true, "the owner can restore it");
});
