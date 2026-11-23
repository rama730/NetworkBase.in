import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// An in-memory stand-in for the two Redis calls the idempotency helper and send rate limit make.
const store = new Map<string, string>();
const fakeRedis = {
  set: async (key: string, value: string, options?: { nx?: boolean }) => {
    if (options?.nx && store.has(key)) return null;
    store.set(key, value);
    return "OK";
  },
  get: async (key: string) => store.get(key) ?? null,
  eval: async (_script: string, keys: string[], args: string[]) => {
    if (store.get(keys[0]!) !== args[0]) return 0;
    store.set(keys[0]!, args[1]!);
    return 1;
  },
};

let viewerId = "";
let projectId = "";
let taskCreates = 0;
let failTaskCreates = 0;
let lastCreate: Record<string, unknown> | null = null;
let createError = "boom";
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishChannel: () => undefined, publishSentMessage: () => undefined });
moduleStubs.set("@/lib/messaging/send-bucket", { takeSendToken: () => true, takeReactToken: () => true });
moduleStubs.set("@/lib/redis", { getRedisClient: () => fakeRedis, rateLimit: async () => ({ allowed: true }), redis: fakeRedis });
moduleStubs.set("@/app/actions/workspace", {
  createTaskAction: async (data: { title: string }) => {
    taskCreates += 1;
    lastCreate = data;
    if (failTaskCreates > 0) { failTaskCreates -= 1; return { success: false, error: createError }; }
    const [task] = await sql`INSERT INTO tasks (workspace_id, title) VALUES (${projectId}, ${data.title}) RETURNING id`;
    return { success: true, task: { id: task!.id } };
  },
});

let messages: typeof import("../../src/app/actions/chat/messages");
before(async () => {
  messages = await loadAppModule(() => import("../../src/app/actions/chat/messages"));
});
beforeEach(() => { store.clear(); taskCreates = 0; failTaskCreates = 0; lastCreate = null; createError = "boom"; });
after(async () => { await sql.end(); await closeAppDb(); });

async function projectChannel() {
  const owner = await sql.begin((tx) => createUser(tx));
  const other = await sql.begin((tx) => createUser(tx));
  projectId = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, projectId, owner));
  const [{ id: channelId }] = await sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${owner}::uuid, ${`c-${owner.slice(0, 6)}`}, null, false) AS id`;
  const channel = { id: channelId as string };
  const cleanup = async () => {
    await sql`DELETE FROM chat_channels WHERE id = ${channel.id}`;
    await sql`DELETE FROM tasks WHERE workspace_id = ${projectId}`;
  };
  return { owner, other, channelId: channel.id, cleanup };
}

const messageCount = async (channelId: string) => Number((await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id = ${channelId}`)[0]!.n);

