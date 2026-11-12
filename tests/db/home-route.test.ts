import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C1, C2, C15 (GET /api/v1/home): one call for nb's home screen and nb next: counts, unread, reviews waiting
// for you, and your assignments due.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
let home: typeof import("../../src/app/api/v1/home/route");
before(async () => { home = await loadAppModule(() => import("../../src/app/api/v1/home/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function read(userId: string, query = "") {
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.0', now() + interval '30 days')`;
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": "/api/v1/home" };
  const res = await home.GET(new Request(`https://app.test/api/v1/home${query}`));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.data;
}

test("home: counts, unread, and the reviews waiting for you as owner or admin, never as a member", async () => {
  const [owner, admin, member] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${admin!}, 'admin'), (${ws}, ${member!}, 'member')`;
  await sql`INSERT INTO tasks (workspace_id, title, status, review_status, assignee_id, task_number) VALUES
    (${ws}, 'Check my logo', 'done', 'pending', ${member!}, 1),
    (${ws}, 'Mine to do', 'todo', 'none', ${member!}, 2)`;
  const forOwner = await read(owner!);
  assert.deepEqual(forOwner.reviews.map((r: { number: number; title: string }) => [r.number, r.title]), [[1, "Check my logo"]]);
  assert.equal(forOwner.reviews[0].workspaceId, ws);
  assert.equal((await read(admin!)).reviews.length, 1);
  const forMember = await read(member!);
  assert.deepEqual(forMember.reviews, []);
  assert.equal(forMember.tasks.open, 2, "a task in review still counts as open work");
  assert.equal(typeof forMember.unread, "number");
  assert.deepEqual(forMember.assignments, []);
});

test("home: the folder's current task comes back while it exists, and null once it's deleted", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  const [t] = await sql`INSERT INTO tasks (workspace_id, title, status, task_number) VALUES (${ws}, 'Current one', 'in_progress', 4) RETURNING id`;
  assert.deepEqual((await read(owner, `?task=${t!.id}`)).currentTask, { id: t!.id, number: 4, title: "Current one", status: "in_progress" });
  await sql`UPDATE tasks SET deleted_at = now() WHERE id = ${t!.id}`;
  assert.equal((await read(owner, `?task=${t!.id}`)).currentTask, null);
  assert.equal("currentTask" in (await read(owner)), false, "not asked, not sent");
});
