import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// CLI report A7.1 item 2 (P6.1): the hosted MCP server answers initialize and tools/list over HTTP for an agent
// token, leaves out local-folder tools, and refuses other tokens.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let mcp: typeof import("../../src/app/api/mcp/route");
before(async () => { mcp = await loadAppModule(() => import("../../src/app/api/mcp/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent", workspaceId?: string) {
  const t = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(t)}, ${t.slice(0, 11)}, 'cloud', '2.0.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Cloud agent" : null}, ${workspaceId ?? null})`;
  return t;
}
const post = async (t: string, body: unknown, session?: string) => {
  headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": "/api/mcp" };
  const res = await mcp.POST(new Request("https://app.test/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}`, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify(body) }));
  return { status: res.status, session: res.headers.get("mcp-session-id"), json: res.status === 202 ? null : await res.json() };
};

test("an agent token gets initialize, a batch with tools/list, and 202 for notifications", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, userId));
  const agent = await token(userId, "agent", ws);
  const init = await post(agent, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(init.status, 200, JSON.stringify(init.json));
  assert.equal(init.json.result.protocolVersion, "2025-06-18");
  assert.ok(init.session);
  const batch = await post(agent, [{ jsonrpc: "2.0", id: 2, method: "tools/list" }, { jsonrpc: "2.0", id: 3, method: "ping" }], init.session!);
  const names = batch.json[0].result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes("networkbase_task_list") && names.includes("networkbase_task_create"));
  assert.ok(!names.includes("networkbase_file_push") && !names.includes("networkbase_undo"), "no local-folder tools");
  assert.deepEqual(batch.json[1], { jsonrpc: "2.0", id: 3, result: {} });
  const pushed = await post(agent, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "networkbase_file_push", arguments: { paths: ["a"], message: "x" } } });
  assert.equal(pushed.json.result.isError, true);
  assert.equal((await post(agent, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
});

test("device tokens are refused with how to get an agent sign-in", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const device = await token(userId, "device");
  const r = await post(device, { jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(r.status, 403);
  assert.match(r.json.message, /nb login --device --agent/);
});

test("no token: 401 with the OAuth hint, not the browser CSRF 403", async () => {
  const res = await mcp.POST(new Request("https://app.test/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
});
