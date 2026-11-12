import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C2 "bulk changes": nb task move 3 4 5 done, nb task assign 3 4 --to sam, nb task edit 3 4 --due friday.
// One request each, all or nothing, one Undo.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let bulk: typeof import("../../src/app/api/v1/tasks/bulk/route");
let undo: typeof import("../../src/app/api/v1/undo/[id]/route");
before(async () => {
  bulk = await loadAppModule(() => import("../../src/app/api/v1/tasks/bulk/route"));
  undo = await loadAppModule(() => import("../../src/app/api/v1/undo/[id]/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

async function world() {
  const [owner, sam] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  const other = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${sam!}, 'member')`;
  const ids: string[] = [];
  for (const n of [1, 2, 3]) {
    const [t] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id, assignee_id, task_number) VALUES (${ws}, ${`Task ${n}`}, 'todo', ${owner!}, null, ${n}) RETURNING id`;
    ids.push(t!.id as string);
  }
  const [elsewhere] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id, task_number) VALUES (${other}, 'Not here', 'todo', ${owner!}, 1) RETURNING id`;
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${owner!}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.0', now() + interval '30 days')`;
  return { ws, ids, elsewhere: elsewhere!.id as string, sam: sam!, raw };
}

async function post(raw: string, body: unknown) {
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": "/api/v1/tasks/bulk" };
  const res = await bulk.POST(new Request("https://app.test/api/v1/tasks/bulk", { method: "POST", headers: { authorization: `Bearer ${raw}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
async function undoIt(raw: string, id: string) {
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": `/api/v1/undo/${id}` };
  const res = await undo.POST(new Request(`https://app.test/api/v1/undo/${id}`, { method: "POST", headers: { authorization: `Bearer ${raw}`, "idempotency-key": randomUUID() } }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}
const column = async (ids: string[], name: "status" | "assignee_id" | "due_date") =>
  (await sql`SELECT id, status, assignee_id, due_date FROM tasks WHERE id = ANY(${ids}) ORDER BY task_number`).map((r) => (name === "due_date" ? (r.due_date ? "set" : null) : r[name]));

test("move three tasks at once, then one undo puts all three back", async () => {
  const w = await world();
  const moved = await post(w.raw, { projectId: w.ws, taskIds: w.ids, change: { kind: "status", status: "in_progress" } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(moved.body.data.tasks.map((t: { number: number }) => t.number), [1, 2, 3]);
  assert.deepEqual(await column(w.ids, "status"), ["in_progress", "in_progress", "in_progress"]);
  const back = await undoIt(w.raw, moved.body.data.undoToken);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.match(back.body.data.result, /#1, #2 and #3 back/);
  assert.deepEqual(await column(w.ids, "status"), ["todo", "todo", "todo"]);
});

test("a task already there is left out of the undo, and a refused undo names the right task", async () => {
  const w = await world();
  await sql`UPDATE tasks SET status = 'in_progress' WHERE id = ${w.ids[0]!}`;
  const moved = await post(w.raw, { projectId: w.ws, taskIds: w.ids, change: { kind: "status", status: "in_progress" } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  await sql`UPDATE tasks SET status = 'blocked' WHERE id = ${w.ids[2]!}`;
  const back = await undoIt(w.raw, moved.body.data.undoToken);
  assert.equal(back.status, 409);
  assert.match(back.body.error ?? back.body.message ?? "", /#3 changed since/);
});

test("a task from another workspace changes nothing", async () => {
  const w = await world();
  const refused = await post(w.raw, { projectId: w.ws, taskIds: [...w.ids, w.elsewhere], change: { kind: "status", status: "blocked" } });
  assert.equal(refused.status, 404);
  assert.deepEqual(await column(w.ids, "status"), ["todo", "todo", "todo"]);
});

test("undo is all or nothing: if one task moved on since, none is put back", async () => {
  const w = await world();
  const moved = await post(w.raw, { projectId: w.ws, taskIds: w.ids, change: { kind: "status", status: "in_progress" } });
  await sql`UPDATE tasks SET status = 'blocked' WHERE id = ${w.ids[1]!}`;
  const back = await undoIt(w.raw, moved.body.data.undoToken);
  assert.equal(back.status, 409);
  assert.match(back.body.error ?? back.body.message ?? "", /#2/);
  assert.deepEqual(await column(w.ids, "status"), ["in_progress", "blocked", "in_progress"]);
});

test("assign and set a due date for several tasks, each with one undo", async () => {
  const w = await world();
  const assigned = await post(w.raw, { projectId: w.ws, taskIds: w.ids.slice(0, 2), change: { kind: "assign", assigneeId: w.sam } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.deepEqual(await column(w.ids, "assignee_id"), [w.sam, w.sam, null]);
  const due = await post(w.raw, { projectId: w.ws, taskIds: w.ids, change: { kind: "edit", field: "dueDate", value: "2026-12-04" } });
  assert.equal(due.status, 200, JSON.stringify(due.body));
  assert.deepEqual(await column(w.ids, "due_date"), ["set", "set", "set"]);
  assert.equal((await undoIt(w.raw, due.body.data.undoToken)).status, 200);
  assert.deepEqual(await column(w.ids, "due_date"), [null, null, null]);
  assert.equal((await undoIt(w.raw, assigned.body.data.undoToken)).status, 200);
  assert.deepEqual(await column(w.ids, "assignee_id"), [null, null, null]);
});

test("assigning to someone outside the workspace changes nobody's task", async () => {
  const w = await world();
  const stranger = await sql.begin((tx) => createUser(tx));
  const refused = await post(w.raw, { projectId: w.ws, taskIds: w.ids, change: { kind: "assign", assigneeId: stranger } });
  assert.notEqual(refused.status, 200);
  assert.ok(!(await column(w.ids, "assignee_id")).includes(stranger));
});
