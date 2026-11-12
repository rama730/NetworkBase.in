import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C2, C15 (M4b): nb search finds tasks, comments, docs and people, with the Tasks tab's read rules.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
let route: typeof import("../../src/app/api/v1/workspaces/[id]/search/route");
before(async () => { route = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/search/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function search(raw: string, ws: string, query: string) {
  const target = `/api/v1/workspaces/${ws}/search?${query}`;
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": target.split("?")[0]! };
  const res = await route.GET(new Request(`https://app.test${target}`), { params: Promise.resolve({ id: ws }) });
  return { status: res.status, body: await res.json() };
}

test("tasks, comments and people that match; outsiders get nothing", async () => {
  const [owner, sam, stranger] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${sam!}, 'member')`;
  await sql`UPDATE profiles SET full_name = 'Sam Login' WHERE id = ${sam!}`;
  const [t] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, task_number) VALUES (${ws}, 'Fix the login page', ${owner!}, 1) RETURNING id`;
  await sql`INSERT INTO tasks (workspace_id, title, creator_id, task_number) VALUES (${ws}, 'Footer colours', ${owner!}, 2)`;
  await sql`INSERT INTO task_comments (task_id, user_id, content) VALUES (${t!.id}, ${owner!}, 'The login button is grey')`;
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at) VALUES (${owner!}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  const found = await search(raw, ws, "q=login");
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.deepEqual(found.body.data.tasks.map((x: { number: number }) => x.number), [1]);
  assert.match(found.body.data.comments[0].text, /login button/);
  assert.deepEqual(found.body.data.people.map((p: { name: string }) => p.name), ["Sam Login"]);
  assert.deepEqual((await search(raw, ws, "q=login&in=tasks")).body.data.comments, [], "in= narrows it");
  assert.equal((await search(raw, ws, "q=x")).status, 400, "two characters at least");
  const theirs = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at) VALUES (${stranger!}, ${hash(theirs)}, ${theirs.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  assert.equal((await search(theirs, ws, "q=login")).status, 403);
});
