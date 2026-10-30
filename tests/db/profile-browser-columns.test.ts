import assert from "node:assert/strict";
import { after, test } from "node:test";

import { actAs, actAsOwner, createUser, inRollback, sql } from "./_helpers";

// Browsers read display columns only; email and preferences stay with the server (nb_app).
after(() => sql.end());

const denied = async (tx: Parameters<Parameters<typeof inRollback>[0]>[0], query: string) =>
  assert.rejects(tx.savepoint((sp) => sp.unsafe(query)), /permission denied/, query);

test("browser roles read profile display columns, never email or preferences", async () => {
  await inRollback(async (tx) => {
    const target = await createUser(tx);
    for (const viewer of [null, await createUser(tx)]) {
      await actAs(tx, viewer);
      const rows = await tx`SELECT id, full_name, avatar_url, username, created_at, updated_at, deleted_at FROM public.profiles WHERE id = ${target}`;
      assert.equal(rows.length, 1);
      await denied(tx, "SELECT email FROM public.profiles");
      await denied(tx, "SELECT notification_preferences FROM public.profiles");
      await denied(tx, "SELECT * FROM public.profiles");
      await actAsOwner(tx);
    }
  });
});

test("a person cannot read their own email through the browser either", async () => {
  await inRollback(async (tx) => {
    const me = await createUser(tx);
    await actAs(tx, me);
    await denied(tx, "SELECT email FROM public.profiles");
    await actAsOwner(tx);
    const [row] = await tx`SELECT email FROM public.profiles WHERE id = ${me}`;
    assert.ok(row?.email, "the server still reads it");
  });
});
