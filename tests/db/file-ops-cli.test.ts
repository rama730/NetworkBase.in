import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C3 (M4b): nb file trash, nb file restore and nb file mkdir with a CLI token, through the Files tab's actions.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let trash: typeof import("../../src/app/api/v1/workspaces/[id]/files/trash/route");
let op: typeof import("../../src/app/api/v1/extension/file-operation/route");
before(async () => {
  trash = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/files/trash/route"));
  op = await loadAppModule(() => import("../../src/app/api/v1/extension/file-operation/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function world() {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, deleted_at, deleted_by) VALUES (${ws}, 'file', 'old.md', '/old.md', ${owner}, now() - interval '3 days', ${owner}) RETURNING id`;
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${owner}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  return { ws, nodeId: node!.id as string, raw };
}
const as = (raw: string, method: string, target: string) => { headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target }; };
async function operate(w: Awaited<ReturnType<typeof world>>, body: unknown) {
  as(w.raw, "POST", "/api/v1/extension/file-operation");
  const res = await op.POST(new Request("https://app.test/api/v1/extension/file-operation", { method: "POST", headers: { authorization: `Bearer ${w.raw}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

test("the Trash lists with days left; restore brings a file back; mkdir makes a folder", async () => {
  const w = await world();
  const target = `/api/v1/workspaces/${w.ws}/files/trash`;
  as(w.raw, "GET", target);
  const listed = await (await trash.GET(new Request(`https://app.test${target}`), { params: Promise.resolve({ id: w.ws }) })).json();
  assert.deepEqual(listed.data.items.map((i: { path: string; daysLeft: number }) => [i.path, i.daysLeft]), [["/old.md", 27]]);
  // `nb file trash <path or folder>` matches the path as well as the name (M4b live check).
  as(w.raw, "GET", target);
  const byPath = await (await trash.GET(new Request(`https://app.test${target}?q=${encodeURIComponent("/old.md")}`), { params: Promise.resolve({ id: w.ws }) })).json();
  assert.deepEqual(byPath.data.items.map((i: { path: string }) => i.path), ["/old.md"]);
  const restored = await operate(w, { kind: "restore", projectId: w.ws, nodeId: w.nodeId });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal((await sql`SELECT deleted_at FROM workspace_nodes WHERE id = ${w.nodeId}`)[0]!.deleted_at, null);
  const made = await operate(w, { kind: "mkdir", projectId: w.ws, parentId: null, name: "design" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.data.folder.path, "/design");
  assert.notEqual((await operate(w, { kind: "mkdir", projectId: w.ws, parentId: null, name: "design" })).status, 200, "the same name twice is refused");
});
