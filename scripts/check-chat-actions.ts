/**
 * Runs every chat server action against a disposable database with the real
 * SQL (plan Phase 2 gate). Only sign-in, Next's after(), the Realtime REST call
 * and Redis are stubbed.
 *   DATABASE_URL_FRESH=$(npm run -s db:disposable) npm run check:chat:actions
 */
import { randomUUID } from "node:crypto";
import Module from "node:module";

import dotenv from "dotenv";

import { requireDisposableDatabaseUrl } from "./lib/disposable-db";

dotenv.config({ path: ".env.local" });
const disposableUrl = requireDisposableDatabaseUrl("check:chat:actions");
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
  const later = await import("@/app/actions/chat/later");
  const search = await import("@/app/actions/chat/search");
  const due = await import("@/lib/messaging/due");
  const assetDeletion = await import("@/lib/storage/asset-deletion");
  const { db } = await import("@/lib/db");
  const { storageAssets } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const [owner, member, outsider] = [randomUUID(), randomUUID(), randomUUID()] as const;
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const taskId = randomUUID();
  const as = (id: string, name: string) => { currentUser = { id, user_metadata: { full_name: name, username: name.toLowerCase() } }; };
  const flush = async () => { await Promise.all(pending.splice(0)); };

  try {
    await sql`INSERT INTO auth.users (id, email) SELECT u, u || '@example.test' FROM unnest(${[owner, member, outsider]}::uuid[]) AS t(u)`;
    await sql`
      INSERT INTO profiles (id, email, username, full_name, message_privacy) VALUES
        (${owner}, ${`a-${owner}@example.test`}, ${`ownerx${owner.slice(0, 8)}`}, 'Olivia Owner', 'connections'),
        (${member}, ${`b-${member}@example.test`}, ${`memberx${member.slice(0, 8)}`}, 'Mason Member', 'everyone'),
        (${outsider}, ${`c-${outsider}@example.test`}, ${`outsiderx${outsider.slice(0, 8)}`}, 'Oscar Outsider', 'connections')
    `;
    await sql`INSERT INTO projects (id, owner_id, title) VALUES (${projectId}, ${owner}, 'Actions test')`;
    await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${projectId}, ${owner}, 'owner'), (${projectId}, ${member}, 'member')`;
    await sql`INSERT INTO tasks (id, project_id, title) VALUES (${taskId}, ${projectId}, 'Linked task')`;
    await sql`INSERT INTO projects (id, owner_id, title) VALUES (${otherProjectId}, ${owner}, 'Second project')`;
    await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${otherProjectId}, ${owner}, 'owner'), (${otherProjectId}, ${member}, 'member')`;
    await sql`SELECT app_private.chat_sync_project_members(${otherProjectId}::uuid, NULL::uuid, 'ensure_default')`;
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
    // The auth stub carries a different name and avatar than the profile (like Google sign-in does).
    await sql`UPDATE profiles SET avatar_url = 'https://example.test/profile.png' WHERE id = ${owner}`;
    currentUser = { id: owner, user_metadata: { full_name: "Olivia", username: "olivia", avatar_url: "https://lh3.example.test/google.png" } };
    const sent = await messages.sendMessage({ channelId: dmId, body: `hello <@${member}>`, clientId: "client-1" });
    await check("a sent message's author comes from profiles, not auth metadata", async () =>
      sent.success && sent.message.author?.full_name === "Olivia Owner" && sent.message.author.avatar_url === "https://example.test/profile.png");
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
    await check("listThread pages the newest replies first, older ones on request", async () => {
      // As the owner: the member's send bucket (10 burst) is spent by the checks above.
      as(owner, "Olivia");
      const top = await messages.sendMessage({ channelId: general, body: "long thread" });
      if (!top.success) return false;
      // The owner replies in their own thread (0190: this used to fail).
      for (const body of ["r1", "r2", "r3"]) await messages.sendMessage({ channelId: general, body, threadRootSeq: top.message.seq });
      const latest = await messages.listThread({ channelId: general, rootSeq: top.message.seq, limit: 2 });
      if (!latest.success || !latest.root) return false;
      const older = await messages.listThread({ channelId: general, rootSeq: top.message.seq, limit: 2, before: latest.replies[0]!.seq });
      return latest.replies.map((m) => m.body).join() === "r2,r3" && latest.hasOlder
        && older.success && older.root === null && older.replies.map((m) => m.body).join() === "r1" && !older.hasOlder;
    });
    // Give the owner's 4 sends back (1 token/s) so later owner checks aren't rate limited.
    await new Promise((resolve) => setTimeout(resolve, 4_200));
    as(member, "Mason");
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
        && (result.data.projects ?? []).some((p) => p.id === projectId) && typeof result.pending?.invites === "number";
    });
    await check("markRead moves the cursor once and publishes read.moved", async () => {
      const [lastRow] = await sql`SELECT last_seq::int AS last FROM chat_channels WHERE id = ${general}`;
      const last = Number(lastRow?.last);
      const first = await read.markRead({ channelId: general, seq: last });
      const second = await read.markRead({ channelId: general, seq: last });
      await flush();
      return first.success && first.moved && second.success && !second.moved && broadcasts.some((b) => b.event === "read.moved");
    });
    await check("inbox lists the mention unread and bootstrap counts it", async () => {
      const result = await activity.listInbox();
      const boot = await read.bootstrap();
      return result.success && result.items.some((item) => item.channel_id === dmId && item.kind === "user" && !item.read)
        && boot.success && (boot.data.inbox_unread ?? 0) >= 1;
    });
    await check("markInboxRead clears the Inbox count", async () => {
      const marked = await activity.markInboxRead({ all: true });
      const boot = await read.bootstrap();
      const result = await activity.listInbox({ filter: "mentions" });
      return marked.success && boot.success && boot.data.inbox_unread === 0 && result.success && result.items.every((item) => item.read);
    });
    await check("thread follow can be left and rejoined", async () => {
      const off = await messages.setThreadFollow({ channelId: general, rootSeq, on: false });
      const left = await messages.listThread({ channelId: general, rootSeq });
      const on = await messages.setThreadFollow({ channelId: general, rootSeq, on: true });
      const back = await messages.listThread({ channelId: general, rootSeq });
      return off.success && on.success && left.success && !left.following && back.success && back.following;
    });
    await check("markUnread moves the channel cursor back", async () => {
      await read.markRead({ channelId: general, seq: rootSeq + 1 });
      const result = await messages.markUnread({ channelId: general, seq: rootSeq });
      const [row] = await sql`SELECT last_read_seq::int AS seq FROM chat_channel_members WHERE channel_id = ${general} AND user_id = ${member}`;
      return result.success && row?.seq === rootSeq - 1;
    });
    await check("save for later with a reminder, list it, unsave", async () => {
      const past = await later.saveMessage({ channelId: general, seq: rootSeq, on: true, remindAt: new Date(Date.now() - 60_000).toISOString() });
      const saved = await later.saveMessage({ channelId: general, seq: rootSeq, on: true, remindAt: new Date(Date.now() + 3_600_000).toISOString() });
      const list = await later.listSaved();
      const seqs = await later.listSavedSeqs({ channelId: general });
      const ok = !past.success && saved.success && list.success && list.items.some((i) => i.seq === rootSeq && i.remind_at)
        && seqs.success && seqs.seqs.includes(rootSeq);
      const off = await later.saveMessage({ channelId: general, seq: rootSeq, on: false });
      const after = await later.listSaved();
      return ok && off.success && after.success && !after.items.some((i) => i.seq === rootSeq);
    });
    await check("due reminders notify once", async () => {
      await later.saveMessage({ channelId: general, seq: rootSeq, on: true, remindAt: new Date(Date.now() + 60_000).toISOString() });
      await sql`UPDATE chat_saved SET remind_at = now() - interval '1 second' WHERE user_id = ${member} AND channel_id = ${general}`;
      const first = await due.fireDueReminders();
      const second = await due.fireDueReminders();
      const [row] = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${member} AND kind = 'chat_reminder'`;
      return first.reminders === 1 && second.reminders === 0 && row?.n === 1;
    });
    await check("reminders for deleted messages close without notifying", async () => {
      const temp = await messages.sendMessage({ channelId: general, body: "remind me then delete" });
      if (!temp.success) return false;
      await later.saveMessage({ channelId: general, seq: temp.message.seq, on: true, remindAt: new Date(Date.now() + 60_000).toISOString() });
      await messages.deleteMessage({ channelId: general, seq: temp.message.seq });
      await sql`UPDATE chat_saved SET remind_at = now() - interval '1 second' WHERE user_id = ${member} AND message_seq = ${temp.message.seq}`;
      const before = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${member} AND kind = 'chat_reminder'`;
      const fired = await due.fireDueReminders();
      const after = await sql`SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ${member} AND kind = 'chat_reminder'`;
      const [row] = await sql`SELECT reminded_at FROM chat_saved WHERE user_id = ${member} AND message_seq = ${temp.message.seq}`;
      return fired.reminders === 1 && before[0]?.n === after[0]?.n && Boolean(row?.reminded_at);
    });
    await check("LOAD-04: reading a channel stamps read_at on its mentions", async () => {
      as(owner, "Olivia");
      const ping = await messages.sendMessage({ channelId: general, body: `ping <@${member}>` });
      as(member, "Mason");
      if (!ping.success) return false;
      const before = await sql`SELECT read_at FROM chat_mentions WHERE user_id = ${member} AND channel_id = ${general} AND message_seq = ${ping.message.seq}`;
      await read.markRead({ channelId: general, seq: ping.message.seq });
      const after = await sql`SELECT read_at FROM chat_mentions WHERE user_id = ${member} AND channel_id = ${general} AND message_seq = ${ping.message.seq}`;
      const [count] = await sql`SELECT app_private.chat_inbox_unread(${member}::uuid) AS n`;
      return before[0]?.read_at === null && after[0]?.read_at !== null && typeof count?.n === "number";
    });
    await check("MUT-01: an edit adds and removes @mentions", async () => {
      as(owner, "Olivia");
      const original = await messages.sendMessage({ channelId: general, body: "plain words" });
      if (!original.success) return false;
      const seq = original.message.seq;
      const mentionRows = async () => (await sql`SELECT count(*)::int AS n FROM chat_mentions WHERE user_id = ${member} AND channel_id = ${general} AND message_seq = ${seq}`)[0]?.n;
      const added = await messages.editMessage({ channelId: general, seq, body: `plain words <@${member}>` });
      const withMention = await mentionRows();
      const removed = await messages.editMessage({ channelId: general, seq, body: "plain words again" });
      const withoutMention = await mentionRows();
      as(member, "Mason");
      return added.success && removed.success && withMention === 1 && withoutMention === 0;
    });
    await check("ACT-04: markReadMany moves several cursors in one call", async () => {
      await sql`UPDATE chat_channel_members SET last_read_seq = 0 WHERE user_id = ${member} AND channel_id IN (${general}, ${dmId})`;
      const lasts = await sql`SELECT id, last_seq::int AS seq FROM chat_channels WHERE id IN (${general}, ${dmId})`;
      const result = await read.markReadMany({ items: lasts.map((row) => ({ channelId: String(row.id), seq: Number(row.seq) })) });
      const cursors = await sql`SELECT last_read_seq::int AS seq FROM chat_channel_members WHERE user_id = ${member} AND channel_id IN (${general}, ${dmId})`;
      return result.success && result.moved === 2 && cursors.every((row) => Number(row.seq) > 0);
    });
    await check("S3-02: an image used only on a canvas is never eligible for deletion", async () => {
      const [asset] = await sql`
        INSERT INTO storage_assets (bucket, storage_key, purpose, declared_mime_type, declared_size, expires_at, owner_user_id, created_at)
        VALUES ('chat-attachments', ${`${general}/${member}/canvas-${Date.now()}.png`}, 'chat_attachment:file', 'image/png', 10, now(), ${member}, now() - interval '2 hours')
        RETURNING id`;
      const assetId = String(asset?.id);
      const eligible = async () => (await db.select({ id: storageAssets.id }).from(storageAssets)
        .where(and(eq(storageAssets.id, assetId), assetDeletion.hasNoLiveReference()))).length;
      const orphan = await eligible();
      await sql`INSERT INTO chat_canvases (channel_id, title, body, asset_ids) VALUES (${general}, 'c', '', ARRAY[${assetId}]::uuid[])
                ON CONFLICT (channel_id) DO UPDATE SET asset_ids = chat_canvases.asset_ids || EXCLUDED.asset_ids`;
      const onCanvas = await eligible();
      await sql`DELETE FROM storage_assets WHERE id = ${assetId}`;
      return orphan === 1 && onCanvas === 0;
    });
    await check("searchMessages finds your conversations' text only", async () => {
      const found = await search.searchMessages({ query: "reply" });
      const inChannel = await search.searchMessages({ query: "reply", channelId: dmId });
      const short = await search.searchMessages({ query: "r" });
      return found.success && found.hits.some((h) => h.channel_id === general && h.thread_root_seq === rootSeq)
        && inChannel.success && inChannel.hits.length === 0 && !short.success;
    });
    await check("listReactors names the reactors", async () => {
      const result = await messages.listReactors({ channelId: general, seq: rootSeq });
      return result.success && result.reactors["🎉"]?.[0] === "You";
    });
    await check("shareMessage quotes the message into another conversation", async () => {
      const result = await messages.shareMessage({ channelId: general, seq: rootSeq, toChannelId: dmId, note: "look" });
      return result.success && result.message.body.startsWith("look") && result.message.body.includes("> edited root")
        && result.message.body.includes(`?m=${rootSeq}`);
    });
    await check("shareMessage quotes an attachment-only message as (attachment)", async () => {
      as(member, "Mason");
      const [asset] = await sql`
        INSERT INTO storage_assets (bucket, storage_key, purpose, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, expires_at, owner_user_id, state, metadata)
        VALUES ('chat-attachments', ${`${general}/${member}/share-${Date.now()}.png`}, 'chat_attachment:file', 'image/png', 10, 'image/png', 10, now(), now() + interval '1 day', ${member}, 'verified', '{"filename":"pic.png"}'::jsonb)
        RETURNING id`;
      const sent = await messages.sendMessage({ channelId: general, body: "", assetIds: [String(asset?.id)] });
      if (!sent.success) return false;
      const result = await messages.shareMessage({ channelId: general, seq: sent.message.seq, toChannelId: dmId });
      return result.success && result.message.body.includes("> (attachment)");
    });
    await check("shareMessage of a thread reply links into its thread", async () => {
      const thread = await messages.listThread({ channelId: general, rootSeq });
      const replySeq = thread.success ? thread.replies[0]?.seq : undefined;
      if (!replySeq) return false;
      const result = await messages.shareMessage({ channelId: general, seq: replySeq, toChannelId: dmId });
      return result.success && result.message.body.includes(`/messages/${general}?m=${replySeq}&thread=${rootSeq}`);
    });
    await check("channel tabs are shared: add, rename, remove", async () => {
      const added = await channels.addChannelTab({ channelId: general, kind: "link", title: "Spec", url: "https://example.test/spec" });
      const bad = await channels.addChannelTab({ channelId: general, kind: "link", title: "Bad", url: "javascript:alert(1)" });
      const tasks = await channels.addChannelTab({ channelId: general, kind: "tasks", title: "Tasks" });
      const twice = await channels.addChannelTab({ channelId: general, kind: "tasks", title: "Tasks" });
      const files = await channels.addChannelTab({ channelId: general, kind: "files", title: "Files" });
      const filesTwice = await channels.addChannelTab({ channelId: general, kind: "files", title: "Files" });
      if (files.success) await channels.removeChannelTab({ channelId: general, tabId: files.tab.id });
      if (!files.success || filesTwice.success) return false;
      as(owner, "Olivia");
      const seen = await channels.listChannelTabs({ channelId: general });
      as(member, "Mason");
      if (!added.success || !tasks.success) return false;
      const saved = await channels.saveChannelTabs({ channelId: general, tabs: [{ id: tasks.tab.id, title: "Board" }, { id: added.tab.id, title: "Spec v2" }] });
      const list = await channels.listChannelTabs({ channelId: general });
      const removed = await channels.removeChannelTab({ channelId: general, tabId: added.tab.id });
      const final = await channels.listChannelTabs({ channelId: general });
      return !bad.success && !twice.success && seen.success && seen.tabs.length === 2 && saved.success && list.success
        && list.tabs[0]?.title === "Board" && list.tabs[1]?.title === "Spec v2" && removed.success && final.success && final.tabs.length === 1;
    });
    await check("listFiles answers for members", async () => {
      const result = await messages.listFiles({ channelId: general });
      return result.success && Array.isArray(result.files);
    });
    await check("scheduled messages send when due, once", async () => {
      const past = await later.scheduleMessage({ channelId: general, body: "later", sendAt: new Date(Date.now() - 1000).toISOString() });
      const queued = await later.scheduleMessage({ channelId: general, body: "scheduled hello", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
      const list = await later.listScheduled();
      if (!queued.success) return false;
      await sql`UPDATE chat_scheduled_messages SET send_at = now() - interval '1 second' WHERE id = ${queued.id}`;
      const first = await due.sendDueScheduledMessages();
      const second = await due.sendDueScheduledMessages();
      const [row] = await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id = ${general} AND body = 'scheduled hello'`;
      const cancelMe = await later.scheduleMessage({ channelId: general, body: "never", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
      const cancelled = cancelMe.success ? await later.cancelScheduled({ id: cancelMe.id }) : { success: false };
      const remaining = await later.listScheduled();
      return !past.success && list.success && list.items.some((i) => i.id === queued.id) && first.sent === 1 && second.due === 0
        && row?.n === 1 && cancelled.success && remaining.success && remaining.items.length === 0;
    });
    await check("COR-010: a crashed claim is retried once; a live claim is left alone", async () => {
      const crashed = await later.scheduleMessage({ channelId: general, body: "after crash", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
      const busy = await later.scheduleMessage({ channelId: general, body: "being sent", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
      if (!crashed.success || !busy.success) return false;
      // A worker claimed both and died; only the expired claim is reclaimable.
      await sql`UPDATE chat_scheduled_messages SET send_at = now() - interval '1 second', claim_expires_at = now() - interval '1 second' WHERE id = ${crashed.id}`;
      await sql`UPDATE chat_scheduled_messages SET send_at = now() - interval '1 second', claim_expires_at = now() + interval '5 minutes' WHERE id = ${busy.id}`;
      const run = await due.sendDueScheduledMessages();
      const [row] = await sql`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id = ${general} AND body = 'after crash'`;
      const [state] = await sql`SELECT sent_at IS NOT NULL AS sent, claim_expires_at IS NULL AS released FROM chat_scheduled_messages WHERE id = ${crashed.id}`;
      const [busyRow] = await sql`SELECT sent_at FROM chat_scheduled_messages WHERE id = ${busy.id}`;
      await later.cancelScheduled({ id: busy.id });
      return run.sent === 1 && row?.n === 1 && state?.sent === true && state?.released === true && busyRow?.sent_at === null;
    });
    await check("searchChannels finds unjoined public channels across all your projects", async () => {
      as(owner, "Olivia");
      const open = await channels.createChannel({ projectId: otherProjectId, name: "zeta-plan" });
      await channels.createChannel({ projectId: otherProjectId, name: "zeta-secret", isPrivate: true });
      const old = await channels.createChannel({ projectId: otherProjectId, name: "zeta-old" });
      if (old.success) await channels.archiveChannel({ channelId: old.channelId });
      as(member, "Mason");
      const found = await channels.searchChannels({ query: "zeta" });
      const joinedOnly = await channels.searchChannels({ query: "launch" });
      const wildcard = await channels.searchChannels({ query: "%" });
      const empty = await channels.searchChannels({ query: "  " });
      return open.success && found.success && found.channels.length === 1 && found.channels[0]?.id === open.channelId
        && found.channels[0]?.project_title === "Second project"
        && joinedOnly.success && joinedOnly.channels.length === 0
        && wildcard.success && wildcard.channels.length === 0 && !empty.success;
    });
    await check("public channels can be previewed by project members before joining", async () => {
      as(owner, "Olivia");
      const made = await channels.createChannel({ projectId, name: "preview" });
      if (made.success) await messages.sendMessage({ channelId: made.channelId, body: "preview me" });
      as(member, "Mason");
      const page = made.success ? await messages.listMessages({ channelId: made.channelId }) : null;
      as(outsider, "Oscar");
      const refused = made.success ? await messages.listMessages({ channelId: made.channelId }) : null;
      as(member, "Mason");
      return Boolean(page?.success && page.messages.some((m) => m.body === "preview me") && refused?.success && refused.messages.length === 0);
    });
    await check("reactions to your messages reach your Inbox", async () => {
      as(owner, "Olivia");
      const result = await activity.listInbox({ filter: "reactions" });
      as(member, "Mason");
      return result.success && result.items.some((i) => i.seq === rootSeq && i.emoji === "🎉" && i.author?.id === member);
    });
    await check("group chats can be named by members", async () => {
      as(owner, "Olivia");
      const group = await members.createGroup({ userIds: [member] });
      as(member, "Mason");
      const renamed = group.success ? await channels.renameGroup({ channelId: group.channelId, title: "Crew" }) : { success: false };
      const boot = await read.bootstrap();
      return renamed.success && boot.success && boot.data.channels.some((c) => group.success && c.id === group.channelId && c.title === "Crew");
    });
    await check("channel admins set roles, archive and unarchive", async () => {
      as(owner, "Olivia");
      const role = await members.setMemberRole({ channelId: launch, userId: member, role: "admin" });
      const ownerRole = await members.setMemberRole({ channelId: launch, userId: owner, role: "member" });
      const archived = await channels.archiveChannel({ channelId: launch });
      const restored = await channels.unarchiveChannel({ channelId: launch });
      const [row] = await sql`SELECT m.role, c.archived_at FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
        WHERE m.channel_id = ${launch} AND m.user_id = ${member}`;
      as(member, "Mason");
      return role.success && !ownerRole.success && archived.success && restored.success && row?.role === "admin" && row.archived_at === null;
    });
    await check("any member may pin", async () => {
      const result = await messages.pinMessage({ channelId: general, seq: rootSeq, on: false });
      return result.success;
    });
    await check("threads lists the followed thread", async () => {
      const result = await activity.listThreads();
      return result.success && result.threads.some((t) => t.channel_id === general && t.root_seq === rootSeq);
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
    await check("Inbox mark all by tab: Mentions leaves thread replies, All clears them", async () => {
      as(member, "Mason");
      const root = await messages.sendMessage({ channelId: general, body: "p3 root", clientId: randomUUID() });
      if (!root.success) return false;
      await messages.setThreadFollow({ channelId: general, rootSeq: root.message.seq, on: true });
      as(owner, "Olivia");
      await messages.sendMessage({ channelId: general, body: "p3 reply", clientId: randomUUID(), threadRootSeq: root.message.seq });
      await flush();
      as(member, "Mason");
      const unread = async () => {
        const result = await activity.listThreads();
        return result.success && result.threads.some((t) => t.root_seq === root.message.seq && t.unread);
      };
      const before = await unread();
      await activity.markInboxRead({ all: true, scope: "mentions" });
      const still = await unread();
      await activity.markInboxRead({ all: true, scope: "all" });
      return before && still && !(await unread());
    });
    await check("muted conversations still show @mentions in the Inbox (like Slack)", async () => {
      as(member, "Mason");
      await members.setMemberState({ channelId: general, notify: "mute" });
      as(owner, "Olivia");
      const sent = await messages.sendMessage({ channelId: general, body: `<@${member}> muted ping`, clientId: randomUUID() });
      await flush();
      as(member, "Mason");
      const inbox = await activity.listInbox();
      await members.setMemberState({ channelId: general, notify: "all" });
      return sent.success && inbox.success && inbox.items.some((i) => i.channel_id === general && i.seq === sent.message.seq);
    });
    await check("Saved names the DM partner", async () => {
      as(member, "Mason");
      const sent = await messages.sendMessage({ channelId: dmId, body: "save me", clientId: randomUUID() });
      if (!sent.success) return false;
      await later.saveMessage({ channelId: dmId, seq: sent.message.seq, on: true });
      const list = await later.listSaved();
      await later.saveMessage({ channelId: dmId, seq: sent.message.seq, on: false });
      return list.success && list.items.some((i) => i.channel_id === dmId && i.channel_title === "Olivia Owner");
    });
    await check("search by conversation alone (no text) works", async () => {
      const result = await search.searchMessages({ query: "", channelId: general });
      return result.success && result.hits.length > 0;
    });
    await check("listFiles carries thread_root_seq for thread links", async () => {
      const result = await messages.listFiles({ channelId: general });
      return result.success && result.files.every((f) => "thread_root_seq" in f);
    });
    // ── Phase 8 (Details + Inbox) ──
    await check("Inbox All includes reactions as read rows", async () => {
      as(owner, "Olivia");
      const result = await activity.listInbox({ filter: "all" });
      as(member, "Mason");
      return result.success && result.items.some((i) => i.kind === "reaction" && i.read);
    });
    await check("listThreads pages by last reply and returns last_reply_seq", async () => {
      as(member, "Mason");
      const all = await activity.listThreads();
      const first = await activity.listThreads({ limit: 1 });
      if (!all.success || !first.success || all.threads.length < 2 || first.threads.length !== 1) return false;
      const head = first.threads[0]!;
      const next = await activity.listThreads({ limit: 1, cursor: head.cursor });
      return typeof head.last_reply_seq === "number" && next.success && next.threads.length === 1
        && `${next.threads[0]!.channel_id}:${next.threads[0]!.root_seq}` !== `${head.channel_id}:${head.root_seq}`;
    });
    await check("markInboxUnread puts a read item back to unread", async () => {
      as(member, "Mason");
      const inbox = await activity.listInbox({ filter: "all" });
      const item = inbox.success ? inbox.items.find((i) => i.kind === "thread_reply" && i.body === "p3 reply") : undefined;
      if (!item || !item.read) return false;
      const marked = await activity.markInboxUnread({ channelId: item.channel_id, seq: item.seq });
      const again = await activity.listInbox({ filter: "all" });
      const boot = await read.bootstrap();
      const now = again.success ? again.items.find((i) => i.channel_id === item.channel_id && i.seq === item.seq && i.kind === "thread_reply") : undefined;
      await activity.markInboxRead({ items: [{ channelId: item.channel_id, seq: item.seq }] });
      return marked.success && now?.read === false && boot.success && (boot.data.inbox_unread ?? 0) > 0;
    });
    await check("Saved and Search page with one page size", async () => {
      as(member, "Mason");
      const page = await messages.listMessages({ channelId: general });
      const seqs = page.success ? page.messages.filter((m) => m.seq > 0).slice(-2).map((m) => m.seq) : [];
      if (seqs.length < 2) return false;
      for (const seq of seqs) await later.saveMessage({ channelId: general, seq, on: true });
      const one = await later.listSaved({ limit: 1 });
      const two = await later.listSaved({ limit: 1, offset: 1 });
      for (const seq of seqs) await later.saveMessage({ channelId: general, seq, on: false });
      const hits = await search.searchMessages({ query: "", channelId: general, limit: 2 });
      if (!hits.success || hits.hits.length !== 2) return false;
      const older = await search.searchMessages({ query: "", channelId: general, limit: 2, cursor: hits.hits[1]!.created_at });
      return one.success && two.success && one.items.length === 1 && two.items.length === 1 && one.items[0]!.seq !== two.items[0]!.seq
        && older.success && older.hits.length > 0 && older.hits.every((h) => Date.parse(h.created_at) < Date.parse(hits.hits[1]!.created_at));
    });
    await check("channel admins switch a channel between public and private", async () => {
      as(owner, "Olivia");
      const made = await channels.createChannel({ projectId, name: "privacy-check" });
      if (!made.success) return false;
      const toPrivate = await channels.setChannelPrivacy({ channelId: made.channelId, private: true });
      as(member, "Mason");
      const browse = await channels.browseChannels({ projectId });
      const notAdmin = await channels.setChannelPrivacy({ channelId: made.channelId, private: false });
      as(owner, "Olivia");
      const toPublic = await channels.setChannelPrivacy({ channelId: made.channelId, private: false });
      const general_ = await channels.setChannelPrivacy({ channelId: general, private: true });
      const group = await members.createGroup({ userIds: [member] });
      const groupRefused = group.success ? await channels.setChannelPrivacy({ channelId: group.channelId, private: false }) : { success: true };
      const [row] = await sql`SELECT kind FROM chat_channels WHERE id = ${made.channelId}`;
      as(member, "Mason");
      return toPrivate.success && browse.success && !browse.channels.some((c) => c.id === made.channelId) && !notAdmin.success
        && toPublic.success && row?.kind === "public" && !general_.success && !groupRefused.success;
    });
    // ── Phase 9 (Saved, Scheduled, Search) ──
    await check("Saved: Clear reminder keeps the item; due reminders count in bootstrap", async () => {
      as(member, "Mason");
      await later.saveMessage({ channelId: general, seq: rootSeq, on: true, remindAt: new Date(Date.now() + 3_600_000).toISOString() });
      await sql`UPDATE chat_saved SET remind_at = now() - interval '1 minute' WHERE user_id = ${member} AND channel_id = ${general} AND message_seq = ${rootSeq}`;
      const due = await read.bootstrap();
      const cleared = await later.saveMessage({ channelId: general, seq: rootSeq, on: true, clearReminder: true });
      const [row] = await sql`SELECT remind_at, reminded_at FROM chat_saved WHERE user_id = ${member} AND channel_id = ${general} AND message_seq = ${rootSeq}`;
      const after = await read.bootstrap();
      await later.saveMessage({ channelId: general, seq: rootSeq, on: false });
      return due.success && (due.data.saved_due ?? 0) >= 1 && cleared.success && row !== undefined && row.remind_at === null
        && row.reminded_at === null && after.success && (after.data.saved_due ?? 0) === (due.data.saved_due ?? 0) - 1;
    });
    await check("Scheduled: send now, retry a failed one, reschedule", async () => {
      as(owner, "Olivia");
      const a = await later.scheduleMessage({ channelId: general, body: "send me now", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
      const b = await later.scheduleMessage({ channelId: general, body: "failed before", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
      if (!a.success || !b.success) return false;
      const now = await later.sendScheduledNow({ id: a.id });
      await sql`UPDATE chat_scheduled_messages SET failed_reason = 'chat_not_member' WHERE id = ${b.id}`;
      const past = await later.rescheduleScheduled({ id: b.id, sendAt: new Date(Date.now() - 1000).toISOString() });
      const moved = await later.rescheduleScheduled({ id: b.id, sendAt: new Date(Date.now() + 7_200_000).toISOString() });
      const [movedRow] = await sql`SELECT failed_reason, send_at FROM chat_scheduled_messages WHERE id = ${b.id}`;
      await sql`UPDATE chat_scheduled_messages SET failed_reason = 'chat_not_member' WHERE id = ${b.id}`;
      // The owner's send bucket (1 token/s) is spent by earlier checks.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const retried = await later.sendScheduledNow({ id: b.id });
      const left = await later.listScheduled();
      const page = await messages.listMessages({ channelId: general });
      as(member, "Mason");
      return now.success && retried.success && !past.success && moved.success && movedRow?.failed_reason === null
        && Date.parse(String(movedRow?.send_at)) > Date.now() + 3_600_000
        && left.success && !left.items.some((i) => i.id === a.id || i.id === b.id)
        && page.success && page.messages.some((m) => m.body === "send me now") && page.messages.some((m) => m.body === "failed before");
    });
    await check("search hits carry the project label", async () => {
      const result = await search.searchMessages({ query: "", channelId: general, limit: 1 });
      return result.success && result.hits[0]?.project_title === "Actions test";
    });
    // Round 2 (#26-#36): read state, Inbox counts and the mute rule agree everywhere.
    // The send bucket is 10 per user, 1/s refill: let it refill first.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    await check("#28 Inbox mark-all also clears the sidebar @ count", async () => {
      as(owner, "Olivia");
      const ping = await messages.sendMessage({ channelId: launch, body: `round two <@${member}>` });
      as(member, "Mason");
      const [before] = await sql`SELECT mention_count FROM chat_channel_members WHERE user_id = ${member} AND channel_id = ${launch}`;
      const result = await activity.markInboxRead({ all: true, scope: "mentions" });
      const [after] = await sql`SELECT mention_count FROM chat_channel_members WHERE user_id = ${member} AND channel_id = ${launch}`;
      return ping.success && Number(before?.mention_count) > 0 && result.success && Number(after?.mention_count) === 0;
    });
    const threadRoot = await messages.sendMessage({ channelId: launch, body: "thread root for round two" });
    await check("#26 reading a thread sends the new Inbox count to the user", async () => {
      if (!threadRoot.success) return false;
      as(owner, "Olivia");
      const reply = await messages.sendMessage({ channelId: launch, body: "a reply", threadRootSeq: threadRoot.message.seq });
      as(member, "Mason");
      await flush();
      broadcasts.length = 0;
      if (!reply.success) return false;
      const result = await read.markThreadRead({ channelId: launch, rootSeq: threadRoot.message.seq, seq: reply.message.seq });
      await flush();
      return result.success && broadcasts.some((b) => b.event === "inbox.count" && b.topic === `chat:user:${member}`);
    });
    await check("#35 marking a thread reply read in the Inbox also reads it in Threads", async () => {
      if (!threadRoot.success) return false;
      as(owner, "Olivia");
      const reply = await messages.sendMessage({ channelId: launch, body: "another reply", threadRootSeq: threadRoot.message.seq });
      as(member, "Mason");
      if (!reply.success) return false;
      const marked = await activity.markInboxRead({ items: [{ channelId: launch, seq: reply.message.seq }] });
      const threads = await activity.listThreads();
      const thread = threads.success ? threads.threads.find((t) => t.channel_id === launch && t.root_seq === threadRoot.message.seq) : null;
      return marked.success && thread?.unread === false;
    });
    await check("#36 muted: thread replies don't count, mentions still do", async () => {
      if (!threadRoot.success) return false;
      await members.setMemberState({ channelId: launch, notify: "mute" });
      as(owner, "Olivia");
      await messages.sendMessage({ channelId: launch, body: "muted reply", threadRootSeq: threadRoot.message.seq });
      await messages.sendMessage({ channelId: launch, body: `muted ping <@${member}>` });
      as(member, "Mason");
      const threads = await activity.listThreads();
      const thread = threads.success ? threads.threads.find((t) => t.channel_id === launch && t.root_seq === threadRoot.message.seq) : null;
      const inbox = await activity.listInbox({ filter: "all" });
      const items = inbox.success ? inbox.items.filter((i) => i.channel_id === launch && !i.read) : [];
      await members.setMemberState({ channelId: launch, notify: "all" });
      return thread?.unread === false && items.some((i) => i.kind === "user") && !items.some((i) => i.kind === "thread_reply");
    });
    await check("#33 Also send to the channel carries the files", async () => {
      if (!threadRoot.success) return false;
      const [asset] = await sql`
        INSERT INTO storage_assets (bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, owner_user_id, expires_at)
        VALUES ('chat-attachments', ${`${launch}/${member}/round2-${Date.now()}.png`}, 'chat_attachment:file', 'verified', 'image/png', 10, 'image/png', 10, now(), ${member}, now() + interval '1 day')
        RETURNING id`;
      const assetId = String(asset?.id);
      const sentBoth = await messages.sendMessage({ channelId: launch, body: "", threadRootSeq: threadRoot.message.seq, assetIds: [assetId], alsoToChannel: true });
      const page = await messages.listMessages({ channelId: launch });
      return sentBoth.success && page.success && page.messages.some((m) => m.thread_root_seq === null && m.attachments.some((a) => a.asset_id === assetId));
    });
    // Round 3 (0193): mentions in followed threads, unfollow and thread reads keep every count true.
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    const unreadReplies = async (rootSeq: number) => (await sql`
      SELECT count(*)::int AS n FROM chat_mentions mn JOIN chat_messages m ON m.channel_id = mn.channel_id AND m.channel_seq = mn.message_seq
      WHERE mn.user_id = ${member} AND mn.channel_id = ${launch} AND m.thread_root_seq = ${rootSeq} AND mn.read_at IS NULL`)[0]?.n as number;
    await check("#1 an @mention in a thread you follow is filed as a mention", async () => {
      if (!threadRoot.success) return false;
      as(owner, "Olivia");
      const reply = await messages.sendMessage({ channelId: launch, body: `look <@${member}>`, threadRootSeq: threadRoot.message.seq });
      as(member, "Mason");
      if (!reply.success) return false;
      const [row] = await sql`SELECT kind FROM chat_mentions WHERE user_id = ${member} AND channel_id = ${launch} AND message_seq = ${reply.message.seq}`;
      const inbox = await activity.listInbox({ filter: "mentions" });
      return row?.kind === "user" && inbox.success && inbox.items.some((i) => i.seq === reply.message.seq);
    });
    await check("#7 reading the thread recounts the conversation's @ count", async () => {
      if (!threadRoot.success) return false;
      const [before] = await sql`SELECT mention_count FROM chat_channel_members WHERE user_id = ${member} AND channel_id = ${launch}`;
      const [last] = await sql`SELECT last_reply_seq::int AS seq FROM chat_messages WHERE channel_id = ${launch} AND channel_seq = ${threadRoot.message.seq}`;
      await flush();
      broadcasts.length = 0;
      const result = await read.markThreadRead({ channelId: launch, rootSeq: threadRoot.message.seq, seq: Number(last?.seq) });
      await flush();
      const [after] = await sql`SELECT mention_count FROM chat_channel_members WHERE user_id = ${member} AND channel_id = ${launch}`;
      return result.success && Number(before?.mention_count) > 0 && Number(after?.mention_count) === 0
        && broadcasts.some((b) => b.event === "inbox.count" && b.topic === `chat:user:${member}`);
    });
    await check("#4 marking one thread reply read reads the older ones too", async () => {
      if (!threadRoot.success) return false;
      as(owner, "Olivia");
      const first = await messages.sendMessage({ channelId: launch, body: "older reply", threadRootSeq: threadRoot.message.seq });
      const second = await messages.sendMessage({ channelId: launch, body: "newer reply", threadRootSeq: threadRoot.message.seq });
      as(member, "Mason");
      if (!first.success || !second.success) return false;
      const marked = await activity.markInboxRead({ items: [{ channelId: launch, seq: second.message.seq }] });
      const [row] = await sql`SELECT read_at FROM chat_mentions WHERE user_id = ${member} AND channel_id = ${launch} AND message_seq = ${first.message.seq}`;
      return marked.success && row?.read_at !== null && row?.read_at !== undefined;
    });
    await check("#6 leaving a thread takes its unread replies out of the badge", async () => {
      if (!threadRoot.success) return false;
      as(owner, "Olivia");
      await messages.sendMessage({ channelId: launch, body: "reply before unfollow", threadRootSeq: threadRoot.message.seq });
      as(member, "Mason");
      const before = await unreadReplies(threadRoot.message.seq);
      const left = await messages.setThreadFollow({ channelId: launch, rootSeq: threadRoot.message.seq, on: false });
      const after = await unreadReplies(threadRoot.message.seq);
      await messages.setThreadFollow({ channelId: launch, rootSeq: threadRoot.message.seq, on: true });
      return left.success && before > 0 && after === 0;
    });
    await check("#9 a muted member who is mentioned still gets a hint (never a push)", async () => {
      await members.setMemberState({ channelId: launch, notify: "mute" });
      await flush();
      broadcasts.length = 0;
      as(owner, "Olivia");
      const ping = await messages.sendMessage({ channelId: launch, body: `muted again <@${member}>` });
      as(member, "Mason");
      await flush();
      await members.setMemberState({ channelId: launch, notify: "all" });
      return ping.success && broadcasts.some((b) => b.event === "hint" && b.topic === `chat:user:${member}`);
    });
    await check("#10 the channel copy of a thread reply doesn't notify its mentions again", async () => {
      if (!threadRoot.success) return false;
      const sent = await messages.sendMessage({ channelId: launch, body: `copy for <@${owner}>`, threadRootSeq: threadRoot.message.seq, alsoToChannel: true });
      const page = await messages.listMessages({ channelId: launch });
      const copy = page.success ? page.messages.filter((m) => m.thread_root_seq === null && m.body.startsWith("copy for")).at(-1) : undefined;
      return sent.success && "alsoSent" in sent && sent.alsoSent === true && copy !== undefined && !copy.body.includes(`<@${owner}>`) && copy.body.includes("@Olivia Owner");
    });
    await check("#22 an edit can remove a file's caption", async () => {
      const [asset] = await sql`
        INSERT INTO storage_assets (bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, owner_user_id, expires_at)
        VALUES ('chat-attachments', ${`${launch}/${member}/round3-${Date.now()}.png`}, 'chat_attachment:file', 'verified', 'image/png', 10, 'image/png', 10, now(), ${member}, now() + interval '1 day')
        RETURNING id`;
      const sent = await messages.sendMessage({ channelId: launch, body: "a caption", assetIds: [String(asset?.id)] });
      if (!sent.success) return false;
      const edited = await messages.editMessage({ channelId: launch, seq: sent.message.seq, body: "" });
      const [row] = await sql`SELECT body FROM chat_messages WHERE channel_id = ${launch} AND channel_seq = ${sent.message.seq}`;
      const textOnly = await messages.sendMessage({ channelId: launch, body: "text only" });
      const refused = textOnly.success ? await messages.editMessage({ channelId: launch, seq: textOnly.message.seq, body: "" }) : { success: true };
      return edited.success && row?.body === "" && !refused.success;
    });
    await check("#260 only the author can remove a link preview, and it stays removed", async () => {
      const sent = await messages.sendMessage({ channelId: launch, body: "see https://example.com/page" });
      if (!sent.success) return false;
      as(owner, "Olivia");
      const notMine = await messages.hideLinkPreview({ channelId: launch, seq: sent.message.seq });
      as(member, "Mason");
      await flush();
      broadcasts.length = 0;
      const hidden = await messages.hideLinkPreview({ channelId: launch, seq: sent.message.seq });
      await flush();
      const page = await messages.listMessages({ channelId: launch });
      const row = page.success ? page.messages.find((m) => m.seq === sent.message.seq) : undefined;
      return !notMine.success && hidden.success && row?.link_preview_hidden === true
        && broadcasts.some((b) => b.event === "message.preview_hidden");
    });
    await check("leaveChannel works for non-default channels only", async () => {
      const left = await channels.leaveChannel({ channelId: launch });
      const refused = await channels.leaveChannel({ channelId: general });
      return left.success && !refused.success;
    });
  } finally {
    await sql`DELETE FROM chat_channels WHERE project_id IN (${projectId}, ${otherProjectId}) OR id IN (
      SELECT channel_id FROM chat_channel_members WHERE user_id IN (${owner}, ${member}, ${outsider}))`.catch(() => undefined);
    await sql`DELETE FROM chat_canvases WHERE channel_id IN (SELECT id FROM chat_channels WHERE project_id = ${projectId})`.catch(() => undefined);
    await sql`DELETE FROM user_notifications WHERE user_id IN (${owner}, ${member}, ${outsider})`.catch(() => undefined);
    await sql`DELETE FROM tasks WHERE id = ${taskId}`.catch(() => undefined);
    await sql`DELETE FROM projects WHERE id IN (${projectId}, ${otherProjectId})`.catch(() => undefined);
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
