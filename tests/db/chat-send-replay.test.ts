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
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishChannel: () => undefined, publishSentMessage: () => undefined });
moduleStubs.set("@/lib/messaging/send-bucket", { takeSendToken: () => true, takeReactToken: () => true });
moduleStubs.set("@/lib/redis", { getRedisClient: () => fakeRedis, rateLimit: async () => ({ allowed: true }), redis: fakeRedis });
moduleStubs.set("@/app/actions/project", {
  createTaskAction: async (data: { title: string }) => {
    taskCreates += 1;
    if (failTaskCreates > 0) { failTaskCreates -= 1; return { success: false, error: "boom" }; }
    const [task] = await sql`INSERT INTO tasks (project_id, title) VALUES (${projectId}, ${data.title}) RETURNING id`;
    return { success: true, task: { id: task!.id } };
  },
});

let messages: typeof import("../../src/app/actions/chat/messages");
before(async () => {
  messages = await loadAppModule(() => import("../../src/app/actions/chat/messages"));
});
beforeEach(() => { store.clear(); taskCreates = 0; failTaskCreates = 0; });
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
    await sql`DELETE FROM tasks WHERE project_id = ${projectId}`;
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
    assert.equal((await sql`SELECT count(*)::int AS n FROM tasks WHERE project_id = ${projectId}`)[0]!.n, 1);
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
