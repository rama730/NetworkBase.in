import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewer = "";
let owner = "";
let outsider = "";
let channel = "";
let project = "";
let root = 0;
let originalTimestamp = "";
const published: unknown[] = [];
let objectBytes: Uint8Array = new Uint8Array();
moduleStubs.set("@/lib/supabase/server", { createAdminClient: async () => ({ storage: { from: () => ({
  info: async () => ({ data: { size: objectBytes.byteLength }, error: null }),
  createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/verified-object" }, error: null }),
}) } }) });
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewer }) });
moduleStubs.set("@/lib/messaging/publish", { publishSentMessage: (input: unknown) => published.push(input), publishUser() {}, publishUsers() {}, publishChannel() {} });
moduleStubs.set("@/app/actions/project", { createTaskAction: async () => ({ success: false }) });
let messages: typeof import("../../src/app/actions/chat/messages");
let send: typeof import("../../src/lib/messaging/send");

before(async () => {
  messages = await loadAppModule(() => import("../../src/app/actions/chat/messages"));
  send = await loadAppModule(() => import("../../src/lib/messaging/send"));
  owner = await sql.begin((tx) => createUser(tx));
  outsider = await sql.begin((tx) => createUser(tx));
  viewer = owner;
  channel = (await sql`INSERT INTO chat_channels(kind, title, created_by) VALUES ('private', 'Metadata fixture', ${owner}) RETURNING id`)[0]!.id;
  await sql`INSERT INTO chat_channel_members(channel_id, user_id, role) VALUES (${channel}, ${owner}, 'owner')`;
  const created = await send.sendAs({ id: owner }, { channelId: channel, body: "root", clientId: "metadata-root" }, null);
  assert.ok(created.success);
  root = created.message.seq;
  originalTimestamp = created.message.created_at;
  await sql`SELECT app_private.chat_append_message(${channel}::uuid, ${owner}::uuid, 'user', 'reply ' || n::text,
    'metadata-reply-' || n::text, ${root}::bigint, '[]'::jsonb, NULL) FROM generate_series(1, 605) AS n`;
});
after(async () => {
  await sql`DELETE FROM chat_channels WHERE id = ${channel} OR project_id = ${project || null}::uuid`;
  if (project) await sql`DELETE FROM projects WHERE id = ${project}`;
  await sql`DELETE FROM profiles WHERE id = ANY(${[owner, outsider]}::uuid[])`;
  await sql`DELETE FROM auth.users WHERE id = ANY(${[owner, outsider]}::uuid[])`;
  await sql.end();
  await closeAppDb();
});

test("old reply identity resolves and bounded paging reaches both sides of a 605-reply thread", async () => {
  const target = await messages.resolveMessageTarget({ channelId: channel, seq: root + 3 });
  assert.deepEqual(target, { success: true, seq: root + 3, threadRootSeq: root });
  const newest = await messages.listThread({ channelId: channel, rootSeq: root });
  assert.ok(newest.success);
  assert.equal(newest.replies.length, 500);
  assert.ok(!newest.replies.some((m) => m.seq === root + 3));
  const around = await messages.listThread({ channelId: channel, rootSeq: root, around: root + 3, limit: 10 });
  assert.ok(around.success);
  assert.ok(around.replies.some((m) => m.seq === root + 3));
  assert.equal(around.hasNewer, true);
  assert.equal(around.hasOlder, false);
  const forward = await messages.listThread({ channelId: channel, rootSeq: root, after: around.replies.at(-1)!.seq, limit: 10 });
  assert.ok(forward.success);
  assert.ok(forward.replies[0]!.seq > around.replies.at(-1)!.seq);
  assert.equal(forward.hasNewer, true);
  const middle = await messages.listThread({ channelId: channel, rootSeq: root, around: root + 300, limit: 10 });
  assert.ok(middle.success);
  assert.equal(middle.hasOlder, true);
  assert.equal(middle.hasNewer, true);
});

