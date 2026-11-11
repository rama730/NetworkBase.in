import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report A4 (afterwards), A5 (changing access in place, renewal notice), A7 (broad sign-ins first), A8, A10.
let signedIn: string | null = null;
let stepUpOk = false;
const events: string[] = [];
moduleStubs.set("next/headers", { headers: async () => ({ get: () => null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/supabase/server", { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: signedIn ? { id: signedIn } : null } }) } }) });
moduleStubs.set("@/lib/security/step-up", { resolveSecurityStepUp: async () => ({ ok: stepUpOk }) });
moduleStubs.set("@/lib/security/step-up-capabilities", { resolveStepUpCapabilities: async () => ({ availableMethods: ["totp"] }) });
moduleStubs.set("@/lib/security/audit-from-headers", { recordSecurityEventFromHeaders: async (e: { eventType: string }) => { events.push(e.eventType); } });

let actions: typeof import("../../src/app/actions/agent-access");
let settings: typeof import("../../src/lib/agents/access-settings");
let sessions: typeof import("../../src/lib/extension/active-sessions");
before(async () => {
  actions = await loadAppModule(() => import("../../src/app/actions/agent-access"));
  settings = await loadAppModule(() => import("../../src/lib/agents/access-settings"));
  sessions = await loadAppModule(() => import("../../src/lib/extension/active-sessions"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function agent(userId: string, opts: { workspaceId?: string | null; all?: boolean; scopes?: string[]; expiresIn?: string; lastSeen?: string } = {}) {
  const token = `nb_agt_${randomUUID().replace(/-/g, "")}`;
  const [row] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, last_seen_at, token_type, agent_name, workspace_id, all_workspaces, scopes)
    VALUES (${userId}, ${hash(token)}, ${token.slice(0, 11)}, 'laptop', '2.0.4', now() + ${opts.expiresIn ?? "30 days"}::interval, now() - ${opts.lastSeen ?? "0 minutes"}::interval, 'agent', 'Claude Code',
            ${opts.all ? null : opts.workspaceId ?? null}, ${Boolean(opts.all)}, ${sql.json(opts.scopes ?? ["workspace:read", "task:read", "task:write", "file:read", "file:write"])}) RETURNING id`;
  return row!.id as string;
}

test("changing access needs a fresh check, then updates scopes and workspace", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));
  const id = await agent(userId, { workspaceId });
  signedIn = userId;
  stepUpOk = false;
  const refused = await actions.changeAgentAccessAction(id, { access: "read", workspace: "all" });
  assert.equal(refused.success, false);
  assert.equal("stepUpRequired" in refused && refused.stepUpRequired, true);
  const [unchanged] = await sql`SELECT workspace_id FROM extension_device_sessions WHERE id = ${id}`;
  assert.equal(unchanged!.workspace_id, workspaceId);

  stepUpOk = true;
  const changed = await actions.changeAgentAccessAction(id, { access: "read", workspace: "all" });
  assert.equal(changed.success, true);
  const [row] = await sql`SELECT workspace_id, all_workspaces, scopes FROM extension_device_sessions WHERE id = ${id}`;
  assert.equal(row!.workspace_id, null);
  assert.equal(row!.all_workspaces, true);
  assert.deepEqual([...row!.scopes].sort(), ["file:read", "task:read", "workspace:read"]);
  assert.ok(events.includes("agent_access_changed"));
  assert.match((changed as { sentence: string }).sentence, /^Claude Code can read all your workspaces for 30 days/);
});

test("only the owner changes a sign-in, and only to a workspace they can use", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const stranger = await sql.begin((tx) => createUser(tx));
  const theirs = await sql.begin((tx) => createProject(tx, stranger));
  const id = await agent(owner, { all: true });
  stepUpOk = true;
  signedIn = stranger;
  assert.equal((await actions.changeAgentAccessAction(id, { access: "small", workspace: "all" })).success, false);
  signedIn = owner;
  const elsewhere = await actions.changeAgentAccessAction(id, { access: "small", workspace: theirs });
  assert.equal(elsewhere.success, false);
  assert.match((elsewhere as { error: string }).error, /workspace/i);
});

test("renewing extends the end date; the daily notice goes out once per sign-in", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const soon = await agent(userId, { all: true, expiresIn: "3 days" });
  await agent(userId, { all: true, expiresIn: "60 days" });
  signedIn = userId;
  stepUpOk = true;
  const renewed = await actions.renewAgentAccessAction(soon, 30);
  assert.equal(renewed.success, true);
  const [row] = await sql`SELECT expires_at FROM extension_device_sessions WHERE id = ${soon}`;
  assert.ok(new Date(row!.expires_at).getTime() > Date.now() + 29 * 86_400_000);

  const other = await sql.begin((tx) => createUser(tx));
  const ending = await agent(other, { all: true, expiresIn: "2 days" });
  await settings.sendAgentRenewalNotices();
  await settings.sendAgentRenewalNotices();
  const notes = await sql`SELECT title, href FROM user_notifications WHERE user_id = ${other} AND kind = 'agent_access_expiring'`;
  assert.equal(notes.length, 1, "one notice, however often the job runs");
  assert.equal(notes[0]!.href, `/settings/agents/${ending}`);
  assert.match(notes[0]!.title, /Claude Code's access ends in 2 days/);
});

test("Settings lists broad sign-ins first and gives each agent its sentence", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const workspaceId = await sql.begin((tx) => createProject(tx, userId));
  await agent(userId, { workspaceId, lastSeen: "1 minute" });
  const broad = await agent(userId, { all: true, lastSeen: "1 hour", scopes: ["workspace:read", "task:read", "task:write", "file:read", "file:write", "task:complete", "file:final", "doc:write"] });
  const { sessions: list } = await sessions.listActiveExtensionSessionsForUser(userId);
  assert.equal(list[0]!.id, broad);
  assert.match(list[0]!.accessSentence!, /^Claude Code can work in all your workspaces/);
});

test("the agent's own page shows its sentence and the requests waiting for an answer", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const id = await agent(userId, { all: true });
  await sql`INSERT INTO agent_access_requests (session_id, user_id, scope, method, path, expires_at) VALUES (${id}, ${userId}, 'task:complete', 'PATCH', '/api/v1/extension/task-update', now() + interval '1 day')`;
  const page = await settings.agentSettingsView(userId, id);
  assert.ok(page);
  assert.equal(page!.preset, "small");
  assert.equal(page!.workspace, "all");
  assert.deepEqual(page!.requests.map((r) => r.words), ["finish tasks"]);
  assert.equal(await settings.agentSettingsView(await sql.begin((tx) => createUser(tx)), id), null, "someone else's agent is not found");
});
