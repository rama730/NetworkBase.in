import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
const woken: Date[] = [];
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
moduleStubs.set("@/lib/messaging/publish", { publishUser: () => undefined, publishUsers: () => undefined, publishChannel: () => undefined });
moduleStubs.set("@/inngest/wake", { wakeChatDueIfSoon: async (at: Date) => { woken.push(at); }, wakeAt: async () => undefined });

let due: typeof import("../../src/lib/messaging/due");
let later: typeof import("../../src/app/actions/chat/later");
before(async () => {
  due = await loadAppModule(() => import("../../src/lib/messaging/due"));
  later = await loadAppModule(() => import("../../src/app/actions/chat/later"));
});
after(async () => { await sql.end(); await closeAppDb(); });
beforeEach(async () => {
  woken.length = 0;
  await sql`DELETE FROM chat_scheduled_messages`;
  await sql`DELETE FROM chat_saved`;
});

async function conversation() {
  const a = await sql.begin((tx) => createUser(tx));
  const b = await sql.begin((tx) => createUser(tx));
  await sql`UPDATE profiles SET message_privacy = 'everyone' WHERE id = ANY(${[a, b]}::uuid[])`;
  const [{ id: channelId }] = await sql`SELECT app_private.chat_get_or_create_dm(${a}::uuid, ${b}::uuid, 'invite') AS id`;
  const [message] = await sql`SELECT (app_private.chat_send_message(${channelId}::uuid, ${a}::uuid, 'hello', ${`c-${a}`})->>'channel_seq')::int AS seq`;
  viewerId = a;
  return { a, channelId: channelId as string, seq: message!.seq as number };
}

const fromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function scheduleRow(channelId: string, userId: string, minutes: number, extra: { sent?: boolean; failed?: boolean } = {}) {
  await sql`INSERT INTO chat_scheduled_messages (channel_id, user_id, body, send_at, sent_at, failed_reason)
    VALUES (${channelId}, ${userId}, 'later', ${fromNow(minutes)}, ${extra.sent ? new Date() : null}, ${extra.failed ? "gone" : null})`;
}

test("the sweep finds scheduled messages due in the next hour, rounded up to a minute", async () => {
  const { a, channelId } = await conversation();
  await scheduleRow(channelId, a, 30);
  const times = await due.dueTimesWithinNextHour();
  assert.equal(times.length, 1);
  assert.equal(times[0]!.getSeconds(), 0);
  assert.ok(times[0]!.getTime() >= fromNow(29.9).getTime());
  assert.ok(times[0]!.getTime() <= fromNow(31.1).getTime());
});

test("the sweep skips sent, failed, already due and far-off messages", async () => {
  const { a, channelId } = await conversation();
  await scheduleRow(channelId, a, 30, { sent: true });
  await scheduleRow(channelId, a, 30, { failed: true });
  await scheduleRow(channelId, a, -5);
  await scheduleRow(channelId, a, 8 * 24 * 60);
  assert.deepEqual(await due.dueTimesWithinNextHour(), []);
});

test("the sweep finds unfired reminders and shares a minute between items", async () => {
  const { a, channelId, seq } = await conversation();
  const at = fromNow(45);
  await sql`INSERT INTO chat_saved (user_id, channel_id, message_seq, remind_at) VALUES (${a}, ${channelId}, ${seq}, ${at})`;
  await sql`INSERT INTO chat_scheduled_messages (channel_id, user_id, body, send_at) VALUES (${channelId}, ${a}, 'later', ${at})`;
  assert.equal((await due.dueTimesWithinNextHour()).length, 1);
  await sql`UPDATE chat_saved SET reminded_at = now()`;
  await sql`DELETE FROM chat_scheduled_messages`;
  assert.deepEqual(await due.dueTimesWithinNextHour(), []);
});

test("scheduling a message wakes the job for that time", async () => {
  const { channelId } = await conversation();
  const sendAt = fromNow(10).toISOString();
  const result = await later.scheduleMessage({ channelId, body: "soon", sendAt });
  assert.equal(result.success, true);
  assert.deepEqual(woken.map((at) => at.getTime()), [Date.parse(sendAt)]);
});

test("rescheduling wakes the job for the new time, and a refused one does not", async () => {
  const { channelId } = await conversation();
  const created = await later.scheduleMessage({ channelId, body: "soon", sendAt: fromNow(10).toISOString() });
  assert.ok(created.success);
  woken.length = 0;
  const sendAt = fromNow(20).toISOString();
  await later.rescheduleScheduled({ id: created.id, sendAt });
  assert.deepEqual(woken.map((at) => at.getTime()), [Date.parse(sendAt)]);
  woken.length = 0;
  await later.rescheduleScheduled({ id: "00000000-0000-4000-8000-000000000000", sendAt });
  assert.equal(woken.length, 0);
});

test("saving a message wakes the job only when it sets a reminder", async () => {
  const { channelId, seq } = await conversation();
  await later.saveMessage({ channelId, seq, on: true });
  assert.equal(woken.length, 0);
  const remindAt = fromNow(10).toISOString();
  await later.saveMessage({ channelId, seq, on: true, remindAt });
  assert.deepEqual(woken.map((at) => at.getTime()), [Date.parse(remindAt)]);
});
