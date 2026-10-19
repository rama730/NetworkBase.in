import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, loadAppModule, sql } from "./_helpers";

let leases: typeof import("../../src/lib/leases");
before(async () => {
  leases = await loadAppModule(() => import("../../src/lib/leases"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const scope = () => `test:${Math.random().toString(36).slice(2)}`;

// ARCH-001
test("only one holder at a time; an expired lease is taken over with a higher fence", async () => {
  const s = scope();
  const first = await leases.acquireWorkLease(s, 60_000);
  assert.ok(first);
  assert.equal(await leases.acquireWorkLease(s, 60_000), null, "a live lease is exclusive");
  assert.equal(await leases.renewWorkLease(first, 60_000), true);

  await sql`UPDATE work_leases SET expires_at = now() - interval '1 second' WHERE scope = ${s}`;
  const second = await leases.acquireWorkLease(s, 60_000);
  assert.ok(second);
  assert.equal(second.fence, first.fence + 1);
  assert.equal(await leases.renewWorkLease(first, 60_000), false, "the old holder cannot renew");
  await leases.releaseWorkLease(first); // a stale release is a no-op
  assert.equal(await leases.acquireWorkLease(s, 60_000), null);
  await leases.releaseWorkLease(second);
  assert.ok(await leases.acquireWorkLease(s, 60_000), "released leases can be taken");
  await sql`DELETE FROM work_leases WHERE scope = ${s}`;
});

test("concurrent acquirers: exactly one wins", async () => {
  const s = scope();
  const results = await Promise.all(Array.from({ length: 8 }, () => leases.acquireWorkLease(s, 60_000)));
  assert.equal(results.filter(Boolean).length, 1);
  await sql`DELETE FROM work_leases WHERE scope = ${s}`;
});

test("the fence check rejects a stale holder inside a transaction", async () => {
  const s = scope();
  const stale = await leases.acquireWorkLease(s, 60_000);
  assert.ok(stale);
  const { db } = await loadAppModule(() => import("../../src/lib/db"));
  await db.transaction(async (tx) => { await leases.assertWorkLeaseHeld(tx, stale); });

  await sql`UPDATE work_leases SET expires_at = now() - interval '1 second' WHERE scope = ${s}`;
  const current = await leases.acquireWorkLease(s, 60_000);
  assert.ok(current);
  await assert.rejects(db.transaction(async (tx) => { await leases.assertWorkLeaseHeld(tx, stale); }), leases.LeaseLostError);
  await db.transaction(async (tx) => { await leases.assertWorkLeaseHeld(tx, current); });
  await sql`DELETE FROM work_leases WHERE scope = ${s}`;
});

test("withWorkLease runs the task, skips a busy scope and always releases", async () => {
  const s = scope();
  let inside: { fence: number } | null = null;
  const ran = await leases.withWorkLease(s, 60_000, async (lease) => {
    inside = lease;
    const busy = await leases.withWorkLease(s, 60_000, async () => "never");
    assert.deepEqual(busy, { skipped: true });
    return "done";
  });
  assert.deepEqual(ran, { skipped: false, value: "done" });
  assert.ok(inside);
  await assert.rejects(leases.withWorkLease(s, 60_000, async () => { throw new Error("boom"); }), /boom/);
  assert.equal((await sql`SELECT count(*)::int AS n FROM work_leases WHERE scope = ${s}`)[0]!.n, 0);
});
