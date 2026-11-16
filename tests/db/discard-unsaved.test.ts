import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report 0.8 #14 (M4d): a failed upload never leaves an empty file entry. Only entries the failed push made, still
// empty, go; an empty file someone made in the app, or one with a saved version, stays.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
let storageFails = false;

let place: typeof import("../../src/app/api/v1/files/place/route");
let discard: typeof import("../../src/lib/files/discard-unsaved");
before(async () => {
  const server = await loadAppModule(() => import("../../src/lib/supabase/server"));
  moduleStubs.set("@/lib/supabase/server", { ...server, createAdminClient: async () => ({ storage: { from: () => ({
    upload: async () => (storageFails ? { error: new Error("storage is down") } : { error: null }),
    createSignedUrl: async () => ({ data: null, error: new Error("not needed") }),
  }) } }) });
  place = await loadAppModule(() => import("../../src/app/api/v1/files/place/route"));
  discard = await loadAppModule(() => import("../../src/lib/files/discard-unsaved"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function deviceToken(userId: string) {
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.6', now() + interval '1 day', 'device')`;
  return raw;
}
async function push(token: string, body: unknown) {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": "/api/v1/files/place" };
  const res = await place.POST(new Request("https://app.test/api/v1/files/place", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const file = (path: string, text: string) => ({ path, contentHash: hash(text), size: text.length, mimeType: "text/markdown", contentBase64: Buffer.from(text).toString("base64") });

test("a push that fails at storage leaves no file entry behind; the same push works once storage is back", async () => {
  const me = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, me));
  const token = await deviceToken(me);
  storageFails = true;
  const failed = await push(token, { projectId: ws, message: "x", files: [file("/notes/today.md", "hello")] });
  storageFails = false;
  assert.notEqual(failed.status, 200, JSON.stringify(failed.json));
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_nodes WHERE workspace_id = ${ws} AND path = '/notes/today.md'`)[0]!.n, 0, "no empty file entry");
  const ok = await push(token, { projectId: ws, message: "x", files: [file("/notes/today.md", "hello")] });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await sql`SELECT count(*)::int AS n FROM workspace_nodes WHERE workspace_id = ${ws} AND path = '/notes/today.md'`)[0]!.n, 1);
});

test("only entries the same person's failed push made, still empty and not being uploaded, go (security review)", async () => {
  const me = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, me));
  const since = new Date();
  const [fresh] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size) VALUES (${ws}, 'file', 'a.md', '/a.md', ${me}, 0) RETURNING id`;
  const [appMade] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size, created_at) VALUES (${ws}, 'file', 'b.md', '/b.md', ${me}, 0, now() - interval '1 hour') RETURNING id`;
  const [saved] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size) VALUES (${ws}, 'file', 'c.md', '/c.md', ${me}, 5) RETURNING id`;
  const [other] = await Promise.all([sql.begin((tx) => createUser(tx))]);
  const [theirs] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size) VALUES (${ws}, 'file', 'd.md', '/d.md', ${other!}, 0) RETURNING id`;
  const [writing] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, size) VALUES (${ws}, 'file', 'e.md', '/e.md', ${me}, 0) RETURNING id`;
  await sql`INSERT INTO upload_intents (user_id, workspace_id, bucket, storage_key, scope, kind, expected_size, expected_mime_type, expires_at, metadata)
            VALUES (${me}, ${ws}, 'project-files', ${`k-${writing!.id}`}, 'workspace_file', 'file', 5, 'text/markdown', now() + interval '1 hour', ${sql.json({ nodeId: writing!.id })})`;
  assert.equal(await discard.discardUnsavedFileNodes([fresh!.id, appMade!.id, saved!.id, theirs!.id, writing!.id, "not-an-id"], since, { userId: me }), 1);
  const left = (await sql`SELECT path FROM workspace_nodes WHERE workspace_id = ${ws} ORDER BY path`).map((r) => r.path);
  assert.deepEqual(left, ["/b.md", "/c.md", "/d.md", "/e.md"], "app-made, saved, someone else's and still uploading stay");
});
