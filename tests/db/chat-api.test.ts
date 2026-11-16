import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report C4 (M4d): nb message list / read / send over the app's own chat functions. Your sign-in reads and sends as
// you; agents never do; @handles of members become mentions; people you blocked fold away; reading moves the marker.
let headerValues: Record<string, string> = {};
moduleStubs.set("next/headers", { headers: async () => ({ get: (name: string) => headerValues[name.toLowerCase()] ?? null }), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });
moduleStubs.set("@/lib/security/csrf", { validateCsrf: () => null });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishUserEvents: () => undefined, publishChannel: () => undefined, publishSentMessage: async () => undefined });

let list: typeof import("../../src/app/api/v1/chat/conversations/route");
let messages: typeof import("../../src/app/api/v1/chat/conversations/[channelId]/messages/route");
let read: typeof import("../../src/app/api/v1/chat/conversations/[channelId]/read/route");
before(async () => {
  list = await loadAppModule(() => import("../../src/app/api/v1/chat/conversations/route"));
  messages = await loadAppModule(() => import("../../src/app/api/v1/chat/conversations/[channelId]/messages/route"));
  read = await loadAppModule(() => import("../../src/app/api/v1/chat/conversations/[channelId]/read/route"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function token(userId: string, kind: "device" | "agent" | "pat" = "device", scopes: string[] = []) {
  const raw = `nb_${kind === "agent" ? "agt" : kind === "pat" ? "pat" : "dev"}_${randomUUID().replace(/-/g, "")}`;
  // An agent here has all workspaces, so only the routes' own refusal stops it.
  await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name, scopes, all_workspaces)
            VALUES (${userId}, ${hash(raw)}, ${raw.slice(0, 11)}, 'laptop', '2.1.6', now() + interval '1 day', ${kind}, ${kind === "agent" ? "Claude Code" : null}, ${sql.json(scopes)}, ${kind === "agent"})`;
  return raw;
}
async function call(raw: string, method: "GET" | "POST", path: string, handler: (r: Request, c: any) => Promise<Response>, channelId?: string, body?: unknown) {
  headerValues = { authorization: `Bearer ${raw}`, "x-networkbase-request-method": method, "x-networkbase-request-target": path.split("?")[0]! };
  const res = await handler(new Request(`https://app.test${path}`, { method, headers: { authorization: `Bearer ${raw}`, "content-type": "application/json", "idempotency-key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ channelId }) });
  return { status: res.status, body: await res.json() };
}

async function team() {
  const [owner, sam, stranger] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql.begin(async (tx) => { await addMember(tx, ws, owner!, "owner"); await addMember(tx, ws, sam!); });
  const name = `design-${owner!.slice(0, 6)}`;
  const [{ id }] = await sql`SELECT app_private.chat_create_channel(${ws}::uuid, ${owner!}::uuid, ${name}, null, false) AS id`;
  await sql`SELECT app_private.chat_join_channel(${id}::uuid, ${sam!}::uuid)`.catch(async () => {
    await sql`INSERT INTO chat_channel_members (channel_id, user_id) VALUES (${id}, ${sam!}) ON CONFLICT DO NOTHING`;
  });
  const [samProfile] = await sql`SELECT username FROM profiles WHERE id = ${sam!}`;
  return { owner: owner!, sam: sam!, stranger: stranger!, channelId: id as string, name, samHandle: samProfile!.username as string };
}

test("your sign-in lists, reads and sends; @handles of members become mentions; reading moves the marker", async () => {
  const t = await team();
  const mine = await token(t.owner);
  const path = `/api/v1/chat/conversations/${t.channelId}/messages`;
  const sent = await call(mine, "POST", path, messages.POST, t.channelId, { text: `@${t.samHandle} the logo is ready, @nobody_here` });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const [row] = await sql`SELECT body FROM chat_messages WHERE channel_id = ${t.channelId} ORDER BY channel_seq DESC LIMIT 1`;
  assert.equal(row!.body, `<@${t.sam}> the logo is ready, @nobody_here`, "a member's handle is a mention; anyone else stays text");

  const samToken = await token(t.sam);
  const conversations = await call(samToken, "GET", "/api/v1/chat/conversations", list.GET);
  assert.equal(conversations.status, 200, JSON.stringify(conversations.body));
  const mine1 = conversations.body.data.conversations.find((c: { id: string }) => c.id === t.channelId);
  assert.equal(mine1.label, `#${t.name}`);
  assert.equal(mine1.kind, "channel");
  assert.ok(mine1.unread >= 1, JSON.stringify(mine1));

  const page = await call(samToken, "GET", path, messages.GET, t.channelId);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  const last = page.body.data.messages.at(-1);
  assert.equal(last.text, `@${t.samHandle} the logo is ready, @nobody_here`, "mentions read back as @handle");
  const marked = await call(samToken, "POST", `/api/v1/chat/conversations/${t.channelId}/read`, read.POST, t.channelId, { seq: last.seq });
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  const after1 = (await call(samToken, "GET", "/api/v1/chat/conversations", list.GET)).body.data.conversations.find((c: { id: string }) => c.id === t.channelId);
  assert.equal(after1.unread, 0);
});

test("agents never read or send; tokens need the message permissions; outsiders find nothing", async () => {
  const t = await team();
  const path = `/api/v1/chat/conversations/${t.channelId}/messages`;
  const agent = await token(t.owner, "agent", ["workspace:read", "task:read", "message:read", "message:write"]);
  assert.equal((await call(agent, "GET", "/api/v1/chat/conversations", list.GET)).status, 403);
  assert.equal((await call(agent, "POST", path, messages.POST, t.channelId, { text: "hi" })).status, 403);
  const narrow = await token(t.owner, "device", ["workspace:read", "task:read"]);
  assert.equal((await call(narrow, "GET", "/api/v1/chat/conversations", list.GET)).status, 403, "a token without message:read");
  const outsider = await token(t.stranger);
  const peek = await call(outsider, "GET", path, messages.GET, t.channelId);
  assert.equal(peek.body.data?.messages?.length ?? 0, 0, "a stranger reads nothing");
  assert.equal((await call(outsider, "POST", path, messages.POST, t.channelId, { text: "hi" })).status, 404);
});

test("messages from someone you blocked fold away", async () => {
  const t = await team();
  const path = `/api/v1/chat/conversations/${t.channelId}/messages`;
  await call(await token(t.sam), "POST", path, messages.POST, t.channelId, { text: "secret plans" });
  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${t.owner}, ${t.sam})`;
  const page = await call(await token(t.owner), "GET", path, messages.GET, t.channelId);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.ok(!JSON.stringify(page.body).includes("secret plans"));
  assert.match(page.body.data.messages.at(-1).text, /hidden/);
});
