import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report D16 (0089): an agent leaves a note where it stopped; the next session reads it with the task; the person
// (or the workspace's owner) deletes it. Someone who can't read the task can't read or write notes on it.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
let route: typeof import("../../src/app/api/v1/tasks/[taskId]/agent-notes/route");
before(async () => { route = await loadAppModule(() => import("../../src/app/api/v1/tasks/[taskId]/agent-notes/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent", workspaceId?: string) {
  const raw = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.4', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Codex" : null}, ${workspaceId ?? null})`;
  return raw;
}
async function call(raw: string, taskId: string, method: "GET" | "POST" | "DELETE", body?: unknown) {
  const target = `/api/v1/tasks/${taskId}/agent-notes`;
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
  const handler = method === "GET" ? route.GET : method === "POST" ? route.POST : route.DELETE;
  const res = await handler(new Request(`https://app.test${target}`, { method, headers: { authorization: `Bearer ${raw}`, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ taskId }) });
  return { status: res.status, body: await res.json() };
}

test("an agent saves where it stopped; the next session reads it; the person deletes it", async () => {
  const [owner, stranger] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "private" }));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id, task_number) VALUES (${ws}, 'Parse the logs', 'in_progress', ${owner!}, 3) RETURNING id`;
  const agent = await token(owner!, "agent", ws);
  const saved = await call(agent, task!.id, "POST", { note: "parsed 3 of 5 files; next: tests", sessionId: "s1" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.note.agentName, "Codex", "an agent sign-in names itself");
  const mine = await token(owner!, "device");
  const own = await call(mine, task!.id, "POST", { note: "second note", agentName: "Claude Code" });
  assert.equal(own.body.data.note.agentName, "Claude Code", "the person's own sign-in says which agent");
  const listed = await call(mine, task!.id, "GET");
  assert.deepEqual(listed.body.data.notes.map((n: { note: string }) => n.note), ["second note", "parsed 3 of 5 files; next: tests"], "newest first");
  const outsider = await call(await token(stranger!, "device"), task!.id, "GET");
  assert.equal(outsider.status, 403, "a private workspace's notes stay inside it");
  const gone = await call(mine, task!.id, "DELETE", { id: saved.body.data.note.id });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal((await call(mine, task!.id, "GET")).body.data.notes.length, 1);
  assert.equal((await call(agent, task!.id, "POST", { note: "" })).status, 400, "an empty note is refused");
});

test("a task keeps its newest 20 notes", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id) VALUES (${ws}, 'Long job', 'in_progress', ${owner}) RETURNING id`;
  const mine = await token(owner, "device");
  for (let i = 0; i < 23; i++) await call(mine, task!.id, "POST", { note: `step ${i}` });
  const notes = (await call(mine, task!.id, "GET")).body.data.notes;
  assert.equal(notes.length, 20);
  assert.equal(notes[0].note, "step 22");
});
