import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report F59: a subtask change from a client must name the exact version it saw; a 5 s window let a
// stale client undo someone else's tick.
let actingUser = "";
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
let route: typeof import("../../src/app/api/v1/extension/task-update/route");
before(async () => {
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", {
    ...shared,
    requireAuthenticatedUser: async () => ({ user: { id: actingUser, user_metadata: {} }, extensionSessionId: "ext", tokenScopes: null, response: null }),
  });
  moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
  moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true }) });
  route = await loadAppModule(() => import("../../src/app/api/v1/extension/task-update/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const patch = (body: unknown) =>
  route.PATCH(new Request("https://app.test/api/v1/extension/task-update", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("a subtask change based on an older version is refused, the current one applies", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, 't') RETURNING id`;
  const [sub] = await sql`INSERT INTO task_subtasks (task_id, title, updated_at) VALUES (${task!.id}, 'Write tests', now()) RETURNING id, updated_at`;
  actingUser = owner;
  const current = (sub!.updated_at as Date).getTime();
  const base = { kind: "subtask", projectId, taskId: task!.id, subtaskId: sub!.id, completed: true };

  const stale = await patch({ ...base, expectedUpdatedAt: new Date(current - 2000).toISOString() });
  assert.equal(stale.status, 409, "two seconds old is stale");

  const fresh = await patch({ ...base, expectedUpdatedAt: new Date(current).toISOString() });
  assert.equal(fresh.status, 200, JSON.stringify(await fresh.clone().json()));
  const [row] = await sql`SELECT completed FROM task_subtasks WHERE id = ${sub!.id}`;
  assert.equal(row!.completed, true);
});
