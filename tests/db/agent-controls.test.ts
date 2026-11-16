import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report F4 (M6): nb agent activity groups your agents' last 24 hours by session; nb agent pause / resume is the
// workspace's switch, for owners and admins, and never for an agent.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });

type Route = (r: Request, c?: any) => Promise<Response>;
let agents: { GET: Route; POST: Route };
before(async () => { agents = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/agents/route")); });
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent" | "pat", workspaceId: string | null, scopes = ["workspace:read", "task:write"]) {
  const t = `nb_${kind === "agent" ? "agt" : kind === "pat" ? "pat" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  if (kind === "pat") {
    await sql`INSERT INTO personal_access_tokens (user_id, label, token_hash, token_prefix, scopes) VALUES (${userId}, 'ci', ${sha(t)}, ${t.slice(0, 12)}, ${sql.json(scopes)})`;
    return t;
  }
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
            VALUES (${userId}, ${sha(t)}, ${t.slice(0, 11)}, 'laptop', '2.3.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Claude Code" : null}, ${workspaceId}, ${sql.json(scopes)})`;
  return t;
}
async function call(handler: Route, t: string, method: string, workspace: string, body?: unknown) {
  const path = `/api/v1/workspaces/${workspace}/agents`;
  headerValues = { authorization: `Bearer ${t}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id: workspace }) });
  return { status: res.status, json: await res.json() as any };
}

test("activity: your agents' last 24 hours, one group per session, with what can still be undone", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  const [s1, s2] = [randomUUID(), randomUUID()];
  const add = (session: string | null, agent: string, summary: string, opts: { ago?: string; used?: boolean; via?: string } = {}) =>
    sql`INSERT INTO undo_operations (user_id, session_id, workspace_id, operation, summary, inverse, via, agent_name, created_at, expires_at, used_at)
        VALUES (${owner}, ${session}, ${workspace}, 'task.status', ${summary}, ${sql.json({ kind: "task.status" })}, ${opts.via ?? "agent"}, ${agent}, now() - ${opts.ago ?? "1 minute"}::interval, now() + interval '23 hours', ${opts.used ? sql`now()` : null})`;
  await add(s1, "Claude Code", "Moved #4 to review", { ago: "2 hours" });
  await add(s1, "Claude Code", "Ticked a subtask on #4", { ago: "1 hour", used: true });
  await add(s2, "Codex", "Commented on #7");
  await add(s2, "Codex", "Old change", { ago: "30 hours" });
  await add(null, "", "Made with the CLI", { via: "cli" });
  const res = await call(agents.GET, await token(owner, "device", null), "GET", workspace);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const sessions = res.json.data.sessions;
  assert.deepEqual(sessions.map((s: any) => [s.agent, s.changes.length]), [["Codex", 1], ["Claude Code", 2]], "newest session first; nothing older than a day; no CLI changes");
  assert.deepEqual(sessions[1].changes.map((c: any) => [c.summary, c.undoable, c.undone]), [["Ticked a subtask on #4", false, true], ["Moved #4 to review", true, false]]);
  const agentToken = await token(owner, "agent", workspace);
  assert.equal((await call(agents.GET, agentToken, "GET", workspace)).status, 403, "an agent can't read its person's view");
});

test("pause and resume: owners and admins; a member is refused, an agent never switches agents back on", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const workspace = await sql.begin((tx) => createProject(tx, owner));
  const member = await sql.begin((tx) => createUser(tx));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${workspace}, ${member}, 'member')`;
  const mine = await token(owner, "device", null);
  const paused = await call(agents.POST, mine, "POST", workspace, { paused: true });
  assert.equal(paused.status, 200, JSON.stringify(paused.json));
  assert.equal(paused.json.data.paused, true);
  const [{ at }] = await sql`SELECT agents_paused_at AS at FROM workspaces WHERE id = ${workspace}`;
  assert.ok(at);
  assert.equal((await call(agents.POST, mine, "POST", workspace, { paused: true })).json.data.pausedAt, new Date(at).toISOString(), "pausing again keeps when it started");
  assert.equal((await call(agents.POST, await token(member, "device", null), "POST", workspace, { paused: false })).status, 403);
  assert.equal((await call(agents.POST, await token(owner, "agent", workspace), "POST", workspace, { paused: false })).status, 403);
  // Security review: a personal access token, or a sign-in without write access, never flips the switch.
  assert.equal((await call(agents.POST, await token(owner, "pat", null), "POST", workspace, { paused: false })).status, 403);
  assert.equal((await call(agents.POST, await token(owner, "device", null, ["workspace:read"]), "POST", workspace, { paused: false })).status, 403);
  const resumed = await call(agents.POST, mine, "POST", workspace, { paused: false });
  assert.equal(resumed.json.data.paused, false);
});
