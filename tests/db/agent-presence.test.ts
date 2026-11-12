import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report D5, D17 (M4c): agents say they're working on a task; the task shows them, and a second agent hears about
// the first. Someone who can't read the task can't see or claim it.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
const broadcasts: unknown[] = [];
moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async (messages: unknown[]) => { broadcasts.push(...messages); return true; } });
let route: typeof import("../../src/app/api/v1/tasks/[taskId]/presence/route");
before(async () => { route = await loadAppModule(() => import("../../src/app/api/v1/tasks/[taskId]/presence/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, agentName: string | null, workspaceId?: string) {
  const raw = `nb_${agentName ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.4', now() + interval '1 day', ${agentName ? "agent" : "device"}, ${agentName}, ${workspaceId ?? null})`;
  return raw;
}
async function call(raw: string, taskId: string, method: "GET" | "POST", body?: unknown) {
  const target = `/api/v1/tasks/${taskId}/presence`;
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
  const res = await (method === "GET" ? route.GET : route.POST)(new Request(`https://app.test${target}`, { method, headers: { authorization: `Bearer ${raw}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ taskId }) });
  return { status: res.status, body: await res.json() };
}

test("two agents on one task: each is shown, the second hears about the first, arrivals are broadcast once", async () => {
  const [owner, stranger] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id) VALUES (${ws}, 'Parse the logs', 'in_progress', ${owner!}) RETURNING id`;
  const claude = await token(owner!, "Claude Code", ws);
  const codex = await token(owner!, "Codex", ws);
  assert.deepEqual((await call(claude, task!.id, "POST", { sessionId: "s-claude" })).body.data.others, []);
  assert.deepEqual((await call(codex, task!.id, "POST", { sessionId: "s-codex" })).body.data.others, ["Claude Code"], "the second agent is told about the first");
  await call(claude, task!.id, "POST", { sessionId: "s-claude" });
  const mine = await token(owner!, null);
  const seen = await call(mine, task!.id, "GET");
  assert.deepEqual(seen.body.data.agents.map((a: { agentName: string }) => a.agentName), ["Claude Code", "Codex"]);
  assert.equal(broadcasts.filter((b) => (b as { event: string }).event === "agent.presence").length, 2, "only arrivals are broadcast");
  assert.equal((await call(await token(stranger!, null), task!.id, "GET")).status, 403);
});
