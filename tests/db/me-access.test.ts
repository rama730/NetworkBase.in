import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A6 #1, #5: /api/v1/me gives an agent the same sentence the person approved; the MCP card and nb whoami use it.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
let me: typeof import("../../src/app/api/v1/me/route");
before(async () => { me = await loadAppModule(() => import("../../src/app/api/v1/me/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, type: "agent" | "device", workspaceId: string | null, scopes: string[]) {
  const raw = `${type === "agent" ? "nb_agt_" : "nb_dev_"}${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, all_workspaces, scopes)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.0.4', now() + interval '30 days', ${type}, ${type === "agent" ? "Claude Code" : null}, ${workspaceId}, ${type === "agent" && !workspaceId}, ${sql.json(scopes)})`;
  return raw;
}
async function get(raw: string) {
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": "/api/v1/me" };
  const res = await me.GET(new Request("https://app.test/api/v1/me"));
  return (await res.json()).data;
}

test("an agent reads where, what and how long in the approval page's words", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));
  const [{ title }] = await sql`SELECT title FROM workspaces WHERE id = ${workspaceId}`;
  const read = await get(await token(userId, "agent", workspaceId, ["workspace:read", "task:read", "file:read"]));
  assert.equal(read.access.preset, "read");
  assert.equal(read.access.workspaceId, workspaceId);
  assert.equal(read.access.sentence, `Claude Code can read ${title} for 30 days. It can't change anything.`);
  const all = await get(await token(userId, "agent", null, ["workspace:read", "task:read", "task:write", "file:read", "file:write", "task:complete", "file:final", "doc:write"]));
  assert.equal(all.access.preset, "full");
  assert.equal(all.access.allWorkspaces, true);
  assert.match(all.access.sentence, /^Claude Code can work in all your workspaces for 30 days\./);
});

test("a person's own terminal has no agent card", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  assert.equal((await get(await token(userId, "device", null, []))).access, null);
});