// COR-055: one operation id is one task and one card, however many times the call is repeated.
test("repeating a /task with the same operation id creates one task and one card", async () => {
  const f = await projectChannel();
  try {
    viewerId = f.owner;
    const base = await messageCount(f.channelId);
    const operationId = crypto.randomUUID();
    const input = { channelId: f.channelId, title: "Ship it", operationId };
    const first = await messages.createTaskFromMessage(input);
    assert.equal(first.success, true, JSON.stringify(first));
    const again = await messages.createTaskFromMessage(input);
    assert.equal(again.success, true, JSON.stringify(again));
    assert.equal(taskCreates, 1);
    assert.equal(await messageCount(f.channelId), base + 1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${projectId}`)[0]!.n, 1);
  } finally { await f.cleanup(); }
});

test("a failed task creation can be retried with the same operation id", async () => {
  const f = await projectChannel();
  try {
    viewerId = f.owner;
    const base = await messageCount(f.channelId);
    const input = { channelId: f.channelId, title: "Retry me", operationId: crypto.randomUUID() };
    failTaskCreates = 1;
    const failed = await messages.createTaskFromMessage(input);
    assert.deepEqual(failed.success === false && failed.error, "chat_task_create_failed");
    store.clear(); // the pending marker of a failed attempt expires after its TTL
    assert.equal((await messages.createTaskFromMessage(input)).success, true);
    assert.equal(taskCreates, 2);
    assert.equal(await messageCount(f.channelId), base + 1);
  } finally { await f.cleanup(); }
});

// COR-054: the copy a thread reply posts to the channel has an identity derived from the reply's.
test("retrying an also-to-channel reply posts the copy once", async () => {
  const f = await projectChannel();
  try {
    viewerId = f.owner;
    const root = await messages.sendMessage({ channelId: f.channelId, body: "root", clientId: "root-1" });
    assert.equal(root.success, true, JSON.stringify(root));
    const rootSeq = root.success ? root.message.seq : 0;
    const reply = { channelId: f.channelId, body: "also here", threadRootSeq: rootSeq, clientId: "reply-1", alsoToChannel: true };
    const first = await messages.sendMessage(reply);
    assert.equal(first.success && first.alsoSent, true, JSON.stringify(first));
    const afterFirst = await messageCount(f.channelId);
    const retried = await messages.sendMessage(reply);
    assert.equal(retried.success && retried.alsoSent, true);
    assert.equal(await messageCount(f.channelId), afterFirst, "no second copy");
  } finally { await f.cleanup(); }
});

// Report 38.6 W10 (plan A2.3): Report as bug makes a New bug from the message, links back to it and posts its card.
test("Report as bug: a New bug with the message as What happened, a link back, one card; unknown messages refused", async () => {
  const f = await projectChannel();
  try {
    viewerId = f.owner;
    process.env.APP_URL = "https://nb.example";
    const sent = await messages.sendMessage({ channelId: f.channelId, body: "Crash on export\nOpen a file, export" });
    assert.ok(sent.success, JSON.stringify(sent));
    const seq = (sent as { message: { seq: number } }).message.seq;
    const base = await messageCount(f.channelId);
    const input = { channelId: f.channelId, seq, title: "Crash on export", typeFields: { steps: "Crash on export\nOpen a file, export", severity: "major" }, operationId: crypto.randomUUID() };
    const r = await messages.reportBugFromMessage(input);
    assert.equal(r.success, true, JSON.stringify(r));
    assert.deepEqual(lastCreate && { title: lastCreate.title, itemType: lastCreate.itemType, stage: lastCreate.stage, typeFields: lastCreate.typeFields },
      { title: "Crash on export", itemType: "bug", stage: "new", typeFields: { steps: "Crash on export\nOpen a file, export", severity: "major" } });
    const [link] = await sql`SELECT l.url, l.kind FROM task_links l JOIN tasks t ON t.id = l.task_id WHERE t.workspace_id = ${projectId}`;
    assert.ok(String(link?.url).endsWith(`m=${seq}`) && link?.kind === "link", String(link?.url));
    assert.equal(await messageCount(f.channelId), base + 1, "one card");
    assert.equal((await messages.reportBugFromMessage(input)).success, true, "a repeat is the same bug");
    assert.equal(taskCreates, 1);
    const missing = await messages.reportBugFromMessage({ ...input, seq: seq + 50, operationId: crypto.randomUUID() });
    assert.equal(missing.success === false && missing.error, "chat_message_not_found");
    failTaskCreates = 1; createError = "Bugs isn’t in this workspace";
    const off = await messages.reportBugFromMessage({ ...input, operationId: crypto.randomUUID() });
    assert.equal(off.success === false && off.error, "chat_bugs_not_added");
    viewerId = f.other;
    const outsider = await messages.reportBugFromMessage({ ...input, operationId: crypto.randomUUID() });
    assert.equal(outsider.success === false && outsider.error, "chat_task_needs_project", "not in the channel");
  } finally { await f.cleanup(); }
});
