/**
 * Runs every chat server action against a disposable database with the real
 * SQL (plan Phase 2 gate). Only sign-in, Next's after(), the Realtime REST call
 * and Redis are stubbed.
 *   DATABASE_URL_FRESH=postgresql://postgres@localhost:54329/nb_chat_test npm run check:chat:actions
 */
import { randomUUID } from "node:crypto";
import Module from "node:module";

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
const disposableUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL_FRESH;
if (!disposableUrl) throw new Error("check:chat:actions requires DATABASE_URL_FRESH or E2E_DATABASE_URL.");
if (disposableUrl === process.env.DATABASE_URL) throw new Error("Refusing to run against DATABASE_URL.");
process.env.DATABASE_URL = disposableUrl;

let currentUser: { id: string; user_metadata: Record<string, unknown> } | null = null;
const broadcasts: Array<{ topic: string; event: string }> = [];
const pending: Promise<unknown>[] = [];

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function load(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request.endsWith("supabase/auth-user")) return { getAuthUser: async () => currentUser };
  if (request === "next/server") return { after: (task: () => unknown) => { pending.push(Promise.resolve().then(task)); } };
  if (request.endsWith("realtime/server-broadcast")) {
    return { broadcast: async (messages: Array<{ topic: string; event: string }>) => { broadcasts.push(...messages); return true; } };
  }
  if (request.endsWith("lib/redis")) return { rateLimit: async () => true, getRedisClient: () => null };
  return originalLoad.call(this, request, parent, isMain);
};

const failures: string[] = [];
let passed = 0;
async function check(label: string, run: () => Promise<boolean>) {
  try {
    if (await run()) passed += 1;
    else failures.push(label);
  } catch (error) {
    failures.push(`${label} (threw: ${(error as Error).message})`);
  }
}

