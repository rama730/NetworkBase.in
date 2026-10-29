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
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.15" }) });

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
  for (const id of created.reverse()) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function orgWithChild() {
  const [owner, admin, member, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const org = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${org}, ${owner!}, 'owner'), (${org}, ${admin!}, 'admin'), (${org}, ${member!}, 'member')`;
  await sql`UPDATE projects SET kind = 'organization', org_type = 'education', join_code = ${generateJoinCode()}, title = 'CSE-3A' WHERE id = ${org}`;
  const child = await sql.begin((tx) => createProject(tx, member!, { visibility: "org" }));
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${child}, ${member!}, 'owner'), (${child}, ${outsider!}, 'member')`;
  await sql`UPDATE projects SET parent_id = ${org}, title = 'Compiler Lab' WHERE id = ${child}`;
  created.push(org, child);
  return { org, child, owner: owner!, admin: admin!, member: member!, outsider: outsider! };
}

/** A published, version-backed doc (no file needed). */
async function addDoc(projectId: string, slug: string, content: string, org: Record<string, unknown> = {}) {
  const [doc] = await sql`INSERT INTO project_docs (project_id, slug, filename, settings)
    VALUES (${projectId}, ${slug}, ${`${slug}.md`}, ${sql.json({ version: 1, editPolicy: "leaders", visibilityOverride: "inherit_project", externalImages: false, projectBlocks: true, org })}) RETURNING id`;
  const [version] = await sql`INSERT INTO project_doc_versions (project_id, doc_id, version_number, content, content_hash)
    VALUES (${projectId}, ${doc!.id}, 1, ${content}, ${slug}) RETURNING id`;
  await sql`UPDATE project_docs SET published_version_id = ${version!.id} WHERE id = ${doc!.id}`;
  return doc!.id as string;
}

async function list(projectId: string, as: string) {
  viewerId = as;
  const result = await docs.readOrgDocsAction(projectId);
  assert.equal(result.success, true, JSON.stringify(result));
  return result.success ? result.data : null;
}

test("required docs are New until opened; Ask members to re-read makes them New again; members can't change options", async () => {
  const o = await orgWithChild();
  const id = await addDoc(o.org, "grading-policy", "# Grading policy");
  viewerId = o.member;
  assert.equal((await docs.updateOrgDocOptionsAction(o.org, id, { required: true })).success, false);
  viewerId = o.admin;
  assert.equal((await docs.updateOrgDocOptionsAction(o.org, id, { required: true, group: "guides" })).success, true);

  const before = await list(o.org, o.member);
  const row = before!.docs.find((d) => d.id === id)!;
  assert.deepEqual([row.group, row.required, row.label], ["guides", true, "new"]);
  assert.equal((await docs.markDocOpenedAction(o.org, "grading-policy")).success, true);
  assert.equal((await list(o.org, o.member))!.docs.find((d) => d.id === id)!.label, null);

  viewerId = o.admin;
  assert.equal((await docs.publishOrgDocAction(o.org, id, { summary: "Late work now −10%", reread: true, notify: true })).success, true);
  assert.equal((await list(o.org, o.member))!.docs.find((d) => d.id === id)!.label, "new");
  const [note] = await sql`SELECT title, body FROM user_notifications WHERE user_id = ${o.member} AND entity_refs->>'projectId' = ${o.org} ORDER BY created_at DESC LIMIT 1`;
  assert.equal(note?.body, "Late work now −10%");
});

test("child projects see org docs marked Show in every workspace in the organization; outside people don't", async () => {
  const o = await orgWithChild();
  await addDoc(o.org, "syllabus", "# Syllabus");
  const hidden = await addDoc(o.org, "admin-notes", "# Notes");
  viewerId = o.admin;
  await docs.updateOrgDocOptionsAction(o.org, hidden, { showInChildren: false });
  const fromOrg = await list(o.child, o.member);
  assert.equal(fromOrg!.mode, "child");
  assert.equal(fromOrg!.orgTitle, "CSE-3A");
  assert.deepEqual(fromOrg!.docs.map((d) => d.slug), ["syllabus"]);
  assert.equal(await list(o.child, o.outsider), null, "no From org section for outside people");
});

