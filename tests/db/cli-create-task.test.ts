import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C2 ("task create takes everything at once") and C16 #3 ("your tasks are yours").
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
let createTask: typeof import("../../src/app/api/v1/extension/create-task/route");
before(async () => { createTask = await loadAppModule(() => import("../../src/app/api/v1/extension/create-task/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function device(userId: string) {
  const token = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.1.0', now() + interval '30 days', 'device')`;
  return token;
}
async function create(token: string, body: Record<string, unknown>) {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": "/api/v1/extension/create-task" };
  const res = await createTask.POST(new Request("https://app.test/api/v1/extension/create-task", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

test("a task you create is yours unless you say otherwise", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  // Real workspaces list their owner as a member (lifecycle createWorkspace); the helper doesn't.
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner}, 'owner')`;
  const made = await create(await device(owner), { projectId: ws, title: "Fix the footer" });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const [row] = await sql`SELECT assignee_id FROM tasks WHERE workspace_id = ${ws} AND title = 'Fix the footer'`;
  assert.equal(row!.assignee_id, owner);
  await create(await device(owner), { projectId: ws, title: "Nobody's yet", assigneeId: null });
  const [none] = await sql`SELECT assignee_id FROM tasks WHERE workspace_id = ${ws} AND title = 'Nobody''s yet'`;
  assert.equal(none!.assignee_id, null, "assigneeId: null leaves it unassigned");
});

test("create takes a due date, an assignee and a sprint at once", async () => {
  const [owner, sam] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${owner!}, 'owner'), (${ws}, ${sam!}, 'member')`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date, status, creator_id) VALUES (${ws}, 'Sprint 1', now(), now() + interval '14 days', 'active', ${owner!}) RETURNING id`;
  const made = await create(await device(owner!), { projectId: ws, title: "Logo", dueDate: "2026-12-01", assigneeId: sam, sprintId: sprint!.id });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const [row] = await sql`SELECT assignee_id, sprint_id, due_date FROM tasks WHERE workspace_id = ${ws} AND title = 'Logo'`;
  assert.equal(row!.assignee_id, sam);
  assert.equal(row!.sprint_id, sprint!.id);
  assert.equal(new Date(row!.due_date).toISOString().slice(0, 10), "2026-12-01");
});