async function main() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(disposableUrl!, { max: 4, prepare: false, onnotice: () => undefined });
  const channels = await import("@/app/actions/chat/channels");
  const members = await import("@/app/actions/chat/members");
  const messages = await import("@/app/actions/chat/messages");
  const read = await import("@/app/actions/chat/read");
  const activity = await import("@/app/actions/chat/activity");

  const [owner, member, outsider] = [randomUUID(), randomUUID(), randomUUID()] as const;
  const projectId = randomUUID();
  const taskId = randomUUID();
  const as = (id: string, name: string) => { currentUser = { id, user_metadata: { full_name: name, username: name.toLowerCase() } }; };
  const flush = async () => { await Promise.all(pending.splice(0)); };

  try {
    await sql`
      INSERT INTO profiles (id, email, username, full_name, message_privacy) VALUES
        (${owner}, ${`a-${owner}@example.test`}, ${`ownerx${owner.slice(0, 8)}`}, 'Olivia Owner', 'connections'),
        (${member}, ${`b-${member}@example.test`}, ${`memberx${member.slice(0, 8)}`}, 'Mason Member', 'everyone'),
        (${outsider}, ${`c-${outsider}@example.test`}, ${`outsiderx${outsider.slice(0, 8)}`}, 'Oscar Outsider', 'connections')
    `;
    await sql`INSERT INTO projects (id, owner_id, title) VALUES (${projectId}, ${owner}, 'Actions test')`;
    await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${projectId}, ${owner}, 'owner'), (${projectId}, ${member}, 'member')`;
    await sql`INSERT INTO tasks (id, project_id, title) VALUES (${taskId}, ${projectId}, 'Linked task')`;
    const [syncRow] = await sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, NULL::uuid, 'ensure_default') AS general`;
    const general = String(syncRow?.general);

    currentUser = null;
    await check("signed-out callers are refused", async () => (await read.bootstrap()).success === false);

    as(owner, "Olivia");
    const created = await channels.createChannel({ projectId, name: "launch", description: "Launch plan" });
    const launch = created.success ? created.channelId : "";
    await check("createChannel returns the new channel", async () => created.success && Boolean(launch));
    await check("createChannel rejects a bad name before SQL", async () => (await channels.createChannel({ projectId, name: "Bad Name" })).success === false);

    as(member, "Mason");
    await check("browseChannels lists public channels with joined flags", async () => {
      const result = await channels.browseChannels({ projectId });
      return result.success && result.channels.some((c) => c.id === launch && !c.joined) && result.channels.some((c) => c.is_default && c.joined);
    });
    await check("joinChannel then getChannel shows membership", async () => {
      const joined = await channels.joinChannel({ channelId: launch });
      const details = await channels.getChannel({ channelId: launch });
      return joined.success && details.success && details.channel.is_member && details.channel.name === "launch";
    });

    as(owner, "Olivia");
    const dm = await members.getOrCreateDm({ userId: member });
    const dmId = dm.success ? dm.channelId : "";
    await check("getOrCreateDm opens the DM", async () => dm.success && Boolean(dmId));
    as(outsider, "Oscar");
    await check("privacy refuses a DM to a connections-only stranger", async () => {
      const refused = await members.getOrCreateDm({ userId: owner });
      return !refused.success && refused.error === "chat_dm_not_allowed";
    });

    as(owner, "Olivia");
    const sent = await messages.sendMessage({ channelId: dmId, body: `hello <@${member}>`, clientId: "client-1" });
    await flush();
    await check("sendMessage returns the message and publishes message.new plus a hint", async () =>
      sent.success && sent.message.seq > 0
      && broadcasts.some((b) => b.event === "message.new" && b.topic === `chat:channel:${dmId}`)
      && broadcasts.some((b) => b.event === "hint" && b.topic === `chat:user:${member}`));
    await check("sendMessage is idempotent on clientId", async () => {
      const again = await messages.sendMessage({ channelId: dmId, body: `hello <@${member}>`, clientId: "client-1" });
      return again.success && sent.success && again.message.seq === sent.message.seq;
    });
    await check("outsider cannot send", async () => {
      as(outsider, "Oscar");
      const result = await messages.sendMessage({ channelId: dmId, body: "hi" });
      as(owner, "Olivia");
      return !result.success && result.error === "chat_not_member";
    });
    await check("attachments must be the sender's own verified assets", async () => {
      const result = await messages.sendMessage({ channelId: dmId, body: "file", assetIds: [randomUUID()] });
      return !result.success && result.error === "chat_attachment_not_ready";
    });

    const root = await messages.sendMessage({ channelId: general, body: "thread root" });
    const rootSeq = root.success ? root.message.seq : 0;
    as(member, "Mason");
    await messages.sendMessage({ channelId: general, body: "reply", threadRootSeq: rootSeq });
    await check("listMessages returns top-level only, oldest first", async () => {
      const page = await messages.listMessages({ channelId: general });
      return page.success && page.messages.every((m) => m.thread_root_seq === null)
        && page.messages.some((m) => m.seq === rootSeq && m.reply_count === 1);
    });
    await check("listThread returns root and replies", async () => {
      const thread = await messages.listThread({ channelId: general, rootSeq });
      return thread.success && thread.root?.seq === rootSeq && thread.replies.length === 1;
    });
    await check("react, then reactions are grouped with me=true", async () => {
      await messages.react({ channelId: general, seq: rootSeq, emoji: "🎉", on: true });
      const page = await messages.listMessages({ channelId: general, around: rootSeq });
      const rootRow = page.success ? page.messages.find((m) => m.seq === rootSeq) : undefined;
      return rootRow?.reactions.length === 1 && rootRow.reactions[0]?.me === true && rootRow.reactions[0]?.count === 1;
    });

    as(owner, "Olivia");
    await sql`
      SELECT app_private.chat_send_message(${general}::uuid, ${owner}::uuid, '', NULL, NULL, '{}', NULL, '[]',
        ${sql.json({ kind: "task", ref_id: taskId })})
    `;
    await check("task cards hydrate for project members", async () => {
      const page = await messages.listMessages({ channelId: general });
      const card = page.success ? page.cards[`task:${taskId}`] : undefined;
      return Boolean(card && "title" in card && card.title === "Linked task");
    });
    await check("pin then listPins", async () => {
      await messages.pinMessage({ channelId: general, seq: rootSeq, on: true });
      const pins = await messages.listPins({ channelId: general });
      return pins.success && pins.messages.some((m) => m.seq === rootSeq && m.pinned);
    });
    await check("edit and delete publish their events", async () => {
      if (!root.success) return false;
      const edited = await messages.editMessage({ channelId: general, seq: rootSeq, body: "edited root" });
      await flush();
      return edited.success && broadcasts.some((b) => b.event === "message.edit");
    });

    as(member, "Mason");
    await check("bootstrap returns channels, projects and pending counts", async () => {
      const result = await read.bootstrap();
      return result.success && result.data.channels.some((c) => c.id === dmId && c.dm_user?.id === owner)
        && (result.data.projects ?? []).some((p) => p.id === projectId) && typeof result.pending.invites === "number";
    });
    await check("markRead moves the cursor once and publishes read.moved", async () => {
      const [lastRow] = await sql`SELECT last_seq::int AS last FROM chat_channels WHERE id = ${general}`;
      const last = Number(lastRow?.last);
      const first = await read.markRead({ channelId: general, seq: last });
      const second = await read.markRead({ channelId: general, seq: last });
      await flush();
      return first.success && first.moved && second.success && !second.moved && broadcasts.some((b) => b.event === "read.moved");
    });
    await check("activity lists the mention", async () => {
      const result = await activity.listActivity();
      return result.success && result.items.some((item) => item.channel_id === dmId && item.kind === "user");
    });
    await check("threads lists the followed thread", async () => {
      const result = await activity.listThreads();
      return result.success && result.threads.some((t) => t.channel_id === general && t.root_seq === rootSeq);
    });
    await check("direct message list includes the DM with its preview", async () => {
      const result = await activity.listDirectMessages();
      return result.success && result.channels.some((c) => c.id === dmId && Boolean(c.last_preview));
    });
    await check("setMemberState stars and mutes", async () => {
      const result = await members.setMemberState({ channelId: dmId, starred: true, notify: "mute" });
      const [row] = await sql`SELECT starred, notify FROM chat_channel_members WHERE channel_id = ${dmId} AND user_id = ${member}`;
      return result.success && row?.starred === true && row.notify === "mute";
    });
    await check("searchPeople finds by name with DM eligibility (privacy applies)", async () => {
      const result = await members.searchPeople({ query: "Olivia Own" });
      return result.success && result.people.some((p) => p.id === owner && p.can_dm === false);
    });
    await check("listMembers returns roles", async () => {
      const result = await channels.listMembers({ channelId: general });
      return result.success && result.members.some((m) => m.id === owner && m.role === "owner");
    });
    await check("leaveChannel works for non-default channels only", async () => {
      const left = await channels.leaveChannel({ channelId: launch });
      const refused = await channels.leaveChannel({ channelId: general });
      return left.success && !refused.success;
    });
  } finally {
    await sql`DELETE FROM chat_channels WHERE project_id = ${projectId} OR id IN (
      SELECT channel_id FROM chat_channel_members WHERE user_id IN (${owner}, ${member}, ${outsider}))`.catch(() => undefined);
    await sql`DELETE FROM tasks WHERE id = ${taskId}`.catch(() => undefined);
    await sql`DELETE FROM projects WHERE id = ${projectId}`.catch(() => undefined);
    await sql`DELETE FROM profiles WHERE id IN (${owner}, ${member}, ${outsider})`.catch(() => undefined);
    await sql.end();
  }

  if (failures.length) {
    console.error(`✗ chat actions: ${failures.length} failed, ${passed} passed`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`✓ chat actions: ${passed} checks passed`);
  process.exit(0);
}

void main();
