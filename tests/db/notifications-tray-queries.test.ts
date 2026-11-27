import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

// Notifications mix: Unread is a query (not a filter of loaded pages), Mark all read has no 50 cap, "Done with all
// read" leaves unread rows alone, Done can be undone, and snoozed rows can be listed.
let service: typeof import("../../src/lib/notifications/service");
before(async () => { service = await loadAppModule(() => import("../../src/lib/notifications/service")); });
const made: string[] = [];
afterEach(async () => { await sql`DELETE FROM auth.users WHERE id = ANY(${made})`; made.length = 0; });
after(async () => { await sql.end(); await closeAppDb(); });

async function user() { const id = await sql.begin((tx) => createUser(tx)); made.push(id); return id; }
async function row(userId: string, over: { title?: string; seen?: boolean; snoozed?: boolean; kind?: string } = {}) {
  const [r] = await sql`INSERT INTO user_notifications (user_id, kind, importance, title, dedupe_key, seen_at, read_at, snoozed_until)
    VALUES (${userId}, ${over.kind ?? "task_assigned"}, 'more', ${over.title ?? "Row"}, ${randomUUID()},
      ${over.seen ? new Date() : null}, ${over.seen ? new Date() : null}, ${over.snoozed ? new Date(Date.now() + 3_600_000) : null}) RETURNING id`;
  return r!.id as string;
}

test("unreadOnly returns only unseen rows; q matches the title", async () => {
  const me = await user();
  await row(me, { title: "Heap sort review", seen: false });
  await row(me, { title: "Old one", seen: true });
  const unread = await service.readNotificationsPage(me, 20, null, undefined, { unreadOnly: true });
  assert.deepEqual(unread.items.map((i) => i.title), ["Heap sort review"]);
  const found = await service.readNotificationsPage(me, 20, null, undefined, { q: "old" });
  assert.deepEqual(found.items.map((i) => i.title), ["Old one"]);
});

test("mark all read reaches every unread row, past 50", async () => {
  const me = await user();
  for (let i = 0; i < 60; i++) await row(me);
  assert.equal(await service.markAllNotificationsRead(me), 60);
  assert.equal((await service.countUnreadNotifications(me)).total, 0);
});

test("done with all read leaves unread rows; undo brings a done row back; snoozed rows are listed", async () => {
  const me = await user();
  const unread = await row(me, { seen: false });
  await row(me, { seen: true });
  await row(me, { seen: true });
  assert.equal(await service.dismissReadNotifications(me), 2);
  const left = await service.readNotificationsPage(me, 20, null);
  assert.deepEqual(left.items.map((i) => i.id), [unread]);

  await service.dismissNotification(me, unread);
  assert.equal((await service.readNotificationsPage(me, 20, null)).items.length, 0);
  await service.restoreNotification(me, unread);
  assert.equal((await service.readNotificationsPage(me, 20, null)).items.length, 1);

  const snoozed = await row(me, { snoozed: true });
  assert.deepEqual((await service.readSnoozedNotifications(me)).map((i) => i.id), [snoozed]);
});
