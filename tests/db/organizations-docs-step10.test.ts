import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Step 10 (report §7.4, §28.4, §37.4; decisions 58, 101): Draft, Published and Unpublished changes; read counts;
// empty documents never reach visitors; Public needs a public organization; templates.

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

let docs: typeof import("../../src/app/actions/org-docs");
let projectDoc: typeof import("../../src/app/actions/workspace/doc");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/org-docs"));
  projectDoc = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id} OR parent_id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function org(visibility = "public") {
  const [owner, admin, a, b] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const id = await sql.begin((tx) => createProject(tx, owner!, { visibility }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner!}, 'owner'), (${id}, ${admin!}, 'admin'), (${id}, ${a!}, 'member'), (${id}, ${b!}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', status = 'active', join_code = ${generateJoinCode()}, title = 'CSE 3B',
    public_tab_visibility = '{"readme": true}'::jsonb WHERE id = ${id}`;
  created.push(id);
  return { id, owner: owner!, admin: admin!, a: a!, b: b! };
}

async function addDoc(projectId: string, slug: string, versions: string[], org: Record<string, unknown> = {}, publishedIndex = versions.length - 1) {
  const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings)
    VALUES (${projectId}, ${slug}, ${`${slug}.md`}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_workspace", externalImages: false, projectBlocks: true, org })}) RETURNING id`;
  const ids: string[] = [];
  for (const [i, content] of versions.entries()) {
    const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${projectId}, ${doc!.id}, ${i + 1}, ${content}, ${`${slug}-${i}`}) RETURNING id`;
    ids.push(v!.id);
  }
  if (publishedIndex >= 0) await sql`UPDATE workspace_documents SET published_version_id = ${ids[publishedIndex]!} WHERE id = ${doc!.id}`;
  return doc!.id as string;
}

const item = async (orgId: string, as: string, slug: string) => {
  viewerId = as;
  const r = await docs.readOrgDocsAction(orgId);
  assert.ok(r.success && r.data, JSON.stringify(r));
  return r.data!.docs.find((d) => d.slug === slug);
};

test("decision 101: a new document starts as a Draft only admins see; publishing makes it the members' copy", async () => {
  const o = await org();
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, path, type, name, size) VALUES (${o.id}, '/Docs/syllabus.md', 'file', 'syllabus.md', 0) RETURNING id`;
  viewerId = o.admin;
  const linked = await projectDoc.linkWorkspaceDocAction(o.id, node!.id);
  assert.ok(linked.success, JSON.stringify(linked));
  assert.equal((await item(o.id, o.admin, linked.success ? linked.slug : ""))?.state, "draft");
  viewerId = o.a;
  const listed = await projectDoc.listWorkspaceDocsAction(o.id);
  assert.equal(listed.success && listed.docs.some((d) => d.id === (linked.success ? linked.id : "")), false, "members don't see drafts");
});

test("37.4: changes wait until published; members read the last published version; Publish records what changed", async () => {
  const o = await org();
  await addDoc(o.id, "rules", ["Lab rules v1", "Lab rules v2 draft"], {}, 0);
  assert.equal((await item(o.id, o.admin, "rules"))?.state, "changed");
  viewerId = o.a;
  const before = await projectDoc.readWorkspaceDocAction(o.id, "rules");
  assert.equal(before.success && before.data.version?.content, "Lab rules v1");
  const docId = (await item(o.id, o.admin, "rules"))!.id;
  viewerId = o.a;
  assert.equal((await docs.publishOrgDocAction(o.id, docId, { summary: "x", reread: false, notify: false })).success, false, "members can't");
  viewerId = o.admin;
  assert.equal((await docs.publishOrgDocAction(o.id, docId, { summary: "Fixed the dates", reread: false, notify: false })).success, true);
  assert.equal((await item(o.id, o.admin, "rules"))?.state, "published");
  viewerId = o.a;
  const after = await projectDoc.readWorkspaceDocAction(o.id, "rules");
  assert.equal(after.success && after.data.version?.content, "Lab rules v2 draft");
  const [latest] = await sql`SELECT change_summary FROM workspace_document_versions WHERE doc_id = ${docId} ORDER BY version_number DESC LIMIT 1`;
  assert.equal(latest!.change_summary, "Fixed the dates");
});

test("28.4, decision 58: required documents show Read by N of M to admins (members only), who hasn't read, and Remind", async () => {
  const o = await org();
  const docId = await addDoc(o.id, "safety", ["Read me first"], { required: true });
  await sql`INSERT INTO doc_opens (doc_id, user_id, version, opened_at) VALUES (${docId}, ${o.a}, 0, now())`;
  assert.deepEqual((await item(o.id, o.admin, "safety"))?.readers, { read: 1, total: 2 });
  assert.equal((await item(o.id, o.a, "safety"))?.readers, null, "members don't see counts");
  viewerId = o.admin;
  const unread = await docs.readUnreadDocPeopleAction(o.id, docId);
  assert.deepEqual(unread.success && unread.people.map((p) => p.id), [o.b]);
  assert.deepEqual(await docs.remindUnreadDocAction(o.id, docId), { success: true, reminded: 1, skipped: 0 });
  assert.deepEqual(await docs.remindUnreadDocAction(o.id, docId), { success: true, reminded: 0, skipped: 1 });
});

test("7.4, 17.6: an empty document never reaches visitors; Public needs a public organization; Template moves to Templates", async () => {
  const o = await org();
  await addDoc(o.id, "empty", ["   "]);
  await addDoc(o.id, "about", ["We meet on Fridays."]);
  viewerId = "";
  const visitor = await projectDoc.listWorkspaceDocsAction(o.id);
  assert.deepEqual(visitor.success && visitor.docs.map((d) => d.slug).sort(), ["about"]);
  const shut = await org("private");
  const docId = await addDoc(shut.id, "notes", ["Notes"]);
  viewerId = shut.admin;
  assert.deepEqual(await docs.updateOrgDocOptionsAction(shut.id, docId, { visibility: "public" }), { success: false, error: "CSE 3B is private, so its documents can’t be public." });
  assert.equal((await docs.updateOrgDocOptionsAction(shut.id, docId, { template: true })).success, true);
  assert.equal((await item(shut.id, shut.admin, "notes"))?.group, "templates");
});

test("28.4: Use this template lists the workspaces in the organization you can add documents to", async () => {
  const o = await org();
  const mine = await sql.begin((tx) => createProject(tx, o.a, { visibility: "org" }));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${mine}, ${o.a}, 'owner')`;
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Falcon' WHERE id = ${mine}`;
  const theirs = await sql.begin((tx) => createProject(tx, o.b, { visibility: "org" }));
  await sql`UPDATE workspaces SET parent_id = ${o.id}, title = 'Team Owl' WHERE id = ${theirs}`;
  viewerId = o.a;
  assert.deepEqual(await docs.readTemplateTargetsAction(o.id), { success: true, workspaces: [{ id: mine, title: "Team Falcon" }] });
});