test("duplicate sends return stored edits, timestamp and flags without a second publish", async () => {
  await sql`UPDATE chat_messages SET body = 'edited root', edited_at = now(), link_preview_hidden = true WHERE channel_id = ${channel} AND channel_seq = ${root}`;
  const count = published.length;
  const retry = await send.sendAs({ id: owner }, { channelId: channel, body: "different retry text", clientId: "metadata-root" }, null);
  assert.ok(retry.success);
  assert.equal(retry.message.body, "edited root");
  assert.equal(retry.message.created_at, originalTimestamp);
  assert.ok(retry.message.edited_at);
  assert.equal(retry.message.reply_count, 605);
  assert.equal(retry.message.link_preview_hidden, true);
  assert.equal(published.length, count);
});

test("invalid sequence boundaries, deleted targets and outsiders reveal no message identity", async () => {
  for (const seq of [-1, 1.5, Infinity, 2147483648]) {
    assert.deepEqual(await messages.resolveMessageTarget({ channelId: channel, seq }), { success: false, error: "chat_invalid_input" });
    assert.deepEqual(await messages.listMessages({ channelId: channel, around: seq }), { success: false, error: "chat_invalid_input" });
  }
  await sql`UPDATE chat_messages SET deleted_at = now(), body = '' WHERE channel_id = ${channel} AND channel_seq = ${root + 4}`;
  assert.deepEqual(await messages.resolveMessageTarget({ channelId: channel, seq: root + 4 }), { success: false, error: "chat_message_not_found" });
  viewer = outsider;
  assert.deepEqual(await messages.resolveMessageTarget({ channelId: channel, seq: root + 3 }), { success: false, error: "chat_message_not_found" });
  const denied = await messages.listThread({ channelId: channel, rootSeq: root, around: root + 3 });
  assert.ok(denied.success);
  assert.equal(denied.root, null);
  assert.deepEqual(denied.replies, []);
  viewer = owner;
});

test("task sources contain their own preview and thread identity, and omit deleted sources", async () => {
  const taskId = randomUUID();
  await sql`INSERT INTO chat_message_cards(channel_id, message_seq, kind, ref_id) VALUES (${channel}, ${root + 3}, 'task', ${taskId})`;
  await sql`UPDATE chat_channels SET last_preview = 'a different latest message' WHERE id = ${channel}`;
  const result = await messages.listTaskSourceMessages({ taskId });
  assert.ok(result.success);
  assert.equal(result.links[0]!.thread_root_seq, root);
  assert.equal(result.links[0]!.preview, "reply 3");
  await sql`UPDATE chat_messages SET deleted_at = now(), body = '' WHERE channel_id = ${channel} AND channel_seq = ${root + 3}`;
  const deleted = await messages.listTaskSourceMessages({ taskId });
  assert.ok(deleted.success);
  assert.equal(deleted.links.length, 0);
});

test("project members can resolve public-channel messages before joining; other users cannot", async () => {
  project = await sql.begin((tx) => createProject(tx, owner));
  await sql.begin((tx) => addMember(tx, project, outsider));
  const publicChannel = (await sql`INSERT INTO chat_channels(kind, name, project_id, created_by) VALUES ('public', 'metadata-public', ${project}, ${owner}) RETURNING id`)[0]!.id;
  await sql`INSERT INTO chat_channel_members(channel_id, user_id, role) VALUES (${publicChannel}, ${owner}, 'owner')`;
  const sent = await send.sendAs({ id: owner }, { channelId: publicChannel, body: "public preview" }, null);
  assert.ok(sent.success);
  viewer = outsider;
  const located = await messages.resolveMessageTarget({ channelId: publicChannel, seq: sent.message.seq });
  assert.ok(located.success);
  await sql`DELETE FROM project_members WHERE project_id = ${project} AND user_id = ${outsider}`;
  assert.deepEqual(await messages.resolveMessageTarget({ channelId: publicChannel, seq: sent.message.seq }), { success: false, error: "chat_message_not_found" });
  viewer = owner;
});


