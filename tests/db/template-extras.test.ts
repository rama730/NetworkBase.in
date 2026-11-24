import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A6.36 (report 38.15 call 7): a document remembers its template (Class notes start members-only); its
// tools make tasks once per item, bugs and roadmap items only where those workflows are added, review tasks for members;
// none of them shows as a live list of the document.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.176" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let docs: typeof import("../../src/app/actions/workspace/doc");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  docs = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, member, viewer, outsider] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  await sql`UPDATE workspaces SET workflows_enabled = true WHERE id = ${ws}`;
  for (const slug of ["spec", "notes"]) {
    const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename) VALUES (${ws}, ${slug}, ${`${slug}.md`}) RETURNING id`;
    const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${ws}, ${doc!.id}, 1, '# Tech spec – SSO', ${`${ws}-${slug}`}) RETURNING id`;
    await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc!.id}`;
  }
  return { owner: owner!, member: member!, viewer: viewer!, outsider: outsider!, ws };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");
const settingsOf = async (ws: string, slug: string) => (await sql`SELECT settings FROM workspace_documents WHERE workspace_id = ${ws} AND slug = ${slug}`)[0]!.settings;

test("the template is remembered once; Class notes start members-only", async () => {
  const t = await workspace();
  viewerId = t.owner;
  assert.equal((await docs.setDocTemplateAction(t.ws, { docSlug: "notes", template: "class-notes" })).success, true);
  const s = await settingsOf(t.ws, "notes");
  assert.deepEqual([s.kind, s.visibilityOverride], ["class-notes", "members_only"]);
  await docs.setDocTemplateAction(t.ws, { docSlug: "notes", template: "prd" });
  assert.equal((await settingsOf(t.ws, "notes")).kind, "class-notes", "set once");
  assert.equal((await docs.setDocTemplateAction(t.ws, { docSlug: "spec", template: "nope" })).success, false);
});

test("tools make each item once, linked to the document, never a live list of its own", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const one = await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "stories", items: [{ title: "As a teacher I sign in once" }, { title: "As a student I see my class" }] });
  assert.deepEqual(one, { success: true, made: 2 });
  assert.deepEqual(await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "stories", items: [{ title: "as a TEACHER i sign in once" }] }), { success: true, made: 0 });
  const keys = await docs.readDocRowKeysAction(t.ws, "spec");
  assert.deepEqual(keys.success && keys.keys, [], "tpl_ blocks aren't lists");
  assert.match(errorOf(await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "bugs", items: [{ title: "SSO fails" }] })), /Add Bugs first/);
  assert.match(errorOf(await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "roadmap", items: [{ title: "SSO" }] })), /Add Roadmap first/);
  await sql`INSERT INTO workspace_workflows (workspace_id, workflow) VALUES (${t.ws}, 'bugs')`;
  assert.equal((await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "bugs", items: [{ title: "SSO fails", steps: "Open, pick SSO", expected: "Signed in" }] })).success, true);
  const [bug] = await sql`SELECT item_type, stage, type_fields, source_block FROM tasks WHERE workspace_id = ${t.ws} AND title = 'SSO fails'`;
  assert.deepEqual([bug!.item_type, bug!.stage, bug!.type_fields.expected, bug!.source_block], ["bug", "new", "Signed in", "tpl_bugs"]);
  viewerId = t.viewer;
  assert.match(errorOf(await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "stories", items: [{ title: "x" }] })), /Only people who can edit/);
});

test("Request review: one task per member reviewer; approved when all are done; outsiders see no tools", async () => {
  const t = await workspace();
  viewerId = t.owner;
  assert.match(errorOf(await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "review", items: [{ title: "Review: SSO", assigneeId: t.outsider }] })), /in this workspace/);
  assert.equal((await docs.makeDocTasksAction(t.ws, { docSlug: "spec", kind: "review", items: [{ title: "Review: SSO", assigneeId: t.member }, { title: "Review: SSO", assigneeId: t.owner }] })).success, true);
  let tools = await docs.readTemplateToolsAction(t.ws, "spec");
  assert.deepEqual(tools.success && tools.review, { state: "in_review", done: 0, total: 2 });
  assert.ok(tools.success && tools.people.some((p) => p.id === t.member) && !tools.people.some((p) => p.id === t.viewer), "viewers aren't offered as reviewers");
  await sql`UPDATE tasks SET status = 'done' WHERE workspace_id = ${t.ws} AND source_block = 'tpl_review'`;
  tools = await docs.readTemplateToolsAction(t.ws, "spec");
  assert.equal(tools.success && tools.review.state, "approved");
  viewerId = t.outsider;
  assert.equal((await docs.readTemplateToolsAction(t.ws, "spec")).success, false);
});
