import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A7.11: whatever a token makes is labelled — "agent" with the agent's name, or "cli" — so the app can show
// "via Claude Code" on versions, tasks, comments and in activity.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let place: typeof import("../../src/app/api/v1/files/place/route");
let comments: typeof import("../../src/app/api/v1/extension/comments/route");
let createTask: typeof import("../../src/app/api/v1/extension/create-task/route");
before(async () => {
  const server = await loadAppModule(() => import("../../src/lib/supabase/server"));
  moduleStubs.set("@/lib/supabase/server", { ...server, createAdminClient: async () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) });
  place = await loadAppModule(() => import("../../src/app/api/v1/files/place/route"));
  comments = await loadAppModule(() => import("../../src/app/api/v1/extension/comments/route"));
  createTask = await loadAppModule(() => import("../../src/app/api/v1/extension/create-task/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function agentToken(userId: string, workspaceId: string) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.0', now() + interval '1 day', 'agent', 'Claude Code', ${workspaceId})`;
  return token;
}
async function patToken(userId: string) {
  const token = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes) VALUES (${userId}, 't', ${hash(token)}, ${token.slice(0, 12)}, ${sql.json(["repo:read", "repo:write", "task:write"])})`;
  return token;
}
const as = (token: string, method: string, target: string) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
};
const post = (url: string, body: unknown) => new Request(`https://app.test${url}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });

test("an agent's push, task and comment say via agent with its name; a CLI token's say cli", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const agent = await agentToken(userId, projectId);

  const text = "hello";
  as(agent, "POST", "/api/v1/files/place");
  const pushed = await place.POST(post("/api/v1/files/place", { projectId, message: "notes", files: [{ path: "/notes.md", contentHash: hash(text), size: text.length, mimeType: "text/markdown", contentBase64: Buffer.from(text).toString("base64") }] }));
  assert.equal(pushed.status, 200, JSON.stringify(await pushed.clone().json()));
  const [version] = await sql`SELECT fv.via, fv.agent_name FROM file_versions fv JOIN workspace_nodes n ON n.id = fv.node_id WHERE n.workspace_id = ${projectId}`;
  assert.deepEqual([version!.via, version!.agent_name], ["agent", "Claude Code"]);
  const [event] = await sql`SELECT metadata FROM workspace_node_events WHERE workspace_id = ${projectId} AND type = 'extension_file_saved' LIMIT 1`;
  assert.equal(event?.metadata?.via, "agent", "file history says it too");

  as(agent, "POST", "/api/v1/extension/create-task");
  const created = await createTask.POST(post("/api/v1/extension/create-task", { projectId, title: "Update the logo" }));
  const createdJson = await created.json();
  assert.equal(created.status, 200, JSON.stringify(createdJson));
  const [task] = await sql`SELECT id, via, agent_name FROM tasks WHERE workspace_id = ${projectId} AND title = 'Update the logo'`;
  assert.deepEqual([task!.via, task!.agent_name], ["agent", "Claude Code"]);

  as(await patToken(userId), "POST", "/api/v1/extension/comments");
  const commented = await comments.POST(post("/api/v1/extension/comments", { kind: "task", projectId, taskId: task!.id, text: "Looks good" }));
  assert.equal(commented.status, 200, JSON.stringify(await commented.clone().json()));
  const [comment] = await sql`SELECT via, agent_name FROM task_comments WHERE task_id = ${task!.id}`;
  assert.deepEqual([comment!.via, comment!.agent_name], ["cli", null]);
});