test("upload verification replaces forged dimensions with EXIF-oriented image dimensions", async () => {
  const uploads = await loadAppModule(() => import("../../src/lib/upload/upload-intents"));
  objectBytes = await sharp({ create: { width: 3, height: 5, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(objectBytes, { headers: { "content-length": String(objectBytes.byteLength) } });
  let asset: string | null = null;
  try {
    const storageKey = `${channel}/${owner}/${randomUUID()}.jpg`;
    const intent = await uploads.createUploadIntent({ userId: owner, bucket: "chat-attachments", storageKey, scope: "chat_attachment", kind: "file", expectedMimeType: "image/jpeg", expectedSize: objectBytes.byteLength,
      metadata: { channelId: channel, filename: "oriented.jpg", width: 9999, height: 9999 } });
    asset = intent.assetId;
    await uploads.finalizeUploadIntent({ intentId: intent.id, userId: owner, bucket: "chat-attachments", storageKey, expectedScope: "chat_attachment", expectedKind: "file" });
    const [stored] = await sql`SELECT state, metadata, verified_mime_type, verified_size FROM storage_assets WHERE id = ${asset}`;
    assert.equal(stored!.state, "verified");
    assert.equal(stored!.metadata.width, 5);
    assert.equal(stored!.metadata.height, 3);
    assert.equal(stored!.verified_mime_type, "image/jpeg");
    assert.equal(Number(stored!.verified_size), objectBytes.byteLength);
  } finally {
    globalThis.fetch = originalFetch;
    if (asset) { await sql`DELETE FROM storage_asset_operations WHERE asset_id = ${asset}`; await sql`DELETE FROM upload_intents WHERE asset_id = ${asset}`; await sql`DELETE FROM storage_assets WHERE id = ${asset}`; }
  }
});


test("attachment metadata is nullable for legacy bad dimensions, and unrelated buckets are refused", async () => {
  const asset = randomUUID();
  const foreign = randomUUID();
  try {
    for (const [id, bucket] of [[asset, "chat-attachments"], [foreign, "profile-images"]]) {
      await sql`INSERT INTO storage_assets(id, owner_user_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, expires_at, metadata)
        VALUES (${id}, ${owner}, ${bucket}, ${id}, 'chat_attachment:file', 'verified', 'image/jpeg', 64, 'image/jpeg', 64, now(), now() + interval '1 hour', ${sql.json({ filename: "photo.jpg", width: "invalid", height: 50 })})`;
    }
    const sent = await send.sendAs({ id: owner }, { channelId: channel, body: "attachment", assetIds: [asset] }, null);
    assert.ok(sent.success);
    assert.equal(sent.message.attachments[0]!.width, null);
    assert.equal(sent.message.attachments[0]!.height, null);
    assert.equal(sent.message.attachments[0]!.mime, "image/jpeg");
    assert.equal(sent.message.attachments[0]!.size, 64);
    assert.deepEqual(await send.sendAs({ id: owner }, { channelId: channel, body: "foreign", assetIds: [foreign] }, null), { success: false, error: "chat_attachment_not_ready" });
    assert.deepEqual(await send.sendAs({ id: owner }, { channelId: channel, body: "duplicate", assetIds: [asset, asset] }, null), { success: false, error: "chat_invalid_input" });
  } finally {
    await sql`DELETE FROM chat_attachments WHERE asset_id = ANY(${[asset, foreign]}::uuid[])`;
    await sql`DELETE FROM storage_assets WHERE id = ANY(${[asset, foreign]}::uuid[])`;
  }
});


test("unnamed group metadata keeps authorized participant names after channel details load", async () => {
  const channels = await loadAppModule(() => import("../../src/app/actions/chat/channels"));
  await sql`INSERT INTO chat_channel_members(channel_id, user_id, role) VALUES (${channel}, ${outsider}, 'member')`;
  await sql`UPDATE chat_channels SET title = NULL WHERE id = ${channel}`;
  const details = await channels.getChannel({ channelId: channel });
  assert.ok(details.success);
  assert.equal(details.channel.members_preview?.[0]?.id, outsider);
  assert.ok(details.channel.members_preview?.[0]?.full_name);
  await sql`DELETE FROM chat_channel_members WHERE channel_id = ${channel} AND user_id = ${outsider}`;
  viewer = outsider;
  assert.deepEqual(await channels.getChannel({ channelId: channel }), { success: false, error: "chat_channel_not_found" });
  viewer = owner;
});