test("Use this template copies a filled template into the child project; only templates, only for people who can add docs", async () => {
  const o = await orgWithChild();
  const tpl = await addDoc(o.org, "lab-report", "# Lab report: {{project}}\nDate: {{date}}", { template: true });
  const plain = await addDoc(o.org, "syllabus", "# Syllabus");
  viewerId = o.member;
  const copy = await docs.readOrgTemplateCopyAction(o.child, tpl);
  assert.equal(copy.success, true, JSON.stringify(copy));
  if (copy.success) {
    assert.match(copy.content, /^# Lab report: Compiler Lab\nDate: \w{3} \d{1,2}$/);
    assert.match(copy.filename, /^lab-report Compiler Lab — \w{3} \d{1,2}\.md$/);
  }
  assert.equal((await docs.readOrgTemplateCopyAction(o.child, plain)).success, false, "not a template");
  viewerId = o.outsider;
  assert.equal((await docs.readOrgTemplateCopyAction(o.child, tpl)).success, false, "outside people get no org templates");
});

test("doc groups: admins rename and reorder; docs keep their group; members can't", async () => {
  const o = await orgWithChild();
  const id = await addDoc(o.org, "co1-notes", "# CO1", { group: "notes" });
  viewerId = o.member;
  assert.equal((await docs.saveOrgDocGroupsAction(o.org, [{ id: "notes", name: "Week notes" }])).success, false);
  viewerId = o.admin;
  assert.equal((await docs.saveOrgDocGroupsAction(o.org, [{ id: "notes", name: "Week notes" }, { id: "start", name: "Start here" }])).success, true);
  const data = await list(o.org, o.member);
  assert.deepEqual(data!.groups.map((g) => g.name), ["Week notes", "Start here"]);
  assert.equal(data!.docs.find((d) => d.id === id)!.group, "notes");
  assert.equal((await docs.saveOrgDocGroupsAction(o.org, Array.from({ length: 21 }, (_, i) => ({ id: `g${i}`, name: `G${i}` })))).success, false, "20 groups at most");
});

test("New doc and template copies land in one top-level Docs folder", async () => {
  const o = await orgWithChild();
  viewerId = o.admin;
  const first = await docs.ensureDocsFolderAction(o.org);
  assert.equal(first.success, true, JSON.stringify(first));
  const second = await docs.ensureDocsFolderAction(o.org);
  assert.deepEqual(second, first);
});

test("the Projects smart block lists the org's child projects, never Private ones", async () => {
  const o = await orgWithChild();
  await addDoc(o.org, "course-welcome", "# Welcome\n{% project.projects %}");
  const hidden = await sql.begin((tx) => createProject(tx, o.owner, { visibility: "private" }));
  await sql`UPDATE projects SET parent_id = ${o.org}, title = 'Secret Lab' WHERE id = ${hidden}`;
  created.push(hidden);
  viewerId = o.member;
  const result = await projectDoc.readWorkspaceDocSmartBlockPreviewsAction(o.org, [{ kind: "projects", ids: [], index: 0 }]);
  assert.equal(result.success, true, JSON.stringify(result));
  if (result.success) assert.deepEqual(result.previews[0]!.items.map((i) => i.title), ["Compiler Lab"]);

  // A visitor on a public org with no README: the doc being read decides access, and only public projects show.
  await sql`UPDATE projects SET visibility = 'public', status = 'active' WHERE id = ${o.org}`;
  await sql`UPDATE project_docs SET settings = settings || '{"visibilityOverride": "public"}'::jsonb WHERE project_id = ${o.org}`;
  viewerId = "";
  const visitor = await projectDoc.readWorkspaceDocSmartBlockPreviewsAction(o.org, [{ kind: "projects", ids: [], index: 0 }], "course-welcome");
  assert.equal(visitor.success, true, JSON.stringify(visitor));
  if (visitor.success) assert.deepEqual(visitor.previews[0]!.items, [], "Organization projects stay hidden from visitors");
});

test("§19 pass: inherited org admins edit child docs; Linked sprint gives the sprint chip and joins its Materials", async () => {
  const o = await orgWithChild();
  await addDoc(o.child, "readme", "# Compiler Lab");
  viewerId = o.admin;
  const asAdmin = await projectDoc.readWorkspaceDocAction(o.child, "readme");
  assert.ok(asAdmin.success && asAdmin.data.canEdit, "inherited admin can edit");
  viewerId = o.outsider;
  const asOutsider = await projectDoc.readWorkspaceDocAction(o.child, "readme");
  assert.ok(asOutsider.success && !asOutsider.data.canEdit, "a plain member stays read-only");

  const id = await addDoc(o.org, "co1-notes", "# CO1 notes");
  const [s] = await sql`INSERT INTO project_sprints (project_id, sprint_number, name, status, start_date, end_date) VALUES (${o.org}, 1, 'CO1', 'planning', now(), now() + interval '14 days') RETURNING id`;
  const data = await list(o.org, o.admin);
  assert.deepEqual(data!.sprints.map((x) => x.name), ["CO1"]);
  viewerId = o.admin;
  assert.ok((await docs.updateOrgDocOptionsAction(o.org, id, { sprintId: s!.id })).success);
  assert.equal((await list(o.org, o.member))!.docs.find((d) => d.id === id)!.sprint, "CO1");
  assert.equal((await sql`SELECT count(*)::int AS n FROM sprint_materials WHERE doc_id = ${id}`)[0]!.n, 1);
  viewerId = o.admin;
  assert.ok((await docs.updateOrgDocOptionsAction(o.org, id, { sprintId: null })).success);
  assert.equal((await list(o.org, o.member))!.docs.find((d) => d.id === id)!.sprint, null);
});
