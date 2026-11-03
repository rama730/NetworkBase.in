import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 14 (report §30.3, §30.4, §31.7, §32.2, §37.8, §45.6; decisions 103, 175; smaller bug 8): the final pass.

let viewerId = "";
let preview: string | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", {
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.141" }),
  cookies: async () => ({ get: (name: string) => (name === "nb_member_preview" && preview ? { name, value: preview } : undefined), set: (name: string, value: string) => { if (name === "nb_member_preview") preview = value || null; }, delete: () => { preview = null; } }),
});

let search: typeof import("../../src/app/actions/org-workspace");
let lifecycle: typeof import("../../src/lib/workspaces/server/lifecycle");
let assignments: typeof import("../../src/app/actions/assignments");
let access: typeof import("../../src/lib/data/workspace-access");
let previewActions: typeof import("../../src/app/actions/member-preview");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
  });
  search = await loadAppModule(() => import("../../src/app/actions/org-workspace"));
  lifecycle = await loadAppModule(() => import("../../src/lib/workspaces/server/lifecycle"));
  assignments = await loadAppModule(() => import("../../src/app/actions/assignments"));
  access = await loadAppModule(() => import("../../src/lib/data/workspace-access"));
  previewActions = await loadAppModule(() => import("../../src/app/actions/member-preview"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(visibility = "public") {
  const tag = Math.random().toString(36).slice(2, 8);
  const [owner, admin, member, viewer, outsider] = await Promise.all([1, 2, 3, 4, 5].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${member!}, 'member'), (${id}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', status = 'active', join_code = ${generateJoinCode()}, title = ${`Class ${tag}`}, slug = ${`class-${tag}`},
    public_tab_visibility = '{"readme": true}'::jsonb WHERE id = ${id}`;
  created.push(id);
  return { id, tag, owner: owner!, admin: admin!, member: member!, viewer: viewer!, outsider: outsider! };
}

async function addDoc(projectId: string, slug: string, orgOptions: Record<string, unknown>) {
  const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings)
    VALUES (${projectId}, ${slug}, ${`${slug}.md`}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true, org: orgOptions })}) RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${projectId}, ${doc!.id}, 1, 'Hello', ${slug}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc!.id}`;
  return doc!.id as string;
}

async function find(as: string, query: string, scope: string | null) {
  viewerId = as;
  return (await search.searchOrgPreviewsAction(query, scope)).map((r) => `${r.kind}:${r.title}`);
}

test("32.2: a draft document never shows in a member's search, in the organization or globally; admins still find it", async () => {
  const o = await org();
  await addDoc(o.id, `syllabus-${o.tag}`, { lifecycle: "published", publishedAt: new Date().toISOString() });
  await addDoc(o.id, `exam-key-${o.tag}`, { lifecycle: "draft" });
  assert.deepEqual((await find(o.member, o.tag, `class-${o.tag}`)).filter((r) => r.startsWith("doc:")), [`doc:syllabus-${o.tag}`]);
  assert.deepEqual((await find(o.member, o.tag, null)).filter((r) => r.startsWith("doc:")), [`doc:syllabus-${o.tag}`]);
  assert.deepEqual((await find(o.admin, o.tag, `class-${o.tag}`)).filter((r) => r.startsWith("doc:")).sort(), [`doc:exam-key-${o.tag}`, `doc:syllabus-${o.tag}`]);
});

test("32.2: viewers get no assignments in search; unlisted organizations show only to their members", async () => {
  const o = await org();
  await sql`INSERT INTO tasks (workspace_id, title, kind, status, assignment_settings, creator_id)
    VALUES (${o.id}, ${`Lab ${o.tag}`}, 'assignment', 'todo', ${sql.json({ publishedAt: new Date().toISOString(), submissionType: "none", target: { mode: "everyone" } })}, ${o.admin})`;
  assert.ok((await find(o.admin, o.tag, null)).includes(`assignment:Lab ${o.tag}`));
  assert.ok(!(await find(o.viewer, o.tag, null)).some((r) => r.startsWith("assignment:")));
  await sql`UPDATE workspaces SET visibility = 'unlisted' WHERE id = ${o.id}`;
  assert.ok(!(await find(o.outsider, o.tag, null)).some((r) => r.startsWith("org:")));
  assert.ok((await find(o.member, o.tag, null)).some((r) => r.startsWith("org:")));
});

test("30.3: the 200-channel limit leaves #general out", async () => {
  const o = await org();
  const [general] = await sql`SELECT count(*)::int AS n FROM chat_channels WHERE workspace_id = ${o.id} AND is_default`;
  if (!general!.n) await sql`INSERT INTO chat_channels (kind, name, workspace_id, created_by, member_count, is_default) VALUES ('public', 'general', ${o.id}, ${o.owner}, 0, true)`;
  await sql`INSERT INTO chat_channels (kind, name, workspace_id, created_by, member_count, is_default)
    SELECT 'public', 'c' || g, ${o.id}, ${o.owner}, 0, false FROM generate_series(1, 199) g`;
  assert.equal((await sql`SELECT count(*)::int AS n FROM chat_channels WHERE workspace_id = ${o.id}`)[0]!.n, 200);
  const [row] = await sql`SELECT app_private.chat_create_channel(${o.id}::uuid, ${o.owner}::uuid, 'last-one', NULL, false) AS id`;
  assert.ok(row?.id);
  await assert.rejects(sql`SELECT app_private.chat_create_channel(${o.id}::uuid, ${o.owner}::uuid, 'one-too-many', NULL, false)`, /chat_project_channel_limit/);
});

test("37.8, decision 103: members and suspended organizations can't be followed; joining ends a follow quietly", async () => {
  const o = await org();
  viewerId = o.member;
  assert.equal((await lifecycle.toggleWorkspaceFollowAction(o.id, true)).success, false);
  viewerId = o.outsider;
  assert.equal((await lifecycle.toggleWorkspaceFollowAction(o.id, true)).success, true);
  assert.equal((await sql`SELECT followers_count FROM workspaces WHERE id = ${o.id}`)[0]!.followers_count, 1);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${o.outsider}, 'member')`;
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_follows WHERE workspace_id = ${o.id}`)[0]!.n, 0);
  assert.equal((await sql`SELECT followers_count FROM workspaces WHERE id = ${o.id}`)[0]!.followers_count, 0);
  const other = await org();
  await sql`UPDATE workspaces SET suspended_at = now() WHERE id = ${other.id}`;
  viewerId = o.outsider;
  assert.equal((await lifecycle.toggleWorkspaceFollowAction(other.id, true)).success, false);
});

