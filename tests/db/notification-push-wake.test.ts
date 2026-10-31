import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

const woken: Array<{ importance: string; delayUntil: Date | null }> = [];
moduleStubs.set("@/inngest/wake", {
  wakePushIfNeeded: async (notification: { importance: string; delayUntil: Date | null }) => { woken.push(notification); },
});

let service: typeof import("../../src/lib/notifications/service");
before(async () => {
  service = await loadAppModule(() => import("../../src/lib/notifications/service"));
});
after(async () => { await sql.end(); await closeAppDb(); });
beforeEach(() => { woken.length = 0; });

const notification = (recipientUserId: string, importance: "important" | "more") => ({
  recipientUserId,
  kind: "chat_reminder" as const,
  category: "mentions" as const,
  importance,
  title: "Reminder",
  dedupeKey: `wake-test:${randomUUID()}`,
});

test("creating a notification offers it to the push wake", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const result = await service.createNotification(notification(userId, "important"));
  assert.ok(result.notification);
  assert.deepEqual(woken, [{ importance: "important", delayUntil: null }]);
});

test("a duplicate notification does not wake the job again", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const input = notification(userId, "important");
  await service.createNotification(input);
  woken.length = 0;
  await service.createNotification(input);
  assert.equal(woken.length, 0);
});

test("adding to an aggregated notification offers it to the push wake", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  const result = await service.upsertAggregatedNotification(notification(userId, "important"));
  assert.ok(result.notification);
  assert.equal(woken.length, 1);
  assert.equal(woken[0]!.importance, "important");
});

test("push delivery wakes on its event and keeps an hourly sweep", () => {
  const job = readFileSync("src/inngest/functions/notification-push-delivery.ts", "utf8");
  assert.match(job, /\[\{ event: "notification\/push\.wake" \}, \{ cron: "30 \* \* \* \*" \}\]/);
});
