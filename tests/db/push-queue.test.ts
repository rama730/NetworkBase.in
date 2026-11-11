import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let queue: typeof import("../../src/lib/notifications/push-queue");
before(async () => {
  queue = await loadAppModule(() => import("../../src/lib/notifications/push-queue"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// COR-018: permanent failures must not occupy the page, and retries back off then stop.
test("a page of failing notifications does not starve fresh ones; backoff and the attempt cap apply", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  try {
    const notify = async (title: string, createdAt: string) => (await sql`
      INSERT INTO user_notifications (user_id, kind, importance, title, dedupe_key, created_at)
      VALUES (${userId}, 'test', 'important', ${title}, ${`${title}-${Math.random()}`}, ${createdAt}) RETURNING id`)[0]!.id as string;
    const fail = (id: string, minutesAgo: number, count = 1) => sql`
      INSERT INTO notification_deliveries (notification_id, user_id, channel, status, attempted_at)
      SELECT ${id}, ${userId}, 'web_push', 'failed', now() - make_interval(mins => ${minutesAgo}) FROM generate_series(1, ${count})`;

    const oldFailingRecent = await notify("old-failing-recent", "2026-01-01T00:00:00Z"); // failed 1 min ago: still backing off
    const oldFailingDue = await notify("old-failing-due", "2026-01-01T00:01:00Z");         // failed 20 min ago: due again
    const exhausted = await notify("exhausted", "2026-01-01T00:02:00Z");                    // failed 6 times: stop
    const fresh = await notify("fresh", "2026-06-01T00:00:00Z");                            // never attempted
    const delivered = await notify("delivered", "2026-01-01T00:03:00Z");
    await fail(oldFailingRecent, 1);
    await fail(oldFailingDue, 20);
    await fail(exhausted, 600, 6);
    await sql`INSERT INTO notification_deliveries (notification_id, user_id, channel, status) VALUES (${delivered}, ${userId}, 'web_push', 'delivered')`;

    // The test database is shared: other suites leave fresh notifications too, so read a page big enough to hold
    // them all, then look at this user's rows (a page of 100 dropped the due failure once 330 others existed).
    const ALL = 100_000;
    const due = (await queue.selectDueWebPushNotifications(ALL)).filter((row) => row.notification.userId === userId).map((row) => row.notification.id);
    assert.deepEqual(due, [fresh, oldFailingDue], "fresh first, then the failure that has waited out its backoff");

    assert.ok(!due.includes(oldFailingRecent) && !due.includes(exhausted) && !due.includes(delivered));

    // Backoff doubles: two failures need >= 10 minutes.
    await fail(oldFailingRecent, 8);
    assert.ok(!(await queue.selectDueWebPushNotifications(ALL)).some((row) => row.notification.id === oldFailingRecent));
  } finally {
    await sql`DELETE FROM notification_deliveries WHERE user_id = ${userId}`;
    await sql`DELETE FROM user_notifications WHERE user_id = ${userId}`;
  }
});
