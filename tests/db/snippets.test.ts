import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A6.35 (report 21.4, 38.15 W5, W6): a snippet is a document filed with a language; only with Snippets on,
// only by its editors; the list and the code follow document permissions.

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.175" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
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
  const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename) VALUES (${ws}, 'retry', 'Retry with backoff.md') RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${ws}, ${doc!.id}, 1, ${"# Retry with backoff\n\n```typescript\nawait retry(fn);\n```\n"}, ${`${ws}-retry`}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc!.id}`;
  return { owner: owner!, viewer: viewer!, outsider: outsider!, ws };
}
const errorOf = (r: { success: boolean; error?: string }) => (r.success ? "" : r.error ?? "");

test("Snippets must be on; editors file a snippet; the list and Copy read it", async () => {
  const t = await workspace();
  viewerId = t.owner;
  const input = { docSlug: "retry", language: "TypeScript", tags: [" Network ", "network", "util"], purpose: "Retries with backoff" };
  assert.match(errorOf(await docs.createSnippetAction(t.ws, input)), /Switch Snippets on/);
  await docs.setDocsSettingsAction(t.ws, { snippetsEnabled: true });
  viewerId = t.viewer;
  assert.match(errorOf(await docs.createSnippetAction(t.ws, input)), /Only people who can edit/);
  viewerId = t.owner;
  assert.match(errorOf(await docs.createSnippetAction(t.ws, { ...input, language: "Cobol" })), /Pick a language/);
  assert.equal((await docs.createSnippetAction(t.ws, input)).success, true);
  assert.match(errorOf(await docs.createSnippetAction(t.ws, input)), /already filed/);
  const list = await docs.readSnippetsAction(t.ws);
  assert.deepEqual(list.success && list.snippets, [{ slug: "retry", name: "Retry with backoff", language: "TypeScript", tags: ["network", "util"], purpose: "Retries with backoff" }]);
  const code = await docs.readSnippetCodeAction(t.ws, "retry");
  assert.deepEqual(code, { success: true, code: "await retry(fn);" });
});

test("outsiders see snippets only as the document rules allow", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await docs.setDocsSettingsAction(t.ws, { snippetsEnabled: true, siteEnabled: true });
  await docs.createSnippetAction(t.ws, { docSlug: "retry", language: "SQL" });
  viewerId = t.outsider;
  const hidden = await docs.readSnippetsAction(t.ws);
  assert.deepEqual(hidden.success && hidden.snippets, [], "with the Docs site on, a snippet off the site stays inside");
  assert.equal((await docs.readSnippetCodeAction(t.ws, "retry")).success, false);
  viewerId = t.owner;
  await docs.setDocsSiteAction(t.ws, { docSlug: "retry", on: true });
  viewerId = t.outsider;
  const shown = await docs.readSnippetsAction(t.ws);
  assert.equal(shown.success && shown.snippets.length, 1);
});
