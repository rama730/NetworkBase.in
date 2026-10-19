import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let transition: typeof import("../../src/lib/privacy/relationship-transition");
let appDb: typeof import("../../src/lib/db").db;
before(async () => {
  transition = await loadAppModule(() => import("../../src/lib/privacy/relationship-transition"));
  appDb = (await loadAppModule(() => import("../../src/lib/db"))).db;
});
after(async () => { await sql.end(); await closeAppDb(); });

const blocks = (a: string, b: string) => sql`
  SELECT blocked_by FROM connections WHERE status = 'blocked'
    AND ((requester_id = ${a} AND addressee_id = ${b}) OR (requester_id = ${b} AND addressee_id = ${a}))`;

// SEC-010: the person who blocked first owns the block; the other side cannot replace or remove it.
test("a blocked user cannot replace or remove the other person's block", async () => {
  const a = await sql.begin((tx) => createUser(tx));
  const b = await sql.begin((tx) => createUser(tx));
  try {
    await appDb.transaction((tx) => transition.replaceRelationshipWithBlockedState(tx, a, b, new Date()));
    await appDb.transaction((tx) => transition.replaceRelationshipWithBlockedState(tx, b, a, new Date()));
    assert.deepEqual((await blocks(a, b)).map((row) => row.blocked_by), [a]);
    await appDb.transaction((tx) => transition.clearBlockedRelationshipState(tx, b, a));
    assert.deepEqual((await blocks(a, b)).map((row) => row.blocked_by), [a]);
    await appDb.transaction((tx) => transition.clearBlockedRelationshipState(tx, a, b));
    assert.equal((await blocks(a, b)).length, 0);
  } finally {
    await sql`DELETE FROM connections WHERE requester_id = ANY(${[a, b]}::uuid[]) OR addressee_id = ANY(${[a, b]}::uuid[])`;
    await sql`DELETE FROM profiles WHERE id = ANY(${[a, b]}::uuid[])`;
  }
});

test("simultaneous blocks in both directions leave exactly one row", async () => {
  const a = await sql.begin((tx) => createUser(tx));
  const b = await sql.begin((tx) => createUser(tx));
  try {
    await Promise.all([
      appDb.transaction((tx) => transition.replaceRelationshipWithBlockedState(tx, a, b, new Date())),
      appDb.transaction((tx) => transition.replaceRelationshipWithBlockedState(tx, b, a, new Date())),
    ]);
    assert.equal((await blocks(a, b)).length, 1);
  } finally {
    await sql`DELETE FROM connections WHERE requester_id = ANY(${[a, b]}::uuid[]) OR addressee_id = ANY(${[a, b]}::uuid[])`;
    await sql`DELETE FROM profiles WHERE id = ANY(${[a, b]}::uuid[])`;
  }
});
