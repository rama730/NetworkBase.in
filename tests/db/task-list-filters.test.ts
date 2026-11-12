import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C2: nb task list filters and sort run on the server, so open work never falls off a page of done tasks.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
let route: typeof import("../../src/app/api/v1/extension/workspace-tasks/route");
before(async () => { route = await loadAppModule(() => import("../../src/app/api/v1/extension/workspace-tasks/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const day = 86_400_000;

async function world() {
  const [owner, teammate] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${teammate!}, 'member')`;
  const [sprint] = await sql`INSERT INTO workspace_sprints (workspace_id, name, start_date, end_date) VALUES (${ws}, 'Week 1', now(), now() + interval '7 days') RETURNING id`;
  const now = Date.now();
  const rows: Array<[string, string, string, string, number | null, string | null, string | null]> = [
    // title, status, review, priority, due offset (days), assignee, sprint
    ["Overdue", "todo", "none", "high", -1, owner!, null],
    ["Soon", "in_progress", "none", "low", 3, owner!, sprint!.id],
    ["Done", "done", "none", "urgent", 2, owner!, null],
    ["Waiting review", "done", "pending", "medium", null, owner!, null],
    ["Theirs", "todo", "none", "urgent", 20, teammate!, null],
  ];
  let n = 0;
  for (const [title, status, review, priority, due, assignee, sprintId] of rows) {
    n += 1;
    await sql`INSERT INTO tasks (workspace_id, title, status, review_status, priority, due_date, assignee_id, sprint_id, creator_id, task_number, updated_at)
              VALUES (${ws}, ${title}, ${status}, ${review}, ${priority}, ${due === null ? null : new Date(now + due * day)}, ${assignee}, ${sprintId}, ${owner!}, ${n}, ${new Date(now - n * 1000)})`;
  }
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${owner!}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.0', now() + interval '30 days')`;
  return { ws, raw, teammate: teammate!, sprint: sprint!.id as string, now };
}

async function list(w: Awaited<ReturnType<typeof world>>, query: Record<string, string>) {
  const target = `/api/v1/extension/workspace-tasks?${new URLSearchParams({ projectId: w.ws, ...query })}`;
  headerValues = { authorization: `Bearer ${w.raw}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": target };
  const res = await route.GET(new Request(`https://app.test${target}`));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return (body.data.tasks as Array<{ title: string }>).map((t) => t.title);
}

test("open, due ranges, person, sprint and priority filter on the server", async () => {
  const w = await world();
  const iso = (offsetDays: number) => new Date(w.now + offsetDays * day).toISOString();
  assert.deepEqual(await list(w, { open: "1" }), ["Overdue", "Soon", "Waiting review", "Theirs"]);
  assert.deepEqual(await list(w, { open: "1", dueBefore: iso(0) }), ["Overdue"]);
  assert.deepEqual(await list(w, { open: "1", dueAfter: iso(0), dueBefore: iso(7) }), ["Soon"]);
  assert.deepEqual(await list(w, { assignee: w.teammate }), ["Theirs"]);
  assert.deepEqual(await list(w, { sprint: w.sprint }), ["Soon"]);
  assert.deepEqual(await list(w, { priority: "urgent,high" }), ["Overdue", "Done", "Theirs"]);
  assert.deepEqual(await list(w, { status: "todo" }), ["Overdue", "Theirs"]);
});

test("sort by due date (no date last) and by priority", async () => {
  const w = await world();
  assert.deepEqual(await list(w, { open: "1", sort: "due" }), ["Overdue", "Soon", "Theirs", "Waiting review"]);
  assert.deepEqual(await list(w, { open: "1", sort: "priority" }), ["Theirs", "Overdue", "Waiting review", "Soon"]);
});

test("a bad filter is a 400, not an empty list", async () => {
  const w = await world();
  const target = `/api/v1/extension/workspace-tasks?projectId=${w.ws}&sort=random`;
  headerValues = { authorization: `Bearer ${w.raw}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": target };
  assert.equal((await route.GET(new Request(`https://app.test${target}`))).status, 400);
});
