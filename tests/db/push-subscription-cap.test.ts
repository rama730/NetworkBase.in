import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let actingUser = "";
let actions: typeof import("../../src/app/actions/push-subscriptions");
let MAX: number;
before(async () => {
  moduleStubs.set("@/lib/supabase/server", {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: actingUser } } }) } }),
  });
  actions = await loadAppModule(() => import("../../src/app/actions/push-subscriptions"));
  ({ MAX_PUSH_ENDPOINTS_PER_USER: MAX } = await import("../../src/lib/notifications/push-endpoint"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// PERF-005: devices per account are capped, keeping the most recently seen.
test("saving more subscriptions than the cap drops the least recently seen", async () => {
  const user = await sql.begin((tx) => createUser(tx));
  try {
    actingUser = user;
    const total = MAX + 3;
    for (let index = 0; index < total; index += 1) {
      const result = await actions.savePushSubscriptionAction({
        endpoint: `https://fcm.googleapis.com/fcm/send/${user}-${index}`,
        p256dh: "p", auth: "a",
      });
      assert.equal(result.success, true);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const rows = await sql`SELECT endpoint FROM push_subscriptions WHERE user_id = ${user} ORDER BY last_seen_at`;
    assert.equal(rows.length, MAX);
    assert.ok(rows.every((row) => !String(row.endpoint).endsWith(`-0`) && !String(row.endpoint).endsWith(`-1`) && !String(row.endpoint).endsWith(`-2`)));
    assert.ok(String(rows.at(-1)!.endpoint).endsWith(`-${total - 1}`));
  } finally {
    await sql`DELETE FROM push_subscriptions WHERE user_id = ${user}`;
  }
});
