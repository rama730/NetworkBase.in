import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A6.34 (report 38.15 W3, W4, call 5): with the Docs site on, outsiders read only documents switched onto it
// (drafts never leak); members still read everything; owners/admins switch the site, document editors switch documents.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.174" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
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
  const [owner, viewer, outsider] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public", publicTabVisibility: { readme: true } }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${viewer!}, 'viewer')`;
  for (const name of ["Guide", "Notes"]) {
    const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename) VALUES (${ws}, ${name.toLowerCase()}, ${`${name}.md`}) RETURNING id`;
    const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${ws}, ${doc!.id}, 1, ${`# ${name}\n\nText.`}, ${`${ws}-${name}`}) RETURNING id`;
    await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc!.id}`;
  }
  return { owner: owner!, viewer: viewer!, outsider: outsider!, ws };
}
const slugs = async (ws: string) => { const r = await docs.listWorkspaceDocsAction(ws); return r.success ? r.docs.map((d) => d.slug).sort() : [r.error]; };
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("site on: outsiders see only switched-on documents; members see all", async () => {
  const t = await workspace();
  viewerId = t.outsider;
  assert.deepEqual(await slugs(t.ws), ["guide", "notes"], "site off: public documents read as before");
  viewerId = t.owner;
  assert.equal((await docs.setDocsSettingsAction(t.ws, { siteEnabled: true })).success, true);
  viewerId = t.outsider;
  assert.deepEqual(await slugs(t.ws), [], "nothing is on the site yet");
  viewerId = t.owner;
  assert.equal((await docs.setDocsSiteAction(t.ws, { docSlug: "guide", on: true, order: 0 })).success, true);
  const list = await docs.listWorkspaceDocsAction(t.ws);
  assert.ok(list.success && list.docs.some((d) => d.slug === "guide" && d.docsSite === true && d.docsOrder === 0));
  viewerId = t.outsider;
  assert.deepEqual(await slugs(t.ws), ["guide"]);
  const notes = await docs.readWorkspaceDocAction(t.ws, "notes");
  assert.equal(!notes.success && notes.code, "NOT_FOUND", "a document off the site doesn't exist for visitors");
  const landing = await docs.readWorkspaceDocAction(t.ws, null);
  assert.equal(landing.success && landing.data.docSlug, "guide", "visitors land on the site’s document");
  viewerId = null as unknown as string;
  assert.deepEqual(await slugs(t.ws), ["guide"], "signed-out visitors too");
  viewerId = t.viewer;
  assert.deepEqual(await slugs(t.ws), ["guide", "notes"], "members read everything");
  viewerId = t.owner;
  await docs.setDocsSiteAction(t.ws, { docSlug: "guide", on: false });
  viewerId = t.outsider;
  assert.deepEqual(await slugs(t.ws), [], "taken off the site, gone at once (20.3 edge)");
});

test("only owners and admins switch the site; only document editors switch a document", async () => {
  const t = await workspace();
  viewerId = t.viewer;
  assert.match(errorOf(await docs.setDocsSettingsAction(t.ws, { siteEnabled: true })), /owners and admins/);
  const read = await docs.readDocsSettingsAction(t.ws);
  assert.deepEqual(read.success && [read.siteEnabled, read.canManage], [false, false]);
  assert.equal((await docs.setDocsSiteAction(t.ws, { docSlug: "guide", on: true })).success, false);
  viewerId = t.owner;
  await docs.setDocsSettingsAction(t.ws, { siteEnabled: true });
  await docs.setDocsSettingsAction(t.ws, { snippetsEnabled: true });
  const [row] = await sql`SELECT workflow_settings->'docs' AS d FROM workspaces WHERE id = ${t.ws}`;
  assert.deepEqual(row!.d, { siteEnabled: true, snippetsEnabled: true }, "patches merge");
});
