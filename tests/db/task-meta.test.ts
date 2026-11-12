import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C2, C12 (0087): labels, "blocked by", watching, stars and links on a task, through one token route.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let route: typeof import("../../src/app/api/v1/tasks/[taskId]/meta/route");
let list: typeof import("../../src/app/api/v1/extension/workspace-tasks/route");
let bulk: typeof import("../../src/app/api/v1/tasks/bulk/route");
before(async () => {
  route = await loadAppModule(() => import("../../src/app/api/v1/tasks/[taskId]/meta/route"));
  list = await loadAppModule(() => import("../../src/app/api/v1/extension/workspace-tasks/route"));
  bulk = await loadAppModule(() => import("../../src/app/api/v1/tasks/bulk/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function signIn(userId: string) {
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  return raw;
}
async function call(raw: string, taskId: string, method: "GET" | "PATCH", body?: unknown) {
  const target = `/api/v1/tasks/${taskId}/meta`;
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
  const res = await (method === "GET" ? route.GET : route.PATCH)(
    new Request(`https://app.test${target}`, { method, headers: { authorization: `Bearer ${raw}`, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    { params: Promise.resolve({ taskId }) },
  );
  return { status: res.status, body: await res.json() };
}

async function world() {
  const [owner, member, viewer, stranger] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${member!}, 'member'), (${ws}, ${viewer!}, 'viewer')`;
  const ids: string[] = [];
  for (const n of [1, 2, 3]) ids.push((await sql`INSERT INTO tasks (workspace_id, title, status, creator_id, assignee_id, task_number) VALUES (${ws}, ${`Task ${n}`}, 'todo', ${owner!}, ${member!}, ${n}) RETURNING id`)[0]!.id as string);
  return { ws, ids, ownerId: owner!, memberId: member!, viewerId: viewer!, owner: await signIn(owner!), member: await signIn(member!), viewer: await signIn(viewer!), stranger: await signIn(stranger!) };
}

test("labels, blocked by and links: added, read back, removed; cycles and other workspaces refused", async () => {
  const w = await world();
  const set = await call(w.member, w.ids[0]!, "PATCH", { labels: { add: ["Bug", " ui "] }, blockedBy: { add: [w.ids[1]] }, links: { add: [{ url: "https://github.com/acme/app/pull/42" }] } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const read = (await call(w.member, w.ids[0]!, "GET")).body.data;
  assert.deepEqual(read.labels, ["bug", "ui"]);
  assert.deepEqual(read.blockedBy.map((t: { number: number }) => t.number), [2]);
  assert.deepEqual(read.links.map((l: { kind: string; title: string }) => [l.kind, l.title]), [["pull_request", "acme/app#42"]]);
  assert.deepEqual((await call(w.member, w.ids[1]!, "GET")).body.data.blocking.map((t: { number: number }) => t.number), [1], "the blocker shows what it blocks");
  const cycle = await call(w.member, w.ids[1]!, "PATCH", { blockedBy: { add: [w.ids[0]] } });
  assert.equal(cycle.status, 409, "#2 can't wait on #1 while #1 waits on #2");
  assert.equal((await call(w.member, w.ids[0]!, "PATCH", { links: { add: [{ url: "http://insecure.example" }] } })).status, 400);
  await call(w.member, w.ids[0]!, "PATCH", { labels: { remove: ["ui"] }, blockedBy: { remove: [w.ids[1]] }, links: { remove: ["https://github.com/acme/app/pull/42"] } });
  const after = (await call(w.member, w.ids[0]!, "GET")).body.data;
  assert.deepEqual([after.labels, after.blockedBy, after.links], [["bug"], [], []]);
});

test("watch and star are personal; a viewer may watch but not label; outsiders get nothing", async () => {
  const w = await world();
  assert.equal((await call(w.viewer, w.ids[0]!, "PATCH", { watch: true, star: true })).status, 200);
  const mine = (await call(w.viewer, w.ids[0]!, "GET")).body.data;
  assert.deepEqual([mine.watching, mine.starred], [true, true]);
  const theirs = (await call(w.member, w.ids[0]!, "GET")).body.data;
  assert.deepEqual([theirs.watching, theirs.starred], [false, false]);
  assert.notEqual((await call(w.viewer, w.ids[0]!, "PATCH", { labels: { add: ["bug"] } })).status, 200, "a viewer can't change the task");
  assert.equal((await call(w.stranger, w.ids[0]!, "GET")).status, 403);
});

test("task list filters by label and starred", async () => {
  const w = await world();
  await call(w.member, w.ids[0]!, "PATCH", { labels: { add: ["bug"] } });
  await call(w.member, w.ids[2]!, "PATCH", { star: true });
  const titles = async (query: string) => {
    const target = `/api/v1/extension/workspace-tasks?projectId=${w.ws}&${query}`;
    headerValues = { authorization: `Bearer ${w.member}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": target };
    return ((await (await list.GET(new Request(`https://app.test${target}`))).json()).data.tasks as Array<{ title: string; labels?: string[] }>).map((t) => t.title);
  };
  assert.deepEqual(await titles("label=bug"), ["Task 1"]);
  assert.deepEqual(await titles("starred=1"), ["Task 3"]);
});

test("finishing a blocker tells the waiting task's assignee; watchers hear about status changes", async () => {
  const w = await world();
  await call(w.member, w.ids[0]!, "PATCH", { blockedBy: { add: [w.ids[1]] } });
  await call(w.viewer, w.ids[1]!, "PATCH", { watch: true });
  headerValues = { authorization: `Bearer ${w.owner}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": "/api/v1/tasks/bulk" };
  const res = await bulk.POST(new Request("https://app.test/api/v1/tasks/bulk", { method: "POST", headers: { authorization: `Bearer ${w.owner}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ projectId: w.ws, taskIds: [w.ids[1]], change: { kind: "status", status: "done" } }) }));
  assert.equal(res.status, 200, await res.text());
  const titles = async (userId: string) => (await sql`SELECT title FROM user_notifications WHERE user_id = ${userId} ORDER BY created_at`).map((r) => r.title as string);
  assert.ok((await titles(w.memberId)).some((t) => /finished #2, which #1 was waiting on/.test(t)), JSON.stringify(await titles(w.memberId)));
  assert.ok((await titles(w.viewerId)).some((t) => /completed a task/.test(t)), "the watcher hears it");
});
