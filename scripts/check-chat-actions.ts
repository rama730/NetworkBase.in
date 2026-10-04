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
  const later = await import("@/app/actions/chat/later");
  const search = await import("@/app/actions/chat/search");
  const due = await import("@/lib/messaging/due");
  const assetDeletion = await import("@/lib/storage/asset-deletion");
  const { db } = await import("@/lib/db");
  const { storageAssets } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");

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
    await check("muted conversations stay out of the Inbox list", async () => {
      as(member, "Mason");
      await members.setMemberState({ channelId: general, notify: "mute" });
      as(owner, "Olivia");
      const sent = await messages.sendMessage({ channelId: general, body: `<@${member}> muted ping`, clientId: randomUUID() });
      await flush();
      as(member, "Mason");
      const inbox = await activity.listInbox();
      await members.setMemberState({ channelId: general, notify: "all" });
      return sent.success && inbox.success && !inbox.items.some((i) => i.channel_id === general && i.seq === sent.message.seq);
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
    await check("leaveChannel works for non-default channels only", async () => {
      const left = await channels.leaveChannel({ channelId: launch });
      const refused = await channels.leaveChannel({ channelId: general });
      return left.success && !refused.success;
    });
  } finally {
    await sql`DELETE FROM chat_channels WHERE project_id = ${projectId} OR id IN (
      SELECT channel_id FROM chat_channel_members WHERE user_id IN (${owner}, ${member}, ${outsider}))`.catch(() => undefined);
    await sql`DELETE FROM chat_canvases WHERE channel_id IN (SELECT id FROM chat_channels WHERE project_id = ${projectId})`.catch(() => undefined);
    await sql`DELETE FROM user_notifications WHERE user_id IN (${owner}, ${member}, ${outsider})`.catch(() => undefined);
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
