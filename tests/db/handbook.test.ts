import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { generateJoinCode } from "../../src/lib/organizations/join-rules";
import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// B4.1 (report 33.2 calls 2–3): a company's Handbook sections; page owners and Review by; Needs review never hides a
// page; owners publish and mark Still correct; Settings → Handbook's review cycle.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.233" }) });

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
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'company', status = 'active', join_code = ${generateJoinCode()}, title = 'CSE 3B',
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
const today = new Date().toISOString().slice(0, 10);

test("33.2: a company starts with its Handbook sections; owners and Review by; owners publish and mark Still correct", async () => {
  const o = await org();
  const page = await addDoc(o.id, "travel-policy", ["# Travel policy\n\nBook early."], { lifecycle: "published", publishedAt: new Date().toISOString() });
  viewerId = o.admin;
  const data = await docs.readOrgDocsAction(o.id);
  assert.ok(data.success && data.data);
  assert.deepEqual(data.data.groups.map((g) => g.name), ["Overview", "How we work", "People", "Policies"]);
  assert.equal(data.data.docs[0]!.group, "overview");
  assert.equal(data.data.people.length, 4, "admins pick an owner from the organization");

  viewerId = o.a;
  assert.equal((await docs.saveHandbookSettingsAction(o.id, { reviewMonths: 6 })).success, false, "members don't change the cycle");
  viewerId = o.admin;
  assert.match((await docs.saveHandbookSettingsAction(o.id, { reviewMonths: 3 }) as { error: string }).error, /6 months, 12 months or off/);
  assert.equal((await docs.saveHandbookSettingsAction(o.id, { reviewMonths: 6 })).success, true);
  const [outsider] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  assert.match((await docs.updateOrgDocOptionsAction(o.id, page, { owner: outsider! }) as { error: string }).error, /someone in the organization/);
  assert.equal((await docs.updateOrgDocOptionsAction(o.id, page, { owner: o.a, reviewBy: "2020-01-01" })).success, true);

  const asMember = await item(o.id, o.b, "travel-policy");
  assert.deepEqual([asMember?.needsReview, asMember?.ownerName !== null, asMember?.ownerGone], [true, true, false], "late pages are marked, never hidden");
  assert.equal((await docs.readOrgDocsAction(o.id) as { data: { people: unknown[] } }).data.people.length, 0, "only admins get the people list");

  viewerId = o.b;
  assert.equal((await docs.markOrgDocStillCorrectAction(o.id, page)).success, false, "only its owner or an admin");
  assert.equal((await docs.publishOrgDocAction(o.id, page, { summary: "x", reread: false, notify: false })).success, false);
  viewerId = o.a;
  const still = await docs.markOrgDocStillCorrectAction(o.id, page);
  assert.ok(still.success);
  assert.ok(still.reviewBy && still.reviewBy > today);
  assert.equal((await item(o.id, o.a, "travel-policy"))?.needsReview, false);
  viewerId = o.a;
  assert.equal((await docs.publishOrgDocAction(o.id, page, { summary: "Clearer booking", reread: false, notify: false })).success, true, "the page's owner publishes it");
  const after6 = await item(o.id, o.admin, "travel-policy");
  const six = new Date(); six.setUTCMonth(six.getUTCMonth() + 6);
  assert.equal(after6?.reviewBy?.slice(0, 7), six.toISOString().slice(0, 7), "publishing restarts the 6-month cycle");

  // The owner leaves: admins see "No owner"; they can no longer publish it.
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${o.id} AND user_id = ${o.a}`;
  assert.equal((await item(o.id, o.admin, "travel-policy"))?.ownerGone, true);
  viewerId = o.a;
  assert.equal((await docs.markOrgDocStillCorrectAction(o.id, page)).success, false);
});

test("33.2 call 6: Run this process makes the runner a task with the published Steps; Viewers can't run it", async () => {
  const o = await org();
  const proc = await addDoc(o.id, "release-process", ["# Release process\n\n## Steps\n- [ ] Tag the build\n- [ ] Write notes\n- [ ] Ship it\n\n## References\n- [ ] not a step", "# Release process\n\n## Steps\n- [ ] Draft only"], { lifecycle: "published" }, 0);
  const empty = await addDoc(o.id, "no-steps", ["# Nothing to run"], { lifecycle: "published" });
  const [viewer] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${o.id}, ${viewer!}, 'viewer')`;
  viewerId = viewer!;
  assert.equal((await docs.runProcessAction(o.id, proc)).success, false, "Viewers read, they don't run");
  viewerId = o.a;
  assert.match((await docs.runProcessAction(o.id, empty) as { error: string }).error, /no Steps/);
  const run = await docs.runProcessAction(o.id, proc);
  assert.ok(run.success, JSON.stringify(run));
  assert.equal(run.steps, 3, "the published version's steps, not the newer draft's");
  const [task] = await sql`SELECT title, assignee_id, source_doc_id, workspace_id FROM tasks WHERE id = ${run.taskId}`;
  assert.deepEqual([task!.title, task!.assignee_id, task!.source_doc_id, task!.workspace_id], ["Run: release-process", o.a, proc, o.id]);
  const subs = await sql`SELECT title FROM task_subtasks WHERE task_id = ${run.taskId} ORDER BY position`;
  assert.deepEqual(subs.map((r) => r.title), ["Tag the build", "Write notes", "Ship it"]);
  const listed = await item(o.id, o.a, "release-process");
  assert.equal(listed?.kind ?? null, null, "kind comes from the template it started from");
});
