import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let service: typeof import("../../src/lib/notifications/service");
before(async () => {
  service = await loadAppModule(() => import("../../src/lib/notifications/service"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// COR-016: replaying a source event must not count it twice; a different event must.
test("aggregate counts each source event once, however often it is replayed", async () => {
  const recipient = await sql.begin((tx) => createUser(tx));
  const actor = await sql.begin((tx) => createUser(tx));
  try {
    const input = (sourceEventId: string | null) => ({
      recipientUserId: recipient,
      actorUserId: actor,
      kind: "task_assigned" as never,
      category: "tasks" as never,
      title: "Burst",
      dedupeKey: "burst:key",
      aggregateCount: 1,
      entityRefs: { projectId: "p" } as never,
      sourceEventId,
    });
    const count = async () => Number((await sql`SELECT aggregate_count FROM user_notifications WHERE user_id = ${recipient} AND dedupe_key = 'burst:key'`)[0]!.aggregate_count);

    await service.upsertAggregatedNotification(input("evt-1"));
    assert.equal(await count(), 1);
    await service.upsertAggregatedNotification(input("evt-1")); // replay after a lost acknowledgement
    await service.upsertAggregatedNotification(input("evt-1"));
    assert.equal(await count(), 1, "replays add nothing");
    await service.upsertAggregatedNotification(input("evt-2"));
    assert.equal(await count(), 2, "a distinct event counts");
    await service.upsertAggregatedNotification(input("evt-2"));
    assert.equal(await count(), 2);

    // A replay must not resurrect a notification the user already read, but a new event does.
    await sql`UPDATE user_notifications SET read_at = now() WHERE user_id = ${recipient} AND dedupe_key = 'burst:key'`;
    await service.upsertAggregatedNotification(input("evt-2"));
    assert.notEqual((await sql`SELECT read_at FROM user_notifications WHERE user_id = ${recipient} AND dedupe_key = 'burst:key'`)[0]!.read_at, null, "replay keeps it read");
    await service.upsertAggregatedNotification(input("evt-3"));
    const [after3] = await sql`SELECT read_at, aggregate_count FROM user_notifications WHERE user_id = ${recipient} AND dedupe_key = 'burst:key'`;
    assert.equal(after3!.read_at, null);
    assert.equal(Number(after3!.aggregate_count), 1, "a read aggregate restarts its count");

    // Without a source id the old behaviour holds (every call counts).
    await service.upsertAggregatedNotification(input(null));
    await service.upsertAggregatedNotification(input(null));
    assert.equal(await count(), 3);

    // The remembered window is bounded.
    for (let i = 0; i < 30; i += 1) await service.upsertAggregatedNotification(input(`many-${i}`));
    const [refs] = await sql`SELECT jsonb_array_length(entity_refs->'aggregateSources') AS n FROM user_notifications WHERE user_id = ${recipient} AND dedupe_key = 'burst:key'`;
    assert.ok(Number(refs!.n) <= 20);
  } finally {
    await sql`DELETE FROM user_notifications WHERE user_id = ${recipient}`;
  }
});
