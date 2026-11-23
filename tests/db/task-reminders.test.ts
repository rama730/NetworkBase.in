import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C2 (0088): `nb task remind`. Reminders are your own, fire once through the chat due job, and say nothing
// about a task you can no longer see.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/inngest/wake", { wakeChatDueIfSoon: async () => undefined, wakePushIfNeeded: async () => undefined, wakeAt: async () => undefined, sendHint: async () => undefined });
let route: typeof import("../../src/app/api/v1/tasks/[taskId]/reminders/route");
let reminders: typeof import("../../src/lib/domain/task-reminders");
before(async () => {
  route = await loadAppModule(() => import("../../src/app/api/v1/tasks/[taskId]/reminders/route"));
  reminders = await loadAppModule(() => import("../../src/lib/domain/task-reminders"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function world() {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${member!}, 'member')`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id, task_number) VALUES (${ws}, 'Ship the footer', 'todo', ${owner!}, 7) RETURNING id`;
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${member!}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  return { ws, member: member!, taskId: task!.id as string, raw };
}
async function call(w: Awaited<ReturnType<typeof world>>, method: "GET" | "POST" | "DELETE", body?: unknown) {
  const target = `/api/v1/tasks/${w.taskId}/reminders`;
  headerValues = { authorization: `Bearer ${w.raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
  const handler = method === "GET" ? route.GET : method === "POST" ? route.POST : route.DELETE;
  const res = await handler(new Request(`https://app.test${target}`, { method, headers: { authorization: `Bearer ${w.raw}`, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ taskId: w.taskId }) });
  return { status: res.status, body: await res.json() };
}

test("a reminder is set, listed, fires once into the inbox, and a past time is refused", async () => {
  const w = await world();
  const set = await call(w, "POST", { at: new Date(Date.now() + 3600_000).toISOString(), note: "check the CI run" });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await call(w, "GET")).body.data.reminders.length, 1);
  assert.equal((await call(w, "POST", { at: new Date(Date.now() - 60_000).toISOString() })).status, 409);
  await sql`UPDATE task_reminders SET remind_at = now() - interval '1 second' WHERE task_id = ${w.taskId}`;
  await reminders.fireDueTaskReminders();
  await reminders.fireDueTaskReminders();
  const sent = await sql`SELECT title, body, kind FROM user_notifications WHERE user_id = ${w.member} AND kind = 'task_reminder'`;
  assert.deepEqual(sent.map((n) => [n.title, n.body]), [["Reminder: #7 Ship the footer", "check the CI run"]], "once");
  assert.equal((await call(w, "GET")).body.data.reminders.length, 0);
});

test("cancel removes what hasn't gone off; leaving the workspace closes a reminder quietly", async () => {
  const w = await world();
  await call(w, "POST", { at: new Date(Date.now() + 3600_000).toISOString() });
  assert.equal((await call(w, "DELETE")).body.data.cancelled, 1);
  await call(w, "POST", { at: new Date(Date.now() + 3600_000).toISOString() });
  await sql`UPDATE task_reminders SET remind_at = now() - interval '1 second' WHERE task_id = ${w.taskId}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${w.ws} AND user_id = ${w.member}`;
  await reminders.fireDueTaskReminders();
  assert.equal((await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${w.member} AND kind = 'task_reminder'`)[0]!.n, 0);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${w.taskId} AND sent_at IS NULL`)[0]!.n, 0, "closed, not retried forever");
});

test("security review (A2.5): a person's note can't look like a request's clock warning", async () => {
  const w = await world();
  const forged = await call(w, "POST", { at: new Date(Date.now() + 3600_000).toISOString(), note: "request_clock:first:breach" });
  assert.equal(forged.status, 400, JSON.stringify(forged.body));
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_reminders WHERE task_id = ${w.taskId}`)[0]!.n, 0);
});
