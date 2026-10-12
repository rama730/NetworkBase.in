import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let settings: typeof import("../../src/lib/privacy/settings");
before(async () => {
  settings = await loadAppModule(() => import("../../src/lib/privacy/settings"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// API-015: keyset pages ordered by (blocked_at, edge id), stable across ties.
test("blocked accounts page without gaps or repeats, including tied block times", async () => {
  const created: string[] = [];
  try {
    const blocker = await sql.begin((tx) => createUser(tx));
    created.push(blocker);
    const targets: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const target = await sql.begin((tx) => createUser(tx));
      created.push(target);
      targets.push(target);
      // Four share one timestamp, three are distinct.
      const blockedAt = i < 4 ? "2026-01-01T00:00:00Z" : `2026-02-0${i}T00:00:00Z`;
      await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at)
                VALUES (${blocker}, ${target}, 'blocked', ${blocker}, ${blockedAt})`;
    }
    // A block the other person placed on the blocker is not the blocker's to list.
    const other = await sql.begin((tx) => createUser(tx));
    created.push(other);
    await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${other}, ${blocker}, 'blocked', ${other}, now())`;

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof settings.listBlockedAccounts>> = await settings.listBlockedAccounts(blocker, { limit: 2, cursor });
      assert.ok(page.accounts.length <= 2);
      seen.push(...page.accounts.map((a) => a.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    assert.equal(pages, 4);
    assert.equal(new Set(seen).size, 7);
    assert.deepEqual([...seen].sort(), [...targets].sort());
    const full = await settings.listBlockedAccounts(blocker, { limit: 100 });
    assert.deepEqual(full.accounts.map((a) => a.id), seen);
    assert.equal(full.nextCursor, null);
    assert.deepEqual((await settings.listBlockedAccounts(blocker, { cursor: "not-a-cursor", limit: 100 })).accounts.map((a) => a.id), seen);
  } finally {
    // blocked_by is ON DELETE SET NULL, which the blocked-status check rejects: drop the edges first.
    await sql`DELETE FROM connections WHERE requester_id = ANY(${created}::uuid[]) OR addressee_id = ANY(${created}::uuid[])`;
    await sql`DELETE FROM auth.users WHERE id = ANY(${created}::uuid[])`;
  }
});
