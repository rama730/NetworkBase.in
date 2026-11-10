import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// A new workspace's starter README has no file behind it. Its first edit from the CLI or an agent creates
// README.md and links the doc to it (files/place with linkDoc), so the README can be changed outside the app.
let headerValues: Record<string, string> = {};
const uploaded = new Map<string, Buffer>();
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let doc: typeof import("../../src/app/api/v1/workspaces/[id]/docs/[slug]/route");
let place: typeof import("../../src/app/api/v1/files/place/route");
before(async () => {
  const server = await loadAppModule(() => import("../../src/lib/supabase/server"));
  moduleStubs.set("@/lib/supabase/server", {
    ...server,
    createAdminClient: async () => ({ storage: { from: () => ({ upload: async (key: string, body: Buffer) => { uploaded.set(key, body); return { error: null }; } }) } }),
  });
  doc = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/docs/[slug]/route"));
  place = await loadAppModule(() => import("../../src/app/api/v1/files/place/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function patFor(userId: string, scopes: string[]) {
  const token = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes)
            VALUES (${userId}, 'test', ${createHash("sha256").update(token).digest("hex")}, ${token.slice(0, 12)}, ${sql.json(scopes)})`;
  return token;
}
const as = (token: string, method: string, target: string) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
};
const text = "# Design Lab\n\nInstall: npm i -g @networkbase/cli\n";
const body = (projectId: string, extra: Record<string, unknown> = {}) => ({
  projectId, linkDoc: "readme",
  files: [{ path: "/README.md", contentHash: createHash("sha256").update(text).digest("hex"), size: Buffer.byteLength(text), mimeType: "text/markdown", contentBase64: Buffer.from(text).toString("base64") }],
  ...extra,
});
const post = async (payload: unknown) => {
  const res = await place.POST(new Request("https://app.test/api/v1/files/place", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(payload) }));
  return { status: res.status, json: await res.json() };
};

test("a starter README with no file: the first edit creates README.md and links it", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const starter = "# Design Lab\n";
  const [row] = await sql`INSERT INTO workspace_documents (workspace_id, slug, filename) VALUES (${projectId}, 'readme', 'README.md') RETURNING id`;
  const [version] = await sql`INSERT INTO workspace_document_versions (workspace_id, doc_id, version_number, content, content_hash, created_by)
    VALUES (${projectId}, ${row!.id}, 1, ${starter}, ${createHash("sha256").update(starter).digest("hex")}, ${userId}) RETURNING id`;
  await sql`UPDATE workspace_documents SET published_version_id = ${version!.id} WHERE id = ${row!.id}`;

  const token = await patFor(userId, ["file:read", "file:write", "workspace:read", "doc:write"]);
  as(token, "GET", `/api/v1/workspaces/${projectId}/docs/readme`);
  const before = await (await doc.GET(new Request(`https://app.test/api/v1/workspaces/${projectId}/docs/readme`), { params: Promise.resolve({ id: projectId, slug: "readme" }) })).json();
  assert.equal(before.success, true, JSON.stringify(before));
  assert.deepEqual([before.data.file, before.data.filename, before.data.canEdit, before.data.content], [null, "README.md", true, starter]);

  as(await patFor(userId, ["file:read", "file:write", "workspace:read"]), "POST", "/api/v1/files/place");
  const noScope = await post(body(projectId));
  assert.equal(noScope.status, 403, JSON.stringify(noScope.json));
  assert.equal(noScope.json.details.scope, "doc:write");

  as(token, "POST", "/api/v1/files/place");
  const saved = await post(body(projectId));
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const [linked] = await sql`SELECT d.linked_node_id, n.path FROM workspace_documents d JOIN workspace_nodes n ON n.id = d.linked_node_id WHERE d.id = ${row!.id}`;
  assert.equal(linked!.path, "/README.md");

  const again = await post(body(projectId));
  assert.equal(again.status, 409, "a doc that has a file takes new versions of it, never a second file");
});
