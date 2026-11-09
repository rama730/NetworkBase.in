import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// CLI report A11.1–A11.2, A1.13 item 5: the inbox from a token, marking read, and the events long-poll answering
// with new notifications and new file versions; an agent token never sees the inbox.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let inbox: typeof import("../../src/app/api/v1/inbox/route");
let read: typeof import("../../src/app/api/v1/inbox/read/route");
let events: typeof import("../../src/app/api/v1/events/route");
before(async () => {
  inbox = await loadAppModule(() => import("../../src/app/api/v1/inbox/route"));
  read = await loadAppModule(() => import("../../src/app/api/v1/inbox/read/route"));
  events = await loadAppModule(() => import("../../src/app/api/v1/events/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent", workspaceId?: string) {
  const t = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(t)}, ${t.slice(0, 11)}, 'laptop', '2.0.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Claude Code" : null}, ${workspaceId ?? null})`;
  return t;
}
const call = async (handler: (r: Request) => Promise<Response>, t: string, method: string, path: string, body?: unknown) => {
  headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { status: res.status, json: await res.json() };
};

test("inbox lists and marks read; events answer at once with what's new", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const other = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, userId));
  const t = await token(userId, "device");
  const since = new Date(Date.now() - 1000).toISOString();
  const [n] = await sql`INSERT INTO user_notifications (user_id, kind, title, dedupe_key) VALUES (${userId}, 'task_assigned', 'You were assigned #7', ${randomUUID()}) RETURNING id`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, name, path, type, current_version) VALUES (${ws}, 'plan.md', '/plan.md', 'file', 2) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, content_hash) VALUES (${node!.id}, 2, 'k', 3, 'text/markdown', ${other}, ${"a".repeat(64)})`;

  const list = await call(inbox.GET, t, "GET", "/api/v1/inbox");
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.ok(list.json.data.items.some((i: { id: string }) => i.id === n!.id));
  const started = Date.now();
  const got = await call(events.GET, t, "GET", `/api/v1/events?since=${encodeURIComponent(since)}&workspace=${ws}`);
  assert.ok(Date.now() - started < 5000, "answers as soon as something is there");
  assert.equal(got.json.data.notifications[0].title, "You were assigned #7");
  assert.deepEqual(got.json.data.files.map((f: { path: string; version: number; mine: boolean }) => [f.path, f.version, f.mine]), [["/plan.md", 2, false]]);
  assert.ok(Date.parse(got.json.data.cursor) >= Date.parse(since));

  const marked = await call(read.POST, t, "POST", "/api/v1/inbox/read", { all: true });
  assert.equal(marked.json.data.read >= 1, true);
  assert.notEqual((await sql`SELECT read_at FROM user_notifications WHERE id = ${n!.id}`)[0]!.read_at, null);

  const agent = await token(userId, "agent", ws);
  assert.equal((await call(inbox.GET, agent, "GET", "/api/v1/inbox")).status, 403, "agents never read the inbox");
  const otherWs = await sql.begin((tx) => createProject(tx, userId));
  assert.equal((await call(events.GET, agent, "GET", `/api/v1/events?since=${encodeURIComponent(since)}&workspace=${otherWs}`)).status, 403);
});
