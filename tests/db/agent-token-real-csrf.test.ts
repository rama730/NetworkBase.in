import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Found by a production-mode build check (2026-11-10): agent tokens were refused by the CSRF guard on every write,
// and the session route ignored them. No CSRF stub here: the real guard runs.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

let session: typeof import("../../src/app/api/v1/extension/session/route");
let comments: typeof import("../../src/app/api/v1/extension/comments/route");
before(async () => {
  session = await loadAppModule(() => import("../../src/app/api/v1/extension/session/route"));
  comments = await loadAppModule(() => import("../../src/app/api/v1/extension/comments/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

test("an agent token writes without a browser CSRF token, and signing it out revokes it", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, userId));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${ws}, 'Logo', 'todo', ${userId}) RETURNING id`;
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  const [row] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
    VALUES (${userId}, ${createHash("sha256").update(token).digest("hex")}, ${token.slice(0, 11)}, 'cloud', '2.0.0', now() + interval '1 day', 'agent', 'Claude Code', ${ws}) RETURNING id`;
  const post = async (handler: (r: Request) => Promise<Response>, path: string, body: unknown) => {
    headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": path };
    const res = await handler(new Request(`https://app.test${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": randomUUID() }, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  const commented = await post(comments.POST, "/api/v1/extension/comments", { kind: "task", projectId: ws, taskId: task!.id, text: "Started on it" });
  assert.equal(commented.status, 200, JSON.stringify(commented.json));
  const out = await post(session.POST, "/api/v1/extension/session", {});
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.notEqual((await sql`SELECT revoked_at FROM extension_device_sessions WHERE id = ${row!.id}`)[0]!.revoked_at, null);
});
