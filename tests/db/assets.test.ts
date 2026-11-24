import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Workflow tabs A7.1 (report 38.16 W1, W2, W6, W10): Assets lists media and marked files (not a task's files), details
// are saved by people who can change files, Used in finds tasks and documents, tags by path; outsiders see nothing.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.177" }), cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) });
stubNextAfter();

let assets: typeof import("../../src/app/actions/assets");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true }),
    getViewerIdentityContext: async () => ({ user: viewerId ? { id: viewerId } : null, userId: viewerId || null, profile: null }),
  });
  assets = await loadAppModule(() => import("../../src/app/actions/assets"));
});

const created: string[] = [];
after(async () => {
  for (const id of created.reverse()) await sql`DELETE FROM workspaces WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

async function workspace() {
  const [owner, viewer, outsider] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  created.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${viewer!}, 'viewer')`;
  const file = async (name: string, mime: string, extra: { metadata?: unknown; taskId?: string } = {}) =>
    (await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, mime_type, created_by, metadata, task_id) VALUES (${ws}, 'file', ${name}, ${`/brand/${name}`}, ${mime}, ${owner!}, ${sql.json((extra.metadata ?? {}) as never)}, ${extra.taskId ?? null}) RETURNING id`)[0]!.id as string;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, priority, creator_id) VALUES (${ws}, 'Launch post', 'todo', 'medium', ${owner!}) RETURNING id`;
  const logo = await file("Logo dark.svg", "image/svg+xml");
  const zip = await file("kit.zip", "application/zip");
  const marked = await file("brief.pdf", "application/pdf", { metadata: { asset: { type: "template", tags: ["brand"] } } });
  await file("screenshot.png", "image/png", { taskId: task!.id });
  return { owner: owner!, viewer: viewer!, outsider: outsider!, ws, logo, zip, marked, task: task!.id as string };
}

test("W1: media and marked files are assets; a task's files and other files aren't", async () => {
  const t = await workspace();
  viewerId = t.viewer;
  const r = await assets.readAssetsAction(t.ws);
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual(r.assets.map((a) => [a.name, a.type]).sort(), [["Logo dark.svg", "logo"], ["brief.pdf", "template"]]);
  assert.equal(r.canEdit, false);
  viewerId = t.outsider;
  assert.equal((await assets.readAssetsAction(t.ws)).success, false, "a private workspace's files stay inside");
});

test("W2: details are saved by people who can change files; null takes a marked file out; tags by path", async () => {
  const t = await workspace();
  viewerId = t.viewer;
  assert.equal((await assets.setAssetDetailsAction({ projectId: t.ws, nodeId: t.logo, details: { tags: ["brand"] } })).success, false);
  viewerId = t.owner;
  assert.equal((await assets.setAssetDetailsAction({ projectId: t.ws, nodeId: t.logo, details: { type: "logo", tags: ["brand"], productionStatus: "final", credit: "" } })).success, true);
  const [meta] = await sql`SELECT metadata FROM workspace_nodes WHERE id = ${t.logo}`;
  assert.deepEqual(meta!.metadata.asset, { type: "logo", tags: ["brand"], productionStatus: "final" }, "empty fields aren't stored");
  assert.equal((await assets.setAssetDetailsAction({ projectId: t.ws, nodeId: t.marked, details: null })).success, true);
  assert.equal((await assets.tagAssetByPathAction(t.ws, "brand/kit.zip", "press")).success, true);
  const r = await assets.readAssetsAction(t.ws);
  assert.deepEqual(r.success && r.assets.map((a) => a.name).sort(), ["Logo dark.svg", "kit.zip"], "kit.zip is an asset once tagged; brief.pdf left");
  assert.equal((await assets.tagAssetByPathAction(t.ws, "nope.png", "x")).success, false);
});

test("W2 Used in: tasks the file is attached to and documents that name it, each once", async () => {
  const t = await workspace();
  viewerId = t.owner;
  await sql`INSERT INTO task_node_links (task_id, node_id) VALUES (${t.task}, ${t.logo})`;
  const [doc] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename) VALUES (${t.ws}, 'brand-guide', 'Brand guide.md') RETURNING id`;
  const [v] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash) VALUES (${t.ws}, ${doc!.id}, 1, '# Brand guide

![Logo](/brand/Logo%20dark.svg)', ${`${t.ws}-bg`}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${v!.id} WHERE id = ${doc!.id}`;
  const r = await assets.readAssetUsedInAction(t.ws, t.logo);
  assert.ok(r.success, JSON.stringify(r));
  assert.deepEqual(r.usedIn.map((u) => [u.kind, u.label.replace(/^NB-\d+ /, "")]), [["task", "Launch post"], ["doc", "Brand guide"]]);
});