test("31.7: several shared organizations read as the first, then +N", async () => {
  const a = await org();
  const b = await org();
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${b.id}, ${a.member}, 'member'), (${b.id}, ${a.admin}, 'member')`;
  await sql`UPDATE workspace_members SET show_on_profile = true WHERE user_id = ${a.member}`;
  viewerId = a.admin;
  assert.match((await search.readSharedOrgsAction([a.member]))[a.member] ?? "", /^Class \w+ \+1$/);
});

test("30.4: reopening tells the people not done that it's open again", async () => {
  const o = await org();
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, status, assignment_settings, creator_id)
    VALUES (${o.id}, 'Lab 1', 'assignment', 'todo', ${sql.json({ publishedAt: new Date().toISOString(), closedAt: new Date().toISOString(), submissionType: "none", target: { mode: "everyone" } })}, ${o.admin}) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, kind, status, assignment_id, assignee_id, creator_id) VALUES (${o.id}, 'Lab 1', 'task', 'todo', ${master!.id}, ${o.member}, ${o.admin})`;
  viewerId = o.admin;
  assert.equal((await assignments.reopenAssignmentAction(master!.id)).success, true);
  const [n] = await sql`SELECT title FROM user_notifications WHERE user_id = ${o.member} AND title = 'Lab 1 is open again'`;
  assert.ok(n);
});

test("45.6, decision 175: an admin previewing as a member reads as a member and every write is blocked; members can't start one", async () => {
  const o = await org();
  viewerId = o.member;
  assert.equal((await previewActions.startMemberPreviewAction(o.id)).success, false);
  assert.equal(preview, null);
  viewerId = o.owner;
  assert.equal((await previewActions.startMemberPreviewAction(o.id)).success, true);
  const seen = await access.getWorkspaceAccessById(o.id, o.owner);
  assert.deepEqual([seen.isOwner, seen.memberRole, seen.canWrite, seen.writeBlocked], [false, "member", false, "preview"]);
  const detail = await loadAppModule(() => import("../../src/lib/organizations/detail"));
  assert.equal(await detail.readViewerOrgRole(o.id, o.owner), "member");
  await previewActions.exitMemberPreviewAction();
  assert.equal(preview, null);
});

test("41.4: Last active here and the indexing rule count from when migration 0043 ran, not a hand-set date", async () => {
  const members = await loadAppModule(() => import("../../src/lib/organizations/members"));
  const [row] = await sql`SELECT min(applied_at) AS at FROM app_migration_journal WHERE tag = '0043_member_last_active_here'`;
  assert.equal((await members.lastActiveHereSince()).getTime(), new Date(row!.at).getTime());
});
