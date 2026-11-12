import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report §20.4, §26.4, A11.6: agents ask their person (others only with ask:others, within limits); people answer;
// an agent session's notifications are held and sent as one summary.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let ask: typeof import("../../src/app/api/v1/questions/route");
let one: typeof import("../../src/app/api/v1/questions/[id]/route");
let answer: typeof import("../../src/app/api/v1/questions/[id]/answer/route");
let fanout: typeof import("../../src/lib/notifications/fanout");
let batching: typeof import("../../src/lib/agents/notifications");
before(async () => {
  ask = await loadAppModule(() => import("../../src/app/api/v1/questions/route"));
  one = await loadAppModule(() => import("../../src/app/api/v1/questions/[id]/route"));
  answer = await loadAppModule(() => import("../../src/app/api/v1/questions/[id]/answer/route"));
  fanout = await loadAppModule(() => import("../../src/lib/notifications/fanout"));
  batching = await loadAppModule(() => import("../../src/lib/agents/notifications"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function agentToken(userId: string, workspaceId: string, scopes: string[] = []) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  const [row] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
            VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.0', now() + interval '1 day', 'agent', 'Claude Code', ${workspaceId}, ${sql.json(scopes)}) RETURNING id`;
  return { token, sessionId: row!.id as string };
}
async function patToken(userId: string) {
  const token = `nb_pat_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes) VALUES (${userId}, 't', ${hash(token)}, ${token.slice(0, 12)}, ${sql.json(["repo:read", "repo:write", "task:write"])})`;
  return token;
}
const as = (token: string, method: string, target: string) => {
  headerValues = { authorization: `Bearer ${token}`, "x-networkbase-request-method": method, "x-networkbase-request-target": target };
};
const post = (path: string, body: unknown) => new Request(`https://app.test${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
const q1 = { key: "format", header: "Export", question: "CSV or Excel?", options: [{ value: "csv", label: "CSV", recommended: true }, { value: "xlsx", label: "Excel" }] };

test("an agent asks its person; the question is in task activity and the person is notified; they answer", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Export', 'in_progress', ${userId}) RETURNING id`;
  const { token } = await agentToken(userId, projectId);
  as(token, "POST", "/api/v1/questions");
  const asked = await ask.POST(post("/api/v1/questions", { projectId, taskId: task!.id, questions: [q1] }));
  const askedJson = await asked.json();
  assert.equal(asked.status, 200, JSON.stringify(askedJson));
  const id = askedJson.data.id as string;
  const [event] = await sql`SELECT event_type FROM task_activity_events WHERE task_id = ${task!.id} AND event_type = 'agent_question'`;
  assert.ok(event, "kept in task activity");
  const [note] = await sql`SELECT kind FROM user_notifications WHERE user_id = ${userId} AND kind = 'agent_question'`;
  assert.ok(note, "the person is told at once");

  as(token, "POST", `/api/v1/questions/${id}/answer`);
  const agentAnswer = await answer.POST(post(`/api/v1/questions/${id}/answer`, { answers: { format: "csv" } }), { params: Promise.resolve({ id }) });
  assert.equal(agentAnswer.status, 403, "an agent can't answer for its person");
  as(await patToken(userId), "POST", `/api/v1/questions/${id}/answer`);
  const answered = await answer.POST(post(`/api/v1/questions/${id}/answer`, { answers: { format: "xlsx" } }), { params: Promise.resolve({ id }) });
  assert.equal(answered.status, 200, JSON.stringify(await answered.clone().json()));
  as(token, "GET", `/api/v1/questions/${id}?wait=5`);
  const read = await (await one.GET(new Request(`https://app.test/api/v1/questions/${id}?wait=5`), { params: Promise.resolve({ id }) })).json();
  assert.equal(read.data.status, "answered");
  assert.deepEqual(read.data.answer, { format: "xlsx" });
});

test("asking someone else needs ask:others and a task; at most 3 open questions", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const assignee = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id) VALUES (${projectId}, 'Export', 'in_progress', ${assignee}) RETURNING id`;
  const plain = await agentToken(userId, projectId);
  as(plain.token, "POST", "/api/v1/questions");
  assert.equal((await ask.POST(post("/api/v1/questions", { projectId, taskId: task!.id, to: "assignee", questions: [q1] }))).status, 403);
  const allowed = await agentToken(userId, projectId, ["workspace:read", "task:read", "task:write", "ask:others"]);
  as(allowed.token, "POST", "/api/v1/questions");
  const toAssignee = await ask.POST(post("/api/v1/questions", { projectId, taskId: task!.id, to: "assignee", questions: [q1] }));
  assert.equal(toAssignee.status, 200);
  const [row] = await sql`SELECT to_user_id FROM agent_questions WHERE asker_session_id = ${allowed.sessionId}`;
  assert.equal(row!.to_user_id, assignee);
  for (let i = 0; i < 2; i++) {
    as(allowed.token, "POST", "/api/v1/questions");
    assert.equal((await ask.POST(post("/api/v1/questions", { projectId, questions: [q1] }))).status, 200);
  }
  as(allowed.token, "POST", "/api/v1/questions");
  assert.equal((await ask.POST(post("/api/v1/questions", { projectId, questions: [q1] }))).status, 429, "a fourth open question waits");
});

test("an agent session's notifications are held, then sent as one summary per person", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const teammate = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const { token, sessionId } = await agentToken(userId, projectId);
  as(token, "POST", "/api/v1/extension/comments");
  const write = (n: number) => ({ operation: "create" as const, input: { recipientUserId: teammate, actorUserId: userId, kind: "project_task_activity" as const, category: "tasks" as const, title: `Change ${n}`, dedupeKey: `t:${n}:${randomUUID()}` } });
  await fanout.enqueueNotificationFanout({ writes: [write(1), write(2), write(3)] });
  const [held] = await sql`SELECT count(*)::int AS n FROM agent_notification_buffer WHERE session_id = ${sessionId}`;
  assert.equal(held!.n, 3);
  const [none] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${teammate}`;
  assert.equal(none!.n, 0, "nothing one by one");
  headerValues = {};
  assert.deepEqual(await batching.flushAgentSession(sessionId), { sent: 1 });
  const notes = await sql`SELECT kind, title FROM user_notifications WHERE user_id = ${teammate}`;
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, "agent_session_summary");
  assert.match(notes[0]!.title, /^Claude Code \(for .*\) made 3 changes$/);
});

test("when the session ends, the person gets its What I did list (report D19)", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const projectId = await sql.begin((tx) => createProject(tx, userId));
  const { sessionId } = await agentToken(userId, projectId);
  headerValues = {};
  const did = ["Moved #4 to in progress", "Commented on #4", "Pushed /notes.md"];
  assert.deepEqual(await batching.flushAgentSession(sessionId, did), { sent: 1 });
  const notes = await sql`SELECT kind, title, body FROM user_notifications WHERE user_id = ${userId}`;
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.kind, "agent_session_summary");
  assert.match(notes[0]!.title, /^Claude Code finished: 3 changes$/);
  assert.equal(notes[0]!.body, "Moved #4 to in progress · Commented on #4 · Pushed /notes.md");
  assert.deepEqual(await batching.flushAgentSession(sessionId, []), { sent: 0 }, "nothing to say, nothing sent");
});
