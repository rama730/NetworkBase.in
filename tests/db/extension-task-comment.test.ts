import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report F1: `nb task comment` sent { taskId, content } to the file-comment route and always got
// "Invalid comment". Task comments from tokens now go through the same code as the task panel.
let actingUser = "";
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let route: typeof import("../../src/app/api/v1/extension/comments/route");
before(async () => {
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", {
    ...shared,
    requireAuthenticatedUser: async () => ({ user: { id: actingUser, user_metadata: { full_name: "Ada Tester" } }, extensionSessionId: "ext", tokenScopes: null, response: null }),
  });
  moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
  route = await loadAppModule(() => import("../../src/app/api/v1/extension/comments/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const post = (body: unknown) =>
  route.POST(new Request("https://app.test/api/v1/extension/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("a task comment from the 1.x CLI and from CLI 2.0 lands on the task", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, 'Fix login') RETURNING id`;
  actingUser = owner;

  const legacy = await post({ taskId: task!.id, content: "API is ready" });
  assert.equal(legacy.status, 200, JSON.stringify(await legacy.clone().json()));

  const current = await post({ kind: "task", projectId, taskId: task!.id, text: "Tests pass" });
  assert.equal(current.status, 200);

  const rows = await sql`SELECT content, user_id FROM task_comments WHERE task_id = ${task!.id} ORDER BY created_at`;
  assert.deepEqual(rows.map((r) => r.content), ["API is ready", "Tests pass"]);
  assert.ok(rows.every((r) => r.user_id === owner));
});

test("someone outside the workspace can't comment on its task", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const stranger = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner, { visibility: "private" }));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, 'Private') RETURNING id`;
  actingUser = stranger;
  const res = await post({ taskId: task!.id, content: "hello" });
  assert.notEqual(res.status, 200);
  const rows = await sql`SELECT 1 FROM task_comments WHERE task_id = ${task!.id}`;
  assert.equal(rows.length, 0);
});

test("unknown tasks and bad bodies are refused", async () => {
  actingUser = await sql.begin((tx) => createUser(tx));
  assert.equal((await post({ taskId: "00000000-0000-4000-8000-000000000000", content: "x" })).status, 404);
  assert.equal((await post({ taskId: "not-a-uuid", content: "x" })).status, 400);
});
