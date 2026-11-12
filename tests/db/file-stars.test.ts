import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C3 (0087): starred files live on the server, so `nb file star`, `nb file list --starred` and the Files tab
// agree; `nb file recent` lists the files you changed lately.
let headerValues: Record<string, string> = {};
let viewer = "";
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewer ? { id: viewer } : null }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
let star: typeof import("../../src/app/api/v1/workspaces/[id]/files/[nodeId]/star/route");
let mine: typeof import("../../src/app/api/v1/workspaces/[id]/files/mine/route");
let actions: typeof import("../../src/app/actions/files/stars");
before(async () => {
  star = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/files/[nodeId]/star/route"));
  mine = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/files/mine/route"));
  actions = await loadAppModule(() => import("../../src/app/actions/files/stars"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function world() {
  const [owner, outsider] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  const nodes: string[] = [];
  for (const name of ["a.md", "b.md"]) nodes.push((await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', ${name}, ${"/" + name}, ${owner!}) RETURNING id`)[0]!.id as string);
  await sql`INSERT INTO workspace_node_events (workspace_id, node_id, actor_id, type, metadata) VALUES (${ws}, ${nodes[1]!}, ${owner!}, 'file_updated', '{}'::jsonb)`;
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${owner!}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  return { ws, nodes, owner: owner!, outsider: outsider!, raw };
}
const as = (raw: string, method: string, target: string) => { headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target }; };

test("a star from the CLI shows in the Files tab, and the other way round; recent lists what you changed", async () => {
  const w = await world();
  const target = `/api/v1/workspaces/${w.ws}/files/${w.nodes[0]}/star`;
  as(w.raw, "PUT", target);
  const res = await star.PUT(new Request(`https://app.test${target}`, { method: "PUT", headers: { authorization: `Bearer ${w.raw}`, "content-type": "application/json" }, body: JSON.stringify({ starred: true }) }), { params: Promise.resolve({ id: w.ws, nodeId: w.nodes[0]! }) });
  assert.equal(res.status, 200, await res.text());
  viewer = w.owner;
  assert.deepEqual(await actions.listMyNodeStarsAction(w.ws), [w.nodes[0]], "the Files tab sees the CLI's star");
  assert.deepEqual((await actions.setNodeStarsAction(w.ws, [w.nodes[1]!, randomUUID()], true)).ids, [w.nodes[1]], "a file not in the workspace is skipped");
  const list = async (kind: string) => {
    const t = `/api/v1/workspaces/${w.ws}/files/mine?kind=${kind}`;
    as(w.raw, "GET", t);
    return ((await (await mine.GET(new Request(`https://app.test${t}`), { params: Promise.resolve({ id: w.ws }) })).json()).data.files as Array<{ path: string }>).map((f) => f.path);
  };
  assert.deepEqual(await list("starred"), ["/a.md", "/b.md"], "the browser's star reaches the CLI; an unknown id is skipped");
  assert.deepEqual(await list("recent"), ["/b.md"]);
  viewer = w.outsider;
  assert.deepEqual(await actions.listMyNodeStarsAction(w.ws), [], "stars are personal");
});
