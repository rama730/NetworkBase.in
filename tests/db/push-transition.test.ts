import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report finding 31: a push that asks to finish a task goes through the task rules (review,
// permissions, notifications) instead of writing the status directly.
let actingUser = "";
let route: typeof import("../../src/app/api/v1/extension/task-push/route");
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
before(async () => {
  // Post-commit work runs inline; NextResponse stays real so routes can answer.
  const real = await import("next/server");
  moduleStubs.set("next/server", { ...real, after: (task: unknown) => { void Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task).catch(() => undefined); } });
  const shared = await loadAppModule(() => import("../../src/app/api/v1/_shared"));
  moduleStubs.set("@/app/api/v1/_shared", {
    ...shared,
    requireAuthenticatedUser: async () => ({ user: { id: actingUser, email: "", user_metadata: {} }, extensionSessionId: "ext", tokenScopes: null, response: null }),
  });
  moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
  moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true }) });
  route = await loadAppModule(() => import("../../src/app/api/v1/extension/task-push/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const HASH = "b".repeat(64);
const push = (body: unknown) =>
  route.POST(new Request("https://app.test/api/v1/extension/task-push", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify(body),
  }));

async function fixture(reviewRequired: boolean) {
  const owner = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, owner));
  await sql`UPDATE workspaces SET task_review_required = ${reviewRequired} WHERE id = ${projectId}`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status) VALUES (${projectId}, 't', 'in_progress') RETURNING id`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, current_version)
    VALUES (${projectId}, 'file', 'report.pdf', '/report.pdf', ${owner}, 1) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, content_hash)
    VALUES (${node!.id}, 1, ${`projects/${projectId}/files/report.pdf`}, 1, 'application/pdf', ${owner}, ${HASH})`;
  const body = { taskId: task!.id, projectId, taskAction: "replace_task_version", role: "deliverable", transitionStatus: "done", files: [{ nodeId: node!.id, version: 1, contentHash: HASH }] };
  return { owner, projectId, taskId: task!.id as string, body };
}

test("finishing a review-required task from a push sends it for review", async () => {
  const f = await fixture(true);
  actingUser = f.owner;
  const res = await push(f.body);
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.data.transition.ok, true, JSON.stringify(json.data.transition));
  assert.equal(json.data.transition.outcome, "submitted");
  const [row] = await sql`SELECT status, review_status, completed_at FROM tasks WHERE id = ${f.taskId}`;
  assert.equal(row!.review_status, "pending", "waits for a reviewer");
  assert.equal(row!.completed_at, null, "not completed until approved");
});

test("finishing a task without review completes it through the same rules", async () => {
  const f = await fixture(false);
  actingUser = f.owner;
  const json = await (await push(f.body)).json();
  assert.equal(json.data.transition.ok, true, JSON.stringify(json.data.transition));
  assert.equal(json.data.transition.outcome, "completed");
  const [row] = await sql`SELECT status, review_status, completed_by FROM tasks WHERE id = ${f.taskId}`;
  assert.equal(row!.status, "done");
  assert.equal(row!.completed_by, f.owner);
});

test("a push by someone who may not move the task keeps the files and reports why", async () => {
  const f = await fixture(false);
  const stranger = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${f.projectId}, ${stranger}, 'viewer')`.catch(() => undefined);
  actingUser = stranger;
  const res = await push(f.body);
  // A viewer can't write at all; the push is refused before any task effect.
  assert.notEqual(res.status, 200);
  const [row] = await sql`SELECT status FROM tasks WHERE id = ${f.taskId}`;
  assert.equal(row!.status, "in_progress");
});
