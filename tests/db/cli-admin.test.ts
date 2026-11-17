import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part F (M7): "Verify it's you" for a terminal (F5), the agent policy from the terminal (only stricter, F3),
// and the export's JSON of tasks, comments and docs (F8).
let headerValues: Record<string, string> = {};
let viewer: string | null = null;
moduleStubs.set("next/headers", { headers: async () => ({ get: (n: string) => headerValues[n.toLowerCase()] ?? null, entries: () => Object.entries(headerValues)[Symbol.iterator]() }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
moduleStubs.set("@/lib/supabase/server", { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }), createAdminClient: async () => ({ storage: { from: () => ({}) } }) });

type Route = (r: Request, c?: unknown) => Promise<Response>;
let stepUp: typeof import("../../src/lib/security/cli-step-up");
let grant: typeof import("../../src/app/actions/cli-step-up");
let exporter: typeof import("../../src/lib/workspaces/server/workspace-export");
let agents: { POST: Route };
let exportRoute: { GET: Route };
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  moduleStubs.set("@/lib/server/viewer-context", {
    ...viewerContext,
    getViewerAuthContext: async () => ({ supabase: null, snapshot: viewer ? {} : null, user: viewer ? { id: viewer } : null, userId: viewer, emailVerified: true }),
  });
  stepUp = await loadAppModule(() => import("../../src/lib/security/cli-step-up"));
  grant = await loadAppModule(() => import("../../src/app/actions/cli-step-up"));
  exporter = await loadAppModule(() => import("../../src/lib/workspaces/server/workspace-export"));
  agents = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/agents/route"));
  exportRoute = await loadAppModule(() => import("../../src/app/api/v1/workspaces/[id]/export/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
async function session(userId: string, kind: "device" | "agent", workspaceId: string | null = null) {
  const t = `nb_${kind === "agent" ? "agt" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  const [row] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, workspace_id, scopes)
    VALUES (${userId}, ${sha(t)}, ${t.slice(0, 11)}, 'laptop', '2.5.0', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Claude Code" : null}, ${workspaceId}, ${sql.json([])}) RETURNING id`;
  return { token: t, id: row!.id as string };
}

test("a terminal must verify in the browser for risky actions; the grant is the person's own sign-in, for 10 minutes", async () => {
  const me = await sql.begin((tx) => createUser(tx));
  const other = await sql.begin((tx) => createUser(tx));
  const dev = await session(me, "device");
  const req = new Request("https://app.test/api/v1/workspaces/x/archive", { method: "POST" });
  const auth = (id: string, kind: "device" | "agent") => ({ user: { id: me }, tokenScopes: new Set<string>(), tokenKind: kind, extensionSessionId: id });
  const first = await stepUp.requireStepUp(auth(dev.id, "device"), req, "archive a workspace");
  assert.equal(first?.status, 403);
  const body = await first!.json() as { errorCode: string; details: { url: string } };
  assert.equal(body.errorCode, "STEP_UP_REQUIRED");
  assert.match(body.details.url, new RegExp(`/cli/verify\\?s=${dev.id}$`));
  const agent = await session(me, "agent", await sql.begin((tx) => createProject(tx, me)));
  assert.equal((await stepUp.requireStepUp(auth(agent.id, "agent"), req, "archive a workspace"))?.status, 403, "agents never");
  // The browser page: someone else can't grant my sign-in; I can, and then it passes.
  viewer = other;
  assert.equal((await grant.grantCliStepUpAction(dev.id)).success, false);
  viewer = me;
  assert.equal((await grant.grantCliStepUpAction(agent.id)).success, false, "never an agent's sign-in");
  const ok = await grant.grantCliStepUpAction(dev.id);
  assert.equal(ok.success, true);
  assert.equal(await stepUp.requireStepUp(auth(dev.id, "device"), req, "archive a workspace"), null);
  await sql`UPDATE extension_device_sessions SET step_up_until = now() - interval '1 second' WHERE id = ${dev.id}`;
  assert.equal((await stepUp.requireStepUp(auth(dev.id, "device"), req, "archive a workspace"))?.status, 403, "it lapses");
});

test("the agent policy from the terminal: stricter only; looser is the app's", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  const dev = await session(owner, "device");
  const call = async (policy: string) => {
    headerValues = { authorization: `Bearer ${dev.token}`, "x-networkbase-request-method": "POST", "x-networkbase-request-target": `/api/v1/workspaces/${ws}/agents` };
    const res = await agents.POST(new Request(`https://app.test/api/v1/workspaces/${ws}/agents`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ policy }) }), { params: Promise.resolve({ id: ws }) });
    return { status: res.status, json: await res.json() as { data?: { policy: string }; errorCode?: string } };
  };
  const strict = await call("ask_all");
  assert.equal(strict.status, 200, JSON.stringify(strict.json));
  assert.equal(strict.json.data?.policy, "ask_all");
  const loose = await call("trust_drafts_docs");
  assert.equal(loose.status, 403);
  const [row] = await sql`SELECT agent_policy FROM workspaces WHERE id = ${ws}`;
  assert.equal(row!.agent_policy, "ask_all");
});

test("export.json: tasks with their comments, people by username, deleted comments left out", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  viewer = owner;
  const [t] = await sql`INSERT INTO tasks (workspace_id, title, creator_id, assignee_id, status, task_number) VALUES (${ws}, 'Fix login', ${owner}, ${owner}, 'todo', 1) RETURNING id`;
  await sql`INSERT INTO task_comments (task_id, user_id, content) VALUES (${t!.id}, ${owner}, 'On it'), (${t!.id}, ${owner}, 'gone')`;
  await sql`UPDATE task_comments SET deleted_at = now() WHERE content = 'gone'`;
  const out = await exporter.buildExportJson(ws);
  assert.equal(out.format, "networkbase-export/1");
  assert.equal(out.tasks.length, 1);
  assert.deepEqual(out.tasks[0]!.comments.map((c) => c.text), ["On it"]);
  const [p] = await sql`SELECT username FROM profiles WHERE id = ${owner}`;
  assert.equal(out.tasks[0]!.assignee, p!.username);
});

test("export is a backup for owners and admins: a member is refused before anything is read", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const member = await sql.begin((tx) => createUser(tx));
  const ws = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, ws, member, "member"));
  const dev = await session(member, "device");
  headerValues = { authorization: `Bearer ${dev.token}`, "x-networkbase-request-method": "GET", "x-networkbase-request-target": `/api/v1/workspaces/${ws}/export` };
  const res = await exportRoute.GET(new Request(`https://app.test/api/v1/workspaces/${ws}/export`), { params: Promise.resolve({ id: ws }) });
  assert.equal(res.status, 403, await res.clone().text());
  assert.equal((await res.json() as { errorCode: string }).errorCode, "FORBIDDEN");
});
