import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createUser, inRollback, sql, type Tx } from "./_helpers";

after(() => sql.end());

const visibleTo = async (tx: Tx, viewer: string | null, id: string) => {
  await actAs(tx, viewer);
  const rows = await tx`SELECT id FROM public.connections WHERE id = ${id}`;
  await actAsOwner(tx);
  return rows.length;
};

test("a connection is readable by its two people only", async () => {
  await inRollback(async (tx) => {
    const [a, b, outsider] = [await createUser(tx), await createUser(tx), await createUser(tx)];
    const [row] = await tx`INSERT INTO public.connections (requester_id, addressee_id, status) VALUES (${a}, ${b}, 'accepted') RETURNING id`;
    assert.equal(await visibleTo(tx, a, row!.id), 1);
    assert.equal(await visibleTo(tx, b, row!.id), 1);
    assert.equal(await visibleTo(tx, outsider, row!.id), 0);
    assert.equal(await visibleTo(tx, null, row!.id), 0);
  });
});

// Blocks moved to user_blocks; a legacy blocked row must still never reveal who blocked whom.
test("a blocked row is hidden from the person who was blocked", async () => {
  await inRollback(async (tx) => {
    const [blocker, blocked] = [await createUser(tx), await createUser(tx)];
    const [row] = await tx`INSERT INTO public.connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${blocker}, ${blocked}, 'blocked', ${blocker}, now()) RETURNING id`;
    assert.equal(await visibleTo(tx, blocker, row!.id), 1);
    assert.equal(await visibleTo(tx, blocked, row!.id), 0);
  });
});

test("the read rule resolves the caller once per query", async () => {
  const rows = await sql`SELECT policyname, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connections' AND NOT 'nb_app' = ANY (roles)`;
  assert.deepEqual(rows.map((r) => r.policyname), ["connections_select_participant_visible"]);
  assert.doesNotMatch(String(rows[0]!.qual), /(?<!SELECT )auth\.uid\(\)/);
});
