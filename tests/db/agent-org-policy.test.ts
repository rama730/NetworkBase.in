import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// CLI report A8.2, A8.4, A8.8: an agent can't write to a "No AI agents" copy; an organization can turn agents off;
// a student hands in through the API with the app's rules; reviewers return and approve.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

let comments: typeof import("../../src/app/api/v1/extension/comments/route");
let list: typeof import("../../src/app/api/v1/assignments/route");
let view: typeof import("../../src/app/api/v1/assignments/[copyId]/route");
let handIn: typeof import("../../src/app/api/v1/assignments/[copyId]/hand-in/route");
let reviews: typeof import("../../src/app/api/v1/reviews/route");
let decide: typeof import("../../src/app/api/v1/reviews/[copyId]/route");
before(async () => {
  comments = await loadAppModule(() => import("../../src/app/api/v1/extension/comments/route"));
  list = await loadAppModule(() => import("../../src/app/api/v1/assignments/route"));
  view = await loadAppModule(() => import("../../src/app/api/v1/assignments/[copyId]/route"));
  handIn = await loadAppModule(() => import("../../src/app/api/v1/assignments/[copyId]/hand-in/route"));
  reviews = await loadAppModule(() => import("../../src/app/api/v1/reviews/route"));
  decide = await loadAppModule(() => import("../../src/app/api/v1/reviews/[copyId]/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent", workspaceId?: string) {
  const t = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id)
            VALUES (${userId}, ${hash(t)}, ${t.slice(0, 11)}, 'laptop', '2.0.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Claude Code" : null}, ${workspaceId ?? null})`;
  return t;
}
const call = async (handler: (r: Request, c?: any) => Promise<Response>, t: string, method: string, path: string, body?: unknown, ctx?: unknown) => {
  headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
  return { status: res.status, json: await res.json() };
};

async function classWith(aiPolicy: "not_allowed" | "labelled", submissionType: "link" | "text" = "text") {
  const [owner, student] = await Promise.all([sql.begin((tx) => createUser(tx)), sql.begin((tx) => createUser(tx))]);
  const org = await sql.begin((tx) => createProject(tx, owner));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${org}, ${owner}, 'owner'), (${org}, ${student}, 'member')`;
  await sql`UPDATE workspaces SET kind = 'organization', org_type = 'education', title = 'Physics 101' WHERE id = ${org}`;
  const [master] = await sql`INSERT INTO tasks (workspace_id, title, kind, creator_id, assignment_settings) VALUES (${org}, 'Essay', 'assignment', ${owner},
    ${sql.json({ version: 1, submissionType, reviewRequired: true, lateRule: "always", target: { mode: "everyone" }, publishedAt: new Date().toISOString(), closedAt: null, aiPolicy, aiNote: "Write it yourself." })}) RETURNING id`;
  const [copy] = await sql`INSERT INTO tasks (workspace_id, title, kind, assignment_id, assignee_id, creator_id, due_date) VALUES (${org}, 'Essay', 'task', ${master!.id}, ${student}, ${owner}, now() + interval '3 days') RETURNING id`;
  return { owner, student, org, master: master!.id as string, copy: copy!.id as string };
}

test("an agent can read a No-AI copy but not comment on it; a labelled one is fine", async () => {
  const strict = await classWith("not_allowed");
  const agent = await token(strict.student, "agent", strict.org);
  const blocked = await call(comments.POST, agent, "POST", "/api/v1/extension/comments", { kind: "task", projectId: strict.org, taskId: strict.copy, text: "done" });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
  assert.equal(blocked.json.errorCode, "AGENT_NOT_ALLOWED");
  assert.match(blocked.json.message, /Write it yourself/);
  const read = await call(view.GET, agent, "GET", `/api/v1/assignments/${strict.copy}`, undefined, { params: Promise.resolve({ copyId: strict.copy }) });
  assert.equal(read.status, 200, JSON.stringify(read.json));
  assert.equal(read.json.data.aiPolicy, "not_allowed");
  const easy = await classWith("labelled");
  const agent2 = await token(easy.student, "agent", easy.org);
  const ok = await call(comments.POST, agent2, "POST", "/api/v1/extension/comments", { kind: "task", projectId: easy.org, taskId: easy.copy, text: "progress" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test("turning agents off in the organization stops every agent request there", async () => {
  const c = await classWith("labelled");
  const agent = await token(c.student, "agent", c.org);
  await sql`UPDATE workspaces SET org_settings = org_settings || '{"allowAgentTokens": false}'::jsonb WHERE id = ${c.org}`;
  const r = await call(view.GET, agent, "GET", `/api/v1/assignments/${c.copy}`, undefined, { params: Promise.resolve({ copyId: c.copy }) });
  assert.equal(r.status, 403);
  assert.equal(r.json.errorCode, "AGENT_NOT_ALLOWED");
});

test("a student lists and hands in; agents can't hand in; a reviewer returns, then approves", async () => {
  const c = await classWith("labelled");
  const mine = await token(c.student, "device");
  const copies = await call(list.GET, mine, "GET", "/api/v1/assignments");
  assert.deepEqual(copies.json.data.copies.map((x: { id: string; state: string }) => [x.id, x.state]), [[c.copy, "not_started"]]);
  const agent = await token(c.student, "agent", c.org);
  const agentHandIn = await call(handIn.POST, agent, "POST", `/api/v1/assignments/${c.copy}/hand-in`, { text: "x" }, { params: Promise.resolve({ copyId: c.copy }) });
  assert.equal(agentHandIn.status, 403, "handing in is the person's act");
  const empty = await call(handIn.POST, mine, "POST", `/api/v1/assignments/${c.copy}/hand-in`, {}, { params: Promise.resolve({ copyId: c.copy }) });
  assert.equal(empty.status, 409);
  assert.match(empty.json.message, /Write your answer/);
  const done = await call(handIn.POST, mine, "POST", `/api/v1/assignments/${c.copy}/hand-in`, { text: "My essay" }, { params: Promise.resolve({ copyId: c.copy }) });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal((await sql`SELECT review_status FROM tasks WHERE id = ${c.copy}`)[0]!.review_status, "pending");
  const teacher = await token(c.owner, "device");
  const queue = await call(reviews.GET, teacher, "GET", `/api/v1/reviews?org=${c.org}`);
  assert.ok(queue.json.data.rows.some((r: { copyId: string }) => r.copyId === c.copy), JSON.stringify(queue.json));
  const noReason = await call(decide.POST, teacher, "POST", `/api/v1/reviews/${c.copy}`, { decision: "return" }, { params: Promise.resolve({ copyId: c.copy }) });
  assert.equal(noReason.status, 400);
  const back = await call(decide.POST, teacher, "POST", `/api/v1/reviews/${c.copy}`, { decision: "return", reason: "Cite sources" }, { params: Promise.resolve({ copyId: c.copy }) });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal((await sql`SELECT review_status FROM tasks WHERE id = ${c.copy}`)[0]!.review_status, "rejected");
});

test("an agent's comment that mentions someone waits for the person's yes (report D12)", async () => {
  const easy = await classWith("labelled");
  const agent = await token(easy.student, "agent", easy.org);
  const held = await call(comments.POST, agent, "POST", "/api/v1/extension/comments", { kind: "task", projectId: easy.org, taskId: easy.copy, text: `@{${easy.owner}|Ms Rao} please look` });
  assert.equal(held.status, 428, JSON.stringify(held.json));
  assert.match(held.json.message, /tells Ms Rao/);
});
