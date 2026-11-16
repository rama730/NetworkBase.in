import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report 0.8 #15 (M4d): Edit on a starter README (no file yet) attaches the new file to that same doc, as the CLI's
// first save does; never a second doc, never for someone who can't edit it, never over a file it already has.
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

let doc: typeof import("../../src/app/actions/workspace/doc");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerProfileContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: null }),
  });
  doc = await loadAppModule(() => import("../../src/app/actions/workspace/doc"));
});
after(async () => { await sql.end(); await closeAppDb(); });

test("Edit on a starter README attaches the new file to the same doc, once, and only for editors", async () => {
  const [owner, viewer] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => { await addMember(tx, ws, owner!, "owner"); await addMember(tx, ws, viewer!, "viewer"); });
  const [readme] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename, settings) VALUES (${ws}, 'readme', 'README.md', '{}'::jsonb) RETURNING id`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size) VALUES (${ws}, 'file', 'README.md', '/README.md', ${owner!}, 10) RETURNING id`;

  viewerId = viewer!;
  const refused = await doc.attachWorkspaceDocFileAction(ws, "readme", node!.id);
  assert.equal(refused.success, false, "a viewer can't");

  viewerId = owner!;
  const attached = await doc.attachWorkspaceDocFileAction(ws, "readme", node!.id);
  assert.equal(attached.success, true, JSON.stringify(attached));
  const rows = await sql`SELECT slug, linked_node_id FROM workspace_documents WHERE workspace_id = ${ws}`;
  assert.deepEqual(rows.map((r) => [r.slug, r.linked_node_id]), [["readme", node!.id]], "the same doc, not readme-2");
  assert.equal(attached.success && attached.id, readme!.id);

  const [other] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size) VALUES (${ws}, 'file', 'NEW.md', '/NEW.md', ${owner!}, 10) RETURNING id`;
  const again = await doc.attachWorkspaceDocFileAction(ws, "readme", other!.id);
  assert.equal(again.success, false, "it already has a file");
  assert.equal((await sql`SELECT linked_node_id FROM workspace_documents WHERE id = ${readme!.id}`)[0]!.linked_node_id, node!.id);
});
