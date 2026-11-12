import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C4 (M4b): `nb comment edit` and `nb comment delete`, your own task comments only, with a CLI token.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let route: typeof import("../../src/app/api/v1/extension/comments/route");
before(async () => { route = await loadAppModule(() => import("../../src/app/api/v1/extension/comments/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function signIn(userId: string) {
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.2', now() + interval '30 days')`;
  return raw;
}
async function call(raw: string, method: "PATCH" | "DELETE", body: unknown) {
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": "/api/v1/extension/comments" };
  const res = await (method === "PATCH" ? route.PATCH : route.DELETE)(new Request("https://app.test/api/v1/extension/comments", { method, headers: { authorization: `Bearer ${raw}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}

test("edit and delete your own comment; someone else's is refused", async () => {
  const [owner, member] = await Promise.all([1, 2].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${member!}, 'member')`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, task_number) VALUES (${ws}, 'T', ${owner!}, 1) RETURNING id`;
  const [mine] = await sql`INSERT INTO task_comments (task_id, user_id, content) VALUES (${task!.id}, ${member!}, 'typo hre') RETURNING id`;
  const [theirs] = await sql`INSERT INTO task_comments (task_id, user_id, content) VALUES (${task!.id}, ${owner!}, 'owner says') RETURNING id`;
  const raw = await signIn(member!);
  const edited = await call(raw, "PATCH", { projectId: ws, commentId: mine!.id, text: "typo here" });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal((await sql`SELECT content FROM task_comments WHERE id = ${mine!.id}`)[0]!.content, "typo here");
  assert.equal((await call(raw, "PATCH", { projectId: ws, commentId: theirs!.id, text: "hijack" })).status, 403);
  assert.equal((await call(raw, "DELETE", { projectId: ws, commentId: theirs!.id })).status, 403);
  assert.equal((await call(raw, "DELETE", { projectId: ws, commentId: mine!.id })).status, 200);
  assert.equal((await sql`SELECT count(*)::int AS n FROM task_comments WHERE id = ${mine!.id}`)[0]!.n, 0);
});
