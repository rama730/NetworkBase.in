import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §17.4 / A2.5: task edit, assign, subtask move, undo of an edit, workspace view, activity, sprints,
// attaching a file to a task, and an agent's update post waiting for a yes.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let taskUpdate: typeof import("../../src/app/api/v1/extension/task-update/route");
let undo: typeof import("../../src/app/api/v1/undo/[id]/route");
let view: typeof import("../../src/app/api/v1/workspaces/[id]/route");
let activity: typeof import("../../src/app/api/v1/workspaces/[id]/activity/route");
let sprints: typeof import("../../src/app/api/v1/workspaces/[id]/sprints/route");
let updates: typeof import("../../src/app/api/v1/workspaces/[id]/updates/route");
let taskFiles: typeof import("../../src/app/api/v1/tasks/[taskId]/files/route");
before(async () => {
  taskUpdate = await loadAppModule(() => import("../../src/app/api/v1/extension/task-update/route"));
  undo = await loadAppModule(() => import("../../src/app/api/v1/undo/[id]/route"));
  view = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/route"));
  activity = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/activity/route"));
  sprints = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/sprints/route"));
  updates = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/updates/route"));
  taskFiles = await loadAppModule(() => import("../../src/app/api/v1/tasks/[taskId]/files/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function pat(userId: string) {
  const token = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes) VALUES (${userId}, 't', ${hash(token)}, ${token.slice(0, 12)}, ${sql.json(["repo:read", "repo:write", "task:write"])})`;
  return token;
}
async function agent(userId: string, workspaceId: string) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.0', now() + interval '1 day', 'agent', 'Claude Code', ${workspaceId})`;
  return token;
}
const call = async (handler: (r: Request, c?: any) => Promise<Response>, token: string, method: string, path: string, body?: unknown, ctx?: unknown) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
  return { status: res.status, json: await res.json() };
};

test("edit, assign and reorder through task-update; undo puts the title back", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await pat(userId);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Logo', 'todo', ${userId}) RETURNING id`;
  const subs = await sql`INSERT INTO task_subtasks (task_id, title, position) VALUES (${task!.id}, 'One', 0), (${task!.id}, 'Two', 1) RETURNING id`;
  const edited = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", { kind: "edit", projectId, taskId: task!.id, field: "title", value: "New logo" });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal((await sql`SELECT title FROM tasks WHERE id = ${task!.id}`)[0]!.title, "New logo");
  const assigned = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", { kind: "assign", projectId, taskId: task!.id, assigneeId: null });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${task!.id}`)[0]!.assignee_id, null);
  const moved = await call(taskUpdate.PATCH, token, "PATCH", "/api/v1/extension/task-update", { kind: "subtask_move", projectId, taskId: task!.id, subtaskId: subs[1]!.id, position: 0 });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.deepEqual((await sql`SELECT id FROM task_subtasks WHERE task_id = ${task!.id} ORDER BY position`).map((r) => r.id), [subs[1]!.id, subs[0]!.id]);
  const back = await call(undo.POST, token, "POST", `/api/v1/undo/${edited.json.data.undoToken}`, {}, { params: Promise.resolve({ id: edited.json.data.undoToken }) });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal((await sql`SELECT title FROM tasks WHERE id = ${task!.id}`)[0]!.title, "Logo");
});

test("workspace view, activity, sprints; attach a file; an agent's update waits for a yes", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const token = await pat(userId);
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Logo', 'todo', ${userId}) RETURNING id`;
  await sql`INSERT INTO workspace_sprints (workspace_id, sprint_number, name, start_date, end_date, status) VALUES (${projectId}, 1, 'Sprint 1', now(), now() + interval '7 days', 'active')`;
  const ctx = { params: Promise.resolve({ id: projectId }) };
  const v = await call(view.GET, token, "GET", `/api/v1/workspaces/${projectId}`, undefined, ctx);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.data.openTasks, 1);
  assert.equal(v.json.data.currentSprint.name, "Sprint 1");
  await sql`INSERT INTO task_activity_events (task_id, workspace_id, actor_id, event_type, payload) VALUES (${task!.id}, ${projectId}, ${userId}, 'status_changed', ${sql.json({ to: "in_progress", via: "agent", agentName: "Claude Code" })})`;
  const a = await call(activity.GET, token, "GET", `/api/v1/workspaces/${projectId}/activity`, undefined, ctx);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.data.items[0].agentName, "Claude Code");
  const sp = await call(sprints.GET, token, "GET", `/api/v1/workspaces/${projectId}/sprints`, undefined, ctx);
  assert.equal(sp.json.data.sprints[0].open, 0);
  assert.equal(sp.json.data.unplanned, 1);

  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by, current_version) VALUES (${projectId}, 'file', 'brief.md', '/brief.md', ${userId}, 1) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, content_hash) VALUES (${node!.id}, 1, ${`projects/${projectId}/files/brief.md`}, 1, 'text/markdown', ${userId}, ${"d".repeat(64)})`;
  const attached = await call(taskFiles.POST, token, "POST", `/api/v1/tasks/${task!.id}/files`, { projectId, path: "brief.md", as: "reference" }, { params: Promise.resolve({ taskId: task!.id }) });
  assert.equal(attached.status, 200, JSON.stringify(attached.json));
  const [link] = await sql`SELECT tags FROM task_node_links WHERE task_id = ${task!.id} AND node_id = ${node!.id}`;
  assert.ok(link, "linked");

  const agentToken = await agent(userId, projectId);
  const held = await call(updates.POST, agentToken, "POST", `/api/v1/workspaces/${projectId}/updates`, { content: "Shipped the logo" }, ctx);
  assert.equal(held.status, 428, JSON.stringify(held.json));
});

test("H8: activity lists saves and merges per branch and deleted branches, for the workspace's people only", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const { unprotect } = await import("./_helpers");
  const saves = await loadAppModule(() => import("../../src/lib/domain/saves"));
  const branches = await loadAppModule(() => import("../../src/lib/domain/branches"));
  await saves.setBranchesEnabled({ user: { id: userId } }, projectId, true);
  await unprotect(projectId);
  const { branch } = await branches.createBranch({ user: { id: userId } }, projectId, { name: "feature-x" });
  await branches.saveTextOnBranch({ user: { id: userId } }, branch.id, { path: "/a.md", text: "a\n", message: "First on the branch" });
  const old = (await branches.createBranch({ user: { id: userId } }, projectId, { name: "old-idea" })).branch;
  await sql`UPDATE branches SET status = 'deleted', deleted_at = now() WHERE id = ${old.id}`;
  const ctx = { params: Promise.resolve({ id: projectId }) };
  const a = await call(activity.GET, await pat(userId), "GET", `/api/v1/workspaces/${projectId}/activity`, undefined, ctx);
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const items = a.json.data.items.filter((i: any) => i.kind === "branch");
  assert.ok(items.some((i: any) => i.type === "save" && i.branch === "feature-x" && /First on the branch/.test(i.detail)), JSON.stringify(items));
  assert.ok(items.some((i: any) => i.type === "deleted" && i.branch === "old-idea"));
  // Someone outside the workspace (public reader) never sees branches.
  await sql`UPDATE workspaces SET visibility = 'public' WHERE id = ${projectId}`;
  const stranger = await sql.begin((tx) => createUser(tx));
  const s = await call(activity.GET, await pat(stranger), "GET", `/api/v1/workspaces/${projectId}/activity`, undefined, ctx);
  assert.ok(s.status !== 200 || !s.json.data.items.some((i: any) => i.kind === "branch"));
});
