import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part B over the CLI's task read (found in M4): task-detail sent whole rows, so "No one" still leaked
// "with Claude Code" to nb task view. And brief=1 (C16 #9) answers with the task row only, after the same checks.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
let route: typeof import("../../src/app/api/v1/extension/task-detail/route");
before(async () => { route = await loadAppModule(() => import("../../src/app/api/v1/extension/task-detail/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function signIn(userId: string) {
  const raw = `nb_dev_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.0', now() + interval '30 days')`;
  return raw;
}
async function detail(raw: string, ws: string, query: string) {
  const target = `/api/v1/extension/task-detail?projectId=${ws}&${query}`;
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": target };
  const res = await route.GET(new Request(`https://app.test${target}`));
  return { status: res.status, body: await res.json() };
}

async function world() {
  const [owner, person, teammate] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${person!}, 'member'), (${ws}, ${teammate!}, 'member')`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, creator_id, via, agent_name, task_number)
                           VALUES (${ws}, 'Fix login', 'todo', ${person!}, 'agent', 'Claude Code', 1) RETURNING id`;
  await sql`INSERT INTO task_subtasks (task_id, title, via, agent_name, created_by) VALUES (${task!.id}, 'Write tests', 'agent', 'Claude Code', ${person!})`;
  return { ws, number: "1", person: await signIn(person!), teammate: await signIn(teammate!) };
}

test("task-detail sends labels only as the workspace's setting allows", async () => {
  const w = await world();
  const labels = async (raw: string) => {
    const { body } = await detail(raw, w.ws, `taskNumber=${w.number}`);
    return [body.data.task.via, body.data.task.agentName, body.data.subtasks[0].via, body.data.subtasks[0].agentName];
  };
  const shown = ["agent", "Claude Code", "agent", "Claude Code"];
  const hidden = [null, null, null, null];
  assert.deepEqual(await labels(w.teammate), shown, "everyone (the default)");
  await sql`UPDATE workspaces SET agent_label_visibility = 'person' WHERE id = ${w.ws}`;
  assert.deepEqual([await labels(w.person), await labels(w.teammate)], [shown, hidden], "only the person");
  await sql`UPDATE workspaces SET agent_label_visibility = 'none' WHERE id = ${w.ws}`;
  assert.deepEqual([await labels(w.person), await labels(w.teammate)], [hidden, hidden], "no one");
});

test("brief=1 answers with the task row only, and only to people who may read the task", async () => {
  const w = await world();
  const { status, body } = await detail(w.teammate, w.ws, `taskNumber=${w.number}&brief=1`);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body.data).sort(), ["task"]);
  assert.deepEqual(Object.keys(body.data.task).sort(), ["assigneeId", "id", "projectId", "reviewStatus", "status", "taskNumber", "title", "updatedAt"]);
  const stranger = await signIn(await sql.begin((tx) => createUser(tx)));
  assert.equal((await detail(stranger, w.ws, `taskNumber=${w.number}&brief=1`)).status, 403);
});
